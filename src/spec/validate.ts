// ChartSpec validation, ported + reduced from build-manifest.py's three layers to the
// one-chart model:
//   1. Structural  — the ajv JSON schema (schema.ts), additionalProperties:false, so typos
//                     (`xAxisTpye`), bad enums, wrong types, and missing required fields fail.
//   2. Cross-ref   — every series named by series_order / series_colors / series_styles /
//                     series_labels / confidence_bands.series must appear in the data.
//   3. CSV format  — required columns exist; each row's `time` parses under the declared
//                     xAxisType; `value` and CI columns are numeric or empty.
// Layers 2-3 need the data, so they live in validateChartData(spec, rows). Each failure is a
// pointed, fix-oriented message (matching the tracker's build-failure style).
import Ajv from "ajv";
import type { ErrorObject } from "ajv";
import { CHART_SPEC_SCHEMA } from "./schema";
import type { ChartSpec, XAxisType } from "./types";
import { resolveColumns, isPreBinned, categoryOrderFor } from "./columns";
import { resolveAnnotations } from "./annotations";
import { resolveRugTracks } from "./rug";
import type { ResolvedColumns } from "./columns";
import type { TidyRow } from "../data/index";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const ajv = new Ajv({ allErrors: true });
const validateStructural = ajv.compile(CHART_SPEC_SCHEMA);

