// Mark-builder registry, keyed on chartType. v1 has `line` only; adding bar/stacked/
// small-multiples later means writing a builder and registering it here — the rest of
// the engine (data prep, axes, assemble, render) is chart-type agnostic.
import type { ChartSpec, ChartType } from "../../spec/types";
import type { BandLabelMode } from "../axes";
import { buildLineMarks } from "./line";
import { buildAreaMarks } from "./area";
import { buildBarMarks } from "./bar";
import { buildStackedMarks } from "./stacked";
import { buildPointMarks } from "./point";
import { buildWaterfallMarks } from "./waterfall";

/** A data row after parsing: canonical series/time plus the engine's derived fields. */
export interface PreparedRow {
  series: string;
  time: string;
  _y: number | null;
  /** Parsed numeric x (numeric axis). */
  _xn?: number;
  /** Parsed date x (temporal/quarterly axis). */
  _xd?: Date | null;
  /** Parsed categorical x (band axis) — the raw string category key. */
  _xc?: string;
  /** Histogram bin edges (numeric, or epoch-ms for temporal). Present on binned/pre-binned rows. */
  _x0?: number;
  _x1?: number;
  /** Confidence-band bounds, when the row's series has a band. */
  _lo?: number;
  _hi?: number;
  /** Point charts (scatter / dotplot): the raw shape-encoding value (from columns.shape).
   *  Drives the marker symbol independently of `series` (color). Absent ⇒ no shape channel. */
  _shape?: string;
  /** Horizontal sectioned bars: the row's section value (from columns.section). Drives the
   *  section-ordered category band + section headers. Absent ⇒ no sections. */
  _section?: string;
  /** Small-multiples (shared mode): the pane's facet value (distinct value of the configured
   *  facet_field that splits this row's pane). */
  _facet?: string;
  /** Waterfall charts: the row's step kind from `columns.kind` — "total"/"skip"/else delta.
   *  Absent when the column isn't mapped (⇒ every row is a delta). */
  _kind?: string;
  /** Small-multiples (shared mode): the pane's grid COLUMN index as a String, bound to Plot's
   *  `fx` facet channel by the orchestrator-built marks. */
  _fxCol?: string;
  /** Small-multiples (shared mode): the pane's grid ROW index as a String, bound to Plot's
   *  `fy` facet channel. */
  _fyRow?: string;
  /** Set when `spec.projected_field` is configured: true when this row's flag column parsed
   *  truthy (`1`/`true`/`yes`, case-insensitive, trimmed). Absent when the field isn't
   *  configured. Drives the line dashed-run split (marks/projected.ts) and the area fade veil. */
  _projected?: boolean;
}

