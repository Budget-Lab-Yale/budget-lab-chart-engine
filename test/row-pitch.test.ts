// @vitest-environment jsdom
//
// A chart whose height grows with its rows (growsWithRows: horizontal bar/stacked, horizontal
// dumbbell) keeps its row pitch however few rows it has: a 3-row chart is simply short. Until 1.16
// the height was floored at 400px, so a 3-row chart's rows stretched to ~100px apart. Below the old
// floor the height is fitted to the rendered row band (figure.ts fitRowsHeight), so the rows sit at
// exactly the slot pitch.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { renderChart } from "../src/engine/index";
import { mountChart, computeChartHeight } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import { INNER_W } from "../src/embed/figure-chrome";
import { horizontalBarChartHeight, HORIZONTAL_PX_PER_BAR } from "../src/engine/figure";
import { rowBandGeometry } from "../src/engine/marks/category-band";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const realGetContext = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
});
beforeEach(() => {
  document.body.innerHTML = "";
});

function translateY(el: Element, svg: Element): number {
  let y = 0;
  for (let n: Element | null = el; n && n !== svg; n = n.parentElement) {
    const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(n.getAttribute("transform") ?? "");
    if (m) y += Number(m[2]);
  }
  return y;
}

/** Row centres top to bottom: one per category label. */
const rowCentres = (svg: SVGSVGElement): number[] =>
  Array.from(svg.querySelectorAll("g.tbl-cat-label text"))
    .map((t) => translateY(t, svg))
    .sort((a, b) => a - b);

/** The row pitch within each section: centre-to-centre steps, less any section gap. */
function pitchesOf(svg: SVGSVGElement, nRows: number): number[] {
  const c = rowCentres(svg);
  expect(c).toHaveLength(nRows);
  const steps = c.slice(1).map((v, i) => +(v - c[i]!).toFixed(3));
  const pitch = Math.min(...steps);
  return steps.filter((s) => s < pitch + 1);
}

/** The single pitch every row of `svg` sits at (asserts there is only one). */
function pitchOf(svg: SVGSVGElement, nRows: number): number {
  const ps = [...new Set(pitchesOf(svg, nRows))];
  expect(ps).toHaveLength(1);
  return ps[0]!;
}

/** The chart SVG the export composed (the widest nested svg). */
const exportChartOf = (root: SVGSVGElement): SVGSVGElement =>
  Array.from(root.querySelectorAll("svg")).reduce((a, b) =>
    Number(b.getAttribute("width") ?? 0) > Number(a.getAttribute("width") ?? 0) ? b : a,
  ) as SVGSVGElement;

/** The live mount's chart SVG (the one carrying the category labels). */
function liveChart(spec: ChartSpec, rows: TidyRow[], width: number): SVGSVGElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  mountChart(container, { spec, rows, width });
  const label = container.querySelector("g.tbl-cat-label text");
  expect(label).not.toBeNull();
  return label!.closest("svg") as SVGSVGElement;
}

const BAR: ChartSpec = {
  chartType: "bar",
  orientation: "horizontal",
  title: "Bars",
  xAxisType: "categorical",
  columns: { x: "cat", value: "v" },
  data: "x",
} as ChartSpec;

const DUMBBELL: ChartSpec = {
  chartType: "dumbbell",
  orientation: "horizontal",
  title: "Dumbbell",
  xAxisType: "categorical",
  columns: { category: "cat", series: "m", value: "v" },
  series_order: ["Before", "After"],
  data: "x",
} as ChartSpec;

const cats = (n: number, prefix = "Q"): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
const barRows = (cs: string[]): TidyRow[] => cs.map((c, i) => ({ cat: c, v: String(10 + i) })) as unknown as TidyRow[];
const dumbbellRows = (cs: string[], pane?: string): TidyRow[] =>
  cs.flatMap((c, i) => [
    { cat: c, m: "Before", v: String(10 + 3 * i), ...(pane ? { pane } : {}) },
    { cat: c, m: "After", v: String(20 + 4 * i), ...(pane ? { pane } : {}) },
  ]) as unknown as TidyRow[];

