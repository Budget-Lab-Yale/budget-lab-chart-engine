// Pure chart engine entry point: a validated spec + normalized tidy rows → an SVG plus
// the metadata the live layer (legend, crosshair) needs. Headless-safe — no Date.now /
// Math.random / locale formatting in the render path; interaction lives elsewhere.
//
// This is the tracker's buildLineChart, generalized: data prep + axis computation are
// chart-type agnostic here; the type-specific marks come from the marks/ registry, and
// the Plot is composed by assemblePlot.
import type { ChartSpec, ValueAffixes } from "../spec/types";
import type { RenderHooks } from "../spec/hooks";
import type { NetMode } from "../spec/bar-stack";
import { resolveColumns, isPreBinned, SINGLE_SERIES_KEY, categoryOrderFor } from "../spec/columns";
import type { ResolvedColumns } from "../spec/columns";
import { resolveAnnotations, filterAnnotationsByFacet } from "../spec/annotations";
import type { TidyRow } from "../data/index";
import { tblColorScale, resolveColor } from "./palette";
import {
  computeYAxis,
  computeBarYExtent,
  computeWaterfallYExtent,
  computeDumbbellValueExtent,
  computeDrawnValueExtent,
  resolveHardDomain,
  domainBounds,
  makeTickFormatter,
} from "./scales";
import { bandLabelMode } from "./axes";
import type { BandLabelMode } from "./axes";
import { makeXAdapter } from "./x-adapter";
import type { XAdapter } from "./x-adapter";
import { parseDate } from "../spec/parse-time";
import { binValues, computeThresholds, temporalThresholds, normalizeBinned } from "./histogram-bin";
import type { BinInput, BinnedRow } from "./histogram-bin";
import { markBuilderFor } from "./marks/index";
import type { PreparedRow, MarkLayers } from "./marks/index";
import { assemblePlot, withTickLabelHook } from "./assemble-plot";
import { TBL_MARGIN_LEFT, TBL_MARGIN_RIGHT, TBL_MARGIN_TOP, markerSymbolForIndex } from "./theme";
import { resolveValueAffixes, isTruthyFlag } from "./util";
import { buildAnnotationLegendItems } from "./annotation-legend";
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

export { TOTAL_SERIES_KEY } from "./series-keys";

