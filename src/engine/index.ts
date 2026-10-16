// Pure chart engine entry point: a validated spec + normalized tidy rows → an SVG plus
// the metadata the live layer (legend, crosshair) needs. Headless-safe — no Date.now /
// Math.random / locale formatting in the render path; interaction lives elsewhere.
//
// This is the tracker's buildLineChart, generalized: data prep + axis computation are
// chart-type agnostic (pane.ts); the type-specific marks come from the marks/ registry, and
// the Plot is composed by assemblePlot.
import type { ChartSpec, ValueAffixes } from "../spec/types";
import type { NetMode } from "../spec/bar-stack";
import type { TidyRow } from "../data/index";
import type { PreparedRow } from "./marks/index";
import { normalizeSpec } from "./util";
import type { OverlayTooltipLine } from "./overlays";
import { renderPane } from "./pane";
import type { RenderOptions } from "./pane";
import { buildSeriesKeyRows, buildLegendItems, buildShapeLegendItems } from "./legend-items";
import type { LegendItem, ShapeLegendItem } from "./legend-items";

export { TOTAL_SERIES_KEY } from "./series-keys";

// The pane pipeline, palette construction and legend-row builders live in modules below this one
// (pane.ts, color-map.ts, legend-items.ts) so figure.ts and marks/{timeline,treemap}.ts import them
// without importing the entry point back. Re-exported here so existing imports keep working.
export { buildColorMap } from "./color-map";
export { renderPane, paneXValues, paneValueExtent, singleChartDrawsNetDots, shapeDomainOver } from "./pane";
export type { RenderOptions, PaneResult } from "./pane";
export { buildSeriesKeyRows, buildLegendItems, buildShapeLegendItems } from "./legend-items";
export type { LegendItem, ShapeLegendItem } from "./legend-items";

export interface RenderResult {
  svg: SVGSVGElement;
  /** Legend rows (null for a single, unstyled series — no legend needed). For point charts this
   *  is the COLOR (series) legend; the shape legend (when distinct) is `shapeLegendItems`. */
  legendItems: LegendItem[] | null;
  /** The key row for EVERY series, including the ones `legendItems` suppresses. Tooltips read this
   *  where `legendItems` is null (see buildSeriesKeyRows) so a lone series still keys correctly. */
  seriesKeyRows: LegendItem[];
  /** Point charts with two-field encoding: the SHAPE legend rows (neutral markers). Null when
   *  shape encodes the same field as color (redundant → folded into `legendItems`) or absent. */
  shapeLegendItems?: ShapeLegendItem[] | null;
  /** The symbol scale the MARKS were drawn with — the domain/range handed to Plot, including the
   *  substitution to series identity when shape and color encode one field. This is what the hover
   *  card's header marker must key off. It is NOT `shapeLegendItems`, which answers the different
   *  question of what the legend displays and is nulled by `legend: false` and by the redundant
   *  case — reading the legend's answer is what made a hidden legend draw circles over triangles. */
  symbolScale?: { domain: string[]; range: string[] } | undefined;
  /** Shape and color encode the same column, so the header names the series once (no shape token)
   *  while still keying the marker off `symbolScale`. */
  shapeIsSeries?: boolean;
  /** Point charts: the rows that produced DOM markers, in marker order. The per-point hover pairs
   *  by index, so it must read this rather than `dataInScope`, which still holds the rows that
   *  rendered nothing. */
  pointOrder?: PreparedRow[];
  /** Optional headings for the color/shape legend groups (point charts, dual encoding). */
  colorLegendTitle?: string;
  shapeLegendTitle?: string;
  seriesLabels: Record<string, string>;
  seriesOrder: string[];
  dashedNames: Set<string>;
  colors: Map<string, string>;
  valueAffixes: ValueAffixes;
  xAxisTitle: string | null;
  /** Rows actually rendered (series-filtered), for the crosshair. */
  dataInScope: PreparedRow[];
  tooltipXParse?: (v: string) => number;
  tooltipXFormat?: (v: number) => string;
  /** `overlays[].tooltip: true` lines drawn in this frame — one hover-tooltip row each. Empty when
   *  no overlay opted in. See PaneResult.overlayTooltips. */
  overlayTooltips: OverlayTooltipLine[];
  /** Top-to-bottom order of the interactive series in the RIGHT legend column: the visual stack
   *  order on a stacked chart, the group order on a treemap. render-live and the PNG export order the
   *  vertical legend column by it; absent, the column reverses the series order. */
  legendVisualOrder?: string[];
  /** Stacked charts only. Mirrors MarkLayers.netMode — see spec/bar-stack.ts. */
  netMode?: NetMode;
  /** Stacked charts only. Mirrors MarkLayers.segmentLabelsDropped — the label builder's report that
   *  at least one segment was too thin for its in-bar number. render-live feeds it to
   *  resolveValuePills so the pill default cannot leave those segments with no number at all. */
  segmentLabelsDropped?: boolean;
  /** Timeline only: the orientation actually rendered. */
  timelineOrientation?: "horizontal" | "vertical";
  /** Treemap only: per-tile hover payload, in DOM order of `rect.tbl-treemap-tile`. */
  treemapTiles?: TreemapTileInfo[];
}