export interface MarkContext {
  /** In-memory field holding the parsed x value (`_xn`, `_xd`, or `_xc`). */
  xField: string;
  /** series key → resolved color. */
  colors: Map<string, string>;
  /** Resolved, ordered series names (for bar builders that need positional info). */
  seriesNames?: string[];
  /** Inner plot width in px (outer width minus left+right margins). Approximate — bar
   *  builders use this for px-based label-suppression logic. */
  plotWidth?: number;
  /** Inner plot height in px (outer height minus top+bottom margins). Approximate. */
  plotHeight?: number;
  /** Small-multiples (shared mode): the PreparedRow field bound to Plot's `fx` (column)
   *  facet channel — set by the figure orchestrator (`"_fxCol"`). When present, mark builders
   *  must bind `fx` on their marks so they face into the grid. Absent → single frame. */
  fxField?: string;
  /** Small-multiples (shared mode): the PreparedRow field bound to Plot's `fy` (row) facet
   *  channel (`"_fyRow"`). Bound alongside `fxField`. */
  fyField?: string;
  /** Small-multiples (either mode): this mark belongs to a (small) pane, so line marks render
   *  with the thinner pane stroke (TBL.strokeWidth.pane). Set by the figure orchestrator for
   *  BOTH shared- and per-pane panes; absent → single chart → default solid stroke. */
  pane?: boolean;
  /** Categorical x-axis label layout ("wrap" → two lines, "rotate" → 45°), decided in renderChart
   *  from width + labels to avoid collision. Grouped bars use it for their `fx` group labels. */
  xLabelMode?: BandLabelMode;
  /** Point charts: the PreparedRow field holding the shape value (`"_shape"`) when a shape
   *  channel is active. Absent ⇒ single shape (circle). */
  shapeField?: string;
  /** Point charts: the ordered distinct shape values driving the symbol scale + shape legend
   *  (from spec.shape_order, else data-encounter order). */
  shapeNames?: string[];
  /** Point charts: true when the shape column IS the series column (redundant color+shape
   *  encoding) — the symbol scale then keys off series identity and the legend is combined. */
  shapeIsSeries?: boolean;
  /** Bars: clip marks to the plot frame. Set when the y-domain excludes 0 (a truncated/non-zero
   *  baseline), so bars drawn from 0 don't overflow below the plot into the x-axis labels. */
  clipMarks?: boolean;
  /** Area: visual stack order bottom→top, overriding series_order for stacking only (legend +
   *  colors stay series_order). Set by the live layer for selected-to-bottom restacking. */
  stackOrder?: string[];
  /** Inline-title-selector color accent (already palette-resolved). When present on a single-
   *  series OR no-series bar chart, it becomes the bar fill — winning over `bar_color`/default so
   *  the bars match the selector's tinted label (`category_colors` still overrides per-category).
   *  Absent → bars keep bar_color/palette. Set from RenderOptions.accentColor. */
  accentColor?: string;
  /** Horizontal bars in shared-mode small multiples, non-leftmost panes: omit the category
   *  (y-band) labels so they show only on the leftmost pane. The category band domain is shared,
   *  so rows still align. Absent → labels emitted (single-chart + leftmost pane unchanged). */
  hideCategoryLabels?: boolean;
  /** Horizontal bars in shared-mode small multiples: the shared left-gutter width (px) to use for
   *  the category labels + plot left margin, computed once by the figure orchestrator over the
   *  shared category set so every pane uses the SAME gutter. Absent → the builder computes its own
   *  via horizontalLeftGutter (single-chart unchanged). */
  categoryGutter?: number;
  /** The pane's final computed y-domain (post auto/hard/bar-extent resolution, or the forced
   *  shared-mode override) — the SAME value assemblePlot uses for the value axis. The area
   *  builder's projected-range veil rect needs it to span the full plot height ([y1,y2] =
   *  yDomain) without recomputing the axis. Other builders may ignore it. */
  yDomain?: [number, number];
}

