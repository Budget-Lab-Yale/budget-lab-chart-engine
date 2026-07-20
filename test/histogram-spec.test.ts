import { describe, it, expect } from "vitest";
import { validateChart } from "../src/spec/validate";
import type { ChartSpec } from "../src/spec/types";

const base = {
  chartType: "histogram", title: "H", xAxisType: "numeric",
  columns: { x: "amount" }, data: "d.csv",
} as unknown as ChartSpec;

describe("histogram spec validation", () => {
  it("accepts a minimal numeric histogram", () => {
    expect(validateChart(base).valid).toBe(true);
  });
  it("accepts bins / binWidth / normalize / weight", () => {
    expect(validateChart({ ...base, histogram: { bins: 20, normalize: "density", weight: "w" } } as any).valid).toBe(true);
    expect(validateChart({ ...base, histogram: { binWidth: 5 } } as any).valid).toBe(true);
  });
  it("rejects a non-numeric/temporal x-axis for histograms", () => {
    expect(validateChart({ ...base, xAxisType: "categorical" } as any).valid).toBe(false);
  });
  it("rejects an unknown normalize value", () => {
    expect(validateChart({ ...base, histogram: { normalize: "zscore" } } as any).valid).toBe(false);
  });
  it("accepts pre-binned (x0+x1+value) and rejects bin config alongside it", () => {
    const pre = { ...base, columns: { x0: "lo", x1: "hi", value: "n" } } as any;
    expect(validateChart(pre).valid).toBe(true);
    expect(validateChart({ ...pre, histogram: { bins: 10 } }).valid).toBe(false);
  });
  it("rejects pre-binned missing an edge column", () => {
    expect(validateChart({ ...base, columns: { x0: "lo", value: "n" } } as any).valid).toBe(false);
  });
});
