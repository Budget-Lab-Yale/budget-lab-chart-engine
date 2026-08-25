// The single contract for one chart. The ajv JSON-schema (schema.ts) and the engine
// both derive from this. One chart = one spec (no figure/tracker/nav wrapper).
//
// Ported and reduced from the AI Labor Market Tracker's chart-block schema
// (scripts/build-manifest.py + data/CONFIG-REFERENCE.md), which supported `line` only. `chartType`
// is a union so each new type is additive; it now carries nine — see below, and CONFIG-SPEC.md.

export type ChartType = "line" | "area" | "bar" | "stacked" | "scatter" | "dotplot" | "waterfall" | "histogram" | "dumbbell";

export type XAxisType = "numeric" | "temporal" | "quarterly" | "categorical";

/** A named palette color (resolved via the Style-Guide tokens) or a raw "#hex". */
export type ColorRef = string;

/** A series fill texture: matplotlib's hatch characters, where the character is a picture of the
 *  result. See `series_patterns`, and `engine/hatch.ts` for the geometry. */
export type HatchChar = "/" | "\\" | "|" | "-" | "+" | "x";

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

/** The chart-wide value affixes, resolved from `value_prefix`/`value_suffix`. Threaded through the
 *  render so axis ticks, value labels and tooltips all format numbers the same way. Empty strings
 *  mean "nothing to add", so an unset chart renders bare numbers. */
