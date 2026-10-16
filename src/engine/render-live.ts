// Live-render layer: mounts a fully interactive chart card into a container element and
// wires the pure engine (renderChart) to the DOM-only live primitives (legend, crosshair,
// source line). Scaling is copied from the tracker's createChartController: the chart is
// RE-RENDERED at the container's width (the x-axis compresses; height stays fixed) down to a
// minimum width, below which a horizontal scroll wrapper takes over and a sticky y-axis
// overlay keeps the value labels pinned at the left. No viewBox/CSS scaling.
import type { ChartSpec, TitleSelector } from "../spec/types.js";
import type { RenderHooks } from "../spec/hooks.js";
import { resolveColumns } from "../spec/columns.js";
import { rowsInSectionOrder } from "../spec/section-key.js";
import { ownValue } from "../spec/own-key.js";
import {
  LEGEND_COLUMN_WIDTH,
  LEGEND_GAP,
  LEGEND_RIGHT_MIN_CARD_WIDTH,
  MIN_CHART_WIDTH,
  legendInRightColumn,
  orderForRightLegend,
  resolveLegendPosition,
} from "./legend-layout.js";
import {
  parseTitleTokens,
  resolveActiveOptionColor,
  resolveSelections,
  resolveTitleText,
} from "../spec/title.js";
import type { TidyRow } from "../data/index.js";
import type { FigureRenderResult } from "./figure.js";
import { renderChart } from "./index.js";
import { resolveTimelineOrientation, timelineHeight, timelineLegendRowCount } from "./marks/timeline.js";
import { TL_GEOM } from "./timeline-layout.js";
import { treemapHeight } from "./marks/treemap.js";
import { TM_GEOM } from "./treemap-layout.js";
import { normalizeSpec } from "./util.js";
import { renderFigure, horizontalBarChartHeight, figurePaneHeight, growsWithRows } from "./figure.js";
import { renderLegend } from "./legend.js";
import type { LegendHandle } from "./legend.js";
import { RUG_CLASS } from "./rug.js";
import { CROSSHAIR_HIT_SELECTOR } from "./hover-classes.js";
import { resolveColor } from "./palette.js";
import { resolveTooltipIcons } from "./icon.js";
import type { HighlightPillsHandle, BandHoverCtx, HoverDetach } from "./crosshair.js";
import { renderSourceLine } from "./source-line.js";
import { rowsToCsv } from "../data/csv-browser.js";
import { LOGO_SVG } from "../embed/assets.js";
import { exportChartPng } from "../embed/export-png.js";
import { LiveLifecycle, attachCause, notify } from "./live/lifecycle.js";
import {
  attachPlanPills,
  attachPrimaryHover,
  attachSecondaryHover,
  buildHoverPlan,
  type CursorDriver,
  type HoverInputs,
} from "./live/hover-options.js";

// Moved to live/hover-options.ts with the rest of the hover option building; re-exported so
// existing importers keep working.
export { formatValue } from "./live/hover-options.js";

export interface MountOptions {
  spec: ChartSpec;
  rows: TidyRow[];
  /** Initial render width (used before the container is measured). */
  width?: number;
  height?: number;
  /** Eyebrow line above the title (e.g. "Figure 1"). A property of the article/embed context,
   *  not the chart itself — supplied at mount time. Passing a value shows it; omitting hides it. */
  eyebrow?: string;
  /** Override the Data/Image download filename slug. Normally derived from the URL (the chart's
   *  folder); pass this when several charts share one page (e.g. a gallery) so each still gets its
   *  own name instead of all resolving to the shared page's slug. */
  downloadName?: string;
  /** Fires when the user changes an inline title selector (see spec.title_selectors), with the
   *  selector key and the newly-active option id. A bubbling `tbl-title-select` CustomEvent
   *  (same detail shape) also dispatches from the card root, for standalone bundles with no
   *  host callback wired up. No-op when the spec has no title_selectors. */
  onSelect?: (change: { id: string; value: string }) => void;
  /** Initial active option id per title-selector key (host re-mount state restore). Precedence:
   *  `selections[key]` > `title_selectors[key].default` > that selector's first option. */
  selections?: Record<string, string>;
  /** Programmatic render hooks (see spec/hooks.ts). Passed to every renderChart/renderFigure call
   *  in the mount + resize paths, and to the Image download's export — so a static hook's output
   *  cannot diverge between the screen and the downloaded PNG. */
  hooks?: RenderHooks;
  /** Fires with the hovered category and its per-series values whenever a categorical bar/stacked
   *  crosshair (standalone or a small-multiples pane) resolves one, and with `null` when the hover
   *  ends — on pointer-leave, and when a redraw or teardown ends the hovered chart's wiring under a
   *  still pointer — so a consumer drawing its own hover card knows when to clear it. Values come
   *  straight from the crosshair's own resolver (`resolveCategorySeriesValues` in crosshair.ts) —
   *  never re-derived here — and fire even when `chrome.tooltip: false` suppresses the engine's
   *  own card, or the pane is a coordinated small-multiples pane with no card of its own: the
   *  engine still hit-tests and this reports what it resolved either way. A bubbling `tbl-hover`
   *  CustomEvent (same detail) also dispatches from the card root. Not yet wired for other chart
   *  types (line, scatter, histogram, dotplot, dumbbell, categorical-line) — see crosshair.ts's
   *  `attachBandCrosshair`, the only attach function this reaches. */
  onHover?: (ctx: BandHoverCtx | null) => void;
  /** Fires after every (re-)render of the chart body: once at mount, once after each width-driven
   *  resize redraw, once after a title-selector change forces a redraw (for its color accent),
   *  and once after an area chart's legend-driven click-to-restack forces its own redraw
   *  (`phase: "restack"` — pinning/unpinning a series moves it to the bottom of the stack and
   *  re-renders; guarded by `suppressRestack` so the focus hand-back inside that redraw does not
   *  re-enter this branch and double-fire; a reselect that drops a pinned series restacks too, so
   *  it fires "reselect" then "restack"). A small-multiples figure fires once PER PANE (each
   *  call's `svg` is that pane's own), rather than once for the figure — there is no single
   *  wrapping SVG to report; small multiples has no restack feature, so `"restack"` never reaches
   *  that path. A bubbling `tbl-render` CustomEvent (same detail) also dispatches from the card
   *  root. */
  onRender?: (ctx: { svg: SVGSVGElement; phase: "mount" | "resize" | "reselect" | "restack" }) => void;
  /** Fires whenever the legend's active highlight set changes — a pin (click), a hover, focus/
   *  blur, or the reset button — with the full active series set. A bubbling `tbl-legend-select`
   *  CustomEvent (same detail) also dispatches from the card root. Distinct from `onSelect`,
   *  which is the title-selector callback — this is the legend's own pin/dim gesture. No-op on a
   *  chart with no legend. Pins are carried across the mount's own redraws; a redraw whose legend
   *  no longer has a pinned row drops it and fires this once with what remains. */
  onLegendSelect?: (ctx: { active: string[] }) => void;
  /** Reparent the floating hover-tooltip card into this element instead of the default
   *  `container.ownerDocument.body`. Opt-in, not the default: the card is positioned
   *  `position: fixed` at the cursor's viewport coordinates, and a container with
   *  `overflow: hidden` or a CSS `transform` on it (or an ancestor) would clip it or throw off
   *  that positioning — `document.body` is the one place that never does either. Pass this only
   *  when the target element is known to have neither. Threaded down to every crosshair/hover
   *  attach call (see crosshair.ts's `getSharedTooltip`, keyed per-parent so two mounts with
   *  different containers never share one tooltip element). Must be a STABLE element across the
   *  mount's lifetime — a fresh element passed in on every re-render leaves the previous one's
   *  empty `.tbl-tooltip` div behind, since `getSharedTooltip` keys its cache by this reference. */
  tooltipContainer?: HTMLElement;
}

// MIN_CHART_WIDTH (legend-layout.ts): below it the chart stops shrinking and the scroll wrapper
// takes over. Height is held constant as the width changes.
const FIXED_CHART_HEIGHT = 400;

/** Compute the live-mount height for a chart. Horizontal bars scale with the number of category
 *  band slots (grouped → nSeries bars per category; stacked/single → one), plus the fixed section
 *  gaps and taller rows for wrapped labels — via the shared engine helper `horizontalBarChartHeight`,
 *  so the single-chart and faceted-figure heights agree. Vertical / non-bar charts return the
 *  fixed default; a horizontal chart with few rows is shorter than it. */
export function computeChartHeight(spec: ChartSpec, rows: TidyRow[]): number {
  spec = normalizeSpec(spec);
  // Timeline height is content-derived (label rows, or the stacked vertical column); renderChart
  // computes it again at the real width, so this is only the pre-draw estimate.
  if (spec.chartType === "timeline") return timelineHeight(spec, rows, 720);
  // Treemap: the same pre-draw estimate; its height follows its width (spec §6).
  if (spec.chartType === "treemap") return treemapHeight(720);
  // Horizontal bar/stacked AND horizontal dumbbell grow their height with the category-row count
  // (one row per category — dumbbell is never grouped, so horizontalBarChartHeight sizes it the
  // same as a single-series horizontal bar, section gaps included).
  if (!growsWithRows(spec)) {
    // Waterfall carries long (often rotated) step labels under the plot — give it more room.
    return spec.chartType === "waterfall" ? 460 : FIXED_CHART_HEIGHT;
  }
  return horizontalBarChartHeight(spec, rows);
}

// Fixed width of the right-side legend column. Chosen to fit typical series labels at 12px
// Figtree; the exact value is tunable in the visual pass. The chart area is computed as
// (outerContainerWidth − LEGEND_COLUMN_WIDTH − LEGEND_GAP) so the ResizeObserver observes
// the OUTER card (stable), not the canvas box (which would shrink as the legend takes space →
// feedback loop).

// When the card is too narrow to fit both the chart floor and the legend column, fall back to
// the top legend so the chart remains usable: LEGEND_RIGHT_MIN_CARD_WIDTH (legend-layout.ts, shared
// with a framed PNG export).


type OverlayEl = HTMLElement & { _ro?: ResizeObserver };

/**
 * Resolve the `data-series` of the chart mark under a click, hit-testing THROUGH the
 * transparent crosshair hit-overlay that sits on top of the bars/paths.
 *
 * The crosshair appends a full-SVG transparent rect with pointer-events:all, so the click
 * target is that overlay (no data-series). `elementsFromPoint` returns the element stack
 * top→bottom; we skip the overlay (and any other non-mark element) and return the first
 * element carrying a `data-series` attribute. Returns null if none is found.
 *
 * Guarded for jsdom: `elementsFromPoint` may be absent — feature-detect and no-op so SSR
 * and tests don't throw. (The toggle path itself is exercised directly in tests.)
 */
function resolveAttrAtPoint(
  svgEl: SVGSVGElement,
  evt: MouseEvent,
  attr: string,
  accept?: (el: Element) => boolean,
): string | null {
  const doc = svgEl.ownerDocument as Document & {
    elementsFromPoint?: (x: number, y: number) => Element[];
  };
  if (typeof doc.elementsFromPoint !== "function") return null;
  for (const el of doc.elementsFromPoint(evt.clientX, evt.clientY)) {
    const value = el.getAttribute?.(attr);
    if (value && (!accept || accept(el))) return value;
    if (el === svgEl) break; // don't search past the chart's own SVG
  }
  return null;
}

function resolveSeriesAtPoint(svgEl: SVGSVGElement, evt: MouseEvent): string | null {
  return resolveAttrAtPoint(svgEl, evt, "data-series");
}

/**
 * The annotation key of the RUG BLOCK under the cursor, or null. Hit-tests through the crosshair's
 * transparent overlay exactly like `resolveSeriesAtPoint`, then requires the hit to be inside the
 * rug strip.
 *
 * Deliberately scoped to the rug rather than to every `[data-annotation]` element. The in-frame
 * annotations — band rects and `shading` fills — are large regions sitting right where the reader
 * sweeps the crosshair to read values, so hovering them would dim the very line being read, on and
 * off, as the pointer crossed each region. The rug sits below the axis, its blocks are discrete, and
 * "what is this block?" is the question a reader actually has there — so it is the one place where
 * chart-to-legend hover helps rather than fights.
 */
