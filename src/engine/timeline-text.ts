// Timeline text measurement (Ruling 45). Every timeline position hangs on text widths, and the
// generic estimateLabelWidth (0.55em per character) runs 25-35% wide of the real Figtree, which left
// content-hugged columns visibly loose. This sums a static per-character advance table generated
// from the embedded font (timeline-metrics.ts; scripts/gen-timeline-metrics.mjs), so it is as
// deterministic as the estimate — no DOM, canvas or getBBox — and the live mount, the PNG export
// and the jsdom goldens still agree. Kerning is ignored, so the sum is not an upper bound: against
// Chromium's rendering (getComputedTextLength, the embedded Figtree), 95,108 drawn lines of vertical
// timelines at 280–440px ran from 1.5% narrower than it (kerned pairs tighten) to 0.23% wider, never
// more than 0.05px wider (round-3 final fix probe). Text with a character outside the table
// (Latin-1 plus common punctuation) is measured by grapheme (`graphemes`), so a multi-code-point
// emoji is one unit: a flag, skin-toned emoji, keycap or tag sequence is one EMOJI_EM, and a ZWJ
// sequence one EMOJI_EM per joined part. Any other grapheme sums its code points, each by class:
//   - EMOJI_EM (1.4em): astral (emoji, supplementary CJK) and the BMP emoji/symbol blocks in
//     EMOJI_RANGES — at least what Chromium's fallback fonts draw (😀 1.37em, ✅ ⭐ ☀ ~1.3em);
//   - WIDE_EM (1em): BMP East Asian Wide/Fullwidth (WIDE_RANGES) — Chromium draws those an em wide;
//   - SCRIPT_EM: a script Figtree lacks (Cyrillic, Greek, and the scripts of OTHER_SCRIPT_RANGES),
//     at the widest Chromium draws it with any of six common fallback fonts, less 2% (F5);
//   - FIGTREE_FALLBACK (the Latin letter mean): everything else (Latin Extended, symbols).
// So a line wrapped to a column renders inside it, to within that fraction of a pixel, for the
// table's characters and the two wide classes (Rulings 48, 49), and to within 2% for those scripts.
// Shared by the timeline and the treemap (treemap-labels.ts fits tile label text with it),
// so a change to the table or its fallbacks moves both; every other chart keeps estimateLabelWidth,
// byte-identical.
import { FIGTREE_ADVANCE, FIGTREE_CHARS, FIGTREE_FALLBACK } from "./timeline-metrics";

/** The two weights a timeline draws: 500 (titles, descriptions, ticks), 700 (dates, lane names). The
 *  treemap draws the same two. */
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
 *  and Arrows (⭐), inclusive (Ruling 49); and ◽ ◾, the BMP's only emoji-presentation characters
 *  outside those blocks and the table (F5). */
const EMOJI_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x2300, 0x23ff], [0x25fd, 0x25fe], [0x2600, 0x27bf], [0x2b00, 0x2bff],
];

/** East Asian Wide / Fullwidth blocks (Hangul Jamo, CJK radicals through Yi, Hangul syllables, CJK
 *  compatibility, vertical and fullwidth forms), inclusive. Figtree has none of them. */
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff],
  [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6],
];

type Ranges = ReadonlyArray<readonly [number, number]>;

/** BMP script blocks Figtree draws none of: Armenian to Ol Chiki (Hebrew, Arabic, the Indic
 *  scripts, Thai, Georgian, Myanmar, Ethiopic, Khmer...), Georgian Mtavruli to Vedic, Coptic to
 *  Ethiopic Extended, Lisu to Vai, Bamum, Syloti Nagri to Meetei Mayek, and the Hebrew and Arabic
 *  presentation forms — less the Hangul jamo blocks, which compose into one wide syllable. */
const OTHER_SCRIPT_RANGES: Ranges = [
  [0x0530, 0x10ff], [0x1200, 0x1c7f], [0x1c90, 0x1cff], [0x2c80, 0x2ddf], [0xa4d0, 0xa63f],
  [0xa6a0, 0xa6ff], [0xa800, 0xa95f], [0xa980, 0xabff], [0xfb1d, 0xfdff], [0xfe70, 0xfefe],
];