export interface ValueAffixes {
  prefix: string;
  suffix: string;
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
  /** Key this line in the chart LEGEND (a line swatch in the marker's color) instead of labelling
   *  it inside the plot frame. Needs a `label`; markers sharing one label collapse to a single row. */
  legend?: boolean;
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
  /** Key this band in the chart LEGEND instead of labelling it inside the plot frame. Needs a
   *  `label`; bands sharing one label collapse to a single legend row. `false` always suppresses
   *  the row; absent defaults to `rug === true` (a rug block with no key is unreadable). See
   *  `engine/annotation-legend.ts`. */
  legend?: boolean;
  /** Also draw this band's interval as a solid block on the x-axis rug — the thin timeline strip
   *  under the axis (see `ChartSpec.rug`). Bands sharing one `label` form one rug track. */
  rug?: boolean;
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
  /** Key this line in the chart LEGEND (a line swatch in the marker's color, dashed when the
   *  marker is) instead of labelling it inside the plot frame. Needs a `label`; markers sharing
   *  one label collapse to a single row. */
  legend?: boolean;
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

/** One shaded region between a line and its baseline (LINE charts only). Entries in `shading` are
 *  independent and paint in list order, so several regions may cover one series with different
 *  tints — overlapping fills deliberately compound their opacity.
 *
 *  The baseline is zero when zero lies inside the resolved y-domain, else the nearer domain edge,
 *  so a fill never leaves the frame. `side` always keys off ZERO, never off that clamped baseline. */
export interface ShadeRegion {
  /** Series to fill under. Omitted → every in-scope series gets its own region, each in its own color. */
  series?: string;
  /** The value the fill runs to, and what `side` is measured against. Default 0. Set it to a rule's
   *  threshold (0.5, 15, -0.7) to shade only the breach — the part of the line beyond that level,
   *  filled back to it, rather than back to zero. Pair it with an `annotations.yAxis` marker at the
   *  same `y` to draw the threshold line itself. */
  baseline?: number;
  /** Which side of `baseline` to fill. Default "both". */
  side?: "both" | "positive" | "negative";
  /** Inclusive x lower bound, in the same string form as `annotations.bands.start`. Omitted → the
   *  series' first point. A bound falling between two points is interpolated to that exact x. */
  from?: string;
  /** Inclusive x upper bound. Omitted → the series' last point. */
  to?: string;
  /** Fill color (named palette token or raw "#hex"). Omitted → the series' own resolved color. */
  color?: ColorRef;
  /** Fill opacity, 0–1. Default 0.5. */
  fillOpacity?: number;
  /** What this fill MEANS ("False positives"). A fill has no in-chart text of its own, so this is
   *  purely a legend/rug key: it names the region in the chart legend and groups regions into one
   *  rug track. Regions sharing a label collapse to a single legend row. */
  label?: string;
  /** Key this fill in the chart legend (a rect swatch tinted like the fill). Needs a `label`;
   *  `false` always suppresses, absent defaults to `rug === true`. */
  legend?: boolean;
  /** Also draw this region's `from`→`to` span as a solid block on the x-axis rug (see
   *  `ChartSpec.rug`). Both bounds must be given — an open-ended region has no interval to draw. */
  rug?: boolean;
}

/** One overlay line, layered over the data marks. Exactly ONE of `method`, `fun`, `slope`+`intercept`
 *  or `column` selects the kind; everything else is shared styling and keying. The four differ only
 *  in how the polyline's points are produced, which is why they share one array — and one paint
 *  order, since overlays paint in list order.
 *
 *  Numeric and temporal x only; a categorical band scale has no position between categories. On a
 *  temporal axis `fun`, `slope`/`intercept` and an explicit numeric `domain` are rejected — x would be
 *  epoch milliseconds, and a slope per millisecond is not a quantity anyone means. */
export interface Overlay {
  /** KIND 1 — a least-squares fit of the plotted data. `lm` is a straight line (Stata `lfit`, R
   *  `geom_smooth(method = "lm")`); `poly` is a polynomial of `degree` (Stata `qfit` at degree 2).
   *  Always BIVARIATE: y against the plotted x. A multi-predictor model belongs upstream, arriving
   *  through `fun` + `params` or `column`. */
  method?: "lm" | "poly";
  /** `method: poly` only. 2–5; default 2. Higher degrees are refused rather than drawn badly. */
  degree?: number;
  /** KIND 2 — an equation in `x`, sampled over `domain` (Stata `twoway function`, R
   *  `geom_function`). Arithmetic (`+ - * / ^`, parentheses, unary minus) over `x`, the constants
   *  `pi`/`e`, any `params` key, and a closed function table; R precedence, so `^` is
   *  right-associative and binds tighter than unary minus. Checked at validation time. */
  fun?: string;
  /** `fun` only. Named constants substituted into the expression — the readable way to carry
   *  coefficients computed upstream, instead of inlining four-decimal floats. */
  params?: Record<string, number>;
  /** `fun` only. Sample count across `domain`. Default 100. A non-finite sample breaks the polyline
   *  there rather than erroring, so `log(x)` over a domain crossing zero draws its valid half. */
  n?: number;
  /** KIND 3 — a straight line stated rather than fitted (R `geom_abline`). Both required together.
   *  For a horizontal or vertical rule use `annotations.yAxis` / `annotations.xAxis` instead. */
  slope?: number;
  intercept?: number;
  /** KIND 4 — a data column holding a precomputed value per row (a fit produced in Stata, R or
   *  Python), drawn as a line over the marks. Unlike the other three kinds, this is real per-row data
   *  and therefore DOES fold into the value-axis extent — see index.ts's yForAxis. */
  column?: string;
  /** `method` and `column`: one line per colour series (`series`, default) or one over every in-scope
   *  point (`none`). Rejected on `fun` and `slope`+`intercept`, which do not read the data. */
  by?: "series" | "none";
  /** `method` only. Confidence level for a pointwise ribbon around the fit, e.g. 0.95. Omitted ⇒ no
   *  ribbon. Needs residual degrees of freedom (n > degree + 1); a fit without them draws the line
   *  and no band. */
  ci?: number;
  /** X extent the line is drawn over. `"axis"` spans the resolved x-domain — the declarative way to
   *  say "all the way across the frame", replacing a hardcoded range that breaks when the data move.
   *  `[min, max]` states it explicitly (numeric x only, min < max). Omitted ⇒ the extent of the
   *  group's OBSERVATIONS for `method`/`column` (matching Stata `lfit`'s own default) — a row with a
   *  blank value cell is not one, so a fit stops at the last point it was fitted from — and the
   *  resolved x-domain for `fun` and `slope`+`intercept`. An overlay NEVER widens the axis, and no
   *  field currently does: `xAxisPolicy` carries only `anchorAtZero`, which extends the domain to
   *  include 0 and nothing more. There is no x counterpart to `yAxisPolicy.min`/`.max`, so a
   *  `[min, max]` reaching past the data is CLIPPED rather than expanding the frame. */
  domain?: "axis" | [number, number];
  /** What this line MEANS. Drawn in-frame at the line's `labelPosition` end unless `legend: true`
   *  moves it to a legend row (the convention `annotations.yAxis` follows). */
  label?: string;
  /** Key this line in the legend instead of labelling it in-frame. Needs a `label`. A per-series fit
   *  gets ONE neutral row for the concept — the series colours are already keyed by the series
   *  legend, and one row cannot key both. Ignored when the chart sets `legend: false`, in which case
   *  the label stays in-frame rather than disappearing. */
  legend?: boolean;
  /** Named palette token or "#hex". Omitted ⇒ the series' colour for a per-series `method`/`column`,
   *  else the dim annotation neutral. */
  color?: ColorRef;
  /** Omitted ⇒ `solid` for `method` and `column`, `dashed` for `fun` and `slope`+`intercept`. The
   *  split is the point: a line computed FROM these data reads differently from one asserted OVER
   *  them, and defaulting everything dashed would flatten that. */
  style?: "dashed" | "solid";
  strokeWidth?: number;
  /** Which SIDE of the line the in-frame label sits: "top" (default) | "middle" | "bottom". */
  labelSide?: "top" | "middle" | "bottom";
  /** WHERE along the line the label anchors: "left" (first point) | "middle" | "right" (last point,
   *  default). An overlay is sloped, so this picks a point ON the line, not a frame edge. */
  labelPosition?: "left" | "middle" | "right";
  /** Label nudges in px, signed: +labelDx = right, +labelDy = UP (matching `annotations`). */
  labelDx?: number;
  labelDy?: number;
  /** Small multiples only: scope this overlay to the pane whose facet value equals `facet`. */
  facet?: string;
  /** Contribute a row to the HOVER TOOLTIP showing this line's value at the hovered x. Default
   *  false: an overlay is usually chrome (a reference slope, a target) whose value at an arbitrary x
   *  says nothing, and three lines all reporting into one card is noise. A fitted trend is the case
   *  where it says a lot. Needs a `label` — it is the row's text.
   *
   *  Honoured only where the hover resolves a single x: the continuous crosshair (line/area on a
   *  numeric/temporal/quarterly axis) and a scatter's per-point hover. A histogram's hover resolves
   *  a BIN RANGE, not an x, so there is no one value to report and the flag is ignored there. See
   *  CONFIG-SPEC.md's `overlays[].tooltip` row, which states the coverage. */
  tooltip?: boolean;
}

/** One closed interval on the x-axis rug. Bounds are x-value strings in the same form as
 *  `annotations.bands.start`/`end` (numeric, date, or quarter — parsed under the chart's
 *  `xAxisType`), both required: a rug block is a span, not a point. */
export interface RugInterval {
  from: string;
  to: string;
}

/** One category on the x-axis rug: a labelled, colored set of intervals. Tracks all paint into the
 *  SAME strip in resolution order (later tracks over earlier), so they read as one timeline rather
 *  than a stack of rows. */
export interface RugTrack {
  /** Legend key for this track. Required — a solid block with no key is unreadable. */
  label: string;
  /** Block color, painted solid. Defaults to the dim annotation neutral. */
  color?: ColorRef;
  /** The spans to draw. */
  intervals: RugInterval[];
  /** Set false to draw the blocks without a legend row (rare — you must key them some other way). */
  legend?: boolean;
}

/** The x-axis rug: a thin strip of solid interval blocks between the x-axis line and its tick
 *  labels, for timeline categories that are illegible as fills (a one-month false-positive run on
 *  a 26-year axis) or that would clutter the frame as labelled bands.
 *
 *  Tracks are RESOLVED, not just declared (see `spec/rug.ts#resolveRugTracks`): every
 *  `annotations.bands` and `shading` entry flagged `rug: true` is grouped by its `label` into a
 *  track, then any explicit `tracks` here are appended. So the michez-rule chart's recession bands
 *  and false-positive fills each become one track without restating a single date.
 *
 *  Not supported on `xAxisType: categorical` (a band scale has no position between categories) or
 *  with `small_multiples`; both are validation errors. */
export interface RugConfig {
  /** Strip height in px — per ROW when `rows: per-track`. Default 8. The x-axis tick labels shift
   *  down to make room. */
  height?: number;
  /** How tracks share the strip.
   *  - `single` (default): all tracks paint into ONE row, later over earlier. Right when the tracks
   *    are near-disjoint in x — a short run sitting at the head of a longer one reads as adjacency.
   *  - `per-track`: each track gets its own row, so no track can hide another. Use it when tracks
   *    genuinely overlap (per-series breach windows, or a span-the-axis track over shorter ones).
   *  A track that `single` would hide COMPLETELY is a validation error pointing here. */
  rows?: "single" | "per-track";
  /** Standalone tracks with literal intervals — for a timeline concept that has no band or fill of
   *  its own. Appended after the tracks derived from `rug: true` flags. */
  tracks?: RugTrack[];
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
  /** Dumbbell charts: the categorical axis column (income group, etc.). A synonym for `x` — the
   *  dumbbell's categorical axis IS the engine's x/y band, so `category` resolves onto the same
   *  role bars read via `x`. `x` still works; `category` wins when both are set. */
  category?: string;
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
  /** Scatter only: column naming each OBSERVATION (a year, a state, a firm), shown verbatim as the
   *  last token of the hover card's header. Encodes nothing — it identifies the point rather than
   *  mapping it to a channel — so there is no `point_labels` display map: the cell IS the label. */
  point_label?: string;
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
  /** d3 `timeFormat` pattern for the crosshair tooltip's X value, on a `temporal` or `quarterly`
   *  axis only. Absent ⇒ `"%b %Y"` (temporal) / `YYYYQ#` (quarterly), which match the axis ticks —
   *  right for month- or quarter-spaced data, wrong for a DAILY series, where every point in a
   *  month shares one tooltip label and hovering can't tell you which day you're on. Opt-in
   *  rather than a granularity auto-detect deliberately: a repin re-renders the whole archive, so
   *  changing the default would move the tooltips of every published temporal figure at once.
   *
   *  Reaches the CARD and the coordinated cursor alike: render-live.ts passes it as `xFormat` into
   *  `attachSecondaryLineCursor` (with `xFormatExplicit`, which is what distinguishes an author's
   *  pattern from the adapter's axis-matching default), and the cursor draws its x echo with it on
   *  one line — including on a DAILY multi-pane line, where the axis ticks on whole months, no tick
   *  row exists to annotate, and the echo would otherwise be skipped. See CONFIG-SPEC.md and
   *  test/hover-claims-defaults.test.ts, which gates set-and-absent on monthly and daily panes. */
  tooltip_x_format?: string;