function resolveRugAnnotationAtPoint(svgEl: SVGSVGElement, evt: MouseEvent): string | null {
  return resolveAttrAtPoint(svgEl, evt, "data-annotation", (el) => !!el.closest?.(`g.${RUG_CLASS}`));
}

/** The y of the rug strip's top edge, or null when this chart has no strip. */
function rugStripTop(svgEl: SVGSVGElement): number | null {
  const block = svgEl.querySelector(`g.${RUG_CLASS} rect`);
  if (!block) return null;
  const y = Number(block.getAttribute("y"));
  return Number.isFinite(y) ? y : null;
}

/**
 * Add transparent FAT "hit" paths for a LINE chart so clicking ON or NEAR a thin line
 * resolves that line's series. The visible lines are ~2px strokes that
 * `document.elementsFromPoint` almost never lands on; these clones are invisible but
 * carry a ~14px stroke with `pointer-events: stroke`, so the cursor is hit-tested
 * within ~7px of the line.
 *
 * Z-order: the crosshair appends its hover overlay LAST (pointer-events:all, topmost) so hover
 * works. We insert each hit-path BELOW that overlay (before the first `CROSSHAIR_HIT_SELECTOR`
 * match, so every family's overlay counts: a categorical-line pane's is `.tbl-catline-hit`, and a
 * list without it appended the hit-paths ABOVE it, where they took the pointer within ~7px of
 * every line and the overlay's pointerleave cleared the hover). The click handler resolves the series
 * via `elementsFromPoint` (the whole stack, not the event target), so it pierces the
 * transparent overlay and finds the fat hit-path's `data-series`. The hover (pointermove
 * on the overlay) is unaffected because the overlay stays on top.
 *
 * Each hit-path clones the visible path's `d` (geometry) and `data-series`. The clone is
 * inserted at the SVG root (just before the crosshair overlay), which is correct here
 * because this engine's Plot output bakes the margins into the path coordinates — the
 * `g[aria-label="line"]` group carries only a 0.5px crispness transform, so a root-level
 * clone lands within ~0.5px of the visible line (well inside the 14px hit stroke). No
 * in-function idempotency guard is needed: `draw()` rebuilds the SVG before each call, so
 * the hit-paths are always fresh.
 */
function addLineHitPaths(svgEl: SVGSVGElement): void {
  const NS = "http://www.w3.org/2000/svg";
  const overlay = svgEl.querySelector(CROSSHAIR_HIT_SELECTOR);
  // A per-series `method`/`column` overlay on a line chart lands in this same
  // `g[aria-label="line"]` namespace (marks/overlay.ts): Plot.line wraps it in its own
  // `g[aria-label="line"]`, nesting the mark's `g.tbl-overlay-line` INSIDE that — so the base
  // selector below would otherwise also pick up the overlay's path and give it a 14px invisible
  // hit zone spanning its full `domain: axis` fit. `closest` (rather than a CSS `:not()`) is used
  // because the class sits on that inner wrapper, not on the path or the aria-label element itself.
  const linePaths = Array.from(
    svgEl.querySelectorAll<SVGPathElement>('g[aria-label="line"] path[data-series]'),
  ).filter((p) => !p.closest(".tbl-overlay-line"));
  for (const path of linePaths) {
    const series = path.getAttribute("data-series");
    const d = path.getAttribute("d");
    if (!series || !d) continue;
    const hit = svgEl.ownerDocument.createElementNS(NS, "path");
    hit.classList.add("tbl-line-hitpath");
    hit.setAttribute("data-series", series);
    hit.setAttribute("d", d);
    hit.setAttribute("fill", "none");
    // A truncated value axis clips the visible line to the frame, but `d` still carries the
    // off-frame geometry — an unclipped root-level clone would leave a phantom hit zone over the
    // title/legend. Plot's frame clip is a userSpaceOnUse rect, so the same reference works here.
    const clipRef = path.closest("[clip-path]")?.getAttribute("clip-path");
    if (clipRef) hit.setAttribute("clip-path", clipRef);
    // Invisible but reliably hit-testable: pointer-events:stroke is geometry-based, but a
    // painted-with-zero-opacity stroke is the safest cross-browser choice (some engines treat
    // stroke="transparent" as non-painted). The 14px width gives a ~7px-each-side hit zone.
    hit.setAttribute("stroke", "#000");
    hit.setAttribute("stroke-opacity", "0");
    hit.setAttribute("stroke-width", "14");
    hit.setAttribute("stroke-linecap", "round");
    hit.setAttribute("stroke-linejoin", "round");
    hit.style.pointerEvents = "stroke";
    hit.style.cursor = "pointer";
    // Insert below the topmost crosshair overlay so the overlay keeps handling hover and
    // the click handler (elementsFromPoint, full stack) still pierces down to this path.
    if (overlay) {
      svgEl.insertBefore(hit, overlay);
    } else {
      svgEl.appendChild(hit);
    }
  }
}

/**
 * Two-way selection: clicking a mark PINS its series through the legend handle. Used by mountChart
 * and by every figure pane in wireFigureSvg; the two paths wired this separately and drifted (a
 * standalone categorical line got no hit-paths, histogram and dumbbell panes got no click at all).
 *
 * The hover overlay (`CROSSHAIR_HIT_SELECTOR`) is a transparent full-SVG rect on top of the marks,
 * so the click lands on it; `resolveSeriesAtPoint` hit-tests through it with `elementsFromPoint`.
 * The overlay sets its cursor inline, which beats the `.is-selectable` CSS rule, so it is
 * overridden to `pointer` here. `lineHitPaths`: add the fat hit-paths for thin line strokes.
 * Live DOM only; renderChart and the PNG export never call this. Records `svg` in
 * `CLICK_TO_PIN_SVGS`, which mountFigure reads to decide `.is-selectable`.
 */
const CLICK_TO_PIN_SVGS = new WeakSet<SVGSVGElement>();
function wireClickToPin(
  svg: SVGSVGElement,
  handle: LegendHandle,
  opts: { lineHitPaths: boolean },
): void {
  if (opts.lineHitPaths) addLineHitPaths(svg);
  svg.querySelectorAll<SVGElement>(CROSSHAIR_HIT_SELECTOR).forEach((el) => { el.style.cursor = "pointer"; });
  svg.addEventListener("click", (evt) => {
    const series = resolveSeriesAtPoint(svg, evt as MouseEvent);
    if (series) handle.toggle(series);
  });
  CLICK_TO_PIN_SVGS.add(svg);
}

// Tray-with-down-arrow glyph — inlined so the bundle stays self-contained.
const DOWNLOAD_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">' +
  '<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" ' +
  'stroke-linejoin="round" d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13h10"/></svg>';

/** Convert a chart title to a kebab-case filename slug. */
function titleToSlug(title: string | undefined): string {
  if (!title) return "chart";
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Sticky y-axis: the SVG's y-tick labels scroll off-screen when the chart overflows
// horizontally. Hide them and recreate each as a floating span (with a semi-transparent
// pill) pinned at the left; the controller translateX's the overlay by scrollLeft so the
// labels stay put. The gridlines/zero baseline stay in the SVG (visible across the chart),
// so we get frozen-y-axis behavior without rebuilding any SVG primitive in HTML.
function attachYAxisOverlay(canvasScroll: HTMLElement, svg: SVGSVGElement): OverlayEl | null {
  const textEls = Array.from(svg.querySelectorAll<SVGTextElement>("g.tbl-y-tick-label text"));
  if (!textEls.length) return null;

  const doc = canvasScroll.ownerDocument;
  const overlay = doc.createElement("div") as OverlayEl;
  overlay.className = "figure-y-axis-overlay";
  const pairs = textEls.map((textEl) => {
    const span = doc.createElement("span");
    span.textContent = textEl.textContent;
    overlay.appendChild(span);
    return { textEl, span };
  });
  textEls.forEach((el) => { el.style.visibility = "hidden"; });
  canvasScroll.appendChild(overlay);

  const reposition = (): void => {
    const svgRect = svg.getBoundingClientRect();
    const scrollRect = canvasScroll.getBoundingClientRect();
    if (!svgRect.height) return;
    overlay.style.height = `${svgRect.height}px`;
    for (const { textEl, span } of pairs) {
      const r = textEl.getBoundingClientRect();
      span.style.top = `${r.top - scrollRect.top}px`;
    }
  };
  reposition();
  // ResizeObserver keeps the spans aligned as fonts load / the box re-lays-out. Guard for
  // environments without it (e.g. jsdom): the one-time reposition above still runs.
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(reposition);
    ro.observe(svg);
    overlay._ro = ro;
  }
  return overlay;
}

/** X-axis title below the chart, sized to the visible viewport (sticky + centered in CSS). */
function appendXAxisTitle(canvasScroll: HTMLElement, axisTitle: string | null): void {
  if (!axisTitle) return;
  const el = canvasScroll.ownerDocument.createElement("div");
  el.className = "figure-x-axis-title";
  el.textContent = axisTitle;
  canvasScroll.appendChild(el);
}

/** Append an axis-title caption (`cls`) to `parent` when `title` is set. Used for the y-axis
 *  caption (above the plot) and the figure-level x-axis title (below the grid). */
function appendAxisTitleEl(parent: HTMLElement, doc: Document, cls: string, title: string | null): void {
  if (!title) return;
  const el = doc.createElement("div");
  el.className = cls;
  el.textContent = title;
  parent.appendChild(el);
}

/** The chart's folder slug, taken from the page URL (charts are served at `…/<chart-folder>/`).
 *  Used for download filenames — far tidier than a slugified title. Falls back to the title slug
 *  when the last path segment looks like a file (e.g. a local `index.html` preview). */
function downloadSlug(spec: ChartSpec): string {
  try {
    const segs = location.pathname.split("/").filter(Boolean);
    const last = segs[segs.length - 1];
    // Served at a folder URL (…/F1_revenue_headline/) → that folder is the slug.
    if (last && !/\./.test(last)) return last;
    // Opened as a file (…/F1_revenue_headline/preview.html) → use the PARENT folder as the slug, so
    // downloads are still named by the chart folder rather than the title.
    const parent = segs[segs.length - 2];
    if (parent && !/\./.test(parent)) return parent;
  } catch {
    /* no location (SSR/jsdom) — fall through */
  }
  // Resolve any title-selector tokens (with the defaults) BEFORE slugifying, so the slug reads
  // "…-by-sector" rather than "…-by-dimension". (Braces themselves could never leak — the
  // slugifier strips all non-alphanumerics — but the resolved label is the better name.)
  return titleToSlug(resolveTitleText(spec));
}

/** Data (CSV) + Image (PNG) download buttons for the source line. Filenames use the chart's folder
 *  slug (from the URL) rather than the title, which makes for unwieldy filenames.
 *
 *  `selections` is the mount's LIVE title-selector selections object (mutated in place by the
 *  inline-select widget's change handler), so the PNG export always prints the currently-chosen
 *  option labels in its title — not the defaults captured at mount time. */
