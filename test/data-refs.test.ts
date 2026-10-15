// @vitest-environment jsdom
//
// The data cross-reference table (src/spec/data-refs.ts), table-driven: for every spec field that
// names a value in the data, on every chart type that accepts the field, a typo is a validation
// error naming the field, and the nearest valid spelling still passes. Histogram, timeline and
// treemap run through their own data paths; each case here proves that path consults the table.
import { describe, it, expect } from "vitest";
import { validateChart, validateChartData } from "../src/spec/validate";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";
import { renderChart } from "../src/engine/index";
import { renderFigure } from "../src/engine/figure";

const spec = (o: Record<string, unknown>): ChartSpec => o as unknown as ChartSpec;

const LINE = { chartType: "line", title: "t", xAxisType: "temporal", data: "d" };
const LINE_ROWS: TidyRow[] = ["a", "b"].flatMap((series, k) => [
  { time: "2021-01-01", series, value: String(1 + k) },
  { time: "2021-02-01", series, value: String(3 + k) },
]);
const LINE_F = { ...LINE, columns: { facet: "f" }, small_multiples: { columns: 2 } };
const LINE_F_ROWS: TidyRow[] = ["P", "Q"].flatMap((f) => LINE_ROWS.map((r) => ({ ...r, f })));

const BAR = { chartType: "bar", title: "t", xAxisType: "categorical", data: "d" };
const BAR_ROWS: TidyRow[] = ["a", "b"].flatMap((series) => [
  { time: "A", series, value: "1" },
  { time: "B", series, value: "2" },
]);
const STACKED = { ...BAR, chartType: "stacked" };

const HBAR_SEC = { ...BAR, orientation: "horizontal", columns: { section: "sec" } };
const HBAR_SEC_ROWS: TidyRow[] = [
  { time: "A", sec: "S1", value: "1" },
  { time: "B", sec: "S2", value: "2" },
];

const DUMBBELL = {
  chartType: "dumbbell", title: "t", xAxisType: "categorical", data: "d",
  columns: { category: "c", series: "s", value: "v" },
};
const DUMBBELL_ROWS: TidyRow[] = ["Q1", "Q2"].flatMap((c) => [
  { c, s: "a", v: "1" },
  { c, s: "b", v: "2" },
]);

const HIST = { chartType: "histogram", title: "t", xAxisType: "numeric", data: "d", columns: { x: "amount" } };
const HIST_ROWS: TidyRow[] = ["a", "b"].flatMap((series) =>
  ["1", "2", "3", "4"].map((amount) => ({ amount, series })),
);
const HIST_F = { ...HIST, columns: { x: "amount", facet: "f" }, small_multiples: { columns: 2 } };
const HIST_F_ROWS: TidyRow[] = ["P", "Q"].flatMap((f) => HIST_ROWS.map((r) => ({ ...r, f })));

const WATERFALL = { chartType: "waterfall", title: "t", xAxisType: "categorical", data: "d", columns: { kind: "k" } };
const WATERFALL_ROWS: TidyRow[] = [
  { time: "a", value: "10", k: "" },
  { time: "b", value: "-4", k: "" },
  { time: "c", value: "", k: "total" },
];

const TIMELINE = { chartType: "timeline", title: "t", xAxisType: "temporal", data: "d", columns: { series: "series" } };
const TIMELINE_ROWS: TidyRow[] = [
  { time: "2020", label: "one", series: "a" },
  { time: "2021", label: "two", series: "b" },
];

const TREEMAP = {
  chartType: "treemap", title: "t", xAxisType: "categorical", data: "d",
  columns: { x: "name", value: "amount", series: "series" },
};
const TREEMAP_ROWS: TidyRow[] = [
  { name: "A", amount: "1", series: "a" },
  { name: "B", amount: "2", series: "b" },
];

