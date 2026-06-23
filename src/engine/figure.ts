// Figure-level orchestrator for small-multiples specs. Turns a spec carrying
// `small_multiples` into a multi-panel figure. This task (B4) implements SHARED mode for
// LINE-family panes: partition rows by `facet_field`, lay the panes out on a (col,row) grid,
// compute ONE shared y-domain across all in-scope rows, and render a single faceted SVG via
// the B3 faceting primitives (renderPane → assemblePlot's `facet` option). Per-pane mode is
// B5; bar-family panes are B8.
import type { ChartSpec } from "../spec/types";
import type { TidyRow } from "../data/index";
import type { PreparedRow } from "./marks/index";
import { renderPane, buildLegendItems } from "./index";
import type { FacetInfo, LegendItem, RenderOptions } from "./index";
import { inferUnitsFromSubtitle } from "./util";

/** Default grid-column count for `n` panes: ≈ ceil(sqrt(n)), capped at 4. */
function defaultColumns(n: number): number {
  return Math.min(4, Math.max(1, Math.ceil(Math.sqrt(n))));
}

/** A pane's identity in the figure result. For shared mode the SVG lives on
 *  `combinedSvg`; `svg` per-pane is filled by per-pane mode (B5). */
export interface FigurePane {
  value: string;
  title: string;
  svg?: SVGSVGElement;
}

export interface FigureRenderResult {
  mode: "shared" | "per-pane";
  /** Shared mode: the ONE faceted SVG. */
  combinedSvg?: SVGSVGElement;
  panes: FigurePane[];
  columns: number;
  rows: number;
  legendItems: LegendItem[] | null;
  seriesLabels: Record<string, string>;
  // Fields render-live / export read (mirrors RenderResult's interaction surface).
  colors: Map<string, string>;
  seriesOrder: string[];
  dashedNames: Set<string>;
  units: string;
  xAxisTitle: string | null;
  dataInScope: PreparedRow[];
  tooltipXParse?: (v: string) => number;
  tooltipXFormat?: (v: number) => string;
  /** Visual top-to-bottom stack order of the interactive series (stacked panes only; line
   *  panes leave this undefined). Mirrors RenderResult.legendVisualOrder. */
  legendVisualOrder?: string[];
  /** Net-dot mode for the band crosshair's Total row (stacked panes only; line panes leave
   *  this undefined). Mirrors RenderResult.showTotalDot. */
  showTotalDot?: boolean;
}

/**
 * Render a small-multiples figure. Requires `spec.small_multiples`.
 *
 * Shared mode (default): one shared y-scale → ONE faceted SVG. Flow:
 *   partition + order panes → grid layout → shared y-domain (computed inside renderPane over
 *   all in-scope rows) → faceted build (renderPane drives assemblePlot's `facet` option).
 */
export function renderFigure(
  spec: ChartSpec,
  rows: TidyRow[],
  opts: RenderOptions = {},
): FigureRenderResult {
  const sm = spec.small_multiples;
  if (!sm) throw new Error("renderFigure called without spec.small_multiples.");
  const mode = sm.mode ?? "shared";
  if (mode === "per-pane") {
    // B5 implements per-pane mode (each pane its own y-scale/units → N SVGs).
    throw new Error("small_multiples mode 'per-pane' is not yet implemented (planned for B5).");
  }

  // Bar-family panes in shared mode are a later task (B8): the bar/stacked mark builders
  // don't bind fxField/fyField, so all panes would superimpose silently. Fail loud.
  if (spec.chartType !== "line") {
    throw new Error(
      "small multiples currently support line charts only; bar/stacked panes are not yet implemented (B8)",
    );
  }

  const facetField = sm.facet_field;

  // 1. Partition + order panes. Distinct facet values in data-encounter order, then reorder +
  //    filter by pane_order when set (pane_order names the included panes, in order).
  const encounterOrder: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const v = r[facetField] as string;
    if (v != null && v !== "" && !seen.has(v)) {
      seen.add(v);
      encounterOrder.push(v);
    }
  }
  const paneValues =
    sm.pane_order && sm.pane_order.length
      ? sm.pane_order.filter((v) => seen.has(v))
      : encounterOrder;

  if (!paneValues.length) throw new Error("No panes: facet_field produced no values in scope.");

  // 2. Grid layout. columns = config else default; rows = ceil(n / columns). col = i % columns,
  //    row = floor(i / columns).
  const columns = sm.columns && sm.columns > 0 ? sm.columns : defaultColumns(paneValues.length);
  const gridRows = Math.ceil(paneValues.length / columns);

  const titles = sm.pane_titles ?? {};
  const cellFor = new Map<string, { col: number; row: number; title: string }>();
  const panes: FigurePane[] = [];
  paneValues.forEach((value, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const title = titles[value] ?? value;
    cellFor.set(value, { col, row, title });
    panes.push({ value, title });
  });

  const facetInfo: FacetInfo = { facetField, cellFor, columns, rows: gridRows };

  // 3 + 4. Shared y-domain + faceted build. renderPane parses rows, tags grid indices, computes
  //         ONE y-axis over all in-scope rows (shared), drives the line marks with fx/fy facet
  //         channels, and assembles ONE faceted SVG. A single deterministic className suffix.
  const pane = renderPane(spec, rows, opts, "fig", facetInfo);

  // 5. Figure-level legend: series config is shared across panes, so compute it ONCE exactly as
  //    renderChart does. L1/single-series → null (pane titles carry identity).
  const legendItems = buildLegendItems(spec, pane.seriesNames, pane.colors, pane.layers);

  return {
    mode: "shared",
    combinedSvg: pane.svg,
    panes,
    columns,
    rows: gridRows,
    legendItems,
    seriesLabels: spec.series_labels ?? {},
    colors: pane.colors,
    seriesOrder: pane.seriesNames,
    dashedNames: pane.layers.dashedNames,
    units: pane.units || inferUnitsFromSubtitle(spec.subtitle),
    xAxisTitle: spec.x_axis_title ?? null,
    dataInScope: pane.dataInScope,
    tooltipXParse: pane.tooltipXParse,
    tooltipXFormat: pane.tooltipXFormat,
    legendVisualOrder: pane.layers.legendVisualOrder,
    showTotalDot: pane.layers.showTotalDot,
  };
}
