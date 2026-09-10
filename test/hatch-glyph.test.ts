// Geometry of the legend/tooltip GLYPH — one centred instance of the texture, not a tiled patch.
//
// A tile is the wrong primitive for a 14px box. It can only show a fraction of a period, so the
// reader gets an edge rather than a direction, and the box has to grow into an awkward rectangle
// before a crossed character resolves at all. A glyph inverts that: draw exactly ONE instance,
// centred, with ground either side — `/` becomes three bands (ground, mark, ground), `+` becomes a
// plus, `x` becomes an x. Recognition comes from the shape, so a small square is enough.
//
// These lock the numbers, because "centred" and "reasonable weight" are pixel decisions:
//   - every band passes through the centre of the box, or it isn't one instance centred;
//   - single-direction bands are flanked by ground on BOTH sides, which is what makes the direction
//     readable rather than an edge;
//   - the single/crossed weights mirror the MARK's rule (wide single, narrower crossed), so the six
//     read as one family here for the same reason they do there.
import { describe, it, expect } from "vitest";
import {
  HATCH_CHARS,
  HATCH_GLYPH_BOX,
  HATCH_GLYPH_BAND,
  HATCH_GLYPH_BAND_CROSSED,
  hatchGlyphShapes,
  type HatchGlyphShape,
} from "../src/engine/hatch";

const C = HATCH_GLYPH_BOX / 2;

/** Does this shape cover the centre of the box? */
function coversCentre(s: HatchGlyphShape): boolean {
  if (s.kind === "rect") {
    return s.x <= C && s.x + s.width >= C && s.y <= C && s.y + s.height >= C;
  }
  return contains(s.points, C, C);
}

/** Ray-casting point-in-polygon, so a diagonal band is tested as the area it actually is. */
function contains(pts: Array<[number, number]>, px: number, py: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The band width a diagonal polygon encodes, recovered from its AREA so the same formula works for
 * both leans. Trimming a `band`-wide 45-degree stripe to the box cuts two opposite corners, each a
 * right triangle with legs `box - e` where `e = band / sqrt(2)`, so the hexagon's area is
 * `box^2 - (box - e)^2`. Inverting that gives `e`, and the width follows. Deliberately derived
 * here rather than read off a vertex: a per-vertex formula depends on which corners were cut, which
 * is exactly the detail a regression would change.
 */
function bandWidthOf(s: Extract<HatchGlyphShape, { kind: "polygon" }>): number {
  const pts = s.points;
  let twiceArea = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!;
    const [xj, yj] = pts[j]!;
    twiceArea += xj * yi - xi * yj;
  }
  const area = Math.abs(twiceArea) / 2;
  const box = HATCH_GLYPH_BOX;
  return (box - Math.sqrt(box * box - area)) * Math.SQRT2;
}

describe("the glyph box", () => {
  it("is square, so `|` and `-` carry the same weight as each other", () => {
    expect(HATCH_GLYPH_BOX).toBe(14);
  });

  it("weights single and crossed bands the way the mark does", () => {
    expect(HATCH_GLYPH_BAND).toBeGreaterThan(HATCH_GLYPH_BAND_CROSSED);
  });
});

describe("every glyph is one centred instance", () => {
  it("puts a band through the centre of the box, for all six", () => {
    for (const char of HATCH_CHARS) {
      const shapes = hatchGlyphShapes(char);
      expect(shapes.length, `char ${char}`).toBeGreaterThan(0);
      expect(shapes.every(coversCentre), `char ${char}: every band must pass through the centre`).toBe(true);
    }
  });

  it("draws one band for a single-direction character and two for a crossed one", () => {
    for (const char of ["|", "-", "/", "\\"] as const) {
      expect(hatchGlyphShapes(char), `char ${char}`).toHaveLength(1);
    }
    for (const char of ["+", "x"] as const) {
      expect(hatchGlyphShapes(char), `char ${char}`).toHaveLength(2);
    }
  });
});

