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
import { TBL, swatchWidthFor, SWATCH_OUTLINE, SHAPE_LEGEND_COLOR, MARK_POINT_R, MARK_LINE_POINT_R } from "./theme";
import { hatchGlyphShapes, type HatchChar, type SeriesHatch } from "./hatch";
import { markerInk, MARKER_KEYLINE_COLOR, type MarkerStyle } from "./marker-ink";
import { escapeHtml } from "./util";

/** The box every icon occupies, px. Square, so a vertical and a horizontal shape weigh the same. */
export const ICON_BOX = 14;

/** Each symbol's measured HALF-BOUNDING-BOX per √size — the shape constant a size is solved from.
 *
 *  d3's `size` is an AREA, and equal area is not equal visual size: for one area a square's bbox is
 *  √area across and a star's is nearly twice that. Storing the measurement and solving for the size
 *  wanted is the only form that cannot be quietly wrong — the first version of this table stored areas
 *  already solved for one target, by hand, and three of the seven were wrong.
 *
 *  Half the BOX, because `SYMBOL_CENTRE_Y` below re-centres each symbol toward its bounding box.
 *  (Sizing by half the box while drawing from the CENTROID is what put a triangle's apex outside the
 *  icon box.) Note the two are not exactly in step: `OPTICAL_CENTRING` applies only part of that
 *  offset, so an asymmetric symbol sits slightly off centre and reaches marginally further on one
 *  side than half its box. At 0.6 the tightest is the star, whose ink stops 0.05 short of the top
 *  edge — inside, but that margin is what a larger factor would spend.
 *
 *  Measured with `getBBox()` at size 400; `test/icon-fits-box.test.ts` re-measures the result. */
const SYMBOL_HALF_BOX_K: Record<string, number> = {
  square: 0.5,
  circle: 0.56439,
  cross: 0.6708,
  wye: 0.73725,
  triangle: 0.75985,
  star: 0.89765,
  diamond: 0.9306,
};

/** Where each symbol's bounding-box centre sits relative to its path origin, per √size.
 *
 *  d3 centres a symbol on its CENTROID, which is not the middle of its box: a triangle's apex is much
 *  further from the centroid than its base, so placing the origin at the middle of the icon box left
 *  the triangle sitting 1.75px HIGH in a 14px box — visibly out of line with its own label. A star sits
 *  0.67 high and a wye 0.52 low for the same reason; the other four are symmetric and measure zero.
 *
 *  Applied at OPTICAL_CENTRING, not in full — see below. */
export const SYMBOL_CENTRE_Y: Record<string, number> = {
  triangle: -0.21935,
  star: -0.09015,
  wye: 0.05703,
};

/** How much of `SYMBOL_CENTRE_Y` to apply. A JUDGEMENT, like SHAPE_CORRECTION below, and for the same
 *  reason: neither end of the range is right and there is no measurement that decides it.
 *
 *  0 is d3's centroid, which put the triangle 1.75px high. 1 is full bounding-box centring, which is
 *  where this module first landed — and it reads LOW, because a triangle's box is not its ink: the
 *  apex is a thin point that adds height while carrying almost no weight, so balancing the BOX tips
 *  the visible mass below the label's centre. Measured with getBBox, every symbol at 1 sits at exactly
 *  7.00 in the 14px box, so the fault is not arithmetic — the box is simply the wrong thing to centre.
 *
 *  0.6 judged by eye against a rendered strip of 1.0 / 0.75 / 0.6 / 0.5 / 0.35 / 0, each shown at real
 *  size, at 6x, and beside a label, on a rule and standalone, with a circle as the symmetric control.
 *  It moves the triangle up 0.78px standalone and 0.61px on a line, the star up 0.28/0.23, and the wye
 *  DOWN 0.21/0.16 — the wye's offset is positive, so it is the one symbol that descends as the
 *  correction eases. Nothing new is clipped: the only spills at 0.6 (star 0.011, diamond 0.026) are
 *  horizontal and identical at 1.0. `test/icon-fits-box.test.ts` re-measures all of it. */
