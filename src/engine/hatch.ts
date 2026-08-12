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
// INVARIANT 1 — the tile must tile. A 7×7 cell holding a vertical line repeats seamlessly;
// rotating that LINE inside the fixed cell does not, because the line swings out of the cell.
// So rotation goes on `patternTransform`, which rotates the whole infinite tiling. That is what
// forces the decomposition below: one-or-two PERPENDICULAR lines drawn in the cell, plus one tile
// rotation. `x` is `+` rotated 45°, NOT two separately rotated diagonals.
//
// INVARIANT 2 — the CSS angle is the SVG rotation MINUS 90°, not its negation. With band
// direction `d` measured clockwise from vertical: the SVG primitive is a vertical line, so
// rotate(θ) gives d = θ; a CSS gradient angle φ names the GRADIENT line and lays its bands
// PERPENDICULAR to that line, so d = φ + 90. Hence φ = θ − 90. Negating instead happens to work
// for the two diagonals (−θ and θ−90 agree modulo 180°, and a symmetric repeating gradient is
// unchanged by a 180° flip) but is off by 90° for `|` and `-`, which silently swaps vertical and
// horizontal between the chart and its legend.
import { d3 } from "./vendor";
import { TONAL_BY_HEX, resolveColor } from "./palette";
import type { ChartSpec, HatchChar } from "../spec/types";

export type { HatchChar };

/** Tile size and line weight, in user units (≈ px at chart scale). 3px of ink per 7px period
 *  reads cleanly at the bar widths the engine produces, on screen and at the export's 2× scale. */
export const HATCH_PERIOD = 7;
export const HATCH_STROKE_WIDTH = 3;

/** Declaration order is the documented order in CONFIG-SPEC. */
export const HATCH_CHARS: readonly HatchChar[] = ["/", "\\", "|", "-", "+", "x"];

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

  const line = (x2: number, y2: number) => {
    const el = doc.createElementNS(SVG_NS, "line");
    el.setAttribute("x1", "0");
    el.setAttribute("y1", "0");
    el.setAttribute("x2", String(x2));
    el.setAttribute("y2", String(y2));
    el.setAttribute("stroke-width", String(HATCH_STROKE_WIDTH));
    el.setAttribute("style", `stroke:${stroke}`);
    return el;
  };
  pattern.appendChild(line(0, HATCH_PERIOD));
  if (crossed) pattern.appendChild(line(HATCH_PERIOD, 0));
  return pattern;
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

/** How many tonal tiers darker the default hatch stroke sits than its ground. Two steps is
 *  visible at a 3px line weight without reading as black. */
const STROKE_TIER_STEP = 2;

/** The default hatch stroke for a ground: a darker step of the SAME hue. When the ground is one of
 *  the Style-Guide tonal tiers this walks that ramp, so the pair stays in palette; a categorical
 *  hue or a raw `#hex` has no ramp to walk, so it darkens in colour space instead. */
export function defaultHatchStroke(ground: string): string {
  const tonal = TONAL_BY_HEX.get(ground.toUpperCase());
  if (tonal) {
    const stepped = tonal.tiers[Math.min(tonal.index + STROKE_TIER_STEP, tonal.tiers.length - 1)];
    // Falls through when the ground already IS the darkest tier: stepping would return the ground
    // itself, and a stroke matching its ground is an invisible hatch.
    if (stepped && stepped.toUpperCase() !== ground.toUpperCase()) return stepped;
  }
  const darker = d3.color(ground)?.darker(1.2);
  return darker ? String(darker.formatHex()) : ground;
}

/** A series' resolved texture: the character plus the two colours it is drawn from. */
export interface SeriesHatch {
  char: HatchChar;
  ground: string;
  stroke: string;
  id: string;
}

/** Resolve `series_patterns` against the colours actually being painted, for every series that
 *  declares a texture. `seriesColors` must be the map the marks and legend agree on — for a mono
 *  stacked bar that is the tonal tier, not the categorical palette entry, or the pattern's ground
 *  would not match its segment. Returns an empty map when the spec declares no textures, which is
 *  what keeps an untextured figure byte-identical. */
export function resolveSeriesHatches(
  spec: Pick<ChartSpec, "series_patterns" | "series_pattern_colors">,
  seriesColors: Map<string, string>,
): Map<string, SeriesHatch> {
  const out = new Map<string, SeriesHatch>();
  const cfg = spec.series_patterns;
  if (!cfg) return out;
  for (const [series, char] of Object.entries(cfg)) {
    if (!isHatchChar(char)) continue; // validation rejects these; belt-and-braces at render time
    const ground = seriesColors.get(series);
    if (!ground) continue;
    const override = resolveColor(spec.series_pattern_colors?.[series]);
    const stroke = override || defaultHatchStroke(ground);
    out.set(series, { char, ground, stroke, id: hatchPatternId(char, ground, stroke) });
  }
  return out;
}

/** The same texture as CSS, for the HTML legend and tooltip swatches. Gradient gaps are
 *  `transparent` and the ground comes from `background-color` alone, so a crossed character's two
 *  layers show through each other instead of the upper one painting the lower one out. */
export function hatchCss(
  char: HatchChar,
  ground: string,
  stroke: string,
): { backgroundColor: string; backgroundImage: string } {
  const backgroundImage = hatchCssAngles(char)
    .map(
      (a) =>
        `repeating-linear-gradient(${a}deg, ${stroke} 0 ${HATCH_STROKE_WIDTH}px, ` +
        `transparent ${HATCH_STROKE_WIDTH}px ${HATCH_PERIOD}px)`,
    )
    .join(", ");
  return { backgroundColor: ground, backgroundImage };
}

