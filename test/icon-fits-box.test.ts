// The gate on a fact that must not drift: nothing an icon draws is CUT by its box.
//
// The box clips, exactly as a <pattern> tile does, and two bugs came from forgetting it: an outlined
// annotation chip sheared off along its bottom edge, and marker symbols at d3 area 90, where the star
// reaches ~2.5 units past the box. Neither shows up in the source numbers — a stroke straddles its
// edge, and `getBBox()` on a transformed element reports pre-transform coordinates — so this measures
// real bounding boxes in the SVG's own viewport, by wrapping each primitive in a <g> (whose bbox DOES
// include its children's transforms).
//
// Scope: CLOSED shapes must fit, because a chip's border and a marker's points are defined by being
// whole. A `line` is excluded: a rule spanning the box edge to edge, and a hatch band running corner
// to corner, are defined by spanning it and are trimmed at the frame deliberately — that trimming is
// what makes the `/` glyph read as three bands.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright";
import { PNG } from "pngjs";
import {
  ICON_BOX,
  symbolArea,
  iconShapes,
  type IconPrimitive,
  type IconSpec,
} from "../src/engine/icon";
import { symbolPathD } from "../src/engine/symbols";
import { MARKER_SYMBOLS } from "../src/engine/theme";
import { resolveHatch } from "../src/engine/hatch";

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60000);
afterAll(async () => {
  await browser?.close();
});

const svgFor = (prims: string) =>
  `<svg width="${ICON_BOX}" height="${ICON_BOX}" viewBox="0 0 ${ICON_BOX} ${ICON_BOX}">${prims}</svg>`;

/** How far each shape's painted box falls outside [0, ICON_BOX], stroke included. */
async function spills(markup: string[]): Promise<number[]> {
  const page = await browser.newPage();
  await page.setContent(
    `<body style="margin:0">` +
      markup.map((m, i) => svgFor(`<g id="g${i}">${m}</g>`)).join("") +
      `</body>`,
  );
  const out = await page.evaluate(
    ({ n, box }) => {
      const res: number[] = [];
      for (let i = 0; i < n; i++) {
        const g = document.getElementById(`g${i}`) as unknown as SVGGraphicsElement;
        const b = g.getBBox();
        const sw = parseFloat(g.firstElementChild?.getAttribute("stroke-width") ?? "0") / 2;
        res.push(
          Math.max(0, -(b.x - sw), -(b.y - sw), b.x + b.width + sw - box, b.y + b.height + sw - box),
        );
      }
      return res;
    },
    { n: markup.length, box: ICON_BOX },
  );
  await page.close();
  return out;
}

/** How far each shape's painted box reaches from the centre of the box. */
async function extents(markup: string[]): Promise<number[]> {
  const page = await browser.newPage();
  await page.setContent(
    `<body style="margin:0">` + markup.map((m, i) => svgFor(`<g id="g${i}">${m}</g>`)).join("") + `</body>`,
  );
  const out = await page.evaluate(
    ({ n, box }) => {
      const res: number[] = [];
      const c = box / 2;
      for (let i = 0; i < n; i++) {
        const g = document.getElementById(`g${i}`) as unknown as SVGGraphicsElement;
        const b = g.getBBox();
        const sw = parseFloat(g.firstElementChild?.getAttribute("stroke-width") ?? "0") / 2;
        res.push(Math.max(Math.abs(b.x - sw - c), Math.abs(b.y - sw - c), Math.abs(b.x + b.width + sw - c), Math.abs(b.y + b.height + sw - c)));
      }
      return res;
    },
    { n: markup.length, box: ICON_BOX },
  );
  await page.close();
  return out;
}

/** Serialise one primitive, so the test measures what the emitter would actually draw. */
function primMarkup(s: IconPrimitive): string {
  switch (s.kind) {
    case "rect":
      return `<rect x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}" stroke-width="${s.strokeWidth ?? 0}"/>`;
    case "circle":
      return `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" stroke-width="${s.strokeWidth ?? 0}"/>`;
    case "path":
      return `<path d="${s.d}" transform="${s.transform}" stroke-width="${s.strokeWidth ?? 0}"/>`;
    case "line":
      return `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke-width="${s.strokeWidth}"/>`;
  }
}

const CASES: Array<[string, IconSpec]> = [
  ["square", { shape: "rect", color: "#0072B2" }],
  ["rounded chip", { shape: "rect", color: "#0072B2", rounded: true }],
  ["OUTLINED chip", { shape: "rect", color: "#EAF3FB", outlined: true }],
  ["textured square", { shape: "rect", color: "#58A3E7", hatch: resolveHatch("x", "#58A3E7") }],
  ["banded chip", { shape: "rect", colors: ["#0072B2", "#E69F00", "#2A8B3A"] }],
  ["filled dot", { shape: "dot", color: "#0072B2" }],
  ["HOLLOW ring", { shape: "dot", color: "#0072B2", hollow: true }],
  ...MARKER_SYMBOLS.map((s) => [`symbol ${s}`, { shape: "symbol", color: "#0072B2", symbol: s }] as [string, IconSpec]),
  ...MARKER_SYMBOLS.map((s) => [`line + ${s}`, { shape: "line", color: "#0072B2", symbol: s }] as [string, IconSpec]),
  // A hollow SYMBOL — what a dumbbell actually emits — was the case this list did not carry, and it
  // was the case that was broken: its ring straddles the path, so the symbol has to be sized half a
  // stroke smaller or the box cuts the ring at its four extremes.
  ...MARKER_SYMBOLS.map(
    (s) => [`HOLLOW symbol ${s}`, { shape: "symbol", color: "#0072B2", symbol: s, hollow: true }] as [string, IconSpec],
  ),
];

