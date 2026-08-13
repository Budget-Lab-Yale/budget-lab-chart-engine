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
import { TBL, swatchWidthFor } from "./theme";
import { hatchGlyphShapes, type HatchChar, type SeriesHatch } from "./hatch";

/** The box every icon occupies, px. Square, so a vertical and a horizontal shape weigh the same. */
export const ICON_BOX = 14;

/** How far from the centre any ink may reach: half the box, less the widest keyline. */
export const ICON_INK_LIMIT = ICON_BOX / 2 - 0.5;

/** d3-symbol AREA per symbol, so every marker reaches the SAME EXTENT and therefore fills the box.
 *
 *  One area for all seven was a mistake: d3's `size` is an AREA, and equal area is not equal visual
 *  size. Measured at area 90, extents ranged from 4.74 (square) to 8.95 (star) — so a single constant
 *  made the pointy symbols overflow the box while the blocky ones sat small inside it. These are that
 *  measurement solved for extent = ICON_INK_LIMIT, since extent scales as sqrt(area).
 *
 *  Gated by `test/icon-fits-box.test.ts`, which measures real bounding boxes: every entry must fit,
 *  and must genuinely use the space rather than leave it. */
const SYMBOL_AREA: Record<string, number> = {
  square: 169,
  circle: 133,
  cross: 94,
  wye: 78,
  // The pointy three sit right on the limit, so each is trimmed a unit to stay inside it.
  triangle: 54,
  diamond: 47,
  star: 46,
};

/** Fraction of the standalone area for a marker drawn ON a line: the line has to stay readable
 *  underneath, so the marker sits at about two thirds of its extent. */
const ON_LINE_SCALE = 0.45;

/** The area this symbol is drawn at. `onLine` shrinks it so the line still reads. */
export function symbolArea(symbol: string, onLine = false): number {
  const area = SYMBOL_AREA[symbol] ?? SYMBOL_AREA.circle!;
  return onLine ? Math.round(area * ON_LINE_SCALE) : area;
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
/** Corner radius: a square key is barely rounded, a "chip" distinctly so. */
const RECT_RADIUS = 1;
const CHIP_RADIUS = 4;
/** Hairline around a near-white tint, so an annotation chip does not read as a gap. */
const OUTLINE = "rgba(0, 0, 0, 0.18)";
/** Ground behind a hollow ring. */
const RING_GROUND = "#ffffff";
/** Ring colour for the stacked Total dot, matching the net marker the chart draws. */
const TOTAL_RING = tokens.structural.mark_black;

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
  /** `dot`: a ring rather than a disc (a dumbbell's hollow end). */
  hollow?: boolean;
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

    case "dot":
      return [
        {
          kind: "circle",
          cx: mid,
          cy: mid,
          // The ring's stroke straddles its radius, so the radius shrinks by half the weight to keep
          // the OUTER diameter equal to the filled dot's — same size on the page, and nothing clipped.
          r: DOT_DIAMETER / 2 - (icon.hollow ? RING_WEIGHT / 2 : 0),
          fill: icon.hollow ? RING_GROUND : color,
          ...(icon.hollow ? { stroke: color, strokeWidth: RING_WEIGHT } : {}),
        },
      ];

    case "symbol":
      return [symbolPrimitive(icon.symbol ?? "circle", color, false, icon.hollow === true)];

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

function symbolPrimitive(symbol: string, color: string, onLine = false, hollow = false): IconPrimitive {
  const mid = ICON_BOX / 2;
  return {
    kind: "path",
    d: symbolPathD(symbol, symbolArea(symbol, onLine)),
    transform: `translate(${mid},${mid})`,
    // Hollow inverts it: the ground shows through and the COLOUR becomes the outline, matching the
    // dumbbell's hollow chart dots. A white keyline otherwise, so a dark marker reads on a dark fill.
    fill: hollow ? RING_GROUND : color,
    stroke: hollow ? color : "#ffffff",
    strokeWidth: hollow ? RING_WEIGHT : 1,
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

/** An icon as an SVG `<g>` at the origin, for the PNG export to position. Null for `none`. */
export function iconSvgGroup(doc: Document, icon: IconSpec): SVGElement | null {
  const svg = iconSvgElement(doc, icon);
  if (!svg) return null;
  const g = doc.createElementNS(SVG_NS, "g");
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
  const color = item.color;
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
      // A dot with NO colour is the stacked Total: a white disc with a black ring, matching the net
      // marker in marks/stacked.ts. A coloured dot is a dumbbell end, filled unless hollow.
      return color
        ? { shape: "dot", color, ...(item.hollow ? { hollow: true } : {}) }
        : { shape: "dot", color: TOTAL_RING, hollow: true };
    case "point":
      return {
        shape: "symbol",
        ...(color ? { color } : {}),
        symbol: item.markerSymbol ?? "circle",
        ...(item.hollow ? { hollow: true } : {}),
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
