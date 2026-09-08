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

/** Grouping for EVERY numeric-x surface — the axis ticks, the crosshair header, the scatter hover
 *  card's x row and the `{x}` row token in a point-callout label. A thousands separator is right for
 *  a measured quantity (`1,234,567` beats `1234567`), and the reason it was once switched off has
 *  gone away: years no longer arrive on a numeric axis. A bare `YYYY` now parses correctly on a
 *  TEMPORAL axis (`parseDate`, spec/parse-time.ts — it used to slide back a year in any
 *  negative-offset zone), and `tblTemporalXAxis` renders a year-cadence span as bare `%Y` labels,
 *  so `xAxisType: temporal` is where an annual series belongs. Ungrouping every numeric x to keep
 *  `2021` from reading `2,021` was a workaround for putting years in the wrong place.
 *
 *  The EXPLICIT `"en-US"` is load-bearing, found by review: these strings are drawn into the SVG
 *  and into the PNG export, and RENDERED output must not depend on the rendering machine —
 *  `toLocaleString()` with no locale yields `2,59` on a de-DE host. `marks/stacked.ts` states that
 *  rule. It applies to rendered text, NOT to every formatter in the engine: the hover card's
 *  y-value formatters (`crosshair.ts`, ten `opts.yFormat` fallbacks) deliberately follow the host
 *  locale, because a card is DOM that is never rasterised. The line is rendered-vs-hover, and an
 *  earlier version of this comment claimed the two formatters below were the only locale-pinned
 *  formatters anywhere, which was simply false. `histogram-label.ts` is pinned too, for a related
 *  reason recorded there: its bin header sits directly under this axis. */
const NUMERIC_X_LOCALE = "en-US";

/** The x formatter for the three numeric-x HOVER surfaces: the crosshair header, the scatter card's
 *  x row, and the `{x}` row token. At most two decimals, grouped. All three call this, so nothing a
 *  reader can hover disagrees about the number — the raw float that once put `2025a: -0.` and
 *  `x=2.285011857607663` on the frame is rounded once, in one place. Temporal and quarterly x keep
 *  `tooltip_x_format`, and a category keeps its `x_labels` name; neither is a number to round. */
export function formatNumericX(v: number): string {
  // `Object.is(-0, 0)` is false and `(-0).toLocaleString()` is "-0", where the plain `${+v}` these
  // surfaces used to print gave "0". A d3 domain that crosses zero can hand us a negative zero.
  if (v === 0) return "0";
  return v.toLocaleString(NUMERIC_X_LOCALE, { maximumFractionDigits: 2, useGrouping: true });
}

/** The x formatter for numeric AXIS TICK labels. The same grouping as the hover surfaces and
 *  deliberately NOT the same rounding: d3 chooses the tick values, so they are already short and
 *  exact, and clamping them to two decimals would print a repeated `0.00` across any axis whose
 *  domain is narrower than about 0.05. So a tick and a hover reading always agree on grouping and
 *  may differ in precision — the honest split, because a tick is a chosen round number while a
 *  hover reading is whatever the data says. */
export function formatNumericTick(v: number): string {
  if (v === 0) return "0"; // as above, and it keeps a zero tick reading "0" rather than "-0"
  const s = v.toLocaleString(NUMERIC_X_LOCALE, { maximumFractionDigits: 20, useGrouping: true });
  // `maximumFractionDigits` is capped at 20 by Intl, so a tick below 1e-20 formats as "0" and a
  // whole narrow-domain axis would print one label repeatedly — precisely the failure this
  // formatter's full precision exists to avoid. Fall back to the plain form (what the axis printed
  // before grouping) whenever formatting would not round-trip; grouping is meaningless down there.
  return Number(s.replace(/,/g, "")) === v ? s : `${v}`;
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
