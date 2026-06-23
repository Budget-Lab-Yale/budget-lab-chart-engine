// Figure-level orchestrator for small-multiples specs. Turns a spec carrying
// `small_multiples` into a multi-panel figure of N independent mini-SVGs laid out on a
// (col,row) grid. BOTH modes use the SAME per-pane composition (each pane is its own single
// frame with its own crosshair / dimming / selection). They differ only in the y-scale:
//   - per-pane: each pane computes its own y-domain (and shows its own y-tick labels).
//   - shared:   ALL panes use ONE y-domain (computed once over all in-scope rows), and y-tick
//               LABELS show only on the leftmost column (col>0 panes hide them; gridlines +
//               plot area + left margin stay so panes remain aligned).
// SHARED mode is line-only (the guard below); per-pane supports line/bar/stacked.
import type { ChartSpec } from "../spec/types";
import type { TidyRow } from "../data/index";
import type { PreparedRow, MarkLayers } from "./marks/index";
import { renderPane, buildLegendItems } from "./index";
import type { LegendItem, RenderOptions } from "./index";
import { inferUnitsFromSubtitle } from "./util";

/** Default grid-column count for `n` panes: ≈ ceil(sqrt(n)), capped at 4. */
function defaultColumns(n: number): number {
  return Math.min(4, Math.max(1, Math.ceil(Math.sqrt(n))));
}

/** A pane's identity + its standalone SVG and per-pane interaction metadata. BOTH modes
 *  populate every field the same way (each pane is its OWN single-frame SVG with its own
 *  crosshair / dimming / selection); shared mode only forces a common y-domain and hides the
 *  y-tick labels on non-leftmost columns. */
export interface FigurePane {
  value: string;
  title: string;
  /** This pane's standalone SVG. */
  svg?: SVGSVGElement;
  /** Rows actually rendered in this pane (series-filtered), for the crosshair. */
  dataInScope?: PreparedRow[];
  /** This pane's series → resolved color map. */
  colors?: Map<string, string>;
  /** This pane's resolved series order. */
  seriesOrder?: string[];
  /** This pane's dashed series. */
  dashedNames?: Set<string>;
  /** This pane's units (each pane infers independently). */
  units?: string;
  /** This pane's x-value parse/format for the crosshair. */
  tooltipXParse?: (v: string) => number;
  tooltipXFormat?: (v: number) => string;
  /** Stacked panes: net-dot mode for the band crosshair's Total row. Mirrors
   *  MarkLayers.showTotalDot — line/bar panes leave this undefined. */
  showTotalDot?: boolean;
  /** Stacked panes: visual top→bottom stack order, for the band crosshair's
   *  Total/series ordering. Line/bar panes leave this undefined. */
  legendVisualOrder?: string[];
}

