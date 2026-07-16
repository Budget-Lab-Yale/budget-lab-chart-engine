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
| `chartType` | enum | `line` \| `area` \| `bar` \| `stacked` \| `scatter` \| `dotplot`. |
| `title` | string | Card title above the chart. Rendered verbatim. |
| `xAxisType` | enum | `numeric` \| `temporal` \| `quarterly` \| `categorical`. Determines how the x column is parsed (see [CSV format](#csv-format)). |
| `data` | string \| object | Usually just `data.csv` (see [Data](#data)). |

> There is **no `eyebrow`** field — the figure number is a property of the article a chart is
> embedded in, supplied at embed time (`--eyebrow`), not a spec field.

Axis constraints: `scatter` requires `xAxisType: numeric`; `dotplot` requires
`xAxisType: categorical`.

### Column mapping

`columns:` maps your CSV column names onto the engine's roles. The whole block is optional; absent,
it defaults to `x: time`, `value: value`, `series: series`.

| field | type | notes |
|---|---|---|
| `columns.x` | string | Column holding the x value. Default `"time"`. |
| `columns.value` | string | Column holding the numeric y value. Default `"value"`. |
| `columns.series` | string | Column identifying series. **Omit for a single-series chart.** Default `"series"` if present. |
| `columns.facet` | string | Column whose distinct values split small-multiples panes. |
| `columns.shape` | string | Point charts only: column driving the marker **shape** (a second encoding channel, independent of color). |
| `columns.section` | string | Horizontal bar charts only: column grouping categories into labeled **sections** along the category axis (e.g. Durable goods / Nondurable goods / Services). See [Section axis](#section-axis-horizontal-bars). |

### Text

| field | type | notes |
|---|---|---|
| `subtitle` | string | Below the title (often the units). |
| `source` | string | Source line below the chart. |
| `note` | string | Note line below the chart, above the source. |
| `x_axis_title` | string | Caption below the x-axis. |
| `y_axis_title` | string | Short caption above the y-axis (left-aligned, horizontal). |
| `tooltip_decimals` | integer | Decimal places for values in hover tooltips (independent of axis ticks). Default 2. |

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
| `annotations.bands` | array | **Shaded** vertical x-regions. Each `{start, end, label?, color?}`. |
| `annotations.points` | array | **Callouts** at a data coordinate. Each `{x, label, y?, series?, value_format?, color?, dx?, dy?, connector?}`; `x` + `label` required. Omit `y` and give `series` to snap to that series' value at `x` (the cumulative stack top on area charts). `connector: true` draws a leader arrow from the label to the point. `dx`/`dy` nudge the label — **`+dx` = right, `+dy` = up**. |

Marker/label `color` is a named color or `"#hex"`; the label color matches its line.

**`{value}` token.** Any `xAxis`/`yAxis`/`points` `label` may contain a literal `{value}` token,
substituted with the marker's own numeric value (`x` when it parses as a number, `y`, or the
callout's resolved value). `value_format` controls the substitution: `{decimals?, prefix?, suffix?}`
(decimals default 2). Without `value_format`, the substitution falls back to the chart's
value-axis tick format (`yAxis`/`points`) or the raw `x` string (`xAxis`, or any `x` that doesn't
parse as a number). A `label` without the token is unaffected.

**`facet` (small multiples only).** Scope an `xAxis`/`yAxis` marker to the pane whose facet value
equals `facet`; omit to render in every pane (unchanged default). Ignored on a non-faceted chart.
`bands`/`points` are not facet-scoped.

### Confidence bands

| field | type | notes |
|---|---|---|
| `confidence_bands` | array | Each `{series, lower, upper}`. `series` is the data key the band wraps; `lower`/`upper` are CSV column names. Renders as a tinted area behind the line. |

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
- Bare `$`, `_`, `^`, `*` are **only** special inside a delimiter, so ordinary text (including
  currency like `$2.50`) needs no escaping and renders unchanged.

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
