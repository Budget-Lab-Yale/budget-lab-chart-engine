// tbl-chart CLI entry point.
// Exported functions (runValidate, runRender, runSnapshot) are unit-testable — they accept
// injected bundle/css and return {exitCode, message} rather than side-effecting.
// main() wires them to real disk I/O and process.exit.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, basename, extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import { validateSpec, validateChartData, validateChart } from "../spec/validate";
import { loadData } from "../data/load";
import { buildStandaloneHtml } from "../embed/bundle-standalone";
import { CHART_CSS } from "../embed/styles";
import { createServer, findCharts } from "./serve";
import { renderChartPng } from "../snapshot/render-png";
import { comparePng } from "../snapshot/compare";
import type { ChartSpec } from "../spec/types";
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
    "  render   <spec.yaml> [-o <out.html>]  render to a self-contained HTML file",
    "  serve    [dir] [--port <n>]      local review gallery (default port 5173)",
    "  snapshot <spec.yaml> [--baseline <path>] [--update]",
    "                                   compare or update a PNG baseline snapshot",
    "",
    "Options:",
    "  -h, --help   show this help",
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

  const seriesSet = new Set<string>();
  for (const row of rows) {
    const key = typedSpec.series_field ?? "series";
    seriesSet.add(row[key] ?? "");
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
  /** Pre-built browser IIFE bundle contents. Injected so tests can pass a stub. */
  liveBundleJs: string;
  /** CSS string. Injected so tests can pass a stub. */
  css: string;
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
  });

  // Determine output path.
  const specBase = basename(absSpecPath, extname(absSpecPath));
  const outPath = opts.outPath
    ? resolve(opts.outPath)
    : resolve(process.cwd(), `${specBase}.html`);

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
  const html = buildStandaloneHtml({
    spec: typedSpec,
    rows,
    liveBundleJs: opts.liveBundleJs,
    css: opts.css,
  });

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
      },
      allowPositionals: true,
    });
    const specPath = positionals[0];
    if (!specPath) {
      console.error("tbl-chart render: missing <spec.yaml> argument\n");
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
        `tbl-chart render: cannot read live bundle at ${liveBundlePath}.\n` +
          `Run \`npm run build\` first.\n` +
          `(${(err as Error).message})`,
      );
      return 1;
    }

    const result = await runRender(specPath, {
      outPath: values.output,
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

    const charts = findCharts(rootDir);
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
          `Serving ${charts.length} chart${charts.length === 1 ? "" : "s"} from ${rootDir} at http://localhost:${port}`,
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
// import.meta.url is file:///…/dist/cli/index.js when executed as the binary;
// process.argv[1] resolves to the same path (after normalization).
const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main(process.argv).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(`tbl-chart: unexpected error: ${(err as Error).message}`);
      process.exit(1);
    },
  );
}
