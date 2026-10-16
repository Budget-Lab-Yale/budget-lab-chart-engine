// ChartSpec validation, ported + reduced from build-manifest.py's three layers to the
// one-chart model:
//   1. Structural  — the ajv JSON schema (schema.ts), additionalProperties:false, so typos
//                     (`xAxisTpye`), bad enums, wrong types, and missing required fields fail.
//   2. Cross-ref   — every spec key that names a series, shape value, category, section or pane
//                     must appear in the data (the one table in data-refs.ts, read by every
//                     chart type's path).
//   3. CSV format  — required columns exist; each row's `time` parses under the declared
//                     xAxisType; `value` and CI columns are numeric or empty.
// Layers 2-3 need the data, so they live in validateChartData(spec, rows). Each failure is a
// pointed, fix-oriented message (matching the tracker's build-failure style).
import Ajv from "ajv";
import type { ErrorObject } from "ajv";
import { CHART_SPEC_SCHEMA } from "./schema";
import { POLY_DEFAULT_DEGREE, SHADE_FILL_OPACITY, Y_BOUND_LIMIT } from "./defaults";
// Imported, deliberately NOT re-exported: a re-export here would hand browser-bundled code a path
// back to this Ajv-carrying module. Import it from ./filled-chart-types directly.
import { FILLED_CHART_TYPES } from "./filled-chart-types";
import { isHorizontalDumbbell, valueAxisIsX } from "./dumbbell-orientation";
import { facetsDrawAsGroups, facetGroupErrors } from "./facet-groups";
import { colorRefError, monoBaseError } from "./color-ref";
import type { ChartSpec, XAxisType } from "./types";
import { resolveColumns, isPreBinned, SINGLE_SERIES_KEY } from "./columns";
import { rowsInSectionOrder } from "./section-key";
import { resolveAnnotations } from "./annotations";
import { resolveRugTracks, fullyHiddenRugTracks, rugBoundPosition } from "./rug";
import { temporalValueError, quarterValueError } from "./parse-time";
import type { ResolvedColumns } from "./columns";
import type { TidyRow } from "../data/index";
import { parseExpression, exprVariables, EXPR_CONSTANTS } from "./expr";
import { overlayKind, overlayPerSeries } from "./overlays";
import type { Overlay } from "./types";
import { timelineDataErrors, timelineColumns } from "./timeline";
import { treemapDataErrors, treemapColumns } from "./treemap";
import { keyReferenceErrors } from "./data-refs";
import { figurePaneValues } from "./panes";
import { textureGroundErrors } from "./texture-grounds";
import type { RefDomains } from "./data-refs";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const ajv = new Ajv({ allErrors: true });
const validateStructural = ajv.compile<ChartSpec>(CHART_SPEC_SCHEMA);

function formatAjvError(e: ErrorObject, spec: unknown): string {
  const path = e.instancePath || "(root)";
  if (e.keyword === "uniqueItems") {
    // Name the value, not ajv's item indexes: `/series_order: "M" appears more than once`.
    const list = e.instancePath.split("/").slice(1).reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], spec);
    const repeated = Array.isArray(list) ? list[e.params.i as number] : undefined;
    return `${path}: ${JSON.stringify(repeated)} appears more than once`;
  }
  if (e.keyword === "additionalProperties") {
    return `${path}: unknown property "${e.params.additionalProperty}" (check for a typo)`;
  }
  if (e.keyword === "enum") {
    const allowed = (e.params.allowedValues as unknown[] | undefined)?.join(", ");
    return `${path}: ${e.message}${allowed ? ` (allowed: ${allowed})` : ""}`;
  }
  if (e.keyword === "required") {
    return `${path}: missing required property "${e.params.missingProperty}"`;
  }
  if ((e.keyword === "minimum" || e.keyword === "maximum") && /^\/yAxisPolicy\/(min|max)$/.test(path)) {
    const bound = Y_BOUND_LIMIT.toExponential().replace("e+", "e"); // "1e300", as authors write it
    return `${path}: must be between -${bound} and ${bound}`;
  }
  return `${path}: ${e.message ?? "invalid"}`;
}

/** Point charts constrain the x-axis type: a scatter plots two NUMERIC axes; a dot plot puts
 *  a CATEGORICAL axis on x. The JSON schema can't express this cross-field rule cleanly, so it
 *  is checked here once structural validation has confirmed both fields are present + well-typed. */
function pointChartAxisError(spec: { chartType?: unknown; xAxisType?: unknown }): string | null {
  if (spec.chartType === "scatter" && spec.xAxisType !== "numeric") {
    return `chartType "scatter" requires xAxisType "numeric" (got ${JSON.stringify(spec.xAxisType)})`;
  }
  if (spec.chartType === "dotplot" && spec.xAxisType !== "categorical") {
    return `chartType "dotplot" requires xAxisType "categorical" (got ${JSON.stringify(spec.xAxisType)})`;
  }
  return null;
}

/** `columns.point_label` names the observation in the SCATTER hover card's header, and no other
 *  chart type draws that header — a dot plot's card is keyed by category, and the rest hover by
 *  band or bin. Silently ignoring it would leave an author believing a label was configured, so it
 *  is rejected, like `x_axis_ticks` on a vertical bar.
 *
 *  This lives with the other cross-field checks rather than in the shared data validator on
 *  purpose: `validateChartData` returns to the histogram-specific validator before it reaches the
 *  column-role checks, so a gate placed there would let `chartType: histogram` through. */
function pointLabelChartTypeError(spec: {
  chartType?: unknown;
  columns?: { point_label?: unknown };
}): string | null {
  // PRESENCE, not truthiness: `point_label: ""` is a no-op the resolver nulls anyway, but letting
  // it through on a line chart contradicts the documented scatter-only gate. Matches the
  // `tooltip_series_name` gate below.
  if (spec.columns?.point_label === undefined) return null;
  if (spec.chartType === "scatter") return null;
  return `columns.point_label is supported on chartType "scatter" only (got ${JSON.stringify(spec.chartType)})`;
}

/** `annotations.points[].point` keys a callout to ONE observation by its `columns.point_label` cell,
 *  which then supplies the callout's x and y. Spec-only rules (the exactly-one-match rule needs the
 *  rows and lives in validateChartData): a callout is anchored by exactly one of `x` / `point`; a
 *  keyed callout may carry neither `y` nor `series` (the row supplies both, and a stale copy would
 *  silently disagree with it); and `point` needs `columns.point_label`, which is scatter-only, so it
 *  is too. Every callout is checked and every message names its index — a spec that gets one wrong
 *  usually gets several wrong the same way, and one error per re-run is a slow way to find out. */
function pointCalloutSpecErrors(spec: {
  chartType?: unknown;
  columns?: { point_label?: unknown };
  annotations?: { points?: Array<{ x?: unknown; point?: unknown; y?: unknown; series?: unknown }> };
}): string[] {
  const errors: string[] = [];
  (spec.annotations?.points ?? []).forEach((p, i) => {
    const at = `annotations.points[${i}]`;
    const hasX = p.x !== undefined;
    const hasPoint = p.point !== undefined;
    if (hasX && hasPoint) {
      errors.push(`${at}: give exactly one of x / point, not both (x: ${JSON.stringify(p.x)}, point: ${JSON.stringify(p.point)})`);
    } else if (!hasX && !hasPoint) {
      errors.push(`${at}: give exactly one of x / point — a callout needs an anchor`);
    }
    if (!hasPoint) return;
    if (p.y !== undefined) {
      errors.push(`${at}: point ${JSON.stringify(p.point)} supplies y from the matched row — remove y: ${JSON.stringify(p.y)}`);
    }
    if (p.series !== undefined) {
      errors.push(`${at}: point ${JSON.stringify(p.point)} supplies series from the matched row — remove series: ${JSON.stringify(p.series)}`);
    }
    if (spec.chartType !== "scatter") {
      errors.push(`${at}.point is supported on chartType "scatter" only (got ${JSON.stringify(spec.chartType)}) — it matches columns.point_label, which is scatter-only`);
    } else if (!spec.columns?.point_label) {
      errors.push(`${at}.point needs columns.point_label — it names the column whose cell ${JSON.stringify(p.point)} must match`);
    }
  });
  return errors;
}

/** `tooltip_series_name` suppresses the series token in the SCATTER card's header, which is the only
 *  card where the series name is a header naming one hovered point. Everywhere else the series name
 *  is a ROW label against a value — a line or bar card without it is a list of unlabelled numbers —
 *  so the field is rejected rather than ignored.
 *
 *  `series_legend` deliberately has NO such gate: dropping the series rows leaves a legend that
 *  still keys the overlays, which is a legible outcome on any chart type. */
function tooltipSeriesNameChartTypeError(spec: {
  chartType?: unknown;
  tooltip_series_name?: unknown;
}): string | null {
  // PRESENCE, not value: `tooltip_series_name: true` on a line chart is a no-op, but accepting it
  // would contradict the documented "rejected elsewhere" and leave an author believing the field
  // is wired there. Matches the point_label gate above.
  if (spec.tooltip_series_name === undefined) return null;
  if (spec.chartType === "scatter") return null;
  return `tooltip_series_name is supported on chartType "scatter" only (got ${JSON.stringify(spec.chartType)}) — on other chart types the series name labels a tooltip ROW, not the header`;
}

/** `tooltip_section` puts the section in the hover CARD's header, so it needs sections: rejected
 *  without `columns.section` (no section to name), or a horizontal chart's `columns.facet`, whose
 *  values draw as sections (spec/facet-groups.ts). PRESENCE, not value, as the sibling gates.
 *  Accepted on every chart type `columns.section` allows (horizontal bar / stacked / dumbbell, by
 *  sectionColumnError): where the chart hovers with value pills rather than a card (a bar, a stack in
 *  pills mode) it is a no-op, since a stack's hover mode can depend on the data
 *  (`barStack.netDisplay: auto`). */
function tooltipSectionError(spec: ChartSpec): string | null {
  if (spec.tooltip_section === undefined) return null;
  if (spec.columns?.section == null && !facetsDrawAsGroups(spec)) {
    return `tooltip_section needs columns.section — it names the hovered row's section in the hover card's header`;
  }
  return null;
}

/** `tooltip_x_label` / `tooltip_y_label` rename the SCATTER card's two value-row labels, which are
 *  otherwise the axis titles. Every other chart type's card labels its rows by SERIES, not by axis
 *  (a line/bar card has one row per series, not one row per axis) — an axis-title override has
 *  nothing to attach to there, so it is rejected rather than silently ignored. Matches the
 *  `tooltip_series_name` / `point_label` gates above. */
function tooltipAxisLabelChartTypeError(spec: {
  chartType?: unknown;
  tooltip_x_label?: unknown;
  tooltip_y_label?: unknown;
}): string | null {
  if (spec.chartType === "scatter") return null;
  // PRESENCE, not value: matches the sibling gates — accepting either field as a no-op elsewhere
  // would contradict the documented "rejected elsewhere" and leave an author believing it is wired.
  const field = spec.tooltip_x_label !== undefined ? "tooltip_x_label"
    : spec.tooltip_y_label !== undefined ? "tooltip_y_label"
    : null;
  if (!field) return null;
  return `${field} is supported on chartType "scatter" only (got ${JSON.stringify(spec.chartType)}) — on other chart types the card's rows are labelled by series, not by axis`;
}

