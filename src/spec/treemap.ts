// Treemap spec helpers: config defaults, column roles, row parsing, data validation and warnings,
// and number formatting. Pure and DOM-free. Must not import src/engine/* (module-graph rule), nor
// d3 (nothing in src/spec does), so the thousands grouping of `formatTreemapValue` is done by hand.
import type { ChartSpec, TreemapTooltipRow, ValueFormat } from "./types";
import type { TidyRow } from "../data/index";
import { resolveColumns } from "./columns";

export interface ResolvedTreemapConfig {
  labelValue: "share" | "value" | "none";
  shading: "size" | "none";
  shareDecimals: number;
  tooltip: TreemapTooltipRow[];
}

export const TREEMAP_TILE_WARN_COUNT = 30;
export const TREEMAP_GROUP_WARN_COUNT = 7;

export function resolveTreemapConfig(spec: ChartSpec): ResolvedTreemapConfig {
  const t = spec.treemap ?? {};
  return {
    labelValue: t.label_value ?? "share",
    shading: t.shading ?? "size",
    shareDecimals: t.share_decimals ?? 1,
    tooltip: t.tooltip ?? [],
  };
}

export interface TreemapColumns {
  name: string;
  value: string;
  group: string | null;
}

/** Name = `columns.x`, size = `columns.value`, group = `columns.series`. As everywhere else, an
 *  unset `columns.series` resolves to a column literally called "series" when `rows` carries one
 *  (and to flat otherwise); without `rows` the group is null unless authored. */
export function treemapColumns(spec: ChartSpec, rows?: ReadonlyArray<Record<string, unknown>>): TreemapColumns {
  const authored = spec.columns?.series;
  const cols = resolveColumns(spec, rows ?? []);
  const group = authored != null && authored !== "" ? authored : rows && rows.length > 0 ? cols.series : null;
  return { name: cols.x, value: cols.value, group };
}

export interface TreemapDatum {
  /** 0-based position in the CSV, among all rows (dropped zero rows still count). */
  index: number;
  name: string;
  group: string | null;
  value: number;
  row: TidyRow;
}

/** Rows to drawable data: drops zero values, keeps CSV order in `index`. Assumes the data already
 *  passed `treemapDataErrors`. */
export function treemapData(spec: ChartSpec, rows: TidyRow[]): TreemapDatum[] {
  const cols = treemapColumns(spec, rows);
  const out: TreemapDatum[] = [];
  rows.forEach((row, index) => {
    const value = Number(row[cols.value]);
    if (value === 0) return;
    out.push({ index, name: String(row[cols.name] ?? ""), group: cols.group ? String(row[cols.group] ?? "") : null, value, row });
  });
  return out;
}

/** A cell parses as a size only if it is non-blank and a finite number >= 0. */
function parseSize(raw: unknown): number | null {
  const s = String(raw ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Data errors for a treemap, each naming its 1-based data row. Column existence is reported in
 *  the same words as the shared chart path. */
export function treemapDataErrors(spec: ChartSpec, rows: TidyRow[]): string[] {
  const errors: string[] = [];
  if (!rows.length) return ["data has no rows"];
  const cols = treemapColumns(spec, rows);
  const present = new Set(Object.keys(rows[0] as object));
  const roles: Array<[string, string | null]> = [["x", cols.name], ["value", cols.value], ["series", cols.group]];
  for (const [role, col] of roles) {
    if (col != null && !present.has(col)) {
      errors.push(
        `config/data mismatch: columns.${role} is "${col}" but no such column exists (columns: ${JSON.stringify([...present].sort())})`,
      );
    }
  }
  (spec.treemap?.tooltip ?? []).forEach((t, i) => {
    if (!present.has(t.column)) errors.push(`treemap.tooltip[${i}].column ${JSON.stringify(t.column)} is not a column in the data`);
  });
  if (errors.length) return errors;

  const firstRow = new Map<string, number>();
  rows.forEach((r, i) => {
    const n = i + 1;
    const name = String(r[cols.name] ?? "");
    if (name.trim() === "") errors.push(`row ${n}: columns.x (${JSON.stringify(cols.name)}) is blank`);
    const raw = r[cols.value];
    if (parseSize(raw) === null) {
      errors.push(`row ${n}: columns.value (${JSON.stringify(cols.value)}) must be a number ≥ 0, got ${JSON.stringify(String(raw ?? ""))}`);
    }
    if (name.trim() === "") return;
    const group = cols.group ? String(r[cols.group] ?? "") : null;
    const key = JSON.stringify([group, name]);
    const seen = firstRow.get(key);
    if (seen === undefined) {
      firstRow.set(key, n);
    } else if (group === null) {
      errors.push(`row ${n}: duplicate tile ${JSON.stringify(name)} (also row ${seen})`);
    } else {
      errors.push(`row ${n}: duplicate tile ${JSON.stringify(name)} in group ${JSON.stringify(group)} (also row ${seen})`);
    }
  });
  return errors;
}

/** Non-fatal findings: zero rows that will not draw, too many tiles, too many groups left to the
 *  default hues. Assumes `treemapDataErrors` is empty. */
export function treemapDataWarnings(spec: ChartSpec, rows: TidyRow[]): string[] {
  const warnings: string[] = [];
  const cols = treemapColumns(spec, rows);
  const zeros: string[] = [];
  rows.forEach((r, i) => {
    if (parseSize(r[cols.value]) === 0) zeros.push(`${i + 1} (${JSON.stringify(String(r[cols.name] ?? ""))})`);
  });
  if (zeros.length) {
    warnings.push(`treemap: ${zeros.length} zero-value row${zeros.length === 1 ? "" : "s"} not drawn: row ${zeros.join(", row ")}`);
  }
  const drawn = treemapData(spec, rows);
  if (drawn.length > TREEMAP_TILE_WARN_COUNT) {
    warnings.push(`treemap: ${drawn.length} tiles; consider grouping small categories into "Other"`);
  }
  const groups = new Set(drawn.map((d) => d.group).filter((g): g is string => g !== null));
  if (groups.size > TREEMAP_GROUP_WARN_COUNT && !spec.series_colors) {
    warnings.push(`treemap: ${groups.size} groups and no series_colors; hues repeat past ${TREEMAP_GROUP_WARN_COUNT}, set series_colors`);
  }
  return warnings;
}

/** `prefix + <v with thousands grouping, decimals places> + suffix`. Decimals default 0 (unlike
 *  `value_format` elsewhere, which defaults to 2 and prints no separators). */
export function formatTreemapValue(v: number, fmt: ValueFormat | undefined): string {
  const fixed = Math.abs(v).toFixed(fmt?.decimals ?? 0);
  const [int, frac] = fixed.split(".");
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${fmt?.prefix ?? ""}${v < 0 ? "-" : ""}${grouped}${frac !== undefined ? "." + frac : ""}${fmt?.suffix ?? ""}`;
}

/** A 0-1 share as a percentage: 0.334 -> "33.4%". */
export function formatTreemapShare(share: number, decimals: number): string {
  return `${(share * 100).toFixed(decimals)}%`;
}
