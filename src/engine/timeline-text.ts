// Timeline text measurement (Ruling 45). Every timeline position hangs on text widths, and the
// generic estimateLabelWidth (0.55em per character) runs 25-35% wide of the real Figtree, which left
// content-hugged columns visibly loose. This sums a static per-character advance table generated
// from the embedded font (timeline-metrics.ts; scripts/gen-timeline-metrics.mjs), so it is as
// deterministic as the estimate — no DOM, canvas or getBBox — and the live mount, the PNG export
// and the jsdom goldens still agree. Kerning is ignored: Figtree's pairs mostly tighten, so a
// kerned line renders no wider than this. A character outside the table measures WIDE_EM if it is
// wide (see isWide), else FIGTREE_FALLBACK.
// Timeline-only: every other chart keeps estimateLabelWidth, byte-identical.
import { FIGTREE_ADVANCE, FIGTREE_CHARS, FIGTREE_FALLBACK } from "./timeline-metrics";

/** The two weights a timeline draws: 500 (titles, descriptions, ticks), 700 (dates, lane names). */
export type TimelineWeight = 500 | 700;

const ADVANCE: Record<TimelineWeight, Map<string, number>> = {
  500: new Map([...FIGTREE_CHARS].map((ch, i) => [ch, FIGTREE_ADVANCE[500][i]!])),
  700: new Map([...FIGTREE_CHARS].map((ch, i) => [ch, FIGTREE_ADVANCE[700][i]!])),
};

/** Advance, per 1000 em, for a character a fallback font draws about an em wide. */
export const WIDE_EM = 1000;

/** East Asian Wide / Fullwidth blocks (Hangul Jamo, CJK radicals through Yi, Hangul syllables, CJK
 *  compatibility, vertical and fullwidth forms), inclusive. Figtree has none of them. */
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff],
  [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6],
];

/** An astral code point (emoji and the supplementary CJK planes) or an East Asian Wide/Fullwidth
 *  one: rendered about an em wide, well past the letter-mean fallback. */
function isWide(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  return cp > 0xffff || WIDE_RANGES.some(([a, b]) => cp >= a && cp <= b);
}

/** Width in px of `text` set in Figtree at `sizePx` and `weight`, one table advance per code point. */
export function timelineTextWidth(text: string, sizePx: number, weight: TimelineWeight): number {
  const table = ADVANCE[weight];
  let em = 0;
  for (const ch of text) em += table.get(ch) ?? (isWide(ch) ? WIDE_EM : FIGTREE_FALLBACK[weight]);
  return (em * sizePx) / 1000;
}
