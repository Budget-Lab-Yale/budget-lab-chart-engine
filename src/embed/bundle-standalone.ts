// Pure HTML builder: assembles a standalone HTML file from a pre-built browser bundle, CSS, and
// chart spec + data. No esbuild dependency at runtime — the caller passes the already-bundled JS
// as a string. Pass `assets` instead to link one shared copy of the runtime/CSS/font rather than
// inlining ~1.65 MB of identical bytes into every page (see shared-assets.ts).
import type { ChartSpec, TitleSelector } from "../spec/types";
import type { TidyRow } from "../data/index";
import { resolveTitleText } from "../spec/title.js";
import { FIGTREE_FONT_FACE } from "./assets.js";
import { sharedAssetRefs } from "./shared-assets.js";

/** Where a page's runtime, CSS, and font come from when they are not inlined. */
export interface SharedAssetsInput {
  /** Relative URL prefix the assets are published under, e.g. "../../embed/v1". */
  base: string;
  /** Engine version; the asset filenames carry it. */
  version: string;
}

export interface StandaloneInput {
  spec: ChartSpec | Record<string, unknown>;
  rows: TidyRow[];
  /** The pre-built browser IIFE bundle (dist/embed/live.js contents). Required unless `assets`
   *  is set, which links the shared runtime instead of inlining it. */
  liveBundleJs?: string;
  /** Chart CSS. Inlined unless `assets` is set, in which case the shared stylesheet carries it. */
  css: string;
  /** Link shared versioned assets instead of inlining the runtime, CSS, and font. */
  assets?: SharedAssetsInput;
  /** Optional page title; falls back to spec.title. */
  title?: string;
  /** Eyebrow / figure number (e.g. "Figure 1"), supplied by the article context. When set, it
   *  is baked into the page and shown by default; the embed can suppress it at view time with
   *  `?eyebrow=off` in the URL. Omitted → the chart renders with no eyebrow. */
  eyebrow?: string;
  /** Which BudgetLabChart method to call on mount. Defaults to "mountChart". */
  mountFn?: "mountChart" | "mountTable";
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
 * Build a complete HTML document string.
 *
 * Self-contained by default: inlines the base64 font, the CHART_CSS, and the browser IIFE bundle
 * (which exports BudgetLabChart.mountChart), then calls mountChart with the serialized spec and
 * rows. With `assets` set, the font/CSS/runtime become links to shared versioned files and only
 * the spec + data stay inline.
 */
export function buildStandaloneHtml(input: StandaloneInput): string {
  const { spec, rows, liveBundleJs, css, assets, title, eyebrow, mountFn = "mountChart" } = input;

  if (!assets && liveBundleJs == null) {
    throw new Error("buildStandaloneHtml: liveBundleJs is required unless `assets` is set");
  }
  // Page <title>: resolve any title-selector `{token}`s with the spec defaults so the browser
  // tab shows real text (e.g. "GDP by Sector"), never a raw braced token. Specs without
  // title_selectors pass through resolveTitleText untouched (tables never have them).
  const rawTitle = title ?? (spec as { title?: string }).title;
  const pageTitle = rawTitle
    ? resolveTitleText({
        title: rawTitle,
        title_selectors: (spec as { title_selectors?: Record<string, TitleSelector> }).title_selectors,
      })
    : "Chart";

  const specJson = safeJsonForScript(spec);
  const rowsJson = safeJsonForScript(rows);

  // Eyebrow: bake the value, but let the embedder hide it at view time via `?eyebrow=off`
  // (also 0/false/none/hide). Emitted only when a value is present, so the bootstrap stays
  // minimal for charts with no figure number.
  const eyebrowMount =
    eyebrow != null && eyebrow !== ""
      ? `\n  eyebrow: /[?&]eyebrow=(off|0|false|none|hide)\\b/i.test(location.search) ? undefined : ${safeJsonForScript(eyebrow)},`
      : "";

  const refs = assets ? sharedAssetRefs(assets.base, assets.version) : null;

  // Either one shared stylesheet (which carries the base64 @font-face itself) or everything inline.
  // Neither form makes a separate font request: Figtree is never loaded from a CDN, so a corporate
  // firewall blocking font hosts cannot drop the chart to a system fallback.
  const headAssets = refs
    ? `<link rel="stylesheet" href="${escapeHtmlAttr(refs.styles)}">`
    : `<style>\n${FIGTREE_FONT_FACE}\n${css}\n</style>`;

  // Neutralize any literal `</script` inside the bundle so it can't close the inline
  // <script> tag. The bundle is trusted, self-generated esbuild output (no source literal
  // contains `</script` today), but a future vendored dep could — this is a cheap guard
  // with no runtime effect: in valid JS, `</script` only ever occurs inside a string or
  // regex literal, where `<\/script` is equivalent.
  // A classic <script src> blocks until it executes, so the bootstrap below still sees
  // BudgetLabChart either way; no defer/async, no load handler needed.
  const runtimeTag = refs
    ? `<script src="${escapeHtmlAttr(refs.runtime)}"></script>`
    : `<script>\n${(liveBundleJs as string).replace(/<\/script/gi, "<\\/script")}\n</script>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtmlAttr(pageTitle)}</title>
${headAssets}
</head>
<body>
<div id="chart" style="max-width:760px;margin:32px auto;padding:0 16px"></div>
${runtimeTag}
<script>
${mountScript({ mountFn, specJson, rowsJson, eyebrowMount, shared: Boolean(refs), pageTitle, eyebrow })}
</script>
</body>
</html>`;
}

/**
 * The bootstrap that mounts the chart.
 *
 * In shared-asset mode the runtime is a separate request, so it can fail where an inlined bundle
 * could not — a stale proxy cache, a half-published deploy. Rather than leave a blank rectangle in
 * the middle of an article, name the figure that should be there and offer a way to retry. The
 * fallback is built with DOM calls and inline styles on purpose: the stylesheet is a separate
 * request too, so it may be just as absent, and nothing here may depend on it.
 */
function mountScript(input: {
  mountFn: string;
  specJson: string;
  rowsJson: string;
  eyebrowMount: string;
  shared: boolean;
  pageTitle: string;
  eyebrow?: string;
}): string {
  const { mountFn, specJson, rowsJson, eyebrowMount, shared, pageTitle, eyebrow } = input;

  const mountCall = `BudgetLabChart.${mountFn}(el, {
  spec: ${specJson},
  rows: ${rowsJson},${eyebrowMount}
});`;

  if (!shared) return `var el = document.getElementById("chart");\n${mountCall}`;

  return `var el = document.getElementById("chart");
if (typeof BudgetLabChart === "undefined") {
  renderUnavailable(el, ${safeJsonForScript(pageTitle)}, ${safeJsonForScript(eyebrow ?? "")});
} else {
${mountCall}
}
function renderUnavailable(el, title, eyebrow) {
  var box = document.createElement("div");
  box.setAttribute("role", "note");
  box.style.cssText = "font:16px/1.5 system-ui,-apple-system,'Segoe UI',Arial,sans-serif;color:#1c1c1c;border:1px solid #d9dce3;border-radius:4px;padding:20px";
  if (eyebrow) {
    var e = document.createElement("p");
    e.textContent = eyebrow;
    e.style.cssText = "margin:0 0 4px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#5a5f6b";
    box.appendChild(e);
  }
  var h = document.createElement("p");
  h.textContent = title;
  h.style.cssText = "margin:0 0 12px;font-weight:600";
  box.appendChild(h);
  var p = document.createElement("p");
  p.style.cssText = "margin:0;color:#5a5f6b";
  p.appendChild(document.createTextNode("This figure could not load. "));
  var a = document.createElement("a");
  a.href = location.href;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = "Open it in a new tab";
  a.style.color = "inherit";
  p.appendChild(a);
  p.appendChild(document.createTextNode("."));
  box.appendChild(p);
  el.appendChild(box);
}`;
}

/** Escape a value for safe use in an HTML attribute (title). */
function escapeHtmlAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}