export const OPTICAL_CENTRING = 0.6;

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
const MAX_HALF_BOX_K = Math.max(...Object.values(SYMBOL_HALF_BOX_K));

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
  const k = SYMBOL_HALF_BOX_K[symbol] ?? SYMBOL_HALF_BOX_K.circle!;
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
  const k = SYMBOL_HALF_BOX_K[symbol] ?? SYMBOL_HALF_BOX_K.circle!;
  const anchor = onLine ? CHART_LINE_MARKER_AREA : CHART_MARKER_AREA;
  const want = anchor * (MAX_HALF_BOX_K / k) ** (2 * SHAPE_CORRECTION);
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
  /** `rect`: round the corners further — the "chip" a point chart's colour legend uses. Has no
   *  effect alongside `colors`, whose banded chip squares off (see the rect branch); the two never
   *  arrive together anyway, since only `markerShape: "chip"` sets this and it carries no colours. */
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
      // A stroke straddles its edge, so an outlined chip must be inset by half of it — otherwise the
      // SVG viewport cuts the outer half and the chip reads as clipped along the bottom and right.
      const inset = icon.outlined ? 0.5 : 0;
      if (tints) {
        // Equal vertical bands, left to right in the given order.
        const box = iconWidth(icon);
        const width = box / tints.length;
        const bands = tints.map((c, i) => ({
          kind: "rect" as const,
          x: i * width,
          y: 0,
          width,
          height: ICON_BOX,
          fill: c,
        }));
        if (!icon.outlined) return bands;
        // The hairline as its OWN rect over the bands, rather than insetting them: the bands divide
        // the width by the palette's rule (swatchWidthFor) and insetting would make every band a
        // different width from the one the chart's own swatch draws. Annotation fill rows are always
        // outlined and an `annotations.bands` tint is ~10% opaque, so without this a merged
        // multi-tint row is a near-white chip with no border — a gap on a white card, which is the
        // exact failure the outline exists to prevent. Bounds are `iconWidth`, NOT the box: a banded
        // chip is the one icon allowed to be wider than ICON_BOX.
        //
        // SQUARE-CORNERED, and `icon.rounded` is deliberately ignored here. A radius on an outline
        // laid OVER square bands curves the border inward at the four corners and leaves band colour
        // outside it; the single-colour path below has no such split (it rounds the ground itself).
        // A banded chip has no single ground to round — rounding each band would notch the seams —
        // so the border squares off instead. At a ~10% tint the leak is invisible, which is how it
        // shipped; a 1px radius on a 14px chip is invisible too, and only one of the two is wrong.
        return [
          ...bands,
          {
            kind: "rect" as const,
            x: inset,
            y: inset,
            width: box - inset * 2,
            height: ICON_BOX - inset * 2,
            fill: "none",
            stroke: OUTLINE,
            strokeWidth: 1,
          },
        ];
      }
      const rx = icon.rounded ? CHIP_RADIUS : RECT_RADIUS;
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
  const size = symbolArea(symbol, onLine, ringed);
  // Shift toward the symbol's own bbox centre, but only OPTICAL_CENTRING of the way: the centroid
  // reads high and the box reads low, and the eye wants a point between them.
  const dy = (SYMBOL_CENTRE_Y[symbol] ?? 0) * OPTICAL_CENTRING * Math.sqrt(size);
  return {
    kind: "path",
    d: symbolPathD(symbol, size),
    transform: `translate(${mid},${Number((mid - dy).toFixed(3))})`,
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

/** One legend row's key markup — the icon plus its label, as a single HTML string. This is the
 *  DEFAULT a `legendKey` hook receives as `ctx.rendered` (spec/hooks.ts): the same drawing
 *  `iconSvgElement`/`iconSvgGroup` would build for this row, so the live legend, the PNG export,
 *  and a hook that wraps rather than replaces all start from one description. */
export function legendRowMarkup(icon: IconSpec, label: string): string {
  return `<span class="tbl-legend-swatch">${iconSvgMarkup(icon)}</span><span>${escapeHtml(label)}</span>`;
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
 *  A chart that DRAWS no legend row still has one to translate: `buildSeriesKeyRows` (index.ts)
 *  resolves a row per series with no legend-presence rule applied, so a lone histogram or waterfall
 *  keys from this same function rather than from a hand-built IconSpec that could drift from it. */
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
 *  tooltip, and a hatched area series showed a textured chip in its legend and a plain line swatch in
 *  its tooltip. Resolving once, here, is what makes them agree.
 *
 *  BOTH sources are legend rows, which is the whole trick. `legendItems` wins where it exists,
 *  because a drawn row is already resolved — symbol, ring, texture and the colour actually painted.
 *  `keyRows` covers the series a legend SUPPRESSES — most often a single unstyled series, though
 *  `legendShowsSeriesRows` (index.ts) is the exact rule and `legend: false` suppresses at any count.
 *  Those charts still tooltip, and they used to key from a separate set of loose channels that
 *  drifted from the legend's rules (see index.ts buildSeriesKeyRows). Filling the gap from the row
 *  the legend would have drawn is what lets those channels be deleted rather than merely bypassed.
 *
 *  It does NOT re-colour. A fill the legend cannot know (`bar_color`, `category_colors`, the
 *  title-selector accent) is applied by `recolourIcons` below, at the hover site that reads the
 *  rendered SVG — one path, and the one that also re-resolves a texture's ground. This function
 *  carried a second, colour-only version of that job, which left a hatched key on its old ground. */
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
  /** The key row for EVERY series, drawn or not — `RenderResult.seriesKeyRows`. Fills the gaps. */
  keyRows?: ReadonlyArray<Parameters<typeof iconFromLegendItem>[0] & { series: string }> | null;
}): Map<string, IconSpec> {
  const out = new Map<string, IconSpec>();
  for (const item of opts.legendItems ?? []) {
    // Annotation rows key bands and rules, never a hovered series.
    if (item.annotation) continue;
    out.set(item.series, iconFromLegendItem(item));
  }
  for (const row of opts.keyRows ?? []) {
    if (!out.has(row.series)) out.set(row.series, iconFromLegendItem(row));
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
