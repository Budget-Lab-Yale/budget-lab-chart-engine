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
  // Augment [m | I] and reduce the left half to the identity.
  const a = m.map((row, i) => [...row, ...Array.from({ length: p }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < p; col++) {
    let pivot = col;
    for (let r = col + 1; r < p; r++) {
      if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    }
    const pv = a[pivot]![col]!;
    // Scale-aware singularity test: an absolute epsilon would reject a legitimately small-scaled
    // design and accept a badly-scaled singular one.
    let scale = 1;
    for (let j = 0; j < p; j++) scale = Math.max(scale, Math.abs(a[pivot]![j]!));
    if (!Number.isFinite(pv) || Math.abs(pv) < 1e-12 * scale) return null;
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
