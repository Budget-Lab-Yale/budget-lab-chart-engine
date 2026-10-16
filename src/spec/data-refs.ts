// Every spec field that names a value in the DATA — a series, a shape value, an x category, a
// section, a pane — in one table, read by every chart type's data validation (validate.ts: the
// shared path, the histogram path, the timeline and treemap paths). A key the data lacks is a typo:
// the engine reads these by exact match, so a misspelled key silently does nothing (a colour that
// never applies, a highlight that dims every series, a pane scope that draws nowhere) or empties the
// chart. Adding a field that names data values means adding a row here, not a check per chart path.
//
// Only a field the chart READS is checked: where the engine ignores it, a typo renders exactly as the
// field's absence does, and rejecting it would fail a figure that draws correctly. Two mechanisms:
// a chart path supplies the domains it has (`RefDomains`), and a rule whose domain is absent is
// skipped (categories exist only on a categorical x, shape values only with a shape column,
// sections only with a section column, panes only on a faceted chart); and a rule read by some chart
// types alone names them in `readBy`. A field a chart type rejects outright (timeline and treemap
// reject most of these) never reaches here, because `validateSpec` fails first.
import type { ChartSpec } from "./types";
import { resolveAnnotations } from "./annotations";
import { categoryOrderFor } from "./columns";

export type RefDomain = "series" | "shape" | "category" | "section" | "pane" | "paneScope";

/** One reference as the author wrote it: the path to name in the message, and the keys it holds.
 *  `single` marks a field holding ONE key (a string), quoted bare in the message rather than as a
 *  list. */
export interface KeyRef {
  where: string;
  keys: string[];
  single?: boolean;
}

export interface KeyRefRule {
  /** The documented field path, for readers of this table. */
  field: string;
  domain: RefDomain;
  refs: (spec: ChartSpec) => KeyRef[];
  /** Whether this spec's rendering reads the field, when not every spec's does. Elsewhere the rule
   *  is skipped. */
  readBy?: (spec: ChartSpec) => boolean;
  /** paneScope only: what fails to draw when the pane is not rendered. */
  drawnNowhere?: string;
  /** paneScope only: whether a `facet` on a chart without small_multiples is an error (overlays) or
   *  ignored, as CONFIG-SPEC documents for markers and callouts. */
  unfaceted?: "error" | "ignore";
}

/** The key sets a chart path can supply. Values are the raw data cells, blanks included, except
 *  `pane.rendered`, which is the panes the figure draws (`figurePaneValues`, spec/panes.ts: blank
 *  facet cells are not panes, and `pane_order` is an inclusion filter). */
export interface RefDomains {
  series?: Set<string>;
  shape?: Set<string>;
  category?: { column: string; values: Set<string> };
  section?: { column: string; values: Set<string> };
  pane?: { column: string; values: Set<string>; rendered: Set<string> };
  /** Whether the chart sets `small_multiples` (a paneScope reference on a chart without it is either
   *  an error or ignored, per rule). */
  faceted?: boolean;
}

const keysOf = (v: string[] | Readonly<Record<string, unknown>>): string[] =>
  Array.isArray(v) ? v : Object.keys(v);
const list = (where: string, v: string[] | Readonly<Record<string, unknown>> | undefined): KeyRef[] =>
  v == null ? [] : [{ where, keys: keysOf(v) }];
const one = (where: string, v: string | undefined | null): KeyRef[] =>
  v == null ? [] : [{ where, keys: [v], single: true }];
const each = <T>(items: readonly T[] | undefined, f: (item: T, i: number) => KeyRef[]): KeyRef[] =>
  (items ?? []).flatMap(f);

/** Live marker lists, named by the block the author wrote (the unified `annotations` block wins per
 *  field over the legacy axis policy, as resolveAnnotations reads them). */
const markerScopes = (spec: ChartSpec, axis: "xAxis" | "yAxis"): KeyRef[] => {
  const legacy = axis === "xAxis" ? "xAxisPolicy.markers" : "yAxisPolicy.markers";
  const at = spec.annotations?.[axis] ? `annotations.${axis}` : legacy;
  return each(resolveAnnotations(spec)[axis] as Array<{ facet?: string }>, (m, i) => one(`${at}[${i}].facet`, m.facet));
};

const notHistogram = (s: ChartSpec): boolean => s.chartType !== "histogram";
const dumbbell = (s: ChartSpec): boolean => s.chartType === "dumbbell";

