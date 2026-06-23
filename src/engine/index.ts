// Pure chart engine entry point: a validated spec + normalized tidy rows → an SVG plus
// the metadata the live layer (legend, crosshair) needs. Headless-safe — no Date.now /
// Math.random / locale formatting in the render path; interaction lives elsewhere.
//
// This is the tracker's buildLineChart, generalized: data prep + axis computation are
// chart-type agnostic here; the type-specific marks come from the marks/ registry, and
// the Plot is composed by assemblePlot.
import type { ChartSpec } from "../spec/types";
import type { TidyRow } from "../data/index";
import { tblColorScale, resolveColor } from "./palette";
import { computeYAxis, computeBarYExtent } from "./scales";
import { makeXAdapter } from "./x-adapter";
import { markBuilderFor } from "./marks/index";
import type { PreparedRow, MarkLayers } from "./marks/index";
import { assemblePlot } from "./assemble-plot";
import { TBL_MARGIN_LEFT, TBL_MARGIN_RIGHT, TBL_MARGIN_TOP } from "./theme";
import { inferUnitsFromSubtitle } from "./util";

export { TOTAL_SERIES_KEY } from "./series-keys";

export interface RenderOptions {
  width?: number;
  height?: number;
  marginRight?: number;
  /** Headless rendering: the document Plot should build into (jsdom in tests/SSR). */
  document?: Document;
  /** Small-multiples: this pane is one cell of a figure, so line marks render with the
   *  thinner pane stroke (TBL.strokeWidth.pane). Set by renderFigure for BOTH shared- and
   *  per-pane panes; absent → single chart → default stroke. Threaded into MarkContext.pane. */
  pane?: boolean;
  /** Small-multiples: override the figure's grid column count (else spec.small_multiples.columns
   *  or the ≈ceil(sqrt(n)) default). The live layer passes this for responsive col reflow. */
  columns?: number;
  /** Shared-mode small multiples: force this hard y-domain (computed once over ALL in-scope
   *  rows by the orchestrator) instead of the per-pane/auto domain. Fed to computeYAxis as the
   *  domain so every pane shares one scale; overrides the line auto-domain AND the bar extent.
   *  Ticks are computed against it. Absent → per-pane/auto domain (unchanged). */
  yDomain?: [number, number];
  /** Shared-mode small multiples, non-leftmost columns: keep the y gridlines but drop the
   *  y-tick LABEL text marks (so only the left column shows values; left margin stays for
   *  alignment). Threaded to assemblePlot. Absent → labels emitted (unchanged). */
  hideYAxisLabels?: boolean;
  /** Shared-mode small multiples: override the plot's LEFT margin (default TBL_MARGIN_LEFT).
   *  Threaded to assemblePlot's tblPlotDefaults marginLeft AND the gridline insetLeft / y-label
   *  dx so gridlines + (when shown) labels use the same margin. The leftmost (labeled) pane
   *  keeps TBL_MARGIN_LEFT; the label-less columns pass a small margin so they don't reserve the
   *  ~44px label gutter. Absent → TBL_MARGIN_LEFT (single-chart + per-pane byte-identical). */
  marginLeft?: number;
  /** SHARED-mode small multiples (figure orchestrator only): the TOTAL inner width the row of
   *  panes spans. renderFigure uses it (with `gridGap`) to compute the per-column OUTER widths
   *  via the shared width helper so the inner DATA width is identical across a row. Absent →
   *  `opts.width` is treated as the total grid width. Ignored outside the shared branch. */
  gridWidth?: number;
  /** SHARED-mode small multiples: the inter-column gap (px) used by the per-column width math.
   *  Must match the live grid's column-gap. Absent → 0. */
  gridGap?: number;
}

export interface LegendItem {
  series: string;
  label: string;
  color: string | undefined;
  dashed: boolean;
  markerShape: "line" | "rect" | "dot";
  /** True for synthetic rows (e.g. Total) that are not interactive series. */
  nonInteractive?: boolean;
  /** True for appended pseudo-series rows (e.g. the diverging Total) that are interactive
   *  but should sort AFTER the real series in the right-legend column. */
  isExtra?: boolean;
}