export interface MarkLayers {
  /** Marks painted behind the gridlines (e.g. confidence bands). */
  underlay: unknown[];
  /** Marks painted on top of the chrome (the lines). */
  overlay: unknown[];
  /** Optional: a "veil" layer painted immediately above `overlay` — currently only the area
   *  builder's projected-range fade rect(s), which must paint over the area fill but UNDER the
   *  xAxis marker rules (fix-wave I1: painting it as part of `overlay` washed a marker rule
   *  drawn inside the veiled range out to the veil's fill-opacity). assemblePlot pushes this
   *  right after `overlay` and, only when present, defers the vertical xAxis marker-rule push
   *  until after both — absent veil (the overwhelming majority of charts) keeps today's exact
   *  push order, so non-area / non-projected output stays byte-identical. */
  veil?: unknown[];
  /** Post-render data-series tagging. For each entry, the elements matched by `selector`
   *  (in DOM order) are tagged data-series from `seriesOrder` by index. When `shapeOrder` is
   *  present (point charts), the same elements are ALSO tagged data-shape by index, so the shape
   *  legend can dim by shape value independently of the color (series) legend. */
  tagging: { selector: string; seriesOrder: string[]; shapeOrder?: string[]; categoryOrder?: string[] }[];
  /** Series rendered dashed (drives legend swatches + tooltip styling). */
  dashedNames: Set<string>;
  /** Optional: a mark layer that owns its x-scale (bars) supplies band-scale options here;
   *  merged over the adapter's x options in assemblePlot. */
  xScaleOpts?: Record<string, unknown>;
  /** Optional: per-series symbol scale (line point markers) — {domain: series, range: shapes}.
   *  Threaded to plotOpts.symbol so each series gets a distinct marker shape. */
  symbolScaleOpts?: { domain: string[]; range: string[] };
  /** Point charts: the ordered distinct shape values (symbol-scale domain), for the shape
   *  legend. Absent for non-point layers / when no shape channel is active. */
  shapeNames?: string[];
  /** Point charts: true when shape encodes the same field as color (series) — the legend is
   *  then a single combined group of colored shapes rather than two groups. */
  shapeIsSeries?: boolean;
  /** Optional: faceted-group band scale options (vertical grouped bars use `fx`). */
  fxScaleOpts?: Record<string, unknown>;
  /** Optional: faceted-group band scale options for HORIZONTAL grouped bars, which facet
   *  the categories onto `fy` (row facets) with the inner series band on `y`. Presence of
   *  this signals assemblePlot to run the fy-oriented facet-chrome collapse (continuous
   *  full-height vertical gridlines + one value-axis label row at the bottom). */
  fyScaleOpts?: Record<string, unknown>;
  /** Optional: a mark layer that owns the y-scale (horizontal bars put the category band
   *  on `y`) supplies y-scale options here; merged over assemblePlot's value-axis y. When
   *  present, assemblePlot treats the chart as horizontal: it skips the vertical value
   *  chrome (horizontal gridlines / y-tick labels) and the layer supplies its own. */
  yScaleOpts?: Record<string, unknown>;
  /** Which Plot scale carries the category band ("x" default, "fx" for grouped bars). */
  xScaleField?: "x" | "fx";
  /** Optional: a responsive LEFT margin (px) the layer wants applied. Horizontal bars set
   *  this to a gutter wide enough for their longest y-axis category label (see
   *  axes.horizontalLeftGutter); assemblePlot passes it to the Plot marginLeft so the labels
   *  are not clipped. Left undefined by vertical charts (they keep the default margin). */
  marginLeft?: number;
  /** Optional: a TOP margin (px) the layer wants applied. Sectioned horizontal bars set this to
   *  make room for the first section's header (which sits in the top margin, above the first bar).
   *  Left undefined otherwise → assemblePlot keeps the default marginTop. */
  marginTop?: number;
  /** Optional: a BOTTOM margin (px) the layer wants applied. Horizontal bars set this small (the
   *  category axis is on the LEFT, so the inherited categorical-label bottom margin is wasted —
   *  only the value-tick row needs room). Left undefined otherwise → default marginBottom. */
  marginBottom?: number;
  /** Optional: x-axis label marks supplied by the layer (grouped bars label the `fx`
   *  group scale, not the adapter's `x` scale). When present, used INSTEAD of the
   *  adapter's `xOpts.axisMarks` in assemblePlot. */
  xAxisMarks?: unknown[];
  /** Optional: extra legend rows beyond the per-series swatches (diverging stacked bars
   *  emit a "Total" row with a dot marker). `series` is the row's selection key — for the
   *  diverging Total it is TOTAL_SERIES_KEY, shared with the net dot/label `data-series` so
   *  the row and the chart markers pin/hover/dim together. Line/bar leave it undefined. */
  legendExtras?: { series: string; label: string; markerShape: "dot" }[];
  /** Optional: series → resolved fill color, when the mark layer is the source of truth
   *  for series colors (stacked bars: mono tonal tiers, else the categorical map). When
   *  present, renderChart uses these for the legend swatches so the legend matches the
   *  bars. Line/grouped-bar leave it undefined (the engine color map already matches). */
  seriesColors?: Map<string, string>;
  /** Optional: the visual top-to-bottom stack order of the interactive series, for the
   *  RIGHT (vertical) legend. For a diverging stack this is [positives reversed] ++
   *  [negatives in declaration order]; the non-interactive Total row is appended by the
   *  renderer. Non-stacked / top-legend charts leave it undefined. */
  legendVisualOrder?: string[];
  /** Controls how the band-crosshair tooltip renders the Total row for stacked charts.
   *  - true  (netMode==="dot"):  show Total with a circle (is-dot) swatch — the net-dot
   *    marker exists on the chart and matches this styling.
   *  - false (netMode==="text"): show Total as plain text with no swatch — the cumulative
   *    stack shows a text-above callout, not a dot.
   *  - undefined (netMode==="none"): omit the Total row entirely — netDisplay:"none" or
   *    normalized stacks suppress all net markers, so no Total should appear.
   *  Non-stacked mark layers leave this undefined. */
  showTotalDot?: boolean;
}

export type MarkBuilder = (data: PreparedRow[], spec: ChartSpec, ctx: MarkContext) => MarkLayers;

const REGISTRY: Partial<Record<ChartType, MarkBuilder>> = {
  line: buildLineMarks,
  area: buildAreaMarks,
  bar: buildBarMarks,
  stacked: buildStackedMarks,
  // Both point types share one builder; it branches on x-scale (numeric vs categorical point).
  scatter: buildPointMarks,
  dotplot: buildPointMarks,
  waterfall: buildWaterfallMarks,
};

export function markBuilderFor(chartType: ChartType): MarkBuilder {
  const builder = REGISTRY[chartType];
  if (!builder) throw new Error(`No mark builder registered for chartType: ${chartType}`);
  return builder;
}
