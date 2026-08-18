// The stacked-bar net/hover decisions, as pure functions of the spec.
//
// These were one tri-state boolean on MarkLayers (`showTotalDot`), which four different consumers read
// for four different purposes — the marker shape, the hover treatment, the tooltip's Total row, and
// whether net dots exist for the highlight pills to pin to (issue #29). Deriving them HERE, at each
// read site, rather than shipping four fields through MarkLayers → FigurePane → FigureRenderResult →
// wireFigureSvg, is deliberate: that forwarding chain is four hops long, a missed hop yields
// `undefined` (which silently reads as "off"), and no golden can catch it because goldens are static
// SVG and never hover. One field crosses the chain; everything else is computed where it is used.
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
