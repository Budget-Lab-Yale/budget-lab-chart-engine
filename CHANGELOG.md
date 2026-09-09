# Changelog

All notable changes to the Budget Lab chart engine are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/); this project adheres to
[Semantic Versioning](https://semver.org/).

## [1.14.0] - 2026-09-02

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
  A label the sweep pushes now also clears every callout's marker, coming to rest no closer than
  that same 6.6px to any callout's point, so a pushed label's leader is always longer than its end
  gap and is therefore always drawn; a label still at its default is exempt, which is what keeps a
  lone callout byte-identical. A callout
  with an explicit `dx` or `dy` **always** draws it — the author asked for the connector and said
  where the label goes. The default WITHOUT a connector is unchanged at 6px. Where no leader can be
  drawn (a categorical x-axis, or a render with no width/height) a pinned callout still falls back
  to a small dot and an auto-placed one now draws nothing. (#42)

### Changed
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
  centre instead of 4px, and an auto-placed callout loses the leader altogether unless the vertical
  sweep pushed its label (a lateral frame-edge flip alone does not earn one). A pushed label is also
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
  The texture reaches the marks, the legend key, the export, and the hover tooltip on the chart types
  that draw one — which among the filled types is standalone `area`, standalone `histogram` and a
  stacked chart with a net dot; `bar` and `waterfall` hover with value pills and have no tooltip key,
  and neither does a coordinated small-multiples pane (corrected in 1.12.0; the original wording
  over-claimed). A key draws ONE centred
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
  baseline. The hover tooltip adds a cumulative **Total** row (standalone only — a coordinated
  small-multiples pane has no card; clarified in 1.12.0). **Click-to-restack**: selecting
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
