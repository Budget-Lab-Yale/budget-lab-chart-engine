import { describe, it, expect } from "vitest";
import {
  TM_LABEL_SIZES, TM_KEY_PREFIX, treemapTier, tileFill, contrastText, fitTileLabel, fitTileLabels, fitStripLabel,
  keyEntries, wrapKey, stripFill, type TileLabel, type LabelTile,
} from "../src/engine/treemap-labels";
import { TM_GEOM } from "../src/engine/treemap-layout";
import { timelineTextWidth } from "../src/engine/timeline-text";
import { tokens } from "../src/theme/tokens";

const WHITE = tokens.structural.background;
const NAVY = tokens.structural.text_heading;
const FLAT_TIERS = ["700", "600", "500", "400", "300", "200", "100"];
const GROUPED_TIERS = ["600", "500", "400", "300", "200", "100"];
const pad = TM_GEOM.pad;

describe("treemapTier", () => {
  it("gives a single tile the darkest usable tier", () => {
    expect(treemapTier(0, 1, false)).toBe("700");
    expect(treemapTier(0, 1, true)).toBe("600");
  });
  it("spreads 7 flat tiles over 700..100, each tier once, largest darkest", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((r) => treemapTier(r, 7, false))).toEqual(FLAT_TIERS);
  });
  it("spreads 6 grouped tiles over 600..100 (700 is the header strip's)", () => {
    expect([0, 1, 2, 3, 4, 5].map((r) => treemapTier(r, 6, true))).toEqual(GROUPED_TIERS);
  });
  it("uses round(r(k-1)/(n-1)): the end ranks hit the end tiers", () => {
    expect(treemapTier(0, 2, false)).toBe("700");
    expect(treemapTier(1, 2, false)).toBe("100");
    // r=3, n=20, k=7: round(18/19) = 1.
    expect(treemapTier(3, 20, false)).toBe("600");
  });
  it("is monotone non-increasing in darkness over 20 tiles, ending at the lightest", () => {
    for (const grouped of [false, true]) {
      const tiers = grouped ? GROUPED_TIERS : FLAT_TIERS;
      const idx = Array.from({ length: 20 }, (_, r) => tiers.indexOf(treemapTier(r, 20, grouped)));
      expect(idx.every((i) => i >= 0)).toBe(true);
      for (let r = 1; r < 20; r++) expect(idx[r]!).toBeGreaterThanOrEqual(idx[r - 1]!);
      expect(idx[0]).toBe(0);
      expect(idx[19]).toBe(tiers.length - 1);
    }
  });
  it("never uses the 50 tier", () => {
    for (let n = 1; n <= 30; n++) {
      for (let r = 0; r < n; r++) {
        expect(treemapTier(r, n, false)).not.toBe("50");
        expect(treemapTier(r, n, true)).not.toBe("50");
      }
    }
  });
});

describe("tileFill", () => {
  const scales = tokens.scales as Record<string, Record<string, string>>;
  it("shades a categorical base hue along its own tonal ramp", () => {
    expect(tileFill("#0072B2", 0, 7, false, "size")).toBe(scales.blue!["700"]);
    expect(tileFill("#0072B2", 6, 7, false, "size")).toBe(scales.blue!["100"]);
    expect(tileFill("#E69F00", 0, 3, true, "size")).toBe(scales.amber!["600"]);
    expect(tileFill("#E69F00", 2, 3, true, "size")).toBe(scales.amber!["100"]);
  });
  it("is case-insensitive on the base hex", () => {
    expect(tileFill("#0072b2", 0, 1, false, "size")).toBe(scales.blue!["700"]);
  });
  it("uses the base hex itself for every tile with shading none", () => {
    for (let r = 0; r < 5; r++) expect(tileFill("#8856BF", r, 5, true, "none")).toBe("#8856BF");
  });
  it("uses a raw series colour off every ramp flat for every tile (no mixing)", () => {
    for (let r = 0; r < 5; r++) expect(tileFill("#123456", r, 5, true, "size")).toBe("#123456");
  });
});

