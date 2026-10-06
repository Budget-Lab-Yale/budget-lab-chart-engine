import { describe, it, expect } from "vitest";
import { timelineTextWidth, graphemes, WIDE_EM, EMOJI_EM } from "../src/engine/timeline-text";
import { FIGTREE_ADVANCE, FIGTREE_CHARS, FIGTREE_FALLBACK } from "../src/engine/timeline-metrics";
import { SCRIPT_CHARS } from "../src/engine/script-metrics";
import { layoutTimeline, LINE_STYLE, type LayoutEvent } from "../src/engine/timeline-layout";

const adv = (ch: string, w: 500 | 700): number => FIGTREE_ADVANCE[w][[...FIGTREE_CHARS].indexOf(ch)]!;

describe("timelineTextWidth (Ruling 45)", () => {
  it("sums the table's per-character advances, scaled to the font size", () => {
    expect(timelineTextWidth("", 13, 700)).toBe(0);
    expect(timelineTextWidth("A", 1000, 500)).toBeCloseTo(adv("A", 500), 9);
    expect(timelineTextWidth("Ab –", 12, 700)).toBeCloseTo(((adv("A", 700) + adv("b", 700) + adv(" ", 700) + adv("–", 700)) * 12) / 1000, 9);
    expect(timelineTextWidth("2026", 26, 500)).toBeCloseTo(2 * timelineTextWidth("2026", 13, 500), 9);
  });

  it("measures bold with the bold table, not a factor", () => {
    expect(timelineTextWidth("Dec 2017", 13, 700)).not.toBeCloseTo(timelineTextWidth("Dec 2017", 13, 500) * 1.08, 1);
    expect(timelineTextWidth("Dec 2017", 13, 700)).toBeGreaterThan(timelineTextWidth("Dec 2017", 13, 500));
  });

  it("covers the characters timelines emit or commonly contain", () => {
    for (const ch of ["–", "—", "’", "“", "”", "…", "·", " ", "é", "ñ"]) expect(FIGTREE_CHARS).toContain(ch);
    expect(FIGTREE_CHARS.length).toBe(new Set(FIGTREE_CHARS).size);
    for (const w of [500, 700] as const) expect(FIGTREE_ADVANCE[w]).toHaveLength([...FIGTREE_CHARS].length);
  });

  it("measures a character outside the table at the fallback advance, an em if it is wide, 1.4em if emoji", () => {
    expect(timelineTextWidth("ｱ", 1000, 500)).toBeCloseTo(FIGTREE_FALLBACK[500], 9); // halfwidth katakana
    // BMP East Asian Wide/Fullwidth: an em in Chromium's fallback fonts (中 한 Ａ 1em), far past the
    // 0.58em letter mean.
    expect(WIDE_EM).toBe(1000);
    for (const ch of ["中", "한", "Ａ", "、"]) expect(timelineTextWidth(ch, 1000, 700), ch).toBeCloseTo(WIDE_EM, 9);
    expect(timelineTextWidth("中文 title", 12, 500)).toBeCloseTo(2 * 12 + timelineTextWidth(" title", 12, 500), 9);
    // Astral (emoji, supplementary CJK; one code point, one advance) and the BMP emoji/symbol blocks:
    // Chromium draws 😀 at 1.37em and ✅ ⭐ ☀ ⌛ at ~1.3em, so the estimate must be at least that or
    // an emoji-heavy line overflows the column it was wrapped to (Rulings 48, 49).
    expect(EMOJI_EM).toBe(1400);
    for (const w of [500, 700] as const) {
      for (const ch of ["😀", "𠀀", "✅", "⭐", "☀", "⌛", "⌀", "⏿", "☀", "➿", "⬀", "⯿"]) {
        expect(timelineTextWidth(ch, 1000, w), ch).toBeCloseTo(EMOJI_EM, 9);
      }
      expect(timelineTextWidth("😀", 12, w)).toBeGreaterThanOrEqual(1.37 * 12);
      for (const ch of ["✅", "⭐", "☀"]) expect(timelineTextWidth(ch, 12, w), ch).toBeGreaterThanOrEqual(1.3 * 12);
      // Just outside each block: the letter-mean fallback.
      for (const ch of ["⋿", "␀", "◿", "⟀", "⫿", "Ⰰ"]) {
        expect(timelineTextWidth(ch, 1000, w), ch).toBeCloseTo(FIGTREE_FALLBACK[w], 9);
      }
    }
  });

  // Chromium-rendered widths (getComputedTextLength, the embedded Figtree @font-face, kerning on),
  // recorded by the Task 16b accuracy script. The estimator must track the real font: the old
  // 0.55em × 1.08 estimate is 11–76% off on these.
  it.each([
    ["Dec 22, 2017 – Dec 31, 2025", 13, 700, 166.67],
    ["September 30, 2026", 13, 700, 122.64],
    ["2026 – 2030", 13, 700, 75.97],
    ["Tax Cuts and Jobs Act signed", 12, 500, 159.41],
    ["WWW MMM", 12, 500, 68.31],
    ["illicit little lilies", 12, 500, 78.56],
    ["Most individual provisions expire after 2025.", 11, 500, 218.66],
    ["Proposed legislation", 12, 700, 111.81],
    ["2020", 10.5, 500, 25.36],
  ] as const)("%s at %ipx/%i is within 1%% of Chromium", (text, size, weight, px) => {
    expect(Math.abs(timelineTextWidth(text, size, weight) - px) / px).toBeLessThan(0.01);
  });
});

