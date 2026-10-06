// Timeline spec helpers: config defaults, column roles, end-cell parsing, the derived date-label
// format, and data validation. Pure and DOM-free. Must not import src/engine/* (module-graph rule),
// which is why formatting (d3.timeFormat) and the projected flag (isTruthyFlag) happen in
// engine/marks/timeline.ts, not here.
import type { ChartSpec } from "./types";
import { parseDate, temporalValueError } from "./parse-time";

export interface ResolvedTimelineConfig {
  spacing: "proportional" | "even";
  lanes: boolean;
  axis: boolean;
  /** Authored `date_format`, or null to derive from the data (deriveDateFormat). */
  dateFormat: string | null;
  labelWidth: number;
  maxRows: number;
  autoVertical: boolean;
  verticalLanes: "columns" | "single";
}

export const TIMELINE_EVENT_WARN_COUNT = 20;

export function resolveTimelineConfig(spec: ChartSpec): ResolvedTimelineConfig {
  const t = spec.timeline ?? {};
  return {
    spacing: t.spacing ?? "proportional",
    lanes: t.lanes ?? false,
    axis: t.axis ?? false,
    dateFormat: t.date_format ?? null,
    labelWidth: t.label_width ?? 150,
    maxRows: t.max_rows ?? 2,
    autoVertical: t.auto_vertical ?? true,
    verticalLanes: t.vertical_lanes ?? "columns",
  };
}

export type EndCell =
  | { kind: "none" }
  | { kind: "ongoing" }
  | { kind: "date"; value: string }
  | { kind: "invalid"; raw: string };

export function parseEndCell(raw: string): EndCell {
  const s = raw.trim();
  if (s === "") return { kind: "none" };
  if (s.toLowerCase() === "ongoing") return { kind: "ongoing" };
  // The one date grammar (spec/parse-time.ts), so a cell kept as a date always parses.
  if (temporalValueError(s) === null) return { kind: "date", value: s };
  return { kind: "invalid", raw: s };
}

/** One granularity per chart, chosen from the DATA (as tooltip_x_format's annual default is):
 *  all 1 January → year; all 1st-of-month → month and year; else the full date. */
export function deriveDateFormat(dates: Date[]): string {
  if (dates.every((d) => d.getMonth() === 0 && d.getDate() === 1)) return "%Y";
  if (dates.every((d) => d.getDate() === 1)) return "%b %Y";
  return "%b %-d, %Y";
}

export interface TimelineColumns {
  x: string;
  end: string | null;
  label: string;
  description: string | null;
  date_label: string | null;
  series: string | null;
}

const nonBlank = (v: string | undefined): string | null => (v != null && v !== "" ? v : null);

export function timelineColumns(
  spec: ChartSpec,
  rows?: ReadonlyArray<Record<string, unknown>>,
): TimelineColumns {
  const c = spec.columns ?? {};
  let series: string | null;
  if (nonBlank(c.series)) series = c.series as string;
  else if (rows && rows.length > 0) series = "series" in (rows[0] as object) ? "series" : null;
  else series = null;
  return {
    x: c.x ?? "time",
    end: nonBlank(c.end),
    label: c.label ?? "label",
    description: nonBlank(c.description),
    date_label: nonBlank(c.date_label),
    series,
  };
}

/** Data errors for a timeline, each naming its 1-based data row. Column existence is reported in
 *  the same words as the shared chart path so authors see one vocabulary. */
export function timelineDataErrors(
  spec: ChartSpec,
  rows: ReadonlyArray<Record<string, unknown>>,
): string[] {
  const errors: string[] = [];
  if (!rows.length) return ["data has no rows"];
  const cols = timelineColumns(spec, rows);
  const present = new Set(Object.keys(rows[0] as object));
  const roles: Array<[string, string | null]> = [
    ["x", cols.x], ["end", cols.end], ["label", cols.label], ["description", cols.description],
    ["date_label", cols.date_label], ["series", cols.series],
  ];
  if (spec.projected_field) roles.push(["projected_field", spec.projected_field]);
  for (const [role, col] of roles) {
    if (col != null && !present.has(col)) {
      errors.push(
        `config/data mismatch: columns.${role} is "${col}" but no such column exists (columns: ${JSON.stringify([...present].sort())})`,
      );
    }
  }
  if (errors.length) return errors;

  rows.forEach((r, i) => {
    const n = i + 1;
    const x = String(r[cols.x] ?? "").trim();
    const xErr = temporalValueError(x);
    if (xErr) {
      errors.push(`row ${n}: columns.x (${JSON.stringify(cols.x)}): ${xErr}`);
      return;
    }
    const label = String(r[cols.label] ?? "");
    if (label.trim() === "") errors.push(`row ${n}: columns.label (${JSON.stringify(cols.label)}) is blank`);
    if (cols.end) {
      const end = parseEndCell(String(r[cols.end] ?? ""));
      if (end.kind === "invalid") {
        errors.push(`row ${n}: columns.end (${JSON.stringify(cols.end)}) is ${JSON.stringify(end.raw)}; expected blank, a date, or "ongoing"`);
      } else if (end.kind === "date" && +parseDate(end.value) < +parseDate(x)) {
        errors.push(`row ${n}: end ${end.value} is before start ${x}`);
      }
    }
  });
  return errors;
}
