import { describe, it, expect } from "vitest";
import { validateSpec, validateChartData, validateChart } from "../src/spec/validate";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const VALID: ChartSpec = {
  chartType: "line",
  title: "Demo",
  xAxisType: "temporal",
  data: "data.csv",
};

const ROWS: TidyRow[] = [
  { time: "2021-01-01", series: "a", value: "1.0" },
  { time: "2021-02-01", series: "a", value: "2.0" },
  { time: "2021-01-01", series: "b", value: "3.0" },
];

describe("validateSpec (structural)", () => {
  it("accepts a minimal valid spec", () => {
    expect(validateSpec(VALID)).toEqual({ valid: true, errors: [] });
  });

  it("accepts the remote data-source object form", () => {
    const r = validateSpec({ ...VALID, data: { url: "https://x/y.csv", format: "csv" } });
    expect(r.valid).toBe(true);
  });

  it("rejects a typo'd property and names it", () => {
    const r = validateSpec({ ...VALID, xAxisTpye: "temporal" });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/xAxisTpye/);
  });

  it("rejects `eyebrow` — the figure number is an embed-time property, not a spec field", () => {
    const r = validateSpec({ ...VALID, eyebrow: "Figure 1" });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/eyebrow/);
  });

  it("rejects a bad enum and lists the allowed values", () => {
    const r = validateSpec({ ...VALID, xAxisType: "weekly" });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/numeric, temporal, quarterly/);
  });

  it("rejects a missing required field", () => {
    const { xAxisType, ...noAxis } = VALID;
    const r = validateSpec(noAxis);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/xAxisType/);
  });

  it("rejects a malformed nested policy", () => {
    const r = validateSpec({ ...VALID, yAxisPolicy: { autoWiden: {} } });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/step/);
  });

  it("accepts columns.section + section_order + section_labels", () => {
    const r = validateSpec({
      ...VALID,
      columns: { section: "toplevel" },
      section_order: ["Durable goods", "Services"],
      section_labels: { "Durable goods": "Durables" },
    });
    expect(r.valid).toBe(true);
  });

  it("rejects a section_order of the wrong type", () => {
    const r = validateSpec({ ...VALID, section_order: "Durable goods" });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/section_order/);
  });

  it("accepts xAxisPolicy.bands, yAxisPolicy.markers, and valueLabels.decimals", () => {
    const r = validateSpec({
      chartType: "line",
      title: "Demo",
      xAxisType: "numeric",
      data: "data.csv",
      xAxisPolicy: { bands: [{ start: "2007", end: "2009", label: "GFC" }] },
      yAxisPolicy: { markers: [{ y: 0.026, label: "Moderate", style: "dashed" }] },
    });
    expect(r).toEqual({ valid: true, errors: [] });
    const b = validateSpec({
      chartType: "bar",
      title: "Demo",
      xAxisType: "categorical",
      data: "data.csv",
      valueLabels: { show: true, decimals: 1 },
    });
    expect(b.valid).toBe(true);
  });

  it("accepts value_format on xAxis/yAxis markers and points callouts", () => {
    const r = validateSpec({
      ...VALID,
      annotations: {
        xAxis: [{ x: "2021", label: "X ({value})", value_format: { decimals: 1 } }],
        yAxis: [{ y: 1, label: "Y ({value})", value_format: { prefix: "$", suffix: "M" } }],
        points: [{ x: "2021", label: "P ({value})", value_format: {} }],
      },
    });
    expect(r).toEqual({ valid: true, errors: [] });
  });

  it("rejects an unknown key inside value_format", () => {
    const r = validateSpec({
      ...VALID,
      annotations: { yAxis: [{ y: 1, label: "Y", value_format: { bogusKey: true } }] },
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/bogusKey/);
  });

  it("rejects out-of-range value_format.decimals (would throw in toFixed at render time)", () => {
    const neg = validateSpec({
      ...VALID,
      annotations: { yAxis: [{ y: 1, label: "Y ({value})", value_format: { decimals: -1 } }] },
    });
    expect(neg.valid).toBe(false);
    const huge = validateSpec({
      ...VALID,
      annotations: { yAxis: [{ y: 1, label: "Y ({value})", value_format: { decimals: 200 } }] },
    });
    expect(huge.valid).toBe(false);
  });

  it("rejects a band missing start/end and a y-marker missing y", () => {
    const r1 = validateSpec({
      chartType: "line", title: "x", xAxisType: "numeric", data: "d",
      xAxisPolicy: { bands: [{ start: "2007" }] },
    });
    expect(r1.valid).toBe(false);
    const r2 = validateSpec({
      chartType: "line", title: "x", xAxisType: "numeric", data: "d",
      yAxisPolicy: { markers: [{ label: "no y" }] },
    });
    expect(r2.valid).toBe(false);
  });

  it("accepts a scatter spec with numeric xAxisType and a shape channel", () => {
    const r = validateSpec({
      chartType: "scatter",
      title: "Scatter Demo",
      xAxisType: "numeric",
      data: "data.csv",
      columns: { x: "gx", value: "gy", series: "color", shape: "shp" },
      shape_order: ["a", "b"],
      shape_labels: { a: "A" },
      color_legend_title: "Color",
      shape_legend_title: "Shape",
    });
    expect(r).toEqual({ valid: true, errors: [] });
  });

  it("accepts a dotplot spec with categorical xAxisType", () => {
    const r = validateSpec({
      chartType: "dotplot",
      title: "Dot Demo",
      xAxisType: "categorical",
      data: "data.csv",
    });
    expect(r.valid).toBe(true);
  });

  it("rejects scatter with a non-numeric xAxisType", () => {
    const r = validateSpec({
      chartType: "scatter",
      title: "Scatter Demo",
      xAxisType: "categorical",
      data: "data.csv",
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/scatter.*requires xAxisType "numeric"/);
  });

  it("rejects dotplot with a non-categorical xAxisType", () => {
    const r = validateSpec({
      chartType: "dotplot",
      title: "Dot Demo",
      xAxisType: "numeric",
      data: "data.csv",
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/dotplot.*requires xAxisType "categorical"/);
  });

  it("accepts a bar spec with categorical xAxisType and bar fields", () => {
    const r = validateSpec({
      chartType: "bar",
      title: "Bar Demo",
      xAxisType: "categorical",
      data: "data.csv",
      orientation: "vertical",
      valueLabels: { show: true, signed: false },
      highlightSeries: ["a"],
      legendPosition: "top",
    });
    expect(r.valid).toBe(true);
  });

  it("accepts `legend: false` (hides the legend, colors/tooltips unaffected)", () => {
    const r = validateSpec({ ...VALID, series_order: ["a", "b"], legend: false });
    expect(r.valid).toBe(true);
  });

  it("accepts `legend: true` (explicit default)", () => {
    const r = validateSpec({ ...VALID, series_order: ["a", "b"], legend: true });
    expect(r.valid).toBe(true);
  });

  it("rejects a non-boolean `legend` value", () => {
    const r = validateSpec({ ...VALID, legend: "no" });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/legend/);
  });

  it("accepts a stacked spec with a barStack block", () => {
    const r = validateSpec({
      chartType: "stacked",
      title: "Stacked Demo",
      xAxisType: "categorical",
      data: "data.csv",
      barStack: {
        netDisplay: "text",
        mono: { base: "#003366" },
        netLabelColor: "white",
        normalize: false,
      },
    });
    expect(r.valid).toBe(true);
  });

  it("rejects an unknown key inside barStack", () => {
    const r = validateSpec({
      chartType: "stacked",
      title: "Bad Stack",
      xAxisType: "categorical",
      data: "data.csv",
      barStack: { bogusKey: true },
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/bogusKey/);
  });

  it("rejects an invalid orientation enum value", () => {
    const r = validateSpec({ ...VALID, orientation: "diagonal" });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/vertical, horizontal/);
  });
});

