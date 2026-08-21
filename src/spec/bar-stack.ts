// The stacked-bar net/hover decisions, as pure functions of the spec.
//
// These were one tri-state boolean on MarkLayers (`showTotalDot`), which four different consumers read
// for four different purposes — the marker shape, the hover treatment, the tooltip's Total row, and
// whether net dots exist for the highlight pills to pin to (issue #29). Deriving them HERE, at each
// read site, rather than shipping four fields through MarkLayers → FigurePane → FigureRenderResult →
// wireFigureSvg, is deliberate: that forwarding chain is four hops long, a missed hop yields
// `undefined` (which silently reads as "off"), and no golden can catch it because goldens are static
// SVG and never hover.
//
// So the rule is not "one field crosses the chain" — it is that a value crosses it ONLY when the
// read site cannot compute the value itself, which makes every field that crosses a REPORT of what
// the mark builder observed rather than a DECISION about what to do. Two qualify:
//   - `netMode` — which net callout the stack actually painted. `undefined` additionally carries
//     "not a stacked chart" (marks/stacked.ts is its only writer), which resolveHoverMode below
//     depends on, so it is passed un-defaulted.
//   - `segmentLabelsDropped` — whether the label builder refused any segment's in-bar value label
//     for being thinner than the fit threshold. That is a function of the data AND the frame
//     geometry the builder was handed, and the pill read site has neither; re-deriving it there
//     would mean a second copy of the threshold, free to drift from what was painted. See
//     resolveValuePills.
// Everything else — the hover treatment, the tooltip's Total row, the value-pill default — is a
// decision computed from the spec plus those two reports, at the site that acts on it.
import type { ChartSpec } from "./types";

/** The net (sum) callout actually painted on a stacked chart. */
export type NetMode = "dot" | "text" | "none";
/** The hover tooltip's Total row style. */
export type TotalRow = "dot" | "text" | "none";
/** Which hover treatment is attached. */
export type HoverMode = "tooltip" | "pills";

/**
 * Which net callout to paint. `hasNegatives` is the only data-derived input (whether any in-scope
 * value is < 0), so the caller passes it in and this stays pure.
 *
 * A 100 %-normalized stack has no meaningful net — every bar totals 100 — so it forces "none"
 * regardless of `netDisplay`.
 */
export function resolveNetMode(spec: ChartSpec, hasNegatives: boolean): NetMode {
  if (spec.barStack?.normalize) return "none";
  const cfg = spec.barStack?.netDisplay ?? "auto";
  if (cfg === "none" || cfg === "dot" || cfg === "text") return cfg;
  return hasNegatives ? "dot" : "text";
}

/**
 * Which hover treatment to attach. Absent `barStack.hover`, this reproduces the historical coupling
 * exactly — tooltip iff the net dot is drawn — so a spec that does not set it renders as before.
 *
 * `netMode: undefined` means NOT A STACKED CHART (only marks/stacked.ts sets it), and the caller
 * passes `layers.netMode` un-defaulted so that signal survives. The read site in render-live serves
 * bar AND stacked charts, nothing validates `barStack` as stacked-only, and today a plain bar chart
 * can never get the floating tooltip — so a bar spec carrying a stray `barStack.hover: tooltip` must
 * not start getting one. Hence the early return, ahead of reading the field at all.
 */
export function resolveHoverMode(spec: ChartSpec, netMode: NetMode | undefined): HoverMode {
  if (netMode == null) return "pills";
  return spec.barStack?.hover ?? (netMode === "dot" ? "tooltip" : "pills");
}

/**
 * The tooltip's Total row style.
 *
 * The `normalize` check is NOT redundant with `resolveNetMode` forcing "none" there. It is what stops
 * a normalized stack that asked for the tooltip from showing a permanent "Total: 100" row — the
 * `hoverMode === "tooltip"` branch below would otherwise give it one. Do not delete it.
 */
export function resolveTotalRow(
  spec: ChartSpec,
  netMode: NetMode | undefined,
  hoverMode: HoverMode,
): TotalRow {
  // Not a stacked chart — see resolveHoverMode on why undefined carries that meaning.
  if (netMode == null) return "none";
  if (spec.barStack?.normalize) return "none";
  // A dot on the chart means the row keys it with a matching circle swatch.
  if (netMode === "dot") return "dot";
  // A chart that asked for the tooltip still wants the total, as plain text — there is no dot to key.
  if (hoverMode === "tooltip") return "text";
  // Otherwise: a text callout gets a text row; no callout gets no row. Unchanged.
  return netMode === "text" ? "text" : "none";
}

