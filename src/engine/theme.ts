// Engine theme: the layout/typography constants the chart primitives read, with all
// COLOR values sourced from the generated Style-Guide tokens (theme/tokens.ts). The
// non-color constants (font stack, type sizes, stroke widths, margins) are the
// engine's own layout decisions and live here, not in colors.json.
import { tokens } from "../theme/tokens";

export const TBL = {
  // Figtree is the house typeface; the rest are load-failure fallbacks.
  font: 'Figtree, "Source Sans 3", system-ui, -apple-system, "Segoe UI", Arial, sans-serif',
  color: {
    text: tokens.structural.text_body,
    heading: tokens.structural.text_heading,
    muted: tokens.structural.text_muted,
    axis: tokens.structural.text_axis,
    gridline: tokens.structural.gridline,
    axisStroke: tokens.structural.axis_stroke,
    annotationDim: tokens.structural.annotation_dim,
    bgSubtle: tokens.structural.bg_subtle,
    border: tokens.structural.border,
    navy: tokens.brand.navy,
    blue: tokens.brand.blue,
  },
  size: {
    axis: 10.5, // tick labels
    legend: 12,
    annotation: 11,
  },
  // `pane` was a thinner small-multiples line stroke; panes now match single charts (2px) for
  // legibility, so `pane` equals `solid` (kept for any non-line callers).
  strokeWidth: { solid: 2, dashed: 2, pane: 2 },
  dashArray: "5 3",
} as const;

/** Legend fill-swatch geometry. A single-tint chip is the CSS default (14px, in embed/styles.ts);
 *  a BANDED chip — one keyed concept over several differently-colored fills — grows so each band
 *  keeps `SWATCH_MIN_BAND` px, up to `SWATCH_MAX_WIDTH`. Beyond that the bands thin again, which is
 *  the honest outcome for a chart with more series than a chip can key. */
export const SWATCH_WIDTH = 14;
export const SWATCH_MIN_BAND = 3;
export const SWATCH_MAX_WIDTH = 30;

/** The chip width that fits `bands` bands. */
export function swatchWidthFor(bands: number): number {
  return Math.min(Math.max(SWATCH_WIDTH, bands * SWATCH_MIN_BAND), SWATCH_MAX_WIDTH);
}

/** Hairline around an annotation-derived legend fill swatch. Such a swatch shows the fill's TINT,
 *  which for a 10 %-opaque band is nearly white — without the outline it reads as a gap. Shared by
 *  the live legend CSS (embed/styles.ts) and the PNG export, which must agree visually. Not a
 *  Style-Guide token (it is chrome on chrome), so it lives here with the other layout constants. */
export const SWATCH_OUTLINE = "rgba(0, 0, 0, 0.18)";

/** Marker RADII the charts draw their point markers at, in px — the size a KEY has to match, since a
 *  key's whole job is to look like the mark it names. Read by marks/point.ts, marks/line.ts and by
 *  engine/icon.ts, which sizes a marker key from these rather than from a constant of its own: the key
 *  was 9% smaller than the scatter dot beside it, which is exactly the kind of gap nobody can measure
 *  by eye but everybody can see. Plot sizes a symbol by AREA = pi*r^2, so these convert directly.
 *
 *  A pane's dots are LARGER than a single chart's for scatter (a small pane needs the mark to survive
 *  being shrunk) and smaller on a line. Keys use the single-chart values: a key is drawn at one size. */
export const MARK_POINT_R = 4.6;
export const MARK_POINT_PANE_R = 5.4;
export const MARK_LINE_POINT_R = 3.6;
export const MARK_LINE_POINT_PANE_R = 3.3;

/** Marker colour for a SHAPE-legend row (a point chart's second legend group). Neutral by design:
 *  shape carries the value in that group, not colour. Here rather than in either legend renderer,
 *  which each had their own copy of it — the live one and the export's, free to drift. */
export const SHAPE_LEGEND_COLOR = "#555B66";

// Per-series point-marker symbols (d3 symbol names), in a fixed, distinguishable order so a
// series' shape is stable and series can be told apart without relying on color (accessibility).
// Assigned by series index; wraps if there are more series than shapes.
export const MARKER_SYMBOLS = [
  "circle",
  "square",
  "triangle",
  "diamond",
  "star",
  "wye",
  "cross",
] as const;

