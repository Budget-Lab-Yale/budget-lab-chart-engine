// Series hatch textures — matplotlib's six characters (/ \ | - + x) as a fill channel alongside
// colour. The character is a picture of the result, so there is no left-vs-right ambiguity to
// resolve in prose. The declared series colour stays the pattern's GROUND, so a spec that omits
// `series_patterns` renders exactly as before.
//
// This module is the single source of truth for the geometry, because the same texture has to be
// emitted twice in two different coordinate conventions: as an SVG <pattern> for the chart marks
// and the PNG export, and as CSS gradients for the HTML legend/tooltip swatches. Both read the
// table below.
//
// INVARIANT 1 — the tile CLIPS, and it must tile. A <pattern> establishes its own viewport, so
// anything crossing the cell edge is cut, not wrapped: a stroked line centred on x=0 loses its outer
// half and renders at HALF its nominal width (measured 17.5% coverage for stroke-width 7, where an
// explicit 7px rect gives 43.3%). Hence bands are RECTS, sized exactly. The same clipping is why
// rotation goes on `patternTransform` — rotating a shape inside a fixed cell swings it out of the
// cell — which forces the decomposition below: one-or-two PERPENDICULAR bands in the cell, plus one
// tile rotation. `x` is `+` rotated 45°, NOT two separately rotated diagonals.
//
// INVARIANT 2 — the CSS angle is the SVG rotation MINUS 90°, not its negation. With band
// direction `d` measured clockwise from vertical: the SVG primitive is a vertical line, so
// rotate(θ) gives d = θ; a CSS gradient angle φ names the GRADIENT line and lays its bands
// PERPENDICULAR to that line, so d = φ + 90. Hence φ = θ − 90. Negating instead happens to work
// for the two diagonals (−θ and θ−90 agree modulo 180°, and a symmetric repeating gradient is
// unchanged by a 180° flip) but is off by 90° for `|` and `-`, which silently swaps vertical and
// horizontal between the chart and its legend.
import { locateOnRamp, lightness, shiftLightness } from "./palette";
import type { ChartSpec, HatchChar } from "../spec/types";

export type { HatchChar };

// Tile size, in user units (≈ px at chart scale).
//
// The geometry is deliberately COARSE — broad bands of colour reading as an alternating two-tone,
// not pinstripes. At 16/7 the ground and the band read as two colours banded together, which is what
// makes the distinction survive a projector and grayscale. Rasterised and pixel-counted at 42–47%
// band for all six characters (the spread is antialiasing on the diagonals).
export const HATCH_PERIOD = 16;

/** `rotate` is the tile rotation; `crossed` adds a second line perpendicular to the first.
 *  See INVARIANT 1 — this pair is the only decomposition that tiles. */
const GEOM: Record<HatchChar, { rotate: number; crossed: boolean; slug: string }> = {
  "|": { rotate: 0, crossed: false, slug: "vert" },
  "-": { rotate: 90, crossed: false, slug: "horz" },
  "/": { rotate: 45, crossed: false, slug: "fwd" },
  "\\": { rotate: -45, crossed: false, slug: "bwd" },
  "+": { rotate: 0, crossed: true, slug: "plus" },
  x: { rotate: 45, crossed: true, slug: "cross" },
};

/** Band WIDTH for a single-direction character (`/ \ | -`), in tile units. Rendered as an explicit
 *  rect, so this is the width that actually appears — see hatchSvgPattern. */
export const HATCH_STROKE = 7;

/** Band width for a CROSSED character (`+ x`). Deliberately narrower: crossing two directions
 *  overlaps their ink, so total coverage is 1 − (gap/period)², not twice one direction's. At the
 *  single-direction width, `+` and `x` would come out 1.55× heavier than `/` — visibly denser for no
 *  reason, since weight carries no meaning here. 4 of 16 solves 1 − (12/16)² = 43.75%, matching the
 *  single-direction 7/16, so the six read as one family that differs only in DIRECTION. */
export const HATCH_STROKE_CROSSED = 4;

/** The band width this character is drawn at. */
export function hatchStrokeWidth(char: HatchChar): number {
  return GEOM[char].crossed ? HATCH_STROKE_CROSSED : HATCH_STROKE;
}

/** Declaration order is the documented order in CONFIG-SPEC. */
export const HATCH_CHARS: readonly HatchChar[] = ["/", "\\", "|", "-", "+", "x"];

export function isHatchChar(v: unknown): v is HatchChar {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(GEOM, v);
}

/** The hatch line direction(s), in degrees clockwise from vertical. A crossed character returns
 *  the pair. Directions are equal as LINES modulo 180°. */
export function hatchAngles(char: HatchChar): number[] {
  const { rotate, crossed } = GEOM[char];
  return crossed ? [rotate, rotate + 90] : [rotate];
}

/** The CSS gradient angles for the same texture. See INVARIANT 2. */
export function hatchCssAngles(char: HatchChar): number[] {
  return hatchAngles(char).map((a) => a - 90);
}

/** Content-addressed, so it is deterministic across renders (the golden-SVG gate depends on
 *  stable ids) AND collision-free between two figures on one page: two figures asking for the
 *  same texture over the same colours share an id whose definitions are identical, which is not a
 *  collision. Different textures or colours always get different ids. */
export function hatchPatternId(char: HatchChar, ground: string, stroke: string): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9]/g, "");
  return `tblhatch-${GEOM[char].slug}-${safe(ground)}-${safe(stroke)}`;
}

