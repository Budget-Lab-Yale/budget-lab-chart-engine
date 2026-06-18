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
    return `(root): missing required property "${e.params.missingProperty}"`;
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

  const seriesField = spec.series_field || "series";
  const columns = new Set(Object.keys(rows[0] as TidyRow));

  // Required columns: time + value (the CSV contract) and the series field.
  for (const required of ["time", "value"]) {
    if (!columns.has(required)) errors.push(`data is missing the required "${required}" column`);
  }
  if (!columns.has(seriesField)) {
    errors.push(
      seriesField === "series"
        ? `data is missing the required "series" column`
        : `config/data mismatch: series_field is "${seriesField}" but no such column exists (columns: ${JSON.stringify([...columns].sort())})`,
    );
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

  // Per-row: time parses; value + CI numeric-or-empty. Collect the series set.
  const seriesSeen = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as TidyRow;
    const rowNum = i + 2; // row 1 = header, data starts at 2
    const timeErr = timeParseError(spec.xAxisType, row.time ?? "");
    if (timeErr) errors.push(`row ${rowNum}: time: ${timeErr}`);
    if (!isNumericOrEmpty(row.value ?? "")) {
      errors.push(`row ${rowNum}: value ${JSON.stringify(row.value)} is not numeric`);
    }
    for (const col of ciCols) {
      const v = row[col] ?? "";
      if (!isNumericOrEmpty(v)) errors.push(`row ${rowNum}: ${col} ${JSON.stringify(v)} is not numeric`);
    }
    seriesSeen.add(row[seriesField] as string);
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

  return { valid: errors.length === 0, errors };
}

/** Full validation: structural first, then (if rows are supplied and structural passed)
 * the cross-reference + CSV checks. */
export function validateChart(spec: unknown, rows?: TidyRow[]): ValidationResult {
  const structural = validateSpec(spec);
  if (!structural.valid || !rows) return structural;
  return validateChartData(spec as ChartSpec, rows);
}