  /** Text placed BEFORE every rendered value — axis ticks, value labels, tooltips. Concatenated
   *  literally, so include any space you want (`"$"` vs `"USD "`); on a negative value it sits after
   *  the minus sign (`-$5`). Nothing is inferred from `subtitle` — that is prose only. */
  value_prefix?: string;
  /** Text placed AFTER every rendered value. Concatenated literally, so include any leading space
   *  you want (`" pp"`, `" billion"`); `"%"` normally wants none. */
  value_suffix?: string;

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
  /** `{ <seriesKey>: hatch }` — a TEXTURE for the series' fill, alongside its colour, on the chart
   *  types whose marks are filled areas (bar, stacked, area, histogram, waterfall). The six values
   *  are matplotlib's hatch characters, and each is a picture of its own result: `"/"` `"\\"`
   *  (diagonals), `"|"` `"-"` (vertical / horizontal), `"+"` `"x"` (the crossed pairs). Quote them
   *  in YAML — bare `-` is a sequence indicator and bare `|` a block scalar.
   *  The colour the mark is actually PAINTED is the pattern's GROUND — the series colour until
   *  `bar_color`, `category_colors` or the title-selector accent overrides the fill, and then it is
   *  that one (see `engine/painted-fill.ts`). Omitting this key renders exactly as before, and an
   *  unrecognised value is rejected rather than silently rendered flat.
   *  Density repeats (`"//"`) are deliberately NOT supported: more ink per unit area reads as a
   *  darker shade, which is the tonal ramp's job and is controlled precisely by `series_colors`.
   *  The hatch's BAND colour is not configurable — the author supplies the base colour and the
   *  character, and the engine derives the band as a step of the same hue (see
   *  `engine/hatch.ts#defaultHatchStroke`), so a pair can never leave the Style-Guide ramp. */
  series_patterns?: Record<string, HatchChar>;
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
  /** Dumbbell charts: category render order along the categorical axis — a synonym for `x_order`
   *  (order-only, never filters). `category_order` wins when both are set. See `categoryOrderFor`. */
  category_order?: string[];
  /** Categorical x: raw category value → display label, used in the hover CARD's header
   *  (e.g. "1" → "1st Decile"). Lets that card read more verbosely than the compact axis ticks.
   *
   *  A CARD-HEADER field, not a general category-label field. It is consumed inside
   *  `buildBandTooltipHtml`, fed `categoryLabels` by both `attachBandCrosshair` and
   *  `attachCategoricalLineCrosshair` (dumbbell / dot plot / categorical-x line) — so it renders
   *  wherever a hover card is drawn, faceted included where the card survives coordination. Where
   *  no card is drawn there is no header to render it in: plain/grouped bar and waterfall hover
   *  with pills in any configuration (`resolveHoverMode` ⇒ "pills"), and a coordinated pane draws
   *  the in-place cursor instead. That cursor's category echo keeps the RAW category on purpose —
   *  `addCoordCategoryHighlight` overlays the rendered axis tick, taking its box, wrap mode and
   *  rotation, and this field is for reading more verbosely than the tick. See CONFIG-SPEC.md and
   *  test/hover-claims-defaults.test.ts. */
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

