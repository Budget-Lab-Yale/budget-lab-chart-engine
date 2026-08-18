// Pure tests for the confidence-interval machinery. The t quantiles are checked against published
// table values, which is the only way to know a hand-rolled distribution function is right.
import { describe, it, expect } from "vitest";
import { fitPoly, polyFitStdError, studentTQuantile } from "../src/engine/fit";

describe("studentTQuantile", () => {
  it("matches the two-sided 95% table values", () => {
    expect(studentTQuantile(0.975, 1)).toBeCloseTo(12.706, 2);
    expect(studentTQuantile(0.975, 2)).toBeCloseTo(4.303, 2);
    expect(studentTQuantile(0.975, 10)).toBeCloseTo(2.228, 3);
    expect(studentTQuantile(0.975, 30)).toBeCloseTo(2.042, 3);
  });

  it("matches the 99% column", () => {
    expect(studentTQuantile(0.995, 10)).toBeCloseTo(3.169, 2);
  });

  it("approaches the normal quantile at large df", () => {
    expect(studentTQuantile(0.975, 100000)).toBeCloseTo(1.96, 3);
  });

  it("is symmetric about zero", () => {
    expect(studentTQuantile(0.025, 10)).toBeCloseTo(-studentTQuantile(0.975, 10), 8);
  });

  it("is zero at the median", () => {
    expect(studentTQuantile(0.5, 7)).toBeCloseTo(0, 8);
  });
});

describe("polyFitStdError", () => {
  // (0,1) (1,3) (2,2): s = sqrt(1.5), xBar = 1, Sxx = 2. At x = xBar the standard error of the mean
  // is s/sqrt(n) = sqrt(1.5/3) = sqrt(0.5).
  it("is s/sqrt(n) at the mean of x", () => {
    const f = fitPoly([[0, 1], [1, 3], [2, 2]], 1)!;
    expect(polyFitStdError(f, 1)).toBeCloseTo(Math.sqrt(0.5), 10);
  });

  // At x = 0, u = -1: se = s * sqrt(1/n + u²/Sxx) = sqrt(1.5) * sqrt(1/3 + 1/2).
  it("widens away from the mean of x", () => {
    const f = fitPoly([[0, 1], [1, 3], [2, 2]], 1)!;
    expect(polyFitStdError(f, 0)).toBeCloseTo(Math.sqrt(1.5) * Math.sqrt(1 / 3 + 1 / 2), 10);
    expect(polyFitStdError(f, 0)).toBeGreaterThan(polyFitStdError(f, 1));
  });

  it("is NaN when the fit has no residual degrees of freedom", () => {
    const f = fitPoly([[1, 1], [2, 3]], 1)!;
    expect(Number.isNaN(polyFitStdError(f, 1.5))).toBe(true);
  });

  // The trap: x0 must be built in the CENTRED basis ([1, u, u², …] with u = x - xBar), not raw x.
  // A raw-x row vector would still produce a plausible-looking band (nonzero, wider away from some
  // point) but its width would drift under an arbitrary shift of the whole x axis, since xtxInv is
  // fixed for a given design while a raw x0 grows with x. The centred basis is invariant to the shift
  // because u (and therefore x0 and the resulting quadratic form) is unchanged when every x and xBar
  // move together.
  it("is invariant to a constant shift added to every x (centred-basis check)", () => {
    const pts: Array<[number, number]> = [[0, 1], [1, 3], [2, 2]];
    const shifted: Array<[number, number]> = pts.map(([x, y]) => [x + 1000, y]);
    const f = fitPoly(pts, 1)!;
    const g = fitPoly(shifted, 1)!;
    for (const x of [0, 0.5, 1, 1.5, 2]) {
      expect(polyFitStdError(g, x + 1000)).toBeCloseTo(polyFitStdError(f, x), 9);
    }
  });
});
