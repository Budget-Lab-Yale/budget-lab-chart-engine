// The single-frame (pane) render pipeline: parse rows -> series order/colors -> y-axis -> x-adapter
// -> markBuilder -> assemblePlot. renderChart (index.ts) wraps one pane with its legend metadata;
// renderFigure (figure.ts) composes N of them. Below index.ts in the module graph, so figure.ts
// imports it directly rather than back through the entry point.
import type { ChartSpec, PointCallout, ValueAffixes } from "../spec/types";
import type { RenderHooks } from "../spec/hooks";
import { resolveColumns, isPreBinned, SINGLE_SERIES_KEY, categoryOrderFor } from "../spec/columns";
import type { ResolvedColumns } from "../spec/columns";
import { resolveAnnotations, filterAnnotationsByFacet } from "../spec/annotations";
import { ownValue } from "../spec/own-key";
import { sectionKeyer, categoryText, rowsInSectionOrder } from "../spec/section-key";
import { valueAxisIsX } from "../spec/dumbbell-orientation";
import type { TidyRow } from "../data/index";
import { buildColorMap } from "./color-map";
import {
  computeYAxis,
  niceDomain,
  computeBarYExtent,
  computeWaterfallYExtent,
  computeDumbbellValueExtent,
  computeDrawnValueExtent,
  resolveHardDomain,
  fittedExtent,
  stackedExtent,
  areaStackKey,
  domainBounds,
  makeTickFormatter,
} from "./scales";
import { bandLabelMode, temporalXTicks } from "./axes";
import type { BandLabelMode } from "./axes";
import { makeXAdapter, numericAxisDomain } from "./x-adapter";
import type { XAdapter, SharedXDomain } from "./x-adapter";
import { parseDate } from "../spec/parse-time";
import { binValues, computeThresholds, temporalThresholds, normalizeBinned } from "./histogram-bin";
import type { BinInput, BinnedRow } from "./histogram-bin";
import { markBuilderFor } from "./marks/index";
import type { PreparedRow, MarkLayers, MarkContext } from "./marks/index";
import { assemblePlot, withTickLabelHook, type ResolvedPointCallout } from "./assemble-plot";
import { TBL_MARGIN_LEFT, TBL_MARGIN_RIGHT, TBL_MARGIN_TOP } from "./theme";
import { resolveValueAffixes, isTruthyFlag, formatNumericX, normalizeSpec, minMax } from "./util";
import { type SeriesHatch } from "./hatch";
import { rugAllowance } from "../spec/rug";
import {
  resolveOverlays,
  overlayColumnValues,
  overlayDrawsInPane,
  overlayTooltipLines,
} from "./overlays";
import type { OverlayTooltipLine } from "./overlays";
import { buildOverlayMarks, buildOverlayLabelMarks } from "./marks/overlay";
import { netDotsDrawn } from "./marks/stacked";

export interface RenderOptions {
  width?: number;
  height?: number;
  /** `height` was chosen by the engine's own height model, not the host: a live mount or PNG export
   *  at auto height. A sectioned chart's gaps then stay the full sectionGapPx; only a host-supplied
   *  height too small for the rows shrinks them (axes.ts fittedSectionGapPx). Absent → a given
   *  `height` is the host's. */
  heightFromModel?: boolean;
  /** Treemap only: cap the treemap area's height at this instead of TM_GEOM.maxHeight (its height
   *  is otherwise its width's aspect height, at most 460px). Only a framed PNG export passes it, so
   *  the tiles and their labels are laid out in the region the frame reserved. Absent → the default
   *  cap, as live. */
  treemapMaxHeight?: number;
  marginRight?: number;
  /** Headless rendering: the document Plot should build into (jsdom in tests/SSR). */
  document?: Document;
  /** Programmatic render hooks (see spec/hooks.ts). Threaded to the builders; the export passes
   *  the SAME object, which is what makes a static hook's output identical in the download. */
  hooks?: RenderHooks;
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
  /** Small multiples (figure orchestrator only): the TOTAL inner width the row of panes spans.
   *  renderFigure uses it (with `gridGap`) to compute the per-column OUTER widths: in shared mode
   *  always (sharedColumnWidths), in per-pane mode only with a non-"equal" `pane_widths`
   *  (perPaneColumnWidths). Absent → `opts.width` is treated as the total grid width. */
  gridWidth?: number;
  /** Small multiples: the inter-column gap (px) used by the per-column width math (see gridWidth).
   *  Must match the live grid's column-gap. Absent → 0. */
  gridGap?: number;
  /** Area charts: visual stack order bottom→top (overrides series_order for stacking only —
   *  legend order + colors stay series_order). The live layer passes a reordered list when series
   *  are selected (selected-to-bottom in click order) so a user can read a series against zero. */
  stackOrder?: string[];
  /** Shared-mode small multiples (vertical bars): force the categorical x-axis label layout
   *  ("single"/"wrap"/"rotate") instead of deciding it per-pane. The figure computes the worst-case
   *  mode across all panes so every pane's labels look consistent. */
  xLabelMode?: BandLabelMode;
  /** Shared-mode small multiples (vertical bars): force the bottom margin (px) — the figure passes
   *  the MAX across panes so every pane reserves the same space and their baselines align. */
  marginBottom?: number;
  /** Small multiples: this pane's facet value, used to scope `annotations.xAxis`/`yAxis` markers
   *  that carry a `facet` key (see `filterAnnotationsByFacet`) — both the y-extent/x-extent
   *  folding below AND the drawn rule/label in assemblePlot read the filtered set. Absent (single
   *  chart, or a faceted chart's figure orchestrator omitting it) → every marker renders,
   *  unchanged from today. */
  paneFacetValue?: string;
  /** Small multiples on a continuous x-axis: the x range every pane shares, computed by the figure
   *  from per-pane probes. Absent → the axis fits this pane's own rows. */
  sharedX?: SharedXDomain;
  /** Small multiples on a date axis: the plot width every pane fits its ticks to — see
   *  `BuildXOptsOptions.tickWidth`. */
  xTickWidth?: number;
  /** Small multiples with `x_ticks: data`: every pane's x values together, so all panes draw the same
   *  ticks. Absent → this pane's own x values. */
  xTickValues?: number[];
  /** Inline title-selector color accent: an already-resolved
   *  CSS color (run through `palette.resolveColor` by the caller) applied as the sole series'
   *  color WHEN the chart resolves to exactly one series (after `series_order` filtering). A
   *  multi-series chart ignores this — its distinct palette/`series_colors` stay untouched, because
   *  one accent colour can only stand for one line. render-live.ts recomputes this from the active
   *  title-selector option on every selection change and re-renders; export-png.ts resolves it
   *  once from `selections` for a static export. Absent (the common case — no title_selectors, or
   *  a multi-series chart) ⇒ byte-identical to before this field existed. */
  accentColor?: string;
  /** Small multiples: the FIGURE's series order, resolved once over ALL panes' rows. A series takes
   *  its palette colour from its index HERE rather than from its index in this pane's own series
   *  list — otherwise a pane that lacks a series shifts every later series one slot down the palette
   *  and paints it a colour the figure legend contradicts (a pane missing the first of two series
   *  painted the second one blue while the legend said amber). Absent (single chart) → the pane's
   *  own list, unchanged. */
  paletteSeries?: string[];
  /** Small multiples, point charts with a SEPARATE shape channel: the FIGURE's shape list, resolved
   *  once over all panes' rows. A shape takes its marker symbol from its index here, as a series
   *  takes its colour from `paletteSeries`; the pane's own shape list still decides what it draws.
   *  Absent (single chart) → the pane's own list, unchanged. */
  paletteShapes?: string[];
  /** Small multiples: how many DISTINCT series the figure draws (rows in its drawn panes, through
   *  series_order). A pane's own list can undercount it. Read by the stacked builder's net dot
   *  (spec/bar-stack.ts drawsNetDots). Absent (single chart) → the pane's own distinct count. */
  chartSeriesCount?: number;
  /** Histogram small multiples (shared mode): the bin thresholds computed ONCE by the figure
   *  orchestrator over ALL in-scope rows, so every pane bins to the SAME edges (and therefore
   *  shares one continuous x-domain). Threaded into `binValues`/`computeThresholds` as the
   *  explicit thresholds. Absent → the pane computes its own thresholds from its own rows
   *  (single chart, or per-pane mode where each pane bins independently). Ignored by non-histogram
   *  chart types and by pre-binned histograms (which read x0/x1 directly). */
  binThresholds?: number[];
  /** hooks.afterRender's ctx.phase (spec/hooks.ts): "export" for buildExportSvg's re-render of the
   *  PNG download; absent (⇒ "live") for every other caller — mountChart, or renderChart/renderFigure
   *  called directly. Threaded straight through; has no other effect on rendering. NOT set on the
   *  metadata-only pre-renders (mountChart's series-count probe, buildExportSvg's legend-metadata
   *  probe) — those callers omit `afterRender` from the hooks object they pass instead, so the hook
   *  never sees a discarded SVG (see the call sites in render-live.ts / export-png.ts). */
  phase?: "live" | "export";
  /** Timeline only: render this orientation instead of the authored one. Set by the live mount's
   *  auto-switch (resolveTimelineOrientation); absent everywhere else, so the PNG export and every
   *  other caller render the authored orientation. */
  timelineOrientation?: "horizontal" | "vertical";
  /** Timeline only, vertical: budget the layout's columns at this width and centre the block in
   *  `width` (TimelineLayoutInput.budgetWidth). Set by the PNG export's portrait frame
   *  (timelineExportFrame); absent everywhere else. */
  timelineBudgetWidth?: number;
}

