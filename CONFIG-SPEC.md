# Figure config specification

The authoritative list of fields the engine accepts in a figure config. This page mirrors the
contract in `src/spec/` (`types.ts` + `schema.ts`); the schema is strict
(`additionalProperties: false` at every level), so an unknown or mistyped field **fails
validation** rather than being silently ignored. Defaults are applied implicitly — **only declare
what differs**.

Two figure types, one file each:

- **`chart.yaml`** — a `ChartSpec`: line, area, bar, stacked-bar, scatter, and dot-plot charts.
- **`table.yaml`** — a `TableSpec`: a formatted, interactive data table.

Validate with `tbl-chart validate <file>` (schema + data cross-reference). Consuming repos
(e.g. budget-lab-charts) add their own collection-level config — `article.yaml` / `tracker.yaml`,
figure-number maps, catalog — which is **not** part of the engine and is documented there.

---

## `chart.yaml`

### Required

| field | type | notes |
|---|---|---|
| `chartType` | enum | `line` \| `area` \| `bar` \| `stacked` \| `scatter` \| `dotplot` \| `waterfall` \| `histogram` \| `dumbbell`. |
| `title` | string | Card title above the chart. Rendered verbatim. |
| `xAxisType` | enum | `numeric` \| `temporal` \| `quarterly` \| `categorical`. Determines how the x column is parsed (see [CSV format](#csv-format)). |
| `data` | string \| object | Usually just `data.csv` (see [Data](#data)). |

> There is **no `eyebrow`** field — the figure number is a property of the article a chart is
> embedded in, supplied at embed time (`--eyebrow`), not a spec field.

Axis constraints: `scatter` requires `xAxisType: numeric`; `dotplot` requires
`xAxisType: categorical`; `histogram` requires `xAxisType: numeric` or `xAxisType: temporal` (a
histogram bins a continuous axis — it has no categorical or quarterly form); `dumbbell` requires
`xAxisType: categorical` (the categorical axis; `orientation` flips it — there is no `yAxisType`).

### Column mapping

`columns:` maps your CSV column names onto the engine's roles. The whole block is optional; absent,
it defaults to `x: time`, `value: value`, `series: series`.

| field | type | notes |
|---|---|---|
| `columns.x` | string | Column holding the x value. Default `"time"`. |
| `columns.category` | string | Dumbbell only: the categorical-axis column — a synonym for `columns.x` (wins when both are set). |
| `columns.value` | string | Column holding the numeric y value. Default `"value"`. |
| `columns.series` | string | Column identifying series. **Omit for a single-series chart.** Default `"series"` if present. |
| `columns.facet` | string | Column whose distinct values split small-multiples panes. |
| `columns.shape` | string | Point charts only: column driving the marker **shape** (a second encoding channel, independent of color). |
| `columns.section` | string | Horizontal bar charts only: column grouping categories into labeled **sections** along the category axis (e.g. Durable goods / Nondurable goods / Services). See [Section axis](#section-axis-horizontal-bars). |
| `columns.x0` / `columns.x1` | string | Histograms only: columns holding each row's bin **lower**/**upper** edge, for **pre-binned** input. Map both to switch the histogram to pre-binned mode; mapping only one is a validation error. See [Histogram](#histogram-options). |

### Text

| field | type | notes |
|---|---|---|
| `subtitle` | string | Below the title (conventionally naming the units). **Display text only** — it does not affect number formatting; use `value_prefix`/`value_suffix` for that. |
| `source` | string | Source line below the chart. |
| `note` | string | Note line below the chart, above the source. |
| `x_axis_title` | string | Caption below the x-axis. |
| `y_axis_title` | string | Short caption above the y-axis (left-aligned, horizontal). |
| `tooltip_decimals` | integer | Decimal places for values in hover tooltips (independent of axis ticks). Default 2. |

### Value units

| field | type | notes |
|---|---|---|
| `value_prefix` | string | Text placed **before** every rendered value — axis ticks, value labels, tooltips. Concatenated literally, so include any space you want (`"$"` vs `"USD "`). On a negative value it sits **after** the minus sign: `-$5`. |
| `value_suffix` | string | Text placed **after** every rendered value. Concatenated literally, so include any leading space you want (`" pp"`, `" billion"`); `"%"` normally wants none. |

```yaml
subtitle: Percentage points     # prose; read by nothing
value_suffix: " pp"             # -> axis "2 pp", tooltip "2.00 pp"
```

```yaml
value_prefix: "$"
value_suffix: " billion"        # -> "$1200 billion", "-$40 billion"
```

No spacing is inserted for you, because `%` wants none and ` pp` does — only the author knows which.

**Precedence.** A narrower explicitly-set format still wins locally: a per-annotation
`value_format` (on an `annotations.xAxis`/`yAxis`/`points` marker) formats that annotation's
`{value}`, and a dumbbell's `gap_annotation.format` — else its chart-level `value_format` — formats
the gap label. Everything else uses `value_prefix`/`value_suffix`.

> **Changed in 1.8.0.** Units used to be **guessed from the subtitle** by substring-matching
> `"percent"`. That put `%` on percentage-*point* charts (a 2 pp change rendered as `2%`) and on any
> subtitle merely containing those letters, e.g. `"Percentiles"`. The inference is gone: a chart that
> wants a `%` must now say `value_suffix: "%"`.

### Inline title selector

An interactive button+popover widget embedded inline in the title, bound to a `{key}` token —
e.g. `title: "GDP by {dimension}"` with a `dimension` entry in `title_selectors`. Every key in
`title_selectors` must appear as `{key}` in `title` (validated). Absent/empty `title_selectors` ⇒
the title renders as plain text, byte-identical to before this field existed. The widget (a boxed
piece of title text with a caret, opening a listbox popover on click) is ported verbatim from the
AI Labor Market Tracker's inline industry picker — click/click-away/Escape/Enter/arrow-keys/type-
ahead all behave the same.

| field | type | notes |
|---|---|---|
| `title_selectors` | object | `{ <key>: { options: [{id, label?, color?}, ...], default? } }`. `label` defaults to `id`. `default` must be one of `options[].id`; falls back to the first option when omitted. |

Changing the selection updates the trigger label in place (no rebuild of the header) and fires a
bubbling `tbl-title-select` CustomEvent (`detail: { id, value }`). `MountOptions.selections` sets
the initial selections (per-key: a valid id wins, else the selector's `default`, else its first
option); `MountOptions.onSelect` is called on every change. PNG export renders the title with
whichever option is currently active (or the initial `selections`, for a scripted export).

**Color matching.** An option's trigger label is tinted to its resolved color: an explicit
`option.color` wins; else `series_colors[option.label ?? option.id]` (the chart's own per-series
color map); else the label inherits the surrounding title color, unchanged. On a **single-series**
chart, the active option's resolved color is also fed back as an accent onto the rendered line
itself — selecting a different option re-colors the chart to match, and a PNG export downloaded
with that selection matches what was on screen (AILMT parity: the by-industry picker recoloring
its own line). On a **multi-series** chart this accent is not applied — only the trigger label
tints; each series keeps its own distinct color from the palette/`series_colors`.

### Axes

| field | type | notes |
|---|---|---|
| `xAxisPolicy.anchorAtZero` | boolean | Numeric x-axis only: extend the visible domain to include 0. **Default `false`** (the axis fits its data range — anchoring at zero squishes a year axis to the right). |
| `x_order` | array | Categorical x-axis only: render order for the x-axis categories. Listed categories come first in this order; any unlisted ones follow in data-encounter order. **Order-only** — unlike `series_order`, it does *not* filter. Ignored off a categorical x-axis. |
| `x_labels` | object | Categorical x-axis: `{ <category>: "Display label" }` for the hover-tooltip header (lets the tooltip read more verbosely than the compact axis ticks). |
| `yAxisPolicy.min` | number | Hard floor for the y-axis. |
| `yAxisPolicy.max` | number | Hard ceiling for the y-axis. |
| `yAxisPolicy.includeZero` | boolean | When `true` (and no hard min/max), always extend the y-domain to 0. |
| `yAxisPolicy.tickCount` | integer | Approximate target number of y-ticks. Default 5. |
| `yAxisPolicy.autoWiden.step` | number | When data exceeds `max`, round the ceiling up to the next multiple of `step`. |

**Truncating the axis below the data.** When `min`/`max` cut into the data, **every chart type**
clips its marks to the plot frame: the geometry runs to its true crossing with the axis edge and
stops there. Nothing is dropped or clamped, so the shape resumes at the correct x when a series
re-enters the range — do *not* pre-clip the source data (that either fakes a plateau or reads as
missing data, and the chart's CSV download would ship the altered values). Value labels, gap
annotations and reference lines are deliberately **not** clipped: a half-cut label reads worse than
one sitting past the axis.

Note that `min`/`max` are **nice'd outward** to land on clean tick boundaries, so the rendered
ceiling can sit above the number you wrote (`max: 15` with 5 ticks renders a 20 ceiling) — clipping
only engages once the *nice'd* domain still cuts the data.

A line leaving the frame is honest but easy to misread as the end of the series, so pair a truncated
axis with a note or an `annotations.yAxis` marker at the ceiling.

**Reversing the axis.** Set `min` **greater than** `max` to flip the value axis, so the numerically
lower value sits at the top: `yAxisPolicy: { min: 0.0, max: -3.0 }` puts `-3.0` at the ceiling and
`0.0` at the floor. Use it for indices where more-negative is worse (CFNAI, output gaps) and the
conventional reading is "down is bad, so draw it up."

Reversal works on **every chart type**, and on the value axis wherever it lives. `min` is the axis'
NEAR edge — the bottom on a vertical chart, the left on a horizontal one — and `max` is the far edge,
so reversing moves the numerically lower value to the top (vertical) or the right (horizontal). On
horizontal bars that means negative data grows left-to-right from a zero line at the left, the mirror
of its ascending layout. Both bounds must be pinned: `min` alone, or `max` alone, is read as
ascending.

A reversed axis is a scale flip and nothing more, so the rest of the engine follows it:

| | Behavior |
|---|---|
| Ticks and gridlines | Run top-to-bottom in descending order. |
| Zero baseline | Still drawn whenever the domain straddles zero. |
| `shading` baselines | Close on their threshold, not on the frame edge. |
| Reference markers, `annotations.points` | Fold in without moving either pinned bound. |
| Clipping | Engages only on real overflow, in either direction. |
| Value labels | Stay clear of the mark's end, on whichever pixel side that now is. |
| `autoWiden` | Extends whichever end the data overflows — on a reversed axis that is `max`, the numeric floor. |
| Small multiples | The one shared domain stays reversed across every pane. |
| Bars, stacks, histograms, waterfalls | Still grow from zero; on a reversed all-positive domain they hang from the ceiling. |

### Series

The series **column** is set via `columns.series`. These options reference the series **keys**
(the values in that column).

| field | type | notes |
|---|---|---|
| `series_order` | array | Render order. **Also an inclusion filter** — when set, only listed series render. For stacked charts (bar/area) it is also the bottom→top stack order. |
| `series_colors` | object | `{ <seriesKey>: color }`. Overrides palette assignment. `color` is a named color or raw `"#hex"` (see [Colors](#colors)). |
| `series_styles` | object | `{ <seriesKey>: { dashed: true } }`. `dashed` is currently the only flag. |
| `series_labels` | object | `{ <seriesKey>: "Display name" }`. Lets the CSV use short keys while the legend/tooltip show full names. |
| `bar_color` | color | **Single-series bar charts only.** The one series' bar fill, resolved through the palette. A first-class replacement for the `series_colors: {"": color}` idiom — that idiom still works; `bar_color` wins when both are set. Ignored on multi-series (grouped) bar charts. With `highlightSeries`, `bar_color` replaces the base color only — a non-highlighted series still dims. |
| `category_colors` | object | **Single-series bar charts only** (both orientations). `{ <xCategory>: color }` — per-category fill override, e.g. a distinct color for one "Total" category while the rest keep the base fill (`bar_color` or series color). Unlisted categories are unaffected. Ignored on multi-series (grouped) bar charts. Validation flags any key not found in the x column. |

### Annotations

A single `annotations:` block holds all four annotation kinds. (The legacy `xAxisPolicy.markers`,
`xAxisPolicy.bands`, and `yAxisPolicy.markers` fields are still accepted and mean the same as
`annotations.xAxis`, `annotations.bands`, and `annotations.yAxis` respectively — prefer
`annotations`.)

| field | type | notes |
|---|---|---|
| `annotations.xAxis` | array | **Vertical** reference lines. Each `{x, label?, value_format?, style?, color?, strokeWidth?, labelSide?, labelPosition?, labelDx?, labelDy?, facet?}`; `x` required. `style` is `dashed` (default) \| `solid`. Two label controls: **`labelSide`** = which *side of the line* (`left`\|`middle`\|`right`, default right); **`labelPosition`** = *where along the line* relative to the x-axis (`top` default, auto-staggered \| `middle` \| `bottom`). `labelDx`/`labelDy` are px nudges — **`+labelDx` = right, `+labelDy` = up**. On **horizontal bar** charts with a numeric `x`, an `xAxis` marker now renders as a vertical rule on the value axis (previously silently ignored). |
| `annotations.yAxis` | array | **Horizontal** reference lines. Each `{y, label?, value_format?, style?, color?, strokeWidth?, labelSide?, labelPosition?, labelDx?, labelDy?, facet?}`; `y` required. Two label controls (the axes swap vs. xAxis): **`labelSide`** = which *side of the line* (`top` default \| `middle` \| `bottom`); **`labelPosition`** = *where along the line* (`left` \| `middle` \| `right`, default right). `labelDx`/`labelDy` are px nudges — **`+labelDx` = right, `+labelDy` = up**. |
| `annotations.bands` | array | **Shaded** vertical x-regions. Each `{start, end, label?, color?, legend?, rug?}`. |
| `annotations.points` | array | **Callouts** at a data coordinate. Each `{x, label, y?, series?, value_format?, color?, dx?, dy?, connector?}`; `x` + `label` required. Omit `y` and give `series` to snap to that series' value at `x` (the cumulative stack top on area charts). `connector: true` draws a leader arrow from the label to the point. `dx`/`dy` nudge the label — **`+dx` = right, `+dy` = up**. |

Marker/label `color` is a named color or `"#hex"`; the label color matches its line. When
`color` is omitted, both `xAxis` and `yAxis` reference lines default to the dim annotation
neutral (`annotationDim`) so they read as chrome rather than a data series.

**`{value}` token.** Any `xAxis`/`yAxis`/`points` `label` may contain a literal `{value}` token,
substituted with the marker's own numeric value (`x` when it parses as a number, `y`, or the
callout's resolved value). `value_format` controls the substitution: `{decimals?, prefix?, suffix?}`
(decimals default 2). Without `value_format`, the substitution falls back to the chart's
value-axis tick format (`yAxis`/`points`) or the raw `x` string (`xAxis`, or any `x` that doesn't
parse as a number). A `label` without the token is unaffected.

**`facet` (small multiples only).** Scope an `xAxis`/`yAxis` marker to the pane whose facet value
equals `facet`; omit to render in every pane (unchanged default). Ignored on a non-faceted chart.
`bands`/`points` are not facet-scoped.

### Keying annotations in the legend (`legend: true`)

On a busy chart there is often nowhere inside the frame for an annotation's label to sit. Set
`legend: true` on a `bands`, `xAxis`, or `yAxis` entry (or on a [`shading`](#shading-line-charts)
region) and its `label` renders as a **legend row** above the plot instead of as text inside it.

| behavior | detail |
|---|---|
| needs a `label` | The label *is* the legend key. `legend: true` with no label is a validation error. |
| **replaces** the in-chart label | A keyed band or reference line draws no text in the frame and reserves no auto-stagger row. Moving the label out is the point; asking for both would re-create the clutter. |
| one row per **label** | Entries sharing a label collapse into a single row — three recession bands become one "US recessions" key. (A fill and a reference line sharing a label stay separate rows: one swatch can't be both.) |
| swatch | Fills get a rect chip in the tint you will actually see (the fill color flattened over white at its `fillOpacity`, with a hairline so a 10 %-opaque band still reads as a chip). Reference lines get a line swatch in the marker's color, dashed when the marker is. A `rug: true` entry is keyed by its **solid** rug color instead — the block, not the tint, is what the reader matches. |
| **multi-series fills** | A `shading` region with no `series` paints one fill per series, each in that series' color. Its chip then shows **every** tint as equal bands (widening so the bands stay legible, up to 30 px), rather than keying the gold and purple fills with the blue one. Writing one region per series under a shared label collapses to that same single banded row. Give the region an explicit `color` to key it with one chip instead. |
| **`rug: true` keys the block** | A rug-flagged fill's chip is a single **solid** chip in the block's own color — the strip can draw only one color, and the chip's job there is to key the block. That color is the region's `color`, else the color of the `series` it names, else the annotation neutral (a region covering *every* series has no one color a strip could carry). |
| ambiguous swatches rejected | Two keyed fills that would resolve to the **same** swatch — both taking their tint from the series palette, over the same series scope, at the same `fillOpacity` — are a validation error. This bites the natural above-target / below-target pair: give at least one an explicit `color` (or a different `fillOpacity`). |
| row order | Series → `bands` → `shading` → `xAxis` → `yAxis` → explicit `rug.tracks`, each in spec order. Not author-controllable. |
| `legend: false` | Suppresses the row (including one implied by `rug: true`). Chart-level `legend: false` suppresses the whole legend, in which case a keyed label stays in the frame rather than being lost. |

**Hover and pin.** Keyed rows are interactive, in both directions:

- **Hovering a row** brightens every chart element it names — all its bands, all its fills, its
  reference line, all its rug blocks — and dims everything else, the data line included. Clicking
  pins that highlight; a reset button appears beside the legend to clear it.
- **Hovering a rug block** does the reverse: it marks its legend row and brightens that track's other
  parts, dimming the rest. Clicking pins it. While the pointer is on the strip the value crosshair
  stands down, so a rug hover gives one answer rather than two.
- Selecting a **series** row dims the keyed annotations too — the two live in one universe, so any
  selection spotlights its own subject.
- A keyed `shading` fill answers to **both** keys: it dims with its own line (as it always has) and
  lights up with its annotation row.

In-frame regions — band rects and `shading` fills — are deliberately **not** hover targets. They sit
where the reader sweeps the crosshair to read values, so hovering them would flicker the whole chart
on and off as the pointer crossed each region. The rug is the hoverable key.

A chart with **one** series and keyed annotations gets a legend built from those rows alone — which
is the case the feature was built for. `annotations.points` cannot be keyed: a callout *is* its
label, and moving it loses the coordinate it points at.

```yaml
annotations:
  bands:
    - { start: "2008-01-01", end: "2009-07-01", color: grey, label: US recessions, legend: true }
    - { start: "2020-03-01", end: "2020-05-01", color: grey, label: US recessions, legend: true }
  yAxis:
    - { y: 0.29, label: "Threshold (0.29)", color: grey, legend: true }
```

### X-axis rug

`rug` draws a thin strip of **solid interval blocks** between the x-axis line and its tick labels —
a timeline for categories that are illegible as fills (a one-month false-positive run on a 26-year
axis is a hairline) or that would clutter the frame as labelled bands.

Blocks are grouped into **tracks**, one per label and color. All tracks paint into the **one** strip
in resolution order (later over earlier), so the strip reads as a single timeline rather than a stack
of rows. Every track is keyed in the legend.

Tracks are usually **derived, not declared**: flag an `annotations.bands` or `shading` entry with
`rug: true` and its interval joins the track named by its `label`. That keeps the dates stated once.

| field | type | notes |
|---|---|---|
| `rug` | object | `{height?, tracks?}`. Both optional — `rug: {}` is valid and correct when every track is derived from a `rug: true` flag. |
| `rug.height` | number | Height in px of **one row**. **Default 8.** The tick labels shift down to make room for the whole strip, so nothing overlaps. |
| `rug.rows` | enum | `single` (default) \| `per-track`. **`single`** paints every track into one row, later over earlier — right when the tracks are near-disjoint in x, where a short run at the head of a longer one reads as adjacency (that is how the michez strip shows a false negative running into its recession). **`per-track`** gives each track its own row, so no track can hide another; use it for per-series breach windows, or when one track spans the axis. A track that `single` would cover *completely* is a validation error naming this field. |
| `rug.tracks` | array | Standalone tracks, for a timeline concept with no band or fill of its own. Each `{label, intervals, color?, legend?}`. Appended after the derived tracks. |
| `rug.tracks[].intervals` | array | Each `{from, to}` — closed x-value spans in the same string form as `annotations.bands.start`/`end` (**quote numbers in YAML**). Must not be empty. |
| `rug.tracks[].color` | color | Named token or `"#hex"`, painted **solid**. Default: the dim annotation neutral. |
| `rug.tracks[].legend` | boolean | Set `false` to draw the blocks without a legend row. Rare — you then have to key them some other way. |
| `annotations.bands[].rug` | boolean | Add this band's `start`→`end` to the rug. Needs a `label`. |
| `shading[].rug` | boolean | Add this region's `from`→`to` to the rug. Needs a `label` **and both bounds** — an open-ended fill has no interval to draw. |

`rug: true` implies `legend: true` (a solid block with no key is unreadable); `legend: false` on the
same entry opts the row back out.

A block narrower than 2px is drawn at 2px, so a single month stays visible — that being the whole
point. Blocks are clamped to the plot's x extent; an interval wholly outside the x-domain is dropped.

**Not supported:** `xAxisType: categorical` (a band scale has no position between categories) and
`small_multiples`. Both are validation errors, as is a `rug` that resolves to no tracks.

A `rug: true` band still paints its in-chart tint. To show a concept **only** on the rug, declare it
as an explicit `rug.tracks` entry instead of as a band.

**Multi-series charts.** One strip is a single timeline, so it cannot say *which series* is in a given
state — a region covering every series draws one neutral track ("some series is below balance here").
For per-series timelines, give each region its own `series` and `label` and set `rug.rows: per-track`:
each series then gets its own row, in its own color, and the rows read as a small gantt.

**Don't make one row key two different things.** `rug: true` on a region covering every series asks a
single row to key both N colored fills *and* one neutral block, and it can only do one — it keys the
block (see the table above), leaving the fills identified by the series rows instead. When you want
both keyed, they are two concepts, so give them two rows: leave the fill un-rugged (its chip bands the
tints) and declare the union band as its own `rug.tracks` entry with its own label.

```yaml
# The fills, keyed by their own tints…
shading:
  - { side: negative, label: Below balance, legend: true, fillOpacity: 0.35 }
# …and the union band, keyed as the separate thing it is.
rug:
  tracks:
    - { label: Any series below, color: grey, intervals: [{ from: "2000", to: "2030" }] }
```

```yaml
# The michez-rule chart: recessions from the bands, false negatives/positives from the fills.
rug: {}
annotations:
  bands:
    - { start: "2001-04-01", end: "2001-12-01", color: grey, label: US recessions, rug: true }
    - { start: "2008-01-01", end: "2009-07-01", color: grey, label: US recessions, rug: true }
  yAxis:
    - { y: 0.29, label: "Threshold (0.29)", color: grey, legend: true }
shading:
  - { from: "2001-04-01", to: "2001-07-01", side: negative, baseline: 0.29, color: amber, label: False negatives, rug: true }
  - { from: "2008-01-01", to: "2008-04-01", side: negative, baseline: 0.29, color: amber, label: False negatives, rug: true }
  - { from: "2024-03-01", to: "2025-06-01", side: positive, baseline: 0.29, color: red, label: False positives, rug: true }
```

### Confidence bands

| field | type | notes |
|---|---|---|
| `confidence_bands` | array | Each `{series, lower, upper}`. `series` is the data key the band wraps; `lower`/`upper` are CSV column names. Renders as a tinted area behind the line. |

### Shading (line charts)

`shading` fills the region between a line and its baseline. **`chartType: line` only** — `area`
already fills to the axis, and the other types have no line to fill under.

| field | type | notes |
|---|---|---|
| `shading` | array | Each `{series?, side?, from?, to?, color?, fillOpacity?, label?, legend?, rug?}`. Entries are **independent** and paint in list order, so one series may carry several regions; overlapping fills compound their opacity (that is how you deepen a tint). |
| `shading[].series` | string | Series to fill under. **Omitted → every in-scope series** gets its own region in its own color. |
| `shading[].baseline` | number | The level the fill runs to, and what `side` is measured against. **Default 0.** Set it to a rule's threshold to shade only the breach — the part of the line beyond that level, filled back to it. Negative thresholds work the same way (`baseline: -0.7` with `side: negative`). |
| `shading[].side` | string | `both` (default) \| `positive` \| `negative` — which side of `baseline` to fill. Runs are split at the baseline crossing, interpolated so the fill closes flat on it rather than on a slanted edge. |
| `shading[].from` / `.to` | string | Inclusive x bounds, same string form as `annotations.bands.start`/`end` — **quote numbers in YAML** (`from: "2026"`), exactly as `annotations` x values require. Omitted → the series' first/last point. A bound falling **between** two points is interpolated to that exact x, so the fill edge lands where you asked rather than at the nearest point. On a categorical x-axis there is no position between categories, so bounds must **name existing categories** and crop on category boundaries. |
| `shading[].color` | color | Named palette token or `"#hex"`. Omitted → the series' own resolved color. |
| `shading[].fillOpacity` | number | 0–1. **Default `0.5`.** Two overlapping regions compound — 0.5 over 0.5 renders as 0.75 — so drop the lower one if you are layering a base tint under an accent window. |
| `shading[].label` | string | What the fill **means** ("False positives"). A fill has no in-chart text of its own, so this is purely a key: it names the region in the legend (with `legend: true`) and groups regions into one [rug](#x-axis-rug) track. Regions sharing a label collapse to one legend row. **Requires `legend: true` or `rug: true`** — a label with neither has nothing to do, so validation rejects it. |
| `shading[].legend` | boolean | Key this fill in the legend — see [Keying annotations in the legend](#keying-annotations-in-the-legend-legend-true). |
| `shading[].rug` | boolean | Also draw this region's span as a solid block on the [x-axis rug](#x-axis-rug). Needs a `label` and **both** `from` and `to`. |

**Baseline.** `baseline` (default 0) is what `side` measures against and where the fill's flat edge
sits. The drawn edge is clamped into the resolved y-domain, so a fill never leaves the plot frame. Shading does **not** expand the domain: if you want the zero
baseline actually visible on a chart whose data sits well away from it, set
`yAxisPolicy.includeZero: true`. `side` always keys off zero, never off that clamped baseline.

Fills paint in the underlay — behind the gridlines, and beneath any `confidence_bands` on the same
chart. They carry their series' identity, so legend hover/pin dims them with their line.

Validation rejects a region naming a series the data lacks, a categorical bound naming a missing
category, and a `side` that could never match (e.g. `side: negative` where the series is never
negative).

```yaml
# Shade only where a rule is breached, filling back to its threshold rather than to zero.
chartType: line
shading:
  - series: Sahm rule
    side: positive
    baseline: 0.5
annotations:
  yAxis:
    - { y: 0.5, label: "Threshold (0.5)", color: grey }   # draw the threshold line itself
```

```yaml
chartType: line
shading:
  - series: Primary deficit
    side: negative              # shade only the deficit years
  - series: Primary deficit
    from: "2026"                # a flatter tint over the projection window
    to: "2035"
    color: gray
    fillOpacity: 0.10
```

### Line & area options

| field | type | notes |
|---|---|---|
| `points` | boolean | Line charts: draw a marker dot at each data point. Default false. |
| `projected_field` | string | Data column whose truthy value (`1`/`true`/`yes`, case-insensitive, trimmed) flags a row as projected (forecast/estimated) rather than actual. **Line:** the flagged run(s) of a series draw dashed, connecting continuously to adjacent actual points — a series may have multiple disjoint projected runs. **Area (stacked):** the fill fades over x-ranges where *every* in-scope series is flagged projected (conservative — a stack can't express partial-series fading). Absent ⇒ no projected styling (byte-identical output). A series also listed in `series_styles[..].dashed` (whole-series dashed) is not split by this field — the whole-series override wins. |
| `projected_style.dashed` | boolean | Line charts, only consulted when `projected_field` is set. Default true; `false` renders the projected run solid (opts out of the visual distinction while keeping the field wired). |
| `projected_style.fillOpacity` | number | Area charts, only consulted when `projected_field` is set. Effective fill opacity of the projected x-range's white veil overlay. Default 0.2. |

Area charts (`chartType: area`) stack their series (a single series fills to the zero baseline);
stack order follows `series_order`. The hover tooltip adds a cumulative **Total** row, and
selecting series in the legend animates them to the bottom of the stack so they can be read against
zero.

### Point charts (scatter / dot plot)

The shape **column** is set via `columns.shape`; these mirror the `series_*` fields for the
shape-encoding legend. When color and shape encode different fields, each legend is titled.

| field | type | notes |
|---|---|---|
| `shape_order` | array | Shape render order; also an inclusion filter. |
| `shape_labels` | object | `{ <shapeKey>: "Display label" }` for the shape legend. |
| `color_legend_title` | string | Heading above the color (series) legend group. |
| `shape_legend_title` | string | Heading above the shape legend group. |

### Bar / stacked-bar options

| field | type | notes |
|---|---|---|
| `orientation` | enum | `vertical` (default; value axis is Y) \| `horizontal`. |
| `x_axis_ticks` | enum | **Horizontal bars only** (standalone and faceted). Where the value-axis tick row(s) render: `bottom` (default) \| `top` \| `both`. Requires `orientation: horizontal` — validation rejects it on a vertical chart (there is no top value axis there). |
| `valueLabels.show` | boolean | **Stacked bars only.** Show per-segment value labels (in-bar value labels for plain/grouped bars were removed). Default off. |
| `valueLabels.decimals` | integer | Fixed decimal places for the labels that remain (stacked segment + net callouts); else the minimum the data needs, capped at 2. |
| `barStack.netDisplay` | enum | Net (sum) callout on stacked bars: `auto` (default — dot if any value is negative, else text) \| `text` \| `dot` \| `none`. When the net **dot** is shown, hovering a category shows the floating tooltip (with a dot-swatch Total row), not the per-segment value pills. |
| `barStack.mono.base` | color | Monochrome stack: render all segments as shades of one base hue (a categorical hue key or alias; see [Colors](#colors)). |
| `barStack.netLabelColor` | enum | `white` \| `black`. |
| `barStack.normalize` | boolean | Normalize each bar to 100%. |
| `barStack.stackOrder` | array | Visual bottom→top stack order, independent of `series_order` (which still drives legend + colors). |
| `highlightSeries` | array | Series keys to emphasize (dims all others). |
| `legendPosition` | enum | `top` \| `right`. Default `top`, except a diverging stacked chart or one with ≥5 series defaults to `right`. An explicit value always wins. |
| `legend` | boolean | Set `false` to hide the legend entirely (top/right/figure/PNG export alike) while keeping multi-series coloring, tooltips, and crosshair. Click-to-pin/dim is consequently unavailable, since it's driven through the legend. Default true. Not bar-specific — applies to any chart type with a legend. |

### Histogram options

`chartType: histogram` bins a continuous x column into edge-to-edge bars. `xAxisType` must be
`numeric` or `temporal`. By default the engine bins **raw** rows (one row per observation); mapping
`columns.x0` + `columns.x1` switches to **pre-binned** input instead (see below).

| field | type | notes |
|---|---|---|
| `histogram.bins` | integer | Target bin **count**. Ignored when `binWidth` is set. |
| `histogram.binWidth` | number \| string | Bin **width**. Numeric x: a number in x-units. Temporal x: a calendar interval name — `day` \| `week` \| `month` \| `quarter` \| `year` — **or** a plain number, interpreted as a day count. |
| `histogram.domain` | `[number, number]` | Explicit binning range `[min, max]`. Default: the data extent. |
| `histogram.normalize` | enum | Bar-height normalization: `none` (default, raw counts/weights) \| `proportion` (each series' bins sum to 1) \| `density` (each series' area — Σ height × bin width — sums to 1). |
| `histogram.weight` | string | Column **summed** per bin (a weighted histogram) instead of counting rows. Default: row count. Ignored (and rejected — see below) for pre-binned data. |
| `histogram.bin_label` | object | Friendly formatting of the hover tooltip's bin-range header. See below. |

**Bin-range tooltip labels (`histogram.bin_label`).** The hover tooltip header shows a friendly bin
label instead of a mathematical interval. Numeric x renders an en-dash range (`47.9 – 50.7`).
Temporal x whose `binWidth` is a calendar interval name collapses each bin to its period name
(`month` → `July 2023`, `quarter` → `Q3 2023`, `year` → `2023`, `week` → `Week of July 2, 2023`,
`day` → `July 5, 2023`); any other temporal binning (a bin count, or a day-count `binWidth`) renders
a month range (`July – September 2023`, or `July 2023 – March 2024` across years).

| field | type | notes |
|---|---|---|
| `histogram.bin_label.unit` | string | Applied to each **numeric** edge, e.g. `"$"`, `"%"`, `" yrs"`. Ignored for temporal labels. A suffix unit that begins with a space (`" yrs"`) is appended once to the range; a tight suffix (`"%"`) attaches to each edge. |
| `histogram.bin_label.unit_position` | enum | `prefix` \| `suffix`. Default `suffix`. |
| `histogram.bin_label.decimals` | integer | Numeric edge rounding. Default: smart trim to ≤2 fraction digits (drops float-accumulation noise). |

**Bin-width precedence:** `binWidth` > `bins` > **auto**. With neither set, the engine picks a bin
count itself via the Freedman–Diaconis rule, falling back to Sturges' rule when the data's IQR is
zero (e.g. a near-constant column).

**Pre-binned input.** Map `columns.x0` + `columns.x1` to the columns holding each row's bin lower/
upper edge; `columns.value` (default `"value"`) supplies the bar height directly, and the engine
draws the given edges as-is rather than computing its own — edges may be uneven. Because there is
no data left to bin, the `histogram` block's binning fields (`bins`, `binWidth`, `domain`,
`weight`) are meaningless in this mode and **validation rejects the spec** if any are set alongside
`columns.x0`/`x1`. (`histogram.normalize` still applies, reusing the same
proportion/density logic over the given bin heights.)

**Overlapping multi-series.** With `columns.series` set, each series draws its own translucent bar
layer over a **shared** set of bins — series don't stack or dodge, they overlay, so the visual
answers "how do these distributions compare" rather than "what's the combined total." `series_order`
still controls z-order and legend/color assignment; a series with no observations in a bin renders
a zero-height bar there (not a gap) so all series share the same bin count.

**Faceting.** Combine `columns.facet` with `small_multiples` as usual. `small_multiples.mode`
governs how bins are computed per pane:

- `shared` (default) — one set of bin thresholds is computed across **all** in-scope rows and
  reused by every pane, so panes share a common x-domain and their bars line up for cross-pane
  comparison.
- `per-pane` — each pane bins only its own rows, independently (its own thresholds, possibly a
  different bin count/domain than its neighbors).

> **Pre-binned + faceting caveat.** The `shared` mode's cross-pane threshold computation only
> applies to **raw** data that the engine bins itself. Pre-binned panes (`columns.x0`/`x1`) already
> carry their own edges per row, and those edges are **not** coordinated across panes in `shared`
> mode — each pane simply renders the edges its own rows supply. If you need pre-binned facets to
> line up on a common x-axis, give every facet the same bin edges yourself in the source data.

### Dumbbell options

`chartType: dumbbell` draws a **connected dot plot**: one dot per series in each category, joined
by a connector "stem", so the **gap** between series is the visual subject — for two or three
values that compare but don't sum (e.g. current-law vs. static vs. collected effective rates).
`xAxisType` must be `categorical`; `orientation` decides the rendering (`horizontal`, default —
categories down the left, values along x — or `vertical`). Map the categorical column via
`columns.category` (or `columns.x`), the value via `columns.value`, and the dot identity via
`columns.series`. Series color/order/labels reuse the shared `series_*` fields; category order
reuses `category_order` (or `x_order`); faceting reuses `columns.facet` + `small_multiples`.

| field | type | notes |
|---|---|---|
| `orientation` | enum | `horizontal` (default; categories on the y band, values on x) \| `vertical`. |
| `series_marker` | object | Per-series dot style: `filled` (solid series color) \| `hollow` (ring — series-color outline, page-background center) \| `ink` (filled neutral ink). Unlisted series default to `filled`. Lets "static/ask" read hollow and "collected" filled. The legend swatch matches (a hollow series shows a ring). |
| `connector` | object | Stem styling: `connector.color` (a color token/hex), `connector.width` (px, default 1.5), `connector.style` (`solid` default \| `dashed` \| `dotted`). Default a subtle neutral line drawn behind the dots. A single-dot (or exactly-coincident) category draws no stem. |
| `dot_radius` | number | Dot radius in px. Default 5. |
| `gap_annotation` | boolean \| object | Label the numeric gap between two series on each stem. `true` uses the first two series in order; an object names them: `{ series_a, series_b, format? }`. `format` (else `value_format`) formats the number. Default off. |
| `value_axis_title` | string | Short caption on the value axis. |
| `value_format` | object | Number format for values in labels: `{ decimals, prefix, suffix }` (e.g. `{ decimals: 1, suffix: "%" }`). |

The value axis **fits the data** and does **not** force a zero baseline (a 2%–35% rate view keeps
its useful range); zero is included only when the dots cross it, and a zero rule is drawn there.
Faceted dumbbells share a common value scale by default (`small_multiples.mode: per-pane` gives
each pane its own).

**Hover & coordinated cursor.** Hovering anywhere in a category's band (a row for horizontal, a
column for vertical) highlights that band and shows a tooltip listing each series' value. In a
faceted dumbbell the cursor is coordinated — hovering a category echoes the band highlight on every
pane (unless `coordinated_cursor: false`).

**Sections (horizontal).** `columns.section` groups the categories into labeled blocks with bold
headers in the left gutter, exactly like horizontal bars (`section_order` / `section_labels`
control order and header text). Horizontal orientation only.

```yaml
chartType: dumbbell
orientation: horizontal
xAxisType: categorical
columns: { category: group, series: measure, value: rate }
category_order: [Quintile 1, Quintile 2, Quintile 3, Quintile 4, Quintile 5]
series_order: [current_law, static, collected]
series_labels: { current_law: Current law, static: Static rate, collected: Collected after behavior }
series_marker: { current_law: ink, static: hollow, collected: filled }
value_axis_title: Effective tax rate
value_format: { decimals: 1, suffix: "%" }
gap_annotation: { series_a: static, series_b: collected }
```

### Small multiples

Set `columns.facet` to the pane-splitting column, then tune the grid here.

| field | type | notes |
|---|---|---|
| `small_multiples.columns` | integer | Grid column **count** (distinct from the `columns` role map). Default derived (≈ ceil(√n), capped). |
| `small_multiples.mode` | enum | `shared` (one y-scale, y-labels in the left column only — default) \| `per-pane` (each pane its own y-scale/units). |
| `small_multiples.pane_order` | array | Pane render order + inclusion filter. |
| `small_multiples.pane_titles` | object | `{ <facetValue>: "Display title" }`. Falls back to the raw facet value. |
| `small_multiples.coordinated_cursor` | boolean | Hovering one pane echoes a secondary cursor on every pane at the same x. Default true. |
| `small_multiples.pane_widths` | enum \| array | How a row's width splits among its columns (vertical bar facets; applied to every row). `equal` (default) — same data width per column. `equal-bar` — each column sized to its bar count so bars render at the same width (exact for a single row; multi-row uses the max bar count per column). An array like `[2, 1]` sets explicit per-column proportions (length must equal the column count). When set and `columns` is unset, the panes lay out in a single row. |

**Faceted horizontal bars/stacks.** `orientation: horizontal` combines with `small_multiples` to
produce a faceted horizontal chart: each pane is one facet value, the panes share a single value (x)
axis, and the category labels form a shared left gutter sized to the longest label — shown on the
leftmost pane only, so the rows line up across panes. Works with single-series, grouped (multi-series),
and **stacked** bars. Use `shared` mode (the default) so the value axis is comparable across panes.
On a diverging stack, `barStack.netDisplay: dot` keeps the net dot in each pane (at a reduced radius);
the net text callout and per-segment value labels are suppressed in panes. With `columns: 1` each
facet occupies its own row with its own full-width category axis, so facets may carry **different**
categories (the shared-category requirement — see below — applies only when panes share a row).

### Section axis (horizontal bars)

Set `columns.section` to group the category axis into labeled sections (horizontal bar charts only).
Categories are ordered so each section is contiguous, with a bold section header in the left gutter
and a gap between sections. Combines with `small_multiples` (the headers show on the leftmost pane).

| field | type | notes |
|---|---|---|
| `columns.section` | string | Column whose distinct values define the sections. |
| `section_order` | array | Section render order along the category axis; also an inclusion filter (like `series_order`). |
| `section_labels` | object | `{ <sectionValue>: "Display label" }` for the section headers. |

`columns.section` and `columns.facet` are supported together on faceted horizontal bars (both
`shared` and `per-pane` `small_multiples.mode`). When panes share a row (`columns > 1`), faceted
horizontal bars/stacks share one category axis across those panes, so every facet must carry the
same categories (and sections) — a facet missing a category or a whole section (a **ragged facet**)
fails validation with an error naming the facet and the missing categories/sections, rather than
silently misaligning rows across panes. This does not apply with `columns: 1` (each facet is on its
own row with its own category axis, so different categories per facet are allowed).

### Data

`data` is usually the bare filename. The object forms support a local file or a remote source.

| form | notes |
|---|---|
| `data: data.csv` | String — sugar for `{ file: "data.csv" }`. The common case. |
| `data: { file: "..." }` | Explicit local file, relative to the chart folder. |
| `data: { url: "...", format: "csv"\|"json", map?: {...} }` | Remote source. For JSON, `map` renames source fields onto the tidy shape: `{ timeField, seriesField, valueField }`. |

### Catalog

| field | type | notes |
|---|---|---|
| `tags` | array | Free-form facet tags (recorded by consuming repos' catalogs; ignored by the renderer). |

---

## `table.yaml`

A table renders from **tidy/long** data: one CSV row per cell, identified by its stub (row) and
header (column) coordinates plus a value. Stub entries nest to form the row hierarchy (all but the
last → row groups; last → the row label). Header entries nest to form the column hierarchy (all but
the last → banner tiers; last → the leaf column). The value column holds a number, a blank, or a
text string.

### Required

| field | type | notes |
|---|---|---|
| `title` | string | Table title. |
| `data` | string | Path to the tidy CSV. |
| `stub` | array | Row-nesting columns. Each entry is a CSV column name or `{label: "..."}`; the **last** entry is the row label, earlier ones are nested row groups. |
| `header` | array | Column-nesting CSV column names; the **last** is the leaf column, earlier ones are banner tiers. |
| `value` | string | CSV column holding each cell's value (number, blank, or text). |

### Roles & panes

| field | type | notes |
|---|---|---|
| `pane` | string | Multi-pane: CSV column whose values split the data into vertically stacked sub-tables, each with its own rows **and** column headers. Omit for a single table. |
| `pane_order` | array | Pane render order + inclusion filter. Default: first-seen. |
| `pane_titles` | object | `{ <paneValue>: "Subheading" }` above each pane. Defaults to the pane value. |

### Labels

| field | type | notes |
|---|---|---|
| `stub_header` | string \| object | Top-left corner label above the row labels. A string applies to all panes; a `{ <paneValue>: label }` map sets it per pane. |
| `column_labels` | object | `{ <leafKey>: "Display label" }` — overrides a leaf column's raw header value. |
| `row_labels` | object | `{ <rowValue>: "Display label" }` — overrides a row label (last stub value). Lets math/markup live in the spec while the CSV keeps short plain keys; `row_order`, `emphasis_rows`, and `format.rows` still key off the raw CSV value. |
| `group_labels` | object | `{ <groupValue>: "Display label" }` — overrides a row-group heading (any non-last stub value); `group_notes` and `format.groups` still key off the raw CSV value. |
| `header_labels` | object | `{ <headerValue>: "Display label" }` — applied to banner tiers above the leaves. |
| `sublabels` | object | `{ <leafKey>: "secondary" }` — a small second line under a column label (e.g. units). |

Leaf columns are keyed by their **full header path**, not just the last-tier value, so a leaf value
that repeats under different banners (e.g. the same metric under two different scenario headers)
renders as distinct columns instead of one column silently swallowing the other. `header_labels`,
`column_labels`, `sublabels`, `column_order`, and the `column_width` map still key off the leaf's
raw last-tier value (the display label an author writes), so authoring is unaffected — a rule keyed
by a repeated leaf value applies to every leaf sharing that value.

### Order

| field | type | notes |
|---|---|---|
| `row_order` | array | Row render order; unlisted rows follow in first-seen order. **Scoped within each row group** — it orders leaves inside a group, not across groups. |
| `group_order` | array | Render order for row **groups** (the non-last stub tiers). A flat `string[]` orders the first group tier only; a `string[][]` orders each tier independently (index 0 = first tier, index 1 = second, ...). Unlisted values at a level follow first-seen order. Groups are always gathered by stub path regardless of input row order, so a group's rows render contiguously wherever they appear in the source data (e.g. a scenario-major CSV regroups correctly). |
| `column_order` | array | Leaf-column render order; unlisted leaves follow in first-seen order. On a multi-tier header it is **scoped within each header super-group** — it orders the leaf tier inside a super, not across supers. |
| `column_group_order` | array | The column analogue of `group_order`: render order for header **super-groups** (the non-last header tiers). A flat `string[]` orders the first super tier only; a `string[][]` orders each tier independently. Unlisted values follow first-seen order. Super-groups are always gathered by header path regardless of input row order, so each super `<th>` spans its leaves contiguously (`colspan`). |

### Number formats

`format` resolves per cell with precedence **default → column → group → row**. Each rule is a
`FormatRule`:

| FormatRule field | type | notes |
|---|---|---|
| `type` | enum | `number` (default) \| `percent` (×100, adds `%`) \| `currency`. |
| `decimals` | number | Decimal places. |
| `thousands` | boolean | Group thousands with `,`. |
| `prefix` | string | e.g. `"$"`. |
| `suffix` | string | e.g. `"pp"` (a `percent` type already adds `%`). |
| `signColor` | boolean | Color negatives red / positives green for this scope. |

| field | type | notes |
|---|---|---|
| `format.default` | FormatRule | Applies to all cells. |
| `format.columns` | object | `{ <leafKey>: FormatRule }`. |
| `format.groups` | object | `{ <groupValue>: FormatRule }`. |
| `format.rows` | object | `{ <rowLabel>: FormatRule }`. |
| `sign_color` | boolean | Apply sign coloring to all cells (overridable per `FormatRule.signColor`). |

Non-numeric, non-empty values render verbatim as left-aligned **text cells** (no number
formatting).

### Cells, footnotes & emphasis

| field | type | notes |
|---|---|---|
| `emphasis_rows` | array | Row labels to render bold/highlighted — styles the **whole row, including the stub** (row label cell), identically in HTML and PNG export. |
| `emphasis_column` | string | CSV column holding a per-cell emphasis flag (`yes`/`1`/`true`). |
| `footnotes` | object | `{ <key>: "text" }` (e.g. `{ a: "revised" }`); rendered as a list below the table. |
| `footnote_column` | string | CSV column holding per-cell footnote keys (space- or comma-separated). |
| `group_notes` | object | `{ <groupValue>: "note" }` — an italic note under a row-group heading. |

### Layout & interactivity

| field | type | notes |
|---|---|---|
| `stub_width` | number | Fixed px width for the stub (row-label) column. Overrides the computed width. |
| `stub_min_width` | number | Minimum stub width — a floor on the auto-sized width, or (with `stub_wrap`) the width labels wrap toward. |
| `stub_wrap` | boolean | Allow row labels to wrap onto multiple lines so the stub can be narrower than the longest label. Default false. |
| `stub_nowrap` | boolean | Keep row labels on one line (the stub is sized to the longest). Default false. |
| `column_width` | number \| object | Fixed px width for data columns: one number for all, or `{ <leafKey>: px }`. |
| `column_wrap` | boolean \| object | Wrap **body** data cells onto multiple lines within the column width: `true` (all data columns) or `{ <leafKey>: true }` (named ones). Default false. Pair with `column_width` to cap the width — without a cap the column sizes to its natural width and nothing wraps. Column headers are unaffected (use `header_max_lines` / the `\\` break token for those). |
| `header_max_lines` | number | Wrap leaf-column headers to at most N lines. |
| `spanner_rules` | boolean | Draw flanking rules on multi-column banner headers. Default true. |
| `header_tier_rules` | boolean | Draw horizontal rules between header tiers. Default false. |
| `sticky.firstColumn` | boolean | Pin the row-label column during horizontal scroll. |
| `sort` | boolean | Allow interactive column sorting (within row groups). |
| `collapsible.default` | enum | Makes row groups collapsible: a caret on each group header toggles that group's rows (a nested group collapses its whole subtree), plus expand-all/collapse-all controls. Baseline state for every group not named in `expanded`/`collapsed`. Default `"expanded"`. Omit `collapsible` entirely for the current plain (non-interactive) group headers. |
| `collapsible.expanded` | array | Group **values** (raw CSV values, matching `group_labels` keying) open despite a `"collapsed"` default. |
| `collapsible.collapsed` | array | Group values closed despite an `"expanded"` default. Wins over `expanded` when a value appears in both. |

Collapse state survives a resize, and PNG export renders a static snapshot honoring the live
collapse state (or the spec's defaults, when exported without interaction).

### Text

| field | type | notes |
|---|---|---|
| `subtitle` | string | Below the title. |
| `source` | string | Source line below the table. |
| `notes` | string \| array | Explanatory note(s); each string renders as a paragraph. |

### Inline math & special characters

Any table text — cell values, row/column labels, headers, sublabels, group labels & notes, the
stub-header corner — may contain inline math using the **same MathJax delimiters as the TBL
website**:

- `\( … \)` — inline math (also `\[ … \]` and `$$ … $$`).
- `\$` — a literal dollar sign.
- `\\` — a **hard line break** (anywhere text renders: cells, row/column labels, headers, group
  labels & notes). It splits the text onto a new line at that exact point, and it works even in a
  one-line (`stub_nowrap` / non-wrapping) cell — a break forces two lines there without turning on
  general wrapping. Recognized only **outside** a math delimiter: `\\(` reads as a break then a
  literal `(`. Leading/trailing/consecutive `\\` produce empty lines.
- Bare `$`, `_`, `^`, `*` are **only** special inside a delimiter, so ordinary text (including
  currency like `$2.50`) needs no escaping and renders unchanged.

> **YAML/CSV escaping for `\\`.** In **CSV** (row/stub labels) there is no escaping, so `\\` is two
> literal characters and works directly. In **double-quoted YAML** `\\` collapses to a single
> backslash — use **single-quoted** YAML (`'Line one \\ line two'`) or write `\\\\`. This mirrors
> the existing inline-math YAML gotcha.

Inside a delimiter, the supported **linear** subset of LaTeX is:

| Feature | Syntax | Example → render |
|---|---|---|
| Greek letters | `\sigma`, `\theta`, `\Sigma`, … | `\(\sigma\)` → σ |
| Subscript | `_{…}` / `_x` | `\(r_{ai}\)` → r with subscript *ai* |
| Superscript | `^{…}` / `^x` | `\(x^2\)` → x² |
| Stacked sub+super | `_{}^{}` on one base | `\(\theta_1^K\)` → θ with K above, 1 below |
| Inline italic | `\textit{…}` / `\mathit{…}` | `\(\textit{abc}\)` → *abc* |
| Operators / relations | `\cdot \times \leq \geq \approx \pm \sum \int …` | `\(\sigma \leq 1\)` → σ ≤ 1 |

Latin letters and lowercase Greek render italic (math variables); digits, uppercase Greek, and symbols upright.

**Not supported:** two-dimensional constructs — `\frac`, `\sqrt`, matrices, `\binom`, over/under
braces. These are **rejected at validation** with a clear message (they are never silently
mis-rendered). For displayed equations needing them, use a real MathJax block on the page.

---

## Colors

Anywhere a color is accepted (`series_colors`, annotation `color`, `barStack.mono.base`, …), the
value is either a **named color** or a raw `"#hex"`:

- **Categorical hues:** `blue`, `amber`, `violet`, `green`, `red`, `rose`, `russet` — and a
  `-light` variant of each (e.g. `blue-light`).
- **Aliases:** `purple`→violet, `pink`→rose, `yellow`→amber, `brown`→russet (each with `-light`).
- **Neutrals:** `black`, `grey` (`gray`), `navy`.

Unrecognized names pass through unchanged, so a raw `"#1A1A2E"` works too. `barStack.mono.base`
accepts only the 7 categorical hues (or an alias) — it pulls that hue's tonal scale.

---

## CSV format

**Charts** use long format. Columns are named freely and mapped via `columns:`; absent that block,
the engine expects `time`, `series`, `value`.

| role | content |
|---|---|
| x (`time`) | x-value. Must parse per `xAxisType`: integer for `numeric`, `YYYY-MM-DD` for `temporal`, `YYYYQ#` for `quarterly`, any string for `categorical`. |
| series | Series identifier; each distinct value is a separate line/segment/band. Omit the column for a single-series chart. |
| value | Numeric y-value. May be empty for missing observations. |

Optional chart columns: confidence-bound columns (if `confidence_bands` references them), the facet
column (if `columns.facet` is set), the shape column (if `columns.shape` is set), and the section
column (if `columns.section` is set).

**Tables** also use tidy/long data: one row per cell, with the `stub`, `header`, and `value`
columns (plus optional `pane`, `emphasis_column`, `footnote_column`). The `value` column may hold
numbers, blanks, or text strings.

Validation parses every row and fails on malformed x-values, missing required columns, or
referenced keys that don't appear in the data.

---

## Minimal examples

**Single-series line:**

```yaml
chartType: line
title: "Median hours worked"
xAxisType: temporal
data: data.csv
# columns omitted → time / value, no series
```

**Stacked area with annotations:**

```yaml
chartType: area
title: "Effective tariff rate by authority"
subtitle: "Percent"
xAxisType: temporal
series_order: [Base Rate, Section 301, Section 232]
annotations:
  xAxis:
    - { x: "2025-04-02", label: "April 2 announcement" }
  bands:
    - { start: "2026-04-01", end: "2026-12-31", label: "Assumes no further changes" }
  points:
    - { x: "2025-04-11", series: Section 232, label: "Peak", connector: true, dx: -16 }
data: data.csv
```

**Table:**

```yaml
title: "Budget score"
data: data.csv
stub: [proposal, { label: method }]   # proposal → row group, method → row label
header: [period]                       # one leaf column per period value
value: value
format:
  default: { type: currency, decimals: 1, prefix: "$" }
sticky: { firstColumn: true }
source: "The Budget Lab"
```
