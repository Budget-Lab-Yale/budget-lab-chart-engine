// tbl-chart CLI entry point.
// Exported functions (runValidate, runRender, runSnapshot) are unit-testable — they accept
// injected bundle/css and return {exitCode, message} rather than side-effecting.
// main() wires them to real disk I/O and process.exit.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { dirname, basename, extname, resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { validateSpec, validateChartData, validateChart } from "../spec/validate";
import { validateTableSpec, validateTableData } from "../spec/table-validate";
import { loadData } from "../data/load";
import { buildStandaloneHtml } from "../embed/bundle-standalone";
import type { SharedAssetsInput } from "../embed/bundle-standalone";
import {
  buildSharedStylesheet,
  runtimeAssetName,
  stylesAssetName,
} from "../embed/shared-assets";
import { CHART_CSS } from "../embed/styles";
import { createServer, findSpecs } from "./serve";
import { renderChartPng } from "../snapshot/render-png";
import { comparePng } from "../snapshot/compare";
import { isTableSpec } from "./table-detect";
import type { ChartSpec } from "../spec/types";
import { resolveColumns } from "../spec/columns";
import type { TidyRow } from "../data/index";

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function usageText(): string {
  return [
    "tbl-chart — Budget Lab chart engine CLI",
    "",
    "Usage: tbl-chart <command> [options]",
    "",
    "Commands:",
    "  validate <spec.yaml>             schema + cross-reference + CSV validation",
    "  render   <spec.yaml> [-o <out.html>] [--eyebrow <text>] [--assets-base <url>]",
    "                                   render to HTML — self-contained, or linking shared assets",
    "  assets   -o <dir>                write the shared runtime + stylesheet",
    "  serve    [dir] [--port <n>]      local review gallery (default port 5173)",
    "  snapshot <spec.yaml> [--baseline <path>] [--update]",
    "                                   compare or update a PNG baseline snapshot",
    "",
    "Options:",
    "  -h, --help   show this help",
    "",
    "Shared assets: `assets -o <dir>` emits engine-<version>.js and chart-<version>.css.",
    "Rendering with `--assets-base <url>` links those instead of inlining them, which is ~1.65 MB",
    "smaller per page. The URL must be RELATIVE to the page (e.g. ../../embed/v1) so the output",
    "still works from file:// and under a preview path prefix.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read a file and return its text, or throw with a clean one-line message. */
async function readTextFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    throw new Error(`cannot read file: ${path}: ${(err as NodeJS.ErrnoException).message}`);
  }
}

/** Parse YAML text, throwing a clean error on failure. */
function parseYamlSpec(text: string, sourcePath: string): unknown {
  try {
    return parseYaml(text);
  } catch (err) {
    throw new Error(`${sourcePath}: YAML parse error: ${(err as Error).message}`);
  }
}

/** Path to a build output, resolved relative to this module (dist/cli/ at runtime). */
function distPath(rel: string): string {
  return fileURLToPath(new URL(`../${rel}`, import.meta.url));
}

/** This engine's own version — the value baked into shared asset filenames. */
async function engineVersion(): Promise<string> {
  const pkgPath = fileURLToPath(new URL("../../package.json", import.meta.url));
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { version?: string };
  if (!pkg.version) throw new Error(`no version field in ${pkgPath}`);
  return pkg.version;
}

/** Read the pre-built browser bundle, with a build-first hint when it's absent. */
async function readLiveBundle(cmd: string): Promise<string> {
  const path = distPath("embed/live.js");
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    throw new Error(
      `tbl-chart ${cmd}: cannot read live bundle at ${path}.\n` +
        `Run \`npm run build\` first.\n` +
        `(${(err as Error).message})`,
    );
  }
}

// ---------------------------------------------------------------------------
// runValidate
// ---------------------------------------------------------------------------

export interface ValidateResult {
  exitCode: number;
  message: string;
}

/**
 * Run `tbl-chart validate <specPath>`.
 * Returns {exitCode, message} — caller is responsible for printing and exiting.
 */
