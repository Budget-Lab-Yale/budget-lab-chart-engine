// Resolve the effective annotations for a chart from the unified `annotations` block, falling back
// to the legacy axis-policy fields so existing specs keep working. The unified block wins when
// present (per field): annotations.xAxis over xAxisPolicy.markers, annotations.bands over
// xAxisPolicy.bands, annotations.yAxis over yAxisPolicy.markers.
import type { ChartSpec, XAxisMarker, XAxisBand, YAxisMarker, PointCallout, ValueFormat } from "./types";

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

// Decimal places used when a `value_format` is given but omits `decimals`.
const VALUE_FORMAT_DEFAULT_DECIMALS = 2;

/** Substitute a literal `{value}` token in an annotation `label` with `value`, formatted via
 *  `fmt` when given, else via `fallbackFormat` (the chart's value-axis tick formatter, or — for
 *  an xAxis marker whose `x` doesn't parse as a number — a function that just returns the raw
 *  string). A label without the token is returned unchanged (zero-cost, zero-output-change for
 *  the vast majority of annotations that don't use it). Pure — no DOM, no chart state. */
export function substituteValueToken(
  label: string,
  value: number,
  fmt: ValueFormat | undefined,
  fallbackFormat: (v: number) => string,
): string {
  if (!label.includes("{value}")) return label;
  const formatted = fmt
    ? `${fmt.prefix ?? ""}${value.toFixed(fmt.decimals ?? VALUE_FORMAT_DEFAULT_DECIMALS)}${fmt.suffix ?? ""}`
    : fallbackFormat(value);
  return label.replaceAll("{value}", formatted);
}
