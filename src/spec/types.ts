// The single contract for one chart. The ajv JSON-schema (schema.ts) and the engine
// both derive from this. One chart = one spec (no figure/tracker/nav wrapper).
//
// Ported and reduced from the AI Labor Market Tracker's chart-block schema
// (scripts/build-manifest.py + data/CONFIG-REFERENCE.md). v1 supports `line` only;
// `chartType` is a union so adding bar/etc. later is additive.

export type ChartType = "line" | "area" | "bar" | "stacked" | "scatter" | "dotplot" | "waterfall" | "histogram";

export type XAxisType = "numeric" | "temporal" | "quarterly" | "categorical";

/** A named palette color (resolved via the Style-Guide tokens) or a raw "#hex". */
export type ColorRef = string;

/** Per-annotation number formatting for a `{value}` token substituted into an annotation's
 *  `label` (see XAxisMarker/YAxisMarker/PointCallout `label`). Absent → falls back to the
 *  chart's value-axis tick format (yAxis markers, points) or the raw x string (xAxis markers). */
export interface ValueFormat {
  /** Fixed decimal places. Default 2. */
  decimals?: number;
  /** Text prepended to the formatted number. */
  prefix?: string;
  /** Text appended to the formatted number. */
  suffix?: string;
}

export interface XAxisMarker {
  x: string;
  /** May contain a literal `{value}` token, replaced with this marker's own `x` — formatted
   *  numerically via `value_format` when present AND `x` parses as a number, else the raw
   *  string. */
  label?: string;
  /** Formatting for the `{value}` token in `label`. Only applies when `x` parses as a number;
   *  absent (or `x` non-numeric) → the raw `x` string is substituted. */
  value_format?: ValueFormat;
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
  /** Small multiples only: scope this marker to the pane whose facet value equals `facet`.
   *  Omit to render in every pane (unchanged default). Ignored on a non-faceted chart. */
  facet?: string;
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
  /** May contain a literal `{value}` token, replaced with this marker's own `y`, formatted via
   *  `value_format` — or, when absent, the chart's value-axis tick format. */
  label?: string;
  /** Formatting for the `{value}` token in `label`. Absent → falls back to the chart's
   *  value-axis tick format. */
  value_format?: ValueFormat;
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
  /** Small multiples only: scope this marker to the pane whose facet value equals `facet`.
   *  Omit to render in every pane (unchanged default). Ignored on a non-faceted chart. */
  facet?: string;
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
  /** May contain a literal `{value}` token, replaced with this callout's resolved `y` (the
   *  explicit value, or — when `y` is omitted and `series` snaps to a series — the snapped
   *  value), formatted via `value_format` — or, when absent, the chart's value-axis tick
   *  format. */
  label: string;
  /** Formatting for the `{value}` token in `label`. Absent → falls back to the chart's
   *  value-axis tick format. */
  value_format?: ValueFormat;
  color?: ColorRef;
  /** Horizontal nudge (px, signed: + = right) of the label from the point. */
  dx?: number;
  /** Vertical nudge (px, signed: + = UP) of the label from the point. */
  dy?: number;
  connector?: boolean;
  /** Wrap the label to at most this width (px), breaking on spaces into multiple lines. Omit ⇒
   *  the label renders on one line. */
  maxWidth?: number;
  /** Small multiples only: scope this callout to the pane whose facet value equals `facet`. Omit
   *  ⇒ render in every pane. Ignored on a non-faceted chart. */
  facet?: string;
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
  /** Waterfall charts: column flagging each step's row TYPE — `total` (an absolute bar anchored
   *  at zero; an explicit value rebases the running cumulative, a blank value = the auto running
   *  total), `skip` (no bar — the category slot is kept so facets stay aligned; label the gap
   *  with a point annotation), or `delta` (the default — a signed step floating on the running
   *  cumulative). Omit ⇒ every row is a delta. */
  kind?: string;
  /** Histogram pre-binned data: columns holding each bin's lower/upper edge. When BOTH are mapped,
   *  the histogram treats data as pre-binned (no engine binning) and `value` is the bar height. */
  x0?: string;
  x1?: string;
}