describe("timeline layout measures with timelineTextWidth", () => {
  const ev = (id: number, start: string, dateText: string, title: string): LayoutEvent => ({
    id, start: new Date(start), end: null, ongoing: false, category: "a", dateText, title, description: null, projected: false,
  });
  const base = { spacing: "proportional" as const, lanes: null, axis: false, labelWidth: 150, maxRows: 3 };

  it("a label box is exactly as wide as its widest line, in each role's weight", () => {
    for (const orientation of ["horizontal", "vertical"] as const) {
      const l = layoutTimeline({ ...base, orientation, width: 600, events: [ev(0, "2020-01-01", "Dec 22, 2017 – Dec 31, 2025", "illicit little lilies")] });
      const lab = l.labels[0]!;
      const w = Math.max(...lab.lines.map((ln) => timelineTextWidth(ln.text, LINE_STYLE[ln.role].size, LINE_STYLE[ln.role].bold ? 700 : 500)));
      expect(lab.box.x1 - lab.box.x0).toBeCloseTo(w, 9);
    }
  });

  it("a title wraps at the measured width, not the estimate", () => {
    // 150px holds "illicit little lilies illicit" in Figtree (~118px) though 0.55em puts it at 191px.
    const l = layoutTimeline({ ...base, orientation: "horizontal", width: 600, events: [ev(0, "2020-01-01", "2020", "illicit little lilies illicit")] });
    expect(l.labels[0]!.lines.filter((ln) => ln.role === "title").map((ln) => ln.text)).toEqual(["illicit little lilies illicit"]);
  });
});

