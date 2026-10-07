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
    ["a positive-only stacked chart with series_legend: false (no Total row at the default netDisplay)", { ...STACKED, series_legend: false } as ChartSpec, STACKED_ROWS],
    ["a horizontal timeline whose lanes name the categories", TIMELINE, TIMELINE_ROWS],
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

});

// CONFIG-SPEC `legendPosition`: a stacked chart's legend has a Total row exactly when
// `barStack.netDisplay` RESOLVES to a dot — an explicit `dot` always, the default `auto` on a
// diverging chart — and never with `text`, `none` or `normalize` (normalize wins even over `dot`),
// or on a single-series stack (test/stacked-single-series-net.test.ts).
// With `series_legend: false` that row is the legend's only row, so it alone decides the column.
describe("a stacked chart's Total row decides the column when series_legend: false", () => {
  const S = { ...STACKED, series_legend: false } as ChartSpec;
  const keeps: Array<[string, ChartSpec, TidyRow[]]> = [
    ["explicit netDisplay: dot on positive-only data", { ...S, barStack: { netDisplay: "dot" } } as ChartSpec, STACKED_ROWS],
    ["the default auto on a diverging chart (defaulted right)", { ...S, legendPosition: undefined } as ChartSpec, DIVERGING_ROWS],
  ];
  for (const [name, spec, rows] of keeps) {
    it(`${name}: a Total row, so the column stays, live and in the PNG`, () => {
      expect((renderChart(spec, rows, { width: INNER_W }).legendItems ?? []).map((i) => i.label)).toEqual(["Total"]);
      const host = mount(spec, rows);
      expect(host.querySelectorAll(".figure-legend-slot--right .tbl-legend-item")).toHaveLength(1);
      expect(widthOf(liveSvg(host))).toBe(RIGHT_W);
      expect(widthOf(exportSvg(spec, rows))).toBe(RIGHT_W);
    });
  }
  const drops: Array<[string, ChartSpec, TidyRow[]]> = [
    ["netDisplay: text on a diverging chart (defaulted right)", { ...S, legendPosition: undefined, barStack: { netDisplay: "text" } } as ChartSpec, DIVERGING_ROWS],
    ["netDisplay: none on a diverging chart (defaulted right)", { ...S, legendPosition: undefined, barStack: { netDisplay: "none" } } as ChartSpec, DIVERGING_ROWS],
    ["normalize, even with netDisplay: dot", { ...S, barStack: { normalize: true, netDisplay: "dot" } } as ChartSpec, STACKED_ROWS],
    ["the default auto on positive-only data", S, STACKED_ROWS],
  ];
  for (const [name, spec, rows] of drops) {
    it(`${name}: no Total row, so no column, live as in the PNG`, () => {
      expect(renderChart(spec, rows, { width: INNER_W }).legendItems ?? []).toHaveLength(0);
      const host = mount(spec, rows);
      expect(host.querySelector(".figure-body--legend-right")).toBeNull();
      expect(widthOf(liveSvg(host))).toBe(INNER_W);
      expect(widthOf(exportSvg(spec, rows))).toBe(INNER_W);
    });
  }
});

describe("a shape-only legend keeps the column live", () => {
  it("a scatter with series_legend: false keeps the column for its shape rows, live and in the PNG", () => {
    const spec = {
      chartType: "scatter", title: "T", xAxisType: "numeric", data: "d.csv",
      columns: { x: "x", value: "v", shape: "s" }, series_legend: false, legendPosition: "right",
    } as unknown as ChartSpec;
    const rows = [{ x: "1", v: "1", s: "circle" }, { x: "2", v: "2", s: "square" }, { x: "3", v: "3", s: "triangle" }] as unknown as TidyRow[];
    // Precondition: no colour rows; the shape legend is the only legend.
    const r = renderChart(spec, rows, { width: INNER_W });
    expect(r.legendItems ?? []).toHaveLength(0);
    expect(r.shapeLegendItems ?? []).toHaveLength(3);
    const host = mount(spec, rows);
    const col = host.querySelector(".figure-legend-slot--right");
    expect(col).not.toBeNull();
    expect(col!.textContent).toContain("triangle");
    expect(widthOf(liveSvg(host))).toBe(RIGHT_W);
    expect(widthOf(exportSvg(spec, rows))).toBe(RIGHT_W);
  });
});

// render-live.ts decides a non-timeline chart's column from ONE probe render at the mount width
// (specPos), on the assumption that legend rows do not depend on the chart's width. This pins that
// assumption on every legend row source — series, Total, annotation and shape rows — across chart
// types. A row source that starts to vary with width fails here, and specPos must then be asked per
// draw, as it already is for a timeline (whose rows follow its orientation).
describe("legend rows do not depend on the chart's width (the live gate's assumption)", () => {
  const sig = (spec: ChartSpec, rows: TidyRow[], width: number): string => {
    const r = renderChart(spec, rows, { width });
    return JSON.stringify([
      (r.legendItems ?? []).map((i) => [i.series, i.label, !!i.isExtra, !!i.nonInteractive]),
      (r.shapeLegendItems ?? []).map((i) => i.label),
    ]);
  };
  const five = ["X", "Y"].flatMap((time) => ["a", "b", "c", "d", "e"].map((series, i) => ({ time, series, value: String(i + 1) }))) as TidyRow[];
  const cases: Array<[string, ChartSpec, TidyRow[]]> = [
    ["line with an annotation row",
      { ...LINE, annotations: { yAxis: [{ y: 2.5, label: "Threshold", legend: true }] } } as ChartSpec,
      [...LINE_ROWS, ...LINE_ROWS.map((r) => ({ ...r, series: "B" }))] as TidyRow[]],
    ["grouped bar", { ...STACKED, chartType: "bar" } as ChartSpec, STACKED_ROWS],
    ["diverging stacked (Total row)", { ...STACKED, legendPosition: undefined } as ChartSpec, DIVERGING_ROWS],
    ["stacked, five series", { ...STACKED, legendPosition: undefined } as ChartSpec, five],
    ["area", { ...STACKED, chartType: "area" } as ChartSpec, STACKED_ROWS],
    ["dotplot", { ...STACKED, chartType: "dotplot" } as ChartSpec, STACKED_ROWS],
    ["scatter with a shape legend",
      { chartType: "scatter", title: "T", xAxisType: "numeric", data: "d.csv", columns: { x: "x", value: "v", series: "g", shape: "s" } } as unknown as ChartSpec,
      [{ x: "1", v: "1", g: "A", s: "circle" }, { x: "2", v: "2", g: "B", s: "square" }] as unknown as TidyRow[]],
    ["grouped treemap",
      { chartType: "treemap", title: "T", data: "d.csv", columns: { x: "c", value: "v", series: "g" } } as unknown as ChartSpec,
      [{ c: "a1", v: "5", g: "A" }, { c: "a2", v: "3", g: "A" }, { c: "b1", v: "4", g: "B" }] as unknown as TidyRow[]],
  ];
  for (const [name, spec, rows] of cases) {
    it(`${name}: the same rows at 320, 560 and 920px`, () => {
      const at920 = sig(spec, rows, 920);
      expect(JSON.parse(at920).flat().length).toBeGreaterThan(0); // non-vacuous: the chart has rows
      expect(sig(spec, rows, 320)).toBe(at920);
      expect(sig(spec, rows, 560)).toBe(at920);
    });
  }
});
