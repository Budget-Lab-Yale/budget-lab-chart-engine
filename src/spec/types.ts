// The single contract for one chart. The ajv JSON-schema (schema.ts) and the engine
// both derive from this. One chart = one spec (no figure/tracker/nav wrapper).
//
// Ported and reduced from the AI Labor Market Tracker's chart-block schema
// (scripts/build-manifest.py + data/CONFIG-REFERENCE.md). v1 supports `line` only;
// `chartType` is a union so adding bar/etc. later is additive.

export type ChartType = "line" | "bar" | "stacked" | "scatter" | "dotplot";

export type XAxisType = "numeric" | "temporal" | "quarterly" | "categorical";

/** A named palette color (resolved via the Style-Guide tokens) or a raw "#hex". */
export type ColorRef = string;

export interface XAxisMarker {
  x: string;
  label?: string;
  style?: "dashed" | "solid";
  color?: ColorRef;
  strokeWidth?: number;
}

export interface XAxisPolicy {
  /** Numeric axis only: extend the visible domain to include 0. */
  anchorAtZero?: boolean;
  /** Vertical reference lines (e.g. a treatment date). */
  markers?: XAxisMarker[];
}

export interface YAxisPolicy {
  min?: number;
  max?: number;
  includeZero?: boolean;
  tickCount?: number;
  /** When data exceeds `max`, round the ceiling up to the next multiple of `step`. */
  autoWiden?: { step: number };
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

  // Series (the series COLUMN is mapped via `columns.series`)
  /** Render order; also an inclusion filter when set. */
  series_order?: string[];
  series_colors?: Record<string, ColorRef>;
  series_styles?: Record<string, SeriesStyle>;
  /** Short data key → display label for legend/tooltip. */
  series_labels?: Record<string, string>;

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
  /** In-bar value labels. */
  valueLabels?: { show?: boolean; signed?: boolean };
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