export interface RenderOptions {
  width?: number;
  height?: number;
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
  /** Small multiples: this pane's facet value, used to scope `annotations.xAxis`/`yAxis` markers
   *  that carry a `facet` key (see `filterAnnotationsByFacet`) — both the y-extent/x-extent
   *  folding below AND the drawn rule/label in assemblePlot read the filtered set. Absent (single
   *  chart, or a faceted chart's figure orchestrator omitting it) → every marker renders,
   *  unchanged from today. */
  paneFacetValue?: string;
  /** Inline title-selector color accent (AILMT parity — charts.js L556-562): an already-resolved
   *  CSS color (run through `palette.resolveColor` by the caller) applied as the sole series'
   *  color WHEN the chart resolves to exactly one series (after `series_order` filtering). A
   *  multi-series chart ignores this — its distinct palette/`series_colors` stay untouched, matching
   *  the tracker's single-line-only accent-feed. render-live.ts recomputes this from the active
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
  /** Dumbbell "hollow" marker: render the point swatch as a ring (`fill="none"` — a genuine hole,
   *  so the swatch takes the card or the tooltip's blur as its ground — with a series-color stroke)
   *  instead of a solid dot, matching the chart's hollow dots. See `engine/marker-ink.ts`. */
  hollow?: boolean;
  /** A `rect` swatch showing MORE THAN ONE tint, drawn as equal vertical bands in this order.
   *  Set when one keyed concept covers several differently-colored fills — `shading` with no
   *  `series` gives every series its own region in its own color, so a single-color chip would key
   *  the gold and purple fills with the blue one. Absent ⇒ the single `color`. */
  colors?: string[];
  /** Draw a hairline around a `rect` swatch. Set on annotation-derived fill rows, whose tint can be
   *  near-white (an `annotations.bands` fill is 10 % opaque) and would otherwise read as a gap.
   *  Off for series swatches, so bar/stacked legends stay byte-identical. */
  outlined?: boolean;
  /** True for synthetic rows (e.g. Total) that are not interactive series. */
  nonInteractive?: boolean;
  /** True for a row that keys an ANNOTATION (a band, a `shading` fill, a reference line, a rug
   *  track) rather than a series. Interactive, but in its own selection dimension: `series` holds
   *  the annotation key and the chart elements it names carry it as `data-annotation`. Separate
   *  from the series dimension because an element can only carry one `data-series` — a keyed
   *  `shading` fill needs to dim with its line AND light up with its annotation row. */
  annotation?: boolean;
  /** True for appended pseudo-series rows (e.g. the diverging Total) that are interactive
   *  but should sort AFTER the real series in the right-legend column. */
  isExtra?: boolean;
  /** `series_patterns` texture for this series, resolved against the colour actually painted.
   *  Present only for a textured series on a filled chart type — the swatch renders it as CSS
   *  gradients, and the PNG export re-emits it as a real `<pattern>`. Absent ⇒ flat fill,
   *  byte-identical to before the field existed. */
  hatch?: SeriesHatch;
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
  /** The key row for EVERY series, including the ones `legendItems` suppresses. Tooltips read this
   *  where `legendItems` is null (see buildSeriesKeyRows) so a lone series still keys correctly. */
  seriesKeyRows: LegendItem[];
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
  valueAffixes: ValueAffixes;
  xAxisTitle: string | null;
  /** Rows actually rendered (series-filtered), for the crosshair. */
  dataInScope: PreparedRow[];
  tooltipXParse?: (v: string) => number;
  tooltipXFormat?: (v: number) => string;
  /** `overlays[].tooltip: true` lines drawn in this frame — one hover-tooltip row each. Empty when
   *  no overlay opted in. See PaneResult.overlayTooltips. */
  overlayTooltips: OverlayTooltipLine[];
  /** Visual top-to-bottom stack order of the interactive series, for the RIGHT legend
   *  (stacked charts only). render-live uses it to order the vertical legend column. */
  legendVisualOrder?: string[];
  /** Stacked charts only. Mirrors MarkLayers.netMode — see spec/bar-stack.ts. */
  netMode?: NetMode;
}

function uniqueSeries(rows: PreparedRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) if (!seen.has(r.series)) { seen.add(r.series); out.push(r.series); }
  return out;
}

/** Series → colour. The palette is assigned BY POSITION, and `paletteOrder` (small multiples: the
 *  figure's full series list) decides whose position counts — see RenderOptions.paletteSeries.
 *  Absent, or a series it doesn't name, falls back to the position in `seriesNames`. */
