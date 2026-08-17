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
  OPTICAL_CENTRING,
  SYMBOL_CENTRE_Y,
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
  ["HOLLOW ring", { shape: "dot", color: "#0072B2", marker: "hollow" as const }],
  ...MARKER_SYMBOLS.map((s) => [`symbol ${s}`, { shape: "symbol", color: "#0072B2", symbol: s }] as [string, IconSpec]),
  ...MARKER_SYMBOLS.map((s) => [`line + ${s}`, { shape: "line", color: "#0072B2", symbol: s }] as [string, IconSpec]),
  // A hollow SYMBOL — what a dumbbell actually emits — was the case this list did not carry, and it
  // was the case that was broken: its ring straddles the path, so the symbol has to be sized half a
  // stroke smaller or the box cuts the ring at its four extremes.
  ...MARKER_SYMBOLS.map(
    (s) => [`HOLLOW symbol ${s}`, { shape: "symbol", color: "#0072B2", symbol: s, marker: "hollow" as const }] as [string, IconSpec],
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
    // Sizing, and the two halves of it. d3's `size` is the painted AREA, so a shared size is equal ink
    // — but the box CLIPS, so the spread shapes bind first. Built from iconShapes, NOT from a transform
    // re-derived here: this test used to place its own `translate(HALF,HALF)` and so measured something
    // the emitter does not draw, which is how a triangle sitting 1.75px high got past it.
    const HALF = ICON_BOX / 2;
    const pathsFor = (icon: (s: string) => IconSpec) =>
      MARKER_SYMBOLS.map((s) => {
        const path = iconShapes(icon(s)).find((p) => p.kind === "path")!;
        return primMarkup(path);
      });

    const alone = await spills(pathsFor((s) => ({ shape: "symbol", color: "#0072B2", symbol: s })));
    MARKER_SYMBOLS.forEach((s, i) => {
      expect(alone[i], `${s} alone spills ${alone[i]!.toFixed(3)}`).toBeLessThanOrEqual(TOL);
    });

    // Something must sit AT the box, or every key is needlessly small. The rest are smaller on purpose.
    const reach = await extents(pathsFor((s) => ({ shape: "symbol", color: "#0072B2", symbol: s })));
    expect(Math.max(...reach), `no symbol reaches the box`).toBeGreaterThan(HALF - TOL);

    // A hollow symbol's RING lands on the box too — the path stops short, the stroke makes it up.
    const ring = await extents(
      pathsFor((s) => ({ shape: "symbol", color: "#0072B2", symbol: s, marker: "hollow" })),
    );
    MARKER_SYMBOLS.forEach((s, i) => {
      expect(ring[i], `hollow ${s} rings at ${ring[i]!.toFixed(2)}`).toBeLessThanOrEqual(HALF + TOL);
    });

    // On a line the marker is smaller, so the rule still reads either side of it.
    const onLine = await extents(pathsFor((s) => ({ shape: "line", color: "#0072B2", symbol: s })));
    expect(Math.max(...onLine), `a marker on a line spills`).toBeLessThanOrEqual(HALF + TOL);
  }, 120000);

  it("sits every symbol between its centroid and its box centre, at OPTICAL_CENTRING", async () => {
    // Neither end of this range is right, which is why the rule is a fraction and not a rule.
    //
    // d3 places a symbol by its CENTROID: a triangle's apex is far from the centroid and its base is
    // near, so a centroid-centred triangle sat 1.75px HIGH and read out of line with its own label.
    // Correcting all the way to the BOX centre overshoots the other way and reads LOW — a triangle's
    // box is not its ink, because the apex adds height while carrying almost no weight, so balancing
    // the box tips the visible mass below the label's centre.
    //
    // So this does NOT assert the ink is box-centred. It asserts the ink sits exactly
    // OPTICAL_CENTRING of the way from centroid to box centre, which is the judgement the module
    // actually makes, and it asserts the symmetric symbols do not move at all — they have no offset,
    // so any factor must leave them alone.
    const page = await browser.newPage();
    const markup = MARKER_SYMBOLS.map((s) =>
      primMarkup(iconShapes({ shape: "symbol", color: "#0072B2", symbol: s }).find((p) => p.kind === "path")!),
    );
    await page.setContent(
      `<body style="margin:0">` + markup.map((m, i) => svgFor(`<g id="g${i}">${m}</g>`)).join("") + `</body>`,
    );
    const centres = await page.evaluate(
      ({ n }) => {
        const out: Array<[number, number]> = [];
        for (let i = 0; i < n; i++) {
          const b = (document.getElementById(`g${i}`) as unknown as SVGGraphicsElement).getBBox();
          out.push([b.x + b.width / 2, b.y + b.height / 2]);
        }
        return out;
      },
      { n: markup.length },
    );
    await page.close();
    const mid = ICON_BOX / 2;
    MARKER_SYMBOLS.forEach((s, i) => {
      const [cx, cy] = centres[i]!;
      // Horizontal is unconditional: every symbol is symmetric about its own vertical axis.
      expect(Math.abs(cx - mid), `${s} ink centre is ${cx.toFixed(2)} across, not ${mid}`).toBeLessThan(0.1);

      // Vertically, the ink centre lands short of the box centre by the part of the offset NOT
      // applied — (1 - OPTICAL_CENTRING) of it. At OPTICAL_CENTRING = 1 this collapses to "box
      // centred"; at 0 it is the raw centroid. Asserting the relationship rather than a literal is
      // what makes the test survive a re-judgement of the factor while still failing if the factor
      // stops being applied.
      const offset = SYMBOL_CENTRE_Y[s] ?? 0;
      const residual = offset * (1 - OPTICAL_CENTRING) * Math.sqrt(symbolArea(s, false, false));
      expect(
        Math.abs(cy - (mid + residual)),
        `${s} ink centre is ${cy.toFixed(2)} down; expected ${(mid + residual).toFixed(2)} ` +
          `(box centre ${mid} plus the ${((1 - OPTICAL_CENTRING) * 100).toFixed(0)}% of its bbox offset that is deliberately not applied)`,
      ).toBeLessThan(0.1);

      // A symmetric symbol has no offset, so no factor may move it off the box centre.
      if (!offset) {
        expect(Math.abs(cy - mid), `${s} is symmetric and must sit on the box centre`).toBeLessThan(0.1);
      }
    });
  }, 120000);

  it("paints as many pixels as the `size` it was given", async () => {
    // The measurement the whole sizing rule rests on: d3's `size` is documented as the painted area,
    // and everything here converts a chart RADIUS into a size on that basis (Plot: area = pi*r^2). If
    // it were only approximately true, two symbols at one size would carry different ink and "optical
    // sizing" would be a story rather than a property. Counted from the rendered image, per symbol, so
    // it also covers the three that the box clamps.
    const SCALE = 8;
    const page = await browser.newPage({ deviceScaleFactor: SCALE });
    const half = ICON_BOX / 2;
    await page.setContent(
      `<body style="margin:0;background:#fff">` +
        MARKER_SYMBOLS.map(
          (s, i) =>
            `<svg id="s${i}" width="${ICON_BOX}" height="${ICON_BOX}" style="display:block">` +
            `<path d="${symbolPathD(s, symbolArea(s))}" transform="translate(${half},${half})" fill="#000"/></svg>`,
        ).join("") +
        `</body>`,
    );
    for (const [i, s] of MARKER_SYMBOLS.entries()) {
      const png = PNG.sync.read(await (await page.$(`#s${i}`))!.screenshot());
      let ink = 0;
      for (let p = 0; p < png.width * png.height; p++) if (png.data[p << 2]! < 128) ink++;
      const painted = ink / SCALE ** 2;
      const asked = symbolArea(s);
      // 5% covers antialiasing on shapes whose perimeter-to-area ratios differ by 3x (a wye is nearly
      // all edge, a square nearly none).
      expect(
        Math.abs(painted - asked) / asked,
        `${s} was given size ${asked} and painted ${painted.toFixed(1)}`,
      ).toBeLessThan(0.05);
    }
    await page.close();
  }, 120000);
});
