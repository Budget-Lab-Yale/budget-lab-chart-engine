// Pure tests for overlay resolution (src/engine/overlays.ts): spec entries + prepared rows in,
// polylines out. No DOM. The rendering wiring is test/overlays-render.test.ts.
//
// Every spec used here is one the validator ACCEPTS — a resolve test that encodes a rejected spec
// proves nothing about the code path a real chart takes.
import { describe, it, expect } from "vitest";
import { resolveOverlays } from "../src/engine/overlays";
import { TBL } from "../src/engine/theme";
import type { ChartSpec, Overlay } from "../src/spec/types";
import type { PreparedRow } from "../src/engine/marks/index";

function rows(pairs: Array<[number, number]>, series = "A"): PreparedRow[] {
  return pairs.map(([x, y]) => ({ series, time: String(x), _y: y, _xn: x })) as PreparedRow[];
}

/** Rows where a `null` y is a BLANK value cell (`_y: null`) — exactly what engine/index.ts's prep
 *  builds from an empty cell, and the only non-number a resolver can see (validate.ts rejects
 *  non-numeric cells). */
function rowsWithBlanks(pairs: Array<[number, number | null]>, series = "A"): PreparedRow[] {
  return pairs.map(([x, y]) => ({ series, time: String(x), _y: y, _xn: x })) as PreparedRow[];
}

const CTX = {
  xField: "_xn" as const,
  colors: new Map([["A", "#1111aa"], ["B", "#aa1111"]]),
  seriesNames: ["A"],
  xDomain: [0, 10] as [number, number],
  legendActive: true,
};

function resolve(overlays: Overlay[], data = rows([[1, 1], [2, 2], [3, 3]]), ctx = CTX) {
  return resolveOverlays({ overlays } as unknown as ChartSpec, data, ctx);
}

/** First and last drawn point, for readable endpoint assertions. */
const ends = (o: { points: Array<{ x: number; y: number | null }> }) => [
  o.points[0],
  o.points[o.points.length - 1],
];

