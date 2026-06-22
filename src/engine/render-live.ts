// Live-render layer: mounts a fully interactive chart card into a container element and
// wires the pure engine (renderChart) to the DOM-only live primitives (legend, crosshair,
// source line). Scaling is copied from the tracker's createChartController: the chart is
// RE-RENDERED at the container's width (the x-axis compresses; height stays fixed) down to a
// minimum width, below which a horizontal scroll wrapper takes over and a sticky y-axis
// overlay keeps the value labels pinned at the left. No viewBox/CSS scaling.
import type { ChartSpec } from "../spec/types.js";
import type { TidyRow } from "../data/index.js";
import type { LegendItem } from "./index.js";
import { renderChart } from "./index.js";
import { renderLegend } from "./legend.js";
import type { LegendHandle } from "./legend.js";
import { attachCrosshair, attachBandCrosshair } from "./crosshair.js";
import { renderSourceLine } from "./source-line.js";
import { rowsToCsvBrowser } from "../data/csv-browser.js";
import { LOGO_SVG } from "../embed/assets.js";
import { exportChartPng } from "../embed/export-png.js";
import { tokens } from "../theme/tokens.js";
import { TOTAL_SERIES_KEY } from "./series-keys.js";

export interface MountOptions {
  spec: ChartSpec;
  rows: TidyRow[];
  /** Initial render width (used before the container is measured). */
  width?: number;
  height?: number;
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
  const seriesField = spec.series_field || "series";
  const cats = new Set<string>();
  const series = new Set<string>();
  for (const r of rows) {
    const cat = r.time;
    if (typeof cat === "string" && cat !== "") cats.add(cat);
    const s = r[seriesField];
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
    // Diverging: any row with a negative _y value.
    const isDiverging = rows.some((r) => {
      const v = typeof r._y === "number" ? r._y : Number(r.value);
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
  const overlay = svgEl.querySelector(".tbl-crosshair-hit");
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
const NET_LABEL_DARK = tokens.structural.text_heading;
const NET_LABEL_WHITE = "#FFFFFF";

/**
 * Pure color decision for a net-total label. Factored out for unit testing (jsdom has no
 * layout, so the geometry-based behind-detection can't be exercised there).
 *   - behind segment dimmed  → dark  (legible over the near-white dimmed bar)
 *   - no segment behind it   → dark  (white would be invisible on the white background)
 *   - behind segment active  → white (the existing default over a full-color segment)
 */
export function netLabelFill(behindDimmed: boolean, hasBehind: boolean): string {
  return !hasBehind || behindDimmed ? NET_LABEL_DARK : NET_LABEL_WHITE;
}

/**
 * Detect, per net-total label, the stacked-segment SERIES drawn directly behind it, by
 * geometry. Runs once post-render. We compare in SCREEN coordinates (getBoundingClientRect):
 * the segment rects bake their geometry into x/y attributes, but the net-LABEL text marks are
 * positioned by a transform, so a text element's getBBox() returns its own local box (origin-
 * centered), NOT user space — only the post-layout client rect places both in the same frame.
 * A label's behind-series is the non-Total segment rect whose [left,right] contains the
 * label's center x AND [top,bottom] contains its center y. The mapping is stamped on
 * `dataset.behindSeries` (empty string = none) so recolorNetLabels can read it on every
 * highlight change. No-op when there are no net labels (anything but a diverging/dot-mode
 * stacked chart) or in non-layout environments (jsdom: client rects are all zero → no hit).
 */
function detectNetLabelBehindSeries(svg: SVGSVGElement): void {
  const labels = svg.querySelectorAll<SVGTextElement>(
    `g.tbl-net-label text[data-series="${TOTAL_SERIES_KEY}"]`,
  );
  if (!labels.length) return;
  const rects = Array.from(
    svg.querySelectorAll<SVGRectElement>(
      `rect[data-series]:not([data-series="${TOTAL_SERIES_KEY}"])`,
    ),
  );
  // Precompute each rect's screen extent + series once.
  const extents = rects.map((rect) => {
    const b = rect.getBoundingClientRect();
    return {
      series: rect.getAttribute("data-series") ?? "",
      x0: b.left,
      x1: b.right,
      y0: b.top,
      y1: b.bottom,
    };
  });
  labels.forEach((label) => {
    const b = label.getBoundingClientRect();
    let found = "";
    // Degenerate (zero-size) label box → no real layout (e.g. jsdom); leave behind unset so
    // recolor falls through to the dark default rather than spuriously matching a 0×0 rect.
    if (b.width > 0 || b.height > 0) {
      const cx = b.left + b.width / 2;
      const cy = b.top + b.height / 2;
      for (const e of extents) {
        if (cx >= e.x0 && cx <= e.x1 && cy >= e.y0 && cy <= e.y1) {
          found = e.series;
          break;
        }
      }
    }
    label.dataset.behindSeries = found;
  });
}

/**
 * Recolor every net-total label from the CURRENT dim state. Reads the behind-series stamped
 * by detectNetLabelBehindSeries; dim state is per-series (all rects of a dimmed series carry
 * .tbl-dimmed), so checking any one rect of that series is sufficient and stable. Called once
 * after wiring (initial state) and on every highlight change via the legend's onHighlight hook
 * (which fires AFTER applyHighlight toggles the classes, so the read is fresh).
 */
function recolorNetLabels(svg: SVGSVGElement): void {
  const labels = svg.querySelectorAll<SVGTextElement>(
    `g.tbl-net-label text[data-series="${TOTAL_SERIES_KEY}"]`,
  );
  if (!labels.length) return;
  labels.forEach((label) => {
    const behind = label.dataset.behindSeries ?? "";
    const hasBehind = behind !== "";
    let behindDimmed = false;
    if (hasBehind) {
      const rect = svg.querySelector<SVGRectElement>(
        `rect[data-series="${cssAttrEscape(behind)}"]`,
      );
      behindDimmed = rect?.classList.contains("tbl-dimmed") ?? false;
    }
    label.setAttribute("fill", netLabelFill(behindDimmed, hasBehind));
  });
}

/** Minimal escaping for a data-series value used inside an attribute selector. Series names
 *  are author-supplied; escape quotes/backslashes so the selector stays valid. */
function cssAttrEscape(value: string): string {
  return value.replace(/(["\\])/g, "\\$1");
}

/** Format a numeric value for tooltip display. */
function formatValue(v: number, units: string): string {
  if (!Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}${units}`;
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

/** Data (CSV) + Image (PNG) download buttons for the source line. */
function buildDownloadActions(doc: Document, spec: ChartSpec, rows: TidyRow[]): HTMLElement {
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
      a.download = `${titleToSlug(spec.title)}.csv`;
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
      await exportChartPng(spec, rows);
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
export function mountChart(container: HTMLElement, opts: MountOptions): () => void {
  const { spec, rows, width: initialWidth } = opts;
  // Explicit height (callers / golden path) wins; otherwise horizontal bars grow taller
  // with the bar/row count and everything else uses the fixed default.
  const height = opts.height ?? computeChartHeight(spec, rows);
  const doc = container.ownerDocument;

  const card = doc.createElement("div");
  card.className = "figure-card";

  // Header: eyebrow above a title row (title left, logo baseline-aligned top-right); subtitle below.
  const header = doc.createElement("div");
  header.className = "figure-header";
  if (spec.eyebrow) {
    const eyebrow = doc.createElement("div");
    eyebrow.className = "figure-supertitle";
    eyebrow.textContent = spec.eyebrow;
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

  // Legend slot above the canvas (used for top-legend; hidden/empty for right-legend).
  const legendSlot = doc.createElement("div");
  legendSlot.className = "figure-legend-slot";
  card.appendChild(legendSlot);

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
    actions: buildDownloadActions(doc, spec, rows),
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
      built = renderChart(spec, rows, { width: target, height });
    } catch (e) {
      canvas.innerHTML = `<div class="figure-error">${(e as Error).message}</div>`;
      return;
    }
    const {
      svg, legendItems, seriesLabels, seriesOrder, dashedNames, colors, units,
      xAxisTitle, dataInScope, tooltipXParse, tooltipXFormat, legendVisualOrder, showTotalDot,
    } = built;

    // Native px — no makeResponsive/viewBox: the SVG keeps its exact pixel width so it
    // overflows into the scroll wrapper below the floor instead of being CSS-scaled down.
    canvas.replaceChildren(svg);

    if (!xTitleAdded) { appendXAxisTitle(canvasScroll, xAxisTitle); xTitleAdded = true; }

    // --- Legend layout ---
    let legendHandle: LegendHandle | null = null;
    if (legendItems) {
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
        const orderedItems = orderForRightLegend(legendItems, legendVisualOrder);
        rightLegendSlot!.replaceChildren();
        legendHandle = renderLegend(rightLegendSlot!, orderedItems, {
          svg,
          onHighlight: () => recolorNetLabels(svg),
        });
        // Add the vertical-layout class to the rendered legend element (use the handle's
        // element directly rather than re-querying the slot).
        legendHandle?.element.classList.add("tbl-legend--vertical");
        // Ensure top legend slot stays empty.
        legendSlot.replaceChildren();
      } else {
        // Top legend (default behavior — unchanged).
        legendSlot.replaceChildren();
        legendHandle = renderLegend(legendSlot, legendItems, {
          svg,
          onHighlight: () => recolorNetLabels(svg),
        });
      }
    }

    // Detect the segment behind each net-total label (geometry, post-render) and set the
    // initial label colors from the current (un-dimmed) state. No-op unless this is a
    // diverging/dot-mode stacked chart (the only case with tbl-net-label elements).
    detectNetLabelBehindSeries(svg);
    recolorNetLabels(svg);

    currentLegendPos = legendPos;

    if (spec.xAxisType === "categorical") {
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
        yFormat: (v) => formatValue(v, units),
        orientation: spec.orientation === "horizontal" ? "horizontal" : "vertical",
      });
    } else {
      attachCrosshair(svg, {
        rows: dataInScope.map((r) => ({ time: r.time, series: r.series, value: r._y })),
        xField: "time",
        yField: "value",
        seriesField: "series",
        xParse: tooltipXParse as ((v: unknown) => number) | undefined,
        xFormat: tooltipXFormat,
        yFormat: (v) => formatValue(v, units),
        colors,
        dashedSeries: dashedNames,
        seriesLabels,
        seriesOrder,
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
    if (legendHandle) {
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