  /** Lines layered over the data marks — fits, equations, stated slopes, or precomputed columns.
   *  Numeric/temporal x only. See Overlay. */
  overlays?: Overlay[];

  /** Line charts ONLY: shaded regions between a line and its baseline. See ShadeRegion. */
  shading?: ShadeRegion[];

  /** The x-axis rug: a thin timeline strip of solid interval blocks under the x-axis. See RugConfig.
   *  Present-but-empty (`rug: { height: 10 }`) is valid when every track is derived from a
   *  `rug: true` flag on a band or shading region. */
  rug?: RugConfig;

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
    /** Whitespace BETWEEN adjacent stacked segments, in px. Default 0 (segments abut, as before).
     *  A thin gap separates two slices from the same hue family without spending another colour.
     *  Subtractive geometry, not paint: each segment's trailing edge is pulled in, floored so a
     *  slice thinner than the gap survives as a hairline instead of being swallowed. No gap is
     *  added at the bar's outer ends — the baseline and the total do not move — and the net marker
     *  stays at the true net. */
    segmentGap?: number;
    /** Which hover treatment a stacked chart gets, INDEPENDENT of the net callout.
     *  - "tooltip": the floating card, with a Total row.
     *  - "pills":   per-segment value pills on the hovered band (the coordinated cursor).
     *  Absent ⇒ the historical coupling: "tooltip" when `netDisplay` resolves to a dot, else "pills".
     *  Two reasons to set it. A tooltip with NO dot: `netDisplay: none` + `hover: tooltip` gives the
     *  card a plain-text Total row, draws no marker and no "Total" legend entry, and — coming from
     *  the spec rather than a stylesheet — the PNG export agrees. And DETERMINISM: `netDisplay: auto`
     *  resolves to a dot only when some value is negative, so a series that dips below zero at some
     *  dial settings silently flipped the reader between a tooltip and value pills (issue #29). */
    hover?: "tooltip" | "pills";
    /** The hover tooltip's Total row. Stacked charts with 2+ series only; a 100 %-normalized stack
     *  never gets a Total row (its total is always 100). `bold` and `divider` default ON — every
     *  such Total row gets a bold, divided row on hover unless a chart opts out. */
    total?: {
      /** Where the row sits: "last" (default, after the series rows) or "first". */
      position?: "first" | "last";
      /** Bold the row's label (the value is already bold). Default true — set `false` to opt out. */
      bold?: boolean;
      /** Rule separating the Total row from the series rows; the side flips with `position` (see
       *  `position` above) so it always separates the Total row from the series rows, never from
       *  the category header. Default true — set `false` to opt out. */
      divider?: boolean;
    };
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

