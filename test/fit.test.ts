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

  // x = [2, 6, 7]: xBar = 5, centred u = [-3, 1, 2] — ASYMMETRIC about the mean (Σu³ = -18 ≠ 0),
  // unlike the two degree-1 cases above (both symmetric, Σu³ = 0 there trivially). This is the
  // smallest fixture that exercises the u·u² coupling: XᵀX = [[3,0,14],[0,14,-18],[14,-18,98]]
  // (Σ1=3, Σu=0, Σu²=14, Σu³=-18, Σu⁴=98). By cofactor/adjugate expansion: det = 400, adjugate =
  // [[1048,-252,-196],[-252,98,54],[-196,54,42]], so (XᵀX)⁻¹ = adjugate/400 — verified by hand by
  // multiplying it back against XᵀX and confirming the product is the identity.
  it("matches a hand-computed (cofactor/adjugate) inverse for an asymmetric degree-2 design", () => {
    const f = fitPoly([[2, 1], [6, 2], [7, 3]], 2)!;
    expect(f.xBar).toBeCloseTo(5, 10);
    const expected = [
      [2.62, -0.63, -0.49],
      [-0.63, 0.245, 0.135],
      [-0.49, 0.135, 0.105],
    ];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) expect(f.xtxInv[i]![j]!).toBeCloseTo(expected[i]![j]!, 10);
    }
  });
});

describe("fitPoly — pivot-tolerance scale (the singularity test in invertNormalMatrix)", () => {
  // Regression: the singularity check used to compare a pivot to a scale floored at a fixed 1, so a
  // well-conditioned design whose real magnitudes are all under 1 (XᵀX here is essentially
  // diag(3, 2e-16) — the 2e-16 entry is an exact sum of squares, not a cancellation artifact) was
  // misread as singular. XᵀX is now equilibrated to a unit diagonal before the test, which removes
  // the design's scale from the comparison entirely, so this must fit.
  it("accepts a well-conditioned design whose scale is far below 1", () => {
    const f = fitPoly([[1e-8, 1], [2e-8, 2], [3e-8, 3]], 1);
    expect(f).not.toBeNull();
    expect(evalPolyFit(f!, 4e-8)).toBeCloseTo(4, 6);
    expect(evalPolyFit(f!, 0)).toBeCloseTo(0, 6);
  });

  // The mirror-image scale (x ~ 1e8) already worked before the fix; pin it so the fix can't trade
  // the small-scale false positive for a large-scale one.
  it("still accepts a well-conditioned design at a large x scale", () => {
    const f = fitPoly([[1e8, 1], [2e8, 2], [3e8, 3]], 1);
    expect(f).not.toBeNull();
    expect(evalPolyFit(f!, 4e8)).toBeCloseTo(4, 4);
  });

  // A repeated x value leaves only 5 distinct x's for a 6-parameter (degree-5) design — genuinely
  // rank-deficient, not just small-scaled. Pins that the scale fix above cannot be loosened into
  // accepting real degeneracy.
  it("still rejects a genuinely rank-deficient design", () => {
    const pts: Array<[number, number]> = [
      [2020, 1],
      [2020, 2],
      [2020.01, 3],
      [2020.02, 4],
      [2020.03, 5],
      [2020.04, 6],
    ];
    expect(fitPoly(pts, 5)).toBeNull();
  });
});

