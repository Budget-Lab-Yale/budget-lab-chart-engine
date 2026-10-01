import { describe, it, expect } from "vitest";
import {
  TM_NAME_SIZES, TM_KEY_PREFIX, treemapTier, tileFill, contrastText, fitTileLabel, fitStripLabel,
  keyEntries, wrapKey, stripFill, type TileLabel,
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
    expect(label.numberSize).toBe(Math.round(1.4 * label.size));
    for (const line of label.nameLines) expect(timelineTextWidth(line, label.size, 700)).toBeLessThanOrEqual(iw);
    if (number !== null) expect(timelineTextWidth(number, label.numberSize, 500)).toBeLessThanOrEqual(iw);
    const height = label.nameLines.length * label.size * 1.2 + (number !== null ? label.numberSize * 1.2 : 0);
    expect(height).toBeLessThanOrEqual(ih);
  } else if (label.mode === "inline") {
    expect(label.text).toBe(number !== null ? `${name} ${number}` : name);
    expect(label.name).toBe(name);
    expect(label.number).toBe(number);
    const width = timelineTextWidth(name, label.size, 700) + (number !== null ? timelineTextWidth(` ${number}`, label.size, 500) : 0);
    expect(width).toBeLessThanOrEqual(iw);
    expect(label.size * 1.2).toBeLessThanOrEqual(ih);
  }
}

describe("fitTileLabel", () => {
  it("stacks a short name and number at the top size in a big tile", () => {
    const l = fitTileLabel("Housing", "33.4%", 410, 510);
    expect(l).toEqual({ mode: "stacked", size: 20, numberSize: 28, nameLines: ["Housing"], number: "33.4%" });
  });
  it("wraps a long name at spaces, below the top size when the top size cannot fit", () => {
    // 88px inner width: "Apparel" fits at 20px bold, so the name wraps; three 20px lines plus the
    // 28px number need 105.6px of height, more than the 88px available, so 20 fails and a smaller
    // size is chosen.
    expect(timelineTextWidth("Apparel", 20, 700)).toBeLessThanOrEqual(88);
    const l = fitTileLabel("Apparel and services", "2.5%", 100, 100);
    expect(l.mode).toBe("stacked");
    if (l.mode !== "stacked") return;
    expect(l.nameLines.length).toBeGreaterThan(1);
    expect(l.size).toBeLessThan(TM_NAME_SIZES[0]);
    assertFits(l, "Apparel and services", "2.5%", 100, 100);
  });
  it("never stacks more than 3 name lines, however tall the tile", () => {
    // One word per line at every ladder size: each word fits at 20px, no two fit together at 11px.
    const word = "Wwwww";
    const iw = Math.ceil(timelineTextWidth(word, 20, 700));
    expect(timelineTextWidth(`${word} ${word}`, 11, 700)).toBeGreaterThan(iw);
    const w = iw + 2 * pad;
    expect(fitTileLabel([word, word, word].join(" "), null, w, 1000).mode).toBe("stacked");
    expect(fitTileLabel([word, word, word, word].join(" "), null, w, 1000)).toEqual({ mode: "none" });
  });
  it("never stacks Education 2.0% in a 60x40 tile", () => {
    const l = fitTileLabel("Education", "2.0%", 60, 40);
    expect(["inline", "none"]).toContain(l.mode);
    assertFits(l, "Education", "2.0%", 60, 40);
  });
  it("falls back to one line when stacking is too tall but the line fits", () => {
    const l = fitTileLabel("Food", "13.0%", 140, 32);
    expect(l).toEqual({ mode: "inline", size: 15, text: "Food 13.0%", name: "Food", number: "13.0%" });
    assertFits(l, "Food", "13.0%", 140, 32);
  });
  it("leaves an unbroken 40-character name in a 120px tile unlabelled", () => {
    expect(fitTileLabel("A".repeat(40), "1.0%", 120, 120)).toEqual({ mode: "none" });
  });
  it("fits the name alone when the number is null", () => {
    const l = fitTileLabel("Housing", null, 410, 510);
    expect(l).toEqual({ mode: "stacked", size: 20, numberSize: 28, nameLines: ["Housing"], number: null });
  });
  it("labels nothing in a tile with no inner box", () => {
    expect(fitTileLabel("X", "1%", 10, 10)).toEqual({ mode: "none" });
  });
  it("only ever renders lines that fit the inner box (200 random cases)", () => {
    let seed = 12345;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const vocab = ["Housing", "Food", "Transportation", "Health", "care", "Education", "and", "services",
      "Apparel", "Entertainment", "Personal", "insurance", "Other", "spending", "Utilities", "Cash",
      "contributions", "Alcoholic", "beverages", "Tobacco", "a", "Supercalifragilisticexpialidocious"];
    const modes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const nWords = 1 + Math.floor(rand() * 5);
      const name = Array.from({ length: nWords }, () => vocab[Math.floor(rand() * vocab.length)]!).join(" ");
      const number = rand() < 0.2 ? null : `${(rand() * 40).toFixed(1)}%`;
      const w = 10 + rand() * 400;
      const h = 10 + rand() * 300;
      const l = fitTileLabel(name, number, w, h);
      modes.add(l.mode);
      assertFits(l, name, number, w, h);
    }
    // The sample exercises every branch, so the assertions above are not vacuous.
    expect([...modes].sort()).toEqual(["inline", "none", "stacked"]);
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