describe("small_multiples config", () => {
  it("accepts a spec with a full small_multiples block", () => {
    const r = validateSpec({
      ...VALID,
      columns: { facet: "region" },
      small_multiples: {
        mode: "shared",
        columns: 3,
        pane_order: ["east", "west"],
        pane_titles: { east: "East Region", west: "West Region" },
        coordinated_cursor: false,
      },
    });
    expect(r.valid).toBe(true);
  });

  it("accepts pane_widths: equal-bar and a proportion array", () => {
    expect(validateSpec({ ...VALID, small_multiples: { pane_widths: "equal-bar" } }).valid).toBe(true);
    expect(validateSpec({ ...VALID, small_multiples: { pane_widths: [2, 1] } }).valid).toBe(true);
  });

  it("rejects a pane_widths array whose length ≠ the resolved column count", () => {
    const rows: TidyRow[] = [
      { facet: "A", cat: "a1", value: "1" },
      { facet: "A", cat: "a2", value: "2" },
      { facet: "B", cat: "b1", value: "3" },
    ] as TidyRow[];
    const spec: ChartSpec = {
      chartType: "bar",
      title: "t",
      xAxisType: "categorical",
      columns: { x: "cat", value: "value", facet: "facet" },
      data: "x",
      // 2 panes → single row of 2 columns; a 3-length array is wrong.
      small_multiples: { mode: "shared", pane_widths: [1, 2, 3] },
    };
    const r = validateChartData(spec, rows);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/pane_widths has 3 proportions but the grid has 2 column/);
  });

  it("accepts faceted horizontal BAR charts (now supported)", () => {
    const r = validateSpec({
      chartType: "bar",
      title: "t",
      xAxisType: "categorical",
      orientation: "horizontal",
      columns: { facet: "scenario" },
      small_multiples: { mode: "shared" },
      data: "d.csv",
    });
    expect(r.valid).toBe(true);
  });

  it("still rejects faceted horizontal STACKED charts (not built)", () => {
    const r = validateSpec({
      chartType: "stacked",
      title: "t",
      xAxisType: "categorical",
      orientation: "horizontal",
      columns: { facet: "scenario" },
      small_multiples: { mode: "shared" },
      data: "d.csv",
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/stacked/);
  });

  it("accepts a boolean points flag", () => {
    expect(validateSpec({ ...VALID, points: true }).valid).toBe(true);
  });

  it("rejects a non-boolean points flag", () => {
    const r = validateSpec({ ...VALID, points: "yes" });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/points/);
  });

  it("accepts x_axis_title and y_axis_title strings", () => {
    const r = validateSpec({ ...VALID, x_axis_title: "Year", y_axis_title: "Percent of GDP" });
    expect(r.valid).toBe(true);
  });

  it("rejects a non-string y_axis_title", () => {
    const r = validateSpec({ ...VALID, y_axis_title: 42 });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/y_axis_title/);
  });

  it("rejects a non-boolean coordinated_cursor", () => {
    const r = validateSpec({
      ...VALID,
      columns: { facet: "region" },
      small_multiples: { coordinated_cursor: "yes" },
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/coordinated_cursor/);
  });

  it("rejects small_multiples with no facet column configured (data validation)", () => {
    const r = validateChartData({ ...VALID, small_multiples: { mode: "shared" } }, ROWS);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/requires a facet column|columns\.facet/);
  });

  it("rejects a bad mode enum value", () => {
    const r = validateSpec({
      ...VALID,
      small_multiples: { mode: "grid" },
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/shared, per-pane/);
  });

  it("rejects an unknown key inside small_multiples", () => {
    const r = validateSpec({
      ...VALID,
      small_multiples: { bogusKey: true },
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/bogusKey/);
  });

  it("a spec without small_multiples validates exactly as before (backward-compat)", () => {
    expect(validateSpec(VALID)).toEqual({ valid: true, errors: [] });
  });
});

