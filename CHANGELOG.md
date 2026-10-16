# Changelog

All notable changes to the Budget Lab chart engine are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/); this project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- Large data: a histogram of more than about 125,000 observations, or a numeric- or temporal-x
  chart whose rows (with a line chart's CI bounds) pass about 125,000 values, now renders. It threw
  `RangeError: Maximum call stack size exceeded`. Standalone and small-multiples both.
- Histograms with `bins` or automatic binning on a temporal axis, or on values of about 1e7 and up:
  the chart draws the bin count it computes. Rounding error in the edge loop could add a final
  sliver bin, a few rounding steps wide (under a millisecond on a date axis), that took the
  observations at the maximum, so the last visible bin undercounted, and under
  `normalize: density` that bin's height flattened every other bar. Only such slivers are dropped:
  a genuine short final bin is kept, and every other bin edge is unchanged. No published figure
  moves: the archive's one histogram is numeric with `binWidth: 0.25`.
- Temporal histograms with a calendar `binWidth` (`day`, `week`, `month`, `quarter`, `year`): bin
  edges are now in local time, as the dates are parsed and the axis is ticked, and so are every
  temporal histogram's hover bin labels. Both were in UTC, so a reader east of UTC (Europe, Asia)
  saw an observation on a period's first day counted and labelled in the previous period
  (2020-01-01 in the 2019 bin), live and in the PNG. Day and week edges stay on local midnight
  across a daylight-saving change. Under UTC nothing changes. West of UTC (the US) the counts and
  labels are the same, and the edges shift by the UTC offset onto local midnight, in line with the
  axis ticks.
- Small multiples in `mode: "shared"` with a reversed value axis (`yAxisPolicy.min` > `max`): when
  the panes' own domains differ (one pane's data overflows into `autoWiden`, or a facet-scoped
  marker extends one pane), every pane now shares their union. The figure took their intersection,
  so the wider pane's data or marker ran off the frame. No published figure moves: the archive's
  two reversed charts are single charts.
- Single (non-faceted) temporal and quarterly charts with an x marker, band or point callout past
  the data: overlay `domain: axis` now spans the whole drawn x-axis, as CONFIG-SPEC says, and the
  top-label auto-stagger and point-callout placement measure positions on it. All three used the
  data extent at most widths, so an `axis` overlay stopped short of the frame, overlapping labels
  shared a row, and a callout near the data's end could flip as if at the frame edge; which widths
  were affected depended on the tick count. The drawn range is now computed before rendering, so a
  chart renders once (it rendered twice when its ticks thinned) and a small-multiples pane and a
  single chart measure the same way. A callout connector with `dx` past the data still widens the
  axis to hold its end, now exactly: the label end sits on the frame edge and the connector is
  `dx` px long. Blank values at the x-extent boundary: where a date-axis chart's marks drop
  blank-value rows (a `projected_field` line; scatter and dot plot rendered without validation) and
  its first or last rows are blank, the axis now spans the full data extent, as a plain line or
  area chart's already did. It used to stop at the first and last tick label, which moved with the
  width. No published figure moves: in every archive temporal chart the annotations lie inside the
  data, and none is a point chart, uses `projected_field` or has a blank boundary row.
- Small multiples with a categorical x-axis, line marks and a legend: the hover cursor no longer
  drops out when the pointer is within a few pixels of a line. The invisible click targets that let
  a click on a line pin its series were stacked above the hover area instead of below it.
- Categorical-x line and area hover with multi-word categories whose axis labels wrap onto two
  lines: the card now shows the category and its values (it showed the two lines run together and
  no values), and the coordinated cursor draws on every pane (it drew nothing).
- Live charts: tearing down a mount, or a redraw (resize, title-selector reselect), while the
  pointer rests on the chart no longer leaves its hover card on the page, and `onHover` /
  `tbl-hover` now report `null` when that ends a hover. Tearing down one chart leaves another
  chart's card alone. Treemaps already hid their card.
- Live tables with `sort: true`: sorting a column orders each group by its own rows' values. Where
  a row label repeated across groups (or two labels shared one `row_labels` display), every group
  after the first was sorted on the first group's values.
- Live tables with `sort: true`: the sort no longer resets when the card resizes or a collapsible
  group is collapsed or expanded, and a collapse no longer rebuilds the table (the pressed toggle
  keeps focus). Sortable column headers keep their column-header role so screen readers announce
  `aria-sort`; the header label is now a button, which is what takes keyboard focus.
- Live charts and small multiples: legend pins survive a resize and a title-selector reselect (they
  were silently cleared, and `onLegendSelect` was not told). A redraw whose legend no longer has a
  pinned row drops that pin and fires `onLegendSelect` once; on an area chart it also restores the
  stack order. Pinning an area series from the keyboard keeps focus on its legend button. An area
  pin now fires `onLegendSelect` once; it fired once per pinned series plus once more, the extra
  calls carrying partial sets as the pins were re-applied.
- Live charts, click to pin: a standalone categorical-x line chart now pins a series on a click
  within a few pixels of its line, and shows a pointer cursor, as its small-multiples panes already
  did (a click had to land on the 2px stroke itself). Standalone dumbbells and multi-series
  histograms, which already pinned on click, now show the pointer too.
  Small-multiples histogram and dumbbell panes now pin a series when a bin or dot is clicked, with
  the pointer cursor; they ignored the click. Small-multiples dot plots and scatters no longer mark
  the card selectable, since their panes do not pin on click. Static SVG and PNG output is unchanged.
- `tbl-chart serve`: a malformed percent-escape in a `/chart/` URL (`/chart/%E0%A4%A`) now answers
  400; it crashed the server. `/chart/` serves only `chart.yaml` and `table.yaml`: any other file
  under the root answers 404 instead of being read and YAML-parsed.
- `tbl-chart snapshot --baseline <path>` with no `.png` suffix: a failing compare overwrote the
  baseline with the diff image. The diff now goes to `<path>.diff.png`. When the rendered image's
  size differs from the baseline's, no diff image is written, and the message no longer says one was.
- Live charts and small multiples, teardown from a callback: a host that tears the mount down from
  `onRender` no longer gets a later pane's `onRender`, a dropped-pin `onLegendSelect`, or (on an
  area chart) the restack's `onLegendSelect` and morph. A legend or title selector left on the page
  after teardown fires no `onLegendSelect`, `onSelect` or `tbl-title-select`, and redraws nothing.
  A teardown from inside `onHover`, `onRender`, `onLegendSelect` or `onSelect` also withholds that
  callback's bubbling `tbl-*` event, which was still dispatched; the `onHover(null)` and `tbl-hover`
  the teardown itself sends for a hover it ends are unchanged. A teardown from inside a hook
  (`tickLabel`, `afterRender`, `legendKey`, `tooltip`) or `onHover` now stops the redraw or hover
  where it is; the redraw went on to finish, rebuild the legend and fire `onRender`, and the hover
  showed its card.
- Live charts and small multiples, a failed render: the error message is shown as text (it was
  parsed as HTML), and a non-`Error` throw shows its value rather than `undefined`. The legend, and
  on a standalone chart the y-axis labels, of the last good render are removed. A standalone chart
  retries a resize to the width that failed; it skipped it as unchanged. Both retry a resize back
  to the last width that rendered, which they also skipped as unchanged.
- Live charts and small multiples in a hidden container (width 0, such as a collapsed tab) are no
  longer redrawn at the minimum width, which also moved a right legend to the top, until shown. On
  a page with no layout, pinning an area series beside a right legend no longer narrows the chart.
- Line charts with a single x value: the hover guide is drawn on the point (it was `x1="NaN"`), and
  the small-multiples coordinated cursor's guide on the point rather than at the left edge.
- `overlays[].fun`: a function name inherited from JavaScript objects (`constructor(x)`,
  `toString(x)`) is now a validation error naming the known functions. It passed validation and the
  render threw.
- PNG export with a `legendKey` hook that returns `ctx.rendered` unchanged: the download now matches
  the one without the hook, as documented. The row was drawn unwrapped (a long label ran off the
  frame) and took a single row in a right-hand legend column. Markup a hook changes is still drawn
  as returned, unwrapped.
- PNG export of a single-series chart with a colored title selector: a legend row colored from the
  series (a dashed series' row, for one) now takes the active option's color, which the series is
  drawn in, on a standalone chart (top or right legend) and a small-multiples figure. It kept the
  series' own color, so the swatch did not match the line. The export's legend pass now paints a
  single series in the accent, as its final pass and the live chart do.
- Stacked bars with a hard `yAxisPolicy.min` or `max` that a stack's sum passes: the segments are
  now clipped to the plot frame, as every other chart type's marks already were. They painted past
  the frame, over the title and legend or into the category-label gutter, live and in the PNG. The
  net total and its dot stay unclipped. A stack that fits its domain is unchanged. See
  **Upgrading**.
- Legend hover and pin, the hover card, and `series_patterns` textures now reach the marks they
  name in three cases where the `data-series` / `data-category` tags were attached to the wrong
  elements. Horizontal grouped bars with sections, or with `columns.facet` (drawn as groups), whose
  rows are drawn in a different order from the data (`section_order` differs from it, or sections
  interleave in it) and whose categories do not all hold the same series in the same order: rects
  carried another series' tag, so hover dimmed the wrong bars and a texture was painted on the
  other series' bars, in the PNG too. A sectioned horizontal dumbbell drawn in a different order
  from its data: dots and category labels carried another row's category, so hovering one row
  showed another row's card. A line chart with a series that has no value (in the chart, or in one
  small-multiples pane), unless it is the last of its dashed or solid group: each line after it
  took the tag of the series before it. Charts whose tags were already right are unchanged. See
  **Upgrading**.
- Stacked bars with `barStack.stackOrder` and `valueLabels.show`: each segment label now sits in
  its own segment. The labels walked the stack in `series_order`, so they were placed at the
  midpoints of segments they do not name, live and in the PNG. Stacks without `stackOrder` are
  unchanged. No published figure moves: the archive's two `stackOrder` stacks draw no segment labels.
- Callouts that give `series` and no `y` on a stacked bar or area chart: under
  `barStack.stackOrder`, or after pinning a series on a live area chart (which moves it to the
  bottom of the stack), the callout now follows that order. It ranked series by `series_order`
  whatever the stack order, and added every lower series' value, negatives included, so it named
  one segment and pointed at another. Positive and negative values now sum separately, as the bars
  stack: a negative series' callout points at its outer end below zero. No published figure moves: every
  archive point callout is on a line chart.
- Stacked and waterfall value labels without `valueLabels.decimals`: the precision is now the
  fewest decimals the data needs, as CONFIG-SPEC says. Rounding error in a sum counted as
  precision, so stacked nets of 1.1 + 2.2 and 1.5 + 2.5 printed "3.30" and "4.00", and a waterfall
  of 1.1, 2.2, 0.5 printed "1.10", "3.30", "3.80" in its labels and "+1.10" in its value pill, live
  and in the PNG. They print "3.3", "4.0", "1.1", "3.3", "3.8" and "+1.1". Values are counted to
  12 significant digits of the chart's largest value. No published figure moves: the archive's
  stacks without `decimals` hold integer data, and its waterfall sets `decimals`.
- Value-axis ticks below 1e-6: each tick now prints its value. Every tick printed "0" (or "0.0000")
  because the decimal count read JavaScript's exponent form ("2e-7"). Ticks take the fewest
  decimals that write every tick exactly (counted, as above, to 12 significant digits of the
  largest tick), and never fewer than the tick step has, so every tick prints its own value: a
  domain pinned to [1e12, 1e12 + 1] reads 1000000000000.0, 1000000000000.2, and so on. No
  published figure moves.
- Value labels count decimals to 12 significant digits of the chart's largest value, so where that
  value is 1e10 or more, decimals below its 12th digit are dropped (a label on 12345678901.25 reads
  12345678901.3). No published figure has values that large.
- Tables, a value that rounds to zero at its decimals: it prints without a sign and takes no
  `sign_color`, live and in the PNG. The sign was read before rounding, so -0.04 at one decimal
  printed "-0.0" (in red under `sign_color`) and +0.04 printed "0.0" in green. See **Upgrading**.
- Table PNG export: a footnote marker on a text cell is drawn. Only numeric cells drew theirs. A
  marker after math sits at the usual height beside the whole text; after a trailing superscript it
  rose with the superscript, and after a stacked sub- and superscript it could overlap it.
- Table PNG export with three or more header tiers where a leaf's blank upper tier is absorbed
  from below: each upper-tier header cell now sits over its own columns. It was placed after the
  previous cell drawn in its tier, so it could land over the absorbed leaves' columns, and the
  banner-width fit widened those columns instead.
- Table PNG export, `\\` in a group label, the corner (`stub_header`), a banner or a sublabel: the
  row or header tier is a line taller per break, so every line sits in its own band. The second
  line was drawn into the next row or the tier below with no room reserved. A banner centres its
  lines; the corner grows upward from the leaf-label baseline, as the leaf labels do. Text without
  a `\\` lays out as before. See **Upgrading**.
- Table PNG export, banner flanking rules: a rule never runs backwards or into its label. The rules
  were placed by a 7 px-per-character estimate over the whole label (a `\\` label included), which
  in Figtree overshoots, so where a banner's cell is about as wide as its label the rules were drawn
  backwards (x1 > x2), out past the cell or across the label. Where that estimate leaves no room,
  or falls short of the label, or the label has a `\\`, the rules now flank the label's measured
  width (its widest line), and a banner with no room beside its label has no rules. Every other
  banner keeps exactly the rules it had. See **Upgrading**.
- Tables with both `stub_wrap` and `stub_nowrap`: `stub_nowrap` wins in the layout as it did in the
  live cell, so the stub is sized to its longest label and the PNG keeps each label on one line.
  The layout wrapped the stub, so the PNG wrapped labels the live table kept on one line, overrunning
  a stub column sized for the wrapped text.
- Table PNG export with `header_max_lines`: a leaf header that needs more lines shows its first N,
  the last ending in an ellipsis, as the live clamp does. The last line took all the remaining words
  and ran past its column. A header that fits in N lines is unchanged. A `header_max_lines` below 1
  now means no limit and a fraction is rounded down, live and in the PNG; on screen neither clamped
  (the CSS clamp takes only a whole number), while the export left the header out of the column
  width as if it would wrap.
- Table PNG export, a table narrower than the frame: it is stretched to the frame's content width
  (480 px in the 560 px frame), as the live table fills its card. It was drawn at its natural width,
  flush left, under a title, notes and source that span the frame. As on screen, a single table
  scales its row-label column and every data column, `stub_width` and `column_width` included, by
  one factor. A multi-pane table keeps its shared row-label width and its data columns take the
  rest in proportion to their widths (on screen they take equal shares). Row labels, text cells,
  clamped headers and group notes wrap at the wider widths, and a banner left no room for its
  flanking rules can now have them. A table at or wider than the frame is unchanged. See
  **Upgrading**.
- Table footnote list: math in a footnote renders on screen (it printed its `\( … \)` source while
  the PNG rendered it), and a `\\` starts a new line on screen and in both PNG layouts, with the
  height reserved. A multi-pane table's PNG now wraps a long footnote to the frame (it ran off the
  edge) and renders its math (it printed the source). Footnotes with neither are unchanged.
- Table PNG export, footnote list: each footnote's marker is drawn as a superscript, as on screen,
  in both PNG layouts. It printed inline at the text's size ("a Phased in…"). It is now 11/1.2 px
  and raised 11/3 + 1 px, as Chromium draws the live list's `<sup>`, with the text straight after
  it; a line after a `\\` or a wrap has no marker. The list is drawn at weight 500, as on screen
  (it was 400). A multi-pane table wraps a footnote's first line with the marker at its drawn size
  and weight, and a first word too wide to fit beside the marker starts the next line, leaving the
  marker alone, as on screen (it ran past the frame edge). See **Upgrading**.
- Table PNG export, a body cell's footnote marker: drawn at the live `<sup>` size and height, 9.1
  px and raised 13/3 + 1 px. It was 11 px and rose about 10.5 px, twice the live 5.3 px: Chromium
  applied `baseline-shift: super` on top of the explicit 4 px rise. See **Upgrading**.
- Tooltip swatches and a `legendKey` hook's `ctx.rendered`: a colour containing quotes (such as
  `url("#p")`) no longer breaks the swatch markup.
- `xAxisPolicy.anchorAtZero: true` on a numeric x-axis whose values are all negative: the axis now
  runs to 0, as CONFIG-SPEC says, on a standalone chart and in every small-multiples pane, live and
  in the PNG. Only the minimum was anchored, so the axis stopped at the largest value. An axis that
  spans 0 or lies above it is unchanged. No published figure moves: the archive sets the field only
  to `false`.
- Stacked charts: a negative value in a series that `series_order` leaves out no longer makes the
  chart count as diverging. The chart does not draw it, but the test read every row, so a stack with
  no negative segment on show took a right-hand legend, live and in the PNG. No published figure
  moves: no stacked spec in the archive drops rows by `series_order`.
- PNG export of small multiples: a pane title wider than its column wraps at word boundaries
  within the column, as the live title does, and its grid row's title band grows by a line per
  extra line, so every pane in that row starts below it. The title was drawn on one line and ran
  into the next pane's title. Whether a title fits is measured with Figtree's own advance widths
  (the table timelines use), not the browser's canvas, so the layout is the same wherever the PNG
  is made. A title that fits is drawn exactly as before. Under a frame's `fillPanes`, the panes
  shrink to make room, and every hook still runs once per export pass. No published figure moves:
  the widest archive pane title (scf `home-sale-exclusion`) fits its 270 px column in the slides'
  half frame.
- Annotation legend chips for bands and `shading` fills colored with 3-, 4- or 8-digit hex, a CSS
  color name, `transparent`, or `rgb()`/`rgba()`/`hsl()`/`hsla()` (whole-number or percentage
  `rgb` channels, a unitless hue, a number alpha or a `/` percentage, comma- or space-separated):
  the chip shows the tint the fill paints, flattened over white at its opacity, with the color's own
  alpha applied too. It showed the color at full strength, about ten times darker than a
  10 %-opaque band. Every other color (`var()`, `lab()`, `lch()`, `oklab()`, `oklch()`, `hwb()`,
  `color()`, `color-mix()`, `currentColor`, a hue with a unit, a fractional `rgb` channel, a
  `none` channel) still keys at full strength, now documented in CONFIG-SPEC.
  No published figure moves: every archive band and fill color is a palette token or 6-digit hex.
- CSV data: a byte-order mark before a quoted first header no longer leaves the header's quotes in
  its name (`"time"` did not match `time`). The data download (charts and tables) and
  `freezeRemote` quote a field holding a bare carriage return, which read back as two rows.