/** Dumbbell cross-field constraint: like bars, the categorical axis is declared via
 *  `xAxisType: categorical` (NOT a separate yAxisType); `orientation` then flips it to screen-y
 *  (horizontal, default) or screen-x (vertical). A non-categorical xAxisType has no meaning. */
function dumbbellAxisError(spec: { chartType?: unknown; xAxisType?: unknown }): string | null {
  if (spec.chartType === "dumbbell" && spec.xAxisType !== "categorical") {
    return `chartType "dumbbell" requires xAxisType "categorical" (got ${JSON.stringify(spec.xAxisType)})`;
  }
  return null;
}

/** Bar cross-field constraint: `bar` and `stacked` draw on a BAND x-scale, and only the categorical
 *  x adapter (`_xc`) builds a band domain from the actual x values. On every other axis type the
 *  output was wrong in some way while `validateSpec` said `valid: true`, but the reasons differ and
 *  it is worth being exact about them, because one shape does render correctly:
 *
 *  NUMERIC, vertical — the numeric adapter emits `xPlotOpts: { domain: [xMin, xMax] }`
 *  (engine/x-adapter.ts) and the vertical single-series path in `marks/bar.ts` does not replace it
 *  (it only refines paddingInner/paddingOuter), so Plot reads that two-element CONTINUOUS domain as
 *  a BAND domain of exactly two categories. The band domain is therefore always the numeric
 *  domain's two ENDPOINTS, and a row is drawn only if its x IS one of those endpoints. So a chart
 *  whose entire x set is those two endpoints — i.e. exactly two distinct x values — renders
 *  COMPLETELY AND CORRECTLY, and every other shape silently drops the interior rows. Measured
 *  (rects drawn / x tick labels): 2 rows → 2 of 2, "1","2"; 3 rows → 2 of 3, "1","3"; 5 rows →
 *  2 of 5, "1","5". Rects at x=104 and x=404, width 240, at every row count.
 *
 *  NUMERIC, horizontal — 0 rects at every row count, including two. The horizontal path builds its
 *  own band domain from the x values filtered to non-empty STRINGS, which the numeric adapter never
 *  produces, so the domain is empty and Plot drops the whole mark.
 *
 *  TEMPORAL / QUARTERLY, vertical — drew EVERY bar at every row count; nothing is dropped here. The
 *  defect is chrome, not data: Plot stacks its own band axis over the engine's, `bar` leaks the
 *  internal field name `_xd` as the x-axis label, and Plot paints its warning glyph into the SVG —
 *  which the PNG export re-renders into a published figure. Horizontal draws 0, as above.
 *
 *  The two-row numeric vertical case is refused ANYWAY, deliberately. It is correct by coincidence
 *  of the band-domain derivation, not by design; the carve-out would be a three-way conjunction
 *  (numeric AND vertical AND exactly two distinct x values) that no author should have to hold; and
 *  `validateSpec` cannot see the data, so narrowing it would move the rule into data validation and
 *  make a spec's validity depend on today's row count — a chart that renders today would start
 *  failing the day its data grew a third row, across a whole archive at repin. See the pinning test
 *  in test/validate.test.ts before relaxing any of this.
 *
 *  Keyed on the two literals ON PURPOSE. `FILLED_CHART_TYPES` (./filled-chart-types) is the
 *  tempting import and the wrong one: it also holds `histogram` (numeric/temporal by design),
 *  `area` (usually temporal) and `waterfall` (already checked, with its own vertical-only message
 *  that a second check here would only duplicate). This must never read as
 *  "categorical implies bar" either — line and area on a categorical axis render correctly and are
 *  used by published figures. */
function barBandAxisError(spec: { chartType?: unknown; xAxisType?: unknown }): string | null {
  if (spec.chartType !== "bar" && spec.chartType !== "stacked") return null;
  if (spec.xAxisType === "categorical") return null;
  return (
    `chartType ${JSON.stringify(spec.chartType)} requires xAxisType "categorical" ` +
    `(got ${JSON.stringify(spec.xAxisType)}) — bars sit on a band scale, and on a continuous or ` +
    "date x-axis that band domain is built from the numeric domain's two endpoints, so all but the " +
    "first and last row are silently dropped (horizontal draws no bars at all, and a date axis " +
    "draws a doubled x-axis with a warning glyph). For values over years, ages or percentiles, " +
    "either declare the x values as categories (xAxisType: categorical, with x_order to fix their " +
    "order) or use chartType: line."
  );
}

/** `title_selectors` cross-field rules the JSON schema can't express: every selector key must
 *  appear as a literal `{key}` token in the title (else the control has nowhere to render), and
 *  `default` (when set) must name one of that selector's own option ids. Duplicate option ids
 *  are also rejected here (ajv has no cross-item uniqueness keyword short of a custom one).
 *  Non-empty option id / options array are enforced structurally (schema.ts TITLE_SELECTOR). */
function titleSelectorsError(spec: {
  title?: unknown;
  title_selectors?: Record<string, { options?: Array<{ id?: string }>; default?: string }>;
}): string | null {
  const selectors = spec.title_selectors;
  if (!selectors) return null;
  const title = typeof spec.title === "string" ? spec.title : "";
  for (const [key, selector] of Object.entries(selectors)) {
    if (!title.includes(`{${key}}`)) {
      return `title_selectors.${key}: title must contain the token "{${key}}" (got ${JSON.stringify(title)})`;
    }
    const ids = new Set<string>();
    for (const opt of selector.options ?? []) {
      const id = opt.id ?? "";
      if (ids.has(id)) {
        return `title_selectors.${key}: duplicate option id ${JSON.stringify(id)}`;
      }
      ids.add(id);
    }
    if (selector.default != null && !ids.has(selector.default)) {
      return `title_selectors.${key}: default ${JSON.stringify(selector.default)} is not one of the option ids (${JSON.stringify([...ids])})`;
    }
  }
  return null;
}


/** `columns.section` groups the category rows of a one-row-per-category HORIZONTAL chart under
 *  section headers: a horizontal `bar` or `stacked` chart (see marks/category-band.ts) or a
 *  horizontal `dumbbell` (marks/dumbbell.ts). Every other chartType/orientation has no row band to
 *  section — a vertical chart's categories run along the bottom — so the field would silently do
 *  nothing; reject it with a pointed message instead. */
function sectionColumnError(spec: {
  chartType?: unknown;
  orientation?: unknown;
  columns?: { section?: unknown };
}): string | null {
  if (spec.columns?.section == null) return null;
  // A dumbbell is horizontal unless it says vertical; a bar or stack must say horizontal.
  const sectionable =
    ((spec.chartType === "bar" || spec.chartType === "stacked") && spec.orientation === "horizontal") ||
    isHorizontalDumbbell(spec);
  if (!sectionable) {
    return (
      `columns.section requires a horizontal "bar", "stacked" or "dumbbell" chart ` +
      `(got chartType ${JSON.stringify(spec.chartType)}, orientation ${JSON.stringify(spec.orientation)})`
    );
  }
  return null;
}

/** Ruling 78: on a horizontal bar, stack or dumbbell the value axis is x, so a value-axis reference
 *  line is an `annotations.xAxis` marker. An `annotations.yAxis` one (or the legacy
 *  `yAxisPolicy.markers`, which `resolveAnnotations` reads in its place) would sit on the categorical
 *  y scale and draw nothing. Named by the block the author wrote. */
function horizontalYAxisMarkerError(spec: ChartSpec): string | null {
  if (!valueAxisIsX(spec) || resolveAnnotations(spec).yAxis.length === 0) return null;
  const at = spec.annotations?.yAxis ? "annotations.yAxis" : "yAxisPolicy.markers";
  return (
    `${at} draws nothing on a horizontal ${JSON.stringify(spec.chartType)} chart: its value axis runs ` +
    `along x, so a value-axis reference line goes in annotations.xAxis (with x set to the value)`
  );
}

/** `x_axis_ticks` (top/both value-axis tick row) only has an effect on a HORIZONTAL bar/stacked
 *  chart — assemblePlot reads it inside its `if (horizontal)` branch, which only bar/stacked marks
 *  reach (see assemble-plot.ts). On any other chartType/orientation it silently no-ops; reject it
 *  early with a pointed message (mirrors the columns.section D7 gate) instead of leaving it looking
 *  like dead configuration. */
function xAxisTicksOrientationError(spec: {
  x_axis_ticks?: unknown;
  chartType?: unknown;
  orientation?: unknown;
}): string | null {
  if (spec.x_axis_ticks == null) return null;
  const isBarLike = spec.chartType === "bar" || spec.chartType === "stacked";
  if (!isBarLike || spec.orientation !== "horizontal") {
    return (
      `x_axis_ticks requires a horizontal bar/stacked chart (a top value axis exists only there) ` +
      `(got chartType ${JSON.stringify(spec.chartType)}, orientation ${JSON.stringify(spec.orientation)})`
    );
  }
  return null;
}

/** Waterfall cross-field constraints the JSON schema can't express: a waterfall is a vertical,
 *  categorical chart (the running cumulative reads top-to-bottom on the value axis). Horizontal
 *  is rejected, and xAxisType must be categorical. */
function waterfallSpecError(spec: {
  chartType?: unknown;
  orientation?: unknown;
  xAxisType?: unknown;
}): string | null {
  if (spec.chartType !== "waterfall") return null;
  if (spec.orientation === "horizontal") {
    return `chartType "waterfall" is vertical only (got orientation "horizontal")`;
  }
  if (spec.xAxisType !== "categorical") {
    return `chartType "waterfall" requires xAxisType "categorical" (got ${JSON.stringify(spec.xAxisType)})`;
  }
  return null;
}

/** Calendar interval names a temporal histogram's `binWidth` may hold (engine/histogram-bin.ts
 *  `calendarEdges`). */
const HISTOGRAM_INTERVALS = ["day", "week", "month", "quarter", "year"];

/** Histogram cross-field constraints the JSON schema can't express: the x-axis must be
 *  numeric or temporal (a histogram bins a continuous axis); pre-binned mode (columns.x0 +
 *  columns.x1 both mapped) requires BOTH edges, not just one; and bin config (bins/binWidth/
 *  domain/weight) is meaningless — and therefore rejected — once the data already carries its
 *  own bin edges. And the bin config's values: the binner falls back to automatic bins for a
 *  binWidth <= 0, any string on a numeric axis, and on a temporal one a string that is neither an
 *  interval name nor a positive day count; an infinite binWidth draws one bin; and a reversed
 *  domain is read as a single unit bin. Each would publish a differently binned chart with no
 *  message. */
