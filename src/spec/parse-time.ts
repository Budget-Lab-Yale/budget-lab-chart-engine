// Time parsing for the three non-categorical x-axis types, and the one dispatch that turns a raw
// x cell into the value the renderer positions the row at.
//
// WHY THIS LIVES IN src/spec: it is spec-level semantics — what an `xAxisType` MEANS for a cell —
// and `engine/x-adapter.ts`'s per-type `parseX` delegates here rather than parsing again, so
// nothing can hold a second opinion about where a row sits on the x axis (pinned by the drift guard
// in test/parse-time.test.ts). engine → spec is the allowed direction (module-graph invariant,
// CLAUDE.md) and the engine already imports columns/annotations/rug helpers from here.
//
// `src/spec/validate.ts` is NOT a consumer: the pooled-overlay guard that once needed an
// x-position key was withdrawn in 1.12.0 (test/overlays-spec.test.ts records why), so do not
// re-justify this module's location by validation's needs.

import type { XAxisType } from "./types";

/** Local midnight on a given calendar date. `new Date(y, m, d)` maps years 0-99 into 1900-1999 —
 *  the constructor's legacy two-digit window — so `new Date(50, 5, 15)` is 15 June 1950, not year
 *  50. `setFullYear` is the documented escape and is a no-op for every year above 99. Both spellings
 *  `parseDate` accepts route through here so they cannot diverge: correcting only the bare-year
 *  branch would have made `"0050"` and `"0050-06-15"` land 1900 years apart. */
function atLocalMidnight(year: number, month: number, day: number): Date {
  const d = new Date(year, month, day);
  d.setFullYear(year, month, day);
  return d;
}

/** `YYYY-MM-DD`, or a bare `YYYY` → Date at local midnight (a bare year is its January 1st).
 *  Falls back to `Date()` for anything else.
 *
 *  BOTH explicit branches exist for one reason: `new Date(s)` reads both forms as **UTC**, and the
 *  engine formats in local time, so in a negative-offset zone the instant slides backwards — for a
 *  bare year, by a whole year. `new Date("1952")` is 1951-12-31T19:00 in ET, whose `getFullYear()`
 *  is 1951, so an annual series on a temporal axis silently labelled and positioned every point one
 *  year early. A bare year is the natural spelling for an annual series and is what makes
 *  `xAxisType: temporal` its right home: `tblTemporalXAxis` (engine/axes.ts) collapses a
 *  year-cadence span to bare `%Y` labels. See `formatNumericX` (engine/util.ts), which groups
 *  thousands precisely BECAUSE a numeric axis is no longer where years belong. */
export function parseDate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return atLocalMidnight(+(m[1] as string), +(m[2] as string) - 1, +(m[3] as string));
  const y = /^(\d{4})$/.exec(s);
  if (y) return atLocalMidnight(+(y[1] as string), 0, 1);
  return new Date(s);
}

/** `YYYYQ#` → Date at the first day of the quarter, or null if it doesn't match. Shares
 *  `atLocalMidnight` with `parseDate` because it shared the same defect: a bare `new Date(y, m, 1)`
 *  put `"0050Q1"` in 1950. */
export function parseQuarter(s: string): Date | null {
  const m = /^(\d{4})Q(\d)$/.exec(s);
  if (!m) return null;
  return atLocalMidnight(+(m[1] as string), (+(m[2] as string) - 1) * 3, 1);
}

/** Date → `YYYYQ#`. */
export function formatQuarter(d: Date): string {
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}Q${q}`;
}

/**
 * The x value a raw cell resolves to under `xAxisType` — numeric via unary `+`, temporal/quarterly
 * via the parsers above, categorical as the string itself (a band scale's key IS the label).
 * `engine/x-adapter.ts`'s per-type `parseX` delegates here, so nothing can hold a second opinion
 * about where a row sits on the x axis.
 */
export function parseXValue(xAxisType: XAxisType, raw: string): number | Date | string | null {
  if (xAxisType === "temporal") return parseDate(raw);
  if (xAxisType === "quarterly") return parseQuarter(raw);
  if (xAxisType === "categorical") return raw;
  return +raw; // numeric
}