type Base = [name: string, base: Record<string, unknown>, rows: TidyRow[]];
const line: Base = ["line", LINE, LINE_ROWS];
const lineFaceted: Base = ["faceted line", LINE_F, LINE_F_ROWS];
const bar: Base = ["bar", BAR, BAR_ROWS];
const lineCategorical: Base = ["categorical line", { ...LINE, xAxisType: "categorical" }, BAR_ROWS];
const stacked: Base = ["stacked", STACKED, BAR_ROWS];
const hbarSectioned: Base = ["sectioned horizontal bar", HBAR_SEC, HBAR_SEC_ROWS];
const dumbbell: Base = ["dumbbell", DUMBBELL, DUMBBELL_ROWS];
const histogram: Base = ["histogram", HIST, HIST_ROWS];
const histogramFaceted: Base = ["faceted histogram", HIST_F, HIST_F_ROWS];
const waterfall: Base = ["waterfall", WATERFALL, WATERFALL_ROWS];
const timeline: Base = ["timeline", TIMELINE, TIMELINE_ROWS];
const treemap: Base = ["treemap", TREEMAP, TREEMAP_ROWS];

interface Case {
  field: string;
  on: Base[];
  /** The nearest valid spelling: patched over the base, it must validate. */
  ok: (base: Record<string, unknown>) => Record<string, unknown>;
  /** The typo: patched over the base, it must fail with `message`. */
  bad: (base: Record<string, unknown>) => Record<string, unknown>;
  message: RegExp;
}

const sm = (base: Record<string, unknown>, extra: Record<string, unknown>) => ({
  small_multiples: { ...(base.small_multiples as object), ...extra },
});

