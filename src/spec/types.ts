// The single contract for one chart. The ajv JSON-schema (schema.ts) and the engine
// both derive from this. One chart = one spec (no figure/tracker/nav wrapper).
//
// Ported and reduced from the AI Labor Market Tracker's chart-block schema
// (scripts/build-manifest.py + data/CONFIG-REFERENCE.md). v1 supports `line` only;
// `chartType` is a union so adding bar/etc. later is additive.

export type ChartType = "line" | "area" | "bar" | "stacked" | "scatter" | "dotplot";

export type XAxisType = "numeric" | "temporal" | "quarterly" | "categorical";

/** A named palette color (resolved via the Style-Guide tokens) or a raw "#hex". */
export type ColorRef = string;

export interface XAxisMarker {
  x: string;
  label?: string;
  style?: "dashed" | "solid";
  color?: ColorRef;
  strokeWidth?: number;
  /** Which SIDE of the (vertical) line the label sits — its relation to the line: "right" (default)
   *  = to the right of the line, "left" = to the left, "middle" = centered on the line. */
  labelSide?: "left" | "middle" | "right";
  /** WHERE along the (vertical) line the label sits, relative to the x-axis: "top" (default) = top
   *  of the plot (auto-staggered to avoid collisions), "middle" = vertical center, "bottom" = just
   *  above the x-axis. `labelDy` still nudges from there. */
  labelPosition?: "top" | "middle" | "bottom";
  /** Vertical nudge (px, signed: + = UP) of the label from its `labelPosition`. Default 0. */
  labelDy?: number;
  /** Horizontal nudge (px, signed: + = right) of the label from the line. Default 4. */
  labelDx?: number;
}

/** A shaded vertical region of the x-axis (e.g. a recession band). `start`/`end` are x values
 *  parsed under the chart's xAxisType (numeric year, date, quarter, or category). */
export interface XAxisBand {
  start: string;
  end: string;
  label?: string;
  /** Fill color; defaults to a subtle neutral gray. */
  color?: ColorRef;
}

export interface XAxisPolicy {
  /** Numeric axis only: extend the visible domain to include 0. Default FALSE (the axis fits its
   *  data range) — anchoring at zero is surprising for a year axis. */
  anchorAtZero?: boolean;
  /** Vertical reference lines (e.g. a treatment date). */
  markers?: XAxisMarker[];
  /** Shaded vertical regions painted behind the data (e.g. recession indicators). */
  bands?: XAxisBand[];
}

/** A horizontal reference line at a fixed y value (e.g. a target or assumption line). */
export interface YAxisMarker {
  y: number;
  label?: string;
  style?: "dashed" | "solid";
  color?: ColorRef;
  strokeWidth?: number;
  /** Which SIDE of the (horizontal) line the label sits — its relation to the line: "top" (default)
   *  = above the line, "middle" = centered on the line, "bottom" = below the line. */
  labelSide?: "top" | "middle" | "bottom";
  /** WHERE along the (horizontal) line the label sits: "right" (default) = right edge, right-aligned;
   *  "left" = left edge, left-aligned; "middle" = horizontally centered. */
  labelPosition?: "left" | "middle" | "right";
  /** Horizontal nudge (px, signed: + = right) of the label from its anchored edge. */
  labelDx?: number;
  /** Vertical nudge (px, signed: + = UP) of the label from its `labelPosition`. Default above. */
  labelDy?: number;
}

export interface YAxisPolicy {
  min?: number;
  max?: number;
  includeZero?: boolean;
  tickCount?: number;
  /** When data exceeds `max`, round the ceiling up to the next multiple of `step`. */
  autoWiden?: { step: number };
  /** Horizontal reference lines (e.g. assumption/target lines), drawn over the data. */
  markers?: YAxisMarker[];
}

/** A callout pointing at a data coordinate. `y` may be omitted when `series` is given (the label
 *  snaps to that series' value at `x`; for a stacked area, the cumulative top through that series).
 *  `dx`/`dy` nudge the label from the point; `connector` draws a short leader line to it. */
export interface PointCallout {
  x: string;
  y?: number;
  series?: string;
  label: string;
  color?: ColorRef;
  /** Horizontal nudge (px, signed: + = right) of the label from the point. */
  dx?: number;
  /** Vertical nudge (px, signed: + = UP) of the label from the point. */
  dy?: number;
  connector?: boolean;
}

/** Unified annotation block: vertical reference lines (xAxis), horizontal reference lines (yAxis),
 *  shaded vertical regions (bands), and point callouts (points). When present, these take
 *  precedence over the legacy xAxisPolicy.markers/bands and yAxisPolicy.markers fields. */
