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
});

describe("resolveOverlays — column", () => {
  function withCol(pairs: Array<[number, number]>, yhats: number[], series = "A"): PreparedRow[] {
    return rows(pairs, series).map((r, i) => ({
      ...r,
      _overlayCols: { yhat: yhats[i] as number },
    })) as PreparedRow[];
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
