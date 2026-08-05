# Annotation legend entries + x-axis rug — design

Date: 2026-08-04. Target release: engine **1.9.0**.

## Problem

Two related complaints from the recession-indicators article, both about the michez-rule chart
(`charts/articles/2026/08/recession-indicators/michez-rule/`).

**1. In-chart annotation labels read as clutter on a busy chart.** That chart carries three
recession `annotations.bands`, five `shading` regions (three false-negative, two false-positive),
and one `annotations.yAxis` threshold line. Every one of those that wants naming has to name itself
*inside the plot frame* — a band label at the top of the band, a threshold label on the rule. On a
chart with three spikes and a dense 2024–26 tail there is nowhere for that text to sit that doesn't
read as stilted.

The chart the author wants to imitate (`jobs_day_preview`) puts its key **above the plot area**,
under the subtitle — but it can do that only because everything it needs to key is a *series*, and
the engine's legend is series-only. Bands, reference lines, and shading fills carry a `label` (or,
for shading, no label at all) and never reach the legend. The workaround the author identified —
adding dummy CSV series purely to mint legend rows — is exactly the kind of data-shaped lie the
archive should not contain.

**2. Thin fills are illegible.** The article switched false negatives from gold vertical bands to
`shading` fills so they'd match the false positives. The false-negative runs are 1–3 months long on
a 26-year axis, so as fills they are hairlines. The author sketched the fix (`revised_michez`): a
thin horizontal strip along the x-axis carrying a solid block per recession / false negative /
false positive — a categorical timeline that stays legible at any interval width.

## Non-goals

- Legend entries for `annotations.points` (a callout **is** its label; moving it to a legend loses
  the coordinate it points at).
- ~~Multi-row rugs.~~ Revisited: see E. One strip remains the default, but a track that the single
  strip would erase is a validation error, and `rug.rows: per-track` stacks them.
- A rug tooltip. Hovering a block highlights its legend row (see C) — that is the answer; a
  second, value-shaped answer over the strip would compete with the crosshair.
- Rug on small multiples or on a categorical x-axis (validated out; see Validation).

## Design

### A. `legend: true` on annotations, bands and shading

Four spec shapes gain an opt-in flag that moves their `label` out of the plot frame and into the
chart legend:

| shape | new fields |
|---|---|
| `annotations.bands[]` | `legend?: boolean`, `rug?: boolean` |
| `annotations.xAxis[]` | `legend?: boolean` |
| `annotations.yAxis[]` | `legend?: boolean` |
| `shading[]` | `label?: string`, `legend?: boolean`, `rug?: boolean` |

`shading` gains `label` because it has no label today — there is no in-chart text for a fill, which
is why the article's fills are described in prose in the `note` line instead.

**Semantics.**

- An entry contributes a legend row when it has a non-empty `label` **and**
  `legend === true || (legend !== false && rug === true)`. So `rug: true` implies a legend row (a
  solid block on the axis strip with no key is unreadable), and `legend: false` always suppresses.
- A legend row **replaces** the in-chart label: a band or reference line whose label went to the
  legend draws no text inside the frame, and reserves no auto-stagger row. That is the whole point
  of the feature — asking for both would just re-create the clutter.
- Rows **dedupe by (label, swatch kind, color)**, first-appearance order preserved. This is what
  makes the michez chart work: three recession bands → one "US recessions" row; three
  false-negative shading regions → one "False negatives" row.
- Rows are interactive in their own selection dimension — see **C. Reciprocal highlighting**, added
  after the first review — and `isExtra: true`, so they sort after the real series in the right-hand
  legend column.
- Row order: series rows → mark-layer extras (the stacked "Total") → **bands → shading → xAxis →
  yAxis**, each group in spec order. Not author-controllable in this release.
- `legend: false` at the chart level still suppresses everything, unchanged.

**Swatches.** Fills get a rect swatch; reference lines get a line swatch (dashed when the marker is
dashed), colored like the rule.

A fill's swatch has to answer "what will I see on the chart?", and what you see is the fill color at
its `fillOpacity` over white. So the swatch color is the fill **flattened against white** at that
opacity — `annotations.bands` default to `fillOpacity: 0.1`, which flattens to very nearly white, so
every annotation-derived rect swatch also draws a hairline outline (`rgba(0,0,0,0.18)`) and a pale
chip still reads as a chip rather than a gap. An entry with `rug: true` is keyed by its **solid**
rug color instead, because the rug block — not the tint — is the thing the reader is matching.