function histogramSpecError(spec: {
  chartType?: unknown;
  xAxisType?: unknown;
  columns?: { x0?: unknown; x1?: unknown };
  histogram?: { bins?: unknown; binWidth?: unknown; domain?: unknown; weight?: unknown };
}): string[] {
  const errors: string[] = [];
  if (spec.chartType !== "histogram") return errors;
  const c = spec.columns ?? {};
  const preBinned = c.x0 != null && c.x1 != null;
  if (spec.xAxisType !== "numeric" && spec.xAxisType !== "temporal") {
    errors.push('histogram requires xAxisType "numeric" or "temporal"');
  }
  if ((c.x0 != null) !== (c.x1 != null)) {
    errors.push("histogram pre-binned mode requires BOTH columns.x0 and columns.x1");
  }
  if (
    preBinned &&
    spec.histogram &&
    (spec.histogram.bins != null ||
      spec.histogram.binWidth != null ||
      spec.histogram.domain != null ||
      spec.histogram.weight != null)
  ) {
    errors.push(
      "histogram: bin config (bins/binWidth/domain/weight) is not allowed with pre-binned data (columns.x0/x1)",
    );
  }
  const bw = spec.histogram?.binWidth;
  if (typeof bw === "number" && !(Number.isFinite(bw) && bw > 0)) {
    errors.push(`histogram.binWidth must be a finite number greater than 0 (got ${bw})`);
  } else if (typeof bw === "string") {
    // A temporal axis reads a numeric string as a day count, exactly as the bare number
    // (histogram-bin.ts temporalThresholds), so "7" stays valid there; a numeric axis ignores it.
    const days = Number(bw);
    if (spec.xAxisType !== "temporal") {
      errors.push(
        `histogram.binWidth ${JSON.stringify(bw)} is a string: on xAxisType ${JSON.stringify(spec.xAxisType)} give a number of x-units (calendar interval names need xAxisType "temporal")`,
      );
    } else if (!HISTOGRAM_INTERVALS.includes(bw) && !(bw.trim() !== "" && Number.isFinite(days) && days > 0)) {
      errors.push(
        bw.trim() !== "" && !Number.isNaN(days)
          ? `histogram.binWidth must be a finite number greater than 0 (got ${JSON.stringify(bw)})`
          : `histogram.binWidth ${JSON.stringify(bw)} is not a calendar interval (allowed: ${HISTOGRAM_INTERVALS.join(", ")}) — or give a number of days`,
      );
    }
  }
  const domain = spec.histogram?.domain;
  if (Array.isArray(domain) && !((domain[0] as number) < (domain[1] as number))) {
    errors.push(`histogram.domain must satisfy min < max (got [${domain[0]}, ${domain[1]}])`);
  }
  return errors;
}

/** `series_patterns` textures a mark's FILL, so it only means anything where the mark is a filled
 *  area (see FILLED_CHART_TYPES). A line's 2px stroke and a dot's 8px disc are both smaller than
 *  the hatch period, so a texture there is noise — reject rather than render something illegible. */
function seriesPatternsError(spec: { chartType?: unknown; series_patterns?: unknown }): string | null {
  if (spec.series_patterns == null) return null;
  if (FILLED_CHART_TYPES.has(spec.chartType as string)) return null;
  return (
    "`series_patterns` applies only to chart types with filled marks " +
    `(${[...FILLED_CHART_TYPES].join(", ")}) — got ${JSON.stringify(spec.chartType)}`
  );
}

/** `tooltip_x_format` is a d3 `timeFormat` pattern, so it only means something on an axis whose x
 *  values ARE dates. On numeric/categorical it would be silently dropped — reject instead, so an
 *  author who reaches for it on the wrong axis finds out at load rather than by hovering. */
function tooltipXFormatError(spec: { xAxisType?: unknown; tooltip_x_format?: unknown }): string | null {
  if (spec.tooltip_x_format == null) return null;
  if (spec.xAxisType === "temporal" || spec.xAxisType === "quarterly") return null;
  return (
    "`tooltip_x_format` is a d3 timeFormat pattern and applies only to xAxisType " +
    `"temporal" or "quarterly" (got ${JSON.stringify(spec.xAxisType)})`
  );
}

/** `x_ticks` places ticks on a continuous axis, so it needs one: temporal, quarterly or numeric. Not
 *  supported on a histogram, and a timeline draws its own axis (TIMELINE_REJECTED_FIELDS).
 *  A listed value must read in the axis' own grammar — a bare number is a year on a temporal axis. */
function xTicksError(spec: { xAxisType?: unknown; chartType?: unknown; x_ticks?: unknown }): string | null {
  const ticks = spec.x_ticks;
  if (ticks == null) return null;
  const axis = spec.xAxisType;
  if (axis !== "temporal" && axis !== "quarterly" && axis !== "numeric") {
    return `\`x_ticks\` applies only to xAxisType "temporal", "quarterly" or "numeric" (got ${JSON.stringify(axis)})`;
  }
  if (spec.chartType === "histogram") return "`x_ticks` is not supported on a histogram";
  if (!Array.isArray(ticks)) return null;
  for (const v of ticks) {
    const s = String(v);
    const err =
      axis === "temporal"
        ? temporalValueError(s)
        : axis === "quarterly"
          ? quarterValueError(s)
          : s.trim() !== "" && Number.isFinite(+s)
            ? null
            : `expected a number, got ${JSON.stringify(v)}`;
    if (err) return `x_ticks: ${err}`;
  }
  return null;
}

/**
 * Every field that takes a color, checked against what the engine can actually PAINT (see
 * color-ref.ts). An unresolvable name is not a cosmetic slip: it reaches Plot as a constant fill,
 * Plot reads an unpaintable string as a column name, and the marks are dropped — a published figure
 * with no bars in it, off a spec that validated clean.
 *
 * All of them are collected, not just the first: a renamed hue is usually wrong in several places at
 * once, and one error per load is a slow way to find that out.
 */
function colorErrors(spec: ChartSpec): string[] {
  const errors: string[] = [];
  const check = (where: string, value: unknown): void => {
    const err = colorRefError(where, value);
    if (err) errors.push(err);
  };
  const checkColors = (where: string, list: ReadonlyArray<{ color?: string }> | undefined): void => {
    (list ?? []).forEach((e, i) => check(`${where}[${i}].color`, e.color));
  };

  for (const [k, v] of Object.entries(spec.series_colors ?? {})) {
    check(`series_colors[${JSON.stringify(k)}]`, v);
  }
  for (const [k, v] of Object.entries(spec.category_colors ?? {})) {
    check(`category_colors[${JSON.stringify(k)}]`, v);
  }
  check("bar_color", spec.bar_color);

  // Only the LIVE annotation source is checked. The unified `annotations` block wins PER FIELD over
  // the legacy axis policy (resolveAnnotations), and whichever loses is never painted — rejecting a
  // color there would fail a spec that renders correctly today.
  const ann = spec.annotations;
  checkColors(ann?.xAxis ? "annotations.xAxis" : "xAxisPolicy.markers", ann?.xAxis ?? spec.xAxisPolicy?.markers);
  checkColors(ann?.bands ? "annotations.bands" : "xAxisPolicy.bands", ann?.bands ?? spec.xAxisPolicy?.bands);
  checkColors(ann?.yAxis ? "annotations.yAxis" : "yAxisPolicy.markers", ann?.yAxis ?? spec.yAxisPolicy?.markers);
  checkColors("annotations.points", ann?.points);
  checkColors("shading", spec.shading);
  checkColors("rug.tracks", spec.rug?.tracks);
  checkColors("overlays", spec.overlays);

  for (const [key, selector] of Object.entries(spec.title_selectors ?? {})) {
    (selector.options ?? []).forEach((o, i) =>
      check(`title_selectors.${key}.options[${i}].color`, o.color),
    );
  }

  check("waterfall.colors.increase", spec.waterfall?.colors?.increase);
  check("waterfall.colors.decrease", spec.waterfall?.colors?.decrease);
  check("waterfall.colors.total", spec.waterfall?.colors?.total);
  check("waterfall.connectorColor", spec.waterfall?.connectorColor);
  check("connector.color", spec.connector?.color);

  const mono = monoBaseError("barStack.mono.base", spec.barStack?.mono?.base);
  if (mono) errors.push(mono);
  return errors;
}

function shadingSpecError(spec: { chartType?: unknown; shading?: unknown[] }): string | null {
  if (!spec.shading?.length) return null;
  return spec.chartType === "line"
    ? null
    : `shading is supported on chartType "line" only (got ${JSON.stringify(spec.chartType)})`;
}

/** Semantic checks on `overlays` — the ones ajv cannot express readably. Returns every error found,
 *  each naming the entry index and the field, so an author fixing three mistakes sees three messages
 *  rather than one per run. */