// F5: text the calibrated Figtree table does not cover. Chromium-rendered widths in px at 1000px
// (canvas measureText, the embedded Figtree first in the engine's stack), at 500 and 700, recorded
// 2026-10-06: for each string the WIDEST of its renderings with Segoe UI, Source Sans 3, Arial,
// Roboto, Noto Sans and DejaVu Sans as the fallback that draws the script (Cyrillic and Greek; the
// other scripts only where those fonts cover them, else Windows' own fallback). The estimate may run
// wide of a narrower font but is never more than 2% short of the widest.
describe("scripts Figtree lacks, emoji clusters and emoji-presentation symbols (F5)", () => {
  it.each([
    ["Федеральный бюджет на 2026 год", 18011.9, 19658.9],
    ["Министерство финансов", 12952.5, 14046.2],
    ["Бюджет", 4317.9, 4795],
    ["Москва", 3830.6, 4261.3],
    ["США", 2451.7, 2743.2],
    ["ЖКХ", 2472.2, 2812.5],
    ["МВФ", 2414, 2749.1],
    ["НАЛОГОВАЯ РЕФОРМА", 11713.8, 13082.8],
    ["Рост ВВП в США", 8244.3, 9043.6],
    ["щи", 1591.8, 1806.2],
    ["мышь", 3048.4, 3416.1],
    ["Κρατικός προϋπολογισμός για το 2026", 19041.1, 21149.1],
    ["Αθήνα", 3147.5, 3541.1],
    ["ΦΠΑ", 2254, 2461],
    ["ΗΠΑ", 2188, 2447.8],
    ["ΦΟΡΟΛΟΓΙΚΗ ΜΕΤΑΡΡΥΘΜΙΣΗ", 14874.4, 16827.9],
    ["ψωμί", 2583, 2788.6],
    ["Երևան", 3785.2, 3764.7],
    ["თბილისი", 5029.8, 5299.4],
    ["תקציב המדינה", 6352, 6647.7],
    ["صندوق النقد الدولي", 8253.2, 9672.3],
    ["नई दिल्ली", 3721.1, 4027.6],
    ["சென்னை", 5366.7, 5667],
    ["කොළඹ", 3779.8, 4314],
    ["തിരുവനന്തപുരം", 9162.6, 10331.1],
    ["กรุงเทพมหานคร", 6682.7, 7423.9],
  ] as const)("%s measures within 2%% of its widest rendering, or wider", (text, px500, px700) => {
    expect(timelineTextWidth(text, 1000, 500)).toBeGreaterThanOrEqual(0.98 * px500);
    expect(timelineTextWidth(text, 1000, 700)).toBeGreaterThanOrEqual(0.98 * px700);
  });

  it("keeps a multi-code-point emoji, and a letter with its combining mark, one grapheme", () => {
    expect(graphemes("a🇺🇸👍🏽1️⃣🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}👨‍👩‍👧éж")).toEqual([
      "a", "🇺🇸", "👍🏽", "1️⃣", "🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}", "👨‍👩‍👧", "é", "ж",
    ]);
    expect(graphemes("")).toEqual([]);
  });

  it("splits graphemes as Intl.Segmenter does, from built-in tables, whatever the runtime has", () => {
    // UAX #29 less the Indic conjunct rule (GB9c) and Prepend (GB9b): those words may break inside a
    // conjunct, the same way in every runtime.
    const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
    const corpus = [
      "Tax Cuts and Jobs Act – 2017", "a\r\nb\u0007c", "🇺🇸🇬🇧🇺", "🇺🇸👍🏽".repeat(4), "👨‍👩‍👧‍👦 🧑‍💻 ❤️‍🔥 🏳️‍🌈 🧔🏻‍♂️ 👩🏾‍🚀",
      "1️⃣#️⃣*️⃣ ▶️ ↔️ ©️ ☝🏿 ✊🏽", "🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}x", "é̂ö",
      "Закон о налогах ёлка й", "Κρατικός προϋπολογισμός ᾄ", "שָׁלוֹם", "مِيزَانِيَّة", "การปฏิรูปภาษีนำ",
      "한국어 각가", "‍́a", "a‍👍", "👍‍a",
    ];
    for (const s of corpus) expect(graphemes(s), s).toEqual(Array.from(seg.segment(s), (x) => x.segment));
  });

  it("joins an emoji across one ZWJ only (GB11), as Intl.Segmenter does", () => {
    const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
    const Z = "‍";
    const corpus = [
      `😀${Z}${Z}😀`, `😀${Z}😀`, `😀${Z}😀${Z}😀`, `😀́${Z}😀`, `😀${Z}́${Z}😀`, `😀${Z}́😀`,
      `©️${Z}${Z}🔥`, `❤️${Z}🔥${Z}${Z}❤️`, `a${Z}${Z}😀`,
    ];
    for (const s of corpus) expect(graphemes(s), s).toEqual(Array.from(seg.segment(s), (x) => x.segment));
    expect(graphemes(`😀${Z}${Z}😀`)).toEqual([`😀${Z}${Z}`, "😀"]);
  });

  it("measures a flag, a skin-toned emoji and a ZWJ sequence one emoji glyph per emoji part", () => {
    // A platform whose emoji font lacks the combined glyph draws the parts side by side: Chromium on
    // Windows 10 draws 🧑‍💻 at 2.68em and ❤️‍🔥 at 2.47em, and on Linux an unsupported flag is its two
    // letter tiles. Even a sequence the font has can run past one glyph (👨‍👩‍👧‍👦 1.94em).
    for (const w of [500, 700] as const) {
      for (const [e, parts] of [
        ["🇺🇸", 2], ["🇦🇦", 2], ["👍🏽", 2], ["☝🏿", 2], ["👨‍👩‍👧", 3], ["👨‍👩‍👧‍👦", 4], ["🧑‍💻", 2], ["❤️‍🔥", 2],
        ["🧔🏻‍♂️", 3], ["👩🏾‍🚀", 3], ["🏳️‍🌈", 2],
        // A BMP pictographic base outside the emoji blocks is a part too: © ️ ZWJ 🔥 draws as two.
        ["©️‍🔥", 2], ["‼️‍🔥", 2],
      ] as const) {
        expect(timelineTextWidth(e, 1000, w), e).toBeCloseTo(parts * EMOJI_EM, 9);
      }
      expect(timelineTextWidth("🇺🇸🇬🇧 2026", 12, w)).toBeCloseTo((4 * EMOJI_EM * 12) / 1000 + timelineTextWidth(" 2026", 12, w), 9);
    }
  });

  it("measures a keycap, a tag flag and a VS16 emoji as one emoji glyph", () => {
    // Chromium: 1️⃣ #️⃣ ❤️ ▶️ 1.37em, 🏴 Scotland 1.30em — the joiners, selectors and tags draw nothing.
    for (const w of [500, 700] as const) {
      for (const e of ["1️⃣", "#️⃣", "❤️", "▶️", "↔️", "🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}"]) {
        expect(timelineTextWidth(e, 1000, w), e).toBeCloseTo(EMOJI_EM, 9);
      }
    }
  });

  it("measures ◽ ◾ and every other BMP emoji-presentation symbol as emoji", () => {
    // Chromium draws ◽ ◾ 0.60em in Windows' symbol font but 0.73em in DejaVu Sans, and from the
    // colour emoji font (~1.37em) where that has them as emoji-presentation characters.
    const table = new Set(FIGTREE_CHARS);
    let n = 0;
    for (let cp = 0x80; cp <= 0xffff; cp++) {
      const ch = String.fromCodePoint(cp);
      if (!/\p{Emoji_Presentation}/u.test(ch) || table.has(ch)) continue;
      n++;
      for (const w of [500, 700] as const) expect(timelineTextWidth(ch, 1000, w), ch).toBeCloseTo(EMOJI_EM, 9);
    }
    expect(n).toBeGreaterThan(50); // 60 in Unicode 15
    for (const ch of ["◽", "◾"]) expect(timelineTextWidth(ch, 1000, 500), ch).toBeCloseTo(EMOJI_EM, 9);
  });

  it("leaves text the table covers measured per character, as before", () => {
    // Latin text never reaches the grapheme path: a string of table characters sums their advances.
    const s = "Tax Cuts and Jobs Act – 2017";
    for (const w of [500, 700] as const) {
      expect(timelineTextWidth(s, 1000, w)).toBeCloseTo([...s].reduce((a, ch) => a + adv(ch, w), 0), 9);
    }
  });
});

