// Least-squares fitting for `overlays[].method` — `lm` is degree 1, `poly` is degree 2–5. PURE:
// numbers in, numbers out, no DOM and no spec, the same contract shade.ts states.
//
// Deliberately BIVARIATE only. The engine fits y against the plotted x and nothing else; a
// multi-predictor model (a `regress y x1 x2` whose coefficients an author partials out at a mean) is
// not something a chart spec should express, and `overlays[].fun` with `params` is the supported path
// for one. That restriction keeps this module to a p×p normal-equations solve with p ≤ 6.
//
// x is CENTRED at its mean before the Vandermonde is built. On Budget Lab data x is routinely a year
// (2000+) or an epoch-ms date (1e12+), where the uncentred x⁴ column of a quadratic reaches 1e13 and
// the normal equations lose most of their significant digits. Centring costs one subtraction per
// evaluation and is the difference between a right answer and a plausible one, so `coef` is only
// meaningful through `evalPolyFit`.

export interface PolyFit {
  /** Coefficients in CENTRED x: ŷ = coef[0] + coef[1]·(x−xBar) + … + coef[d]·(x−xBar)^d.
   *  Not raw powers of x — always evaluate through `evalPolyFit`. */
  coef: number[];
  /** The mean x the fit is centred on. */
  xBar: number;
  /** Residual standard error, s = √(RSS / (n − p)). NaN when n ≤ p (no residual df) — a legal fit
   *  with no uncertainty estimate rather than an error. */
  s: number;
  /** Observations actually used (non-finite pairs dropped). */
  n: number;
  /** Parameters, = degree + 1. */
  p: number;
  /** (XᵀX)⁻¹ in the centred basis, p×p row-major. Only the confidence interval reads it. */
  xtxInv: number[][];
}

/** Gauss-Jordan inverse with partial pivoting. Null if the matrix is singular to working precision —
 *  which is how a degenerate design (every x identical, or fewer distinct x values than parameters)
 *  is reported, rather than as silent Infinities in the coefficients. */
