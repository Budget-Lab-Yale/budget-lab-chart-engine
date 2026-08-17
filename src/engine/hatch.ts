// Series hatch textures — matplotlib's six characters (/ \ | - + x) as a fill channel alongside
// colour. The character is a picture of the result, so there is no left-vs-right ambiguity to
// resolve in prose. The colour the mark is actually PAINTED is the pattern's GROUND — the series
// colour until `bar_color`, `category_colors` or the title-selector accent overrides the fill (see
// `painted-fill.ts`) — so a spec that omits `series_patterns` renders exactly as before.
//
// This module is the single source of truth for the geometry, and there is exactly one emitter:
// `hatchSvgPattern` below. The chart marks, the PNG export and the legend/tooltip glyphs are all
// SVG <pattern>s built from the table below. A second, CSS-gradient emitter for the HTML swatches
// used to exist and had to mirror this geometry by hand; 1.11.0 retired it, which is what removed
// the class of bug where a swatch and the mark it named disagreed about direction or band weight.
//
// INVARIANT — the tile CLIPS, and it must tile. A <pattern> establishes its own viewport, so
// anything crossing the cell edge is cut, not wrapped: a stroked line centred on x=0 loses its outer
// half and renders at HALF its nominal width (measured 17.5% coverage for stroke-width 7, where an
// explicit 7px rect gives 43.3%). Hence bands are RECTS, sized exactly. The same clipping is why
// rotation goes on `patternTransform` — rotating a shape inside a fixed cell swings it out of the
// cell — which forces the decomposition below: one-or-two PERPENDICULAR bands in the cell, plus one
// tile rotation. `x` is `+` rotated 45°, NOT two separately rotated diagonals.
import { locateOnRamp, lightness, shiftLightness } from "./palette";
import type { HatchChar } from "../spec/types";

export type { HatchChar };

// Tile size, in user units (≈ px at chart scale).
//
// The geometry is deliberately COARSE — broad bands of colour reading as an alternating two-tone,
// not pinstripes. At 16/7 the ground and the band read as two colours banded together, which is what
// makes the distinction survive a projector and grayscale. Rasterised and pixel-counted at 42–47%
// band for all six characters (the spread is antialiasing on the diagonals).
export const HATCH_PERIOD = 16;

/** `rotate` is the tile rotation; `crossed` adds a second band perpendicular to the first.
 *  See the INVARIANT above — this pair is the only decomposition that tiles. */
const GEOM: Record<HatchChar, { rotate: number; crossed: boolean; slug: string }> = {
  "|": { rotate: 0, crossed: false, slug: "vert" },
  "-": { rotate: 90, crossed: false, slug: "horz" },
  "/": { rotate: 45, crossed: false, slug: "fwd" },
  "\\": { rotate: -45, crossed: false, slug: "bwd" },
  "+": { rotate: 0, crossed: true, slug: "plus" },
  x: { rotate: 45, crossed: true, slug: "cross" },
};

/** Band WIDTH for a single-direction character on a MARK, in tile units. Rendered as an explicit
 *  rect, so this is the width that actually appears — see hatchSvgPattern. */
export const HATCH_STROKE = 7;

/** Band width for a CROSSED character on a mark. Narrower: crossing two directions overlaps their
 *  ink, so total coverage is 1 - (gap/period)^2, not twice one direction's. At the single-direction
 *  width `+` and `x` would come out 1.55x heavier than `/` - visibly denser for no reason, since
 *  weight carries no meaning here. 4 of 16 solves 1 - (12/16)^2 = 43.75%, matching 7/16. */
export const HATCH_STROKE_CROSSED = 4;

