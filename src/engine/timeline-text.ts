// Timeline text measurement (Ruling 45). Every timeline position hangs on text widths, and the
// generic estimateLabelWidth (0.55em per character) runs 25-35% wide of the real Figtree, which left
// content-hugged columns visibly loose. This sums a static per-character advance table generated
// from the embedded font (timeline-metrics.ts; scripts/gen-timeline-metrics.mjs), so it is as
// deterministic as the estimate — no DOM, canvas or getBBox — and the live mount, the PNG export
// and the jsdom goldens still agree. Kerning is ignored, so the sum is not an upper bound: against
// Chromium's rendering (getComputedTextLength, the embedded Figtree), 95,108 drawn lines of vertical
// timelines at 280–440px ran from 1.5% narrower than it (kerned pairs tighten) to 0.23% wider, never
// more than 0.05px wider (round-3 final fix probe). Text with a character outside the table
// (Latin-1 plus common punctuation) is measured by grapheme (`graphemes`): a multi-code-point
// emoji is one unit, one EMOJI_EM per emoji part (graphemesEm). Any other grapheme sums its code
// points, each by class:
//   - EMOJI_EM (1.4em): astral (emoji, supplementary CJK) and the BMP emoji/symbol blocks in
//     EMOJI_RANGES — at least what Chromium's fallback fonts draw (😀 1.37em, ✅ ⭐ ☀ ~1.3em);
//   - WIDE_EM (1em): BMP East Asian Wide/Fullwidth (WIDE_RANGES) — Chromium draws those an em wide;
//   - a Cyrillic or Greek letter (Cyrillic Extended-B included): the widest advance among Arial,
//     Segoe UI, Liberation Sans, DejaVu Sans, Noto Sans, FreeSans, Source Sans 3 and Roboto
//     (script-metrics.ts; Ruling 51);
//   - SCRIPT_EM: any other character of a script Figtree lacks (SCRIPT_RANGES) — Unifont's em, not
//     the widest any font draws (Ruling 52);
//   - FIGTREE_FALLBACK (the Latin letter mean): everything else (Latin Extended, symbols).
// So a line wrapped to a column renders inside it, to within that fraction of a pixel, for the
// table's characters and the two wide classes (Rulings 48, 49); and Cyrillic and Greek, in the fonts
// measured (macOS fonts were not), short only where kerning tightens a pair, except at 500 on
// Windows, where Chromium draws Segoe UI's semibold face: up to 0.7% wider than the table for common
// letters (М) and 9% for rare ones (ꙇ). Text in another script runs past its column where the
// reader's font draws it wider than SCRIPT_EM, as Windows does a word dense in some Tamil, Malayalam
// or Myanmar letters (see SCRIPT_EM).
// Shared by the timeline and the treemap (treemap-labels.ts fits tile label text with it),
// so a change to the table or its fallbacks moves both; every other chart keeps estimateLabelWidth,
// byte-identical.
import { EXTENDED_PICTOGRAPHIC, GRAPHEME_EXTEND } from "./grapheme-data";
import { SCRIPT_ADVANCE, SCRIPT_CHARS } from "./script-metrics";
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

/** Cyrillic and Greek letters: the widest advance among the common fallback fonts that draw them
 *  (script-metrics.ts, scripts/gen-script-metrics.mjs; Ruling 51). */
const SCRIPT_ADVANCE_BY_CHAR: Record<TimelineWeight, Map<string, number>> = {
  500: new Map([...SCRIPT_CHARS].map((ch, i) => [ch, SCRIPT_ADVANCE[500][i]!])),
  700: new Map([...SCRIPT_CHARS].map((ch, i) => [ch, SCRIPT_ADVANCE[700][i]!])),
};

/** BMP script blocks Figtree draws none of: Greek and Coptic, Cyrillic and its Supplement,
 *  Armenian to Ol Chiki (Hebrew, Arabic, the Indic scripts, Thai, Georgian, Myanmar, Ethiopic,
 *  Khmer...), Cyrillic Extended-C to Vedic, Greek Extended, Coptic to Cyrillic Extended-A, Lisu to
 *  Bamum (with Cyrillic Extended-B), Syloti Nagri to Meetei Mayek, and the Hebrew and Arabic
 *  presentation forms. Left out: the Hangul jamo blocks (they compose into one wide syllable) and
 *  Latin Extended-E (U+AB30–AB6F, Latin, so the Latin letter mean). */