export interface RenderResult {
  svg: SVGSVGElement;
  /** Legend rows (null for a single, unstyled series — no legend needed). */
  legendItems: LegendItem[] | null;
  seriesLabels: Record<string, string>;
  seriesOrder: string[];
  dashedNames: Set<string>;
  colors: Map<string, string>;
  units: string;
  xAxisTitle: string | null;
  /** Rows actually rendered (series-filtered), for the crosshair. */
  dataInScope: PreparedRow[];
  tooltipXParse?: (v: string) => number;
  tooltipXFormat?: (v: number) => string;
  /** Visual top-to-bottom stack order of the interactive series, for the RIGHT legend
   *  (stacked charts only). render-live uses it to order the vertical legend column. */
  legendVisualOrder?: string[];
  /** Net-dot mode for the band crosshair's Total row (stacked charts only).
   *  Mirrors MarkLayers.showTotalDot — see that field for the tri-state semantics. */
  showTotalDot?: boolean;
}

function uniqueSeries(rows: PreparedRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) if (!seen.has(r.series)) { seen.add(r.series); out.push(r.series); }
  return out;
}

function buildColorMap(
  seriesNames: string[],
  seriesColorsCfg?: Record<string, string>,
): Map<string, string> {
  const palette = tblColorScale(seriesNames.length);
  const m = new Map<string, string>();
  seriesNames.forEach((s, i) => {
    const override = resolveColor(seriesColorsCfg?.[s]);
    m.set(s, override || (palette[i] as string));
  });
  return m;
}

/** Single rendered pane (frame): the SVG plus everything `renderChart`'s legend-decision
 *  block and `RenderResult` need. The Phase B figure orchestrator renders N of these (each
 *  with a distinct `classNameSuffix`) and composes them. */
export interface PaneResult {
  svg: SVGSVGElement;
  /** Series order (also the filter when spec.series_order is set). */
  seriesNames: string[];
  colors: Map<string, string>;
  units: string;
  /** The y-domain this pane was rendered against (after the auto/hard/bar-extent resolution,
   *  or the forced opts.yDomain). The shared-mode orchestrator probe-renders over all rows and
   *  reads this to obtain the one shared domain. */
  yDomain: [number, number];
  dataInScope: PreparedRow[];
  /** The chart-type-specific mark layers — legend decision reads dashedNames /
   *  seriesColors / legendExtras / legendVisualOrder / showTotalDot off this. */
  layers: MarkLayers;
  tooltipXParse?: (v: string) => number;
  tooltipXFormat?: (v: number) => string;
}

/** DORMANT (Plot grid-faceting): the old SHARED-mode combined-SVG path passed this into
 *  renderPane to drive Plot's fx/fy facet grid. Shared mode is now a per-pane composition
 *  (figure.ts), so renderFigure no longer constructs a FacetInfo. The faceting machinery
 *  (this type, assemblePlot's `facet` option, collapseFacetGridChrome, paneTitleMark,
 *  attachFacetCrosshair, the facet-regions golden) is left in place + still unit-tested via the
 *  assemblePlot facet path, but is unused by the live shared figure. Candidate for a later
 *  cleanup round. NOTE: the bar/stacked fx-grouped + fy-horizontal chrome (collapseFacetChrome /
 *  collapseFacetChromeY) is a DIFFERENT, still-live path — do not remove that.
 *
 *  SHARED-mode faceting passed into renderPane: the value→(col,row) grid assignment the
 *  orchestrator computed, plus the grid dimensions + per-cell pane titles. When present,
 *  renderPane tags each row with its grid-index fields, drops out-of-scope facet values,
 *  drives the markBuilder + x-adapter in faceted mode, and passes `facet` to assemblePlot —
 *  producing ONE faceted SVG whose y-domain is shared across every in-scope pane. */