The outline is opt-in per row (`LegendItem.outlined`) so existing bar/stacked rect swatches stay
byte-identical.

### B. The x-axis rug

A single thin horizontal strip immediately below the x-axis line, carrying a solid block per
interval. Blocks are grouped into **tracks**; each track has a label and a color, and all tracks
paint into the one strip in order (later tracks over earlier).

**Where the intervals come from.** Duplicating the michez date ranges into a `rug:` block would
mean eight date pairs stated twice and free to drift, so tracks are *derived from the entries that
already state them*: any `annotations.bands` or `shading` entry with `rug: true` is grouped by
`label` into a track. Explicit `rug.tracks[]` with literal `intervals` covers the remaining case —
a timeline concept with no band or fill of its own.

```yaml
rug:
  height: 8            # px, default 8
  tracks:              # optional; explicit tracks, drawn after the derived ones
    - label: Policy in effect
      color: blue
      intervals:
        - { from: "2021-03-01", to: "2022-09-01" }
```

Track resolution order: derived-from-`bands` → derived-from-`shading` → explicit `rug.tracks`,
matching the legend row order so the strip and its key read in the same sequence. A derived track's
color is the source entry's `color` (solid — the rug is not a tint), defaulting to the annotation
neutral. A track's intervals are its group's `start`/`end` (bands) or `from`/`to` (shading); a
shading entry with an open bound (`from`/`to` omitted) cannot become a rug interval and is a
validation error.

The `rug` block may be present with no `tracks` (just `height`) when every track is derived.

**Geometry.** The strip sits between the plot frame's bottom edge and the x-axis tick labels:

```
  ── frame bottom (axis) ────────────────────
        RUG_GAP  3px
  ▮▮▮▮  ▮▮      strip  RUG_H  8px (rug.height)
        RUG_PAD  2px
  2005    2010          tick labels, shifted down by RUG_ALLOWANCE (13px)
```

The room is made by **growing `marginBottom`** by `RUG_ALLOWANCE = RUG_GAP + height + RUG_PAD` and
shifting the x-axis tick labels down by the same amount. Growing the margin (rather than insetting
the y range) is deliberate: every consumer that derives plot geometry as
`height - marginTop - marginBottom` — the annotation stagger, the point-callout connector math, and
all six margin reads in `crosshair.ts` — stays correct with no changes, because
`svg.dataset.marginBottom` is stamped from the same value.

`renderPane` (`engine/index.ts`) owns the allowance: it resolves the tracks, passes the allowance to
`buildXOpts` as an axis-label dy shift, and adds it to `xOpts.marginBottom`. `assemblePlot` re-derives
the tracks (a pure spec read) and draws the strip; it must not add the allowance again.

**Drawing.** Post-render DOM injection at the end of `assemblePlot`, not a Plot mark: the strip
lives outside the plot frame, needs exact pixel geometry, and must not acquire a facet channel (any
fx/fy-bound mark facets the whole plot). Pixel positions come from Plot's own
`svg.scale("x")` — the same accessor `crosshair.ts` reads — so the blocks land on the real scale
rather than on a re-derived approximation of it. Deterministic (no layout measurement), so it works
identically in the live HTML, the PNG export, and the jsdom/SSR goldens, all of which consume this
one SVG.

Each block is clamped to the plot's horizontal extent and floored at 2px wide, so a one-month
interval on a 26-year axis is still visible (that being the entire point). Intervals falling wholly
outside the x-domain are dropped. The strip is `<g class="tbl-rug" aria-hidden="true">` — the
legend is its accessible name.

### C. Reciprocal highlighting (added after the first review)

A keyed row and the chart elements it names should highlight each other. Hovering the row brightens
its parts and dims the rest; hovering the part marks the row.

**Why a separate selection dimension.** The obvious implementation — give annotation rows a
`data-series` key and reuse the series machinery — breaks a shipped behavior: a `shading` fill already
carries its series' `data-series` so it dims *with its line*, and an element can only carry one. So
annotations get their own attribute, `data-annotation`, and `LegendItem.annotation: true` says which
attribute a row matches. A keyed fill then carries **both** keys and answers to both.