function buildDownloadActions(
  doc: Document,
  spec: ChartSpec,
  rows: TidyRow[],
  slugOverride?: string,
  selections?: Record<string, string>,
  hooks?: RenderHooks,
): HTMLElement {
  const base = slugOverride || downloadSlug(spec);
  const downloads = doc.createElement("div");
  downloads.className = "figure-downloads";

  const dataBtn = doc.createElement("button");
  dataBtn.type = "button";
  dataBtn.className = "figure-download-btn";
  dataBtn.setAttribute("aria-label", "Download data (CSV)");
  dataBtn.innerHTML = `${DOWNLOAD_ICON}<span>Data</span>`;
  const dataLabel = dataBtn.querySelector("span") as HTMLSpanElement;
  dataBtn.addEventListener("click", () => {
    const original = dataLabel.textContent ?? "Data";
    dataBtn.disabled = true;
    try {
      const csv = rowsToCsv(rows);
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = doc.createElement("a");
      a.href = url;
      a.download = `${base}.csv`;
      doc.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      console.error("Data download failed:", err);
      dataLabel.textContent = "Failed";
      setTimeout(() => { dataLabel.textContent = original; dataBtn.disabled = false; }, 2000);
      return;
    }
    dataBtn.disabled = false;
  });
  downloads.appendChild(dataBtn);

  const imgBtn = doc.createElement("button");
  imgBtn.type = "button";
  imgBtn.className = "figure-download-btn";
  imgBtn.setAttribute("aria-label", "Download image (PNG)");
  imgBtn.innerHTML = `${DOWNLOAD_ICON}<span>Image</span>`;
  const imgLabel = imgBtn.querySelector("span") as HTMLSpanElement;
  imgBtn.addEventListener("click", async () => {
    const original = imgLabel.textContent ?? "Image";
    imgBtn.disabled = true;
    imgLabel.textContent = "…";
    try {
      await exportChartPng(spec, rows, { filename: `${base}.png`, selections, hooks });
    } catch (err) {
      console.error("Image export failed:", err);
      imgLabel.textContent = "Failed";
      setTimeout(() => { imgLabel.textContent = original; imgBtn.disabled = false; }, 2000);
      return;
    }
    imgLabel.textContent = original;
    imgBtn.disabled = false;
  });
  downloads.appendChild(imgBtn);

  return downloads;
}

/**
 * Mount a fully interactive chart card into `container`. Returns a teardown() that
 * disconnects the resize/scroll observers.
 *
 * Card structure (top-legend variant — default for line/bar and stacked with <5 series):
 *   div.figure-card
 *     div.figure-header            eyebrow + (title | logo) + subtitle
 *     div.figure-legend-slot       (top-legend lives here)
 *     div.figure-canvas-scroll     horizontal scroll wrapper (+ sticky y-axis overlay)
 *       div.figure-canvas          ← the re-rendered SVG goes here
 *     div.figure-meta              note + source + Data/Image download buttons
 *
 * Card structure (right-legend variant — stacked ≥5 series or explicit legendPosition:"right",
 * with legend rows to show):
 *   div.figure-card
 *     div.figure-header
 *     div.figure-body--legend-right  (flex row: canvas-side left, legend-column right)
 *       div.figure-canvas-scroll
 *         div.figure-canvas
 *       div.figure-legend-slot--right
 *         div.tbl-legend.tbl-legend--vertical
 *     div.figure-meta
 *
 * No-feedback-loop width computation for right-legend:
 *   The ResizeObserver watches the OUTER card element (whose width is set by the layout
 *   column — stable). The chart width is computed as:
 *     cardWidth − LEGEND_COLUMN_WIDTH − LEGEND_GAP
 *   This means the legend column taking space does NOT narrow the observed element, so
 *   there is no resize feedback loop. (Same discipline as the existing canvasScroll
 *   observer for the SVG-widening case.)
 */
/** Snapshot each area band's data-series → its current `d`, so a restack can morph from it. */
function captureAreaDs(svg: SVGSVGElement): Map<string, string> {
  const m = new Map<string, string>();
  svg.querySelectorAll('g[aria-label="area"] path[data-series]').forEach((p) => {
    const s = p.getAttribute("data-series");
    const d = p.getAttribute("d");
    if (s && d) m.set(s, d);
  });
  return m;
}

// Match the numbers in a path `d` string (handles decimals, signs, exponents).
const D_NUM_RE = /-?\d*\.?\d+(?:e-?\d+)?/g;

/** Brief restack morph: the stacked total is order-invariant, so only the band paths' geometry
 *  changes. We interpolate each band's `d` from its OLD to its NEW value over ~320ms (the two
 *  share an identical command structure — same x points — so the numbers line up), so the bands
 *  visibly slide into their new stack positions. Snaps if the structures don't match. Pure JS, so
 *  it works regardless of CSS `d`-transition support. */
function animateAreaRestack(svg: Element, oldDs: Map<string, string>): void {
  type Anim = { p: Element; newD: string; from: number[]; to: number[] };
  const anims: Anim[] = [];
  for (const p of svg.querySelectorAll('g[aria-label="area"] path[data-series]')) {
    const s = p.getAttribute("data-series");
    const newD = p.getAttribute("d");
    const oldD = s ? oldDs.get(s) : undefined;
    if (!s || !newD || !oldD || oldD === newD) continue;
    const from = oldD.match(D_NUM_RE)?.map(Number);
    const to = newD.match(D_NUM_RE)?.map(Number);
    if (!from || !to || from.length !== to.length) continue; // structure differs → leave at new (snap)
    p.setAttribute("d", oldD); // start at the old geometry
    anims.push({ p, newD, from, to });
  }
  if (!anims.length) return;
  const win = svg.ownerDocument?.defaultView;
  const raf = win?.requestAnimationFrame?.bind(win);
  if (!raf) {
    for (const a of anims) a.p.setAttribute("d", a.newD); // no rAF (SSR) → just apply the new geometry
    return;
  }
  const DUR = 320;
  const ease = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);
  let start = -1;
  const step = (now: number): void => {
    if (start < 0) start = now;
    const t = Math.min(1, (now - start) / DUR);
    const e = ease(t);
    for (const a of anims) {
      if (t >= 1) {
        a.p.setAttribute("d", a.newD);
        continue;
      }
      let k = 0;
      a.p.setAttribute(
        "d",
        a.newD.replace(D_NUM_RE, () => {
          const v = a.from[k]! + (a.to[k]! - a.from[k]!) * e;
          k++;
          return v.toFixed(2);
        }),
      );
    }
    if (t < 1) raf(step);
  };
  raf(step);
}