  // Dumbbell (connected dot plot). A categorical axis × numeric value axis rendered as per-category
  // dots joined by a connector; `orientation` flips it (horizontal = categories on screen-y). The
  // categorical axis is declared via `xAxisType: categorical` (like bars), NOT a separate yAxisType.
  // Series color/order/labels reuse the shared `series_*` fields; category order reuses
  // `category_order`/`x_order`; faceting reuses `columns.facet` + `small_multiples`.
  /** Per-series dot style: solid fill, hollow ring (series-color outline around a HOLE — the middle
   *  is `fill="none"`, so the connector stem and whatever the figure sits on show through it), or
   *  filled neutral ink. Absent series default to "filled". See `engine/marker-ink.ts`, which is
   *  where the hole/white-disc distinction is stated once. */
  series_marker?: Record<string, "filled" | "hollow" | "ink">;
  /** Connector "stem" styling; defaults to a light muted 1.5px solid line drawn behind the dots. */
  connector?: { color?: ColorRef; width?: number; style?: "solid" | "dashed" | "dotted" };
  /** Dot radius (px). Default 5 (`DEFAULT_DOT_R`, `engine/marks/dumbbell.ts`); dots size
   *  consistently across a facet. */
  dot_radius?: number;
  /** Label the numeric gap between two named series on each stem. `true` uses the first two series
   *  in series order; an object names the pair explicitly. Default off. */
  gap_annotation?: boolean | { series_a: string; series_b: string; format?: ValueFormat };
  /** Value-axis title (short caption on the numeric axis). */
  value_axis_title?: string;
  /** Number format for a dumbbell's GAP LABEL (reuses ValueFormat); `gap_annotation.format` wins
   *  over it. It does NOT drive axis ticks or hover — those come from `value_prefix`/`value_suffix`
   *  like every other chart type. */
  value_format?: ValueFormat;

