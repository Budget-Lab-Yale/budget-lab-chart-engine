// Pure chart engine entry point: a validated spec + normalized tidy rows → an SVG plus
// the metadata the live layer (legend, crosshair) needs. Headless-safe — no Date.now /
// Math.random / locale formatting in the render path; interaction lives elsewhere.
//
// This is the tracker's buildLineChart, generalized: data prep + axis computation are
// chart-type agnostic here; the type-specific marks come from the marks/ registry, and
// the Plot is composed by assemblePlot.
import type { ChartSpec } from "../spec/types";
import { resolveColumns, SINGLE_SERIES_KEY } from "../spec/columns";
import { resolveAnnotations } from "../spec/annotations";
import type { TidyRow } from "../data/index";
import { tblColorScale, resolveColor } from "./palette";
import { computeYAxis, computeBarYExtent } from "./scales";
import { bandLabelMode } from "./axes";
import type { BandLabelMode } from "./axes";
import { makeXAdapter } from "./x-adapter";
import { markBuilderFor } from "./marks/index";
import type { PreparedRow, MarkLayers } from "./marks/index";
import { assemblePlot } from "./assemble-plot";
import { TBL_MARGIN_LEFT, TBL_MARGIN_RIGHT, TBL_MARGIN_TOP, markerSymbolForIndex } from "./theme";
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
  /** Area charts: visual stack order bottom→top (overrides series_order for stacking only —
   *  legend order + colors stay series_order). The live layer passes a reordered list when series
   *  are selected (selected-to-bottom in click order) so a user can read a series against zero. */
  stackOrder?: string[];
  /** Shared-mode small multiples, horizontal bars, non-leftmost panes: omit the category labels
   *  (the horizontal analog of hideYAxisLabels, which only affects the vertical value axis).
   *  Threaded into MarkContext.hideCategoryLabels. Absent → labels emitted. */
  hideCategoryLabels?: boolean;
  /** Shared-mode small multiples, horizontal bars: the shared category-gutter width (px) every
   *  pane should use. Threaded into MarkContext.categoryGutter. Absent → builder computes its own. */
  categoryGutter?: number;
  /** Shared-mode small multiples (vertical bars): force the categorical x-axis label layout
   *  ("single"/"wrap"/"rotate") instead of deciding it per-pane. The figure computes the worst-case
   *  mode across all panes so every pane's labels look consistent. */
  xLabelMode?: BandLabelMode;
  /** Shared-mode small multiples (vertical bars): force the bottom margin (px) — the figure passes
   *  the MAX across panes so every pane reserves the same space and their baselines align. */
  marginBottom?: number;
}

export interface LegendItem {
  series: string;
  label: string;
  color: string | undefined;
  dashed: boolean;
  /** Swatch style: "line"/"rect"/"dot" for line/bar/stacked; "point" for scatter/dotplot — a
   *  filled colored marker (the `markerSymbol`, default circle); "chip" — a filled rounded-square
   *  color key (point charts' color-only legend, where a point shape would be ambiguous). */
  markerShape: "line" | "rect" | "dot" | "point" | "chip";
  /** Line charts with point markers, or point charts with redundant color+shape encoding: the
   *  d3 symbol name for this series (shown on the swatch so series can be told apart by shape,
   *  not just color). */
  markerSymbol?: string;
  /** True for synthetic rows (e.g. Total) that are not interactive series. */
  nonInteractive?: boolean;
  /** True for appended pseudo-series rows (e.g. the diverging Total) that are interactive
   *  but should sort AFTER the real series in the right-legend column. */
  isExtra?: boolean;
}

/** One row of the SHAPE legend (point charts, dual color/shape encoding): a neutral-colored
 *  marker symbol identifying a shape-channel value. Non-interactive in v1 (the shape legend
 *  does not drive hover-dim / pin). */
export interface ShapeLegendItem {
  /** The raw shape-value key. */
  shape: string;
  label: string;
  /** d3 symbol name (assigned by shape index, matching the chart's symbol scale). */
  markerSymbol: string;
}