function uniqueSeries(rows: PreparedRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) if (!seen.has(r.series)) { seen.add(r.series); out.push(r.series); }
  return out;
}

/** Single rendered pane (frame): the SVG plus everything `renderChart`'s legend-decision
 *  block and `RenderResult` need. The Phase B figure orchestrator renders N of these (each
 *  with a distinct `classNameSuffix`) and composes them. */
export interface PaneResult {
  svg: SVGSVGElement;
  /** Series order (also the filter when spec.series_order is set). */
  seriesNames: string[];
  colors: Map<string, string>;
  valueAffixes: ValueAffixes;
  /** The y-domain this pane was rendered against (after the auto/hard/bar-extent resolution,
   *  or the forced opts.yDomain). The shared-mode orchestrator probe-renders over all rows and
   *  reads this to obtain the one shared domain. */
  yDomain: [number, number];
  /** Set only when a lone `yAxisPolicy` bound had nothing fitted on its open side in THIS pane's
   *  rows, so its own domain took resolveHardDomain's ascending fallback: the domain the pane would
   *  have had without it, nice'd as `yDomain` is (reversed or [b, b]). Shared-mode probes read it:
   *  whenever another pane ascends on its own, the figure unions this in place of `yDomain`. */
  yDomainWithoutFallback?: [number, number];
  /** Formats a value the way this pane's value AXIS does (decimal places derived from its tick
   *  set, plus the chart's affixes). Carried so a `{value}` token in a keyed annotation's legend
   *  label reads exactly as the in-frame label would have. */
  formatValue: (v: number) => string;
  dataInScope: PreparedRow[];
  /** Continuous x-axis only: the extent of this pane's parsed x values, and the domain Plot drew
   *  its x scale over (wider when a marker or band reaches past the data). Small-multiples probes
   *  union them into the figure's `SharedXDomain`. Epoch ms on a date axis. */
  xDataExtent?: [number, number];
  xScaleDomain?: [number, number];
  /** The chart-type-specific mark layers — legend decision reads dashedNames /
   *  seriesColors / legendExtras / legendVisualOrder / netMode off this. */
  layers: MarkLayers;
  /** Series → the `series_patterns` texture this pane's marks were ACTUALLY PAINTED. The ONLY
   *  source a key may take a hatch from — see `AssembleResult.seriesHatches` for why re-deriving
   *  one from the colour map was a divergence waiting to happen. */
  seriesHatches: Map<string, SeriesHatch>;
  /** Series → the flat colour its FILLED marks were painted. Same purpose as `seriesHatches`: the
   *  render is the only thing that knows what a per-mark override produced. */
  seriesPainted: Map<string, string>;
  tooltipXParse?: (v: string) => number;
  tooltipXFormat?: (v: number) => string;
  /** `overlays[].tooltip: true` lines that draw in THIS pane, already cropped to their `domain` and
   *  filtered by `facet`. Carried out of the render rather than recomputed by the live layer for the
   *  same reason `seriesHatches` is: the resolved x-domain that decides where a `domain: "axis"` line
   *  starts and stops is settled here and nowhere else, and a tooltip row for a line that is not on
   *  screen at that x is the defect this whole field exists to avoid. */
  overlayTooltips: OverlayTooltipLine[];
}

/** `x_ticks` → the candidate tick positions the x adapter places and thins, in its units (epoch ms on
 *  a date axis): the data's own x values (or the figure's, `figureValues`), or the listed values
 *  parsed in the axis' grammar. Undefined when the spec leaves the ticks to the axis. */
function xTickCandidates(
  spec: ChartSpec,
  adapter: XAdapter,
  rows: PreparedRow[],
  figureValues: number[] | undefined,
): { tickValues: number[] } | undefined {
  const ticks = spec.x_ticks;
  if (ticks == null) return undefined;
  if (ticks === "data") return { tickValues: figureValues ?? paneXValues(rows) };
  return { tickValues: ticks.map((v) => +adapter.parseX(String(v))) };
}

/** A pane's distinct x values on a continuous axis, in the axis' units (epoch ms on a date axis). */
export function paneXValues(rows: PreparedRow[]): number[] {
  const out = new Set<number>();
  for (const r of rows) {
    const v = r._xd != null ? +r._xd : r._xn;
    if (Number.isFinite(v)) out.add(v as number);
  }
  return [...out];
}

/** Render the single-frame pipeline: parse rows → series order/colors → y-axis (incl. the
 *  bar y-extent pre-pass) → x-adapter/xOpts → markBuilder → assemblePlot. No legend or
 *  RenderResult assembly — that stays in renderChart. `classNameSuffix` is threaded into
 *  assemblePlot for unique-but-deterministic clip-path ids per pane (absent → "tblchart"). */
export function renderPane(
  spec: ChartSpec,
  rows: TidyRow[],
  opts: RenderOptions = {},
  classNameSuffix?: string,
): PaneResult {
  spec = normalizeSpec(spec);
  const xType = spec.xAxisType;
  if (!xType) throw new Error("No xAxisType.");
  const cols = resolveColumns(spec, rows);

  // Histogram: raw rows are binned (or pre-binned x0/x1/value read directly) into `_x0/_x1/_y`
  // PreparedRows, then rendered through the shared pane tail with a continuous histogram adapter.
  if (spec.chartType === "histogram") {
    return renderHistogramPane(spec, rows, opts, classNameSuffix, cols, xType);
  }

  const adapter = makeXAdapter(xType, spec.xAxisPolicy, undefined, spec.tooltip_x_format);
  const data = prepareRows(spec, rows, cols, adapter);

  if (!data.length) throw new Error("No data.");

  const monoStack = spec.chartType === "stacked" && spec.barStack?.mono?.base != null;
  const allSections = !opts.paletteSeries || monoStack ? rowsWithEverySection(spec, rows, cols, adapter, data) : undefined;
  const paletteSeries = opts.paletteSeries ?? seriesBeforeSectionScope(spec, allSections, data);
  const paneOpts = paletteSeries ? { ...opts, paletteSeries } : opts;
  const monoBasis = monoStack && allSections ? scopeToSeries(spec, allSections) : undefined;
  // In the row order the full render sums them (assemblePaneResult sorts its rows the same way): a
  // series' sign is a float sum, so a different order can flip a near-cancelling one and swap shades.
  if (monoBasis) sortByCategoryOrder(spec, monoBasis.dataInScope);
  const pane = assemblePaneResult(spec, paneOpts, classNameSuffix, adapter, cols, data, monoBasis);
  // A date axis fits its ticks to the data's span, but a marker, band or callout past the data
  // widens the scale Plot draws, crowding the labels. Only the render knows that scale, so when it
  // would thin the ticks, render once more with it explicit (the same domain, so nothing else moves).
  // Small-multiples panes already arrive with their drawn range in `sharedX`.
  if (!opts.sharedX && (xType === "temporal" || xType === "quarterly") && pane.xDataExtent && pane.xScaleDomain) {
    const [d0, d1] = pane.xDataExtent;
    const [s0, s1] = pane.xScaleDomain;
    if (s0 < d0 || s1 > d1) {
      const width = (opts.width ?? 720) - (opts.marginLeft ?? TBL_MARGIN_LEFT) - (opts.marginRight ?? TBL_MARGIN_RIGHT);
      const dates: [Date, Date] = [new Date(d0), new Date(d1)];
      // `x_ticks` always: its listed values may lie in the widened part, and its thinning is measured
      // on the drawn span too.
      if (spec.x_ticks != null || temporalXTicks(dates, width, [s0, s1]).length !== temporalXTicks(dates, width).length) {
        return renderPane(spec, rows, { ...opts, sharedX: { data: [d0, d1], scale: [s0, s1] } }, classNameSuffix);
      }
    }
  }
  return pane;
}