/**
 * Are there net-dot markers in the DOM?
 *
 * Read by `attachHighlightPills`: selecting the Total pseudo-series has no rect to pill, so it draws
 * a net-value pill at each net dot instead (crosshair.ts, `readNetDotMarkers`). This tracks the
 * MARKER, which is why it is not the same question as `resolveTotalRow` — `netDisplay: none` with
 * `hover: tooltip` yields a "text" Total row and no dots whatsoever.
 */
export function hasNetDots(netMode: NetMode | undefined): boolean {
  return netMode === "dot";
}

/**
 * Are a stacked chart's per-segment value labels actually PAINTED?
 *
 * SINGLE SOURCE for two decisions that must agree: the label mark itself (marks/stacked.ts) and the
 * value-pill DEFAULT below. `valueLabels.show` is a REQUEST, and three cases refuse it — so a rule
 * keyed on the request rather than on the paint would take pills away from charts that print no
 * numbers at all. Deriving the two separately is exactly how they would drift.
 *
 * The refusals:
 *  - `netMode == null` — NOT A STACKED CHART (only marks/stacked.ts sets it; see resolveHoverMode).
 *    A **waterfall** lands here, and that is correct rather than incidental: it does paint labels
 *    under `valueLabels.show`, but they are the running LEVEL after each step while its hover pill is
 *    the signed DELTA. Those are different numbers, so nothing is duplicated and the pill must stay.
 *  - `netMode === "dot"` — a diverging stack suppresses segment labels entirely.
 *  - `pane` — small-multiples panes paint none either (there is no room).
 */
export function stackedSegmentLabelsShown(
  spec: ChartSpec,
  netMode: NetMode | undefined,
  pane: boolean,
): boolean {
  if (spec.valueLabels?.show !== true) return false;
  if (netMode == null || netMode === "dot") return false;
  return !pane;
}

/**
 * Are the hover value pills drawn?
 *
 * `valueLabels.show` moves the DEFAULT, and only that: an explicit `chrome.valuePills` — either way —
 * still wins. Written as an override instead, `chrome.valuePills: true` would stop meaning anything
 * on exactly the charts an author would set it on, which trades one uncoordinated behaviour for a
 * switch that ignores what it was set to.
 *
 * Called at BOTH render-live.ts pill sites (the standalone `mountChart` one and `wireFigureSvg`'s
 * per-pane one) with that site's own `pane` value. Same rule, different context — a pane really does
 * paint no segment labels, so it really does keep its pills.
 *
 * INVARIANT: a reader must never be left with no number for a segment.
 *
 * `stackedSegmentLabelsShown` answers only the per-CHART half of "are the labels painted". The other
 * half is the per-SEGMENT fit threshold in marks/stacked.ts: a segment thinner than
 * SEGMENT_LABEL_MIN_PX gets no label even on a chart that paints them everywhere else. Keying the
 * default on the per-chart half alone left those segments with nothing — painted labels imply
 * `netMode: "text"` → `hoverMode: "pills"` → a band crosshair attached `emitOnly`, so there is no
 * floating tooltip standing behind them. `segmentLabelsDropped` closes that: it is the label
 * builder's REPORT of what it actually painted, not a second copy of the threshold, so the two
 * cannot drift.
 *
 * The rule is COARSE — the default flips off only when EVERY segment's label is painted; if any was
 * refused, the whole band keeps its pills, including the segments that did get a label. The finer
 * alternative (a pill for the refused segments only) is more precise about duplication and was
 * rejected on three counts:
 *  - the pills are a HIGHLIGHT affordance (`attachHighlightPills`): they say "this is what you are
 *    pointing at". Drawing them on a subset of the hovered band's segments misreads as those
 *    segments being singled out, rather than as a fallback for a number that would not fit.
 *  - the cost it avoids is a transient, hover-only duplicate of a number the reader can already see.
 *    The cost it adds is a band state nobody has published or reviewed.
 *  - it needs the SET of refused segments to reach the pill driver plus a second gate inside it —
 *    two more places for the paint and the pill to disagree, against this one boolean.
 * Where all the labels do fit, the coarse rule keeps afc61bf's behaviour exactly; where they do not,
 * it falls back to the pre-afc61bf behaviour (pills on), which is what the published archive shipped.
 */
export function resolveValuePills(
  spec: ChartSpec,
  netMode: NetMode | undefined,
  pane: boolean,
  segmentLabelsDropped: boolean,
): boolean {
  const labelsCoverEverySegment =
    stackedSegmentLabelsShown(spec, netMode, pane) && !segmentLabelsDropped;
  return spec.chrome?.valuePills ?? !labelsCoverEverySegment;
}