describe("resolveOverlays — abline", () => {
  it("draws y = x across the resolved x-domain by default", () => {
    const [o] = resolve([{ slope: 1, intercept: 0 }]);
    expect(ends(o!)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
  });

  it("honours an explicit numeric domain", () => {
    const [o] = resolve([{ slope: 2, intercept: 1, domain: [-1, 1] }]);
    expect(ends(o!)).toEqual([{ x: -1, y: -1 }, { x: 1, y: 3 }]);
  });

  it("defaults to dashed — a line asserted over the data, not fitted from it", () => {
    expect(resolve([{ slope: 1, intercept: 0 }])[0]!.dashed).toBe(true);
  });

  it("takes the dim annotation neutral, not a series colour", () => {
    expect(resolve([{ slope: 1, intercept: 0 }])[0]!.color).toBe(TBL.color.annotationDim);
  });
});

describe("resolveOverlays — fun", () => {
  it("samples an expression over the x-domain", () => {
    const [o] = resolve([{ fun: "2*x + 1", n: 3 }]);
    expect(o!.points).toEqual([
      { x: 0, y: 1 },
      { x: 5, y: 11 },
      { x: 10, y: 21 },
    ]);
  });

  it("substitutes named params", () => {
    const [o] = resolve([{ fun: "b0 + b1*x", params: { b0: 100, b1: -10 }, n: 2 }]);
    expect(ends(o!)).toEqual([{ x: 0, y: 100 }, { x: 10, y: 0 }]);
  });

  it("breaks the line at a non-finite sample instead of dropping the overlay", () => {
    // Samples at -1, 0, 1: log(-1) is NaN, log(0) is -Infinity, log(1) is 0.
    const [o] = resolve([{ fun: "log(x)", domain: [-1, 1], n: 3 }]);
    expect(o!.points.map((p) => p.y)).toEqual([null, null, 0]);
  });

  it("defaults to 100 samples", () => {
    expect(resolve([{ fun: "x" }])[0]!.points.length).toBe(100);
  });

  it("defaults to dashed", () => {
    expect(resolve([{ fun: "x" }])[0]!.dashed).toBe(true);
  });
});

describe("resolveOverlays — method", () => {
  it("fits a line through the plotted points and spans their extent by default", () => {
    const [o] = resolve([{ method: "lm" }]);
    expect(ends(o!)).toEqual([{ x: 1, y: 1 }, { x: 3, y: 3 }]);
  });

  it("spans the whole axis with domain: axis, extrapolating past the data", () => {
    const [o] = resolve([{ method: "lm", domain: "axis" }]);
    const [first, last] = ends(o!);
    expect(first!.x).toBe(0);
    expect(first!.y).toBeCloseTo(0, 8);
    expect(last!.x).toBe(10);
    expect(last!.y).toBeCloseTo(10, 8);
  });

  it("defaults to SOLID — a line computed from these data", () => {
    expect(resolve([{ method: "lm" }])[0]!.dashed).toBe(false);
  });

  it("takes its series' colour when fitting per series", () => {
    const [o] = resolve([{ method: "lm" }]);
    expect(o!.color).toBe("#1111aa");
    expect(o!.series).toBe("A");
  });

  it("fits one line per series by default", () => {
    const data = [...rows([[1, 1], [2, 2]], "A"), ...rows([[1, 5], [2, 6]], "B")];
    const out = resolve([{ method: "lm" }], data, { ...CTX, seriesNames: ["A", "B"] });
    expect(out.length).toBe(2);
    expect(out.map((o) => o.series)).toEqual(["A", "B"]);
    expect(out.map((o) => o.color)).toEqual(["#1111aa", "#aa1111"]);
  });

  it("pools every point with by: none, and keys no series", () => {
    const data = [...rows([[1, 1], [2, 2]], "A"), ...rows([[1, 5], [2, 6]], "B")];
    const out = resolve([{ method: "lm", by: "none" }], data, { ...CTX, seriesNames: ["A", "B"] });
    expect(out.length).toBe(1);
    expect(out[0]!.series).toBeUndefined();
    expect(out[0]!.color).toBe(TBL.color.annotationDim);
  });

  it("fits a quadratic exactly when the data are quadratic", () => {
    const [o] = resolve(
      [{ method: "poly", degree: 2, domain: [0, 3] }],
      rows([[0, 0], [1, 1], [2, 4]]),
    );
    const last = o!.points[o!.points.length - 1]!;
    expect(last.x).toBe(3);
    expect(last.y).toBeCloseTo(9, 6);
  });

  it("drops a group it cannot fit rather than emitting an empty line", () => {
    expect(resolve([{ method: "lm" }], rows([[1, 1]])).length).toBe(0);
  });

  // The default domain is CONFIG-SPEC's "the fitted group's data extent": the extent of the
  // observations the fit ACTUALLY used. A row with a blank value cell is skipped by the fitting
  // loop, so its x is not part of that extent — including it drew the line out to an observation
  // the fit never saw, which is extrapolation presented as fit.
  it("stops at the last FITTED observation, not at a trailing blank value", () => {
    const [o] = resolve([{ method: "lm" }], rowsWithBlanks([[1, 1], [2, 2], [3, 3], [5, null]]));
    expect(ends(o!)).toEqual([{ x: 1, y: 1 }, { x: 3, y: 3 }]);
  });

  it("starts at the first FITTED observation, not at a leading blank value", () => {
    const [o] = resolve([{ method: "lm" }], rowsWithBlanks([[0, null], [1, 1], [2, 2], [3, 3]]));
    expect(ends(o!)[0]).toEqual({ x: 1, y: 1 });
  });

  it("drops a group whose only two distinct x values carry no value", () => {
    // Every fittable point sits at one x: no extent, so there is nothing to draw — the blank rows
    // must not manufacture a width the fit cannot support.
    expect(resolve([{ method: "lm" }], rowsWithBlanks([[1, 1], [1, 2], [4, null]])).length).toBe(0);
  });

  it("still extrapolates to the axis with domain: axis, blank rows or not", () => {
    const [o] = resolve(
      [{ method: "lm", domain: "axis" }],
      rowsWithBlanks([[1, 1], [2, 2], [3, 3], [5, null]]),
    );
    expect(ends(o!)[1]!.x).toBe(10);
  });
});

describe("resolveOverlays — confidence ribbon (ci)", () => {
  it("adds no band without `ci`", () => {
    const [o] = resolve([{ method: "lm" }]);
    expect(o!.band).toBeUndefined();
  });

  it("bands the FITTED extent, not a trailing blank row's x", () => {
    const [o] = resolve(
      [{ method: "lm", ci: 0.95 }],
      rowsWithBlanks([[0, 1], [1, 3], [2, 2], [9, null]]),
    );
    expect(o!.band!.at(-1)!.x).toBe(2);
  });

  it("adds a band spanning the same x samples as the line, bracketing the fit", () => {
    const [o] = resolve([{ method: "lm", ci: 0.95 }], rows([[0, 1], [1, 3], [2, 2]]));
    expect(o!.band).toBeDefined();
    expect(o!.band!.map((b) => b.x)).toEqual(o!.points.map((p) => p.x));
    for (let i = 0; i < o!.band!.length; i++) {
      const b = o!.band![i]!;
      const y = o!.points[i]!.y;
      expect(b.lo).toBeLessThanOrEqual(y!);
      expect(b.hi).toBeGreaterThanOrEqual(y!);
    }
  });

  // n === p: fitPoly still succeeds (a line through 2 points is exact) but s is NaN — no residual
  // df to estimate it from. A NaN half-width must degrade to no band, never to NaN coordinates.
  it("omits the band, but not the line, when the fit has no residual degrees of freedom", () => {
    const [o] = resolve([{ method: "lm", ci: 0.95 }], rows([[1, 1], [2, 2]]));
    expect(o!.points.length).toBeGreaterThan(0);
    expect(o!.band).toBeUndefined();
  });

  it("does not populate a band for a `fun` overlay even if `ci` were present", () => {
    const [o] = resolve([{ fun: "x", ci: 0.95 } as unknown as Overlay]);
    expect(o!.band).toBeUndefined();
  });
});

describe("resolveOverlays — column", () => {
  /** `_overlayCols` exactly as engine/index.ts's prep builds it: a BLANK cell leaves the key
   *  ABSENT (the prep `continue`s past it, and omits the bag entirely when nothing landed in it),
   *  which is what a `null` in `yhats` means here. Non-numeric cells never reach this code —
   *  validate.ts rejects them — so "absent" is the only non-number a resolver can see. */
  function withCol(
    pairs: Array<[number, number]>,
    yhats: Array<number | null>,
    series = "A",
  ): PreparedRow[] {
    return rows(pairs, series).map((r, i) => {
      const v = yhats[i];
      return (v == null ? r : { ...r, _overlayCols: { yhat: v } }) as PreparedRow;
    });
  }

  it("draws the column's values, x-ordered, per series", () => {
    const [o] = resolve([{ column: "yhat" }], withCol([[3, 3], [1, 1], [2, 2]], [3.5, 1.5, 2.5]));
    expect(o!.points).toEqual([
      { x: 1, y: 1.5 },
      { x: 2, y: 2.5 },
      { x: 3, y: 3.5 },
    ]);
  });

  it("defaults to solid", () => {
    expect(resolve([{ column: "yhat" }], withCol([[1, 1], [2, 2]], [1, 2]))[0]!.dashed).toBe(false);
  });

  it("crops to an explicit domain", () => {
    const [o] = resolve(
      [{ column: "yhat", domain: [1.5, 3] }],
      withCol([[1, 1], [2, 2], [3, 3]], [1, 2, 3]),
    );
    expect(o!.points.map((p) => p.x)).toEqual([2, 3]);
  });

  // CONFIG-SPEC.md's `overlays[].column` row: "A blank cell is treated as absent, not as zero, so a
  // sparse column breaks its line rather than diving to the baseline." The break is the half that was
  // missing — the blank row was skipped outright, so the polyline joined 2 → 4 and rerouted the line.
  it("emits a BREAK at a blank cell instead of joining across it", () => {
    const [o] = resolve(
      [{ column: "yhat" }],
      withCol([[1, 1], [2, 2], [3, 3], [4, 4]], [1, 2, null, 4]),
    );
    expect(o!.points).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: null },
      { x: 4, y: 4 },
    ]);
  });

  it("keeps the break in x order when the rows arrive unsorted", () => {
    const [o] = resolve(
      [{ column: "yhat" }],
      withCol([[4, 4], [2, 2], [3, 3], [1, 1]], [4, 2, null, 1]),
    );
    expect(o!.points).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: null },
      { x: 4, y: 4 },
    ]);
  });

  it("counts only REAL points against the two-point minimum, not the breaks", () => {
    // One value and two blanks is not a line. If the break placeholders counted, this would resolve
    // to a 'line' of a single vertex.
    expect(resolve([{ column: "yhat" }], withCol([[1, 1], [2, 2], [3, 3]], [null, 2, null]))).toEqual(
      [],
    );
  });

  // The domain default is stated for `column` too, and this path already honours it by a different
  // mechanism than `method`'s: a row past the last value IS admitted by the default domain, but it
  // emits a BREAK, and a trailing break opens no segment (marks/overlay.ts#runsOf) — so the drawn
  // line already stops at the data. Asserted so a later domain change cannot quietly extend it.
  it("draws nothing past the last real value when the trailing cells are blank", () => {
    const [o] = resolve([{ column: "yhat" }], withCol([[1, 1], [2, 2], [3, 3]], [1, 2, null]));
    const drawn = o!.points.filter((p) => p.y != null);
    expect(drawn.at(-1)).toEqual({ x: 2, y: 2 });
  });

  it("does not emit a break for a row cropped OUT by the domain", () => {
    // Outside the drawn extent is not a gap in the line — the line simply stops there.
    const [o] = resolve(
      [{ column: "yhat", domain: [1, 3] }],
      withCol([[1, 1], [2, 2], [3, 3], [4, 4]], [1, 2, 3, null]),
    );
    expect(o!.points).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]);
  });
});

