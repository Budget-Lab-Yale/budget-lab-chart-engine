// Live-render layer: mounts a fully interactive chart card into a container element and
// wires the pure engine (renderChart) to the DOM-only live primitives (legend, crosshair,
// source line). Scaling is copied from the tracker's createChartController: the chart is
// RE-RENDERED at the container's width (the x-axis compresses; height stays fixed) down to a
// minimum width, below which a horizontal scroll wrapper takes over and a sticky y-axis
// overlay keeps the value labels pinned at the left. No viewBox/CSS scaling.
import type { ChartSpec } from "../spec/types.js";
import { resolveColumns } from "../spec/columns.js";
import type { TidyRow } from "../data/index.js";
import type { LegendItem } from "./index.js";
import type { PreparedRow } from "./marks/index.js";
import { pointDodgeOffsets } from "./marks/point.js";
import type { FigureRenderResult } from "./figure.js";
import { renderChart } from "./index.js";
import { renderFigure } from "./figure.js";
import { renderLegend } from "./legend.js";
import type { LegendHandle } from "./legend.js";
import {
  attachCrosshair,
  attachBandCrosshair,
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
}

// Below this width the chart stops shrinking and the scroll wrapper takes over (matches the
// tracker's mobile/stacked-header breakpoint). Height is held constant as the width changes.
const MIN_CHART_WIDTH = 390;
const FIXED_CHART_HEIGHT = 400;

// Horizontal bars grow taller with the bar/row count (the stakeholder blessed taller
// horizontals). Per-row pixel budget + chrome headroom, floored at the vertical default so
// short horizontals don't shrink. Vertical charts keep the fixed height.
const HORIZONTAL_PX_PER_ROW = 34; // per bar (single/stacked: 1 per category; grouped: per series-in-group)
const HORIZONTAL_CHROME_PX = 80; // top/bottom margins + value-axis label row + a little slack

/** Compute the live-mount height for a chart. Horizontal bars scale with the number of bars
 *  (rows): single-series / stacked → one row per category; grouped → categories x series.
 *  Vertical charts (and non-bar types) return the fixed default. Floored at
 *  FIXED_CHART_HEIGHT so short horizontals are not smaller than a vertical chart. */
export function computeChartHeight(spec: ChartSpec, rows: TidyRow[]): number {
  if (spec.orientation !== "horizontal" || (spec.chartType !== "bar" && spec.chartType !== "stacked")) {
    return FIXED_CHART_HEIGHT;
  }
  const cols = resolveColumns(spec, rows);
  const cats = new Set<string>();
  const series = new Set<string>();
  for (const r of rows) {
    const cat = r[cols.x];
    if (typeof cat === "string" && cat !== "") cats.add(cat);
    const s = cols.series ? r[cols.series] : null;
    if (typeof s === "string" && s !== "") series.add(s);
  }
  const nCats = Math.max(1, cats.size);
  // series_order, when present, is the authoritative series count (it filters/orders).
  const nSeries =
    spec.series_order && spec.series_order.length
      ? spec.series_order.length
      : Math.max(1, series.size);
  // Stacked stacks all series into one row per category; grouped clusters one row per series.
  const grouped = spec.chartType === "bar" && nSeries > 1;
  const rowCount = grouped ? nCats * nSeries : nCats;
  return Math.max(FIXED_CHART_HEIGHT, Math.round(rowCount * HORIZONTAL_PX_PER_ROW + HORIZONTAL_CHROME_PX));
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
  return titleToSlug(spec.title);
}

/** Data (CSV) + Image (PNG) download buttons for the source line. Filenames use the chart's folder
 *  slug (from the URL) rather than the title, which makes for unwieldy filenames. */
