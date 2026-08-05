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

/** Small multiples: scope `xAxis`/`yAxis` markers and `points` to the pane whose facet value is
 *  `facetValue`. An annotation with no `facet` key always passes through (all-panes behavior); one
 *  WITH a `facet` key is kept only when it equals `facetValue`. `bands` are unaffected (all-panes).
 *  `facetValue === undefined` (non-faceted chart, or a faceted chart's shared-mode probe called
 *  without a pane) returns `resolved` UNCHANGED (same reference) so non-faceted rendering stays
 *  byte-identical. */
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
    points: keep(resolved.points),
  };
}

// Decimal places used when a `value_format` is given but omits `decimals`.
const VALUE_FORMAT_DEFAULT_DECIMALS = 2;

/**
 * An xAxis marker's label with its `{value}` token resolved. The marker's own `x` is substituted —
 * numerically when `value_format` is given AND `x` parses as a number, else as the raw string.
 * Shared by the in-frame label (assemble-plot) and the keyed legend row (annotation-legend) so one
 * marker can never read two ways.
 */
export function xMarkerLabel(m: XAxisMarker): string {
  if (!m.label) return "";
  const xNum = Number(m.x);
  const fmt = m.value_format != null && Number.isFinite(xNum) ? m.value_format : undefined;
  return substituteValueToken(m.label, xNum, fmt, () => m.x);
}

/**
 * A yAxis marker's label with its `{value}` token resolved from the marker's own `y` — via
 * `value_format` when given, else `fallbackFormat` (the chart's value-axis tick formatter).
 */
export function yMarkerLabel(m: YAxisMarker, fallbackFormat: (v: number) => string): string {
  if (!m.label) return "";
  return substituteValueToken(m.label, m.y, m.value_format, fallbackFormat);
}

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