/** This pane's rows with every section drawn, when `section_order` leaves some of them out; else
 *  undefined. Colours are resolved over these, so no drawn series changes colour (Ruling 79). */
function rowsWithEverySection(
  spec: ChartSpec,
  rows: TidyRow[],
  cols: ResolvedColumns,
  adapter: XAdapter,
  data: PreparedRow[],
): PreparedRow[] | undefined {
  if (!cols.section || !spec.section_order?.length) return undefined;
  const all = prepareRows({ ...spec, section_order: undefined }, rows, cols, adapter);
  // section_order only removes rows, so an equal count means it removed none.
  return all.length === data.length ? undefined : all;
}

/** The series list a chart resolves with every section drawn (`allSections`), when `section_order`
 *  leaving a section out drops a series from it; else undefined. Colours and markers index this list
 *  (as a figure's panes index RenderOptions.paletteSeries), so a series found only in an excluded
 *  section takes no legend row but keeps its palette position, and no drawn series changes colour. */
function seriesBeforeSectionScope(spec: ChartSpec, allSections: PreparedRow[] | undefined, data: PreparedRow[]): string[] | undefined {
  if (!allSections) return undefined;
  const all = scopeToSeries(spec, allSections).seriesNames;
  const drawn = scopeToSeries(spec, data).seriesNames;
  return all.length === drawn.length && all.every((s, i) => s === drawn[i]) ? undefined : all;
}

/** renderPane's row prep: parse + validate rows into the engine's in-memory shape. Shared with
 *  `shapeDomainOver`, which must read the rows exactly as a pane does. */
function prepareRows(
  spec: ChartSpec,
  rows: TidyRow[],
  cols: ResolvedColumns,
  adapter: XAdapter,
): PreparedRow[] {
  // `overlays[].column` names an author-chosen data column, so no canonical PreparedRow field can
  // hold it — carry the ones this spec actually asks for, keyed by name. No overlays ⇒ no field ⇒
  // byte-identical rows.
  const overlayCols = Array.from(
    new Set((spec.overlays ?? []).map((o) => o.column).filter((c): c is string => !!c)),
  );

  // Parse + validate rows into the engine's in-memory shape. Input columns are mapped onto the
  // engine's canonical fields (series / time / _y) via the resolved `columns` role map; a null
  // series column ⇒ a single implicit series.
  // Sectioned axis: a row's category is its section + category key (spec/section-key.ts), so a
  // label repeated across sections stays two rows. Bare category when nothing repeats (in the
  // figure, when a small-multiples figure has decided for all its panes).
  const sectionField = cols.section;
  rows = rowsInSectionOrder(rows, spec.section_order, sectionField ? (r) => r[sectionField] : null);
  const keyOf =
    sectionField && adapter.xField === "_xc"
      ? sectionKeyer(rows, (r) => r[cols.x] ?? "", (r) => r[sectionField] ?? "")
      : null;
  return rows
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
      // Verbatim: this names an observation, so it is not a number to format or a key to look up.
      if (cols.point_label) row._pointLabel = r[cols.point_label] ?? "";
      // The RAW cell, read past the resolver's series/shape dedupe, so a `point:` callout keyed to
      // such a column still finds its row. Same exact-match contract as validateChartData.
      if (spec.columns?.point_label) row._pointKey = r[spec.columns.point_label] ?? "";
      if (cols.section) row._section = r[cols.section] ?? "";
      // Waterfall step kind (delta/total/skip/branch).
      if (cols.kind) row._kind = r[cols.kind] ?? "";
      if (spec.projected_field) {
        row._projected = isTruthyFlag(r[spec.projected_field]);
      }
      (row as unknown as Record<string, unknown>)[adapter.xField] = keyOf ? keyOf(r) : adapter.parseX(xRaw);
      for (const band of spec.confidence_bands ?? []) {
        if (row.series === band.series) {
          const lo = r[band.lower];
          const hi = r[band.upper];
          row._lo = lo !== "" && lo != null ? +lo : undefined;
          row._hi = hi !== "" && hi != null ? +hi : undefined;
        }
      }
      if (overlayCols.length) {
        const bag: Record<string, number> = {};
        for (const c of overlayCols) {
          const raw = r[c];
          // Blank and null are ABSENT, not zero. `Number("")` is 0, which would draw a fitted line
          // diving to the baseline wherever the column is sparse — and, since a `column` overlay folds
          // into yForAxis, drag the value axis down with it. This is the same guard the
          // confidence_bands `_lo`/`_hi` prep applies four lines below.
          if (raw === "" || raw == null) continue;
          const v = +raw;
          if (Number.isFinite(v)) bag[c] = v;
        }
        if (Object.keys(bag).length) row._overlayCols = bag;
      }
      return row;
    })
    .filter((r) => adapter.validate(r as unknown as Record<string, unknown>));
}

/** [min(_x0), max(_x1)] over binned rows — the continuous bin-edge span the histogram x-scale
 *  must cover (the already-binned counts must NOT drive the x domain). */
function histogramDomainOf(binned: PreparedRow[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of binned) {
    if (r._x0 != null && r._x0 < lo) lo = r._x0;
    if (r._x1 != null && r._x1 > hi) hi = r._x1;
  }
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : [0, 1];
}

/** Histogram pane: transform raw rows into binned `_x0/_x1/_y` PreparedRows (or read pre-binned
 *  edges directly), build a CONTINUOUS x-adapter whose domain spans the bin edges, then hand off
 *  to the shared pane tail. Binning is driven off the RAW rows (so the weight column is in hand)
 *  using the same numeric/temporal x-parse the adapter uses. Shared-mode facet thresholds arrive
 *  via `opts.binThresholds` (computed once over all rows by the figure orchestrator). */
function renderHistogramPane(
  spec: ChartSpec,
  rows: TidyRow[],
  opts: RenderOptions,
  classNameSuffix: string | undefined,
  cols: ResolvedColumns,
  xType: NonNullable<ChartSpec["xAxisType"]>,
): PaneResult {
  const binned = histogramPaneRows(spec, rows, cols, xType, opts.binThresholds);
  if (!binned.length) throw new Error("No data.");

  const adapter = makeXAdapter(xType, spec.xAxisPolicy, histogramDomainOf(binned), spec.tooltip_x_format);
  return assemblePaneResult(spec, opts, classNameSuffix, adapter, cols, binned);
}

/** A histogram pane's binned `_x0/_x1/_y` rows: pre-binned rows read directly, raw rows binned at
 *  `binThresholds` (the figure's shared thresholds) or their own. */
