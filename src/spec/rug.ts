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
  /** Raw color ref (named token or "#hex"); undefined ⇒ the caller's neutral default. */
  color: string | undefined;
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
  entries: Array<{ label: string; color?: string; legend?: boolean; interval: RugInterval }>,
  origin: ResolvedRugTrack["origin"],
): ResolvedRugTrack[] {
  const byLabel = new Map<string, ResolvedRugTrack>();
  for (const e of entries) {
    const existing = byLabel.get(e.label);
    if (existing) {
      existing.intervals.push(e.interval);
      continue;
    }
    byLabel.set(e.label, {
      label: e.label,
      color: e.color,
      intervals: [e.interval],
      origin,
      legend: e.legend !== false,
    });
  }
  return [...byLabel.values()];
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

export function rugHeight(spec: ChartSpec): number {
  return spec.rug?.height ?? RUG_DEFAULT_HEIGHT;
}

/**
 * Vertical space the rug claims below the plot frame. Added to `marginBottom` AND to the x-axis
 * tick labels' dy, so the frame shrinks by exactly the strip's footprint and the labels stay the
 * same distance below it as on a rugless chart. 0 when the chart has no tracks.
 *
 * Growing the margin (rather than insetting the y range) keeps every consumer that derives plot
 * geometry as `height - marginTop - marginBottom` correct with no changes — the annotation stagger,
 * the point-callout connector math, and all six margin reads in crosshair.ts.
 */
export function rugAllowance(spec: ChartSpec): number {
  if (!resolveRugTracks(spec).length) return 0;
  return RUG_GAP + rugHeight(spec) + RUG_PAD;
}
