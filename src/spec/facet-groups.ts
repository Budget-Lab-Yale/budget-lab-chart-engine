// Ruling 80: on a horizontal bar, stacked or dumbbell chart, `columns.facet` draws no small-multiple
// panes. Each facet value is a GROUP of the one chart's rows, exactly as `columns.section` draws one:
// a bold flush-left group title, its rows indented under it, a fixed gap between groups, one shared
// value axis. The mapping happens here, once, on the spec (engine/util.ts normalizeSpec runs it at
// every exported entry), so every section path applies unchanged: marks, hover, legend, PNG export,
// height models.
import type { ChartSpec } from "./types";
import { valueAxisIsX } from "./dumbbell-orientation";

/** Whether `columns.facet` draws groups rather than panes: a horizontal bar, stack or dumbbell
 *  (orientation omitted included) with a facet column. */
export function facetsDrawAsGroups(spec: Pick<ChartSpec, "chartType" | "orientation" | "columns">): boolean {
  return valueAxisIsX(spec) && spec.columns?.facet != null;
}

/** `spec` with a horizontal chart's facet column drawn as its section column: `columns.facet` becomes
 *  `columns.section`, `small_multiples.pane_order` the `section_order` and `pane_titles` the
 *  `section_labels`, and `small_multiples` is dropped. Any other spec is returned as is, the same
 *  object. A spec setting both columns is an error validation reports (facetGroupErrors); it throws
 *  here rather than drawing one of them silently. */
export function facetsAsGroups(spec: ChartSpec): ChartSpec {
  if (!facetsDrawAsGroups(spec)) return spec;
  const { facet, ...columns } = spec.columns ?? {};
  if (columns.section != null) {
    throw new Error(FACET_WITH_SECTION);
  }
  const { small_multiples: sm, section_order: _order, section_labels: _labels, ...rest } = spec;
  return {
    ...rest,
    columns: { ...columns, section: facet },
    ...(sm?.pane_order ? { section_order: sm.pane_order } : {}),
    ...(sm?.pane_titles ? { section_labels: sm.pane_titles } : {}),
  };
}

const FACET_WITH_SECTION =
  "columns.facet and columns.section are both set: on a horizontal chart columns.facet draws its values as groups, " +
  "exactly as columns.section does, so set one of them";

/** Validation for a spec whose facets draw as groups (facetsDrawAsGroups): every setting that only
 *  means something for side-by-side panes, or that a group has its own field for. Each message points
 *  at what to do instead. */
export function facetGroupErrors(spec: ChartSpec): string[] {
  if (!facetsDrawAsGroups(spec)) return [];
  const errors: string[] = [];
  const why = "a horizontal chart draws columns.facet as groups in one chart (like columns.section), not as panes";
  if (spec.columns?.section != null) errors.push(FACET_WITH_SECTION);
  const sm = spec.small_multiples;
  if (sm?.columns != null && sm.columns > 1) {
    errors.push(`small_multiples.columns ${sm.columns} has no effect: ${why}, so the groups stack in one column; remove it`);
  }
  if (sm?.mode === "per-pane") {
    errors.push(`small_multiples.mode "per-pane" has no effect: ${why} on one shared value axis; remove it`);
  }
  if (sm?.pane_widths != null) {
    errors.push(`small_multiples.pane_widths has no effect: ${why}, so there are no columns to size; remove it`);
  }
  if (sm?.coordinated_cursor != null) {
    errors.push(`small_multiples.coordinated_cursor has no effect: ${why}, so there is no other pane to echo the cursor on; remove it`);
  }
  for (const field of ["section_order", "section_labels"] as const) {
    if (spec[field] != null) {
      const pane = field === "section_order" ? "small_multiples.pane_order" : "small_multiples.pane_titles";
      errors.push(`${field} applies to columns.section; with columns.facet the groups are ordered and titled by ${pane}`);
    }
  }
  // A `facet` scope names a pane, and a grouped chart has none: the entry would draw across the whole
  // chart instead of under its group.
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
        errors.push(`${at}[${i}].facet has no pane to scope to: ${why}; remove facet`);
      }
    }
  }
  return errors;
}
