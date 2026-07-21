# Changelog

All notable changes to the Budget Lab chart engine are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/); this project adheres to
[Semantic Versioning](https://semver.org/).

## [1.6.1] - 2026-07-21

### Fixed — interaction

- **Bar value-pills no longer freeze the tab.** `staggerBarLabels` (the routine that spreads
  overlapping bar value-labels apart) had a `while` loop that could never terminate: because
  `(y + pad) - y` is not exactly `pad` in IEEE-754, the overlap test stayed true and the loop
  spun forever. Any interaction laying out ≥2 colliding pills — hover with a coordinated cursor,
  or legend series-selection with persistent pills — could hang the browser tab. The loop now
  advances only on strict upward progress, guaranteeing termination.

## [1.6.0] - 2026-07-20

### Added — histogram

- **New `chartType: "histogram"`** — continuous-x binned bars. `xAxisType` must be `numeric` or
  `temporal`. Bins are sized by `histogram.binWidth` (x-units, or for temporal x a calendar
  interval name `day`/`week`/`month`/`quarter`/`year` or a day count) > `histogram.bins` (target
  count) > auto (Freedman–Diaconis, falling back to Sturges' rule). `histogram.domain` fixes the
  binning range; `histogram.weight` sums a column per bin instead of counting rows;
  `histogram.normalize` renders `proportion` (each series' bins sum to 1) or `density` (area sums
  to 1) bars instead of raw counts.
- **Pre-binned input.** Mapping `columns.x0` + `columns.x1` supplies each row's bin edges directly
  (uneven widths allowed), with `columns.value` as the bar height and the engine's own binning
  fields rejected by validation.
- **Overlapping multi-series** — each series draws a translucent bar layer over a shared bin set,
  for comparing distributions rather than stacking totals.
- **Faceting** via `columns.facet` + `small_multiples`: `shared` mode (default) bins every pane to
  one common threshold set; `per-pane` bins each pane independently.
- **Per-bin hover tooltip** — hovering a histogram shades the bin under the cursor and shows its
  range plus each series' value. In `shared` faceted mode the cursor is **coordinated across
  panes**: hovering one pane echoes the same bin on the others.
- **Friendly, configurable bin labels** (`histogram.bin_label`) — bin ranges read as `47.9 – 50.7`
  (numeric, with an optional `unit`/`unit_position`) or collapse to a period name for temporal bins
  (`July 2023`, `Q3 2023`, `2023`, or a `July – September 2023` range); `decimals` sets numeric
  rounding.
- Histogram bars render with a partial fill so overlapping series blend and single-series bars
  don't read as heavy solid blocks.

## [1.5.0] - 2026-07-20

### Fixed — tables

- **`stub_wrap` no longer collapses the data columns.** Turning on `stub_wrap` used to leave the
  data `<col>`s width-less, so at narrow viewports the columns shrank below their content and the
  (nowrap) leaf headers overflowed and overlapped. The data columns now keep their computed widths
  and the table scrolls horizontally instead — only the stub wraps. `column_width` is honored again
  even when `stub_wrap` is on.

### Added — tables

- **`\\` hard line break in cell text.** Two backslashes force a line break anywhere text renders
  (cells, row/column labels, headers, group labels & notes), including inside a non-wrapping cell.
  Recognized only outside math delimiters (`\\(` = break + literal `(`). Honored identically in the
  live DOM (`<br>`) and PNG/SVG export.
- **`column_wrap` spec field.** `true` (all data columns) or `{ <leafKey>: true }` wraps a data
  column's **body** cells within their width — the data-column analogue of `stub_wrap`. Pair with
  `column_width` to cap the width.

## [1.4.1] - 2026-07-17

### Fixed — sectioned horizontal bars

- **Section-header vertical spacing.** Non-first section headers had generous space below but
  almost none above, so with many rows they crammed against the bar above. Each non-first section
  now reserves a fixed spacer block and all headers render through one lifted-text mechanism, so
  the whitespace above and below every header is symmetric and no longer scales with row count.
- **Hover highlight no longer spills into section headers.** The band-hover highlight for a bar
  adjacent to a section boundary is now clamped at the spacer instead of stretching across the
  header band.

### Fixed — PNG export height

- **Single-chart horizontal `bar`/`stacked` exports are responsive to row count.** They previously
  crammed every row into the fixed 4:3 frame (labels collided at high row counts); the export now
  grows its height from the same helper the live mount uses.
- **Waterfall small-multiples exports are no longer squashed.** The export pane height for
  waterfall figures matches the live mount (was ~57% of it). Figure pane-height is now a single
  source of truth shared by the live mount and the export.

### Changed — figures

- **Horizontal `bar`/`stacked` small multiples grow with row count, and each facet's pane is sized
  to its own row count** — so bars are the same thickness across facets with different category
  counts (the horizontal analog of `pane_widths: "equal-bar"`). Figures whose facets share the
  same categories are unchanged.

### Fixed — tables

- **Header→body separator is continuous under blank-group columns.** A column whose top header
  tier is blank (a standalone metric rendered as a rowspanning cell) was missing the separator;
  the rule now applies to every header cell whose bottom edge is the header base.

### Removed

- Internal review gallery (`examples/gallery/`) and design spec docs (`docs/specs/`) — development
  artifacts not part of the published engine.

## [1.4.0] - 2026-07-16

### Added — waterfall

- **New `chartType: "waterfall"`** — a vertical, single-series categorical chart whose bars float
  on a running cumulative. `columns.kind` flags each step: `total` (an absolute bar anchored at
  zero — an explicit value rebases the running total, a blank value draws the auto running sum),
  `skip` (no bar; the category slot is kept so faceted panes stay aligned — label the gap with a
  point annotation), else `delta` (a signed step). Colors are semantic by default (increase blue,
  decrease red, total navy), overridable globally via `waterfall.colors` and per bar via
  `category_colors`. Dotted connectors link consecutive bars (`waterfall.connectors`,
  `waterfall.connectorColor`). Always-on running-total labels (`valueLabels.show`) are
  color-matched to the bar; on hover a **signed** delta pill shows centered in the bar
  (delta bars only — totals/skips shade without a pill). The delta and running total share one
  precision (`valueLabels.decimals`, else the minimum the data needs). Single-frame and faceted
  (small-multiples) figures are both supported.

### Added — annotations

- **Point callouts now render on categorical (bar-type) charts.** A point annotation's `x`
  resolves to the category's bar center (previously a silent no-op on a band scale). Point callouts
  also gained `facet` scoping (like axis markers) and a `maxWidth` word-wrap. Available to every
  bar-type chart, not just waterfalls.

### Added — bars

- **Selecting the `Total` legend row pins a net-value pill at each net dot** on a diverging /
  net-dot stack (`barStack.netDisplay: dot`). The pill is black, sits below the dot by default and
  flips above when space is tight (horizontal: just past the dot on its value side), and avoids
  colliding with any segment pill also selected. Composes with per-segment selection pills.

## [1.3.3] - 2026-07-16

### Changed — annotations

- **Horizontal (`yAxis`) reference lines default to the dim annotation neutral**, matching
  vertical (`xAxis`) lines, instead of borrowing the categorical data palette (which made an
  uncolored line render amber). An explicit `color` still overrides. Reference lines now read
  as chrome, not as a data series, and the two axes are consistent.

## [1.3.2] - 2026-07-16

### Added — bars

- **Faceted horizontal stacked bars.** `orientation: horizontal` + `small_multiples` now works for
  `stacked` charts, not just single-series/grouped bars. Panes share the value axis and the left
  category gutter (labels on the leftmost pane); diverging stacks keep the net dot in each pane at a
  reduced radius, with the net text callout and segment labels suppressed. With `columns: 1` each
  facet gets its own row and may carry different categories; the ragged-facet guard (shared category
  axis) now covers stacked and applies only when panes share a row (`columns > 1`).

### Changed — bars

- **Total-dot stacks hover with the band tooltip, not per-segment value pills.** When a stacked
  chart shows the net **dot** (`barStack.netDisplay: dot`, or `auto` with negatives), hovering a
  category now shows the floating tooltip — including the dot-swatch Total row — instead of the
  per-segment pills introduced in 1.3.0. Plain and grouped bars, and cumulative (text-callout)
  stacks, keep the pills. Legend-highlight pills are unaffected in both modes.
- **Net dot: no static value label, smaller marker.** The net dot no longer draws a static signed
  value label (the value now reads from the hover tooltip's Total row), and the dot marker is 20%
  smaller (radius 10→8 standalone, ~7→5.6 in small-multiples panes). `barStack.netLabelColor` is
  accepted for compatibility but no longer has an effect.

## [1.3.1] - 2026-07-09

### Fixed — tables

- **Multi-tier header super-groups stay contiguous under `column_order`.** `column_order` now
  orders the leaf tier **within** each header super-group instead of sorting all leaves globally
  (which interleaved the super-groups into repeated `colspan=1` cells). Super-groups are gathered
  by header path regardless of input row order — the column analogue of the 1.3.0 row grouping.

### Added — tables

- **`column_group_order`** — orders header **super-groups** (the non-last header tiers), the
  column analogue of `group_order` (a flat `string[]` for the first super tier, or a `string[][]`
  for each tier independently). Unlisted values follow first-seen order.
- **`collapsible.control`** — `"stub-header"` (new default) renders the expand/collapse-all
  control in the table's top-left corner cell, above the stub and beside the carets it toggles;
  `"footer"` keeps the pre-1.3.1 placement in the download action row. PNG export omits the
  control either way.

### Fixed — bars

- **Inline-selector color accent now recolors no-series bar charts — standalone and faceted.**
  When a colored `title_selectors` option is active, a bar chart with no `columns.series` (colored
  via `bar_color`/default) now tints its bars to the option's color — matching the tinted selector
  label — the bar analogue of the single-series line recolor. This applies to standalone charts
  and to every pane of a `small_multiples` figure (recoloring live on selection change, and in PNG
  export). The accent wins over `bar_color`; `category_colors` still overrides per-category.
  Multi-series bars are unchanged.
- **Single-facet small multiples use the bar-end pill, not the legacy tooltip.** A
  `small_multiples` bar/stacked chart whose facet resolves to one value now hovers with the shade
  band + bar-end value pill (like a standalone chart) instead of falling back to the floating
  tooltip. Any tooltip swatch still shown (e.g. `coordinated_cursor: false`) now color-matches the
  bar's rendered fill rather than the series' base color.

## [1.3.0] - 2026-07-09

### Added — tables

- **`group_order`** — orders row-group tiers (a flat `string[]` for the first tier, or a
  `string[][]` for each tier independently). `row_order` is now scoped **within** each group
  rather than across all groups. Grouping is order-independent: groups are always gathered by
  stub path, so a scenario-major CSV (rows not already grouped contiguously) regroups correctly.
- **Collapsible row groups** — `collapsible: { default?, expanded?, collapsed? }` adds a caret to
  each group header that toggles its rows (nested groups collapse their whole subtree), plus
  expand/collapse-all controls. Collapse state survives a resize; PNG export renders a static
  snapshot honoring the live collapse state, or the spec's defaults when exported without
  interaction.

### Fixed — tables

- **`emphasis_rows` now styles the whole row**, including the stub (row label) cell, identically
  in HTML and PNG export — previously the stub cell was left unstyled.
- **Multi-tier header leaves are now keyed by their full header path**, not just the last-tier
  value, so a leaf value repeated under different banner groups renders as distinct columns
  instead of one silently swallowing the other. `header_labels`, `column_labels`, `sublabels`,
  `column_order`, and the `column_width` map still resolve against the leaf's raw last-tier value.

### Added — bars

- **`bar_color`** — single-series bar fill resolved through the palette; a first-class
  replacement for the `series_colors: {"": color}` idiom (which still works). Highlight dimming
  still applies on top.
- **`category_colors`** — per-x-category fill override for single-series bars (both
  orientations), e.g. a distinct color for one category while the rest keep the base fill.

### Fixed — bars

- **Sectioned horizontal bars no longer clip the first section header.** The top margin is now
  floored to the header's lift height (+ gap) whenever a top section header is present, so it's
  never clipped under the default (bottom) `x_axis_ticks` — this changes rendered output (top
  margin) for existing sectioned horizontal bar specs; unsectioned and vertical bars are
  unaffected.
- **`x_axis_ticks` now validates orientation.** It only has an effect on horizontal bars/stacked
  charts; setting it on a vertical chart previously silently no-op'ed and now fails validation.

### Changed — bars

- **Standalone bar/stacked hover now matches the faceted "best practice" look.** Hovering a
  standalone (non-small-multiples) bar or stacked chart shades the hovered band at a uniform height
  across section spacers and shows a value pill at the bar's end, replacing the previous floating
  tooltip. Horizontal: the shade extends into the left category-label gutter and the hovered row
  label is bolded (no pill). Vertical: the shade stops at the baseline and the hovered x-axis
  category name is shown on a frosted pill — both matching faceted panes, which are unchanged.
  Standalone horizontal category labels + section headers also now render at the larger faceted
  font size (previously standalone-only-smaller).

### Added — line & area

- **`projected_field`** + **`projected_style`** — flags rows as projected (forecast/estimated).
  Line charts draw the flagged run(s) of a series dashed, connecting continuously to adjacent
  actual points, with support for multiple disjoint projected runs per series. Area charts fade
  the fill over x-ranges where every in-scope series is flagged projected. A whole-series
  `series_styles[..].dashed` override still wins over per-run projected styling.

### Added — annotations

- **`facet` on `xAxis`/`yAxis` markers** — scopes a reference line to one small-multiples pane;
  omitted, it still renders in every pane.
- **`value_format`** + a `{value}` token in `xAxis`/`yAxis`/`points` labels — substitutes the
  marker's own numeric value into the label, formatted with `{decimals, prefix, suffix}` (falling
  back to the chart's value-axis tick format when `value_format` is omitted).
- **Horizontal bars now honor numeric `annotations.xAxis` markers**, rendering them as vertical
  rules on the value axis — previously silently ignored on that orientation.

### Added — chrome

- **`legend: false`** — hides all legend chrome (top/right/figure/PNG export alike) while keeping
  multi-series coloring, tooltips, and the crosshair. Click-to-pin/dim is unavailable since it's
  driven through the legend.
- **`title_selectors`** + a `{token}` in `title` — an inline button+popover dropdown (ported from
  the AI Labor Market Tracker's inline industry picker) embedded in the figure title. Selecting an
  option swaps the title text in place and fires a bubbling `tbl-title-select` CustomEvent;
  `MountOptions.selections`/`onSelect` read and drive the selection programmatically. PNG export
  prints whichever option is active. Options may carry a `color` (or fall back to
  `series_colors[label]`): the active option tints the trigger label, and on a single-series chart
  is also fed back as that line's color (multi-series charts keep their own palette).

### Fixed — small multiples

- **`columns.section` and `columns.facet` now compose** on faceted horizontal bars (shared and
  per-pane modes). A facet missing a category or a whole section (a ragged facet) now fails
  validation with a pointed error instead of silently misaligning rows across panes.

### CLI / gallery

- **`tbl-chart serve` now discovers `table.yaml`** alongside `chart.yaml` under the served
  directory, tagging tables in the index; `npm run gallery` serves `examples/gallery` — 17
  example figures pressure-testing each feature above.

## [1.2.1] — 2026-07-01

### Fixed

- **Faceted horizontal bars no longer force horizontal scrolling at normal widths.** The live
  layer's per-pane minimum for horizontal bar facets was 300px, so a two-pane figure demanded a
  natural width of ~816px (2×300 + gap + gutter reserve) — wider than a typical embedded content
  column, making it scroll sideways even on wide screens. The per-pane minimum is now 240px (the
  same as vertical facets; horizontal panes read fine at that width), lowering the natural width
  to ~700px. Pane layout itself is unchanged — this only relaxes the width below which the grid
  overflows into the horizontal scroll wrapper.

## [1.2.0] — 2026-07-01

Adds faceted horizontal bar charts with sectioned category axes, variable pane widths for
small-multiples, and a reworked annotation-label placement system — plus a few behavior changes
worth reading before upgrading. Existing chart specs render unchanged unless noted under
**Significant changes**.

### New features

- **Faceted horizontal bar charts** — `orientation: horizontal` together with `small_multiples`
  now renders side-by-side panes that share one category gutter (on the leftmost pane) and one
  value axis. Hover is a coordinated crosshair — a continuous highlight row spanning every pane
  and the label gutter — rather than per-pane tooltips. `x_axis_ticks: top | bottom | both`
  controls where the value-tick labels sit. The figure grows in height with the row count and
  long category labels wrap.
- **Sectioned category axis** — `columns.section` groups categories under bold section headers,
  ordered by `section_order` with display overrides via `section_labels`.
- **Variable pane widths** for faceted small-multiples — `small_multiples.pane_widths` accepts
  `"equal"` (default), `"equal-bar"` (columns sized so bars are equal width), or a proportion
  array like `[3, 1]`. Works in both `shared` mode (one common y-domain) and `per-pane` mode
  (each pane keeps its own y-axis and zero point, and its own y-label gutter).
- **Annotation label placement** — x/y reference-line markers now take two orthogonal, name-based
  controls instead of pixel guesswork:
  - `labelSide` — which side of the line the label sits on (x-marks: `left | middle | right`;
    y-marks: `top | middle | bottom`).
  - `labelPosition` — where along the line the label sits (x-marks: `top | middle | bottom`;
    y-marks: `left | middle | right`).

### Significant changes

- **`labelDy` / point-callout `dy` sign flipped** — a **positive** value now nudges the label
  **up** and a negative value **down**, for x-markers, y-markers, and point callouts (previously
  it followed SVG's positive-is-down convention). `labelDx` is unchanged (positive = right). Any
  existing spec that sets `labelDy`/`dy` will now nudge in the opposite vertical direction.
- **`labelAnchor` removed** from x-axis markers — its `start | middle | end` options are folded
  into `labelSide` (`right | middle | left`). Specs using `labelAnchor` must switch to `labelSide`.
- **`anchorAtZero` now defaults to `false`** on numeric x-axes — the axis fits its data range
  unless `xAxisPolicy.anchorAtZero: true`, which is the less-surprising default for a year axis.
- **In-bar value labels removed** — bars no longer print a value label inside or atop each bar
  (the prior style no longer fit the chart look). Values remain available on hover and via the axis.
- **Annotation labels always paint on top** of every reference line, band, and data mark; a later
  line can no longer paint over an earlier label. Near-top y-axis reference labels now also join
  the x-marker collision-avoidance pass, so a label and a right-edge marker no longer overlap.

### Minor tweaks

- Faceted-horizontal layout polish: graceful auto-height, wrapped y-labels, pane titles aligned
  over the data (not the gutter), gridlines extended just above the topmost bar, uniform gaps
  below section headers, and 13px category labels.
- Faceted-horizontal and variable-width figures never reflow onto extra rows — they keep their
  configured columns and scroll horizontally when the viewport is narrow.
- x-axis label rotation and bottom margin are coordinated across panes so baselines line up when
  one pane's labels rotate; rotated (45°) labels also reserve enough room so long labels aren't
  clipped at narrow widths.

## [1.1.1] — 2026-06-29

### Added — inline math in tables

- Table text now supports **inline math / special characters** using the same MathJax
  delimiters as the TBL website: `\( … \)` for inline math (also `\[ … \]` / `$$ … $$`), and
  `\$` for a literal dollar sign. Inside a delimiter, the **linear** LaTeX subset is supported:
  Greek letters (`\sigma`, `\theta`, …), sub/superscripts (`_{}`, `^{}`, including **stacked**
  sub+super like `\theta_1^K`), inline italics (`\textit{}` / `\mathit{}`), and common
  operator/relation symbols (`\cdot`, `\leq`, `\sum`, …).
- Works across every text field — cell values, row/stub labels, column headers, sublabels,
  group labels & notes, the stub-header corner — in both the live HTML and the PNG export, which
  measure and stack identically.
- 2-D constructs (`\frac`, `\sqrt`, …) are **rejected at validation** with a clear message
  rather than silently mis-rendered.
- Because the markers only carry meaning inside their delimiters, text without them passes
  through verbatim — bare `$ _ ^ *` stay literal, and existing tables render unchanged.
- New **`row_labels`** and **`group_labels`** spec maps (mirroring `column_labels` /
  `header_labels`) override a row label or group heading by its raw CSV value — so labels
  (including inline math) can live in the spec while the CSV keeps short plain keys. Ordering,
  emphasis, formats, and notes still key off the raw value.

## [1.1.0] — 2026-06-26

A major feature release: three new chart types (scatter, dot plot, area), a new tables figure
type, a unified annotation system, and richer interactivity. All additions are
backward-compatible — existing chart specs render unchanged.

### Added — chart types

- **Scatter** (`chartType: "scatter"`, numeric x) and **dot plot** (`chartType: "dotplot"`,
  categorical x) point charts. Optional dual **color + shape** encoding (`columns.shape`,
  `shape_order`, `shape_labels`, with separate `color_legend_title` / `shape_legend_title`),
  category dodge, per-point hover tooltips, and a coordinated cursor.
- **Area** (`chartType: "area"`). Stacked areas, with a single series filling to the zero
  baseline. The hover tooltip adds a cumulative **Total** row. **Click-to-restack**: selecting
  series animates them to the bottom of the stack (in click order) so they can be read against
  zero; deselecting restores the default order.

### Added — tables

- A new **`table.yaml`** figure type rendering an interactive HTML table plus a self-contained
  PNG, themed to the Style-Guide.
- Tidy/long data pivoted into data-driven multi-tier column headers (colspan + blank-tier
  rowspan), with per-default / per-column / per-group / per-row number formats and verbatim
  **text-string cells**.
- Footnotes, per-row / per-cell emphasis, sign coloring, and indented sub-rows.
- Interactivity: sortable columns (within row groups), row + column hover, a sticky first column,
  and responsive horizontal scroll.
- Layout controls: `stub_width`, `stub_min_width`, `stub_wrap`, `stub_nowrap`, `stub_header`,
  `column_width`, `header_max_lines`, `spanner_rules`, `header_tier_rules`.
- **Multi-pane tables**: a `pane` column splits one CSV into vertically stacked sub-tables (each
  with its own column headers), with `pane_order` / `pane_titles` and shared stub-width alignment.

### Added — annotations & interactivity

- **Unified `annotations` block.** One place for `xAxis` (vertical reference lines, with labels),
  `yAxis` (horizontal reference lines), `bands` (shaded x-regions), and `points` (callouts).
  Point callouts can snap to a series' value at x (the cumulative stack top for area charts) and
  draw a leader arrow. Labels auto-stagger to avoid collisions and carry a white halo for
  legibility. The legacy `xAxisPolicy` / `yAxisPolicy` marker + band fields are still honored.
- **Legend-highlight value pills** — pinned or hovered series show value pills that match the
  coordinated cursor, in both vertical and horizontal orientations.
- **`x_order`** — fixes the render order of categorical x-axis categories (bar, stacked, dot
  plot). Listed categories come first in the given order; any unlisted categories follow in
  data-encounter order. Order-only — unlike `series_order`, it does not filter. No-op off the
  categorical x-axis. Validation flags any listed category absent from the data.

### Changed

- Vertical reference-line (`xAxis` marker) labels are now rendered (previously only the rule was
  drawn), with `labelAnchor` / `labelDx` / `labelDy` placement controls.
- Annotation reference lines span the full plot width on faceted (small-multiples) bar charts.

## [1.0.4] — 2026-06-24

### Changed
- Standalone chart pages now inline the Figtree font as a base64 `@font-face` instead of loading
  it from Google Fonts. The page renders in the correct font with **zero external requests**, so
  corporate firewalls that block the fonts CDN no longer drop charts to a system-font fallback.
  (The font was already vendored and inlined for PNG export; this reuses it for the live page.)

### Removed
- Dropped the unused `engineVersion` field from `ChartSpec` (schema + types). It was never read
  by the engine; the rendering engine version is fixed by the consumer's dependency pin, not a
  per-chart field. No chart specs set it.

## [1.0.3] — 2026-06-24

### Changed
- Standalone chart page background is now transparent (was opaque white), so a chart embedded in
  an iframe inherits the host page's background — correct for publications with non-white pages.
  Standalone, the browser default (white) shows through, so the gallery view is unchanged.

## [1.0.2] — 2026-06-24

### Changed
- Data (CSV) and Image (PNG) download filenames now use the chart's folder slug (derived from the
  page URL, e.g. `childcare-by-activity.csv`) instead of a slugified title, which was unwieldy.
  Falls back to the title slug when the page isn't served from a chart-folder URL.

## [1.0.1] — 2026-06-24

### Fixed
- `tbl-chart` CLI was a silent no-op (exit 0, no output, no file written) when invoked through
  its `node_modules/.bin` symlink — i.e. under a normal install, including CI. The entry-point
  guard compared `import.meta.url` (the realpath) against `process.argv[1]` (the symlink path);
  these never matched, so `main()` never ran. The guard now resolves `process.argv[1]` through
  `realpathSync` before comparing.

## [1.0.0] — 2026-06-24

Initial public release — the launch baseline for the engine.

### Chart types
- **Line** charts (temporal, numeric, quarterly, and categorical x-axes), optional data-point markers.
- **Grouped bar** charts (vertical and horizontal), with value labels.
- **Stacked bar** charts: cumulative, diverging (net dot + signed labels), 100%/normalized, and
  monochromatic tonal modes.
- **Small multiples** (multi-panel figures) in shared-scale and per-pane modes, with a responsive
  reflowing grid.

### Data
- Configurable column mapping via a `columns:` block (`x` / `value` / `series` / `facet`) — input
  CSVs may use any column names; series is optional (single-series charts).
- Tidy long-format loading from local CSV or remote URL/JSON, normalized to one internal shape.

### Interactivity
- Hover crosshair / category tooltips, legend hover-to-highlight and click-to-pin, click-to-select.
- Coordinated cursor across small-multiples panes.
- Collision-aware value labels and adaptive x-axis labels (wrap → rotate).

### Styling & layout
- Style-Guide palette and typography tokens (generated from the canonical palette).
- Axis titles, value labels, confidence bands; responsive widths down to a mobile floor.

### Embedding & export
- Self-contained interactive HTML, PNG and SVG export.
- Figure-number eyebrow supplied at embed time (not in the spec); suppressible per-embed via
  `?eyebrow=off`.

### Tooling
- `tbl-chart` CLI: `validate`, `render`, `serve`, `snapshot`.
- ajv schema + data cross-reference validation.
- Distributed as a git-tag dependency; the `prepare` script builds `dist/` on install.
