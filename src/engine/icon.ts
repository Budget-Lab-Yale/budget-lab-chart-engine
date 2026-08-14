// The single source of truth for legend, tooltip and export icons.
//
// An icon is the small drawing that identifies a series — a legend key, a tooltip key, the chip in a
// downloaded PNG. Before this module each of those was built by its own renderer: six of them, each
// knowing a different subset of the shapes, with eleven different boxes between them. A tooltip's
// plain square was 11px beside a hatched one at 14px; a legend's line was 18x3 beside its own 14x14
// chip; the export invented its metrics a third time. Adding a channel meant threading it into six
// places, so it reliably reached three.
//
// Two rules make that class of bug structurally impossible rather than merely caught:
//
// ONE BOX — every shape occupies ICON_BOX square, in every context. The ink inside varies; the box
// does not. A column of keys therefore cannot wobble as its shapes change, and a series' key is the
// same size wherever it appears. The banded chip is the one documented exception: N colours need N
// bands, so it is the only icon allowed to be wider than the box.
//
// ONE GEOMETRY — `iconShapes` returns primitives and the emitters render that list and nothing else.
// They cannot disagree because there is only one description to disagree about. Everything is SVG,
// including the dashed line and the dot, which used to be CSS tricks (a hard-stop gradient and a
// border-radius) with separate SVG equivalents in the export.
import { symbolPathD } from "./symbols";
import { tokens } from "../theme/tokens";
import { TBL, swatchWidthFor, SWATCH_OUTLINE, SHAPE_LEGEND_COLOR, MARK_POINT_R, MARK_LINE_POINT_R } from "./theme";
import { hatchGlyphShapes, type HatchChar, type SeriesHatch } from "./hatch";
import { markerInk, HOLE, MARKER_KEYLINE_COLOR, type MarkerStyle } from "./marker-ink";

/** The box every icon occupies, px. Square, so a vertical and a horizontal shape weigh the same. */
export const ICON_BOX = 14;

/** Each symbol's measured REACH FROM ITS CENTRE per √area — the shape constant an area is solved from.
 *
 *  d3's `size` is an AREA, and equal area is not equal visual size: for one area a square's bbox is
 *  √area across and a star's is nearly twice that. Storing the measurement and solving for the reach
 *  wanted is the only form that cannot be quietly wrong. The previous table stored areas already
 *  solved for one target, hand-fitted, and missed on three of the seven — `triangle` reached 5.58 of a
 *  7 half-box, so a triangle key read visibly smaller than the square chip beside it.
 *
 *  Reach from the centre, NOT half the bounding box: d3 centres a symbol on its CENTROID, so a
 *  triangle's apex sits 17.5 from the origin while its box is only 26.3 tall. Sizing by half the box
 *  put the apex a full unit outside the icon box.
 *
 *  Measured with `getBBox()` at area 400; `test/icon-fits-box.test.ts` re-measures the result. */
const SYMBOL_REACH_K: Record<string, number> = {
  square: 0.5,
  circle: 0.56439,
  cross: 0.6708,
  wye: 0.73725,
  triangle: 0.8774,
  diamond: 0.9306,
  star: 0.94385,
};

/** The ANCHOR: the area the chart itself draws a marker at, which is the size a key has to be in the
 *  neighbourhood of — a key that is 9% smaller than the dot beside it is wrong in a way nobody can
 *  measure by eye but everybody can see.
 *
 *  Well defined because of two measurements. Plot sizes a symbol by area (πr²), and d3's `size` really
 *  is the painted area — counted in pixels, the ratio is 1.000 ± 1% across all seven — so a chart
 *  RADIUS converts straight into a d3 `size`. `SHAPE_CORRECTION` below then spreads the set around this
 *  anchor, and the box clamps whatever still will not fit. */
const CHART_MARKER_AREA = Math.PI * MARK_POINT_R ** 2;
const CHART_LINE_MARKER_AREA = Math.PI * MARK_LINE_POINT_R ** 2;

/** The least compact symbol — the one whose ink is spread furthest for a given area. */
const MAX_REACH_K = Math.max(...Object.values(SYMBOL_REACH_K));

