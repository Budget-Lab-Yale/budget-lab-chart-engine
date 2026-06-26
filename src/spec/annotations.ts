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