export async function runValidate(specPath: string): Promise<ValidateResult> {
  const absSpecPath = resolve(specPath);
  const specText = await readTextFile(absSpecPath);
  const spec = parseYamlSpec(specText, absSpecPath);

  // --- Table path ---
  if (isTableSpec(spec)) {
    const structural = validateTableSpec(spec);
    if (!structural.valid) {
      const lines = structural.errors.map((e) => `${absSpecPath}: ${e}`).join("\n");
      return { exitCode: 1, message: lines };
    }

    const baseDir = dirname(absSpecPath);
    let rows: TidyRow[];
    try {
      rows = await loadData(spec.data, { baseDir });
    } catch (err) {
      return {
        exitCode: 1,
        message: `${absSpecPath}: data load failed: ${(err as Error).message}`,
      };
    }

    const dataResult = validateTableData(spec, rows);
    if (!dataResult.valid) {
      const lines = dataResult.errors.map((e) => `${absSpecPath}: ${e}`).join("\n");
      return { exitCode: 1, message: lines };
    }

    return {
      exitCode: 0,
      message: `OK: ${absSpecPath} (${rows.length} rows, table)`,
    };
  }

  // --- Chart path ---
  const structural = validateSpec(spec);
  if (!structural.valid) {
    const lines = structural.errors.map((e) => `${absSpecPath}: ${e}`).join("\n");
    return { exitCode: 1, message: lines };
  }

  const typedSpec = spec as ChartSpec;
  const baseDir = dirname(absSpecPath);
  let rows: TidyRow[];
  try {
    rows = await loadData(typedSpec.data, { baseDir });
  } catch (err) {
    return {
      exitCode: 1,
      message: `${absSpecPath}: data load failed: ${(err as Error).message}`,
    };
  }

  const dataResult = validateChartData(typedSpec, rows);
  if (!dataResult.valid) {
    const lines = dataResult.errors.map((e) => `${absSpecPath}: ${e}`).join("\n");
    return { exitCode: 1, message: lines };
  }

  const cols = resolveColumns(typedSpec, rows);
  const seriesSet = new Set<string>();
  for (const row of rows) {
    seriesSet.add(cols.series ? (row[cols.series] ?? "") : "");
  }

  return {
    exitCode: 0,
    message: `OK: ${absSpecPath} (${rows.length} rows, ${seriesSet.size} series)`,
  };
}

// ---------------------------------------------------------------------------
// runRender
// ---------------------------------------------------------------------------

export interface RenderOptions {
  /** Caller-supplied output path (from -o flag). If omitted, defaults to cwd/<specBasename>.html */
  outPath?: string;
  /** Pre-built browser IIFE bundle contents. Injected so tests can pass a stub. Not needed when
   *  `assets` is set — the page links the shared runtime instead of inlining it. */
  liveBundleJs?: string;
  /** CSS string. Injected so tests can pass a stub. */
  css: string;
  /** Eyebrow / figure number (from --eyebrow). An article-context property baked into the
   *  output; omitted → no eyebrow. The embedder can still hide a baked value via `?eyebrow=off`. */
  eyebrow?: string;
  /** Link shared versioned assets (from `tbl-chart assets`) instead of inlining them. */
  assets?: SharedAssetsInput;
}

export interface RenderResult {
  exitCode: number;
  message: string;
  /** Absolute path written, set only on success. */
  htmlPath?: string;
}

/**
 * Run `tbl-chart render <specPath> [-o outPath]`.
 * Accepts injected liveBundleJs + css for testability.
 */
