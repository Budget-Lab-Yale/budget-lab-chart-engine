// @vitest-environment jsdom
//
// Does the legend key actually READ as its character?
//
// A hatch is only a channel if a reader can tell which one they are looking at, and the key is where
// they learn it. The key is a GLYPH — one centred instance of the texture — because a patch of the
// mark's tiling in a 14px box shows a fraction of one period, which is an edge with no direction in
// it. `test/hatch-glyph.test.ts` locks the glyph's coordinates; this proves the shipped result.
//
// It rasterises the REAL legend (renderLegend + CHART_CSS) in a browser and measures each key from
// its pixels rather than asserting on markup. Three properties per character:
//
//   1. CENTRED — the band passes through the middle of the box. That is what makes the glyph one
//      instance rather than a crop of a pattern.
//   2. DIRECTION — walking outward from the centre along the direction the character depicts stays
//      on the band; walking along any other direction leaves it.
//   3. FLANKED — a single-direction band has ground on BOTH sides ("three bands"), which is what
//      separates `/` from an edge.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright";
import { PNG } from "pngjs";
import { renderLegend } from "../src/engine/legend";
import { CHART_CSS } from "../src/embed/styles";
import { HATCH_CHARS, resolveHatch, type HatchChar } from "../src/engine/hatch";
import type { LegendItem } from "../src/engine/index";

const GROUND = "#58A3E7";
/** Screenshot at 8x so a 14px box gives enough pixels to walk a diagonal. */
const SCALE = 8;

/** Unit steps for the four directions a band can run, as [dx, dy]. SVG y grows downward. */
const DIRECTIONS = {
  vertical: [0, 1],
  horizontal: [1, 0],
  /** Top-left to bottom-right — the `\` lean. */
  backward: [1, 1],
  /** Bottom-left to top-right — the `/` lean. */
  forward: [1, -1],
} as const;
type Direction = keyof typeof DIRECTIONS;

const EXPECTED: Record<HatchChar, Direction[]> = {
  "/": ["forward"],
  "\\": ["backward"],
  "|": ["vertical"],
  "-": ["horizontal"],
  "+": ["vertical", "horizontal"],
  x: ["forward", "backward"],
};

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60000);
afterAll(async () => {
  await browser?.close();
});

async function shootSwatch(char: HatchChar): Promise<PNG> {
  const hatch = resolveHatch(char, GROUND);
  const items: LegendItem[] = [
    { series: "s", label: "Series", color: GROUND, dashed: false, markerShape: "rect", hatch },
  ];
  const parent = document.createElement("div");
  renderLegend(parent, items);

  const page = await browser.newPage({ deviceScaleFactor: SCALE });
  await page.setContent(
    `<!doctype html><html><head><style>${CHART_CSS}</style></head>` +
      `<body style="margin:0;background:#fff">${parent.innerHTML}</body></html>`,
  );
  const el = await page.waitForSelector(".tbl-legend-swatch");
  const shot = await el.screenshot();
  await page.close();
  return PNG.sync.read(shot);
}

/** Classify each pixel band/ground by nearest colour, so antialiased edges land on one side. */
function classify(png: PNG, band: string, ground: string): boolean[][] {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [br, bg, bb] = rgb(band) as [number, number, number];
  const [gr, gg, gb] = rgb(ground) as [number, number, number];
  const grid: boolean[][] = [];
  for (let y = 0; y < png.height; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < png.width; x++) {
      const i = (png.width * y + x) << 2;
      const r = png.data[i]!, g = png.data[i + 1]!, b = png.data[i + 2]!;
      row.push((r - br) ** 2 + (g - bg) ** 2 + (b - bb) ** 2 < (r - gr) ** 2 + (g - gg) ** 2 + (b - gb) ** 2);
    }
    grid.push(row);
  }
  return grid;
}

const centre = (grid: boolean[][]) => [Math.floor(grid[0]!.length / 2), Math.floor(grid.length / 2)];

/** Fraction of a ray walked out from the centre along `dir` (both ways) that stays on the band.
 *  Stops short of the box edge, where the diagonals are clipped and antialiasing dominates. */
function rayScore(grid: boolean[][], dir: Direction): number {
  const [ux, uy] = DIRECTIONS[dir];
  const [cx, cy] = centre(grid) as [number, number];
  const len = Math.hypot(ux, uy);
  const reach = Math.floor(Math.min(cx, cy) * 0.9);
  let on = 0, total = 0;
  for (let sign of [1, -1]) {
    for (let t = 1; t <= reach; t++) {
      const x = Math.round(cx + (sign * ux * t) / len);
      const y = Math.round(cy + (sign * uy * t) / len);
      if (x < 0 || x >= grid[0]!.length || y < 0 || y >= grid.length) continue;
      total++;
      if (grid[y]![x]) on++;
    }
  }
  return total ? on / total : 0;
}