describe("standalone horizontal charts below the old 400px floor keep the slot pitch", () => {
  const cases: [string, ChartSpec, (cs: string[]) => TidyRow[]][] = [
    ["horizontal bar", BAR, barRows],
    ["horizontal dumbbell", DUMBBELL, (cs) => dumbbellRows(cs)],
  ];
  for (const [name, spec, rowsOf] of cases) {
    it(`${name}: a 3-row chart is short, its rows exactly one slot apart (live)`, () => {
      const rows = rowsOf(cats(3));
      const h = computeChartHeight(spec, rows);
      expect(h).toBeLessThan(200);
      expect(horizontalBarChartHeight(spec, rows)).toBe(h);
      const live = liveChart(spec, rows, 720);
      expect(Number(live.getAttribute("height"))).toBe(h);
      expect(pitchOf(live, 3)).toBe(HORIZONTAL_PX_PER_BAR);
    });

    it(`${name}: the PNG export draws the 3-row chart at the live height and pitch`, () => {
      const rows = rowsOf(cats(3));
      const chart = exportChartOf(buildExportSvg(spec, rows));
      expect(Number(chart.getAttribute("width"))).toBe(INNER_W);
      const live = liveChart(spec, rows, INNER_W);
      expect(Number(chart.getAttribute("height"))).toBe(Number(live.getAttribute("height")));
      expect(rowCentres(chart)).toEqual(rowCentres(live));
    });

    it(`${name}: a single row is its margins plus one row's band`, () => {
      const rows = rowsOf(cats(1));
      const h = computeChartHeight(spec, rows);
      const band = rowBandGeometry(spec.chartType, spec.x_axis_ticks, false);
      // One row's band step: the slot over max(1, 1 − inner + 2·outer) steps.
      expect(h).toBe(band.margins + Math.ceil(HORIZONTAL_PX_PER_BAR * Math.max(1, 1 - band.inner + 2 * band.outer)));
      const svg = renderChart(spec, rows, { width: 720, height: h, heightFromModel: true, document }).svg;
      expect(Number(svg.dataset.marginTop) + Number(svg.dataset.marginBottom)).toBe(band.margins);
    });
  }

  it("a chart the old floor never touched keeps its height (24 rows: rows x slot + 80)", () => {
    expect(computeChartHeight(BAR, barRows(cats(24)))).toBe(24 * HORIZONTAL_PX_PER_BAR + 80);
  });
});

// Every builder variant the height model mirrors (rowBandGeometry): the rendered margins match it,
// and the rows land at exactly the slot pitch. A builder whose band padding or margins drift from
// the model fails here.
describe("rowBandGeometry matches what each builder renders", () => {
  const seriesRows = (cs: string[], series: string[], section?: (i: number) => string): TidyRow[] =>
    cs.flatMap((c, i) =>
      series.map((s, j) => ({ cat: c, s, v: String(10 + i + j), m: s, ...(section ? { sec: section(i) } : {}) })),
    ) as unknown as TidyRow[];
  const half = (i: number): string => (i < 2 ? "First" : "Second");
  type Case = [string, ChartSpec, TidyRow[], number, number];
  const n = 4;
  const variants: Case[] = [];
  for (const ticks of [undefined, "top", "both"] as const) {
    const t = ticks ? { x_axis_ticks: ticks } : {};
    variants.push(
      [`bar single ${ticks ?? "bottom"}`, { ...BAR, ...t } as ChartSpec, seriesRows(cats(n), ["A"]), n, 22],
      [`bar grouped ${ticks ?? "bottom"}`, { ...BAR, ...t, columns: { x: "cat", value: "v", series: "s" } } as ChartSpec, seriesRows(cats(n), ["A", "B"]), n, 44],
      [`stacked ${ticks ?? "bottom"}`, { ...BAR, ...t, chartType: "stacked", columns: { x: "cat", value: "v", series: "s" } } as ChartSpec, seriesRows(cats(n), ["A", "B"]), n, 22],
      [`bar sectioned ${ticks ?? "bottom"}`, { ...BAR, ...t, columns: { x: "cat", value: "v", section: "sec" } } as ChartSpec, seriesRows(cats(n), ["A"], half), n, 22],
      [`stacked sectioned ${ticks ?? "bottom"}`, { ...BAR, ...t, chartType: "stacked", columns: { x: "cat", value: "v", series: "s", section: "sec" } } as ChartSpec, seriesRows(cats(n), ["A", "B"], half), n, 22],
    );
  }
  variants.push(
    ["dumbbell", DUMBBELL, seriesRows(cats(n), ["Before", "After"]), n, 22],
    ["dumbbell sectioned", { ...DUMBBELL, columns: { ...DUMBBELL.columns, section: "sec" } } as ChartSpec, seriesRows(cats(n), ["Before", "After"], half), n, 22],
    // Long labels wrap in the gutter: the slot is the wrapped-label budget, not the bar budget.
    ["dumbbell, wrapped labels", DUMBBELL, seriesRows(cats(n, "A category label long enough that it has to wrap onto lines "), ["Before", "After"]), n, -1],
  );
  for (const [name, spec, rows, nRows, slot] of variants) {
    it(`${name}`, () => {
      const h = computeChartHeight(spec, rows);
      expect(h).toBeLessThan(400);
      const live = liveChart(spec, rows, 720);
      const sectioned = name.includes("sectioned");
      expect(Number(live.dataset.marginTop) + Number(live.dataset.marginBottom)).toBe(
        rowBandGeometry(spec.chartType, spec.x_axis_ticks, sectioned).margins,
      );
      const pitch = pitchOf(live, nRows);
      if (slot > 0) expect(pitch).toBe(slot);
      else expect(pitch).toBeGreaterThan(HORIZONTAL_PX_PER_BAR);
    });
  }

  it("an unsectioned horizontal dumbbell's bottom margin does not grow with long labels", () => {
    const rows = seriesRows(cats(3, "Top 1% by net worth and quite a few more words "), ["Before", "After"]);
    for (const width of [720, 400]) {
      const svg = renderChart(DUMBBELL, rows, { width, height: 300, document }).svg;
      expect(Number(svg.dataset.marginBottom)).toBe(22);
    }
  });
});