export interface FacetInfo {
  facetField: string;
  /** facet value → grid cell. Out-of-scope values (not a key) drop the row. */
  cellFor: Map<string, { col: number; row: number; title: string }>;
  columns: number;
  rows: number;
}

/** Render the single-frame pipeline: parse rows → series order/colors → y-axis (incl. the
 *  bar y-extent pre-pass) → x-adapter/xOpts → markBuilder → assemblePlot. No legend or
 *  RenderResult assembly — that stays in renderChart. `classNameSuffix` is threaded into
 *  assemblePlot for unique-but-deterministic clip-path ids per pane (absent → "tblchart").
 *  When `facetInfo` is supplied (shared-mode small multiples), every parsed row is tagged with
 *  its grid indices, the markBuilder binds fx/fy, and the result is ONE faceted SVG. */
export function renderPane(
  spec: ChartSpec,
  rows: TidyRow[],
  opts: RenderOptions = {},
  classNameSuffix?: string,
  facetInfo?: FacetInfo,
): PaneResult {
  const xType = spec.xAxisType;
  if (!xType) throw new Error("No xAxisType.");

  const adapter = makeXAdapter(xType, spec.xAxisPolicy);
  const seriesField = spec.series_field || "series";

  // Parse + validate rows into the engine's in-memory shape.
  const data: PreparedRow[] = rows
    .map((r) => {
      const row = {
        series: r[seriesField] as string,
        time: r.time,
        _y: r.value === "" ? null : +r.value,
      } as PreparedRow;
      (row as unknown as Record<string, unknown>)[adapter.xField] = adapter.parseX(r.time);
      for (const band of spec.confidence_bands ?? []) {
        if (r[seriesField] === band.series) {
          const lo = r[band.lower];
          const hi = r[band.upper];
          row._lo = lo !== "" && lo != null ? +lo : undefined;
          row._hi = hi !== "" && hi != null ? +hi : undefined;
        }
      }
      // Shared-mode small multiples: tag the row with its pane's facet value + grid indices.
      // Rows whose facet value isn't in the ordered pane set are dropped below.
      if (facetInfo) {
        const fval = r[facetInfo.facetField] as string;
        const cell = facetInfo.cellFor.get(fval);
        if (cell) {
          row._facet = fval;
          row._fxCol = String(cell.col);
          row._fyRow = String(cell.row);
        }
      }
      return row;
    })
    .filter((r) => adapter.validate(r as unknown as Record<string, unknown>))
    // Drop rows outside the in-scope pane set (consistent with pane_order filtering).
    .filter((r) => !facetInfo || r._facet != null);

  if (!data.length) throw new Error("No data.");

  // Series order + colors. When series_order is set it acts as both filter and order.
  const seriesNames =
    spec.series_order && spec.series_order.length
      ? spec.series_order.filter((s) => data.some((r) => r.series === s))
      : uniqueSeries(data);
  const seriesSet = new Set(seriesNames);
  const dataInScope = data.filter((r) => seriesSet.has(r.series));
  const colors = buildColorMap(seriesNames, spec.series_colors);

  // Y-axis: fold CI band bounds into the computed range when present.
  const yForAxis: Array<number | null | undefined> = [
    ...dataInScope.map((d) => d._y),
    ...dataInScope.map((d) => d._lo).filter(Number.isFinite),
    ...dataInScope.map((d) => d._hi).filter(Number.isFinite),
  ];
  const policy = spec.yAxisPolicy ?? {};
  const tickCount = policy.tickCount ?? 5;
  const chartType = spec.chartType;

  let hardDomain: [number, number] | null;
  let includeZero: boolean;

  if (chartType === "bar" || chartType === "stacked") {
    // Bar/stacked: mandatory zero baseline; axis extent derived from stacked totals +
    // value-label headroom. Author-supplied yAxisPolicy.min / .max still win (override
    // the computed bar extent), but we force includeZero so nice() never drops zero.
    includeZero = true;
    const barExtent = computeBarYExtent(dataInScope, spec, chartType);
    const resolvedMin = policy.min ?? barExtent.min;
    const resolvedMax = policy.max ?? barExtent.max;
    hardDomain = [resolvedMin, resolvedMax];
  } else {
    // Line (and future non-bar types): unchanged behavior.
    includeZero = policy.includeZero === true;
    let yMax = policy.max;
    if (policy.autoWiden && yMax != null) {
      const dataMax = Math.max(...(yForAxis.filter(Number.isFinite) as number[]));
      if (dataMax > yMax) {
        const step = policy.autoWiden.step || 1;
        yMax = Math.ceil(dataMax / step) * step;
      }
    }
    hardDomain = policy.min != null && yMax != null ? [policy.min, yMax] : null;
  }

  // Shared-mode small multiples: opts.yDomain is the ONE domain the orchestrator computed over
  // all in-scope rows. It overrides both the line auto-domain and the bar extent so every pane
  // shares one scale; ticks are computed against it.
  const { domain: yDomain, ticks: yTicks } = computeYAxis(yForAxis, {
    includeZero,
    domain: opts.yDomain ?? hardDomain,
    tickCount,
  });

  // Faceted (shared mode): tag x-axis label marks so the grid chrome collapse keeps only the
  // bottom-row copies. Non-faceted → default false → byte-identical single-chart output.
  const xOpts = adapter.buildXOpts(dataInScope, facetInfo != null);
  const units = inferUnitsFromSubtitle(spec.subtitle);

  // Approximate inner plot dimensions for bar-builder label-suppression logic.
  // Approximation: uses TBL_MARGIN_TOP (matches tblPlotDefaults default) and the adapter's
  // marginBottom; bar builders should treat these as rough guidance, not pixel-perfect.
  const effWidth = opts.width ?? 720;
  const effHeight = opts.height ?? 320;
  const plotWidth = effWidth - TBL_MARGIN_LEFT - TBL_MARGIN_RIGHT;
  const plotHeight = effHeight - TBL_MARGIN_TOP - xOpts.marginBottom;

  // Chart-type-specific marks, then assemble the Plot.
  const layers = markBuilderFor(spec.chartType)(dataInScope, spec, {
    xField: adapter.xField,
    colors,
    seriesNames,
    plotWidth,
    plotHeight,
    // Shared-mode small multiples: pass the facet field names so the mark builder binds
    // fx/fy on its marks (they face into the grid). Absent → single frame.
    ...(facetInfo ? { fxField: "_fxCol", fyField: "_fyRow" } : {}),
    // Pane stroke flag: thins line marks for figure panes (both modes). renderFigure sets it.
    ...(opts.pane ? { pane: true } : {}),
  });

  // Shared-mode small multiples: build the per-cell pane-title list from the grid assignment.
  const facetOpt = facetInfo
    ? {
        columns: facetInfo.columns,
        rows: facetInfo.rows,
        cells: Array.from(facetInfo.cellFor.values()).map((c) => ({
          col: c.col,
          row: c.row,
          title: c.title,
        })),
      }
    : undefined;

  const svg = assemblePlot({
    layers,
    yDomain,
    yTicks,
    units,
    xOpts,
    seriesNames,
    colors,
    spec,
    width: opts.width,
    height: opts.height,
    marginRight: opts.marginRight,
    document: opts.document,
    classNameSuffix,
    ...(facetOpt ? { facet: facetOpt } : {}),
    ...(opts.hideYAxisLabels ? { hideYAxisLabels: true } : {}),
    ...(opts.marginLeft != null ? { marginLeft: opts.marginLeft } : {}),
  });

  return {
    svg,
    seriesNames,
    colors,
    units,
    yDomain,
    dataInScope,
    layers,
    tooltipXParse: xOpts.tooltipXParse,
    tooltipXFormat: xOpts.tooltipXFormat,
  };
}