export function buildColorMap(
  seriesNames: string[],
  seriesColorsCfg?: Record<string, string>,
  paletteOrder?: string[],
): Map<string, string> {
  const order = paletteOrder ?? [];
  const palette = tblColorScale(Math.max(seriesNames.length, order.length));
  const m = new Map<string, string>();
  seriesNames.forEach((s, i) => {
    const override = resolveColor(seriesColorsCfg?.[s]);
    const at = order.indexOf(s);
    m.set(s, override || (palette[at >= 0 ? at : i] as string));
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
  valueAffixes: ValueAffixes;
  /** The y-domain this pane was rendered against (after the auto/hard/bar-extent resolution,
   *  or the forced opts.yDomain). The shared-mode orchestrator probe-renders over all rows and
   *  reads this to obtain the one shared domain. */
  yDomain: [number, number];
  /** Formats a value the way this pane's value AXIS does (decimal places derived from its tick
   *  set, plus the chart's affixes). Carried so a `{value}` token in a keyed annotation's legend
   *  label reads exactly as the in-frame label would have. */
  formatValue: (v: number) => string;
  dataInScope: PreparedRow[];
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
  const cols = resolveColumns(spec, rows);

  // Histogram: raw rows are binned (or pre-binned x0/x1/value read directly) into `_x0/_x1/_y`
  // PreparedRows, then rendered through the shared pane tail with a continuous histogram adapter.
  if (spec.chartType === "histogram") {
    return renderHistogramPane(spec, rows, opts, classNameSuffix, facetInfo, cols, xType);
  }

  const adapter = makeXAdapter(xType, spec.xAxisPolicy, undefined, spec.tooltip_x_format);

  // `overlays[].column` names an author-chosen data column, so no canonical PreparedRow field can
  // hold it — carry the ones this spec actually asks for, keyed by name. No overlays ⇒ no field ⇒
  // byte-identical rows.
  const overlayCols = Array.from(
    new Set((spec.overlays ?? []).map((o) => o.column).filter((c): c is string => !!c)),
  );

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
      // Waterfall step kind (delta/total/skip).
      if (cols.kind) row._kind = r[cols.kind] ?? "";
      if (spec.projected_field) {
        row._projected = isTruthyFlag(r[spec.projected_field]);
      }
      (row as unknown as Record<string, unknown>)[adapter.xField] = adapter.parseX(xRaw);
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

  return assemblePaneResult(spec, opts, classNameSuffix, facetInfo, adapter, cols, data);
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
  facetInfo: FacetInfo | undefined,
  cols: ResolvedColumns,
  xType: NonNullable<ChartSpec["xAxisType"]>,
): PaneResult {
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
      opts.binThresholds ??
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

  if (!binned.length) throw new Error("No data.");

  const adapter = makeXAdapter(xType, spec.xAxisPolicy, histogramDomainOf(binned), spec.tooltip_x_format);
  return assemblePaneResult(spec, opts, classNameSuffix, facetInfo, adapter, cols, binned);
}

/** Shared pane-assembly tail: series order/colors → annotations → y-axis → x-opts → markBuilder →
 *  assemblePlot → PaneResult. Consumed by BOTH the standard parse path (line/bar/…, which passes a
 *  data-fitted adapter) and the histogram path (which passes binned `_x0/_x1/_y` rows + a
 *  bin-edge-domain adapter). The y-extent block branches per chartType (histograms: `_y`, include 0). */
function assemblePaneResult(
  spec: ChartSpec,
  opts: RenderOptions,
  classNameSuffix: string | undefined,
  facetInfo: FacetInfo | undefined,
  adapter: XAdapter,
  cols: ResolvedColumns,
  data: PreparedRow[],
): PaneResult {
  // Series order + colors. When series_order is set it acts as both filter and order.
  const seriesNames =
    spec.series_order && spec.series_order.length
      ? spec.series_order.filter((s) => data.some((r) => r.series === s))
      : uniqueSeries(data);
  const seriesSet = new Set(seriesNames);
  const dataInScope = data.filter((r) => seriesSet.has(r.series));
  const colors = buildColorMap(seriesNames, spec.series_colors, opts.paletteSeries);
  // Single-series charts driven by a colored inline title selector (e.g. a by-industry picker)
  // adopt the selector's color, so the line matches the selector's tinted label. Multi-series
  // charts keep their distinct palette/series_colors untouched — see RenderOptions.accentColor.
  if (opts.accentColor && seriesNames.length === 1) {
    colors.set(seriesNames[0]!, opts.accentColor);
  }

  // Categorical x render order. Every downstream consumer (the band scale via adapter.buildXOpts,
  // the mark builders, the x-label collision check) reads the category order from dataInScope's
  // row order, so a single stable sort here fixes the order everywhere. Listed categories first in
  // x_order; unlisted ones keep their encounter order after (order-only — unlike series_order,
  // x_order does NOT filter). Stable sort preserves within-category row order. No-op off the
  // categorical axis.
  const catOrder = categoryOrderFor(spec);
  if (spec.xAxisType === "categorical" && catOrder && catOrder.length) {
    const rank = new Map(catOrder.map((c, i) => [c, i] as const));
    const last = catOrder.length;
    dataInScope.sort((a, b) => (rank.get(a._xc ?? "") ?? last) - (rank.get(b._xc ?? "") ?? last));
  }

  // Y-axis: fold CI band bounds into the computed range when present, plus any horizontal
  // reference-line (yAxisPolicy.markers) values so a marker at/beyond the data extent gets a
  // little headroom instead of sitting flush against the axis edge.
  // Small multiples: scope markers with a `facet` key to THIS pane before anything below reads
  // `ann` — the extent folding a few lines down (markerYs / yForAxis) must see the FILTERED set
  // so a marker beyond one pane's own range doesn't widen every pane's domain. Undefined
  // paneFacetValue (single chart) returns `ann` unchanged (byte-identical).
  const ann = filterAnnotationsByFacet(resolveAnnotations(spec), opts.paneFacetValue);

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

  // Numeric extent of the parsed x values — lets assemblePlot estimate label px positions for
  // annotation-label collision avoidance (numeric/temporal axes only; categorical → undefined).
  // Computed HERE, above the y-extent block, because the `column` overlay fold a few lines down
  // needs it to crop by the entry's `domain` (see below) — xOpts, which the draw-time overlay
  // resolution prefers, is not built until much later.
  const xExtentVals = dataInScope
    .map((r) =>
      adapter.xField === "_xd" ? r._xd?.getTime() : adapter.xField === "_xn" ? r._xn : undefined,
    )
    .filter((v): v is number => Number.isFinite(v as number));
  const xExtent: [number, number] | undefined = xExtentVals.length
    ? [Math.min(...xExtentVals), Math.max(...xExtentVals)]
    : undefined;

  // Y-axis: fold CI band bounds into the computed range when present, plus any horizontal
  // reference-line (yAxis markers) values + point-callout y values so an annotation at/beyond the
  // data extent gets a little headroom instead of sitting flush against the axis edge.
  const yForAxis: Array<number | null | undefined> = [
    ...dataInScope.map((d) => d._y),
    ...dataInScope.map((d) => d._lo).filter(Number.isFinite),
    ...dataInScope.map((d) => d._hi).filter(Number.isFinite),
    ...ann.yAxis.map((m) => m.y),
    ...resolvedPoints.map((p) => p.y).filter((v): v is number => Number.isFinite(v as number)),
    // A `column` overlay is real per-row data — the same kind of thing as the CI bounds two lines up
    // — so it folds into the extent rather than being clipped. The CONSTRUCTED kinds (method, fun,
    // slope+intercept) deliberately do not: `domain: axis` extrapolates as far as the frame goes, and
    // letting a steep fit dictate the axis is what the clip exists to prevent.
    //
    // Scoped to what THIS pane draws — `facet` and `domain` both, via the same code the geometry
    // uses (overlays.ts#overlayColumnValues). An unscoped fold widened every pane's axis to the
    // overlay's range, and in `mode: "shared"` the unioned domain then flattened the lot.
    // `xDomain` is the DATA extent, not xOpts' resolved axis domain (unavailable this early): they
    // differ only in that the axis domain is the WIDER of the two (x-adapter fits the data, or
    // anchors at zero), and every value this reads sits at the x of a row — inside the data extent
    // either way — so `domain: "axis"` crops identically.
    ...overlayColumnValues(spec, dataInScope, {
      xField: adapter.xField,
      seriesNames,
      ...(opts.paneFacetValue != null ? { paneFacetValue: opts.paneFacetValue } : {}),
      ...(xExtent ? { xDomain: xExtent } : {}),
    }),
  ];
  const policy = spec.yAxisPolicy ?? {};
  const tickCount = policy.tickCount ?? 5;
  const chartType = spec.chartType;

  let hardDomain: [number, number] | null;
  let includeZero: boolean;

  // Value-axis reference markers, for the branches that fold them in so a marker stays visible.
  // The value axis is x on a horizontal chart, so annotations.xAxis plays the yAxis role there
  // (see assemblePlot's horizontal xAxis marker path).
  const valueAxisMarkers = (): number[] =>
    [
      ...ann.yAxis.map((m) => m.y),
      ...(spec.orientation === "horizontal" ? ann.xAxis.map((m) => Number(m.x)) : []),
    ].filter(Number.isFinite);

  if (chartType === "bar" || chartType === "stacked") {
    // Bar/stacked: zero baseline by default (axis extent from stacked totals + value-label
    // headroom). An explicit yAxisPolicy.min OPTS OUT of the forced zero — a truncated bar axis
    // (use sparingly; e.g. a level series whose variation is small relative to its magnitude).
    // Reference-line (markers) values are folded into the extent so a marker stays visible.
    includeZero = policy.min == null;
    hardDomain = resolveHardDomain({
      min: policy.min,
      max: policy.max,
      auto: computeBarYExtent(dataInScope, spec, chartType),
      fold: valueAxisMarkers(),
    });
  } else if (chartType === "dumbbell") {
    // Dumbbell: dots are POSITIONS, so the value axis fits the padded data extent and does NOT
    // force zero (see computeDumbbellValueExtent). Orientation is handled by the mark (horizontal
    // puts the value on x via yScaleOpts).
    includeZero = false;
    hardDomain = resolveHardDomain({
      min: policy.min,
      max: policy.max,
      auto: computeDumbbellValueExtent(dataInScope.map((d) => d._y)),
      fold: valueAxisMarkers(),
    });
  } else if (chartType === "histogram") {
    // Histogram: the value axis is the (possibly normalized) bin height `_y`, which yForAxis
    // already carries. Zero baseline is mandatory (bars grow from 0); an explicit min+max opts
    // into a fixed domain, otherwise auto-fit-from-zero.
    includeZero = true;
    hardDomain = resolveHardDomain({ min: policy.min, max: policy.max });
  } else if (chartType === "waterfall") {
    // Waterfall: the value axis must span the running CUMULATIVE path (bar bases/tops, including
    // total bars), not the raw deltas — computed by the same stepper the mark builder uses so the
    // axis and bars agree. Zero baseline; reference-line (yAxis) values fold in for headroom.
    includeZero = policy.min == null;
    hardDomain = resolveHardDomain({
      min: policy.min,
      max: policy.max,
      auto: computeWaterfallYExtent(dataInScope),
      fold: ann.yAxis.map((m) => m.y).filter(Number.isFinite),
    });
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
    hardDomain = resolveHardDomain({
      min: policy.min,
      max: policy.max,
      auto: { min: Math.min(0, minVal), max: stackMax },
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
      if (finite.length) {
        if (reversed) {
          const dataMin = Math.min(...finite);
          if (dataMin < yMax) yMax = Math.floor(dataMin / step) * step;
        } else {
          const dataMax = Math.max(...finite);
          if (dataMax > yMax) yMax = Math.ceil(dataMax / step) * step;
        }
      }
    }
    hardDomain = resolveHardDomain({ min: policy.min, max: yMax });
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
  // tagCategoryLabels: the hover-accent hook (task 17) is bar/stacked-only — categorical-x line
  // and dot-plot charts share this same adapter path and stay byte-identical.
  // X-axis rug: the strip occupies space between the plot frame and the tick labels. Handed to the
  // adapter as a bottom GUTTER, which it adds to both its marginBottom and its tick-label dy — so
  // the room made and the offset taken are one number applied in one place. assemblePlot draws the
  // strip into that gap and must NOT re-add it. 0 when the chart has no rug tracks.
  const xOpts = adapter.buildXOpts(dataInScope, {
    faceted: facetInfo != null,
    labelMode: xLabelMode,
    tagCategoryLabels: chartType === "bar" || chartType === "stacked",
    bottomGutter: rugAllowance(spec),
  });
  // Faceted vertical bars: the figure forces a shared bottom margin (the max across panes) so every
  // pane's baseline lines up regardless of its own label length. Flows to plotHeight + assemblePlot.
  if (opts.marginBottom != null) xOpts.marginBottom = opts.marginBottom;
  const valueAffixes = resolveValueAffixes(spec);

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
    // Inline-selector accent: let a no-series/single-series bar chart recolor its bars to the
    // active option's color (the bar analogue of the single-series line recolor above). The bar
    // mark makes it win over bar_color/default; multi-series charts keep their palette.
    ...(opts.accentColor ? { accentColor: opts.accentColor } : {}),
    // Horizontal faceted bars: suppress category labels on non-leftmost panes; use the shared gutter.
    ...(opts.hideCategoryLabels ? { hideCategoryLabels: true } : {}),
    ...(opts.categoryGutter != null ? { categoryGutter: opts.categoryGutter } : {}),
    // This pane's facet identity (per-pane small multiples) — for hooks.valueLabel's ctx.facet.
    ...(opts.paneFacetValue != null ? { facet: opts.paneFacetValue } : {}),
    // Programmatic render hooks (spec/hooks.ts) — only `valueLabel` is consumed by mark builders.
    ...(opts.hooks ? { hooks: opts.hooks } : {}),
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
    // do), else the data extent — the widest honest answer available.
    const axisDomain = (xOpts.xPlotOpts?.domain as [number, number] | undefined) ?? xExtent;
    const resolvedOverlays = resolveOverlays(spec, dataInScope, {
      xField: adapter.xField as "_xn" | "_xd",
      colors,
      seriesNames,
      legendActive: spec.legend !== false,
      ...(axisDomain ? { xDomain: axisDomain } : {}),
    }).filter((o) => overlayDrawsInPane(o.facet, opts.paneFacetValue));
    overlayTooltips = overlayTooltipLines(spec.overlays, resolvedOverlays);
    // NOT actually wired for shared-mode small multiples: `facetInfo` here only turns on the
    // fx/fy CHANNEL NAMES passed to `buildOverlayMarks`, but the `OverlayRow` objects it builds
    // (marks/overlay.ts) carry no `_fxCol`/`_fyRow` fields — those channels would resolve to
    // `undefined` on every row if this path ever ran. Unreachable today: no production caller
    // (engine/figure.ts) supplies `facetInfo` to `renderPane`; only a test does. Wiring this for
    // real needs `runsOf`/the band mapper in marks/overlay.ts to stamp the resolved overlay's
    // `facet` value onto each row as `_fxCol`/`_fyRow` before this reaches that point.
    const om = buildOverlayMarks(resolvedOverlays, spec.overlays ?? [], {
      xField: adapter.xField as "_xn" | "_xd",
      ...(facetInfo ? { fxField: "_fxCol", fyField: "_fyRow" } : {}),
    });
    layers.underlay.push(...om.underlay);
    layers.overlay.push(
      ...om.overlay,
      // Labels last within the overlay layer, so they paint over their own lines. They still sit
      // BELOW assemblePlot's annotation labels (pushed at its step 8) — correct precedence: an
      // `annotations` placement is the more deliberate one, and both are nudgeable.
      ...buildOverlayLabelMarks(resolvedOverlays, {
        xField: adapter.xField as "_xn" | "_xd",
        ...(facetInfo ? { fxField: "_fxCol", fyField: "_fyRow" } : {}),
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
    points: resolvedPoints,
    ...(xExtent ? { xExtent } : {}),
    width: opts.width,
    height: opts.height,
    marginRight: opts.marginRight,
    document: opts.document,
    classNameSuffix,
    hooks: opts.hooks,
    ...(facetOpt ? { facet: facetOpt } : {}),
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
    layers,
    seriesHatches,
    seriesPainted,
    tooltipXParse: xOpts.tooltipXParse,
    tooltipXFormat: xOpts.tooltipXFormat,
    overlayTooltips,
  };
}

/** The key row EVERY series gets, whether or not a legend is drawn.
 *
 *  Split out of `buildLegendItems` because a tooltip needs a key for a series the legend suppressed.
 *  A single, unstyled series draws no legend on any chart type — see `legendShowsSeriesRows`, which
 *  is the exact rule; a lone DASHED line still gets rows, and `legend: false` suppresses them at any
 *  series count — yet every one of those charts still shows tooltips. Those tooltips used to
 *  re-derive a key from loose channels — `swatchShape`, `hatches`, `swatchMarkers`, `dashedSeries` —
 *  a second, partial copy of the table below that drifted from it: a lone dot plot keyed a LINE, and
 *  a lone dumbbell keyed a plain DOT rather than the sized, box-centred symbol its legend row draws.
 *  Deriving both from this one function is what makes the drift impossible: the suppressed row and
 *  the tooltip key are built by the same code from the same inputs. Under `renderChart` they are the
 *  SAME OBJECTS — it builds them once and hands them to `buildLegendItems` — so nothing may mutate a
 *  returned row. `renderFigure` still builds twice, because a pane's rows and the FIGURE legend's are
 *  resolved from different series and colour maps; those two are deep-equal only when they agree.
 *
 *  A row's TEXTURE is not derived here at all: `paintedHatches` is what the marks were painted, and
 *  a row takes that object unchanged. The alternative — resolving the hatch from the colour map, as
 *  this did — agreed with the marks only by coincidence, since `bar_color`/`category_colors`/the
 *  selector accent override a mark's fill without reaching that map and merely happen to be
 *  single-series (so no legend series rows) today.
 *
 *  So this applies NO presence rule — `buildLegendItems` owns "is a legend worth drawing", this owns
 *  "what would this series' key look like". */
export function buildSeriesKeyRows(
  spec: ChartSpec,
  seriesNames: string[],
  colors: Map<string, string>,
  layers: MarkLayers,
  /** Series → the texture the MARKS were painted (`PaneResult.seriesHatches`). REQUIRED, and there
   *  is deliberately no colour-map fallback: a key's ground must be the ground its mark is drawn
   *  over, and the only thing that knows that is the render. See `AssembleResult.seriesHatches`. */
  paintedHatches: Map<string, SeriesHatch>,
  /** Series → the flat colour its FILLED marks were painted (`PaneResult.seriesPainted`). Preferred
   *  over any colour map for the same reason the hatch ground is: `highlightSeries` dims through a
   *  literal per-mark fill, so a dimmed series' chip read its palette colour beside grey bars. Absent
   *  for a series whose marks are not filled, where the colour map is correct.
   *
   *  REQUIRED, like `paintedHatches` and for the same reason: a default would let a new call site
   *  silently fall back to the colour map, which is the bug. */
  paintedColors: Map<string, string>,
): LegendItem[] {
  const chartType = spec.chartType;
  const seriesLabels = spec.series_labels ?? {};
  const labelFor = (name: string): string => seriesLabels[name] ?? name;
  // When the mark layer is the source of truth for series colors (stacked: mono tiers or
  // categorical), use those for the legend swatches so the legend matches the bars.
  const legendColorFor = (name: string): string | undefined =>
    paintedColors.get(name) ?? layers.seriesColors?.get(name) ?? colors.get(name);


  let items: LegendItem[];
  if (chartType === "scatter" || chartType === "dotplot") {
    // Point charts (scatter / dotplot): the COLOR (series) legend. Swatch is a filled colored
    // marker — the per-series symbol when shape encodes the same field (redundant → combined
    // legend), otherwise a plain circle (shape is carried by the separate shape legend).
    //
    // A SEPARATE shape legend exists when shape is its own channel (distinct values, not the
    // series). In that case the color legend must NOT use a point shape (a circle/square here
    // would be ambiguous with the shape legend's symbols) — use a color chip (rounded square)
    // instead. Redundant encoding → the combined legend shows the actual colored marker shape;
    // no shape channel → the actual (circle) marker.
    const distinctShape = !!(layers.shapeNames && layers.shapeNames.length && !layers.shapeIsSeries);
    items = seriesNames.map((name, i) => {
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
  } else if (chartType === "dumbbell") {
    // Dumbbell: one dot per series, styled by its marker (filled/ink → solid colored dot; hollow →
    // ring). Colors come from layers.seriesColors (ink resolves to the ink token there).
    items = seriesNames.map((name) => ({
      series: name,
      label: labelFor(name),
      color: legendColorFor(name),
      dashed: false,
      markerShape: "point" as const,
      markerSymbol: "circle",
      ...((spec.series_marker?.[name] ?? "filled") === "hollow" ? { hollow: true } : {}),
    }));
  } else {
    // Every chart type whose marks are FILLED keys with a chip; only stroked marks get a line
    // swatch. An area is a filled region, so a line swatch always misrepresented it — and a 3px line
    // cannot hold a texture, so a hatched area series had no way to show its glyph. Pinned against
    // spec/filled-chart-types.ts by test, since a new filled type that forgot this would lose
    // its texture in the key silently.
    const markerShape: "line" | "rect" =
      chartType === "bar" ||
      chartType === "stacked" ||
      chartType === "histogram" ||
      chartType === "area" ||
      chartType === "waterfall"
        ? "rect"
        : "line";
    // Line charts with point markers: each series carries its marker shape so the legend swatch
    // shows the same symbol as the chart (assigned by series index, matching the symbol scale).
    const withSymbols = markerShape === "line" && spec.points === true;
    items = seriesNames.map((name, i) => ({
      series: name,
      label: labelFor(name),
      color: legendColorFor(name),
      dashed: spec.series_styles?.[name]?.dashed === true,
      markerShape,
      ...(withSymbols ? { markerSymbol: markerSymbolForIndex(i) } : {}),
    }));
  }

  // Attach the PAINTED textures, on EVERY chart-type path so a new chart type cannot forget them.
  // The row carries the very object the mark was drawn from, so its ground cannot be a ground the
  // chart does not paint — and a textured series is keyed by a CHIP whatever its chart type (see
  // icon.ts: an area series' 18×3 line swatch is thinner than the glyph, so left as a line its
  // texture would never appear).
  if (!paintedHatches.size) return items;
  return items.map((item) => {
    const hatch = paintedHatches.get(item.series);
    return hatch ? { ...item, hatch } : item;
  });
}

/** Whether a legend DRAWS one row per series. A lone series has nothing to distinguish, so its row
 *  would be a restatement of the title — except when a dash override makes the style itself the
 *  thing being named. Point/dumbbell charts have no dash channel, so they key on count alone. */
function legendShowsSeriesRows(spec: ChartSpec, seriesNames: string[], layers: MarkLayers): boolean {
  if (seriesNames.length > 1) return true;
  const chartType = spec.chartType;
  if (chartType === "scatter" || chartType === "dotplot" || chartType === "dumbbell") return false;
  return layers.dashedNames.size > 0;
}

/** Build the legend rows from a spec + a rendered pane's series order / colors / mark layers.
 *  Shared by renderChart (single frame) and renderFigure (figure-level legend), so both decide
 *  legend presence and ordering identically. Returns null for a single, unstyled series. */
export function buildLegendItems(
  spec: ChartSpec,
  seriesNames: string[],
  colors: Map<string, string>,
  layers: MarkLayers,
  /** The series key rows, already built by the caller (`buildSeriesKeyRows`). Passed rather than
   *  built here so the legend row and the tooltip key are ONE object, and so the only way to get a
   *  row is to have the painted hatches a row needs — there is no second construction site that
   *  could resolve a key's ground from anything but the render. */
  keyRows: LegendItem[],
  /** The pane's value-axis formatter (`PaneResult.formatValue`), used only for a `{value}` token in
   *  a keyed annotation label. Omitted → the token falls back to a bare number. */
  formatValue?: (v: number) => string,
): LegendItem[] | null {
  if (spec.legend === false) return null;
  const baseItems = legendShowsSeriesRows(spec, seriesNames, layers) ? keyRows : null;

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
  // Annotation-derived rows (bands / shading / reference lines opted in with `legend: true`) come
  // last, on EVERY chart-type path — a suppressed series list leaves `baseItems` null rather than
  // returning, because assemble-plot suppresses a keyed entry's in-frame label by asking the SPEC,
  // not the legend. An early return here would drop the row while the label stayed suppressed, and
  // the name would vanish from the chart entirely. Like the extras above these may be the ONLY
  // rows — a single-series chart whose subject is its annotations gets a legend built from them.
  const annotationRows = buildAnnotationLegendItems(spec, seriesNames, colors, {
    ...(formatValue ? { formatValue } : {}),
  });
  if (annotationRows.length) {
    legendItems = legendItems ? [...legendItems, ...annotationRows] : annotationRows;
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
