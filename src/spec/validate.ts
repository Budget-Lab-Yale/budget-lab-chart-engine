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
import { resolveColumns } from "./columns";
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

/** Layer 1: structural validation against the JSON schema. */
export function validateSpec(spec: unknown): ValidationResult {
  const ok = validateStructural(spec);
  if (ok) return { valid: true, errors: [] };
  const errors = (validateStructural.errors ?? []).map(formatAjvError);
  return { valid: false, errors };
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

/** Layers 2-3: cross-reference + CSV-format checks over the chart's data rows. Assumes the
 * spec already passed structural validation. */
export function validateChartData(spec: ChartSpec, rows: TidyRow[]): ValidationResult {
  const errors: string[] = [];
  if (!rows.length) {
    return { valid: false, errors: ["data has no rows"] };
  }

  const cols = resolveColumns(spec, rows);
  const columns = new Set(Object.keys(rows[0] as TidyRow));

  // Required columns resolve from the `columns` role map (defaults x:"time", value:"value",
  // series:"series"). Series is optional (single-series charts); facet is required when faceting.
  const requiredRoles: Array<[string, string]> = [
    ["x", cols.x],
    ["value", cols.value],
  ];
  if (cols.series) requiredRoles.push(["series", cols.series]);
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

  // Per-row: x parses under xAxisType; value + CI numeric-or-empty. Collect the series set.
  const seriesSeen = new Set<string>();
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
  for (const b of spec.confidence_bands ?? []) {
    if (!seriesSeen.has(b.series)) {
      errors.push(
        `confidence_bands names series ${JSON.stringify(b.series)} not found in the data (data series: ${knownSeries})`,
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