/** Build the legend rows from a spec + a rendered pane's series order / colors / mark layers.
 *  Shared by renderChart (single frame) and renderFigure (figure-level legend), so both decide
 *  legend presence and ordering identically. Returns null for a single, unstyled series. */
export function buildLegendItems(
  spec: ChartSpec,
  seriesNames: string[],
  colors: Map<string, string>,
  layers: MarkLayers,
): LegendItem[] | null {
  const chartType = spec.chartType;
  const seriesLabels = spec.series_labels ?? {};
  const labelFor = (name: string): string => seriesLabels[name] ?? name;
  const hasDashOverrides = layers.dashedNames.size > 0;
  const markerShape: "line" | "rect" =
    chartType === "bar" || chartType === "stacked" ? "rect" : "line";
  // When the mark layer is the source of truth for series colors (stacked: mono tiers or
  // categorical), use those for the legend swatches so the legend matches the bars.
  const legendColorFor = (name: string): string | undefined =>
    layers.seriesColors?.get(name) ?? colors.get(name);
  const baseItems: LegendItem[] | null =
    seriesNames.length > 1 || hasDashOverrides
      ? seriesNames.map((name) => ({
          series: name,
          label: labelFor(name),
          color: legendColorFor(name),
          dashed: spec.series_styles?.[name]?.dashed === true,
          markerShape,
        }))
      : null;
  // Append legendExtras (e.g. diverging stacked Total row) after the series rows.
  let legendItems: LegendItem[] | null = baseItems;
  if (layers.legendExtras && layers.legendExtras.length > 0) {
    // The Total pseudo-series is INTERACTIVE: its `series` is the shared TOTAL_SERIES_KEY,
    // matching the net dot/label `data-series`, so the legend row and the chart markers
    // pin/hover/dim as one. `isExtra` keeps it sorted after the real series in the right
    // legend without making it non-interactive.
    const extras: LegendItem[] = layers.legendExtras.map((extra) => ({
      series: extra.series,
      label: extra.label,
      color: undefined,
      dashed: false,
      markerShape: extra.markerShape,
      isExtra: true,
    }));
    // Append the extras (e.g. the diverging "Total" dot row). If there were no series rows
    // (a single-series chart with no style override), the extras alone form the legend, so
    // the Total marker is never silently dropped.
    legendItems = legendItems ? [...legendItems, ...extras] : extras;
  }
  return legendItems;
}