describe("stripFill", () => {
  const scales = tokens.scales as Record<string, Record<string, string>>;
  it("is the hue family's 700 tier", () => {
    expect(stripFill("#0072B2")).toBe(scales.blue!["700"]);
    expect(stripFill("#E69F00")).toBe(scales.amber!["700"]);
  });
  it("is a raw series colour off every ramp, as-is", () => {
    expect(stripFill("#123456")).toBe("#123456");
  });
});

describe("contrastText", () => {
  it("puts white on the darkest blue and navy on the lightest", () => {
    expect(contrastText("#002B61")).toBe(WHITE);
    expect(contrastText("#95DAFF")).toBe(NAVY);
  });
  it("puts navy on blue-100, the lightest tier a tile is drawn in", () => {
    expect(contrastText((tokens.scales as Record<string, Record<string, string>>).blue!["100"]!)).toBe(NAVY);
  });
  it("puts navy on white and white on navy", () => {
    expect(contrastText("#FFFFFF")).toBe(NAVY);
    expect(contrastText(NAVY)).toBe(WHITE);
  });
  it("parses CSS4 space syntax: rgb(0 0 0) is black, so white text", () => {
    expect(contrastText("rgb(0 0 0)")).toBe(WHITE);
    expect(contrastText("hsl(0 0% 0%)")).toBe(WHITE);
  });
  it("composites a translucent fill over white before judging it", () => {
    expect(contrastText("#000000")).toBe(WHITE);
    expect(contrastText("#0000001A")).toBe(NAVY);
    expect(contrastText("rgb(0 0 0 / 10%)")).toBe(NAVY);
    expect(contrastText("rgb(0 0 0 / 0.1)")).toBe(NAVY);
    expect(contrastText("rgba(0, 0, 0, 0.1)")).toBe(NAVY);
    expect(contrastText("hsl(0 0% 0% / 10%)")).toBe(NAVY);
    expect(contrastText("transparent")).toBe(NAVY);
  });
  it("falls back to navy on an unparseable colour", () => {
    expect(contrastText("not-a-colour")).toBe(NAVY);
    expect(contrastText("")).toBe(NAVY);
  });
});

/** Every drawn line of a label, measured as it will be drawn, fits the tile's inner box. */
function assertFits(label: TileLabel, name: string, number: string | null, w: number, h: number): void {
  const iw = w - 2 * pad;
  const ih = h - 2 * pad;
  if (label.mode === "stacked") {
    expect(label.nameLines.length).toBeGreaterThan(0);
    expect(label.nameLines.length).toBeLessThanOrEqual(3);
    expect(label.nameLines.join(" ")).toBe(name); // never truncates
    expect(label.number).toBe(number);
    for (const line of label.nameLines) expect(timelineTextWidth(line, label.size, 700)).toBeLessThanOrEqual(iw);
    // The number is drawn at the name's size.
    if (number !== null) expect(timelineTextWidth(number, label.size, 500)).toBeLessThanOrEqual(iw);
    const lines = label.nameLines.length + (number !== null ? 1 : 0);
    expect(lines * label.size * 1.2).toBeLessThanOrEqual(ih);
  } else if (label.mode === "inline") {
    expect(label.text).toBe(number !== null ? `${name} ${number}` : name);
    expect(label.name).toBe(name);
    expect(label.number).toBe(number);
    const width = timelineTextWidth(name, label.size, 700) + (number !== null ? timelineTextWidth(` ${number}`, label.size, 500) : 0);
    expect(width).toBeLessThanOrEqual(iw);
    expect(label.size * 1.2).toBeLessThanOrEqual(ih);
  }
}