function overlaySpecErrors(spec: {
  overlays?: Overlay[];
  xAxisType?: unknown;
  chartType?: unknown;
  orientation?: unknown;
}): string[] {
  const overlays = spec.overlays;
  if (!overlays?.length) return [];
  const errors: string[] = [];
  const xAxisType = spec.xAxisType;
  const histogram = spec.chartType === "histogram";

  if (xAxisType === "categorical") {
    return [
      "overlays are not supported with xAxisType categorical — a band scale has no position between categories, so a fitted or drawn line has nowhere to land",
    ];
  }
  // Same "nowhere to land" reason as the categorical rejection above, one axis over: a HORIZONTAL
  // bar/stacked chart puts the category band on screen-y, and the overlay mark writes its values to
  // the `y` channel unconditionally (engine/marks/overlay.ts), so a band y-scale cannot place them.
  // Transposing that mark's channels would not have been the fix: horizontal bar/stacked with a
  // non-categorical x draws no BARS either (bar.ts/stacked.ts build the band domain from string
  // categories, which only the `_xc` adapter produces), so the fit would land on an empty frame.
  // Scoped to bar/stacked — the only overlay-eligible chart types that HONOUR `orientation`.
  // dumbbell/waterfall already require categorical x / vertical; on line/area/scatter `orientation`
  // is dead config the renderer ignores, and those draw their overlay correctly, so rejecting them
  // would break figures that render fine today.
  if (
    spec.orientation === "horizontal" &&
    (spec.chartType === "bar" || spec.chartType === "stacked")
  ) {
    return [
      `overlays are not supported on a horizontal ${spec.chartType} chart — the category band is on the y axis there, so a fitted or drawn line has nowhere to land (drop \`orientation: horizontal\`, or drop the overlay)`,
    ];
  }
  const temporal = xAxisType === "temporal" || xAxisType === "quarterly";

  overlays.forEach((o, i) => {
    const at = `overlays[${i}]`;
    const kind = overlayKind(o);
    if (!kind) {
      if ((o.slope == null) !== (o.intercept == null)) {
        errors.push(`${at}: \`slope\` and \`intercept\` must be given together`);
      } else {
        errors.push(
          `${at}: an overlay needs exactly one of \`method\`, \`fun\`, \`slope\`+\`intercept\`, \`column\``,
        );
      }
      return;
    }

    if (o.degree != null && o.method !== "poly") {
      errors.push(`${at}: \`degree\` applies to \`method: poly\``);
    }
    if (o.params != null && kind !== "fun") errors.push(`${at}: \`params\` applies to \`fun\``);
    if (o.n != null && kind !== "fun") errors.push(`${at}: \`n\` applies to \`fun\``);
    if (o.ci != null && kind !== "method") errors.push(`${at}: \`ci\` applies to \`method\``);
    if (o.by != null && kind !== "method" && kind !== "column") {
      errors.push(
        `${at}: \`by\` applies to \`method\` and \`column\` — the other kinds do not read the data`,
      );
    }
    // A dangling `slope`/`intercept` alongside another resolved kind (e.g. `{ method: "lm", slope:
    // 0.5 }`) reaches here — never both, together they'd make `kind` "abline" (or null, if a THIRD
    // key is also set) and be caught above instead. Named individually so a typo in either fails
    // the build, matching every other misapplied key above.
    if (kind !== "abline") {
      if (o.slope != null) errors.push(`${at}: \`slope\` applies to \`slope\`+\`intercept\` (an abline)`);
      if (o.intercept != null) {
        errors.push(`${at}: \`intercept\` applies to \`slope\`+\`intercept\` (an abline)`);
      }
    }
    if (o.legend === true && !o.label) {
      errors.push(`${at}: \`legend: true\` needs a \`label\` — it is the row's text`);
    }
    if (o.tooltip === true && !o.label) {
      errors.push(`${at}: \`tooltip: true\` needs a \`label\` — it is the row's text`);
    }

    // Histogram rows are BinnedRows ({_x0, _x1, _y}) built on a path that skips the row preparation
    // where `_xn` and `_overlayCols` are set, so the two data-reading kinds would fit NaN / find no
    // values and be dropped WITHOUT a message — while the spec validated. Reject them by name.
    if (histogram && (kind === "method" || kind === "column")) {
      errors.push(
        `${at}: \`${kind}\` is not supported on chartType histogram — histogram rows carry bin edges, not a per-row x, so there is nothing to fit or read. Use \`fun\` (e.g. a \`dnorm\` density curve over \`histogram.normalize: density\`).`,
      );
    }

    if (kind === "fun") {
      const parsed = parseExpression(o.fun as string);
      if (!parsed.ok) {
        errors.push(`${at}: \`fun\` does not parse — ${parsed.error}`);
      } else {
        const allowed = new Set(["x", ...Object.keys(EXPR_CONSTANTS), ...Object.keys(o.params ?? {})]);
        const unknown = exprVariables(parsed.ast).filter((v) => !allowed.has(v));
        if (unknown.length) {
          errors.push(
            `${at}: \`fun\` uses ${unknown.map((v) => JSON.stringify(v)).join(", ")}, which is neither \`x\`, a constant (${Object.keys(EXPR_CONSTANTS).join(", ")}), nor a declared \`params\` key`,
          );
        }
      }
    }

    if (temporal && (kind === "fun" || kind === "abline")) {
      const field = kind === "fun" ? "`fun`" : "`slope`+`intercept`";
      errors.push(
        `${at}: ${field} is not supported on a temporal x-axis — x would be epoch milliseconds, so the coefficients would not mean anything. Use \`method\` or \`column\` there.`,
      );
    }
    if (Array.isArray(o.domain)) {
      if (temporal) {
        errors.push(
          `${at}: an explicit numeric \`domain\` is not supported on a temporal x-axis — use \`domain: axis\``,
        );
      } else if (!(o.domain[0]! < o.domain[1]!)) {
        errors.push(`${at}: \`domain\` must satisfy min < max (got [${o.domain[0]}, ${o.domain[1]}])`);
      }
    }
  });

  return errors;
}

/** Every spec-side x coordinate on a temporal or quarterly axis, against the same grammar as a data
 *  cell. The engine parses each through the x adapter, which throws on a malformed date; the publish
 *  CLI validates and then ships HTML that renders in the browser, so a coordinate passed here and
 *  rejected there would publish a figure that throws on load. `rug.tracks` intervals are checked
 *  with the rest of the rug, in `legendAndRugErrors`. Paths name the block the author wrote — the
 *  unified `annotations` block or the legacy `xAxisPolicy` one, as `resolveAnnotations` picks. */
function dateCoordinateErrors(spec: ChartSpec): string[] {
  const { xAxisType } = spec;
  if (xAxisType !== "temporal" && xAxisType !== "quarterly") return [];
  const ann = spec.annotations;
  const resolved = resolveAnnotations(spec);
  const markersAt = ann?.xAxis ? "annotations.xAxis" : "xAxisPolicy.markers";
  const bandsAt = ann?.bands ? "annotations.bands" : "xAxisPolicy.bands";
  const coords: Array<[string, string | undefined]> = [
    ...resolved.xAxis.map((m, i): [string, string] => [`${markersAt}[${i}].x`, m.x]),
    ...resolved.bands.flatMap((b, i): Array<[string, string]> => [
      [`${bandsAt}[${i}].start`, b.start],
      [`${bandsAt}[${i}].end`, b.end],
    ]),
    ...resolved.points.map((p, i): [string, string | undefined] => [`annotations.points[${i}].x`, p.x]),
    ...(spec.shading ?? []).flatMap((s, i): Array<[string, string | undefined]> => [
      [`shading[${i}].from`, s.from],
      [`shading[${i}].to`, s.to],
    ]),
  ];
  const errors: string[] = [];
  for (const [where, value] of coords) {
    if (value === undefined) continue;
    const err = timeParseError(xAxisType, value);
    if (err) errors.push(`${where}: ${err}`);
  }
  return errors;
}

/** A band / shading / marker entry as the legend + rug flags see it. */
interface LegendFlagged {
  label?: string;
  legend?: boolean;
  rug?: boolean;
  /** Band bounds (`annotations.bands`). */
  start?: string;
  end?: string;
  /** Shading bounds. */
  from?: string;
  to?: string;
  /** Shading swatch inputs — an explicit color, its series scope, and its tint strength. */
  color?: string;
  series?: string;
  fillOpacity?: number;
}

/**
 * The `legend: true` / `rug: true` flags on annotations, bands and shading, plus the `rug` block.
 *
 * Both flags exist to move a name OUT of the plot frame, so an entry that carries one without a
 * `label` has asked for a swatch with nothing beside it — silently dropped before this check. The
 * rug rules are harder constraints: it needs a linear x scale to place blocks on, one plot frame to
 * hang under, and closed intervals to draw.
 */
function legendAndRugErrors(spec: ChartSpec): string[] {
  const errors: string[] = [];
  // Through resolveAnnotations, so the unified-block-over-legacy-policy precedence is stated once —
  // a second copy here could admit a spec the engine reads differently.
  const resolved = resolveAnnotations(spec);
  const bands = resolved.bands as LegendFlagged[];
  const xMarkers = resolved.xAxis as LegendFlagged[];
  const yMarkers = resolved.yAxis as LegendFlagged[];
  const shading = (spec.shading ?? []) as LegendFlagged[];

  const needsLabel = (entries: LegendFlagged[], where: string): void => {
    entries.forEach((e, i) => {
      if ((e.legend === true || e.rug === true) && !e.label) {
        const flag = e.legend === true ? "legend: true" : "rug: true";
        errors.push(`${where}[${i}]: ${flag} needs a \`label\` — it is the legend key`);
      }
    });
  };
  needsLabel(bands, "annotations.bands");
  needsLabel(xMarkers, "annotations.xAxis");
  needsLabel(yMarkers, "annotations.yAxis");
  needsLabel(shading, "shading");

  // Keyed fills whose swatch is DERIVED (no explicit color) are keyed by the series palette, so two
  // of them over the same series scope at the same opacity render the same chip — e.g. an
  // above-target and a below-target fill on a three-series chart both key as the same three tints.
  const derivedChips = new Map<string, string[]>();
  shading.forEach((s) => {
    const keyed = s.legend === true || s.rug === true;
    if (!keyed || !s.label || s.color) return;
    // A rug-flagged fill keys SOLID, everything else keys by its tint — different rules, so they
    // can't collide with each other.
    const scope = `${s.series ?? "*"}|${s.rug === true ? "solid" : (s.fillOpacity ?? SHADE_FILL_OPACITY)}`;
    const labels = derivedChips.get(scope) ?? [];
    if (!labels.includes(s.label)) labels.push(s.label);
    derivedChips.set(scope, labels);
  });
  for (const labels of derivedChips.values()) {
    if (labels.length > 1) {
      errors.push(
        `shading: ${labels.map((l) => JSON.stringify(l)).join(" and ")} would key with the SAME legend ` +
          `swatch — both take their tint from the series colors at the same opacity. Give at least one ` +
          `an explicit \`color\` (or a different \`fillOpacity\`) so the two concepts read apart`,
      );
    }
  }

  shading.forEach((s, i) => {
    if (s.label && s.legend !== true && s.rug !== true) {
      errors.push(
        `shading[${i}]: \`label\` on a fill has no effect without \`legend: true\` or \`rug: true\` ` +
          `— a fill draws no text of its own, so its label exists only to key it`,
      );
    }
    if (s.rug === true && (s.from == null || s.to == null)) {
      errors.push(
        `shading[${i}]: rug: true needs BOTH \`from\` and \`to\` — a rug block is a closed span, ` +
          `and an open-ended fill has no interval to draw`,
      );
    }
  });

  const hasRug = spec.rug != null || [...bands, ...shading].some((e) => e.rug === true);
  if (!hasRug) return errors;

  const xAxisType = spec.xAxisType as XAxisType | undefined;
  if (xAxisType === "categorical") {
    errors.push(
      'the x-axis rug needs a continuous x-axis (numeric / temporal / quarterly) — a band scale ' +
        "has no position between categories",
    );
  }
  if (spec.small_multiples != null) {
    errors.push("the x-axis rug is not supported with small_multiples");
  }

  const tracks = spec.rug?.tracks ?? [];
  tracks.forEach((t, i) => {
    if (!t.intervals?.length) errors.push(`rug.tracks[${i}]: \`intervals\` must not be empty`);
  });

  // Every interval, declared or derived, parsed on this chart's axis. An unparseable bound would
  // silently drop its block; a reversed one would draw a zero-width sliver at the floor width.
  // Indexed BEFORE the rug filter, so `annotations.bands[2]` names the entry the author wrote.
  // On a date axis `dateCoordinateErrors` has already parsed every band and shading bound against the
  // same grammar, so only the rug's own tracks report a bad bound from here there (`parsedAbove`).
  const parsedAbove = xAxisType === "temporal" || xAxisType === "quarterly";
  const allIntervals: Array<{ where: string; from?: string; to?: string; parsedAbove: boolean }> = [
    ...bands.map((b, i) => ({ where: `annotations.bands[${i}]`, from: b.start, to: b.end, e: b, parsedAbove })),
    ...shading.map((s, i) => ({ where: `shading[${i}]`, from: s.from, to: s.to, e: s, parsedAbove })),
  ]
    .filter(({ e }) => e.rug === true)
    .concat(
      tracks.flatMap((t, ti) =>
        (t.intervals ?? []).map((iv, ii) => ({
          where: `rug.tracks[${ti}].intervals[${ii}]`,
          from: iv.from,
          to: iv.to,
          e: {} as LegendFlagged,
          parsedAbove: false,
        })),
      ),
    );
  if (xAxisType && xAxisType !== "categorical") {
    for (const iv of allIntervals) {
      if (iv.from == null || iv.to == null) continue;
      const fromErr = timeParseError(xAxisType, iv.from);
      const toErr = timeParseError(xAxisType, iv.to);
      if (fromErr && !iv.parsedAbove) errors.push(`${iv.where}: rug bound \`from\`: ${fromErr}`);
      if (toErr && !iv.parsedAbove) errors.push(`${iv.where}: rug bound \`to\`: ${toErr}`);
      if (!fromErr && !toErr && rugBoundPosition(xAxisType, iv.from) > rugBoundPosition(xAxisType, iv.to)) {
        errors.push(`${iv.where}: rug interval runs backwards (${iv.from} → ${iv.to})`);
      }
    }
  }

  // A track the single strip would paint away entirely still claims a legend row, so the reader is
  // keyed to blocks that aren't drawn. Partial cover stays legal — that is how the michez strip reads
  // a false negative running into its recession.
  for (const label of fullyHiddenRugTracks(spec)) {
    errors.push(
      `rug: the track ${JSON.stringify(label)} is completely covered by a later track, so its blocks ` +
        `would never be visible. Set \`rug.rows: per-track\` to give each track its own row`,
    );
  }

  // Asked of the RESOLVER, not of a re-written copy of its predicates: this error exists to predict
  // exactly what resolveRugTracks will return, so it must not be able to disagree with it.
  if (!resolveRugTracks(spec).length) {
    errors.push(
      "the x-axis rug resolves to no tracks — flag a band or shading region with `rug: true` " +
        "(each needs a `label`), or declare `rug.tracks`",
    );
  }
  return errors;
}

