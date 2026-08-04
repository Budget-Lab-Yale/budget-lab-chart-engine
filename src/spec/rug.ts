// Resolve the x-axis rug's tracks from a spec. PURE — no DOM, no scales, no x parsing: the caller
// (engine/rug.ts) turns these x-value STRINGS into pixels through the chart's own x scale.
//
// Tracks are mostly DERIVED rather than declared. The michez-rule chart already states its recession
// spans as `annotations.bands` and its false-negative / false-positive runs as `shading` regions;
// restating those eight date pairs under `rug:` would be duplication free to drift, so any band or
// shading entry flagged `rug: true` is grouped by its `label` into a track instead. Explicit
// `rug.tracks` cover the remaining case: a timeline concept with no band or fill of its own.
import { resolveAnnotations } from "./annotations";
import type { ChartSpec, RugInterval, RugTrack } from "./types";

/** A track with its color and legend flag resolved, ready to draw or to key. */
export interface ResolvedRugTrack {
  label: string;
  /** Raw color ref (named token or "#hex") declared on the source entry; undefined ⇒ resolve from
   *  `series`, else the caller's neutral default. See `rugTrackColor`. */
  color: string | undefined;
  /** The series this track's source `shading` region was scoped to, when it named one. Lets the
   *  renderer color an uncolored track like the fill it came from, so the block matches its own
   *  legend chip. Undefined for band-derived tracks, explicit tracks, and region-covers-every-series
   *  regions (which have no single color the strip could draw). */
  series?: string;
  intervals: RugInterval[];
  /** Where this track came from. Read by the legend builder to avoid double-keying: a DERIVED
   *  track's row is already produced from its source band / shading entry, so only an explicit
   *  `rug.tracks` entry — which has no band or fill of its own — needs a row minted here. */
  origin: "bands" | "shading" | "tracks";
  /** False only when the author explicitly opted the track out of the legend. */
  legend: boolean;
}

/** Group flagged entries by label, preserving first-appearance order. The first entry of a group
 *  fixes the group's color and legend flag; later entries only contribute intervals. */
function groupByLabel(
  entries: Array<{
    label: string;
    color?: string;
    series?: string;
    legend?: boolean;
    interval: RugInterval;
  }>,
  origin: ResolvedRugTrack["origin"],
): ResolvedRugTrack[] {
  const byLabel = new Map<string, ResolvedRugTrack>();
  for (const e of entries) {
    const existing = byLabel.get(e.label);
    if (existing) {
      existing.intervals.push(e.interval);
      // Entries of one track scoped to DIFFERENT series have no single series color; drop the scope
      // so the track resolves to the neutral rather than to whichever entry came first.
      if (existing.series !== e.series) delete existing.series;
      continue;
    }
    byLabel.set(e.label, {
      label: e.label,
      color: e.color,
      ...(e.series != null ? { series: e.series } : {}),
      intervals: [e.interval],
      origin,
      legend: e.legend !== false,
    });
  }
  return [...byLabel.values()];
}

/** The one resolution of a track's block color, shared by the strip and its legend chip so the two
 *  can never disagree. `seriesColor` looks up a series' resolved color; `neutral` is the fallback. */
export function rugTrackColor(
  track: ResolvedRugTrack,
  seriesColor: (s: string) => string | undefined,
  resolve: (c: string | undefined) => string | undefined,
  neutral: string,
): string {
  return (
    resolve(track.color) ||
    (track.series != null ? seriesColor(track.series) : undefined) ||
    neutral
  );
}

/**
 * Every rug track for this chart, in draw + legend order: bands → shading → explicit `rug.tracks`.
 * All tracks paint into ONE strip, so this order is also the paint order (later over earlier).
 *
 * Entries that can't yield a closed interval are skipped rather than throwing — a `rug: true`
 * shading region with an open bound, or a flag with no `label`, is a validation error reported by
 * `spec/validate.ts`; rendering must not crash on a spec that got here unvalidated.
 */
