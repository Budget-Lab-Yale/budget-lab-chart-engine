// Figure-level orchestrator for small-multiples specs. Turns a spec carrying
// `small_multiples` into a multi-panel figure of N independent mini-SVGs laid out on a
// (col,row) grid. BOTH modes use the SAME per-pane composition (each pane is its own single
// frame with its own crosshair / dimming / selection). They differ only in the y-scale:
//   - per-pane: each pane computes its own y-domain (and shows its own y-tick labels).
//   - shared:   ALL panes use ONE y-domain (the union of the per-pane domains), and y-tick
//               LABELS show only on the leftmost column (col>0 panes hide them; gridlines +
//               plot area + left margin stay so panes remain aligned).
// BOTH modes support line/bar/stacked (each pane is an independent single frame, so grouped
// bars' own `fx` faceting never collides with the grid — the grid is CSS-composed).
import type { ChartSpec } from "../spec/types";
import { resolveColumns } from "../spec/columns";
import type { TidyRow } from "../data/index";
import type { PreparedRow, MarkLayers } from "./marks/index";
import { renderPane, buildLegendItems, buildShapeLegendItems } from "./index";
import type { LegendItem, ShapeLegendItem, RenderOptions } from "./index";
import { inferUnitsFromSubtitle } from "./util";
import { TBL_MARGIN_LEFT, TBL_MARGIN_RIGHT } from "./theme";

/** Default grid-column count for `n` panes: ≈ ceil(sqrt(n)), capped at 4. */
function defaultColumns(n: number): number {
  return Math.min(4, Math.max(1, Math.ceil(Math.sqrt(n))));
}

/** Label-less (non-leftmost) columns get a small left margin instead of the ~44px y-label
 *  gutter, so the series doesn't render with a big blank strip on its left. */
export const SHARED_LABELLESS_MARGIN_LEFT = 2;

/** SHARED-mode small-multiples per-row width math (the single source of truth, reused by the
 *  live grid and the PNG export). Given the TOTAL inner grid width `availW` (the width the row
 *  of panes spans, minus inter-column gaps already accounted for by the caller), the column
 *  count and the inter-column gap, compute:
 *   - `dataW`: the inner DATA/plot width, IDENTICAL for every column (so the series renders at
 *     the same apparent width in every pane);
 *   - `colWidths[c]`: each column's OUTER width — the leftmost (labeled) column is wider (it
 *     carries the full TBL_MARGIN_LEFT label gutter), the label-less columns are narrower (they
 *     only reserve SHARED_LABELLESS_MARGIN_LEFT);
 *   - `marginLeft[c]`: the per-column left margin (TBL_MARGIN_LEFT for col 0, the small margin
 *     otherwise) to thread into renderPane.
 *
 *  Width identity (per the brief):
 *    dataW    = (availW − LM − (C−1)·lm − C·R − (C−1)·G) / C
 *    colW[0]  = dataW + LM + R
 *    colW[c>0]= dataW + lm + R
 *  For C=1 there is no label-less column, so dataW = availW − LM − R.
 *  The colWidths sum to availW − (C−1)·G (i.e. they tile the row exactly, leaving the gaps). */