/** Top-level fields a timeline honours. Every CHART_SPEC_SCHEMA property is in exactly one of
 *  these two lists — test/timeline-spec.test.ts enforces it, so a field added to the schema later
 *  must be classified here rather than silently accepted and ignored on a timeline. */
export const TIMELINE_ALLOWED_FIELDS: readonly string[] = [
  "chartType", "columns", "title", "subtitle", "source", "note", "x_axis_title", "xAxisType",
  "series_order", "series_colors", "series_labels", "projected_field",
  "orientation", "legendPosition", "legend", "series_legend", "data", "tags", "timeline",
];

export const TIMELINE_REJECTED_FIELDS: readonly string[] = [
  "title_selectors", "value_prefix", "value_suffix", "x_axis_ticks", "y_axis_title",
  "tooltip_decimals", "tooltip_series_name", "tooltip_section", "tooltip_x_format", "tooltip_x_label", "tooltip_y_label",
  "xAxisPolicy", "yAxisPolicy", "annotations", "series_patterns", "bar_color", "category_colors",
  "series_styles", "section_order", "section_labels", "x_order", "x_ticks", "category_order", "x_labels",
  "shape_order", "shape_labels", "shape_legend_title", "confidence_bands", "overlays", "shading",
  "rug", "points", "projected_style", "valueLabels", "barStack", "waterfall", "histogram",
  "series_marker", "connector", "dot_radius", "gap_annotation", "value_axis_title", "value_format",
  "highlightSeries", "chrome", "small_multiples", "treemap",
  // Drawn only as a heading in the shape-legend layout, and a timeline has no shape legend.
  "color_legend_title",
];

const TIMELINE_ONLY_COLUMNS = ["end", "label", "description", "date_label"] as const;
const TIMELINE_REJECTED_COLUMNS = ["value", "facet", "shape", "point_label", "section", "kind", "x0", "x1", "category"] as const;

/** Timeline cross-field rules, plus the reverse direction: the timeline-only column roles and the
 *  `timeline:` block are errors on every other chart type. Off a timeline this can only fire on a
 *  field that did not exist before 1.15.0, so no existing spec changes validity. */
function timelineSpecErrors(chartSpec: ChartSpec): string[] {
  // Read by field NAME (the TIMELINE_*_FIELDS lists), so through an index view.
  const spec = chartSpec as unknown as Readonly<Record<string, unknown>>;
  const errors: string[] = [];
  const cols = (spec.columns ?? {}) as Record<string, unknown>;
  if (spec.chartType !== "timeline") {
    for (const c of TIMELINE_ONLY_COLUMNS) {
      if (cols[c] != null) errors.push(`columns.${c} is only valid on chartType "timeline"`);
    }
    if (spec.timeline != null) errors.push(`the timeline block is only valid on chartType "timeline"`);
    return errors;
  }
  if (spec.xAxisType !== "temporal") {
    errors.push(`chartType "timeline" requires xAxisType "temporal" (got ${JSON.stringify(spec.xAxisType)})`);
  }
  for (const f of TIMELINE_REJECTED_FIELDS) {
    if (spec[f] !== undefined) errors.push(`${f} is not supported on chartType "timeline"`);
  }
  for (const c of TIMELINE_REJECTED_COLUMNS) {
    if (cols[c] != null) errors.push(`columns.${c} is not supported on chartType "timeline"`);
  }
  const tl = (spec.timeline ?? {}) as { axis?: boolean; spacing?: string };
  if (tl.axis === true && tl.spacing === "even") {
    errors.push(
      `timeline.axis cannot be used with timeline.spacing "even": ticks would imply proportional gaps between evenly spaced events`,
    );
  }
  if (spec.x_axis_title !== undefined && tl.axis !== true) {
    errors.push(`x_axis_title on a timeline requires timeline.axis: true (there is no axis to caption)`);
  }
  return errors;
}

/** Top-level fields a treemap honours. Every CHART_SPEC_SCHEMA property is in exactly one of
 *  these two lists — test/treemap-spec.test.ts enforces it. Inside `chrome`, only `tooltip`. */
export const TREEMAP_ALLOWED_FIELDS: readonly string[] = [
  "chartType", "title", "subtitle", "note", "source", "xAxisType", "data", "tags", "columns",
  "series_order", "series_colors", "series_labels", "value_format", "tooltip_decimals", "chrome", "treemap",
  "legend", "legendPosition", "series_legend",
];

export const TREEMAP_REJECTED_FIELDS: readonly string[] = [
  "value_prefix", "value_suffix", "annotations", "overlays",
  "title_selectors", "x_axis_title", "x_axis_ticks", "y_axis_title", "tooltip_series_name", "tooltip_section",
  "tooltip_x_format", "tooltip_x_label", "tooltip_y_label", "xAxisPolicy", "yAxisPolicy",
  "series_patterns", "bar_color", "category_colors", "series_styles", "section_order", "section_labels",
  "x_order", "x_ticks", "category_order", "x_labels", "shape_order", "shape_labels", "color_legend_title",
  "shape_legend_title", "confidence_bands", "shading", "rug", "points", "projected_field",
  "projected_style", "orientation", "valueLabels", "barStack", "waterfall", "histogram", "timeline",
  "series_marker", "connector", "dot_radius", "gap_annotation", "value_axis_title", "highlightSeries",
  "small_multiples",
];

const TREEMAP_ALLOWED_COLUMNS: readonly string[] = ["x", "value", "series"];

/** Treemap cross-field rules, plus the reverse direction: the `treemap:` block is an error on every
 *  other chart type. Off a treemap this can only fire on a field that did not exist before it, so
 *  no existing spec changes validity. */
function treemapSpecErrors(chartSpec: ChartSpec): string[] {
  // Read by field NAME (the TREEMAP_*_FIELDS lists), so through an index view.
  const spec = chartSpec as unknown as Readonly<Record<string, unknown>>;
  const errors: string[] = [];
  if (spec.chartType !== "treemap") {
    if (spec.treemap != null) errors.push(`the treemap block is only valid on chartType "treemap"`);
    return errors;
  }
  if (spec.xAxisType !== "categorical") {
    errors.push(`chartType "treemap" requires xAxisType "categorical" (got ${JSON.stringify(spec.xAxisType)})`);
  }
  for (const f of TREEMAP_REJECTED_FIELDS) {
    if (spec[f] !== undefined) errors.push(`${f} is not supported on chartType "treemap"`);
  }
  const cols = (spec.columns ?? {}) as Record<string, unknown>;
  for (const c of Object.keys(cols)) {
    if (cols[c] != null && !TREEMAP_ALLOWED_COLUMNS.includes(c)) {
      errors.push(`columns.${c} is not supported on chartType "treemap"`);
    }
  }
  const chrome = (spec.chrome ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(chrome)) {
    if (k !== "tooltip") errors.push(`chrome.${k} is not supported on chartType "treemap"`);
  }
  return errors;
}

/** A cross-field rule over a structurally valid spec: every error it finds, in the order it finds
 *  them (none when the spec passes). */
type SpecRule = (spec: ChartSpec) => readonly string[];

/** A rule that reports at most one error. */
const single =
  (rule: (spec: ChartSpec) => string | null): SpecRule =>
  (spec) => {
    const err = rule(spec);
    return err ? [err] : [];
  };

/** Chart-type admission. A failing gate ENDS validation: it names a field the chart type does not
 *  honour, and every rule below would only re-describe that same field with a less specific message
 *  (e.g. tooltip_x_format's axis check). The treemap gate goes before the timeline's so a treemap
 *  carrying a timeline-only column or the timeline block reports as unsupported on a treemap, not as
 *  "only valid on a timeline". */
const SPEC_GATES: readonly SpecRule[] = [treemapSpecErrors, timelineSpecErrors];

/** The cross-field rules, run in this order and ALL reported: errors[0] is the first failing rule's
 *  first error, and tests and downstream CI read it, so the order is a contract — a new rule goes at
 *  the end unless it must report before an existing one. */
const SPEC_RULES: readonly SpecRule[] = [
  single(pointChartAxisError),
  single(pointLabelChartTypeError),
  pointCalloutSpecErrors,
  single(tooltipSeriesNameChartTypeError),
  single(tooltipSectionError),
  single(tooltipAxisLabelChartTypeError),
  single(dumbbellAxisError),
  single(titleSelectorsError),
  single(sectionColumnError),
  facetGroupErrors,
  single(horizontalYAxisMarkerError),
  single(xAxisTicksOrientationError),
  single(waterfallSpecError),
  histogramSpecError,
  overlaySpecErrors,
  // AFTER `overlaySpecErrors`, not up with the other axis checks: a horizontal bar/stacked chart
  // carrying an overlay violates BOTH rules, and the overlay message is the more specific of the two,
  // so it reports first.
  single(barBandAxisError),
  single(shadingSpecError),
  single(tooltipXFormatError),
  single(xTicksError),
  single(seriesPatternsError),
  colorErrors,
  // Before the rug rule, which leaves a band or shading bound on a date axis to this one.
  dateCoordinateErrors,
  legendAndRugErrors,
];