// Ruling 51: Cyrillic and Greek letters measure from a per-letter table of the widest advance among
// common fallback fonts (src/engine/script-metrics.ts), and every other script Figtree lacks at a
// conservative constant. The floors here are read independently from the fonts' own hmtx tables
// (fontTools): per letter the widest of Arial, Liberation Sans, DejaVu Sans, FreeSans and Segoe UI,
// regular at 500 (where those fonts have no 500 face) and bold at 700.
describe("per-letter Cyrillic and Greek, a conservative constant for other scripts (Ruling 51)", () => {
  const FLOOR: Record<string, [number, number]> = {
    "ω": [837.4, 869.1], "Щ": [1093.8, 1325.7], "Ж": [1077.1, 1224.1], "ш": [915, 1062], "Ю": [1079.6, 1173.8], "Ω": [764.2, 850.1],
    // Cyrillic Extended-B, Segoe UI regular and bold (F5 fix round 2).
    "Ꚙ": [1330.5, 1278.3], "Ꙍ": [1128.9, 1152.3],
  };
  it.each(Object.entries(FLOOR))("%s measures no narrower than its widest font", (ch, [f500, f700]) => {
    expect(timelineTextWidth(ch, 1000, 500)).toBeGreaterThanOrEqual(f500);
    expect(timelineTextWidth(ch, 1000, 700)).toBeGreaterThanOrEqual(f700);
  });

  // Ruling 57: at weight 500 on Windows, Chromium draws Segoe UI Semibold (600; there is no 500
  // face), so a 500 entry is never narrower than Semibold's advance. hmtx of seguisb.ttf (fontTools),
  // rounded down to 0.1: the generator used to measure Regular there, and these three were short.
  it.each([["И", 767.5], ["ю", 844.7], ["ꙇ", 395.5]] as const)(
    "%s at 500 measures no narrower than Segoe UI Semibold (%s)",
    (ch, semibold) => {
      expect(timelineTextWidth(ch, 1000, 500)).toBeGreaterThanOrEqual(semibold);
    },
  );

  it.each(["ω", "Щ"])("a title of 30 %s wraps inside a 280px frame at its widest font's advance", (ch) => {
    const title = ch.repeat(30);
    const e: LayoutEvent = { id: 0, start: new Date("2020-01-01"), end: null, ongoing: false, category: "a", dateText: "2020", title, description: null, projected: false };
    const l = layoutTimeline({ events: [e], width: 280, orientation: "vertical", spacing: "proportional", lanes: null, axis: false, labelWidth: 150, maxRows: 3 });
    const lab = l.labels[0]!;
    const lines = lab.lines.filter((ln) => ln.role === "title");
    expect(lines.map((ln) => ln.text).join("")).toBe(title);
    expect(lines.length).toBeGreaterThan(1);
    expect(lab.box.x0).toBeGreaterThanOrEqual(0);
    expect(lab.box.x1).toBeLessThanOrEqual(280 + 1e-6);
    const st = LINE_STYLE.title;
    const floor = FLOOR[ch]![st.bold ? 1 : 0];
    for (const ln of lines) expect(([...ln.text].length * floor * st.size) / 1000, ln.text).toBeLessThanOrEqual(lab.box.x1 - lab.box.x0 + 1e-6);
  });

  it("measures every other script Figtree lacks at no less than an em a code point, Unifont's width", () => {
    // Unifont, the Playwright Linux image's last-resort font, draws these an em wide; Windows draws the
    // Sinhala word කොළඹ at 1.08em a code point at 700. Not a bound on every font (Ruling 52).
    for (const ch of ["Ա", "א", "ب", "क", "ক", "த", "മ", "ක", "ก", "ሀ", "ა", "ܐ", "ᠮ", "က", "ក", "ཀ", "Ꭰ", "ᐃ"]) {
      expect(timelineTextWidth(ch, 1000, 500), ch).toBeGreaterThanOrEqual(1000);
      expect(timelineTextWidth(ch, 1000, 700), ch).toBeGreaterThanOrEqual(1000);
    }
    expect(timelineTextWidth("කොළඹ", 1000, 700)).toBeGreaterThanOrEqual(4314);
  });

  it("measures every Cyrillic Extended-B and -C letter from the per-letter table", () => {
    // Extended-A (U+2DE0-2DFF) is all combining marks, which the table leaves out.
    const table = new Set(SCRIPT_CHARS);
    const letters: string[] = [];
    for (const [a, b] of [[0xa640, 0xa69f], [0x1c80, 0x1c88]] as const) {
      for (let cp = a; cp <= b; cp++) {
        const ch = String.fromCodePoint(cp);
        if (!/\p{M}/u.test(ch)) letters.push(ch);
      }
    }
    expect(letters.length).toBeGreaterThan(80);
    for (const ch of letters) expect(table.has(ch), ch).toBe(true);
  });

  it("leaves Latin Extended-E at the Latin letter mean", () => {
    for (const w of [500, 700] as const) expect(timelineTextWidth("ꬰ", 1000, w)).toBeCloseTo(FIGTREE_FALLBACK[w], 9);
  });
});
