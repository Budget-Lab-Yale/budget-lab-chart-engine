// @vitest-environment jsdom
//
// `legendPosition: right` with no legend rows to show reserves no column, on every chart type,
// live as in the PNG: the plot takes the card's full width. The export always did this
// (legendInRightColumn); the live card reserved the column's width anyway on every chart type but a
// treemap, so the two drew the plot at different widths.
import { describe, it, expect, afterEach } from "vitest";
import { renderChart } from "../src/engine/index";
import { mountChart } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import { INNER_W } from "../src/embed/figure-chrome";
import { LEGEND_COLUMN_WIDTH, LEGEND_GAP } from "../src/engine/legend-layout";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const RIGHT_W = INNER_W - LEGEND_COLUMN_WIDTH - LEGEND_GAP;

const LINE = { chartType: "line", title: "L", xAxisType: "categorical", data: "d.csv", legendPosition: "right" } as ChartSpec;
const LINE_ROWS = [{ time: "X", series: "A", value: "3" }, { time: "Y", series: "A", value: "2" }] as TidyRow[];

const STACKED = { chartType: "stacked", title: "S", xAxisType: "categorical", data: "d.csv", legendPosition: "right" } as ChartSpec;
const STACKED_ROWS = ["X", "Y"].flatMap((time) => [
  { time, series: "A", value: "3" }, { time, series: "B", value: "2" },
]) as TidyRow[];

const DIVERGING_ROWS = STACKED_ROWS.map((r) => (r.series === "A" ? { ...r, value: "-3" } : r)) as TidyRow[];

const TIMELINE = {
  chartType: "timeline", title: "T", xAxisType: "temporal", data: "d.csv", legendPosition: "right",
  columns: { x: "date", label: "title", series: "kind" }, series_order: ["policy", "cohort"], timeline: { lanes: true },
} as ChartSpec;
const TIMELINE_ROWS = [
  { date: "2026", title: "Policy begins", kind: "policy" }, { date: "2030", title: "First cohort born", kind: "policy" },
  { date: "2055", title: "Projection ends", kind: "cohort" }, { date: "2095", title: "Cohort turns 65", kind: "cohort" },
] as TidyRow[];

function mount(spec: ChartSpec, rows: TidyRow[], width = INNER_W): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  mountChart(host, { spec, rows, width });
  return host;
}
/** The chart svg the live card drew (the canvas's own svg, whatever the chart type). */
const liveSvg = (host: HTMLElement): SVGSVGElement => host.querySelector<SVGSVGElement>(".figure-canvas-scroll svg")!;
/** The chart svg the export composed: the widest nested svg. */
const exportSvg = (spec: ChartSpec, rows: TidyRow[]): SVGSVGElement => {
  const nested = [...buildExportSvg(spec, rows).querySelectorAll("svg")];
  return nested.reduce((a, b) => (Number(b.getAttribute("width")) > Number(a.getAttribute("width")) ? b : a));
};
const widthOf = (svg: SVGSVGElement): number => Number(svg.getAttribute("width"));

afterEach(() => document.body.replaceChildren());

describe("legendPosition: right with no legend rows", () => {
  const cases: Array<[string, ChartSpec, TidyRow[]]> = [
    ["a single-series line", LINE, LINE_ROWS],
    ["a stacked chart with series_legend: false", { ...STACKED, series_legend: false } as ChartSpec, STACKED_ROWS],
    ["a horizontal timeline whose lanes name the categories", TIMELINE, TIMELINE_ROWS],
    // Defaulted, not explicit: diverging resolves "right", but with no net dot there is no Total row.
    ["a diverging stacked chart with series_legend: false and no net dot (defaulted right)",
      { ...STACKED, legendPosition: undefined, series_legend: false, barStack: { netDisplay: "none" } } as ChartSpec, DIVERGING_ROWS],
  ];
  for (const [name, spec, rows] of cases) {
    it(`${name} draws at the full card width live, as in the PNG`, () => {
      // Precondition: the chart really has no legend rows (else this is not the case under test).
      expect(renderChart(spec, rows, { width: INNER_W }).legendItems ?? []).toHaveLength(0);
      const host = mount(spec, rows);
      expect(host.querySelector(".figure-body--legend-right")).toBeNull();
      expect(widthOf(liveSvg(host))).toBe(INNER_W);
      expect(widthOf(exportSvg(spec, rows))).toBe(INNER_W);
    });
  }

  it("a chart WITH legend rows keeps its right-hand column, live and in the PNG", () => {
    const host = mount(STACKED, STACKED_ROWS);
    expect(host.querySelectorAll(".figure-legend-slot--right .tbl-legend-item[data-series]")).toHaveLength(2);
    expect(widthOf(liveSvg(host))).toBe(RIGHT_W);
    expect(widthOf(exportSvg(STACKED, STACKED_ROWS))).toBe(RIGHT_W);
  });

  it("a diverging stacked chart with series_legend: false keeps the column for its Total row (defaulted right)", () => {
    const spec = { ...STACKED, legendPosition: undefined, series_legend: false } as ChartSpec;
    const host = mount(spec, DIVERGING_ROWS);
    expect(host.querySelector(".figure-legend-slot--right .tbl-legend-item")).not.toBeNull();
    expect(widthOf(liveSvg(host))).toBe(RIGHT_W);
    expect(widthOf(exportSvg(spec, DIVERGING_ROWS))).toBe(RIGHT_W);
  });
});
