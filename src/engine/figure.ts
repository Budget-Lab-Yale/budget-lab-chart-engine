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

/** A pane's identity in the figure result. For shared mode the SVG lives on the figure's
 *  `combinedSvg` and only `value`/`title` are populated. For per-pane mode each pane is its
 *  OWN single-frame SVG with independent y-scale/units/x-domain, and the per-pane interaction
 *  metadata the live layer (B6) needs for the per-pane crosshair is carried here. */
export interface FigurePane {
  value: string;
  title: string;
  /** Per-pane mode: this pane's standalone SVG (own y-domain/units/x-domain). */
  svg?: SVGSVGElement;
  /** Per-pane mode: rows actually rendered in this pane (series-filtered), for the crosshair. */
  dataInScope?: PreparedRow[];
  /** Per-pane mode: this pane's series → resolved color map. */
  colors?: Map<string, string>;
  /** Per-pane mode: this pane's resolved series order. */
  seriesOrder?: string[];
  /** Per-pane mode: this pane's dashed series. */
  dashedNames?: Set<string>;
  /** Per-pane mode: this pane's units (each pane infers independently). */
  units?: string;
  /** Per-pane mode: this pane's x-value parse/format for the crosshair. */
  tooltipXParse?: (v: string) => number;
  tooltipXFormat?: (v: number) => string;
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

  // Bar-family panes are a later task (B8): the bar/stacked mark builders don't bind
  // fxField/fyField (shared) and per-pane composition is line-only here, so fail loud for both
  // modes. (Applies before the mode branch — neither shared nor per-pane supports bars yet.)
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
  // Column count: a live-layer override (responsive reflow) wins, else the spec config, else
  // the ≈ceil(sqrt(n)) default. Clamp to [1, paneValues.length].
  const requestedColumns = opts.columns && opts.columns > 0
    ? opts.columns
    : sm.columns && sm.columns > 0
      ? sm.columns
      : defaultColumns(paneValues.length);
  const columns = Math.max(1, Math.min(requestedColumns, paneValues.length));
  const gridRows = Math.ceil(paneValues.length / columns);

  const titles = sm.pane_titles ?? {};
  const titleFor = (value: string): string => titles[value] ?? value;
  const seriesLabels = spec.series_labels ?? {};

  // PER-PANE mode: each pane is its OWN single-frame SVG with an independent y-scale, units,
  // and x-domain (Plot faceting can't give independent y-scales, so we render + compose N
  // mini-SVGs instead of one faceted SVG). Each pane gets a distinct deterministic
  // classNameSuffix ("p0", "p1", …) so clip-path ids stay unique across the composed DOM, and
  // `pane: true` thins its line stroke.
  if (mode === "per-pane") {
    const panes: FigurePane[] = paneValues.map((value, i) => {
      // Restrict the rows to this pane (own y-domain/units/x-domain). No facetInfo → renderPane
      // renders a standalone single frame for these rows only.
      const paneRows = rows.filter((r) => (r[facetField] as string) === value);
      const p = renderPane(spec, paneRows, { ...opts, pane: true }, `p${i}`);
      return {
        value,
        title: titleFor(value),
        svg: p.svg,
        dataInScope: p.dataInScope,
        colors: p.colors,
        seriesOrder: p.seriesNames,
        dashedNames: p.layers.dashedNames,
        units: p.units || inferUnitsFromSubtitle(spec.subtitle),
        tooltipXParse: p.tooltipXParse,
        tooltipXFormat: p.tooltipXFormat,
      };
    });

    // Figure-level legend: series config is shared across panes, so compute it ONCE from the
    // first pane's series/colors (same as shared mode). Single/unstyled series → null.
    const first = panes[0];
    const legendItems = buildLegendItems(
      spec,
      first?.seriesOrder ?? [],
      first?.colors ?? new Map(),
      // The legend reads dashedNames + (for bars) the extras; per-pane is line-only, so derive
      // a minimal MarkLayers from the first pane's dashed set.
      { underlay: [], overlay: [], tagging: [], dashedNames: first?.dashedNames ?? new Set() },
    );

    return {
      mode: "per-pane",
      combinedSvg: undefined,
      panes,
      columns,
      rows: gridRows,
      legendItems,
      seriesLabels,
      colors: first?.colors ?? new Map(),
      seriesOrder: first?.seriesOrder ?? [],
      dashedNames: first?.dashedNames ?? new Set(),
      units: first?.units ?? inferUnitsFromSubtitle(spec.subtitle),
      xAxisTitle: spec.x_axis_title ?? null,
      dataInScope: first?.dataInScope ?? [],
      tooltipXParse: first?.tooltipXParse,
      tooltipXFormat: first?.tooltipXFormat,
    };
  }

  // SHARED mode: one shared y-scale → ONE faceted SVG.
  const cellFor = new Map<string, { col: number; row: number; title: string }>();
  const panes: FigurePane[] = [];
  paneValues.forEach((value, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const title = titleFor(value);
    cellFor.set(value, { col, row, title });
    panes.push({ value, title });
  });

  const facetInfo: FacetInfo = { facetField, cellFor, columns, rows: gridRows };

  // 3 + 4. Shared y-domain + faceted build. renderPane parses rows, tags grid indices, computes
  //         ONE y-axis over all in-scope rows (shared), drives the line marks with fx/fy facet
  //         channels, and assembles ONE faceted SVG. A single deterministic className suffix.
  //         `pane: true` thins the line stroke (panes are small — same as per-pane mode).
  const pane = renderPane(spec, rows, { ...opts, pane: true }, "fig", facetInfo);

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
    seriesLabels,
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