/** Scripts Figtree lacks: the advance per code point, per 1000 em, and the capitals' where those
 *  run wider. Each is the least that keeps every string of a probe corpus (sentences, place names,
 *  acronyms, all-caps headings, short words of wide letters such as "щи" and "мышь") within 2% of
 *  the widest Chromium draws it with the embedded Figtree first in the engine's stack and Segoe UI,
 *  Source Sans 3, Arial, Roboto, Noto Sans or DejaVu Sans drawing the script (F5, 2026-10-06; for
 *  the scripts none of those covers, Windows' own fallback). DejaVu Sans is the widest, so a
 *  narrower font draws short of the estimate: a Cyrillic sentence in Segoe UI by 30–45%. First
 *  match wins: Tamil and Sinhala, inside OTHER_SCRIPT_RANGES, draw wider a code point than any other
 *  script measured (சென்னை 0.88em, කොළඹ 1.06em); the rest is held to the widest of the others
 *  (Armenian 0.74em, Malayalam 0.78em at 700), so it runs wide of most — Arabic draws 0.39–0.56em. */
const SCRIPT_EM: ReadonlyArray<{ ranges: Ranges; em: Record<TimelineWeight, number>; capsEm?: Record<TimelineWeight, number> }> = [
  { ranges: [[0x0400, 0x052f], [0x1c80, 0x1c8f], [0xa640, 0xa69f]], em: { 500: 780, 700: 890 }, capsEm: { 500: 810, 700: 920 } }, // Cyrillic
  { ranges: [[0x0370, 0x03ff], [0x1f00, 0x1fff]], em: { 500: 640, 700: 695 }, capsEm: { 500: 740, 700: 805 } }, // Greek
  { ranges: [[0x0b80, 0x0bff], [0x0d80, 0x0dff]], em: { 500: 930, 700: 1060 } }, // Tamil, Sinhala
  { ranges: OTHER_SCRIPT_RANGES, em: { 500: 750, 700: 780 } },
];

const inRanges = (cp: number, ranges: Ranges): boolean => ranges.some(([a, b]) => cp >= a && cp <= b);

const isEmoji = (cp: number): boolean => cp > 0xffff || inRanges(cp, EMOJI_RANGES);

/** Advance, per 1000 em, for a character outside the table. */
function fallbackEm(ch: string, weight: TimelineWeight): number {
  const cp = ch.codePointAt(0)!;
  if (isEmoji(cp)) return EMOJI_EM;
  if (inRanges(cp, WIDE_RANGES)) return WIDE_EM;
  const script = SCRIPT_EM.find((s) => inRanges(cp, s.ranges));
  if (!script) return FIGTREE_FALLBACK[weight];
  return script.capsEm && ch !== ch.toLowerCase() ? script.capsEm[weight] : script.em[weight];
}

const SEGMENTER: Intl.Segmenter | null =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function" ? new Intl.Segmenter("en", { granularity: "grapheme" }) : null;

/** `text` split into graphemes (user-perceived characters: a flag, a skin-toned or ZWJ emoji, a
 *  keycap, a letter with its combining marks), so a line break never cuts inside one. Intl.Segmenter
 *  is in Node (full ICU, the default build) and every current browser (Chrome and Edge 87, Safari
 *  14.1, Firefox 125); a runtime without it falls back to code points. */
export function graphemes(text: string): string[] {
  return SEGMENTER ? Array.from(SEGMENTER.segment(text), (s) => s.segment) : Array.from(text);
}

/** Width in px of `text` set in Figtree at `sizePx` and `weight`. Text the table covers sums one
 *  advance per character; any other text is measured by grapheme (graphemesEm). */
export function timelineTextWidth(text: string, sizePx: number, weight: TimelineWeight): number {
  const table = ADVANCE[weight];
  let em = 0;
  for (const ch of text) {
    const a = table.get(ch);
    if (a === undefined) return (graphemesEm(text, weight) * sizePx) / 1000;
    em += a;
  }
  return (em * sizePx) / 1000;
}

/** `text`'s advance, per 1000 em, a grapheme at a time. A multi-code-point grapheme led by an emoji
 *  or carrying VS16 (U+FE0F) or a keycap mark (U+20E3) is emoji: one EMOJI_EM for a flag, skin-toned
 *  emoji, keycap or tag sequence, and one per part of a ZWJ (U+200D) sequence — a platform whose
 *  emoji font lacks the sequence draws its parts side by side (Chromium on Windows 10: 🧑‍💻 2.68em),
 *  and even one it has can run past an em and a half (👨‍👩‍👧‍👦 1.94em). Any other grapheme sums its code
 *  points. */
function graphemesEm(text: string, weight: TimelineWeight): number {
  const table = ADVANCE[weight];
  let em = 0;
  for (const g of graphemes(text)) {
    const cps = Array.from(g);
    if (cps.length > 1 && (isEmoji(g.codePointAt(0)!) || g.includes("\uFE0F") || g.includes("\u20E3"))) {
      em += EMOJI_EM * (1 + cps.filter((ch) => ch === "\u200D").length);
      continue;
    }
    for (const ch of cps) em += table.get(ch) ?? fallbackEm(ch, weight);
  }
  return em;
}