describe("fitPoly — temporal x (epoch milliseconds)", () => {
  // A temporal x-axis hands the fit epoch milliseconds, so a 1-day span is an x-spread of 8.64e7 and
  // the u⁴ column of XᵀX reaches 5e31. `invert`'s singularity test used to judge each pivot against
  // that ORIGINAL column magnitude while the pivot actually reached in the column scales as u², so
  // the tolerance outgrew the thing it measured and every degree-≥2 fit was reported singular past an
  // x-spread of roughly 707,000 ms — about TWELVE MINUTES. `poly` therefore drew nothing at all for
  // any real date data, which is exactly the path validate.ts recommends on a temporal axis
  // ("`fun` … is not supported on a temporal x-axis … Use `method` or `column` there").
  //
  // These fits are on data lying EXACTLY on a known polynomial, so non-null is not the assertion —
  // reproducing the known curve is. `t` below is the position within the span (0 at the start, 1 at
  // the end), which keeps y O(1) at every span while the polynomial in x itself stays exact.
  const DAY = 86_400_000;
  const T0 = Date.UTC(2020, 0, 1);
  const COEF = [3, -2, 1.5, -0.75, 0.4, -0.2];
  const spans: Array<[string, number]> = [
    ["1 day", DAY],
    ["30 days", 30 * DAY],
    ["10 years", 3652 * DAY],
  ];

  /** The true curve: a degree-`d` polynomial in the span-normalised position of x. */
  const truth = (span: number, d: number) => (x: number) => {
    const t = (x - T0) / span;
    let y = 0;
    let pow = 1;
    for (let k = 0; k <= d; k++) {
      y += COEF[k]! * pow;
      pow *= t;
    }
    return y;
  };

  const sample = (span: number, d: number, n = 12): Array<[number, number]> => {
    const f = truth(span, d);
    return Array.from({ length: n }, (_, i) => {
      const x = T0 + (span * i) / (n - 1);
      return [x, f(x)] as [number, number];
    });
  };

  for (const [label, span] of spans) {
    for (let d = 2; d <= 5; d++) {
      it(`recovers a degree-${d} curve over ${label} of epoch milliseconds`, () => {
        const f = truth(span, d);
        const fit = fitPoly(sample(span, d), d);
        expect(fit).not.toBeNull();
        // Interior, both endpoints, and outside the data range (what `domain: axis` extrapolates to).
        for (const q of [-0.25, 0, 0.17, 0.5, 0.83, 1, 1.25]) {
          const x = T0 + span * q;
          const want = f(x);
          expect(evalPolyFit(fit!, x)).toBeCloseTo(want, 6);
          // Relative form too: `toBeCloseTo(·, 6)` is absolute, and these y values are O(1) by
          // construction, so pin the relative error where the absolute check is weakest.
          expect(Math.abs(evalPolyFit(fit!, x) - want) / Math.max(1, Math.abs(want))).toBeLessThan(
            1e-9,
          );
        }
      });
    }
  }

  it("fits a degree-1 line on a temporal axis (the case that already worked)", () => {
    const pts: Array<[number, number]> = [0, 1, 2, 3].map(
      (i) => [T0 + i * DAY, 10 + 2 * i] as [number, number],
    );
    const fit = fitPoly(pts, 1)!;
    expect(evalPolyFit(fit, T0 + 4 * DAY)).toBeCloseTo(18, 6);
  });

  // The fix works by equilibrating XᵀX, which makes the pivot test dimensionless — so the SAME design
  // at three wildly different x scales must produce the same fitted values at the same relative
  // positions. This is the property whose absence was the bug; a scale-dependent test could not have
  // it.
  it("is invariant to the x scale: identical fitted values at identical relative positions", () => {
    for (let d = 2; d <= 5; d++) {
      const fits = spans.map(([, span]) => ({ span, fit: fitPoly(sample(span, d), d)! }));
      for (const q of [0, 0.3, 0.5, 0.7, 1]) {
        const ref = evalPolyFit(fits[0]!.fit, T0 + fits[0]!.span * q);
        for (const { span, fit } of fits.slice(1)) {
          expect(evalPolyFit(fit, T0 + span * q)).toBeCloseTo(ref, 8);
        }
      }
    }
  });

  // The equilibrated test must not have bought temporal fits by going permissive: a temporal design
  // with fewer distinct x values than parameters is still rank-deficient and must still be null,
  // rather than coefficients full of garbage that the caller would happily draw.
  it("still rejects a rank-deficient temporal design", () => {
    const dup: Array<[number, number]> = [0, 0, 1, 2, 3, 4].map(
      (i, k) => [T0 + i * DAY, k] as [number, number],
    );
    expect(fitPoly(dup, 5)).toBeNull();
    const oneDate: Array<[number, number]> = [1, 2, 3, 4].map((y) => [T0, y] as [number, number]);
    expect(fitPoly(oneDate, 2)).toBeNull();
  });
});
