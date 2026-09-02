import type { ValueAffixes } from "../spec/types";
import type { RenderHooks, ValueLabelHookCtx } from "../spec/hooks";

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

/** The one x formatter for a NUMERIC x: at most two decimals, thousands grouped. Both the scatter
 *  hover card's x row (`scatterPointHoverOptions`, render-live.ts) and the `{x}` row token in a
 *  point-callout label (`xTokenFor`, index.ts) call this, so a callout and the card for the same
 *  observation cannot disagree. Keep it one function: the callout token used to reuse the AXIS
 *  format instead (`${+v}`), which put `2025a: -0.` and `x=2.285011857607663` on the frame — a raw
 *  float is not a label. Temporal/quarterly x keeps `tooltip_x_format` and categorical x keeps its
 *  `x_labels` name; neither is a number to round. */
export function formatNumericX(v: number): string {
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Apply the `valueLabel` hook to one in-mark label's text. `rendered` is the engine's own
 *  formatted text; the hook receives it (plus the label's series/category/value/facet) and may
 *  return a replacement, or `null` for "engine default". Absent hook / `hooks: {}` / a `null`
 *  return all take this same early-return path, so output stays byte-identical to no hooks at
 *  all — mirroring `withTickLabelHook` (assemble-plot.ts). Returns plain text: value labels are a
 *  Plot `text` channel rendered as an SVG `<text>` node's textContent on both the live and export
 *  paths, so there is no HTML/SVG medium split to navigate here (contrast `legendKey`). */
export function applyValueLabelHook(
  rendered: string,
  hooks: RenderHooks | undefined,
  ctx: Omit<ValueLabelHookCtx, "rendered">,
): string {
  const hook = hooks?.valueLabel;
  if (!hook) return rendered;
  return hook({ ...ctx, rendered }) ?? rendered;
}

/** Parses a `projected_field` (or similar boolean-flag CSV column) value: `1`/`true`/`yes`
 *  (case-insensitive, trimmed) is truthy; everything else (`0`, `false`, `no`, empty, missing)
 *  is falsy. */
export function isTruthyFlag(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}
