import { describe, it, expect } from "vitest";
import {
  TM_LABEL_SIZES, treemapLabelSize, treemapBand, treemapShades, tileFill, contrastText, fitTileLabel, fitTileLabels,
  type TileLabel, type LabelTile,
} from "../src/engine/treemap-labels";
import { TM_GEOM } from "../src/engine/treemap-layout";
import { timelineTextWidth } from "../src/engine/timeline-text";
import { tokens } from "../src/theme/tokens";
import { d3 } from "../src/engine/vendor";

const WHITE = tokens.structural.background;
const NAVY = tokens.structural.text_heading;
const pad = TM_GEOM.pad;

describe("treemapBand", () => {
  const scales = tokens.scales as Record<string, Record<string, string>>;
  const tiers = (family: string, keys: string[]) => keys.map((k) => scales[family]![k]!);
  it("is the 4 tiers around a colour's place on its ramp, one darker and two lighter, darkest first", () => {
    // The categorical blue base sits nearest blue-400.
    expect(treemapBand("#0072B2")).toEqual(tiers("blue", ["500", "400", "300", "200"]));
    expect(treemapBand("#0072b2")).toEqual(tiers("blue", ["500", "400", "300", "200"]));
  });
  it("gives a light repeat (group 8 on) and a series_colors tier their own band", () => {
    expect(treemapBand(scales.blue!["200"]!)).toEqual(tiers("blue", ["300", "200", "100", "50"]));
    expect(treemapBand(scales.violet!["300"]!)).toEqual(tiers("violet", ["400", "300", "200", "100"]));
  });
  it("is clamped at either end of the ramp and keeps 4 tiers", () => {
    expect(treemapBand(scales.blue!["700"]!)).toEqual(tiers("blue", ["700", "600", "500", "400"]));
    expect(treemapBand(scales.amber!["600"]!)).toEqual(tiers("amber", ["700", "600", "500", "400"]));
    expect(treemapBand(scales.green!["50"]!)).toEqual(tiers("green", ["300", "200", "100", "50"]));
    expect(treemapBand(scales.rose!["100"]!)).toEqual(tiers("rose", ["300", "200", "100", "50"]));
  });
  it("is null for a colour on no ramp", () => {
    expect(treemapBand("#123456")).toBeNull();
  });
});

describe("treemapShades", () => {
  const scales = tokens.scales as Record<string, Record<string, string>>;
  const L = (hex: string): number => d3.lab(hex).l;
  /** The CIELAB midpoint of two colours, computed here independently of the engine's interpolator. */
  const labMid = (a: string, b: string): string => {
    const x = d3.lab(a);
    const y = d3.lab(b);
    return d3.lab((x.l + y.l) / 2, (x.a + y.a) / 2, (x.b + y.b) / 2).formatHex().toUpperCase();
  };
  it("is the band's 4 tiers with the CIELAB midpoint of each adjacent pair between them: 7 shades, darkest first", () => {
    const shades = treemapShades("#0072B2")!;
    const band = treemapBand("#0072B2")!;
    expect(shades).toHaveLength(7);
    // The ends are the band's end tiers; every other shade is a band tier, in order.
    expect(shades[0]).toBe(scales.blue!["500"]);
    expect(shades[6]).toBe(scales.blue!["200"]);
    expect([shades[0], shades[2], shades[4], shades[6]]).toEqual(band);
    // Between them, the Lab midpoints.
    for (const i of [1, 3, 5]) expect(shades[i]).toBe(labMid(shades[i - 1]!, shades[i + 1]!));
    // Pinned, so a change of interpolator or rounding is caught: 500, 450, 400, 350, 300, 250, 200.
    expect(shades).toEqual(["#005794", "#0063A1", "#0070AF", "#227CBD", "#3689CB", "#4896D9", "#58A3E7"]);
  });
  it("is strictly monotonic in L*, darkest first, the midpoint halfway in L* between its neighbours", () => {
    for (const c of tokens.categorical) {
      const shades = treemapShades(c.base)!;
      for (let i = 1; i < shades.length; i++) expect(L(shades[i]!)).toBeGreaterThan(L(shades[i - 1]!));
      for (const i of [1, 3, 5]) expect(Math.abs(L(shades[i]!) - (L(shades[i - 1]!) + L(shades[i + 1]!)) / 2)).toBeLessThan(0.5);
    }
  });
  it("computes the midpoints: none is a palette token", () => {
    const palette = new Set(Object.values(scales).flatMap((s) => Object.values(s).map((h) => h.toUpperCase())));
    for (const c of tokens.categorical) {
      const shades = treemapShades(c.base)!;
      for (const i of [0, 2, 4, 6]) expect(palette.has(shades[i]!)).toBe(true);
      for (const i of [1, 3, 5]) expect(palette.has(shades[i]!)).toBe(false);
    }
  });
  it("keeps 7 shades at either end of the ramp", () => {
    expect(treemapShades(scales.green!["50"]!)!.filter((_, i) => i % 2 === 0)).toEqual(["300", "200", "100", "50"].map((k) => scales.green![k]));
    expect(treemapShades(scales.amber!["700"]!)!.filter((_, i) => i % 2 === 0)).toEqual(["700", "600", "500", "400"].map((k) => scales.amber![k]));
    expect(treemapShades(scales.amber!["700"]!)).toHaveLength(7);
  });
  it("is null for a colour on no ramp", () => {
    expect(treemapShades("#123456")).toBeNull();
  });
});