const SCRIPT_RANGES: Ranges = [
  [0x0370, 0x10ff], [0x1200, 0x1cff], [0x1f00, 0x1fff], [0x2c80, 0x2dff], [0xa4d0, 0xa6ff],
  [0xa800, 0xa95f], [0xa980, 0xab2f], [0xab70, 0xabff], [0xfb1d, 0xfdff], [0xfe70, 0xfefe],
];

/** Advance, per 1000 em, for a code point of SCRIPT_RANGES with no entry in the per-letter table
 *  (every script but Cyrillic and Greek, and their rarer characters). 1000 is Unifont's width: the
 *  last-resort font of the CI Playwright image draws every BMP code point an em wide or less. 1080
 *  at 700 is Windows' Sinhala word කොළඹ averaged per code point. Not a per-letter bound (Ruling
 *  52): Windows' Nirmala UI draws some single Tamil and Malayalam letters at 2–2.7em (ஔ ഐ) and
 *  Myanmar Text draws ဪ at 2.3em, so a word dense in them runs past this (ഔഷധം 15–18% short).
 *  It runs wide of most scripts — Arabic draws 0.39–0.56em. */
export const SCRIPT_EM: Record<TimelineWeight, number> = { 500: 1000, 700: 1080 };

const inRanges = (cp: number, ranges: Ranges): boolean => ranges.some(([a, b]) => cp >= a && cp <= b);

const isEmoji = (cp: number): boolean => cp > 0xffff || inRanges(cp, EMOJI_RANGES);

/** Advance, per 1000 em, for a character outside the Figtree table. */
function fallbackEm(ch: string, weight: TimelineWeight): number {
  const cp = ch.codePointAt(0)!;
  if (isEmoji(cp)) return EMOJI_EM;
  if (inRanges(cp, WIDE_RANGES)) return WIDE_EM;
  const letter = SCRIPT_ADVANCE_BY_CHAR[weight].get(ch);
  if (letter !== undefined) return letter;
  return inRanges(cp, SCRIPT_RANGES) ? SCRIPT_EM[weight] : FIGTREE_FALLBACK[weight];
}

/** Whether `cp` is in a flattened, ascending list of inclusive [start, end] pairs (grapheme-data). */
function inPairs(cp: number, pairs: readonly number[]): boolean {
  let lo = 0;
  let hi = pairs.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < pairs[2 * mid]!) hi = mid - 1;
    else if (cp > pairs[2 * mid + 1]!) lo = mid + 1;
    else return true;
  }
  return false;
}

const ZWJ = 0x200d;
const isRegionalIndicator = (cp: number): boolean => cp >= 0x1f1e6 && cp <= 0x1f1ff;
const isControl = (cp: number): boolean =>
  cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029;

/** A code point's Hangul syllable type (UAX #29 L, V, T, LV, LVT), or null. */
function hangul(cp: number): "L" | "V" | "T" | "LV" | "LVT" | null {
  if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0xa960 && cp <= 0xa97c)) return "L";
  if ((cp >= 0x1160 && cp <= 0x11a7) || (cp >= 0xd7b0 && cp <= 0xd7c6)) return "V";
  if ((cp >= 0x11a8 && cp <= 0x11ff) || (cp >= 0xd7cb && cp <= 0xd7fb)) return "T";
  if (cp >= 0xac00 && cp <= 0xd7a3) return (cp - 0xac00) % 28 === 0 ? "LV" : "LVT";
  return null;
}

/** `text` split into graphemes (user-perceived characters: a flag, a skin-toned or ZWJ emoji, a
 *  keycap, a tag sequence, a letter with its combining marks, a Hangul syllable), so a line break
 *  never cuts inside one. UAX #29's extended grapheme clusters, from tables frozen in grapheme-data.ts
 *  (scripts/gen-grapheme-data.mjs) rather than Intl.Segmenter, so every runtime — Node under the
 *  goldens, any browser — splits a line at the same points. Two rules are left out: Prepend (GB9b)
 *  and the Indic conjunct rule (GB9c), so an over-wide word in Devanagari, Bengali and the like may
 *  be hard-broken between the consonants of a conjunct (widths are unaffected). */