export function mountChart(container: HTMLElement, opts: MountOptions): () => void {
  const unique = normalizeSpec(opts.spec);
  if (unique !== opts.spec) opts = { ...opts, spec: unique };
  // Small-multiples figures take a separate mount path (shared faceted SVG, or a responsive
  // per-pane grid) so the heavily-tuned single-chart controller below stays untouched.
  if (opts.spec.small_multiples) return mountFigure(container, opts);

  const { spec, rows, width: initialWidth } = opts;
  // Explicit height (callers / golden path) wins; otherwise horizontal bars grow taller
  // with the bar/row count and everything else uses the fixed default.
  const height = opts.height ?? computeChartHeight(spec, rows);
  // The engine chose the height, not the host (RenderOptions.heightFromModel).
  const heightFromModel = opts.height == null;
  const doc = container.ownerDocument;
  // See MountOptions.tooltipContainer for why body is the default rather than `container` itself.
  const tooltipContainer = opts.tooltipContainer ?? doc.body;

  const card = doc.createElement("div");
  // x-<xAxisType>: keys axis-shape-dependent CSS (e.g. the x-axis-title breathing-room fix,
  // styles.ts) to the axis type rather than the chart type — see .x-numeric there for why.
  card.className = `figure-card chart-${spec.chartType} x-${spec.xAxisType}`;

  // onHover: forwarded into attachBandCrosshair below as the crosshair's own notifier — see
  // BandCrosshairOptions.onHover. Fires the host callback then the bubbling `tbl-hover` event,
  // from whatever the crosshair already resolved (never re-derived here).
  // Its disposed flag is set by the returned teardown and checked by the deferred "mount" onRender
  // dispatch below — a synchronous mount-then-teardown (React StrictMode's dev double-invoke, or any
  // fast unmount) would otherwise fire onRender for a chart that has already been disposed.
  // "Disposed" is a logical contract state, not DOM detachment: teardown disconnects observers and
  // listeners but never removes the card from its container, so the svg the consumer would be
  // handed is still sitting exactly where it was mounted — the problem is that its owner considers
  // it torn down. Commit key: the chart width of the last successful draw.
  const life = new LiveLifecycle<number>(card);
  const hoverNotifier = life.hoverNotifier(opts.onHover);

  // Inline title selectors: the mount owns ONE selections object for its whole life. The
  // header's widget change handler mutates it in place, so the PNG download (below) and any
  // later reads see the live state; the header itself is built once and never rebuilt by the
  // resize draw() loop, so the control + its state survive the engine's own re-renders.
  const selections = resolveSelections(spec, opts.selections);

  // Color accent feed: a single-series chart driven by a
  // colored title selector adopts the active option's resolved color as its line color, so it
  // matches the selector's tinted label. `requestAccentRedraw` is assigned once `draw` exists
  // below (forward reference — only invoked later, from a user's selection, by which point the
  // assignment has already run); `draw()` itself recomputes the accent color from the live
  // `selections` on every call, so a selection change picks it up on the very next redraw.
  let requestAccentRedraw: (() => void) | undefined;

  // Header: eyebrow above a title row (title left, logo baseline-aligned top-right); subtitle
  // below. Shared with the figure card via buildFigureHeader so the two never diverge.
  const closeTitleSelectors = buildFigureHeader(
    card, doc, spec, opts.eyebrow,
    spec.title_selectors
      ? {
          selectors: spec.title_selectors,
          selections,
          onSelect: opts.onSelect,
          seriesColors: spec.series_colors,
          afterChange: () => requestAccentRedraw?.(),
          isDisposed: life.isDisposed,
        }
      : undefined,
  );

  // Legend slot above the canvas (used for top-legend; hidden/empty for right-legend).
  const legendSlot = doc.createElement("div");
  legendSlot.className = "figure-legend-slot";
  card.appendChild(legendSlot);

  // Y-axis title: a horizontal caption just above the plot (left-aligned), above the legend's
  // canvas. Coexists with the units subtitle.
  appendAxisTitleEl(card, doc, "figure-y-axis-title", spec.y_axis_title ?? null);

  // Scroll wrapper isolates horizontal overflow to the chart region; the canvas holds the
  // native-px SVG (which overflows below MIN_CHART_WIDTH).
  const canvasScroll = doc.createElement("div");
  canvasScroll.className = "figure-canvas-scroll";
  const canvas = doc.createElement("div");
  canvas.className = "figure-canvas";
  canvasScroll.appendChild(canvas);
  card.appendChild(canvasScroll);

  renderSourceLine(card, {
    note: spec.note,
    source: spec.source,
    actions: buildDownloadActions(doc, spec, rows, opts.downloadName, selections, opts.hooks),
  });

  container.appendChild(card);

  // --- chart controller: re-render at the container width on resize ---
  // The chart width of the last successful draw is `life`'s commit key. The hover attachments of the
  // current draw (treemap's included) are `life`'s detach handles: the card sits outside the svg,
  // so a redraw or unmount under a still pointer would otherwise strand it (Ruling 21; B2). The svg
  // CURRENTLY in the canvas is `life`'s svg 0, re-read (not captured) by the deferred "mount"
  // onRender dispatch below — see it for why. None between a failed render and the next successful
  // one: draw()'s catch replaces the canvas with a .figure-error and there is no live svg to report.
  //
  // The card width the last successful draw was given: where a redraw falls back to when the card
  // reports no width of its own (no layout, or a hidden tab). Not the commit key, which is the CHART
  // width — beside a right legend, the legend column narrower.
  let lastOuterWidth = 0;
  let currentOverlay: OverlayEl | null = null;
  let xTitleAdded = false;
  // Right-legend slot — created lazily when the right-legend layout is activated.
  let rightLegendSlot: HTMLElement | null = null;
  // Track the current effective legendPosition so we can rebuild layout on first call.
  let currentLegendPos: "top" | "right" | null = null;

  // Area click-to-restack: the live visual stack order (selected series to the bottom, in click
  // order), the full series list, and a re-entrancy guard so re-applying pins after a rebuild
  // doesn't recurse (the latest legend handle is `life.legend`). Non-area charts never touch any of
  // this.
  let restackOrder: string[] | undefined;
  let suppressRestack = false;
  let currentSeriesNames: string[] = [];


  /** Take down the right-legend column (its legend with it) and put the canvas back in the card. */
  const dropRightColumn = (): void => {
    if (!rightLegendSlot) return;
    const bodyWrapper = rightLegendSlot.parentElement as HTMLElement;
    card.insertBefore(canvasScroll, bodyWrapper);
    bodyWrapper.remove();
    rightLegendSlot = null;
  };

  /** The width the chart is drawn at on a card `outerWidth` wide with the legend at `legendPos`. */
  const chartTarget = (outerWidth: number, legendPos: "top" | "right"): number => {
    // For right-legend, the chart width is computed from the OUTER card width (stable),
    // not from canvasScroll (which would shrink as the legend takes space → feedback loop).
    const chartAvail = legendPos === "right"
      ? outerWidth - LEGEND_COLUMN_WIDTH - LEGEND_GAP
      : outerWidth;
    // A timeline goes vertical instead of scrolling, so it renders at the real width down to a phone;
    // a treemap re-lays itself out at any width, down to its own 280px floor.
    const minW = spec.chartType === "timeline" ? TL_GEOM.minLiveWidth
      : spec.chartType === "treemap" ? TM_GEOM.minLiveWidth
      : MIN_CHART_WIDTH;
    return Math.max(minW, Math.round(chartAvail));
  };

  const draw = (
    outerWidth: number,
    legendPos: "top" | "right",
    renderPhase?: "mount" | "resize" | "reselect" | "restack",
  ): void => {
    const target = chartTarget(outerWidth, legendPos);
    if (life.isCommitted(target) && legendPos === currentLegendPos) return;
    life.runDetaches();
    // The detach can end a hover, and a consumer may unmount from that onHover(null) / tbl-hover,
    // synchronously. Drawing on would wire fresh hover onto a disposed mount.
    if (life.disposed) return;

    // Color accent feed: resolve the active title-selector option's color (raw
    // ColorRef → engine/palette.resolveColor), fresh on every draw() so a selection change picks
    // it up immediately. renderChart only applies it when the chart resolves to exactly one
    // series (engine/index.ts) — a multi-series chart's palette/series_colors stay untouched.
    const rawAccent = spec.title_selectors
      ? resolveActiveOptionColor(spec.title_selectors, selections, spec.series_colors)
      : undefined;
    const accentColor = rawAccent ? resolveColor(rawAccent) : undefined;

    // Spec §5.4: re-resolved on every width-driven redraw, on the width actually drawn (`target` —
    // beside a right legend that is the chart column, not the card).
    const timelineOrientation =
      spec.chartType === "timeline" ? resolveTimelineOrientation(spec, rows, target) : undefined;

    let built;
    try {
      built = renderChart(spec, rows, {
        width: target,
        height,
        ...(heightFromModel ? { heightFromModel: true } : {}),
        hooks: opts.hooks,
        ...(timelineOrientation ? { timelineOrientation } : {}),
        ...(restackOrder ? { stackOrder: restackOrder } : {}),
        ...(accentColor ? { accentColor } : {}),
      });
    } catch (e) {
      // Skipped when a hook (tickLabel, valueLabel, afterRender) tore the mount down. The commit is
      // invalidated, not merely left uncommitted: a resize back to the last GOOD width must not be
      // skipped as unchanged while the error is on screen. Any next width retries.
      life.failDraw(canvas, e, () => {
        // The last good draw's y-axis labels and legend describe a chart that is gone; left up, the
        // labels float over the message and the legend still pins against a detached svg. Its pins
        // are kept (life.legend) so a recovered draw carries them.
        currentOverlay?._ro?.disconnect();
        currentOverlay?.remove();
        currentOverlay = null;
        legendSlot.replaceChildren();
        dropRightColumn();
      });
      return;
    }
    // renderChart runs the user's hooks (tickLabel, valueLabel, afterRender) synchronously; one may
    // have torn the mount down. Stop before touching the card again. Same after renderLegend below
    // (legendKey).
    if (life.disposed) return;
    life.commit(target);
    lastOuterWidth = outerWidth;
    const {
      svg, legendItems, seriesKeyRows, seriesLabels, seriesOrder, colors, valueAffixes,
      xAxisTitle, dataInScope, tooltipXParse, tooltipXFormat, legendVisualOrder, netMode,
      shapeLegendItems, colorLegendTitle, shapeLegendTitle, overlayTooltips, segmentLabelsDropped,
      symbolScale, shapeIsSeries, pointOrder,
    } = built;
    // Legend-highlight value pills: attached after the crosshair below, but the legend's
    // onHighlight closure (set when the legend is created) calls through this holder, so the
    // pill renderer just needs to exist by the time the user interacts.
    // ONE resolved icon per series, shared by every tooltip this chart attaches. Handing the attach
    // functions loose channels instead is what let a legend and a tooltip disagree. The fallback
    // covers a series the legend suppressed, so EVERY series resolves — which is what lets the
    // channels go away entirely rather than survive as a path only a lone series could reach.
    const seriesIcons = resolveTooltipIcons({ legendItems, keyRows: seriesKeyRows });
    currentSeriesNames = seriesOrder;
    let pillDriver: HighlightPillsHandle | null = null;
    const onHighlight = (active: Set<string>): void => {
      pillDriver?.setActive(active);
      // teardown() leaves the legend on the page; a disposed mount restacks and reports nothing.
      if (life.disposed) return;
      // Area click-to-restack: pinned series move to the BOTTOM of the stack (in click order) so a
      // user can read them against zero; unpinning restores the default order. Driven off PINS
      // (not hover), so this only fires on an actual selection change. Re-renders the whole chart
      // via draw(), which carries the pins onto the freshly built legend.
      if (spec.chartType === "area" && !suppressRestack) {
        const pins = life.legend?.pinnedSeries() ?? [];
        const next = pins.length
          ? [...pins, ...currentSeriesNames.filter((s) => !pins.includes(s))]
          : undefined;
        if (JSON.stringify(next) !== JSON.stringify(restackOrder)) {
          // Capture the current bands' geometry so the re-rendered ones can morph from it.
          const oldDs = captureAreaDs(svg);
          restackOrder = next;
          suppressRestack = true;
          life.invalidate(); // force draw() past its same-width early return
          // A stuck `suppressRestack` silently disables every future restack on this mount — a
          // permanent break, worse than any throw it could come from — so it is reset in a
          // `finally`. It stays true for the whole draw() on purpose: draw() carries the pins onto
          // the fresh legend and may hand keyboard focus back to it, and the focus handler re-enters
          // onHighlight, where the restack branch must skip rather than recurse.
          //
          // A throwing onRender (it fires at the tail of draw's "restack" branch, after the legend
          // is rebuilt and the pins carried) must not cost the host its onLegendSelect for this pin.
          // So the render error is CARRIED: the notification below still runs, and then the render
          // error surfaces, unwrapped and identical to what the consumer threw (so `instanceof` and
          // `.message` still hold at the catch site), with a throw from the notification attached as
          // its `.cause` when that slot is free. Nothing is swallowed.
          let renderError: { e: unknown } | null = null;
          try {
            draw(card.clientWidth || lastOuterWidth, currentLegendPos ?? legendPos, "restack");
          } catch (e) {
            renderError = { e };
          } finally {
            suppressRestack = false;
          }
          if (renderError) {
            if (!life.disposed) {
              try {
                life.notify("tbl-legend-select", { active: [...active] }, opts.onLegendSelect);
              } catch (later) {
                attachCause(renderError.e, later);
              }
            }
            throw renderError.e;
          }
          // A consumer may have torn the mount down from that draw's onRender.
          if (life.disposed) return;
          // Brief morph: the stacked total is order-invariant, so only the band paths' `d` change.
          // Unreachable when draw() threw — the error above propagates past this point.
          const newSvg = canvas.querySelector("svg");
          if (newSvg) animateAreaRestack(newSvg, oldDs);
        }
      }
      // onLegendSelect: reports the active/dimmed set however it changed — a pin click, a hover,
      // focus/blur, or the reset button (legend.ts's applyHighlight runs onHighlight for all of
      // them; see its own comment). High-frequency: a bare mouse hover fires this, not only a
      // click, so a consumer wiring this up will likely want to debounce.
      life.notify("tbl-legend-select", { active: [...active] }, opts.onLegendSelect);
    };
    // Native px — no makeResponsive/viewBox: the SVG keeps its exact pixel width so it
    // overflows into the scroll wrapper below the floor instead of being CSS-scaled down.
    canvas.replaceChildren(svg);
    life.setSvgs([svg]);

    if (spec.chartType === "timeline") {
      // A timeline's title follows its ticks, which a resize can remove (a narrow vertical render
      // omits them) or bring back, so it is rebuilt on every draw rather than added once.
      canvasScroll.querySelector(":scope > .figure-x-axis-title")?.remove();
      appendXAxisTitle(canvasScroll, xAxisTitle);
    } else if (!xTitleAdded) { appendXAxisTitle(canvasScroll, xAxisTitle); xTitleAdded = true; }

    // --- Legend layout ---
    // Read before the old legend leaves the DOM: focus falls to <body> once it does.
    const carried = life.carryLegend();
    const shapeOpts = {
      shapeItems: shapeLegendItems ?? undefined,
      colorTitle: colorLegendTitle,
      shapeTitle: shapeLegendTitle,
      state: carried?.state,
    };
    let legendHandle: LegendHandle | null = null;
    // A resize below LEGEND_RIGHT_MIN_CARD_WIDTH moves the legend to the top (and a timeline's can
    // vanish), so take down a right column this draw does not use; a later right-legend draw
    // rebuilds it (the guard below). Left standing, the narrow draw kept the chart squeezed beside a
    // stale column under a second, top legend, and the next wide draw threw NotFoundError: its
    // rebuild inserts relative to canvasScroll, which was still inside the old wrapper.
    if (rightLegendSlot) {
      const hasLegend = !!legendItems || !!(shapeLegendItems && shapeLegendItems.length);
      if (legendPos !== "right" || !hasLegend) dropRightColumn();
    }
    if (legendItems || (shapeLegendItems && shapeLegendItems.length)) {
      if (legendPos === "right") {
        // Activate the right-legend layout on first use (or if switching from top).
        // `!rightLegendSlot` is defensive: a right draw with no legend rows to show takes the top
        // position instead (specPos below), so none records "right" without building the column.
        if (currentLegendPos !== "right" || !rightLegendSlot) {
          // Move canvasScroll into the body wrapper.
          const bodyWrapper = doc.createElement("div");
          bodyWrapper.className = "figure-body--legend-right";
          card.insertBefore(bodyWrapper, canvasScroll);
          card.removeChild(canvasScroll);
          bodyWrapper.appendChild(canvasScroll);
          // Create the right legend slot inside the body wrapper.
          rightLegendSlot = doc.createElement("div");
          rightLegendSlot.className = "figure-legend-slot--right";
          bodyWrapper.appendChild(rightLegendSlot);
          // Top legend slot stays in the DOM but is now empty (no content added).
        }
        // Render the right-side vertical legend with reversed series order.
        const orderedItems = orderForRightLegend(legendItems ?? [], legendVisualOrder);
        rightLegendSlot!.replaceChildren();
        legendHandle = renderLegend(rightLegendSlot!, orderedItems, {
          svg,
          onHighlight,
          hooks: opts.hooks,
          ...shapeOpts,
          abandoned: life.isDisposed,
        });
        if (life.disposed) return; // legendKey tore the mount down
        // Add the vertical-layout class to the rendered legend element (use the handle's
        // element directly rather than re-querying the slot).
        legendHandle?.element.classList.add("tbl-legend--vertical");
        // Ensure top legend slot stays empty.
        legendSlot.replaceChildren();
      } else {
        // Top legend (default behavior — unchanged for non-point charts).
        legendSlot.replaceChildren();
        legendHandle = renderLegend(legendSlot, legendItems ?? [], {
          svg,
          onHighlight,
          hooks: opts.hooks,
          ...shapeOpts,
          abandoned: life.isDisposed,
        });
        if (life.disposed) return; // legendKey tore the mount down
      }
    } else if (spec.chartType === "timeline") {
      // Drawn lanes name the categories and a vertical render may draw one track instead, so a
      // timeline's legend comes and goes on a resize: drop the last draw's.
      legendSlot.replaceChildren();
    }

    // Expose the freshly built legend handle for the area-restack re-render path (onHighlight).
    const dropped = life.adoptLegend(legendHandle, carried);

    currentLegendPos = legendPos;

    // --- Hover: one plan per chart family, shared with every figure pane (live/hover-options.ts).
    // A band chart in pills hover mode drives its own coordinated cursor: `attachBandCrosshair` runs
    // hit-test-only (emitOnly), and the locally captured drivers below play the role the figure bus
    // plays for panes, minus the bus — full-band hover (horizontal: into the left label gutter;
    // vertical: stopping at the baseline), a one-row highlight that never covers a section gap, a
    // bolded hovered label (horizontal) / frosted category pill (vertical), and a bar-end value
    // pill. Attach order mirrors wireFigureSvg (crosshair → highlightPills → secondary cursor) so
    // `.tbl-coord` paints above the bars. The legend's onHighlight above calls through `pillDriver`,
    // so the pill renderer just needs to exist by the time the user interacts.
    let secondaryDriver: CursorDriver | null = null;
    const hover = buildHoverPlan("standalone", {
      spec,
      dataInScope,
      colors,
      seriesLabels,
      seriesOrder,
      valueAffixes,
      icons: seriesIcons,
      tooltipContainer,
      hooks: opts.hooks,
      tooltipXParse,
      tooltipXFormat,
      overlayTooltips,
      symbolScale,
      shapeIsSeries,
      pointOrder,
      netMode,
      segmentLabelsDropped: segmentLabelsDropped ?? false,
      treemapTiles: built.treemapTiles,
      onHover: hoverNotifier,
      onResolve: (cat) => {
        pillDriver?.setSuppressedCategory(cat as string | null);
        secondaryDriver?.(cat, true);
      },
    });
    if (hover.primary) life.addDetach(attachPrimaryHover(svg, hover.primary));
    pillDriver = attachPlanPills(svg, hover);
    if (hover.secondary) secondaryDriver = attachSecondaryHover(svg, hover.secondary);

    currentOverlay?._ro?.disconnect();
    currentOverlay?.remove();
    currentOverlay = spec.chartType === "timeline" || spec.chartType === "treemap" ? null : attachYAxisOverlay(canvasScroll, svg);

    // --- Reciprocal annotation highlight: hovering a rug block lights up its legend row and every
    // other chart element carrying the same key (its bands, its fills, its other blocks), and dims
    // the rest — the mirror image of hovering the legend row. Clicking pins it, so the highlight can
    // be held and works on touch. Wired on the SVG (events bubble up from the crosshair overlay), so
    // there is no z-order fight with that overlay.
    // Gated on the strip EXISTING, not merely on there being a legend: `resolveRugAnnotationAtPoint`
    // can only match inside `g.tbl-rug`, so without a strip these handlers could only ever return
    // null — while still paying a `document.elementsFromPoint` hit test (and the forced style/layout
    // it implies) on every pointermove of every interactive chart in the archive.
    const stripTop = rugStripTop(svg);
    if (legendHandle && stripTop != null) {
      const handle = legendHandle;
      // The crosshair's hit rect covers the WHOLE svg, so without this the strip would serve a value
      // tooltip ("Oct 2008: 0.73") on top of the annotation highlight — two answers to one hover.
      // Stop every hit area at the top of the strip so the crosshair hides as the pointer enters it.
      svg
        .querySelectorAll<SVGRectElement>(CROSSHAIR_HIT_SELECTOR)
        .forEach((el) => el.setAttribute("height", String(stripTop)));
      svg.addEventListener("pointermove", (evt) => {
        handle.hoverAnnotation(resolveRugAnnotationAtPoint(svg, evt as MouseEvent));
      });
      svg.addEventListener("pointerleave", () => { handle.hoverAnnotation(null); });
      svg.addEventListener("click", (evt) => {
        const key = resolveRugAnnotationAtPoint(svg, evt as MouseEvent);
        if (key) handle.toggleAnnotation(key);
      });
    }

    // --- Two-way selection: clicking a bar/segment/line PINS that series via the legend
    // handle (single source of truth). Only wire when an interactive legend exists; a
    // single-series no-legend chart has nothing to select. The crosshair attaches a
    // TRANSPARENT full-SVG hit rect on top of the marks (pointer-events:all), so a plain
    // click lands on that overlay, not the bar — hit-test THROUGH it with
    // elementsFromPoint and find the first [data-series] mark beneath the cursor.
    // Point charts (scatter / dotplot) take no click (`clickToPin: null`) — just markers + legend
    // (the color legend still drives hover-dim, which is independent of the crosshair).
    if (legendHandle && hover.clickToPin) {
      card.classList.add("is-selectable");
      wireClickToPin(svg, legendHandle, hover.clickToPin);
    } else {
      card.classList.remove("is-selectable");
    }

    // The carried state reached the new legend without its onHighlight: dim the marks added since
    // it was built (the hit paths above), and tell this draw's pill driver.
    const carriedActive = life.reapplyCarried(carried, legendHandle, (active) => pillDriver?.setActive(active));

    // onRender: at each of the four real re-render occasions this mount forces past draw()'s
    // same-width/same-legendPos guard above — mount/resize/reselect, and the area click-to-restack
    // redraw a few lines up ("restack"). The restack call passes its phase explicitly and is
    // guarded by its own try/finally there, so this fires exactly once per user-visible restack
    // (the carried pins and the focus hand-back never reach a NEW draw()).
    const fireRender = (): void => {
      if (renderPhase) {
        if (renderPhase === "mount") {
          // Deferred: this IS mountChart's own initial call, still executing inside mountChart's
          // own body — everything after it (requestAccentRedraw wiring, the scroll listener, the
          // ResizeObserver, and the RETURN of the teardown closure) is still to come. A function
          // cannot both let an exception propagate to its caller AND return a value to that same
          // caller, so a throwing onRender here — unlike resize/reselect, which have no follow-up
          // code in the closure that called draw(), and restack, which has its own try/finally
          // below — would otherwise make mountChart() itself throw: the caller would never receive
          // the teardown, and the ResizeObserver would never attach (chart rendered but left
          // un-tearable-down and non-resizable). Queuing the notify lets mountChart() finish and
          // return normally first; the throw still surfaces (uncaught, on its own microtask) rather
          // than being swallowed — it just arrives slightly later than the other three phases.
          //
          // Guarded on `life.disposed`: a caller that tears the mount down before this microtask runs
          // (a synchronous mount-then-teardown — React StrictMode's dev double-invoke does exactly
          // this) must not have onRender fire afterward for a chart already disposed of — a logical
          // contract state, not DOM detachment; teardown never removes the card from its container.
          // Checked INSIDE the microtask (not before scheduling it) since `disposed` is only known
          // at the time this callback actually runs.
          //
          // The svg is RE-READ from `life`'s svg 0 inside the microtask rather than captured with this
          // closure. Deferring means a synchronous re-render can land first — a host that changes a
          // title selector immediately after mountChart() returns reaches requestAccentRedraw, whose
          // draw() runs `canvas.replaceChildren(newSvg)` and notifies "reselect" synchronously — and
          // the svg this closure was created with is by then DETACHED. Handing a consumer that node
          // makes every DOM mutation its mount handler performs invisible: a silent no-op in the one
          // callback that exists so a consumer can decorate the chart it just mounted.
          //
          // RE-TARGET rather than skip: "mount" means "the first notification for this mounted
          // chart", and a consumer's one-time decoration must land SOMEWHERE or it never happens at
          // all for the life of the chart. (Whether the label is exactly right in that sequence is a
          // smaller complaint than never firing; a consumer that decorates on more than one phase is
          // already handed the same fresh svg twice per redraw and has to be idempotent regardless.)
          // Identity is read as `life`'s svg 0, the reference draw() assigns beside its own
          // replaceChildren: `svg.parentNode === canvas` would answer the same question here but not
          // in mountFigure, where each pane's svg lives in its own cell wrapper, and a draw counter
          // would need threading and keeping in step to say no more than the live reference does.
          // Deliberately NOT `svg.isConnected`: a mount into a detached container reports false on a
          // perfectly current svg (most of the test suite mounts exactly that way).
          life.deferMountRender(0, () => opts.onRender);
        } else {
          life.notify("tbl-render", { svg, phase: renderPhase }, opts.onRender);
        }
      }
    };

    // The drop is reported after onRender, which must be handed THIS draw's svg: on an area chart a
    // dropped pin changes the stack order, and onHighlight restacks with a draw of its own.
    life.finishRedraw(
      fireRender,
      dropped ? () => onHighlight(carriedActive) : null,
      // life.legend, not legendHandle: that restack may have replaced the legend again.
      () => { if (carried?.focus) life.legend?.focus(carried.focus); },
    );
  };

  // Initial draw: we don't know the series count yet, so render first to get legendItems,
  // then resolve legendPosition from the result. Use initialWidth or a fallback for the
  // very first render (before the ResizeObserver fires).
  const initialCardWidth = card.clientWidth || initialWidth || 720;
  // Quick pre-render to detect series count (width doesn't matter for position resolution). Its
  // SVG is discarded (never mounted), so `afterRender` is stripped from the hooks passed here —
  // else a real mount would fire a mutating, possibly side-effecting hook twice: once uselessly
  // on this throwaway probe, once more on the real draw() below. Every other hook is a pure
  // formatter, unaffected by running against output nobody sees.
  let prelimLegendItems: NonNullable<ReturnType<typeof renderChart>["legendItems"]> = [];
  let prelimShapeRows = 0;
  try {
    const prelimHooks = opts.hooks?.afterRender ? { ...opts.hooks, afterRender: undefined } : opts.hooks;
    const prelim = renderChart(spec, rows, {
      width: initialCardWidth,
      height,
      ...(heightFromModel ? { heightFromModel: true } : {}),
      hooks: prelimHooks,
    });
    prelimLegendItems = prelim.legendItems ?? [];
    prelimShapeRows = prelim.shapeLegendItems?.length ?? 0;
  } catch {
    // Ignore — draw() will surface the error.
  }
  // The spec's legend position on a card `cardW` wide, by the export's rule (legendInRightColumn):
  // "right" only for a legend with rows to show. A legend with none — a single series,
  // `series_legend: false` with no other rows, a treemap's flat data — reserves no column, so the
  // plot takes the card's full width, as in the PNG. Legend rows do not depend on the chart's width
  // (pinned per row source in test/right-legend-no-rows.test.ts), so the probe's rows hold at
  // every width — except a timeline's: a resize can switch its
  // orientation, and with it whether drawn lanes replace the rows, so it is asked at the width the
  // column would leave.
  const specPos = (cardW: number): "top" | "right" => {
    if (spec.chartType !== "timeline") {
      return legendInRightColumn(spec, prelimLegendItems, prelimShapeRows, rows) ? "right" : "top";
    }
    // A timeline's position never depends on its row count (only a stacked chart's does), so this
    // check is cheap and skips the orientation layout for every timeline that is not "right".
    if (resolveLegendPosition(spec, 0, rows) !== "right") return "top";
    const orientation = resolveTimelineOrientation(spec, rows, chartTarget(cardW, "right"));
    return timelineLegendRowCount(spec, rows, orientation) > 0 ? "right" : "top";
  };
  // Fall back to top if the card is too narrow for the right-legend column.
  const resolvedPos = (): "top" | "right" => {
    const cardW = card.clientWidth || initialWidth || 720;
    const pos = specPos(cardW);
    if (pos === "right" && cardW < LEGEND_RIGHT_MIN_CARD_WIDTH) {
      return "top";
    }
    return pos;
  };

  draw(initialCardWidth, resolvedPos(), "mount");

  // Wire the accent-redraw hook (see its declaration above): a title-selector change forces
  // draw() past its same-width/same-legendPos early return, mirroring the area click-to-restack
  // pattern (`life.invalidate()` then a fresh draw() call at the current width/legendPos).
  requestAccentRedraw = () => {
    if (life.disposed) return;
    life.invalidate();
    draw(card.clientWidth || lastOuterWidth || initialCardWidth, currentLegendPos ?? resolvedPos(), "reselect");
  };

  // Single persistent scrollLeft → translateX for the sticky y-axis overlay.
  let scrollRaf: number | null = null;
  const onScroll = (): void => {
    if (scrollRaf !== null) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = null;
      if (currentOverlay) currentOverlay.style.transform = `translateX(${canvasScroll.scrollLeft}px)`;
    });
  };
  canvasScroll.addEventListener("scroll", onScroll);

  // Re-render on width change. For right-legend, observe the OUTER card (stable width set by
  // layout column, unaffected by inner SVG widening → no feedback loop). For top-legend,
  // canvasScroll is equivalent, but we observe card uniformly so the legendPos computation
  // always has access to the full outer width.
  // Guard for environments without ResizeObserver (e.g. jsdom): the initial draw still ran.
  let resizeRaf: number | null = null;
  let ro: ResizeObserver | undefined;
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => {
      if (resizeRaf !== null) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        const cardW = card.clientWidth;
        // A hidden card (a collapsed tab) reports 0: drawing then would render at the minimum width
        // and move a right legend to the top, only to undo both when shown. The observer fires
        // again on the first non-zero width.
        if (!cardW) return;
        const pos = specPos(cardW);
        const effectivePos: "top" | "right" =
          pos === "right" && cardW < LEGEND_RIGHT_MIN_CARD_WIDTH ? "top" : pos;
        draw(cardW, effectivePos, "resize");
      });
    });
    ro.observe(card);
  }

  return () => {
    life.dispose();
    ro?.disconnect();
    if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
    if (scrollRaf !== null) cancelAnimationFrame(scrollRaf);
    canvasScroll.removeEventListener("scroll", onScroll);
    currentOverlay?._ro?.disconnect();
    closeTitleSelectors();
  };
}