const ajvValidationErrors = (spec: unknown): string[] =>
  (validateStructural.errors ?? []).map((e) => formatAjvError(e, spec));

/** Layer 1: structural validation against the JSON schema (every schema error), then the
 *  chart-type gates (the first failing one), then every cross-field rule's errors. */
export function validateSpec(spec: unknown): ValidationResult {
  if (!validateStructural(spec)) return { valid: false, errors: ajvValidationErrors(spec) };
  for (const gate of SPEC_GATES) {
    const errors = gate(spec);
    if (errors.length) return { valid: false, errors: [...errors] };
  }
  const errors = SPEC_RULES.flatMap((rule) => rule(spec));
  return { valid: errors.length === 0, errors };
}

/** Returns an error string if `value` doesn't parse under `xAxisType`, else null. A date axis reads
 *  the ONE grammar the parsers throw on (spec/parse-time.ts), so a cell validation passes always
 *  parses and one it rejects never does. A bare year is a valid temporal cell: it is the natural
 *  spelling for an annual series, and `parseDate` reads it as local 1 January. */
function timeParseError(xAxisType: XAxisType, value: string): string | null {
  if (xAxisType === "numeric") {
    return value.trim() !== "" && Number.isFinite(Number(value))
      ? null
      : `expected a number, got ${JSON.stringify(value)}`;
  }
  if (xAxisType === "temporal") return temporalValueError(value);
  if (xAxisType === "quarterly") return quarterValueError(value);
  if (xAxisType === "categorical") {
    // Any non-empty string is a valid category label.
    return value.trim() !== "" ? null : `expected a non-empty category label, got ${JSON.stringify(value)}`;
  }
  return `unknown xAxisType ${JSON.stringify(xAxisType)}`;
}

/** A numeric cell is a number or EMPTY (blank means absent, CONFIG-SPEC.md). A whitespace-only
 *  cell is neither: `Number(" ")` is 0, so the engine would draw it as a zero. */
const isNumericOrEmpty = (v: string): boolean => v === "" || (v.trim() !== "" && Number.isFinite(Number(v)));

/** The per-row error for a cell `isNumericOrEmpty` rejects. */
function notNumericError(rowNum: number, col: string, v: string): string {
  const hint = v !== "" && v.trim() === "" ? " — leave the cell empty for a missing observation" : "";
  return `row ${rowNum}: ${col} ${JSON.stringify(v)} is not numeric${hint}`;
}

function missingColumnErrors(roles: Array<[string, string]>, columns: Set<string>): string[] {
  return roles
    .filter(([, col]) => !columns.has(col))
    .map(([role, col]) => `config/data mismatch: columns.${role} is "${col}" but no such column exists (columns: ${JSON.stringify([...columns].sort())})`);
}

/** The key sets the reference table (data-refs.ts) checks against, for the shared and histogram
 *  paths. A chart with NO series column has one implicit series keyed "" (SINGLE_SERIES_KEY), which
 *  no data cell spells out, so it is added or every key naming that series is rejected — including
 *  the documented `series_colors: {"": color}` idiom. Only when the column is absent: with a series
 *  column present, "" names nothing and IS a mistake. Assumes every declared column exists. */
function refDomains(spec: ChartSpec, rows: TidyRow[], cols: ResolvedColumns, columns: Set<string>): RefDomains {
  const values = (col: string): Set<string> => new Set(rows.map((r) => r[col] as string));
  const series = cols.series ? values(cols.series) : new Set([SINGLE_SERIES_KEY]);
  const facet = spec.small_multiples && cols.facet && columns.has(cols.facet) ? cols.facet : null;
  const facetValues = facet ? values(facet) : null;
  return {
    series,
    shape: cols.shape ? values(cols.shape) : undefined,
    category: spec.xAxisType === "categorical" ? { column: cols.x, values: values(cols.x) } : undefined,
    section: cols.section ? { column: cols.section, values: values(cols.section) } : undefined,
    pane: facet && facetValues
      ? { column: facet, values: facetValues, rendered: new Set(figurePaneValues(spec, rows, facet)) }
      : undefined,
    faceted: spec.small_multiples != null,
  };
}

/** `small_multiples.pane_widths`: one proportion per grid column. Columns = the explicit config,
 *  else a single row (all panes) when pane_widths is set. */
function paneWidthsErrors(spec: ChartSpec, rows: TidyRow[], cols: ResolvedColumns, columns: Set<string>): string[] {
  const pw = spec.small_multiples?.pane_widths;
  if (!Array.isArray(pw) || !cols.facet || !columns.has(cols.facet)) return [];
  const facetField = cols.facet;
  // The pane LIST the grid lays out (repeats included, blanks not), from the figure's own function.
  const paneCount = figurePaneValues(spec, rows, facetField).length;
  const cfgCols = spec.small_multiples?.columns;
  const resolvedCols = cfgCols && cfgCols > 0 ? Math.min(cfgCols, paneCount) : paneCount;
  return pw.length === resolvedCols
    ? []
    : [`small_multiples.pane_widths has ${pw.length} proportions but the grid has ${resolvedCols} column(s) — the array length must equal the column count`];
}

/** Histogram data validation. A histogram breaks the shared x/value contract two ways: a RAW
 * histogram derives each bar's height from the row COUNT (or a summed weight column), so `value`
 * is optional; and a PRE-BINNED histogram carries its own bin edges (columns.x0/x1) and a per-bin
 * `value`, so there is no continuous `x`/`time` column to parse. This branch handles both, leaving
 * the shared non-histogram path untouched. Series/facet columns validate exactly as the normal
 * path does (existence only). */
function validateHistogramData(
  spec: ChartSpec,
  rows: TidyRow[],
  cols: ResolvedColumns,
  columns: Set<string>,
): ValidationResult {
  const errors: string[] = [];

  // series / facet column existence — the only declared columns a histogram reads.
  const requiredRoles: Array<[string, string]> = [];
  if (cols.series) requiredRoles.push(["series", cols.series]);
  if (spec.small_multiples) {
    if (!cols.facet) {
      errors.push(`small_multiples requires a facet column — set columns.facet`);
    } else {
      requiredRoles.push(["facet", cols.facet]);
    }
  }

  if (isPreBinned(cols)) {
    // Pre-binned: x0, x1, value all required; each row must satisfy x1 > x0 (both finite).
    const x0 = cols.x0 as string;
    const x1 = cols.x1 as string;
    requiredRoles.push(["x0", x0], ["x1", x1], ["value", cols.value]);
    errors.push(...missingColumnErrors(requiredRoles, columns));
    if (errors.length) return { valid: false, errors };
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as TidyRow;
      const rowNum = i + 2; // row 1 = header, data starts at 2
      const loRaw = (row[x0] as string) ?? "";
      const hiRaw = (row[x1] as string) ?? "";
      const lo = Number(loRaw);
      const hi = Number(hiRaw);
      if (loRaw.trim() === "" || hiRaw.trim() === "" || !Number.isFinite(lo) || !Number.isFinite(hi)) {
        errors.push(
          `row ${rowNum}: bin edges must be finite numbers, got ${cols.x0}=${JSON.stringify(loRaw)}, ${cols.x1}=${JSON.stringify(hiRaw)}`,
        );
      } else if (!(hi > lo)) {
        errors.push(
          `row ${rowNum}: bin upper edge ${cols.x1}=${JSON.stringify(hiRaw)} must be greater than lower edge ${cols.x0}=${JSON.stringify(loRaw)}`,
        );
      }
      const valRaw = (row[cols.value] as string) ?? "";
      if (!isNumericOrEmpty(valRaw)) errors.push(notNumericError(rowNum, cols.value, valRaw));
    }
    errors.push(...histogramReferenceErrors(spec, rows, cols, columns));
    return { valid: errors.length === 0, errors };
  }

  // Raw (count mode): the x column is required; `value` is NOT (bar height = row count). Only a
  // mapped histogram.weight column is required + numeric-checked.
  requiredRoles.push(["x", cols.x]);
  errors.push(...missingColumnErrors(requiredRoles, columns));
  const weightCol = spec.histogram?.weight;
  if (weightCol && !columns.has(weightCol)) {
    errors.push(
      `config/data mismatch: histogram.weight is "${weightCol}" but no such column exists (columns: ${JSON.stringify([...columns].sort())})`,
    );
  }
  if (errors.length) return { valid: false, errors };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as TidyRow;
    const rowNum = i + 2; // row 1 = header, data starts at 2
    const xErr = timeParseError(spec.xAxisType, (row[cols.x] as string) ?? "");
    if (xErr) errors.push(`row ${rowNum}: ${cols.x}: ${xErr}`);
    if (weightCol) {
      const w = (row[weightCol] as string) ?? "";
      if (!isNumericOrEmpty(w)) errors.push(notNumericError(rowNum, weightCol, w));
    }
  }
  errors.push(...histogramReferenceErrors(spec, rows, cols, columns));
  return { valid: errors.length === 0, errors };
}

/** A histogram's references: the same table as every other chart type, plus pane_widths and the
 *  colours a texture is laid over. Its rows are binned, not drawn one per row, but the series, pane
 *  and scope keys name the same cells. */
function histogramReferenceErrors(spec: ChartSpec, rows: TidyRow[], cols: ResolvedColumns, columns: Set<string>): string[] {
  return [
    ...keyReferenceErrors(spec, refDomains(spec, rows, cols, columns)),
    ...paneWidthsErrors(spec, rows, cols, columns),
    ...textureGroundErrors(spec, rows, cols),
  ];
}

/** A timeline's series keys, through the shared reference table (data-refs.ts). Only the series
 *  domain exists here: every other referencing field is rejected on a timeline by validateSpec. */
function validateTimelineKeys(spec: ChartSpec, rows: TidyRow[]): ValidationResult {
  const cols = timelineColumns(spec, rows);
  const seriesSeen = new Set<string>();
  for (const r of rows) seriesSeen.add(cols.series ? ((r[cols.series] as string) ?? "") : SINGLE_SERIES_KEY);
  const errors = keyReferenceErrors(spec, { series: seriesSeen });
  return { valid: errors.length === 0, errors };
}

/** series_order / series_colors / series_labels keys must name groups present in the data, through
 *  the shared reference table with the groups as the series domain. A flat
 *  treemap has no groups, so any key there is an error: the bar chart's `{"": color}` idiom would
 *  otherwise validate and then be ignored (a flat treemap is always blue). */
function validateTreemapKeys(spec: ChartSpec, rows: TidyRow[]): ValidationResult {
  const cols = treemapColumns(spec, rows);
  if (!cols.group) {
    const keyed: Array<[string, string[]]> = [
      ["series_order", spec.series_order ?? []],
      ["series_colors", Object.keys(spec.series_colors ?? {})],
      ["series_labels", Object.keys(spec.series_labels ?? {})],
    ];
    const errors = keyed.flatMap(([field, keys]) =>
      keys.map((k) => `${field} key ${JSON.stringify(k)} is not allowed: this treemap has no groups (columns.series)`));
    return { valid: errors.length === 0, errors };
  }
  const seriesSeen = new Set<string>();
  for (const r of rows) seriesSeen.add((r[cols.group] as string) ?? "");
  const errors = keyReferenceErrors(spec, { series: seriesSeen });
  return { valid: errors.length === 0, errors };
}