/** Seeded random chart: names from a budget vocabulary, a share, a value and a tile size. */
function randomChart(seed: number): { tiles: LabelTile[]; width: number } {
  let s = seed;
  const rand = (): number => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const vocab = ["Housing", "Food", "Transportation", "Health", "care", "Education", "and", "services",
    "Apparel", "Entertainment", "Personal", "insurance", "Other", "spending", "Utilities", "Cash",
    "contributions", "Alcoholic", "beverages", "Tobacco", "a", "Supercalifragilisticexpialidocious"];
  const width = 280 + rand() * 700;
  const n = 1 + Math.floor(rand() * 25);
  const noNumber = rand() < 0.2;
  const tiles = Array.from({ length: n }, (): LabelTile => {
    const nWords = 1 + Math.floor(rand() * 5);
    const name = Array.from({ length: nWords }, () => vocab[Math.floor(rand() * vocab.length)]!).join(" ");
    const value = Math.floor(rand() * 5) * 10; // coarse, so value ties occur
    // Sizes independent of value: the properties must hold for any geometry, not only a treemap's.
    return { name, number: noNumber ? null : `${(rand() * 40).toFixed(1)}%`, value, w: 10 + rand() * 400, h: 10 + rand() * 300 };
  });
  return { tiles, width };
}

describe("fitTileLabel (one size)", () => {
  it("stacks the name (700) above the number (500), both at the given size", () => {
    expect(fitTileLabel("Housing", "33.4%", 410, 510, 14)).toEqual({ mode: "stacked", size: 14, nameLines: ["Housing"], number: "33.4%" });
  });
  it("wraps a long name at spaces", () => {
    const l = fitTileLabel("Apparel and services", "2.5%", 100, 100, 14);
    expect(l.mode).toBe("stacked");
    if (l.mode !== "stacked") return;
    expect(l.nameLines.length).toBeGreaterThan(1);
    assertFits(l, "Apparel and services", "2.5%", 100, 100);
  });
  it("never stacks more than 3 name lines, however tall the tile", () => {
    // One word per line: each word fits, no two fit together.
    const word = "Wwwww";
    const w = Math.ceil(timelineTextWidth(word, 14, 700)) + 2 * pad;
    expect(timelineTextWidth(`${word} ${word}`, 14, 700)).toBeGreaterThan(w - 2 * pad);
    expect(fitTileLabel([word, word, word].join(" "), null, w, 1000, 14).mode).toBe("stacked");
    expect(fitTileLabel([word, word, word, word].join(" "), null, w, 1000, 14)).toEqual({ mode: "none" });
  });
  it("falls back to one line when stacking is too tall but the line fits", () => {
    // 20px of inner height: one 14px line (16.8px) fits, two do not.
    const l = fitTileLabel("Food", "13.0%", 140, 32, 14);
    expect(l).toEqual({ mode: "inline", size: 14, text: "Food 13.0%", name: "Food", number: "13.0%" });
    assertFits(l, "Food", "13.0%", 140, 32);
  });
  it("labels nothing when neither stacked nor inline fits at the size: it never shrinks", () => {
    expect(fitTileLabel("A".repeat(40), "1.0%", 120, 120, 12)).toEqual({ mode: "none" });
    // Fits at 12, not at 14: the 14px fit gives none rather than a smaller size.
    const iw = Math.ceil(timelineTextWidth("Education", 12, 700)) + 1;
    expect(timelineTextWidth("Education", 14, 700)).toBeGreaterThan(iw);
    expect(fitTileLabel("Education", null, iw + 2 * pad, 100, 12).mode).toBe("stacked");
    expect(fitTileLabel("Education", null, iw + 2 * pad, 100, 14)).toEqual({ mode: "none" });
  });
  it("fits the name alone when the number is null", () => {
    expect(fitTileLabel("Housing", null, 410, 510, 12)).toEqual({ mode: "stacked", size: 12, nameLines: ["Housing"], number: null });
  });
  it("labels nothing in a tile with no inner box", () => {
    expect(fitTileLabel("X", "1%", 10, 10, 12)).toEqual({ mode: "none" });
  });
});

