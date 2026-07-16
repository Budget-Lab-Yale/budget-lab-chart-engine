import { describe, it, expect } from "vitest";
import {
  computeYAxis,
  makeTickFormatter,
  computeWaterfallSteps,
  computeWaterfallYExtent,
} from "../src/engine/scales";
import type { PreparedRow } from "../src/engine/marks/index";

const wfRow = (cat: string, y: number | null, kind?: string): PreparedRow =>
  ({ series: "", time: cat, _xc: cat, _y: y, ...(kind ? { _kind: kind } : {}) }) as PreparedRow;

describe("computeYAxis", () => {
  it("honors a hard domain override (ignoring the data extent), niced like the tracker", () => {
    // Data alone would give ~[0,8]; the override locks the range. As in the tracker,
    // d3 .nice() rounds the supplied bounds outward to round tick boundaries.
    const { domain, ticks } = computeYAxis([3, 7], { domain: [0, 100], tickCount: 5 });
    expect(domain).toEqual([0, 100]);
    expect(ticks).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it("nices the data extent when no domain is given", () => {
    const { domain } = computeYAxis([2.3, 9.8], { tickCount: 5 });
    expect(domain[0]).toBeLessThanOrEqual(2.3);
    expect(domain[1]).toBeGreaterThanOrEqual(9.8);
  });

  it("extends the domain to include zero when asked", () => {
    const { domain } = computeYAxis([5, 12], { includeZero: true });
    expect(domain[0]).toBe(0);
  });

  it("falls back to [0,1] when no value is finite", () => {
    // Note: +null === 0, so nulls DO count (as 0) — only genuinely non-finite inputs
    // trigger the fallback. This mirrors the tracker's axis behavior for blank rows.
    expect(computeYAxis([NaN, undefined])).toEqual({ domain: [0, 1], ticks: [0, 1] });
  });
});

describe("makeTickFormatter", () => {
  it("uses no decimals when every tick is an integer", () => {
    const fmt = makeTickFormatter([0, 4, 8, 12, 16]);
    expect(fmt(8)).toBe("8");
  });

  it("uses the max precision across the tick array", () => {
    const fmt = makeTickFormatter([0, 0.5, 1]);
    expect(fmt(1)).toBe("1.0");
    expect(fmt(0.5)).toBe("0.5");
  });

  it("appends a units suffix", () => {
    const fmt = makeTickFormatter([0, 4, 8], "%");
    expect(fmt(4)).toBe("4%");
  });
});

describe("computeWaterfallSteps", () => {
  it("floats deltas on the running cumulative; explicit total rebases, blank total = auto sum", () => {
    const steps = computeWaterfallSteps([
      wfRow("Start", 100, "total"),
      wfRow("Up", 20),
      wfRow("Down", -30),
      wfRow("End", null, "total"),
    ]);
    expect(steps.map((s) => [s.cat, s.base, s.top, s.level])).toEqual([
      ["Start", 0, 100, 100], // explicit total: bar 0→100, running := 100
      ["Up", 100, 120, 120], // delta +20
      ["Down", 90, 120, 90], // delta −30 (falls)
      ["End", 0, 90, 90], // blank total: bar 0→running(90)
    ]);
    expect(steps.map((s) => s.rise)).toEqual([true, true, false, true]);
  });

  it("skip steps keep their slot and leave the running total untouched", () => {
    const steps = computeWaterfallSteps([
      wfRow("A", 10),
      wfRow("Gap", null, "skip"),
      wfRow("B", 5),
    ]);
    expect(steps[1]).toMatchObject({ cat: "Gap", kind: "skip", base: 10, top: 10, level: 10 });
    expect(steps[2]).toMatchObject({ cat: "B", base: 10, top: 15, level: 15 }); // B builds from 10, not the gap
  });
});

describe("computeWaterfallYExtent", () => {
  it("spans the whole cumulative path (including a dip below zero) with headroom", () => {
    const ext = computeWaterfallYExtent([
      wfRow("Start", 50, "total"),
      wfRow("Down", -90), // running → −40
      wfRow("Up", 100), // running → 60
    ]);
    expect(ext.min).toBeLessThanOrEqual(-40);
    expect(ext.max).toBeGreaterThanOrEqual(60);
  });
});
