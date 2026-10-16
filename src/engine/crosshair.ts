// The live hover layer's public surface (a barrel). Cursor-following hover for every chart family:
// a crosshair or band highlight plus a floating card on the hovered pane, and a coordinated echo
// cursor on sibling small-multiples panes. Nothing here runs on the static or PNG-export path.
//
// The code lives in ./crosshair/:
// - one module per family, each with its pointer-driven attach and its echo cursor: line.ts
//   (continuous x), band.ts (bar / stacked / waterfall), histogram.ts, catline.ts (categorical-x
//   line, dot plot, dumbbell), highlight-pills.ts (legend-highlight pills), point.ts (scatter);
// - the layers they share: attach.ts (detach handle, listener wiring), card.ts (the shared card
//   element and its markup builders), layout-math.ts (pure geometry), coord-draw.ts (echo-cursor
//   drawing) and dom-geometry.ts (reads of the rendered SVG).
// Everything this module exported before that split is still exported from here, so importers
// (render-live, live/*, treemap-hover, the tests) did not change.
export { type HoverDetach, listen } from "./crosshair/attach";
export {
  LABEL_VALUE_GAP,
  getSharedTooltip,
  tooltipOwnership,
  seriesSwatchHtml,
  overlayTooltipRows,
  resolveCategorySeriesValues,
  buildBandTooltipHtml,
  buildHistogramTooltipHtml,
  buildLineTooltipHtml,
  buildPointTooltipHtml,
} from "./crosshair/card";
export {
  type CategoryBand,
  type CategoryBandH,
  type HistogramBin,
  widenBandsToMidpoints,
  resolveCategoryFromBands,
  resolveCategoryFromBandsH,
  buildHistogramBins,
  resolveHistogramBinIndex,
  spreadLabelYs,
  spreadPillCentersX,
  staggerBarLabels,
  uniformBand,
} from "./crosshair/layout-math";
export { type CrosshairOptions, attachCrosshair, attachSecondaryLineCursor } from "./crosshair/line";
export {
  type BandHoverCtx,
  type BandCrosshairOptions,
  type SecondaryBandOptions,
  attachBandCrosshair,
  attachSecondaryBandCursor,
} from "./crosshair/band";
export {
  type HistogramHoverOptions,
  attachHistogramHover,
  attachSecondaryHistogramCursor,
} from "./crosshair/histogram";
export {
  type CategoricalLineOptions,
  attachCategoricalLineCrosshair,
  attachSecondaryCategoricalLineCursor,
} from "./crosshair/catline";
export {
  type HighlightPillsOptions,
  type HighlightPillsHandle,
  attachHighlightPills,
} from "./crosshair/highlight-pills";
export { type PointHoverOptions, attachPointHover } from "./crosshair/point";

/** Every transparent hover hit-rect the attach functions append, in one selector. Re-exported from
 *  the leaf `hover-classes.ts` (see there) for the callers that already import it from here. */
export { CROSSHAIR_HIT_CLASSES, CROSSHAIR_HIT_SELECTOR } from "./hover-classes";