/** Is the band flanked by ground on both sides? Samples perpendicular to `dir`, well out from the
 *  centre but inside the box. */
function flankedByGround(grid: boolean[][], dir: Direction): boolean {
  const [ux, uy] = DIRECTIONS[dir];
  const [px, py] = [-uy, ux];
  const len = Math.hypot(px, py);
  const [cx, cy] = centre(grid) as [number, number];
  const out = Math.floor(Math.min(cx, cy) * 0.7);
  return [1, -1].every((sign) => {
    const x = Math.round(cx + (sign * px * out) / len);
    const y = Math.round(cy + (sign * py * out) / len);
    return !grid[y]?.[x];
  });
}

describe("every legend key reads as its own character", () => {
  const measured = new Map<HatchChar, { grid: boolean[][]; scores: Record<Direction, number> }>();

  beforeAll(async () => {
    for (const char of HATCH_CHARS) {
      const png = await shootSwatch(char);
      const hatch = resolveHatch(char, GROUND);
      const grid = classify(png, hatch.stroke, hatch.ground);
      const scores = Object.fromEntries(
        (Object.keys(DIRECTIONS) as Direction[]).map((d) => [d, rayScore(grid, d)]),
      ) as Record<Direction, number>;
      measured.set(char, { grid, scores });
    }
  }, 120000);

  it("paints both colours — no key renders flat, and none fills the box", () => {
    for (const char of HATCH_CHARS) {
      const flat = measured.get(char)!.grid.flat();
      const ink = flat.filter(Boolean).length / flat.length;
      expect(ink, `char ${char} ink fraction`).toBeGreaterThan(0.2);
      expect(ink, `char ${char} ink fraction`).toBeLessThan(0.75);
    }
  });

  it("puts the band through the centre of the box", () => {
    for (const char of HATCH_CHARS) {
      const { grid } = measured.get(char)!;
      const [cx, cy] = centre(grid) as [number, number];
      expect(grid[cy]![cx], `char ${char} centre`).toBe(true);
    }
  });

  it("stays on the band along the direction its character depicts, and leaves it otherwise", () => {
    // Judged by DOMINANCE, not an absolute cutoff. The band is 6 of 14 — deliberately wide, so it
    // reads as weight rather than a hairline — which means a ray off its axis still crosses several
    // px of band before leaving. What must hold is that the character's own direction is essentially
    // perfect and clearly ahead of every other. `flankedByGround` below covers the rest.
    const MARGIN = 0.12;
    for (const char of HATCH_CHARS) {
      const { scores } = measured.get(char)!;
      const expected = EXPECTED[char];
      const others = (Object.keys(DIRECTIONS) as Direction[]).filter((d) => !expected.includes(d));
      const worstExpected = Math.min(...expected.map((d) => scores[d]));
      const bestOther = Math.max(...others.map((d) => scores[d]));
      expect(worstExpected, `char ${char} along its own direction ${JSON.stringify(scores)}`).toBeGreaterThan(0.95);
      expect(
        worstExpected - bestOther,
        `char ${char} must dominate its own direction ${JSON.stringify(scores)}`,
      ).toBeGreaterThan(MARGIN);
    }
  });

  it("flanks a single-direction band with ground on both sides — the 'three bands' read", () => {
    for (const char of ["|", "-", "/", "\\"] as const) {
      const { grid } = measured.get(char)!;
      expect(flankedByGround(grid, EXPECTED[char][0]!), `char ${char}`).toBe(true);
    }
  });

  it("tells each confusable pair apart", () => {
    const pairs: Array<[HatchChar, HatchChar, Direction, Direction]> = [
      ["/", "\\", "forward", "backward"],
      ["|", "-", "vertical", "horizontal"],
      ["+", "x", "vertical", "forward"],
    ];
    for (const [a, b, dirA, dirB] of pairs) {
      const sa = measured.get(a)!.scores;
      const sb = measured.get(b)!.scores;
      expect(sa[dirA], `${a} vs ${b} on ${dirA}`).toBeGreaterThan(sb[dirA]);
      expect(sb[dirB], `${b} vs ${a} on ${dirB}`).toBeGreaterThan(sa[dirB]);
    }
  });
});
