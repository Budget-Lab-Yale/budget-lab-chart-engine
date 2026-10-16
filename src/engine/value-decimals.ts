// The one "fewest decimals the data needs" count, shared by every printed value that derives its
// precision from the values themselves: stacked value labels (marks/stacked.ts), waterfall labels and
// hover delta (scales.ts waterfallValueDecimals) and axis ticks (scales.ts makeTickFormatter).
//
// KNOWN BUG A9, preserved deliberately (phase 5 fixes it here, once): the count reads each value's
// String() form, so float noise counts as precision — String(1.1 + 2.2) is "3.3000000000000003", 16
// digits, which the value-label entry point caps to 2 for every label in the chart. Exponent forms
// (String(1e-7) is "1e-7") count as 0. test/value-decimals.test.ts pins today's output.

/** The most fraction digits any finite value's String() form carries. Non-finite values are skipped;
 *  no values gives 0. Uncapped: axis ticks use it directly. */
export function fractionDigitsNeeded(values: readonly number[]): number {
  return values.reduce((max, v) => {
    if (!Number.isFinite(v)) return max;
    const s = String(v);
    const i = s.indexOf(".");
    return Math.max(max, i < 0 ? 0 : s.length - i - 1);
  }, 0);
}

/** Upper bound on a value label's data-derived precision, so raw floats don't print 15 digits. */
export const VALUE_LABEL_DECIMALS_CAP = 2;

/** Decimal places for value labels: an explicit `valueLabels.decimals` wins; else the fewest the
 *  values need, capped at VALUE_LABEL_DECIMALS_CAP. */
export function valueLabelDecimals(values: readonly number[], explicit?: number): number {
  if (explicit != null) return explicit;
  return Math.min(VALUE_LABEL_DECIMALS_CAP, fractionDigitsNeeded(values));
}
