// Live-render layer: mounts a fully interactive chart card into a container element and
// wires the pure engine (renderChart) to the DOM-only live primitives (legend, crosshair,
// source line). Scaling is copied from the tracker's createChartController: the chart is
// RE-RENDERED at the container's width (the x-axis compresses; height stays fixed) down to a
// minimum width, below which a horizontal scroll wrapper takes over and a sticky y-axis
// overlay keeps the value labels pinned at the left. No viewBox/CSS scaling.
import type { ChartSpec, TitleSelector } from "../spec/types.js";
import { resolveColumns } from "../spec/columns.js";
import {
  parseTitleTokens,
  resolveActiveOptionColor,
  resolveSelections,
  resolveTitleText,
} from "../spec/title.js";
import type { TidyRow } from "../data/index.js";
import type { LegendItem } from "./index.js";
import type { PreparedRow } from "./marks/index.js";
import { pointDodgeOffsets } from "./marks/point.js";
import type { FigureRenderResult } from "./figure.js";
import { renderChart } from "./index.js";
import { waterfallValueDecimals } from "./scales.js";
import { renderFigure, horizontalBarChartHeight, figurePaneHeight } from "./figure.js";
import { FACETED_CAT_LABEL_PX } from "./axes.js";
import { renderLegend } from "./legend.js";
import type { LegendHandle } from "./legend.js";
import { resolveColor } from "./palette.js";
import {
  attachCrosshair,
  attachBandCrosshair,
  attachHistogramHover,
  attachSecondaryLineCursor,
  attachSecondaryBandCursor,
  attachCategoricalLineCrosshair,
  attachSecondaryCategoricalLineCursor,
  attachPointHover,
  attachHighlightPills,
} from "./crosshair.js";
import type { HighlightPillsHandle } from "./crosshair.js";
import { renderSourceLine } from "./source-line.js";
import { rowsToCsvBrowser } from "../data/csv-browser.js";
import { LOGO_SVG } from "../embed/assets.js";
import { exportChartPng } from "../embed/export-png.js";
import { TBL, markerSymbolForIndex } from "./theme.js";
import { TOTAL_SERIES_KEY } from "./series-keys.js";

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
}

// Below this width the chart stops shrinking and the scroll wrapper takes over (matches the
// tracker's mobile/stacked-header breakpoint). Height is held constant as the width changes.
const MIN_CHART_WIDTH = 390;
const FIXED_CHART_HEIGHT = 400;

/** Compute the live-mount height for a chart. Horizontal bars scale with the number of category
 *  band slots (grouped → nSeries bars per category; stacked/single → one), plus section spacer
 *  slots and taller rows for wrapped labels — via the shared engine helper `horizontalBarChartHeight`,
 *  so the single-chart and faceted-figure heights agree. Vertical / non-bar charts return the
 *  fixed default; the helper floors short horizontals at it too. */
