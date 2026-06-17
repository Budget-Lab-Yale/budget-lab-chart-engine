// Live-render layer: mounts a fully interactive chart card into a container element.
// Wires the pure engine (renderChart) to the DOM-only live primitives: legend,
// crosshair, source line, and makeResponsive. No resize re-render — the SVG is
// made responsive via viewBox scaling. Mirror of createChartController / buildCard
// in the tracker's charts.js, minus the scroll wrapper, sticky y-axis overlay,
// selectors/variants, and x-axis-title overlay.
import type { ChartSpec } from "../spec/types.js";
import type { TidyRow } from "../data/index.js";
import { renderChart } from "./index.js";
import { renderLegend } from "./legend.js";
import { attachCrosshair } from "./crosshair.js";
import { renderSourceLine } from "./source-line.js";
import { makeResponsive } from "./axes.js";
import { rowsToCsvBrowser } from "../data/csv-browser.js";
import { LOGO_SVG } from "../embed/assets.js";
import { exportChartPng } from "../embed/export-png.js";

export interface MountOptions {
  spec: ChartSpec;
  rows: TidyRow[];
  width?: number;
  height?: number;
}

/** Format a numeric value for tooltip display. */
function formatValue(v: number, units: string): string {
  if (!Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}${units}`;
}

// Tray-with-down-arrow glyph — inlined so the bundle stays self-contained.
// Ported from the tracker's charts.js DOWNLOAD_ICON constant.
const DOWNLOAD_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">' +
  '<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" ' +
  'stroke-linejoin="round" d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13h10"/></svg>';

/** Convert a chart title to a kebab-case filename slug. */
function titleToSlug(title: string | undefined): string {
  if (!title) return "chart";
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Mount a fully interactive chart card into `container`.
 *
 * Card structure (mirrors tracker's buildCard + createChartController):
 *   div.figure-card
 *     div.figure-header
 *       div.figure-header-text
 *         div.figure-supertitle  (if spec.eyebrow)
 *         h3.figure-title        (if spec.title)
 *         p.figure-subtitle      (if spec.subtitle)
 *       svg.figure-logo          (inline TBL logo)
 *     div.figure-legend-slot
 *     div.figure-canvas          ← SVG goes here
 *   div.figure-meta              (note + source + download buttons, via renderSourceLine)
 */
export function mountChart(container: HTMLElement, opts: MountOptions): void {
  const { spec, rows, width = 720, height = 400 } = opts;

  // Build the card DOM.
  const card = container.ownerDocument.createElement("div");
  card.className = "figure-card";

  // Header: eyebrow (full width) above a title row; the title row holds the title on the
  // left and the logo top-right, with the logo's wordmark baseline aligned to the title's
  // first-line baseline (see .figure-titlebar / .figure-logo in styles.ts). Subtitle below.
  const header = container.ownerDocument.createElement("div");
  header.className = "figure-header";

  // Eyebrow (e.g. "Figure 1") above the title row, if the spec carries one.
  if (spec.eyebrow) {
    const eyebrow = container.ownerDocument.createElement("div");
    eyebrow.className = "figure-supertitle";
    eyebrow.textContent = spec.eyebrow;
    header.appendChild(eyebrow);
  }

  // Title row: title (left) + logo (right), baseline-aligned.
  const titlebar = container.ownerDocument.createElement("div");
  titlebar.className = "figure-titlebar";

  if (spec.title) {
    const h = container.ownerDocument.createElement("h3");
    h.className = "figure-title";
    h.textContent = spec.title;
    titlebar.appendChild(h);
  }

  // Logo — inline SVG so no external request is needed.
  const logoWrapper = container.ownerDocument.createElement("div");
  logoWrapper.className = "figure-logo";
  logoWrapper.innerHTML = LOGO_SVG;
  titlebar.appendChild(logoWrapper);

  header.appendChild(titlebar);

  if (spec.subtitle) {
    const s = container.ownerDocument.createElement("p");
    s.className = "figure-subtitle";
    s.textContent = spec.subtitle;
    header.appendChild(s);
  }

  card.appendChild(header);

  const legendSlot = container.ownerDocument.createElement("div");
  legendSlot.className = "figure-legend-slot";
  card.appendChild(legendSlot);

  const canvas = container.ownerDocument.createElement("div");
  canvas.className = "figure-canvas";
  card.appendChild(canvas);

  container.appendChild(card);

  // Render the chart — no `document` option, engine uses global (browser / jsdom).
  const {
    svg,
    legendItems,
    seriesLabels,
    seriesOrder,
    dashedNames,
    colors,
    units,
    dataInScope,
    tooltipXParse,
    tooltipXFormat,
  } = renderChart(spec, rows, { width, height });

  // Make the SVG responsive (viewBox-based scaling).
  makeResponsive(svg);
  canvas.appendChild(svg);

  // Legend: only when 2+ series or any series has a style override.
  if (legendItems !== null) {
    renderLegend(legendSlot, legendItems, { svg });
  }

  // Crosshair tooltip.
  attachCrosshair(svg, {
    rows: dataInScope.map((r) => ({ time: r.time, series: r.series, value: r._y })),
    xField: "time",
    yField: "value",
    seriesField: "series",
    // tooltipXParse is typed (v: string) => number in the engine but crosshair
    // declares (v: unknown) => number; widen via cast since the values are always
    // strings at runtime.
    xParse: tooltipXParse as ((v: unknown) => number) | undefined,
    xFormat: tooltipXFormat,
    yFormat: (v) => formatValue(v, units),
    colors,
    dashedSeries: dashedNames,
    seriesLabels,
    seriesOrder,
  });

  // --- Download buttons ---
  const doc = container.ownerDocument;
  const downloads = doc.createElement("div");
  downloads.className = "figure-downloads";

  // Data (CSV) download button
  const dataBtn = doc.createElement("button");
  dataBtn.type = "button";
  dataBtn.className = "figure-download-btn";
  dataBtn.setAttribute("aria-label", "Download data (CSV)");
  dataBtn.innerHTML = `${DOWNLOAD_ICON}<span>Data</span>`;
  const dataLabel = dataBtn.querySelector("span")!;
  dataBtn.addEventListener("click", () => {
    const original = dataLabel.textContent ?? "Data";
    dataBtn.disabled = true;
    try {
      const csv = rowsToCsvBrowser(rows);
      const slug = titleToSlug(spec.title);
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = doc.createElement("a");
      a.href = url;
      a.download = `${slug}.csv`;
      doc.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      console.error("Data download failed:", err);
      dataLabel.textContent = "Failed";
      setTimeout(() => {
        dataLabel.textContent = original;
        dataBtn.disabled = false;
      }, 2000);
      return;
    }
    dataBtn.disabled = false;
  });
  downloads.appendChild(dataBtn);

  // Image (PNG) download button
  const imgBtn = doc.createElement("button");
  imgBtn.type = "button";
  imgBtn.className = "figure-download-btn";
  imgBtn.setAttribute("aria-label", "Download image (PNG)");
  imgBtn.innerHTML = `${DOWNLOAD_ICON}<span>Image</span>`;
  const imgLabel = imgBtn.querySelector("span")!;
  imgBtn.addEventListener("click", async () => {
    const original = imgLabel.textContent ?? "Image";
    imgBtn.disabled = true;
    imgLabel.textContent = "…";
    try {
      await exportChartPng(spec, rows);
    } catch (err) {
      console.error("Image export failed:", err);
      imgLabel.textContent = "Failed";
      setTimeout(() => {
        imgLabel.textContent = original;
        imgBtn.disabled = false;
      }, 2000);
      return;
    }
    imgLabel.textContent = original;
    imgBtn.disabled = false;
  });
  downloads.appendChild(imgBtn);

  // Note + source line appended to the card (after the canvas), with download buttons.
  renderSourceLine(card, { note: spec.note, source: spec.source, actions: downloads });
}
