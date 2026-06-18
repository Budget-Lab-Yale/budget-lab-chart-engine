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

describe("validateChartData (cross-reference + CSV format)", () => {
  it("passes valid rows", () => {
    expect(validateChartData(VALID, ROWS)).toEqual({ valid: true, errors: [] });
  });

  it("flags a config series not present in the data", () => {
    const r = validateChartData({ ...VALID, series_order: ["a", "missing"] }, ROWS);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/series_order names series \["missing"\]/);
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
    expect(r.errors.join("\n")).toMatch(/missing the required "value" column/);
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