/** SHAPE CORRECTION: how far to move from equal AREA toward equal REACH, because neither reads right.
 *
 *  0 draws every symbol at the same area — d3's own rule, and it makes the COMPACT shapes (circle,
 *  square) read small, because their ink sits in a smaller span. 1 gives every symbol the same span,
 *  which is matplotlib's rule, and it makes the SPREAD shapes (star, wye, cross) read light, because
 *  the same span holds a third of the ink. The truth is in between and it is shape-dependent.
 *
 *  There is no published answer to take. matplotlib has carried this as an open issue since 2019 and
 *  its own conclusion is that "an objective geometric criterion like area" cannot do it and the
 *  factors "need to be hand-tuned by a human". The psychophysics gives only the shape of the problem —
 *  perceived size is a compressive power function of area, exponent ≈ 0.7 — and cartography's two
 *  classic results are within-shape magnitude corrections (Flannery's 0.5716 exponent for circles;
 *  Crawford finding squares scaled by area are judged accurately), not a cross-shape table.
 *
 *  So this is a hand-judged constant, as the state of the art says it must be. What it is NOT is seven
 *  hand-tuned numbers: the correction is one exponent over the measured shape constants, so a
 *  judgement about the set stays a judgement about one value. Judged by eye against a rendered strip
 *  of 0, 0.25, 0.45, 0.7 and 1.0, beside the chart's own dots. */
const SHAPE_CORRECTION = 0.45;

/** The largest `size` that keeps `symbol`'s ink within `limit` of the centre. */
function sizeAtReach(symbol: string, limit: number): number {
  const k = SYMBOL_REACH_K[symbol] ?? SYMBOL_REACH_K.circle!;
  return (limit / k) ** 2;
}

/** The d3 `size` a marker key is drawn at.
 *
 *  Anchored to the size the CHART draws its marker at, corrected for shape, and clamped so the box
 *  never cuts it. The anchor is what stopped the key reading smaller than the scatter dot beside it;
 *  the correction is what stops the compact symbols reading small within the key's own set. */
export function symbolArea(symbol: string, onLine = false, hollow = false): number {
  const half = ICON_BOX / 2;
  // A ring's stroke straddles the path, so the path stops half a stroke short and the RING's outer
  // edge lands on the box. Without this the ring was cut at its four extremes and read flat-sided.
  const limit = hollow ? half - RING_WEIGHT / 2 : onLine ? half - MARKER_KEYLINE / 2 : half;
  const k = SYMBOL_REACH_K[symbol] ?? SYMBOL_REACH_K.circle!;
  const anchor = onLine ? CHART_LINE_MARKER_AREA : CHART_MARKER_AREA;
  const want = anchor * (MAX_REACH_K / k) ** (2 * SHAPE_CORRECTION);
  return Math.round(Math.min(want, sizeAtReach(symbol, limit)));
}

/** Line weight for the `line` shape — thick enough to read as a rule, not a hairline. */
const LINE_WEIGHT = 3;
/** Dash pattern — the CHART's own, so a dashed key matches the dashed line it names. It existed in
 *  three spellings before this: "4 2" in the legend, TBL.dashArray in the export, and a hard-stop CSS
 *  gradient in the tooltip. */
const LINE_DASH = TBL.dashArray;
/** Dot diameter — the FULL box, so a dot does not read smaller than the square beside it. A ring's
 *  radius shrinks by half its weight (below) so its outer edge lands on the box, not past it. */
const DOT_DIAMETER = ICON_BOX;
/** Ring weight for a hollow dot (dumbbell). */
const RING_WEIGHT = 2;
/** Keyline around a marker sitting ON a line, so the line does not run visually through it. A
 *  standalone symbol has no keyline: it sits on a card, where the keyline only ate its size — that is
 *  why a square marker read smaller than the square chip next to it. */
const MARKER_KEYLINE = 1;
/** Corner radius: a square key is barely rounded, a "chip" distinctly so. */
const RECT_RADIUS = 1;
const CHIP_RADIUS = 4;
/** Hairline around a near-white tint, so an annotation chip does not read as a gap. */
const OUTLINE = SWATCH_OUTLINE;
/** The stacked Total's key, from the same description its MARK is painted from (marker-ink.ts): a
 *  white disc under a black ring, not a hole. */
