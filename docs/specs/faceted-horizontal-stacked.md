# Spec: horizontal stacked bars with small multiples

Status: proposed · Target: patch release (1.3.2) · Author: The Budget Lab / drafted 2026-07-15

## Motivation

budget-lab-charts needs a faceted horizontal 100%-stacked distribution chart (share of tax
units by cut size, faceted "By Quintile" / "Within Top Quintile", one facet per row via
`small_multiples.columns: 1`). Today the engine rejects the combination:

```
horizontal orientation is not supported with small_multiples for "stacked" charts yet —
use vertical, or drop small_multiples
```

(`src/spec/validate.ts:89-98`, `facetedHorizontalError`.) The limitation is silent in
CONFIG-SPEC.md — "Faceted horizontal bars" (L207-211) documents single-series and grouped
bars only and never mentions the stacked exclusion.

Motivating consumer spec (should validate and render after this feature):

```yaml
chartType: stacked
orientation: horizontal
title: "Distribution of Tax Cuts Against Current Policy By Income Group, 2026"
xAxisType: categorical
columns: { x: income_group, value: share, series: cut_size, facet: section }
x_order: ["Quintile 1", "Quintile 2", "Quintile 3", "Quintile 4", "Quintile 5",
          "Top 10%", "Top 5%", "Top 1%", "Top 0.1%"]
series_order: ["No cut or tax increase", "< $100", "$100 - $500",
               "$500 - $1,000", "$1,000 - $5,000", "> $5,000"]
small_multiples:
  columns: 1
  pane_order: ["By Quintile", "Top Quintile Breakout"]
barStack: { netDisplay: none }
yAxisPolicy: { max: 100 }
```

## Why the gap is narrow

Faceting is per-pane composition (`renderFigure` in `src/engine/figure.ts` renders N
independent mini-SVGs on a CSS grid; the Plot `fx`/`fy` path is dormant). The interaction
layer already supports horizontal stacked panes end to end: the band crosshair handles
`orientation: "horizontal"` + `isStacked` + the Total row (`crosshair.ts:786-850, 955-1017`),
the faceted live wiring passes them through (`render-live.ts:1671-1740`), and figure-level
legend dedup already consumes the stacked builder's `seriesColors`/`legendExtras`/
`legendVisualOrder`/`showTotalDot` (`figure.ts:484-497, 621-634`). `buildStackedMarks` even
has `ctx.pane` suppression for net text, net labels, and segment labels already
(`stacked.ts:244, 253-332`). What remains is rendering + validation.

## Changes

### 1. `src/engine/marks/stacked.ts` — honor the faceted-horizontal contract (the real work)

The horizontal return path (L410-432) must do what `bar.ts:318-320` already does:

- Use `ctx.categoryGutter` when provided instead of always self-computing
  `horizontalLeftGutter(...)` (L413): leftmost pane gets the shared gutter, others get
  `SHARED_LABELLESS_MARGIN_LEFT`.
- Suppress the `tblBandYAxis(...)` category-label marks (L426) when
  `ctx.hideCategoryLabels` is set.
- Confirm pane margins (`marginTop`/`marginBottom`) produce the same value-tick row spacing
  as faceted horizontal bars (bar.ts's `fyCategoryBandLayer` sets both, stacked's horizontal
  path currently sets only `marginLeft`, L428).

### 2. `src/engine/figure.ts` — widen the orientation gates

- `isHorizontalBar` (L285) → `(chartType === "bar" || chartType === "stacked") &&
  orientation === "horizontal"`. This turns on the shared category gutter
  (`orderedCategories` + `horizontalLeftGutter`, L286-288), auto-height, and the
  gutter/label threading (L463-468, 597-605), all of which are chartType-agnostic.
- `horizontalBarHeight` (L49-67): for stacked, `barsPerCat = 1` (a stack occupies one band
  slot, like single-series). The value-axis extent already handles stacked totals via
  `computeBarYExtent`, so the shared-domain probe (L540-553) needs no change.
