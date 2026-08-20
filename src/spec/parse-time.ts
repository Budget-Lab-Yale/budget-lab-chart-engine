// Time parsing for the three non-categorical x-axis types, and the one dispatch that turns a raw
// x cell into the value the renderer positions the row at.
//
// WHY THIS LIVES IN src/spec: `src/spec/*` must not import `src/engine/*` (module-graph invariant,
// CLAUDE.md), and `validate.ts` needs the SAME x parse the renderer uses — a pooled-overlay guard
// keyed on a second, lookalike parser is a guard that disagrees with the drawing it protects.
// `engine/x-adapter.ts`'s `parseX` is this function, per axis type; engine → spec is the allowed
// direction and the engine already imports columns/annotations/rug helpers from here.

import type { XAxisType } from "./types";

/** `YYYY-MM-DD` → Date (local midnight). Falls back to Date() for anything else. */
export function parseDate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return new Date(+(m[1] as string), +(m[2] as string) - 1, +(m[3] as string));
  return new Date(s);
}

/** `YYYYQ#` → Date at the first day of the quarter, or null if it doesn't match. */
export function parseQuarter(s: string): Date | null {
  const m = /^(\d{4})Q(\d)$/.exec(s);
  if (!m) return null;
  return new Date(+(m[1] as string), (+(m[2] as string) - 1) * 3, 1);
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

/**
 * A comparable identity for an x POSITION: two cells sit at the same x iff this returns the same
 * key. `parseXValue` with Dates flattened to epoch ms, and `null` for a cell that names no position
 * — a malformed date or quarter, a non-numeric number, or a blank. Those are each already reported
 * by validate's per-row x-format check, and a caller that bucketed them would group every one of
 * them together and invent a second, unrelated complaint on top of the real one. (`null` for blank
 * is the one place this deliberately does not mirror `parseXValue`, whose numeric branch is unary
 * `+` and so reads `""` as 0: a blank x fails validation, so the renderer never positions one.)
 */
export function xPositionKey(xAxisType: XAxisType, raw: string): number | string | null {
  if (raw.trim() === "") return null;
  const v = parseXValue(xAxisType, raw);
  if (v == null) return null;
  if (typeof v === "string") return v;
  const n = +v;
  return Number.isFinite(n) ? n : null;
}