export interface AnnotationsBlock {
  xAxis?: XAxisMarker[];
  yAxis?: YAxisMarker[];
  bands?: XAxisBand[];
  points?: PointCallout[];
}

export interface ConfidenceBand {
  /** Data key the band wraps. */
  series: string;
  /** CSV column holding the lower bound. */
  lower: string;
  /** CSV column holding the upper bound. */
  upper: string;
}

export interface SeriesStyle {
  dashed?: boolean;
}

/** Where a chart's data comes from. A bare string is sugar for `{ file }`. */
export type DataSource =
  | string
  | { file: string }
  | {
      url: string;
      format: "csv" | "json";
      /** For arbitrary JSON: map source fields onto the tidy long shape. */
      map?: { timeField: string; seriesField: string; valueField: string };
    };

export interface SmallMultiplesConfig {
  /** Grid column COUNT (an integer) — distinct from the top-level `columns` role map. The
   *  pane-splitting data column is `columns.facet`. Default derived later (≈ ceil(sqrt(n)),
   *  capped) — not enforced here. */
  columns?: number;
  /** "shared": one y-scale, y-labels left column only (default).
   *  "per-pane": each pane its own y-scale/units. */
  mode?: "shared" | "per-pane";
  /** Pane render order + inclusion filter (like series_order is for series). */
  pane_order?: string[];
  /** facet value → display title above the pane (falls back to the raw value). */
  pane_titles?: Record<string, string>;
  /** Coordinated cursor: hovering one pane echoes a secondary cursor (guide + compact value
   *  labels) on every other pane at the same x. Default true; set false to disable. */
  coordinated_cursor?: boolean;
  /** How a row's width is split among its columns (shared across all rows; vertical bar facets).
   *  - "equal" (default): every column the same data width.
   *  - "equal-bar": each column's width ∝ its bar count, so bars render at the same width (exact for
   *    a single row; multi-row sizes each column to the max bar count among its panes).
   *  - number[]: explicit per-column proportions, length === the grid column count, applied to every
   *    row (e.g. [2, 1] → column 0 twice as wide as column 1). */
  pane_widths?: "equal" | "equal-bar" | number[];
}

/** Maps data-column names onto the roles the engine consumes. Any column name is allowed; the
 *  YAML declares what each does. The whole block is optional — absent ⇒ the legacy defaults
 *  `x: "time"`, `value: "value"`, `series: "series"`. `series` may be omitted (or its column
 *  absent) for a single-series chart. `facet` defines small-multiples panes. */
export interface ColumnMap {
  /** Column holding the x value (any xAxisType). Default "time". */
  x?: string;
  /** Column holding the numeric value. Default "value". */
  value?: string;
  /** Column holding the series key. Omit ⇒ single implicit series. Default "series" (if present). */
  series?: string;
  /** Column whose distinct values split small-multiples panes. */
  facet?: string;
  /** Point charts (scatter / dotplot): column driving the marker SHAPE — an encoding channel
   *  independent of `series` (which drives color). Point both at the same column for redundant
   *  color+shape encoding (the dot-plot default). Omit ⇒ a single shape (circle), no shape legend. */
  shape?: string;
  /** Horizontal bar charts: column whose distinct values group the categories into labeled
   *  sections along the category axis (e.g. Durable goods / Nondurable goods / Services). Each
   *  section is contiguous with a bold header in the left gutter. Omit ⇒ no sections. */
  section?: string;
}

export interface ChartSpec {
  chartType: ChartType;

  /** Data column → role mapping (x / value / series / facet). See ColumnMap. */
  columns?: ColumnMap;

  // Text
  // (The eyebrow / figure number is NOT a spec field — it's a property of the article a chart
  //  is embedded in, supplied at embed time via MountOptions.eyebrow / `render --eyebrow`.)
  title: string;
  subtitle?: string;
  source?: string;
  note?: string;
  x_axis_title?: string;
  /** Where to place the x-axis (value-axis, for horizontal bars) TICK LABELS: "bottom" (default),
   *  "top", or "both". "both" repeats the scale at top and bottom — useful for very tall horizontal
   *  charts so the scale is readable without scrolling. */
  x_axis_ticks?: "bottom" | "top" | "both";
  /** Y-axis title — a short caption above the axis (left-aligned, horizontal). Coexists with the
   *  units subtitle; the author manages any redundancy. */
  y_axis_title?: string;
  /** Decimal places for VALUES shown in hover tooltips. Independent of the axis tick labels
   *  (which round for legibility), so a tooltip can be more precise than the axis — e.g. set 4
   *  for small magnitudes that round to 0.00 on a 2-decimal axis. Default 2. */
  tooltip_decimals?: number;