describe("the straight characters are pixel-crisp", () => {
  it("centres `|` on integer coordinates with equal ground either side", () => {
    const [band] = hatchGlyphShapes("|") as [Extract<HatchGlyphShape, { kind: "rect" }>];
    expect(band.kind).toBe("rect");
    expect(band.width).toBe(HATCH_GLYPH_BAND);
    expect(band.height).toBe(HATCH_GLYPH_BOX); // spans the box
    expect(band.x).toBe((HATCH_GLYPH_BOX - HATCH_GLYPH_BAND) / 2);
    expect(Number.isInteger(band.x)).toBe(true);
    // Ground either side, equal — the "three bands" read.
    expect(band.x).toBe(HATCH_GLYPH_BOX - (band.x + band.width));
  });

  it("is `|` rotated a quarter turn for `-`", () => {
    const [v] = hatchGlyphShapes("|") as [Extract<HatchGlyphShape, { kind: "rect" }>];
    const [h] = hatchGlyphShapes("-") as [Extract<HatchGlyphShape, { kind: "rect" }>];
    expect({ x: h.y, y: h.x, width: h.height, height: h.width }).toEqual({
      x: v.x,
      y: v.y,
      width: v.width,
      height: v.height,
    });
  });

  it("crosses two narrower arms for `+`, each centred and spanning the box", () => {
    const arms = hatchGlyphShapes("+") as Array<Extract<HatchGlyphShape, { kind: "rect" }>>;
    expect(arms.every((a) => a.kind === "rect")).toBe(true);
    const vertical = arms.find((a) => a.height === HATCH_GLYPH_BOX)!;
    const horizontal = arms.find((a) => a.width === HATCH_GLYPH_BOX)!;
    expect(vertical.width).toBe(HATCH_GLYPH_BAND_CROSSED);
    expect(horizontal.height).toBe(HATCH_GLYPH_BAND_CROSSED);
    expect(vertical.x).toBe((HATCH_GLYPH_BOX - HATCH_GLYPH_BAND_CROSSED) / 2);
    expect(horizontal.y).toBe((HATCH_GLYPH_BOX - HATCH_GLYPH_BAND_CROSSED) / 2);
  });
});

describe("the diagonal characters lean as their glyph depicts", () => {
  const poly = (char: "/" | "\\" | "x", i = 0) =>
    hatchGlyphShapes(char)[i] as Extract<HatchGlyphShape, { kind: "polygon" }>;
  const B = HATCH_GLYPH_BOX;

  // The diagonals are polygons, not stroked lines, and that is the whole fix: a `band`-wide stripe
  // at 45 degrees overflows a 14px box at both ends and along both flanks, and the glyph used to
  // rely on its `<svg>` viewport to trim it. The PNG export's `iconSvgGroup` unwraps that viewport
  // into a bare `<g>`, which does not clip, so the `/` key rendered as a parallelogram spilling
  // across the legend row. Carrying the trimmed shape makes it correct in any container.
  it("stays inside the box, which a stroked diagonal did not", () => {
    for (const char of ["/", "\\", "x"] as const) {
      for (const s of hatchGlyphShapes(char)) {
        expect(s.kind, `char ${char}`).toBe("polygon");
        for (const [x, y] of (s as Extract<HatchGlyphShape, { kind: "polygon" }>).points) {
          expect(x, `char ${char}: x outside the box`).toBeGreaterThanOrEqual(0);
          expect(x, `char ${char}: x outside the box`).toBeLessThanOrEqual(B);
          expect(y, `char ${char}: y outside the box`).toBeGreaterThanOrEqual(0);
          expect(y, `char ${char}: y outside the box`).toBeLessThanOrEqual(B);
        }
      }
    }
  });

  it("runs `/` corner to corner ASCENDING left to right", () => {
    // SVG y grows downward, so ascending passes through the bottom-left and top-right corners.
    const s = poly("/");
    expect(contains(s.points, 0.5, B - 0.5)).toBe(true);
    expect(contains(s.points, B - 0.5, 0.5)).toBe(true);
    // ...and not through the other two, or it would not lean.
    expect(contains(s.points, 0.5, 0.5)).toBe(false);
    expect(contains(s.points, B - 0.5, B - 0.5)).toBe(false);
    expect(bandWidthOf(s)).toBeCloseTo(HATCH_GLYPH_BAND, 10);
  });

  it("runs `\` corner to corner DESCENDING left to right", () => {
    const s = poly("\\");
    expect(contains(s.points, 0.5, 0.5)).toBe(true);
    expect(contains(s.points, B - 0.5, B - 0.5)).toBe(true);
    expect(contains(s.points, 0.5, B - 0.5)).toBe(false);
    expect(contains(s.points, B - 0.5, 0.5)).toBe(false);
    expect(bandWidthOf(s)).toBeCloseTo(HATCH_GLYPH_BAND, 10);
  });

  it("reaches every side of the box, so the band spans it rather than sitting in the middle", () => {
    for (const char of ["/", "\\"] as const) {
      const xs = poly(char).points.map(([x]) => x);
      const ys = poly(char).points.map(([, y]) => y);
      expect(Math.min(...xs), `char ${char}`).toBe(0);
      expect(Math.max(...xs), `char ${char}`).toBe(B);
      expect(Math.min(...ys), `char ${char}`).toBe(0);
      expect(Math.max(...ys), `char ${char}`).toBe(B);
    }
  });

  it("superimposes both diagonals for `x`, at the narrower crossed weight", () => {
    const a = poly("x", 0);
    const b = poly("x", 1);
    expect(bandWidthOf(a)).toBeCloseTo(HATCH_GLYPH_BAND_CROSSED, 10);
    expect(bandWidthOf(b)).toBeCloseTo(HATCH_GLYPH_BAND_CROSSED, 10);
    // One ascends, one descends — an x, not a doubled stroke.
    expect(contains(a.points, 0.5, B - 0.5)).toBe(true);
    expect(contains(b.points, 0.5, 0.5)).toBe(true);
  });
});
