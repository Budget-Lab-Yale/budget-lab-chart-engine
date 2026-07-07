/**
 * tbl-chart serve — local review gallery.
 *
 * Exported functions are testable: createServer / createRequestHandler / findSpecs
 * accept injected liveBundleJs + css and do NOT call process.exit.
 *
 * main() wires them to real disk I/O.
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { validateChart } from "../spec/validate";
import { validateTableSpec, validateTableData } from "../spec/table-validate";
import { loadData } from "../data/load";
import { buildStandaloneHtml } from "../embed/bundle-standalone";
import { isTableSpec } from "./table-detect";
import type { ChartSpec } from "../spec/types";
import type { TableSpec } from "../spec/table-types";

// ---------------------------------------------------------------------------
// findSpecs
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);
const SPEC_FILENAMES = new Set(["chart.yaml", "table.yaml"]);

/**
 * Recursively find every `chart.yaml` and `table.yaml` under `dir`, skipping
 * `node_modules`, `dist`, and `.git`. Returns absolute paths.
 */
export function findSpecs(dir: string): string[] {
  const results: string[] = [];

  function walk(current: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          walk(path.join(current, entry.name));
        }
      } else if (entry.isFile() && SPEC_FILENAMES.has(entry.name)) {
        results.push(path.join(current, entry.name));
      }
    }
  }

  walk(dir);
  return results;
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/** Read a chart.yaml or table.yaml and pull out the title + kind for the index. Returns null
 *  on failure. (The figure-number eyebrow is no longer a spec field — it's supplied at embed
 *  time.) */
function readSpecMeta(absPath: string): { title: string; kind: "chart" | "table" } | null {
  try {
    const text = fs.readFileSync(absPath, "utf8");
    const spec = parseYaml(text) as Record<string, unknown>;
    if (typeof spec !== "object" || spec === null) return null;
    const title = typeof spec["title"] === "string" ? spec["title"] : null;
    if (!title) return null;
    return { title, kind: isTableSpec(spec) ? "table" : "chart" };
  } catch {
    return null;
  }
}

function buildIndexPage(specs: string[], rootDir: string): string {
  const items =
    specs.length === 0
      ? `<p class="no-charts">No <code>chart.yaml</code> or <code>table.yaml</code> files found under <code>${escapeHtml(rootDir)}</code>.</p>`
      : specs
          .map((abs) => {
            const rel = path.relative(rootDir, abs).replace(/\\/g, "/");
            const meta = readSpecMeta(abs);
            const displayTitle = meta?.title ?? rel;
            const kindTag = meta?.kind === "table" ? `<span class="chart-kind">table</span>` : "";
            const href = `/chart/${encodeURIComponent(rel).replace(/%2F/g, "/")}`;
            return [
              `<li class="chart-item">`,
              `<a class="chart-link" href="${escapeHtml(href)}">${escapeHtml(displayTitle)}</a>${kindTag}`,
              `<span class="chart-path">${escapeHtml(rel)}</span>`,
              `</li>`,
            ]
              .filter(Boolean)
              .join("\n      ");
          })
          .join("\n    ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>tbl-chart gallery</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: 'Figtree', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif;
  font-size: 15px;
  line-height: 1.5;
  color: #1a1a2e;
  background: #f8f9fa;
}
.header {
  background: #1a1a2e;
  color: #fff;
  padding: 20px 32px;
}
.header h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.01em;
}
.header p {
  margin: 4px 0 0;
  font-size: 13px;
  opacity: 0.7;
}
.main {
  max-width: 860px;
  margin: 32px auto;
  padding: 0 24px;
}
.chart-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.chart-item {
  border: 1px solid #e2e5ea;
  border-radius: 8px;
  background: #fff;
  margin-bottom: 12px;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  transition: box-shadow 0.12s;
}
.chart-item:hover {
  box-shadow: 0 2px 8px rgba(0,0,0,0.10);
}
.chart-link {
  font-size: 16px;
  font-weight: 700;
  color: #1a1a2e;
  text-decoration: none;
}
.chart-link:hover { text-decoration: underline; }
.chart-kind {
  margin-left: 8px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #555;
  background: #eef0f3;
  border-radius: 4px;
  padding: 2px 6px;
}
.chart-path {
  font-size: 12px;
  color: #888;
  font-family: 'Courier New', monospace;
}
.no-charts {
  color: #666;
  padding: 24px 0;
}
</style>
</head>
<body>
<div class="header">
  <h1>tbl-chart gallery</h1>
  <p>Serving from <code>${escapeHtml(rootDir)}</code> &mdash; ${specs.length} spec${specs.length === 1 ? "" : "s"} found</p>
</div>
<div class="main">
  <ul class="chart-list">
    ${items}
  </ul>