/** `x_labels` is read in two places only: the hover CARD's header, and a callout label's `{x}` token
 *  (engine/pane.ts xTokenFor). Checked where one of them is certain to read it: a callout using
 *  `{x}`, a dumbbell (whose card survives every layout), or a standalone categorical line, area or
 *  dot plot. Bars, stacks and waterfalls hover with value pills in most layouts, and a coordinated
 *  small-multiples pane replaces its card with the cursor's RAW category echo, so there the field is
 *  often never read, and a typo renders exactly as its absence; those are not checked (a missed
 *  typo is the cheaper error than refusing a figure that draws correctly). */
const xLabelsRead = (s: ChartSpec): boolean =>
  (s.annotations?.points ?? []).some((p) => p.label.includes("{x}")) ||
  s.chartType === "dumbbell" ||
  (s.small_multiples == null && (s.chartType === "line" || s.chartType === "area" || s.chartType === "dotplot"));

/** Ordered so the messages come out in the order the pre-table checks emitted them. */
export const DATA_KEY_REFERENCES: readonly KeyRefRule[] = [
  { field: "series_order", domain: "series", refs: (s) => list("series_order", s.series_order) },
  { field: "series_colors", domain: "series", refs: (s) => list("series_colors", s.series_colors) },
  { field: "series_patterns", domain: "series", refs: (s) => list("series_patterns", s.series_patterns) },
  // A histogram's legend swatch is a chip, which carries no dash (icon.ts), and its bars no stroke.
  { field: "series_styles", domain: "series", readBy: notHistogram, refs: (s) => list("series_styles", s.series_styles) },
  { field: "series_labels", domain: "series", refs: (s) => list("series_labels", s.series_labels) },
  // The histogram binner draws no shape channel; the other chart types were checked before this table.
  { field: "shape_order", domain: "shape", readBy: notHistogram, refs: (s) => list("shape_order", s.shape_order) },
  { field: "shape_labels", domain: "shape", readBy: notHistogram, refs: (s) => list("shape_labels", s.shape_labels) },
  {
    // Histogram rows are bins, with no per-row bound to read.
    field: "confidence_bands[].series", domain: "series", readBy: notHistogram,
    refs: (s) => each(s.confidence_bands, (b) => one("confidence_bands", b.series)),
  },
  { field: "shading[].series", domain: "series", refs: (s) => each(s.shading, (r, i) => one(`shading[${i}]`, r.series)) },
  {
    field: "shading[].from / to", domain: "category",
    refs: (s) => each(s.shading, (r, i) => [...one(`shading[${i}].from`, r.from), ...one(`shading[${i}].to`, r.to)]),
  },
  // marks/bar.ts, marks/histogram.ts and marks/stacked.ts are its only readers.
  {
    field: "highlightSeries", domain: "series",
    readBy: (s) => s.chartType === "bar" || s.chartType === "histogram" || s.chartType === "stacked",
    refs: (s) => list("highlightSeries", s.highlightSeries),
  },
  { field: "series_marker", domain: "series", readBy: dumbbell, refs: (s) => list("series_marker", s.series_marker) },
  {
    field: "gap_annotation.series_a / series_b", domain: "series", readBy: dumbbell,
    refs: (s) => {
      const g = s.gap_annotation;
      if (g == null || typeof g !== "object") return [];
      return [...one("gap_annotation.series_a", g.series_a), ...one("gap_annotation.series_b", g.series_b)];
    },
  },
  {
    field: "barStack.stackOrder", domain: "series", readBy: (s) => s.chartType === "stacked",
    refs: (s) => list("barStack.stackOrder", s.barStack?.stackOrder),
  },
  {
    // A keyed (`point:`) callout takes its series from the matched row; validateSpec rejects a
    // `series` beside it, and validateChartData checks the row.
    field: "annotations.points[].series", domain: "series",
    refs: (s) => each(s.annotations?.points, (p, i) => (p.point == null ? one(`annotations.points[${i}].series`, p.series) : [])),
  },
  {
    field: "x_order / category_order", domain: "category",
    refs: (s) => list(s.category_order ? "category_order" : "x_order", categoryOrderFor(s)),
  },
  { field: "category_colors", domain: "category", refs: (s) => list("category_colors", s.category_colors) },
  { field: "x_labels", domain: "category", readBy: xLabelsRead, refs: (s) => list("x_labels", s.x_labels) },
  { field: "section_order", domain: "section", refs: (s) => list("section_order", s.section_order) },
  { field: "section_labels", domain: "section", refs: (s) => list("section_labels", s.section_labels) },
  {
    field: "small_multiples.pane_order", domain: "pane",
    refs: (s) => list("small_multiples.pane_order", s.small_multiples?.pane_order),
  },
  {
    field: "small_multiples.pane_titles", domain: "pane",
    refs: (s) => list("small_multiples.pane_titles", s.small_multiples?.pane_titles),
  },
  {
    // annotation-legend.ts keys an overlay's legend row from the spec alone, with no rows, so it
    // cannot tell a misspelled pane from a real one: this check is deliberately the only gate.
    field: "overlays[].facet", domain: "paneScope", unfaceted: "error",
    drawnNowhere: "the line would be drawn nowhere while still keying a legend row",
    refs: (s) => each(s.overlays, (o, i) => one(`overlays[${i}].facet`, o.facet)),
  },
  {
    field: "annotations.xAxis[].facet (or xAxisPolicy.markers)", domain: "paneScope", unfaceted: "ignore",
    drawnNowhere: "the marker would be drawn nowhere", refs: (s) => markerScopes(s, "xAxis"),
  },
  {
    field: "annotations.yAxis[].facet (or yAxisPolicy.markers)", domain: "paneScope", unfaceted: "ignore",
    drawnNowhere: "the marker would be drawn nowhere", refs: (s) => markerScopes(s, "yAxis"),
  },
  {
    // x-anchored callouts only: a keyed callout's pane is its matched row's, checked against the row.
    field: "annotations.points[].facet", domain: "paneScope", unfaceted: "ignore",
    drawnNowhere: "the callout would be drawn nowhere",
    refs: (s) => each(s.annotations?.points, (p, i) => (p.point == null ? one(`annotations.points[${i}].facet`, p.facet) : [])),
  },
];