export interface HistogramConfig {
  /** Bin COUNT. Ignored when binWidth is set. */
  bins?: number;
  /** Bin WIDTH: a number in x-units (numeric x), or for temporal x a calendar interval name
   *  ("day"|"week"|"month"|"quarter"|"year") or a number interpreted as days. */
  binWidth?: number | string;
  /** Explicit binning range [min, max]; default = data extent. */
  domain?: [number, number];
  /** Bar-height normalization. "proportion": each series sums to 1. "density": area = 1. Default "none". */
  normalize?: "none" | "proportion" | "density";
  /** Column summed per bin (weighted histogram); default = row count. Ignored when pre-binned. */
  weight?: string;
  /** Friendly formatting of the hover tooltip's bin-range header. See `formatBinLabel`. */
  bin_label?: {
    /** Unit applied to NUMERIC edges only, e.g. "$", "%", " yrs". Ignored for temporal labels. */
    unit?: string;
    /** Where the unit sits on each numeric edge. Default "suffix". */
    unit_position?: "prefix" | "suffix";
    /** Numeric edge rounding. Default = smart trim to ≤2 fraction digits. */
    decimals?: number;
  };
}

/** One option in an inline title selector's dropdown. `label` defaults to `id` when absent.
 *  `color` tints the selector's trigger label when this option is active (ported from the AI
 *  Labor Market Tracker's inline industry picker): explicit `color` wins; else falls back to
 *  `spec.series_colors[label ?? id]` (the shared per-series color map) — see
 *  `title.ts#resolveActiveOptionColor`. Absent ⇒ the label inherits the surrounding title color,
 *  unchanged from before this field existed. */
export interface TitleSelectorOption {
  id: string;
  label?: string;
  color?: ColorRef;
}

/** An engine-owned interactive single-select control bound to a `{key}` token in `title`. See
 *  `src/spec/title.ts` for token parsing/resolution and `src/engine/render-live.ts` for the
 *  live button+popover widget (ported from the AI Labor Market Tracker's inline title picker). */
export interface TitleSelector {
  options: TitleSelectorOption[];
  /** Initial active option id. Must be one of `options[].id`. Falls back to the first option
   *  when omitted. */
  default?: string;
}

export interface ChartSpec {
  chartType: ChartType;

  /** Data column → role mapping (x / value / series / facet). See ColumnMap. */
  columns?: ColumnMap;

  // Text
  // (The eyebrow / figure number is NOT a spec field — it's a property of the article a chart
  //  is embedded in, supplied at embed time via MountOptions.eyebrow / `render --eyebrow`.)
  title: string;
  /** Interactive dropdowns embedded inline in `title` via a `{key}` token — e.g.
   *  `title: "GDP by {dimension}"` with `title_selectors: { dimension: {...} }`. Every key here
   *  must appear as `{key}` in `title` (validated in spec/validate.ts). Absent/empty ⇒ the title
   *  renders as plain text, byte-identical to before this field existed. */
  title_selectors?: Record<string, TitleSelector>;
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
  /** Bar charts, SINGLE-SERIES only: the bar fill for the one series, resolved through the
   *  palette (named token or raw "#hex"). A first-class replacement for the
   *  `series_colors: {"": color}` idiom — that idiom still works; `bar_color` wins when both are
   *  set. Ignored on multi-series (grouped) bar charts, where each series keeps its own color.
   *  With `highlightSeries`, bar_color replaces the BASE color only — highlight dimming still
   *  applies (a non-highlighted series dims regardless of bar_color). */
  bar_color?: ColorRef;
  /** Bar charts, SINGLE-SERIES only (both orientations): per-x-category fill override, e.g. render
   *  a "Total" category in a distinct color while every other category keeps the base fill (the
   *  series color, or `bar_color` when set). Values are resolved through the palette; unlisted
   *  categories are unaffected. Ignored on multi-series (grouped) bar charts, where series fill
   *  wins for every bar regardless of category. */
  category_colors?: Record<string, ColorRef>;
  series_styles?: Record<string, SeriesStyle>;
  /** Short data key → display label for legend/tooltip. */
  series_labels?: Record<string, string>;
  /** Categorical x: render order for the x-axis categories. Listed categories come first in this
   *  order; any unlisted categories follow in data-encounter order. Order-only — unlike
   *  series_order, this does NOT filter. Ignored off the categorical x-axis.
   *  With `columns.section` set (horizontal bars), section grouping is authoritative for
   *  CROSS-section order (sections always render contiguously, in `section_order`/encounter
   *  order) — x_order only reorders categories WITHIN each section; it can never split a
   *  section's categories apart or reorder the sections themselves. */
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

