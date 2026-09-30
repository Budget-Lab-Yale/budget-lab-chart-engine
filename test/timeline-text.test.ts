import { describe, it, expect } from "vitest";
import { timelineTextWidth, WIDE_EM, ASTRAL_EM } from "../src/engine/timeline-text";
import { FIGTREE_ADVANCE, FIGTREE_CHARS, FIGTREE_FALLBACK } from "../src/engine/timeline-metrics";
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

  it("measures a character outside the table at the fallback advance, an em if it is wide, 1.4em if astral", () => {
    expect(timelineTextWidth("ק", 1000, 500)).toBeCloseTo(FIGTREE_FALLBACK[500], 9);
    expect(timelineTextWidth("ｱ", 1000, 500)).toBeCloseTo(FIGTREE_FALLBACK[500], 9); // halfwidth katakana
    // BMP East Asian Wide/Fullwidth: an em in Chromium's fallback fonts (中 한 Ａ 1em), far past the
    // 0.58em letter mean.
    expect(WIDE_EM).toBe(1000);
    for (const ch of ["中", "한", "Ａ", "、"]) expect(timelineTextWidth(ch, 1000, 700), ch).toBeCloseTo(WIDE_EM, 9);
    expect(timelineTextWidth("中文 title", 12, 500)).toBeCloseTo(2 * 12 + timelineTextWidth(" title", 12, 500), 9);
    // Astral (emoji, supplementary CJK; one code point, one advance): Chromium draws 😀 at 1.37em, so
    // the estimate must be at least that or an emoji-heavy line overflows the column it was wrapped to
    // (Ruling 48).
    expect(ASTRAL_EM).toBe(1400);
    for (const w of [500, 700] as const) {
      for (const ch of ["😀", "𠀀"]) expect(timelineTextWidth(ch, 1000, w), ch).toBeCloseTo(ASTRAL_EM, 9);
      expect(timelineTextWidth("😀", 12, w)).toBeGreaterThanOrEqual(1.37 * 12);
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
