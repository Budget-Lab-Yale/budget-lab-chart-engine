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

  it("matches the 99.5% column", () => {
    expect(studentTQuantile(0.995, 30)).toBeCloseTo(2.75, 3);
    expect(studentTQuantile(0.9995, 2)).toBeCloseTo(31.599, 2);
  });
});

// A quantile bisected inside a FIXED bracket saturates at the bracket and reports the bound as the
// answer. `ci` is documented as any level in (0, 1) and df = 1 is reachable (an `lm` through three
// points), so the reachable quantiles run far past any constant one could pick — and a saturated
// critical value makes the ribbon NARROWER than the interval it claims, which for published policy
// research is a substantive error, not a rounding one.
//
// Checked against the CLOSED FORM at df = 1, where Student's t is Cauchy and Q(p) = tan(π(p − ½)):
// an independent reference that needs no printed table, at the df that pushes the quantile furthest.
describe("studentTQuantile — past a fixed bracket", () => {
  const cauchy = (p: number): number => Math.tan(Math.PI * (p - 0.5));

  it("returns the quantile, not the bound, for ci = 0.99999 on 1 df", () => {
    // p = 1 − (1 − 0.99999)/2 = 0.999995 ⇒ t ≈ 63,662, not 10,000.
    const t = studentTQuantile(0.999995, 1);
    expect(t / cauchy(0.999995)).toBeCloseTo(1, 6);
    expect(t).toBeGreaterThan(60000);
  });

  it("tracks the Cauchy closed form out along the tail", () => {
    for (const p of [0.9, 0.99, 0.999, 0.9999, 0.99999, 0.999999, 0.9999999]) {
      expect(studentTQuantile(p, 1) / cauchy(p)).toBeCloseTo(1, 6);
    }
  });

  it("is symmetric in the far tail too", () => {
    expect(studentTQuantile(0.000005, 1) / -cauchy(0.999995)).toBeCloseTo(1, 6);
  });

  // TERMINATION, not accuracy — this one holds before and after the fix, and exists so a growing
  // bracket cannot run away. `1 - Number.EPSILON / 2` is the largest double below 1, i.e. the most
  // extreme level the guard `p < 1` admits at all; the CDF saturates at exactly 1 long before, which
  // is what stops the growth. (`1 - 1e-17` is not such a case: it rounds to exactly 1 and the guard
  // returns NaN.)
  it("returns a finite value at the most extreme level the guard admits", () => {
    const p = 1 - Number.EPSILON / 2;
    expect(p).toBeLessThan(1);
    for (const df of [1, 2, 30]) {
      expect(Number.isFinite(studentTQuantile(p, df))).toBe(true);
      expect(Number.isFinite(studentTQuantile(1 - p, df))).toBe(true);
    }
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

describe("polyFitStdError — temporal x (epoch milliseconds)", () => {
  // The band, not just the line. `polyFitStdError` reads `xtxInv`, so a fix that only got `fitPoly`
  // to stop returning null would relocate the bug into the ribbon: a badly conditioned inverse gives
  // a fitted line that looks right and a confidence band that is nonsense. These assert the band is
  // finite, positive, symmetric, narrowest at the centre, and — the property that matters — NUMERICALLY
  // THE SAME at every x scale, since the quadratic form x₀ᵀ(XᵀX)⁻¹x₀ is dimensionless in the
  // span-normalised position and cannot legitimately depend on whether the span is a day or a decade.
  const DAY = 86_400_000;
  const T0 = Date.UTC(2020, 0, 1);
  const COEF = [3, -2, 1.5, -0.75, 0.4, -0.2];
  const spans: Array<[string, number]> = [
    ["1 day", DAY],
    ["30 days", 30 * DAY],
    ["10 years", 3652 * DAY],
  ];

  /** A degree-`d` curve over `span`, with a deterministic ±0.05 wobble so RSS > 0 and s is real. */
  const sample = (span: number, d: number, n = 24): Array<[number, number]> =>
    Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1);
      let y = 0;
      let pow = 1;
      for (let k = 0; k <= d; k++) {
        y += COEF[k]! * pow;
        pow *= t;
      }
      return [T0 + span * t, y + ((i % 3) - 1) * 0.05] as [number, number];
    });

  for (const [label, span] of spans) {
    for (let d = 2; d <= 5; d++) {
      it(`gives a sane band for a degree-${d} fit over ${label}`, () => {
        const fit = fitPoly(sample(span, d), d);
        expect(fit).not.toBeNull();
        expect(fit!.s).toBeGreaterThan(0);
        const se = (q: number) => polyFitStdError(fit!, T0 + span * q);
        for (const q of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
          expect(Number.isFinite(se(q))).toBe(true);
          expect(se(q)).toBeGreaterThan(0);
          // A band wider than the whole y range would be arithmetic garbage that still passed
          // "finite and positive"; the data spans ~2 units and s is ~0.045 here.
          expect(se(q)).toBeLessThan(1);
        }
        // Narrowest at the centre of the data and wider at both edges. (At degree 2 the variance
        // function's true minimum sits slightly off-centre, near ±¼ of the span — a real property of
        // the design, not an error — so this compares the centre against the edges, not against
        // every interior point.)
        expect(se(0.5)).toBeLessThan(se(0.1));
        expect(se(0.5)).toBeLessThan(se(0.9));
        expect(se(0.5)).toBeLessThan(se(0));
        expect(se(0.5)).toBeLessThan(se(1));
        // Symmetric design → symmetric band.
        expect(se(0)).toBeCloseTo(se(1), 8);
        expect(se(0.25)).toBeCloseTo(se(0.75), 8);
        // And wider still outside the data range, where `domain: axis` extrapolates.
        expect(se(1.3)).toBeGreaterThan(se(1));
      });
    }
  }

  it("gives the same band at every x scale, since the quadratic form is dimensionless", () => {
    for (let d = 2; d <= 5; d++) {
      const fits = spans.map(([, span]) => ({ span, fit: fitPoly(sample(span, d), d)! }));
      for (const q of [0, 0.25, 0.5, 0.75, 1]) {
        const ref = polyFitStdError(fits[0]!.fit, T0 + fits[0]!.span * q);
        for (const { span, fit } of fits.slice(1)) {
          expect(polyFitStdError(fit, T0 + span * q)).toBeCloseTo(ref, 8);
        }
      }
    }
  });
});