const NET_INK = markerInk("net", "");

/** What an icon depicts. `none` draws nothing — a cumulative stack's Total row is text with no key,
 *  and asking for `none` explicitly is safer than every caller remembering to skip the emitter. */
export type IconShapeName = "line" | "rect" | "dot" | "symbol" | "none";

export interface IconSpec {
  shape: IconShapeName;
  /** Resolved colour (hex). Absent only for `none` and for a banded chip, which carries `colors`. */
  color?: string;
  /** `line`: dash it. */
  dashed?: boolean;
  /** `line`: also draw this marker centred on the line (a line chart with point markers). */
  symbol?: string;
  /** `rect`: round the corners further — the "chip" a point chart's colour legend uses. */
  rounded?: boolean;
  /** `rect`: draw a hairline, for a tint pale enough to vanish against the card. */
  outlined?: boolean;
  /** `rect`: a `series_patterns` texture. Drawn as the hatch glyph's own bands, so a key can never
   *  lean differently from the mark it names. */
  hatch?: SeriesHatch;
  /** `rect`: several tints under one label (an annotation fill covering several series). The only
   *  case that widens the box. */
  colors?: string[];
  /** `dot` / `symbol`: how the middle relates to the colour — filled with it, outlined by it around a
   *  HOLE, the neutral ink token, or the net marker's white disc. See marker-ink.ts, which is where
   *  the paint for each lives, shared with the marks so a key cannot drift from what it names.
   *  Absent ⇒ `filled`. */
  marker?: MarkerStyle;
}

/** A drawing primitive, in a box `ICON_BOX` square. */
export type IconPrimitive =
  | { kind: "rect"; x: number; y: number; width: number; height: number; rx?: number; fill: string; stroke?: string; strokeWidth?: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; stroke: string; strokeWidth: number; dasharray?: string }
  | { kind: "circle"; cx: number; cy: number; r: number; fill: string; stroke?: string; strokeWidth?: number }
  | { kind: "path"; d: string; transform: string; fill: string; stroke?: string; strokeWidth?: number };

/** The width an icon occupies. `ICON_BOX`, except a banded chip, which needs one band per colour. */
export function iconWidth(icon: IconSpec): number {
  const bands = icon.colors?.length ?? 0;
  return bands > 1 ? swatchWidthFor(bands) : ICON_BOX;
}

/** The primitives making up an icon. The ONLY description of an icon's geometry — both emitters
 *  render this and nothing else. */
