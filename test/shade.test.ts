// Pure tests for the line-to-baseline shading core (src/engine/shade.ts). No DOM.
//
// buildShadeRuns turns ONE series' x-ordered points into contiguous fill runs, cutting at the
// x-range bounds and (for a side filter) at zero crossings, interpolating a synthetic point at
// every cut so the fill edge lands exactly where the author asked instead of at the nearest point.
import { describe, it, expect } from "vitest";
import { buildShadeRuns } from "../src/engine/shade";
import type { PreparedRow } from "../src/engine/marks/index";

/** Numeric-x points; `_xn` is the parsed x the numeric adapter uses. */
function pts(pairs: Array<[number, number]>): PreparedRow[] {
  return pairs.map(([x, y]) => ({ series: "A", time: String(x), _y: y, _xn: x })) as PreparedRow[];
}

/** Flatten runs to [[x, y], ...] per run, for readable assertions. */
function shape(runs: Array<{ rows: PreparedRow[] }>): Array<Array<[number, number]>> {
  return runs.map((r) => r.rows.map((row) => [row._xn as number, row._y as number]));
}

const FULL = { from: null, to: null };

describe("buildShadeRuns — side: both (crop only)", () => {
  it("returns one run covering every point when unbounded", () => {
    const runs = buildShadeRuns(pts([[2020, 5], [2021, -3], [2022, 8]]), "_xn", {
      side: "both",
      ...FULL,
    });
    expect(shape(runs)).toEqual([[[2020, 5], [2021, -3], [2022, 8]]]);
  });

  it("does not split at a zero crossing", () => {
    const runs = buildShadeRuns(pts([[0, 4], [1, -4]]), "_xn", { side: "both", ...FULL });
    expect(runs.length).toBe(1);
  });

  it("returns nothing for empty input", () => {
    expect(buildShadeRuns([], "_xn", { side: "both", ...FULL })).toEqual([]);
  });

  it("keeps a single point as a one-point run", () => {
    const runs = buildShadeRuns(pts([[2020, 5]]), "_xn", { side: "both", ...FULL });
    expect(shape(runs)).toEqual([[[2020, 5]]]);
  });

  it("tags each run with a distinct _seg so Plot cannot bridge them", () => {
    const runs = buildShadeRuns(pts([[0, 5], [1, -5], [2, 5]]), "_xn", {
      side: "positive",
      ...FULL,
    });
    const segs = runs.map((r) => (r.rows[0] as unknown as { _seg: string })._seg);
    expect(segs.length).toBe(2);
    expect(new Set(segs).size).toBe(2);
    // Every row within a run shares that run's _seg.
    for (const run of runs) {
      const seg = (run.rows[0] as unknown as { _seg: string })._seg;
      for (const row of run.rows) expect((row as unknown as { _seg: string })._seg).toBe(seg);
    }
  });
});

describe("buildShadeRuns — x-range crop", () => {
  const data = pts([[2020, 10], [2021, 20], [2022, 30], [2023, 40]]);

  it("interpolates a synthetic point when a bound falls between two points", () => {
    const runs = buildShadeRuns(data, "_xn", { side: "both", from: 2020.5, to: 2022.5 });
    expect(shape(runs)).toEqual([[[2020.5, 15], [2021, 20], [2022, 30], [2022.5, 35]]]);
  });

  it("inserts nothing when a bound lands exactly on a point", () => {
    const runs = buildShadeRuns(data, "_xn", { side: "both", from: 2021, to: 2022 });
    expect(shape(runs)).toEqual([[[2021, 20], [2022, 30]]]);
  });

  it("clamps a bound outside the data to the data extent", () => {
    const runs = buildShadeRuns(data, "_xn", { side: "both", from: 1990, to: 2050 });
    expect(shape(runs)).toEqual([[[2020, 10], [2021, 20], [2022, 30], [2023, 40]]]);
  });

  it("supports an open-ended lower bound", () => {
    const runs = buildShadeRuns(data, "_xn", { side: "both", from: null, to: 2021 });
    expect(shape(runs)).toEqual([[[2020, 10], [2021, 20]]]);
  });

  it("supports an open-ended upper bound", () => {
    const runs = buildShadeRuns(data, "_xn", { side: "both", from: 2022, to: null });
    expect(shape(runs)).toEqual([[[2022, 30], [2023, 40]]]);
  });

  it("returns nothing when from > to", () => {
    expect(buildShadeRuns(data, "_xn", { side: "both", from: 2023, to: 2020 })).toEqual([]);
  });

  it("returns nothing when the range falls entirely outside the data", () => {
    expect(buildShadeRuns(data, "_xn", { side: "both", from: 2030, to: 2040 })).toEqual([]);
  });

  it("yields a degenerate two-point run when from === to between points", () => {
    // A zero-width range paints nothing visible, but must not produce a malformed run.
    const runs = buildShadeRuns(data, "_xn", { side: "both", from: 2021.5, to: 2021.5 });
    expect(shape(runs)).toEqual([[[2021.5, 25]]]);
  });
});