describe("validateChartData (cross-reference + CSV format)", () => {
  it("passes valid rows", () => {
    expect(validateChartData(VALID, ROWS)).toEqual({ valid: true, errors: [] });
  });

  it("accepts arbitrary column names declared via the columns block", () => {
    const spec: ChartSpec = {
      ...VALID,
      xAxisType: "categorical",
      columns: { x: "age_bin", value: "mean_hours", series: "cohort" },
    };
    const rows: TidyRow[] = [
      { age_bin: "18-21", cohort: "Gen X", mean_hours: "1.5" },
      { age_bin: "22-25", cohort: "Gen X", mean_hours: "2.0" },
    ];
    expect(validateChartData(spec, rows)).toEqual({ valid: true, errors: [] });
  });

  it("flags a columns.x that names a column absent from the data", () => {
    const spec: ChartSpec = { ...VALID, xAxisType: "categorical", columns: { x: "age_bin" } };
    const r = validateChartData(spec, ROWS); // ROWS have time/series/value, not age_bin
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/columns\.x is "age_bin".*no such column/);
  });

  it("accepts a chart with no series column (single implicit series)", () => {
    const spec: ChartSpec = {
      ...VALID,
      xAxisType: "categorical",
      columns: { x: "age_bin", value: "mean_hours" },
    };
    const rows: TidyRow[] = [
      { age_bin: "18-21", mean_hours: "1.5" },
      { age_bin: "22-25", mean_hours: "2.0" },
    ];
    expect(validateChartData(spec, rows)).toEqual({ valid: true, errors: [] });
  });

  it("accepts a scatter with an independent shape column present in the data", () => {
    const spec: ChartSpec = {
      chartType: "scatter",
      title: "Scatter",
      xAxisType: "numeric",
      data: "data.csv",
      columns: { x: "gx", value: "gy", series: "color", shape: "shp" },
      shape_order: ["tri", "dot"],
    };
    const rows: TidyRow[] = [
      { gx: "1", gy: "10", color: "slow", shp: "tri" },
      { gx: "2", gy: "20", color: "fast", shp: "dot" },
    ];
    expect(validateChartData(spec, rows)).toEqual({ valid: true, errors: [] });
  });

  it("flags a columns.shape that names a column absent from the data", () => {
    const spec: ChartSpec = {
      chartType: "scatter",
      title: "Scatter",
      xAxisType: "numeric",
      data: "data.csv",
      columns: { x: "gx", value: "gy", shape: "shp" },
    };
    const rows: TidyRow[] = [{ gx: "1", gy: "10" }];
    const r = validateChartData(spec, rows);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/columns\.shape is "shp".*no such column/);
  });

  it("flags a shape_order value not present in the shape column", () => {
    const spec: ChartSpec = {
      chartType: "scatter",
      title: "Scatter",
      xAxisType: "numeric",
      data: "data.csv",
      columns: { x: "gx", value: "gy", shape: "shp" },
      shape_order: ["tri", "missing"],
    };
    const rows: TidyRow[] = [{ gx: "1", gy: "10", shp: "tri" }];
    const r = validateChartData(spec, rows);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/shape_order names shape values.*missing/);
  });

  it("flags a config series not present in the data", () => {
    const r = validateChartData({ ...VALID, series_order: ["a", "missing"] }, ROWS);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/series_order names series \["missing"\]/);
  });

  it("flags an x_order value absent from the categorical x column", () => {
    const rows: TidyRow[] = [
      { time: "Northeast", series: "a", value: "1" },
      { time: "South", series: "a", value: "2" },
    ];
    const spec: ChartSpec = { ...VALID, xAxisType: "categorical", x_order: ["Northeast", "typo"] };
    const r = validateChartData(spec, rows);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/x_order names categories \["typo"\]/);
  });

  it("accepts x_order that lists a subset of the categories (order-only, no filter)", () => {
    const rows: TidyRow[] = [
      { time: "Northeast", series: "a", value: "1" },
      { time: "South", series: "a", value: "2" },
    ];
    const spec: ChartSpec = { ...VALID, xAxisType: "categorical", x_order: ["South"] };
    expect(validateChartData(spec, rows)).toEqual({ valid: true, errors: [] });
  });

  it("flags a time value that doesn't parse under xAxisType", () => {
    const r = validateChartData(VALID, [{ time: "2021/01/01", series: "a", value: "1" }]);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/row 2: time: expected YYYY-MM-DD/);
  });

  it("flags a non-numeric value", () => {
    const r = validateChartData(VALID, [{ time: "2021-01-01", series: "a", value: "abc" }]);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/row 2: value "abc" is not numeric/);
  });

  it("accepts blank values (missing observations)", () => {
    const r = validateChartData(VALID, [{ time: "2021-01-01", series: "a", value: "" }]);
    expect(r.valid).toBe(true);
  });

  it("flags a missing required column", () => {
    const r = validateChartData(VALID, [{ time: "2021-01-01", series: "a" } as unknown as TidyRow]);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/columns\.value is "value".*no such column/);
  });

  it("flags a confidence_bands CI column absent from the data", () => {
    const spec: ChartSpec = {
      ...VALID,
      confidence_bands: [{ series: "a", lower: "lo", upper: "hi" }],
    };
    const r = validateChartData(spec, ROWS);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/confidence_bands references a "lo" column/);
  });

  it("flags columns.facet not present as a data column", () => {
    const spec: ChartSpec = {
      ...VALID,
      columns: { facet: "region" },
      small_multiples: { mode: "shared" },
    };
    const r = validateChartData(spec, ROWS);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/columns\.facet.*"region".*no such column/);
  });

  it("flags small_multiples.pane_order with a value absent from the facet column", () => {
    const rows: TidyRow[] = [
      { time: "2021-01-01", series: "a", value: "1", region: "east" },
      { time: "2021-02-01", series: "a", value: "2", region: "west" },
    ];
    const spec: ChartSpec = {
      ...VALID,
      columns: { facet: "region" },
      small_multiples: { mode: "shared", pane_order: ["east", "typo"] },
    };
    const r = validateChartData(spec, rows);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/pane_order names panes \["typo"\]/);
  });

  it("passes a valid small_multiples facet config", () => {
    const rows: TidyRow[] = [
      { time: "2021-01-01", series: "a", value: "1", region: "east" },
      { time: "2021-02-01", series: "a", value: "2", region: "west" },
    ];
    const spec: ChartSpec = {
      ...VALID,
      columns: { facet: "region" },
      small_multiples: {
        mode: "shared",
        pane_order: ["east", "west"],
        pane_titles: { east: "East Region", west: "West Region" },
      },
    };
    expect(validateChartData(spec, rows)).toEqual({ valid: true, errors: [] });
  });
});

describe("validateChart (combined)", () => {
  it("short-circuits on structural errors without touching data", () => {
    const r = validateChart({ ...VALID, xAxisType: "weekly" }, ROWS);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/allowed: numeric, temporal, quarterly/);
  });

  it("runs data checks when the spec is structurally valid", () => {
    expect(validateChart(VALID, ROWS)).toEqual({ valid: true, errors: [] });
  });

  it("validates structure only when no rows are supplied", () => {
    expect(validateChart(VALID)).toEqual({ valid: true, errors: [] });
  });
});
