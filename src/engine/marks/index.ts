// Mark-builder registry, keyed on chartType. v1 has `line` only; adding bar/stacked/
// small-multiples later means writing a builder and registering it here — the rest of
// the engine (data prep, axes, assemble, render) is chart-type agnostic.
import type { ChartSpec, ChartType } from "../../spec/types";
import { buildLineMarks } from "./line";
import { buildBarMarks } from "./bar";
import { buildStackedMarks } from "./stacked";

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
  /** Confidence-band bounds, when the row's series has a band. */
  _lo?: number;
  _hi?: number;
  /** Small-multiples (shared mode): the pane's facet value (distinct value of the configured
   *  facet_field that splits this row's pane). */
  _facet?: string;
  /** Small-multiples (shared mode): the pane's grid COLUMN index as a String, bound to Plot's
   *  `fx` facet channel by the orchestrator-built marks. */
  _fxCol?: string;
  /** Small-multiples (shared mode): the pane's grid ROW index as a String, bound to Plot's
   *  `fy` facet channel. */
  _fyRow?: string;
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
}

export interface MarkLayers {
  /** Marks painted behind the gridlines (e.g. confidence bands). */
  underlay: unknown[];
  /** Marks painted on top of the chrome (the lines). */
  overlay: unknown[];
  /** Post-render data-series tagging. For each entry, the elements matched by `selector`
   *  (in DOM order) are tagged data-series from `seriesOrder` by index. */
  tagging: { selector: string; seriesOrder: string[] }[];
  /** Series rendered dashed (drives legend swatches + tooltip styling). */
  dashedNames: Set<string>;
  /** Optional: a mark layer that owns its x-scale (bars) supplies band-scale options here;
   *  merged over the adapter's x options in assemblePlot. */
  xScaleOpts?: Record<string, unknown>;
  /** Optional: per-series symbol scale (line point markers) — {domain: series, range: shapes}.
   *  Threaded to plotOpts.symbol so each series gets a distinct marker shape. */
  symbolScaleOpts?: { domain: string[]; range: string[] };
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

const REGISTRY: Record<ChartType, MarkBuilder> = {
  line: buildLineMarks,
  bar: buildBarMarks,
  stacked: buildStackedMarks,
};

export function markBuilderFor(chartType: ChartType): MarkBuilder {
  const builder = REGISTRY[chartType];
  if (!builder) throw new Error(`No mark builder registered for chartType: ${chartType}`);
  return builder;
}