// --- Small-multiples figure mount ----------------------------------------------------------
// Below this pane width the grid reflows to fewer columns (3→2→1). Used by both modes.
const PANE_MIN_WIDTH = 240;
// Must match the column-gap in `.figure-grid` CSS so the per-pane width math lines up.
const GRID_GAP = 16;

/** Live wiring for the inline title selector(s): the spec's `title_selectors`, the mount's
 *  SHARED mutable selections object (updated in place on change, so later reads — e.g. the PNG
 *  download button — always see the live state), and the host's optional change callback. The
 *  card root itself (buildFigureHeader's first argument) is the CustomEvent dispatch target. */
export interface TitleSelectorWiring {
  selectors: Record<string, TitleSelector>;
  selections: Record<string, string>;
  onSelect?: (change: { id: string; value: string }) => void;
  /** `spec.series_colors` — the fallback source for an option's trigger-label tint when the
   *  option itself has no explicit `color` (see TitleSelectorOption.color and
   *  spec/title.ts#resolveActiveOptionColor, which this mirrors at build time). */
  seriesColors?: Record<string, string>;
  /** Called after a selection's shared-state update + host callback + CustomEvent have all
   *  fired — mountChart's hook to re-render the chart body so a single-series chart's line
   *  adopts the newly-active option's color (see engine/index.ts
   *  RenderOptions.accentColor). mountFigure (small multiples) omits this: the label still
   *  tints, but the per-pane grid isn't re-rendered — each pane is one facet's chart body, not a
   *  single accent target, and this port does not touch figure.ts. */
  afterChange?: () => void;
  /** The owning mount's disposal state. Read on every change, because teardown can re-enter the
   *  widget before it closes the header (its own `onHover(null)` may pick an option). */
  isDisposed?: () => boolean;
}