const SVG_NS = "http://www.w3.org/2000/svg";

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
  const pattern = doc.createElementNS(SVG_NS, "pattern");
  pattern.setAttribute("id", hatchPatternId(char, ground, stroke));
  pattern.setAttribute("width", String(HATCH_PERIOD));
  pattern.setAttribute("height", String(HATCH_PERIOD));
  pattern.setAttribute("patternUnits", "userSpaceOnUse");
  if (rotate !== 0) pattern.setAttribute("patternTransform", `rotate(${rotate})`);

  const bg = doc.createElementNS(SVG_NS, "rect");
  bg.setAttribute("width", String(HATCH_PERIOD));
  bg.setAttribute("height", String(HATCH_PERIOD));
  bg.setAttribute("style", `fill:${ground}`);
  pattern.appendChild(bg);

  // A BAND RECT, not a stroked line. A <pattern> tile clips to its own bounds, so a line centred on
  // the tile edge loses the half that falls outside — it does not wrap into the neighbouring tile.
  // Measured: a `stroke-width: 7` line on x=0 renders 17.5% coverage, where an explicit 7px rect
  // renders 43.3%. The rect also matches `hatchCss`, whose hard gradient stops were always a true
  // band, so the legend swatch and the mark now carry the same weight.
  const w = hatchStrokeWidth(char);
  const band = (width: number, height: number) => {
    const el = doc.createElementNS(SVG_NS, "rect");
    el.setAttribute("width", String(width));
    el.setAttribute("height", String(height));
    el.setAttribute("style", `fill:${stroke}`);
    return el;
  };
  pattern.appendChild(band(w, HATCH_PERIOD));
  if (crossed) pattern.appendChild(band(HATCH_PERIOD, w));
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
 *  both follow from the ground, so this is the only place a hatch is constructed. */
export function resolveHatch(char: HatchChar, ground: string): SeriesHatch {
  const stroke = defaultHatchStroke(ground);
  return { char, ground, stroke, id: hatchPatternId(char, ground, stroke) };
}

/** Resolve `series_patterns` for the LEGEND, whose ground is the colour the legend itself shows.
 *  The marks resolve per element instead (see assemble-plot), because `bar_color`/`category_colors`/
 *  the selector accent override the fill per mark and the legend shows only the base colour.
 *  Returns an empty map when the spec declares no textures, which is what keeps an untextured
 *  figure byte-identical. */
export function resolveSeriesHatches(
  spec: Pick<ChartSpec, "series_patterns">,
  seriesColors: Map<string, string>,
): Map<string, SeriesHatch> {
  const out = new Map<string, SeriesHatch>();
  const cfg = spec.series_patterns;
  if (!cfg) return out;
  for (const [series, char] of Object.entries(cfg)) {
    if (!isHatchChar(char)) continue; // validation rejects these; belt-and-braces at render time
    const ground = seriesColors.get(series);
    if (ground) out.set(series, resolveHatch(char, ground));
  }
  return out;
}

/** Series → texture CSS, built from already-resolved legend rows. The legend is the source of
 *  truth on purpose: it holds the colour each series is actually PAINTED (a mono stacked bar's
 *  tonal tier, not its palette entry), so a tooltip swatch built from this can never disagree with
 *  the key beside it. Returns an empty map when nothing is textured. */
export function hatchCssBySeries(
  items: ReadonlyArray<{ series: string; hatch?: SeriesHatch }> | null | undefined,
): Map<string, { backgroundColor: string; backgroundImage: string }> {
  const out = new Map<string, { backgroundColor: string; backgroundImage: string }>();
  for (const item of items ?? []) {
    if (item.hatch) out.set(item.series, hatchCss(item.hatch.char, item.hatch.ground, item.hatch.stroke));
  }
  return out;
}

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

/**
 * The hatch band colour for a given ground: a step of the SAME hue, derived rather than authored.
 *
 * An author supplies the colour and the character; the pair is the engine's to resolve, so a hatch
 * can never be given a band colour that breaks the Style-Guide ramp or vanishes against its ground.
 *
 * Darker by default; LIGHTER when the ground is too dark to darken, which keeps the contrast
 * constant instead of clamping to an invisible pair. (The inverted branch cannot underflow: needing
 * it means index > 4, so index − 3 ≥ 2.)
 */
export function defaultHatchStroke(ground: string): string {
  const loc = locateOnRamp(ground);
  if (loc) {
    const darker = loc.index + HATCH_TIER_STEP;
    const index = darker < loc.tiers.length ? darker : loc.index - HATCH_TIER_STEP;
    return loc.tiers[index] as string;
  }
  const l = lightness(ground);
  const canDarken = l != null && l - HATCH_FALLBACK_DL >= 0;
  return shiftLightness(ground, canDarken ? -HATCH_FALLBACK_DL : HATCH_FALLBACK_DL);
}

/** The same texture as CSS, for the HTML legend and tooltip swatches. Gradient gaps are
 *  `transparent` and the ground comes from `background-color` alone, so a crossed character's two
 *  layers show through each other instead of the upper one painting the lower one out. */
export function hatchCss(
  char: HatchChar,
  ground: string,
  stroke: string,
): { backgroundColor: string; backgroundImage: string } {
  const w = hatchStrokeWidth(char);
  const backgroundImage = hatchCssAngles(char)
    .map(
      (a) =>
        `repeating-linear-gradient(${a}deg, ${stroke} 0 ${w}px, ` +
        `transparent ${w}px ${HATCH_PERIOD}px)`,
    )
    .join(", ");
  return { backgroundColor: ground, backgroundImage };
}

