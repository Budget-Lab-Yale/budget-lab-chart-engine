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
import {
  ICON_BOX,
  ICON_INK_LIMIT,
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

  it("sizes every symbol to fill the box, none overflowing it", async () => {
    // d3's `size` is an AREA, and equal area is not equal visual size — at one constant the star
    // overflowed while the square sat small. Each symbol's area is solved for the same EXTENT, so
    // this checks both halves of that: nothing spills, and nothing is left needlessly small.
    const marker = (onLine: boolean) =>
      MARKER_SYMBOLS.map(
        (s) =>
          `<path d="${symbolPathD(s, symbolArea(s, onLine))}" transform="translate(${ICON_BOX / 2},${ICON_BOX / 2})" stroke-width="1"/>`,
      );

    const alone = await spills(marker(false));
    MARKER_SYMBOLS.forEach((s, i) => {
      expect(alone[i], `${s} alone spills ${alone[i]!.toFixed(3)}`).toBeLessThanOrEqual(TOL);
    });

    // Filling the box means reaching most of the way to the limit — measured by how much room is
    // left, since a symbol that fits trivially is a symbol drawn too small.
    const reach = await extents(marker(false));
    MARKER_SYMBOLS.forEach((s, i) => {
      expect(reach[i], `${s} reaches only ${reach[i]!.toFixed(2)} of ${ICON_INK_LIMIT}`).toBeGreaterThan(
        ICON_INK_LIMIT * 0.9,
      );
    });

    // On a line, deliberately smaller so the line still reads underneath.
    const onLine = await extents(marker(true));
    MARKER_SYMBOLS.forEach((s, i) => {
      expect(onLine[i], `${s} on a line is not smaller`).toBeLessThan(reach[i]! * 0.85);
    });
  }, 120000);
});