export function iconShapes(icon: IconSpec): IconPrimitive[] {
  const mid = ICON_BOX / 2;
  const color = icon.color ?? "currentColor";

  // A texture only exists on a FILLED mark, so it settles the shape: a hatched icon is the chip with
  // the glyph in it, whatever the caller asked for. A caller that asks for `line` and passes a hatch
  // is describing an AREA series, and drawing its request literally is exactly the divergence this
  // module exists to prevent — a chip with a glyph in the legend, a plain line in the tooltip.
  switch (icon.hatch && icon.shape !== "none" ? "rect" : icon.shape) {
    case "none":
      return [];

    case "line": {
      const out: IconPrimitive[] = [
        {
          kind: "line",
          x1: 0,
          y1: mid,
          x2: ICON_BOX,
          y2: mid,
          stroke: color,
          strokeWidth: LINE_WEIGHT,
          ...(icon.dashed ? { dasharray: LINE_DASH } : {}),
        },
      ];
      if (icon.symbol) out.push(symbolPrimitive(icon.symbol, color, true));
      return out;
    }

    case "dot": {
      const ringed = icon.marker === "hollow" || icon.marker === "net";
      const ink = markerInk(icon.marker ?? "filled", color);
      return [
        {
          kind: "circle",
          cx: mid,
          cy: mid,
          // A ring's stroke straddles its radius, so the radius shrinks by half the weight to keep the
          // OUTER diameter equal to the filled dot's — same size on the page, and nothing clipped.
          r: DOT_DIAMETER / 2 - (ringed ? RING_WEIGHT / 2 : 0),
          fill: ink.fill,
          ...(ringed ? { stroke: ink.stroke, strokeWidth: RING_WEIGHT } : {}),
        },
      ];
    }

    case "symbol":
      return [symbolPrimitive(icon.symbol ?? "circle", color, false, icon.marker ?? "filled")];

    case "rect": {
      const tints = icon.colors && icon.colors.length > 1 ? icon.colors : null;
      if (tints) {
        // Equal vertical bands, left to right in the given order.
        const width = iconWidth(icon) / tints.length;
        return tints.map((c, i) => ({
          kind: "rect" as const,
          x: i * width,
          y: 0,
          width,
          height: ICON_BOX,
          fill: c,
        }));
      }
      const rx = icon.rounded ? CHIP_RADIUS : RECT_RADIUS;
      // A stroke straddles its edge, so an outlined chip must be inset by half of it — otherwise the
      // SVG viewport cuts the outer half and the chip reads as clipped along the bottom and right.
      const inset = icon.outlined ? 0.5 : 0;
      const ground: IconPrimitive = {
        kind: "rect",
        x: inset,
        y: inset,
        width: ICON_BOX - inset * 2,
        height: ICON_BOX - inset * 2,
        rx,
        fill: color,
        ...(icon.outlined ? { stroke: OUTLINE, strokeWidth: 1 } : {}),
      };
      if (!icon.hatch) return [ground];
      // The hatch glyph's own bands, over this ground — hatch.ts owns that geometry, so the key and
      // the mark are one drawing.
      const { char, stroke } = icon.hatch;
      const bands = hatchGlyphShapes(char).map((s): IconPrimitive =>
        s.kind === "rect"
          ? { kind: "rect", x: s.x, y: s.y, width: s.width, height: s.height, fill: stroke }
          : { kind: "line", x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, stroke, strokeWidth: s.width },
      );
      return [{ ...ground, fill: icon.hatch.ground }, ...bands];
    }
  }
}

function symbolPrimitive(symbol: string, color: string, onLine = false, marker: MarkerStyle = "filled"): IconPrimitive {
  const mid = ICON_BOX / 2;
  const ringed = marker === "hollow" || marker === "net";
  const ink = markerInk(marker, color);
  return {
    kind: "path",
    d: symbolPathD(symbol, symbolArea(symbol, onLine, ringed)),
    transform: `translate(${mid},${mid})`,
    fill: ink.fill,
    // A ring takes the colour; otherwise a keyline only where a line runs behind the marker.
    ...(ringed
      ? { stroke: ink.stroke, strokeWidth: RING_WEIGHT }
      : onLine
        ? { stroke: MARKER_KEYLINE_COLOR, strokeWidth: MARKER_KEYLINE }
        : {}),
  };
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Attribute list for one primitive, shared by both emitters so they cannot format differently. */
function attrsOf(s: IconPrimitive): Array<[string, string]> {
  const style = (fill?: string, stroke?: string) =>
    [fill ? `fill:${fill}` : "fill:none", stroke ? `stroke:${stroke}` : ""].filter(Boolean).join(";");
  switch (s.kind) {
    case "rect":
      return [
        ["x", String(s.x)],
        ["y", String(s.y)],
        ["width", String(s.width)],
        ["height", String(s.height)],
        ...(s.rx != null ? ([["rx", String(s.rx)]] as Array<[string, string]>) : []),
        ...(s.strokeWidth != null ? ([["stroke-width", String(s.strokeWidth)]] as Array<[string, string]>) : []),
        ["style", style(s.fill, s.stroke)],
      ];
    case "line":
      return [
        ["x1", String(s.x1)],
        ["y1", String(s.y1)],
        ["x2", String(s.x2)],
        ["y2", String(s.y2)],
        ["stroke-width", String(s.strokeWidth)],
        ...(s.dasharray ? ([["stroke-dasharray", s.dasharray]] as Array<[string, string]>) : []),
        ["style", style(undefined, s.stroke)],
      ];
    case "circle":
      return [
        ["cx", String(s.cx)],
        ["cy", String(s.cy)],
        ["r", String(s.r)],
        ...(s.strokeWidth != null ? ([["stroke-width", String(s.strokeWidth)]] as Array<[string, string]>) : []),
        ["style", style(s.fill, s.stroke)],
      ];
    case "path":
      return [
        ["d", s.d],
        ["transform", s.transform],
        ...(s.strokeWidth != null ? ([["stroke-width", String(s.strokeWidth)]] as Array<[string, string]>) : []),
        ["style", style(s.fill, s.stroke)],
      ];
  }
}

/** An icon as SVG markup, for the tooltips (which build HTML strings). Empty for `none`. */
export function iconSvgMarkup(icon: IconSpec): string {
  const shapes = iconShapes(icon);
  if (!shapes.length) return "";
  const w = iconWidth(icon);
  const body = shapes
    .map((s) => `<${s.kind} ${attrsOf(s).map(([k, v]) => `${k}="${v}"`).join(" ")}/>`)
    .join("");
  return (
    `<svg width="${w}" height="${ICON_BOX}" viewBox="0 0 ${w} ${ICON_BOX}" aria-hidden="true">` +
    `${body}</svg>`
  );
}

/** An icon as a DOM `<svg>`, for the live legend. Null for `none`, so a caller appends nothing. */
export function iconSvgElement(doc: Document, icon: IconSpec): SVGElement | null {
  const shapes = iconShapes(icon);
  if (!shapes.length) return null;
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(iconWidth(icon)));
  svg.setAttribute("height", String(ICON_BOX));
  svg.setAttribute("viewBox", `0 0 ${iconWidth(icon)} ${ICON_BOX}`);
  svg.setAttribute("aria-hidden", "true");
  for (const s of shapes) {
    const el = doc.createElementNS(SVG_NS, s.kind);
    for (const [k, v] of attrsOf(s)) el.setAttribute(k, v);
    svg.appendChild(el);
  }
  return svg;
}