const CASES: Case[] = [
  {
    field: "series_order", on: [line, bar, histogram, timeline, treemap],
    ok: () => ({ series_order: ["a"] }), bad: () => ({ series_order: ["Nope"] }),
    message: /^series_order names series \["Nope"\] not found in the data \(data series: \["a","b"\]\)$/,
  },
  {
    field: "series_colors", on: [line, histogram, timeline, treemap],
    ok: () => ({ series_colors: { a: "blue" } }), bad: () => ({ series_colors: { Nope: "blue" } }),
    message: /^series_colors names series \["Nope"\] not found in the data/,
  },
  {
    field: "series_labels", on: [line, histogram, timeline, treemap],
    ok: () => ({ series_labels: { a: "A" } }), bad: () => ({ series_labels: { Nope: "A" } }),
    message: /^series_labels names series \["Nope"\] not found in the data/,
  },
  {
    field: "series_patterns", on: [bar, histogram],
    ok: () => ({ series_patterns: { a: "/" } }), bad: () => ({ series_patterns: { Nope: "/" } }),
    message: /^series_patterns names series \["Nope"\] not found in the data/,
  },
  {
    field: "series_styles", on: [line],
    ok: () => ({ series_styles: { a: { dashed: true } } }), bad: () => ({ series_styles: { Nope: { dashed: true } } }),
    message: /^series_styles names series \["Nope"\] not found in the data/,
  },
  {
    field: "highlightSeries", on: [bar, histogram],
    ok: () => ({ highlightSeries: ["a"] }), bad: () => ({ highlightSeries: ["Nope"] }),
    message: /^highlightSeries names series \["Nope"\] not found in the data \(data series: \["a","b"\]\)$/,
  },
  {
    field: "series_marker", on: [dumbbell],
    ok: () => ({ series_marker: { a: "hollow" } }), bad: () => ({ series_marker: { Nope: "hollow" } }),
    message: /^series_marker names series \["Nope"\] not found in the data/,
  },
  {
    field: "gap_annotation.series_a / series_b", on: [dumbbell],
    ok: () => ({ gap_annotation: { series_a: "a", series_b: "b" } }),
    bad: () => ({ gap_annotation: { series_a: "a", series_b: "Nope" } }),
    message: /^gap_annotation\.series_b names series "Nope" not found in the data \(data series: \["a","b"\]\)$/,
  },
  {
    field: "barStack.stackOrder", on: [stacked],
    ok: () => ({ barStack: { stackOrder: ["b", "a"] } }), bad: () => ({ barStack: { stackOrder: ["b", "Nope"] } }),
    message: /^barStack\.stackOrder names series \["Nope"\] not found in the data/,
  },
  {
    field: "x_labels (standalone categorical line)", on: [lineCategorical],
    ok: () => ({ x_labels: { A: "Alpha" } }), bad: () => ({ x_labels: { Z: "Zed" } }),
    message: /^x_labels names categories \["Z"\] not found in x column "time" \(data values: \["A","B"\]\)$/,
  },
  {
    field: "x_labels (a callout's {x} token reads it)", on: [bar],
    ok: () => ({ x_labels: { A: "Alpha" }, annotations: { points: [{ x: "A", y: 1, label: "{x}" }] } }),
    bad: () => ({ x_labels: { Z: "Zed" }, annotations: { points: [{ x: "A", y: 1, label: "{x}" }] } }),
    message: /^x_labels names categories \["Z"\] not found in x column "time"/,
  },
  {
    field: "x_labels (dumbbell, columns.category)", on: [dumbbell],
    ok: () => ({ x_labels: { Q1: "First" } }), bad: () => ({ x_labels: { Q9: "Ninth" } }),
    message: /^x_labels names categories \["Q9"\] not found in x column "c"/,
  },
  {
    field: "annotations.points[].series", on: [line],
    ok: () => ({ annotations: { points: [{ x: "2021-01-01", series: "a", label: "L" }] } }),
    bad: () => ({ annotations: { points: [{ x: "2021-01-01", series: "Nope", label: "L" }] } }),
    message: /^annotations\.points\[0\]\.series names series "Nope" not found in the data/,
  },
  {
    field: "small_multiples.pane_order", on: [lineFaceted, histogramFaceted],
    ok: (b) => sm(b, { pane_order: ["Q", "P"] }), bad: (b) => sm(b, { pane_order: ["Q", "Nope"] }),
    message: /^small_multiples\.pane_order names panes \["Nope"\] not found in facet column "f" \(data values: \["P","Q"\]\)$/,
  },
  {
    field: "small_multiples.pane_titles", on: [lineFaceted, histogramFaceted],
    ok: (b) => sm(b, { pane_titles: { P: "Pee" } }), bad: (b) => sm(b, { pane_titles: { Nope: "x" } }),
    message: /^small_multiples\.pane_titles names panes \["Nope"\] not found in facet column "f"/,
  },
  {
    field: "small_multiples.pane_widths", on: [lineFaceted, histogramFaceted],
    ok: (b) => sm(b, { pane_widths: [1, 2] }), bad: (b) => sm(b, { pane_widths: [1, 2, 3] }),
    message: /^small_multiples\.pane_widths has 3 proportions but the grid has 2 column\(s\)/,
  },
  {
    field: "overlays[].facet", on: [lineFaceted],
    ok: () => ({ overlays: [{ column: "value", facet: "P" }] }),
    bad: () => ({ overlays: [{ column: "value", facet: "Nope" }] }),
    message: /^overlays\[0\]\.facet names pane "Nope" not found in facet column "f" \(data values: \["P","Q"\]\)$/,
  },
  {
    field: "overlays[].facet (fun)", on: [histogramFaceted],
    ok: () => ({ overlays: [{ fun: "x", facet: "P", legend: true, label: "L" }] }),
    bad: () => ({ overlays: [{ fun: "x", facet: "Nope", legend: true, label: "L" }] }),
    message: /^overlays\[0\]\.facet names pane "Nope" not found in facet column "f"/,
  },
  {
    field: "annotations.xAxis[].facet", on: [lineFaceted],
    ok: () => ({ annotations: { xAxis: [{ x: "2021-01-01", facet: "P" }] } }),
    bad: () => ({ annotations: { xAxis: [{ x: "2021-01-01", facet: "Nope" }] } }),
    message: /^annotations\.xAxis\[0\]\.facet names pane "Nope" not found in facet column "f" \(data values: \["P","Q"\]\)$/,
  },
  {
    field: "annotations.xAxis[].facet (numeric x)", on: [histogramFaceted],
    ok: () => ({ annotations: { xAxis: [{ x: "2", facet: "P" }] } }),
    bad: () => ({ annotations: { xAxis: [{ x: "2", facet: "Nope" }] } }),
    message: /^annotations\.xAxis\[0\]\.facet names pane "Nope"/,
  },
  {
    field: "xAxisPolicy.markers[].facet", on: [lineFaceted],
    ok: () => ({ xAxisPolicy: { markers: [{ x: "2021-01-01", facet: "Q" }] } }),
    bad: () => ({ xAxisPolicy: { markers: [{ x: "2021-01-01", facet: "Nope" }] } }),
    message: /^xAxisPolicy\.markers\[0\]\.facet names pane "Nope"/,
  },
  {
    field: "annotations.yAxis[].facet", on: [lineFaceted, histogramFaceted],
    ok: () => ({ annotations: { yAxis: [{ y: 1, facet: "P" }] } }),
    bad: () => ({ annotations: { yAxis: [{ y: 1, facet: "Nope" }] } }),
    message: /^annotations\.yAxis\[0\]\.facet names pane "Nope"/,
  },
  {
    field: "yAxisPolicy.markers[].facet", on: [lineFaceted],
    ok: () => ({ yAxisPolicy: { markers: [{ y: 1, facet: "P" }] } }),
    bad: () => ({ yAxisPolicy: { markers: [{ y: 1, facet: "Nope" }] } }),
    message: /^yAxisPolicy\.markers\[0\]\.facet names pane "Nope"/,
  },
  {
    field: "annotations.points[].facet (x-anchored)", on: [lineFaceted],
    ok: () => ({ annotations: { points: [{ x: "2021-01-01", y: 1, label: "L", facet: "P" }] } }),
    bad: () => ({ annotations: { points: [{ x: "2021-01-01", y: 1, label: "L", facet: "Nope" }] } }),
    message: /^annotations\.points\[0\]\.facet names pane "Nope"/,
  },
  {
    field: "a marker facet pane_order leaves out", on: [lineFaceted],
    ok: (b) => ({ ...sm(b, { pane_order: ["P"] }), annotations: { xAxis: [{ x: "2021-01-01", facet: "P" }] } }),
    bad: (b) => ({ ...sm(b, { pane_order: ["P"] }), annotations: { xAxis: [{ x: "2021-01-01", facet: "Q" }] } }),
    message: /^annotations\.xAxis\[0\]\.facet names pane "Q", which small_multiples\.pane_order excludes — that pane is never rendered, so the marker would be drawn nowhere \(rendered panes: \["P"\]\)$/,
  },
  {
    field: "a callout facet pane_order leaves out", on: [lineFaceted],
    ok: (b) => ({ ...sm(b, { pane_order: ["Q"] }), annotations: { points: [{ x: "2021-01-01", y: 1, label: "L", facet: "Q" }] } }),
    bad: (b) => ({ ...sm(b, { pane_order: ["Q"] }), annotations: { points: [{ x: "2021-01-01", y: 1, label: "L", facet: "P" }] } }),
    message: /^annotations\.points\[0\]\.facet names pane "P", which small_multiples\.pane_order excludes — that pane is never rendered, so the callout would be drawn nowhere \(rendered panes: \["Q"\]\)$/,
  },
  {
    field: "annotations.points[].series beside an explicit y", on: [line],
    ok: () => ({ annotations: { points: [{ x: "2021-01-01", y: 1, series: "b", label: "L" }] } }),
    bad: () => ({ annotations: { points: [{ x: "2021-01-01", y: 1, series: "B", label: "L" }] } }),
    message: /^annotations\.points\[0\]\.series names series "B" not found in the data/,
  },
  {
    field: "columns.section", on: [hbarSectioned],
    ok: () => ({ columns: { section: "sec" } }), bad: () => ({ columns: { section: "secc" } }),
    message: /^config\/data mismatch: columns\.section is "secc" but no such column exists \(columns: \["sec","time","value"\]\)$/,
  },
  {
    field: "section_order", on: [hbarSectioned],
    ok: () => ({ section_order: ["S2", "S1"] }), bad: () => ({ section_order: ["S2", "Nope"] }),
    message: /^section_order names sections \["Nope"\] not found in section column "sec" \(data values: \["S1","S2"\]\)$/,
  },
  {
    field: "section_labels", on: [hbarSectioned],
    ok: () => ({ section_labels: { S1: "One" } }), bad: () => ({ section_labels: { Nope: "One" } }),
    message: /^section_labels names sections \["Nope"\] not found in section column "sec"/,
  },
  {
    field: "columns.kind", on: [waterfall],
    ok: () => ({ columns: { kind: "k" } }), bad: () => ({ columns: { kind: "knd" } }),
    message: /^config\/data mismatch: columns\.kind is "knd" but no such column exists \(columns: \["k","time","value"\]\)$/,
  },
];