  /** Series keys to visually highlight (dimming all others). */
  highlightSeries?: string[];
  /**
   * Where to render the legend.
   *
   * Defaults to "top", except: a stacked chart that is diverging (any category/series has a
   * negative value) OR has ≥5 series defaults to "right" — where the ≥5 count is of the series rows
   * the legend actually SHOWS (`series_legend: false` removes them).
   *
   * Four routes ignore this field entirely, an explicit value included: `legend: false` resolves
   * "top" before the field is read (unobservable — nothing is drawn), a card narrower than
   * LEGEND_RIGHT_MIN_CARD_WIDTH falls back to "top" (and re-resolves on resize), a `small_multiples`
   * figure has only a top legend slot, and the PNG export always draws the legend above the chart.
   * Where a right legend is possible at all, an explicit value wins over the defaults above.
   */
  legendPosition?: "top" | "right";
  /** Set `false` to hide the legend entirely (top/right/figure/PNG export alike) while keeping
   *  multi-series coloring, tooltips, and crosshair. Click-to-pin/dim is consequently
   *  unavailable, since it is driven through the legend. Default true (legend shown per the
   *  usual ≥2-series / style-override rules). */
  legend?: boolean;
  /** Drop the SERIES rows from the legend while keeping overlay/annotation rows in it. For a chart
   *  whose colour channel needs no naming because the points are identified some other way. Use the
   *  top-level `legend: false` to remove the whole box instead. Default true. */
  series_legend?: boolean;
  /** Scatter only: drop the series token from the hover card's header, leaving the shape and
   *  `point_label` tokens. Other chart types use the series name as a ROW label against a value, so
   *  suppressing it there would leave unlabelled numbers — validation rejects it. Default true. */
  tooltip_series_name?: boolean;
  /** Turn engine hover chrome OFF, for a consumer drawing its own. Switching a piece off rather
   *  than hiding it in CSS is what makes the PNG export agree — the export re-renders from the
   *  spec, so a stylesheet never reached it.
   *  Deliberately NOT here: the net marker (use `barStack.netDisplay: none`, which also expresses
   *  dot/text) and the legend (use the top-level `legend: false`). Each would otherwise be a
   *  second formula for a decision that already has one. */
  chrome?: {
    /** The floating hover tooltip card. Default true. */
    tooltip?: boolean;
    /** The per-segment value pills on the hovered band. Default true. */
    valuePills?: boolean;
  };

  // Small multiples (multi-panel); per-pane base chart type stays `chartType`.
  small_multiples?: SmallMultiplesConfig;

  // Data
  data: DataSource;

  /** Catalog facets. */
  tags?: string[];
}