function buildDownloadActions(doc: Document, spec: ChartSpec, rows: TidyRow[], slugOverride?: string): HTMLElement {
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
      await exportChartPng(spec, rows, { filename: `${base}.png` });
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

/** Brief restack morph: the stacked total is order-invariant, so only the band paths' geometry
 *  changes. Start each re-rendered band at its OLD `d`, then transition to the new `d` (CSS
 *  `transition: d` via .tbl-area-animating) so the bands visibly slide into their new positions.
 *  Degrades to an instant change where `d` transitions aren't supported. */
function animateAreaRestack(svg: Element, oldDs: Map<string, string>): void {
  const paths = [...svg.querySelectorAll('g[aria-label="area"] path[data-series]')];
  const targets: Array<[Element, string]> = [];
  for (const p of paths) {
    const s = p.getAttribute("data-series");
    const target = p.getAttribute("d");
    const old = s ? oldDs.get(s) : undefined;
    if (s && target && old && old !== target) {
      p.setAttribute("d", old);
      p.classList.add("tbl-area-animating");
      targets.push([p, target]);
    }
  }
  if (!targets.length) return;
  void (svg as SVGElement).getBoundingClientRect(); // commit the start state before transitioning
  const win = svg.ownerDocument?.defaultView ?? undefined;
  const raf =
    win?.requestAnimationFrame?.bind(win) ?? ((cb: (t: number) => void) => setTimeout(() => cb(0), 16));
  raf(() => raf(() => { for (const [p, target] of targets) p.setAttribute("d", target); }));
  (win?.setTimeout ?? setTimeout)(() => {
    for (const [p] of targets) p.classList.remove("tbl-area-animating");
  }, 360);
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

  // Header: eyebrow above a title row (title left, logo baseline-aligned top-right); subtitle
  // below. Shared with the figure card via buildFigureHeader so the two never diverge.
  buildFigureHeader(card, doc, spec, opts.eyebrow);

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
    actions: buildDownloadActions(doc, spec, rows, opts.downloadName),
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

    let built;
    try {
      built = renderChart(spec, rows, { width: target, height, ...(restackOrder ? { stackOrder: restackOrder } : {}) });
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
      // Determine if this is a stacked chart (needs Total row) and if it uses
      // fx-faceted grouped bar layout (xScaleField === "fx" in bar.ts).
      const isStacked = spec.chartType === "stacked";
      const isFaceted = spec.chartType === "bar" && (seriesOrder.length > 1);
      // Derive the ordered category list from the data rows (declaration order).
      const catsSeen = new Set<string>();
      const cats: string[] = [];
      for (const r of dataInScope) {
        const cat = r._xc;
        if (cat && !catsSeen.has(cat)) { catsSeen.add(cat); cats.push(cat); }
      }
      attachBandCrosshair(svg, {
        rows: dataInScope.map((r) => ({ _xc: r._xc, series: r.series, _y: r._y })),
        isStacked,
        showTotalDot,
        isFaceted,
        categories: cats,
        colors,
        seriesLabels,
        seriesOrder,
        yFormat: (v) => formatValue(v, units, spec.tooltip_decimals),
        categoryLabels: spec.x_labels,
        swatchShape: "rect",
        orientation: spec.orientation === "horizontal" ? "horizontal" : "vertical",
      });
      pillDriver = attachHighlightPills(svg, {
        rows: dataInScope.map((r) => ({ _xc: r._xc, series: r.series, _y: r._y })),
        chartType: isStacked ? "stacked" : "bar",
        isStacked,
        isFaceted,
        categories: cats,
        colors,
        seriesOrder,
        yFormat: (v) => formatValue(v, units, spec.tooltip_decimals),
        horizontal: spec.orientation === "horizontal",
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
  };
}

// --- Small-multiples figure mount ----------------------------------------------------------
// Below this pane width the grid reflows to fewer columns (3→2→1). Used by both modes.
const PANE_MIN_WIDTH = 240;
// Per-pane mini-chart height (both modes — each pane is an independent mini-SVG).
const PANE_HEIGHT = 240;
// Must match the column-gap in `.figure-grid` CSS so the per-pane width math lines up.
const GRID_GAP = 16;

/** Build the shared card header (eyebrow / title+logo / subtitle) — mirrors mountChart's
 *  header so single-chart and figure cards look identical. The eyebrow (figure number) is an
 *  embed-time value supplied by the caller, not read from the spec.
 *
 *  The spec parameter is typed as `{ title?: string; subtitle?: string }` (a structural subset)
 *  so both ChartSpec and TableSpec can be passed without casting. */
export function buildFigureHeader(card: HTMLElement, doc: Document, spec: { title?: string; subtitle?: string }, eyebrowText?: string): void {
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
  if (spec.title) {
    const h = doc.createElement("h3");
    h.className = "figure-title";
    h.textContent = spec.title;
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
  // Coordinated cursor is x-keyed; horizontal bars are category-on-Y, so they keep the per-pane
  // tooltip instead. `useCoord` gates the no-tooltip emitOnly + coordinated-renderer path.
  const horizontal = ctx.spec.orientation === "horizontal";
  const useCoord = ctx.onResolve != null && !horizontal;
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
    // bar.ts), so isFaceted = bar && >1 series.
    const isFaceted = ctx.spec.chartType === "bar" && ctx.seriesOrder.length > 1;
    const catsSeen = new Set<string>();
    const cats: string[] = [];
    for (const r of ctx.dataInScope) {
      const cat = r._xc;
      if (cat && !catsSeen.has(cat)) { catsSeen.add(cat); cats.push(cat); }
    }
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
      ...(useCoord ? { emitOnly: true, onResolve: (cat: string | null) => ctx.onResolve!(cat) } : {}),
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
      }),
    );
    if (useCoord) {
      return attachSecondaryBandCursor(svg, {
        rows: ctx.dataInScope.map((r) => ({ _xc: r._xc, series: r.series, _y: r._y })),
        isStacked,
        isFaceted,
        categories: cats,
        colors: ctx.colors,
        seriesLabels: ctx.seriesLabels,
        seriesOrder: ctx.seriesOrder,
        yFormat: (v) => formatValue(v, ctx.units, ctx.spec.tooltip_decimals),
      }) as (key: unknown, active?: boolean) => void;
    }
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
  buildFigureHeader(card, doc, spec, opts.eyebrow);

  const legendSlot = doc.createElement("div");
  legendSlot.className = "figure-legend-slot";
  card.appendChild(legendSlot);

  // Figure-level y-axis title: one caption above the whole grid (left-aligned).
  appendAxisTitleEl(card, doc, "figure-y-axis-title", spec.y_axis_title ?? null);

  // Body: BOTH modes use the responsive `.figure-grid` of independent per-pane mini-SVGs.
  // (Shared mode is no longer a single faceted SVG — it is the same per-pane composition with
  // one shared y-domain + y-labels only on the left column, all handled inside renderFigure.)
  const grid = doc.createElement("div");
  grid.className = "figure-grid";
  card.appendChild(grid);

  // Figure-level x-axis title: one centered caption below the whole grid.
  appendAxisTitleEl(card, doc, "figure-x-axis-title", spec.x_axis_title ?? null);

  renderSourceLine(card, {
    note: spec.note,
    source: spec.source,
    actions: buildDownloadActions(doc, spec, rows, opts.downloadName),
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
  const paneMinWidth = isPointFigure ? 160 : PANE_MIN_WIDTH;
  // Dot-plot AND bar/stacked panes render ~33% taller (320) so the marks have room to read;
  // line/scatter panes keep the default.
  const TALL_PANE_TYPES = new Set(["dotplot", "bar", "stacked"]);
  const paneHeight = TALL_PANE_TYPES.has(spec.chartType) ? 320 : PANE_HEIGHT;

  const drawGrid = (outerWidth: number): void => {
    const baseCols = sm.columns && sm.columns > 0 ? sm.columns : 0; // 0 → reflow-driven
    // Reflow: how many columns fit at >= paneMinWidth each, capped by config and pane count
    // (so renderFigure won't re-clamp and leave paneW mismatched against the grid cells).
    const fitCols = Math.max(1, Math.floor((outerWidth + GRID_GAP) / (paneMinWidth + GRID_GAP)));
    const cols = Math.max(1, Math.min(baseCols || fitCols, fitCols, paneCount()));
    // SHARED mode: pass the TOTAL inner grid width + gap so renderFigure's width helper sizes the
    // unequal columns (labeled col 0 wider, label-less cols narrower) sharing one inner data width.
    // PER-PANE mode: equal panes, one shared pane width (1fr columns).
    const paneW = Math.max(paneMinWidth, Math.floor((outerWidth - GRID_GAP * (cols - 1)) / cols));
    const sig = isShared ? `s:${cols}:${outerWidth}` : `p:${cols}:${paneW}`;
    if (sig === lastSig) return;
    let fig: FigureRenderResult;
    try {
      fig = isShared
        ? renderFigure(spec, rows, {
            gridWidth: outerWidth,
            gridGap: GRID_GAP,
            height: paneHeight,
            columns: cols,
          })
        : renderFigure(spec, rows, { width: paneW, height: paneHeight, columns: cols });
    } catch (e) {
      grid.innerHTML = `<div class="figure-error">${(e as Error).message}</div>`;
      return; // leave lastSig unchanged so a same-width re-render retries after a fix
    }
    lastSig = sig; // commit only after a successful render
    // SHARED mode: explicit unequal column px widths (the panes are rendered at those widths, so
    // the grid template must match). PER-PANE mode: equal 1fr columns via --figure-cols.
    if (isShared && fig.columnWidths && fig.columnWidths.length) {
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
    const coordinated = sm.coordinated_cursor !== false && fig.panes.length > 1;
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
        ...(coordinated ? { onResolve: (key: unknown) => emit(idx, key) } : {}),
      });
      drivers.push(driver ?? (() => {}));
    });
  };

  const draw = (w: number): void => { drawGrid(w); };

  const initialWidth = card.clientWidth || opts.width || 720;
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
  };
}
