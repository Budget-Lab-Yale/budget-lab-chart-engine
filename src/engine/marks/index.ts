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
  /** Optional: faceted-group band scale options (grouped bars use `fx`). */
  fxScaleOpts?: Record<string, unknown>;
  /** Optional: a mark layer that owns the y-scale (horizontal bars put the category band
   *  on `y`) supplies y-scale options here; merged over assemblePlot's value-axis y. When
   *  present, assemblePlot treats the chart as horizontal: it skips the vertical value
   *  chrome (horizontal gridlines / y-tick labels) and the layer supplies its own. */
  yScaleOpts?: Record<string, unknown>;
  /** Which Plot scale carries the category band ("x" default, "fx" for grouped bars). */
  xScaleField?: "x" | "fx";
  /** Optional: x-axis label marks supplied by the layer (grouped bars label the `fx`
   *  group scale, not the adapter's `x` scale). When present, used INSTEAD of the
   *  adapter's `xOpts.axisMarks` in assemblePlot. */
  xAxisMarks?: unknown[];
  /** Optional: extra legend rows beyond the per-series swatches (diverging stacked bars
   *  emit a "Total" row with a dot marker). A7 only PRODUCES this metadata; A8 renders it.
   *  Line/bar leave it undefined. */
  legendExtras?: { label: string; markerShape: "dot" }[];
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