/** One option's DATA for the inline-select widget below: display label + the RAW (unresolved)
 *  color, if any, that tints the trigger label while this option is active. */
interface InlineSelectItem {
  id: string;
  label: string;
  color?: string;
}

/**
 * The AI Labor Market Tracker's inline title-selector widget (charts.js `buildInlineSelect`,
 * ported near-verbatim — see also styles.css L392-479 for the paired CSS): a button styled like
 * a boxed piece of title text (`.inline-select`) with a caret, opening a popover `<ul>`
 * (`.inline-select-popover`) of options on click. Behavior: click toggles the popover; a
 * click anywhere outside the button/popover closes it; Escape closes it and refocuses the
 * button; Enter/Space on a focused option selects it; ArrowUp/ArrowDown move focus with
 * wraparound; typing buffers into a 600ms type-ahead match against option labels. The button's
 * label is tinted to the ACTIVE option's resolved color (`palette.resolveColor`) — the caret
 * stays muted; the popover itself carries no per-option tint (the active row is marked navy +
 * semibold only, via `.is-active`).
 *
 * One structural difference from the tracker: the tracker tears down and rebuilds this widget on
 * every selection (as part of a full figure re-render driven by its own state store). The
 * engine's title is built ONCE per mount and never rebuilt (see buildFigureHeader) so the resize
 * draw() loop can't clobber the user's open popover / focus — so this instance updates its own
 * label/aria state in place on selection, rather than relying on a future rebuild.
 */
function buildInlineSelect(
  doc: Document,
  items: InlineSelectItem[],
  initialActiveId: string,
  onSelect: (id: string) => void,
): { el: HTMLElement; destroy: () => void } {
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.className = "inline-select";
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");

  const labelEl = doc.createElement("span");
  labelEl.className = "inline-select-label";
  const caret = doc.createElement("span");
  caret.className = "inline-select-caret";
  caret.textContent = "▾";
  caret.setAttribute("aria-hidden", "true");
  btn.appendChild(labelEl);
  btn.appendChild(caret);

  const popover = doc.createElement("ul");
  popover.className = "inline-select-popover";
  popover.setAttribute("role", "listbox");
  popover.hidden = true;

  let activeId = initialActiveId;
  const itemById = new Map<string, HTMLLIElement>();

  function refresh(): void {
    const active = items.find((i) => i.id === activeId) ?? items[0];
    labelEl.textContent = active?.label ?? "";
    // Tint the label with the option's resolved color (matches the chart's series color when the
    // accent feeds back to a single-series chart — see engine/index.ts RenderOptions.accentColor);
    // the caret stays grey (CSS-only, var(--tbl-text-muted)).
    labelEl.style.color = (active && resolveColor(active.color)) || "";
    for (const [id, li] of itemById) {
      li.setAttribute("aria-selected", String(id === active?.id));
      li.classList.toggle("is-active", id === active?.id);
    }
  }

  function selectItem(id: string): void {
    activeId = id;
    refresh();
    onSelect(id);
  }

  for (const item of items) {
    const li = doc.createElement("li");
    li.setAttribute("role", "option");
    li.dataset.id = item.id;
    li.textContent = item.label;
    li.tabIndex = 0;
    li.addEventListener("click", () => {
      selectItem(item.id);
      closePopover();
    });
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectItem(item.id);
        closePopover();
      }
    });
    popover.appendChild(li);
    itemById.set(item.id, li);
  }
  refresh();

  let typeAheadBuffer = "";
  let typeAheadTimer: ReturnType<typeof setTimeout> | undefined;

  function focusItem(li: HTMLElement | null | undefined): void {
    li?.focus();
  }

  // Guards the deferred `addEventListener` below: if closePopover runs in the SAME synchronous
  // tick as openPopover (e.g. click-then-Escape with no await), the pending setTimeout hasn't
  // fired yet, so removeEventListener would no-op and the listener would attach anyway a tick
  // later — permanently, since nothing is listening for it at that point. Capturing the timer id
  // lets closePopover cancel it before it ever registers.
  let clickAwayTimer: ReturnType<typeof setTimeout> | undefined;
  function openPopover(): void {
    popover.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    clickAwayTimer = setTimeout(() => {
      clickAwayTimer = undefined;
      doc.addEventListener("click", clickAway);
    }, 0);
    setTimeout(() => {
      const activeLi = itemById.get(activeId) ?? (popover.firstElementChild as HTMLElement | null);
      focusItem(activeLi);
    }, 0);
  }
  function closePopover(): void {
    popover.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    if (clickAwayTimer !== undefined) {
      clearTimeout(clickAwayTimer);
      clickAwayTimer = undefined;
    }
    doc.removeEventListener("click", clickAway);
    typeAheadBuffer = "";
    clearTimeout(typeAheadTimer);
    btn.focus();
  }
  function clickAway(e: Event): void {
    const target = e.target as Node;
    if (!btn.contains(target) && !popover.contains(target)) closePopover();
  }
  // Unmount-time teardown: same listener/timer cleanup as closePopover, but without the
  // onSelect-adjacent focus side effect (the button may be about to leave the DOM).
  function destroy(): void {
    if (clickAwayTimer !== undefined) {
      clearTimeout(clickAwayTimer);
      clickAwayTimer = undefined;
    }
    doc.removeEventListener("click", clickAway);
    clearTimeout(typeAheadTimer);
    popover.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }

  function keyHandler(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      closePopover();
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      const focused = doc.activeElement;
      if (focused && focused.parentElement === popover) {
        e.preventDefault();
        (focused as HTMLElement).click();
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const lis = Array.from(popover.children) as HTMLElement[];
      const idx = lis.indexOf(doc.activeElement as HTMLElement);
      const next = e.key === "ArrowDown"
        ? lis[(idx + 1) % lis.length]
        : lis[(idx - 1 + lis.length) % lis.length];
      focusItem(next);
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      typeAheadBuffer += e.key.toLowerCase();
      clearTimeout(typeAheadTimer);
      typeAheadTimer = setTimeout(() => {
        typeAheadBuffer = "";
      }, 600);
      const match = items.find((i) => i.label.toLowerCase().startsWith(typeAheadBuffer));
      if (match) {
        e.preventDefault();
        focusItem(itemById.get(match.id));
      }
    }
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    popover.hidden ? openPopover() : closePopover();
  });

  const wrap = doc.createElement("span");
  wrap.className = "inline-select-wrap";
  wrap.appendChild(btn);
  wrap.appendChild(popover);
  wrap.addEventListener("keydown", keyHandler);
  return { el: wrap, destroy };
}

/** Render a title with inline-selector tokens into `h`: text segments become text nodes; each
 *  `{key}` token becomes an engine-owned button+popover widget (see buildInlineSelect — options
 *  from its TitleSelector, active = the current selection). On change: the shared selections
 *  object is updated in place, the host callback fires, a bubbling `tbl-title-select` CustomEvent
 *  dispatches from the card root (for standalone bundles with no host callback), and — when
 *  wired (mountChart only) — `afterChange` re-renders the chart body for the color accent. */
function buildSelectorTitle(
  h: HTMLElement,
  doc: Document,
  title: string,
  card: HTMLElement,
  wiring: TitleSelectorWiring,
): Array<() => void> {
  // Set by the header's close (every mount's teardown calls it, last): the widget stays on the
  // page, but a torn-down mount fires no onSelect, no tbl-title-select and no redraw. `off()` also
  // reads the mount's own disposal, which is set FIRST: teardown's onHover(null) can pick an option
  // before the header is closed. The close stays last so it still cleans up a popover opened then.
  let closed = false;
  const cleanups: Array<() => void> = [() => { closed = true; }];
  const { selectors, selections, onSelect, seriesColors, afterChange, isDisposed } = wiring;
  const off = (): boolean => closed || (isDisposed?.() ?? false);
  for (const seg of parseTitleTokens(title, selectors)) {
    if (seg.kind === "text") {
      h.appendChild(doc.createTextNode(seg.text));
      continue;
    }
    const key = seg.key;
    const selector = selectors[key]!;
    const items: InlineSelectItem[] = selector.options.map((opt) => ({
      id: opt.id,
      label: opt.label ?? opt.id,
      // Explicit option color wins; else the figure's series color for the option's label (the
      // shared per-series map) — mirrors spec/title.ts#resolveActiveOptionColor.
      color: opt.color ?? ownValue(seriesColors, opt.label ?? opt.id),
    }));
    // The mounts always pass a resolveSelections() map (every key populated), so the fallback is
    // defensive only — buildFigureHeader is exported, and an external caller could hand-roll an
    // incomplete wiring.selections.
    const initialActiveId = selections[key] ?? selector.options[0]?.id ?? "";
    const { el, destroy } = buildInlineSelect(doc, items, initialActiveId, (value) => {
      selections[key] = value;
      if (off()) return;
      notify(card, "tbl-title-select", { id: key, value }, onSelect, off);
      if (off()) return;
      afterChange?.();
    });
    h.appendChild(el);
    cleanups.push(destroy);
  }
  return cleanups;
}

