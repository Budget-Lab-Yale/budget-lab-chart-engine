// @vitest-environment jsdom
//
// Hatch geometry. Two things here are easy to get wrong and invisible in unit-free code.
//
// 1. THE TILE MUST STAY SEAMLESS. A 7×7 tile containing a vertical line tiles perfectly. Rotating
//    that LINE inside the fixed tile does not — the line swings out of the cell and the tiling
//    breaks up. So the rotation belongs on the tile (`patternTransform`), which rotates the whole
//    infinite tiling and stays seamless. That constrains the decomposition: every character is
//    one-or-two PERPENDICULAR lines drawn in the cell, plus one tile rotation. `x` is therefore
//    `+` rotated 45°, not two independently rotated diagonals.
//
// 2. THE SVG↔CSS ANGLE RELATIONSHIP. Chart marks are real <pattern> elements; legend and tooltip
//    swatches are CSS gradients. If they disagree the key leans the opposite way from the bars and
//    nothing else catches it. With band direction `d` measured clockwise from vertical:
//      SVG — the primitive is a VERTICAL line, so rotate(θ) gives d = θ.
//      CSS — angle φ names the GRADIENT line (clockwise from up) and lays bands PERPENDICULAR to
//            it, so d = φ + 90.
//    Equating: φ = θ − 90.
//    Issue #26 says the CSS angle is the NEGATION of the SVG angle. That holds only for the two
//    diagonals, where −θ and θ−90 coincide modulo 180° (a symmetric repeating gradient is
//    unchanged by a 180° flip). For `|` and `-` negation is off by 90°, which would silently swap
//    vertical and horizontal between chart and legend.
import { describe, it, expect } from "vitest";
import { tokens } from "../src/theme/tokens";
import {
  HATCH_CHARS,
  defaultHatchStroke,
  isHatchChar,
  hatchAngles,
  hatchCssAngles,
  hatchPatternId,
  hatchSvgPattern,
  hatchCss,
  HATCH_PERIOD,
  HATCH_STROKE,
  HATCH_STROKE_CROSSED,
  hatchStrokeWidth,
} from "../src/engine/hatch";

const GROUND = "#58A3E7";
const STROKE = "#0070AF";

/** Two hatch directions are the same LINE if they agree modulo 180°. */
const sameDirection = (a: number, b: number) => ((a - b) % 180 + 180) % 180 === 0;

describe("the hatch character set", () => {
  it("is exactly matplotlib's six", () => {
    expect(HATCH_CHARS).toEqual(["/", "\\", "|", "-", "+", "x"]);
  });

  it("accepts each of the six", () => {
    for (const c of HATCH_CHARS) expect(isHatchChar(c)).toBe(true);
  });

  it("rejects a density repeat — deliberately not supported", () => {
    expect(isHatchChar("//")).toBe(false);
    expect(isHatchChar("xx")).toBe(false);
  });

  it("rejects near-misses and non-strings", () => {
    expect(isHatchChar("X")).toBe(false);
    expect(isHatchChar("")).toBe(false);
    expect(isHatchChar(" / ")).toBe(false);
    expect(isHatchChar(undefined)).toBe(false);
    expect(isHatchChar(45)).toBe(false);
  });
});

describe("hatchAngles — each character is a picture of its own result", () => {
  it("leans the single-direction characters the way the glyph does", () => {
    expect(hatchAngles("|")).toEqual([0]);
    expect(hatchAngles("/")).toEqual([45]);
    expect(hatchAngles("\\")).toEqual([-45]);
    expect(hatchAngles("-")).toEqual([90]);
  });

  it("gives a crossed character two perpendicular directions", () => {
    for (const c of ["+", "x"] as const) {
      const [a, b] = hatchAngles(c) as [number, number];
      expect(hatchAngles(c)).toHaveLength(2);
      expect(sameDirection(a + 90, b)).toBe(true);
    }
  });

  it("builds each crossed character out of the pair its glyph depicts", () => {
    // `+` is `|` and `-`; `x` is `/` and `\` — compared as line directions, since the
    // implementation is free to name `\` as either −45° or 135°.
    const [plusA, plusB] = hatchAngles("+") as [number, number];
    expect(sameDirection(plusA, hatchAngles("|")[0]!)).toBe(true);
    expect(sameDirection(plusB, hatchAngles("-")[0]!)).toBe(true);

    const [crossA, crossB] = hatchAngles("x") as [number, number];
    expect(sameDirection(crossA, hatchAngles("/")[0]!)).toBe(true);
    expect(sameDirection(crossB, hatchAngles("\\")[0]!)).toBe(true);
  });
});