describe("data cross-references: a typo in each referenced field fails on each chart type that accepts it", () => {
  for (const c of CASES) {
    for (const [name, base, rows] of c.on) {
      it(`${c.field} on a ${name}`, () => {
        const okSpec = spec({ ...base, ...c.ok(base) });
        expect(validateChart(okSpec, rows)).toEqual({ valid: true, errors: [] });
        const badSpec = spec({ ...base, ...c.bad(base) });
        // The typo is a DATA error: the spec alone is well-formed.
        expect(validateChart(badSpec).valid).toBe(true);
        const r = validateChart(badSpec, rows);
        expect(r.valid).toBe(false);
        expect(r.errors.some((e) => c.message.test(e)), r.errors.join("\n")).toBe(true);
      });
    }
  }
});

describe("data cross-references: edges", () => {
  it("a facet on a marker of a non-faceted chart stays ignored, as documented", () => {
    const s = spec({ ...LINE, annotations: { xAxis: [{ x: "2021-01-01", facet: "anything" }] } });
    expect(validateChart(s, LINE_ROWS)).toEqual({ valid: true, errors: [] });
  });

  it("an overlay facet on a histogram without small_multiples is an error, as on every other chart type", () => {
    const s = spec({ ...HIST, overlays: [{ fun: "x", facet: "P" }] });
    const r = validateChart(s, HIST_ROWS);
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("overlays[0].facet is set but the chart has no small_multiples — remove `facet` or add small_multiples");
  });

  // A field only checked where the chart type READS it: elsewhere a typo renders exactly as the
  // field's absence does, so rejecting it would fail a figure that draws correctly. Each case pins
  // both halves — it validates, and the render is byte-identical without the field.
  const svg = (s: ChartSpec, r: TidyRow[]): string =>
    renderChart(s, r, { width: 600, height: 360, document }).svg.outerHTML;
  const unread: Array<[string, Record<string, unknown>, TidyRow[], Record<string, unknown>]> = [
    ["section_order without columns.section", { ...BAR, orientation: "horizontal" }, BAR_ROWS, { section_order: ["S1"] }],
    ["section_labels without columns.section", { ...BAR, orientation: "horizontal" }, BAR_ROWS, { section_labels: { S1: "One" } }],
    ["shape_labels on a histogram with an absent shape column", { ...HIST, columns: { x: "amount", shape: "absent" } }, HIST_ROWS, { shape_labels: { A: "Alpha" }, shape_order: ["A"] }],
    ["series_styles on a histogram", HIST, HIST_ROWS, { series_styles: { Nope: { dashed: true } } }],
    ["highlightSeries on a line", LINE, LINE_ROWS, { highlightSeries: ["Nope"] }],
    ["highlightSeries on a stacked bar", STACKED, BAR_ROWS, { highlightSeries: ["Nope"] }],
    ["series_marker on a line", LINE, LINE_ROWS, { series_marker: { Nope: "hollow" } }],
    ["gap_annotation on a line", LINE, LINE_ROWS, { gap_annotation: { series_a: "a", series_b: "Nope" } }],
    ["barStack.stackOrder on a bar", BAR, BAR_ROWS, { barStack: { stackOrder: ["Nope"] } }],
    ["x_labels on a standalone bar (value pills, no card)", BAR, BAR_ROWS, { x_labels: { Z: "Zed" } }],
  ];
  for (const [name, base, rows, extra] of unread) {
    it(`not read, so not checked: ${name}`, () => {
      const withField = spec({ ...base, ...extra });
      expect(validateChart(withField, rows)).toEqual({ valid: true, errors: [] });
      expect(svg(withField, rows)).toBe(svg(spec(base), rows));
    });
  }

  it("pane_widths counts the panes drawn: a blank facet cell is not a pane", () => {
    const blankLine = [...LINE_F_ROWS, { time: "2021-01-01", series: "a", value: "9", f: "" }];
    const blankHist = [...HIST_F_ROWS, { amount: "2", series: "a", f: "" }];
    for (const [name, base, rows] of [["line", LINE_F, blankLine], ["histogram", HIST_F, blankHist]] as const) {
      const ok = spec({ ...base, small_multiples: { pane_widths: [1, 2] } });
      expect(validateChart(ok, rows), name).toEqual({ valid: true, errors: [] });
      const bad = spec({ ...base, small_multiples: { pane_widths: [1, 2, 3] } });
      expect(validateChart(bad, rows).errors, name).toContain(
        "small_multiples.pane_widths has 3 proportions but the grid has 2 column(s) — the array length must equal the column count",
      );
    }
  });

  it("pane_widths counts the pane list the figure draws, a repeated pane_order entry included", () => {
    for (const [name, base, rows] of [["line", LINE_F, LINE_F_ROWS], ["histogram", HIST_F, HIST_F_ROWS]] as const) {
      const ok = spec({ ...base, small_multiples: { pane_order: ["P", "P"], pane_widths: [1, 2] } });
      expect(validateChart(ok, rows), name).toEqual({ valid: true, errors: [] });
      // The figure the validator describes: two panes, in two columns.
      const fig = renderFigure(ok, rows, { width: 800, height: 400, document });
      expect([fig.panes.length, fig.columns], name).toEqual([2, 2]);
      const bad = spec({ ...base, small_multiples: { pane_order: ["P", "P"], pane_widths: [1] } });
      expect(validateChart(bad, rows).errors, name).toContain(
        "small_multiples.pane_widths has 1 proportions but the grid has 2 column(s) — the array length must equal the column count",
      );
    }
  });

  it("a declared column only a chart type it does not apply to would read is not required", () => {
    // `columns.kind` is read by a waterfall alone; `shape` and `projected_field` not by a histogram.
    expect(validateChart(spec({ ...BAR, columns: { kind: "nope" } }), BAR_ROWS)).toEqual({ valid: true, errors: [] });
    expect(validateChart(spec({ ...HIST, columns: { x: "amount", shape: "nope" } }), HIST_ROWS)).toEqual({ valid: true, errors: [] });
    expect(validateChart(spec({ ...HIST, projected_field: "nope" }), HIST_ROWS)).toEqual({ valid: true, errors: [] });
  });

  it("a single-series chart's keys still name the implicit series \"\"", () => {
    const rows: TidyRow[] = [{ time: "A", value: "1" }, { time: "B", value: "2" }];
    expect(validateChart(spec({ ...BAR, highlightSeries: [""] }), rows).valid).toBe(true);
    const r = validateChart(spec({ ...BAR, highlightSeries: ["Total"] }), rows);
    expect(r.errors).toContain(`highlightSeries names series ["Total"] not found in the data (data series: [""])`);
    const callout = (series: string) => spec({ ...BAR, annotations: { points: [{ x: "A", y: 1, series, label: "L" }] } });
    expect(validateChart(callout(""), rows).valid).toBe(true);
    expect(validateChart(callout("value"), rows).errors).toContain(
      `annotations.points[0].series names series "value" not found in the data (data series: [""])`,
    );
  });

  it("gap_annotation: true names no series and is not checked", () => {
    expect(validateChart(spec({ ...DUMBBELL, gap_annotation: true }), DUMBBELL_ROWS).valid).toBe(true);
  });

  it("a histogram reports every reference error together, after its columns check out", () => {
    const s = spec({ ...HIST_F, series_order: ["Nope"], small_multiples: { columns: 2, pane_order: ["Nah"] } });
    const r = validateChartData(s, HIST_F_ROWS);
    expect(r.errors).toEqual([
      `series_order names series ["Nope"] not found in the data (data series: ["a","b"])`,
      `small_multiples.pane_order names panes ["Nah"] not found in facet column "f" (data values: ["P","Q"])`,
    ]);
  });

  it("a pre-binned histogram checks its references too", () => {
    const s = spec({ ...HIST, columns: { x0: "lo", x1: "hi", value: "n", series: "g" }, series_labels: { Nope: "x" } });
    const r = validateChartData(s, [{ lo: "0", hi: "1", n: "2", g: "a" }]);
    expect(r.errors).toEqual([`series_labels names series ["Nope"] not found in the data (data series: ["a"])`]);
  });
});