/** Build the shared card header (eyebrow / title+logo / subtitle) — mirrors mountChart's
 *  header so single-chart and figure cards look identical. The eyebrow (figure number) is an
 *  embed-time value supplied by the caller, not read from the spec.
 *
 *  The spec parameter is typed as `{ title?: string; subtitle?: string }` (a structural subset)
 *  so both ChartSpec and TableSpec can be passed without casting. `titleWiring` (chart mounts
 *  only — tables have no title_selectors and omit it) turns each `{key}` token in the title
 *  into an engine-owned button+popover widget (see buildInlineSelect); absent, the title renders
 *  as plain textContent, DOM-identical to before the selector feature existed. The header is
 *  built ONCE per mount
 *  (the resize draw() loop never rebuilds it), so the control and its selection state survive
 *  the engine's own re-renders naturally.
 *
 *  Returns a cleanup callback: closes any open title-selector popover(s), clears their pending
 *  click-away timers, and removes the document click listener. A no-op when there's no
 *  titleWiring (tables, or a chart with no title_selectors). Callers (mountChart, mountFigure)
 *  MUST invoke this from their own unmount closures — otherwise unmounting with a popover open
 *  leaves its document-level click listener attached forever. */
export function buildFigureHeader(
  card: HTMLElement,
  doc: Document,
  spec: { title?: string; subtitle?: string },
  eyebrowText?: string,
  titleWiring?: TitleSelectorWiring,
): () => void {
  const header = doc.createElement("div");
  header.className = "figure-header";
  if (eyebrowText) {
    const eyebrow = doc.createElement("div");
    eyebrow.className = "figure-supertitle";
    eyebrow.textContent = eyebrowText;
    header.appendChild(eyebrow);
  }
  const titlebar = doc.createElement("div");
  titlebar.className = "figure-titlebar";
  let cleanups: Array<() => void> = [];
  if (spec.title) {
    const h = doc.createElement("h3");
    h.className = "figure-title";
    if (titleWiring && Object.keys(titleWiring.selectors).length) {
      cleanups = buildSelectorTitle(h, doc, spec.title, card, titleWiring);
    } else {
      h.textContent = spec.title;
    }
    titlebar.appendChild(h);
  }
  const logoWrapper = doc.createElement("div");
  logoWrapper.className = "figure-logo";
  logoWrapper.innerHTML = LOGO_SVG;
  titlebar.appendChild(logoWrapper);
  header.appendChild(titlebar);
  if (spec.subtitle) {
    const s = doc.createElement("p");
    s.className = "figure-subtitle";
    s.textContent = spec.subtitle;
    header.appendChild(s);
  }
  card.appendChild(header);
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

/** Wire the hover + two-way selection onto one figure pane's mini-SVG (both modes draw one per
 *  pane), from the same per-family plan mountChart's draw() builds (live/hover-options.ts; the
 *  pane differences are listed there). Attach order: primary crosshair → click-to-pin (gated on
 *  `handle`: nothing to pin without an interactive legend) → legend-highlight pills → coordinated
 *  cursor. When `inputs.onResolve` is set (coordinated cursor), the primary emits its resolved key
 *  and the secondary-cursor driver is returned for the figure-level bus. */
function wireFigureSvg(
  svg: SVGSVGElement,
  handle: LegendHandle | null,
  inputs: HoverInputs,
  sinks: {
    /** Legend-highlight pills: the pane's value-pill handle is registered here so the figure-level
     *  legend can fire every pane's pills on highlight, and the coordinated cursor can suppress the
     *  hovered category's pills. */
    onPillDriver?: (handle: HighlightPillsHandle) => void;
    /** Receives this pane's hover detach handle (crosshair.ts `HoverDetach`); mountFigure runs every
     *  pane's before each redraw and on teardown, as mountChart does its own. */
    onHoverDetach: (detach: HoverDetach) => void;
  },
): CursorDriver | undefined {
  const hover = buildHoverPlan("pane", inputs);
  if (hover.primary) sinks.onHoverDetach(attachPrimaryHover(svg, hover.primary));
  if (handle && hover.clickToPin) wireClickToPin(svg, handle, hover.clickToPin);
  const pills = attachPlanPills(svg, hover);
  if (pills) sinks.onPillDriver?.(pills);
  return hover.secondary ? attachSecondaryHover(svg, hover.secondary) : undefined;
}

/**
 * Mount a small-multiples figure. BOTH modes render into a responsive `.figure-grid` of
 * independent per-pane mini-chart SVGs (each its own y-scale or, in shared mode, a forced
 * common y-scale), reflowing columns by width. The top legend's highlight root is the GRID so
 * dimming/pinning spans every pane; each pane gets its own crosshair + click-to-select,
 * dispatched per pane by xAxisType (band for categorical, line for continuous).
 *
 * Shared vs. per-pane is now ENTIRELY a renderFigure concern: shared mode forces one y-domain
 * across panes and hides the y-tick labels on non-leftmost columns; the live wiring here is
 * identical for both. Both modes support line, bar, and stacked panes. A coordinated cursor
 * (on by default, `coordinated_cursor: false` to disable) echoes a secondary cursor on sibling
 * panes at the hovered x.
 */
function mountFigure(container: HTMLElement, opts: MountOptions): () => void {
  const { spec, rows } = opts;
  const sm = spec.small_multiples!;
  const doc = container.ownerDocument;
  // See MountOptions.tooltipContainer for why body is the default rather than `container` itself.
  const tooltipContainer = opts.tooltipContainer ?? doc.body;

  const card = doc.createElement("div");
  // x-<xAxisType>: same axis-keyed class as mountChart's card — see the comment there. A faceted
  // scatter never carried the chart-type class this replaces, so this is a fix, not just a rename.
  card.className = `figure-card x-${spec.xAxisType}`;
  // Its disposed flag is set by the returned teardown and checked by the deferred "mount" onRender
  // dispatch below — see mountChart's for why (a synchronous mount-then-teardown must not fire
  // onRender afterward for a chart that no longer exists). Commit key: the grid signature.
  // `life` also holds the pane svgs CURRENTLY in the grid, by pane index — re-read (not captured)
  // by the deferred "mount" onRender dispatch below; see mountChart's identical dispatch comment.
  // Emptied by a failed render, which replaces the grid with a .figure-error and leaves no live
  // pane at all. And it holds every pane's hover detach handle of the current draw, and the legend
  // of the current draw, read by the next one to carry its pins (see CarriedLegend).
  const life = new LiveLifecycle<string>(card);
  // onHover: same notifier shape as mountChart's, forwarded per pane through wireFigureSvg's ctx.
  const hoverNotifier = life.hoverNotifier(opts.onHover);
  // Inline title selectors — same single shared selections object discipline as mountChart.
  // `afterChange` re-renders the pane grid so a colored option's accent recolors every pane's bars
  // live (parity with mountChart's requestAccentRedraw). Forward-declared: assigned once draw()
  // exists below. See TitleSelectorWiring.afterChange.
  const selections = resolveSelections(spec, opts.selections);
  let requestFigureRedraw: (() => void) | undefined;
  const closeTitleSelectors = buildFigureHeader(
    card, doc, spec, opts.eyebrow,
    spec.title_selectors
      ? {
          selectors: spec.title_selectors,
          selections,
          onSelect: opts.onSelect,
          seriesColors: spec.series_colors,
          afterChange: () => requestFigureRedraw?.(),
          isDisposed: life.isDisposed,
        }
      : undefined,
  );

  const legendSlot = doc.createElement("div");
  legendSlot.className = "figure-legend-slot";
  card.appendChild(legendSlot);

  // Figure-level y-axis title: one caption above the whole grid (left-aligned).
  appendAxisTitleEl(card, doc, "figure-y-axis-title", spec.y_axis_title ?? null);

  // Body: BOTH modes use the responsive `.figure-grid` of independent per-pane mini-SVGs.
  // (Shared mode is no longer a single faceted SVG — it is the same per-pane composition with
  // one shared y-domain + y-labels only on the left column, all handled inside renderFigure.)
  // Variable-width figures never reflow to extra rows — they keep their columns and scroll
  // horizontally when narrow, so their grid lives inside a horizontal-scroll wrapper.
  const smCfg = spec.small_multiples!;
  const variableWidths = smCfg.pane_widths != null && smCfg.pane_widths !== "equal";
  const noStack = variableWidths;
  const grid = doc.createElement("div");
  grid.className = "figure-grid";
  if (noStack) {
    const scroll = doc.createElement("div");
    scroll.className = "figure-grid-scroll";
    scroll.appendChild(grid);
    card.appendChild(scroll);
  } else {
    card.appendChild(grid);
  }

  // Figure-level x-axis title: one centered caption below the whole grid.
  appendAxisTitleEl(card, doc, "figure-x-axis-title", spec.x_axis_title ?? null);

  renderSourceLine(card, {
    note: spec.note,
    source: spec.source,
    actions: buildDownloadActions(doc, spec, rows, opts.downloadName, selections, opts.hooks),
  });
  container.appendChild(card);

  // Distinct in-scope facet values (respecting pane_order) → the pane count. Used to clamp the
  // column count BEFORE computing paneW, so the per-pane render width matches the grid cell
  // width even when there are fewer panes than the reflow/config would allow.
  // Counted over the rows renderFigure draws: a pane holding only rows of a section section_order
  // leaves out is never rendered, so it must not take a grid column.
  const figCols = resolveColumns(spec, rows);
  const facetCol = figCols.facet;
  const sectionCol = figCols.section;
  const drawnRows = rowsInSectionOrder(rows, spec.section_order, sectionCol ? (r) => r[sectionCol] as string : null);
  const paneCount = (): number => {
    const distinct = new Set<string>();
    for (const r of drawnRows) {
      const v = facetCol ? r[facetCol] : undefined;
      if (typeof v === "string" && v !== "") distinct.add(v);
    }
    const n = sm.pane_order && sm.pane_order.length
      ? sm.pane_order.filter((v) => distinct.has(v)).length
      : distinct.size;
    return Math.max(1, n);
  };

  // Draw the responsive grid of independent per-pane mini-SVGs. Used by BOTH modes: renderFigure
  // returns a uniform panes[] grid (shared mode forces one y-domain + hides non-left y-labels
  // internally), so the live wiring is identical — each pane gets its own crosshair + selection,
  // and the legend's highlight root is the grid so dimming/pinning spans every pane.
  const isShared = (sm.mode ?? "shared") === "shared";

  // Point-chart panes (dot plots / scatters) carry only markers, so they read fine much narrower
  // than line/bar panes — use a smaller reflow floor so a configured column count (e.g. 3) still
  // fits at common widths instead of collapsing to 2.
  const isPointFigure = spec.chartType === "dotplot" || spec.chartType === "scatter";
  // Waterfall panes carry long step labels (often rotated) under the plot, so give them a wider
  // reflow floor (fewer, roomier columns) than a plain bar pane.
  const isWaterfallFig = spec.chartType === "waterfall";
  const paneMinWidth = isPointFigure ? 160 : isWaterfallFig ? 320 : PANE_MIN_WIDTH;
  // Categorical (band) figures whose hover is the shade + bar-end pill (like the standalone bar
  // chart), not the floating tooltip. Used to give a lone pane that treatment (see `coordinated`).
  const isCategoricalBarFig = spec.chartType === "bar" || spec.chartType === "stacked";
  // Dot-plot AND bar/stacked panes render ~33% taller (320); waterfall panes taller still (420) to
  // clear rotated step labels; line/scatter keep the default (240). Single source of truth shared
  // with the PNG export (export-png.ts) so the two paths can't drift. (A horizontal bar, stack or
  // dumbbell is never a figure: its facets draw as groups, spec/facet-groups.ts.)
  const figHeight = figurePaneHeight(spec);

  const drawGrid = (outerWidth: number, renderPhase?: "mount" | "resize" | "reselect"): void => {
    const baseCols = sm.columns && sm.columns > 0 ? sm.columns : 0; // 0 → reflow-driven
    // Reflow: how many columns fit at >= paneMinWidth each, capped by config and pane count
    // (so renderFigure won't re-clamp and leave paneW mismatched against the grid cells).
    // NO-STACK figures (variable widths) never reduce columns for width — they keep the configured
    // columns (else a single row) and scroll horizontally instead.
    const fitCols = Math.max(1, Math.floor((outerWidth + GRID_GAP) / (paneMinWidth + GRID_GAP)));
    const cols = noStack
      ? Math.max(1, Math.min(baseCols || paneCount(), paneCount()))
      : Math.max(1, Math.min(baseCols || fitCols, fitCols, paneCount()));
    // No-stack: keep panes at a readable minimum and let the row overflow into the scroll wrapper.
    const naturalW = cols * paneMinWidth + (cols - 1) * GRID_GAP;
    const gridW = noStack ? Math.max(outerWidth, naturalW) : outerWidth;
    // Pass the TOTAL inner grid width + gap whenever renderFigure sizes explicit per-column widths
    // — SHARED mode (unequal labeled/label-less columns), or variable pane_widths in either mode.
    // Otherwise (equal per-pane) pass one shared pane width for 1fr columns.
    const useGridWidth = isShared || variableWidths;
    const paneW = Math.max(paneMinWidth, Math.floor((gridW - GRID_GAP * (cols - 1)) / cols));
    const sig = useGridWidth ? `s:${cols}:${gridW}` : `p:${cols}:${paneW}`;
    if (life.isCommitted(sig)) return;
    life.runDetaches();
    // As mountChart's draw(): a consumer may unmount from the onHover(null) the detach just sent.
    if (life.disposed) return;
    // Inline-selector accent (parity with mountChart's draw()): recolor every pane's bars to the
    // active option's color. renderFigure forwards accentColor to each pane's renderChart, which
    // applies it to single/no-series bars (category_colors still overrides; multi-series unchanged).
    // Gated on a resolvable colored option → figures without one pass nothing and stay byte-identical.
    const rawAccent = spec.title_selectors
      ? resolveActiveOptionColor(spec.title_selectors, selections, spec.series_colors)
      : undefined;
    const accentColor = rawAccent ? resolveColor(rawAccent) : undefined;
    let fig: FigureRenderResult;
    try {
      fig = useGridWidth
        ? renderFigure(spec, rows, {
            gridWidth: gridW,
            gridGap: GRID_GAP,
            height: figHeight,
            columns: cols,
            hooks: opts.hooks,
            ...(accentColor ? { accentColor } : {}),
          })
        : renderFigure(spec, rows, {
            width: paneW,
            height: figHeight,
            columns: cols,
            hooks: opts.hooks,
            ...(accentColor ? { accentColor } : {}),
          });
    } catch (e) {
      // Skipped when a hook in a pane's render tore the mount down. Invalidated, as mountChart's
      // draw(): the failed width and the last good one both retry.
      // As mountChart's draw(): the legend goes with the panes it pinned; its pins are kept.
      life.failDraw(grid, e, () => legendSlot.replaceChildren());
      return;
    }
    // renderFigure runs the user's hooks synchronously for every pane; one may have torn the mount
    // down. Stop before touching the card again (as mountChart's draw(); also after renderLegend).
    if (life.disposed) return;
    life.commit(sig); // commit only after a successful render
    // Explicit per-column px widths (shared mode, or variable pane_widths in either mode): the
    // panes were rendered at those widths, so the grid template must match. Else equal 1fr columns.
    if (fig.columnWidths && fig.columnWidths.length) {
      grid.style.gridTemplateColumns = fig.columnWidths.map((w) => `${w}px`).join(" ");
    } else {
      grid.style.gridTemplateColumns = "";
    }
    grid.style.setProperty("--figure-cols", String(fig.columns));
    grid.replaceChildren();
    for (const pane of fig.panes) {
      const cell = doc.createElement("div");
      cell.className = "figure-pane";
      const title = doc.createElement("div");
      title.className = "figure-pane-title";
      title.textContent = pane.title;
      cell.appendChild(title);
      if (pane.svg) cell.appendChild(pane.svg);
      grid.appendChild(cell);
    }
    life.setSvgs(fig.panes.map((p) => (p.svg as SVGSVGElement | undefined) ?? undefined));
    // Read before the old legend leaves the DOM: focus falls to <body> once it does.
    const carried = life.carryLegend();
    legendSlot.replaceChildren();
    // Highlight root = the grid, so legend hover/pin dims [data-series] across EVERY pane SVG.
    // Each pane registers its value-pill driver here; the legend fires them all on highlight.
    const pillDrivers: HighlightPillsHandle[] = [];
    const hasFigShape = !!(fig.shapeLegendItems && fig.shapeLegendItems.length);
    const onHighlight = (active: Set<string>): void => {
      for (const d of pillDrivers) d.setActive(active);
      if (life.disposed) return;
      // onLegendSelect: same "however it changed" note as mountChart's identical dispatch —
      // fires on hover/focus/blur too, not only a pin click; high-frequency, debounce-worthy.
      life.notify("tbl-legend-select", { active: [...active] }, opts.onLegendSelect);
    };
    const handle = fig.legendItems || hasFigShape
      ? renderLegend(legendSlot, fig.legendItems ?? [], {
          svg: grid,
          onHighlight,
          hooks: opts.hooks,
          shapeItems: fig.shapeLegendItems ?? undefined,
          colorTitle: fig.colorLegendTitle,
          shapeTitle: fig.shapeLegendTitle,
          state: carried?.state,
          abandoned: life.isDisposed,
        })
      : null;
    if (life.disposed) return; // legendKey tore the mount down
    const dropped = life.adoptLegend(handle, carried);
    // Attach each pane's crosshair ALWAYS (single-series bar panes have no legend but still
    // need tooltips); selection click is gated on `handle` inside wireFigureSvg, and
    // `.is-selectable` is set below from the panes that were actually wired.

    // Coordinated cursor: hovering one pane echoes a secondary cursor on every OTHER pane at the
    // same x. Default on for multi-pane figures; `coordinated_cursor: false` disables. The bus
    // collects each pane's secondary-cursor driver; a pane's primary crosshair emits its resolved
    // x-key, which drives the others (and clears the source's own secondary).
    // Multi-pane figures coordinate cursors across panes. A SINGLE-pane bar/stacked figure (a
    // small_multiples chart whose facet resolves to one value) has nothing to coordinate, but it
    // should still get the in-place shade + bar-end value pill instead of falling back to the
    // legacy floating tooltip — i.e. behave like the standalone bar chart. So enable the same
    // path for a lone bar/stacked pane. Line/area figures keep the tooltip when standalone-like.
    const coordinated =
      sm.coordinated_cursor !== false && (fig.panes.length > 1 || isCategoricalBarFig);
    const drivers: Array<(key: unknown, active?: boolean) => void> = [];
    // Render EVERY pane at the hovered x: the source (hovered) pane gets active styling (heavier
    // labels + the x-axis value above); the rest get passive styling. null clears all.
    const emit = (sourceIdx: number, key: unknown): void => {
      for (let i = 0; i < drivers.length; i++) drivers[i]!(key, i === sourceIdx);
      // Hovering a category surfaces its per-category value pills (coordinated cursor) on every
      // pane; suppress that same category in the series-highlight pills so they don't double up.
      // A non-category key (line figures: a numeric x) or null clears the suppression.
      const cat = typeof key === "string" ? key : null;
      for (const d of pillDrivers) d.setSuppressedCategory(cat);
    };

    fig.panes.forEach((pane, idx) => {
      if (!pane.svg) { drivers.push(() => {}); return; }
      const driver = wireFigureSvg(pane.svg, handle, {
        spec,
        tooltipContainer,
        dataInScope: pane.dataInScope ?? [],
        colors: pane.colors ?? new Map(),
        seriesLabels: fig.seriesLabels,
        seriesOrder: pane.seriesOrder ?? [],
        valueAffixes: pane.valueAffixes ?? fig.valueAffixes,
        tooltipXParse: pane.tooltipXParse,
        tooltipXFormat: pane.tooltipXFormat,
        overlayTooltips: pane.overlayTooltips,
        symbolScale: pane.symbolScale,
        shapeIsSeries: pane.shapeIsSeries,
        pointOrder: pane.pointOrder,
        netMode: pane.netMode,
        symbolSeries: fig.seriesOrder,
        // One shared key for the whole figure, so every pane's tooltip agrees with it. The
        // fallback is per-PANE: per-pane mode resolves each pane's colours independently, and a
        // single-series figure has no legend rows to read at all.
        icons: resolveTooltipIcons({
          legendItems: fig.legendItems,
          keyRows: pane.seriesKeyRows,
        }),
        hooks: opts.hooks,
        facet: pane.value,
        onHover: hoverNotifier,
        ...(coordinated ? { onResolve: (key: unknown) => emit(idx, key) } : {}),
      }, {
        onPillDriver: (d) => pillDrivers.push(d),
        onHoverDetach: (d) => life.addDetach(d),
      });
      drivers.push(driver ?? (() => {}));
    });
    // Not `handle != null`: dot-plot and scatter panes get no click wiring (nor do their standalone
    // charts), so a legend alone would advertise a click that does nothing.
    card.classList.toggle(
      "is-selectable",
      fig.panes.some((pane) => pane.svg != null && CLICK_TO_PIN_SVGS.has(pane.svg)),
    );

    // As mountChart's draw(): the carried state reached the legend without its onHighlight.
    const carriedActive = life.reapplyCarried(carried, handle, (active) => {
      for (const d of pillDrivers) d.setActive(active);
    });

    // onRender: once PER PANE (there is no single wrapping SVG for a figure to report) at the
    // three real re-render occasions — mirrors mountChart's dispatch, gated the same way, INCLUDING
    // the "mount" deferral (mountFigure's own initial draw() call has the identical ResizeObserver/
    // teardown-construction-after-it shape mountChart's does — see that dispatch's comment).
    // Fired here, at the true end of drawGrid — after the legend is (re)built and every pane's
    // crosshair/coordinated-cursor DOM is wired — so every phase (mount/resize/reselect) sees the
    // SAME finished DOM shape mountChart's end-of-draw() dispatch sees. Firing earlier (right after
    // the pane SVGs were appended, before legendSlot.replaceChildren()) meant a synchronous
    // resize/reselect saw the PREVIOUS render's legend, and any DOM a consumer applied here was
    // wiped a few lines later.
    const fireRender = (): void => {
      if (renderPhase) {
        fig.panes.forEach((pane, i) => {
          if (!pane.svg) return;
          if (renderPhase === "mount") {
            // Guarded on `life.disposed`, and RE-READING the pane's live svg by index instead of
            // capturing this render's -- see mountChart's identical dispatch comment for both.
            life.deferMountRender(i, () => opts.onRender);
          } else if (!life.disposed) { // a consumer may tear down from an earlier pane's onRender
            life.notify("tbl-render", { svg: pane.svg, phase: renderPhase }, opts.onRender);
          }
        });
      }
    };

    life.finishRedraw(
      fireRender,
      dropped ? () => onHighlight(carriedActive) : null,
      () => { if (carried?.focus) handle?.focus(carried.focus); },
    );
  };

  const draw = (w: number, phase?: "mount" | "resize" | "reselect"): void => { drawGrid(w, phase); };

  const initialWidth = card.clientWidth || opts.width || 720;
  // On a selection change, re-render the grid so the accent tracks the active option. Reset the
  // width-keyed guard (sig is width-only) so the same-width re-render isn't skipped.
  requestFigureRedraw = () => {
    if (life.disposed) return;
    life.invalidate();
    draw(card.clientWidth || initialWidth, "reselect");
  };
  draw(initialWidth, "mount");

  let resizeRaf: number | null = null;
  let ro: ResizeObserver | undefined;
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => {
      if (resizeRaf !== null) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        // As mountChart's observer: a hidden card (width 0) waits for its first non-zero width.
        const w = card.clientWidth;
        if (w) draw(w, "resize");
      });
    });
    ro.observe(card);
  }

  return () => {
    life.dispose();
    ro?.disconnect();
    if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
    closeTitleSelectors();
  };
}