</div>
</body>
</html>`;
}

function buildErrorPage(title: string, errors: string[]): string {
  const items = errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("\n    ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Validation error</title>
<style>
body { font-family: system-ui, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 24px; color: #1a1a2e; }
h1 { font-size: 20px; color: #b91c1c; }
ul { margin-top: 16px; padding-left: 20px; line-height: 1.8; }
code { background: #f3f4f6; padding: 1px 4px; border-radius: 3px; font-size: 0.9em; }
</style>
</head>
<body>
<h1>Validation error</h1>
<p><code>${escapeHtml(title)}</code></p>
<ul>
    ${items}
</ul>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Request handler factory
// ---------------------------------------------------------------------------

export interface ServeOptions {
  /** Absolute root directory containing chart.yaml files. */
  rootDir: string;
  /** Pre-built browser IIFE bundle. Injected so tests can pass a stub. */
  liveBundleJs: string;
  /** CSS string. Injected so tests can pass a stub. */
  css: string;
}

/**
 * Create a Node.js HTTP request handler for the gallery server.
 * Testable: accepts injected liveBundleJs + css; never calls process.exit.
 */
export function createRequestHandler(
  opts: ServeOptions,
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  const { rootDir, liveBundleJs, css } = opts;

  return function handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    const url = req.url ?? "/";

    // Strip query string.
    const pathname = url.split("?")[0] ?? "/";

    // GET / — index gallery
    if (pathname === "/" || pathname === "") {
      const specs = findSpecs(rootDir);
      const html = buildIndexPage(specs, rootDir);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    // GET /chart/<relpath>
    const CHART_PREFIX = "/chart/";
    if (pathname.startsWith(CHART_PREFIX)) {
      const rel = decodeURIComponent(pathname.slice(CHART_PREFIX.length));

      // Security: reject path traversal
      const abs = path.resolve(rootDir, rel);
      if (!abs.startsWith(rootDir + path.sep) && abs !== rootDir) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("404 Not Found");
        return;
      }

      serveChart(abs, rel, liveBundleJs, css, res);
      return;
    }

    // Unknown route
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      `<!doctype html><html><body><h1>404 Not Found</h1><p><code>${escapeHtml(pathname)}</code></p></body></html>`,
    );
  };
}

/** Async chart render — separated so handleRequest stays sync at the top level. */
function serveChart(
  absPath: string,
  displayRel: string,
  liveBundleJs: string,
  css: string,
  res: http.ServerResponse,
): void {
  (async () => {
    // Read + parse YAML
    let yamlText: string;
    try {
      yamlText = fs.readFileSync(absPath, "utf8");
    } catch {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><html><body><h1>404 Not Found</h1><p>No chart at <code>${escapeHtml(displayRel)}</code></p></body></html>`,
      );
      return;
    }

    let spec: unknown;
    try {
      spec = parseYaml(yamlText);
    } catch (err) {
      res.writeHead(422, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        buildErrorPage(displayRel, [`YAML parse error: ${(err as Error).message}`]),
      );
      return;
    }

    const baseDir = path.dirname(absPath);

    // --- Table path: mirrors runRender's table branch in src/cli/index.ts. ---
    if (isTableSpec(spec)) {
      const structural = validateTableSpec(spec);
      if (!structural.valid) {
        res.writeHead(422, { "Content-Type": "text/html; charset=utf-8" });
        res.end(buildErrorPage(displayRel, structural.errors));
        return;
      }

      let tableRows;
      try {
        tableRows = await loadData((spec as TableSpec).data, { baseDir });
      } catch (err) {
        res.writeHead(422, { "Content-Type": "text/html; charset=utf-8" });
        res.end(buildErrorPage(displayRel, [`data load failed: ${(err as Error).message}`]));
        return;
      }

      const dataResult = validateTableData(spec, tableRows);
      if (!dataResult.valid) {
        res.writeHead(422, { "Content-Type": "text/html; charset=utf-8" });
        res.end(buildErrorPage(displayRel, dataResult.errors));
        return;
      }

      const tableHtml = buildStandaloneHtml({
        spec: spec as unknown as ChartSpec,
        rows: tableRows,
        liveBundleJs,
        css,
        mountFn: "mountTable",
      });

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(tableHtml);
      return;
    }

    // --- Chart path (unchanged) ---
    let rows;
    try {
      rows = await loadData((spec as ChartSpec).data, { baseDir });
    } catch (err) {
      res.writeHead(422, { "Content-Type": "text/html; charset=utf-8" });
      res.end(buildErrorPage(displayRel, [`data load failed: ${(err as Error).message}`]));
      return;
    }

    // Validate
    const result = validateChart(spec, rows);
    if (!result.valid) {
      res.writeHead(422, { "Content-Type": "text/html; charset=utf-8" });
      res.end(buildErrorPage(displayRel, result.errors));
      return;
    }

    // Render
    const html = buildStandaloneHtml({
      spec: spec as ChartSpec,
      rows,
      liveBundleJs,
      css,
    });

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  })().catch((err: unknown) => {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain" });
    }
    res.end(`Internal server error: ${(err as Error).message}`);
  });
}

// ---------------------------------------------------------------------------
// createServer
// ---------------------------------------------------------------------------

/**
 * Create and return an http.Server bound to the given options.
 * Does NOT call listen or process.exit — caller is responsible.
 */
export function createServer(opts: ServeOptions): http.Server {
  const handler = createRequestHandler(opts);
  return http.createServer(handler);
}