describe("fitTileLabels: chart-level sizing", () => {
  const sizesOf = (labels: TileLabel[]): Array<number | null> => labels.map((l) => (l.mode === "none" ? null : l.size));

  it("uniform: 14px when the chart is at least 600px wide, else 12px, one size for the whole chart", () => {
    expect(TM_LABEL_SIZES).toEqual({ uniformWide: 14, uniformNarrow: 12, uniformWideAt: 600, steppedLarge: 18, steppedSmall: 13 });
    const tiles: LabelTile[] = [
      { name: "Housing", number: "33.4%", value: 30, w: 400, h: 300 },
      { name: "Food", number: "13.0%", value: 10, w: 120, h: 60 },
    ];
    expect(sizesOf(fitTileLabels(tiles, 600, "uniform"))).toEqual([14, 14]);
    expect(sizesOf(fitTileLabels(tiles, 599, "uniform"))).toEqual([12, 12]);
  });

  it("uniform: a tile that does not fit at the chart's size goes to the key, never to a smaller size", () => {
    // Education's tile is 1px wider than the name at 12px, narrower than it at 14px.
    const w = Math.ceil(timelineTextWidth("Education", 12, 700)) + 1 + 2 * pad;
    expect(timelineTextWidth("Education", 14, 700)).toBeGreaterThan(w - 2 * pad);
    const tiles: LabelTile[] = [
      { name: "Housing", number: "33.4%", value: 30, w: 400, h: 300 },
      { name: "Education", number: "2.0%", value: 5, w, h: 100 },
    ];
    expect(sizesOf(fitTileLabels(tiles, 920, "uniform"))).toEqual([14, null]);
    expect(sizesOf(fitTileLabels(tiles, 599, "uniform"))).toEqual([12, 12]);
  });

  it("stepped: 18px for the longest run of largest tiles that each fit at 18, 13px for every tile after", () => {
    const tiles: LabelTile[] = [
      { name: "Small", number: "1.0%", value: 1, w: 300, h: 300 }, // fits at 18, but follows the break
      { name: "Housing", number: "33.4%", value: 30, w: 400, h: 300 },
      { name: "Transportation", number: "16.0%", value: 20, w: 120, h: 60 }, // too narrow at 18
      { name: "Food", number: "13.0%", value: 20, w: 300, h: 300 }, // ties Transportation, after it in layout order
    ];
    expect(timelineTextWidth("Transportation", 18, 700)).toBeGreaterThan(120 - 2 * pad);
    expect(sizesOf(fitTileLabels(tiles, 920, "stepped"))).toEqual([13, 18, 13, 13]);
  });

  it("stepped: a tile that does not fit at 13px goes to the key", () => {
    const tiles: LabelTile[] = [
      { name: "Housing", number: "33.4%", value: 30, w: 400, h: 300 },
      { name: "A".repeat(40), number: "1.0%", value: 2, w: 120, h: 120 },
    ];
    expect(sizesOf(fitTileLabels(tiles, 920, "stepped"))).toEqual([18, null]);
  });

  it("property (uniform): every labelled tile in a chart shares one size, and every drawn line fits (300 charts)", () => {
    const modes = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      const { tiles, width } = randomChart(seed);
      const labels = fitTileLabels(tiles, width, "uniform");
      const want = width >= 600 ? 14 : 12;
      labels.forEach((l, i) => {
        modes.add(l.mode);
        if (l.mode !== "none") expect(l.size).toBe(want);
        const t = tiles[i]!;
        assertFits(l, t.name, t.number, t.w, t.h);
      });
    }
    expect([...modes].sort()).toEqual(["inline", "none", "stacked"]);
  });

  it("property (stepped): at most two sizes, never a larger tile with smaller text, every drawn line fits (300 charts)", () => {
    const modes = new Set<string>();
    const sizesSeen = new Set<number>();
    for (let seed = 1; seed <= 300; seed++) {
      const { tiles, width } = randomChart(seed);
      const labels = fitTileLabels(tiles, width, "stepped");
      const drawn = labels.flatMap((l, i) => (l.mode === "none" ? [] : [{ size: l.size, value: tiles[i]!.value }]));
      for (const d of drawn) sizesSeen.add(d.size);
      expect(new Set(drawn.map((d) => d.size)).size).toBeLessThanOrEqual(2);
      for (const a of drawn) for (const b of drawn) if (a.value > b.value) expect(a.size).toBeGreaterThanOrEqual(b.size);
      labels.forEach((l, i) => {
        modes.add(l.mode);
        if (l.mode !== "none") expect([18, 13]).toContain(l.size);
        const t = tiles[i]!;
        assertFits(l, t.name, t.number, t.w, t.h);
      });
    }
    expect([...modes].sort()).toEqual(["inline", "none", "stacked"]);
    expect([...sizesSeen].sort()).toEqual([13, 18]);
  });
});

