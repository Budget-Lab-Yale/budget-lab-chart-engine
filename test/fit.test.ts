// Pure tests for the overlay fit core (src/engine/fit.ts). No DOM, no spec.
//
// Every expected value is hand-computable, so a failure points at the arithmetic rather than at a
// fixture nobody can check. `lm` is degree 1; there is no separate linear path.
import { describe, it, expect } from "vitest";
import { fitPoly, evalPolyFit } from "../src/engine/fit";

describe("fitPoly — degree 1 (lm)", () => {
  it("recovers an exact line", () => {
    const f = fitPoly([[1, 1], [2, 2], [3, 3]], 1)!;
    expect(evalPolyFit(f, 0)).toBeCloseTo(0, 10);
    expect(evalPolyFit(f, 10)).toBeCloseTo(10, 10);
  });

  // (0,1) (1,3) (2,2): xBar 1, ybar 2, Sxy 1, Sxx 2 → slope 0.5, so ŷ = 2 + 0.5(x-1).
  it("computes the least-squares line for a non-exact fit", () => {
    const f = fitPoly([[0, 1], [1, 3], [2, 2]], 1)!;
    expect(evalPolyFit(f, 0)).toBeCloseTo(1.5, 10);
    expect(evalPolyFit(f, 1)).toBeCloseTo(2.0, 10);
    expect(evalPolyFit(f, 2)).toBeCloseTo(2.5, 10);
  });

  // Residuals -0.5, 1.0, -0.5 → RSS 1.5, df 1 → s = sqrt(1.5).
  it("reports the residual standard error", () => {
    const f = fitPoly([[0, 1], [1, 3], [2, 2]], 1)!;
    expect(f.n).toBe(3);
    expect(f.p).toBe(2);
    expect(f.s).toBeCloseTo(Math.sqrt(1.5), 10);
  });

  it("extrapolates outside the data range, which is what domain: axis needs", () => {
    const f = fitPoly([[1, 1], [2, 2]], 1)!;
    expect(evalPolyFit(f, -1000)).toBeCloseTo(-1000, 6);
    expect(evalPolyFit(f, 1000)).toBeCloseTo(1000, 6);
  });
});

describe("fitPoly — degree 2 (poly / qfit)", () => {
  // (0,0) (1,1) (2,4) lie exactly on y = x².
  it("recovers an exact quadratic", () => {
    const f = fitPoly([[0, 0], [1, 1], [2, 4]], 2)!;
    expect(evalPolyFit(f, 3)).toBeCloseTo(9, 8);
    expect(evalPolyFit(f, -2)).toBeCloseTo(4, 8);
  });

  it("stays conditioned on x values far from zero, where a raw Vandermonde would not", () => {
    // y = (x - 2000)² on a year-scale x. Uncentred, the x⁴ column reaches 1.6e13 and the normal
    // equations lose most of their precision; centring is what keeps this exact.
    const pts: Array<[number, number]> = [1998, 1999, 2000, 2001, 2002].map(
      (x) => [x, (x - 2000) ** 2] as [number, number],
    );
    const f = fitPoly(pts, 2)!;
    expect(evalPolyFit(f, 2003)).toBeCloseTo(9, 6);
  });
});

describe("fitPoly — degenerate input", () => {
  it("returns null with fewer points than parameters", () => {
    expect(fitPoly([[1, 1]], 1)).toBeNull();
    expect(fitPoly([[1, 1], [2, 2]], 2)).toBeNull();
  });

  it("returns null for no points", () => {
    expect(fitPoly([], 1)).toBeNull();
  });

  it("returns null when every x is identical, so the design is singular", () => {
    expect(fitPoly([[5, 1], [5, 2], [5, 3]], 1)).toBeNull();
  });

  it("drops non-finite pairs before fitting", () => {
    const f = fitPoly([[1, 1], [NaN, 5], [2, 2], [3, Infinity], [3, 3]], 1)!;
    expect(f.n).toBe(3);
    expect(evalPolyFit(f, 4)).toBeCloseTo(4, 10);
  });

  it("reports s as NaN when there are no residual degrees of freedom", () => {
    const f = fitPoly([[1, 1], [2, 3]], 1)!;
    expect(f.n).toBe(2);
    expect(Number.isNaN(f.s)).toBe(true);
  });

  // A validated spec only ever asks for lm (1) or poly (2-5); anything below 1 must report null
  // rather than silently being clamped up to a line nobody asked for.
  it("returns null for a degree below 1", () => {
    expect(fitPoly([[1, 1], [2, 2], [3, 3]], 0)).toBeNull();
    expect(fitPoly([[1, 1], [2, 2], [3, 3]], -1)).toBeNull();
  });
});

describe("fitPoly — xtxInv pinned by hand", () => {
  // Two points (0,0) and (2,0), degree 1: xBar = 1, centred u = [-1, 1].
  // X = [[1,-1],[1,1]] (rows). XᵀX = [[2,0],[0,2]] (cross term Σu = 0 by construction of xBar).
  // (XᵀX)⁻¹ = [[0.5,0],[0,0.5]].
  it("matches the hand-computed inverse for a 2-point centred design", () => {
    const f = fitPoly([[0, 0], [2, 0]], 1)!;
    expect(f.xBar).toBeCloseTo(1, 10);
    expect(f.xtxInv[0]![0]!).toBeCloseTo(0.5, 10);
    expect(f.xtxInv[0]![1]!).toBeCloseTo(0, 10);
    expect(f.xtxInv[1]![0]!).toBeCloseTo(0, 10);
    expect(f.xtxInv[1]![1]!).toBeCloseTo(0.5, 10);
  });

  // Three points (0,·) (1,·) (2,·), degree 1: xBar = 1, centred u = [-1, 0, 1].
  // XᵀX = [[3,0],[0,2]] (Σu = 0, Σu² = 2) → (XᵀX)⁻¹ = [[1/3,0],[0,0.5]].
  it("matches the hand-computed inverse for a 3-point centred design", () => {
    const f = fitPoly([[0, 5], [1, 5], [2, 5]], 1)!;
    expect(f.xtxInv[0]![0]!).toBeCloseTo(1 / 3, 10);
    expect(f.xtxInv[0]![1]!).toBeCloseTo(0, 10);
    expect(f.xtxInv[1]![0]!).toBeCloseTo(0, 10);
    expect(f.xtxInv[1]![1]!).toBeCloseTo(0.5, 10);
  });
});