/** The class marking a legend key inside a flat exported SVG, where there is no legend element to
 *  scope a query to — the key's shapes are siblings of the chart's own. */
export const ICON_GROUP_CLASS = "tbl-icon";

/** An icon as an SVG `<g>` at the origin, for the PNG export to position. Null for `none`. */
export function iconSvgGroup(doc: Document, icon: IconSpec): SVGElement | null {
  const svg = iconSvgElement(doc, icon);
  if (!svg) return null;
  const g = doc.createElementNS(SVG_NS, "g");
  g.setAttribute("class", ICON_GROUP_CLASS);
  while (svg.firstChild) g.appendChild(svg.firstChild);
  return g;
}

/** The icon a resolved legend row depicts.
 *
 *  `LegendItem` is already the resolved description of a series' key — this is the translation from
 *  its vocabulary to the drawing's, and it is the reason a tooltip can key from the same source the
 *  legend does instead of re-deriving from raw colour maps. Typed structurally rather than importing
 *  LegendItem, which would be a cycle (engine/index imports this module).
 *
 *  A chart type with no legend at all (single-series histogram, waterfall) has no row to translate,
 *  so its tooltip builds an IconSpec directly — the shape is known from the chart type. */
export function iconFromLegendItem(item: {
  color?: string | undefined;
  dashed?: boolean;
  markerShape?: "line" | "rect" | "dot" | "point" | "chip";
  markerSymbol?: string;
  hollow?: boolean;
  colors?: string[];
  outlined?: boolean;
  hatch?: SeriesHatch;
}): IconSpec {
  // A point/chip key with no colour is a SHAPE-legend row, which is neutral by design: shape carries
  // the value there, not colour. Here rather than in the renderers, which each had to remember it —
  // and a colourless row is otherwise the stacked Total, which means something else entirely.
  const color =
    item.color ??
    (item.markerShape === "point" || item.markerShape === "chip" ? SHAPE_LEGEND_COLOR : undefined);
  switch (item.markerShape) {
    case "rect":
      return {
        shape: "rect",
        ...(color ? { color } : {}),
        ...(item.hatch ? { hatch: item.hatch } : {}),
        ...(item.colors ? { colors: item.colors } : {}),
        ...(item.outlined ? { outlined: true } : {}),
      };
    case "chip":
      return { shape: "rect", rounded: true, ...(color ? { color } : {}) };
    case "dot":
      // A dot with NO colour is the stacked Total, whose marker is the `net` style: a white disc under
      // a black ring, NOT a hole — it occludes the stack it sits on. A coloured dot is a dumbbell end.
      return color
        ? { shape: "dot", color, ...(item.hollow ? { marker: "hollow" as const } : {}) }
        : { shape: "dot", color: NET_INK.stroke, marker: "net" as const };
    case "point":
      return {
        shape: "symbol",
        ...(color ? { color } : {}),
        symbol: item.markerSymbol ?? "circle",
        ...(item.hollow ? { marker: "hollow" as const } : {}),
      };
    default:
      return {
        shape: "line",
        ...(color ? { color } : {}),
        ...(item.dashed ? { dashed: true } : {}),
        ...(item.markerSymbol ? { symbol: item.markerSymbol } : {}),
      };
  }
}

