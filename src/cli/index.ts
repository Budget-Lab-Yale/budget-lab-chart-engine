// tbl-chart CLI entry point.
// Exported functions (runValidate, runRender, runSnapshot) are unit-testable — they accept
// injected bundle/css and return {exitCode, message} rather than side-effecting.
// main() wires them to real disk I/O and process.exit.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { dirname, basename, extname, resolve, join } from "node:path";
import { parseArgs } from "node:util";
import type * as http from "node:http";
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
import { timelineWarnings, timelineExportChartWidth } from "../engine/marks/timeline";
import { treemapWarnings, treemapExportChartWidth } from "../engine/marks/treemap";
import { loneBoundWarnings } from "../engine/figure";

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
    "  serve    [dir] [--port <n>] [--host <addr>]",
    "                                   local review gallery (default 127.0.0.1:5173; pass",
    "                                   --host 0.0.0.0 to let other machines reach it)",
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

  // Non-fatal: a timeline can publish, but these make it hard to read or overflow in the PNG.
  // Checked at the SAME width the export actually draws at (Ruling 17) — a right-hand legend
  // narrows that below INNER_W, and validate must not silently check the wider, unwarranted width.
  const warnings =
    typedSpec.chartType === "timeline"
      ? timelineWarnings(typedSpec, rows, timelineExportChartWidth(typedSpec, rows))
      : typedSpec.chartType === "treemap"
        // Includes the data warnings (>30 tiles, zero-value rows; negatives are validation errors),
        // at the width the export draws the treemap at.
        ? treemapWarnings(typedSpec, rows, treemapExportChartWidth(typedSpec, rows))
        // A lone yAxisPolicy min above, or max below, every value in a pane's data. A statement
        // about the data, not the drawing.
        : loneBoundWarnings(typedSpec, rows);
  return {
    exitCode: 0,
    message: [
      `OK: ${absSpecPath} (${rows.length} rows, ${seriesSet.size} series)`,
      ...warnings.map((w) => `${absSpecPath}: warning: ${w}`),
    ].join("\n"),
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

  const diffOutPath = snapshotDiffPath(baselinePath);
  const cmp = await comparePng(pngBuffer, baselineBuffer, { diffOutPath });

  if (cmp.match) {
    return { exitCode: 0, message: `Snapshot OK` };
  }

  return {
    exitCode: 1,
    message: cmp.diffWritten
      ? `Snapshot DIFFERS: ${cmp.diffPixels} px (wrote ${diffOutPath})`
      : `Snapshot DIFFERS: image size differs from the baseline (no diff image written)`,
  };
}

/** Where `snapshot` writes its diff image: `x.png` → `x.diff.png`, and any other path gets
 *  `.diff.png` appended. Never the baseline itself: a bare `.png` replace left a suffix-less
 *  `--baseline` path unchanged, and the first failing compare overwrote the baseline with the diff. */
export function snapshotDiffPath(baselinePath: string): string {
  return /\.png$/i.test(baselinePath)
    ? baselinePath.replace(/\.png$/i, ".diff.png")
    : `${baselinePath}.diff.png`;
}

// ---------------------------------------------------------------------------
// serve: arguments and bind address
// ---------------------------------------------------------------------------

/** Loopback only. The served pages embed the full data rows of every spec under the root,
 *  unpublished figures included, so reaching them from another machine is an explicit opt-in
 *  (`--host`), never the default. */
export const DEFAULT_SERVE_HOST = "127.0.0.1";

export interface ServeArgs {
  rootDir: string;
  port: number;
  host: string;
}

/** Parse the arguments after `serve`. Returns `{ error }` for a bad port. */
export function parseServeArgs(args: string[]): ServeArgs | { error: string } {
  const { positionals, values } = parseArgs({
    args,
    options: {
      port: { type: "string" },
      host: { type: "string" },
    },
    allowPositionals: true,
  });
  const port = values.port !== undefined ? parseInt(values.port, 10) : 5173;
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    return { error: `tbl-chart serve: invalid port ${JSON.stringify(values.port)}` };
  }
  return { rootDir: resolve(positionals[0] ?? process.cwd()), port, host: values.host ?? DEFAULT_SERVE_HOST };
}

/** `http://<address>:<port>`, with an IPv6 address in brackets. */
export function serveUrl(address: string, port: number): string {
  return `http://${address.includes(":") ? `[${address}]` : address}:${port}`;
}

/** Listen on `host:port`; resolve to the URL of the address actually bound, reject on a listen
 *  error (EADDRINUSE, an unknown host). */
export function listenServe(server: http.Server, port: number, host: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const addr = server.address();
      resolvePromise(
        addr && typeof addr === "object" ? serveUrl(addr.address, addr.port) : serveUrl(host, port),
      );
    });
  });
}

export type ServeStart =
  | { exitCode: 0; message: string; server: http.Server; url: string }
  | { exitCode: 1; message: string };

/** `tbl-chart serve` after argument parsing and the bundle read: build the server and listen on
 *  `args.host` (127.0.0.1 unless `--host` was given). Returns the line to print; the caller keeps
 *  the process alive, and a test closes `server`. */
export async function startServe(args: ServeArgs, liveBundleJs: string): Promise<ServeStart> {
  const { rootDir, port, host } = args;
  const specs = findSpecs(rootDir);
  const server = createServer({ rootDir, liveBundleJs, css: CHART_CSS });

  let url: string;
  try {
    url = await listenServe(server, port, host);
  } catch (err) {
    return {
      exitCode: 1,
      message:
        (err as NodeJS.ErrnoException).code === "EADDRINUSE"
          ? `tbl-chart serve: port ${port} is already in use.\nTry a different port with --port <n>.`
          : `tbl-chart serve: server error: ${(err as Error).message}`,
    };
  }
  server.on("error", (err) => console.error(`tbl-chart serve: server error: ${err.message}`));
  return {
    exitCode: 0,
    message: `Serving ${specs.length} spec${specs.length === 1 ? "" : "s"} from ${rootDir} at ${url}`,
    server,
    url,
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
    const parsed = parseServeArgs(argv.slice(3));
    if ("error" in parsed) {
      console.error(parsed.error);
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

    const started = await startServe(parsed, liveBundleJs);
    if (started.exitCode !== 0) {
      console.error(started.message);
      return started.exitCode;
    }
    console.log(started.message);

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
