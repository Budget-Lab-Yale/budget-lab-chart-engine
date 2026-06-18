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
import { attachCrosshair } from "./crosshair.js";
import { renderSourceLine } from "./source-line.js";
import { rowsToCsvBrowser } from "../data/csv-browser.js";
import { LOGO_SVG } from "../embed/assets.js";
import { exportChartPng } from "../embed/export-png.js";

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
 *   - Otherwise: "right" when chartType === "stacked" AND seriesCount >= 5; "top" otherwise.
 *   - Diverging detection (any negative _y) could also trigger "right", but series count ≥ 5
 *     covers the main case cleanly; diverging-specific ordering is a visual-pass refinement.
 *
 * The fallback to "top" when the card is too narrow is enforced in mountChart (not here),
 * after the card width is known.
 */
function resolveLegendPosition(
  spec: ChartSpec,
  seriesCount: number,
): "top" | "right" {
  if (spec.legendPosition === "top" || spec.legendPosition === "right") {
    return spec.legendPosition;
  }
  if (spec.chartType === "stacked" && seriesCount >= 5) return "right";
  return "top";
}

type OverlayEl = HTMLElement & { _ro?: ResizeObserver };

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
  const { spec, rows, width: initialWidth, height = FIXED_CHART_HEIGHT } = opts;
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
   * Order legendItems for the right-legend column:
   *   - Series rows in REVERSED declaration order (top-of-stack first, matching visual stack).
   *   - nonInteractive rows (e.g. Total) moved to the END in their original relative order.
   *
   * Note: for diverging stacks the ideal order interleaves positives top-down then negatives;
   * this reversed-series-then-total approximation is correct for the all-positive case and is a
   * good visual approximation for diverging. Exact diverging interleaving can be refined in the
   * visual pass.
   */
  function orderForRightLegend(items: LegendItem[]): LegendItem[] {
    const series = items.filter((i) => !i.nonInteractive);
    const extras = items.filter((i) => i.nonInteractive);
    return [...[...series].reverse(), ...extras];
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
      xAxisTitle, dataInScope, tooltipXParse, tooltipXFormat,
    } = built;

    // Native px — no makeResponsive/viewBox: the SVG keeps its exact pixel width so it
    // overflows into the scroll wrapper below the floor instead of being CSS-scaled down.
    canvas.replaceChildren(svg);

    if (!xTitleAdded) { appendXAxisTitle(canvasScroll, xAxisTitle); xTitleAdded = true; }

    // --- Legend layout ---
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
        const orderedItems = orderForRightLegend(legendItems);
        rightLegendSlot!.replaceChildren();
        renderLegend(rightLegendSlot!, orderedItems, { svg });
        // Add vertical class to the rendered legend element.
        const legendEl = rightLegendSlot!.querySelector(".tbl-legend");
        if (legendEl) legendEl.classList.add("tbl-legend--vertical");
        // Ensure top legend slot stays empty.
        legendSlot.replaceChildren();
      } else {
        // Top legend (default behavior — unchanged).
        legendSlot.replaceChildren();
        renderLegend(legendSlot, legendItems, { svg });
      }
    }

    currentLegendPos = legendPos;

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

    currentOverlay?._ro?.disconnect();
    currentOverlay?.remove();
    currentOverlay = attachYAxisOverlay(canvasScroll, svg);
  };

  // Initial draw: we don't know the series count yet, so render first to get legendItems,
  // then resolve legendPosition from the result. Use initialWidth or a fallback for the
  // very first render (before the ResizeObserver fires).
  const initialCardWidth = card.clientWidth || initialWidth || 720;
  // Quick pre-render to detect series count (width doesn't matter for position resolution).
  let prelimSeriesCount = 1;
  try {
    const prelim = renderChart(spec, rows, { width: initialCardWidth, height });
    prelimSeriesCount = (prelim.legendItems ?? []).filter((i) => !i.nonInteractive).length;
  } catch {
    // Ignore — draw() will surface the error.
  }
  // Fall back to top if the card is too narrow for the right-legend column.
  const resolvedPos = (): "top" | "right" => {
    const pos = resolveLegendPosition(spec, prelimSeriesCount);
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
        const pos = resolveLegendPosition(spec, prelimSeriesCount);
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
