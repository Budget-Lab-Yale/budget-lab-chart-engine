// The bottom→top stack order, shared by the builders that stack (stacked.ts, area.ts) and by what has
// to agree with them: the stacked segment labels, and the series-snapped callout (pane.ts), which
// once ranked by `series_order` while the builder stacked by `barStack.stackOrder` / the live area
// restack, and named one segment while pointing at another.
//
// This is the DRAWN order only where an order override applies, or on an area (area.ts sorts its rows
// into it). A stacked bar without `barStack.stackOrder` is stacked by Plot in DATA order, and this
// assumes its rows arrive in `series_order`; a category whose rows do not is still mislabelled
// (deferred: fixing it moves output for specs the phase-5 archive scan did not cover).
import type { ChartSpec } from "../../spec/types";

/** Bottom→top stack sequence: `order`'s series first, then the rest of `seriesNames` in their own
 *  order. No `order` (or an empty one) is `seriesNames` itself. */
export function stackSequence(seriesNames: readonly string[], order: readonly string[] | undefined): string[] {
  if (!order || !order.length) return [...seriesNames];
  return [...order, ...seriesNames.filter((s) => !order.includes(s))];
}

/** Series → its rank in `stackSequence` (lower = nearer zero). A series listed twice takes its last
 *  position, as a Map built in sequence order does. */
export function stackRank(seriesNames: readonly string[], order: readonly string[] | undefined): Map<string, number> {
  return new Map(stackSequence(seriesNames, order).map((s, i) => [s, i]));
}

/** The order override a chart's stack is drawn in, beyond `series_order`: `barStack.stackOrder` on a
 *  stacked bar, the live restack order (`RenderOptions.stackOrder`) on an area. Each builder reads
 *  only its own, so the other is ignored here too. */
export function drawnStackOrder(spec: ChartSpec, liveStackOrder: readonly string[] | undefined): readonly string[] | undefined {
  if (spec.chartType === "stacked") return spec.barStack?.stackOrder;
  if (spec.chartType === "area") return liveStackOrder;
  return undefined;
}