describe("no icon is cut by its box", () => {
  // Tolerance: 0.05 of a 14-unit box is under a tenth of a device pixel even at 8x zoom, i.e. below
  // what any renderer can express. Tighter than that measures getBBox's float precision, not clipping.
  const TOL = 0.05;

  it("fits every closed shape, stroke included", async () => {
    const named: Array<[string, IconPrimitive]> = CASES.flatMap(([name, icon]) =>
      iconShapes(icon)
        .filter((s) => s.kind !== "line")
        .map((s) => [name, s] as [string, IconPrimitive]),
    );
    const over = await spills(named.map(([, s]) => primMarkup(s)));
    named.forEach(([name, s], i) => {
      expect(over[i], `${name} (${s.kind}) spills ${over[i]!.toFixed(2)} past the box`).toBeLessThanOrEqual(TOL);
    });
  }, 120000);

  it("starts and ends every spanning line inside the box", async () => {
    // A line may be TRIMMED at the frame, but it must not begin outside it.
    for (const [name, icon] of CASES) {
      for (const s of iconShapes(icon)) {
        if (s.kind !== "line") continue;
        for (const v of [s.x1, s.y1, s.x2, s.y2]) {
          expect(v, `${name}: endpoint outside the box`).toBeGreaterThanOrEqual(0);
          expect(v, `${name}: endpoint outside the box`).toBeLessThanOrEqual(ICON_BOX);
        }
      }
    }
  });

  it("gives every symbol the same INK, none of it outside the box", async () => {
    // Optical sizing, and the two halves of it. d3's `size` is the painted AREA, so equal ink is one
    // shared size — but the box CLIPS, so that size is dictated by the pointiest symbol. Equal reach
    // was the previous rule and it read wrong: a star's points touched the box while its body carried
    // a third of the square's ink.
    const HALF = ICON_BOX / 2;
    const marker = (onLine: boolean, hollow = false) =>
      MARKER_SYMBOLS.map(
        (s) =>
          `<path d="${symbolPathD(s, symbolArea(onLine, hollow))}" transform="translate(${HALF},${HALF})" stroke-width="${hollow ? 2 : onLine ? 1 : 0}"/>`,
      );

    const alone = await spills(marker(false));
    MARKER_SYMBOLS.forEach((s, i) => {
      expect(alone[i], `${s} alone spills ${alone[i]!.toFixed(3)}`).toBeLessThanOrEqual(TOL);
    });

    // Exactly one symbol may sit AT the box — the pointiest. If none does, every key is needlessly
    // small; the rest are smaller on purpose, which is what carries the equal ink.
    const reach = await extents(marker(false));
    expect(Math.max(...reach), `no symbol reaches the box`).toBeGreaterThan(HALF - TOL);

    // A hollow symbol's RING lands on the box too — the path stops short, the stroke makes it up.
    const ring = await extents(marker(false, true));
    MARKER_SYMBOLS.forEach((s, i) => {
      expect(ring[i], `hollow ${s} rings at ${ring[i]!.toFixed(2)}, not ${HALF}`).toBeLessThanOrEqual(HALF + TOL);
    });

    // On a line the marker is smaller so the rule still reads either side of it — how much smaller is
    // a taste call (ON_LINE_REACH), so what is gated here is only that it stays inside the box.
    const onLine = await extents(marker(true));
    expect(Math.max(...onLine), `a marker on a line spills`).toBeLessThanOrEqual(HALF + TOL);
  }, 120000);

  it("paints the same number of pixels for every symbol", async () => {
    // The measurement optical sizing rests on, taken from the rendered image rather than from d3's
    // documented semantics: one shared `size` is only equal INK if `size` really is the painted area.
    // This is also the gate against a future hand-tuned table — the previous one was hand-fitted and
    // three of its seven entries were wrong.
    const SCALE = 8;
    const page = await browser.newPage({ deviceScaleFactor: SCALE });
    const half = ICON_BOX / 2;
    await page.setContent(
      `<body style="margin:0;background:#fff">` +
        MARKER_SYMBOLS.map(
          (s, i) =>
            `<svg id="s${i}" width="${ICON_BOX}" height="${ICON_BOX}" style="display:block">` +
            `<path d="${symbolPathD(s, symbolArea())}" transform="translate(${half},${half})" fill="#000"/></svg>`,
        ).join("") +
        `</body>`,
    );
    const inks: number[] = [];
    for (let i = 0; i < MARKER_SYMBOLS.length; i++) {
      const png = PNG.sync.read(await (await page.$(`#s${i}`))!.screenshot());
      let ink = 0;
      for (let p = 0; p < png.width * png.height; p++) if (png.data[p << 2]! < 128) ink++;
      inks.push(ink / SCALE ** 2);
    }
    await page.close();
    const mean = inks.reduce((a, b) => a + b, 0) / inks.length;
    MARKER_SYMBOLS.forEach((s, i) => {
      // 8% covers antialiasing on shapes whose perimeter-to-area ratios differ by 3x (a wye is nearly
      // all edge, a square nearly none). A hand-fitted table missed by 40%, so this is not slack.
      expect(
        Math.abs(inks[i]! - mean) / mean,
        `${s} paints ${inks[i]!.toFixed(1)} where the mean is ${mean.toFixed(1)}`,
      ).toBeLessThan(0.08);
    });
  }, 120000);
});