  /** Data column whose truthy value (`1`/`true`/`yes`, case-insensitive, trimmed) flags a row as
   *  "projected" (forecast/estimated) rather than actual/historical. LINE charts draw the
   *  flagged run(s) of a series dashed (same color/width), connecting continuously to the
   *  adjacent actual points; a series may have multiple disjoint projected runs. AREA (stacked)
   *  charts fade the fill over x-ranges where EVERY in-scope series is flagged projected
   *  (conservative — a stack can't express partial-series fading). Absent ⇒ no projected styling
   *  (byte-identical output). A series ALSO listed in `series_styles[..].dashed` (whole-series
   *  dashed) is NOT split by this field — the whole-series dashed override wins; see
   *  marks/line.ts for the exact gating. */
  projected_field?: string;
  /** Overrides the default projected-run styling. Only consulted when `projected_field` is set.
   *  `dashed` (line charts, default true): whether the projected run renders dashed at all —
   *  `false` renders it solid (same as actual), i.e. opts out of the visual distinction while
   *  keeping the field wired. `fillOpacity` (area charts, default 0.2): the effective fill
   *  opacity of the projected x-range's white veil overlay. */
  projected_style?: { dashed?: boolean; fillOpacity?: number };

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
  /** Waterfall-chart display options. A waterfall is a vertical, single-series categorical chart
   *  whose bars float on a running cumulative (see `columns.kind`). Ignored by other chart types. */
  waterfall?: {
    /** Semantic bar colors, resolved through the palette. Any subset overrides the defaults
     *  (increase = blue, decrease = red, total = navy). `category_colors` still wins per bar. */
    colors?: { increase?: ColorRef; decrease?: ColorRef; total?: ColorRef };
    /** Draw dotted connector lines linking each bar's end level to the next bar's start level.
     *  Default true. */
    connectors?: boolean;
    /** Connector color; defaults to the dim neutral. */
    connectorColor?: ColorRef;
  };
  // Histogram (continuous-x binned bars). Ignored by other chart types.
  histogram?: HistogramConfig;

  /** Series keys to visually highlight (dimming all others). */
  highlightSeries?: string[];
  /**
   * Where to render the legend.
   *
   * Defaults to "top", except: a stacked chart that is diverging (any category/series has a
   * negative value) OR has ≥5 series defaults to "right". An explicit value always wins.
   */
  legendPosition?: "top" | "right";
  /** Set `false` to hide the legend entirely (top/right/figure/PNG export alike) while keeping
   *  multi-series coloring, tooltips, and crosshair. Click-to-pin/dim is consequently
   *  unavailable, since it is driven through the legend. Default true (legend shown per the
   *  usual ≥2-series / style-override rules). */
  legend?: boolean;

  // Small multiples (multi-panel); per-pane base chart type stays `chartType`.
  small_multiples?: SmallMultiplesConfig;

  // Data
  data: DataSource;

  /** Catalog facets. */
  tags?: string[];
}
