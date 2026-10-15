// The panes a small-multiples figure draws. Lives in src/spec so that data validation (validate.ts,
// data-refs.ts) and the figure renderer (engine/figure.ts) read ONE definition: a pane count or
// rendered-pane set the validator derived on its own drifted from the grid twice (blank facet cells,
// repeated pane_order entries).
import type { ChartSpec } from "./types";
import type { TidyRow } from "../data/index";

/** The figure's panes, in order: distinct facet values in data-encounter order, then reordered and
 *  filtered by `small_multiples.pane_order` when set (it names the included panes, in order, and a
 *  repeated entry draws its pane twice). A blank facet cell is not a pane. validateChartData's
 *  keyed-callout "drawn nowhere" rules mirror both drops (src/spec/validate.ts) — change both. */
export function figurePaneValues(spec: ChartSpec, rows: TidyRow[], facetField: string): string[] {
  const encounterOrder: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const v = r[facetField] as string;
    if (v != null && v !== "" && !seen.has(v)) {
      seen.add(v);
      encounterOrder.push(v);
    }
  }
  const order = spec.small_multiples?.pane_order;
  return order && order.length ? order.filter((v) => seen.has(v)) : encounterOrder;
}