function formatAjvError(e: ErrorObject): string {
  const path = e.instancePath || "(root)";
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

/** Dumbbell cross-field constraint: like bars, the categorical axis is declared via
 *  `xAxisType: categorical` (NOT a separate yAxisType); `orientation` then flips it to screen-y
 *  (horizontal, default) or screen-x (vertical). A non-categorical xAxisType has no meaning. */
function dumbbellAxisError(spec: { chartType?: unknown; xAxisType?: unknown }): string | null {
  if (spec.chartType === "dumbbell" && spec.xAxisType !== "categorical") {
    return `chartType "dumbbell" requires xAxisType "categorical" (got ${JSON.stringify(spec.xAxisType)})`;
  }
  return null;
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


/** `columns.section` (section-header horizontal-bar grouping) only has an effect on a horizontal
 *  `bar` chart (see bar.ts's `sectioned` gate) — it silently no-ops on every other chartType/
 *  orientation combination, which looks like a config bug (the field appears to do nothing) but
 *  is actually just dead configuration. Reject it early with a pointed message instead. */
function sectionColumnError(spec: {
  chartType?: unknown;
  orientation?: unknown;
  columns?: { section?: unknown };
}): string | null {
  if (spec.columns?.section == null) return null;
  const sectionable = spec.chartType === "bar" || spec.chartType === "dumbbell";
  if (!sectionable || spec.orientation !== "horizontal") {
    return (
      `columns.section requires a horizontal "bar" or "dumbbell" chart ` +
      `(got chartType ${JSON.stringify(spec.chartType)}, orientation ${JSON.stringify(spec.orientation)})`
    );
  }
  return null;
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

/** Histogram cross-field constraints the JSON schema can't express: the x-axis must be
 *  numeric or temporal (a histogram bins a continuous axis); pre-binned mode (columns.x0 +
 *  columns.x1 both mapped) requires BOTH edges, not just one; and bin config (bins/binWidth/
 *  domain/weight) is meaningless — and therefore rejected — once the data already carries its
 *  own bin edges. */
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
  return errors;
}

/** `shading` fills between a line and its baseline, so it only means anything on a line chart:
 *  `area` already fills to the axis, and the rest have no line to fill under. */
function shadingSpecError(spec: { chartType?: unknown; shading?: unknown[] }): string | null {
  if (!spec.shading?.length) return null;
  return spec.chartType === "line"
    ? null
    : `shading is supported on chartType "line" only (got ${JSON.stringify(spec.chartType)})`;
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
  const allIntervals: Array<{ where: string; from?: string; to?: string }> = [
    ...bands.map((b, i) => ({ where: `annotations.bands[${i}]`, from: b.start, to: b.end, e: b })),
    ...shading.map((s, i) => ({ where: `shading[${i}]`, from: s.from, to: s.to, e: s })),
  ]
    .filter(({ e }) => e.rug === true)
    .concat(
      tracks.flatMap((t, ti) =>
        (t.intervals ?? []).map((iv, ii) => ({
          where: `rug.tracks[${ti}].intervals[${ii}]`,
          from: iv.from,
          to: iv.to,
          e: {} as LegendFlagged,
        })),
      ),
    );
  if (xAxisType && xAxisType !== "categorical") {
    for (const iv of allIntervals) {
      if (iv.from == null || iv.to == null) continue;
      const fromErr = timeParseError(xAxisType, iv.from);
      const toErr = timeParseError(xAxisType, iv.to);
      if (fromErr) errors.push(`${iv.where}: rug bound \`from\`: ${fromErr}`);
      if (toErr) errors.push(`${iv.where}: rug bound \`to\`: ${toErr}`);
      if (!fromErr && !toErr && rugBoundOrder(xAxisType, iv.from) > rugBoundOrder(xAxisType, iv.to)) {
        errors.push(`${iv.where}: rug interval runs backwards (${iv.from} → ${iv.to})`);
      }
    }
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

/** Sortable position of a rug bound. Only meaningful for bounds that already parsed. */
function rugBoundOrder(xAxisType: XAxisType, value: string): number {
  if (xAxisType === "numeric") return Number(value);
  if (xAxisType === "temporal") return +new Date(value);
  return Number(value.slice(0, 4)) * 4 + Number(value[5]); // quarterly: YYYYQ#
}

/** Layer 1: structural validation against the JSON schema, plus the point-chart axis-type
 *  constraint (a cross-field rule outside the schema). */
export function validateSpec(spec: unknown): ValidationResult {
  const ok = validateStructural(spec);
  if (!ok) {
    const errors = (validateStructural.errors ?? []).map(formatAjvError);
    return { valid: false, errors };
  }
  const axisErr = pointChartAxisError(spec as { chartType?: unknown; xAxisType?: unknown });
  if (axisErr) return { valid: false, errors: [axisErr] };
  const dbErr = dumbbellAxisError(spec as { chartType?: unknown; xAxisType?: unknown });
  if (dbErr) return { valid: false, errors: [dbErr] };
  const tsErr = titleSelectorsError(spec as { title?: unknown; title_selectors?: Record<string, { options?: Array<{ id?: string }>; default?: string }> });
  if (tsErr) return { valid: false, errors: [tsErr] };
  const secErr = sectionColumnError(
    spec as { chartType?: unknown; orientation?: unknown; columns?: { section?: unknown } },
  );
  if (secErr) return { valid: false, errors: [secErr] };
  const ticksErr = xAxisTicksOrientationError(
    spec as { x_axis_ticks?: unknown; chartType?: unknown; orientation?: unknown },
  );
  if (ticksErr) return { valid: false, errors: [ticksErr] };
  const wfErr = waterfallSpecError(
    spec as { chartType?: unknown; orientation?: unknown; xAxisType?: unknown },
  );
  if (wfErr) return { valid: false, errors: [wfErr] };
  const histErrors = histogramSpecError(
    spec as {
      chartType?: unknown;
      xAxisType?: unknown;
      columns?: { x0?: unknown; x1?: unknown };
      histogram?: { bins?: unknown; binWidth?: unknown; domain?: unknown; weight?: unknown };
    },
  );
  if (histErrors.length) return { valid: false, errors: histErrors };
  const shadeErr = shadingSpecError(spec as { chartType?: unknown; shading?: unknown[] });
  if (shadeErr) return { valid: false, errors: [shadeErr] };
  const rugErrors = legendAndRugErrors(spec as ChartSpec);
  if (rugErrors.length) return { valid: false, errors: rugErrors };
  return { valid: true, errors: [] };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const QUARTER_RE = /^\d{4}Q[1-4]$/;

/** Returns an error string if `value` doesn't parse under `xAxisType`, else null. */
function timeParseError(xAxisType: XAxisType, value: string): string | null {
  if (xAxisType === "numeric") {
    return value.trim() !== "" && Number.isFinite(Number(value))
      ? null
      : `expected a number, got ${JSON.stringify(value)}`;
  }
  if (xAxisType === "temporal") {
    if (!DATE_RE.test(value)) return `expected YYYY-MM-DD, got ${JSON.stringify(value)}`;
    return Number.isNaN(+new Date(value)) ? `invalid date ${JSON.stringify(value)}` : null;
  }
  if (xAxisType === "quarterly") {
    return QUARTER_RE.test(value) ? null : `expected YYYYQ#, got ${JSON.stringify(value)}`;
  }
  if (xAxisType === "categorical") {
    // Any non-empty string is a valid category label.
    return value.trim() !== "" ? null : `expected a non-empty category label, got ${JSON.stringify(value)}`;
  }
  return `unknown xAxisType ${JSON.stringify(xAxisType)}`;
}

const isNumericOrEmpty = (v: string): boolean => v === "" || Number.isFinite(Number(v));

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

  // series / facet column existence — mirrors the shared path.
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
    for (const [role, col] of requiredRoles) {
      if (!columns.has(col)) {
        errors.push(
          `config/data mismatch: columns.${role} is "${col}" but no such column exists (columns: ${JSON.stringify([...columns].sort())})`,
        );
      }
    }
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
      if (!isNumericOrEmpty(valRaw)) {
        errors.push(`row ${rowNum}: ${cols.value} ${JSON.stringify(valRaw)} is not numeric`);
      }
    }
    return { valid: errors.length === 0, errors };
  }

  // Raw (count mode): the x column is required; `value` is NOT (bar height = row count). Only a
  // mapped histogram.weight column is required + numeric-checked.
  requiredRoles.push(["x", cols.x]);
  for (const [role, col] of requiredRoles) {
    if (!columns.has(col)) {
      errors.push(
        `config/data mismatch: columns.${role} is "${col}" but no such column exists (columns: ${JSON.stringify([...columns].sort())})`,
      );
    }
  }
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
      if (!isNumericOrEmpty(w)) errors.push(`row ${rowNum}: ${weightCol} ${JSON.stringify(w)} is not numeric`);
    }
  }
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

  // Required columns resolve from the `columns` role map (defaults x:"time", value:"value",
  // series:"series"). Series is optional (single-series charts); facet is required when faceting.
  const requiredRoles: Array<[string, string]> = [
    ["x", cols.x],
    ["value", cols.value],
  ];
  if (cols.series) requiredRoles.push(["series", cols.series]);
  if (cols.shape) requiredRoles.push(["shape", cols.shape]);
  if (spec.projected_field) requiredRoles.push(["projected_field", spec.projected_field]);
  if (spec.small_multiples) {
    if (!cols.facet) {
      errors.push(`small_multiples requires a facet column — set columns.facet`);
    } else {
      requiredRoles.push(["facet", cols.facet]);
    }
  }
  for (const [role, col] of requiredRoles) {
    if (!columns.has(col)) {
      errors.push(
        `config/data mismatch: columns.${role} is "${col}" but no such column exists (columns: ${JSON.stringify([...columns].sort())})`,
      );
    }
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

  // Bail before row scanning if structural columns are absent — the per-row checks would
  // just repeat the same missing-column failure for every row.
  if (errors.length) return { valid: false, errors };

  // Per-row: x parses under xAxisType; value + CI numeric-or-empty. Collect the series + shape sets.
  const seriesSeen = new Set<string>();
  const shapeSeen = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as TidyRow;
    const rowNum = i + 2; // row 1 = header, data starts at 2
    const xErr = timeParseError(spec.xAxisType, (row[cols.x] as string) ?? "");
    if (xErr) errors.push(`row ${rowNum}: ${cols.x}: ${xErr}`);
    const valRaw = (row[cols.value] as string) ?? "";
    if (!isNumericOrEmpty(valRaw)) {
      errors.push(`row ${rowNum}: ${cols.value} ${JSON.stringify(valRaw)} is not numeric`);
    }
    for (const col of ciCols) {
      const v = row[col] ?? "";
      if (!isNumericOrEmpty(v)) errors.push(`row ${rowNum}: ${col} ${JSON.stringify(v)} is not numeric`);
    }
    if (cols.series) seriesSeen.add(row[cols.series] as string);
    if (cols.shape) shapeSeen.add(row[cols.shape] as string);
  }

  // Cross-reference: every config-named series must appear in the data.
  const knownSeries = JSON.stringify([...seriesSeen].sort());
  const checkSeries = (named: string[] | Record<string, unknown> | undefined, source: string): void => {
    if (!named) return;
    const keys = Array.isArray(named) ? named : Object.keys(named);
    const unknown = keys.filter((k) => !seriesSeen.has(k));
    if (unknown.length) {
      errors.push(
        `${source} names series ${JSON.stringify(unknown)} not found in the data (data series: ${knownSeries})`,
      );
    }
  };
  checkSeries(spec.series_order, "series_order");
  checkSeries(spec.series_colors, "series_colors");
  checkSeries(spec.series_styles, "series_styles");
  checkSeries(spec.series_labels, "series_labels");

  // Cross-reference: every config-named shape value must appear in the shape column's data.
  if (cols.shape) {
    const knownShapes = JSON.stringify([...shapeSeen].sort());
    const checkShapes = (named: string[] | Record<string, unknown> | undefined, source: string): void => {
      if (!named) return;
      const keys = Array.isArray(named) ? named : Object.keys(named);
      const unknown = keys.filter((k) => !shapeSeen.has(k));
      if (unknown.length) {
        errors.push(
          `${source} names shape values ${JSON.stringify(unknown)} not found in the data (data shapes: ${knownShapes})`,
        );
      }
    };
    checkShapes(spec.shape_order, "shape_order");
    checkShapes(spec.shape_labels, "shape_labels");
  }
  for (const b of spec.confidence_bands ?? []) {
    if (!seriesSeen.has(b.series)) {
      errors.push(
        `confidence_bands names series ${JSON.stringify(b.series)} not found in the data (data series: ${knownSeries})`,
      );
    }
  }

  // Cross-reference: `shading` regions against the data — the series they name, the categories
  // their bounds name, and whether a `side` filter can ever match anything.
  for (const [i, region] of (spec.shading ?? []).entries()) {
    const where = `shading[${i}]`;
    if (region.series != null && !seriesSeen.has(region.series)) {
      errors.push(
        `${where} names series ${JSON.stringify(region.series)} not found in the data (data series: ${knownSeries})`,
      );
      continue;
    }
    if (spec.xAxisType === "categorical") {
      const xValues = new Set(rows.map((r) => r[cols.x] as string));
      for (const [key, bound] of [["from", region.from], ["to", region.to]] as const) {
        if (bound != null && !xValues.has(bound)) {
          errors.push(
            `${where}.${key} names category ${JSON.stringify(bound)} not found in x column "${cols.x}" (data values: ${JSON.stringify([...xValues].sort())})`,
          );
        }
      }
    }
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

  // Cross-reference: every category named by x_order must appear in the categorical x column.
  // x_order is order-only (it never filters), so a value the data lacks is almost certainly a
  // typo. Only checked on a categorical x-axis (it is a no-op for numeric/temporal x).
  const catOrder = categoryOrderFor(spec);
  if (spec.xAxisType === "categorical" && catOrder?.length) {
    const xValues = new Set(rows.map((r) => r[cols.x] as string));
    const unknown = catOrder.filter((v) => !xValues.has(v));
    if (unknown.length) {
      const field = spec.category_order ? "category_order" : "x_order";
      errors.push(
        `${field} names categories ${JSON.stringify(unknown)} not found in x column "${cols.x}" (data values: ${JSON.stringify([...xValues].sort())})`,
      );
    }
  }

  // Cross-reference: every category named by category_colors must appear in the categorical x
  // column — mirrors the x_order unknown-value check above (a typo'd key would otherwise silently
  // no-op). category_colors is single-series scope at render time, but its KEYS are x-category
  // values regardless of series count, so the same check applies. Only checked on a categorical
  // x-axis (a no-op for numeric/temporal x).
  if (spec.xAxisType === "categorical" && spec.category_colors) {
    const xValues = new Set(rows.map((r) => r[cols.x] as string));
    const unknown = Object.keys(spec.category_colors).filter((v) => !xValues.has(v));
    if (unknown.length) {
      errors.push(
        `category_colors names categories ${JSON.stringify(unknown)} not found in x column "${cols.x}" (data values: ${JSON.stringify([...xValues].sort())})`,
      );
    }
  }

  // Cross-reference: small_multiples pane_order / pane_titles keys must correspond to actual
  // distinct values in the facet column. (The facet column's existence is already enforced above
  // via the resolved-columns check, which bails before this point if it's missing.)
  if (spec.small_multiples && cols.facet && columns.has(cols.facet)) {
    const facetField = cols.facet;
    const { pane_order, pane_titles } = spec.small_multiples;
    const facetValues = new Set(rows.map((r) => r[facetField] as string));
    const knownFacets = JSON.stringify([...facetValues].sort());
    if (pane_order) {
      const unknown = pane_order.filter((v) => !facetValues.has(v));
      if (unknown.length) {
        errors.push(
          `small_multiples.pane_order names panes ${JSON.stringify(unknown)} not found in facet column "${facetField}" (data values: ${knownFacets})`,
        );
      }
    }
    if (pane_titles) {
      const unknown = Object.keys(pane_titles).filter((v) => !facetValues.has(v));
      if (unknown.length) {
        errors.push(
          `small_multiples.pane_titles names panes ${JSON.stringify(unknown)} not found in facet column "${facetField}" (data values: ${knownFacets})`,
        );
      }
    }
    // pane_widths proportion array: length must match the resolved grid column count. Columns =
    // the explicit config, else a single row (all panes) when pane_widths is set, else the default.
    const pw = spec.small_multiples.pane_widths;
    if (Array.isArray(pw)) {
      const paneCount = pane_order && pane_order.length
        ? pane_order.filter((v) => facetValues.has(v)).length
        : facetValues.size;
      const cfgCols = spec.small_multiples.columns;
      const resolvedCols =
        cfgCols && cfgCols > 0 ? Math.min(cfgCols, paneCount) : paneCount; // pane_widths ⇒ single row default
      if (pw.length !== resolvedCols) {
        errors.push(
          `small_multiples.pane_widths has ${pw.length} proportions but the grid has ${resolvedCols} column(s) — the array length must equal the column count`,
        );
      }
    }

    // Ragged-facet guard (both shared and per-pane mode): faceted HORIZONTAL bars lay every
    // facet out as its own pane but assume ONE shared category axis (renderFigure suppresses the
    // category labels/section headers on every pane but the first — see figure.ts). Each pane's
    // band domain is otherwise computed independently from ITS OWN rows (buildBarMarks), so a
    // facet missing a category (or a whole section) would silently shrink that pane's domain and
    // misalign its rows against the others with no visual cue. Fail loudly instead — pointed at
    // the facet + category (+ section, when sectioned) that's missing.
    // Exception: columns:1 puts each pane on its OWN row with its own full-width gutter + labels,
    // so panes never share a category axis and disjoint categories per facet are legitimate.
    const oneFacetPerRow = spec.small_multiples.columns === 1;
    if (!oneFacetPerRow && (spec.chartType === "bar" || spec.chartType === "stacked") && spec.orientation === "horizontal" && spec.xAxisType === "categorical" && cols.x) {
      const xField = cols.x;
      const catsByFacet = new Map<string, Set<string>>();
      const allCats = new Set<string>();
      for (const r of rows) {
        const facet = r[facetField] as string;
        const cat = r[xField] as string;
        if (!facet || !cat) continue;
        allCats.add(cat);
        if (!catsByFacet.has(facet)) catsByFacet.set(facet, new Set());
        (catsByFacet.get(facet) as Set<string>).add(cat);
      }
      const sectionOf = cols.section
        ? (() => {
            const secField = cols.section as string;
            const m = new Map<string, string>();
            for (const r of rows) {
              const cat = r[xField] as string;
              const sec = r[secField] as string;
              if (cat && sec != null && sec !== "" && !m.has(cat)) m.set(cat, sec);
            }
            return m;
          })()
        : null;
      for (const [facet, cats] of catsByFacet) {
        const missing = [...allCats].filter((c) => !cats.has(c));
        if (missing.length) {
          const named = sectionOf
            ? missing.map((c) => `${JSON.stringify(c)} (section ${JSON.stringify(sectionOf.get(c) ?? "?")})`)
            : missing.map((c) => JSON.stringify(c));
          errors.push(
            `facet "${facet}" is missing categor${missing.length === 1 ? "y" : "ies"} ${named.join(", ")} present in other facets — faceted horizontal bars/stacks share one category axis across panes, so every facet must carry the same categories (and sections); otherwise rows silently misalign across panes`,
          );
        }
      }
    }
  }

  // Waterfall: the kind column (columns.kind) may only hold delta / total / skip (empty ⇒ delta),
  // and a waterfall is single-series (one bar per step — no series channel). The value-axis reads
  // a running cumulative, so faceted waterfalls share ONE category axis: every facet must carry the
  // same steps (use a `skip` row to hold a category slot a facet lacks), mirroring the horizontal
  // bar ragged-facet guard.
  if (spec.chartType === "waterfall") {
    if (cols.kind && columns.has(cols.kind)) {
      const ALLOWED = new Set(["", "delta", "total", "skip"]);
      const bad = new Set<string>();
      for (const r of rows) {
        const k = ((r[cols.kind] as string) ?? "").trim();
        if (!ALLOWED.has(k)) bad.add(k);
      }
      if (bad.size) {
        errors.push(
          `columns.kind "${cols.kind}" has unknown value(s) ${JSON.stringify([...bad])} — waterfall kinds are "delta", "total", or "skip" (empty ⇒ delta)`,
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
