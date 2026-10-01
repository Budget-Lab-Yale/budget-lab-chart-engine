// Timeline spec helpers: config defaults, column roles, end-cell parsing, the derived date-label
// format, and data validation. Pure and DOM-free. Must not import src/engine/* (module-graph rule),
// which is why formatting (d3.timeFormat) and the projected flag (isTruthyFlag) happen in
// engine/marks/timeline.ts, not here.
import type { ChartSpec } from "./types";
import { parseDate } from "./parse-time";

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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_RE = /^\d{4}$/;

/** True when a string already matching DATE_RE or YEAR_RE names a REAL calendar date. `parseDate`
 *  (via `new Date(y, m, d)`) silently ROLLS an out-of-range month/day into the next month/year
 *  (`2026-13-01` becomes 2027-01-01; `2026-02-30` becomes 2026-03-02), so it never throws or
 *  returns an invalid Date for these — the only way to catch it is to round-trip the parsed Date's
 *  fields back against what was asked for. A bare YYYY (YEAR_RE) is always 1 January and always
 *  real, so it short-circuits true without parsing. */
function isRealCalendarDate(s: string): boolean {
  if (YEAR_RE.test(s)) return true;
  const y = +s.slice(0, 4);
  const mo = +s.slice(5, 7);
  const d = +s.slice(8, 10);
  const parsed = parseDate(s);
  return parsed.getFullYear() === y && parsed.getMonth() === mo - 1 && parsed.getDate() === d;
}

export function parseEndCell(raw: string): EndCell {
  const s = raw.trim();
  if (s === "") return { kind: "none" };
  if (s.toLowerCase() === "ongoing") return { kind: "ongoing" };
  if ((DATE_RE.test(s) || YEAR_RE.test(s)) && isRealCalendarDate(s)) return { kind: "date", value: s };
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
    if (!DATE_RE.test(x) && !YEAR_RE.test(x)) {
      errors.push(`row ${n}: columns.x (${JSON.stringify(cols.x)}): expected YYYY-MM-DD or YYYY, got ${JSON.stringify(x)}`);
      return;
    }
    if (!isRealCalendarDate(x)) {
      errors.push(`row ${n}: columns.x (${JSON.stringify(cols.x)}): invalid date ${JSON.stringify(x)}`);
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