/** Series → the icon its key should draw, for a TOOLTIP.
 *
 *  This is the fix for a whole class of bug. Tooltips used to be handed six loose channels — colours,
 *  dashed set, swatch shape, dumbbell markers, rendered fills, textures — and each path re-derived an
 *  icon from whichever subset it knew about. So a line chart's markers reached its legend but not its
 *  tooltip, and a `bar_color` histogram keyed from the PALETTE while its bins were painted from
 *  `bar_color`: a blue key over violet bins. Resolving once, here, is what makes them agree.
 *
 *  `legendItems` is the preferred source because a legend row is already resolved — it carries the
 *  symbol, the ring, the texture AND the colour actually painted. `painted` overrides the colour per
 *  series for the cases the legend cannot know (a `category_colors` bar keys the hovered category, not
 *  the series). `fallback` covers charts with tooltips but NO legend — a single-series histogram or
 *  waterfall — where there is no row to read. */
export function resolveTooltipIcons(opts: {
  legendItems?: ReadonlyArray<{
    series: string;
    color?: string | undefined;
    dashed?: boolean;
    markerShape?: "line" | "rect" | "dot" | "point" | "chip";
    markerSymbol?: string;
    hollow?: boolean;
    colors?: string[];
    outlined?: boolean;
    hatch?: SeriesHatch;
    annotation?: boolean;
  }> | null;
  /** Series → the colour actually painted, when it differs from the legend's. */
  painted?: Map<string, string>;
  /** Used for series with no legend row at all. */
  fallback?: (series: string) => IconSpec | undefined;
  /** Series the tooltip will show, so a fallback can cover them all. */
  series?: readonly string[];
}): Map<string, IconSpec> {
  const out = new Map<string, IconSpec>();
  for (const item of opts.legendItems ?? []) {
    // Annotation rows key bands and rules, never a hovered series.
    if (item.annotation) continue;
    out.set(item.series, iconFromLegendItem(item));
  }
  for (const s of opts.series ?? []) {
    if (!out.has(s)) {
      const icon = opts.fallback?.(s);
      if (icon) out.set(s, icon);
    }
  }
  if (opts.painted) {
    for (const [s, color] of opts.painted) {
      const icon = out.get(s);
      if (icon) out.set(s, { ...icon, color });
      else if (opts.fallback?.(s)) out.set(s, { ...opts.fallback(s)!, color });
    }
  }
  return out;
}

/** Re-colour resolved icons from the fill actually painted, rebuilding a texture's ground with it.
 *
 *  `bar_color`, `category_colors` and the title-selector accent override a mark's fill without ever
 *  reaching the engine's colour map, so a tooltip keyed from a legend row can show a different colour
 *  from the bar under the cursor. Overriding only `color` is not enough: a hatched icon draws its
 *  ground from `hatch.ground`, so the texture has to be re-resolved against the new colour or the key
 *  keeps the old ground. */
export function recolourIcons(
  icons: Map<string, IconSpec>,
  painted: Map<string, string> | undefined,
  reHatch: (char: HatchChar, ground: string) => SeriesHatch,
): Map<string, IconSpec> {
  if (!painted?.size) return icons;
  const out = new Map(icons);
  for (const [series, color] of painted) {
    const icon = out.get(series);
    if (!icon || !color) continue;
    out.set(series, {
      ...icon,
      color,
      ...(icon.hatch ? { hatch: reHatch(icon.hatch.char, color) } : {}),
    });
  }
  return out;
}