describe("tileFill", () => {
  const scales = tokens.scales as Record<string, Record<string, string>>;
  const blue = treemapShades("#0072B2")!;
  it("shades by rank across the colour's 7 shades, largest darkest, each shade once for 7 tiles", () => {
    expect(Array.from({ length: 7 }, (_, r) => tileFill("#0072B2", r, 7, "size"))).toEqual(blue);
    // One tile: the colour itself (Ruling 40), the legend chip's colour.
    expect(tileFill("#0072B2", 0, 1, "size")).toBe("#0072B2");
    expect(tileFill("#E69F00", 0, 1, "size")).toBe("#E69F00");
    // Ranks spread evenly over the 7 shades: round(r * 6 / (n - 1)).
    expect([0, 1, 2].map((r) => tileFill("#0072B2", r, 3, "size"))).toEqual([blue[0], blue[3], blue[6]]);
    expect([0, 1].map((r) => tileFill("#0072B2", r, 2, "size"))).toEqual([blue[0], blue[6]]);
    // r=3, n=20: round(18/19) = 1.
    expect(tileFill("#0072B2", 3, 20, "size")).toBe(blue[1]);
  });
  it("is monotone over 20 tiles, from the darkest shade to the lightest", () => {
    const idx = Array.from({ length: 20 }, (_, r) => blue.indexOf(tileFill("#0072B2", r, 20, "size")));
    expect(idx.every((i) => i >= 0)).toBe(true);
    for (let r = 1; r < 20; r++) expect(idx[r]!).toBeGreaterThanOrEqual(idx[r - 1]!);
    expect(idx[0]).toBe(0);
    expect(idx[19]).toBe(6);
  });
  it("flat data's blue never reaches the ramp's 700, 600, 100 or 50 tiers", () => {
    const outside = new Set(["700", "600", "100", "50"].map((k) => scales.blue![k]));
    for (let n = 1; n <= 30; n++) for (let r = 0; r < n; r++) expect(outside.has(tileFill("#0072B2", r, n, "size"))).toBe(false);
  });
  it("shades another hue within its own band: amber (its base nearest amber-100) runs 300 to 50", () => {
    const amber = treemapShades("#E69F00")!;
    expect(amber[0]).toBe(scales.amber!["300"]);
    expect(amber[6]).toBe(scales.amber!["50"]);
    expect([0, 1, 2].map((r) => tileFill("#E69F00", r, 3, "size"))).toEqual([amber[0], amber[3], amber[6]]);
  });
  it("is case-insensitive on the base hex", () => {
    expect(tileFill("#0072b2", 0, 2, "size")).toBe(blue[0]);
  });
  it("uses the base hex itself for every tile with shading none", () => {
    for (let r = 0; r < 5; r++) expect(tileFill("#8856BF", r, 5, "none")).toBe("#8856BF");
  });
  it("uses a raw series colour off every ramp flat for every tile (no mixing)", () => {
    for (let r = 0; r < 5; r++) expect(tileFill("#123456", r, 5, "size")).toBe("#123456");
  });
});

describe("contrastText", () => {
  it("puts white on the darkest blue and navy on the lightest", () => {
    expect(contrastText("#002B61")).toBe(WHITE);
    expect(contrastText("#95DAFF")).toBe(NAVY);
  });
  it("puts navy on blue-100", () => {
    expect(contrastText((tokens.scales as Record<string, Record<string, string>>).blue!["100"]!)).toBe(NAVY);
  });
  it("judges a computed midpoint shade on its own fill: white on blue's 450 and 350, navy on its 250", () => {
    const blue = treemapShades("#0072B2")!;
    expect(contrastText(blue[1]!)).toBe(WHITE);
    expect(contrastText(blue[3]!)).toBe(WHITE);
    expect(contrastText(blue[5]!)).toBe(NAVY);
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