/** The band width this character is drawn at on a mark. */
export function hatchStrokeWidth(char: HatchChar): number {
  return GEOM[char].crossed ? HATCH_STROKE_CROSSED : HATCH_STROKE;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** The legend/tooltip GLYPH: one centred instance of the texture, in a square box.
 *
 *  A tile is the wrong primitive at this size. A 14px box holds a fraction of the mark's period, so
 *  a tiled key shows an edge rather than a direction, and it has to grow into an awkward rectangle
 *  before a crossed character resolves at all. A glyph inverts that — draw exactly ONE instance,
 *  centred, ground either side: `/` reads as three bands (ground, mark, ground), `+` as a plus, `x`
 *  as an x. Recognition comes from the shape, so a small square is enough.
 *
 *  All six are drawn in SVG, on the marks, in the key and in the export — so unlike a CSS-gradient
 *  key there is only one coordinate convention and no angle conversion to get wrong. */
export const HATCH_GLYPH_BOX = 14;

/** Band width for a single-direction glyph. 6 of 14 leaves 4px of ground either side: equal, integer,
 *  pixel-crisp, and ~43% ink, which is the mark's coverage. */
export const HATCH_GLYPH_BAND = 6;

/** Band width for a crossed glyph. Narrower for the same reason the mark's is — two crossing bands
 *  overlap their ink — and it keeps 5px of ground either side of each arm, so the cross reads as a
 *  cross rather than a filled box. */
export const HATCH_GLYPH_BAND_CROSSED = 4;

/** One band of a glyph. A rect for the axis-aligned characters, which must land on integer
 *  coordinates to stay crisp; a line for the diagonals, which cannot be crisp anyway and are
 *  clipped to the box by its viewport. */
export type HatchGlyphShape =
  | { kind: "rect"; x: number; y: number; width: number; height: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; width: number };

/** The bands making up a character's glyph, in a HATCH_GLYPH_BOX-square box. Every band passes
 *  through the centre — that is what "one centred instance" means, and it is what the reader's eye
 *  finds first. */
export function hatchGlyphShapes(char: HatchChar): HatchGlyphShape[] {
  const box = HATCH_GLYPH_BOX;
  const inset = (band: number) => (box - band) / 2;

  const vertical = (band: number): HatchGlyphShape =>
    ({ kind: "rect", x: inset(band), y: 0, width: band, height: box });
  const horizontal = (band: number): HatchGlyphShape =>
    ({ kind: "rect", x: 0, y: inset(band), width: box, height: band });
  /** Ascending left-to-right: SVG y grows downward, so it starts at the BOTTOM-left. */
  const ascending = (band: number): HatchGlyphShape =>
    ({ kind: "line", x1: 0, y1: box, x2: box, y2: 0, width: band });
  const descending = (band: number): HatchGlyphShape =>
    ({ kind: "line", x1: 0, y1: 0, x2: box, y2: box, width: band });

  const wide = HATCH_GLYPH_BAND;
  const thin = HATCH_GLYPH_BAND_CROSSED;
  switch (char) {
    case "|":
      return [vertical(wide)];
    case "-":
      return [horizontal(wide)];
    case "/":
      return [ascending(wide)];
    case "\\":
      return [descending(wide)];
    case "+":
      return [vertical(thin), horizontal(thin)];
    case "x":
      return [ascending(thin), descending(thin)];
  }
}

/** Declaration order is the documented order in CONFIG-SPEC. */
export const HATCH_CHARS: readonly HatchChar[] = ["/", "\\", "|", "-", "+", "x"];

export function isHatchChar(v: unknown): v is HatchChar {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(GEOM, v);
}



/** Content-addressed, so it is deterministic across renders (the golden-SVG gate depends on
 *  stable ids) AND collision-free between two figures on one page: two figures asking for the
 *  same texture over the same colours share an id whose definitions are identical, which is not a
 *  collision. Different textures or colours always get different ids. */
export function hatchPatternId(
  char: HatchChar,
  ground: string,
  stroke: string,
): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9]/g, "");
  return `tblhatch-${GEOM[char].slug}-${safe(ground)}-${safe(stroke)}`;
}

/** The <pattern> for a textured series, ready to append to a plot's <defs>.
 *  Colours go on `style` rather than the `fill`/`stroke` presentation attributes so a
 *  `var(--tbl-*)` reference would resolve, and so no stylesheet rule can override them. */
