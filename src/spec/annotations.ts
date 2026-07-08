// Resolve the effective annotations for a chart from the unified `annotations` block, falling back
// to the legacy axis-policy fields so existing specs keep working. The unified block wins when
// present (per field): annotations.xAxis over xAxisPolicy.markers, annotations.bands over
// xAxisPolicy.bands, annotations.yAxis over yAxisPolicy.markers.
import type { ChartSpec, XAxisMarker, XAxisBand, YAxisMarker, PointCallout } from "./types";

export interface ResolvedAnnotations {
  xAxis: XAxisMarker[];
  yAxis: YAxisMarker[];
  bands: XAxisBand[];
  points: PointCallout[];
}

export function resolveAnnotations(spec: ChartSpec): ResolvedAnnotations {
  const a = spec.annotations;
  return {
    xAxis: a?.xAxis ?? spec.xAxisPolicy?.markers ?? [],
    yAxis: a?.yAxis ?? spec.yAxisPolicy?.markers ?? [],
    bands: a?.bands ?? spec.xAxisPolicy?.bands ?? [],
    points: a?.points ?? [],
  };
}

/** Small multiples: scope `xAxis`/`yAxis` markers to the pane whose facet value is `facetValue`.
 *  A marker with no `facet` key always passes through (today's all-panes behavior); a marker
 *  WITH a `facet` key is kept only when it equals `facetValue`. `bands`/`points` are unaffected
 *  (out of scope — unchanged, all-panes). `facetValue === undefined` (non-faceted chart, or a
 *  faceted chart's shared-mode probe called without a pane) returns `resolved` UNCHANGED (same
 *  reference) so non-faceted rendering stays byte-identical. */
export function filterAnnotationsByFacet(
  resolved: ResolvedAnnotations,
  facetValue: string | undefined,
): ResolvedAnnotations {
  if (facetValue === undefined) return resolved;
  const keep = <T extends { facet?: string }>(list: T[]): T[] =>
    list.filter((m) => m.facet == null || m.facet === facetValue);
  return {
    xAxis: keep(resolved.xAxis),
    yAxis: keep(resolved.yAxis),
    bands: resolved.bands,
    points: resolved.points,
  };
}
