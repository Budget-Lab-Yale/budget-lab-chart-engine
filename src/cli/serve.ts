/**
 * tbl-chart serve — local review gallery.
 *
 * Exported functions are testable: createServer / createRequestHandler / findCharts
 * accept injected liveBundleJs + css and do NOT call process.exit.
 *
 * main() wires them to real disk I/O.
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { validateChart } from "../spec/validate";
import { loadData } from "../data/load";
import { buildStandaloneHtml } from "../embed/bundle-standalone";
import type { ChartSpec } from "../spec/types";

// ---------------------------------------------------------------------------
// findCharts
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);

/**
 * Recursively find every `chart.yaml` under `dir`, skipping `node_modules`,
 * `dist`, and `.git`. Returns absolute paths.
 */
export function findCharts(dir: string): string[] {
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
      } else if (entry.isFile() && entry.name === "chart.yaml") {
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

/** Read a chart.yaml and pull out the title for the index. Returns null on failure. (The
 *  figure-number eyebrow is no longer a spec field — it's supplied at embed time.) */
function readChartMeta(absPath: string): { title: string } | null {
  try {
    const text = fs.readFileSync(absPath, "utf8");
    const spec = parseYaml(text) as Record<string, unknown>;
    if (typeof spec !== "object" || spec === null) return null;
    const title = typeof spec["title"] === "string" ? spec["title"] : null;
    if (!title) return null;
    return { title };
  } catch {
    return null;
  }
}

function buildIndexPage(charts: string[], rootDir: string): string {
  const items =
    charts.length === 0
      ? `<p class="no-charts">No <code>chart.yaml</code> files found under <code>${escapeHtml(rootDir)}</code>.</p>`
      : charts
          .map((abs) => {
            const rel = path.relative(rootDir, abs).replace(/\\/g, "/");
            const meta = readChartMeta(abs);
            const displayTitle = meta?.title ?? rel;
            const href = `/chart/${encodeURIComponent(rel).replace(/%2F/g, "/")}`;
            return [
              `<li class="chart-item">`,
              `<a class="chart-link" href="${escapeHtml(href)}">${escapeHtml(displayTitle)}</a>`,
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
  <p>Serving from <code>${escapeHtml(rootDir)}</code> &mdash; ${charts.length} chart${charts.length === 1 ? "" : "s"} found</p>
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
      const charts = findCharts(rootDir);
      const html = buildIndexPage(charts, rootDir);
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

    // Load data (baseDir = chart file's directory)
    const baseDir = path.dirname(absPath);
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