describe("hatchCssAngles — the mirror trap", () => {
  it("is the SVG rotation minus 90 degrees, for every character", () => {
    for (const c of HATCH_CHARS) {
      expect(hatchCssAngles(c)).toEqual(hatchAngles(c).map((a) => a - 90));
    }
  });

  it("keeps vertical vertical and horizontal horizontal, where plain negation fails", () => {
    expect(hatchCssAngles("|")).toEqual([-90]);
    expect(hatchCssAngles("-")).toEqual([0]);
  });
});

describe("hatchPatternId", () => {
  it("is stable for the same character and colours", () => {
    expect(hatchPatternId("/", GROUND, STROKE)).toBe(hatchPatternId("/", GROUND, STROKE));
  });

  it("distinguishes character, ground and stroke", () => {
    const base = hatchPatternId("/", GROUND, STROKE);
    expect(hatchPatternId("\\", GROUND, STROKE)).not.toBe(base);
    expect(hatchPatternId("/", "#FFFFFF", STROKE)).not.toBe(base);
    expect(hatchPatternId("/", GROUND, "#000000")).not.toBe(base);
  });

  it("is a legal SVG id — nothing unescaped from the character or the colours", () => {
    for (const c of HATCH_CHARS) {
      expect(hatchPatternId(c, GROUND, STROKE)).toMatch(/^[A-Za-z][-A-Za-z0-9_]*$/);
    }
  });
});

describe("hatchSvgPattern", () => {
  it("emits a userSpaceOnUse pattern one period square", () => {
    const p = hatchSvgPattern(document, "/", GROUND, STROKE);
    expect(p.tagName).toBe("pattern");
    expect(p.getAttribute("patternUnits")).toBe("userSpaceOnUse");
    expect(p.getAttribute("width")).toBe(String(HATCH_PERIOD));
    expect(p.getAttribute("height")).toBe(String(HATCH_PERIOD));
    expect(p.getAttribute("id")).toBe(hatchPatternId("/", GROUND, STROKE));
  });

  it("paints the declared colour as the ground, so the fill still reads as its series colour", () => {
    const p = hatchSvgPattern(document, "/", GROUND, STROKE);
    const rect = p.querySelector("rect")!;
    expect(rect.getAttribute("width")).toBe(String(HATCH_PERIOD));
    expect(rect.getAttribute("style")).toContain(GROUND);
  });

  it("rotates the TILE, not the lines, so the tiling stays seamless", () => {
    const p = hatchSvgPattern(document, "/", GROUND, STROKE);
    expect(p.getAttribute("patternTransform")).toBe("rotate(45)");
    expect(p.querySelector("line")!.hasAttribute("transform")).toBe(false);
  });

  it("omits the tile rotation entirely for the two unrotated characters", () => {
    for (const c of ["|", "+"] as const) {
      expect(hatchSvgPattern(document, c, GROUND, STROKE).hasAttribute("patternTransform")).toBe(false);
    }
  });

  it("draws one stroked line for a single-direction character", () => {
    for (const c of ["|", "-", "/", "\\"] as const) {
      const lines = [...hatchSvgPattern(document, c, GROUND, STROKE).querySelectorAll("line")];
      expect(lines).toHaveLength(1);
      expect(lines[0]!.getAttribute("stroke-width")).toBe(String(HATCH_STROKE));
      expect(lines[0]!.getAttribute("style")).toContain(STROKE);
    }
  });

  it("crosses a perpendicular pair inside the cell for `+` and `x`", () => {
    for (const c of ["+", "x"] as const) {
      const lines = [...hatchSvgPattern(document, c, GROUND, STROKE).querySelectorAll("line")];
      expect(lines).toHaveLength(2);
      // One spans the cell vertically, the other horizontally — perpendicular, both seamless.
      expect(lines[0]!.getAttribute("y2")).toBe(String(HATCH_PERIOD));
      expect(lines[1]!.getAttribute("x2")).toBe(String(HATCH_PERIOD));
    }
  });

  it("is `+` rotated 45 degrees for `x`", () => {
    expect(hatchSvgPattern(document, "x", GROUND, STROKE).getAttribute("patternTransform")).toBe(
      "rotate(45)",
    );
  });
});