- `pane_widths: equal-bar` weighting (L367-378) currently multiplies
  `catSet.size * serSet.size`; for stacked the bar count is categories only — add a
  stacked branch.

### 3. `src/spec/validate.ts` — validation

- Remove (or narrow to nothing) `facetedHorizontalError` (L89-98; call site L150-153).
- Widen the ragged-facet guard gate (L382) to `chartType === "bar" || "stacked"`. The
  reasoning is identical: `buildStackedMarks` computes its band domain per pane from its own
  rows (`stacked.ts:88-98, 425`), so a category missing from one facet silently misaligns
  that pane. Update the error-message wording from "bars" to "bars/stacks". The `sectionOf`
  branch stays bar-only (`columns.section` remains rejected for stacked by
  `sectionColumnError`).

### 4. Design decision: net-dot chrome at pane edges

This is the concern the `facetedHorizontalError` comment cites. Net text, net labels, and
segment labels are already suppressed in panes; the net **dot** (r: 10, `stacked.ts:275`) is
kept, positioned at the true net value — near the pane's right edge it can clip, and r: 10 is
large for a narrow pane.

Decision: in panes (`ctx.pane`), render the net dot at **r: 7**, and when the resolved
`netMode === "dot"`, extend the pane's value-axis headroom by the dot radius (mirror of how
standalone charts absorb it in `TBL_MARGIN_RIGHT`). No clipping, no repositioning. Charts
with `netDisplay: none` or `normalize` (like the motivating spec) are unaffected.

### 5. Docs

- CONFIG-SPEC.md "Faceted horizontal bars" (L207-211): extend to "single-series, grouped,
  and stacked bars"; note the pane behavior of `barStack.netDisplay` (dot kept at reduced
  size, text/labels suppressed).
- Cross-reference from the `barStack.*` table (L185-189) to the small-multiples section.
- CHANGELOG entry under `### Added — bars`, patch bump to 1.3.2, git tag `v1.3.2`
  (budget-lab-charts consumes by re-pinning the tag).

## QA

- **Gallery fixture** `examples/gallery/21_faceted-horizontal-stacked/` (chart.yaml +
  data.csv): the motivating spec above, `columns: 1` (one facet per row), ragged-safe data;
  `note:` states what to confirm visually (aligned category gutters, labels only in the
  first pane... for columns: 1, every pane is leftmost — include a second fixture variant or
  set `columns: 2` in the fixture so label suppression is actually exercised).
- **Golden tests** (`test/golden.test.ts`): new baselines for faceted horizontal stacked in
  both `shared` and `per-pane` modes (precedent: `figure-stacked-perpane.golden.svg`,
  `figure-bar-shared.golden.svg`). Include one diverging fixture with `netDisplay: dot` to
  lock the r: 7 pane dot and headroom.
- **validate.test.ts**: flip the accept/reject cases at L526/L539; add ragged-facet cases
  for stacked.
- `npm test`, `npm run typecheck`, visual pass via `npm run gallery`.

## Acceptance criteria

1. The motivating spec validates and renders: two panes stacked vertically (one facet per
   row), horizontal 100% bars, shared 0-100 value axis, category labels present in every
   pane when `columns: 1`, single figure-level legend in stack order.
2. With `columns: 2`, non-leftmost panes suppress category labels and share the left gutter,
   identical to faceted horizontal bars.
3. Diverging stacked data with `netDisplay: dot` shows per-category net dots (r: 7) inside
   every pane without clipping; net text/labels remain pane-suppressed.
4. A facet missing a category fails validation with the ragged-facet message naming the
   facet and categories.
5. Tooltips/crosshair behave as on vertical faceted stacked (Total row per `showTotalDot`);
   coordinated cursor works across panes.
6. No change to any existing golden baseline (vertical stacked, faceted bars, single-pane
   horizontal stacked).
