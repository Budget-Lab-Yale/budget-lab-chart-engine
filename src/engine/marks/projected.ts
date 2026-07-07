// Splits per-series rows into maximal "actual" vs "projected" runs, keyed by `_projected`
// (set by renderPane from spec.projected_field — task 12). This generalizes the line builder's
// existing WHOLE-SERIES dashed/solid split (line.ts's dashedNames/dashedData/solidData, which
// keys on series name) to a split WITHIN a series driven by a per-row flag.
import type { PreparedRow } from "./index";

/** A PreparedRow tagged with its run id. Rows sharing `_seg` render as one Plot <path> (the z
 *  channel) — every run (actual or projected) gets its own path so runs never bridge each other. */
export type SegmentedRow = PreparedRow & { _seg: string };

export interface ProjectedSplit {
  /** Rows belonging to actual (non-projected) runs, tagged with `_seg`. Never extended — an
   *  actual run ends exactly where the data says it does; only the projected side needs the
   *  shared boundary point (see `projected` below). */
  actual: SegmentedRow[];
  /** Rows belonging to projected runs, tagged with `_seg`. Each run is extended with a shallow
   *  COPY of the immediately adjacent row on each side, when that neighbor exists and is
   *  drawable (finite `_y`) — retagged with the projected run's own `_seg` so it becomes part of
   *  that path. This is what makes the actual→projected transition render as one continuous
   *  (dashed) segment instead of a gap, without mutating or duplicating the original row into
   *  the actual run too (which would double-draw the connector). */
  projected: SegmentedRow[];
}

/**
 * Group `rows` by `series` (preserving each series' relative, time-sorted input order — safe
 * even when series are interleaved in the input array), then split each series' sequence into
 * maximal runs.
 *
 * A new run starts whenever:
 *   - `_projected` flips between consecutive rows, OR
 *   - either row's `_y` is non-finite (null/undefined data is always its own hard boundary —
 *     never bridged into a neighboring run, never duplicated as a boundary point).
 *
 * Every row is tagged `_seg = series + "\0" + runIndex` (0-based per series) so Plot's z-channel
 * groups each run into its own <path>, preventing a solid bridge across a projected gap (the
 * failure mode of leaving z:"series" untouched).
 *
 * Rows are only ever shallow-copied, never mutated — callers (crosshair/tooltip) read the
 * original PreparedRow[] and must see it unchanged.
 */
export function splitProjectedRuns(rows: PreparedRow[]): ProjectedSplit {
  const bySeries = new Map<string, PreparedRow[]>();
  for (const r of rows) {
    const bucket = bySeries.get(r.series);
    if (bucket) bucket.push(r);
    else bySeries.set(r.series, [r]);
  }

  const actual: SegmentedRow[] = [];
  const projected: SegmentedRow[] = [];

  for (const [series, seriesRows] of bySeries) {
    if (!seriesRows.length) continue;

    // Compute [start, end] (inclusive) index ranges for each maximal run.
    const runs: Array<{ start: number; end: number; isProjected: boolean }> = [];
    let start = 0;
    for (let i = 1; i <= seriesRows.length; i++) {
      const prev = seriesRows[i - 1]!;
      const cur = i < seriesRows.length ? seriesRows[i] : undefined;
      const boundary =
        cur === undefined ||
        !Number.isFinite(prev._y) ||
        !Number.isFinite(cur._y) ||
        !!prev._projected !== !!cur._projected;
      if (boundary) {
        runs.push({ start, end: i - 1, isProjected: !!seriesRows[start]!._projected });
        start = i;
      }
    }

    runs.forEach((run, runIdx) => {
      const seg = `${series}\0${runIdx}`;
      const out: SegmentedRow[] = [];

      if (run.isProjected && run.start > 0) {
        const left = seriesRows[run.start - 1]!;
        if (Number.isFinite(left._y)) out.push({ ...left, _seg: seg });
      }
      for (let i = run.start; i <= run.end; i++) {
        out.push({ ...seriesRows[i]!, _seg: seg });
      }
      if (run.isProjected && run.end < seriesRows.length - 1) {
        const right = seriesRows[run.end + 1]!;
        if (Number.isFinite(right._y)) out.push({ ...right, _seg: seg });
      }

      (run.isProjected ? projected : actual).push(...out);
    });
  }

  return { actual, projected };
}
