// Line-to-baseline shading geometry. PURE — no DOM, no scales, no spec parsing: the caller resolves
// `from`/`to` through the x-adapter and picks colors, so this module only cuts a point sequence.
//
// Both cuts it performs — the x-range crop and the side split — are the same operation: slice the
// sequence and synthesize a point AT the cut so the fill edge is a clean vertical (crop) or sits flat
// on the baseline (zero crossing), rather than landing on whichever data point happens to be nearest.
// Categorical x has no position between two categories, so it slices on point boundaries and
// synthesizes nothing.
import type { PreparedRow } from "./marks/index";

export type ShadeSide = "both" | "positive" | "negative";

/** X field on PreparedRow, matching the x-adapter's `xField`. */
export type ShadeXField = "_xn" | "_xd" | "_xc";

export interface ShadeRun {
  /** One contiguous fill segment's points, x-ordered, each tagged with this run's `_seg`. */
  rows: PreparedRow[];
}

export interface BuildShadeRunsOptions {
  side: ShadeSide;
  /** The value `side` is measured against, and the level a run's synthesized edge points sit at.
   *  0 for the ordinary "above/below zero" fill; a threshold (0.5, -0.7, 15) for a rule-breach fill. */
  baseline: number;
  /** Pre-parsed lower bound (number / Date / category string); null ⇒ open-ended. */
  from: number | Date | string | null;
  /** Pre-parsed upper bound; null ⇒ open-ended. */
  to: number | Date | string | null;
}

/** Numeric position of a row on a continuous x-axis (epoch ms for dates). */
function posOf(row: PreparedRow, xField: ShadeXField): number {
  return xField === "_xd" ? ((row._xd as Date | null)?.getTime() ?? NaN) : (row._xn as number);
}

function boundToNumber(b: number | Date | string | null): number | null {
  if (b == null) return null;
  if (b instanceof Date) return b.getTime();
  const n = typeof b === "number" ? b : Number(b);
  return Number.isFinite(n) ? n : null;
}

/**
 * A synthetic point at continuous position `pos`, with `_y` linearly interpolated between `a` and
 * `b`. Inherits everything else (series, projected flag, ...) from `a`, so downstream code that
 * reads those fields sees a plausible row.
 */
function interpolate(
  a: PreparedRow,
  b: PreparedRow,
  pos: number,
  xField: ShadeXField,
): PreparedRow {
  const pa = posOf(a, xField);
  const pb = posOf(b, xField);
  const span = pb - pa;
  const t = span === 0 ? 0 : (pos - pa) / span;
  const y = (a._y as number) + t * ((b._y as number) - (a._y as number));
  const out = { ...a, _y: y } as PreparedRow;
  if (xField === "_xd") out._xd = new Date(pos);
  else out._xn = pos;
  return out;
}

/** Continuous position where the segment a→b crosses `baseline`. Callers guarantee the two points sit
 *  strictly on opposite sides of it, so `yb - ya` is non-zero. */
function baselineCrossing(
  a: PreparedRow,
  b: PreparedRow,
  xField: ShadeXField,
  baseline: number,
): number {
  const pa = posOf(a, xField);
  const pb = posOf(b, xField);
  const ya = a._y as number;
  const yb = b._y as number;
  return pa + ((baseline - ya) / (yb - ya)) * (pb - pa);
}

/** Crop to [lo, hi] on a CONTINUOUS axis, inserting an interpolated point at a bound that falls
 *  strictly between two points. A bound outside the data extent simply doesn't insert anything. */
function cropContinuous(
  points: PreparedRow[],
  xField: ShadeXField,
  lo: number | null,
  hi: number | null,
): PreparedRow[] {
  const inside = points.filter((p) => {
    const x = posOf(p, xField);
    return (lo == null || x >= lo) && (hi == null || x <= hi);
  });

  /** The point pair strictly straddling `bound`, if any. */
  const straddle = (bound: number): [PreparedRow, PreparedRow] | null => {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      if (posOf(a, xField) < bound && bound < posOf(b, xField)) return [a, b];
    }
    return null;
  };

  const out = [...inside];
  if (lo != null) {
    const pair = straddle(lo);
    if (pair) out.unshift(interpolate(pair[0], pair[1], lo, xField));
  }
  if (hi != null) {
    const pair = straddle(hi);
    if (pair) out.push(interpolate(pair[0], pair[1], hi, xField));
  }
  // A zero-width range inserts the same position at both ends; collapse the duplicate.
  return out.filter((p, i) => i === 0 || posOf(p, xField) !== posOf(out[i - 1]!, xField));
}

