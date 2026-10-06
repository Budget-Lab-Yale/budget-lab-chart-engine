// The date grammar, time parsing for the three non-categorical x-axis types, and the one dispatch
// that turns a raw x cell into the value the renderer positions the row at.
//
// WHY THIS LIVES IN src/spec: it is spec-level semantics — what an `xAxisType` MEANS for a cell —
// and `engine/x-adapter.ts`'s per-type `parseX` delegates here rather than parsing again, so
// nothing can hold a second opinion about where a row sits on the x axis (pinned by the drift guard
// in test/parse-time.test.ts). engine → spec is the allowed direction (module-graph invariant,
// CLAUDE.md) and the engine already imports columns/annotations/rug helpers from here.
//
// `src/spec/validate.ts` consumes the grammar (`temporalValueError` / `quarterValueError`), not
// the parsers: the pooled-overlay guard that once needed an x-position key was withdrawn in 1.12.0
// (test/overlays-spec.test.ts records why).

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

// THE date grammar. Validation (`timeParseError`, spec/validate.ts), the timeline's cell checks
// (spec/timeline.ts), the rug's interval math (spec/rug.ts) and the parsers below all read these
// two functions, so nothing accepts a string another part rejects. Before they were shared,
// validation was strict and the parsers lax: `parseQuarter("2024Q5")` rolled into 2025Q1,
// `parseDate("2024-13-01")` into January 2025, `parseDate("March 1, 2024")` went through
// `new Date(s)` — and `renderChart` does not validate, so an embedder got a silently wrong x.
// CONFIG-SPEC.md states the grammar once, under "Dates"; keep the two in step.
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_RE = /^\d{4}$/;
const QUARTER_RE = /^(\d{4})Q([1-4])$/;

/** Days in a 1-based month of the proleptic Gregorian calendar. Arithmetic, not `Date`, because
 *  `Date` rolls an impossible day forward rather than refusing it. */
function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Why `s` is not a temporal x value — `YYYY-MM-DD` naming a real calendar day, or a bare `YYYY`
 *  — or null when it is one. No trimming: a padded cell is malformed. */
export function temporalValueError(s: string): string | null {
  if (YEAR_RE.test(s)) return null;
  const m = DATE_RE.exec(s);
  if (!m) return `expected YYYY-MM-DD or YYYY, got ${JSON.stringify(s)}`;
  const year = +(m[1] as string);
  const month = +(m[2] as string);
  const day = +(m[3] as string);
  const real = month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
  return real ? null : `invalid date ${JSON.stringify(s)}`;
}

/** Why `s` is not a quarterly x value (`YYYYQ1`–`YYYYQ4`), or null when it is one. */
export function quarterValueError(s: string): string | null {
  return QUARTER_RE.test(s) ? null : `expected YYYYQ#, got ${JSON.stringify(s)}`;
}

/** `YYYY-MM-DD`, or a bare `YYYY` → Date at local midnight (a bare year is its January 1st).
 *  Throws on anything else (`temporalValueError` says why) — there is no `new Date(s)` fallback.
 *
 *  Both forms are parsed here rather than by `new Date(s)` because `new Date(s)` reads them as
 *  **UTC**, and the engine formats in local time, so in a negative-offset zone the instant slides
 *  backwards — for a bare year, by a whole year. `new Date("1952")` is 1951-12-31T19:00 in ET, whose `getFullYear()`
 *  is 1951, so an annual series on a temporal axis silently labelled and positioned every point one
 *  year early. A bare year is the natural spelling for an annual series and is what makes
 *  `xAxisType: temporal` its right home: `tblTemporalXAxis` (engine/axes.ts) collapses a
 *  year-cadence span to bare `%Y` labels. See `formatNumericX` (engine/util.ts), which groups
 *  thousands precisely BECAUSE a numeric axis is no longer where years belong. */
export function parseDate(s: string): Date {
  const err = temporalValueError(s);
  if (err) throw new Error(`temporal x value: ${err}`);
  const m = DATE_RE.exec(s);
  if (m) return atLocalMidnight(+(m[1] as string), +(m[2] as string) - 1, +(m[3] as string));
  return atLocalMidnight(+s, 0, 1);
}

/** `YYYYQ#` → Date at the first day of the quarter. Throws on anything else, `Q5` included (it
 *  used to roll into the next year). Shares `atLocalMidnight` with `parseDate` because it shared
 *  the same defect: a bare `new Date(y, m, 1)` put `"0050Q1"` in 1950. */
export function parseQuarter(s: string): Date {
  const m = QUARTER_RE.exec(s);
  if (!m) throw new Error(`quarterly x value: ${quarterValueError(s)}`);
  return atLocalMidnight(+(m[1] as string), (+(m[2] as string) - 1) * 3, 1);
}

/** Date → `YYYYQ#`. */
export function formatQuarter(d: Date): string {
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}Q${q}`;
}

/**
 * The x value a raw cell resolves to under `xAxisType` — numeric via unary `+`, temporal/quarterly
 * via the parsers above (which throw on a malformed date), categorical as the string itself (a
 * band scale's key IS the label).
 * `engine/x-adapter.ts`'s per-type `parseX` delegates here, so nothing can hold a second opinion
 * about where a row sits on the x axis.
 */
export function parseXValue(xAxisType: XAxisType, raw: string): number | Date | string {
  if (xAxisType === "temporal") return parseDate(raw);
  if (xAxisType === "quarterly") return parseQuarter(raw);
  if (xAxisType === "categorical") return raw;
  return +raw; // numeric
}