export function renderChart(
  spec: ChartSpec,
  rows: TidyRow[],
  opts: RenderOptions = {},
): RenderResult {
  spec = normalizeSpec(spec);
  // Timeline draws its own SVG (no Plot frame, no value axis): branch before renderPane so no
  // existing chart type's path runs any timeline code.
  if (spec.chartType === "timeline") return renderTimeline(spec, rows, opts);
  // Treemap likewise draws its own SVG.
  if (spec.chartType === "treemap") return renderTreemap(spec, rows, opts);
  const pane = renderPane(spec, rows, opts);
  const { svg, seriesNames, colors, valueAffixes, dataInScope, layers } = pane;

  const seriesLabels = spec.series_labels ?? {};
  // ONE build, shared. The legend's series rows and the tooltip's key rows are the same rows off the
  // same inputs, so building them twice (and re-resolving every texture with them) only bought a
  // second chance for the two to differ. The textures come from the RENDER (`pane.seriesHatches`),
  // which is what makes the mark, the tooltip, the export and the legend one drawing over one ground.
  const seriesKeyRows = buildSeriesKeyRows(spec, seriesNames, colors, layers, pane.seriesHatches, pane.seriesPainted);
  const legendItems = buildLegendItems(spec, seriesNames, colors, layers, seriesKeyRows, pane.formatValue);
  const shapeLegendItems = buildShapeLegendItems(spec, layers);

  // Escape hatch: LAST thing before the SVG is handed back — every mark/axis/legend-metadata build
  // above is done, and nothing downstream removes or replaces what's here (render-live.ts only ADDS
  // interactive-only nodes afterward, e.g. crosshair guides). `opts.phase` distinguishes buildExportSvg's
  // re-render ("export") from every other, live, caller. Guarded so an absent hook costs nothing —
  // no ctx object, no call — and `hooks: {}` stays byte-identical to no hooks at all.
  if (opts.hooks?.afterRender) {
    opts.hooks.afterRender(svg, { phase: opts.phase ?? "live" });
  }

  return {
    svg,
    legendItems,
    seriesKeyRows,
    shapeLegendItems,
    symbolScale: layers.symbolScaleOpts,
    shapeIsSeries: layers.shapeIsSeries ?? false,
    pointOrder: layers.pointOrder,
    colorLegendTitle: spec.color_legend_title,
    shapeLegendTitle: spec.shape_legend_title,
    seriesLabels,
    seriesOrder: seriesNames,
    dashedNames: layers.dashedNames,
    colors,
    valueAffixes,
    xAxisTitle: spec.x_axis_title ?? null,
    dataInScope,
    tooltipXParse: pane.tooltipXParse,
    tooltipXFormat: pane.tooltipXFormat,
    overlayTooltips: pane.overlayTooltips,
    legendVisualOrder: layers.legendVisualOrder,
    netMode: layers.netMode,
    segmentLabelsDropped: layers.segmentLabelsDropped,
  };
}

// Figure orchestrator (small multiples), re-exported for library consumers. figure.ts imports the
// pane pipeline and legend builders from pane.ts / legend-items.ts, not from this module.
export { renderFigure } from "./figure";
export type { FigureRenderResult, FigurePane } from "./figure";
// Timeline and treemap renderers draw their own SVG; both take buildColorMap from color-map.ts.
import { renderTimeline } from "./marks/timeline";
import { renderTreemap } from "./marks/treemap";
import type { TreemapTileInfo } from "./marks/treemap";
