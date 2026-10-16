// A horizontal bar, stacked or dumbbell chart has no small-multiple panes: it groups its rows with
// `columns.section`. `columns.facet` there is a validation error, and every exported render entry
// throws the same message (engine/util.ts normalizeSpec), so such a spec is never drawn as panes.
// Ruling 80 (1.16.0) drew it as sections by mapping facet -> section, pane_order -> section_order and
// pane_titles -> section_labels; that mapping was exact, so the section spelling draws the same chart.
import type { ChartSpec } from "./types";
import { valueAxisIsX } from "./dumbbell-orientation";

/** Whether `spec` sets `columns.facet` on a horizontal bar, stack or dumbbell (orientation omitted
 *  included), which is rejected. */
export function facetOnHorizontalChart(spec: Pick<ChartSpec, "chartType" | "orientation" | "columns">): boolean {
  return valueAxisIsX(spec) && spec.columns?.facet != null;
}

export const HORIZONTAL_FACET_ERROR =
  "columns.facet is not supported on a horizontal bar, stacked or dumbbell chart: set columns.section instead, " +
  "with section_order and section_labels in place of small_multiples.pane_order and small_multiples.pane_titles, " +
  "and remove small_multiples — it draws the same chart";

/** Throws HORIZONTAL_FACET_ERROR for a spec facetOnHorizontalChart rejects: renderChart does not
 *  validate, so the render entries refuse it here rather than draw it. */
export function assertNoHorizontalFacet(spec: ChartSpec): void {
  if (facetOnHorizontalChart(spec)) throw new Error(HORIZONTAL_FACET_ERROR);
}

/** Validation for a spec facetOnHorizontalChart rejects: the one error, which covers every
 *  small_multiples and section setting by naming the rename, plus each `facet` scope on an
 *  annotation, marker or overlay, which the rename does not cover (left in place, an annotation's
 *  scope is ignored on an unfaceted chart and it draws across every section). */
export function horizontalFacetErrors(spec: ChartSpec): string[] {
  if (!facetOnHorizontalChart(spec)) return [];
  const errors = [HORIZONTAL_FACET_ERROR];
  const scoped: Array<[string, Array<{ facet?: string }> | undefined]> = [
    ["annotations.xAxis", spec.annotations?.xAxis],
    ["annotations.yAxis", spec.annotations?.yAxis],
    ["annotations.points", spec.annotations?.points],
    ["yAxisPolicy.markers", spec.yAxisPolicy?.markers],
    ["overlays", spec.overlays],
  ];
  for (const [at, list] of scoped) {
    for (const [i, entry] of (list ?? []).entries()) {
      if (entry.facet != null) {
        errors.push(`${at}[${i}].facet has no pane to scope to: a horizontal chart has no panes; remove facet`);
      }
    }
  }
  return errors;
}