export function graphemes(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let prev = -1;
  let ri = 0; // regional indicators at the end of `cur`
  let pictographic = false; // `cur` ends in Extended_Pictographic Extend*
  let zwjAfterPictographic = false; // ...and then a ZWJ (GB11)
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cur && !continues(prev, cp, ri, zwjAfterPictographic)) {
      out.push(cur);
      cur = "";
      ri = 0;
      pictographic = false;
    }
    zwjAfterPictographic = cp === ZWJ && pictographic;
    // A ZWJ ends the run too: GB11 joins across exactly one, so 😀 ZWJ ZWJ 😀 is two graphemes.
    if (inPairs(cp, EXTENDED_PICTOGRAPHIC)) pictographic = true;
    else if (cp === ZWJ || !inPairs(cp, GRAPHEME_EXTEND)) pictographic = false;
    ri = isRegionalIndicator(cp) ? ri + 1 : 0;
    cur += ch;
    prev = cp;
  }
  if (cur) out.push(cur);
  return out;
}

/** Whether `cp` continues the grapheme ending in `prev` (UAX #29 GB3–GB13, less GB9b and GB9c). */
function continues(prev: number, cp: number, ri: number, zwjAfterPictographic: boolean): boolean {
  if (prev === 0x0d && cp === 0x0a) return true; // GB3
  if (isControl(prev) || isControl(cp)) return false; // GB4, GB5
  const h0 = hangul(prev);
  const h1 = hangul(cp);
  if (h0 === "L" && h1 !== null && h1 !== "T") return true; // GB6
  if ((h0 === "LV" || h0 === "V") && (h1 === "V" || h1 === "T")) return true; // GB7
  if ((h0 === "LVT" || h0 === "T") && h1 === "T") return true; // GB8
  if (cp === ZWJ || inPairs(cp, GRAPHEME_EXTEND)) return true; // GB9, GB9a
  if (zwjAfterPictographic && inPairs(cp, EXTENDED_PICTOGRAPHIC)) return true; // GB11
  return isRegionalIndicator(cp) && ri % 2 === 1; // GB12, GB13
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

/** An emoji part of an emoji grapheme: an Extended_Pictographic or emoji-class code point other than
 *  a tag character or a variation selector (U+E0000–E01EF, which draw nothing). Extended_Pictographic
 *  takes in BMP bases outside EMOJI_RANGES (© ‼ ↔ ▶), so ©️ ZWJ 🔥 counts two. */
const isEmojiPart = (cp: number): boolean =>
  (isEmoji(cp) || inPairs(cp, EXTENDED_PICTOGRAPHIC)) && !(cp >= 0xe0000 && cp <= 0xe01ef);

/** `text`'s advance, per 1000 em, a grapheme at a time. A multi-code-point grapheme led by an emoji
 *  or carrying VS16 (U+FE0F) or a keycap mark (U+20E3) is emoji: one EMOJI_EM per emoji part (at
 *  least one), so a keycap, a tag flag or a VS16 emoji is one, while a flag (two regional
 *  indicators), a skin-toned emoji (base and modifier) and a ZWJ sequence count each part. A
 *  platform whose emoji font lacks the combined glyph draws the parts side by side — Chromium on
 *  Windows 10 draws 🧑‍💻 at 2.68em, Linux an unknown flag as its two letter tiles — and even one it
 *  has can run past an em and a half (👨‍👩‍👧‍👦 1.94em). Any other grapheme sums its code points. */
function graphemesEm(text: string, weight: TimelineWeight): number {
  const table = ADVANCE[weight];
  let em = 0;
  for (const g of graphemes(text)) {
    const cps = Array.from(g, (ch) => ch.codePointAt(0)!);
    if (cps.length > 1 && (isEmoji(cps[0]!) || cps.includes(0xfe0f) || cps.includes(0x20e3))) {
      em += EMOJI_EM * Math.max(1, cps.filter(isEmojiPart).length);
      continue;
    }
    for (const ch of g) em += table.get(ch) ?? fallbackEm(ch, weight);
  }
  return em;
}
