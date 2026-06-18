import { describe, it, expect } from "vitest";
import { computeBarYExtent } from "../src/engine/scales";
import type { PreparedRow } from "../src/engine/marks/index";
import type { ChartSpec } from "../src/spec/types";

// Minimal ChartSpec factory — only the fields computeBarYExtent reads.
function makeSpec(overrides: Partial<ChartSpec> = {}): ChartSpec {
  return {
    chartType: "bar",
    title: "Test",
    xAxisType: "categorical",
    data: "test.csv",
    ...overrides,
  } as ChartSpec;
}

// Helpers to build PreparedRow arrays.
function barRows(values: number[]): PreparedRow[] {
  return values.map((v, i) => ({
    series: "A",
    time: String(i),
    _y: v,
    _xc: `cat${i}`,
  }));
}

function stackedRows(
  entries: { cat: string; series: string; y: number }[],
): PreparedRow[] {
  return entries.map(({ cat, series, y }) => ({
    series,
    time: cat,
    _y: y,
    _xc: cat,
  }));
}

describe("computeBarYExtent — grouped bar", () => {
  it("positive-only data: min=0, max=dataMax*1.05", () => {
    const rows = barRows([10, 20, 15]);
    const result = computeBarYExtent(rows, makeSpec({ chartType: "bar" }), "bar");
    expect(result.min).toBe(0);
    expect(result.max).toBeCloseTo(20 * 1.05);
  });

  it("with negatives: min<0, max=dataMax*1.05, zero within range", () => {
    const rows = barRows([-5, 10, -3]);
    const result = computeBarYExtent(rows, makeSpec({ chartType: "bar" }), "bar");
    expect(result.min).toBe(-5);
    expect(result.max).toBeCloseTo(10 * 1.05);
    expect(result.min).toBeLessThan(0);
    expect(result.max).toBeGreaterThan(0);
  });

  it("all-negative data: max=0 (floor at 0 after headroom on 0)", () => {
    const rows = barRows([-5, -10]);
    const result = computeBarYExtent(rows, makeSpec({ chartType: "bar" }), "bar");
    // dataMax = max(0, -5, -10) = 0; 0*1.05 = 0
    expect(result.max).toBe(0);
    expect(result.min).toBe(-10);
  });
});

describe("computeBarYExtent — stacked (all positive)", () => {
  it("max = max category total * 1.08 (net-text headroom), min=0", () => {
    // cat1: A=10 + B=5 = 15; cat2: A=8 + B=20 = 28
    const rows = stackedRows([
      { cat: "cat1", series: "A", y: 10 },
      { cat: "cat1", series: "B", y: 5 },
      { cat: "cat2", series: "A", y: 8 },
      { cat: "cat2", series: "B", y: 20 },
    ]);
    const result = computeBarYExtent(
      rows,
      makeSpec({ chartType: "stacked" }),
      "stacked",
    );
    expect(result.min).toBe(0);
    // posMax = 28; headroom = 1.08 (auto → text, no negatives)
    expect(result.max).toBeCloseTo(28 * 1.08);
  });
});

describe("computeBarYExtent — stacked diverging (mixed sign)", () => {
  it("max=posMax*1.05, min=negMin, zero within range", () => {
    // cat1: A=10 + B=-3 → pos=10, neg=-3; cat2: A=6 + B=-8 → pos=6, neg=-8
    const rows = stackedRows([
      { cat: "cat1", series: "A", y: 10 },
      { cat: "cat1", series: "B", y: -3 },
      { cat: "cat2", series: "A", y: 6 },
      { cat: "cat2", series: "B", y: -8 },
    ]);
    const result = computeBarYExtent(
      rows,
      makeSpec({ chartType: "stacked" }),
      "stacked",
    );
    // posMax = max(10, 6) = 10; negMin = min(-3, -8) = -8
    expect(result.max).toBeCloseTo(10 * 1.05); // negatives present → default headroom
    expect(result.min).toBe(-8);
    expect(result.min).toBeLessThan(0);
    expect(result.max).toBeGreaterThan(0);
  });
});

describe("computeBarYExtent — stacked normalize=true", () => {
  it("returns {min:0, max:100} regardless of data", () => {
    const rows = stackedRows([
      { cat: "cat1", series: "A", y: 0.6 },
      { cat: "cat1", series: "B", y: 0.4 },
    ]);
    const result = computeBarYExtent(
      rows,
      makeSpec({ chartType: "stacked", barStack: { normalize: true } }),
      "stacked",
    );
    expect(result).toEqual({ min: 0, max: 100 });
  });
});

describe("computeBarYExtent — empty data", () => {
  it("returns safe default {min:0, max:1}, does not throw", () => {
    const result = computeBarYExtent([], makeSpec({ chartType: "bar" }), "bar");
    expect(result).toEqual({ min: 0, max: 1 });
  });

  it("handles all-null _y values without throwing", () => {
    const rows: PreparedRow[] = [
      { series: "A", time: "x", _y: null, _xc: "cat1" },
      { series: "B", time: "x", _y: null, _xc: "cat1" },
    ];
    const result = computeBarYExtent(rows, makeSpec({ chartType: "bar" }), "bar");
    expect(result).toEqual({ min: 0, max: 1 });
  });
});

describe("computeBarYExtent — netDisplay explicit", () => {
  it('netDisplay="dot" keeps default 1.05 headroom even with no negatives', () => {
    const rows = stackedRows([
      { cat: "cat1", series: "A", y: 10 },
      { cat: "cat1", series: "B", y: 5 },
    ]);
    const result = computeBarYExtent(
      rows,
      makeSpec({ chartType: "stacked", barStack: { netDisplay: "dot" } }),
      "stacked",
    );
    expect(result.max).toBeCloseTo(15 * 1.05);
  });

  it('netDisplay="text" explicit uses 1.08 headroom', () => {
    const rows = stackedRows([
      { cat: "cat1", series: "A", y: 10 },
      { cat: "cat1", series: "B", y: 5 },
    ]);
    const result = computeBarYExtent(
      rows,
      makeSpec({ chartType: "stacked", barStack: { netDisplay: "text" } }),
      "stacked",
    );
    expect(result.max).toBeCloseTo(15 * 1.08);
  });
});