function histogramPaneRows(
  spec: ChartSpec,
  rows: TidyRow[],
  cols: ResolvedColumns,
  xType: NonNullable<ChartSpec["xAxisType"]>,
  binThresholds: number[] | undefined,
): PreparedRow[] {
  const isTemporal = xType === "temporal";
  let binned: PreparedRow[];

  if (isPreBinned(cols)) {
    // Pre-binned: each row already carries a bin's lower/upper edge + its bar height (value).
    // No engine binning; still honor `normalize` (validation forbids bins/binWidth/domain/weight
    // here, but not normalize) so a pre-binned proportion/density histogram scales the same way.
    const preRows: BinnedRow[] = rows.map((r) => {
      const valRaw = r[cols.value];
      const row: BinnedRow = {
        series: cols.series ? String(r[cols.series] ?? "") : SINGLE_SERIES_KEY,
        _x0: +r[cols.x0!]!,
        _x1: +r[cols.x1!]!,
        _y: valRaw === "" || valRaw == null ? 0 : +valRaw,
      };
      if (cols.facet) row._facet = String(r[cols.facet] ?? "");
      return row;
    });
    binned = normalizeBinned(preRows, spec.histogram?.normalize) as PreparedRow[];
  } else {
    // Raw: parse x the SAME way the adapter would (numeric `+v`, temporal `parseDate` → epoch-ms),
    // read the optional weight column off the raw row (blank ⇒ 0 contribution), and drop non-finite x.
    const weightCol = spec.histogram?.weight;
    const inputs: BinInput[] = rows
      .map((r) => {
        const xRaw = r[cols.x] ?? "";
        const x = isTemporal ? parseDate(xRaw).getTime() : +xRaw;
        const wRaw = weightCol ? r[weightCol] : undefined;
        const weight =
          weightCol != null ? (wRaw === "" || wRaw == null ? 0 : Number(wRaw)) : undefined;
        const input: BinInput = {
          series: cols.series ? String(r[cols.series] ?? "") : SINGLE_SERIES_KEY,
          x,
        };
        if (weight !== undefined) input.weight = weight;
        if (cols.facet) input._facet = String(r[cols.facet] ?? "");
        return input;
      })
      .filter((r) => Number.isFinite(r.x));
    const values = inputs.map((r) => r.x);
    const bw = spec.histogram?.binWidth;
    const thresholds =
      binThresholds ??
      (isTemporal
        ? temporalThresholds(values, bw, spec.histogram?.bins, spec.histogram?.domain)
        : computeThresholds(values, {
            bins: spec.histogram?.bins,
            binWidth: typeof bw === "number" ? bw : undefined,
            domain: spec.histogram?.domain,
          }));
    binned = binValues(inputs, {
      thresholds,
      normalize: spec.histogram?.normalize,
    }) as PreparedRow[];
  }
  return binned;
}

/** The [min, max] of the value cells `rows` hold as one pane, after renderPane's own row prep and
 *  series scope (`series_order` filters); a histogram's values are its bin heights, binned at
 *  `binThresholds`. A statement about the DATA, not the drawing: `tbl-chart validate` reads it, and
 *  what the axis then draws also answers to headroom, markers, nice rounding and shared domains.
 *  Pure, no DOM. Null when no value is finite. */
export function paneValueExtent(
  spec: ChartSpec,
  rows: TidyRow[],
  binThresholds?: number[],
): { min: number; max: number } | null {
  spec = normalizeSpec(spec);
  const xType = spec.xAxisType;
  if (!xType) return null;
  const cols = resolveColumns(spec, rows);
  const data =
    spec.chartType === "histogram"
      ? histogramPaneRows(spec, rows, cols, xType, binThresholds)
      : prepareRows(spec, rows, cols, makeXAdapter(xType, spec.xAxisPolicy, undefined, spec.tooltip_x_format));
  let min = Infinity;
  let max = -Infinity;
  for (const r of scopeToSeries(spec, data).dataInScope) {
    const y = r._y as number;
    if (!Number.isFinite(y)) continue;
    if (y < min) min = y;
    if (y > max) max = y;
  }
  return min <= max ? { min, max } : null;
}

/** Whether a SINGLE stacked chart of these rows draws net dots: renderPane's own row prep and series
 *  scope (blank series names and `series_order`'s filter included), then the builder's own predicate
 *  (marks/stacked.ts netDotsDrawn) over the series count renderChart gives it. The fitted row-pitch
 *  floor (figure.ts) reads it. Pure, no DOM. */
export function singleChartDrawsNetDots(spec: ChartSpec, rows: TidyRow[]): boolean {
  spec = normalizeSpec(spec);
  if (spec.chartType !== "stacked" || !spec.xAxisType) return false;
  const cols = resolveColumns(spec, rows);
  const data = prepareRows(spec, rows, cols, makeXAdapter(spec.xAxisType, spec.xAxisPolicy, undefined, spec.tooltip_x_format));
  const { seriesNames, dataInScope } = scopeToSeries(spec, data);
  return netDotsDrawn(spec, dataInScope, seriesNames.length);
}

/** Series order. When series_order is set it acts as both filter and order. Mirrored by
 *  validateChartData's keyed-callout "drawn nowhere" rules (src/spec/validate.ts) — change both. */
function scopeToSeries(spec: ChartSpec, data: PreparedRow[]): { seriesNames: string[]; dataInScope: PreparedRow[] } {
  const seriesNames =
    spec.series_order && spec.series_order.length
      ? spec.series_order.filter((s) => data.some((r) => r.series === s))
      : uniqueSeries(data);
  const seriesSet = new Set(seriesNames);
  return { seriesNames, dataInScope: data.filter((r) => seriesSet.has(r.series)) };
}

/** Categorical x render order, IN PLACE. Every downstream consumer (the band scale via
 *  adapter.buildXOpts, the mark builders, the x-label collision check) reads the category order from
 *  dataInScope's row order, so a single stable sort fixes the order everywhere. Listed categories
 *  first in x_order; unlisted ones keep their encounter order after (order-only — unlike
 *  series_order, x_order does NOT filter). Stable sort preserves within-category row order. No-op
 *  off the categorical axis.
 *
 *  A sectioned axis then takes the row order `sectionedRowOrder` states. The marks group the sorted rows by section in the order they reach each section,
 *  so the x_order sort alone moved a section whose category x_order lists above one the data reaches
 *  first. The rows are re-sorted only when the band they would draw differs from that order, so a
 *  chart already drawn in it keeps its row order, and its bytes. */
function sortByCategoryOrder(spec: ChartSpec, dataInScope: PreparedRow[]): void {
  const catOrder = categoryOrderFor(spec);
  const sectioned = isSectionedAxis(spec, dataInScope);
  const target = sectioned && catOrder?.length ? sectionedRowOrder(spec, dataInScope, true) : null;
  if (spec.xAxisType === "categorical" && catOrder && catOrder.length) {
    const rank = new Map(catOrder.map((c, i) => [c, i] as const));
    const last = catOrder.length;
    // A bare name ranks every section's row of that name (spec/section-key.ts).
    const rankOf = (r: PreparedRow): number => rank.get(categoryText(r._xc ?? "")) ?? last;
    dataInScope.sort((a, b) => rankOf(a) - rankOf(b));
  }
  if (!target) return;
  const drawn = sectionedRowOrder(spec, dataInScope, false);
  const present = new Set(drawn);
  const want = target.filter((c) => present.has(c));
  if (want.length === drawn.length && want.every((c, i) => c === drawn[i])) return;
  const rank = new Map(want.map((c, i) => [c, i] as const));
  const rankOf = (r: PreparedRow): number => rank.get(r._xc ?? "") ?? want.length;
  dataInScope.sort((a, b) => rankOf(a) - rankOf(b));
}

/** Whether these rows draw a sectioned category axis: a horizontal bar, stack or dumbbell (the
 *  charts whose marks group rows into sections — marks/category-band.ts, marks/dumbbell.ts) with a
 *  section on some row. */
function isSectionedAxis(spec: ChartSpec, rows: readonly PreparedRow[]): boolean {
  return spec.xAxisType === "categorical" && valueAxisIsX(spec) && rows.some((r) => r._section != null);
}

