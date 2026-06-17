// Live-render layer: mounts a fully interactive chart card into a container element.
// Wires the pure engine (renderChart) to the DOM-only live primitives: legend,
// crosshair, source line, and makeResponsive. No resize re-render — the SVG is
// made responsive via viewBox scaling. Mirror of createChartController / buildCard
// in the tracker's charts.js, minus the scroll wrapper, sticky y-axis overlay,
// download buttons, selectors/variants, and x-axis-title overlay.
import type { ChartSpec } from "../spec/types";
import type { TidyRow } from "../data/index";
import { renderChart } from "./index";
import { renderLegend } from "./legend";
import { attachCrosshair } from "./crosshair";
import { renderSourceLine } from "./source-line";
import { makeResponsive } from "./axes";

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

/**
 * Mount a fully interactive chart card into `container`.
 *
 * Card structure (mirrors tracker's buildCard + createChartController):
 *   div.figure-card
 *     h3.figure-title        (if spec.title)
 *     p.figure-subtitle      (if spec.subtitle)
 *     div.figure-legend-slot
 *     div.figure-canvas      ← SVG goes here
 *   div.figure-meta          (note + source, via renderSourceLine)
 */
export function mountChart(container: HTMLElement, opts: MountOptions): void {
  const { spec, rows, width = 720, height = 400 } = opts;

  // Build the card DOM.
  const card = container.ownerDocument.createElement("div");
  card.className = "figure-card";

  // Eyebrow (e.g. "Figure 1") above the title, if the spec carries one.
  if (spec.eyebrow) {
    const eyebrow = container.ownerDocument.createElement("div");
    eyebrow.className = "figure-supertitle";
    eyebrow.textContent = spec.eyebrow;
    card.appendChild(eyebrow);
  }

  if (spec.title) {
    const h = container.ownerDocument.createElement("h3");
    h.className = "figure-title";
    h.textContent = spec.title;
    card.appendChild(h);
  }

  if (spec.subtitle) {
    const s = container.ownerDocument.createElement("p");
    s.className = "figure-subtitle";
    s.textContent = spec.subtitle;
    card.appendChild(s);
  }

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

  // Note + source line appended to the card (after the canvas).
  renderSourceLine(card, { note: spec.note, source: spec.source });
}
