// Pure HTML builder: assembles a self-contained standalone HTML file from a
// pre-built browser bundle, CSS, and chart spec + data. No esbuild dependency
// at runtime — the caller passes the already-bundled JS as a string.
import type { ChartSpec } from "../spec/types";
import type { TidyRow } from "../data/index";

export interface StandaloneInput {
  spec: ChartSpec;
  rows: TidyRow[];
  /** The pre-built browser IIFE bundle (dist/embed/live.js contents). */
  liveBundleJs: string;
  css: string;
  /** Optional page title; falls back to spec.title. */
  title?: string;
  /** Eyebrow / figure number (e.g. "Figure 1"), supplied by the article context. When set, it
   *  is baked into the page and shown by default; the embed can suppress it at view time with
   *  `?eyebrow=off` in the URL. Omitted → the chart renders with no eyebrow. */
  eyebrow?: string;
}

/**
 * Guard against `</script>` injection in JSON embedded in a <script> tag.
 * Replace `<` with its HTML entity throughout the serialized JSON.
 * (A full serialization-safe approach; sufficient for our use case.)
 */
function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * Build a complete self-contained HTML document string.
 *
 * The document:
 * - Loads Figtree from Google Fonts.
 * - Inlines the CHART_CSS.
 * - Inlines the browser IIFE bundle (which exports BudgetLabChart.mountChart).
 * - Calls mountChart with the serialized spec and rows.
 */
export function buildStandaloneHtml(input: StandaloneInput): string {
  const { spec, rows, liveBundleJs, css, title, eyebrow } = input;
  const pageTitle = title ?? spec.title ?? "Chart";

  const specJson = safeJsonForScript(spec);
  const rowsJson = safeJsonForScript(rows);

  // Eyebrow: bake the value, but let the embedder hide it at view time via `?eyebrow=off`
  // (also 0/false/none/hide). Emitted only when a value is present, so the bootstrap stays
  // minimal for charts with no figure number.
  const eyebrowMount =
    eyebrow != null && eyebrow !== ""
      ? `\n  eyebrow: /[?&]eyebrow=(off|0|false|none|hide)\\b/i.test(location.search) ? undefined : ${safeJsonForScript(eyebrow)},`
      : "";

  // Neutralize any literal `</script` inside the bundle so it can't close the inline
  // <script> tag. The bundle is trusted, self-generated esbuild output (no source literal
  // contains `</script` today), but a future vendored dep could — this is a cheap guard
  // with no runtime effect: in valid JS, `</script` only ever occurs inside a string or
  // regex literal, where `<\/script` is equivalent.
  const safeBundle = liveBundleJs.replace(/<\/script/gi, "<\\/script");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtmlAttr(pageTitle)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
${css}
</style>
</head>
<body>
<div id="chart" style="max-width:760px;margin:32px auto;padding:0 16px"></div>
<script>
${safeBundle}
</script>
<script>
BudgetLabChart.mountChart(document.getElementById("chart"), {
  spec: ${specJson},
  rows: ${rowsJson},${eyebrowMount}
});
</script>
</body>
</html>`;
}

/** Escape a value for safe use in an HTML attribute (title). */
function escapeHtmlAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}