/** The row order of a sectioned category axis, as category keys (`_xc`): sections in
 *  `section_order`, else in the order `rows` first reach them; within a section, x_order /
 *  category_order (when `withCategoryOrder`), then the order `rows` reach its categories. A
 *  category belongs to the section of its first row, as in the marks. Without `withCategoryOrder`
 *  this is the order the marks draw `rows` in as they stand. */
function sectionedRowOrder(spec: ChartSpec, rows: readonly PreparedRow[], withCategoryOrder: boolean): string[] {
  const sectionOf = new Map<string, string>();
  const categories: string[] = [];
  for (const r of rows) {
    const cat = r._xc;
    if (!cat || sectionOf.has(cat)) continue;
    sectionOf.set(cat, r._section ?? "");
    categories.push(cat);
  }
  const encountered = [...new Set(categories.map((c) => sectionOf.get(c) as string))];
  const sections = spec.section_order?.length ? spec.section_order.filter((s) => encountered.includes(s)) : encountered;
  const catOrder = withCategoryOrder ? categoryOrderFor(spec) : undefined;
  // As sortByCategoryOrder: unlisted ranks at the list's length. A repeated entry makes the
  // distinct count smaller than a listed index, which tied the two.
  const rank = new Map((catOrder ?? []).map((c, i) => [c, i] as const));
  const unlisted = catOrder?.length ?? 0;
  const rankOf = (c: string): number => rank.get(categoryText(c)) ?? unlisted;
  return sections.flatMap((s) => categories.filter((c) => sectionOf.get(c) === s).sort((a, b) => rankOf(a) - rankOf(b)));
}

/** Point charts: the shape domain. Distinct shape values in spec.shape_order (filter + order; a
 *  listed blank value counts) else data-encounter order over the (category-sorted) rows, blanks
 *  left out. This domain is an inclusion filter, mirrored by validateChartData's keyed-callout
 *  "drawn nowhere" rules (src/spec/validate.ts) — change both. */
function resolveShapeNames(spec: ChartSpec, dataInScope: readonly PreparedRow[]): string[] {
  return spec.shape_order && spec.shape_order.length
    ? spec.shape_order.filter((s) => dataInScope.some((r) => r._shape === s))
    : Array.from(new Set(dataInScope.map((r) => r._shape).filter((s): s is string => s != null && s !== "")));
}

/** The shape domain a pane resolves when it draws `rows`: renderPane's own row prep, series scope,
 *  category order and shape rule, run over these rows. Small multiples call it over every DRAWN
 *  pane's rows for the figure's one shape list (RenderOptions.paletteShapes). Being the pane rule
 *  itself is what leaves an already-consistent figure unchanged: each pane's rows, in the order the
 *  pane reads them, are a subsequence of these, so where every pane's list is a prefix of the
 *  longest (the panes agreed with each other and with that list as legend) this returns it. A rule
 *  of the figure's own (dropping a listed blank value, reading rows before x_order sorts them,
 *  counting rows no pane draws) returned another list and moved those figures' markers. */
export function shapeDomainOver(spec: ChartSpec, rows: TidyRow[]): string[] {
  spec = normalizeSpec(spec);
  const xType = spec.xAxisType;
  if (!xType) throw new Error("No xAxisType.");
  const cols = resolveColumns(spec, rows);
  const adapter = makeXAdapter(xType, spec.xAxisPolicy, undefined, spec.tooltip_x_format);
  const { dataInScope } = scopeToSeries(spec, prepareRows(spec, rows, cols, adapter));
  sortByCategoryOrder(spec, dataInScope);
  return resolveShapeNames(spec, dataInScope);
}

/** Shared pane-assembly tail: series order/colors → annotations → y-axis → x-opts → markBuilder →
 *  assemblePlot → PaneResult. Consumed by BOTH the standard parse path (line/bar/…, which passes a
 *  data-fitted adapter) and the histogram path (which passes binned `_x0/_x1/_y` rows + a
 *  bin-edge-domain adapter). The y-extent block branches per chartType (histograms: `_y`, include 0). */
