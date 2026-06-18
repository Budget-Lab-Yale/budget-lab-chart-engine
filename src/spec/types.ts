// The single contract for one chart. The ajv JSON-schema (schema.ts) and the engine
// both derive from this. One chart = one spec (no figure/tracker/nav wrapper).
//
// Ported and reduced from the AI Labor Market Tracker's chart-block schema
// (scripts/build-manifest.py + data/CONFIG-REFERENCE.md). v1 supports `line` only;
// `chartType` is a union so adding bar/etc. later is additive.

export type ChartType = "line" | "bar" | "stacked";

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

export interface ChartSpec {
  chartType: ChartType;

  // Text
  /** Eyebrow line above the title, e.g. "Figure 1" (rendered uppercase/tracked). Lives in
   * the spec for now to nail the visual; intended to be supplied by the embed script later. */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  source?: string;
  note?: string;
  x_axis_title?: string;

  // Axes
  xAxisType: XAxisType;
  xAxisPolicy?: XAxisPolicy;
  yAxisPolicy?: YAxisPolicy;

  // Series
  series_field?: string;
  /** Render order; also an inclusion filter when set. */
  series_order?: string[];
  series_colors?: Record<string, ColorRef>;
  series_styles?: Record<string, SeriesStyle>;
  /** Short data key → display label for legend/tooltip. */
  series_labels?: Record<string, string>;

  confidence_bands?: ConfidenceBand[];

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

  // Data
  data: DataSource;

  // Provenance / locking
  /** Engine release that rendered/approved this chart (inherited from article.yaml). */
  engineVersion?: string;
  /** Catalog facets. */
  tags?: string[];
}
