// Timeline text measurement (Ruling 45). Every timeline position hangs on text widths, and the
// generic estimateLabelWidth (0.55em per character) runs 25-35% wide of the real Figtree, which left
// content-hugged columns visibly loose. This sums a static per-character advance table generated
// from the embedded font (timeline-metrics.ts; scripts/gen-timeline-metrics.mjs), so it is as
// deterministic as the estimate — no DOM, canvas or getBBox — and the live mount, the PNG export
// and the jsdom goldens still agree. Kerning is ignored, so the sum is not an upper bound: against
// Chromium's rendering (getComputedTextLength, the embedded Figtree), 95,108 drawn lines of vertical
// timelines at 280–440px ran from 1.5% narrower than it (kerned pairs tighten) to 0.23% wider, never
// more than 0.05px wider (round-3 final fix probe). A character outside the table (Latin-1 plus
// common punctuation) measures, by code point:
//   - EMOJI_EM (1.4em): astral (emoji, supplementary CJK) and the BMP emoji/symbol blocks in
//     EMOJI_RANGES — at least what Chromium's fallback fonts draw (😀 1.37em, ✅ ⭐ ☀ ~1.3em);
//   - WIDE_EM (1em): BMP East Asian Wide/Fullwidth (WIDE_RANGES) — Chromium draws those an em wide;
//   - FIGTREE_FALLBACK (the Latin letter mean): everything else. Scripts that render wider than that
//     (Cyrillic, Greek) can still measure short, so a line of them may run past its column.
// So a line wrapped to a column renders inside it, to within that fraction of a pixel, only for the
// table's characters and the two wide classes (Rulings 48, 49).
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

/** Advance, per 1000 em, for an astral code point (cp > 0xFFFF: emoji, supplementary CJK) or one in
 *  EMOJI_RANGES. Chromium draws 😀 at 1.37em and ✅ ⭐ ☀ at ~1.3em, so an em would let an
 *  emoji-heavy line overflow its column (Rulings 48, 49). */
export const EMOJI_EM = 1400;

/** BMP blocks whose characters Chromium draws from an emoji or symbol font, well past an em wide:
 *  Miscellaneous Technical (⌛), Miscellaneous Symbols and Dingbats (☀ ✅), Miscellaneous Symbols
 *  and Arrows (⭐), inclusive (Ruling 49). */
const EMOJI_RANGES: ReadonlyArray<readonly [number, number]> = [[0x2300, 0x23ff], [0x2600, 0x27bf], [0x2b00, 0x2bff]];

/** East Asian Wide / Fullwidth blocks (Hangul Jamo, CJK radicals through Yi, Hangul syllables, CJK
 *  compatibility, vertical and fullwidth forms), inclusive. Figtree has none of them. */
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff],
  [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6],
];

const inRanges = (cp: number, ranges: ReadonlyArray<readonly [number, number]>): boolean =>
  ranges.some(([a, b]) => cp >= a && cp <= b);

/** Advance, per 1000 em, for a character outside the table. */
function fallbackEm(ch: string, weight: TimelineWeight): number {
  const cp = ch.codePointAt(0)!;
  if (cp > 0xffff || inRanges(cp, EMOJI_RANGES)) return EMOJI_EM;
  return inRanges(cp, WIDE_RANGES) ? WIDE_EM : FIGTREE_FALLBACK[weight];
}

/** Width in px of `text` set in Figtree at `sizePx` and `weight`, one table advance per code point. */
export function timelineTextWidth(text: string, sizePx: number, weight: TimelineWeight): number {
  const table = ADVANCE[weight];
  let em = 0;
  for (const ch of text) em += table.get(ch) ?? fallbackEm(ch, weight);
  return (em * sizePx) / 1000;
}
