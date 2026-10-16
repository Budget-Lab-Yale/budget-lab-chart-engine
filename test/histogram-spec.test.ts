import { describe, it, expect } from "vitest";
import { validateChart } from "../src/spec/validate";
import { temporalThresholds } from "../src/engine/histogram-bin";
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

describe("histogram block: values the engine would silently replace with automatic bins", () => {
  const temporal = { ...base, xAxisType: "temporal" } as unknown as ChartSpec;
  const errs = (s: unknown): string[] => validateChart(s).errors;

  it("bins: a positive integer", () => {
    expect(validateChart({ ...base, histogram: { bins: 1 } } as any).valid).toBe(true);
    expect(errs({ ...base, histogram: { bins: 2.5 } })).toEqual(["/histogram/bins: must be integer"]);
    expect(errs({ ...base, histogram: { bins: 0 } })).toEqual(["/histogram/bins: must be >= 1"]);
    expect(errs({ ...base, histogram: { bins: -3 } })).toEqual(["/histogram/bins: must be >= 1"]);
  });

  it("binWidth: a finite number greater than 0", () => {
    expect(validateChart({ ...base, histogram: { binWidth: 0.25 } } as any).valid).toBe(true);
    expect(validateChart({ ...temporal, histogram: { binWidth: 7 } } as any).valid).toBe(true);
    // ajv already refuses a non-finite number (JSON has none), with its own message.
    expect(validateChart({ ...base, histogram: { binWidth: Infinity } } as any).valid).toBe(false);
    for (const bw of [0, -1]) {
      expect(errs({ ...base, histogram: { binWidth: bw } })).toEqual([`histogram.binWidth must be a finite number greater than 0 (got ${bw})`]);
      expect(errs({ ...temporal, histogram: { binWidth: bw } })).toEqual([`histogram.binWidth must be a finite number greater than 0 (got ${bw})`]);
    }
  });

  it("binWidth: a calendar interval name only on a temporal axis, and only a documented one", () => {
    for (const name of ["day", "week", "month", "quarter", "year"]) {
      expect(validateChart({ ...temporal, histogram: { binWidth: name } } as any).valid, name).toBe(true);
    }
    expect(errs({ ...temporal, histogram: { binWidth: "months" } })).toEqual([
      `histogram.binWidth "months" is not a calendar interval (allowed: day, week, month, quarter, year) — or give a number of days`,
    ]);
    for (const bw of ["0", "-7", "Infinity"]) {
      expect(errs({ ...temporal, histogram: { binWidth: bw } })).toEqual([
        `histogram.binWidth must be a finite number greater than 0 (got ${JSON.stringify(bw)})`,
      ]);
    }
    expect(errs({ ...temporal, histogram: { binWidth: "" } })).toEqual([
      `histogram.binWidth "" is not a calendar interval (allowed: day, week, month, quarter, year) — or give a number of days`,
    ]);
    expect(errs({ ...base, histogram: { binWidth: "month" } })).toEqual([
      `histogram.binWidth "month" is a string: on xAxisType "numeric" give a number of x-units (calendar interval names need xAxisType "temporal")`,
    ]);
  });

  it("binWidth: a positive numeric string on a temporal axis is a day count, binned exactly as the number", () => {
    expect(validateChart({ ...temporal, histogram: { binWidth: "7" } } as any)).toEqual({ valid: true, errors: [] });
    expect(validateChart({ ...temporal, histogram: { binWidth: "2.5" } } as any).valid).toBe(true);
    const day = 86400000;
    const values = [0, 3, 10, 20, 30].map((d) => Date.UTC(2024, 0, 1) + d * day);
    const fromString = temporalThresholds(values, "7", undefined, undefined);
    expect(fromString).toEqual(temporalThresholds(values, 7, undefined, undefined));
    expect(fromString[1]! - fromString[0]!).toBe(7 * day);
    // On a numeric axis the binner ignores a string (it reads `typeof bw === "number"` only).
    expect(errs({ ...base, histogram: { binWidth: "7" } })).toEqual([
      `histogram.binWidth "7" is a string: on xAxisType "numeric" give a number of x-units (calendar interval names need xAxisType "temporal")`,
    ]);
  });

  it("domain: min < max", () => {
    expect(validateChart({ ...base, histogram: { domain: [-1, 2.25] } } as any).valid).toBe(true);
    expect(errs({ ...base, histogram: { domain: [7, 1] } })).toEqual(["histogram.domain must satisfy min < max (got [7, 1])"]);
    expect(errs({ ...base, histogram: { domain: [3, 3] } })).toEqual(["histogram.domain must satisfy min < max (got [3, 3])"]);
  });
});