export function computeChartHeight(spec: ChartSpec, rows: TidyRow[]): number {
  if (spec.orientation !== "horizontal" || (spec.chartType !== "bar" && spec.chartType !== "stacked")) {
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
const LEGEND_COLUMN_WIDTH = 160;
const LEGEND_GAP = 16;

// When the card is too narrow to fit both the chart floor and the legend column, fall back to
// the top legend so the chart remains usable.
const LEGEND_RIGHT_MIN_CARD_WIDTH = MIN_CHART_WIDTH + LEGEND_COLUMN_WIDTH + LEGEND_GAP;

/**
 * Resolve the effective legend position for this chart.
 *
 * Rule (per Style-Guide §8.2/§8.3):
 *   - Explicit `spec.legendPosition` always wins.
 *   - Otherwise: "right" when chartType === "stacked" AND (seriesCount >= 5 OR the chart is
 *     diverging — any row with _y < 0); "top" otherwise.
 *
 * The fallback to "top" when the card is too narrow is enforced in mountChart (not here),
 * after the card width is known.
 */
function resolveLegendPosition(
  spec: ChartSpec,
  seriesCount: number,
  rows: TidyRow[],
): "top" | "right" {
  // `legend: false` suppresses the legend entirely (buildLegendItems returns null), so no
  // right column must ever be reserved — treat the layout as top (whose slot stays empty and
  // takes no space) regardless of an explicit legendPosition or the stacked defaults below.
  if (spec.legend === false) return "top";
  if (spec.legendPosition === "top" || spec.legendPosition === "right") {
    return spec.legendPosition;
  }
  if (spec.chartType === "stacked") {
    if (seriesCount >= 5) return "right";
    // Diverging: any row with a negative value.
    const valueCol = resolveColumns(spec, rows).value;
    const isDiverging = rows.some((r) => {
      const v = typeof r._y === "number" ? r._y : Number(r[valueCol]);
      return Number.isFinite(v) && v < 0;
    });
    if (isDiverging) return "right";
  }
  return "top";
}

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
function resolveSeriesAtPoint(svgEl: SVGSVGElement, evt: MouseEvent): string | null {
  const doc = svgEl.ownerDocument as Document & {
    elementsFromPoint?: (x: number, y: number) => Element[];
  };
  if (typeof doc.elementsFromPoint !== "function") return null;
  const stack = doc.elementsFromPoint(evt.clientX, evt.clientY);
  for (const el of stack) {
    const series = el.getAttribute?.("data-series");
    if (series) return series;
    if (el === svgEl) break; // don't search past the chart's own SVG
  }
  return null;
}

/**
 * Add transparent FAT "hit" paths for a LINE chart so clicking ON or NEAR a thin line
 * resolves that line's series. The visible lines are ~2px strokes that
 * `document.elementsFromPoint` almost never lands on; these clones are invisible but
 * carry a ~14px stroke with `pointer-events: stroke`, so the cursor is hit-tested
 * within ~7px of the line.
 *
 * Z-order: the crosshair appends its `.tbl-crosshair-hit` overlay LAST
 * (pointer-events:all, topmost) so hover works. We insert each hit-path BELOW that
 * overlay (before the first `.tbl-crosshair-hit`). The click handler resolves the series
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
  const overlay = svgEl.querySelector(".tbl-crosshair-hit, .tbl-facet-crosshair-hit");
  const linePaths = Array.from(
    svgEl.querySelectorAll<SVGPathElement>('g[aria-label="line"] path[data-series]'),
  );
  for (const path of linePaths) {
    const series = path.getAttribute("data-series");
    const d = path.getAttribute("d");
    if (!series || !d) continue;
    const hit = svgEl.ownerDocument.createElementNS(NS, "path");
    hit.classList.add("tbl-line-hitpath");
    hit.setAttribute("data-series", series);
    hit.setAttribute("d", d);
    hit.setAttribute("fill", "none");
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

// Net-total label legibility over dimmed bars.
// The diverging net label (tbl-net-label) is white over a full-color segment. When the
// segment behind it is dimmed (near-white), white text is illegible — so each label adapts
// its color to the segment DIRECTLY behind it: dark when that segment is dimmed (or there is
// no segment behind, i.e. the white background), white when the segment is active.
const NET_LABEL_WHITE = "#FFFFFF";

/**
 * Pure color decision for a net-total label. Factored out for unit testing (jsdom has no
 * layout, so the geometry-based behind-detection can't be exercised there).
 *   - behind segment dimmed  → dark  (legible over the near-white dimmed bar)
 *   - no segment behind it   → dark  (white would be invisible on the white background)
 *   - behind segment active  → white (the existing default over a full-color segment)
 */
export function netLabelFill(behindDimmed: boolean, hasBehind: boolean): string {
  return !hasBehind || behindDimmed ? TBL.color.heading : NET_LABEL_WHITE;
}

/**
 * Recolor every net-total label from the CURRENT dim state. Detection of the behind-series
 * is computed LIVE on each call (not cached), so geometry is always fresh even when the chart
 * first rendered off-screen or with zero geometry. We compare in SCREEN coordinates
 * (getBoundingClientRect): segment rects bake geometry into x/y attributes, but net-label
 * text marks are positioned by a transform, so only the post-layout client rect places both
 * in the same frame. A label's behind-series is the first non-Total segment rect whose
 * [left,right] × [top,bottom] contains the label's center — skipping zero-size rects (a
 * value=0 segment renders as zero-height; inclusive containment with y0===y1 can spuriously
 * match). No-op when there are no net labels (anything but a diverging/dot-mode stacked chart)
 * or in non-layout environments (jsdom: client rects are all zero → label box is zero → skip).
 * Called once after wiring (initial state) and on every highlight change via the legend's
 * onHighlight hook (which fires AFTER applyHighlight toggles the classes, so the read is fresh).
 * In the initial nothing-pinned state no segment is dimmed → all labels stay white regardless
 * of detection.
 */
function recolorNetLabels(svg: SVGSVGElement): void {
  const labels = svg.querySelectorAll<SVGTextElement>(
    `g.tbl-net-label text[data-series="${TOTAL_SERIES_KEY}"]`,
  );
  if (!labels.length) return;

  // Precompute extents for all non-Total segment rects, skipping zero-size ones.
  const extents = Array.from(
    svg.querySelectorAll<SVGRectElement>(
      `rect[data-series]:not([data-series="${TOTAL_SERIES_KEY}"])`,
    ),
  ).flatMap((rect) => {
    const b = rect.getBoundingClientRect();
    // Skip zero-size rects: a value=0 segment renders as a zero-height rect; inclusive
    // containment (cy>=y0 && cy<=y1) with y0===y1 can spuriously match a degenerate center.
    if (!(b.width > 0 && b.height > 0)) return [];
    return [{
      series: rect.getAttribute("data-series") ?? "",
      x0: b.left,
      x1: b.right,
      y0: b.top,
      y1: b.bottom,
    }];
  });

  labels.forEach((label) => {
    const b = label.getBoundingClientRect();
    let behind = "";
    // Degenerate (zero-size) label box → no real layout (e.g. jsdom); skip hit-test and fall
    // through to the dark default (both dimensions must be positive).
    if (b.width > 0 && b.height > 0) {
      const cx = b.left + b.width / 2;
      const cy = b.top + b.height / 2;
      for (const e of extents) {
        if (cx >= e.x0 && cx <= e.x1 && cy >= e.y0 && cy <= e.y1) {
          behind = e.series;
          break;
        }
      }
    }
    const hasBehind = behind !== "";
    let behindDimmed = false;
    if (hasBehind) {
      const rect = svg.querySelector<SVGRectElement>(
        `rect[data-series="${cssAttrEscape(behind)}"]`,
      );
      behindDimmed = rect?.classList.contains("tbl-dimmed") ?? false;
    }
    // Use inline style so a future CSS fill rule on .tbl-net-label text can't override.
    label.style.fill = netLabelFill(behindDimmed, hasBehind);
  });
}

/** Minimal escaping for a data-series value used inside an attribute selector. Series names
 *  are author-supplied; escape quotes/backslashes so the selector stays valid. */
function cssAttrEscape(value: string): string {
  return value.replace(/(["\\])/g, "\\$1");
}


/** Format a numeric value for tooltip display. `decimals` (default 2) lets a tooltip be more
 *  precise than the axis — e.g. 4 for small magnitudes that round to 0.00 on a 2-decimal axis. */
export function formatValue(v: number, units: string, decimals = 2): string {
  if (!Number.isFinite(v)) return "—";
  return `${v.toFixed(decimals)}${units}`;
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
      const csv = rowsToCsvBrowser(rows);
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
      await exportChartPng(spec, rows, { filename: `${base}.png`, selections });
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
 * Card structure (right-legend variant — stacked ≥5 series or explicit legendPosition:"right"):
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

// Bar charts facet their category band whenever bar.ts puts it on fx (vertical grouped) or fy
// (horizontal grouped, OR horizontal sectioned — any series count, since Task 16 unified single-
// and multi-series sectioned bars onto one fy topology; see bar.ts). The category-band crosshair
// (attachBandCrosshair) reads rect geometry differently in each case: faceted charts wrap each
// category in its own translated `<g>` (readCategoryBands/H's `isFaceted` branch); unfaceted charts
// read raw rect x/y directly. Passing the wrong branch reads a facet-LOCAL coordinate as if it were
// absolute, misresolving every hover past the first facet.
function isBarCategoryFaceted(spec: ChartSpec, rows: PreparedRow[], seriesCount: number): boolean {
  if (spec.chartType !== "bar") return false;
  if (seriesCount > 1) return true;
  return spec.orientation === "horizontal" && rows.some((r) => r._section != null);
}

// Sectioned horizontal bars render categories grouped by section (bar.ts's `bandDomain`), so the
// bands' rendered VISUAL (fy facet) order can differ from data-encounter order. The category-band
// crosshair maps facet rows -> categories BY INDEX, so callers must reorder their category list to
// match before passing it in. Stable sort keeps within-section order. No-op (returns `cats`
// unchanged, same array reference) when the chart has no section column.
function sectionOrderedCategories(spec: ChartSpec, rows: PreparedRow[], cats: string[]): string[] {
  const sectionCol = spec.columns?.section;
  if (!sectionCol) return cats;
  const sectionOf = new Map<string, string>();
  for (const r of rows) {
    if (r._xc && r._section != null && !sectionOf.has(r._xc)) sectionOf.set(r._xc, r._section);
  }
  const secOrder =
    spec.section_order && spec.section_order.length
      ? spec.section_order
      : [...new Set(cats.map((c) => sectionOf.get(c) ?? ""))];
  const rankOf = (c: string): number => {
    const i = secOrder.indexOf(sectionOf.get(c) ?? "");
    return i < 0 ? secOrder.length : i;
  };
  return [...cats].sort((a, b) => rankOf(a) - rankOf(b));
}

export function mountChart(container: HTMLElement, opts: MountOptions): () => void {
  // Small-multiples figures take a separate mount path (shared faceted SVG, or a responsive
  // per-pane grid) so the heavily-tuned single-chart controller below stays untouched.
  if (opts.spec.small_multiples) return mountFigure(container, opts);

  const { spec, rows, width: initialWidth } = opts;
  // Explicit height (callers / golden path) wins; otherwise horizontal bars grow taller
  // with the bar/row count and everything else uses the fixed default.
  const height = opts.height ?? computeChartHeight(spec, rows);
  const doc = container.ownerDocument;

  const card = doc.createElement("div");
  card.className = `figure-card chart-${spec.chartType}`;

  // Inline title selectors: the mount owns ONE selections object for its whole life. The
  // header's widget change handler mutates it in place, so the PNG download (below) and any
  // later reads see the live state; the header itself is built once and never rebuilt by the
  // resize draw() loop, so the control + its state survive the engine's own re-renders.
  const selections = resolveSelections(spec, opts.selections);

  // Color accent feed (AILMT parity — charts.js L556-562): a single-series chart driven by a
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
    actions: buildDownloadActions(doc, spec, rows, opts.downloadName, selections),
  });

  container.appendChild(card);

  // --- chart controller: re-render at the container width on resize ---
  let lastWidth = -1;
  let currentOverlay: OverlayEl | null = null;
  let xTitleAdded = false;
  // Right-legend slot — created lazily when the right-legend layout is activated.
  let rightLegendSlot: HTMLElement | null = null;
  // Track the current effective legendPosition so we can rebuild layout on first call.
  let currentLegendPos: "top" | "right" | null = null;

  // Area click-to-restack: the live visual stack order (selected series to the bottom, in click
  // order), the latest legend handle + full series list, and a re-entrancy guard so re-applying
  // pins after a rebuild doesn't recurse. Non-area charts never touch any of this.
  let restackOrder: string[] | undefined;
  let suppressRestack = false;
  let currentLegendHandle: LegendHandle | null = null;
  let currentSeriesNames: string[] = [];

  /**
   * Order legendItems for the right-legend column to match the VISUAL top→bottom stack:
   *   - When the engine supplies `legendVisualOrder` (stacked charts), series rows follow
   *     that order ([positives reversed] ++ [negatives in declaration order]).
   *   - Otherwise fall back to REVERSED declaration order (top-of-stack first).
   *   - extra rows (e.g. the interactive Total pseudo-series) are appended at the END in
   *     original relative order.
   */
  function orderForRightLegend(items: LegendItem[], visualOrder?: string[]): LegendItem[] {
    const series = items.filter((i) => !i.nonInteractive && !i.isExtra);
    const extras = items.filter((i) => i.nonInteractive || i.isExtra);
    let orderedSeries: LegendItem[];
    if (visualOrder && visualOrder.length) {
      const bySeries = new Map(series.map((i) => [i.series, i]));
      orderedSeries = visualOrder
        .map((s) => bySeries.get(s))
        .filter((i): i is LegendItem => i != null);
      // Append any series not named in visualOrder (defensive), preserving their order.
      for (const i of series) if (!visualOrder.includes(i.series)) orderedSeries.push(i);
    } else {
      orderedSeries = [...series].reverse();
    }
    return [...orderedSeries, ...extras];
  }

  const draw = (outerWidth: number, legendPos: "top" | "right"): void => {
    // For right-legend, the chart width is computed from the OUTER card width (stable),
    // not from canvasScroll (which would shrink as the legend takes space → feedback loop).
    const chartAvail = legendPos === "right"
      ? outerWidth - LEGEND_COLUMN_WIDTH - LEGEND_GAP
      : outerWidth;
    const target = Math.max(MIN_CHART_WIDTH, Math.round(chartAvail));
    if (target === lastWidth && legendPos === currentLegendPos) return;
    lastWidth = target;

    // Color accent feed (AILMT parity): resolve the active title-selector option's color (raw
    // ColorRef → engine/palette.resolveColor), fresh on every draw() so a selection change picks
    // it up immediately. renderChart only applies it when the chart resolves to exactly one
    // series (engine/index.ts) — a multi-series chart's palette/series_colors stay untouched.
    const rawAccent = spec.title_selectors
      ? resolveActiveOptionColor(spec.title_selectors, selections, spec.series_colors)
      : undefined;
    const accentColor = rawAccent ? resolveColor(rawAccent) : undefined;

    let built;
    try {
      built = renderChart(spec, rows, {
        width: target,
        height,
        ...(restackOrder ? { stackOrder: restackOrder } : {}),
        ...(accentColor ? { accentColor } : {}),
      });
    } catch (e) {
      canvas.innerHTML = `<div class="figure-error">${(e as Error).message}</div>`;
      return;
    }
    const {
      svg, legendItems, seriesLabels, seriesOrder, dashedNames, colors, units,
      xAxisTitle, dataInScope, tooltipXParse, tooltipXFormat, legendVisualOrder, showTotalDot,
      shapeLegendItems, colorLegendTitle, shapeLegendTitle,
    } = built;
    // Legend-highlight value pills: attached after the crosshair below, but the legend's
    // onHighlight closure (set when the legend is created) calls through this holder, so the
    // pill renderer just needs to exist by the time the user interacts.
    currentSeriesNames = seriesOrder;
    let pillDriver: ReturnType<typeof attachHighlightPills> | null = null;
    const onHighlight = (active: Set<string>): void => {
      recolorNetLabels(svg);
      pillDriver?.setActive(active);
      // Area click-to-restack: pinned series move to the BOTTOM of the stack (in click order) so a
      // user can read them against zero; unpinning restores the default order. Driven off PINS
      // (not hover), so this only fires on an actual selection change. Re-renders the whole chart
      // via draw() and re-applies the pins to the freshly built legend.
      if (spec.chartType === "area" && !suppressRestack) {
        const pins = currentLegendHandle?.pinnedSeries() ?? [];
        const next = pins.length
          ? [...pins, ...currentSeriesNames.filter((s) => !pins.includes(s))]
          : undefined;
        if (JSON.stringify(next) !== JSON.stringify(restackOrder)) {
          // Capture the current bands' geometry so the re-rendered ones can morph from it.
          const oldDs = captureAreaDs(svg);
          restackOrder = next;
          suppressRestack = true;
          lastWidth = -1; // force draw() past its same-width early return
          draw(card.clientWidth || target, currentLegendPos ?? legendPos);
          if (currentLegendHandle) for (const s of pins) currentLegendHandle.toggle(s);
          suppressRestack = false;
          // Brief morph: the stacked total is order-invariant, so only the band paths' `d` change.
          const newSvg = canvas.querySelector("svg");
          if (newSvg) animateAreaRestack(newSvg, oldDs);
        }
      }
    };
    // Point charts (scatter / dotplot): no crosshair / click-to-select in v1 — just markers +
    // legend (the color legend still drives hover-dim, which is independent of the crosshair).
    const isPoint = spec.chartType === "scatter" || spec.chartType === "dotplot";

    // Native px — no makeResponsive/viewBox: the SVG keeps its exact pixel width so it
    // overflows into the scroll wrapper below the floor instead of being CSS-scaled down.
    canvas.replaceChildren(svg);

    if (!xTitleAdded) { appendXAxisTitle(canvasScroll, xAxisTitle); xTitleAdded = true; }

    // --- Legend layout ---
    const shapeOpts = {
      shapeItems: shapeLegendItems ?? undefined,
      colorTitle: colorLegendTitle,
      shapeTitle: shapeLegendTitle,
    };
    let legendHandle: LegendHandle | null = null;
    if (legendItems || (shapeLegendItems && shapeLegendItems.length)) {
      if (legendPos === "right") {
        // Activate the right-legend layout on first use (or if switching from top).
        if (currentLegendPos !== "right") {
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
          ...shapeOpts,
        });
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
          ...shapeOpts,
        });
      }
    }

    // Expose the freshly built legend handle for the area-restack re-render path (onHighlight).
    currentLegendHandle = legendHandle;

    // Set the initial label colors from the current (un-dimmed) state. No-op unless this is a
    // diverging/dot-mode stacked chart (the only case with tbl-net-label elements). Detection
    // of the behind-series is computed live inside recolorNetLabels on each call.
    recolorNetLabels(svg);

    currentLegendPos = legendPos;

    if (spec.chartType === "scatter") {
      // Scatter: per-point hover (no shared-x guide — points aren't aligned on x). Markers render
      // as <path> when a shape channel is active, else <circle>; tag order == dataInScope order.
      const pointHasShape = !!spec.columns?.shape;
      const showShape = !!(shapeLegendItems && shapeLegendItems.length);
      // shape value → its marker symbol (from the shape legend), so the tooltip header marker
      // matches the chart point.
      const symbols = new Map((shapeLegendItems ?? []).map((s) => [s.shape, s.markerSymbol] as const));
      attachPointHover(svg, {
        points: dataInScope.map((r) => ({ series: r.series, shape: r._shape, x: r._xn ?? 0, y: r._y })),
        selector: pointHasShape ? 'g[aria-label="dot"] path' : 'g[aria-label="dot"] circle',
        colors,
        seriesLabels,
        shapeLabels: spec.shape_labels,
        showShape,
        symbols,
        xLabel: spec.x_axis_title ?? "x",
        yLabel: spec.y_axis_title ?? "Value",
        xFormat: (v) => v.toLocaleString(undefined, { maximumFractionDigits: 2 }),
        yFormat: (v) => formatValue(v, units, spec.tooltip_decimals),
      });
    } else if (spec.chartType === "dotplot") {
      // Dot plot: category hover (resolve the category from the x-axis labels; list each series'
      // value). Reuses the categorical-line crosshair — no bars required.
      attachCategoricalLineCrosshair(svg, {
        rows: dataInScope.map((r) => ({ _xc: r._xc, series: r.series, _y: r._y })),
        colors,
        seriesLabels,
        seriesOrder,
        yFormat: (v) => formatValue(v, units, spec.tooltip_decimals),
        bandHighlight: true,
        centersFromMarks: true,
      });
      pillDriver = attachHighlightPills(svg, {
        rows: dataInScope.map((r) => ({ _xc: r._xc, series: r.series, _y: r._y })),
        chartType: "dotplot",
        colors,
        seriesOrder,
        yFormat: (v) => formatValue(v, units, spec.tooltip_decimals),
        dodge: seriesOrder.length > 1 ? pointDodgeOffsets(seriesOrder, false) : undefined,
      });
    } else if (spec.xAxisType === "categorical" && spec.chartType === "line") {
      // Categorical-x LINE: resolve the category from the x-axis labels (no bars) and show a
      // guide + tooltip.
      attachCategoricalLineCrosshair(svg, {
        rows: dataInScope.map((r) => ({ _xc: r._xc, series: r.series, _y: r._y })),
        colors,
        seriesLabels,
        seriesOrder,
        yFormat: (v) => formatValue(v, units, spec.tooltip_decimals),
      });
    } else if (spec.xAxisType === "categorical") {
      // Determine if this is a stacked chart (needs Total row) and if it uses a faceted category
      // band (xScaleField === "fx" for vertical grouped, or `fy` for horizontal grouped/sectioned
      // — see bar.ts / isBarCategoryFaceted above).
      const isStacked = spec.chartType === "stacked";
      const isFaceted = isBarCategoryFaceted(spec, dataInScope, seriesOrder.length);
      // Waterfall: `delta` steps get a signed value pill CENTERED in the bar on hover; `total`/`skip`
      // steps shade only (their value is the always-on running-total label). deltaCats drives that
      // (empty for non-waterfall charts). `skip` steps render a zero-height rect in the builder, so
      // every category still has a rect and the rect-index→category mapping stays 1:1.
      const waterfallCursor =
        spec.chartType === "waterfall"
          ? {
              deltaCats: new Set(
                dataInScope
                  .filter((r) => {
                    const k = ((r._kind as string | undefined) ?? "").trim();
                    return k !== "total" && k !== "skip";
                  })
                  .map((r) => r._xc as string),
              ),
            }
          : undefined;
      // Derive the ordered category list from the data rows (declaration order).
      const catsSeen = new Set<string>();
      const cats: string[] = [];
      for (const r of dataInScope) {
        const cat = r._xc;
        if (cat && !catsSeen.has(cat)) { catsSeen.add(cat); cats.push(cat); }
      }
      const orderedCats = sectionOrderedCategories(spec, dataInScope, cats);
      const bandRows = dataInScope.map((r) => ({ _xc: r._xc, series: r.series, _y: r._y }));
      const horizontalBar = spec.orientation === "horizontal";
      // Waterfall: the hover delta uses the SAME precision as the always-on running-total labels
      // (valueLabels.decimals, else the min the data needs) so the two never disagree.
      const wfDecimals =
        spec.chartType === "waterfall"
          ? waterfallValueDecimals(dataInScope, spec.valueLabels?.decimals)
          : undefined;
      const bandYFormat = (v: number): string =>
        formatValue(v, units, wfDecimals ?? spec.tooltip_decimals);

      // Task 17: standalone bar/stacked charts now drive the SAME coordinated-cursor primitive
      // faceted panes use (attachSecondaryBandCursor) — full-band hover (horizontal: into the left
      // label gutter; vertical: stopping at the baseline, matching faceted), a uniform highlight
      // height across section spacers, a bolded hovered label (horizontal) / frosted category pill
      // (vertical), and a bar-end value pill — instead of the old tooltip. `attachBandCrosshair` runs
      // hit-test-only (emitOnly), and a locally-captured driver plays the SAME role the figure bus
      // plays for faceted panes, minus the bus. Attach order mirrors wireFigureSvg (crosshair →
      // highlightPills → secondaryBandCursor) so `.tbl-coord` paints above the bars.
      // Total-dot stacks hover with the floating band tooltip (with its dot-swatch Total row),
      // NOT the per-segment value pills — the net is what matters and pills can't show it. Every
      // other bar/stacked chart keeps the coordinated-cursor pills (task 17). Legend-highlight
      // pills stay in BOTH modes (a legend gesture, independent of band hover).
      const useTooltip = showTotalDot === true;
      let secondaryDriver: ((key: unknown, active?: boolean) => void) | null = null;
      attachBandCrosshair(svg, {
        rows: bandRows,
        isStacked,
        showTotalDot,
        isFaceted,
        categories: orderedCats,
        colors,
        seriesLabels,
        seriesOrder,
        yFormat: bandYFormat,
        categoryLabels: spec.x_labels,
        swatchShape: "rect",
        orientation: horizontalBar ? "horizontal" : "vertical",
        ...(useTooltip
          ? {}
          : {
              emitOnly: true,
              onResolve: (cat: string | null) => {
                pillDriver?.setSuppressedCategory(cat);
                secondaryDriver?.(cat, true);
              },
            }),
      });
      pillDriver = attachHighlightPills(svg, {
        rows: bandRows,
        chartType: isStacked ? "stacked" : "bar",
        isStacked,
        isFaceted,
        categories: orderedCats,
        colors,
        seriesOrder,
        yFormat: bandYFormat,
        horizontal: horizontalBar,
        showTotalDot,
      });
      if (!useTooltip) {
        secondaryDriver = attachSecondaryBandCursor(svg, {
          rows: bandRows,
          isStacked,
          isFaceted,
          categories: orderedCats,
          colors,
          seriesLabels,
          seriesOrder,
          yFormat: bandYFormat,
          horizontal: horizontalBar,
          // Horizontal: shade into the left label gutter + bold the hovered row label (no pill).
          // Vertical: shade stops at the baseline (matching faceted vertical); the x-axis category
          // name gets its own frosted pill from attachSecondaryBandCursor's addCoordCategoryHighlight.
          ...(horizontalBar
            ? { regionFromLeftEdge: true, accentLabel: { font: FACETED_CAT_LABEL_PX } }
            : {}),
          ...(waterfallCursor ? { waterfall: waterfallCursor } : {}),
        }) as (key: unknown, active?: boolean) => void;
      }
    } else if (spec.chartType === "histogram") {
      // Histogram: continuous numeric/temporal x, but BINNED bars — resolve the bin under the
      // cursor by x-extent (not a snapped point) and show a per-bin tooltip headed by the bin range.
      attachHistogramHover(svg, {
        rows: dataInScope.map((r) => ({ _x0: r._x0, _x1: r._x1, series: r.series, _y: r._y })),
        colors,
        seriesLabels,
        seriesOrder,
        yFormat: (v) => formatValue(v, units, spec.tooltip_decimals),
        // Temporal: use the date formatter. Numeric: omit so attachHistogramHover's rounding
        // default formats the bin edges (raw tooltipXFormat would print float-accumulation noise).
        xFormat: spec.xAxisType === "temporal" ? tooltipXFormat : undefined,
      });
    } else {
      attachCrosshair(svg, {
        rows: dataInScope.map((r) => ({ time: r.time, series: r.series, value: r._y })),
        xField: "time",
        yField: "value",
        seriesField: "series",
        xParse: tooltipXParse as ((v: unknown) => number) | undefined,
        xFormat: tooltipXFormat,
        yFormat: (v) => formatValue(v, units, spec.tooltip_decimals),
        colors,
        dashedSeries: dashedNames,
        seriesLabels,
        seriesOrder,
        // Stacked area: the cumulative stack height is the meaningful aggregate — show a Total row.
        showTotal: spec.chartType === "area",
      });
    }

    currentOverlay?._ro?.disconnect();
    currentOverlay?.remove();
    currentOverlay = attachYAxisOverlay(canvasScroll, svg);

    // --- Two-way selection: clicking a bar/segment/line PINS that series via the legend
    // handle (single source of truth). Only wire when an interactive legend exists; a
    // single-series no-legend chart has nothing to select. The crosshair attaches a
    // TRANSPARENT full-SVG hit rect on top of the marks (pointer-events:all), so a plain
    // click lands on that overlay, not the bar — hit-test THROUGH it with
    // elementsFromPoint and find the first [data-series] mark beneath the cursor.
    if (legendHandle && !isPoint) {
      const handle = legendHandle; // capture the non-null value for the click closure
      card.classList.add("is-selectable");
      // Line charts: the visible lines are thin ~2px strokes that elementsFromPoint rarely
      // hits. Add transparent fat hit-paths (per series, below the crosshair overlay) so
      // clicking ON or NEAR a line resolves its series. Gated to the continuous-x (line)
      // case; bars resolve directly off the rect geometry and don't need this.
      if (spec.xAxisType !== "categorical") {
        addLineHitPaths(svg);
      }
      // The crosshair sets the hit overlay's cursor inline (crosshair/default), which would
      // win over the .is-selectable CSS rule. Override it to `pointer` so the click
      // affordance shows across the whole plot when selection is on.
      svg.querySelectorAll<SVGElement>(".tbl-crosshair-hit, .tbl-band-crosshair-hit")
        .forEach((el) => { el.style.cursor = "pointer"; });
      svg.addEventListener("click", (evt) => {
        const series = resolveSeriesAtPoint(svg, evt as MouseEvent);
        if (series) handle.toggle(series);
      });
    } else {
      card.classList.remove("is-selectable");
    }
  };

  // Initial draw: we don't know the series count yet, so render first to get legendItems,
  // then resolve legendPosition from the result. Use initialWidth or a fallback for the
  // very first render (before the ResizeObserver fires).
  const initialCardWidth = card.clientWidth || initialWidth || 720;
  // Quick pre-render to detect series count (width doesn't matter for position resolution).
  let prelimSeriesCount = 1;
  try {
    const prelim = renderChart(spec, rows, { width: initialCardWidth, height });
    prelimSeriesCount = (prelim.legendItems ?? []).filter((i) => !i.nonInteractive && !i.isExtra).length;
  } catch {
    // Ignore — draw() will surface the error.
  }
  // Fall back to top if the card is too narrow for the right-legend column.
  const resolvedPos = (): "top" | "right" => {
    const pos = resolveLegendPosition(spec, prelimSeriesCount, rows);
    if (pos === "right" && (card.clientWidth || initialWidth || 720) < LEGEND_RIGHT_MIN_CARD_WIDTH) {
      return "top";
    }
    return pos;
  };

  draw(initialCardWidth, resolvedPos());

  // Wire the accent-redraw hook (see its declaration above): a title-selector change forces
  // draw() past its same-width/same-legendPos early return, mirroring the area click-to-restack
  // pattern (`lastWidth = -1` then a fresh draw() call at the current width/legendPos).
  requestAccentRedraw = () => {
    lastWidth = -1;
    draw(card.clientWidth || initialCardWidth, currentLegendPos ?? resolvedPos());
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
        const pos = resolveLegendPosition(spec, prelimSeriesCount, rows);
        const effectivePos: "top" | "right" =
          pos === "right" && cardW < LEGEND_RIGHT_MIN_CARD_WIDTH ? "top" : pos;
        draw(cardW, effectivePos);
      });
    });
    ro.observe(card);
  }

  return () => {
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
// Minimum DATA width per pane for faceted horizontal bars (the shared category gutter is
// reserved separately — see HBAR_GUTTER_RESERVE). Matches the vertical PANE_MIN_WIDTH: a
// horizontal pane reads fine at this width, and the earlier 300px premium forced a natural
// figure width (2×300 + gutter) that overflowed a normal content column, so faceted horizontal
// charts scrolled horizontally even at wide viewports.
const HBAR_PANE_MIN_WIDTH = 240;
// Width reserved (once) for the shared category-label gutter on the leftmost horizontal pane
// when computing the no-stack natural width.
const HBAR_GUTTER_RESERVE = 200;
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
   *  adopts the newly-active option's color (AILMT parity; see engine/index.ts
   *  RenderOptions.accentColor). mountFigure (small multiples) omits this: the label still
   *  tints, but the per-pane grid isn't re-rendered — each pane is one facet's chart body, not a
   *  single accent target, and this port does not touch figure.ts. */
  afterChange?: () => void;
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
  const cleanups: Array<() => void> = [];
  const { selectors, selections, onSelect, seriesColors, afterChange } = wiring;
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
      color: opt.color ?? seriesColors?.[opt.label ?? opt.id],
    }));
    // The mounts always pass a resolveSelections() map (every key populated), so the fallback is
    // defensive only — buildFigureHeader is exported, and an external caller could hand-roll an
    // incomplete wiring.selections.
    const initialActiveId = selections[key] ?? selector.options[0]?.id ?? "";
    const { el, destroy } = buildInlineSelect(doc, items, initialActiveId, (value) => {
      selections[key] = value;
      onSelect?.({ id: key, value });
      card.dispatchEvent(
        new CustomEvent("tbl-title-select", { detail: { id: key, value }, bubbles: true }),
      );
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

/** Wire the crosshair + two-way selection onto one figure SVG (shared combined SVG or a
 *  per-pane mini-SVG). Dispatches the crosshair by `spec.xAxisType`:
 *   - continuous (line): `attachCrosshair` + the fat line hit-paths (thin strokes are hard to
 *     hit), and `resolveSeriesAtPoint` for clicks.
 *   - categorical (bar/stacked panes): `attachBandCrosshair` (mirrors mountChart's categorical
 *     branch — `isStacked`/`isFaceted`/`showTotalDot`/`categories`/`orientation`); bar rects
 *     carry `data-series`, so clicks resolve directly with no fat hit-paths.
 *  Both modes support all chart types, so the band branch is reached for any categorical pane.
 *  When `ctx.onResolve` is set (coordinated cursor), the primary crosshair emits its resolved
 *  x-key and a secondary-cursor driver is attached + returned for the figure-level bus.
 *  `dataInScope`/tooltip/bar-metadata come from the pane (or figure) metadata. */
function wireFigureSvg(
  svg: SVGSVGElement,
  handle: LegendHandle | null,
  ctx: {
    spec: ChartSpec;
    dataInScope: PreparedRow[];
    colors: Map<string, string>;
    dashedNames: Set<string>;
    seriesLabels: Record<string, string>;
    seriesOrder: string[];
    units: string;
    tooltipXParse?: (v: string) => number;
    tooltipXFormat?: (v: number) => string;
    showTotalDot?: boolean;
    /** Coordinated cursor: when set, this pane's crosshair emits its resolved x-key here, and a
     *  coordinated-cursor driver is attached + returned so the figure bus can render every pane. */
    onResolve?: (key: unknown) => void;
    /** Legend-highlight pills: when set, the pane's value-pill handle is registered here so the
     *  figure-level legend can fire every pane's pills on highlight, and the coordinated cursor
     *  can suppress the hovered category's pills. */
    onPillDriver?: (handle: HighlightPillsHandle) => void;
    /** Horizontal coordinated cursor: extend the shaded row this many px past the plot's right edge
     *  to bridge the inter-pane gap (so the highlight reads as one continuous row). */
    coordExtendRight?: number;
    /** Horizontal coordinated cursor: this pane shows the category labels (leftmost), so accent the
     *  hovered category's label on hover. */
    coordAccentLabel?: boolean;
  },
): ((key: unknown, active?: boolean) => void) | undefined {
  // Dot-plot panes behave like the other faceted charts: a coordinated category cursor. Hovering
  // a category shades that band + shows per-series value pills on EVERY pane (and highlights the
  // category on the hovered pane). Mirrors the bar/line coordinated path; resolves the category
  // from axis-label centers (points have no rects). The marker dots take each series' symbol.
  if (ctx.spec.chartType === "dotplot") {
    const dotUseCoord = ctx.onResolve != null;
    const symbols = new Map(ctx.seriesOrder.map((s, i) => [s, markerSymbolForIndex(i)] as const));
    // Multi-series dot plots dodge horizontally; the coordinated dots/labels must use the same
    // offsets so they land over the actual points (panes dodge at the pane gap).
    const dodge = ctx.seriesOrder.length > 1 ? pointDodgeOffsets(ctx.seriesOrder, true) : undefined;
    attachCategoricalLineCrosshair(svg, {
      rows: ctx.dataInScope.map((r) => ({ _xc: r._xc, series: r.series, _y: r._y })),
      colors: ctx.colors,
      seriesLabels: ctx.seriesLabels,
      seriesOrder: ctx.seriesOrder,
      yFormat: (v) => formatValue(v, ctx.units, ctx.spec.tooltip_decimals),
      bandHighlight: true,
      centersFromMarks: true,
      ...(dotUseCoord ? { emitOnly: true, onResolve: (cat: string | null) => ctx.onResolve!(cat) } : {}),
    });
    ctx.onPillDriver?.(
      attachHighlightPills(svg, {
        rows: ctx.dataInScope.map((r) => ({ _xc: r._xc, series: r.series, _y: r._y })),
        chartType: "dotplot",
        colors: ctx.colors,
        seriesOrder: ctx.seriesOrder,
        yFormat: (v) => formatValue(v, ctx.units, ctx.spec.tooltip_decimals),
        dodge,
      }),
    );
    if (dotUseCoord) {
      return attachSecondaryCategoricalLineCursor(svg, {
        rows: ctx.dataInScope.map((r) => ({ _xc: r._xc, series: r.series, _y: r._y })),
        colors: ctx.colors,
        seriesLabels: ctx.seriesLabels,
        seriesOrder: ctx.seriesOrder,
        yFormat: (v) => formatValue(v, ctx.units, ctx.spec.tooltip_decimals),
        symbols,
        bandHighlight: true,
        centersFromMarks: true,
        dodge,
      }) as (key: unknown, active?: boolean) => void;
    }
    return undefined;
  }
  if (ctx.spec.chartType === "scatter") {
    const cols = ctx.spec.columns ?? {};
    const pointHasShape = !!cols.shape;
    // shape value → marker symbol (by shape_order index, matching the chart's symbol scale).
    const symbols = new Map((ctx.spec.shape_order ?? []).map((s, i) => [s, markerSymbolForIndex(i)] as const));
    attachPointHover(svg, {
      points: ctx.dataInScope.map((r) => ({ series: r.series, shape: r._shape, x: r._xn ?? 0, y: r._y })),
      selector: pointHasShape ? 'g[aria-label="dot"] path' : 'g[aria-label="dot"] circle',
      colors: ctx.colors,
      seriesLabels: ctx.seriesLabels,
      shapeLabels: ctx.spec.shape_labels,
      showShape: pointHasShape && cols.shape !== cols.series,
      symbols,
      xLabel: ctx.spec.x_axis_title ?? "x",
      yLabel: ctx.spec.y_axis_title ?? "Value",
      xFormat: (v) => v.toLocaleString(undefined, { maximumFractionDigits: 2 }),
      yFormat: (v) => formatValue(v, ctx.units, ctx.spec.tooltip_decimals),
    });
    return undefined;
  }

  const categorical = ctx.spec.xAxisType === "categorical";
  // Coordinated cursor: the band crosshair resolves a CATEGORY (works for both orientations —
  // categories on X for vertical, on Y for horizontal), so horizontal bars get the coordinated
  // row-highlight + value pills too (not a per-pane tooltip). `useCoord` gates the no-tooltip
  // emitOnly + coordinated-renderer path.
  const horizontal = ctx.spec.orientation === "horizontal";
  const useCoord = ctx.onResolve != null;
  // Line charts with point markers: per-series marker shape, so the coordinated hover dot can
  // match the static marker. Keyed by series index, matching the chart's symbol scale.
  const markerSymbols = ctx.spec.points && ctx.spec.chartType === "line"
    ? new Map(ctx.seriesOrder.map((s, i) => [s, markerSymbolForIndex(i)] as const))
    : undefined;
  // The crosshair/tooltip is attached for EVERY pane regardless of whether a legend exists
  // (single-series bar panes have no legend but still need hover tooltips). Selection (the
  // click → legend.toggle wiring) is gated on `handle`, since there's nothing to pin without
  // an interactive legend.
  if (categorical && ctx.spec.chartType === "line") {
    // Categorical-x LINE pane: resolve the category from the x-axis labels (no bars). Coordinated
    // panes hit-test + emit only; the secondary renderer draws guide + per-series dot + value pill.
    attachCategoricalLineCrosshair(svg, {
      rows: ctx.dataInScope.map((r) => ({ _xc: r._xc, series: r.series, _y: r._y })),
      colors: ctx.colors,
      seriesLabels: ctx.seriesLabels,
      seriesOrder: ctx.seriesOrder,
      yFormat: (v) => formatValue(v, ctx.units, ctx.spec.tooltip_decimals),
      ...(useCoord ? { emitOnly: true, onResolve: (cat: string | null) => ctx.onResolve!(cat) } : {}),
    });
    if (handle) {
      // Lines are thin; fat hit-paths + tagged dots let clicks resolve the series.
      addLineHitPaths(svg);
      svg.querySelectorAll<SVGElement>(".tbl-catline-hit").forEach((el) => { el.style.cursor = "pointer"; });
      svg.addEventListener("click", (evt) => {
        const series = resolveSeriesAtPoint(svg, evt as MouseEvent);
        if (series) handle.toggle(series);
      });
    }
    if (useCoord) {
      return attachSecondaryCategoricalLineCursor(svg, {
        rows: ctx.dataInScope.map((r) => ({ _xc: r._xc, series: r.series, _y: r._y })),
        colors: ctx.colors,
        seriesLabels: ctx.seriesLabels,
        seriesOrder: ctx.seriesOrder,
        yFormat: (v) => formatValue(v, ctx.units, ctx.spec.tooltip_decimals),
        symbols: markerSymbols,
      }) as (key: unknown, active?: boolean) => void;
    }
    return undefined;
  }

  if (categorical) {
    // Categorical pane: band crosshair, mirroring mountChart's categorical branch.
    const isStacked = ctx.spec.chartType === "stacked";
    // A grouped per-pane bar IS fx-faceted within its own frame (xScaleField === "fx" in
    // bar.ts); a sectioned horizontal per-pane bar (any series count) is fy-faceted — see
    // isBarCategoryFaceted above.
    const isFaceted = isBarCategoryFaceted(ctx.spec, ctx.dataInScope, ctx.seriesOrder.length);
    const catsSeen = new Set<string>();
    const catsRaw: string[] = [];
    for (const r of ctx.dataInScope) {
      const cat = r._xc;
      if (cat && !catsSeen.has(cat)) { catsSeen.add(cat); catsRaw.push(cat); }
    }
    // Sectioned horizontal bars render categories grouped by section, so the bands' VISUAL order
    // differs from data-encounter order. The crosshair maps facet rows → categories by index, so
    // reorder to match the rendered (section) order.
    const cats = sectionOrderedCategories(ctx.spec, ctx.dataInScope, catsRaw);
    // Total-dot stacks hover with the tooltip (dot-swatch Total row), never per-segment pills —
    // matching the standalone rule. Coordination is dropped for these panes (they tooltip
    // independently), so pills never appear anywhere in a total-dot figure.
    const useTooltip = ctx.showTotalDot === true;
    const coord = useCoord && !useTooltip;
    attachBandCrosshair(svg, {
      rows: ctx.dataInScope.map((r) => ({ _xc: r._xc, series: r.series, _y: r._y })),
      isStacked,
      showTotalDot: ctx.showTotalDot,
      isFaceted,
      categories: cats,
      colors: ctx.colors,
      seriesLabels: ctx.seriesLabels,
      seriesOrder: ctx.seriesOrder,
      yFormat: (v) => formatValue(v, ctx.units, ctx.spec.tooltip_decimals),
      categoryLabels: ctx.spec.x_labels,
      swatchShape: "rect",
      orientation: horizontal ? "horizontal" : "vertical",
      // Coordinated: hit-test + emit only (no tooltip/highlight); the coordinated renderer draws.
      ...(coord ? { emitOnly: true, onResolve: (cat: string | null) => ctx.onResolve!(cat) } : {}),
    });
    if (handle) {
      // Bars carry data-series on their rects → click resolves directly (no fat hit-paths).
      svg.querySelectorAll<SVGElement>(".tbl-band-crosshair-hit").forEach((el) => { el.style.cursor = "pointer"; });
      svg.addEventListener("click", (evt) => {
        const series = resolveSeriesAtPoint(svg, evt as MouseEvent);
        if (series) handle.toggle(series);
      });
    }
    ctx.onPillDriver?.(
      attachHighlightPills(svg, {
        rows: ctx.dataInScope.map((r) => ({ _xc: r._xc, series: r.series, _y: r._y })),
        chartType: isStacked ? "stacked" : "bar",
        isStacked,
        isFaceted,
        categories: cats,
        colors: ctx.colors,
        seriesOrder: ctx.seriesOrder,
        yFormat: (v) => formatValue(v, ctx.units, ctx.spec.tooltip_decimals),
        horizontal,
        showTotalDot: ctx.showTotalDot,
      }),
    );
    if (coord) {
      // Waterfall (per pane): delta steps get a centered signed value pill on hover; total/skip
      // shade only. Computed from this pane's rows so a step that is a delta in one facet and a
      // skip in another is handled correctly (e.g. the April 2 decomposition's "Apply ηs").
      const wfCursor =
        ctx.spec.chartType === "waterfall"
          ? {
              deltaCats: new Set(
                ctx.dataInScope
                  .filter((r) => {
                    const k = ((r._kind as string | undefined) ?? "").trim();
                    return k !== "total" && k !== "skip";
                  })
                  .map((r) => r._xc as string),
              ),
            }
          : undefined;
      const wfDecimals = wfCursor
        ? waterfallValueDecimals(ctx.dataInScope, ctx.spec.valueLabels?.decimals)
        : undefined;
      return attachSecondaryBandCursor(svg, {
        rows: ctx.dataInScope.map((r) => ({ _xc: r._xc, series: r.series, _y: r._y })),
        isStacked,
        isFaceted,
        categories: cats,
        colors: ctx.colors,
        seriesLabels: ctx.seriesLabels,
        seriesOrder: ctx.seriesOrder,
        yFormat: (v) => formatValue(v, ctx.units, wfDecimals ?? ctx.spec.tooltip_decimals),
        horizontal,
        ...(horizontal
          ? {
              regionFromLeftEdge: true,
              regionExtendRight: ctx.coordExtendRight ?? 0,
              ...(ctx.coordAccentLabel ? { accentLabel: { font: FACETED_CAT_LABEL_PX } } : {}),
            }
          : {}),
        ...(wfCursor ? { waterfall: wfCursor } : {}),
      }) as (key: unknown, active?: boolean) => void;
    }
    return undefined;
  }

  // Histogram panes: per-bin hover (numeric/temporal x, binned bars), same as the standalone path.
  // No coordinated-cursor variant (histograms don't share an x-domain across panes).
  if (ctx.spec.chartType === "histogram") {
    attachHistogramHover(svg, {
      rows: ctx.dataInScope.map((r) => ({ _x0: r._x0, _x1: r._x1, series: r.series, _y: r._y })),
      colors: ctx.colors,
      seriesLabels: ctx.seriesLabels,
      seriesOrder: ctx.seriesOrder,
      yFormat: (v) => formatValue(v, ctx.units, ctx.spec.tooltip_decimals),
      // Temporal: date formatter. Numeric: omit so the rounding default formats the bin edges.
      xFormat: ctx.spec.xAxisType === "temporal" ? ctx.tooltipXFormat : undefined,
    });
    return undefined;
  }

  attachCrosshair(svg, {
    rows: ctx.dataInScope.map((r) => ({ time: r.time, series: r.series, value: r._y })),
    xField: "time",
    yField: "value",
    seriesField: "series",
    xParse: ctx.tooltipXParse as ((v: unknown) => number) | undefined,
    xFormat: ctx.tooltipXFormat,
    yFormat: (v) => formatValue(v, ctx.units, ctx.spec.tooltip_decimals),
    colors: ctx.colors,
    dashedSeries: ctx.dashedNames,
    seriesLabels: ctx.seriesLabels,
    seriesOrder: ctx.seriesOrder,
    ...(useCoord ? { emitOnly: true, onResolve: (x: number | null) => ctx.onResolve!(x) } : {}),
  });
  if (handle) {
    // Line strokes are thin; add transparent fat hit-paths so clicks near a line resolve it.
    addLineHitPaths(svg);
    svg.querySelectorAll<SVGElement>(".tbl-crosshair-hit").forEach((el) => { el.style.cursor = "pointer"; });
    svg.addEventListener("click", (evt) => {
      const series = resolveSeriesAtPoint(svg, evt as MouseEvent);
      if (series) handle.toggle(series);
    });
  }
  if (useCoord) {
    return attachSecondaryLineCursor(svg, {
      rows: ctx.dataInScope.map((r) => ({ time: r.time, series: r.series, value: r._y })),
      xField: "time",
      yField: "value",
      seriesField: "series",
      xParse: ctx.tooltipXParse as ((v: unknown) => number) | undefined,
      xFormat: ctx.tooltipXFormat,
      yFormat: (v) => formatValue(v, ctx.units, ctx.spec.tooltip_decimals),
      colors: ctx.colors,
      seriesLabels: ctx.seriesLabels,
      seriesOrder: ctx.seriesOrder,
      symbols: markerSymbols,
    }) as (key: unknown, active?: boolean) => void;
  }
  return undefined;
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

  const card = doc.createElement("div");
  card.className = "figure-card";
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
  // Horizontal-bar and variable-width figures never reflow to extra rows — they keep their columns
  // and scroll horizontally when narrow, so their grid lives inside a horizontal-scroll wrapper.
  const smCfg = spec.small_multiples!;
  const variableWidths = smCfg.pane_widths != null && smCfg.pane_widths !== "equal";
  const noStack =
    (spec.chartType === "bar" && spec.orientation === "horizontal") || variableWidths;
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
    actions: buildDownloadActions(doc, spec, rows, opts.downloadName, selections),
  });
  container.appendChild(card);

  let lastSig = "";

  // Distinct in-scope facet values (respecting pane_order) → the pane count. Used to clamp the
  // column count BEFORE computing paneW, so the per-pane render width matches the grid cell
  // width even when there are fewer panes than the reflow/config would allow.
  const facetCol = resolveColumns(spec, rows).facet;
  const paneCount = (): number => {
    const distinct = new Set<string>();
    for (const r of rows) {
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
  // Horizontal bar AND horizontal stacked figures grow their height with the row count — let
  // renderFigure compute it (passing undefined) rather than forcing the fixed pane height. Also
  // drives the pane-title offset (both share the left-gutter fy topology — see figure.ts).
  const isHorizontalBarFig =
    (spec.chartType === "bar" || spec.chartType === "stacked") && spec.orientation === "horizontal";
  // Categorical (band) figures whose hover is the shade + bar-end pill (like the standalone bar
  // chart), not the floating tooltip. Used to give a lone pane that treatment (see `coordinated`).
  const isCategoricalBarFig = spec.chartType === "bar" || spec.chartType === "stacked";
  // Dot-plot AND bar/stacked (vertical) panes render ~33% taller (320); waterfall panes taller
  // still (420) to clear rotated step labels; line/scatter keep the default (240); horizontal
  // bar/stacked panes grow with row count (undefined). Single source of truth shared with the
  // PNG export (export-png.ts) so the two paths can't drift.
  const figHeight = figurePaneHeight(spec);

  const drawGrid = (outerWidth: number): void => {
    const baseCols = sm.columns && sm.columns > 0 ? sm.columns : 0; // 0 → reflow-driven
    // Reflow: how many columns fit at >= paneMinWidth each, capped by config and pane count
    // (so renderFigure won't re-clamp and leave paneW mismatched against the grid cells).
    // NO-STACK figures (horizontal bars / variable widths) never reduce columns for width — they
    // keep the configured columns (else a single row) and scroll horizontally instead.
    const fitCols = Math.max(1, Math.floor((outerWidth + GRID_GAP) / (paneMinWidth + GRID_GAP)));
    const cols = noStack
      ? Math.max(1, Math.min(baseCols || paneCount(), paneCount()))
      : Math.max(1, Math.min(baseCols || fitCols, fitCols, paneCount()));
    // No-stack: keep panes at a readable minimum and let the row overflow into the scroll wrapper.
    // (Horizontal panes reserve the left category gutter on top of the data, so allow extra.)
    const minPerPane = isHorizontalBarFig ? HBAR_PANE_MIN_WIDTH : paneMinWidth;
    const naturalW = cols * minPerPane + (cols - 1) * GRID_GAP + (isHorizontalBarFig ? HBAR_GUTTER_RESERVE : 0);
    const gridW = noStack ? Math.max(outerWidth, naturalW) : outerWidth;
    // Pass the TOTAL inner grid width + gap whenever renderFigure sizes explicit per-column widths
    // — SHARED mode (unequal labeled/label-less columns), variable pane_widths in either mode, OR
    // per-pane HORIZONTAL bars (the category gutter is asymmetric — pane 0 wide, others narrow —
    // so renderFigure compensates the outer widths for one shared inner data width and needs the
    // total row width, exactly like shared mode). Otherwise (equal per-pane) pass one shared pane
    // width for 1fr columns.
    const useGridWidth = isShared || variableWidths || isHorizontalBarFig;
    const paneW = Math.max(paneMinWidth, Math.floor((gridW - GRID_GAP * (cols - 1)) / cols));
    const sig = useGridWidth ? `s:${cols}:${gridW}` : `p:${cols}:${paneW}`;
    if (sig === lastSig) return;
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
            ...(accentColor ? { accentColor } : {}),
          })
        : renderFigure(spec, rows, {
            width: paneW,
            height: figHeight,
            columns: cols,
            ...(accentColor ? { accentColor } : {}),
          });
    } catch (e) {
      grid.innerHTML = `<div class="figure-error">${(e as Error).message}</div>`;
      return; // leave lastSig unchanged so a same-width re-render retries after a fix
    }
    lastSig = sig; // commit only after a successful render
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
      // Faceted horizontal bars: the leftmost pane reserves a wide category gutter on its left, so
      // align the pane title with the DATA area (offset by that pane's left margin) instead of
      // letting it sit over the category labels. Other panes have a negligible margin (no shift).
      if (isHorizontalBarFig && pane.svg) {
        const ml = Number((pane.svg as SVGSVGElement).dataset.marginLeft) || 0;
        if (ml > 0) title.style.paddingInlineStart = `${ml}px`;
      }
      cell.appendChild(title);
      if (pane.svg) cell.appendChild(pane.svg);
      grid.appendChild(cell);
    }
    legendSlot.replaceChildren();
    // Highlight root = the grid, so legend hover/pin dims [data-series] across EVERY pane SVG.
    // Each pane registers its value-pill driver here; the legend fires them all on highlight.
    const pillDrivers: HighlightPillsHandle[] = [];
    const hasFigShape = !!(fig.shapeLegendItems && fig.shapeLegendItems.length);
    const handle = fig.legendItems || hasFigShape
      ? renderLegend(legendSlot, fig.legendItems ?? [], {
          svg: grid,
          onHighlight: (active) => {
            for (const p of fig.panes) if (p.svg) recolorNetLabels(p.svg);
            for (const d of pillDrivers) d.setActive(active);
          },
          shapeItems: fig.shapeLegendItems ?? undefined,
          colorTitle: fig.colorLegendTitle,
          shapeTitle: fig.shapeLegendTitle,
        })
      : null;
    // Attach each pane's crosshair ALWAYS (single-series bar panes have no legend but still
    // need tooltips); selection click is gated on `handle` inside wireFigureSvg.
    card.classList.toggle("is-selectable", handle != null);

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
      const col = idx % fig.columns;
      const driver = wireFigureSvg(pane.svg, handle, {
        spec,
        dataInScope: pane.dataInScope ?? [],
        colors: pane.colors ?? new Map(),
        dashedNames: pane.dashedNames ?? new Set(),
        seriesLabels: fig.seriesLabels,
        seriesOrder: pane.seriesOrder ?? [],
        units: pane.units ?? fig.units,
        tooltipXParse: pane.tooltipXParse,
        tooltipXFormat: pane.tooltipXFormat,
        showTotalDot: pane.showTotalDot,
        onPillDriver: (d) => pillDrivers.push(d),
        // Horizontal coordinated cursor: bridge the inter-pane gap (all but the last column) so the
        // shaded row is continuous, and accent the category label on the leftmost (label-bearing) pane.
        ...(isHorizontalBarFig
          ? {
              coordExtendRight: col < fig.columns - 1 ? GRID_GAP : 0,
              coordAccentLabel: col === 0,
            }
          : {}),
        ...(coordinated ? { onResolve: (key: unknown) => emit(idx, key) } : {}),
      });
      drivers.push(driver ?? (() => {}));
    });
  };

  const draw = (w: number): void => { drawGrid(w); };

  const initialWidth = card.clientWidth || opts.width || 720;
  // On a selection change, re-render the grid so the accent tracks the active option. Reset the
  // width-keyed guard (sig is width-only) so the same-width re-render isn't skipped.
  requestFigureRedraw = () => {
    lastSig = "";
    draw(card.clientWidth || initialWidth);
  };
  draw(initialWidth);

  let resizeRaf: number | null = null;
  let ro: ResizeObserver | undefined;
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => {
      if (resizeRaf !== null) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        draw(card.clientWidth || initialWidth);
      });
    });
    ro.observe(card);
  }

  return () => {
    ro?.disconnect();
    if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
    closeTitleSelectors();
  };
}