/** The marker symbol for a series at index `i` (wraps). */
export function markerSymbolForIndex(i: number): string {
  return MARKER_SYMBOLS[((i % MARKER_SYMBOLS.length) + MARKER_SYMBOLS.length) % MARKER_SYMBOLS.length]!;
}

/** The marker symbol of each row of `names`, a list built row by row (a legend, the key rows, a
 *  hover map). Small multiples pass the FIGURE's list as `order` (RenderOptions.paletteSeries /
 *  paletteShapes), the one the figure legend keys markers by: the n-th row naming a value takes the
 *  position of the n-th entry naming it in `order`. A pane lacking a value, or meeting its values in
 *  another order, so numbers them as the legend does; a pane holding the whole list numbers each row
 *  as it numbered its own before, a duplicated `series_order`/`shape_order` entry included (Ruling
 *  65). A value `order` does not name keeps its row index; absent `order` (a single chart), every
 *  row does. */
export function markerSymbolsForRows(names: readonly string[], order?: readonly string[]): string[] {
  if (!order) return names.map((_, i) => markerSymbolForIndex(i));
  const positions = new Map<string, number[]>();
  order.forEach((v, j) => (positions.get(v) ?? positions.set(v, []).get(v)!).push(j));
  const seen = new Map<string, number>();
  return names.map((name, i) => {
    const nth = seen.get(name) ?? 0;
    seen.set(name, nth + 1);
    const at = positions.get(name);
    return markerSymbolForIndex(at ? (at[nth] ?? at[0]!) : i);
  });
}

/** The range of Plot's ordinal symbol scale over `domain`, the pane's own list. Plot keeps a value's
 *  FIRST occurrence and pairs the k-th DISTINCT value with `range[k]`, so the first entries are what
 *  is drawn: each distinct value takes its position among the distinct values of `order`, which is
 *  the same in every pane. The entries past them are read only by the hover maps built from domain
 *  and range row by row (a later duplicate overwrites), so they keep `markerSymbolsForRows`'
 *  numbering. A pane holding the figure's whole list gets the range it built before F12, duplicates
 *  included; absent `order` (a single chart), the range is numbered by row as it always was. */
export function markerSymbolRange(domain: readonly string[], order?: readonly string[]): string[] {
  const byRow = markerSymbolsForRows(domain, order);
  if (!order) return byRow;
  const distinct = [...new Set(domain)];
  const distinctOrder = [...new Set(order)];
  return byRow.map((sym, k) => {
    if (k >= distinct.length) return sym;
    const at = distinctOrder.indexOf(distinct[k]!);
    return markerSymbolForIndex(at >= 0 ? at : k);
  });
}

// Callout number labels — the single shared style for per-bar VALUE labels (grouped/single
// bars) and stacked NET-TOTAL text, so they read consistently. `gap` is the px offset
// between the bar's end/top and the number (perpendicular to the value axis); the
// negative-direction offset is larger to clear the descending text box.
export const TBL_VALUE_LABEL = {
  fontSize: 12, // match the legend text size (keep the heavier 700 weight)
  fontWeight: 700,
  gap: 12, // above a positive bar / outside a bar end
  gapBelow: 18, // below a negative bar (clears the text box)
} as const;

// marginLeft holds a "label column": y-tick labels sit at svg x=0 (sharing the left
// edge with title/subtitle above) and the plot area starts at x=marginLeft. marginRight
// reserves room for the rightmost x-tick label so it isn't clipped.
// marginTop matches the tblPlotDefaults default; used for inner-plot-height approximations.
export const TBL_MARGIN_LEFT = 44;
export const TBL_MARGIN_RIGHT = 16;
export const TBL_MARGIN_TOP = 18;
/** Label-less (non-leftmost) small-multiples columns get this small left margin instead of the
 *  full label gutter, so the series doesn't render with a big blank strip on its left. Lives here
 *  (not figure.ts) so leaf modules like the bar mark builder can import it without a module cycle.
 *  figure.ts re-exports it for back-compat. */
export const SHARED_LABELLESS_MARGIN_LEFT = 2;