describe("defaultHatchStroke", () => {
  const blue = tokens.scales.blue as Record<string, string>;

  it("steps down the SAME tonal ramp when the ground is one of its tiers", () => {
    // blue-200 → blue-400: still in palette, and visibly darker at a 3px line weight.
    expect(defaultHatchStroke(blue["200"]!)).toBe(blue["400"]);
  });

  it("does not care about the case the ground was written in", () => {
    expect(defaultHatchStroke(blue["200"]!.toLowerCase())).toBe(blue["400"]);
  });

  it("never returns the ground itself, even at the darkest tier", () => {
    const darkest = blue["700"]!;
    expect(defaultHatchStroke(darkest).toUpperCase()).not.toBe(darkest.toUpperCase());
  });

  it("darkens in colour space for a colour that is on no ramp", () => {
    const stroke = defaultHatchStroke("#808080");
    expect(stroke).toMatch(/^#[0-9a-f]{6}$/i);
    expect(stroke.toUpperCase()).not.toBe("#808080");
    // Darker, not lighter: compare summed channels.
    const lum = (h: string) =>
      parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
    expect(lum(stroke)).toBeLessThan(lum("#808080"));
  });

  it("returns something usable for a categorical base hue", () => {
    const stroke = defaultHatchStroke(tokens.categorical[0]!.base);
    expect(stroke).toMatch(/^#[0-9a-f]{6}$/i);
    expect(stroke.toUpperCase()).not.toBe(tokens.categorical[0]!.base.toUpperCase());
  });
});

describe("hatchCss", () => {
  it("carries the ground as the background colour", () => {
    expect(hatchCss("/", GROUND, STROKE).backgroundColor).toBe(GROUND);
  });

  it("lays one repeating gradient per direction, at the CSS angle", () => {
    expect(hatchCss("/", GROUND, STROKE).backgroundImage).toBe(
      `repeating-linear-gradient(-45deg, ${STROKE} 0 ${HATCH_STROKE}px, transparent ${HATCH_STROKE}px ${HATCH_PERIOD}px)`,
    );
  });

  it("uses the crossed character's thinner stroke, so its ink does not double up", () => {
    expect(hatchCss("+", GROUND, STROKE).backgroundImage).toContain(`0 ${HATCH_STROKE_CROSSED}px`);
    expect(hatchCss("+", GROUND, STROKE).backgroundImage).not.toContain(`0 ${HATCH_STROKE}px`);
  });

  it("layers both gradients for a crossed character, gaps transparent so the lower shows through", () => {
    const { backgroundImage } = hatchCss("+", GROUND, STROKE);
    expect(backgroundImage.split("repeating-linear-gradient").length - 1).toBe(2);
    expect(backgroundImage).toContain("-90deg");
    expect(backgroundImage).toContain("0deg");
    // The ground never appears in a gradient stop: it comes from background-color alone, so a
    // layered pair cannot paint over the layer beneath it.
    expect(backgroundImage).not.toContain(GROUND);
  });
});

// The geometry is deliberately coarse: broad bands of colour reading as an alternating two-tone,
// rather than fine pinstripes. Two properties are worth locking, because both are invisible in the
// numbers alone and both were wrong in the first cut.
describe("hatch weight", () => {
  /** Fraction of the tile covered by ink. One direction lays a band; two crossed directions overlap,
   *  so their combined coverage is 1 − (gap fraction)², NOT twice one direction's. */
  const coverage = (char: Parameters<typeof hatchStrokeWidth>[0]) => {
    const s = hatchStrokeWidth(char);
    const gap = (HATCH_PERIOD - s) / HATCH_PERIOD;
    return hatchAngles(char).length === 2 ? 1 - gap * gap : s / HATCH_PERIOD;
  };

  it("reads as broad alternating bands, not pinstripes", () => {
    // Ink and ground within a factor of ~1.5 of each other is what makes it read as two-tone.
    expect(coverage("/")).toBeGreaterThan(0.35);
    expect(coverage("/")).toBeLessThan(0.5);
    // And the band itself is broad in absolute terms, not a hairline.
    expect(HATCH_STROKE).toBeGreaterThanOrEqual(6);
  });

  it("weighs every character the same, so `x` is not heavier than `/`", () => {
    const weights = HATCH_CHARS.map(coverage);
    const min = Math.min(...weights);
    const max = Math.max(...weights);
    // Crossing two 43%-ink directions would give 67% coverage; the crossed characters use a
    // thinner stroke to land back on the same weight.
    expect(max - min).toBeLessThan(0.04);
  });

  it("gives a crossed character a thinner stroke than a single-direction one", () => {
    expect(hatchStrokeWidth("+")).toBeLessThan(hatchStrokeWidth("/"));
    expect(hatchStrokeWidth("x")).toBe(hatchStrokeWidth("+"));
    expect(hatchStrokeWidth("|")).toBe(hatchStrokeWidth("/"));
  });
});
