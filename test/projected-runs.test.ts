// Unit tests for the run splitter that generalizes the line builder's whole-series dashed
// split to a per-row `_projected` flag (task 12). Pure data-shape tests — no rendering.
import { describe, it, expect } from "vitest";
import { splitProjectedRuns } from "../src/engine/marks/projected";
import type { PreparedRow } from "../src/engine/marks/index";

function row(series: string, xn: number, y: number | null, projected = false): PreparedRow {
  return { series, time: String(xn), _xn: xn, _y: y, _projected: projected } as PreparedRow;
}

describe("splitProjectedRuns", () => {
  it("no-flag identity: all-actual input returns everything in `actual`, zero copies", () => {
    const rows = [1, 2, 3, 4].map((x) => row("A", x, x * 10));
    const { actual, projected } = splitProjectedRuns(rows);
    expect(projected.length).toBe(0);
    expect(actual.length).toBe(rows.length);
    expect(actual.map((r) => r._y)).toEqual(rows.map((r) => r._y));
  });

  it("splits two disjoint projected runs per series, extending each with ≤2 boundary copies", () => {
    // x: 1,2 actual | 3,4 projected | 5,6,7,8 actual | 9,10 projected(trailing)
    const flags = [0, 0, 1, 1, 0, 0, 0, 0, 1, 1];
    const rows = flags.map((f, i) => row("A", i + 1, (i + 1) * 10, !!f));
    const { actual, projected } = splitProjectedRuns(rows);

    // Interior run [3,4]: extended left (x=2) and right (x=5) → 4 rows.
    const interiorSeg = projected.find((r) => r._xn === 3)!._seg;
    const interiorRun = projected.filter((r) => r._seg === interiorSeg);
    expect(interiorRun.map((r) => r._xn)).toEqual([2, 3, 4, 5]);

    // Trailing run [9,10]: extended left (x=8) only, no right neighbor → 3 rows.
    const trailingSeg = projected.find((r) => r._xn === 9)!._seg;
    const trailingRun = projected.filter((r) => r._seg === trailingSeg);
    expect(trailingRun.map((r) => r._xn)).toEqual([8, 9, 10]);

    // Actual runs are NOT extended: [1,2] and [5,6,7,8], untouched.
    const actualSegs = new Set(actual.map((r) => r._seg));
    expect(actualSegs.size).toBe(2);
    expect(actual.filter((r) => r._xn! <= 2).map((r) => r._xn)).toEqual([1, 2]);
    expect(actual.filter((r) => r._xn! >= 5).map((r) => r._xn)).toEqual([5, 6, 7, 8]);

    // Total boundary-point duplication across both projected runs: interior run gains 2 copies
    // (left + right), trailing run gains 1 (left only) — 3 total, each run ≤2.
    const totalRaw = rows.filter((r) => r._projected).length; // 4 raw projected rows
    expect(projected.length - totalRaw).toBe(3);
  });

  it("handles multiple series independently, preserving each series' own run structure", () => {
    const a = [0, 1, 1, 0].map((f, i) => row("A", i + 1, (i + 1) * 10, !!f));
    const b = [0, 0, 1, 0].map((f, i) => row("B", i + 1, (i + 1) * 100, !!f));
    const rows = [a[0]!, b[0]!, a[1]!, b[1]!, a[2]!, b[2]!, a[3]!, b[3]!]; // interleaved input
    const { actual, projected } = splitProjectedRuns(rows);
    expect(projected.filter((r) => r.series === "A").map((r) => r._xn)).toEqual([1, 2, 3, 4]);
    expect(projected.filter((r) => r.series === "B").map((r) => r._xn)).toEqual([2, 3, 4]);
    expect(actual.filter((r) => r.series === "A").map((r) => r._xn)).toEqual([1, 4]);
    expect(actual.filter((r) => r.series === "B").map((r) => r._xn)).toEqual([1, 2, 4]);
  });

  it("a leading projected run (no preceding row) is extended on the right only", () => {
    const rows = [1, 1, 0, 0].map((f, i) => row("A", i + 1, (i + 1) * 10, !!f));
    const { projected } = splitProjectedRuns(rows);
    expect(projected.map((r) => r._xn)).toEqual([1, 2, 3]); // + right neighbor (x=3), no left
  });

  it("a trailing projected run (no following row) is extended on the left only", () => {
    const rows = [0, 0, 1, 1].map((f, i) => row("A", i + 1, (i + 1) * 10, !!f));
    const { projected } = splitProjectedRuns(rows);
    expect(projected.map((r) => r._xn)).toEqual([2, 3, 4]); // left neighbor (x=2) + the run
  });

  it("a null (_y non-finite) point is a hard boundary and is never duplicated", () => {
    // x=1 actual, x=2 null (gap), x=3,4 projected.
    const rows = [
      row("A", 1, 10, false),
      row("A", 2, null, false),
      row("A", 3, 30, true),
      row("A", 4, 40, true),
    ];
    const { actual, projected } = splitProjectedRuns(rows);
    // The projected run's left neighbor (x=2) is non-finite -> NOT duplicated; no left extension.
    expect(projected.map((r) => r._xn)).toEqual([3, 4]);
    // The null row itself appears exactly once (in whichever bucket its own flag places it),
    // never duplicated into the projected run.
    const nullCount = [...actual, ...projected].filter((r) => r._xn === 2).length;
    expect(nullCount).toBe(1);
  });

  it("never mutates the input rows", () => {
    const rows = [0, 1, 1, 0].map((f, i) => row("A", i + 1, (i + 1) * 10, !!f));
    const snapshot = JSON.parse(JSON.stringify(rows));
    splitProjectedRuns(rows);
    expect(JSON.parse(JSON.stringify(rows))).toEqual(snapshot);
    expect(rows.every((r) => !("_seg" in r))).toBe(true);
  });
});
