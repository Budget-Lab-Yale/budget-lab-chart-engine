import { describe, it, expect } from "vitest";
import {
  TM_LABEL_SIZES, treemapLabelSize, treemapStripHeight, treemapTier, tileFill, contrastText, fitTileLabel, fitTileLabels, fitStripLabel,
  stripFill, fitNumberOnly, type TileLabel, type LabelTile,
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
    // Inline always carries a number: a name alone that fits one line already fits stacked.
    expect(number).not.toBeNull();
    expect(label.text).toBe(`${name} ${number}`);
    expect(label.name).toBe(name);
    expect(label.number).toBe(number);
    const width = timelineTextWidth(name, label.size, 700) + timelineTextWidth(` ${number}`, label.size, 500);
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
  const groups = rand() < 0.5 ? [null] : ["G1", "G2", "G3"];
  const tiles = Array.from({ length: n }, (): LabelTile => {
    const group = groups[Math.floor(rand() * groups.length)]!;
    const nWords = 1 + Math.floor(rand() * 5);
    const name = Array.from({ length: nWords }, () => vocab[Math.floor(rand() * vocab.length)]!).join(" ");
    const value = Math.floor(rand() * 5) * 10; // coarse, so value ties occur
    // Sizes independent of value: the properties must hold for any geometry, not only a treemap's.
    return { name, group, number: noNumber ? null : `${(rand() * 40).toFixed(1)}%`, value, w: 10 + rand() * 400, h: 10 + rand() * 300 };
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

describe("treemapLabelSize", () => {
  it("is 14px on a chart at least 600px wide, else 12px", () => {
    expect(TM_LABEL_SIZES).toEqual({ wide: 14, narrow: 12, wideAt: 600, small: 11, smallBelow: 400 });
    expect([280, 599, 599.99, 600, 920].map(treemapLabelSize)).toEqual([12, 12, 12, 14, 14]);
  });
});

describe("fitTileLabels: one size, top-down per group", () => {
  const sizesOf = (labels: TileLabel[]): Array<number | null> => labels.map((l) => (l.mode === "none" ? null : l.size));
  const tile = (name: string, value: number, w: number, h: number, group: string | null = null): LabelTile =>
    ({ name, group, number: "1.0%", value, w, h });
  // Education's tile is 1px wider than the name at 12px, narrower than it at 14px.
  const eduW = Math.ceil(timelineTextWidth("Education", 12, 700)) + 1 + 2 * pad;

  it("draws every label in the chart at the one size it is given", () => {
    const tiles = [tile("Housing", 30, 400, 300), tile("Food", 10, 120, 60)];
    expect(sizesOf(fitTileLabels(tiles, 14))).toEqual([14, 14]);
    expect(sizesOf(fitTileLabels(tiles, 12))).toEqual([12, 12]);
  });

  it("a tile that does not fit at that size is unlabelled, never drawn smaller", () => {
    expect(timelineTextWidth("Education", 14, 700)).toBeGreaterThan(eduW - 2 * pad);
    const tiles = [tile("Housing", 30, 400, 300), tile("Education", 5, eduW, 100)];
    expect(sizesOf(fitTileLabels(tiles, 14))).toEqual([14, null]);
    expect(sizesOf(fitTileLabels(tiles, 12))).toEqual([12, 12]);
  });

  it("stops at the first tile, by value, whose label does not fit: every smaller tile in its group is unlabelled too", () => {
    // Listed out of value order: the visit order is by value, not by position.
    const tiles = [
      tile("Small", 1, 300, 300), // fits, but is smaller than Education
      tile("Housing", 30, 400, 300),
      tile("Education", 5, eduW, 100), // does not fit at 14
      tile("Food", 10, 300, 300),
    ];
    expect(sizesOf(fitTileLabels(tiles, 14))).toEqual([null, 14, null, 14]);
    // At 12 Education fits, so the walk reaches Small.
    expect(sizesOf(fitTileLabels(tiles, 12))).toEqual([12, 12, 12, 12]);
  });

  it("breaks value ties by input (layout) order", () => {
    const tiles = [tile("Education", 5, eduW, 100), tile("Food", 5, 300, 300)];
    expect(sizesOf(fitTileLabels(tiles, 14))).toEqual([null, null]);
    expect(sizesOf(fitTileLabels([tiles[1]!, tiles[0]!], 14))).toEqual([14, null]);
  });

  it("walks each group on its own: a group's tiles are not compared with another group's", () => {
    const tiles = [
      tile("Housing", 30, 400, 300, "A"),
      tile("Education", 20, eduW, 100, "A"), // stops group A
      tile("Food", 10, 300, 300, "A"),
      tile("Fuel", 5, 300, 300, "B"), // smaller than A's unlabelled tiles, still labelled
    ];
    expect(sizesOf(fitTileLabels(tiles, 14))).toEqual([14, null, null, 14]);
  });

  it("property: one size; in each group the labelled tiles are exactly the run, by value, that fit (400 charts)", () => {
    const modes = new Set<string>();
    let cut = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const { tiles, width } = randomChart(seed);
      const size = treemapLabelSize(width);
      const labels = fitTileLabels(tiles, size);
      labels.forEach((l, i) => {
        modes.add(l.mode);
        if (l.mode !== "none") expect(l.size).toBe(size);
        const t = tiles[i]!;
        assertFits(l, t.name, t.number, t.w, t.h);
      });
      for (const g of new Set(tiles.map((t) => t.group))) {
        const idx = tiles.map((_, i) => i).filter((i) => tiles[i]!.group === g)
          .sort((a, b) => tiles[b]!.value - tiles[a]!.value || a - b);
        const labelled = idx.map((i) => labels[i]!.mode !== "none");
        const run = labelled.indexOf(false) === -1 ? labelled.length : labelled.indexOf(false);
        // No unlabelled tile has a larger value than a labelled one in its group.
        for (const a of idx) for (const b of idx) {
          if (labels[a]!.mode === "none" && labels[b]!.mode !== "none") expect(tiles[a]!.value).toBeLessThanOrEqual(tiles[b]!.value);
        }
        expect(labelled.slice(run).every((x) => !x)).toBe(true);
        if (run < idx.length) {
          const first = tiles[idx[run]!]!;
          expect(fitTileLabel(first.name, first.number, first.w, first.h, size).mode).toBe("none");
          if (idx.slice(run + 1).some((i) => fitTileLabel(tiles[i]!.name, tiles[i]!.number, tiles[i]!.w, tiles[i]!.h, size).mode !== "none")) cut++;
        }
      }
    }
    expect([...modes].sort()).toEqual(["inline", "none", "stacked"]);
    // The walk really stopped short of tiles that would have fitted on their own.
    expect(cut).toBeGreaterThan(10);
  });
});

describe("fitNumberOnly", () => {
  it("is the number alone (no name lines) where it fits at the size, else none", () => {
    expect(fitNumberOnly("13.5%", 200, 100, 14)).toEqual({ mode: "stacked", size: 14, nameLines: [], number: "13.5%" });
    const w = Math.ceil(timelineTextWidth("13.5%", 14, 500)) + 2 * pad;
    expect(fitNumberOnly("13.5%", w, 100, 14).mode).toBe("stacked");
    expect(fitNumberOnly("13.5%", w - 1, 100, 14)).toEqual({ mode: "none" });
    expect(fitNumberOnly("13.5%", 200, 14 * 1.2 + 2 * pad - 0.1, 14)).toEqual({ mode: "none" });
    expect(fitNumberOnly(null, 200, 100, 14)).toEqual({ mode: "none" });
  });
});

describe("fitStripLabel", () => {
  const spad = TM_GEOM.stripPad;
  it("pads the strip text by its own constant, 6px", () => {
    expect(spad).toBe(6);
  });
  const avail = (bw: number): number => bw - 2 * spad;
  const full = (n: string, s: string, size: number): number => timelineTextWidth(n, size, 700) + timelineTextWidth(` ${s}`, size, 500);
  it("shows name and share when both fit", () => {
    expect(fitStripLabel("Housing", "33.4%", 300, 14)).toEqual({ mode: "full", name: "Housing", share: "33.4%" });
  });
  it("drops the share first, then the label", () => {
    const name = "Transportation";
    for (const size of [12, 14]) {
      const nameW = timelineTextWidth(name, size, 700);
      // Wide enough for the name alone, not for name + share.
      const bw = Math.ceil(nameW + 2 * spad) + 1;
      expect(full(name, "17.0%", size)).toBeGreaterThan(avail(bw));
      expect(fitStripLabel(name, "17.0%", bw, size)).toEqual({ mode: "name", name });
      expect(fitStripLabel(name, "17.0%", Math.floor(nameW + 2 * spad) - 1, size)).toEqual({ mode: "none" });
    }
  });
  it("measures at the given size, exactly at the boundary (name + share within blockWidth - 2*stripPad)", () => {
    for (const size of [12, 14]) {
      const bw = full("Food", "13.0%", size) + 2 * spad;
      expect(fitStripLabel("Food", "13.0%", bw + 1e-9, size).mode).toBe("full"); // float slack only
      expect(fitStripLabel("Food", "13.0%", bw - 0.01, size).mode).toBe("name");
    }
    // A width that holds the text at 12px but not at 14px.
    const bw12 = full("Food", "13.0%", 12) + 2 * spad;
    expect(fitStripLabel("Food", "13.0%", bw12, 14).mode).toBe("name");
  });
});

describe("treemapStripHeight", () => {
  it("is 22px at 12px text, scaled with the text and rounded: 26px at 14px", () => {
    expect(treemapStripHeight(12)).toBe(22);
    expect(treemapStripHeight(14)).toBe(26);
  });
});