describe("fitStripLabel", () => {
  const spad = TM_GEOM.stripPad;
  it("pads the strip text by its own constant, 6px", () => {
    expect(spad).toBe(6);
  });
  const avail = (bw: number): number => bw - 2 * spad;
  const full = (n: string, s: string): number => timelineTextWidth(n, 12, 700) + timelineTextWidth(` ${s}`, 12, 500);
  it("shows name and share when both fit", () => {
    expect(fitStripLabel("Housing", "33.4%", 300)).toEqual({ mode: "full", name: "Housing", share: "33.4%" });
  });
  it("drops the share first, then the label", () => {
    const name = "Transportation";
    const nameW = timelineTextWidth(name, 12, 700);
    // Wide enough for the name alone, not for name + share.
    const bw = Math.ceil(nameW + 2 * spad) + 1;
    expect(full(name, "17.0%")).toBeGreaterThan(avail(bw));
    expect(fitStripLabel(name, "17.0%", bw)).toEqual({ mode: "name", name });
    expect(fitStripLabel(name, "17.0%", Math.floor(nameW + 2 * spad) - 1)).toEqual({ mode: "none" });
  });
  it("measures exactly at the boundary (name + share at 12px within blockWidth - 2*stripPad)", () => {
    const bw = full("Food", "13.0%") + 2 * spad;
    expect(fitStripLabel("Food", "13.0%", bw + 1e-9).mode).toBe("full"); // float slack only
    expect(fitStripLabel("Food", "13.0%", bw - 0.01).mode).toBe("name");
  });
});

describe("keyEntries", () => {
  it("lists strip-less groups first, then unlabelled tiles in order", () => {
    const out = keyEntries({
      groups: [
        { name: "Housing", share: "33.4%", strip: true },
        { name: "Other spending", share: "1.1%", strip: false },
        { name: "Food", share: "13.0%", strip: false },
      ],
      tiles: [
        { group: "Housing", name: "Shelter", number: "20.0%", labelled: true },
        { group: "Housing", name: "Utilities", number: "2.0%", labelled: false },
        { group: "Other spending", name: "Misc", number: "1.1%", labelled: false },
        { group: "Food", name: "Away", number: "5.0%", labelled: true },
      ],
    });
    expect(out).toEqual([
      "Other spending: 1.1%",
      "Food: 13.0%",
      "Utilities (Housing) 2.0%",
      "Misc (Other spending) 1.1%",
    ]);
  });
  it("omits the group prefix on flat data", () => {
    const out = keyEntries({
      groups: [],
      tiles: [
        { group: null, name: "Education", number: "2.0%", labelled: false },
        { group: null, name: "Housing", number: "33.4%", labelled: true },
        { group: null, name: "Apparel and services", number: "2.5%", labelled: false },
      ],
    });
    expect(out).toEqual(["Education 2.0%", "Apparel and services 2.5%"]);
  });
  it("is empty when everything is labelled", () => {
    expect(keyEntries({ groups: [{ name: "A", share: "50%", strip: true }],
      tiles: [{ group: "A", name: "x", number: "50%", labelled: true }] })).toEqual([]);
  });
});