describe("resolveOverlays — shared fields", () => {
  it("an explicit style beats the per-kind default in both directions", () => {
    expect(resolve([{ method: "lm", style: "dashed" }])[0]!.dashed).toBe(true);
    expect(resolve([{ slope: 1, intercept: 0, style: "solid" }])[0]!.dashed).toBe(false);
  });

  it("an explicit colour beats the default", () => {
    expect(resolve([{ method: "lm", color: "#00ff00" }])[0]!.color).toBe("#00ff00");
  });

  it("carries the label and its placement defaults", () => {
    const [o] = resolve([{ fun: "x", label: "45 degrees" }]);
    expect(o!.label).toBe("45 degrees");
    expect(o!.keyed).toBe(false);
    expect(o!.labelSide).toBe("top");
    expect(o!.labelPosition).toBe("right");
  });

  it("moves the label to a legend key when legend: true, leaving nothing in-frame", () => {
    const [o] = resolve([{ fun: "x", label: "45 degrees", legend: true }]);
    expect(o!.keyed).toBe(true);
    expect(o!.label).toBeUndefined();
  });

  it("KEEPS the in-frame label when the chart's legend is off entirely", () => {
    // Mirrors annotation-legend.ts's labelMovedToLegend: with no legend to move the label TO, moving
    // it would delete it from the figure.
    const [o] = resolve([{ fun: "x", label: "45 degrees", legend: true }], rows([[1, 1], [2, 2]]), {
      ...CTX,
      legendActive: false,
    });
    expect(o!.keyed).toBe(false);
    expect(o!.label).toBe("45 degrees");
  });

  it("paints in list order", () => {
    const out = resolve([{ fun: "x", n: 2 }, { slope: 0, intercept: 1 }]);
    expect(out.length).toBe(2);
    expect(out[0]!.points[1]!.y).toBe(10);
    expect(out[1]!.points[1]!.y).toBe(1);
  });

  it("returns nothing when the spec declares no overlays", () => {
    expect(resolveOverlays({} as ChartSpec, rows([[1, 1]]), CTX)).toEqual([]);
  });
});