Dimming, however, treats the two as **one universe**: an element stays bright when *either* of its
keys is selected, and the "is a strict subset selected?" test counts series + annotation rows
together. That is what makes hovering "False negatives" spotlight the gold fills and blocks while the
data line drops back — and, symmetrically, makes hovering a series row dim the annotations.
`pinnedSeries()` and the `onHighlight` callback keep reporting **series only**, so the area restack
and the value-pill renderer never see an annotation key.

**Tagging.** One key per row, derived from the **label** (`__annotation:<label>`) rather than the
entry's index — precisely because one row stands for many elements. Applied by:

| element | mechanism |
|---|---|
| band rect | a deterministic `className` (`tbl-annotation-band-<i>`) stamped **only when keyed**, tagged post-render — so an unkeyed band emits no class attribute and stays byte-identical |
| `xAxis` rule | same, reusing `X_ANNOTATION_LINE_CLASS-<i>` |
| `yAxis` rule | already carries `ANNOTATION_LINE_CLASS-<i>` unconditionally; only the key→class pairing is new |
| `shading` fill | a sparse `annotationOrder` array on the existing `layers.tagging` entry, parallel to `seriesOrder` |
| rug block | set directly in `drawRug`, via a `keyFor(track)` callback |

**Chart → legend, scoped to the rug.** The reverse hover is wired on the **rug blocks only**, resolved
with `elementsFromPoint` (the crosshair's transparent full-SVG hit rect sits on top, so this is the
same piercing technique the existing click-to-pin uses). In-frame regions are deliberately excluded:
band rects and fills sit exactly where the reader sweeps the crosshair to read values, so hovering
them would dim the line being read, on and off, at every region boundary. The rug sits below the axis,
its blocks are discrete, and "what is this block?" is the question a reader actually has there.

One consequence to handle: the crosshair hit rect covers the whole SVG, so the strip would otherwise
serve a value tooltip on top of the annotation highlight — two answers to one hover. When a rug is
present, the hit rect's height is clamped to the top of the strip, so the crosshair hides as the
pointer enters it. Gated on rug presence; every other chart is untouched.

### D. Multi-series fills (added after the multi-series pressure test)

A `shading` region with no `series` is documented convenience for "fill under every series", and each
fill takes its own series' color. One label over N differently-colored fills therefore cannot be keyed
by one chip — the first implementation keyed all three with the *first* series' tint, and a region that
did name a series was keyed by the first series' tint too (a plain bug).

Resolved by making the swatch carry a **list** of tints (`LegendItem.colors`), one per fill the row
actually names, rendered as equal vertical bands — a hard-stop `linear-gradient` in the live legend
(the same technique the dashed swatch already uses) and N rects in the PNG export. `shadeSwatchColors`
derives the list the way the fills are derived: explicit `color` → that one; else the named series'
color; else one per in-scope series.

Row dedupe consequently merges on **(label, swatch shape, dashed)** rather than including color, and
unions the tints. That makes the two ways of writing the same thing agree: one region covering three
series, and three regions sharing a label, produce the identical banded row. A rect and a rule sharing
a label stay separate rows — one swatch cannot be both.

`shading[].label` has no meaning without `legend`/`rug` (a fill draws no text of its own), so a label
with neither is now a validation error, matching how this repo already treats `columns.section` and
`x_axis_ticks` no-ops rather than letting dead configuration render nothing.

### E. What the pressure suite found (multi-series, 16 cases)

A generated suite — series counts 1/3/7/9, one vs several concepts per series, regions scoped to one
series vs all, shared vs distinct labels, rug on/off, right-hand legend, overlapping tracks, long
labels, dashed series, area+temporal — measured against the live DOM rather than eyeballed. Four
defects, each fixed:

| found | fix |
|---|---|
| A keyed fill naming a series was keyed by the **first** series' color | resolve the swatch from the fills the row actually names (`shadeSwatchColors`) |
| At 7 and 9 series the banded chip stayed 14 px → 2 px and 1.5 px bands | the chip widens to hold `SWATCH_MIN_BAND` per band, capped at `SWATCH_MAX_WIDTH` |
| A rug block and its own chip could be **different colors** — the chip took the series tint, the block the neutral | one shared resolution, `spec/rug.ts#rugTrackColor`, used by `drawRug` and the legend; a rug-flagged chip is single + solid, because it keys the block |
| A track spanning the axis painted earlier tracks away **entirely**, while they kept their legend rows | `rug.rows: per-track`, plus a validation error (`fullyHiddenRugTracks`, pure interval math) when `single` would erase a track |