/** Layers 2-3: cross-reference + CSV-format checks over the chart's data rows. Assumes the
 * spec already passed structural validation. */
export function validateChartData(spec: ChartSpec, rows: TidyRow[]): ValidationResult {
  const errors: string[] = [];
  if (!rows.length) {
    return { valid: false, errors: ["data has no rows"] };
  }

  const cols = resolveColumns(spec, rows);
  const columns = new Set(Object.keys(rows[0] as TidyRow));

  // Histogram diverges from the shared x/value contract (optional value in count mode; pre-binned
  // edge columns instead of a continuous x). Handle it separately, leaving the path below intact.
  if (spec.chartType === "histogram") {
    return validateHistogramData(spec, rows, cols, columns);
  }

  // Timeline has no value column and its own row contract (start / end / label). Its errors come
  // from spec/timeline.ts; the key cross-reference below (series_order/series_colors/series_labels
  // vs data) still applies.
  if (spec.chartType === "timeline") {
    const tlErrors = timelineDataErrors(spec, rows);
    if (tlErrors.length) return { valid: false, errors: tlErrors };
    return validateTimelineKeys(spec, rows);
  }

  // Treemap: one row per tile (name / value / optional group); its own row contract.
  if (spec.chartType === "treemap") {
    const tmErrors = treemapDataErrors(spec, rows);
    if (tmErrors.length) return { valid: false, errors: tmErrors };
    return validateTreemapKeys(spec, rows);
  }

  // Required columns resolve from the `columns` role map (defaults x:"time", value:"value",
  // series:"series"). Series is optional (single-series charts); facet is required when faceting.
  const requiredRoles: Array<[string, string]> = [
    ["x", cols.x],
    ["value", cols.value],
  ];
  if (cols.series) requiredRoles.push(["series", cols.series]);
  if (cols.shape) requiredRoles.push(["shape", cols.shape]);
  // The RAW field, not the resolved one: resolveColumns nulls a point_label that merely repeats the
  // series or shape column, and a typo'd column name must still be reported rather than collapsed.
  const rawPointLabel = spec.columns?.point_label;
  if (rawPointLabel) requiredRoles.push(["point_label", rawPointLabel]);
  if (spec.projected_field) requiredRoles.push(["projected_field", spec.projected_field]);
  // Only where the column is read: validateSpec admits `columns.section` on sectionable charts
  // alone, and only a waterfall reads `columns.kind` (elsewhere a missing one changes nothing).
  if (cols.section) requiredRoles.push(["section", cols.section]);
  if (cols.kind && spec.chartType === "waterfall") requiredRoles.push(["kind", cols.kind]);
  if (spec.small_multiples || facetsDrawAsGroups(spec)) {
    if (!cols.facet) {
      errors.push(`small_multiples requires a facet column — set columns.facet`);
    } else {
      requiredRoles.push(["facet", cols.facet]);
    }
  }
  errors.push(...missingColumnErrors(requiredRoles, columns));

  // A `point:` callout must match EXACTLY one row's raw `columns.point_label` cell, across every row
  // (a faceted chart's match lives in one pane; the pane drop happens at render). Zero matches is a
  // typo; several is the case the key exists to prevent — the motivating chart had two rows sharing
  // an exact x AND series ("2025b" / "2025b*"), which a first-match would have silently merged.
  // Matched on the RAW column, like the `point_label` role check above: the resolver nulls a
  // point_label that repeats the series column for the hover header only. Skipped when that column
  // is missing — the role check has already reported it, and every callout would otherwise
  // re-report the same absence as "no match".
  // The one matched row must also carry a numeric value — an empty value cell is legal data (the
  // per-row check below allows it) but gives the callout no y — and must be a row the figure DRAWS:
  // `series_order` and the shape domain are inclusion filters (buildPointMarks draws no dot for a
  // row outside either — the inferred shape domain omits a blank cell, pane.ts), the callout's own
  // `facet:` keeps it out of every pane but that one (where its row is absent), and a blank facet
  // cell or one `small_multiples.pane_order` omits is not a rendered pane (figure.ts). In each case
  // the label would point at an observation that is not drawn — or not be drawn itself — without a
  // word, and the row "supplies x and y" is the documented contract. The rendered-pane rule is the
  // one the overlays[].facet entry of the reference table (data-refs.ts) applies.
  if (rawPointLabel && columns.has(rawPointLabel)) {
    (spec.annotations?.points ?? []).forEach((p, i) => {
      if (p.point == null) return;
      const matched = rows.filter((r) => ((r[rawPointLabel] as string | undefined) ?? "") === p.point);
      const n = matched.length;
      if (n === 0) {
        errors.push(`annotations.points[${i}].point ${JSON.stringify(p.point)} matches no row — no row's ${JSON.stringify(rawPointLabel)} cell equals it (exact match, case- and whitespace-sensitive)`);
      } else if (n > 1) {
        errors.push(`annotations.points[${i}].point ${JSON.stringify(p.point)} matches ${n} rows — a keyed callout must name exactly one; disambiguate the ${JSON.stringify(rawPointLabel)} cells or anchor the callout by x and y`);
      } else {
        const row = matched[0] as TidyRow;
        // Blank exactly as the engine reads it (`valRaw === ""` gives `_y: null`, pane.ts). A
        // whitespace-only or non-numeric cell is already reported once per row below, so only
        // blankness is this callout's own error.
        const valRaw = (row[cols.value] as string | undefined) ?? "";
        if (columns.has(cols.value) && valRaw === "") {
          errors.push(`annotations.points[${i}].point ${JSON.stringify(p.point)} matches a row whose ${JSON.stringify(cols.value)} cell is empty — the callout takes its y from that cell`);
        }
        if (cols.series && columns.has(cols.series) && spec.series_order?.length) {
          const s = (row[cols.series] as string | undefined) ?? "";
          if (!spec.series_order.includes(s)) {
            errors.push(`annotations.points[${i}].point ${JSON.stringify(p.point)} matches a row whose ${JSON.stringify(cols.series)} is ${JSON.stringify(s)}, which series_order excludes — the callout would be drawn nowhere`);
          }
        }
        if (cols.shape && columns.has(cols.shape) && cols.shape !== cols.series) {
          const s = (row[cols.shape] as string | undefined) ?? "";
          const order = spec.shape_order?.length ? spec.shape_order : null;
          if (order ? !order.includes(s) : s === "") {
            errors.push(`annotations.points[${i}].point ${JSON.stringify(p.point)} matches a row whose ${JSON.stringify(cols.shape)} is ${JSON.stringify(s)}, which ${order ? "shape_order excludes" : "is blank and so outside the shape domain"} — that observation is never drawn`);
          }
        }
        if (cols.facet && columns.has(cols.facet) && spec.small_multiples) {
          const rowFacet = (row[cols.facet] as string | undefined) ?? "";
          if (rowFacet === "") {
            errors.push(`annotations.points[${i}].point ${JSON.stringify(p.point)} matches a row whose ${JSON.stringify(cols.facet)} cell is blank — a blank facet is not a pane, so the row is never rendered`);
          } else if (p.facet != null && p.facet !== rowFacet) {
            errors.push(`annotations.points[${i}].facet ${JSON.stringify(p.facet)} disagrees with the matched row's ${JSON.stringify(cols.facet)} ${JSON.stringify(rowFacet)} — a keyed callout renders in its row's pane; drop facet or fix it`);
          }
          const paneOrder = spec.small_multiples.pane_order;
          if (rowFacet !== "" && paneOrder && paneOrder.length && !paneOrder.includes(rowFacet)) {
            errors.push(`annotations.points[${i}].point ${JSON.stringify(p.point)} matches a row in pane ${JSON.stringify(rowFacet)}, which small_multiples.pane_order excludes — that pane is never rendered, so the callout would be drawn nowhere`);
          }
        }
      }
    });
  }

  // CI columns are required only because confidence_bands asks for them.
  const ciCols: string[] = [];
  for (const b of spec.confidence_bands ?? []) {
    for (const col of [b.lower, b.upper]) if (!ciCols.includes(col)) ciCols.push(col);
  }
  for (const col of ciCols) {
    if (!columns.has(col)) {
      errors.push(
        `config/data mismatch: confidence_bands references a "${col}" column the data does not have`,
      );
    }
  }

  // A `column` overlay names a data column, so the data has to have it — the same check the
  // confidence_bands lower/upper columns get. Collected once, because the same list is
  // numeric-checked per row below for the same reason the CI columns are.
  const overlayCols: string[] = [];
  for (const o of spec.overlays ?? []) {
    if (o.column != null && !overlayCols.includes(o.column)) overlayCols.push(o.column);
  }
  for (const col of overlayCols) {
    if (!columns.has(col)) {
      errors.push(
        `config/data mismatch: overlays references a "${col}" column the data does not have`,
      );
    }
  }

  // INVARIANT: every column whose cells the value axis reads gets ONE numeric-or-empty check —
  // `value` above, the CI columns, and a `column` overlay's column. The overlay column is not
  // optional here: engine/pane.ts reads it with unary `+` and skips anything non-finite, so a
  // mistyped cell does not drop a point, it drops the VERTEX and reroutes the line straight from
  // its neighbours — byte-identical to a blank cell and invisible to the author. A genuinely blank
  // cell stays legitimate (isNumericOrEmpty accepts ""): blank means absent, per CONFIG-SPEC.md.
  const numericCols = [...ciCols, ...overlayCols.filter((c) => !ciCols.includes(c))];

  // Bail before row scanning if structural columns are absent — the per-row checks would
  // just repeat the same missing-column failure for every row.
  if (errors.length) return { valid: false, errors };

  // Per-row: x parses under xAxisType; value + numericCols numeric-or-empty.
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as TidyRow;
    const rowNum = i + 2; // row 1 = header, data starts at 2
    const xErr = timeParseError(spec.xAxisType, (row[cols.x] as string) ?? "");
    if (xErr) errors.push(`row ${rowNum}: ${cols.x}: ${xErr}`);
    const valRaw = (row[cols.value] as string) ?? "";
    if (!isNumericOrEmpty(valRaw)) errors.push(notNumericError(rowNum, cols.value, valRaw));
    for (const col of numericCols) {
      const v = row[col] ?? "";
      if (!isNumericOrEmpty(v)) errors.push(notNumericError(rowNum, col, v));
    }
  }

  // Cross-reference: every spec key that names a series, shape value, category, section or pane
  // must appear in the data (data-refs.ts holds the one table every chart type reads).
  const domains = refDomains(spec, rows, cols, columns);
  const seriesSeen = domains.series as Set<string>;
  const knownSeries = JSON.stringify([...seriesSeen].sort());
  errors.push(...keyReferenceErrors(spec, domains));
  errors.push(...paneWidthsErrors(spec, rows, cols, columns));
  // A texture over an unreadable colour that only the data shows will be painted under it.
  errors.push(...textureGroundErrors(spec, rows, cols));

  // `shading` regions: whether a `side` filter can ever match anything. A region naming an unknown
  // series is reported by the table above and has nothing to measure here.
  for (const [i, region] of (spec.shading ?? []).entries()) {
    if (region.series != null && !seriesSeen.has(region.series)) continue;
    const where = `shading[${i}]`;
    // A side filter that can never match is a spec mistake, and it is decidable from the DATA (does
    // this series ever cross the baseline?) without knowing the resolved y-domain.
    const side = region.side ?? "both";
    const baseline = region.baseline ?? 0;
    if (side !== "both") {
      const values = rows
        .filter((r) => region.series == null || r[cols.series ?? ""] === region.series)
        .map((r) => Number(r[cols.value] as string))
        .filter(Number.isFinite);
      const matches = values.some((v) => (side === "positive" ? v > baseline : v < baseline));
      if (values.length && !matches) {
        const scope = region.series == null ? "the data" : `series ${JSON.stringify(region.series)}`;
        const level = baseline === 0 ? `${side} values` : `values ${side === "positive" ? "above" : "below"} ${baseline}`;
        errors.push(
          `${where}.side is "${side}" but no ${level} exist in ${scope} — the region would fill nothing`,
        );
      }
    }
  }

  // A sectioned row is identified by section + category (spec/section-key.ts), so the same label may
  // repeat across sections — but one section + category carries one value per series. A second row
  // would be drawn on top of the first, or merged into it by the hover, unseen. Only the sections
  // section_order keeps: an excluded section's rows are never drawn. A horizontal chart's facets draw
  // as sections (spec/facet-groups.ts), ordered by small_multiples.pane_order, and are named so here.
  const groupsByFacet = facetsDrawAsGroups(spec);
  const groupField = groupsByFacet ? cols.facet : cols.section;
  const groupNoun = groupsByFacet ? "facet" : "section";
  if (groupField && columns.has(groupField) && spec.xAxisType === "categorical") {
    const groupOrder = groupsByFacet ? spec.small_multiples?.pane_order : spec.section_order;
    const seen = new Set<string>();
    const reported = new Set<string>();
    for (const r of rowsInSectionOrder(rows, groupOrder, (r) => r[groupField] as string)) {
      const cat = r[cols.x] as string;
      if (cat == null || cat === "") continue;
      const sec = (r[groupField] as string) ?? "";
      const series = cols.series ? ((r[cols.series] as string) ?? "") : null;
      const id = JSON.stringify([sec, cat, series]);
      if (!seen.has(id)) { seen.add(id); continue; }
      if (reported.has(id)) continue;
      reported.add(id);
      const what = series != null ? `more than one ${JSON.stringify(series)} value` : "more than one value";
      errors.push(
        `category ${JSON.stringify(cat)} in ${groupNoun} ${JSON.stringify(sec)} has ${what} — rows are identified by ${groupNoun} + category, so each ${groupNoun}'s row carries one value per series`,
      );
    }
  }


  // Cross-reference: a `legend: true` overlay must be able to draw SOMETHING. Sibling of the
  // `overlays[].facet` check (data-refs.ts), and for the same reason: `buildAnnotationLegendItems` emits an entry's
  // legend row from the spec alone, while `resolveOverlays` DROPS an entry it cannot compute from
  // the data — a `method` fit with fewer usable points than its degree needs, a `column` with fewer
  // than two finite cells. The two disagreed, so a one-point `lm` with `legend: true` rendered zero
  // paths and a legend row anyway. The row is the half a reader sees. That builder gets no rows, so
  // it cannot implement this; here is the only place that can.
  //
  // INVARIANT — this check is DELIBERATELY GENEROUS, and the direction is the point. It reads the
  // raw table and ignores every filter that NARROWS what is drawn: `domain`, `series_order`,
  // `pane_order`, `facet`, and the requirement that a line span two distinct x. Those can only
  // REMOVE rows, so ignoring them makes this estimate too optimistic — it can miss a phantom row,
  // and can never refuse an entry that draws. Do not "tighten" it by folding any of those in: that
  // is exactly the re-derivation that made the pooled-column consistency guard wrong three times
  // before it was withdrawn (test/overlays-spec.test.ts records the six ways). A missed phantom row
  // is a cosmetic defect the author sees on screen; a false rejection breaks a published figure on
  // the next repin.
  //
  // A COUNT, NEVER A CONTIGUITY TEST — and this is the one place the "those filters only remove
  // rows" argument above does NOT license a tightening. A blank cell BREAKS the polyline
  // (engine/overlays.ts#columnPoints, engine/marks/overlay.ts#runsOf), so `5, blank, 7` resolves to
  // two one-point runs and paints two dots with no segment between them. Requiring two ADJACENT
  // cells in x-sorted order looks like the obvious repair and is unsound: removing a row can DELETE
  // THE BREAK BETWEEN TWO RUNS AND JOIN THEM, so the longest run is not monotone under the filters
  // this check ignores, even though the count is. `series_order: ["A"]` dropping the B row that
  // carried the blank, and a pooled entry on a faceted chart whose blank lives in another pane, both
  // draw a real two-vertex line from a raw table with no two adjacent cells anywhere
  // (test/overlays-render.test.ts, "a contiguity test would refuse a spec that draws"). Scoping the
  // contiguity soundly means re-deriving the pane partition and the series filter — the exact
  // re-derivation the paragraph above forbids. The isolated-dots case stays accepted on purpose: it
  // is the cheaper error, and it is plain on the author's own screen.
  //
  // The row is EARNED BY ANY ONE GROUP: a per-series entry where one series can be fitted and
  // another cannot still gets its single concept row (CONFIG-SPEC.md, `overlays[].legend`), so the
  // threshold test is a MAX over groups, never an "every group" test.
  // `legend: false` ⇒ no legend at all, so no row can be phantom (the label stays in-frame, where it
  // is drawn from the resolved line and vanishes with it). A categorical axis draws no overlay at
  // all and validateSpec already refuses `overlays` there — skipped so a direct validateChartData
  // call cannot add a second, derivative complaint on top of that one.
  if (spec.legend !== false && spec.xAxisType !== "categorical") {
    for (const [i, o] of (spec.overlays ?? []).entries()) {
      if (o.legend !== true || !o.label) continue;
      const kind = overlayKind(o);
      // `fun` and `slope`+`intercept` are constructed from the spec and read no data, so they draw
      // wherever there is a domain — nothing here can starve them.
      if (kind !== "method" && kind !== "column") continue;
      const field = kind === "column" ? (o.column as string) : cols.value;
      if (!field || !columns.has(field)) continue; // absent column: already reported above
      // What `resolveOverlays` needs from ONE group: fitPoly wants degree + 1 finite pairs, and
      // columnPoints wants 2 real points. Both counted over finite cells of the driving column.
      const need = kind === "column" ? 2 : (o.method === "poly" ? (o.degree ?? POLY_DEFAULT_DEGREE) : 1) + 1;
      const perSeries = overlayPerSeries(o);
      const counts = new Map<string, number>();
      for (const r of rows) {
        const raw = (r[field] as string) ?? "";
        if (raw === "" || !Number.isFinite(+raw)) continue;
        const key = perSeries && cols.series ? ((r[cols.series] as string) ?? "") : SINGLE_SERIES_KEY;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const best = Math.max(0, ...counts.values());
      if (best < need) {
        errors.push(
          kind === "column"
            ? `overlays[${i}] has \`legend: true\` with label ${JSON.stringify(o.label)}, but column "${field}" ${perSeries && cols.series ? `has fewer than 2 numeric cells in any one series (most in one series: ${best})` : `has only ${best} numeric cell(s)`} — no line can be drawn, so the legend would key a line that is not on the chart. Remove \`legend: true\`, or give the column values.`
            : `overlays[${i}] has \`legend: true\` with label ${JSON.stringify(o.label)}, but \`method: ${o.method}\` needs ${need} points and "${field}" has at most ${best} numeric cell(s)${perSeries && cols.series ? " in any one series" : ""} — the fit cannot be computed, so the legend would key a line that is not on the chart. Remove \`legend: true\`${o.method === "poly" ? ", or lower `degree`" : ""}, or give the chart more data.`,
        );
      }
    }
  }

  // Waterfall: the kind column (columns.kind) may only hold delta / total / skip / branch (empty ⇒ delta),
  // and a waterfall is single-series (one bar per step — no series channel). The value-axis reads
  // a running cumulative, so faceted waterfalls share ONE category axis: every facet must carry the
  // same steps (use a `skip` row to hold a category slot a facet lacks), mirroring the horizontal
  // bar ragged-facet guard.
  if (spec.chartType === "waterfall") {
    if (cols.kind && columns.has(cols.kind)) {
      const ALLOWED = new Set(["", "delta", "total", "skip", "branch"]);
      const bad = new Set<string>();
      for (const r of rows) {
        const k = ((r[cols.kind] as string) ?? "").trim();
        if (!ALLOWED.has(k)) bad.add(k);
      }
      if (bad.size) {
        errors.push(
          `columns.kind "${cols.kind}" has unknown value(s) ${JSON.stringify([...bad])} — waterfall kinds are "delta", "total", "skip", or "branch" (empty ⇒ delta)`,
        );
      }
    }
    if (cols.series && seriesSeen.size > 1) {
      errors.push(
        `chartType "waterfall" is single-series (one bar per step) but the data has ${seriesSeen.size} series (${knownSeries}) — remove columns.series`,
      );
    }
    if (spec.small_multiples && cols.facet && columns.has(cols.facet)) {
      const facetField = cols.facet;
      const catsByFacet = new Map<string, Set<string>>();
      const allCats = new Set<string>();
      for (const r of rows) {
        const facet = r[facetField] as string;
        const cat = r[cols.x] as string;
        if (!facet || !cat) continue;
        allCats.add(cat);
        if (!catsByFacet.has(facet)) catsByFacet.set(facet, new Set());
        (catsByFacet.get(facet) as Set<string>).add(cat);
      }
      for (const [facet, cats] of catsByFacet) {
        const missing = [...allCats].filter((c) => !cats.has(c));
        if (missing.length) {
          errors.push(
            `facet "${facet}" is missing step(s) ${missing.map((c) => JSON.stringify(c)).join(", ")} present in other facets — faceted waterfalls share one category axis, so every facet must carry the same steps (use a "skip" row to hold a missing step's slot)`,
          );
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Full validation: structural first, then (if rows are supplied and structural passed)
 * the cross-reference + CSV checks. */
export function validateChart(spec: unknown, rows?: TidyRow[]): ValidationResult {
  const structural = validateSpec(spec);
  if (!structural.valid || !rows) return structural;
  return validateChartData(spec as ChartSpec, rows);
}