describe("whitespace-only numeric cells", () => {
  it("a whitespace-only value cell is not empty: it is rejected, where a blank cell passes", () => {
    const blank = LINE_ROWS.map((r, i) => (i === 1 ? { ...r, value: "" } : r));
    expect(validateChart(spec(LINE), blank)).toEqual({ valid: true, errors: [] });
    const spaced = LINE_ROWS.map((r, i) => (i === 1 ? { ...r, value: "  " } : r));
    const r = validateChart(spec(LINE), spaced);
    expect(r.valid).toBe(false);
    expect(r.errors).toEqual([`row 3: value "  " is not numeric — leave the cell empty for a missing observation`]);
  });

  it("the same for a confidence-band, overlay-column and histogram weight cell", () => {
    const ci = LINE_ROWS.map((r) => ({ ...r, lo: "0", hi: r === LINE_ROWS[0] ? " " : "9" }));
    const withCi = spec({ ...LINE, confidence_bands: [{ series: "a", lower: "lo", upper: "hi" }] });
    expect(validateChart(withCi, ci).errors).toEqual([`row 2: hi " " is not numeric — leave the cell empty for a missing observation`]);
    const withOverlay = spec({ ...LINE, overlays: [{ column: "trend" }] });
    const trend = LINE_ROWS.map((r, i) => ({ ...r, trend: i === 3 ? " " : "1" }));
    expect(validateChart(withOverlay, trend.map((r) => ({ ...r, trend: "1" }))).valid).toBe(true);
    expect(validateChart(withOverlay, trend).errors).toEqual([`row 5: trend " " is not numeric — leave the cell empty for a missing observation`]);
    const weighted = spec({ ...HIST, histogram: { weight: "w" } });
    const w = HIST_ROWS.map((r, i) => ({ ...r, w: i === 0 ? "\t" : "1" }));
    expect(validateChart(weighted, w).errors).toEqual([`row 2: w "\\t" is not numeric — leave the cell empty for a missing observation`]);
  });
});