export async function runRender(
  specPath: string,
  opts: RenderOptions,
): Promise<RenderResult> {
  const absSpecPath = resolve(specPath);
  const specText = await readTextFile(absSpecPath);
  const spec = parseYamlSpec(specText, absSpecPath);

  // Determine output path (shared between chart and table paths).
  const specBase = basename(absSpecPath, extname(absSpecPath));
  const outPath = opts.outPath
    ? resolve(opts.outPath)
    : resolve(process.cwd(), `${specBase}.html`);

  // --- Table path ---
  if (isTableSpec(spec)) {
    const structural = validateTableSpec(spec);
    if (!structural.valid) {
      const lines = structural.errors.map((e) => `${absSpecPath}: ${e}`).join("\n");
      return { exitCode: 1, message: lines };
    }

    const baseDir = dirname(absSpecPath);
    let rows: TidyRow[];
    try {
      rows = await loadData(spec.data, { baseDir });
    } catch (err) {
      return {
        exitCode: 1,
        message: `${absSpecPath}: data load failed: ${(err as Error).message}`,
      };
    }

    const dataResult = validateTableData(spec, rows);
    if (!dataResult.valid) {
      const lines = dataResult.errors.map((e) => `${absSpecPath}: ${e}`).join("\n");
      return { exitCode: 1, message: lines };
    }

    const html = buildStandaloneHtml({
      spec: spec as unknown as ChartSpec,
      rows,
      liveBundleJs: opts.liveBundleJs,
      css: opts.css,
      assets: opts.assets,
      eyebrow: opts.eyebrow,
      mountFn: "mountTable",
    });

    try {
      await writeFile(outPath, html, "utf8");
    } catch (err) {
      return {
        exitCode: 1,
        message: `cannot write output: ${outPath}: ${(err as NodeJS.ErrnoException).message}`,
      };
    }

    return { exitCode: 0, message: `Wrote ${outPath}`, htmlPath: outPath };
  }

  // --- Chart path ---
  const structural = validateSpec(spec);
  if (!structural.valid) {
    const lines = structural.errors.map((e) => `${absSpecPath}: ${e}`).join("\n");
    return { exitCode: 1, message: lines };
  }

  const baseDir = dirname(absSpecPath);
  let rows: TidyRow[];
  try {
    rows = await loadData((spec as ChartSpec).data, { baseDir });
  } catch (err) {
    return {
      exitCode: 1,
      message: `${absSpecPath}: data load failed: ${(err as Error).message}`,
    };
  }

  const result = validateChart(spec, rows);
  if (!result.valid) {
    const lines = result.errors.map((e) => `${absSpecPath}: ${e}`).join("\n");
    return { exitCode: 1, message: lines };
  }

  const typedSpec = spec as ChartSpec;
  const html = buildStandaloneHtml({
    spec: typedSpec,
    rows,
    liveBundleJs: opts.liveBundleJs,
    css: opts.css,
    assets: opts.assets,
    eyebrow: opts.eyebrow,
  });

  try {
    await writeFile(outPath, html, "utf8");
  } catch (err) {
    return {
      exitCode: 1,
      message: `cannot write output: ${outPath}: ${(err as NodeJS.ErrnoException).message}`,
    };
  }

  return {
    exitCode: 0,
    message: `Wrote ${outPath}`,
    htmlPath: outPath,
  };
}

// ---------------------------------------------------------------------------
// runAssets
// ---------------------------------------------------------------------------

export interface AssetsOptions {
  /** Directory to write the shared assets into. Created if missing. */
  outDir: string;
  /** Engine version the filenames carry. */
  version: string;
  /** Pre-built browser IIFE bundle contents. */
  liveBundleJs: string;
  /** Chart CSS, wrapped with the base64 @font-face into the shared stylesheet. */
  css: string;
}

export interface AssetsResult {
  exitCode: number;
  message: string;
  /** Written filenames, relative to outDir — the manifest a site build consumes. */
  manifest?: { version: string; runtime: string; styles: string };
}

/**
 * Run `tbl-chart assets -o <dir>`: write the shared runtime, stylesheet, and font.
 *
 * Writing is idempotent — for a given engine version the bytes are fixed, so re-running over an
 * existing directory is a no-op in effect. Callers publish the whole directory and keep old
 * versions until no page references them.
 */
export async function runAssets(opts: AssetsOptions): Promise<AssetsResult> {
  const { outDir, version, liveBundleJs, css } = opts;
  const manifest = {
    version,
    runtime: runtimeAssetName(version),
    styles: stylesAssetName(version),
  };

  try {
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, manifest.runtime), liveBundleJs, "utf8");
    await writeFile(join(outDir, manifest.styles), buildSharedStylesheet(css), "utf8");
  } catch (err) {
    return {
      exitCode: 1,
      message: `cannot write assets to ${outDir}: ${(err as NodeJS.ErrnoException).message}`,
    };
  }

  return {
    exitCode: 0,
    message: `Wrote ${manifest.runtime} and ${manifest.styles} to ${outDir}`,
    manifest,
  };
}

// ---------------------------------------------------------------------------
// runSnapshot
// ---------------------------------------------------------------------------

