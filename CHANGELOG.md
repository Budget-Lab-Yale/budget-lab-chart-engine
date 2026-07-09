# Changelog

All notable changes to the Budget Lab chart engine are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/); this project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
  standalone (non-small-multiples) bar or stacked chart shades the FULL band — including the
  category-label gutter — at a uniform height across section spacers, bolds the hovered
  category's axis label (with a background chip on horizontal charts), and shows a value pill at
  the bar's end — replacing the previous floating tooltip. Faceted panes are unchanged (they
  already worked this way); standalone horizontal category labels + section headers also now
  render at the larger faceted font size, previously standalone-only-smaller.

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