describe("buildShadeRuns — side split at zero", () => {
  it("keeps an all-positive series as one run for side: positive", () => {
    const runs = buildShadeRuns(pts([[0, 3], [1, 7]]), "_xn", { side: "positive", ...FULL });
    expect(shape(runs)).toEqual([[[0, 3], [1, 7]]]);
  });

  it("returns nothing for side: negative on an all-positive series", () => {
    expect(buildShadeRuns(pts([[0, 3], [1, 7]]), "_xn", { side: "negative", ...FULL })).toEqual([]);
  });

  it("keeps an all-negative series as one run for side: negative", () => {
    const runs = buildShadeRuns(pts([[0, -3], [1, -7]]), "_xn", { side: "negative", ...FULL });
    expect(shape(runs)).toEqual([[[0, -3], [1, -7]]]);
  });

  it("interpolates the zero crossing so the fill closes flat on the baseline", () => {
    // 10 → -10 across x 0→1 crosses zero at x = 0.5.
    const runs = buildShadeRuns(pts([[0, 10], [1, -10]]), "_xn", { side: "positive", ...FULL });
    expect(shape(runs)).toEqual([[[0, 10], [0.5, 0]]]);
  });

  it("gives the negative side the same crossing point", () => {
    const runs = buildShadeRuns(pts([[0, 10], [1, -10]]), "_xn", { side: "negative", ...FULL });
    expect(shape(runs)).toEqual([[[0.5, 0], [1, -10]]]);
  });

  it("interpolates an asymmetric crossing correctly", () => {
    // 30 → -10 across x 0→4: zero at x = 3.
    const runs = buildShadeRuns(pts([[0, 30], [4, -10]]), "_xn", { side: "positive", ...FULL });
    expect(shape(runs)).toEqual([[[0, 30], [3, 0]]]);
  });

  it("splits a series that crosses zero twice into two positive runs", () => {
    const runs = buildShadeRuns(pts([[0, 10], [1, -10], [2, 10]]), "_xn", {
      side: "positive",
      ...FULL,
    });
    expect(shape(runs)).toEqual([
      [[0, 10], [0.5, 0]],
      [[1.5, 0], [2, 10]],
    ]);
  });

  it("uses an exact-zero point as the run boundary without synthesizing a crossing", () => {
    const runs = buildShadeRuns(pts([[0, 10], [1, 0], [2, -10]]), "_xn", {
      side: "positive",
      ...FULL,
    });
    expect(shape(runs)).toEqual([[[0, 10], [1, 0]]]);
  });

  it("does not split a series that only touches zero without crossing", () => {
    const runs = buildShadeRuns(pts([[0, 10], [1, 0], [2, 10]]), "_xn", {
      side: "positive",
      ...FULL,
    });
    expect(shape(runs)).toEqual([[[0, 10], [1, 0], [2, 10]]]);
  });

  it("never emits a run consisting only of a zero point", () => {
    const runs = buildShadeRuns(pts([[0, -10], [1, 0], [2, -10]]), "_xn", {
      side: "positive",
      ...FULL,
    });
    expect(runs).toEqual([]);
  });

  it("returns nothing for an all-zero series on either side", () => {
    const flat = pts([[0, 0], [1, 0]]);
    expect(buildShadeRuns(flat, "_xn", { side: "positive", ...FULL })).toEqual([]);
    expect(buildShadeRuns(flat, "_xn", { side: "negative", ...FULL })).toEqual([]);
  });
});