export function hatchSvgPattern(
  doc: Document,
  char: HatchChar,
  ground: string,
  stroke: string,
): SVGElement {
  const { rotate, crossed } = GEOM[char];
  const period = HATCH_PERIOD;
  const pattern = doc.createElementNS(SVG_NS, "pattern");
  pattern.setAttribute("id", hatchPatternId(char, ground, stroke));
  pattern.setAttribute("width", String(period));
  pattern.setAttribute("height", String(period));
  pattern.setAttribute("patternUnits", "userSpaceOnUse");
  if (rotate !== 0) pattern.setAttribute("patternTransform", `rotate(${rotate})`);

  const bg = doc.createElementNS(SVG_NS, "rect");
  bg.setAttribute("width", String(period));
  bg.setAttribute("height", String(period));
  bg.setAttribute("style", `fill:${ground}`);
  pattern.appendChild(bg);

  // A BAND RECT, not a stroked line. A <pattern> tile clips to its own bounds, so a line centred on
  // the tile edge loses the half that falls outside — it does not wrap into the neighbouring tile.
  // Measured: a `stroke-width: 7` line on x=0 renders 17.5% coverage, where an explicit 7px rect
  // renders 43.3%. Every consumer — the marks, the export and the legend/tooltip glyph — is built
  // from this one emitter, so the band weight cannot differ between a swatch and the mark it names.
  const w = hatchStrokeWidth(char);
  const band = (width: number, height: number) => {
    const el = doc.createElementNS(SVG_NS, "rect");
    el.setAttribute("width", String(width));
    el.setAttribute("height", String(height));
    el.setAttribute("style", `fill:${stroke}`);
    return el;
  };
  pattern.appendChild(band(w, period));
  if (crossed) pattern.appendChild(band(period, w));
  return pattern;
}

/** A series' resolved texture: the character plus the two colours it is drawn from. The band colour
 *  is DERIVED from the ground (see `defaultHatchStroke`), never authored — an author supplies the
 *  colour and the character, and the pair is the engine's to resolve. */
export interface SeriesHatch {
  char: HatchChar;
  ground: string;
  stroke: string;
  id: string;
}

/** Resolve one texture: the character plus the ground it is drawn over. The band colour and the id
 *  both follow from the ground, so this is the only place a hatch is constructed.
 *
 *  INVARIANT — the band is never the ground. A <pattern> painting both in one colour is a FLAT
 *  BLOCK: the texture the author asked for is silently not there, on a chart that otherwise looks
 *  right, and it reaches the legend key and the PNG export the same way. That is what a ground
 *  `d3.color` cannot read produces — a CSS `var(--x)`, `currentColor`, a mistyped colour name —
 *  because every step `defaultHatchStroke` can take needs the ground's lightness, so with none to
 *  read it hands the ground straight back. There is nothing to fall back to (a band picked without
 *  reading the ground can land invisible on it), and the author's own colour string is the thing to
 *  correct, so this throws — as `monoScale` does on an unknown hue. The test is on the RESULT
 *  rather than on parseability, so it also holds for any future band rule that could return its
 *  input. Checking here rather than in validation covers the grounds validation cannot see: a mark's
 *  fill can come from `bar_color`, `category_colors` or the title-selector accent, resolved per
 *  element at render time (see assemble-plot). */
export function resolveHatch(char: HatchChar, ground: string): SeriesHatch {
  const stroke = defaultHatchStroke(ground);
  if (stroke === ground) {
    throw new Error(
      `series_patterns: cannot derive a hatch band colour for "${char}" over the fill "${ground}" — ` +
        `the engine cannot read that as a colour (use a palette name or a "#hex"). ` +
        `The texture would render as a flat block of "${ground}".`,
    );
  }
  return { char, ground, stroke, id: hatchPatternId(char, ground, stroke) };
}