Two more were ruled *correct as-is*: partial cover in one row (the michez read — a false negative at
the head of its recession), and the two-concepts-one-palette collision, which no automatic choice can
resolve honestly and is therefore a validation error telling the author to give one an explicit color.

The suite also caught a **test** defect: two assertions read a `y` attribute off numeric-axis tick
labels, which `Plot.axisX` positions by a group transform. Both sides were `NaN`, and `toEqual`
treats `NaN` as equal to `NaN`, so the assertion passed without checking anything. They now assert on
the temporal axis (real `y` values) and prove the values are finite first.

## Validation

New errors in `spec/validate.ts`:

- `legend: true` (or `rug: true`) on an entry with no `label`.
- `rug` intervals that don't parse under the chart's `xAxisType`, or whose `from` > `to`.
- a `shading` entry with `rug: true` and an omitted `from`/`to` (no closed interval to draw).
- `rug` with `xAxisType: categorical` — a band scale has no position between categories.
- `rug` with `small_multiples` — unsupported in this release.
- an explicit `rug.tracks[]` entry with an empty `intervals` array.
- `rug` present (or any `rug: true` flag) with no resolvable track — a silent no-op otherwise.

## Files

| file | change |
|---|---|
| `src/spec/types.ts` | `legend`/`rug`/`label` fields; `RugConfig`, `RugTrack`, `RugInterval`; `ChartSpec.rug` |
| `src/spec/schema.ts` | mirror the above |
| `src/spec/rug.ts` | **new.** Pure `resolveRugTracks(spec)` — the shared track resolution for the strip and the legend |
| `src/spec/validate.ts` | the checks above |
| `src/engine/annotation-legend.ts` | **new.** Pure `buildAnnotationLegendItems(spec, colors, seriesNames)` + `annotationLabelSuppressed` helpers |
| `src/engine/rug.ts` | **new.** `drawRug(svg, tracks, opts)` — the post-render injection |
| `src/engine/index.ts` | `LegendItem.outlined`; append annotation rows in `buildLegendItems`; rug allowance in `renderPane` |
| `src/engine/legend.ts` | outlined rect swatch; the annotation selection dimension + `hoverAnnotation`/`toggleAnnotation` |
| `src/engine/render-live.ts` | rug-block hover/click → the legend handle; clamp the crosshair hit rect above the strip |
| `src/engine/marks/line.ts`, `marks/index.ts` | `annotationOrder` on the shading fills' tagging entry |
| `src/engine/facet-chrome.ts` | `X_BAND_CLASS` (keyed bands only) |
| `src/engine/axes.ts` | `axisLabelDy` shift on the three x-axis label builders |
| `src/engine/x-adapter.ts` | thread `axisLabelDy` through `buildXOpts` |
| `src/engine/assemble-plot.ts` | skip suppressed band / marker labels; draw the rug |
| `src/embed/export-png.ts` | outlined rect swatch in the exported legend |
| `src/embed/styles.ts` | `.tbl-legend-swatch.is-outlined` |
| `CONFIG-SPEC.md`, `CHANGELOG.md` | document both features |

## Tests

- `test/annotation-legend.test.ts` — rows from each of the four shapes; dedupe by label; `rug: true`
  implies a row and keys it solid; `legend: false` suppresses; in-chart band/marker label is gone
  when the row exists and still present when it isn't; a single-series chart gets a legend built
  from extras alone. Plus reciprocal highlighting: every element a row names carries its key; a keyed
  fill keeps its series key too; row hover brightens its parts and dims the line; `hoverAnnotation`
  marks the row; unknown keys no-op; pin + reset; a series row dims the annotations.
- `test/rug.test.ts` — `resolveRugTracks` grouping/order; `marginBottom` grows by the allowance and
  the tick labels shift with it; block geometry against `svg.scale("x")`; the 2px floor; out-of-domain
  intervals dropped; `rug.height` honored.
- `test/validate.test.ts` — each new error.
- `test/golden.test.ts` — a chart with neither feature stays byte-identical.