export interface FigureRenderResult {
  mode: "shared" | "per-pane";
  /** Always undefined now — both modes are per-pane compositions (no combined SVG). Retained
   *  for API/back-compat with callers that still check `combinedSvg in result`. */
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
 * Both modes: partition + order panes → grid layout → render N independent single-frame panes.
 * Shared mode (default) additionally probe-renders over all in-scope rows for ONE shared
 * y-domain, then forces it on every pane and hides the y-tick labels on non-leftmost columns.
 */
export function renderFigure(
  spec: ChartSpec,
  rows: TidyRow[],
  opts: RenderOptions = {},
): FigureRenderResult {
  const sm = spec.small_multiples;
  if (!sm) throw new Error("renderFigure called without spec.small_multiples.");
  const mode = sm.mode ?? "shared";

  // SHARED mode is line-only (B8): shared faceting uses Plot `fx` for the grid columns, but
  // grouped bars also use `fx` for their series grouping (collision), and faceted bar chrome
  // is a larger effort — deferred. PER-PANE mode renders each pane as an independent single
  // frame (the grid is CSS-composed), so all bar types work like a normal per-pane chart with
  // no faceting collision; the guard below is scoped to the shared branch.
  if (mode === "shared" && spec.chartType !== "line") {
    throw new Error(
      "shared-mode small multiples support line charts only; use mode: per-pane for bar/stacked",
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
    // Keep the first pane's full PaneResult so the figure-level legend reads its real mark
    // layers (rect swatches for bar/stacked, the diverging-stack "Total" extra, mono/categorical
    // seriesColors). Line panes carry a dashedNames-only layer, so this is a no-op for them.
    let firstLayers: MarkLayers | undefined;
    const panes: FigurePane[] = paneValues.map((value, i) => {
      // Restrict the rows to this pane (own y-domain/units/x-domain). No facetInfo → renderPane
      // renders a standalone single frame for these rows only.
      const paneRows = rows.filter((r) => (r[facetField] as string) === value);
      const p = renderPane(spec, paneRows, { ...opts, pane: true }, `p${i}`);
      if (i === 0) firstLayers = p.layers;
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
        showTotalDot: p.layers.showTotalDot,
        legendVisualOrder: p.layers.legendVisualOrder,
      };
    });

    // Figure-level legend: series config is shared across panes, so compute it ONCE from the
    // first pane's series/colors + its mark layers (same source of truth as a single chart).
    const first = panes[0];
    const legendItems = buildLegendItems(
      spec,
      first?.seriesOrder ?? [],
      first?.colors ?? new Map(),
      firstLayers ?? { underlay: [], overlay: [], tagging: [], dashedNames: new Set() },
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
      legendVisualOrder: firstLayers?.legendVisualOrder,
      showTotalDot: firstLayers?.showTotalDot,
    };
  }

  // SHARED mode: the SAME per-pane composition as above (N independent mini-SVGs in the grid,
  // each its own frame with its own crosshair / dimming / selection), with TWO differences:
  //   1. ALL panes use ONE shared y-domain, computed once over ALL in-scope rows.
  //   2. y-axis tick LABELS show only on the leftmost column (col 0); panes with col > 0 keep
  //      their gridlines + plot area + left margin but hide the tick label text (so panes stay
  //      aligned and the same width).
  // (The old Plot-faceting path — one combined SVG, collapseFacetGridChrome, facet-aware
  // crosshair — is retired; combinedSvg is now undefined for shared mode too.)

  // 1. Shared y-domain: probe-render over ALL in-scope rows and read the computed domain. This
  //    reuses renderPane's full auto/hard/bar resolution, so the shared domain is exactly what a
  //    single chart over all rows would use. The probe SVG is discarded.
  const probe = renderPane(spec, rows, { ...opts, pane: true }, "probe");
  const sharedYDomain = probe.yDomain;

  // 2. Render each pane as its own single frame, forcing the shared y-domain and hiding the
  //    y-tick labels on every non-leftmost column. Identical to per-pane mode otherwise.
  let firstLayers: MarkLayers | undefined;
  const panes: FigurePane[] = paneValues.map((value, i) => {
    const col = i % columns;
    const paneRows = rows.filter((r) => (r[facetField] as string) === value);
    const p = renderPane(
      spec,
      paneRows,
      { ...opts, pane: true, yDomain: sharedYDomain, hideYAxisLabels: col > 0 },
      `p${i}`,
    );
    if (i === 0) firstLayers = p.layers;
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
      showTotalDot: p.layers.showTotalDot,
      legendVisualOrder: p.layers.legendVisualOrder,
    };
  });

  // 3. Figure-level legend: series config is shared across panes, so compute it ONCE from the
  //    first pane (same source of truth as a single chart). L1/single-series → null.
  const first = panes[0];
  const legendItems = buildLegendItems(
    spec,
    first?.seriesOrder ?? [],
    first?.colors ?? new Map(),
    firstLayers ?? { underlay: [], overlay: [], tagging: [], dashedNames: new Set() },
  );

  return {
    mode: "shared",
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
    legendVisualOrder: firstLayers?.legendVisualOrder,
    showTotalDot: firstLayers?.showTotalDot,
  };
}