export function resolveRugTracks(spec: ChartSpec): ResolvedRugTrack[] {
  const ann = resolveAnnotations(spec);

  const bandTracks = groupByLabel(
    ann.bands
      .filter((b) => b.rug === true && !!b.label)
      .map((b) => ({
        label: b.label as string,
        color: b.color,
        legend: b.legend,
        interval: { from: b.start, to: b.end },
      })),
    "bands",
  );

  const shadeTracks = groupByLabel(
    (spec.shading ?? [])
      .filter((s) => s.rug === true && !!s.label && s.from != null && s.to != null)
      .map((s) => ({
        label: s.label as string,
        color: s.color,
        ...(s.series != null ? { series: s.series } : {}),
        legend: s.legend,
        interval: { from: s.from as string, to: s.to as string },
      })),
    "shading",
  );

  const explicit: ResolvedRugTrack[] = (spec.rug?.tracks ?? [])
    .filter((t: RugTrack) => !!t.label && t.intervals.length > 0)
    .map((t: RugTrack) => ({
      label: t.label,
      color: t.color,
      intervals: t.intervals,
      origin: "tracks" as const,
      legend: t.legend !== false,
    }));

  return [...bandTracks, ...shadeTracks, ...explicit];
}

const RUG_DEFAULT_HEIGHT = 8;
/** Gap between the plot frame's bottom edge and the top of the strip. */
export const RUG_GAP = 3;
/** Gap below the strip, before the x-axis tick labels. */
export const RUG_PAD = 2;
/** Gap between rows when every track gets its own (`rug.rows: per-track`). */
export const RUG_ROW_GAP = 2;

/** Height of ONE row of the strip. */
export function rugHeight(spec: ChartSpec): number {
  return spec.rug?.height ?? RUG_DEFAULT_HEIGHT;
}

/** How many rows the strip occupies: one, or one per resolved track. */
export function rugRowCount(spec: ChartSpec): number {
  const tracks = resolveRugTracks(spec);
  if (!tracks.length) return 0;
  return spec.rug?.rows === "per-track" ? tracks.length : 1;
}

/** Numeric position of a rug bound on `xAxisType`, for interval math. Bounds that don't parse
 *  return NaN — validation reports those separately. */
export function rugBoundPosition(xAxisType: string, value: string): number {
  if (xAxisType === "numeric") return Number(value);
  if (xAxisType === "temporal") return +new Date(value);
  if (xAxisType === "quarterly") return Number(value.slice(0, 4)) * 4 + Number(value[5]);
  return NaN;
}

/**
 * Tracks that `rows: single` would paint away ENTIRELY — every one of their intervals covered by
 * later tracks. Such a track still claims a legend row, so the reader is keyed to blocks that are
 * not on the chart. Pure interval math on the spec, so validation can catch it without rendering.
 *
 * Partial cover is deliberately allowed: a short run at the head of a longer one is exactly how the
 * michez strip reads a false negative running into its recession.
 */
export function fullyHiddenRugTracks(spec: ChartSpec): string[] {
  if (spec.rug?.rows === "per-track") return [];
  const tracks = resolveRugTracks(spec);
  const xType = spec.xAxisType;
  const hidden: string[] = [];
  tracks.forEach((track, i) => {
    const later = tracks.slice(i + 1).flatMap((t) => t.intervals);
    if (!later.length) return;
    const covered = track.intervals.every((iv) => {
      const lo = rugBoundPosition(xType, iv.from);
      const hi = rugBoundPosition(xType, iv.to);
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false;
      // Covered when some LATER interval contains this one outright. (Union-of-several cover is
      // rarer and harder to state; containment is the case that actually bites.)
      return later.some((o) => {
        const olo = rugBoundPosition(xType, o.from);
        const ohi = rugBoundPosition(xType, o.to);
        return Number.isFinite(olo) && Number.isFinite(ohi) && olo <= lo && ohi >= hi;
      });
    });
    if (covered) hidden.push(track.label);
  });
  return hidden;
}

/**
 * Vertical space the rug claims below the plot frame — the gap above, every row, the gaps between
 * rows, and the pad before the tick labels. Added to `marginBottom` AND to the tick labels' dy, so
 * the frame shrinks by exactly the strip's footprint and the labels stay the same distance below it
 * as on a rugless chart. 0 when the chart has no tracks.
 *
 * Growing the margin (rather than insetting the y range) keeps every consumer that derives plot
 * geometry as `height - marginTop - marginBottom` correct with no changes — the annotation stagger,
 * the point-callout connector math, and all six margin reads in crosshair.ts.
 */
export function rugAllowance(spec: ChartSpec): number {
  const rows = rugRowCount(spec);
  if (!rows) return 0;
  return RUG_GAP + rows * rugHeight(spec) + (rows - 1) * RUG_ROW_GAP + RUG_PAD;
}