  // Axes
  xAxisType: XAxisType;
  xAxisPolicy?: XAxisPolicy;
  yAxisPolicy?: YAxisPolicy;

  /** Unified annotations (vertical/horizontal reference lines, shaded bands, point callouts).
   *  Takes precedence over the legacy xAxisPolicy/yAxisPolicy marker+band fields. */
  annotations?: AnnotationsBlock;

  // Series (the series COLUMN is mapped via `columns.series`)
  /** Render order; also an inclusion filter when set. */
  series_order?: string[];
  series_colors?: Record<string, ColorRef>;
  series_styles?: Record<string, SeriesStyle>;
  /** Short data key → display label for legend/tooltip. */
  series_labels?: Record<string, string>;
  /** Categorical x: render order for the x-axis categories. Listed categories come first in this
   *  order; any unlisted categories follow in data-encounter order. Order-only — unlike
   *  series_order, this does NOT filter. Ignored off the categorical x-axis. */
  x_order?: string[];
  /** Categorical x: raw category value → display label, used in the hover tooltip header (e.g.
   *  "1" → "1st Decile"). Lets the tooltip read more verbosely than the compact axis ticks. */
  x_labels?: Record<string, string>;

  // Section axis (horizontal bars; the section COLUMN is mapped via `columns.section`).
  /** Section render order along the category axis; also an inclusion filter (like series_order). */
  section_order?: string[];
  /** Section value → display label for the section header. */
  section_labels?: Record<string, string>;

  // Shape channel (point charts: scatter / dotplot). The shape COLUMN is mapped via
  // `columns.shape`; these mirror the series_* fields for the shape-encoding legend.
  /** Shape render order; also an inclusion filter when set. */
  shape_order?: string[];
  /** Short shape-value key → display label for the shape legend. */
  shape_labels?: Record<string, string>;
  /** Heading shown above the color (series) legend group — used when color and shape encode
   *  two different fields, so each legend is labeled (e.g. "Shock variant"). */
  color_legend_title?: string;
  /** Heading shown above the shape legend group (e.g. "Labor map"). */
  shape_legend_title?: string;

  confidence_bands?: ConfidenceBand[];

  /** Line charts: draw a marker (dot) at each data point. Default false. */
  points?: boolean;

  // Bar / stacked bar
  /** Chart orientation; defaults to "vertical" (value axis is Y). */
  orientation?: "vertical" | "horizontal";
  /** In-bar value labels. `decimals` fixes the label precision; omitted ⇒ the minimum precision
   *  the data needs, capped at 2 (so raw floats don't print 15 digits). */
  valueLabels?: { show?: boolean; signed?: boolean; decimals?: number };
  /** Stacked-bar display options. */
  barStack?: {
    /** How to render the net (sum) callout.
     * - "auto" (default): dot when any value is negative, otherwise text.
     * - "text": text above the top of each cumulative stack.
     * - "dot": white-stroked black dot at the true net value.
     * - "none": suppress all net markers and the "Total" legend entry. */
    netDisplay?: "auto" | "text" | "dot" | "none";
    /** Monochrome override: render all segments using shades of one base color. */
    mono?: { base: ColorRef };
    netLabelColor?: "white" | "black";
    /** Normalize each bar to 100 % (0–1 scale). */
    normalize?: boolean;
    /** Visual stack order, BOTTOM→TOP among positive segments (negatives mirror it downward from
     *  zero). Independent of `series_order` (which fixes the legend order + colors), so a series
     *  can sit at the bottom of the stack while keeping its legend position/color. Series omitted
     *  here keep their relative `series_order` position after the listed ones. */
    stackOrder?: string[];
  };
  /** Series keys to visually highlight (dimming all others). */
  highlightSeries?: string[];
  /**
   * Where to render the legend.
   *
   * Defaults to "top", except: a stacked chart that is diverging (any category/series has a
   * negative value) OR has ≥5 series defaults to "right". An explicit value always wins.
   */
  legendPosition?: "top" | "right";

  // Small multiples (multi-panel); per-pane base chart type stays `chartType`.
  small_multiples?: SmallMultiplesConfig;

  // Data
  data: DataSource;

  /** Catalog facets. */
  tags?: string[];
}
