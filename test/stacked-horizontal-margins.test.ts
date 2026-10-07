// @vitest-environment jsdom
//
// A horizontal stacked bar's value axis sits at the bottom with a short tick row, so its margins
// are a horizontal bar's, not the vertical category margin it used to inherit. That inherited margin
// is sized for 45°-rotated category labels under a vertical chart (bandLabelMarginBottom, capped at
// 120), so long category names left ~100px of empty canvas under the axis (PR #67's two stacks).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { renderChart } from "../src/engine/index";
import { mountChart } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import { INNER_W } from "../src/embed/figure-chrome";
import { horizontalBarChartHeight } from "../src/engine/figure";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

// jsdom has no canvas: return null quietly; text measurement takes the same fallback either way.
const realGetContext = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
});

// The shape of pr67's revenue-by-tax-step-up: long category names, a five-series stack.
const SPEC: ChartSpec = {
  chartType: "stacked",
  orientation: "horizontal",
  title: "Revenue by tax provision",
  xAxisType: "categorical",
  columns: { x: "bar", series: "tax", value: "v" },
  series_order: ["Income tax", "Capital gains", "Payroll", "Corporate"],
  barStack: { netDisplay: "text" },
  data: "d.csv",
};
const BARS = [
  "Capital gains: before response",
  "Capital gains: after mechanical adjustments",
  "Capital gains: after behavioral response",
  "+ Corporate: before response",
  "+ Corporate: after mechanical adjustments",
  "+ Corporate: after behavioral response",
];
const ROWS = BARS.flatMap((bar, i) =>
  ["Income tax", "Capital gains", "Payroll", "Corporate"].map((tax, j) => ({ bar, tax, v: String(20 + 10 * i + 5 * j) })),
) as unknown as TidyRow[];

const margins = (svg: SVGSVGElement) => ({ top: Number(svg.dataset.marginTop), bottom: Number(svg.dataset.marginBottom) });

/** Absolute y of an element: its own translate plus every ancestor translate below the svg. */
function absY(el: Element, svg: Element): number {
  let y = Number(el.getAttribute("y")) || 0;
  for (let n: Element | null = el; n && n !== svg; n = n.parentElement) {
    const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(n.getAttribute("transform") ?? "");
    if (m) y += Number(m[2]);
  }
  return y;
}

describe("horizontal stacked bars: value-axis margins", () => {
  it("long category labels give the horizontal-bar margins, not the rotated-label margin", () => {
    const { svg } = renderChart(SPEC, ROWS, { width: 720, height: 400, document });
    expect(margins(svg)).toEqual({ top: 18, bottom: 26 });
  });

  it("the content fills the SVG: under 10px of empty canvas below the value-tick row", () => {
    const { svg } = renderChart(SPEC, ROWS, { width: 720, height: 400, document });
    const h = Number(svg.getAttribute("height"));
    // The value-tick row is the lowest text; its glyphs reach about half a font size below the
    // baseline-anchored y.
    let lowest = -Infinity;
    for (const t of Array.from(svg.querySelectorAll("text"))) {
      const fs = Number(t.closest("[font-size]")?.getAttribute("font-size")) || 10;
      lowest = Math.max(lowest, absY(t, svg) + fs / 2);
    }
    expect(h - lowest).toBeGreaterThanOrEqual(0);
    expect(h - lowest).toBeLessThan(10);
  });

  for (const ticks of ["bottom", "top", "both"] as const) {
    it(`x_axis_ticks: ${ticks} — the margins equal a horizontal bar's`, () => {
      const stacked = renderChart({ ...SPEC, x_axis_ticks: ticks }, ROWS, { width: 720, height: 400, document }).svg;
      const bar = renderChart(
        { ...SPEC, chartType: "bar", barStack: undefined, x_axis_ticks: ticks },
        ROWS,
        { width: 720, height: 400, document },
      ).svg;
      expect(margins(stacked)).toEqual(margins(bar));
    });
  }

  it("the PNG export lays the stack out like the live chart (shared row-sized height)", () => {
    const root = buildExportSvg(SPEC, ROWS);
    const chart = Array.from(root.querySelectorAll("svg")).reduce((a, b) =>
      Number(b.getAttribute("width") ?? 0) > Number(a.getAttribute("width") ?? 0) ? b : a,
    ) as SVGSVGElement;
    expect(Number(chart.getAttribute("width"))).toBe(INNER_W);

    const container = document.createElement("div");
    document.body.appendChild(container);
    mountChart(container, { spec: SPEC, rows: ROWS, width: INNER_W });
    const live = container.querySelector('g[aria-label="bar"] rect')!.closest("svg") as SVGSVGElement;

    expect(Number(chart.getAttribute("height"))).toBe(horizontalBarChartHeight(SPEC, ROWS));
    expect(Number(live.getAttribute("height"))).toBe(horizontalBarChartHeight(SPEC, ROWS));
    expect(margins(chart)).toEqual(margins(live));
    expect(margins(chart)).toEqual({ top: 18, bottom: 26 });
    const rectYs = (s: SVGSVGElement) =>
      Array.from(s.querySelectorAll('g[aria-label="bar"] rect')).map((r) => absY(r, s));
    expect(rectYs(chart)).toEqual(rectYs(live));
  });
});
