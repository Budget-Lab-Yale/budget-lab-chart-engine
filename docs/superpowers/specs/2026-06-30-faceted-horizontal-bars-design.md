# Faceted horizontal bar charts + sectioned category axis

Status: approved 2026-06-30.

## Problem

The engine renders single horizontal grouped bars correctly and renders vertical bars
under `small_multiples`, but the **combination** `orientation: horizontal` +
`small_multiples` produces a broken layout: category labels are drawn left-anchored at each
pane's plot edge and run rightward over the bars, floating in the gap between panes.

Root cause: `src/engine/figure.ts` small-multiples is written assuming the value axis is
vertical. In shared mode it (a) shares the y-domain, (b) hides y-tick labels on non-leftmost
columns, and (c) forces `marginLeft` to `TBL_MARGIN_LEFT` (col 0) / `SHARED_LABELLESS_MARGIN_LEFT`
(col > 0). For a horizontal bar the value axis is **x** and the category axis is **y (a band)**,
so the forced 44px left margin is far too narrow for long category labels, the category labels
are emitted via the group-header idiom rather than as a shared left-gutter axis, and the
label-hiding logic targets the value ticks instead of the category labels.

The single-chart horizontal path is unaffected (it computes a responsive gutter, e.g.
`data-margin-left="62"`). Only the faceted combination is unhandled.

## Goals

1. `orientation: horizontal` + `small_multiples` renders a correct faceted horizontal bar
   chart: one shared category (y) axis in a left gutter on the leftmost pane, panes to the
   right sharing the value (x) axis, category labels suppressed on non-leftmost panes, value
   ticks at the bottom of every pane, pane titles above each pane. Works for single-series and
   grouped (multi-series) horizontal bars.
2. Optional **sectioned category axis**: a new `columns.section` role groups categories into
   contiguous sections (e.g. Durable goods / Nondurable goods / Services) with a bold section
   header in the left gutter and a gap between sections. Scoped to horizontal bars.
3. A Figure-7-derived fixture (Budget Lab tariff PCE price effects) exercising both, locked to
   a golden SVG.

## Non-goals

- Sectioning for vertical bars or non-bar chart types.
- Auto-sorting categories by value (the engine preserves data / `x_order` order by principle;
  fixtures are pre-sorted).
- Per-section independent value scales.

## Approach

Keep the existing CSS-composed independent-pane architecture (each pane is its own mini-SVG) —
it is already the right model for faceted horizontal bars. Make small-multiples
**orientation-aware** rather than introducing Plot 2-D faceting (the combined-SVG faceting path
was deliberately retired).

### Part 1 — Faceted horizontal layout (`figure.ts` + `bar.ts`)

- Detect the horizontal-bar case in shared-mode small-multiples.
- Leftmost pane: left margin = `horizontalLeftGutter(orderedCategories)` (sized to the longest
  label), category labels rendered right-justified in the gutter, vertically centered on each
  category row (the existing `tblBandYAxis` / grouped equivalent, NOT the group-header idiom).
- Non-leftmost panes: small left margin (`SHARED_LABELLESS_MARGIN_LEFT`), category labels
  suppressed. Rows stay aligned because the category band domain is shared across panes.
- Value (x) axis domain shared across panes (already works via the shared-domain probe); x-ticks
  shown at the bottom of every pane.
- The bar builder must honor a "hide category labels" signal and an externally supplied
  category-band domain + gutter width, threaded the same way the vertical path threads
  `hideYAxisLabels` / `marginLeft`.

### Part 2 — Sectioned category axis

Spec additions (`src/spec/types.ts` + `schema.ts` + `columns.ts`):

- `columns.section?: string` — column whose distinct values group the categories into sections.
  Horizontal bars only.
- `section_order?: string[]` — section render order; also an inclusion filter (mirrors
  `series_order`).
- `section_labels?: Record<string,string>` — section value → display label.

Layout:

- Build the category band domain ordered so each section is contiguous (`section_order` else
  data-encounter order; within-section category order preserved). Insert a spacer sentinel band
  entry between sections — it carries no data rows, so no bars, value labels, or rect tags are
  produced for it; it creates the vertical gap.
- Gutter renderer draws: category labels right-aligned per real category row; a bold section
  header (heading color, 700 weight, left-aligned at the gutter's left edge) in each spacer gap.
- Section headers render on the leftmost pane only, consistent with category labels.
- Default gap ≈ one bar-row; no divider rule.

## Components touched

| File | Change |
|---|---|
| `src/spec/types.ts` | Add `section` to `ColumnMap`; add `section_order`, `section_labels` to `ChartSpec`. |
| `src/spec/schema.ts` | Schema entries for the new fields. |
| `src/spec/columns.ts` | Resolve the `section` column. |
| `src/engine/figure.ts` | Orientation-aware shared-mode: horizontal gutter sizing, category-label suppression on non-left panes, ordered+sectioned category domain. |
| `src/engine/marks/bar.ts` | Honor externally supplied band domain, gutter, hide-category-labels flag; skip spacer entries for bars/labels/tags. |
| `src/engine/axes.ts` | Section-aware gutter renderer (category labels + section headers + spacer handling). |
| `test/fixtures/` | `figure7-tariff.csv` + `figure7-tariff.golden.svg`. |
| `test/golden.test.ts` | Faceted-horizontal + sectioned assertions (gutter on col 0, labels suppressed col > 0, shared value domain, rect counts, section headers). |
| `CONFIG-SPEC.md` | Document `columns.section`, `section_order`, `section_labels` and the faceted-horizontal combination. |

## Testing

- Unit/golden: leftmost pane margin equals the computed gutter; non-leftmost pane margin is the
  small label-less margin and has zero category-label text marks; both panes share one value
  (x) domain; rect count = (categories × series) per pane; section headers present once
  (leftmost) with correct text; spacer entries produce no bars.
- Determinism: byte-identical re-render (existing golden discipline).
- Visual: render the Figure-7 fixture to PNG and eyeball before locking the golden.

## Build order

1. Part 1 (faceted horizontal layout) end-to-end with the flat (unsectioned) fixture.
2. Part 2 (section axis) layered on top.

Each part lands with its tests green before the next.