describe("wrapKey", () => {
  /** Width of a key line as drawn: the bold prefix (line 0 only) at 700, the rest at 500. */
  const lineWidth = (line: string, i: number): number => {
    const bold = i === 0 && line.startsWith(TM_KEY_PREFIX) ? TM_KEY_PREFIX : "";
    return timelineTextWidth(bold, 12, 700) + timelineTextWidth(line.slice(bold.length), 12, 500);
  };
  const long = "Personal insurance and pensions (Other spending) 12.0%";
  const entries = ["Other spending: 1.1%", "Utilities (Housing) 2.0%", "Education 2.0%",
    "Apparel and services 2.5%", "Entertainment 4.7%", long];
  /** The entry-level pieces of each line: line 0 without its prefix, split at the separator. */
  const pieces = (lines: string[]): string[][] => lines.map((l, i) =>
    (i === 0 ? l.slice(TM_KEY_PREFIX.length).trimStart() : l).split(" · ").filter((s) => s !== ""));
  const widths = [200, 280, 400, 600, 920];

  it("is empty with no entries", () => {
    expect(wrapKey([], 600)).toEqual([]);
  });
  it("is one line when it fits", () => {
    expect(wrapKey(["Education 2.0%"], 900)).toEqual(["Not labelled above: Education 2.0%"]);
  });
  it("starts line 0 with the whole prefix", () => {
    for (const width of widths) expect(wrapKey(entries, width)[0]!.startsWith(`${TM_KEY_PREFIX}`)).toBe(true);
  });
  it("keeps every line within the width (prefix at 700, the rest at 500)", () => {
    for (const width of widths) {
      const lines = wrapKey(entries, width);
      lines.forEach((line, i) => expect(lineWidth(line, i)).toBeLessThanOrEqual(width));
      if (width < 600) expect(lines.length).toBeGreaterThan(1);
    }
  });
  it("never starts or ends a line with the separator", () => {
    for (const width of widths) {
      for (const line of wrapKey(entries, width)) {
        expect(line.startsWith("·")).toBe(false);
        expect(line.trimEnd().endsWith("·")).toBe(false);
      }
    }
  });
  it("keeps every entry that fits a line whole on one line", () => {
    for (const width of widths) {
      const all = pieces(wrapKey(entries, width)).flat();
      for (const e of entries) if (lineWidth(e, 1) <= width) expect(all).toContain(e);
    }
  });
  it("breaks between entries, dropping the separator at the break", () => {
    const one = lineWidth(`${TM_KEY_PREFIX} Education 2.0%`, 0);
    expect(lineWidth(`${TM_KEY_PREFIX} Education 2.0% · Housing 33.4%`, 0)).toBeGreaterThan(one + 0.5);
    expect(wrapKey(["Education 2.0%", "Housing 33.4%"], one + 0.5))
      .toEqual(["Not labelled above: Education 2.0%", "Housing 33.4%"]);
  });
  it("breaks an entry at its own spaces only when it is wider than a whole line", () => {
    expect(lineWidth(long, 1)).toBeGreaterThan(200);
    const lines = wrapKey(entries, 200);
    expect(pieces(lines).flat()).not.toContain(long);
    lines.forEach((line, i) => expect(lineWidth(line, i)).toBeLessThanOrEqual(200));
  });
  it("hard-breaks a single word wider than the line into chunks, each within the width", () => {
    const word = "W".repeat(100);
    const lines = wrapKey([`${word} 0.0%`, "Education 2.0%"], 280);
    expect(lines.length).toBeGreaterThan(3);
    lines.forEach((line, i) => expect(lineWidth(line, i)).toBeLessThanOrEqual(280));
    // Only the over-wide word is split: its chunks rejoin to the word, and the rest stays whole.
    expect(lines.slice(1).join("").includes(word)).toBe(true);
    expect(pieces(lines).flat()).toContain("Education 2.0%");
  });
  it("loses no text apart from separators dropped at breaks", () => {
    for (const width of widths) {
      const lines = wrapKey(entries, width);
      expect(lines.join(" ").replace(/ · /g, " ")).toBe(`${TM_KEY_PREFIX} ${entries.join(" ")}`);
    }
  });
  it("measures the prefix bold: a width that fits it at 500 but not 700 still wraps", () => {
    const w500 = timelineTextWidth(`${TM_KEY_PREFIX} Education 2.0%`, 12, 500);
    const drawn = lineWidth(`${TM_KEY_PREFIX} Education 2.0%`, 0);
    expect(drawn).toBeGreaterThan(w500);
    expect(wrapKey(["Education 2.0%"], (w500 + drawn) / 2)).toEqual([TM_KEY_PREFIX, "Education 2.0%"]);
  });
});
