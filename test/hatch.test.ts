// @vitest-environment jsdom
//
// Hatch geometry for the MARKS. The one thing worth pinning hardest:
//
// THE TILE CLIPS, AND IT MUST TILE. A <pattern> establishes its own viewport, so anything crossing
// the cell edge is cut, not wrapped: a stroked line centred on x=0 loses its outer half and renders
// at HALF its nominal width (measured 17.5% coverage for stroke-width 7, where an explicit 7px rect
// gives 43.3%). Hence bands are RECTS, sized exactly. The same clipping is why rotation goes on
// `patternTransform` — rotating a shape inside a fixed cell swings it out of the cell — which forces
// the decomposition: one-or-two PERPENDICULAR bands in the cell, plus one tile rotation. `x` is `+`
// rotated 45°, NOT two separately rotated diagonals.
//
// The legend/tooltip KEY is a different drawing entirely — one centred glyph, not a patch of this
// tiling. See test/hatch-glyph.test.ts and test/hatch-legend-legibility.test.ts.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tokens } from "../src/theme/tokens";
import { locateOnRamp, shiftLightness } from "../src/engine/palette";
import { d3 } from "../src/engine/vendor";
import type { HatchChar } from "../src/spec/types";
import {
  HATCH_CHARS,
  defaultHatchStroke,
  hatchBandTier,
  isHatchChar,
  hatchPatternId,
  hatchSvgPattern,
  HATCH_PERIOD,
  HATCH_STROKE,
  HATCH_STROKE_CROSSED,
  hatchStrokeWidth,
  resolveHatch,
} from "../src/engine/hatch";

const GROUND = "#58A3E7";
const STROKE = "#0070AF";

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