const sorted = (values: Set<string>): string => JSON.stringify([...values].sort());

function ruleErrors(rule: KeyRefRule, ref: KeyRef, d: RefDomains): string[] {
  const named = (unknown: string[]): string => JSON.stringify(ref.single ? unknown[0] : unknown);
  const plural = (one: string, many: string): string => (ref.single ? one : many);
  switch (rule.domain) {
    case "series": {
      if (!d.series) return [];
      const unknown = ref.keys.filter((k) => !d.series!.has(k));
      return unknown.length
        ? [`${ref.where} names series ${named(unknown)} not found in the data (data series: ${sorted(d.series)})`]
        : [];
    }
    case "shape": {
      if (!d.shape) return [];
      const unknown = ref.keys.filter((k) => !d.shape!.has(k));
      return unknown.length
        ? [`${ref.where} names ${plural("shape value", "shape values")} ${named(unknown)} not found in the data (data shapes: ${sorted(d.shape)})`]
        : [];
    }
    case "category": {
      const c = d.category;
      if (!c) return [];
      const unknown = ref.keys.filter((k) => !c.values.has(k));
      return unknown.length
        ? [`${ref.where} names ${plural("category", "categories")} ${named(unknown)} not found in x column "${c.column}" (data values: ${sorted(c.values)})`]
        : [];
    }
    case "section": {
      const sec = d.section;
      if (!sec) return [];
      const unknown = ref.keys.filter((k) => !sec.values.has(k));
      return unknown.length
        ? [`${ref.where} names ${plural("section", "sections")} ${named(unknown)} not found in section column "${sec.column}" (data values: ${sorted(sec.values)})`]
        : [];
    }
    case "pane": {
      const p = d.pane;
      if (!p) return [];
      const unknown = ref.keys.filter((k) => !p.values.has(k));
      return unknown.length
        ? [`${ref.where} names ${plural("pane", "panes")} ${named(unknown)} not found in facet column "${p.column}" (data values: ${sorted(p.values)})`]
        : [];
    }
    case "paneScope": {
      if (!d.faceted) {
        return rule.unfaceted === "error"
          ? [`${ref.where} is set but the chart has no small_multiples — remove \`facet\` or add small_multiples`]
          : [];
      }
      const p = d.pane;
      if (!p) return [];
      const facet = ref.keys[0] as string;
      if (p.rendered.has(facet)) return [];
      const panes = new Set([...p.values].filter((v) => v !== ""));
      return [
        panes.has(facet)
          ? `${ref.where} names pane ${JSON.stringify(facet)}, which small_multiples.pane_order excludes — that pane is never rendered, so ${rule.drawnNowhere} (rendered panes: ${JSON.stringify([...p.rendered])})`
          : `${ref.where} names pane ${JSON.stringify(facet)} not found in facet column "${p.column}" (data values: ${sorted(panes)})`,
      ];
    }
  }
}

/** Every reference in `spec` checked against the domains the chart path supplied, in table order. */
export function keyReferenceErrors(spec: ChartSpec, domains: RefDomains): string[] {
  return DATA_KEY_REFERENCES
    .filter((rule) => !rule.readBy || rule.readBy(spec))
    .flatMap((rule) => rule.refs(spec).flatMap((ref) => ruleErrors(rule, ref, domains)));
}
