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
  // A line covers the centre when the centre lies on it (all glyph lines are corner-to-corner).
  const midX = (s.x1 + s.x2) / 2;
  const midY = (s.y1 + s.y2) / 2;
  return Math.abs(midX - C) < 0.001 && Math.abs(midY - C) < 0.001;
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
  const line = (char: "/" | "\\" | "x", i = 0) =>
    hatchGlyphShapes(char)[i] as Extract<HatchGlyphShape, { kind: "line" }>;

  it("runs `/` corner to corner ASCENDING left to right", () => {
    const l = line("/");
    // SVG y grows downward, so ascending means y1 > y2.
    expect(l.x1).toBeLessThan(l.x2);
    expect(l.y1).toBeGreaterThan(l.y2);
    expect(l.width).toBe(HATCH_GLYPH_BAND);
  });

  it("runs `\\` corner to corner DESCENDING left to right", () => {
    const l = line("\\");
    expect(l.x1).toBeLessThan(l.x2);
    expect(l.y1).toBeLessThan(l.y2);
  });

  it("spans the full box on both diagonals, so the band reaches the corners", () => {
    for (const char of ["/", "\\"] as const) {
      const l = line(char);
      expect(Math.abs(l.x2 - l.x1)).toBe(HATCH_GLYPH_BOX);
      expect(Math.abs(l.y2 - l.y1)).toBe(HATCH_GLYPH_BOX);
    }
  });

  it("superimposes both diagonals for `x`, at the narrower crossed weight", () => {
    const a = line("x", 0);
    const b = line("x", 1);
    expect(a.width).toBe(HATCH_GLYPH_BAND_CROSSED);
    expect(b.width).toBe(HATCH_GLYPH_BAND_CROSSED);
    // One ascends, one descends — an x, not a doubled stroke.
    expect(Math.sign(a.y2 - a.y1)).toBe(-Math.sign(b.y2 - b.y1));
  });
});