// THERE IS NO "resolve the legend's hatches from the colour map" FUNCTION, and adding one back is
// the bug. One lived here until 1.11.0: the marks resolved a hatch per element from the fill they
// were PAINTED, and the legend resolved its own from the series colour map. That was called safe
// because the fills which miss the map — `bar_color`, `category_colors` — are single-series, so
// those charts draw no legend rows, and the selector accent is folded into the map. It was not:
// `highlightSeries` dims every unhighlighted series through a per-mark fill on a MULTI-series chart,
// so a dimmed textured series was keyed over its palette colour while its bars were drawn grey. The
// legend, the tooltip and the export now take the SeriesHatch objects `assemblePlot` actually
// painted (`AssembleResult.seriesHatches`), so a key's ground is not a second derivation that has
// to match — it is the same object.

/** How far the hatch band sits from its ground, in TIERS of the ground's own hue ramp.
 *
 *  Three, not two, because of the band geometry: at a 7px band the ground and the hatch read as two
 *  colours side by side rather than lines over a colour, so the pair wants the separation of a
 *  legible tonal pair. Two tiers (~19 L*) at that width reads as a printing artifact.
 *
 *  Three tiers is the same perceptual distance in every hue family, because the tonal tiers are
 *  iso-lightness across hues (tier 200 is ~L*65 in all seven). That is the property the whole rule
 *  rests on, and it is gated in test/hatch.test.ts rather than trusted. */
const HATCH_TIER_STEP = 3;

/** The equivalent step for a colour on no ramp, in L*. Sized to match HATCH_TIER_STEP's measured
 *  ~29 L* so an off-palette colour behaves like a palette one instead of following its own logic. */
const HATCH_FALLBACK_DL = 28;

/** The band tier for a ground sitting at `index` on `tiers`: three steps DARKER, or three steps
 *  LIGHTER when darkening would overrun the ramp. Undefined when the ramp is too SHORT to hold
 *  either step — which is why this is a lookup returning a maybe, not arithmetic returning a tier.
 *
 *  This used to compute `index - HATCH_TIER_STEP` on the proof "needing the inverted branch means
 *  index > 4, so index − 3 ≥ 2". That proof holds only at `tiers.length === 8`. `locateOnRamp`
 *  builds tiers with a filter that DROPS any tier a hue family is missing, so a family shipping
 *  fewer than eight yields a short ramp on which the inverted index goes negative; `tiers[-1] as
 *  string` then laundered `undefined` past tsc and the caller wrote `fill:undefined` into a
 *  <pattern>. Indexing without the cast makes tsc carry that case instead, so the caller has to
 *  answer it. All seven families ship eight tiers today — this is what keeps a future five-tier
 *  family a graceful fallback rather than a rendering bug. Exported so the short-ramp path is
 *  testable without a fake token file; see test/hatch.test.ts. */
export function hatchBandTier(tiers: readonly string[], index: number): string | undefined {
  return tiers[index + HATCH_TIER_STEP] ?? tiers[index - HATCH_TIER_STEP];
}

/**
 * The hatch band colour for a given ground: a step of the SAME hue, derived rather than authored.
 *
 * An author supplies the colour and the character; the pair is the engine's to resolve, so a hatch
 * can never be given a band colour that breaks the Style-Guide ramp or vanishes against its ground.
 *
 * Darker by default; LIGHTER when the ground is too dark to darken, which keeps the contrast
 * constant instead of clamping to an invisible pair. A ramp with no room for either step falls
 * through to the perceptual rule below, which is sized to the same ΔL*, so the degradation is a
 * slightly off-ramp band rather than a missing fill.
 */
export function defaultHatchStroke(ground: string): string {
  const loc = locateOnRamp(ground);
  const onRamp = loc && hatchBandTier(loc.tiers, loc.index);
  if (onRamp) return onRamp;
  const l = lightness(ground);
  const canDarken = l != null && l - HATCH_FALLBACK_DL >= 0;
  return shiftLightness(ground, canDarken ? -HATCH_FALLBACK_DL : HATCH_FALLBACK_DL);
}
