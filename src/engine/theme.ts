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
