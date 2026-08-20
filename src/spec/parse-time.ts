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
