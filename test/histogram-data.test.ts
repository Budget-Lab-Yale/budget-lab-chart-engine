import { describe, it, expect } from "vitest";
import { validateChartData } from "../src/spec/validate";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const rawBase = {
  chartType: "histogram", title: "H", xAxisType: "numeric",
  columns: { x: "amount" }, data: "d.csv",
} as unknown as ChartSpec;

const preBase = {
  chartType: "histogram", title: "H", xAxisType: "numeric",
  columns: { x0: "lo", x1: "hi", value: "n" }, data: "d.csv",
} as unknown as ChartSpec;

describe("validateChartData for histograms", () => {
  it("accepts a raw count-mode histogram with only the x column (no value)", () => {
    const rows: TidyRow[] = [
      { amount: "1.5" },
      { amount: "2.0" },
      { amount: "3.7" },
    ];
    const res = validateChartData(rawBase, rows);
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it("rejects a raw histogram whose mapped histogram.weight column is absent", () => {
    const spec = { ...rawBase, histogram: { weight: "w" } } as unknown as ChartSpec;
    const rows: TidyRow[] = [{ amount: "1.5" }, { amount: "2.0" }];
    const res = validateChartData(spec, rows);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("histogram.weight"))).toBe(true);
  });

  it("accepts a pre-binned histogram with valid x0/x1/value rows", () => {
    const rows: TidyRow[] = [
      { lo: "0", hi: "10", n: "5" },
      { lo: "10", hi: "20", n: "8" },
      { lo: "20", hi: "30", n: "3" },
    ];
    const res = validateChartData(preBase, rows);
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it("rejects a pre-binned histogram where a row has x1 <= x0", () => {
    const rows: TidyRow[] = [
      { lo: "0", hi: "10", n: "5" },
      { lo: "20", hi: "20", n: "8" },
    ];
    const res = validateChartData(preBase, rows);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("must be greater than lower edge"))).toBe(true);
  });

  it("rejects a pre-binned histogram missing the x1 column in the data", () => {
    const rows: TidyRow[] = [
      { lo: "0", n: "5" },
      { lo: "10", n: "8" },
    ];
    const res = validateChartData(preBase, rows);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("columns.x1"))).toBe(true);
  });
});
