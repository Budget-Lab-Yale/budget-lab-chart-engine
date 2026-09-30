// Timeline text measurement (Ruling 45). Every timeline position hangs on text widths, and the
// generic estimateLabelWidth (0.55em per character) runs 25-35% wide of the real Figtree, which left
// content-hugged columns visibly loose. This sums a static per-character advance table generated
// from the embedded font (timeline-metrics.ts; scripts/gen-timeline-metrics.mjs), so it is as
// deterministic as the estimate — no DOM, canvas or getBBox — and the live mount, the PNG export
// and the jsdom goldens still agree. Kerning is ignored: Figtree's pairs mostly tighten, so a
// kerned line renders no wider than this. A character outside the table measures FIGTREE_FALLBACK.
// Timeline-only: every other chart keeps estimateLabelWidth, byte-identical.
import { FIGTREE_ADVANCE, FIGTREE_CHARS, FIGTREE_FALLBACK } from "./timeline-metrics";

/** The two weights a timeline draws: 500 (titles, descriptions, ticks), 700 (dates, lane names). */
export type TimelineWeight = 500 | 700;

const ADVANCE: Record<TimelineWeight, Map<string, number>> = {
  500: new Map([...FIGTREE_CHARS].map((ch, i) => [ch, FIGTREE_ADVANCE[500][i]!])),
  700: new Map([...FIGTREE_CHARS].map((ch, i) => [ch, FIGTREE_ADVANCE[700][i]!])),
};

/** Width in px of `text` set in Figtree at `sizePx` and `weight`, one table advance per code point. */
export function timelineTextWidth(text: string, sizePx: number, weight: TimelineWeight): number {
  const table = ADVANCE[weight];
  let em = 0;
  for (const ch of text) em += table.get(ch) ?? FIGTREE_FALLBACK[weight];
  return (em * sizePx) / 1000;
}
