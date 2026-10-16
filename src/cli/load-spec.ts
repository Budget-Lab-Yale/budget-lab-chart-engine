// Shared spec + data loading for the CLI commands and `serve`.
// Order (identical for charts and tables): structural schema validation, then data load, then
// data validation. Errors come back unprefixed; callers add their own context (the CLI prefixes
// each line with the spec path, serve renders them on an error page).

import { validateSpec, validateChartData } from "../spec/validate";
import { validateTableSpec, validateTableData } from "../spec/table-validate";
import { loadData } from "../data/load";
import { isTableSpec } from "./table-detect";
import type { ChartSpec } from "../spec/types";
import type { TableSpec } from "../spec/table-types";
import type { TidyRow } from "../data/index";

export type LoadedSpec =
  | { ok: true; kind: "chart"; spec: ChartSpec; rows: TidyRow[] }
  | { ok: true; kind: "table"; spec: TableSpec; rows: TidyRow[] }
  | { ok: false; errors: string[] };

/** Validate a parsed spec, load its data relative to `baseDir`, and validate the data. */
export async function loadSpecAndRows(spec: unknown, baseDir: string): Promise<LoadedSpec> {
  if (isTableSpec(spec)) {
    const structural = validateTableSpec(spec);
    if (!structural.valid) return { ok: false, errors: structural.errors };

    let rows: TidyRow[];
    try {
      rows = await loadData(spec.data, { baseDir });
    } catch (err) {
      return { ok: false, errors: [`data load failed: ${(err as Error).message}`] };
    }

    const dataResult = validateTableData(spec, rows);
    if (!dataResult.valid) return { ok: false, errors: dataResult.errors };
    return { ok: true, kind: "table", spec: spec as TableSpec, rows };
  }

  const structural = validateSpec(spec);
  if (!structural.valid) return { ok: false, errors: structural.errors };

  const typedSpec = spec as ChartSpec;
  let rows: TidyRow[];
  try {
    rows = await loadData(typedSpec.data, { baseDir });
  } catch (err) {
    return { ok: false, errors: [`data load failed: ${(err as Error).message}`] };
  }

  const dataResult = validateChartData(typedSpec, rows);
  if (!dataResult.valid) return { ok: false, errors: dataResult.errors };
  return { ok: true, kind: "chart", spec: typedSpec, rows };
}
