import { describe, it, expect } from "vitest";
import { computeThresholds, binValues } from "../../src/engine/histogram-bin";

const rows = (xs: number[], series = "") => xs.map((x) => ({ series, x }));

describe("computeThresholds", () => {
  it("uses an explicit binWidth stepping from the domain start", () => {
    expect(computeThresholds([0, 10], { binWidth: 5, domain: [0, 10] })).toEqual([0, 5, 10]);
  });
  it("uses a bin COUNT to divide the domain evenly", () => {
    expect(computeThresholds([0, 100], { bins: 4, domain: [0, 100] })).toEqual([0, 25, 50, 75, 100]);
  });
  it("closes the last (short) bin on max when the width does not divide evenly", () => {
    expect(computeThresholds([0, 12], { binWidth: 5, domain: [0, 12] })).toEqual([0, 5, 10, 12]);
  });
  it("auto-bins (returns >= 2 edges spanning the data extent) when neither is set", () => {
    const t = computeThresholds([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], {});
    expect(t.length).toBeGreaterThanOrEqual(2);
    expect(t[0]).toBe(1); expect(t[t.length - 1]).toBe(10);
  });
  it("returns a single unit bin for a zero-range domain (never divides by zero)", () => {
    expect(computeThresholds([5, 5, 5], {})).toEqual([5, 6]);
  });
});

describe("binValues", () => {
  it("counts values per bin, half-open [x0,x1) with the last bin closed on max", () => {
    const out = binValues(rows([0, 1, 5, 9, 10]), { binWidth: 5, domain: [0, 10] });
    // bins [0,5)->{0,1}, [5,10]->{5,9,10}
    expect(out.map((b) => [b._x0, b._x1, b._y])).toEqual([[0, 5, 2], [5, 10, 3]]);
  });
  it("emits one row per (bin x series), preserving empty bins as _y=0", () => {
    const out = binValues([...rows([0, 1], "A"), ...rows([9], "B")], { binWidth: 5, domain: [0, 10] });
    const a = out.filter((b) => b.series === "A").map((b) => b._y);
    const b = out.filter((b) => b.series === "B").map((b) => b._y);
    expect(a).toEqual([2, 0]); // A: [0,5)->2, [5,10]->0
    expect(b).toEqual([0, 1]); // B: [0,5)->0, [5,10]->1
  });
  it("sums weights when a weight is present (weighted histogram)", () => {
    const out = binValues([{ series: "", x: 1, weight: 3 }, { series: "", x: 2, weight: 4 }], { binWidth: 5, domain: [0, 5] });
    expect(out[0]!._y).toBe(7);
  });
  it("normalize=proportion makes each series sum to 1", () => {
    const out = binValues(rows([0, 1, 9]), { binWidth: 5, domain: [0, 10], normalize: "proportion" });
    expect(out.reduce((s, b) => s + b._y, 0)).toBeCloseTo(1, 9);
  });
  it("normalize=density makes area (sum of _y*width) = 1", () => {
    const out = binValues(rows([0, 1, 9]), { binWidth: 5, domain: [0, 10], normalize: "density" });
    const area = out.reduce((s, b) => s + b._y * (b._x1 - b._x0), 0);
    expect(area).toBeCloseTo(1, 9);
  });
  it("excludes non-finite x from counts and from the normalization total", () => {
    const out = binValues([{ series: "", x: 1 }, { series: "", x: NaN }, { series: "", x: 4 }], { binWidth: 5, domain: [0, 5], normalize: "proportion" });
    expect(out[0]!._y).toBeCloseTo(1, 9);          // 2 finite values, both in [0,5]; proportion sums to 1
    expect(out.reduce((s, b) => s + b._y, 0)).toBeCloseTo(1, 9);
  });
  it("honors explicit shared thresholds (ignores bins/binWidth)", () => {
    const out = binValues(rows([0, 3, 8]), { thresholds: [0, 4, 8] });
    expect(out.map((b) => [b._x0, b._x1, b._y])).toEqual([[0, 4, 2], [4, 8, 1]]);
  });
});