describe("buildShadeRuns — crop and side split composed", () => {
  it("crops first, then splits, with the bound inside a negative stretch", () => {
    // Points: +10, -10, -10, +10. Crop to [0.5, 2.5] lands mid-descent and mid-ascent.
    const data = pts([[0, 10], [1, -10], [2, -10], [3, 10]]);
    const runs = buildShadeRuns(data, "_xn", { side: "negative", from: 0.75, to: 2.5 });
    // Crop interpolates mid-descent at 0.75 (10 → -10 over 0 → 1, so y = -5) and mid-ascent at
    // 2.5 (-10 → 10 over 2 → 3, so y = 0). Every cropped point is then already on the negative
    // side (or at zero), so the side split leaves one run — no crossing to synthesize.
    expect(shape(runs)).toEqual([[[0.75, -5], [1, -10], [2, -10], [2.5, 0]]]);
  });

  it("keeps only the positive part of a cropped range", () => {
    const data = pts([[0, 20], [1, 20], [2, -20], [3, -20]]);
    const runs = buildShadeRuns(data, "_xn", { side: "positive", from: 0.5, to: 2.5 });
    expect(shape(runs)).toEqual([[[0.5, 20], [1, 20], [1.5, 0]]]);
  });
});

describe("buildShadeRuns — temporal x", () => {
  const d = (iso: string) => new Date(iso);
  function tpts(pairs: Array<[string, number]>): PreparedRow[] {
    return pairs.map(([iso, y]) => ({
      series: "A",
      time: iso,
      _y: y,
      _xd: d(iso),
    })) as PreparedRow[];
  }

  it("interpolates a bound on epoch ms", () => {
    const data = tpts([["2020-01-01", 0], ["2020-01-03", 20]]);
    const runs = buildShadeRuns(data, "_xd", {
      side: "both",
      from: d("2020-01-02"),
      to: null,
    });
    const rows = runs[0]!.rows;
    expect((rows[0]!._xd as Date).toISOString()).toBe(d("2020-01-02").toISOString());
    expect(rows[0]!._y).toBe(10);
  });

  it("interpolates a zero crossing on epoch ms", () => {
    const data = tpts([["2020-01-01", 10], ["2020-01-03", -10]]);
    const runs = buildShadeRuns(data, "_xd", { side: "positive", ...FULL });
    const rows = runs[0]!.rows;
    expect(rows.length).toBe(2);
    expect((rows[1]!._xd as Date).toISOString()).toBe(d("2020-01-02").toISOString());
    expect(rows[1]!._y).toBe(0);
  });
});

describe("buildShadeRuns — categorical x", () => {
  function cpts(pairs: Array<[string, number]>): PreparedRow[] {
    return pairs.map(([cat, y]) => ({ series: "A", time: cat, _y: y, _xc: cat })) as PreparedRow[];
  }
  const data = cpts([["a", 10], ["b", 20], ["c", -5], ["d", 8]]);

  it("crops by category position, interpolating nothing", () => {
    const runs = buildShadeRuns(data, "_xc", { side: "both", from: "b", to: "c" });
    expect(runs[0]!.rows.map((r) => [r._xc, r._y])).toEqual([
      ["b", 20],
      ["c", -5],
    ]);
  });

  it("splits at a sign change on the enclosing points, with no synthetic crossing", () => {
    const runs = buildShadeRuns(data, "_xc", { side: "positive", ...FULL });
    expect(runs.map((r) => r.rows.map((row) => row._xc))).toEqual([["a", "b"], ["d"]]);
  });

  it("returns nothing when a bound names a category the data lacks", () => {
    expect(buildShadeRuns(data, "_xc", { side: "both", from: "zz", to: null })).toEqual([]);
  });
});