- CONFIG-SPEC corrections, where the code was right and the page wrong (no output changes):
  - Colors: lists the forms validation accepts (hex, the named CSS functions, Plot's CSS keywords) in
    place of "any CSS color passes through". `yellowgreen` is rejected; `"Blue"` is the CSS keyword,
    not the palette's blue. Color fields elsewhere now point to that section rather than saying
    "named color or `#hex`".
  - Table inline math: `\$` is a dollar sign only in text parsed for math. In the PNG export,
    multi-line text can be parsed line by line, so `\$` can keep its backslash on a line without
    math; the table's `notes` line is never parsed.
  - Hooks: what a throwing `legendKey` (out of `mountChart` on the first draw, no teardown, no
    resize redraw, and on a standalone chart no title-selector redraw) and `tooltip` (on hover only;
    a card from an earlier move stays with its old content) actually do. The old account said both
    were retried on the next resize.
  - Hooks: `legendKey` receives `__annotation:<label>` as `ctx.series` on annotation rows, and markup
    a hook changes is exported unwrapped on every chart type, not only timelines.
  - `barStack.netLabelColor` and `valueLabels.signed` are documented as accepted with no effect.
  - Point callouts: the frame clamp has a second exception. In the fallback sweep (more than nine
    auto-placed callouts, or no arrangement meeting every constraint), clearing other callouts'
    markers can push a label outside the frame even where the column of labels would fit in it.
  - Shading: `side` is measured against `baseline`, not zero.
  - Rug: tracks group by label within bands and within shading (explicit tracks never), painted in
    the first entry's color, while the legend chip keys every entry's color; the full-cover
    validation error only catches a track inside one later interval.
  - Keying annotations: which same-label rows merge (fills always; lines only with the same dash, in
    the first line's color), the row order includes `overlays` (before `xAxis`), and a no-`series`
    shading chip shows every series' tint, painted or not.
  - `columns.category` works on every chart type but `timeline` and `treemap`, not only dumbbells.
  - `MountOptions.height`: honoured by a standalone chart; ignored by timelines, treemaps,
    small-multiples figures and the PNG download.
  - `series_order` on a stacked bar sets which series draw, the legend order and the colours, not
    the stack: each category stacks in the order its rows appear in the data, and
    `barStack.stackOrder` sets the stack. Without `stackOrder`, a category whose rows arrive out of
    `series_order` can draw a segment label inside a segment it does not name (unchanged).
  - Now documented: the `waterfall` block (`colors.increase`/`decrease`/`total`, `connectors`,
    `connectorColor`), `category_order`, table `collapsible.control`, `category_colors` on
    waterfalls, the dumbbell gap label's default of 1 decimal place, and `legend` in the
    `annotations.xAxis` / `annotations.yAxis` entry shapes.
  - Tables: `stub_width` and `column_width` are no longer called fixed. A table narrower than the
    card stretches on screen, and these columns widen with it; a multi-pane table's data columns
    split the width beside the row labels equally whatever their `column_width`. The PNG export
    now stretches too (see the narrow-table entry above).

### Changed
- Validation is stricter, and looser where it rejected figures that render correctly. See
  **Upgrading**.
- `validateSpec` (and `tbl-chart validate`) reports every cross-field rule a spec breaks, not only
  the first rule's errors, in a fixed rule order. Two cases still end the report early: a schema
  error reports only the schema errors, and a field a timeline or treemap does not support reports
  only those errors. Where a rule added in this release fires before an older one, the first error
  is the new rule's: a temporal histogram with `binWidth: "fortnight"` and an `overlays[].fun`
  reports the `binWidth` error first, where 1.18.0 reported the `fun` error.
- CSV data that cannot be read unambiguously is an error naming its line (and, from `loadData`, the
  file or URL): a quoted field with no closing quote, which took the rest of the file as one cell;
  text after a closing quote (`"x"y`), which shifted the row's later cells; two header columns
  sharing a non-blank name, of which the last silently won (blank names may repeat); and a
  non-empty cell past the header's last column, which was dropped. A short row is still padded with
  empty cells. See **Upgrading**.
- Requires Node 24: `engines.node` is now `>=24` (it was `>=20`), and CI runs on Node 24. See
  **Upgrading**.
- `tbl-chart serve` listens on `127.0.0.1` by default. It listened on every interface while
  printing a `localhost` URL, so another machine on the same network could open every spec under
  the root, data included. `--host <addr>` opts in to another address, and the printed URL is the
  address actually bound.

### Removed
- From the package entry: the `FacetInfo` type and `renderPane`'s fifth (`facetInfo`) parameter,
  the dormant shared-mode Plot-faceting path they drove; `render()`, a dispatcher nothing in the
  engine called (use `renderChart`, or `renderFigure` for a `small_multiples` spec); and
  `FigureRenderResult.combinedSvg`, which was always `undefined`.

### Upgrading
- **Archive scan** (`budget-lab-charts` at main 8ef220b): every `chart.yaml` and `table.yaml`, 88
  in all (77 figures under `charts/` and 11 slide-pipeline fixtures), validates exactly as it did
  on 1.18.0, except two `ecec-macro` figures that set `columns.facet` on a horizontal stack and need
  a rename first (see **Horizontal facets**, below). The one other failure, the slide pipeline's
  deliberate bad-input fixture `scripts/slides/fixtures/unknown-field/chart.yaml`, already failed.
  `budget-lab-interactives` has no specs this engine validates.
- **Newly rejected** by `tbl-chart validate` (and `validateChart`). Except for table `decimals`
  from 11 to 100, `highlightSeries` off a bar or histogram, and `columns.facet` on a horizontal
  chart (below), each of these rendered wrongly, blank, or not at all, so a spec that now fails
  needs fixing, not waiving. The validation changes below alter no rendered output; a horizontal
  chart's `columns.facet` also stops rendering (see its entry).
  - A spec key that names a value in the data and is not in the data, on every chart type,
    histograms included, wherever the chart reads the field: the `series_*` maps,
    `highlightSeries` (bar, histogram), `series_marker` and `gap_annotation.series_a`/`series_b`
    (dumbbell), `barStack.stackOrder` (stacked), `x_labels` (where a hover card or a callout's `{x}`
    is sure to read it), `section_order`, `section_labels`,
    `small_multiples.pane_order`/`pane_titles`/`pane_widths`, `overlays[].facet`,
    `annotations.points[].series`, and `facet` on reference markers and x-anchored callouts. On a
    histogram none of these was checked; elsewhere a typo in the newly checked ones dimmed every
    series, drew a scoped marker nowhere, or silently did nothing the chart showed. CONFIG-SPEC's
    CSV format section lists the fields checked only on some charts.
  - `columns.section`, and on a waterfall `columns.kind`, naming a column the data lacks. A
    misspelled `kind` column drew every waterfall step as a delta.
  - `histogram.bins` that is not a positive integer: 0 or less fell back to automatic binning, and
    a fraction such as 2.5 drew about that many bins, the last one short.
  - `histogram.binWidth` of 0 or less, which fell back to automatic binning. A string is accepted
    only on a temporal axis, as `day`, `week`, `month`, `quarter`, `year` or a positive day count
    such as `"7"`; any other string fell back to automatic binning.
  - `histogram.domain` that is not ascending. A reversed one drew a single bin.
  - A cell holding only whitespace in a numeric column (the value, a confidence bound, a `column`
    overlay's column, `histogram.weight`): leave the cell empty for a missing observation. A
    whitespace-only value cell drew as 0.
  - A hex color without 3, 4, 6 or 8 digits, and `rgb()`, `rgba()`, `hsl()` or `hsla()` whose
    contents are not three channels and an optional alpha, comma- or space-separated (`rgb(foo)`).
    A 5- or 7-digit hex or `rgb(foo)` reached the SVG as written and the browser dropped it: a
    filled mark took the chart's text color and a line was not drawn.
  - Under a `series_patterns` texture, a color the engine cannot read (`oklch()`, `currentColor`, a
    space-separated `rgb()`, an `rgb()` with fractional channels, …) where it is the color actually
    painted under the texture, when the chart is validated with its data: `bar_color` on a chart
    whose one series is named, or beside a `series_colors[""]`; `category_colors`;
    `waterfall.colors`; a title-selector option's color. These threw at render.
  - Tables: a `format` `decimals` that is not an integer from 0 to 10, in any scope (a negative or
    over-100 value threw at render, and a fraction was truncated; 11 to 100 rendered correctly and is
    rejected for consistency with the chart `decimals` bound of 10); and an `emphasis_column` or
    `footnote_column` naming a column the data lacks (a typo dropped every emphasis or footnote).
  - An `overlays[].fun` function name inherited from JavaScript objects (`constructor(x)`); see
    **Fixed**.
  - `highlightSeries` on a line, area, stacked, scatter, dot plot, waterfall or dumbbell chart
    (timelines and treemaps already rejected it). Only `bar` and `histogram` read it: CONFIG-SPEC
    listed it under the bar and stacked-bar options, but a stacked chart, like the others, drew
    exactly as it would without the field. Stacked charts do not support it. No published figure
    sets the field.
  - `columns.facet` on a horizontal `bar`, `stacked` or `dumbbell` chart (a dumbbell with
    `orientation` omitted included), with or without `small_multiples`. Since 1.16.0 the engine drew
    it as `columns.section` (Ruling 80; see 1.16.0 **Changed**, "Horizontal charts draw
    `columns.facet` as groups"). It is now one error that names the section spelling, and it
    replaces the errors 1.16.0 added beside it for `columns.section`, `small_multiples.columns`,
    `mode`, `pane_widths`, `coordinated_cursor`, `section_order` and `section_labels`. A `facet` on
    an annotation, `yAxisPolicy.markers` or `overlays` entry is still reported, since the rename
    does not cover it. `tooltip_section` on such a chart now also reports that it needs
    `columns.section`. `renderChart`, `renderFigure`, `mountChart` and the PNG export throw the
    same message instead of drawing the chart, so `budget-lab-interactives`, which renders without
    validating, fails too. Published specs use it: see **Horizontal facets**, below.
- **Horizontal facets** (see **Newly rejected**): these specs set `columns.facet` on a horizontal
  chart and must be migrated before a repin, or they fail validation and do not render. Rename
  `columns.facet` to `columns.section`, `small_multiples.pane_order` to `section_order` and
  `small_multiples.pane_titles` to `section_labels`, and delete `small_multiples`. 1.16.0 drew the
  facet spelling by making exactly that rewrite on the spec (Ruling 80), so after the rename the
  output is identical: the engine's two goldens recorded from the facet spelling
  (`figure7-tariff-grouped`, `hstacked-grouped`) match byte for byte from the section spelling.
  - `budget-lab-charts`: `charts/articles/2026/10/ecec-macro/full-workforce-gdp-by-estimate/chart.yaml`
    (stacked, `facet: estimate`) and
    `charts/articles/2026/10/ecec-macro/parental-contributions-by-policy/chart.yaml` (stacked,
    `facet: year`).
  - `budget-lab-interactives`, State of Tariffs: `tools/state-of-tariffs/data/manifest.json` (the
    consumer-prices bar figure, `facet: substitution`, in every tab and vintage) and 43 specs in 31 files under
    `tools/state-of-tariffs/data/previous-vintages/*/vintage.json`. Either edit those files, or add
    the rename as a shim in `tools/state-of-tariffs/render.js`, which already rewrites
    `spec.columns.facet`; the shim is the cheaper route.
- **No longer rejected**, because they render correctly:
  - `small_multiples.pane_widths` sized to the panes the grid draws, when a facet cell is blank. A
    blank cell is not a pane, but it was counted as one.
  - Under a texture, a color that is never painted under it. The check follows fill precedence: a
    `series_colors` entry that `bar_color` overrides, and `bar_color` on a stacked, area or
    waterfall chart, now pass; a later title selector's color is not checked when an earlier
    selector colors every option. `validateSpec` without the data no longer makes this check.
  - Under a texture, a single series' `series_colors` entry, and on a bar chart its `bar_color`,
    when some title selector colors every option: an accent is then painted over it under every
    selection. The PNG export painted it in its legend pass and threw (see **Fixed**). A
    histogram's `bar_color` still wins over the accent, so it is still checked.
- **Node 24** (see **Changed**): `budget-lab-charts` installs the engine from its git tag and builds
  it (`prepare`) under its CI runner's default Node, and its CI and `package.json` assume `>=20`.
  Its CI must run Node 24 or later before it repins. Under an older Node, npm warns `EBADENGINE`
  (an error under `engine-strict`).
- **Stricter CSV parsing** (see **Changed**): every CSV in `budget-lab-charts` (165 files) and in
  `budget-lab-interactives` (473, of which 431 are State of Tariffs data) parses, row for row, to
  the same rows as on 1.18.0. A data file that now fails was being read wrongly; fix the file.
- **PNG export legend accent** (see **Fixed**): no published figure moves. No `budget-lab-charts`
  figure has `title_selectors`; the only specs there that do are two slide fixtures, single-series
  lines with no legend rows. In State of Tariffs, `default-scenario/gdp-by-category` (and the same
  figure in 38 earlier vintages) has option colors but no legend rows under either selection, so
  there is no swatch to recolor.
- **Stacked bars clipped** (see **Fixed**): three published figures move, all in
  `articles/2026/10/ecec-macro`: `full-workforce-gdp-by-estimate`, `parental-contributions-by-policy`
  and `parents-and-children-contributions`. Each is a horizontal stack with `yAxisPolicy.min: 0`
  whose Child allowance rows are small negatives (down to -0.0014). Those segments painted up to
  about 5 px left of the zero line, into the category-label gutter (about 7 px in the PNG). They are
  now clipped away, so the slivers no longer show, and the stack mark gains a `clip-path` group.
  The notes on two of these figures say the child allowance's contributions are small and negative;
  to show them, drop `min: 0` from the three specs in `budget-lab-charts` (to be done there
  separately). No other published stacked figure has a hard bound its data passes.
- **Hover and legend tags** (see **Fixed**): no `budget-lab-charts` figure moves. Its one dumbbell
  has its sections in data order, its grouped horizontal bars are unsectioned, and no line has a
  blank series. Two `budget-lab-interactives` tools change once they re-vendor the engine, live
  only (no texture is involved, so neither PNG changes): State of Tariffs
  `default-scenario/consumer-prices` (and the same figure in 38 earlier vintages), a horizontal bar
  with `columns.series` and `columns.facet` on one column, where 20 of 42 bars carry the other
  series' tag, so legend hover and pin dim the wrong bars; and the BLSMM `plot_10yr_yield` and
  `plot_federal_funds` charts, where a scenario that leaves the first variable unchanged blanks its
  Scenario series and the second variable's Scenario line takes the first's tag.
- **Table export, line breaks and signed zero** (see **Fixed**). In `budget-lab-charts` only PNG
  downloads change; no archive table uses what the live-table fixes touch. Five published figures
  move:
  - `articles/2026/10/revenue-potential-top-taxes/income-above-top-thresholds`: its banners
    "Income above \\ threshold" and "After-tax income \\ above threshold" have a line break. The
    banner row is 15 px taller, so the figure is 15 px taller and both banner lines sit above the
    "$ billions" / "% of GDP" row (the second line was drawn 13 px above it, inside that row).
    Their rules ran backwards across the first line: "Income above threshold" now has short rules
    beside its wider line, and "After-tax income above threshold", whose cell is exactly as wide
    as its label, has none.
  - `articles/2026/07/ai-fiscal/key-parameters` and `key-parameters-symbols`: the banner "AI
    Adoption Scenarios via Karger et al. (2026)" fills its cell, and its rules were drawn backwards,
    sticking out past the cell into the stub column and the right margin. It has no rules now.
  - `articles/2026/07/tariff-model-update-july2026/headline-results` and `update-decomposition`:
    the "10-year revenue ($B)" banner's rules were drawn backwards (about 9 px); they are now about
    3 px long, beside the label. Their other banners are unchanged.
  No other `budget-lab-charts` table changes: none has `footnote_column` or `footnotes`, a
  `stub_wrap`/`stub_nowrap` pair, a header longer than its `header_max_lines`, a value that rounds
  to zero under `sign_color`, a `\\` outside its banners, or an upper header tier that the fix
  moves. In State of Tariffs, on re-vendor: the `alternative-scenarios/summary-statistics` cells
  that print "-0.0%" or "-0.00 pp" and the two in `alternative-scenarios/etr-by-country` (and
  earlier vintages) lose the minus, on screen and in the PNG; the 2026-02-21 and 2026-03-09
  `summary-statistics` banners with a `\\` (such as "Policy Before\\SCOTUS Ruling") get a
  taller banner row and measured rules. Its banners without a break were not rendered for this
  check; any whose rules are drawn backwards today change as above.
- **Narrow tables in the PNG** (see **Fixed**): no `budget-lab-charts` figure moves. All 13 of its
  tables are wider than the 480 px content width (the narrowest,
  `articles/2026/07/ai-fiscal/key-parameters`, is 512 px), so their PNGs are unchanged, the five
  figures named under **Table export, line breaks and signed zero** included. Live tables are
  unchanged. State of Tariffs tables were not checked. The five table export goldens, all narrow
  synthetic tables, were re-recorded for this change under an owner waiver.
- **Footnote markers and the footnote list in the PNG** (see **Fixed**): no `budget-lab-charts`
  figure moves. None of its 13 tables sets `footnotes` (the only source of the list) or
  `footnote_column` (the only source of cell markers). Live tables are unchanged. Of the table
  export goldens, only `table-footnotes` moves (its two cell markers and its footnote list); it is
  re-recorded for this change under an owner waiver.

## [1.18.0] - 2026-10-14

### Added
- `x_ticks` on a `temporal`, `quarterly` or `numeric` x-axis: `data` puts the ticks on the data's own
  x values (on a figure, every pane's), a list puts them on the values given in the axis' grammar.
  Values outside the drawn range are dropped, and crowded labels thin to every k-th value from the
  first. A validation error on a categorical axis, a histogram and a timeline.

### Fixed
- Small multiples on a `temporal`, `quarterly` or `numeric` x-axis: the panes now share one x range,
  in both `shared` and `per-pane` mode. Each pane used to fit its own rows, so a pane whose data
  started later drew a different axis from its neighbours. The shared range is the union of every
  pane's own; on a date axis that includes markers, bands and callouts past the data. Categorical
  panes keep their own categories; histograms keep their binning rules.
- Temporal and quarterly tick labels no longer overprint in a narrow plot. The cadence still comes
  from the span of the data, and now steps up (quarterly, half-yearly, then 1, 2, 5, 10, 20, 50, 100
  years and so on, down to a single tick) while adjacent labels would overlap at the drawn width,
  measured on the drawn scale (which a marker or band past the data widens). In small multiples on a
  date axis, histograms included, every pane fits its ticks to the narrowest pane, so unequal
  `pane_widths` still give every pane the same ticks and bottom margin. This mostly reaches
  small-multiples panes and phone-width cards.
- Line and area hover (the crosshair and the coordinated cursor) mapped the pointer across the
  pane's own data extent rather than the x range Plot drew, so wherever the two differed — a marker
  or band past the data on a single chart, and now every pane drawn over a shared range — the guide
  and dots landed off the points and the pointer resolved to the wrong observation. Both read the
  drawn range now.
- The coordinated cursor no longer borrows a neighbouring point in a pane that has no data at the
  hovered x: hovering 2001 on one pane used to show another pane's 2004 values. Outside a pane's own
  data its guide marks the hovered x and no value is drawn.

### Removed
- The `densityMultiplier` parameter of `temporalXTicks` / `tblTemporalXAxis` (every caller passed 1).
  Both now take the plot's data width in that position.

### Upgrading
- **Archive scan** (budget-lab-charts at origin/main 1afaaa5, plus the open SCF figures and the untracked
  `charts/trackers/`): every chart rendered live with 1.17.0 and 1.18.0 and the SVG markup compared.
  At 760 px all 64 are byte-identical: no faceted figure there has panes with different x ranges, and
  no desktop-width temporal axis crowds. At 390 px six standalone temporal charts thin their ticks:
  `recession-indicators/yield-curve` (5 -> 10 years) and five `emp-dispersion-graphs` figures
  (`lfp-by-education`, `lfp-quintiles-rf`, `lfp-quintiles-rf-contemporaneous`,
  `unemployment-quintiles-rf`, `unemployment-quintiles-rf-contemporaneous`; 1 -> 2 years). No golden
  moved.
- `budget-lab-interactives` vendors its own engine (1.13.0, 1.15.0); its small-multiples figures
  are categorical bars, which this release does not touch.

## [1.17.0] - 2026-10-13

### Added
- Export frame: `buildExportSvg(spec, rows, { frame })` takes `frame: { width, height, logoTop?,
  fillPanes?, fitRows? }` (CSS px) in place of the default 1000x750 frame. `logoTop` is the padding above the
  title row and defaults to the 40 px margin; a negative or non-finite `logoTop` throws. The
  smallest frame is 320x240; a smaller one throws. `fillPanes` and `fitRows` take `true`, `false`
  or nothing; any other value throws.
  With no `frame`, the output is unchanged. `height` is a target: a chart that sizes to its content
  (a figure without `fillPanes`, a row-sized bar chart that fits, a treemap, a timeline) can come out
  shorter, and content that needs more room can come out taller, including under `fillPanes` and
  `fitRows` when their floors bind. A timeline keeps its own width and height.
  A framed export also changes how some chart parts lay out:
  - `fillPanes: true` sizes every pane row of a small-multiples figure so the grid fills the frame
    exactly, growing or shrinking the panes, but not below 160 px (the least height a framed single
    chart gets). If the frame leaves less room than that, the panes stay at 160 px and the output
    comes out taller than the frame.
  - `fitRows: true` fits a row-sized chart (horizontal bar or stack, horizontal dumbbell) that is
    taller than the frame by compressing its row pitch, so it fills the frame exactly. Margins and
    section gaps keep their size, and a chart that already fits is not stretched. The pitch stops at
    16 px per category-label line, 15 px per bar in the row (12 px value-label height over the
    band's 0.8 bar share; a grouped row of three bars needs 45 px), and the height of the row's own
    marks plus 3 px clear: a horizontal dumbbell's dots (`dot_radius` and outline), connector and
    `gap_annotation` label, and a diverging stack's net dot (21 px). The largest of these wins. Past
    that floor the output comes out taller than the frame. The on-screen chart is unchanged.
  - A treemap's height is capped by the room the frame leaves it, not by the fixed 460 px.
  - A long x-axis title wraps to the width it is centred in.
  - A legend label wider than a whole legend row wraps (colour and shape legends).
  - When a title word cannot fit in the column beside the logo (in a 320 px frame that column is
    66 px), the logo takes a row of its own above the title. The 640 and 1280 px slide frames keep
    the side-by-side layout for any ordinary title.
  - A right-hand legend moves above the chart when the frame's inner width is under 566 px, as the
    live card does.
- `buildExportSvg` is on the `BudgetLabChart` browser-bundle global.
- Waterfall: `columns.kind` accepts `branch`. A branch draws a bar from the running total by its
  value, like a delta, but does not move the running total, and an unfilled box from zero to its
  level is drawn over its slot. The `columns.kind` row is now in CONFIG-SPEC.md.

### Fixed
- PNG export of `small_multiples.pane_widths` figures: each pane is placed at the width it was
  rendered at (see Upgrading).
- `small_multiples.pane_widths: "equal-bar"` now gives equal bars. It weighted each column by its
  bar count, but a band of n categories spans n + 0.2 steps (outer padding 0.2 at each end, inner 0.2),
  so the busier pane's bars came out wider: 63 vs 62 px at the default export width, 86 vs 82 px
  in a 1280 px frame. Columns are now weighted by that span, on screen and in the export.

### Upgrading
- **PNG export of `small_multiples.pane_widths` figures.** The download now places each pane at the
  width it was rendered at. Before, panes were rendered at their `pane_widths` widths and then
  rescaled into equal-width cells, so with `pane_widths: "equal-bar"` the bars came out a different
  width in each pane (and per-pane mode squeezed the whole split into one cell's width). Archive
  scan: no figure in `budget-lab-charts` uses `pane_widths` (origin/main 82d6974, plus the
  untracked `charts/trackers/`), so a repin moves no published chart. The only user is
  `budget-lab-interactives`' State of Tariffs `gdp-by-category` figure (shared mode,
  `pane_widths: "equal-bar"`, 2 columns, in every scenario and vintage). Its PNG download changes
  to equal-width bars when that tool next re-vendors the engine, and its on-screen chart changes
  slightly too: the "equal-bar" weighting fix narrows the pane with more bars a little and widens
  the other, so the two panes' bars match. Figures without `pane_widths` render and export exactly
  as before.
- The `frame` option (with `fillPanes` and `fitRows`) and the waterfall `branch` kind are opt-in, as are the legend-label wrap and
  the logo row, which apply only under a `frame`. No published spec uses `branch` (the validator
  rejected it before 1.17.0), and no golden moved.

## [1.16.3] - 2026-10-09

### Fixed
- Small multiples: on a temporal line or area figure whose x is a bare year (`2026`), the
  coordinated cursor's x echo printed the raw timestamp (`2398395600000`) instead of the year. The
  echo chose its form by sniffing the raw cell for `YYYY-MM-DD` and missed the other valid temporal
  spelling; it now goes by `xAxisType`. An annual series now echoes the bare year on one line, as
  its axis and hover card print it, where a `YYYY-01-01` series drew `Jan` over the year.

### Upgrading
- Hover only; no golden or export output changes. No published figure moves: the archive's only
  faceted temporal line/area figure (ui-recipiency Figure 2) is monthly, so its echo is unchanged.
  ecec-macro Appendix Figure 1 (bare years) worked around this with `tooltip_x_format: "%Y"`,
  which it may keep or drop; the echo reads the same either way.

## [1.16.2] - 2026-10-08

### Changed
- Tables render on a transparent background, like charts: header and body cells no longer paint
  white, so an embedded table takes the host page's colour. Emphasis rows and row/column hover keep
  their tint. With `sticky.firstColumn`, the pinned column stays opaque while the table overflows
  its frame, so cells scrolled under it stay hidden, and is transparent when the table fits. The PNG
  export is unchanged: it keeps the white ground the chart export uses.

### Upgrading
- On a white host page nothing visible moves. On a non-white host, a published table's cells show
  the host colour, and a `sticky.firstColumn` table that overflows its frame shows a white pinned
  column. No golden or export output changes.

## [1.16.1] - 2026-10-08

### Added
- Tables: `column_align` sets a data column's horizontal alignment (`left` / `center` / `right`),
  body cells and column header alike, whatever the cell type: one value for every data column or a
  `{ <leafKey>: … }` map. Omitted, nothing changes. On screen and in the PNG export.
- Tables: `\\` in `notes` is a hard line break, on screen and in the PNG export. A note without it
  renders as before. Chart `note` is unchanged and keeps `\\` literal.

### Fixed
- Tables: a `column_width` cap narrower than a wrapping cell's widest word split the word mid-way
  on screen ("Underreportin / g") and ran it into the next column in the PNG export. The column now
  floors at its widest word plus padding. Such tables also lay out again once the webfont has
  loaded, because the first draw measured words in the fallback font; other tables still draw once.
- Tables: a triangle marker (`▲ ▼`, U+25B2 to U+25C5) no longer wraps onto a line of its own, apart
  from the word after it, and a lone trailing `°` / `†` / `‡` no longer wraps away from the word
  before it (the space beside them becomes a no-break space, in text cells only).
- Tables, PNG export: a wrapped cell whose inline math contained spaces (a `\(\textit{…}\)` phrase)
  drew delimiter fragments (`responds}\)`), dropped the italic after the first line and clipped the
  first line's last letter. Each line is now drawn in the run's style.

### Upgrading
- One published table moves, found by rendering every `table.yaml` in budget-lab-charts with 1.16.0
  and with this release and comparing the live card (760 and 1100px) and the PNG export:
  `articles/2026/10/revenue-potential-top-taxes/appendix-tax-base-interactions`, through the three
  fixes above (its columns widen to their widest words, the ▲/▼ and ° markers stay attached, its
  italic cells wrap correctly in the PNG). The other eight tables are byte-identical. No golden
  moved.

## [1.16.0] - 2026-10-07

### Added
- `chartType: treemap` — a part-to-whole composition as nested tiles, one CSV row per tile
  (`columns.x` name, `columns.value` size, optional `columns.series` group). Deterministic; tile
  area is proportional to value at one scale across the chart, less the gutters; tiles shaded by
  size rank within a band around their colour (each group's, or blue with no groups): the four tonal
  tiers nearest it plus the CIELAB midpoint of each adjacent pair, seven shades in all (blue: 500,
  450, … 200); a one-tile group is drawn in its colour as resolved, the legend chip's. The midpoints
  are computed, not palette tokens, and have no name a figure could set (a raw hex equal to one is
  accepted, and fills its group flat). Labels top-left at one size per chart (14px, 12px below 600px
  wide), placed largest first within each group and stopping at the first that does not fit, so a
  group never labels a tile while leaving a larger one bare. The tiles of flat data are drawn
  squarified (aiming at aspect ratio 1, d3's default or 2, whichever labels the most), or as rows,
  columns or a balanced split only when that labels at least 2 more tiles; grouped data's blocks are
  squarified at 600px and wider and compete the same way below; below 400px wide 11px text competes
  too. A group whose largest tile cannot hold its label is re-laid out inside its own block (rows,
  columns or a balanced split) where that lets it fit. Groups are named by the standard legend (top,
  or `legendPosition: right`, which reserves no column when there are no legend rows; `legend` and
  `series_legend` work as on other charts), whose rows highlight their group's tiles. A tile left
  unlabelled is named by its hover card and screen-reader label. New `treemap:` block
  (`label_value`, `shading`, `share_decimals`, `tooltip_values`, `share_label`, `value_label`,
  `tooltip_group`, `tooltip_note`, `tooltip` rows). On a treemap, `value_format` groups thousands,
  and `series_order` sets hue order and breaks ties between equal group totals, without filtering.
  Hover card on screen; the PNG export re-renders at 920px (744px beside a right-hand legend).
  `tbl-chart validate` warns on zero-value rows, more than 30 tiles, mostly unlabelled tiles at the
  export width, or more than seven groups without `series_colors`. The `treemap:` block is rejected
  on every other chart type, so no existing spec changes. See CONFIG-SPEC "Treemap options".
- `columns.section` on a horizontal `stacked` chart: the categories are grouped into sections
  with bold headers in the left gutter, as on a horizontal bar. Each category is still one stack;
  its net text or net dot and its segment labels sit on its own row. Hover, legend pin/dim,
  `x_axis_ticks` and the PNG export follow the sectioned rows. Validation still rejects `columns.section` on a vertical stack. See CONFIG-SPEC "Section
  axis".
- A label may repeat across sections (`columns.section`, horizontal bar, stacked and dumbbell). A row is
  identified by section + category and still displays the category, so "Top 1%" under two sections
  draws two rows, each hovering its own values; before, the second merged silently into the first.
  `x_order` / `category_order`, `x_labels` and `category_colors` name a bare label and apply to every
  section containing it (`x_order` orders within each section). The same section + category with two
  rows for one series is now a validation error. A sectioned chart without a repeated label renders
  byte-identically.
- `tooltip_section: true` (opt-in, default false) on a sectioned chart puts the hovered row's
  section in the hover card's header, before the category: `+ Corporate · Before response`, through
  `section_labels` and `x_labels`. Horizontal dumbbells and card-hover horizontal stacks; card header only (pills and the coordinated echo are unchanged, so it
  does nothing where the chart hovers with pills). Validation rejects it without `columns.section`.
  See CONFIG-SPEC `tooltip_section`.
- The `onHover` payload (and the `tbl-hover` event's `detail`) carries `section` on a chart with
  `columns.section`: the hovered row's raw section value, so a host can tell apart two rows that
  share a category across sections. Absent on a chart without sections.

### Changed
- **Horizontal charts draw `columns.facet` as groups, not small-multiple panes** (Ruling 80). On a
  horizontal `bar`, `stacked` or `dumbbell` chart (orientation omitted included), each facet value is
  a group of one chart, drawn exactly as a `columns.section` section: one plot on one value axis, a
  bold group title flush left, its rows indented 14px under it, the fixed 33px gap between groups.
  `small_multiples.pane_order` orders the groups and `pane_titles` titles them; `small_multiples`
  may be omitted. Groups may carry different categories. Hover, legend, PNG export and height are a
  sectioned chart's, and `onHover` reports the group as `section` (it was `facet`). Validation now
  rejects on these charts `columns.facet` with `columns.section`, `small_multiples.columns` above 1,
  `mode: per-pane`, `pane_widths`, `coordinated_cursor`, `section_order` / `section_labels` beside
  `columns.facet`, and a `facet` key on an annotation, `yAxisPolicy.markers` or `overlays` entry;
  `tooltip_section` is accepted with `columns.facet`. `renderFigure` throws on such a spec, pointing
  at `renderChart` / `render`. The ragged-facet check is gone with the shared category axis it
  protected. Vertical charts keep their panes, byte for byte. See CONFIG-SPEC "Small multiples".
- **Sections: the gap between two sections is a fixed 33px** on top of the usual space between two
  rows (room for the 13px header line with 10px either side), on horizontal bars, stacks and
  dumbbells, live and in the PNG export. It was two empty row
  slots, so it grew with the row height: 114-120px
  centre to centre at a 38-40px row pitch. The bottom of each section header's line sits 10px above
  its first row (was 15px), and the top margin of a sectioned chart shrinks to match (38 to 33px).
  The chart's height counts each gap at 33px rather than two 22px rows, so a sectioned chart of
  400px or more is 11px shorter per gap with its rows unchanged; a shorter one is sized to its rows
  (see the 400px entry below). Charts without sections render byte-identically. The
  chart's height gives the rows at least as much room as the gaps (a chart of many one-row sections
  grows to fit). The gaps stay 33px at any height the engine picks; only a host's own explicit
  `renderChart` or `mountChart` height too small for the rows shrinks them so they take at most
  half the plot, rather than squeezing the rows to nothing.
- **Sections: category labels are indented 14px under their section header**, as a table indents
  the rows of a row group, so the bold header reads as a title over its rows. The header stays flush
  left. The left gutter grows by the 14px, so the labels wrap as before. Horizontal bars, stacks and
  dumbbells, live and in the PNG export. Charts without sections
  render byte-identically.
- **Hover on horizontal charts: the shaded strip covers only the hovered row.** A stack that hovers
  with its card (a net dot, or `barStack.hover: "tooltip"`) spread a section's first row's strip
  over the gap and the header above it; it is now one row high, as the bar's already was. That
  stack's strip and a horizontal dumbbell's now also run left under the category label, which is
  bolded and darkened while hovered, as on a horizontal bar. Live only: the PNG export has no hover.
- `overlays[].ci` is now capped at 0.999 (still above 0); a level above it is a validation error
  naming `ci`. Near 1 the t-quantile is numerically meaningless. No published figure uses one.
- One date grammar for validation and rendering (CONFIG-SPEC "Dates"). **Embedders calling
  `renderChart` with a malformed date now get an error** naming the value, instead of a silently
  wrong x: `2024Q5` rolled into 2025Q1, `2024-13-01` into January 2025, `March 1, 2024` (or any
  other spelling) was read by JavaScript's `Date`, and a malformed timeline `end` cell drew its
  event as a point. Validation also tightens: it now rejects a day the month does not have
  (`2024-02-30`, which it passed before), and checks every spec-side x coordinate on a temporal or
  quarterly axis (`annotations` markers, bands and callouts, the legacy `xAxisPolicy` ones,
  `shading` bounds) against the grammar. Every published figure was scanned and re-rendered before
  and after: none is rejected and none changes.
- A `series_order` or `shape_order` that lists a value twice is now a validation error naming the
  field and the value (`/series_order: "M" appears more than once`), on every chart type.
  `renderChart`, which does not validate, drops the repeat and keeps the first entry, so such a spec
  renders as the list without it, live and in the PNG. Before, the marks took the first entry while
  the legend, key rows, hover markers, colours and a horizontal bar's height counted the repeat, so
  they disagreed.
- **Horizontal bars, stacks and dumbbells are no longer stretched to 400px.** A chart whose height
  grows with its rows was floored at 400px, so a 3-row chart's rows sat over 100px apart. Below 400px the height is now
  the chart's margins, its section gaps, and its rows one slot apart (22px per bar, or the wrapped
  label's height if taller): a 3-row horizontal bar chart is 107px tall, its rows 22px apart. A
  chart whose height came to 400px or more keeps it, byte for byte. Live and the PNG export agree. An
  unsectioned horizontal dumbbell's bottom margin is now one value-tick row (22px) at any label
  length; it was the vertical chart's category-label margin, which grew to 36px or 120px with long
  labels the horizontal chart never draws there.

### Fixed
- A short category label of wide letters could reach the plot on a horizontal bar, stack or dumbbell
  ("Gamma" touched a dumbbell's zero rule): the left gutter is sized from an average letter width,
  which runs short on such labels. The gutter now also clears each one-line label's width, measured
  from the font's letter widths, by 8px. Live, in the PNG export and the height models. A label
  that already had the room leaves the gutter as it was, so no published figure moves.
- `barStack.netDisplay: text` printed a negative net as its magnitude ("15" for -15), so a stack
  netting below zero read as a gain. It now prints it with a leading minus, outside any prefix, the
  sign style of the hover card and the waterfall labels (`-15`, `-$15`), live and in the PNG export, on vertical, horizontal and sectioned stacks.
  Positive nets and the (unsigned) segment labels are unchanged.
- On a sectioned category axis (`columns.section`), `x_order` / `category_order` could move a whole
  section: listing a category of a later section drew that section first. They now order categories
  within each section only; sections follow `section_order`, else the order the data first reaches
  them. Live and in the PNG export, on horizontal bars, stacks and dumbbells.
- `section_order` left a section out of the drawing but not out of the chart: its rows still fed the
  value axis, the height, a stack's net marker (a hidden negative gave a visible all-positive stack a
  net dot) and a stack's legend placement. They are now dropped before anything reads them, live
  and in the PNG export, on horizontal bars, stacks and dumbbells.
- `section_order` scoping reached two more readers. Validation's duplicate-row check counted rows
  of a left-out section, so a valid spec was rejected. And a series found only in a left-out section moved
  every later series one palette colour; colours now index the series list with every section drawn,
  as small multiples' panes index the figure's list (live, legend and PNG export). A
  `barStack.mono` stack ranks its shades over the rows with every section drawn, summed in the row
  order the full render sums them (a near-cancelling series could otherwise flip sign), so no drawn
  series changes shade either.
- A colour named `constructor`, `toString`, `__proto__` or another `Object.prototype` key passed
  validation as a palette name and could make the chart throw at render; it is now rejected at load
  like any unknown name, on every chart type. No published figure uses one.
- A series, category, group, facet, section or shape named like an `Object.prototype` key
  (`constructor`, `toString`, `__proto__`, …) drew a function as its colour and printed its source
  as its label; under `category_colors` its bar was not drawn at all (bar and waterfall), a dumbbell
  with `series_marker` set threw at render, and in a table's rich text `\constructor` was read as a
  Greek letter instead of reported as an unsupported macro. Every author map is now read by own key,
  so it takes its default colour and its own name, on every chart type and in tables. No published
  figure uses such a name.
- A timeline with an empty `series_order: []` drew no events; it now draws every event, as with no
  `series_order`, matching every other chart type.
- Timeline and treemap text in scripts Figtree lacks measures wider, so it runs past its column or
  tile far less often. A Cyrillic or Greek letter (Cyrillic Extended-B included) measures at its
  widest advance among Arial, Segoe UI, Liberation Sans, DejaVu Sans, Noto Sans, FreeSans, Source
  Sans 3 and Roboto, at weight 500 including Segoe UI's semibold face, which Chromium on Windows
  draws there (of Roboto only the 400 and 700 faces were measured; Roboto Medium, where installed,
  was not). Any other such script measures an em a code point (Unifont's width; 1.08em at weight
  700). That is not a bound: on Windows some single Tamil, Malayalam and Myanmar letters draw at
  2–2.7em, so a word dense in them can still run past. macOS fonts were not measured. A line now
  breaks only between graphemes, the same way in every runtime, so a flag, skin-toned, keycap or ZWJ
  emoji or an accented letter stays whole. Emoji joiners, variation selectors, tag characters and
  keycap marks now measure nothing (a keycap 1.4em, was 1.7em; a Scotland flag 1.4em, was 9.8em);
  flags, skin-toned emoji and ZWJ sequences measure 1.4em per part (a flag 2.8em, as before). ◽ ◾
  measure as emoji. Latin text, Latin Extended-E (U+AB30–AB6F) included, measures as in 1.15.0; no
  published figure is a timeline or treemap.
- **A right-hand legend now survives a resize below the right-column minimum and back.** Narrowed,
  the chart stayed squeezed beside the old right column with a second legend drawn on top; widened
  again, the redraw threw `NotFoundError` and stopped partway. The column is now taken down when the
  legend moves to the top and rebuilt when it moves back, as timelines already did. Live only: the
  first draw and the PNG export are unchanged, and no published figure resolves to a right legend.
- `legendPosition: right` (explicit or defaulted) with no legend rows to show now takes the full
  width on screen, as the PNG export already did, on every chart type; no published figure changes.
- A shared-mode (coordinated) faceted histogram's bin-range hover label (`10 – 20`) now hides the
  axis tick labels it covers instead of leaving a neighbouring tick's fragment past its edge. Hover
  only.
- A stacked chart with a single series no longer draws a net dot or a legend "Total" row where
  `netDisplay` resolves to a dot (by default, any negative value; an explicit `dot` included): with
  one series each bar's net is its own end. Its hover card, which already omitted the Total row, is
  unchanged, and it still paints no segment labels. A small-multiples figure counts the distinct
  series in the panes it draws, not a pane's. With no legend rows left, its defaulted right legend
  takes no column.
- A faceted area chart whose pane hovers with a card (a facet resolving to one pane, or
  `small_multiples.coordinated_cursor: false`) now shows the card's cumulative Total row, as
  CONFIG-SPEC promised and a standalone area chart already did. Hover only.
- An area chart on a categorical x (`xAxisType: categorical`) now hovers at all: standalone, and in
  a pane that hovers with a card, it shows the card with each series and the Total row; a
  coordinated multi-pane figure shows the guide and value pills, as on a temporal x. Before, the
  hover looked for bar rectangles an area chart does not draw, and showed nothing. The card is the
  categorical-x line's, so `x_labels` heads it and `hooks.tooltip` reaches it. Hover only.
- A small-multiples figure legend no longer keys a series whose rows sit only in panes
  `small_multiples.pane_order` leaves out, which is drawn nowhere; live and in the PNG. Colours are
  unchanged: the palette still counts that series, so every drawn series keeps its colour.
- A small-multiples pane now draws each series with the point marker the figure legend keys it with
  (`line` with `points: true`, and a `scatter` or `dotplot` whose `columns.shape` is the series
  column), as colours already did. A pane used to number markers by its own series, so a pane
  missing a series, or meeting its series in another order with no `series_order`, drew a series
  with another series' marker. The coordinated cursor's hover dot follows, and so does the hover
  card's key for a series the legend has no row for (`series_legend: false`, `legend: false`, or a
  figure drawing one series). Live and in the PNG.
- A small-multiples `scatter` or `dotplot` whose `columns.shape` is its own column (not the series)
  now draws each shape with the marker the figure's shape legend keys it with, in every pane, and the
  shape legend lists every shape a pane draws. Each pane numbered symbols by its own shapes, even
  with `shape_order`, so a pane missing a shape drew the next one with another shape's marker, and
  the legend (the first pane's) had no row for a shape the first pane lacked. The figure now
  resolves one shape list by the rule each pane applies to its own rows (`shape_order`, a listed
  blank value included, else first appearance with categories read in `x_order`), run over the
  rows of every drawn pane; a shape found only in a pane `pane_order` leaves out takes no position.
  A figure whose panes already agreed with each other and with the shape legend renders unchanged.
  Live and in the PNG.
- A small-multiples dot plot's coordinated hover dot now draws the marker of the point it sits on.
  It took a marker per series, so with a separate `columns.shape` it could draw a circle over a
  square, and with no shape column it drew series symbols over circles. A point `shape_order`
  leaves out gets no hover dot. Hover only.
- A horizontal chart (bar, stacked bar, dumbbell) no longer draws its zero rule when 0 is outside
  the value axis: a dumbbell fitted to its data (8–31, say), or a bar axis truncated with
  `yAxisPolicy.min`. The rule was drawn at x = 0 outside the plot, across the category labels. A
  vertical chart already drew it only when 0 is in range. Live and in the PNG.
- A dumbbell (connected dot plot) ignored `yAxisPolicy.includeZero: true`; it now extends the
  fitted value axis to 0, standalone and in small multiples. A pinned `min` or `max` still sets its
  own end. Omitted, the axis stays fitted to the dots as before.
- A lone `yAxisPolicy.min` or `max` (the other unset) was ignored on `line`, `scatter`, `dotplot`
  and `histogram` charts, which auto-fitted the whole axis; CONFIG-SPEC calls them a hard floor and
  ceiling. It now pins its own end and the other end stays fitted, as bars, stacks, areas,
  waterfalls and dumbbells already did. `autoWiden` now acts on a lone `max` on `line`, `scatter`
  and `dotplot` too (it has no effect on any other chart type, histograms included), and
  `includeZero` extends only an unpinned end. Standalone, small multiples and the PNG. CONFIG-SPEC's
  `min`, `max` and `includeZero` rows now say so.
- A lone `yAxisPolicy.min` or `max` past all of the data reversed the axis (a line with data 8–31
  and `min: 50` drew 50 at the bottom and 30 at the top; bars under `max: -5` drew [0, -5]), though
  CONFIG-SPEC reads a lone bound as ascending. The axis now ascends on every value-axis chart type:
  the bound stays where it was written and the open end lies past it (`min: 50` there draws 50–60),
  finite at any bound. In `per-pane` small multiples each pane decides this for itself; in `shared`
  mode the figure decides it for its one axis, so a pane whose data all lie on the other side of
  the bound moves that axis only through what it holds on the open side or a marker that raises
  its pinned end, as it did before. `yAxisPolicy.min` and `max` beyond ±1e300 are now validation
  errors. `tbl-chart validate` now warns, naming the bound, when a lone `min` is above every value in the
  data or a lone `max` below every value (per pane on a small-multiples figure; bin heights on a
  histogram). CONFIG-SPEC's `min` and `max` rows and its reversed-axis section state the rule, and
  the `autoWiden.step` row now says it applies to `line`, `scatter` and `dotplot` only.
- An `area` chart whose stack is negative at every x drew no 0 baseline: the value axis stopped at
  the stack's top (-5, say), though areas fill from 0. Its ceiling is now 0, as on bars and stacks.
- An `area` chart's value-axis floor was its lowest single value, though negatives stack down from
  0, so two negative series at one x (-20 and -11) got a floor of -20 and the stack's bottom (-31)
  was clipped. The floor is now the stacked negative extent. Its ceiling had the mirror defect: it
  was the net total per x, so mixed signs (+12, -2, -1 at one x) got a ceiling of 10 under a band
  reaching 12; it is now the stacked positive extent. Both are keyed by the parsed x, as Plot
  stacks, so a numeric x spelled `1` in one row and `1.0` in another is one stack, not two. Live and
  in the PNG.
- A dumbbell with `orientation` omitted is horizontal, as CONFIG-SPEC documents and the dots were
  already drawn, but everything around the mark treated it as vertical: a standalone chart kept a
  fixed height and hovered by column on screen, its `annotations.xAxis` markers were not folded into
  the value axis, and `columns.section` was rejected. It now renders exactly as `orientation: horizontal`,
  live and in the PNG.
- A standalone horizontal dumbbell's PNG kept the fixed 750px frame while the live chart grows with
  its rows, so the download stretched a short chart's rows apart and squeezed a long one's together.
  The export now sizes it with the live chart's height rule, as it already did for horizontal bars,
  so each row sits at the page's spacing and the frame grows or shrinks to fit.
- A right-hand legend column taller than the plot stretched the plot in the PNG: the export drew
  the chart at the legend's height, so its rows moved away from where the page draws them (a
  horizontal stacked bar with 30 series: 732px in the PNG, 400px on the page). The plot now keeps
  its own height and the frame grows to hold the legend. As on the page, the plot is centred
  against the taller column with its x-axis title directly under it (the PNG had top-aligned the
  plot and put the title below the legend). Live is unchanged.
- An `annotations.yAxis` marker (or `yAxisPolicy.markers`) on a horizontal bar, stacked bar or
  dumbbell (`orientation` omitted included) drew nothing, since the value axis is x there, but still
  widened the value axis to reach it. `tbl-chart validate` now rejects it and points at
  `annotations.xAxis`; `renderChart` no longer widens the axis for it, nor keys a legend row for it
  under `legend: true`. Live and in the PNG.
- `yAxisPolicy.autoWiden.step` must be greater than 0. A positive step tiny beside the value
  (`1e-320`) made `renderChart` and the PNG export throw, and a negative one rounded short of the
  value it was widening to. Validation rejects 0 and below, and a multiple of `step` that is not
  finite or falls short now moves `max` to the value itself.
- A horizontal stacked bar took its bottom margin from the vertical chart's category-label rule,
  which is sized for 45-degree labels under the plot (up to 120px), so long category names left
  about 100px of empty canvas under the value axis. It now takes a horizontal bar's margins: 26px
  under the value-tick row (8px with `x_axis_ticks: top`) and room for top ticks when
  `x_axis_ticks` is `top` or `both`. Live and in the PNG.

### Docs
- CONFIG-SPEC's `x_axis_ticks` row said "Horizontal bars only"; validation also accepts it on a
  horizontal stack, which draws the top tick row. It now says bars and stacks, and that
  every other chart type, a horizontal dumbbell included, is rejected.
- CONFIG-SPEC `annotations.xAxis`: the vertical rule on the value axis is drawn on horizontal
  stacked bars and dumbbells (`orientation` omitted included) as well as horizontal bars.
- CONFIG-SPEC `tooltip_decimals`: a waterfall's value pill (standalone, or a coordinated
  small-multiples pane) never used it; the pill takes the running-total labels' precision
  (`valueLabels.decimals`, else what the data needs). A waterfall pane with a card does use it.
- CONFIG-SPEC `overlays[].ci`: the reason for the 0.999 cap is now stated as the t quantile growing
  without bound near 1, not as an interval "too wide to mean anything".
- CONFIG-SPEC `series_order`: an empty `series_order: []` filters nothing.
- CONFIG-SPEC: statements of when a small-multiples pane hovers with a card instead of the
  coordinated cursor were wider than the code. `small_multiples.coordinated_cursor` now names the
  cases that never coordinate (a scatter, a `per-pane` histogram, a single pane of any type but bar
  or stacked); the `hooks.tooltip` table and `x_labels` no longer say bar and waterfall have no card
  "in any configuration" (an uncoordinated pane has one, and so does a dot plot or categorical line
  resolving to one pane); the texture notes count a single-pane faceted area, histogram or waterfall
  as hovering with a card.
- CONFIG-SPEC `barStack.netDisplay` said it "chooses the marker and nothing else" and no longer
  decides the hover. Resolving to a dot also sets the default hover (the card, unless
  `barStack.hover` is set) and refuses segment labels; the row now says so, and that `text` prints
  nothing in a `small_multiples` pane.
- CONFIG-SPEC `x_labels`: its list of cards that carry the label now includes an uncoordinated `bar`
  or `waterfall` pane, and its test note no longer calls the `coordinated_cursor: false` case a
  default-settings one.
- CONFIG-SPEC `yAxisPolicy.min`/`max` described them as a hard floor and ceiling with no exception,
  and its reversed-axis table said reference markers fold in without moving either pinned bound.
  On `bar`, `stacked`, `waterfall`, `dumbbell` and `area` a marker above the numeric ceiling (`max`,
  or `min` reversed) raises it, with one bound pinned or both (bars under `max: 20` with a marker at
  40 get [0, 40]); under `autoWiden` on `line`, `scatter` and `dotplot` a marker or callout past
  `max` moves it as data does, on a reversed axis too, where `max` is the floor. A new note,
  **Markers beyond a pinned bound**, says which markers count on which types; the rows keep their
  "Hard floor/ceiling" wording, now qualified, and they and the table point to the note. The
  `autoWiden.step` row now says markers and callouts widen `max` too and that `min` is never
  widened; the reversed-axis table's `autoWiden` row said it extends "whichever end the data
  overflows", and now says it extends `max` only.

### Upgrading

- **Horizontal facets draw as groups.** **No published figure is affected**: no `chart.yaml` on
  `main` or on the PR #67 branch is a horizontal `bar` or `stacked` chart or a `dumbbell` with
  `columns.facet` (the archive's 17 faceted specs are vertical line, bar, stacked, dotplot and
  waterfall charts). Horizontal small-multiple goldens were replaced (approved):
  `figure7-tariff` and `figure-hstacked-shared` by `figure7-tariff-grouped` and
  `hstacked-grouped`, rendered as grouped single charts; `figure7-tariff-sectioned`,
  `figure10-shape-sectioned-single` and `figure-hstacked-sectioned`, which set `columns.facet`
  with `columns.section`, are removed, as validation now rejects that pairing.
- **Horizontal facet charts change for embedders.** On a horizontal `bar`, `stacked` or `dumbbell`
  chart (orientation omitted included) with `columns.facet`, `onHover` and the `tbl-hover` event
  report the facet value as `section` and no longer carry `facet`, so a handler reading `facet` must
  read `section`. `renderFigure` throws on such a spec; draw it with `renderChart` or `render`.
  `renderChart`, `render`, `mountChart` and `buildExportSvg` throw on one that also sets
  `columns.section`, which `tbl-chart validate` rejects. **No published figure is affected** (see
  the entry above).
- **Sectioned charts get a fixed 33px section gap and indented category labels.** Published figures
  affected: the tariff model update's `etas` and `eta-effect` (sectioned horizontal bars, on
  `main`), and `effective-tax-rates-top-groups` on the unmerged PR #67 branch (sectioned horizontal
  dumbbell). Their sections close up from two row heights to 33px and the headers move 5px closer
  to their first rows, on screen and in the PNG. `etas` and `eta-effect` come out 11px shorter (one
  break each); the PR #67 dumbbell is under 400px, so it is sized to its rows (next entry). In all
  three the category labels move 14px right under their headers and the plot area
  narrows by 14px to make room. Found by reading every `chart.yaml` on `main` and on the PR #67 branch for
  `columns.section`; no other spec sets it. Sectioned goldens were re-recorded for this change
  (approved): `bar-sectioned-single`, `figure7-tariff-sectioned`, `figure10-shape-sectioned-single`,
  `dumbbell-sectioned`, `stacked-sectioned`, `stacked-sectioned-net-dot`,
  `stacked-sectioned-net-text`, `figure-hstacked-sectioned`; the same eight again for the
  label indent (approved). `figure7-tariff-sectioned`, `figure10-shape-sectioned-single` and
  `figure-hstacked-sectioned` were since removed (horizontal facets draw as groups, above).
- **Horizontal charts under 400px are sized to their rows.** One archived figure moves:
  `effective-tax-rates-top-groups` on the unmerged PR #67 branch (a 7-row sectioned dumbbell) goes
  from 400px to 243px on screen and its PNG from 614px to 457px, its rows 22px apart instead of
  stretched. `etas` and `eta-effect` on `main`, and PR #67's `revenue-by-tax-step-up` (422px) and
  `revenue-by-tax-deemed-realization` (536px), are 400px or more and render byte-identically, live
  and in the PNG. Found by reading every `chart.yaml` on `main` and in the PR #67 working tree for a
  horizontal `bar` or `stacked` chart or a `dumbbell`; no other spec is one. The dumbbell bottom-margin change
  reaches none either: the archive's only dumbbell is sectioned. Goldens re-recorded because they
  were floored at 400px (approved): `dumbbell-sectioned`, `figure-hstacked-shared`,
  `figure-hstacked-sectioned` (the last two since removed: horizontal facets draw as groups, above).
- **Hover: horizontal card-hover stacks and horizontal dumbbells shade under the label and bold it.**
  Live only. Of the archive, only the PR #67 dumbbell above hovers differently; the stacks on `main`
  (ai-fiscal `revenue-by-income-type`, `revenue-by-instrument`) are vertical.
- **A negative net printed by `barStack.netDisplay: text` gains its minus sign.** **No published
  figure is affected**: the archive's stacks on `main` (ai-fiscal `revenue-by-income-type`,
  `revenue-by-instrument`) use `netDisplay: none`, and PR #67's two `text` stacks have only
  positive nets.
- **`section_order` drops the rows of a section it leaves out** before the axis, height, net marker
  and legend placement read them. **No published figure is affected**: the archive's two
  `section_order` specs (the tariff model update's `eta-effect` and `etas`) list every section their
  data carries. The same holds for its validation, grid-column and series-colour readers.
- **Sections: `x_order` / `category_order` no longer move a section.** Rows are re-sorted only
  when the order they would draw in differs, so a chart already drawn in this order keeps its output byte for byte. **No published figure is affected**: the
  archive's sectioned specs (`eta-effect`, `etas`, and `effective-tax-rates-top-groups` on the PR #67
  branch) set neither field and none is faceted.
- **Sections: a label repeated across sections draws one row per section**, and two rows for the
  same section + category + series are a validation error. **No published figure is affected**: the
  archive's sectioned specs — the tariff model update's `eta-effect` and `etas` (horizontal bar),
  and `effective-tax-rates-top-groups` on the unmerged PR #67 branch (dumbbell) — repeat no label
  across sections and carry no duplicate row, and none is faceted. Their rendered SVG and PNG export
  are unchanged.
- **Hover: the bin-range label now hides the tick it covers.** Drawn only on the hovered pane of a
  shared-mode small-multiples histogram with two or more panes and `coordinated_cursor` not `false`;
  every other histogram (standalone, `per-pane`, `coordinated_cursor: false`, or a facet resolving
  to one pane) hovers with a card and draws no such label. **No published figure is affected**: the
  archive's only histogram, the deficit-management scorecard's `deviation-distribution`, is
  standalone. Rendered SVG and the PNG export are unchanged.
- **A single-series stack, of any sign, loses its net dot and its legend "Total" row**, on screen
  and in the PNG; with that row gone a defaulted right legend has no rows, so the plot takes the
  full width. **No published figure is affected**: the archive's only stacked charts, ai-fiscal's
  `revenue-by-income-type` and `revenue-by-instrument`, have four series in every pane and set
  `netDisplay: none`. No golden covers a single-series stack.
- **Hover: a faceted area chart's card gains its Total row** where the pane hovers with a card (one
  pane, or `coordinated_cursor: false`). **No published figure is affected**: the archive has no
  area chart. Rendered SVG and the PNG export are unchanged.
- **Hover: a categorical-x area chart gains its card (or, coordinated, its pills).** **No published
  figure is affected**: the archive has no area chart. Rendered SVG and the PNG export are
  unchanged.
- **A figure legend drops a row for a series drawn in no pane** (live and PNG). **No published
  figure is affected**: all 17 archived small-multiples specs set `pane_order`, and none leaves out
  a facet value present in its data. No golden moves.
- **A pane's point markers follow the figure legend** where the pane's own series list numbered
  them differently (live and PNG). **No published figure is affected**: of the 17 archived
  small-multiples specs, the 11 that draw per-series markers (10 `line` with `points: true`, one
  `dotplot` with shape = series) give every series the same position in every pane as in the
  figure; all 47 archived specs render byte-identical panes, legends and PNG export before and
  after. No golden moves. The same holds for the follow-up fixes (hover-card keys, a separate shape
  channel, the dot plot's hover dot): no archived faceted spec has a separate shape channel (the two
  that do, ai-fiscal's `revenue-vs-factor-income` and `revenue-vs-pretax-income`, are standalone),
  and `inequality-gini`'s hover dots are unchanged.
- **A spec that lists a value twice in `series_order` or `shape_order` now fails `tbl-chart
  validate`**; remove the repeat. Embedders calling `renderChart` directly get the list without the
  repeat instead. **No published figure is affected**: none of the 47 archived specs repeats an
  entry. No golden moves.
- **`renderChart` now throws on a malformed date it used to guess at** (see the date-grammar entry
  under Changed). Specs that pass `tbl-chart validate` are unaffected.
- **A horizontal chart whose value axis excludes 0 loses its zero rule** (live and PNG). **No
  published figure is affected**: the only horizontal specs among the 47 archived ones,
  tariff-model-update-july2026's `eta-effect` and `etas` (sectioned bars, no `yAxisPolicy`), include
  0. Nor are the three horizontal figures on the unpublished `pr67-spec-fixes` branch:
  `effective-tax-rates-top-groups` (a dumbbell with `yAxisPolicy.min: 0`) and the two
  `revenue-by-tax` stacks include 0. All five draw one zero rule before and after. No golden moves.
- **A dumbbell with `yAxisPolicy.includeZero: true` now starts (or ends) its value axis at 0.**
  **No published figure is affected**: the archive has no dumbbell, and the one on the unpublished
  `pr67-spec-fixes` branch, `effective-tax-rates-top-groups`, does not set `includeZero` (it pins
  `min: 0`). No golden moves.
- **A lone `yAxisPolicy.min` or `max` on a line, scatter, dot plot or histogram now pins its end.**
  **No published figure is affected**: every `yAxisPolicy` among the 47 archived specs sets both
  `min` and `max` or neither, and the one lone bound on the unpublished `pr67-spec-fixes` branch
  (`effective-tax-rates-top-groups`, `min: 0`) is a dumbbell, which already honoured it. No golden
  moves.
- **A lone `yAxisPolicy` bound past all of the data now gives an ascending axis** instead of a
  reversed one. **No published figure is affected**: the archive has no lone bound, and the one on
  the unpublished `pr67-spec-fixes` branch (`effective-tax-rates-top-groups`, `min: 0`) is below all
  of its data (8.0–30.6), so its axis is unchanged and validate does not warn. No golden moves.
- **`yAxisPolicy.min` and `max` must lie within ±1e300.** **No published figure is affected**: every
  bound on `main`, on the `pr67-spec-fixes` branch and in its working tree lies within ±4000.
- **An all-negative `area` chart's value axis now reaches 0.** **No published figure is affected**:
  there is no `area` chart in the archive, on the `pr67-spec-fixes` branch or in its working tree.
  No golden moves.
- **An `area` chart's value axis can reach further, to its stacked extents.** The floor moves only
  when some x's negatives sum below the lowest single value; the ceiling moves only when some x's
  positives sum above every x's net total (and above 0), which takes negatives at that x; and either
  moves where one x is spelled two ways (`1` and `1.0`). **No published figure is affected**: there
  is no `area` chart in the archive, on the `pr67-spec-fixes` branch or in its working tree. No
  golden moves.
- **A dumbbell with `orientation` omitted now renders as `orientation: horizontal`** throughout.
  **No published figure is
  affected**: the archive has no dumbbell, and the one on the unpublished `pr67-spec-fixes` branch
  sets `orientation: horizontal` and has no facets. No golden moves.
- **A standalone horizontal dumbbell's PNG is sized to its rows**, as the live chart is. The live
  chart does not change. **No published figure is affected**: the archive has no dumbbell. The one
  on the unpublished `pr67-spec-fixes` branch, `effective-tax-rates-top-groups` (7 rows in 2
  sections), now downloads 599px tall instead of 750px at 1x, with its rows 38px apart as on the
  page rather than 55px. No golden moves.
- **A PNG whose right-hand legend is taller than its plot keeps the plot at its own height,
  centred against the column, with the x-axis title under the plot** (PNG only). **No published
  figure is affected**: no spec on `main`, on the `pr67-spec-fixes` branch or in its working tree
  resolves to a right legend, and every one exports byte-identical before and after. No golden
  moves.
- **`annotations.yAxis` (or `yAxisPolicy.markers`) on a horizontal bar, stack or dumbbell now fails
  `tbl-chart validate`**; move the marker to `annotations.xAxis`. **No published figure is
  affected**: of the horizontal specs, `main`'s `eta-effect` and `etas` (bars) mark the value axis
  with `annotations.xAxis`, and the `pr67-spec-fixes` branch's `effective-tax-rates-top-groups`
  (dumbbell) and two `revenue-by-tax` stacks, committed and in its working tree, have no
  annotations. No golden moves.
- **`yAxisPolicy.autoWiden.step` of 0 or below now fails `tbl-chart validate`.** **No published
  figure is affected**: no spec on `main`, on the `pr67-spec-fixes` branch or in its working tree
  sets `autoWiden`. No golden moves.
- **A horizontal stacked bar's value axis sits 26px from the bottom of the chart** (live and PNG),
  and with `x_axis_ticks: top` or `both` its top margin grows by 18px for the tick row, as a
  horizontal bar's does. **No published figure is affected**: the archive's two stacked figures,
  ai-fiscal's `revenue-by-income-type` and `revenue-by-instrument`, are vertical. The two horizontal
  stacks on the unpublished `pr67-spec-fixes` branch, `revenue-by-tax-deemed-realization` and
  `revenue-by-tax-step-up`, go from a 120px to a 26px bottom margin and their bars take the freed
  height; neither sets `x_axis_ticks`. **Two goldens were re-recorded**, with Sylva's approval:
  `stacked-horizontal` and `figure-hstacked-shared` (short labels, so 22px became 26px and the plot
  is 4px shorter). `figure-hstacked-shared` was since replaced by `hstacked-grouped` (horizontal
  facets draw as groups, above).
- **`columns.section` is now accepted on a horizontal stacked chart** (it was a validation error).
  **No published figure is affected**: no stacked spec on `main` (ai-fiscal's two, both vertical),
  on the `pr67-spec-fixes` branch or in its working tree sets `columns.section`. The sectioned-bar
  layout code moved into a module the stack shares; every bar golden is byte-identical. New goldens
  only: `stacked-sectioned`, `stacked-sectioned-net-dot`, `stacked-sectioned-net-text`,
  `figure-hstacked-sectioned` (since removed: horizontal facets draw as groups, above). No existing
  golden moves.

## [1.15.0] - 2026-10-01

### Added
- `chartType: timeline` — dated point, span and open-ended events along a rule, one CSV row per
  event (`columns.end`, `columns.label`, `columns.description`, `columns.date_label`); proportional
  or even spacing; optional lanes and date axis; horizontal or vertical, switching to vertical on
  screen when narrow or crowded. Date ranges are spaced (`2031 – 2035`, open-ended `2040 –`). A
  vertical timeline sets each label beside its item, with its bold date above the title; a label
  that would collide on the right moves to the left of the track when that clears it, and a label
  still pushed below its date gets a leader. Moving labels left never adds leaders overall, so where
  it would, the labels on the rule all stay on the right, leaders included, even one whose left side
  was clear. Its text columns wrap at no more than 360px and hug their labels, and the whole timeline
  is centred in the chart. Two lanes draw as side-by-side lane columns unless
  `timeline.vertical_lanes: single`, and three or more share one track. Static (no hover); the PNG
  export keeps the authored orientation, and a vertical timeline downloads as a portrait image,
  360–640px wide, with its legend above the chart.
  `tbl-chart validate` warns on more than 20 events, on label overflow at the export width, or on
  an explicit `vertical_lanes: columns` with three or more lanes. The `timeline:` block and the new
  column roles are rejected on every other chart type, so no existing spec changes. See CONFIG-SPEC
  "Timeline options".

## [1.14.0] - 2026-09-10

### Added
- `annotations.points[].point` — **`scatter` only**: key a callout to ONE observation by its
  `columns.point_label` cell instead of copying that row's x and y into the spec. Exactly one of
  `x` / `point` is required; `point` excludes `y` and `series`, because the row supplies both. The
  value must match exactly one row's RAW `point_label` cell across the whole dataset — zero or several
  matches fail validation with a message naming the count, never a silent first match, because the
  motivating chart had two rows sharing an exact x and series. A keyed row that would not be drawn
  is refused too, rather than the callout vanishing: a blank value cell, a series dropped by
  `series_order`, a shape outside `shape_order`, a blank facet cell, a pane excluded by `pane_order`,
  or a `facet` that disagrees with the row's own. On a faceted chart the callout appears only in the
  pane holding its row; `facet:` is not needed and, if given, must agree. Matching is against the raw
  column, so a `point_label` that duplicates the series column (which the hover header dedupes to
  nothing) still keys. (#37)
- Row tokens in a point callout's `label`: `{point_label}`, `{x}` and `{series}` fill from the
  callout's row — the row `point:` matched, or the row a `series` callout snapped to. `{x}` is
  rounded to at most two decimals and grouped on a numeric axis (`2.593569308310415` reads `2.59`,
  `1234567.891` reads `1,234,567.89`) — grouped as the numeric axis ticks are, and identical to both
  the scatter hover card's x row and the crosshair header, so nothing on the chart disagrees;
  `tooltip_x_format` on a temporal or quarterly one, `x_labels` on a categorical one; `{series}`
  honours `series_labels`. `{value}` is unchanged. All four are substituted in one pass, so a
  data cell that happens to contain `{value}` is text, not a token. A token that cannot be
  resolved — a blank `point_label` cell, the nameless single series — stays literal. (#37)
- Point-callout labels that would sit on each other now move apart, and placement chooses HOW so
  that as few connectors are drawn as possible. Each auto-placed callout takes one of three
  treatments — keep its default offset, lift above its point, or drop below it — and the whole
  arrangement is chosen by: fewest leaders crossing another label, then fewest connectors (a
  displaced label with no `connector` costs no line, so it is the one moved by preference), then
  fewest labels moved at all, then least total movement. A tie lifts the label so its leader runs
  downward. So a label that can sit beside its point does, and needs no line; a label that must move
  goes far enough to carry a *visible* shaft rather than merely clear of the dot. A callout with an
  explicit `dx` or `dy` is pinned where the author put it and the others clear it. A callout that
  collides with nothing, and sits on no other callout's marker, keeps exactly today's offset — which
  is what keeps every published figure byte-identical. Pushed labels are clamped to the frame by
  their full height, except that a stack taller than the frame overflows the bottom, the top of the
  column winning. Past nine auto-placed callouts on one chart, or where no arrangement satisfies the
  constraints, placement falls back to a simple downward sweep that resolves overlaps without
  consulting the shaft geometry. An auto-placed label that would run off one side is also flipped,
  anchored away from that side and offset 6px to the inside of its point, because the visual review
  found callouts cut off at the right of the frame; the flipped box is what placement then works
  from, so the flip decides which labels collide. The thresholds are
  asymmetric: the CANVAS edge on the right, where the margin is empty and only a truncated label is a
  problem, and the FRAME edge on the left, where the margin holds the y-axis tick labels. A label
  that fits keeps the centred anchor and offset it always had; one that overruns both limits, or
  whose flip would overrun the opposite limit, stays centred because no side fits; a pinned label is
  never flipped. An explicit `\n` in a `label` is now a hard line
  break even when `maxWidth` is set — the wrapper split on all whitespace, so setting `maxWidth`
  silently destroyed authored breaks; each line now wraps at word boundaries on its own. Placement
  is otherwise one-dimensional, vertical only, like the x-axis stagger; it runs under the same
  conditions as the connectors (a numeric or temporal axis domain and a known width AND height —
  the stagger itself needs only the width, so a height-less render staggers axis labels but does not
  place callouts). (#37)
- `tooltip_x_label` / `tooltip_y_label` — **`scatter` only**: name the hover card's x and y rows
  when the axis titles are the wrong words for a tooltip (an abbreviated axis title, or a unit the
  card should spell out). Each falls back to the matching axis title, and that falls back to the
  literal `x` / `Value` as before. The axis titles themselves are untouched. Rejected on every other
  chart type, where a card row is labelled by its series rather than by an axis. Hover-only — a PNG
  export has no hover state. (#35)

### Changed
- **A point callout's connector is now a short, plain, headless leader that stops short of the
  marker.** Three defaults moved together, from the 1.14.0 visual review ("these are pretty weird
  and far from the points … the end of the connector also touches the point"). A callout with
  `connector: true` now sits **12px above its point instead of 28**; the leader is a plain line in
  the callout's colour with **no arrowhead**, where it was a `Plot.arrow` with a 6px head; and it
  stops **6.6px from the point's centre** — the scatter marker's 4.6px radius plus 2 — where the old
  4px inset ended it *inside* the marker, so the line ran under the dot. And an **auto-placed**
  callout draws the leader only when placement actually **moved** its label off that
  default: at 12px the label's own proximity says which point it belongs to, and the line was a few
  px of ink between two things already touching. A purely lateral frame-edge flip does **not** earn
  one — it leaves the label hugging its point, where the leader is a ~7px stub that reads as noise.
  A label placement moves now also clears every callout's marker, coming to rest no closer than
  that same 6.6px to any callout's point; a label still at its default is exempt, which is what
  keeps a lone callout byte-identical. Placement additionally puts a moved leader-drawing label far
  enough out for a *visible* shaft — though only for arrangements the search finds, not for the
  sweep it falls back to. A callout with an explicit `dx` or `dy` asks for the connector and says
  where the label goes, so its leader is drawn **whenever there is room for one**: pinned closer
  than the 15.1px threshold below, there is no shaft to draw and none appears. The default WITHOUT
  a connector is unchanged at 6px. Where no leader can be drawn (a categorical x-axis, or a render
  with no width/height) a pinned callout still falls back to a small dot and an auto-placed one
  now draws nothing. (#42)

- **Callout placement was rewritten twice within this release.** The first implementation swept
  colliding labels in one direction, which maximised the number displaced and therefore the number
  of leaders; a stakeholder review of the demo caught it before release ("2025a should obviously be
  above, with a longer line straight down… is there a way to minimize connectors?"). The shipped
  behaviour is the connector-minimising search described under Added; the sweep survives only as the
  fallback named there. Recorded because the intermediate behaviour appears in this file's own git
  history and in three rounds of review notes, not because any release ever had it.
- **A point callout's label takes its series' colour by default.** It was a flat neutral
  (`TBL.color.heading`) whatever the callout pointed at, so a label read as chrome detached from the
  data rather than as a note ON that series. A callout keyed by `point:` now takes the colour of the
  row it matched, and one snapped by `series:` the colour of that series — the same map the marks
  are painted from, so a label cannot disagree with its own dot. An explicit `color:` still wins,
  and a plain `x` + `y` callout has no series to inherit from and keeps the neutral. **No published
  figure moves:** every callout in the archive sets `color` explicitly (`etr-vintages` and
  `price-waterfall` at `#6D6D6D`, the untracked scorecard at violet).
- **An annual temporal series' hover card reads a bare year.** The card defaulted to `%b %Y`, so an
  annual series showed `Jan 1950` under an axis reading `1950` — the axis already collapses a
  year-cadence span to a bare `%Y`. The default is now `%Y` when every x cell falls on 1 January.
  Tested on the DATA and deliberately not on the tick cadence: a monthly series across eighty years
  also draws decade ticks, and there the month is the only thing separating adjacent points. An
  explicit `tooltip_x_format` still wins. **No published figure moves** — all twelve tracked
  temporal specs are daily or monthly.

### Fixed
- **A callout's leader no longer paints over another callout's label.** `assemble-plot.ts` collects
  annotation text in `labelMarks` and pushes it after every line and rect, precisely because Plot
  paints in array order and "the white halo can't rescue text drawn under a later stroke" — its own
  comment. Point callouts were the one annotation not using that bucket: the label went into `marks`
  inline, inside the per-callout loop, so callout N+1's shaft was drawn after callout N's label and
  straight through it. Reported as illegible on the demo. Placement minimises crossings but cannot
  always reach zero, so the paint order is what keeps the text readable — and the halo has been
  there all along waiting to do its job. **Rendered output changes for any chart with a point
  callout.** SVG element order changes on all of them, the label moving later in the array. PIXELS
  change in three cases: wherever a leader previously crossed a label — that is the defect, and
  removing those stroke pixels from the text is the fix — and wherever a callout label overlaps a
  pane title or an `annotations.xAxis` / `yAxis` / `bands` label, both of which the callout now
  paints OVER rather than under (those marks were already queued in `labelMarks`, so the callout
  moving into the same bucket puts it last).
  **The archive's two tracked callouts are unaffected, verified by rendering rather than argued:**
  `etr-vintages` ("Projected") and `price-waterfall` (`maxWidth`-wrapped to "(no step in" /
  "original)", facet-scoped) were rendered and every other `<text>` in the figure measured against
  them — neither callout's box intersects any other text, so nothing can paint over or under
  anything and the pixels are identical. Only their serialised element order differs. No golden
  covers `annotations.points`, so the suite is silent on all of it.
- **Placement's second ranking key counts connectors, not displaced labels.** A displaced callout
  with no `connector` draws no line, so counting it tied a move that costs a leader against one that
  costs nothing and let the tie-break pick the expensive one. Caught in review before release.
  Crossings are also scored once the whole arrangement is settled, over every leader actually drawn
  — including pinned ones — where scoring them as labels were placed missed an earlier label's shaft
  crossing a later one, and missed pinned shafts entirely. And the shaft is modelled as the real
  slanted segment from the label's anchor to the marker rather than a vertical line at the point's
  x, which differ by the `dx` offset on a flipped or pinned label; since crossings are the FIRST
  ranking key, that discrepancy could pick a worse arrangement.
- **The PNG export puts the legend where the live card puts it.** A stacked chart with five or more
  series — or a diverging one — lays its legend in a right-hand column on screen, and the download
  drew it above the chart regardless. `legendPosition` was resolved inside `render-live.ts`, so the
  export never saw it; `export-png.ts` contained no reference to it at all. Reported from a real
  download. Nothing recorded a reason for the two to differ, and a test had recorded the
  divergence as behaviour, which is why it survived.
  The fix is a third module, `src/engine/legend-layout.ts`, holding the position rule, the column
  width and gap, the series count the rule is defined on, and the top-to-bottom ordering — imported
  by BOTH paths, so they cannot drift again. It could not simply be imported from `render-live.ts`:
  that module imports `exportChartPng` for its download button, so the reverse import would be a
  runtime cycle. The export now reserves 160px plus a 16px gap, renders the chart into what remains,
  stacks the legend rows beside the plot in the same visual order the live column uses, wraps a
  label too long for the column, and puts a shape legend below the colour rows in the same column.
  A `small_multiples` figure keeps its top legend, as it does live.
- **An auto-placed callout label no longer parks on another labelled point.** Only a MOVED label
  cleared the markers; a label sitting at its default was exempt, so on the 1.14.0 demo "2025a" came
  to rest squarely on a different callout's dot — leaving the reader to guess which of two labels
  belonged to it. Every AUTO-PLACED label now clears every other callout's marker, whether or not
  anything else moved it. A **pinned** label (`dx`/`dy`) is not swept at all, here as for the flip
  and the frame clamp, so it still sits exactly where the author put it. A label's own marker
  stays exempt while it sits at its default, which is what keeps a lone callout byte-identical, and
  binds the moment anything pushes it. **No published figure moves:** the two tracked callouts are
  each alone on their chart (no other marker to clear) and the untracked scorecard's four are all
  pinned, and pinned labels are never swept.
- **A connector leader no longer runs up through its own label's text.** It started at the label's
  ANCHOR, which is the box's vertical centre, so on a wrapped or line-broken label the shaft was
  drawn through every row of it — reported as looking terrible on the 1.14.0 demo. It now starts at
  the label's edge: half the box height plus 2px with no `dx`, or just the 2px when an explicit or
  flipped `dx` anchors the box by the edge facing the point. Where the two insets leave no room the
  leader is **not drawn at all**, rather than emitted as an invisible or text-crossing line — the
  label is already touching its point, the same reasoning that gives a callout at its default no
  leader. The threshold is the two insets added together — **15.1px** for a one-row label — so
  **clearing the marker and earning a leader are now different thresholds**: a label the sweep
  pushes just clear of a dot (13.6px on the demo fixture) shows none, while one pushed 26.6px shows
  an 11px shaft. A `connector: true` pinned closer than 15.1px draws no line at all, and one pinned
  just past it draws a hairline. No tracked published figure carries a
  `connector`, so nothing published moves.
- **A multi-line point callout is clamped to the frame by its whole height, not by one row.** The
  clamp bounds were computed once, from half of a single row, and applied to every label — so a
  callout wrapped by `maxWidth` or broken by an explicit `\n` (both new in this release) had its
  centre pulled to 6.5px inside the frame while its half-height was 13px or more, leaving the rest
  hanging outside. `placePointCallouts` now takes the frame edges and insets each label by its own
  half-height. The pass that pins an overrunning label also picks the label that most overruns **its
  own** limit rather than the lowest one in the column, since with per-box limits a tall label can
  be outside the frame while a shorter one below it is still inside. A one-row callout clamps
  exactly where it did before, so no single-line figure moves. Found by review. (#42)
- **A diagonal texture's legend key no longer overflows its swatch in the PNG export.** Found
  downstream in a real download (`interactives-staging`, taxes-at-the-top distribution card, engine
  1.12.0 as vendored): a `series_patterns: '/'` key rasterised as a tilted parallelogram spilling
  past its swatch box and past the legend row, beside three clean square swatches, while the same
  key was correct on screen. `iconSvgGroup` (`src/engine/icon.ts`) builds the glyph's clipping
  `<svg>` viewport and then moves the shapes OUT of it into a bare `<g>` for the export to
  position — and a `<g>` does not clip. The diagonals were stroked lines drawn corner to corner at
  6px wide, which overflow a 14px box at both ends and along both flanks, and `hatch.ts` said so
  outright: they "are clipped to the box by its viewport". Only `/`, `\` and `x` were affected; the
  axis-aligned `|`, `-`, `+` are rects sized exactly to the box. The diagonal band is now a polygon
  carrying the trimmed geometry — the exact intersection of that stroke with the box, so the region
  the live legend draws is unchanged — which is correct in any container and needs no viewport.
  Geometric identity is derived, not measured: a polygon fill and a clipped stroke take different
  rasteriser paths and may differ in edge antialiasing, and no before/after screenshot was
  compared, so the live key is "the same shape", not certified pixel-for-pixel. This follows the
  precedent `hatchPattern` already records for using a band rect rather than a stroked line inside a
  `<pattern>` tile. It also closes the gap that hid it: the diagonals were the one shape
  `test/icon-fits-box.test.ts` filtered out of its clipping check, and the line test it left them to
  asserted only that endpoints were inside the box, on the assumption that a line "may be TRIMMED at
  the frame". As polygons they are measured with every other shape, and a new test asserts the
  exported group carries no stroked band and no geometry outside the box.
- **A bare `YYYY` cell on a temporal axis landed a year early in any negative-offset zone.**
  `parseDate` (`src/spec/parse-time.ts`) special-cased `YYYY-MM-DD` to local midnight and fell
  through to `new Date(s)` for everything else, which reads a bare year as an ISO year anchored at
  **UTC** midnight. The engine then formats in local time, so `new Date("1952")` is 31 December
  1951 at 19:00 in ET and `getFullYear()` returns 1951: every point, every tick label and the axis
  domain itself slid back one year, silently and consistently enough to look right. A bare year is
  the natural spelling for an annual series, and this is what makes `xAxisType: temporal` its
  correct home — see the numeric-grouping note under Upgrading. The fix is the same local-midnight
  construction the `YYYY-MM-DD` branch already used, so both spellings now agree to the millisecond
  and a column mixing them no longer splits. Covered by a test that moves the process timezone; the
  suite pins `TZ=UTC`, where the two parses agree and the bug is invisible. A low four-digit year is
  handled explicitly too: the multi-argument `Date` constructor maps years 0-99 into 1900-1999, so
  `"0050"` would otherwise have come back as 1950. That correction is applied in **one** helper
  shared by all three parsers, because the `YYYY-MM-DD` and `YYYYQ#` branches had the same defect
  already — fixing only the bare year would have put `"0050"` and `"0050-06-15"` 1900 years apart.
  **`validateChartData` now accepts a bare `YYYY` as a temporal cell**, which it did not: it
  required `YYYY-MM-DD` and rejected every row with `expected YYYY-MM-DD, got "1952"`. Parsing the
  cell correctly was useless while validation refused it — the recommended annual-series migration
  could not have passed the publish path. The error now names both accepted forms.
- **The hover card wraps a row label longer than the card instead of clipping it.** `.tbl-tooltip`
  set `white-space: nowrap` *and* `max-width: 320px`, which contradict: the box stopped at 320px and
  the un-wrappable line ran out through the right border, so the row's value — the one thing a
  reader hovers for — was painted outside the card and cut off. Reported on a `scatter` whose card
  rows fall back to the axis titles (`tooltip_x_label` / `tooltip_y_label` absent), but it hit any
  card with a long series name, category name or overlay label. The card now wraps at the same
  320px — a label with no space or hyphen to break at is broken mid-word rather than left to run
  out through the border — and every row's value is joined to its label by a non-breaking space
  so a wrap does not separate them. Pre-existing since the card was introduced. Hover-only: the
  card is live-DOM CSS and a PNG export has no card, so no exported or published image changes.
  (#41)
- **A faceted stacked bar in tooltip mode keeps its cross-pane band echo.** A stack whose hover is
  the card (a diverging stack with its net dot, or `barStack.hover: "tooltip"`) dropped ALL
  coordination with its sibling panes: the gate that suppresses value pills on a card pane also
  withheld the `onResolve` forward that drives the other panes, so hovering one pane left the rest
  dark. The pills half of coordination is what tooltip mode drops; the band echo is independent of
  it. The pane now forwards its hover and its siblings draw an echo-only shade (`echoOnly` on the
  secondary band cursor, the stacked analogue of the dumbbell's `markerless` branch) — no pills, no
  category-name pill, no axis echo — and the hovered pane's own echo stays blank because its card
  and highlight already mark the band. A pinned legend series' own pills stand on every pane
  through the hover, exactly as a standalone chart in this mode leaves them; suppressing them exists
  only so the pills cursor can draw its replacement, and the echo draws none. At default settings;
  `small_multiples.coordinated_cursor: false` keeps the card with no echo and `chrome.tooltip: false`
  keeps the echo with no card. Hover-only — nothing here reaches the PNG. (#32)
- **The x-axis title no longer collides with the tick labels on a numeric axis.** The 8px correction
  was keyed to `.chart-scatter`, so a histogram (numeric axis, not a scatter) never received it and a
  faceted scatter did not either, because the figure card carried no chart-type class at all. The
  cause was the axis type: a numeric x-adapter reserves 22px below the frame against the temporal
  adapter's 38px. Both card roots now carry `x-<xAxisType>` and the rule is keyed to `x-numeric`.
  Categorical, temporal and quarterly axes are unchanged. The PNG export positions the title with its
  own arithmetic, already looser than the screen on every axis type, and did not change. (#34)
- **Annotation stagger and connector geometry now measure against the drawn axis, not the data.**
  `assemblePlot` estimated label pixel positions from the data's x extent, which is not what the axis
  spans when a histogram's bin-edge span (`histogram.domain`, else the computed outer bin edges) or
  `anchorAtZero` is in play — and binned rows carry
  no numeric x at all, so on a histogram the stagger never ran and overlapping `annotations.xAxis`
  labels overprinted. The resolved axis domain is now passed in its place (`xExtent` → `xAxisDomain`
  on the `assemblePlot` option; a `Date`-valued temporal-histogram domain is converted to epoch ms).
  (#36)

### Docs
- `CONFIG-SPEC.md`: the `annotations.points` row is rewritten for `x | point`, the row tokens and
  auto-placement, with a new "Row tokens" paragraph and a worked scatter example keyed to
  observations; the `barStack.hover` row and the small-multiples paragraph state that a card pane
  coordinates a band echo and leaves a pinned series' pills standing; the `tooltip_x_label` /
  `tooltip_y_label` row, now also noting the pre-1.14.0 clipping the wrap fix replaces; the
  `chrome.tooltip` row's new paragraph on the card's 320px wrap; and a paragraph under the class
  table documenting `figure-card`, `chart-<chartType>` and `x-<xAxisType>` on the card roots.
- Four pre-existing `CONFIG-SPEC.md` claims corrected. Two were made false by this release and
  narrowed to match: the `x_labels` row said a coordinated small-multiples pane replaces its card
  with the in-place cursor (a dumbbell and a stacked pane in tooltip mode keep theirs), and the
  `series_patterns` notes said no coordinated pane draws a card. One was already false: "`bands` /
  `points` are not facet-scoped" (`points` take `facet`, and `filterAnnotationsByFacet` has scoped
  them). One was ambiguous once `point:` existed: "`annotations.points` cannot be keyed" meant
  legend-keyed and now says `legend: true`, since `point:` is a key of a different kind.

### Upgrading

A repin re-renders every published figure at once — here is what a maintainer will see change:

- **Charts where the axis domain differs from the data extent re-lay out their annotations.** Four
  classes, none present in any golden fixture: a histogram with `annotations.xAxis` or band labels
  (labels that overprinted now stagger); a histogram with `annotations.points[].connector: true`
  (previously drew a plain dot because the connector gate was never satisfied, now takes the leader
  rules under Changed);
  an `anchorAtZero` chart with annotation labels (label x now matches the marker's drawn x); and an
  `anchorAtZero` chart with connector callouts (previously drew no leader line at all; now draws one
  whenever the callout is pinned or placement moved its label). **One chart in the sibling
  archive falls in the first class, and it is NOT yet published** — the deficit-management
  scorecard's `deviation-distribution` histogram, which lives under the untracked
  `charts/trackers/` tree (`git ls-files` does not know it), so nothing published moves here;
  it will pick this up whenever that tracker is committed. The chart (`histogram.domain: [-1, 2.25]`, four labelled
  `annotations.xAxis` markers), whose "2026a" (x = 0.5013) and "2025a" (x = 0.6222) labels sit about
  24 px apart at width 720 against about 31 px of text and overprint today; that overprinting is the
  defect being fixed, and "2025a" drops to the second stagger row on repin. The archive's only two
  `anchorAtZero` uses are both `anchorAtZero: false`, and a non-anchored numeric axis's domain is
  exactly the data extent (`[d3.min, d3.max]` of the parsed x), so every other numeric chart renders
  byte-identically — as does every temporal, quarterly and categorical chart, which fall back to the
  data extent exactly as before. (#36)
- **Point callouts that overlap at their default offsets now move apart, unconditionally.** A chart
  with two or more `annotations.points` without `dx`/`dy` whose labels currently sit on each other
  re-lays out on repin. **No published spec is affected**, established by parsing every authored
  spec: two figures carry a single unpinned callout each (a lone callout never collides) and the one
  figure with several callouts pins all of them. No golden fixture carries `annotations.points`, so
  this guarantee rests on the exact-equality tests in the engine, not on the golden suite. (#37)
- **An unpinned point callout near a horizontal edge now flips to the inside of its point.** This is
  a separate condition from the collision above, and the "no published spec is affected" finding
  there does NOT cover it: a LONE unpinned callout flips too, whenever its centred label would run
  off the canvas on the right or cross the frame edge into the y-tick-label gutter on the left.
  **No published callout moves**, established by rendering both figures that carry an unpinned
  callout before and after the change — `etr-vintages` ("Projected") and `price-waterfall`
  ("(no step in original)", on a categorical axis where the flip is gated off) — and finding
  identical label positions and text-anchors. A callout whose label fits is untouched, and a
  pinned (`dx`/`dy`) callout never flips. (#37)
- **Every `connector: true` point callout re-lays out.** Its label moves 16px closer to its point
  (12px above instead of 28), its leader loses the arrowhead and now stops 6.6px from the point's
  centre instead of 4px, and an auto-placed callout loses the leader altogether unless placement
  moved its label (a lateral frame-edge flip alone does not earn one). A moved label is also
  held clear of every callout's marker, so it can no longer come to rest on the dot it names. **No
  committed published figure carries a `connector`**, established by grepping every `chart.yaml`
  under `budget-lab-charts/charts`: the only hit is
  `trackers/deficit-management-scorecard/scorecard-scatter`, which is untracked in that repo (not
  published) and whose four pinned callouts will change appearance on the next render — expected. No
  golden fixture carries a `connector` either (`grep -l connector test/fixtures/*.yaml` is empty), so
  this change is invisible to the golden suite and rests on the tests in the engine. (#42)
- **No published figure changes.** The right-hand PNG legend reaches only a STANDALONE chart, and
  the archive has none that qualifies: parsing all 40 tracked `chart.yaml` files, no spec sets
  `legendPosition`, and every stacked spec declares `small_multiples` — a figure has only a top
  legend slot, in the export as on screen. So there are zero stacked non-figure specs, and nothing
  published takes the new path. (An earlier draft of this note named `ai-fiscal/revenue-by-income-type`
  and `/revenue-by-instrument` as changing; both are small multiples, so neither does. The scan
  behind that claim filtered on chart type, series count and sign without applying the figure gate
  that decides whether the position rule runs at all.)
- **Every numeric x axis gains a thousands separator, and its crosshair header now rounds.** One
  grouping rule (`formatNumericX` / `formatNumericTick`, `src/engine/util.ts`) now serves the axis
  tick labels, the crosshair header, the scatter hover card's x row and the `{x}` callout token, so
  a tick and a hover reading can no longer disagree. Two changes fall out of it: a numeric tick over
  999 reads `1,234,567` where it read `1234567`, which is a **rendered SVG and PNG** change; and the
  numeric crosshair header rounds to two decimals, where it printed the raw value
  (`x=2.285011857607663` now reads `2.29`), which is hover-only. A histogram's bin-range header is
  pinned to the same locale for the same reason (`histogram-label.ts`); it followed the host's,
  so on a de-DE machine it read `1.234,5` under a `1,234.5` tick. Identical on an en-US host.
  **Two published figures move, and both must be migrated in the same repin.** The sibling archive
  has **six tracked** specs on `xAxisType: numeric`. Four have no |x| over 911 and are untouched
  (`ces-qcew-benchmark-revisions/final-v-prelim` and `/regressions` at 911,
  `ai-fiscal/revenue-vs-factor-income` at 633, `ai-fiscal/revenue-vs-pretax-income` at 547). The
  other two are annual series on a numeric axis — `ai-fiscal/gdp-growth-history` (1952-2036) and
  `ai-fiscal/labor-share-history` (1947-2026) — whose tick labels would read `1,950 1,960 …`.
  (Two further numeric-x specs sit under the untracked `charts/trackers/` tree —
  `deficit-management-scorecard/deviation-distribution` at 1.96 and `/scorecard-scatter` at 3.29 —
  and are unpublished; neither would gain a separator anyway.)
  **Change both to `xAxisType: temporal`**, which needs no data edit: a bare `YYYY` cell now parses
  as that year's 1 January and validates (below), and `tblTemporalXAxis` renders a year-cadence span
  as bare `%Y` labels — the same `1950 1960 …` decades those two charts show today. Their axis
  *markup* and bottom margin still change, because a temporal axis is drawn by text marks rather
  than `tblXAxis`; their labels do not. Grouping is right for a measured quantity and wrong for a
  year, and the fix is the axis type rather than a magnitude carve-out in the formatter. No golden
  fixture uses a numeric x at all (`xAxisType` in `test/fixtures` is only `categorical` and
  `temporal`), so the golden suite is silent on this and it rests on the engine's own tests. (#37, #42)
- **Every published histogram and faceted scatter gains 8px between its x-axis title and its tick
  labels.** Screen only; the PNG export is unchanged. (#34)
- **A faceted stacked bar whose hover is the card now also shades the hovered category on its
  sibling panes** — at default settings; `small_multiples.coordinated_cursor: false` keeps the card
  alone and `chrome.tooltip: false` keeps the echo alone. Hover-only. (#32)
- **Every chart card root now carries an `x-<xAxisType>` class** alongside `figure-card`; a host stylesheet
  keying on the exact class string will see the new token. `chart-<chartType>` stays on the standalone
  card. (#34)
- **Every published chart's hover card now wraps a label longer than the card**, where before the
  line ran out through the border and the value was clipped. A card with a long series name,
  category name, overlay label or (on a `scatter`) axis title grows taller rather than losing its
  number off the edge; the value stays on its label's last line. Hover-only, with no exported or
  published image changes — but the on-screen card looks different for every such chart starting
  now, with no spec change on anyone's part. (#41)
- **`CONFIG-SPEC.md` changed.** `budget-lab-charts` vendors it verbatim and gates CI on it being
  current — re-run its vendoring step at repin.

## [1.13.0] - 2026-08-25

### Added
- `columns.point_label` — **`scatter` only**: a column naming each OBSERVATION (a year, a state, a
  firm), appended verbatim to the hover card's header after the series and any shape token
  (`Observed · Compressive · 2004`). It encodes nothing, so there is no display map and no
  formatting: the cell is the label. A blank cell contributes no token, and a `point_label` pointed
  at the series or shape column collapses to nothing rather than repeating what the header already
  says. Rejected on every other chart type rather than ignored. Hover-only — a PNG export has no
  hover state.

- Inline links in `note` / `source` (charts) and `notes` / `source` (tables): `[text](url)`. The
  URL must carry an explicit `http://`, `https://` or `mailto:` scheme — anything else, a bare
  `www.` or a slash-less `http:` included, does not form a link and stays literal text, which is
  also why no unsafe scheme can ever reach an anchor. A URL over 2048 characters is refused
  outright rather than truncated. There is **no
  escape syntax**, deliberately: `\[` already opens display math in table text, and an escape would
  both collide with that and re-interpret strings that are legal today. Following
  `table/richtext.ts`, a marker only means anything inside a complete, well-formed construct, so any
  line without one renders byte-identically to before. In a **PNG export** the link text is
  underlined but not clickable and the URL is not shown — a raster image cannot carry a link target,
  and the export draws SVG `<tspan>`s rather than an `<a>` so it cannot imply otherwise.

- `series_legend: false` — drop the legend's **series rows** while keeping the rows overlays and
  annotations opted into with `legend: true`. For a chart whose colour channel needs no naming
  because the points are identified some other way. Distinct from `legend: false`, which removes the
  whole box and pushes overlay labels back in-frame; here the box survives, so click-to-pin still
  works for the rows that remain. Any chart type.
- `tooltip_series_name: false` — **`scatter` only**: drop the series token from the hover card's
  header, so `Observed · 2004` reads `2004`. Rejected on other chart types, where the series name
  labels a tooltip ROW against a value rather than heading the card. Independent of `series_legend`.

- **An overlay's in-frame label no longer wanders off the canvas.** The label anchors at a point on
  the line and is deliberately never clipped; together those put it wherever the line's last SAMPLED
  point was — and a line is drawn across its `domain`, not across the part you can see. A steep
  `domain: axis` fit exceeded the value axis and a `domain` wider than the x axis ran off the side,
  so the label was placed outside the frame and silently vanished. Measured before the fix: a
  slope-3 line's label sat 675px above a 400px frame, and a real spec's second fit label was 44%
  visible. The line is now clipped to the frame before the anchor is chosen, so `labelPosition:
  right` means the last point you can see. A line with no visible portion draws no label at all.
- **A label on a steep line now clears it.** `labelSide`'s few px of vertical offset does nothing
  against a line that climbs further than that across the width of the text — it ran straight
  through. Past 45° on screen the label moves beside the line instead, its text running away from
  it. Across a 19-label sweep this took own-line intersections from 8 to 0; the one remaining
  collision is a label crossing a DIFFERENT overlay, which nothing arbitrates.

### Fixed — the scatter hover layer read three things it should have been told
Each of these was the hover/tagging layer reconstructing what the render had already decided,
instead of reading it. All three are hover- or attribute-level; no rendered geometry changes and no
golden moved.
- **`legend: false` no longer strips a scatter card's shape name and marker.** The header keyed off
  the shape LEGEND, which `legend: false` nulls, so hiding the legend emptied the symbol map and
  every header fell back to a circle over whatever the point actually was. CONFIG-SPEC has always
  promised `legend: false` keeps tooltips; now it does. The header now keys off the symbol scale the
  marks were drawn with.
- **A faceted scatter no longer draws the wrong marker in its card.** That path indexed raw
  `shape_order`, which is optional and, when set, is filtered to each pane's own values before it
  becomes the domain — so an absent order made every header a circle, and a filtered one shifted
  every later symbol.
- **A point chart no longer pairs markers with the wrong rows.** A row that renders no marker — a
  blank value, or a shape value left out of `shape_order` — stayed in the array that `data-series`,
  `data-shape`, hatch textures and the hover card are all indexed against, shifting every later
  marker onto the wrong row. The legend dimmed and pinned the wrong points, textures painted onto
  the wrong series, and the card reported the wrong x and y. The mark, the tagging and the hover now
  share one list of the rows that actually rendered.

- **A scatter card's header no longer opens with a dangling separator.** A chart with no `series`
  column resolves to the single-series key (`""`), and that empty token was being joined rather than
  dropped — so a single-series scatter with a shape channel has always read `· Compressive`. Empty
  tokens are now dropped, which also covers the new `point_label`.

### Docs
- `CONFIG-SPEC.md`: the table `notes` row claimed "each string renders as a paragraph". Both table
  mount branches join the array into one string and the source-line renderer emits a single `<p>`,
  so an array has never produced one paragraph per entry. Corrected to what the code does.
- `CONFIG-SPEC.md` + `types.ts`: the `legendPosition` row promised "an explicit value always
  wins". Four routes ignore the field outright — `legend: false`, a card too narrow for the
  column, any `small_multiples` figure, and the PNG export, which always draws the legend on
  top. Long-standing; scoped now because the row was edited here. Each route has a test.

## [1.12.0] - 2026-08-18

### Added — a stacked-bar hover/net-callout split, and overlay lines on scatter and line charts
- `barStack.hover` (`tooltip` | `pills`) selects a stacked chart's hover treatment independently of
  `barStack.netDisplay`. A chart can now have the floating tooltip with no net dot and no "Total"
  legend entry, from the spec alone — so the PNG export matches the screen, which a CSS override could
  not achieve. It also pins the treatment against `netDisplay: auto`'s data-dependent flip.
- `barStack.total` orders and styles the tooltip's Total row: `position` (`first` | `last`, default
  `last`), `bold`, and `divider` — a rule separating the Total row from the series rows, whose side
  flips with `position` so it never lands between the header and the Total row instead. **`bold`
  and `divider` default to `true`** (opt out with `false`) — every stacked chart with a Total row
  now shows it bold and divided on hover, including the pre-existing diverging/dot case, with no
  spec change required. This changes on-screen hover cards for existing charts; it does **not**
  change any exported/published image — tooltips are hover-only, never appear in the PNG export,
  and no golden fixture contains tooltip HTML. Also fixed: the Total row's plain-text form (no dot)
  now gets an empty swatch spacer, so its label indents to match every series row's label instead
  of sitting flush left.
- `overlays` — lines drawn over the data marks on a numeric- or temporal-x `line`, `area`, `scatter`
  or `histogram` chart (`bar` and `stacked` cannot carry one: they require a categorical x, and a
  categorical axis has no position between categories to land a line on). Four kinds, one per
  entry: `method` (`lm` / `poly`, a bivariate least-squares fit of the plotted data, optionally with a
  `ci` ribbon), `fun` (an equation in x with named `params`), `slope`+`intercept` (a stated line), and
  `column` (a fit computed upstream). `by: series` (default) fits per colour series; `by: none` pools.
  `domain: axis` spans the frame. Keyed in-frame with `label` or in the legend with `legend: true`.

  Three conventions worth knowing. **`style` defaults by kind** — `method` and `column` solid, `fun` and
  `slope`+`intercept` dashed — because a line computed from the data and one asserted over it are
  different claims. **`fun`'s grammar follows R**: `^` is right-associative and binds tighter than unary
  minus, so `-2^2` is `-4`; expressions are parsed and name-checked at validation time, so a typo fails
  the build. And **only `column` affects the value axis** — it is real per-row data, like
  `confidence_bands`' bounds; the constructed kinds are clipped at the frame instead.

  On a **histogram**, `fun` and `slope`+`intercept` only — histogram rows carry bin edges rather than a
  per-row x, so `method` and `column` are validation errors there rather than lines that silently fail
  to draw. `fun: "dnorm(…)"` over `histogram.normalize: density` is the density-curve case.

  Not implemented: `loess`/`lowess` (precompute one and use `column`), and multi-predictor fits (the
  engine is bivariate by design — bring coefficients in through `fun` + `params`).

  **A pooled (`by: none`) `column` is NOT validated for consistency across series.** It draws a
  sawtooth when the column varies by series, and that hazard is documented under `overlays[].by`
  rather than rejected. Such a check has to know which rows are *drawn*, and `domain`, `facet`,
  `series_order` and `small_multiples.pane_order` each narrow that set inside the renderer — which
  `src/spec` may not call. Re-deriving it from the raw table produced false rejections of figures
  that render correctly, and a false rejection breaks an already-published figure on the next repin,
  where a sawtooth is self-evident on the author's own screen.

  **A `legend: true` overlay must hold enough values to resolve a line.** `method` and `column`
  entries are dropped by the renderer when the data cannot feed them (a fit with fewer numeric values
  than `degree + 1`, a column with fewer than two), but the legend row was built from the spec alone
  and survived the line's absence — so a one-point `lm` keyed a line that was not on the chart. Now a
  validation error. A per-series entry needs only ONE drawable series, since the row keys the
  concept rather than each line. The check counts cells and deliberately does not require ADJACENT
  ones: a blank is a break, so a column whose blanks isolate every value paints dots rather than a
  segment and keeps its row. Requiring adjacency is unsound for the same reason the pooled guard
  above was withdrawn — dropping a row can delete the break between two runs and join them, so
  `series_order` or a facet partition can make a raw table with no two adjacent cells draw a real
  line.

  `overlays[].tooltip` (default `false`) opts a single overlay into the hover tooltip, reporting its
  value at the hovered x as a row of its own — behind a separator, so the observed series and their
  Total stay one block, and carrying a line swatch in the overlay's own colour and dash so a modelled
  value is not mistaken for an observed one. Honoured on `line` and `area` on a continuous axis
  (standalone; in small-multiples panes only with `coordinated_cursor: false`, or on a single-pane
  figure — the default coordinated cursor replaces a pane's card with the in-place guide/dot/pill,
  and there is then no card for the row to land in) and on `scatter`; **silently ignored on `histogram`**,
  whose hover resolves a bin range rather than a single x. A `by: series` fit adds one row per series,
  which is uncapped — worth thinking about before setting it on a many-series chart.

### Added — customisation without forking the renderer (#30)
- `chrome.tooltip` and `chrome.valuePills` — spec-level switches that turn hover chrome off from
  `chart.yaml` itself rather than from a stylesheet the PNG export never sees. Deliberately just
  these two: the net marker and the legend already have an owning field (`barStack.netDisplay:
  none`, top-level `legend: false`), so `chrome` doesn't duplicate either decision.
- `hooks` — five programmatic render hooks (`tickLabel`, `valueLabel`, `legendKey`, `afterRender`,
  `tooltip`), passed to `mountChart`/`renderChart`/`renderFigure` for a consumer embedding the
  engine directly. Not spec keys: the publishing pipeline JSON-serialises `chart.yaml` + rows into
  a standalone HTML bundle for headless Chromium, and a function cannot cross that boundary. The
  first four are guaranteed to fire identically on screen and in the PNG export, since the export
  re-renders through the same builders with the same hooks object — `test/hooks-export-parity.test.ts`
  gates all four together, not just individually. `tooltip` is the one exception twice over:
  screen-only, since a static PNG has no hover state for its content to match, **and** reachable
  only where a floating hover card is actually drawn — which at default settings is far fewer chart
  types than forward it (never a plain/grouped bar or a waterfall in any configuration, and not a
  coordinated small-multiples pane). CONFIG-SPEC.md carries the reach table;
  `test/hover-card-reach.test.ts` gates it at defaults. `legendKey`'s `ctx.medium`
  (`"html"` live, `"svg"` exported) must be honored by the returned markup — an HTML fragment
  returned into the SVG export lands in the XHTML namespace and silently fails to rasterise, correct
  on screen and missing from the download. Every hook returns `null` for "engine default"; `hooks: {}`
  renders byte-identically to no hooks at all. See CONFIG-SPEC.md's new Customisation section.
- `onHover`, `onRender`, `onLegendSelect` — mount-time callbacks, each also dispatched as a bubbling
  `CustomEvent` of the same name from the chart's card root so a published standalone figure's host
  page can observe it without any callback wiring. `onHover` reaches only `attachBandCrosshair`
  (categorical bar/stacked, standalone and faceted) — silence from other chart types means "this
  chart type doesn't report hovers," not "nothing happened." `onRender`'s `"mount"` phase fires one
  microtask after `mountChart()` returns (its `"resize"`/`"reselect"`/`"restack"` phases fire
  synchronously) — a consumer writing a synchronous test against mount will be surprised.
- `MountOptions.tooltipContainer` reparents the floating tooltip card away from `document.body`, for
  a consumer scoping it to one figure.
- Seven new classes on previously-unaddressable hover chrome (`tbl-coord-pill`,
  `tbl-coord-pill-text`, `tbl-coord-axis-label`, `tbl-coord-axis-label-text`, `tbl-coord-region`,
  `tbl-coord-guide`, `tbl-coord-dot`), so a consumer stylesheet can target them without depending on
  presentation attributes like `rx="3"`.
- **Not shipped, deliberately:** CONFIG-SPEC.md does not publish a stable-hooks list, and a stable
  hook's retirement or rename is not required to be called out under an Upgrading heading — a
  scope decision ("classes only, no policy"), not an oversight, so a future rework can still break a
  consumer silently the way `.tbl-legend-swatch.is-dot`'s retirement did in 1.11.0.

### Changed
- **`chartType: bar` and `chartType: stacked` now require `xAxisType: categorical`.** Numeric,
  temporal and quarterly are validation errors, in both orientations. Bars are drawn on a band
  scale, and only the categorical x adapter builds that band domain from the data's x values. The
  rule is deliberately **stricter than the defect** — one shape on a numeric axis renders correctly
  and is refused anyway — so, precisely:
  - **Numeric, vertical:** the numeric adapter emits `domain: [xMin, xMax]` and the vertical bar
    path does not replace it, so a bar mark reads that two-element continuous domain as a band
    domain of exactly two categories — **the endpoints**. A row is drawn only if its x *is* an
    endpoint. Measured (rects drawn / tick labels): 2 rows → **2 of 2**, `1`,`2`; 3 rows → 2 of 3,
    `1`,`3`; 5 rows → 2 of 5, `1`,`5`. So a **two-row** chart is complete and correct, and every
    other shape silently loses the rows in between. The two-row case is refused anyway: it is
    correct by coincidence of that derivation, the exception would really be "numeric **and**
    vertical **and** exactly two distinct x values", and `validateSpec` reads the spec and not the
    data — narrowing it would make a figure's validity depend on today's row count, so a working
    two-row chart would start failing the day its data grew a third row.
  - **Horizontal:** **no bars at all**, on any continuous axis at any row count — its band domain is
    built from string categories a continuous adapter never produces, so the mark is dropped whole.
  - **Temporal / quarterly, vertical:** drew **every** bar; nothing is dropped. The defect is chrome
    — a second x-axis stacked over the engine's, the internal field name `_xd` leaked as the x-axis
    label, and Plot's warning glyph painted into the SVG, which the PNG export re-renders into a
    published figure.

  Every one of those validated `valid: true` before this release. The renderer is deliberately
  **not** changed here: making a continuous-x bar chart genuinely work is a feature with
  axis-ordering, hover and export surface, and this refusal is what makes it a safe additive change
  later. `histogram` is unaffected — it is a separate chart type that bins a continuous axis by
  design — and so are `line`/`area` on a categorical axis.
- **`overlays` are no longer available on `bar` or `stacked` in any orientation.** Unreleased
  feature, narrowed before it shipped: overlays require a non-categorical x, bar/stacked now require
  a categorical one. The horizontal-orientation rejection added earlier in this release is kept as
  the reporting site for the horizontal case, because it names the more specific reason. What this
  removes was measured, on five rows, to render a fitted line over a chart drawing 2 of those 5 bars.
- **Value pills now default to off where segment value labels are painted for every segment.** A
  stacked chart with `valueLabels.show` printed its numbers in the segments and then repeated them in
  hover pills a few pixels away. The default is keyed on the labels being *painted*, not on the flag
  being set — `valueLabels.show` is a request that four cases refuse, and suppressing pills wherever
  the flag appeared would have removed them from charts printing no numbers at all: a diverging
  net-dot stack and every small-multiples pane paint no segment labels; a waterfall's labels are the
  running *level* while its hover pill is the signed *delta*, so nothing is duplicated there; and a
  segment thinner than the 25px fit threshold is skipped individually, so a chart whose labels do not
  cover **every** segment keeps its pills for the whole chart. That last refusal is per-segment and
  frame-size dependent, and the label builder reports which it skipped rather than the pill rule
  re-deriving the threshold. An explicit `chrome.valuePills: true` still wins, so asking for both
  remains possible.
- **`CONFIG-SPEC.md`'s "Axis constraints" list was missing `waterfall`.** The code has enforced
  `waterfall` = categorical x + vertical only since it shipped; the list named only four of the
  five constraints. Documentation only — no behaviour changed. An under-documented constraint is
  the same defect class as an over-claimed one.
- **`valueLabels.show` is not "stacked bars only".** A waterfall paints segment labels for the same
  flag. `CONFIG-SPEC.md` claimed otherwise; the claim was false before this release and is now
  corrected and test-backed. No behaviour changed — only the documentation of behaviour that already
  existed.
- `barStack.netDisplay` now chooses the net callout only. Defaults are unchanged: a spec that does not
  set `barStack.hover` renders exactly as before.
- `RenderResult`, `FigurePane` and `FigureRenderResult` rename their `showTotalDot` field to
  `netMode` — breaking for any consumer that reads it off a returned object (see below).
- `onHover`/`onRender`/`onLegendSelect` dispatch their `CustomEvent` unconditionally on every mount,
  whether or not a host callback is passed — a real runtime behaviour change on every categorical-
  chart hover for an existing embedder, even one that never adopts the new callbacks.

### Fixed
- **An identity-less `overlays` line no longer dims when a legend row is selected on a chart that also
  carries a keyed or per-series one.** Whether an overlay's paths get a `data-series` was decided once
  for the whole list, from flags any entry could set — so on a mixed list a pooled `by: none` fit, a
  `fun`, or a bare `slope`/`intercept` line was tagged with the inert single-series key (`""`), which
  the legend's dim walk matches by attribute *presence* and no selection can ever satisfy. Picking any
  series dropped an unrelated reference line and its confidence ribbon back to 15 % opacity. The same
  overlay was correct **alone** (the gate stayed shut), which is how it survived. The decision is now
  per overlay: a keyed or per-series entry keeps its tag and still dims with its own row, an
  identity-less one carries no attribute either way, and a ribbon is built from its own line's key so
  it still behaves exactly as that line does. New in 1.12.0, so no published figure is affected.
- **`CONFIG-SPEC.md` over-claimed the reach of legend dimming.** "Hovering a row … dims everything
  else" read as covering every drawn thing; the selection universe is keyed rows plus series, so
  chrome in neither — an unkeyed reference line, an overlay that is neither keyed nor per-series —
  stays at full strength. That was already true of unkeyed reference lines before this release, and
  is now stated and test-backed. Documentation only; no behaviour changed.
- **A negative or zero standard deviation in `dnorm`/`normalden` now breaks the overlay line instead
  of drawing an invalid curve.** `fun: "dnorm(x, 0, -1)"` validated and drew: a negative `sd` divides
  through by a negative normaliser and returns the correct density with its sign flipped (measured:
  `dnorm(0.5, 0, -1)` = `-0.352…`), so the renderer painted a smooth **inverted** density curve
  hanging below the axis. `dnorm` is the documented density-curve case, over
  `histogram.normalize: density`, so a typed minus sign produced a plausible-looking wrong published
  figure rather than an error. `sd <= 0` now evaluates to `NaN`, which is this evaluator's
  established convention for an unrepresentable value and breaks the line at that sample. Also
  found by auditing the whole function table rather than only the reported function: **`log(x, base)`
  with a base of `0`** evaluated to `-0` — finite, so an undefined logarithm drew a flat line along
  zero — and now returns `NaN` too, as do bases `1` and negative (those two were already `Infinity`
  and `NaN`, so nothing drawn changes for them). Every other domain edge in the evaluator (`sqrt` of
  a negative, `log`/`ln`/`log10`/`log2` of a non-positive, division by zero) was already non-finite
  and needed no guard; those are now pinned by test so a later tidy-up cannot make one finite.
  New in 1.12.0 — no published figure is affected, and no golden moved.

### Changed — internal
- `MarkLayers.showTotalDot` (a tri-state boolean read for four different purposes) is replaced by
  `MarkLayers.netMode`; the tooltip's Total row, the hover treatment and the highlight pills' net-dot
  flag are now derived from it by resolver functions in `src/spec/bar-stack.ts`, read at their call
  sites in `src/engine/render-live.ts`, `src/engine/crosshair.ts` and `src/engine/marks/stacked.ts`.
  Consumers reading `showTotalDot` off a `renderChart` / `renderFigure` result should read `netMode`
  instead.
- **Every CONFIG-SPEC.md claim of the form "X reaches the hover tooltip" is narrowed to what the
  code does, and gated.** A floating hover card is rarer than the doc assumed: a coordinated
  small-multiples pane draws none (the in-place cursor replaces it), and a plain/grouped bar or a
  waterfall draws none in *any* configuration. Claims corrected: `hooks.tooltip`'s reach,
  `x_labels`, `tooltip_x_format`, the stacked-area `Total` row, the three `series_patterns` texture
  sentences, `small_multiples.coordinated_cursor`'s single-pane parenthetical, `chrome.tooltip`'s
  scope, `tbl-coord-axis-label`'s conditions, and the `tooltip_decimals` / `histogram.bin_label`
  wording. **No rendered output changes** — these were doc defects, not behaviour changes.
  `test/hover-card-reach.test.ts` and `test/hover-claims-defaults.test.ts` gate them by mounting
  every chart type at DEFAULT settings, standalone and two-pane; the earlier claims had each been
  "verified" by a test that first turned a default off.
- **Two of those claims were gaps, and are now fixed rather than narrowed** (hover-only: no
  exported image changes, and no golden moves). `tooltip_x_format` is honoured by a faceted
  figure's coordinated cursor, which drew its x echo with a hardcoded `%b` / `%Y` while being
  handed the author's formatter and ignoring it. On a **daily** multi-pane line that echo was
  missing altogether — it could only annotate an existing x-axis tick and a sub-month span draws
  none — so with the field set it is now anchored below the plot instead of skipped. Where the pane
  DOES tick, the echo stays on the tick rows and hides the tick labels its pill covers for as long
  as it shows: the pill is sized from the author's format, not from the tick, so `Jun 1, 2026` over
  a `Jun`/`Jul` axis was reaching across its neighbour and leaving a fragment of it (`Apr` read as
  `pr`) sticking out past the pill's edge. Absent the
  field nothing moves: the echo keeps its two-line, axis-matching form, which is why the fix reads
  an explicit-format flag rather than the formatter alone. And `x_labels` now heads the
  `dumbbell` / `dotplot` / categorical-x `line` hover card, which shared the band card's builder
  but was never handed `categoryLabels`. One limit stays, and is documented rather than promised
  away: a coordinated pane's category echo keeps the raw category, because it overlays the rendered
  axis tick and `x_labels` exists to read more verbosely than that tick.
- **Three hover-only fixes, and the `tbl-coord-pill` claim narrowed to match.** A waterfall whose data
  carries a `series` column (single-valued, which validates) drew **no value pill at all**: its bars
  are stamped `SINGLE_SERIES_KEY` while its hover rows carried the column's value, so every pill
  lookup missed. Fixed on the hover side rather than at the stamp, because `data-series` is in the
  rendered SVG and drives series-keyed paint. And a single-series card row read
  `": 5.00"` — a colon labelling nothing, since a chart with no series column has one implicit
  series keyed `""`; that row now carries the value alone (`series_labels: {"": "…"}` still labels
  it). Every card builder shares one row helper now, so this covers all of the types whose card rows
  are series-keyed: histogram, categorical-x `line`, `dotplot`, temporal `line`, `area`, `dumbbell`,
  and `stacked` where a card is drawn. (`scatter` is unaffected — its rows are the axis titles, not
  series names.) No invented word instead: what the value means is whatever the value axis measures,
  so no label is honest across figures, and the swatch already identifies the mark.
  Third: a stacked **area** card stated a `Total` of a single series — `4.00` and then
  `Total: 4.00`. That row is the sum of the rows above it, so it is now gated on the card having
  drawn more than one series row at the hovered x, which is the rule the band card builder already
  applied (`orderedSeries.length > 1`). It also drops at an x where only one series has a value.
  All are hover-only: no published image changes and no golden moved. The `tbl-coord-pill`
  documentation said pills are drawn on every coordinated-cursor type but dumbbell, which
  over-claimed the waterfall — they are **delta-step-only** there.

### Upgrading

A repin re-renders every published figure at once — here is what a maintainer will see change:

- **`showTotalDot` → `netMode`.** `RenderResult`, `FigurePane` and `FigureRenderResult` no
  longer carry `showTotalDot`; read `netMode` instead.
- **Every existing stacked chart with a Total row now renders it bold, with a divider, on hover.**
  `barStack.total.bold`/`.divider` default to `true`. No exported/published image changes —
  tooltips are hover-only and appear in no golden fixture — but the on-screen hover card itself
  looks different for every such chart starting now, with no spec change on anyone's part.
- **A stacked chart's Total row, in its plain-text (no-dot) form, now gets an empty swatch
  spacer** so its label indents to match every series row's label instead of sitting flush left —
  a small but visible change to every already-published stacked chart's hover card. Hover-only, no
  exported/published image changes.
- **`tbl-hover`/`tbl-render`/`tbl-legend-select` now dispatch on every mount, whether or not a
  callback is passed.** An existing embedder's categorical (bar/stacked) charts now dispatch a
  `tbl-hover` CustomEvent per pointermove regardless of whether anything listens — harmless on
  its own, but new work on a hot path, and a host page listening for an unrelated bubbling event of
  the same name will now see these.
- **A published stacked chart with `valueLabels.show` loses its hover value pills — unless some
  segment is too thin to print its number.** The numbers are already in the segments, so the pills
  were repeating them; this is the intended change, but it lands on every such chart at repin with no
  spec change on anyone's part. A chart with any segment under the 25px fit threshold keeps its pills
  instead, since those segments have no printed number to repeat. Hover-only — no exported/published
  image changes, and no golden fixture moved. Set `chrome.valuePills: true` explicitly on a chart
  that should keep both.
- **A bar or stacked chart on a numeric, temporal or quarterly x-axis is now refused at
  validation.** This is a new refusal on a schema released without it, so it is called out even
  though **no known spec is affected**. That was established by parsing, not grepping: every
  authored `.yaml`/`.json` spec (179), the YAML front matter of every interactives `config.md`
  (80 — a format a `*.yaml`-only search misses entirely), and every spec instance recovered from
  built and published output by brace-balanced JSON decoding (236). Every bar/stacked spec found —
  66 in authored YAML/JSON, 8 in `config.md` front matter, 74 instances in built output — declares
  `xAxisType: categorical`, and `xAxisType` is a *required*
  property, so there is no "absent, defaults to something else" case. A proximity-based first pass
  did report seven bar+temporal hits in the state-of-tariffs manifests; structural re-parsing of
  those exact files showed all seven were bar figures whose nearest `xAxisType` in the text
  belonged to a neighbouring `line` figure. If a spec does trip this, the fix is either
  `xAxisType: categorical` (with `x_order` to fix the tick order) or `chartType: line`. What it was
  drawing before depends on the axis: on a numeric x, every row past the first and last was missing
  (or, horizontally, every bar); on a temporal or quarterly x, all the bars were there but the figure
  carried a doubled x-axis and a warning glyph. The one case that was genuinely correct — a two-row
  numeric vertical chart — is refused too, on purpose; see the Changed entry above.
- **`CONFIG-SPEC.md` changed.** `budget-lab-charts` vendors it verbatim and gates CI on it being
  current — re-run its vendoring step at repin.

## [1.11.0] - 2026-08-17

### Added — a second fill channel, whitespace between stacked segments, and a tooltip x-format

Three keys, all opt-in and all with zero effect on an existing figure, so a repin does not move
published output. Each closes a gap where a consumer could style the on-page chart with CSS but
could not reach the PNG export, which re-renders from the spec rather than serialising the DOM.

- **`series_patterns`** gives a series a hatch texture alongside its colour, on the chart types with
  filled marks (`bar`, `stacked`, `area`, `histogram`, `waterfall`). The six values are
  matplotlib's hatch characters (`"/"` `"\\"` `"|"` `"-"` `"+"` `"x"`), so the character is a
  picture of the result. The colour the mark is actually PAINTED stays the pattern's ground — which
  is the series colour until `bar_color`, `category_colors` or the title-selector accent overrides
  it, and then it is that — and the hatch BAND colour is derived rather than authored — three tonal tiers along the ground's own hue ramp (lighter
  instead when the ground is too dark to darken), so a pair can never leave the Style-Guide ramp.
  A CI gate holds the pair between 20 and 33 ΔL* across all 72 hue-family palette colours (measured
  today: 21.6 at `red-50`, 32.5 at `sky`). The geometry is
  deliberately coarse (16px period, 7px band; 4px for the crossed characters, which overlap their
  own ink) so the pair reads as two colours banded together rather than pinstripes over a colour.
  The texture reaches the marks, the legend key, the hover tooltip and the export. A key draws ONE centred
  instance of the texture as a glyph rather than a patch of the tiling — at 14px a tiling shows an
  edge with no direction in it — so `"/"` reads as three bands, `"+"` as a plus, `"x"` as an x. A
  rasterising test measures all six from their pixels. An unrecognised
  value is rejected at load rather than rendered flat — including density repeats (`"//"`), which
  are deliberately unsupported: more ink per unit area reads as a darker shade, which the tonal
  scale already controls precisely.
- **`barStack.segmentGap`** opens whitespace between adjacent stacked segments, so two slices from
  one hue family stop reading as a single block. Subtractive geometry rather than a
  background-coloured stroke: a segment thinner than the gap is floored to a hairline instead of
  being painted over, no gap appears at the bar's outer ends, and the net marker stays at the true
  net. Honoured in both orientations, on normalized stacks, in panes, and in the export.
- **A series' key is one drawing, wherever it appears.** The legend, the three tooltip paths and the
  PNG export each built their keys separately, from a different subset of the channels and with
  eleven different icon boxes between them — a tooltip's plain square was 11px beside a hatched one
  at 14px, and adding a channel meant threading it into six places. So a hatched area series showed
  a textured chip in its legend and a plain line in its tooltip; a lone dot plot keyed a line and a
  lone dumbbell a plain disc, neither of which is the marker the chart draws; a line chart's markers
  reached the legend and not the tooltip; and in a downloaded PNG a diverging stack's Total came out
  as a navy bar rather than the net dot, a hollow dumbbell end came out filled, and every bar and
  area key was distinctly rounder than on screen. All of it is now drawn by one module: one box, one
  geometry, all SVG (which retires the CSS gradient that had to mirror the SVG dash by hand, and its
  angle conversion with it). A test renders twelve charts spanning seven chart types and asserts, for
  each, that the key carries the same ink as the mark it names — in the legend, in the tooltip and in
  the export. A second block covers the charts that draw no legend at all: a lone series on each of
  the nine chart types, checked for the right key SHAPE, plus a mounted, hovered, textured histogram
  whose tooltip key must carry the same `<pattern>` id as the bin under the cursor.
- **A marker symbol is sized and centred from measurements, not by hand.** Three separate faults, all
  from geometry written out by eye. The sizes were areas already solved for one target, and three of
  the seven were simply wrong (a triangle reached 5.58 of a 7 half-box). d3 sizes a symbol by AREA, so
  equal size is equal ink — but equal ink makes the compact shapes read small, and equal SPAN makes
  the spread ones read light, and there is no published cross-shape rule to take: matplotlib has
  carried this as an open issue since 2019 and concluded the factors must be hand-tuned. So a key is
  drawn at the size the CHART draws its marker (which is now one shared constant, not a literal in
  each mark builder — a key was 9 % smaller than the scatter dot beside it), spread around that anchor
  by ONE hand-judged exponent over the measured shape constants, and clamped so the box never cuts it.
  And each symbol is shifted onto its own bounding-box centre, because d3 places a symbol by its
  CENTROID: a triangle sat 1.75px high in a 14px box, visibly out of line with its own label.
- **`hollow` now means hollow, in the chart as well as the key.** A dumbbell's hollow dot was an
  opaque white disc — so it hid the connector stem its own code comment said showed through, and read
  as a filled white dot on any ground that is not white. Its middle is empty now, and the marker INK
  (what fills a middle, what outlines it) is described once and read by the dumbbell marks, the
  stacked net marker and the icons alike. That distinction matters in both directions: the stacked
  net marker's white centre is deliberate, because it sits on its stack and must occlude it, and
  keying it as a hole was a regression this shared description exists to prevent.
- **An `area` series is keyed by a square chip, not a line swatch.** An area mark is a filled
  region, so the line swatch misrepresented it, and at 3px tall it could not hold a hatch glyph —
  a textured area series had no way to show its texture in the key. Every filled chart type now
  keys with a chip; only stroked marks keep the line swatch, and a test ties the two sets together.
- **Tonal tiers and `sky` are now named colours.** `blue-200`, `violet-700`, `purple-600` and the
  rest of the 8-tier ramps resolve anywhere a colour is accepted, as do the aliases' tiers and the
  brand `sky`. Previously only the 7 hues, their `-light` variants and three neutrals had names, so
  relating two series within one hue family — the case a texture is usually paired with — meant
  pasting a hex that said nothing about which ramp or which step it was. A raw `"#hex"` (or any CSS
  colour) is unaffected — but an unrecognised NAME is now rejected rather than passed through; see
  the next entry, which is what the new tier names made urgent.
- **A colour the engine cannot paint is rejected at load.** It never was cosmetic: an unresolvable
  name reached Plot as a constant fill, Plot read a string it could not parse as a *column name*, and
  the marks it coloured were dropped — so `bar_color: "blue-450"` published a chart frame with no
  bars in it while `validateSpec` returned `valid: true`. The 8-tier names make that a likely typo
  rather than an exotic one (`blue-800`, `blue-250` and `sky-300` all look like names and none
  exist). Every colour-valued field is checked — `series_colors`, `bar_color`, `category_colors`,
  annotation and band and callout colours, `shading`, `rug.tracks`, title-selector options, the
  waterfall colours and connector, `connector.color` — and the error names the field, the value and
  the near miss (`"blue" ships tiers 50 100 200 300 400 500 600 700`). `barStack.mono.base` gets its
  own rule: it names a HUE whose tonal scale the stack pulls, so a hex there (which used to throw
  mid-render) fails at load instead.
- **A chart with no series column can now be named.** Its one implicit series is keyed `""`, which
  no data cell spells out, so the cross-reference check rejected every key naming it — including the
  `series_colors: {"": color}` idiom this file documents as working, and any hatch on a
  single-series bar, histogram or waterfall.
- **A series keeps its colour in every pane of a small-multiples figure.** Colours are assigned by
  POSITION, and each pane resolved its own series list from its own rows — so a pane MISSING a
  series shifted every later series one slot down the palette and painted it a colour the figure
  legend, and the pane beside it, contradicted (measured: a pane lacking the first of two series
  painted the second one `#0072B2` while the legend said `#E69F00`). A pane's colour now comes from
  the series' position in the FIGURE's series list, resolved once over every pane's rows. The same
  list keys the legend, so a series the FIRST pane happens to lack — which previously had no legend
  row at all — is keyed too. Both modes.
- **A texture's key is grounded in the fill the mark is PAINTED, in the legend too.** The chart, the
  tooltip and the export already were; the legend resolved its own hatch from the series colour map,
  and the four were said to agree because `bar_color`/`category_colors` are single-series (so those
  charts draw no legend rows) and the selector accent is folded into that map. `highlightSeries` is
  neither: on a multi-series bar or histogram it dims every non-highlighted series to `#BBBBBB`
  through a per-mark fill the colour map never sees, so a dimmed textured series was already keyed
  over its palette colour while its bars were drawn grey. The chart now hands the resolved texture to
  the other three surfaces instead of each deriving one, so there is no second derivation left to
  drift. A figure's single legend takes the texture a PANE painted (see the colour fix above, which
  is what makes every pane's ground the same). A declared texture that reaches no mark is now a load
  error rather than a key for a texture that is not there — which is what an unreadable colour
  produces, since Plot drops the whole mark and draws an empty frame.
- **`tooltip_x_format`** overrides the crosshair tooltip's x label on a `temporal` or `quarterly`
  axis (a d3 `timeFormat` pattern). The default matches the axis ticks, which is right for
  month-spaced data and wrong for a daily series, where every point in a month otherwise shares one
  tooltip label. Opt-in rather than a granularity auto-detect, so no published temporal figure
  changes.

- **A colour the engine can paint but cannot READ is refused when it carries a texture.** Plot paints
  `oklch(…)`, `lab(…)`, `color-mix(…)`, `var(…)` and `currentColor`; deriving a hatch band means parsing
  the ground to walk its tonal ramp, which d3 cannot do for any of them, and the space-separated
  function forms (`rgb(0 114 178)`) fail where the comma forms parse. That combination validated clean
  and then threw at render, so it is a load-time error now. A test derives the admitted set from the
  real pipeline rather than restating it, so upgrading d3 cannot quietly reopen the gap.

### Upgrading

The three new spec keys are opt-in and change nothing that does not use them. The colour check is
not: a spec carrying a colour the engine cannot paint **stops validating**. Every such spec was
already rendering the affected marks as nothing (or, for a `barStack.mono.base` hex, throwing), so
this converts a silent blank into a load error — but it is a new refusal on a released schema, and
an empty string in a colour field (`color: ""`) is refused too.

The small-multiples colour fix is likewise not opt-in, but it can only move a figure whose panes do
not all resolve the same series in the same order — a pane missing a series, or panes whose rows
introduce the series in a different order. Every such figure was painting a series two different
colours across its own panes, so what moves is the pane that disagreed with the legend.

The painted-fill fixes move one thing a reader sees, on a figure using `highlightSeries`: a dimmed
series' legend, tooltip and export key now show the grey its bars are drawn in rather than its palette
colour — textured or not, since a chip's colour comes from the render now for the same reason its
texture's ground does. `bar_color`, `category_colors`, a `barStack.mono` tier and the title-selector
accent are the same class of override, and all of them now key what was painted. Everything else keys
exactly as before, because every other fill already reached the colour map. No published figure uses
any of those channels except `category_colors`, whose three figures are single-series and so draw no
legend rows.

The icon work is likewise not opt-in, so **a repin re-renders every published figure's legend and
tooltip keys**, and two of those changes reach the SVG a reader sees:

- **Every legend, tooltip and PNG-export key is redrawn** — one 14px box, marker symbols sized and
  centred from measurements, hollow middles genuinely empty. Nothing here changes a MARK, so the plot
  itself is untouched; but a figure's keys will not be byte-identical, and a downloaded PNG's keys
  change more than the on-screen ones did (they were the copy that had drifted furthest).
- **A `dumbbell` with `series_marker: hollow` changes its dots**: the middle is a hole rather than an
  opaque white disc, so the connector stem now shows through it. This is the only change to a mark.
  Figures on a white ground look near-identical; on any other ground the dot no longer reads as a
  white blob. Both dumbbell goldens moved, on those two attributes only.

Two more changes are **hover-time only** — they live in the tooltip's HTML, not in the SVG — so no
golden moved and the markup comparison below cannot see them. A reader can:

- **A textured tooltip key is grounded in the colour the mark under the cursor is actually painted**,
  not in the series' palette entry. The two disagree wherever the fill did not come from
  `series_colors`: a `barStack.mono` stack, whose segments are tonal tiers of one ramp, and any bar
  taking its fill from `bar_color` or `category_colors`. The key's ground — and therefore its derived
  band — now moves with the segment being hovered, so the swatch matches the thing it is naming
  instead of showing the family's base colour with a texture over it.
- **A chart with ONE series keys its tooltip from the row the legend would have drawn.** A single
  unstyled series draws no legend row on any chart type (a lone *dashed* line is the exception — a
  dash is a channel worth keying, so it gets rows), and the charts with no rows used to key from a
  separate set of loose channels that had drifted from the legend's own rules. So a single-series
  **dot plot**'s tooltip key changes from a line to its circular marker, and a single-series
  **dumbbell**'s from a box-filling disc to that same marker, sized and centred the way every other
  key is. In both cases it becomes what the multi-series version of the chart already drew.

Nothing else in the plot frame moves: the snapshot self-test is pixel-identical, and the only golden
diffs in the suite are the two dumbbell fixtures. (A third golden file also appears in the diff,
`stack-textured-gapped`, but it is an addition rather than a change — a new fixture covering the two
new keys together.)

Measured against the archive rather than argued: all **41 figures published at the time of release**
were rendered with 1.10.0 and with this version and compared in a browser. All 41 validate, none fail
to render, and **the plot markup is byte-identical on all 41** — no mark moves. That and the dumbbell
change above are consistent because **none of the 41 is a dumbbell**; a published dumbbell would have
moved, and will move on the repin that first carries one. 29 legends are
redrawn. Three figures with a point-chart legend end up 1–4 px shorter, because that legend's swatch
was its own 18×16 box and is now the shared 14×14 one; if you embed by a fixed height, those three are
the ones to look at.

That comparison is on the rendered MARKUP, deliberately. Screenshot comparison is not trustworthy at
this scale: rendering the same page twice in the same browser differs by a few hundred to a few
thousand pixels, on a varying subset of figures, from layout and antialiasing timing alone. A control
run — 1.10.0 against itself — is the only way to tell a real change from that noise, and it is what
the markup comparison was checked against.

## [1.10.0] - 2026-08-10

### Added — publishable shared assets, so a site stops shipping the engine per figure

A rendered page inlined the runtime, the CSS, and the font: ~1.65 MB, of which only the spec and
data differed from any other page. An archive of 41 figures therefore published ~67 MB of identical
bytes, and a reader opening an article with 7 embedded figures downloaded the engine 7 times
(~3.3 MB, since each figure is its own iframe and shares no cache with its neighbours).

- **`tbl-chart assets -o <dir>`** writes the two shared files for this engine version:
  `engine-<version>.js` and `chart-<version>.css`. `--json` prints the manifest for a build script.
- **`tbl-chart render --assets-base <relative-url>`** emits a page that links those instead of
  inlining them: ~29 KB instead of ~1.65 MB (~3.9 KB vs ~464 KB gzipped). Rendering is
  pixel-identical to the inlined form — verified by screenshot comparison, 0 differing pixels.
  Omit the flag and the output is self-contained exactly as before.
- **An absolute `--assets-base` is rejected.** Pages must reference assets relatively or they break
  when opened from `file://` (how thumbnail screenshotters load them) and under a path prefix like
  `/pr-preview/pr-42/`.
- **A fallback when the shared runtime does not arrive.** A separate request can fail where an
  inlined bundle could not, so a shared-asset page checks for the runtime and, if it is absent,
  names the figure and asks the reader to reload, with a contact address, instead of leaving a blank
  rectangle mid-article. Built with DOM calls and inline styles, since the stylesheet is a separate request
  and may be equally absent. Self-contained pages don't emit it — they cannot lose their runtime.

### Changed

- **`dist/embed/live.js` is minified**: 1,523,766 → 980,426 bytes (403,852 → 344,714 gzipped). It is
  the only output that reaches a browser; library entries stay readable, and all outputs keep their
  external sourcemaps.
- **The font is no longer duplicated within a page.** It was inlined twice — once in the page CSS
  and once inside the bundle for PNG export — which was 84 KB gzipped of every page. In shared mode
  it rides once in the stylesheet. It stays a base64 `@font-face` rather than a separate file
  because fonts are fetched in CORS mode and a `file://` page has a null origin, so a font file is
  blocked there and text would silently fall back to a system face.

### Upgrading

No action required: `render` without `--assets-base` behaves exactly as in 1.9.0. Consumers moving
to shared assets must publish `tbl-chart assets` output alongside their pages and keep prior
versions published until no page references them.

## [1.9.0] - 2026-08-04

### Added — annotation legend entries, and an x-axis rug

Both come out of the recession-indicators michez-rule chart, and both are about getting names and
thin intervals out of a crowded plot frame.

- **`legend: true` on `annotations.bands` / `xAxis` / `yAxis` and on `shading`.** The engine's legend
  was series-only, so a chart whose subject is its annotations had to label each one *inside* the
  frame — or mint dummy CSV series to get legend rows. The flag moves the entry's `label` to a
  legend row above the plot and drops the in-chart text. Entries sharing a label collapse into one
  row, so three recession bands become one "US recessions" key. `shading` gains a `label` for this
  (a fill had no text of its own, and was previously described only in the `note` line). Rows are
  interactive in their own selection dimension and sort after the real series. A single-series chart
  now gets a legend built from these rows alone. See CONFIG-SPEC, "Keying annotations in the legend".
- **Reciprocal highlighting between a keyed row and the chart.** Hovering a row brightens every
  element it names — all its bands, fills, reference line and rug blocks — and dims the rest,
  including the data line; hovering a **rug block** does the reverse, marking its row and brightening
  that track's other parts. Either can be clicked to pin. Annotations get their own selection
  dimension (`data-annotation`) rather than borrowing `data-series`, which is what lets a keyed
  `shading` fill answer to both keys: it still dims with its own line, and it also lights up with its
  annotation row. Series and annotations share one universe for dimming, so selecting a series dims
  the annotations too. While the pointer is on the rug strip the value crosshair stands down, so the
  hover gives one answer instead of two. In-frame regions (band rects, fills) are deliberately not
  hover targets — they sit where the reader sweeps the crosshair, and hovering them would flicker the
  chart as the pointer crossed each region.
- **`rug`: a thin strip of solid interval blocks under the x-axis.** For timeline categories that are
  illegible as fills — the article's false-negative runs are 1–3 months on a 26-year axis, so as
  fills they are hairlines. Flag a band or shading region with `rug: true` and its interval joins the
  track named by its `label`, so the dates stay stated once; `rug.tracks` covers a concept with no
  band or fill of its own. Blocks are floored at 2px so a single month stays visible, clamped to the
  plot's x extent, and keyed in the legend by their solid color. The strip claims its space by
  growing `marginBottom` and shifting the tick labels down by the same amount, so every consumer
  that derives geometry from `height - marginTop - marginBottom` (the annotation stagger, callout
  connectors, the crosshair) stays correct. Not supported on a categorical x-axis or with
  `small_multiples` — both are validation errors. See CONFIG-SPEC, "X-axis rug".

**Multi-series charts with shaded areas** (found by a 16-case pressure suite):

- A `shading` region with no `series` paints one fill per series, each in that series' color, so a
  single-color chip cannot key it honestly. Such a row's chip now shows **every** tint as equal
  vertical bands (live legend and PNG export alike), **widening** so the bands stay legible — at the
  fixed 14 px, seven series gave 2 px bands. Rows merge by label rather than by color, so writing one
  region per series under a shared label collapses to that same one banded row instead of three
  identically-worded ones.
- A region naming a `series` is keyed by **that** series' color (it was keyed by the first series').
- **A rug block and its own legend chip could disagree**: a rug-flagged region with no explicit color
  keyed the series tint while the block drew the neutral, so the key pointed at a color that was
  nowhere on the strip. Both now come from one resolution — explicit `color`, else the named series'
  color, else the neutral — and a rug-flagged chip is always a single solid chip, because what it keys
  is the block.
- **`rug.rows: per-track`** gives each track its own row. The single strip is right for near-disjoint
  tracks (the michez read), but a track spanning the axis painted the tracks under it away entirely
  while they kept their legend rows. A track `single` would cover completely is now a validation error
  naming this field.
- Two keyed fills that would resolve to the **same** swatch (both derived from the series palette,
  same scope, same opacity — the natural above/below pair) are now a validation error.
- `shading[].label` with neither `legend: true` nor `rug: true` is now a validation error rather than
  a silent no-op.

Charts using neither feature render byte-identically (the goldens are unchanged).

## [1.8.1] - 2026-07-31

### Fixed — reversed value axis

`yAxisPolicy: {min: 0, max: -4}` (min > max) reverses the value axis, putting the numerically lower
value at the top — the right treatment for indices where more-negative is worse (CFNAI, output gaps).
It was never a declared feature: it worked because a descending `domain` is ordinary Plot input, and
it broke wherever engine code read the domain pair as `[lo, hi]`. Charts already relying on it were
getting silently wrong output. This release makes it work on every chart type, and documents it
(CONFIG-SPEC, "Reversing the axis").

- **`shading` baselines closed on the frame instead of their threshold.** The reported bug: with
  `{min: 0.0, max: -3.0}`, a `baseline: -0.7` clamped to `-3.0`, so every fill ran to the top of the
  frame rather than stopping at the threshold. The clamp now takes the domain's numeric bounds
  (`domainBounds`), the one place that answers "which end of this pair is the floor".
- **A reference marker destroyed a reversed domain.** Five per-type domain branches folded marker
  values in with `Math.max(policy.max, ...markerYs)`, which read -0.7 as above -4 and collapsed the
  ceiling: a bar chart with `{min: 0, max: -4}` and a marker at -0.7 painted its first bar at
  `y = -136`, `height = 514` on a 400px canvas — over the title and off the top of the SVG. Those
  five branches (plus histogram and line) now share one `resolveHardDomain`, so a fold value widens
  a domain's numeric bounds and never flips or collapses its orientation.
- **Value labels were painted inside the bars they label.** Waterfall running totals and stacked's
  net total keyed a pixel offset off a data-space sign (`rising`, `posTop`). Each now picks its side
  — and the horizontal net label its `textAnchor` — from the axis orientation.
- **The zero baseline was dropped** from reversed domains that straddle zero, and the **mark clip**
  engaged unconditionally (harmless visually, but it wrapped every reversed chart in a clip group it
  did not need). The `annotations.yAxis` label collision-avoidance pass skipped reversed axes
  entirely and now runs.
- **`autoWiden` now extends whichever end the data overflows** — on a reversed axis that is `max`,
  the numeric floor, rounded outward with `floor` rather than `ceil`.
- Honored on the types that compute their own domain: a reversed 100%-normalized stack puts 100 at
  the bottom, a reversed histogram hangs its bins from the ceiling. Reversal applies to the value
  axis wherever it lives — `y` vertically, `x` horizontally, where `min` is the LEFT edge (so
  reversing puts the lower value at the right and negative bars grow left-to-right).

Ascending output is unchanged and byte-identical — the golden snapshots are the check, and
`resolveHardDomain` preserves the pre-existing floor/ceiling asymmetry (a fold value can widen a
pinned ceiling; a pinned floor is authoritative) exactly.

## [1.8.0] - 2026-07-30

### Added — shading baseline

- **`shading[].baseline`** (default `0`) sets the level a fill runs to and what `side` is measured
  against, so a threshold rule can shade just its breach instead of filling back to zero:
  `{side: positive, baseline: 0.5}` fills only where the line is above 0.5, closing flat on 0.5.
  Negative thresholds work identically (`{side: negative, baseline: -0.7}`).
- Runs split at the **baseline** crossing, interpolated to the exact level, so the fill's edge is flat
  on the threshold rather than a slanted segment. A point sitting exactly on the baseline is a
  boundary, and a series that touches it without crossing stays one run.
- Regions are independent, so one series can carry fills at several thresholds. Pair a region with an
  `annotations.yAxis` marker at the same `y` to draw the threshold line itself.
- Omitting `baseline` is byte-identical to `baseline: 0` (asserted in the tests).

### Changed — shading opacity

- **`shading[].fillOpacity` now defaults to 0.5**, up from the 0.18 it borrowed from confidence bands.
  Shading is usually the subject of the chart rather than chrome behind it, so it reads at half
  opacity. Set `fillOpacity` per region to go back to a lighter wash. Two overlapping regions still
  compound — 0.5 over 0.5 renders as 0.75 — so drop the lower one when layering a base tint under an
  accent window.

### Added — explicit value units

- **New `value_prefix` / `value_suffix`.** State a chart's units instead of having them guessed:
  `value_suffix: "%"`, `value_suffix: " pp"`, `value_prefix: "$"`, or both
  (`value_prefix: "$"` + `value_suffix: " billion"`). They apply everywhere a number is rendered —
  axis ticks, the horizontal-bar value axis, stacked segment and net labels, waterfall running
  totals, and hover tooltips.
- Concatenated **literally**, so the author owns spacing (`%` wants none, `" pp"` does). A prefix sits
  **after** a minus sign, so a negative currency value reads `-$5`, not `$-5`.
- A narrower explicitly-set format still wins locally: a per-annotation `value_format`, and a
  dumbbell's `gap_annotation.format` (else its chart-level `value_format`) for the gap label.

### Removed — units inferred from the subtitle

- **`subtitle` no longer affects number formatting.** It was substring-matched for `"percent"` and,
  on a hit, `%` was appended to every rendered value. Consequences, all now gone:
  - `subtitle: "Percentage points"` rendered a 2 pp change as **`2%`** — a change presented as a rate.
    This is the reported bug.
  - `subtitle: "Percentiles"` also got `%`, because the match was a bare substring test.
  - The condition's second clause (`includes("percentage point")`) was unreachable, since any such
    string already contains `"percent"`.
- **Breaking for charts that relied on the inference**: their axes lose `%` until they set
  `value_suffix: "%"`. In `budget-lab-charts` that is three figures (`ai-fiscal/debt-to-gdp`,
  `tariff-model-update-july2026/etr-vintages`, `recession-indicators/ui-percent`); five others were
  being mislabelled and are corrected by the removal alone.
- Chart-level `value_format`'s doc comment claimed it formatted "axis ticks / hover / gap labels";
  only the gap label ever read it. The comment now says what it does.

### Changed — internal

- The threaded `units: string` became `valueAffixes: ValueAffixes` (`{prefix, suffix}`) on
  `AssembleOptions`, `PaneResult`, `RenderResult`, `FigurePane` and `FigureRenderResult`;
  `makeTickFormatter`, `formatValue` and the stacked/waterfall label formatters take it in place of a
  bare suffix string. `inferUnitsFromSubtitle` is deleted, replaced by `resolveValueAffixes` and
  `applyValueAffixes`.

### Fixed — dev tooling

- **`npm run snapshot:selftest` works again.** It opened
  `examples/augmented-occupations/chart.yaml`, deleted in a32714a ("prepare v1.1.0") — the commit
  that repointed the CLI and serve tests onto `test/fixtures/sample-chart` but missed this script.
  It has been failing with an ENOENT since v1.1.0, through eleven releases, despite being part of
  the README's documented release checklist. Now renders that same fixture, with an explicit
  missing-spec guard matching the script's existing build-artefact checks.
- **Removed the broken `npm run gallery` alias.** It served `examples/gallery`, deleted in b436746.
  The engine intentionally ships no bundled figures, so the alias had nothing to point at; use
  `tbl-chart serve <dir>` against whatever directory you are reviewing.

Neither script affects published output. The selftest matters because it is the only check that
exercises the built `dist/` end to end — the vitest suite imports from `src/`, and CI runs
browser-free — and `dist/` is what consumers get when they install by tag.

## [1.7.0] - 2026-07-29

### Added — dumbbell

- **New `chartType: "dumbbell"`** — a connected dot plot: one dot per series in each category joined
  by a connector stem, so the GAP between two or three non-summing values (e.g. current-law vs.
  static vs. collected effective rates) is the visual subject. `xAxisType` must be `categorical`;
  `orientation` (`horizontal` default \| `vertical`) flips the rendering. Map the categorical column
  via `columns.category` (a synonym for `columns.x`); category order via `category_order` (synonym
  for `x_order`). Reuses the shared `series_*` fields, `columns.facet` + `small_multiples`, and the
  standard legend/hover/PNG-SVG export.
- **Marker styles** — `series_marker` sets each series' dot to `filled` (solid series color),
  `hollow` (ring: series-color outline, page-background center), or `ink` (filled neutral). The
  legend swatch matches (hollow reads as a ring).
- **Connector, gap annotation, formatting** — `connector` (color/width/solid|dashed|dotted),
  `gap_annotation` (label the |a − b| gap per stem), `dot_radius`, `value_axis_title`,
  `value_format`. Single-dot / coincident categories draw no stem.
- **Value axis fits the data** (no forced zero baseline), including zero only when the dots cross
  it. Faceted dumbbells share a common value scale by default.
- **Per-category band hover** (both orientations) — hovering a category's row/column highlights the
  band and shows a tooltip listing each series' value; faceted dumbbells get a **coordinated
  cursor** that echoes the band across panes. (The categorical crosshair gained a horizontal mode.)
- **Sections** (`columns.section`, horizontal) — group categories into labeled blocks with bold
  gutter headers, like horizontal bars.
- **Horizontal dumbbells auto-grow their height** with the category-row count (and section spacers),
  reusing the horizontal-bar height helper — no more cramped/overflowing rows at high category
  counts. Standalone and faceted panes alike.
- **Facet layout matches orientation**: horizontal dumbbell facets **stack vertically** (one
  full-width pane per row — a horizontal value axis needs the width); vertical dumbbell facets sit
  **side by side** in the usual grid.
- **Consistent dot draw order** — dots render series-major (first series drawn first, last on top),
  so overlapping dots stack identically in every category.
- **Gap annotation** renders at the connector midpoint, prefixed with `Δ` (and skips zero-gap
  categories), so it reads as a difference rather than a value competing with the axis.

### Added — line-to-baseline shading

- **New `shading` field (line charts).** A list of independent regions, each filling between a line
  and its baseline: `{series?, side?, from?, to?, color?, fillOpacity?}`. Omit `series` to shade every
  in-scope series in its own color. Several regions may cover one series, so a base tint plus a
  differently-colored projection window is a two-entry spec.
- **`side: positive | negative`** restricts a fill to one side of zero, splitting the series at its
  zero crossings and interpolating each crossing so the fill closes flat on the baseline rather than
  on a slanted edge.
- **`from`/`to`** restrict a fill to an x range. A bound falling between two data points is
  interpolated to that exact x, so the edge lands where the spec says instead of at the nearest
  point. Categorical axes crop on category boundaries (bounds must name existing categories).
- Baseline is zero when zero is in view, else the nearer domain edge, so a fill never leaves the
  frame. Shading does not expand the y-domain — use `yAxisPolicy.includeZero` for that.
- Fills paint behind the gridlines and beneath `confidence_bands`, and dim with their series in the
  legend.
- Validation rejects `shading` on a non-line chart, an unknown series, a categorical bound naming a
  missing category, and a `side` that could never match the data.

### Fixed — marks escaping a truncated value axis

- **Line marks are now clipped to the plot frame.** A `yAxisPolicy.min`/`max` narrower than the data
  used to let lines, confidence bands and point markers paint outside the frame entirely — a spike
  rendered over the title and legend and off the top of the SVG, not merely inside the plot box. The
  clip is geometric, so the stroke runs to its true crossing with the axis edge and stops there;
  nothing is dropped or clamped, and a series that re-enters the range resumes at the correct x.
  Pre-clipping the source data as a workaround is no longer needed (and was never right — it either
  fakes a plateau or reads as missing data, and the chart's CSV download shipped the altered values).
- **The clip gate now fires in both directions and either sign.** It was `yDomain[0] > 0`, which only
  caught a raised floor on positive data: a bar taller than a hard `max`, or a bar below a negative
  `min`, still overflowed. The gate compares the resolved domain against the geometry each chart type
  actually paints (`computeDrawnValueExtent`), so label headroom alone never triggers it and charts
  whose data fits stay byte-identical.
- **Waterfall charts now clip.** `clipMarks` was read by the waterfall builder but never set for
  `chartType: "waterfall"`, so a truncated waterfall's bars and connectors spilled out of the frame.
- **Line hover hit-paths inherit the clip.** The invisible fat clone used for click-to-select is
  inserted at the SVG root and kept the off-frame geometry, leaving a phantom hit zone over the
  title/legend on a clipped chart.
- **Dumbbell dots and connector stems now clip.** A dumbbell fits its data rather than forcing a zero
  baseline, so an author-set `yAxisPolicy.min`/`max` is ordinary — and an out-of-range dot landed far
  off the canvas (one measured at `cx ≈ 2849` on a 720px chart). Gap annotations stay unclipped, so a
  label is never cut in half.

Every chart type now clips. Value labels, gap annotations and reference lines stay unclipped by
design — a half-cut label reads worse than one sitting past the axis.

### Fixed — bar/stacked

- **All-zero bar/stacked charts no longer render full-height bars.** When every value was `0` the
  value extent collapsed to `[0, 0]`, making the scale singular and painting full-height,
  single-color bars labeled `0%`. The axis range is now floored to `[0, 1]` while bars stay sized to
  their real `0` (zero height). Affects both `stacked` and grouped `bar`; some-categories-zero
  charts and all non-degenerate charts are unchanged.

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