describe("each character is a picture of its own result", () => {
  // Asserted on the emitted <pattern>, not on an intermediate angle helper: the tile rotation IS
  // the direction, so testing the output leaves nothing between the claim and the pixels.
  const rotationOf = (char: HatchChar) =>
    hatchSvgPattern(document, char, GROUND, STROKE).getAttribute("patternTransform");

  it("leans each single-direction character the way its glyph does", () => {
    expect(rotationOf("|")).toBeNull(); // no rotation — the primitive is already vertical
    expect(rotationOf("-")).toBe("rotate(90)");
    expect(rotationOf("/")).toBe("rotate(45)");
    expect(rotationOf("\\")).toBe("rotate(-45)");
  });

  it("builds each crossed character from the pair its glyph depicts", () => {
    // `+` is `|` and `-` — the unrotated pair, so the tile is unrotated and holds two bands.
    expect(rotationOf("+")).toBeNull();
    // `x` is that same crossed pair turned 45°, which is `/` and `\`.
    expect(rotationOf("x")).toBe(rotationOf("/"));
  });

  it("gives a crossed character two bands and a single-direction character one", () => {
    for (const c of ["|", "-", "/", "\\"] as const) {
      // ground + one band
      expect([...hatchSvgPattern(document, c, GROUND, STROKE).querySelectorAll("rect")]).toHaveLength(2);
    }
    for (const c of ["+", "x"] as const) {
      expect([...hatchSvgPattern(document, c, GROUND, STROKE).querySelectorAll("rect")]).toHaveLength(3);
    }
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

  it("rotates the TILE, not the bands, so the tiling stays seamless", () => {
    const p = hatchSvgPattern(document, "/", GROUND, STROKE);
    expect(p.getAttribute("patternTransform")).toBe("rotate(45)");
    for (const r of p.querySelectorAll("rect")) expect(r.hasAttribute("transform")).toBe(false);
  });

  it("draws the band as a RECT, never a centred stroke", () => {
    // A <pattern> clips to its tile, so a stroke centred on the tile edge loses the half outside it:
    // measured, a stroke-width 7 line renders 17.5% coverage where a 7px rect renders 43.3%. It also
    // silently disagreed with the CSS swatch, whose hard gradient stops are a true band.
    const p = hatchSvgPattern(document, "/", GROUND, STROKE);
    expect(p.querySelector("line")).toBeNull();
    expect(p.querySelector("[stroke-width]")).toBeNull();
  });

  it("omits the tile rotation entirely for the two unrotated characters", () => {
    for (const c of ["|", "+"] as const) {
      expect(hatchSvgPattern(document, c, GROUND, STROKE).hasAttribute("patternTransform")).toBe(false);
    }
  });

  it("draws one band the full height of the cell for a single-direction character", () => {
    for (const c of ["|", "-", "/", "\\"] as const) {
      const rects = [...hatchSvgPattern(document, c, GROUND, STROKE).querySelectorAll("rect")];
      expect(rects).toHaveLength(2); // ground + one band
      const band = rects[1]!;
      expect(band.getAttribute("width")).toBe(String(HATCH_STROKE));
      expect(band.getAttribute("height")).toBe(String(HATCH_PERIOD));
      expect(band.getAttribute("style")).toContain(STROKE);
    }
  });

  it("crosses a perpendicular pair of bands inside the cell for `+` and `x`", () => {
    for (const c of ["+", "x"] as const) {
      const rects = [...hatchSvgPattern(document, c, GROUND, STROKE).querySelectorAll("rect")];
      expect(rects).toHaveLength(3); // ground + two crossed bands
      // One band spans the cell vertically, the other horizontally.
      expect(rects[1]!.getAttribute("height")).toBe(String(HATCH_PERIOD));
      expect(rects[1]!.getAttribute("width")).toBe(String(HATCH_STROKE_CROSSED));
      expect(rects[2]!.getAttribute("width")).toBe(String(HATCH_PERIOD));
      expect(rects[2]!.getAttribute("height")).toBe(String(HATCH_STROKE_CROSSED));
    }
  });

  it("is `+` rotated 45 degrees for `x`", () => {
    expect(hatchSvgPattern(document, "x", GROUND, STROKE).getAttribute("patternTransform")).toBe(
      "rotate(45)",
    );
  });
});

describe("defaultHatchStroke — the palette rule", () => {
  const TIERS = ["50", "100", "200", "300", "400", "500", "600", "700"] as const;
  const scales = tokens.scales as Record<string, Record<string, string>>;
  const L = (hex: string) => d3.lab(d3.color(hex)!).l;

  it("steps THREE tiers darker along the ground's own hue ramp", () => {
    expect(defaultHatchStroke(scales.blue!["200"]!)).toBe(scales.blue!["500"]);
    expect(defaultHatchStroke(scales.violet!["100"]!)).toBe(scales.violet!["400"]);
    expect(defaultHatchStroke(scales.green!["400"]!)).toBe(scales.green!["700"]);
  });

  it("locates a CANONICAL base on its ramp by lightness, not by exact hex", () => {
    // The canonical hues are near-misses for their own tiers (blue is #0072B2, blue-400 is
    // #0070AF), so an exact-hex lookup finds nothing and falls off the palette entirely.
    const blue = tokens.categorical.find((c) => c.key === "blue")!;
    expect(TIERS.some((tier) => scales.blue![tier]!.toUpperCase() === blue.base.toUpperCase())).toBe(false);
    expect(defaultHatchStroke(blue.base)).toBe(scales.blue!["700"]);
  });

  it("goes LIGHTER instead when the ground is too dark to darken", () => {
    // russet's base sits at tier 500, so +3 would overrun 700; it inverts to a light band.
    const russet = tokens.categorical.find((c) => c.key === "russet")!;
    expect(defaultHatchStroke(russet.base)).toBe(scales.russet!["200"]);
    expect(defaultHatchStroke(scales.blue!["700"]!)).toBe(scales.blue!["400"]);
  });

  it("puts navy and sky on the blue ramp — blue-family brand colours with an obvious home", () => {
    expect(defaultHatchStroke(tokens.brand.navy)).toBe(scales.blue!["400"]);
    expect(defaultHatchStroke(tokens.brand.sky)).toBe(scales.blue!["500"]);
  });

  it("falls back to a perceptual step for a colour on no ramp", () => {
    const grey = defaultHatchStroke(tokens.structural.text_muted);
    expect(grey).toMatch(/^#[0-9a-f]{6}$/i);
    // Sized to match the on-ramp rule, so an off-palette colour behaves like a palette one.
    expect(Math.abs(L(tokens.structural.text_muted) - L(grey))).toBeGreaterThan(20);
    expect(Math.abs(L(tokens.structural.text_muted) - L(grey))).toBeLessThan(33);
  });

  it("lightens rather than darkens when an off-ramp ground has no room below", () => {
    expect(L(defaultHatchStroke("#000000"))).toBeGreaterThan(0);
  });

  it("never returns the ground itself", () => {
    for (const fam of Object.keys(scales))
      for (const tier of TIERS)
        expect(defaultHatchStroke(scales[fam]![tier]!).toUpperCase()).not.toBe(scales[fam]![tier]!.toUpperCase());
  });
});

// A <pattern> whose band and ground are one colour is a FLAT BLOCK — the texture is silently not
// there, on a chart that otherwise looks right, and it reaches the legend key and the PNG export
// the same way. Every step defaultHatchStroke can take needs the ground's LIGHTNESS, so a ground
// d3.color cannot read comes straight back out and lands exactly there. `series_colors` passes an
// author's string through unchanged by design, so the string is reachable from a spec.
describe("resolveHatch refuses a ground it cannot read", () => {
  const UNREADABLE = [
    "not-a-colour", // a typo, or a colour name the CSS spec does not have
    "var(--tbl-blue)", // a CSS custom property: the browser resolves it, d3.color does not
    "currentColor", // what the root <svg> is stamped with; see painted-fill.ts
  ];

  it("throws rather than painting a texture that is not there", () => {
    for (const ground of UNREADABLE) {
      expect(() => resolveHatch("/", ground), ground).toThrow(/cannot read that as a colour/);
      // The message has to name the offending string — it is the thing the author must fix.
      expect(() => resolveHatch("/", ground), ground).toThrow(new RegExp(escapeRe(ground)));
    }
  });

  it("resolves every readable ground, on the ramp or off it", () => {
    for (const ground of ["#58A3E7", tokens.brand.navy, "rebeccapurple", "rgb(1, 2, 3)"]) {
      const hatch = resolveHatch("/", ground);
      expect(hatch.stroke, ground).not.toBe(ground);
    }
  });
});

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The ramp step on a SHORT ramp. Asserting only against the real tokens would prove nothing here:
// all seven families ship eight tiers, so the underflow is unreachable through them and a test that
// went through them would pass just as happily against the old broken code. `locateOnRamp` builds
// its tiers by dropping the ones a family doesn't ship, so shortness is a token-file change away.
describe("hatchBandTier — the ramp step, on a ramp that may be short", () => {
  const ramp = (n: number) => Array.from({ length: n }, (_, i) => `#tier${i}`);

  it("steps three tiers darker when the ramp has room below", () => {
    expect(hatchBandTier(ramp(8), 1)).toBe("#tier4");
  });

  it("inverts to three tiers lighter when darkening would overrun the ramp", () => {
    expect(hatchBandTier(ramp(8), 7)).toBe("#tier4");
  });

  it("reports NO tier rather than a hole in the array when neither step fits", () => {
    // Five tiers, ground in the middle: darkening wants index 5 (past the end), inverting wants
    // index -1. The old code took the inverted index unconditionally and cast `tiers[-1]` to string,
    // so `defaultHatchStroke` returned undefined and the pattern got `fill:undefined`.
    expect(hatchBandTier(ramp(5), 2)).toBeUndefined();
    expect(hatchBandTier(ramp(3), 0)).toBeUndefined();
  });

  it("returns a member of the ramp or nothing, at every length and index", () => {
    for (let n = 1; n <= 8; n++) {
      const tiers = ramp(n);
      for (let i = 0; i < n; i++) {
        const band = hatchBandTier(tiers, i);
        if (band !== undefined) expect(tiers).toContain(band);
      }
    }
  });

  it("hands a ground on NO ramp to the perceptual fallback, which always yields a colour", () => {
    // A neutral: locateOnRamp returns null, so this never reaches the ramp branch at all. It pins
    // the OTHER half of the composition — see the short-ramp case below for the half that matters.
    expect(locateOnRamp("#808080")).toBeNull();
    expect(defaultHatchStroke("#808080")).toMatch(/^#[0-9a-f]{6}$/i);
  });

  // The behaviour change 2dfe9b7 actually made is at the CALLER: `hatchBandTier` returning
  // undefined must fall THROUGH to the perceptual rule, where the pre-fix `tiers[index - 3] as
  // string` returned undefined and put `fill:undefined` into a <pattern>. Reaching that needs a
  // ground that is ON a ramp whose ramp is too short — `#808080` above is neither, so it enters the
  // branch never. locateOnRamp reads tokens.scales at CALL time for a near-miss hue (the canonical
  // `blue` is #0072B2; blue-400 is #0070AF), so shortening the family here is exactly the token-file
  // change the fix anticipates, with no fake token module needed.
  describe("a ground that is on a ramp too short to step along", () => {
    const scales = tokens.scales as unknown as Record<string, Record<string, string>>;
    const BLUE = tokens.categorical.find((c) => c.key === "blue")!.base;
    let saved: Record<string, string>;

    beforeEach(() => {
      saved = scales.blue!;
      // Three tiers: darkening wants index+3 (past the end) and inverting wants index−3 (negative),
      // at every index — so hatchBandTier has no answer whichever tier the ground locates to.
      scales.blue = { "50": "#95DAFF", "100": "#77BEFF", "200": "#58A3E7" };
    });
    afterEach(() => {
      scales.blue = saved;
    });

    it("really does enter the fallthrough — on a ramp, with no tier to step to", () => {
      const loc = locateOnRamp(BLUE);
      expect(loc).not.toBeNull();
      expect(loc!.tiers).toHaveLength(3);
      expect(hatchBandTier(loc!.tiers, loc!.index)).toBeUndefined();
    });

    it("falls through to the perceptual step instead of returning undefined", () => {
      const stroke = defaultHatchStroke(BLUE);
      expect(stroke).toMatch(/^#[0-9a-f]{6}$/i);
      // The ground is dark enough to darken, so the fallback takes the −28 L* step — the same
      // distance the three-tier ramp step would have covered.
      expect(stroke).toBe(shiftLightness(BLUE, -28));
      expect(locateOnRamp(BLUE)!.tiers).not.toContain(stroke);
    });
  });
});

// A CI gate, not a unit test. The rule only works because the tonal tiers are iso-lightness across
// hues (tier 200 is ~L*65 in every family), which makes "three tiers" the same perceptual distance
// everywhere. A future token retune could quietly break that and flatten every hatch pair in the
// archive at once, with nothing else to catch it.
describe("hatch contrast holds across the whole palette", () => {
  const TIERS = ["50", "100", "200", "300", "400", "500", "600", "700"];
  const scales = tokens.scales as Record<string, Record<string, string>>;
  const L = (hex: string) => d3.lab(d3.color(hex)!).l;

  /** Every colour an author can name that belongs to a hue family. */
  const palette: Array<[string, string]> = [
    ...Object.entries(scales).flatMap(([fam, s]) =>
      TIERS.map((tier) => [`${fam}-${tier}`, s[tier]!] as [string, string]),
    ),
    ...tokens.categorical.flatMap((c) => [
      [`${c.key} base`, c.base] as [string, string],
      [`${c.key} light`, c.light] as [string, string],
    ]),
    ["navy", tokens.brand.navy],
    ["sky", tokens.brand.sky],
  ];

  it("covers every hue-family colour in the palette", () => {
    expect(palette.length).toBe(7 * 8 + 7 * 2 + 2);
  });

  it("keeps every hatch pair inside one hue family", () => {
    for (const [name, hex] of palette) {
      const stroke = defaultHatchStroke(hex);
      const family = Object.entries(scales).find(([, s]) => Object.values(s).includes(stroke));
      expect(family, `${name} (${hex}) -> ${stroke} is not a palette token`).toBeTruthy();
    }
  });

  it("keeps every hatch pair between 20 and 33 L* apart", () => {
    for (const [name, hex] of palette) {
      const dL = Math.abs(L(hex) - L(defaultHatchStroke(hex)));
      expect(dL, `${name} (${hex}) ΔL*=${dL.toFixed(1)}`).toBeGreaterThan(20);
      expect(dL, `${name} (${hex}) ΔL*=${dL.toFixed(1)}`).toBeLessThan(33);
    }
  });
});

describe("hatch weight", () => {
  /** Fraction of the tile covered by ink. One direction lays a band; two crossed directions overlap,
   *  so their combined coverage is 1 − (gap fraction)², NOT twice one direction's. */
  const coverage = (char: HatchChar) => {
    const s = hatchStrokeWidth(char);
    const gap = (HATCH_PERIOD - s) / HATCH_PERIOD;
    // Two bands overlap their ink, so their union is 1 - gap², not twice one band's.
    const bands = hatchSvgPattern(document, char, GROUND, STROKE).querySelectorAll("rect").length - 1;
    return bands === 2 ? 1 - gap * gap : s / HATCH_PERIOD;
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
