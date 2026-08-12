// @vitest-environment jsdom
//
// Does the legend key actually READ as its character?
//
// A hatch is only a channel if a reader can tell which one they are looking at, and the key is where
// they learn it. The `is-rect` swatch is 14x12px, so at the mark's 16px tile period it showed barely
// one band — the direction was unreadable, and `/` was indistinguishable from `\`.
//
// This rasterises the REAL shipped legend (renderLegend + CHART_CSS) in a browser and measures each
// swatch from its pixels, rather than asserting on the CSS string. Two properties, per character:
//
//   1. DIRECTION. Bands run ALONG their own direction, so pixel pairs one step apart along that
//      direction agree, and pairs across it do not. The direction with the highest agreement must be
//      the one the character depicts.
//   2. COUNT. At least two bands must be visible, or there is no repetition to read a direction
//      from — one edge bisecting a square could be anything.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright";
import { PNG } from "pngjs";
import { renderLegend } from "../src/engine/legend";
import { CHART_CSS } from "../src/embed/styles";
import { HATCH_CHARS, HATCH_SWATCH_PERIOD, resolveHatch, type HatchChar } from "../src/engine/hatch";
import type { LegendItem } from "../src/engine/index";

const GROUND = "#58A3E7";
/** Screenshot at 6x so a 22x16 swatch gives enough pixels to measure a diagonal reliably. */
const SCALE = 6;

/** Unit steps for the four directions a hatch band can run, as [dx, dy]. */
const DIRECTIONS = {
  vertical: [0, 1],
  horizontal: [1, 0],
  /** Top-left to bottom-right — the `\` lean. */
  backward: [1, 1],
  /** Bottom-left to top-right — the `/` lean. */
  forward: [1, -1],
} as const;
type Direction = keyof typeof DIRECTIONS;

/** Which direction(s) each character's bands run. */
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

/** Rasterise one character's real legend swatch and return its pixels. */
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

/** Classify each pixel as band or ground by nearest colour, so antialiased edges land on one side.
 *  Returns a boolean grid, band = true. */
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
      const dBand = (r - br) ** 2 + (g - bg) ** 2 + (b - bb) ** 2;
      const dGround = (r - gr) ** 2 + (g - gg) ** 2 + (b - gb) ** 2;
      row.push(dBand < dGround);
    }
    grid.push(row);
  }
  return grid;
}

/** Fraction of pixel pairs HALF A TILE PERIOD apart along `dir` that fall in the same class.
 *
 *  The step size is the whole measurement. One pixel apart tells you nothing — at 6x scale a band is
 *  ~12 device px wide, so neighbours agree in every direction and all four scores collapse to the
 *  same number. Half a period is the discriminating distance: along the direction the bands RUN you
 *  are still inside the same band, and across them you have landed in the gap.
 *
 *  Sampled on an inset region so the swatch's rounded corners and outer edge don't count. */
function agreement(grid: boolean[][], dir: Direction): number {
  const [ux, uy] = DIRECTIONS[dir];
  // Scale the unit step so the DISPLACEMENT LENGTH is half a period, diagonals included.
  const halfPeriod = (HATCH_SWATCH_PERIOD / 2) * SCALE;
  const len = Math.hypot(ux, uy);
  const dx = Math.round((ux / len) * halfPeriod);
  const dy = Math.round((uy / len) * halfPeriod);

  const h = grid.length, w = grid[0]!.length;
  const inset = Math.round(Math.min(w, h) * 0.2);
  let same = 0, total = 0;
  for (let y = inset; y < h - inset; y++) {
    for (let x = inset; x < w - inset; x++) {
      const ny = y + dy, nx = x + dx;
      if (ny < inset || ny >= h - inset || nx < inset || nx >= w - inset) continue;
      total++;
      if (grid[y]![x] === grid[ny]![nx]) same++;
    }
  }
  return total ? same / total : 0;
}

/** How many bands are visible: class transitions along a scan ACROSS the bands, halved. Scans the
 *  full inset extent rather than a fixed radius, so a wide swatch gets credit for its width. */
function bandCount(grid: boolean[][], dir: Direction): number {
  const [ux, uy] = DIRECTIONS[dir];
  // Perpendicular to the band direction.
  const [px, py] = [-uy, ux];
  const h = grid.length, w = grid[0]!.length;
  const inset = Math.round(Math.min(w, h) * 0.15);
  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  let transitions = 0;
  let prev: boolean | null = null;
  for (let t = -Math.max(w, h); t <= Math.max(w, h); t++) {
    const x = cx + px * t, y = cy + py * t;
    if (x < inset || x >= w - inset || y < inset || y >= h - inset) continue;
    const here = grid[y]![x]!;
    if (prev !== null && here !== prev) transitions++;
    prev = here;
  }
  return Math.ceil(transitions / 2);
}

describe("every legend swatch reads as its own character", () => {
  const measured = new Map<HatchChar, { grid: boolean[][]; scores: Record<Direction, number> }>();

  beforeAll(async () => {
    for (const char of HATCH_CHARS) {
      const png = await shootSwatch(char);
      const hatch = resolveHatch(char, GROUND);
      const grid = classify(png, hatch.stroke, hatch.ground);
      const scores = Object.fromEntries(
        (Object.keys(DIRECTIONS) as Direction[]).map((d) => [d, agreement(grid, d)]),
      ) as Record<Direction, number>;
      measured.set(char, { grid, scores });
    }
  }, 120000);

  it("paints both colours in every swatch — none renders flat", () => {
    for (const char of HATCH_CHARS) {
      const { grid } = measured.get(char)!;
      const flat = grid.flat();
      const bandFraction = flat.filter(Boolean).length / flat.length;
      expect(bandFraction, `char ${char} band fraction`).toBeGreaterThan(0.15);
      expect(bandFraction, `char ${char} band fraction`).toBeLessThan(0.85);
    }
  });

  it("leans the way its character depicts, measured from the pixels", () => {
    for (const char of HATCH_CHARS) {
      const { scores } = measured.get(char)!;
      const expected = EXPECTED[char];
      const others = (Object.keys(DIRECTIONS) as Direction[]).filter((d) => !expected.includes(d));
      const worstExpected = Math.min(...expected.map((d) => scores[d]));
      const bestOther = Math.max(...others.map((d) => scores[d]));
      expect(
        worstExpected,
        `char ${char}: expected ${expected.join("+")} to dominate, got ${JSON.stringify(scores)}`,
      ).toBeGreaterThan(bestOther);
    }
  });

  it("shows at least two bands, so there is a repeat to read the direction from", () => {
    for (const char of HATCH_CHARS) {
      const { grid } = measured.get(char)!;
      const count = Math.max(...EXPECTED[char].map((d) => bandCount(grid, d)));
      expect(count, `char ${char} visible bands`).toBeGreaterThanOrEqual(2);
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
      // Each character scores higher than the other on its OWN direction — a mirror-image bug makes
      // these agree instead.
      expect(sa[dirA], `${a} vs ${b} on ${dirA}`).toBeGreaterThan(sb[dirA]);
      expect(sb[dirB], `${b} vs ${a} on ${dirB}`).toBeGreaterThan(sa[dirB]);
    }
  });
});