export function renderChart(
  spec: ChartSpec,
  rows: TidyRow[],
  opts: RenderOptions = {},
): RenderResult {
  const pane = renderPane(spec, rows, opts);
  const { svg, seriesNames, colors, units, dataInScope, layers } = pane;

  const seriesLabels = spec.series_labels ?? {};
  const legendItems = buildLegendItems(spec, seriesNames, colors, layers);

  return {
    svg,
    legendItems,
    seriesLabels,
    seriesOrder: seriesNames,
    dashedNames: layers.dashedNames,
    colors,
    units,
    xAxisTitle: spec.x_axis_title ?? null,
    dataInScope,
    tooltipXParse: pane.tooltipXParse,
    tooltipXFormat: pane.tooltipXFormat,
    legendVisualOrder: layers.legendVisualOrder,
    showTotalDot: layers.showTotalDot,
  };
}

// Figure orchestrator (small multiples). Imported here for the `render` dispatcher; figure.ts
// imports renderPane/buildLegendItems back from this module (ES-module cycle is safe — both
// references resolve at call time, not at module evaluation).
import { renderFigure } from "./figure";
import type { FigureRenderResult } from "./figure";
export { renderFigure } from "./figure";
export type { FigureRenderResult, FigurePane } from "./figure";

/** Top-level dispatcher: a `small_multiples` spec renders a multi-panel figure (renderFigure),
 *  everything else renders a single chart (renderChart). render-live/export switch to this in
 *  B6/B7; for now both renderChart and renderFigure stay exported and callable directly. */
export function render(
  spec: ChartSpec,
  rows: TidyRow[],
  opts: RenderOptions = {},
): RenderResult | FigureRenderResult {
  return spec.small_multiples ? renderFigure(spec, rows, opts) : renderChart(spec, rows, opts);
}