/** Crop to the category range on a BAND axis. A bound naming a category the data lacks yields
 *  nothing — the author meant a specific column and it isn't there (validation flags it too). */
function cropCategorical(
  points: PreparedRow[],
  lo: string | null,
  hi: string | null,
): PreparedRow[] {
  const indexOf = (cat: string) => points.findIndex((p) => p._xc === cat);
  let start = 0;
  let end = points.length - 1;
  if (lo != null) {
    start = indexOf(lo);
    if (start < 0) return [];
  }
  if (hi != null) {
    end = indexOf(hi);
    if (end < 0) return [];
  }
  return start > end ? [] : points.slice(start, end + 1);
}

/**
 * Split a cropped sequence into the runs that lie on `side` of `baseline`.
 *
 * A point is ELIGIBLE when its value is strictly on the requested side, or exactly at the baseline.
 * Runs are maximal stretches of eligible points; a run with no strictly-on-side point is dropped, so
 * a series that merely touches the baseline from the far side contributes nothing. Treating the
 * baseline as eligible rather than as a boundary is what keeps a series that touches it without
 * crossing in ONE run.
 *
 * Where a run's edge point is strictly on-side and its neighbour outside the run is strictly on the
 * far side, the crossing between them is synthesized so the fill closes flat on the baseline. When
 * the edge point already sits at the baseline it IS the crossing, so nothing is added.
 */
function splitBySide(
  cropped: PreparedRow[],
  xField: ShadeXField,
  side: Exclude<ShadeSide, "both">,
  baseline: number,
): PreparedRow[][] {
  const continuous = xField !== "_xc";
  const wanted = (r: PreparedRow) =>
    side === "positive" ? (r._y as number) > baseline : (r._y as number) < baseline;
  const eligible = (r: PreparedRow) => wanted(r) || (r._y as number) === baseline;

  const runs: PreparedRow[][] = [];
  let i = 0;
  while (i < cropped.length) {
    if (!eligible(cropped[i]!)) {
      i++;
      continue;
    }
    const start = i;
    while (i < cropped.length && eligible(cropped[i]!)) i++;
    const run = cropped.slice(start, i);
    if (!run.some(wanted)) continue;

    if (continuous) {
      const before = cropped[start - 1];
      if (before && !eligible(before) && (run[0]!._y as number) !== baseline) {
        run.unshift(interpolateToBaseline(before, run[0]!, xField, baseline));
      }
      const after = cropped[i];
      const last = run[run.length - 1]!;
      if (after && !eligible(after) && (last._y as number) !== baseline) {
        run.push(interpolateToBaseline(last, after, xField, baseline));
      }
    }
    runs.push(run);
  }
  return runs;
}

/** The baseline-crossing point of a→b, carrying a's non-positional fields. */
function interpolateToBaseline(
  a: PreparedRow,
  b: PreparedRow,
  xField: ShadeXField,
  baseline: number,
): PreparedRow {
  const point = interpolate(a, b, baselineCrossing(a, b, xField, baseline), xField);
  // Pin to exactly the baseline: the interpolation lands there algebraically, but float error can
  // leave a hair either side, which would read as an off-baseline value to anything re-inspecting
  // the run (and leave the fill edge a fraction of a pixel off flat).
  point._y = baseline;
  return point;
}

/**
 * Turn ONE series' points into the fill runs for a shaded region.
 *
 * `points` must be that series' rows with finite `_y`; continuous axes are sorted defensively, while
 * a categorical axis keeps the caller's order (which is already the resolved category order).
 */
export function buildShadeRuns(
  points: PreparedRow[],
  xField: ShadeXField,
  opts: BuildShadeRunsOptions,
): ShadeRun[] {
  const finite = points.filter((p) => Number.isFinite(p._y as number));
  if (!finite.length) return [];

  let cropped: PreparedRow[];
  if (xField === "_xc") {
    cropped = cropCategorical(
      finite,
      typeof opts.from === "string" ? opts.from : null,
      typeof opts.to === "string" ? opts.to : null,
    );
  } else {
    const ordered = [...finite].sort((a, b) => posOf(a, xField) - posOf(b, xField));
    const lo = boundToNumber(opts.from);
    const hi = boundToNumber(opts.to);
    if (lo != null && hi != null && lo > hi) return [];
    cropped = cropContinuous(ordered, xField, lo, hi);
  }
  if (!cropped.length) return [];

  const runs =
    opts.side === "both"
      ? [cropped]
      : splitBySide(cropped, xField, opts.side, opts.baseline);

  return runs.map((rows, i) => ({
    rows: rows.map((r) => ({ ...r, _seg: `shade-${i}` }) as PreparedRow),
  }));
}