export interface RenderResult {
  svg: SVGSVGElement;
  /** Legend rows (null for a single, unstyled series — no legend needed). For point charts this
   *  is the COLOR (series) legend; the shape legend (when distinct) is `shapeLegendItems`. */
  legendItems: LegendItem[] | null;
  /** Point charts with two-field encoding: the SHAPE legend rows (neutral markers). Null when
   *  shape encodes the same field as color (redundant → folded into `legendItems`) or absent. */
  shapeLegendItems?: ShapeLegendItem[] | null;
  /** Optional headings for the color/shape legend groups (point charts, dual encoding). */
  colorLegendTitle?: string;
  shapeLegendTitle?: string;
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
  const cols = resolveColumns(spec, rows);

  // Parse + validate rows into the engine's in-memory shape. Input columns are mapped onto the
  // engine's canonical fields (series / time / _y) via the resolved `columns` role map; a null
  // series column ⇒ a single implicit series.
  const data: PreparedRow[] = rows
    .map((r) => {
      const xRaw = r[cols.x] ?? "";
      const valRaw = r[cols.value];
      const row = {
        series: cols.series ? (r[cols.series] ?? "") : SINGLE_SERIES_KEY,
        time: xRaw,
        _y: valRaw === "" || valRaw == null ? null : +valRaw,
      } as PreparedRow;
      // Point charts: the independent shape-encoding value (drives marker symbol). When the shape
      // column IS the series column (redundant encoding) this simply mirrors `series`.
      if (cols.shape) row._shape = r[cols.shape] ?? "";
      if (cols.section) row._section = r[cols.section] ?? "";
      (row as unknown as Record<string, unknown>)[adapter.xField] = adapter.parseX(xRaw);
      for (const band of spec.confidence_bands ?? []) {
        if (row.series === band.series) {
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

  // Categorical x render order. Every downstream consumer (the band scale via adapter.buildXOpts,
  // the mark builders, the x-label collision check) reads the category order from dataInScope's
  // row order, so a single stable sort here fixes the order everywhere. Listed categories first in
  // x_order; unlisted ones keep their encounter order after (order-only — unlike series_order,
  // x_order does NOT filter). Stable sort preserves within-category row order. No-op off the
  // categorical axis.
  if (spec.xAxisType === "categorical" && spec.x_order && spec.x_order.length) {
    const rank = new Map(spec.x_order.map((c, i) => [c, i] as const));
    const last = spec.x_order.length;
    dataInScope.sort((a, b) => (rank.get(a._xc ?? "") ?? last) - (rank.get(b._xc ?? "") ?? last));
  }

  // Y-axis: fold CI band bounds into the computed range when present, plus any horizontal
  // reference-line (yAxisPolicy.markers) values so a marker at/beyond the data extent gets a
  // little headroom instead of sitting flush against the axis edge.
  const ann = resolveAnnotations(spec);

  // Point callouts: resolve a y for any callout that gives a `series` but omits `y` — snap to that
  // series' value at x. For a stacked chart (area/stacked) that's the cumulative TOP of the series'
  // band; otherwise the series' own value. Rows are matched at x by the raw time / numeric key.
  const stackedChart = spec.chartType === "area" || spec.chartType === "stacked";
  const seriesRank = new Map<string, number>(seriesNames.map((s, i) => [s, i]));
  const resolvedPoints = ann.points.map((p) => {
    if (Number.isFinite(p.y as number) || !p.series) return p;
    const atX = dataInScope.filter((r) => r.time === p.x || String(r._xn ?? "") === p.x);
    const targetRank = seriesRank.get(p.series);
    if (targetRank == null) return p;
    let y: number | undefined;
    if (stackedChart) {
      let sum = 0;
      let found = false;
      for (const r of atX) {
        const rr = seriesRank.get(r.series);
        if (rr != null && rr <= targetRank && Number.isFinite(r._y as number)) {
          sum += r._y as number;
          found = true;
        }
      }
      if (found) y = sum;
    } else {
      const row = atX.find((r) => r.series === p.series);
      if (row && Number.isFinite(row._y as number)) y = row._y as number;
    }
    return y != null ? { ...p, y } : p;
  });

  // Y-axis: fold CI band bounds into the computed range when present, plus any horizontal
  // reference-line (yAxis markers) values + point-callout y values so an annotation at/beyond the
  // data extent gets a little headroom instead of sitting flush against the axis edge.
  const yForAxis: Array<number | null | undefined> = [
    ...dataInScope.map((d) => d._y),
    ...dataInScope.map((d) => d._lo).filter(Number.isFinite),
    ...dataInScope.map((d) => d._hi).filter(Number.isFinite),
    ...ann.yAxis.map((m) => m.y),
    ...resolvedPoints.map((p) => p.y).filter((v): v is number => Number.isFinite(v as number)),
  ];
  const policy = spec.yAxisPolicy ?? {};
  const tickCount = policy.tickCount ?? 5;
  const chartType = spec.chartType;

  let hardDomain: [number, number] | null;
  let includeZero: boolean;

  if (chartType === "bar" || chartType === "stacked") {
    // Bar/stacked: zero baseline by default (axis extent from stacked totals + value-label
    // headroom). An explicit yAxisPolicy.min OPTS OUT of the forced zero — a truncated bar axis
    // (use sparingly; e.g. a level series whose variation is small relative to its magnitude).
    // Reference-line (markers) values are folded into the extent so a marker stays visible.
    const markerYs = ann.yAxis.map((m) => m.y).filter(Number.isFinite);
    includeZero = policy.min == null;
    const barExtent = computeBarYExtent(dataInScope, spec, chartType);
    const resolvedMin = policy.min ?? Math.min(barExtent.min, ...markerYs);
    const resolvedMax = Math.max(policy.max ?? barExtent.max, ...markerYs);
    hardDomain = [resolvedMin, resolvedMax];
  } else if (chartType === "area") {
    // Stacked area: zero baseline; the axis extent comes from the per-x STACKED TOTAL (the
    // cumulative top), not individual series values. Annotation y values are folded in for headroom.
    includeZero = true;
    const markerYs = [
      ...ann.yAxis.map((m) => m.y),
      ...resolvedPoints.map((p) => p.y).filter((v): v is number => Number.isFinite(v as number)),
    ].filter(Number.isFinite);
    const totalByX = new Map<string, number>();
    let minVal = 0;
    for (const r of dataInScope) {
      if (!Number.isFinite(r._y as number)) continue;
      const k = r.time || String(r._xn ?? r._xc ?? "");
      totalByX.set(k, (totalByX.get(k) ?? 0) + (r._y as number));
      if ((r._y as number) < minVal) minVal = r._y as number;
    }
    const stackMax = totalByX.size ? Math.max(...totalByX.values()) : 0;
    const resolvedMin = policy.min ?? Math.min(0, minVal, ...markerYs);
    const resolvedMax = Math.max(policy.max ?? stackMax, ...markerYs);
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

  // Categorical x-axis: when horizontal labels would collide at this width, wrap multi-word
  // labels to two lines, or (if even wrapped labels overlap) rotate to 45°. Uses the DATA width
  // (outer width minus the ACTUAL margins) so the decision is identical across a shared figure's
  // panes (which share one data width). Non-categorical → no categories → "single".
  const catsForX =
    spec.xAxisType === "categorical"
      ? Array.from(new Set(dataInScope.map((r) => r._xc).filter((c): c is string => !!c)))
      : [];
  const dataWidthForX =
    (opts.width ?? 720) - (opts.marginLeft ?? TBL_MARGIN_LEFT) - (opts.marginRight ?? TBL_MARGIN_RIGHT);
  // A figure-forced mode (worst case across panes) wins, so every pane reserves the same bottom
  // margin and their baselines align; otherwise decide per-pane from this pane's width + categories.
  const xLabelMode = opts.xLabelMode ?? bandLabelMode(catsForX, dataWidthForX);

  // Faceted (shared mode): tag x-axis label marks so the grid chrome collapse keeps only the
  // bottom-row copies. Non-faceted → default false → byte-identical single-chart output.
  const xOpts = adapter.buildXOpts(dataInScope, facetInfo != null, xLabelMode);
  // Faceted vertical bars: the figure forces a shared bottom margin (the max across panes) so every
  // pane's baseline lines up regardless of its own label length. Flows to plotHeight + assemblePlot.
  if (opts.marginBottom != null) xOpts.marginBottom = opts.marginBottom;
  const units = inferUnitsFromSubtitle(spec.subtitle);

  // Approximate inner plot dimensions for bar-builder label-suppression logic.
  // Approximation: uses TBL_MARGIN_TOP (matches tblPlotDefaults default) and the adapter's
  // marginBottom; bar builders should treat these as rough guidance, not pixel-perfect.
  const effWidth = opts.width ?? 720;
  const effHeight = opts.height ?? 320;
  const plotWidth = effWidth - TBL_MARGIN_LEFT - TBL_MARGIN_RIGHT;
  const plotHeight = effHeight - TBL_MARGIN_TOP - xOpts.marginBottom;

  // Point charts: the shape-encoding channel. Distinct shape values in spec.shape_order (filter +
  // order) else data-encounter order; `shapeIsSeries` flags the redundant case (shape column ==
  // series column) so the symbol scale + legend collapse to a single combined group.
  const hasShape = cols.shape != null;
  const shapeNames = hasShape
    ? spec.shape_order && spec.shape_order.length
      ? spec.shape_order.filter((s) => dataInScope.some((r) => r._shape === s))
      : Array.from(
          new Set(dataInScope.map((r) => r._shape).filter((s): s is string => s != null && s !== "")),
        )
    : undefined;
  const shapeIsSeries = hasShape && cols.shape === cols.series;

  // Chart-type-specific marks, then assemble the Plot.
  const layers = markBuilderFor(spec.chartType)(dataInScope, spec, {
    xField: adapter.xField,
    colors,
    seriesNames,
    plotWidth,
    plotHeight,
    // Truncated bar axis (y-domain excludes 0): clip bars so they don't overflow below the plot.
    ...((chartType === "bar" || chartType === "stacked") && yDomain[0] > 0 ? { clipMarks: true } : {}),
    ...(hasShape ? { shapeField: "_shape", shapeNames, shapeIsSeries } : {}),
    // Shared-mode small multiples: pass the facet field names so the mark builder binds
    // fx/fy on its marks (they face into the grid). Absent → single frame.
    ...(facetInfo ? { fxField: "_fxCol", fyField: "_fyRow" } : {}),
    // Pane stroke flag: thins line marks for figure panes (both modes). renderFigure sets it.
    ...(opts.pane ? { pane: true } : {}),
    // Grouped bars label their categories on `fx`; pass the layout mode so those labels match
    // the single-band/line labels (the adapter handles the `x` band path).
    ...(xLabelMode !== "single" ? { xLabelMode } : {}),
    // Dynamic stack order (area): the live layer passes a reordered list when a series is selected
    // (selected-to-bottom); the mark stacks in this order while legend/colors stay series_order.
    ...(opts.stackOrder ? { stackOrder: opts.stackOrder } : {}),
    // Horizontal faceted bars: suppress category labels on non-leftmost panes; use the shared gutter.
    ...(opts.hideCategoryLabels ? { hideCategoryLabels: true } : {}),
    ...(opts.categoryGutter != null ? { categoryGutter: opts.categoryGutter } : {}),
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

  // Numeric extent of the parsed x values — lets assemblePlot estimate label px positions for
  // annotation-label collision avoidance (numeric/temporal axes only; categorical → undefined).
  const xExtentVals = dataInScope
    .map((r) =>
      adapter.xField === "_xd" ? r._xd?.getTime() : adapter.xField === "_xn" ? r._xn : undefined,
    )
    .filter((v): v is number => Number.isFinite(v as number));
  const xExtent: [number, number] | undefined = xExtentVals.length
    ? [Math.min(...xExtentVals), Math.max(...xExtentVals)]
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
    points: resolvedPoints,
    ...(xExtent ? { xExtent } : {}),
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
  if (spec.legend === false) return null;
  const chartType = spec.chartType;
  const seriesLabels = spec.series_labels ?? {};
  const labelFor = (name: string): string => seriesLabels[name] ?? name;
  const hasDashOverrides = layers.dashedNames.size > 0;
  // When the mark layer is the source of truth for series colors (stacked: mono tiers or
  // categorical), use those for the legend swatches so the legend matches the bars.
  const legendColorFor = (name: string): string | undefined =>
    layers.seriesColors?.get(name) ?? colors.get(name);

  // Point charts (scatter / dotplot): the COLOR (series) legend. Swatch is a filled colored
  // marker — the per-series symbol when shape encodes the same field (redundant → combined
  // legend), otherwise a plain circle (shape is carried by the separate shape legend). A single
  // color → no color legend (the shape legend, if any, stands alone).
  if (chartType === "scatter" || chartType === "dotplot") {
    if (seriesNames.length <= 1) return null;
    // A SEPARATE shape legend exists when shape is its own channel (distinct values, not the
    // series). In that case the color legend must NOT use a point shape (a circle/square here
    // would be ambiguous with the shape legend's symbols) — use a color chip (rounded square)
    // instead. Redundant encoding → the combined legend shows the actual colored marker shape;
    // no shape channel → the actual (circle) marker.
    const distinctShape = !!(layers.shapeNames && layers.shapeNames.length && !layers.shapeIsSeries);
    return seriesNames.map((name, i) => {
      const base = {
        series: name,
        label: labelFor(name),
        color: legendColorFor(name),
        dashed: false,
      };
      if (layers.shapeIsSeries) {
        return { ...base, markerShape: "point" as const, markerSymbol: markerSymbolForIndex(i) };
      }
      if (distinctShape) {
        return { ...base, markerShape: "chip" as const };
      }
      return { ...base, markerShape: "point" as const, markerSymbol: "circle" };
    });
  }

  const markerShape: "line" | "rect" =
    chartType === "bar" || chartType === "stacked" ? "rect" : "line";
  // Line charts with point markers: each series carries its marker shape so the legend swatch
  // shows the same symbol as the chart (assigned by series index, matching the symbol scale).
  const withSymbols = markerShape === "line" && spec.points === true;
  const baseItems: LegendItem[] | null =
    seriesNames.length > 1 || hasDashOverrides
      ? seriesNames.map((name, i) => ({
          series: name,
          label: labelFor(name),
          color: legendColorFor(name),
          dashed: spec.series_styles?.[name]?.dashed === true,
          markerShape,
          ...(withSymbols ? { markerSymbol: markerSymbolForIndex(i) } : {}),
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

/** Build the SHAPE legend rows for a point chart with DUAL encoding (shape ≠ color). Returns
 *  null when there is no shape channel, or when shape encodes the same field as color (the
 *  redundant case — those symbols are folded into the combined color legend by buildLegendItems).
 *  Symbols are assigned by shape index, matching the chart's symbol scale. */
export function buildShapeLegendItems(
  spec: ChartSpec,
  layers: MarkLayers,
): ShapeLegendItem[] | null {
  if (spec.legend === false) return null;
  if (!layers.shapeNames || layers.shapeNames.length === 0 || layers.shapeIsSeries) return null;
  const shapeLabels = spec.shape_labels ?? {};
  return layers.shapeNames.map((shape, i) => ({
    shape,
    label: shapeLabels[shape] ?? shape,
    markerSymbol: markerSymbolForIndex(i),
  }));
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
  const shapeLegendItems = buildShapeLegendItems(spec, layers);

  return {
    svg,
    legendItems,
    shapeLegendItems,
    colorLegendTitle: spec.color_legend_title,
    shapeLegendTitle: spec.shape_legend_title,
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