function invert(m: number[][]): number[][] | null {
  const p = m.length;
  // Per-column reference scale, read from the ORIGINAL matrix once, before any row operation. A
  // pivot can only be judged against its own column's native magnitude: a column that starts small
  // (e.g. a Vandermonde entry on a small-scaled design, XᵀX entries ~1e-16) is not evidence of
  // singularity, and a large column elsewhere in the same matrix must not raise the bar for it — so
  // this is neither a matrix-wide scale nor a fixed absolute floor. Floored at Number.EPSILON only
  // so a column that is genuinely all-zero (truly singular from the start) still produces a nonzero
  // tolerance a zero pivot fails, rather than the vacuous `0 < 0` an unfloored zero scale would give.
  const colScale = Array.from({ length: p }, (_, j) => {
    let s = 0;
    for (let i = 0; i < p; i++) s = Math.max(s, Math.abs(m[i]![j]!));
    return Math.max(s, Number.EPSILON);
  });
  // Augment [m | I] and reduce the left half to the identity.
  const a = m.map((row, i) => [...row, ...Array.from({ length: p }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < p; col++) {
    let pivot = col;
    for (let r = col + 1; r < p; r++) {
      if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    }
    const pv = a[pivot]![col]!;
    if (!Number.isFinite(pv) || Math.abs(pv) < 1e-12 * colScale[col]!) return null;
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    const prow = a[col]!;
    for (let j = 0; j < 2 * p; j++) prow[j] = prow[j]! / pv;
    for (let r = 0; r < p; r++) {
      if (r === col) continue;
      const f = a[r]![col]!;
      if (f === 0) continue;
      for (let j = 0; j < 2 * p; j++) a[r]![j] = a[r]![j]! - f * prow[j]!;
    }
  }
  return a.map((row) => row.slice(p));
}

export function fitPoly(pts: Array<[number, number]>, degree: number): PolyFit | null {
  const d = Math.floor(degree);
  // Below-1 degrees are degenerate (not just "clamp to 1"): the caller's contract is a spec-validated
  // 1 (lm) or 2–5 (poly), so a value outside that reports null rather than silently fitting a line
  // for a nonsensical request.
  if (!Number.isFinite(d) || d < 1) return null;
  const p = d + 1;
  const clean = pts.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const n = clean.length;
  if (n < p) return null;

  let xSum = 0;
  for (const [x] of clean) xSum += x;
  const xBar = xSum / n;

  // Centred design rows, [1, u, u², …, u^d] with u = x − xBar.
  const rows = clean.map(([x]) => {
    const u = x - xBar;
    const r: number[] = [1];
    for (let k = 1; k < p; k++) r.push(r[k - 1]! * u);
    return r;
  });

  // Normal equations: XᵀX (p×p) and Xᵀy (p).
  const xtx: number[][] = Array.from({ length: p }, () => Array.from({ length: p }, () => 0));
  const xty: number[] = Array.from({ length: p }, () => 0);
  for (let i = 0; i < n; i++) {
    const r = rows[i]!;
    const y = clean[i]![1];
    for (let a = 0; a < p; a++) {
      xty[a] = xty[a]! + r[a]! * y;
      for (let b = a; b < p; b++) xtx[a]![b] = xtx[a]![b]! + r[a]! * r[b]!;
    }
  }
  for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) xtx[a]![b] = xtx[b]![a]!;

  const xtxInv = invert(xtx);
  if (!xtxInv) return null;

  const coef = xtxInv.map((row) => row.reduce((s, v, j) => s + v * xty[j]!, 0));
  if (!coef.every(Number.isFinite)) return null;

  let rss = 0;
  for (let i = 0; i < n; i++) {
    const r = rows[i]!;
    const yhat = coef.reduce((s, c, k) => s + c * r[k]!, 0);
    const e = clean[i]![1] - yhat;
    rss += e * e;
  }
  const s = n > p ? Math.sqrt(rss / (n - p)) : NaN;

  return { coef, xBar, s, n, p, xtxInv };
}

/** ŷ at one x, in the ORIGINAL x units. */
export function evalPolyFit(fit: PolyFit, x: number): number {
  const u = x - fit.xBar;
  let pow = 1;
  let out = 0;
  for (let k = 0; k < fit.coef.length; k++) {
    out += fit.coef[k]! * pow;
    pow *= u;
  }
  return out;
}

/** Standard error of the fitted MEAN response at x: s·√(x₀ᵀ(XᵀX)⁻¹x₀), with x₀ the centred design
 *  row. This is the interval around the FIT — R's `predict(..., interval = "confidence")` and Stata's
 *  `lfitci` — not a prediction interval for a new observation, which is wider. NaN when the fit has no
 *  residual df, in which case the caller draws the line without a band. */
export function polyFitStdError(fit: PolyFit, x: number): number {
  if (!Number.isFinite(fit.s)) return NaN;
  const u = x - fit.xBar;
  const row: number[] = [1];
  for (let k = 1; k < fit.p; k++) row.push(row[k - 1]! * u);
  let q = 0;
  for (let a = 0; a < fit.p; a++) {
    for (let b = 0; b < fit.p; b++) q += row[a]! * fit.xtxInv[a]![b]! * row[b]!;
  }
  return q <= 0 ? NaN : fit.s * Math.sqrt(q);
}

// --- Student's t, for the interval's multiplier -------------------------------------------------
// Implemented here rather than pulled in: the engine vendors its dependencies as pinned ESM bundles
// (src/engine/vendor.ts) and a distribution library is a poor trade for one quantile. The continued
// fraction is the standard one for the regularized incomplete beta; test/fit-ci.test.ts checks the
// results against published t-table values, which is the only meaningful test of this code.

/** Lanczos log-gamma. */
function lgamma(z: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  const x = z - 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < g.length; i++) a += g[i]! / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the incomplete beta (modified Lentz). */
function betacf(a: number, b: number, x: number): number {
  const TINY = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-16) break;
  }
  return h;
}

/** Regularized incomplete beta, I_x(a, b). */
function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2)
    ? (front * betacf(a, b, x)) / a
    : 1 - (front * betacf(b, a, 1 - x)) / b;
}

/** P(T ≤ t) for Student's t with `df` degrees of freedom. */
function studentTCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const tail = 0.5 * betai(df / 2, 0.5, x);
  return t > 0 ? 1 - tail : tail;
}

/** The p-quantile of Student's t. Bisection on the CDF: a monotone function, fast enough for the
 *  handful of calls one chart makes and much easier to verify than a rational approximation. */
export function studentTQuantile(p: number, df: number): number {
  if (!(p > 0 && p < 1) || !(df > 0)) return NaN;
  if (p === 0.5) return 0;
  let lo = -1e4;
  let hi = 1e4;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (studentTCdf(mid, df) < p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-10) break;
  }
  return (lo + hi) / 2;
}