function assemblePaneResult(
  spec: ChartSpec,
  opts: RenderOptions,
  classNameSuffix: string | undefined,
  adapter: XAdapter,
  cols: ResolvedColumns,
  data: PreparedRow[],
  monoBasis?: MarkContext["monoBasis"],
): PaneResult {
  const { seriesNames, dataInScope } = scopeToSeries(spec, data);
  const colors = buildColorMap(seriesNames, spec.series_colors, opts.paletteSeries);
  // Single-series charts driven by a colored inline title selector (e.g. a by-industry picker)
  // adopt the selector's color, so the line matches the selector's tinted label. Multi-series
  // charts keep their distinct palette/series_colors untouched — see RenderOptions.accentColor.
  if (opts.accentColor && seriesNames.length === 1) {
    colors.set(seriesNames[0]!, opts.accentColor);
  }

  sortByCategoryOrder(spec, dataInScope);

  // Y-axis: fold CI band bounds into the computed range when present, plus any horizontal
  // reference-line (yAxisPolicy.markers) values so a marker at/beyond the data extent gets a
  // little headroom instead of sitting flush against the axis edge.
  // Small multiples: scope markers with a `facet` key to THIS pane before anything below reads
  // `ann` — the extent folding a few lines down (markerYs / yForAxis) must see the FILTERED set
  // so a marker beyond one pane's own range doesn't widen every pane's domain. Undefined
  // paneFacetValue (single chart) returns `ann` unchanged (byte-identical).
  const ann = filterAnnotationsByFacet(resolveAnnotations(spec), opts.paneFacetValue);

  // Point callouts. A `point:` callout takes BOTH coordinates from the one row whose raw
  // `columns.point_label` cell equals it (validateChartData guaranteed exactly one across all rows).
  // No match in THIS pane's rows ⇒ dropped here: on a faceted chart the row lives in exactly one
  // pane, and a callout without `facet:` reaches every pane, so this drop is what makes it appear
  // only where its observation is. `x` is the raw string because markerToX re-parses it.
  // Otherwise resolve a y for any callout that gives a `series` but omits `y` — snap to that
  // series' value at x. For a stacked chart (area/stacked) that's the cumulative TOP of the series'
  // band; otherwise the series' own value. Rows are matched at x by the raw time / numeric key.
  const stackedChart = spec.chartType === "area" || spec.chartType === "stacked";
  const seriesRank = new Map<string, number>(seriesNames.map((s, i) => [s, i]));
  const resolvedPoints: PointCallout[] = [];
  // The single row each entry of `resolvedPoints` came from, by index — undefined for an explicit
  // x+y callout and for the stacked cumulative snap (a sum has no row). Read by the row-token
  // substitution below, which has to wait for xOpts (the `{x}` formatter lives there).
  const pointRows: Array<PreparedRow | undefined> = [];
  for (const p of ann.points) {
    if (p.point != null) {
      const row = dataInScope.find((r) => r._pointKey === p.point);
      if (!row || !Number.isFinite(row._y as number)) continue;
      // `series` rides along so the label can take its series' colour by default (assemblePlot).
      // Validation forbids an AUTHORED `series` beside `point:`; this is the resolved row's own,
      // set after that check, and nothing downstream re-snaps on it.
      resolvedPoints.push({ ...p, x: row.time, y: row._y as number, series: row.series });
      pointRows.push(row);
      continue;
    }
    if (Number.isFinite(p.y as number) || !p.series) {
      resolvedPoints.push(p);
      pointRows.push(undefined);
      continue;
    }
    const atX = dataInScope.filter((r) => r.time === p.x || String(r._xn ?? "") === p.x);
    const targetRank = seriesRank.get(p.series);
    let y: number | undefined;
    let snapped: PreparedRow | undefined;
    if (targetRank == null) {
      // unknown series: the callout stays as written (no y ⇒ assemblePlot draws nothing)
    } else if (stackedChart) {
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
      if (row && Number.isFinite(row._y as number)) {
        y = row._y as number;
        snapped = row;
      }
    }
    resolvedPoints.push(y != null ? { ...p, y } : p);
    pointRows.push(snapped);
  }

  // Numeric extent of the parsed x values (numeric/temporal axes only; categorical → undefined).
  // Computed HERE, above the y-extent block, because the `column` overlay fold a few lines down
  // needs it to crop by the entry's `domain` (see below) — xOpts, which the draw-time overlay
  // resolution prefers, is not built until much later. Everything that measures against the DRAWN
  // axis reads `xAxisDomain` instead (built once xOpts exists); this is only its fallback.
  const xExtentVals = dataInScope
    .map((r) =>
      adapter.xField === "_xd" ? r._xd?.getTime() : adapter.xField === "_xn" ? r._xn : undefined,
    )
    .filter((v): v is number => Number.isFinite(v as number));
  const xExtent: [number, number] | undefined = xExtentVals.length
    ? minMax(xExtentVals)
    : undefined;

  // Y-axis: fold CI band bounds into the computed range when present, plus any horizontal
  // reference-line (yAxis markers) values + point-callout y values so an annotation at/beyond the
  // data extent gets a little headroom instead of sitting flush against the axis edge.
  // A `column` overlay is real per-row data — the same kind of thing as the CI bounds below — so it
  // folds into the value extent rather than being clipped. The CONSTRUCTED kinds (method, fun,
  // slope+intercept) deliberately do not: `domain: axis` extrapolates as far as the frame goes, and
  // letting a steep fit dictate the axis is what the clip exists to prevent.
  //
  // Scoped to what THIS pane draws — `facet` and `domain` both, via the same code the geometry uses
  // (overlays.ts#overlayColumnValues). An unscoped fold widened every pane's axis to the overlay's
  // range, and in `mode: "shared"` the unioned domain then flattened the lot. `xDomain` is the DATA
  // extent, not xOpts' resolved axis domain (unavailable this early): they differ only in that the
  // axis domain is the WIDER of the two (x-adapter fits the data, or anchors at zero), and every
  // value this reads sits at the x of a row — inside the data extent either way — so `domain: "axis"`
  // crops identically.
  //
  // Hoisted out of `yForAxis` because it is needed TWICE: chart types that resolve a `hardDomain`
  // never reach `yForAxis` at all (computeYAxis returns on the supplied domain without reading the
  // values), so the AREA branch below has to fold this in itself. Empty for every spec without a
  // `column` overlay, which is what keeps that fold a no-op everywhere else.
  const overlayColumnYs = overlayColumnValues(spec, dataInScope, {
    xField: adapter.xField,
    seriesNames,
    ...(opts.paneFacetValue != null ? { paneFacetValue: opts.paneFacetValue } : {}),
    ...(xExtent ? { xDomain: xExtent } : {}),
  });
  // annotations.yAxis markers on a chart whose value axis is x draw nothing (they sit on the
  // categorical y scale), so they reach no value domain (Ruling 78; validation rejects them).
  const yAxisMarkerYs = valueAxisIsX(spec) ? [] : ann.yAxis.map((m) => m.y);
  const yForAxis: Array<number | null | undefined> = [
    ...dataInScope.map((d) => d._y),
    ...dataInScope.map((d) => d._lo).filter(Number.isFinite),
    ...dataInScope.map((d) => d._hi).filter(Number.isFinite),
    ...yAxisMarkerYs,
    ...resolvedPoints.map((p) => p.y).filter((v): v is number => Number.isFinite(v as number)),
    // See overlayColumnYs above for why a `column` overlay folds in and the constructed kinds do not.
    ...overlayColumnYs,
  ];
  const policy = spec.yAxisPolicy ?? {};
  const tickCount = policy.tickCount ?? 5;
  const chartType = spec.chartType;

  // A LONE pinned bound (`min` or `max`, the other unset) pins only its own end. The branches that
  // have no extent of their own fill the open end with what computeYAxis fits from `yForAxis` when
  // given no domain (the same `fittedExtent`). Without it resolveHardDomain returned null and the
  // lone bound was silently dropped. Undefined when the values hold nothing finite, which keeps the
  // axis on computeYAxis' own fallback.
  const loneBound = (policy.min == null) !== (policy.max == null);
  const fittedOpenEnd = (zero: boolean): { auto?: { min: number; max: number } } => {
    const auto = loneBound ? fittedExtent(yForAxis, zero) : null;
    return auto ? { auto } : {};
  };

  let hardDomain: [number, number] | null;
  let includeZero: boolean;
  // Set when a lone bound took resolveHardDomain's ascending fallback: the hard domain it replaced
  // (see PaneResult.yDomainWithoutFallback).
  let hardDomainWithoutFallback: [number, number] | undefined;
  const hardOpts = {
    tickCount,
    onLoneFallback: (d: [number, number]) => void (hardDomainWithoutFallback = d),
  };

  // Value-axis reference markers, for the branches that fold them in so a marker stays visible.
  // The value axis is x on a horizontal chart, so annotations.xAxis plays the yAxis role there
  // (see assemblePlot's horizontal xAxis marker path), and annotations.yAxis plays none.
  const valueAxisMarkers = (): number[] =>
    [...yAxisMarkerYs, ...(valueAxisIsX(spec) ? ann.xAxis.map((m) => Number(m.x)) : [])].filter(Number.isFinite);

  if (chartType === "bar" || chartType === "stacked") {
    // Bar/stacked: zero baseline by default (axis extent from stacked totals + value-label
    // headroom). An explicit yAxisPolicy.min OPTS OUT of the forced zero — a truncated bar axis
    // (use sparingly; e.g. a level series whose variation is small relative to its magnitude).
    // Reference-line (markers) values are folded into the extent so a marker stays visible.
    includeZero = policy.min == null;
    hardDomain = resolveHardDomain({
      min: policy.min,
      max: policy.max,
      ...hardOpts,
      auto: computeBarYExtent(dataInScope, spec, chartType),
      fold: valueAxisMarkers(),
    });
  } else if (chartType === "dumbbell") {
    // Dumbbell: dots are POSITIONS, so the value axis fits the padded data extent and does NOT
    // force zero (see computeDumbbellValueExtent) unless the author sets yAxisPolicy.includeZero.
    // That has to widen the auto extent itself: this branch always resolves a hard domain, and
    // computeYAxis never applies its own includeZero to one. A pinned min/max still wins on its side.
    // Orientation is handled by the mark (horizontal puts the value on x via yScaleOpts).
    includeZero = policy.includeZero === true;
    const fitted = computeDumbbellValueExtent(dataInScope.map((d) => d._y));
    hardDomain = resolveHardDomain({
      min: policy.min,
      max: policy.max,
      ...hardOpts,
      auto: includeZero ? { min: Math.min(0, fitted.min), max: Math.max(0, fitted.max) } : fitted,
      fold: valueAxisMarkers(),
    });
  } else if (chartType === "histogram") {
    // Histogram: the value axis is the (possibly normalized) bin height `_y`, which yForAxis
    // already carries. Zero baseline by default (bars grow from 0); a pinned min/max sets its own
    // end, and a lone one leaves the other auto-fitted from zero.
    includeZero = true;
    hardDomain = resolveHardDomain({ min: policy.min, max: policy.max, ...hardOpts, ...fittedOpenEnd(true) });
  } else if (chartType === "waterfall") {
    // Waterfall: the value axis must span the running CUMULATIVE path (bar bases/tops, including
    // total bars), not the raw deltas — computed by the same stepper the mark builder uses so the
    // axis and bars agree. Zero baseline; reference-line (yAxis) values fold in for headroom.
    includeZero = policy.min == null;
    hardDomain = resolveHardDomain({
      min: policy.min,
      max: policy.max,
      ...hardOpts,
      auto: computeWaterfallYExtent(dataInScope),
      fold: ann.yAxis.map((m) => m.y).filter(Number.isFinite),
    });
  } else if (chartType === "area") {
    // Stacked area: zero baseline; the axis extent comes from the per-x STACKED TOTAL (the
    // cumulative top), not individual series values. Annotation y values are folded in for headroom.
    includeZero = true;
    // `overlayColumnYs` is folded in HERE as well as into `yForAxis`, because this branch always
    // resolves a non-null `hardDomain` (its `auto` is unconditional), and computeYAxis returns on a
    // supplied domain without ever reading `yForAxis`. Without this the axis kept the stack's own
    // range and a `column` overlay above the stack was drawn hundreds of px off-frame and clipped
    // invisible, while its `fit` labels still painted. Empty array for every spec without a `column`
    // overlay, so the fold is a no-op there and no existing figure moves.
    const markerYs = [
      ...ann.yAxis.map((m) => m.y),
      ...resolvedPoints.map((p) => p.y).filter((v): v is number => Number.isFinite(v as number)),
      ...overlayColumnYs,
    ].filter(Number.isFinite);
    // The floor and ceiling are the stacked NEGATIVE and POSITIVE extents: each sign stacks away
    // from 0 on its own, so two negatives at one x reach their sum, not the lower of the two, and
    // positives reach theirs whatever negatives share the x (Ruling 72). Keyed by the parsed x, as
    // Plot stacks, and the same computation as the clip gate's (computeDrawnValueExtent).
    hardDomain = resolveHardDomain({
      min: policy.min,
      max: policy.max,
      ...hardOpts,
      // Areas fill from 0, so the baseline is on the axis whatever the sign of the stack: an
      // all-negative area's ceiling is 0 (Ruling 70), as a bar's or a stack's is.
      auto: stackedExtent(dataInScope, areaStackKey) ?? { min: 0, max: 0 },
      fold: markerYs,
    });
  } else {
    // Line (and future non-bar types): unchanged behavior.
    includeZero = policy.includeZero === true;
    // A reversed request (min > max) carries the numeric FLOOR in `max`, so autoWiden — "round the
    // bound the data overflows out to a clean multiple of `step`" — extends it DOWNWARD there,
    // where on an ascending axis the same rule raises the ceiling.
    const reversed = policy.min != null && policy.max != null && policy.min > policy.max;
    let yMax = policy.max;
    if (policy.autoWiden && yMax != null) {
      const step = policy.autoWiden.step || 1;
      const finite = yForAxis.filter(Number.isFinite) as number[];
      // Validation requires step > 0, but a tiny one overflows v / step to Infinity (and an
      // unvalidated negative one rounds the wrong way): a multiple that is not finite or does not
      // reach v falls back to v itself, so the bound always covers what overflowed it.
      const widen = (v: number, round: (x: number) => number, reaches: (m: number) => boolean): number => {
        const m = round(v / step) * step;
        return Number.isFinite(m) && reaches(m) ? m : v;
      };
      if (finite.length) {
        if (reversed) {
          const dataMin = minMax(finite)[0];
          if (dataMin < yMax) yMax = widen(dataMin, Math.floor, (m) => m <= dataMin);
        } else {
          const dataMax = minMax(finite)[1];
          if (dataMax > yMax) yMax = widen(dataMax, Math.ceil, (m) => m >= dataMax);
        }
      }
    }
    hardDomain = resolveHardDomain({ min: policy.min, max: yMax, ...hardOpts, ...fittedOpenEnd(includeZero) });
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

  // tagCategoryLabels: the hover-accent hook (task 17) is bar/stacked-only — categorical-x line
  // and dot-plot charts share this same adapter path and stay byte-identical.
  // X-axis rug: the strip occupies space between the plot frame and the tick labels. Handed to the
  // adapter as a bottom GUTTER, which it adds to both its marginBottom and its tick-label dy — so
  // the room made and the offset taken are one number applied in one place. assemblePlot draws the
  // strip into that gap and must NOT re-add it. 0 when the chart has no rug tracks.
  const xOpts = adapter.buildXOpts(dataInScope, {
    labelMode: xLabelMode,
    tagCategoryLabels: chartType === "bar" || chartType === "stacked",
    bottomGutter: rugAllowance(spec),
    dataWidth: dataWidthForX,
    ...(opts.xTickWidth != null ? { tickWidth: opts.xTickWidth } : {}),
    ...(xTickCandidates(spec, adapter, dataInScope, opts.xTickValues) ?? {}),
    ...(opts.sharedX ? { sharedX: opts.sharedX } : {}),
  });
  // Faceted vertical bars: the figure forces a shared bottom margin (the max across panes) so every
  // pane's baseline lines up regardless of its own label length. Flows to plotHeight + assemblePlot.
  if (opts.marginBottom != null) xOpts.marginBottom = opts.marginBottom;

  // Row-token VALUES for point-callout labels, computed HERE (the rows and the x formatter are
  // here) and applied by assemblePlot in one pass together with `{value}`, whose y-tick fallback
  // formatter lives there. `{x}` on a numeric axis goes through `formatNumericX` (util.ts) — see
  // its docstring for the grouping rule and the explicit "en-US" locale. Temporal and quarterly x
  // still take the adapter's date format (`tooltip_x_format`) and a category still takes its
  // `x_labels` display name; neither is a number to round.
  // `{series}` reads the `series_labels` name, which may name the implicit single series too
  // (SINGLE_SERIES_KEY = ""); unmapped, that nameless series and a blank point_label cell are
  // `undefined`, which leaves the token literal rather than printing nothing.
  // Own-property lookups (ownValue): a data key like "toString" must fall through to the raw key,
  // not to Object.prototype (the publish boundary rebuilds these maps as ordinary objects).
  const seriesLabelFor = (key: string | undefined): string | undefined =>
    key == null ? undefined : (ownValue(spec.series_labels, key) ?? (key || undefined));
  const xTokenFor = (x: string | undefined): string | undefined => {
    if (x == null) return undefined;
    const mx = xOpts.markerToX({ x });
    if (typeof mx === "string") return ownValue(spec.x_labels, mx) ?? x;
    if (typeof mx === "number") return Number.isFinite(mx) ? formatNumericX(mx) : x;
    const n = mx instanceof Date ? mx.getTime() : NaN;
    return Number.isFinite(n) && xOpts.tooltipXFormat ? xOpts.tooltipXFormat(n) : x;
  };
  const pointsForPlot: ResolvedPointCallout[] = resolvedPoints.map((p, i) => {
    const row = pointRows[i];
    return {
      ...p,
      rowTokens: {
        point_label: row?._pointKey || undefined,
        x: xTokenFor(p.x),
        series: seriesLabelFor(row?.series ?? p.series),
      },
    };
  });

  // The resolved x-axis domain as a numeric span, for anything that maps px <-> data against the
  // DRAWN axis: annotation-label stagger geometry and point-callout connectors (assemblePlot), and
  // overlay `domain: "axis"` cropping below. The numeric adapter always supplies a domain (it fits
  // the data, or anchors at zero); a histogram's is the bin-edge span (Dates on a temporal axis —
  // convert); temporal/quarterly non-histogram adapters supply none and Plot infers the data
  // extent, so `xExtent` is the honest fallback there. The categorical band domain is a list of
  // categories, not a span — never a candidate.
  const xAxisDomain = numericAxisDomain(xOpts.xPlotOpts?.domain) ?? xExtent;

  const valueAffixes = resolveValueAffixes(spec);

  // Approximate inner plot dimensions for bar-builder label-suppression logic.
  // Approximation: uses TBL_MARGIN_TOP (matches tblPlotDefaults default) and the adapter's
  // marginBottom; bar builders should treat these as rough guidance, not pixel-perfect.
  const effWidth = opts.width ?? 720;
  const effHeight = opts.height ?? 320;
  const plotWidth = effWidth - TBL_MARGIN_LEFT - TBL_MARGIN_RIGHT;
  const plotHeight = effHeight - TBL_MARGIN_TOP - xOpts.marginBottom;

  // Point charts: the shape-encoding channel (resolveShapeNames); `shapeIsSeries` flags the
  // redundant case (shape column == series column) so the symbol scale + legend collapse to a
  // single combined group.
  const hasShape = cols.shape != null;
  const shapeNames = hasShape ? resolveShapeNames(spec, dataInScope) : undefined;
  const shapeIsSeries = hasShape && cols.shape === cols.series;

  // Truncated value axis (a hard yAxisPolicy.min/max, or a shared-mode figure domain, narrower than
  // the data): clip the data marks so they stop at the frame instead of spilling over the title and
  // legend. Compared against the PAINTED extent rather than the padded axis extent so a chart whose
  // data fits stays unclipped — and therefore byte-identical, since Plot's `clip` wraps the mark in
  // an extra <g>. Fires in both directions and either sign, which `yDomain[0] > 0` did not — and
  // against the domain's NUMERIC bounds, so a reversed axis is judged on real overflow rather than
  // clipping unconditionally.
  const drawnExtent = computeDrawnValueExtent(dataInScope, spec, chartType);
  const [clipLo, clipHi] = domainBounds(yDomain);
  const domainEps = Math.abs(clipHi - clipLo) * 1e-9;
  const clipMarks =
    drawnExtent != null &&
    (drawnExtent.min < clipLo - domainEps || drawnExtent.max > clipHi + domainEps);

  // Chart-type-specific marks, then assemble the Plot.
  const layers = markBuilderFor(spec.chartType)(dataInScope, spec, {
    xField: adapter.xField,
    colors,
    seriesNames,
    plotWidth,
    plotHeight,
    // Final resolved y-domain (post auto/hard/bar-extent/shared-mode override) — the area
    // builder's projected-range veil needs it to span the full plot height.
    yDomain,
    // Lets a builder resolve author-supplied x strings (line `shading` from/to) on this chart's axis.
    parseXValue: adapter.parseX,
    ...(clipMarks ? { clipMarks: true } : {}),
    ...(hasShape ? { shapeField: "_shape", shapeNames, shapeIsSeries } : {}),
    // Pane stroke flag: thins line marks for figure panes (both modes). renderFigure sets it.
    ...(opts.pane ? { pane: true } : {}),
    // The figure's distinct drawn series (set only by renderFigure): a count a pane can undercount.
    ...(opts.chartSeriesCount != null ? { chartSeriesCount: opts.chartSeriesCount } : {}),
    // The figure's series list (set only by renderFigure): per-series marker symbols index it.
    ...(opts.paletteSeries ? { paletteSeries: opts.paletteSeries } : {}),
    ...(opts.paletteShapes ? { paletteShapes: opts.paletteShapes } : {}),
    ...(monoBasis ? { monoBasis } : {}),
    // Grouped bars label their categories on `fx`; pass the layout mode so those labels match
    // the single-band/line labels (the adapter handles the `x` band path).
    ...(xLabelMode !== "single" ? { xLabelMode } : {}),
    // Dynamic stack order (area): the live layer passes a reordered list when a series is selected
    // (selected-to-bottom); the mark stacks in this order while legend/colors stay series_order.
    ...(opts.stackOrder ? { stackOrder: opts.stackOrder } : {}),
    // Inline-selector accent: let a no-series/single-series bar chart recolor its bars to the
    // active option's color (the bar analogue of the single-series line recolor above). The bar
    // mark makes it win over bar_color/default; multi-series charts keep their palette.
    ...(opts.accentColor ? { accentColor: opts.accentColor } : {}),
    // This pane's facet identity (per-pane small multiples) — for hooks.valueLabel's ctx.facet.
    ...(opts.paneFacetValue != null ? { facet: opts.paneFacetValue } : {}),
    // Programmatic render hooks (spec/hooks.ts) — only `valueLabel` is consumed by mark builders.
    ...(opts.hooks ? { hooks: opts.hooks } : {}),
  });

  // Overlay lines — fits, equations, stated slopes, precomputed columns. Built HERE rather than in a
  // mark builder because they apply to every numeric/temporal-x chart type, and this is the one site
  // every chart type passes through. Pushing them into `layers` is also what gets them into the PNG:
  // buildExportSvg re-renders through renderChart (or renderFigure for small multiples), so anything
  // derived from spec + rows reaches the download with no second code path to keep in step.
  // `overlays[].tooltip: true` lines for the live hover card, populated inside the block below (the
  // one place the pane-filtered, domain-cropped lines exist). Empty on every chart with no overlays.
  let overlayTooltips: OverlayTooltipLine[] = [];
  if (spec.overlays?.length && adapter.xField !== "_xc") {
    // `domain: "axis"` means the resolved x-scale domain when the adapter supplies one (numeric axes
    // do), else the data extent — the widest honest answer available. See `xAxisDomain` above.
    const resolvedOverlays = resolveOverlays(spec, dataInScope, {
      xField: adapter.xField as "_xn" | "_xd",
      colors,
      seriesNames,
      legendActive: spec.legend !== false,
      ...(xAxisDomain ? { xDomain: xAxisDomain } : {}),
    }).filter((o) => overlayDrawsInPane(o.facet, opts.paneFacetValue));
    overlayTooltips = overlayTooltipLines(spec.overlays, resolvedOverlays);
    const om = buildOverlayMarks(resolvedOverlays, spec.overlays ?? [], {
      xField: adapter.xField as "_xn" | "_xd",
    });
    layers.underlay.push(...om.underlay);
    layers.overlay.push(
      ...om.overlay,
      // Labels last within the overlay layer, so they paint over their own lines. They still sit
      // BELOW assemblePlot's annotation labels (pushed at its step 8) — correct precedence: an
      // `annotations` placement is the more deliberate one, and both are nudgeable.
      ...buildOverlayLabelMarks(resolvedOverlays, {
        xField: adapter.xField as "_xn" | "_xd",
        // The visible frame, so a label anchors on the part of the line that is on screen.
        ...(xAxisDomain ? { xDomain: xAxisDomain } : {}),
        yDomain,
        plotWidth,
        plotHeight,
      }),
    );
    layers.tagging.push(...om.tagging);
  }

  const { svg, seriesHatches, seriesPainted } = assemblePlot({
    layers,
    yDomain,
    yTicks,
    valueAffixes,
    xOpts,
    seriesNames,
    colors,
    spec,
    points: pointsForPlot,
    ...(xAxisDomain ? { xAxisDomain } : {}),
    width: opts.width,
    height: opts.height,
    ...(opts.heightFromModel ? { heightFromModel: true } : {}),
    marginRight: opts.marginRight,
    document: opts.document,
    classNameSuffix,
    hooks: opts.hooks,
    ...(opts.hideYAxisLabels ? { hideYAxisLabels: true } : {}),
    ...(opts.marginLeft != null ? { marginLeft: opts.marginLeft } : {}),
    ...(opts.paneFacetValue != null ? { paneFacetValue: opts.paneFacetValue } : {}),
  });

  return {
    svg,
    seriesNames,
    colors,
    valueAffixes,
    yDomain,
    ...(hardDomainWithoutFallback
      ? { yDomainWithoutFallback: niceDomain(hardDomainWithoutFallback, tickCount) }
      : {}),
    // Wrapped with the SAME tickLabel hook + ctx assemblePlot used internally for the in-frame
    // annotation label (yTickFallbackFmt) — this is what buildLegendItems passes through as
    // pane.formatValue for a keyed annotation's LEGEND row token. Left un-wrapped, the two would
    // resolve `{value}` differently under a `tickLabel` hook: see annotation-legend.ts's invariant
    // comment on why that can never be allowed to happen.
    formatValue: withTickLabelHook(makeTickFormatter(yTicks, valueAffixes), opts.hooks, {
      axis: "y",
      ticks: yTicks,
      affixes: valueAffixes,
    }),
    dataInScope,
    ...(xExtent ? { xDataExtent: xExtent } : {}),
    ...(xExtent ? { xScaleDomain: numericAxisDomain((svg as any).scale?.("x")?.domain) ?? xExtent } : {}),
    layers,
    seriesHatches,
    seriesPainted,
    tooltipXParse: xOpts.tooltipXParse,
    tooltipXFormat: xOpts.tooltipXFormat,
    overlayTooltips,
  };
}
