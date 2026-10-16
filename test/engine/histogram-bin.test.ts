import { describe, it, expect } from "vitest";
import { computeThresholds, binValues } from "../../src/engine/histogram-bin";
import { calendarEdges, temporalThresholds } from "../../src/engine/histogram-bin";

const ms = (iso: string) => Date.parse(iso + "T00:00:00Z");

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

  // A3: the edge loop stopped at a FIXED `max - 1e-9`. At magnitudes ≳1e7 (dollar microdata, epoch
  // ms) the accumulated edge lands a few ulps short of max, still above max - 1e-9, so one extra
  // edge was pushed: a sliver bin [max - ~1e-8, max] that swallowed the max observation(s).
  it("draws exactly `bins` bins at large magnitudes (no sliver bin before max)", () => {
    for (const [lo, hi, n] of [
      [1e7, 3e7, 6],
      [1e7, 3e7, 11],
      [12345678, 98765432, 11],
    ] as const) {
      const t = computeThresholds([lo, hi], { bins: n, domain: [lo, hi] });
      expect(t.length - 1, `${lo}..${hi} / ${n}`).toBe(n);
      expect(t[t.length - 1]).toBe(hi);
    }
  });

  it("draws exactly `bins` bins on an epoch-ms temporal span (the rendered 8-for-7 case)", () => {
    const t = temporalThresholds([ms("1990-03-07"), ms("1991-08-19")], undefined, 7, undefined);
    expect(t.length - 1).toBe(7);
    // The max observation lands in a real bin, not a zero-width one.
    const out = binValues(rows([ms("1990-03-07"), ms("1991-08-19"), ms("1991-08-19")]), { thresholds: t });
    expect(out[out.length - 1]!._y).toBe(2);
    expect(out[out.length - 1]!._x1 - out[out.length - 1]!._x0).toBeGreaterThan(86400000);
  });

  it("changes no edge but the sliver: every other edge is bit-identical to the old loop", () => {
    const oldLoop = (min: number, max: number, width: number) => {
      const e: number[] = [];
      for (let x = min; x < max - 1e-9; x += width) e.push(x);
      e.push(max);
      return e;
    };
    let slivers = 0;
    // The last row: bins narrower than 1e-3 at a large offset, where a tolerance tighter than the
    // old 1e-9 would CREATE float-error slivers the old loop dropped.
    for (const [lo, hi] of [
      [0, 1], [-1, 2.25], [0.5, 97.3], [1e7, 3e7], [12345678, 98765432], [1e9, 7e9],
      [41248.2756513365, 41248.27585216979],
      // Bins only ~100 ulps wide: the rounding bound exceeds a bin here, and uncapped it removed
      // several real edges, not one sliver.
      [68241177.63771486, 68241177.63779189],
    ]) {
      for (let n = 1; n <= 40; n++) {
        const before = oldLoop(lo!, hi!, (hi! - lo!) / n);
        const after = computeThresholds([lo!, hi!], { bins: n, domain: [lo!, hi!] });
        if (before.length === after.length) {
          expect(after, `${lo}..${hi} / ${n}`).toEqual(before);
        } else {
          // The only difference allowed: the old loop's extra edge just below max.
          slivers++;
          expect(before.length, `${lo}..${hi} / ${n}`).toBe(after.length + 1);
          expect(before.slice(0, -2)).toEqual(after.slice(0, -1));
          // ... and it lies within the loop's accumulated rounding error of max (4 ulps of the
          // magnitude per step), never further: a real short bin is kept.
          const errBound = n * 4 * Number.EPSILON * Math.max(Math.abs(lo!), Math.abs(hi!));
          expect(hi! - before[before.length - 2]!).toBeLessThanOrEqual(Math.max(1e-9, errBound));
        }
      }
    }
    expect(slivers, "the sweep must include sliver cases, or it tests nothing").toBeGreaterThan(0);
  });

  it("keeps a genuine short final bin, however small next to a wide binWidth", () => {
    // A tolerance proportional to the bin width (1e9 * 1e-6 = 1000) swallowed this real 1-unit
    // remainder and merged its counts into the bin before. Only rounding error is dropped.
    const t = computeThresholds([0, 1000000001], { binWidth: 1000000000, domain: [0, 1000000001] });
    expect(t).toEqual([0, 1000000000, 1000000001]);
    const out = binValues(rows([5, 1000000000, 1000000001]), { thresholds: t });
    expect(out.map((b) => b._y)).toEqual([1, 2]);
  });

  it("keeps the minimum edge when binWidth exceeds the domain: one bin, not an empty edge list", () => {
    // The tolerance scales with the width, so a width far past the domain put the stop below min
    // and the loop pushed nothing: [max] alone, which is rejected as thresholds and replaced by
    // automatic binning.
    expect(computeThresholds([0, 1], { binWidth: 1e9, domain: [0, 1] })).toEqual([0, 1]);
    const out = binValues(rows([0, 0.5, 1]), { binWidth: 1e9, domain: [0, 1] });
    expect(out.map((b) => [b._x0, b._x1, b._y])).toEqual([[0, 1, 3]]);
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

describe("temporal edges", () => {
  it("calendarEdges by month covers the range on month boundaries", () => {
    const e = calendarEdges(ms("2024-01-10"), ms("2024-03-05"), "month");
    expect(e[0]).toBe(ms("2024-01-01"));
    expect(e).toContain(ms("2024-02-01"));
    expect(e).toContain(ms("2024-03-01"));
    expect(e[e.length - 1]).toBeGreaterThanOrEqual(ms("2024-04-01"));
  });
  it("temporalThresholds with a day-count width steps in whole days", () => {
    const t = temporalThresholds([ms("2024-01-01"), ms("2024-01-08")], 7, undefined, undefined);
    expect(t[1]! - t[0]!).toBe(7 * 86400000);
  });
  it("temporalThresholds with a bin count divides the ms range evenly", () => {
    const t = temporalThresholds([0, 100], undefined, 4, [0, 100]);
    expect(t).toEqual([0, 25, 50, 75, 100]);
  });
});