export function sharedColumnWidths(
  availW: number,
  columns: number,
  gap: number,
): { dataW: number; colWidths: number[]; marginLeft: number[] } {
  const LM = TBL_MARGIN_LEFT;
  const lm = SHARED_LABELLESS_MARGIN_LEFT;
  const R = TBL_MARGIN_RIGHT;
  const C = Math.max(1, columns);
  const dataW =
    C === 1
      ? availW - LM - R
      : (availW - LM - (C - 1) * lm - C * R - (C - 1) * gap) / C;
  const colWidths: number[] = [];
  const marginLeft: number[] = [];
  for (let c = 0; c < C; c++) {
    const isLeft = c === 0;
    marginLeft.push(isLeft ? LM : lm);
    colWidths.push(dataW + (isLeft ? LM : lm) + R);
  }
  return { dataW, colWidths, marginLeft };
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
  /** SHARED mode only: the per-column OUTER pixel widths (length === `columns`) the panes were
   *  rendered at — col 0 wider (labeled), col>0 narrower (label-less), all sharing one inner data
   *  width. The live grid sets `grid-template-columns` to these px widths and the PNG export lays
   *  the panes out the same way. Undefined for per-pane mode (equal `1fr` columns). */
  columnWidths?: number[];
  legendItems: LegendItem[] | null;
  /** Point-chart figures with dual color/shape encoding: the SHAPE legend rows (else null). */
  shapeLegendItems?: ShapeLegendItem[] | null;
  colorLegendTitle?: string;
  shapeLegendTitle?: string;
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

  const facetField = resolveColumns(spec, rows).facet;
  if (!facetField) {
    throw new Error("small_multiples requires a facet column (set columns.facet).");
  }

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
      shapeLegendItems: buildShapeLegendItems(spec, firstLayers ?? { underlay: [], overlay: [], tagging: [], dashedNames: new Set() }),
      colorLegendTitle: spec.color_legend_title,
      shapeLegendTitle: spec.shape_legend_title,
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

  // 1. Shared y-domain: probe EACH pane independently and UNION the per-pane domains. A single
  //    combined probe over all in-scope rows would, for STACKED bars, sum same-category rows
  //    ACROSS panes (panes share the x-categories) and inflate the scale. Probing per pane and
  //    unioning is correct for every chart type, and — because computeYAxis's nice-rounding is
  //    monotonic — yields exactly the combined-probe domain for line/single-series/grouped bars,
  //    so those stay unchanged. Each per-pane probe already applies the bar zero-baseline +
  //    value-label headroom, so the union endpoints carry it. Probe SVGs are discarded.
  let yLo = Infinity;
  let yHi = -Infinity;
  for (const value of paneValues) {
    const paneRows = rows.filter((r) => (r[facetField] as string) === value);
    const [lo, hi] = renderPane(spec, paneRows, { ...opts, pane: true }, "probe").yDomain;
    if (lo < yLo) yLo = lo;
    if (hi > yHi) yHi = hi;
  }
  const sharedYDomain: [number, number] = [yLo, yHi];

  // 2. Per-row width math (single source: sharedColumnWidths). The label-less (non-leftmost)
  //    columns drop the ~44px label gutter for a small left margin; column OUTER widths are made
  //    unequal so the inner DATA width is IDENTICAL across a row (labeled col 0 wider, label-less
  //    cols narrower). The TOTAL inner grid width is `opts.gridWidth` (live grid) else `opts.width`
  //    (e.g. golden tests pass a single width as the row total); the gap matches the live grid.
  const gridGap = opts.gridGap ?? 0;
  const availW = opts.gridWidth ?? opts.width ?? 720;
  const { colWidths, marginLeft: colMarginLeft } = sharedColumnWidths(availW, columns, gridGap);

  // 3. Render each pane as its own single frame at its column's OUTER width + left margin,
  //    forcing the shared y-domain and hiding the y-tick labels on every non-leftmost column.
  let firstLayers: MarkLayers | undefined;
  const panes: FigurePane[] = paneValues.map((value, i) => {
    const col = i % columns;
    const paneRows = rows.filter((r) => (r[facetField] as string) === value);
    const p = renderPane(
      spec,
      paneRows,
      {
        ...opts,
        pane: true,
        yDomain: sharedYDomain,
        hideYAxisLabels: col > 0,
        width: colWidths[col],
        marginLeft: colMarginLeft[col],
      },
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

  // 4. Figure-level legend: series config is shared across panes, so compute it ONCE from the
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
    columnWidths: colWidths,
    legendItems,
    shapeLegendItems: buildShapeLegendItems(spec, firstLayers ?? { underlay: [], overlay: [], tagging: [], dashedNames: new Set() }),
    colorLegendTitle: spec.color_legend_title,
    shapeLegendTitle: spec.shape_legend_title,
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