export interface SnapshotOptions {
  /** Path to the baseline PNG. Defaults to <specDir>/baseline.png */
  baselinePath?: string;
  /** When true, write the rendered PNG to baselinePath and return success. */
  update?: boolean;
  /** Pre-built browser IIFE bundle contents. Injected so tests can pass a stub. */
  liveBundleJs: string;
  /** CSS string. Injected so tests can pass a stub. */
  css: string;
}

export interface SnapshotResult {
  exitCode: number;
  message: string;
}

/**
 * Run `tbl-chart snapshot <specPath> [--baseline <path>] [--update]`.
 * Renders the chart to PNG via headless Chromium.
 * --update: writes the PNG as the new baseline.
 * Without --update: compares against the existing baseline.
 * Returns {exitCode, message} — caller is responsible for printing and exiting.
 */
export async function runSnapshot(
  specPath: string,
  opts: SnapshotOptions,
): Promise<SnapshotResult> {
  const absSpecPath = resolve(specPath);
  const specDir = dirname(absSpecPath);

  // Parse and validate the spec.
  let specText: string;
  try {
    specText = await readFile(absSpecPath, "utf8");
  } catch (err) {
    return {
      exitCode: 1,
      message: `cannot read file: ${absSpecPath}: ${(err as NodeJS.ErrnoException).message}`,
    };
  }

  let spec: unknown;
  try {
    spec = parseYaml(specText);
  } catch (err) {
    return {
      exitCode: 1,
      message: `${absSpecPath}: YAML parse error: ${(err as Error).message}`,
    };
  }

  // --- Table path: validate via the table validators and build the table standalone HTML. ---
  let html: string;
  if (isTableSpec(spec)) {
    const structuralTable = validateTableSpec(spec);
    if (!structuralTable.valid) {
      const lines = structuralTable.errors.map((e) => `${absSpecPath}: ${e}`).join("\n");
      return { exitCode: 1, message: lines };
    }

    let tableRows: TidyRow[];
    try {
      tableRows = await loadData(spec.data, { baseDir: specDir });
    } catch (err) {
      return {
        exitCode: 1,
        message: `${absSpecPath}: data load failed: ${(err as Error).message}`,
      };
    }

    const dataResult = validateTableData(spec, tableRows);
    if (!dataResult.valid) {
      const lines = dataResult.errors.map((e) => `${absSpecPath}: ${e}`).join("\n");
      return { exitCode: 1, message: lines };
    }

    html = buildStandaloneHtml({
      spec: spec as unknown as ChartSpec,
      rows: tableRows,
      liveBundleJs: opts.liveBundleJs,
      css: opts.css,
      mountFn: "mountTable",
    });
  } else {
    const structural = validateSpec(spec);
    if (!structural.valid) {
      const lines = structural.errors.map((e) => `${absSpecPath}: ${e}`).join("\n");
      return { exitCode: 1, message: lines };
    }

    let rows: TidyRow[];
    try {
      rows = await loadData((spec as ChartSpec).data, { baseDir: specDir });
    } catch (err) {
      return {
        exitCode: 1,
        message: `${absSpecPath}: data load failed: ${(err as Error).message}`,
      };
    }

    const result = validateChart(spec, rows);
    if (!result.valid) {
      const lines = result.errors.map((e) => `${absSpecPath}: ${e}`).join("\n");
      return { exitCode: 1, message: lines };
    }

    const typedSpec = spec as ChartSpec;
    html = buildStandaloneHtml({
      spec: typedSpec,
      rows,
      liveBundleJs: opts.liveBundleJs,
      css: opts.css,
    });
  }

  // Render to PNG via headless browser.
  let pngBuffer: Buffer;
  try {
    pngBuffer = await renderChartPng(html);
  } catch (err) {
    return {
      exitCode: 1,
      message: `snapshot render failed: ${(err as Error).message}`,
    };
  }

  const baselinePath = opts.baselinePath
    ? resolve(opts.baselinePath)
    : resolve(specDir, "baseline.png");

  // --update mode: write the PNG and exit.
  if (opts.update) {
    try {
      await writeFile(baselinePath, pngBuffer);
    } catch (err) {
      return {
        exitCode: 1,
        message: `cannot write baseline: ${baselinePath}: ${(err as NodeJS.ErrnoException).message}`,
      };
    }
    return { exitCode: 0, message: `Updated baseline ${baselinePath}` };
  }

  // Compare mode: baseline must exist.
  if (!existsSync(baselinePath)) {
    return {
      exitCode: 1,
      message:
        `baseline not found: ${baselinePath}\n` +
        `Run with --update to create it.`,
    };
  }

  let baselineBuffer: Buffer;
  try {
    baselineBuffer = await readFile(baselinePath);
  } catch (err) {
    return {
      exitCode: 1,
      message: `cannot read baseline: ${baselinePath}: ${(err as NodeJS.ErrnoException).message}`,
    };
  }

  const diffOutPath = baselinePath.replace(/\.png$/i, ".diff.png");
  const cmp = await comparePng(pngBuffer, baselineBuffer, { diffOutPath });

  if (cmp.match) {
    return { exitCode: 0, message: `Snapshot OK` };
  }

  return {
    exitCode: 1,
    message: `Snapshot DIFFERS: ${cmp.diffPixels} px (wrote ${diffOutPath})`,
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

export async function main(argv: string[]): Promise<number> {
  const cmd = argv[2];

  if (!cmd || cmd === "--help" || cmd === "-h") {
    console.log(usageText());
    return 0;
  }

  if (cmd === "validate") {
    const { positionals } = parseArgs({
      args: argv.slice(3),
      options: {},
      allowPositionals: true,
    });
    const specPath = positionals[0];
    if (!specPath) {
      console.error("tbl-chart validate: missing <spec.yaml> argument\n");
      console.error(usageText());
      return 1;
    }
    const result = await runValidate(specPath);
    if (result.exitCode === 0) {
      console.log(result.message);
    } else {
      console.error(result.message);
    }
    return result.exitCode;
  }

  if (cmd === "render") {
    const { positionals, values } = parseArgs({
      args: argv.slice(3),
      options: {
        output: { type: "string", short: "o" },
        eyebrow: { type: "string" },
        "assets-base": { type: "string" },
      },
      allowPositionals: true,
    });
    const specPath = positionals[0];
    if (!specPath) {
      console.error("tbl-chart render: missing <spec.yaml> argument\n");
      console.error(usageText());
      return 1;
    }

    const assetsBase = values["assets-base"];
    if (assetsBase !== undefined && /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(assetsBase)) {
      console.error(
        `tbl-chart render: --assets-base must be a relative URL, got ${JSON.stringify(assetsBase)}.\n` +
          `An absolute URL breaks file:// rendering and preview path prefixes.`,
      );
      return 1;
    }

    // Shared-asset mode never inlines the bundle, so don't spend a 1.5 MB read per page on it.
    let liveBundleJs: string | undefined;
    let assets: SharedAssetsInput | undefined;
    try {
      if (assetsBase === undefined) liveBundleJs = await readLiveBundle("render");
      else assets = { base: assetsBase, version: await engineVersion() };
    } catch (err) {
      console.error((err as Error).message);
      return 1;
    }

    const result = await runRender(specPath, {
      outPath: values.output,
      liveBundleJs,
      css: CHART_CSS,
      assets,
      eyebrow: values.eyebrow,
    });
    if (result.exitCode === 0) {
      console.log(result.message);
    } else {
      console.error(result.message);
    }
    return result.exitCode;
  }

  if (cmd === "assets") {
    const { values } = parseArgs({
      args: argv.slice(3),
      options: {
        output: { type: "string", short: "o" },
        json: { type: "boolean" },
      },
      allowPositionals: true,
    });
    if (!values.output) {
      console.error("tbl-chart assets: missing -o <dir> argument\n");
      console.error(usageText());
      return 1;
    }

    let liveBundleJs: string;
    let version: string;
    try {
      liveBundleJs = await readLiveBundle("assets");
      version = await engineVersion();
    } catch (err) {
      console.error((err as Error).message);
      return 1;
    }

    const result = await runAssets({
      outDir: resolve(values.output),
      version,
      liveBundleJs,
      css: CHART_CSS,
    });
    if (result.exitCode === 0) {
      console.log(values.json ? JSON.stringify(result.manifest) : result.message);
    } else {
      console.error(result.message);
    }
    return result.exitCode;
  }

  if (cmd === "serve") {
    const { positionals, values } = parseArgs({
      args: argv.slice(3),
      options: {
        port: { type: "string" },
      },
      allowPositionals: true,
    });

    const rootDir = resolve(positionals[0] ?? process.cwd());
    const port = values.port !== undefined ? parseInt(values.port, 10) : 5173;

    if (Number.isNaN(port) || port < 1 || port > 65535) {
      console.error(`tbl-chart serve: invalid port ${JSON.stringify(values.port)}`);
      return 1;
    }

    // Read the pre-built live bundle from disk relative to this module.
    const liveBundlePath = fileURLToPath(new URL("../embed/live.js", import.meta.url));
    let liveBundleJs: string;
    try {
      liveBundleJs = await readFile(liveBundlePath, "utf8");
    } catch (err) {
      console.error(
        `tbl-chart serve: cannot read live bundle at ${liveBundlePath}.\n` +
          `Run \`npm run build\` first.\n` +
          `(${(err as Error).message})`,
      );
      return 1;
    }

    const specs = findSpecs(rootDir);
    const server = createServer({ rootDir, liveBundleJs, css: CHART_CSS });

    await new Promise<void>((resolvePromise, reject) => {
      server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          console.error(
            `tbl-chart serve: port ${port} is already in use.\n` +
              `Try a different port with --port <n>.`,
          );
        } else {
          console.error(`tbl-chart serve: server error: ${err.message}`);
        }
        reject(err);
      });

      server.listen(port, () => {
        console.log(
          `Serving ${specs.length} spec${specs.length === 1 ? "" : "s"} from ${rootDir} at http://localhost:${port}`,
        );
        resolvePromise();
      });
    }).catch(() => {
      return;
    });

    // If server failed to start, error was already printed above; return non-zero.
    if (!server.listening) return 1;

    // Keep the process alive until interrupted.
    await new Promise<void>(() => {
      // Intentionally never resolves — server runs until SIGINT/SIGTERM.
    });

    return 0;
  }

  if (cmd === "snapshot") {
    const { positionals, values } = parseArgs({
      args: argv.slice(3),
      options: {
        baseline: { type: "string" },
        update: { type: "boolean" },
      },
      allowPositionals: true,
    });
    const specPath = positionals[0];
    if (!specPath) {
      console.error("tbl-chart snapshot: missing <spec.yaml> argument\n");
      console.error(usageText());
      return 1;
    }

    // Read the pre-built live bundle from disk relative to this module.
    const liveBundlePath = fileURLToPath(new URL("../embed/live.js", import.meta.url));
    let liveBundleJs: string;
    try {
      liveBundleJs = await readFile(liveBundlePath, "utf8");
    } catch (err) {
      console.error(
        `tbl-chart snapshot: cannot read live bundle at ${liveBundlePath}.\n` +
          `Run \`npm run build\` first.\n` +
          `(${(err as Error).message})`,
      );
      return 1;
    }

    const result = await runSnapshot(specPath, {
      baselinePath: values.baseline,
      update: values.update ?? false,
      liveBundleJs,
      css: CHART_CSS,
    });
    if (result.exitCode === 0) {
      console.log(result.message);
    } else {
      console.error(result.message);
    }
    return result.exitCode;
  }

  console.error(`tbl-chart: unknown command '${cmd}'\n`);
  console.error(usageText());
  return 1;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

// Only run when invoked directly (not when imported by tests or other modules).
// `import.meta.url` is the realpath of this module (Node resolves symlinks for ESM), but
// `process.argv[1]` is the path as launched — which is the `node_modules/.bin/tbl-chart`
// SYMLINK under a normal install. Resolve argv[1] through realpath before comparing, or the
// CLI silently no-ops (exit 0, no output) when run via its bin symlink. realpathSync can throw
// if argv[1] is odd, so guard it.
function isMainEntry(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  const here = fileURLToPath(import.meta.url);
  if (argv1 === here) return true;
  try {
    return realpathSync(argv1) === here;
  } catch {
    return false;
  }
}
const isMain = isMainEntry();

if (isMain) {
  main(process.argv).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(`tbl-chart: unexpected error: ${(err as Error).message}`);
      process.exit(1);
    },
  );
}
