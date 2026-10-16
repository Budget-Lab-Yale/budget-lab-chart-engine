// The one "fewest decimals the data needs" count, shared by every printed value that derives its
// precision from the values themselves: stacked value labels (marks/stacked.ts), waterfall labels and
// hover delta (scales.ts waterfallValueDecimals) and axis ticks (scales.ts makeTickFormatter, via
// tickFractionDigits).
//
// Each value is rounded to SIGNIFICANT_DIGITS of the set's largest magnitude before its decimals are
// counted, so float noise is not counted as precision: 1.1 + 2.2 is 3.3000000000000003 and counts 1,
// and a stacked net that cancels to 5.6e-17 beside a 2 counts 0. The count reads toFixed(), never
// String(), so a value String() writes in exponent form (1e-7) counts its real decimals (7). Through
// 1.18.0 the count read String(v): noise read as 16 or 17 decimals (A9), and "1e-7" as 0, which
// printed every tick of a domain below 1e-6 as "0". test/value-decimals.test.ts keeps those originals.

/** Significant digits of the set's largest magnitude that count as precision. Authored data has far
 *  fewer; sum noise sits at the 16th–17th, or a few digits higher after cancellation. */
const SIGNIFICANT_DIGITS = 12;

/** toFixed's limit. Values below 1e-100 (relative to the largest) count no decimals. */
const MAX_FIXED_DIGITS = 100;

/** The most fraction digits any finite value needs, counted to SIGNIFICANT_DIGITS of the largest
 *  finite magnitude. Non-finite values are skipped; no values (or only zeros) gives 0. Uncapped:
 *  axis ticks use it directly. */
export function fractionDigitsNeeded(values: readonly number[]): number {
  let maxAbs = 0;
  for (const v of values) if (Number.isFinite(v) && Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
  if (maxAbs === 0) return 0;
  // The decimal place of the largest value's last significant digit.
  const places = SIGNIFICANT_DIGITS - 1 - Math.floor(Math.log10(maxAbs));
  if (places <= 0) return 0;
  const digits = Math.min(places, MAX_FIXED_DIGITS);
  return values.reduce((max, v) => {
    if (!Number.isFinite(v)) return max;
    const frac = Math.abs(v).toFixed(digits).split(".")[1] ?? "";
    return Math.max(max, frac.replace(/0+$/, "").length);
  }, 0);
}

/** Significant digits the tick step is rounded to before its decimals are counted. d3 steps are
 *  1, 2 or 5 × 10^k; the step is a difference of two ticks, so it carries the ticks' rounding error,
 *  which near 1e12 is about 1e-4 (0.05 arrives as 0.050048828125). */
const TICK_STEP_DIGITS = 2;

/** Decimal places for axis ticks: the larger of fractionDigitsNeeded and the decimals of the
 *  smallest tick step. The set-relative cut alone drops digits below the largest tick's 12th
 *  significant digit, so a step finer than that merged or misprinted ticks ([1e12, 1e12 + 1] by 0.2
 *  printed three "1000000000000"; [1e12 + 0.1, 1e12 + 0.15] printed its upper tick as "…0.2"). With
 *  the step's decimals every tick prints its own value. */
export function tickFractionDigits(ticks: readonly number[]): number {
  const finite = ticks.filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  let step = Infinity;
  for (let i = 1; i < finite.length; i++) {
    const gap = finite[i]! - finite[i - 1]!;
    if (gap > 0 && gap < step) step = gap;
  }
  const stepDigits = Number.isFinite(step) ? fractionDigitsNeeded([Number(step.toPrecision(TICK_STEP_DIGITS))]) : 0;
  return Math.max(fractionDigitsNeeded(finite), stepDigits);
}

/** Upper bound on a value label's data-derived precision, so raw floats don't print 15 digits. */
export const VALUE_LABEL_DECIMALS_CAP = 2;

/** Decimal places for value labels: an explicit `valueLabels.decimals` wins; else the fewest the
 *  values need, capped at VALUE_LABEL_DECIMALS_CAP. */
export function valueLabelDecimals(values: readonly number[], explicit?: number): number {
  if (explicit != null) return explicit;
  return Math.min(VALUE_LABEL_DECIMALS_CAP, fractionDigitsNeeded(values));
}
