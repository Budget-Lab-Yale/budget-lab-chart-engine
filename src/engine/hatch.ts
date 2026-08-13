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

/** `rotate` is the tile rotation; `crossed` adds a second band perpendicular to the first.
 *  See INVARIANT 1 — this pair is the only decomposition that tiles. */
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

/** Render a glyph as SVG markup: a ground rect plus its bands. One emitter shared by the DOM
 *  builders and the tooltip's HTML string, so the three surfaces cannot drift. */
export function hatchGlyphMarkup(char: HatchChar, ground: string, stroke: string): string {
  const box = HATCH_GLYPH_BOX;
  const bands = hatchGlyphShapes(char)
    .map((s) =>
      s.kind === "rect"
        ? `<rect x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}" style="fill:${stroke}"/>`
        : `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke-width="${s.width}" style="stroke:${stroke}"/>`,
    )
    .join("");
  return (
    `<svg width="${box}" height="${box}" viewBox="0 0 ${box} ${box}" aria-hidden="true">` +
    `<rect width="${box}" height="${box}" style="fill:${ground}"/>${bands}</svg>`
  );
}

/** The same glyph as DOM, for the live legend and the PNG export. Returns a <g> at the origin so a
 *  caller can position it; the box is HATCH_GLYPH_BOX square. */
export function hatchGlyphGroup(
  doc: Document,
  char: HatchChar,
  ground: string,
  stroke: string,
): SVGElement {
  const box = HATCH_GLYPH_BOX;
  const g = doc.createElementNS(SVG_NS, "g");
  const bg = doc.createElementNS(SVG_NS, "rect");
  bg.setAttribute("width", String(box));
  bg.setAttribute("height", String(box));
  bg.setAttribute("style", `fill:${ground}`);
  g.appendChild(bg);
  for (const s of hatchGlyphShapes(char)) {
    if (s.kind === "rect") {
      const el = doc.createElementNS(SVG_NS, "rect");
      el.setAttribute("x", String(s.x));
      el.setAttribute("y", String(s.y));
      el.setAttribute("width", String(s.width));
      el.setAttribute("height", String(s.height));
      el.setAttribute("style", `fill:${stroke}`);
      g.appendChild(el);
    } else {
      const el = doc.createElementNS(SVG_NS, "line");
      el.setAttribute("x1", String(s.x1));
      el.setAttribute("y1", String(s.y1));
      el.setAttribute("x2", String(s.x2));
      el.setAttribute("y2", String(s.y2));
      el.setAttribute("stroke-width", String(s.width));
      el.setAttribute("style", `stroke:${stroke}`);
      g.appendChild(el);
    }
  }
  return g;
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
 *  both follow from the ground, so this is the only place a hatch is constructed. */
export function resolveHatch(char: HatchChar, ground: string): SeriesHatch {
  const stroke = defaultHatchStroke(ground);
  return { char, ground, stroke, id: hatchPatternId(char, ground, stroke) };
}

/** Series → resolved texture, read off already-resolved legend rows. The legend is the source of
 *  truth on purpose: it holds the colour each series is actually PAINTED, so a tooltip key built from
 *  this can never disagree with the legend key beside it. Empty when nothing is textured. */
export function hatchesBySeries(
  items: ReadonlyArray<{ series: string; hatch?: SeriesHatch }> | null | undefined,
): Map<string, SeriesHatch> {
  const out = new Map<string, SeriesHatch>();
  for (const item of items ?? []) if (item.hatch) out.set(item.series, item.hatch);
  return out;
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



/** The textures a TOOLTIP should key from.
 *
 *  Prefers the legend's resolved rows, because those carry the colour each series is actually PAINTED
 *  (a mono stack's tonal tier, not its palette entry). Falls back to resolving from the spec when
 *  there is no legend at all — a single-series histogram or waterfall has tooltips but no legend, so
 *  keying off legend rows silently produced no texture there. This is why the RESOLVER has to be
 *  shared and not just the renderer. */
export function tooltipHatches(
  items: ReadonlyArray<{ series: string; hatch?: SeriesHatch }> | null | undefined,
  spec: Pick<ChartSpec, "series_patterns">,
  seriesColors: Map<string, string>,
): Map<string, SeriesHatch> {
  const fromLegend = hatchesBySeries(items);
  return fromLegend.size ? fromLegend : resolveSeriesHatches(spec, seriesColors);
}
