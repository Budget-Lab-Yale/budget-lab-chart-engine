import { describe, it, expect } from "vitest";
import { computeYAxis, makeTickFormatter } from "../src/engine/scales";

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
