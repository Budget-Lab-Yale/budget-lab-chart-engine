// Timeline text measurement (Ruling 45). Every timeline position hangs on text widths, and the
// generic estimateLabelWidth (0.55em per character) runs 25-35% wide of the real Figtree, which left
// content-hugged columns visibly loose. This sums a static per-character advance table generated
// from the embedded font (timeline-metrics.ts; scripts/gen-timeline-metrics.mjs), so it is as
// deterministic as the estimate — no DOM, canvas or getBBox — and the live mount, the PNG export
// and the jsdom goldens still agree. Kerning is ignored: Figtree's pairs mostly tighten, so a
// kerned line renders no wider than this. A character outside the table measures ASTRAL_EM if it is
// astral (emoji, supplementary CJK), WIDE_EM if it is BMP East Asian Wide/Fullwidth (see isWide),
// else FIGTREE_FALLBACK. Both wide advances are at least what Chromium's fallback fonts draw, so a
// line wrapped to a column never renders past it (Ruling 48).
// Timeline-only: every other chart keeps estimateLabelWidth, byte-identical.
import { FIGTREE_ADVANCE, FIGTREE_CHARS, FIGTREE_FALLBACK } from "./timeline-metrics";

/** The two weights a timeline draws: 500 (titles, descriptions, ticks), 700 (dates, lane names). */
export type TimelineWeight = 500 | 700;

const ADVANCE: Record<TimelineWeight, Map<string, number>> = {
  500: new Map([...FIGTREE_CHARS].map((ch, i) => [ch, FIGTREE_ADVANCE[500][i]!])),
  700: new Map([...FIGTREE_CHARS].map((ch, i) => [ch, FIGTREE_ADVANCE[700][i]!])),
};

/** Advance, per 1000 em, for a BMP East Asian Wide/Fullwidth character (中 한 Ａ: an em in
 *  Chromium's fallback fonts). */
export const WIDE_EM = 1000;

/** Advance, per 1000 em, for an astral code point (cp > 0xFFFF: emoji, supplementary CJK). Chromium
 *  draws 😀 at 1.37em, so an em would let an emoji-heavy line overflow its column (Ruling 48). */
export const ASTRAL_EM = 1400;

/** East Asian Wide / Fullwidth blocks (Hangul Jamo, CJK radicals through Yi, Hangul syllables, CJK
 *  compatibility, vertical and fullwidth forms), inclusive. Figtree has none of them. */
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff],
  [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6],
];

/** A BMP East Asian Wide/Fullwidth code point: rendered about an em wide, well past the letter-mean
 *  fallback. */
function isWide(cp: number): boolean {
  return WIDE_RANGES.some(([a, b]) => cp >= a && cp <= b);
}

/** Advance, per 1000 em, for a character outside the table. */
function fallbackEm(ch: string, weight: TimelineWeight): number {
  const cp = ch.codePointAt(0)!;
  return cp > 0xffff ? ASTRAL_EM : isWide(cp) ? WIDE_EM : FIGTREE_FALLBACK[weight];
}

/** Width in px of `text` set in Figtree at `sizePx` and `weight`, one table advance per code point. */
export function timelineTextWidth(text: string, sizePx: number, weight: TimelineWeight): number {
  const table = ADVANCE[weight];
  let em = 0;
  for (const ch of text) em += table.get(ch) ?? fallbackEm(ch, weight);
  return (em * sizePx) / 1000;
}
