import type { ValueAffixes } from "../spec/types";

/** HTML-escape a value for safe interpolation into innerHTML (tooltip/legend). */
export function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/** The chart's value affixes, from the explicit spec fields. Nothing is inferred from `subtitle`:
 *  it used to be substring-matched for "percent", which put `%` on percentage-POINT charts (a 2 pp
 *  change read as a 2 % rate) and on any subtitle merely containing those letters, e.g.
 *  "Percentiles". Prose does not decide number formatting. */
export function resolveValueAffixes(spec: {
  value_prefix?: string;
  value_suffix?: string;
}): ValueAffixes {
  return { prefix: spec.value_prefix ?? "", suffix: spec.value_suffix ?? "" };
}

/** Wrap an already-formatted number in the chart's affixes. The prefix goes AFTER a minus sign, so
 *  a negative currency value reads `-$5` rather than `$-5`; nothing else is inserted, so the author
 *  owns any spacing (`"%"` wants none, `" pp"` does). */
export function applyValueAffixes(formatted: string, affixes: ValueAffixes): string {
  if (!affixes.prefix && !affixes.suffix) return formatted;
  const negative = formatted.startsWith("-");
  const magnitude = negative ? formatted.slice(1) : formatted;
  return `${negative ? "-" : ""}${affixes.prefix}${magnitude}${affixes.suffix}`;
}

/** Parses a `projected_field` (or similar boolean-flag CSV column) value: `1`/`true`/`yes`
 *  (case-insensitive, trimmed) is truthy; everything else (`0`, `false`, `no`, empty, missing)
 *  is falsy. */
export function isTruthyFlag(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}
