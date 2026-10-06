// @vitest-environment jsdom
//
// A right-hand legend column taller than the plot must grow the export FRAME, not the PLOT. The
// export used to replace the chart's own height with the legend's and render the chart at that, so
// a tall legend stretched the downloaded plot and moved its rows away from where the live card
// draws them (Ruling 71; Codex F14 review). The live card keeps computeChartHeight's height and
// lets the legend column run past it.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mountChart, computeChartHeight } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import { INNER_W } from "../src/embed/figure-chrome";
import { LEGEND_COLUMN_WIDTH, LEGEND_GAP } from "../src/engine/legend-layout";
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

const CHART_W = INNER_W - LEGEND_COLUMN_WIDTH - LEGEND_GAP;

// Codex repro 1: one category, thirty series — a 400px plot beside a far taller legend column.
const STACKED: ChartSpec = {
  chartType: "stacked",
  orientation: "horizontal",
  title: "T",
  xAxisType: "categorical",
  columns: { x: "g", value: "v", series: "s" },
  note: "n",
  source: "s",
  data: "d.csv",
} as unknown as ChartSpec;
const STACKED_ROWS = Array.from({ length: 30 }, (_, i) => ({
  g: "Group",
  s: `Series ${i}`,
  v: String(i + 1),
})) as unknown as TidyRow[];

// Codex repro 2: seven categories, two series with very long labels in a right column.
const LONG_A = "Cash income " + "Long descriptive label ".repeat(8);
const LONG_B = "Accrual income " + "Long descriptive label ".repeat(8);
const DUMBBELL: ChartSpec = {
  chartType: "dumbbell",
  orientation: "horizontal",
  legendPosition: "right",
  title: "T",
  xAxisType: "categorical",
  columns: { category: "c", series: "m", value: "v" },
  series_order: [LONG_A, LONG_B],
  data: "d.csv",
} as unknown as ChartSpec;
const DUMBBELL_ROWS = Array.from({ length: 7 }, (_, i) => [
  { c: `Group ${i + 1}`, m: LONG_A, v: String(20 + i) },
  { c: `Group ${i + 1}`, m: LONG_B, v: String(8 + i) },
]).flat() as unknown as TidyRow[];

/** The export's chart svg: the nested svg drawn at the right-legend chart width. */
const exportChartOf = (root: SVGSVGElement): SVGSVGElement => {
  const svg = Array.from(root.querySelectorAll("svg")).find((s) => Number(s.getAttribute("width")) === CHART_W);
  expect(svg, "export chart svg at the right-legend width").toBeDefined();
  return svg as SVGSVGElement;
};

/** The live mount's chart svg, mounted on a card as wide as the export's inner width. */
function liveChartOf(spec: ChartSpec, rows: TidyRow[]): { svg: SVGSVGElement; container: HTMLElement } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  mountChart(container, { spec, rows, width: INNER_W });
  // Precondition: live lays this chart out with a right-hand legend column.
  expect(container.querySelector(".figure-legend-slot--right")).not.toBeNull();
  const svg = container.querySelector(".figure-canvas svg") as SVGSVGElement | null;
  expect(svg).not.toBeNull();
  return { svg: svg!, container };
}

/** Every bar rect and dot, by its data keys, with its y and height inside its chart svg. */
function markGeometry(svg: SVGSVGElement): string[] {
  const out: string[] = [];
  for (const el of Array.from(svg.querySelectorAll('g[aria-label="bar"] rect, g[aria-label="dot"] circle'))) {
    let dy = 0;
    for (let n: Element | null = el.parentElement; n && n !== svg; n = n.parentElement) {
      const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(n.getAttribute("transform") ?? "");
      if (m) dy += Number(m[2]);
    }
    const y = el.tagName === "circle" ? Number(el.getAttribute("cy")) : Number(el.getAttribute("y"));
    out.push(
      `${el.getAttribute("data-category") ?? ""}|${el.getAttribute("data-series") ?? ""}|${y + dy}|${el.getAttribute("height") ?? ""}`,
    );
  }
  return out.sort();
}

describe("a tall right-hand legend grows the export frame, not the plot", () => {
  const cases: [string, ChartSpec, TidyRow[], number][] = [
    ["horizontal stacked, 30 series in one category", STACKED, STACKED_ROWS, 30],
    ["horizontal dumbbell, 7 categories, two very long series labels", DUMBBELL, DUMBBELL_ROWS, 14],
  ];
  for (const [name, spec, rows, nMarks] of cases) {
    it(`${name}: the plot keeps its live height and every mark sits where it does live`, () => {
      const root = buildExportSvg(spec, rows);
      const chart = exportChartOf(root);
      const { svg: live } = liveChartOf(spec, rows);

      const liveH = Number(live.getAttribute("height"));
      expect(liveH).toBe(computeChartHeight(spec, rows));
      expect(Number(chart.getAttribute("height"))).toBe(liveH);

      const exportMarks = markGeometry(chart);
      expect(exportMarks.length).toBeGreaterThanOrEqual(nMarks);
      expect(exportMarks).toEqual(markGeometry(live));

      // Non-vacuity: the legend column really is taller than the plot here, and the frame grows to
      // hold all of it (every legend label above the frame's bottom, below the plot's top).
      const chartTop = Number(chart.getAttribute("y"));
      const frameH = Number(root.getAttribute("height"));
      const legendYs = Array.from(root.querySelectorAll("text"))
        .filter((t) => t.closest("svg") === root)
        .filter((t) => Number(t.getAttribute("x")) >= Number(chart.getAttribute("x")) + CHART_W + LEGEND_GAP)
        .map((t) => Number(t.getAttribute("y")));
      expect(legendYs.length).toBeGreaterThan(0);
      const legendBottom = Math.max(...legendYs);
      expect(legendBottom).toBeGreaterThan(chartTop + liveH);
      expect(frameH).toBeGreaterThan(legendBottom);
      for (const y of legendYs) expect(y).toBeGreaterThan(chartTop);
    });
  }
});
