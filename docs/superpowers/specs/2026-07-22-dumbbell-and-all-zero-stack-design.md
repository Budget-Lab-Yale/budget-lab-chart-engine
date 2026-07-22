# Dumbbell chart type + all-zero stacked-bar fix

**Date:** 2026-07-22
**Repo:** `Budget-Lab-Yale/budget-lab-chart-engine`
**Status:** Design approved, pending implementation plan.
**Requested by:** Revenue from higher taxes at the top (`interactives-staging/tools/taxes-at-the-top`), `docs/engine-requests/`.

This spec covers two changes delivered as one plan: a high-priority stacked-bar rendering bug, and a new `dumbbell` chart type. Both come from the taxes-at-the-top tool's engine-request set. The three remaining requests in that set are evaluated in "Out of scope" below and are **not** built here.

---

## Part 1 — Bug: all-zero stacked bar renders full-height

### Background

A `chartType: stacked` chart whose rows are **all exactly `0`** (every series, every category) renders every bar at full plot height, in a single series' color, each labeled `0%`. It reads as real, sizable data rather than "nothing to show" — actively misleading. A dataset that is zero in *some* categories but not others already renders correctly (those categories draw zero-height); the bug is specific to the whole chart's y-domain collapsing to `[0, 0]`.

This is a reachable first-touch state for the tool: the distribution card's "New taxes added by the plan" measure is legitimately all-zero the moment a user opens that tab before moving any policy lever. The tool works around it today (`render/distribution.js` detects an all-zero row set and shows a "No new taxes yet" message instead of mounting the chart); that workaround should be removable once this ships.

### Root cause

`src/engine/scales.ts` → `computeBarYExtent`, stacked branch. When every value is `0`, both `posMax` and `negMin` compute to `0`, so the function returns `{ min: 0, max: 0 }`. That degenerate `[0, 0]` extent flows into `computeYAxis` and the value scale collapses; the stacked bars are then sized against a scale with no span and paint at full height.

### Fix

Decouple the **axis range floor** from the **bar sizing**:

- When the resolved stacked extent is `[0, 0]`, give the value axis a finite range (e.g. `max = 1`) so gridlines and the `0%` tick render normally as a flat line — no divide-by-zero, no collapsed scale.
- Ensure the stacked bars are sized against the **real** `max = 0`, so every segment draws at zero height (invisible), matching the data.

The floor value that keeps the axis finite must not be the value the bars scale against.

### Constraints / acceptance

- All-zero stacked dataset → every category zero-height (no visible fill), axis/gridlines normal.
- Some-categories-all-zero dataset → **unchanged** (already correct).
- All existing non-degenerate stacked-bar golden snapshots → **byte-identical**.
- Reproduce first: a failing extent/golden test with an all-zero dataset before the fix (systematic-debugging).

This is scoped to `stacked`. `bar` (grouped) and the dumbbell's own value extent are separate and not degenerate in the same way (a dumbbell of all-equal dots renders correctly — dots at one position, no stem).

---

## Part 2 — `dumbbell` chart type

### Background

Several Budget Lab figures compare, per category, **two or three independent point values that do not sum** — e.g. an effective tax rate under current law vs. a policy's static rate vs. the rate collected after behavior. A bar can't express this (a stack shows components of one total; a grouped bar reads as magnitudes and burns horizontal space). The natural encoding is a **dumbbell** (connected dot plot): one row/column per category, a dot per series, a connector "stem" spanning them so the **gap** is the visual subject.

The tool ships an interim custom-SVG dumbbell built from the exact data contract below; when this mark lands it swaps its custom render for `mountChart` and deletes the custom code — no data reshaping.

### Goals

1. A first-class `dumbbell` chart type: a categorical axis × numeric value axis, rendered as per-category dots joined by a connector.
2. **Both orientations** — `horizontal` (categories down `y`, values along `x`) and `vertical` (categories along `x`, values up `y`).
3. **N series per category** (2 or 3 typical); connector spans min→max of present dots.
4. **Faceting** (`columns.facet` + `small_multiples`), including a top-decile breakout pane sharing series/colors/legend and a common value scale.
5. Per-series **marker styles** (filled / hollow / ink) and connector styling.
6. Optional **gap annotation** labeling the numeric gap between two named series on each stem.
7. Standard engine **hover, legend, and PNG/SVG export** — no bespoke tooltip or layout.

### Non-goals

- User-mutable / drag-reorderable category order (that is app interaction state, not a mark; see Out of scope).
- A paired slim/full *bar* variant (different visual weight per row) — separate mark, not built here.
- A general "annotation targeting two marks" primitive — `gap_annotation` stays dumbbell-local.

### Architecture

**A new `src/engine/marks/dumbbell.ts` builder registered in `marks/index.ts`, composing existing engine infrastructure rather than inventing geometry.** This is the same additive path `histogram` and `waterfall` used: the data-prep, axes, assemble, render, legend, tooltip, and export layers are chart-type-agnostic and need no dumbbell-specific changes beyond registration and the value-extent branch.

The dumbbell is, structurally, "point dots + one connector rule per category":

- **Reuse from `bar.ts`:** the categorical-axis + value-axis topology and the orientation switch — horizontal puts the category band on `y` and the value on `x` (`yScaleOpts` present → assemblePlot treats the chart as horizontal and skips the vertical value chrome); vertical puts the category band on `x` and the value on `y`. The horizontal **left-gutter** sizing for long category labels (`horizontalLeftGutter`, `tblBandYAxis`) is reused directly. Faceting uses the same `fx`/`fy` binding bars use.
- **Reuse from `point.ts`:** dot rendering (`Plot.dot`), per-series `data-series` tagging so legend hover/pin/dim works identically to other chart types, and the shared-tooltip wiring. Per-series dodge is **not** used (dumbbell dots share the category center by design; only exactly-coincident dots get a tiny dodge — see edge cases).
- **New geometry — the connector:** one rule per category spanning that category's min→max dot value, drawn in the `underlay` (behind the dots). Horizontal orientation → `Plot.ruleY({ y: category, x1: min, x2: max })`; vertical → `Plot.ruleX({ x: category, y1: min, y2: max })`.

### Design

#### 1. Spec surface

`ChartType` gains `"dumbbell"`. The categorical axis is validated exactly like bars: `horizontal` requires `yAxisType: categorical`; `vertical` requires `xAxisType: categorical`.

```yaml
chartType: dumbbell
orientation: horizontal            # default horizontal
yAxisType: categorical             # (xAxisType: categorical for vertical)
columns: { category: group, series: measure, value: rate }
category_order: [Quintile 1, Quintile 2, Quintile 3, Quintile 4, Quintile 5]
series_order: [current_law, static, collected]
series_labels: { current_law: Current law, static: Static rate, collected: Collected }
series_colors: { ... }             # per-series dot color; defaults to --tbl-cat* ramp
series_marker: { current_law: ink, static: hollow, collected: filled }   # default all filled
connector: { color, width, style } # default light --tbl-border, 1.5px solid
value_axis_title: Effective tax rate
value_format: { type: number, decimals: 1, suffix: "%" }
dot_radius: 5                      # default from theme
gap_annotation: { series_a: static, series_b: collected }   # optional; default off
legend: true                       # default on for >=2 series
```

**Column mapping note.** The dumbbell uses `columns.category` / `.series` / `.value`. The existing `ColumnMap` is x/value/series-oriented. Decision for the plan: map `category` onto the engine's categorical-x/y field (the same field bars read via `columns.x`) so the data-prep layer needs no new role — i.e. `category` is accepted as the dumbbell's spelling of the categorical axis column, `value` as the numeric field, `series` unchanged. The implementation plan resolves whether to alias `category`→`x` at parse time or add an explicit `category` role; aliasing is preferred (no data-layer change).

New `ChartSpec` fields (types.ts + ajv schema.ts): `series_marker` (map series → `"filled" | "hollow" | "ink"`), `connector` (`{ color?, width?, style? }`), `dot_radius` (number), `gap_annotation` (`bool | { series_a, series_b, format? }`), `value_axis_title` (string), `value_format` (reuse the existing `ValueFormat` shape). Reused as-is: `orientation`, `series_order`, `series_labels`, `series_colors`, `columns.facet`, `small_multiples`, `legend`, `annotations`.

#### 2. Marker styles

`series_marker` maps to Plot dot fill/stroke:

- `filled` — `fill = series color`, thin white stroke (matches point.ts).
- `hollow` — `fill = page-background token` (so the stem shows through the ring center), `stroke = series color`.
- `ink` — `fill = neutral ink token`, no colored stroke.

The legend honors `series_marker` so a hollow series reads as a ring, a filled one as a solid dot (extend the legend swatch rendering, which already special-cases dot markers for the stacked "Total" row).

#### 3. Value-axis extent

Unlike bars, a dumbbell does **not** force zero into the domain — dots are positions, not magnitudes measured from a baseline. A new small helper (`computeDumbbellValueExtent` in `scales.ts`, or a branch alongside `computeBarYExtent`) fits the extent to the dot values and includes zero **only when the data crosses it** (negative and positive dots both present), rendering a zero rule like the bar chart's in that case. Faceted panes share one common value scale by default (matching bars); per-pane scales available via the same `small_multiples.mode: per-pane` bars already expose.

#### 4. Gap annotation

When `gap_annotation` is set, each stem gets a small text label of the numeric gap between the two named series (`|value(series_a) − value(series_b)|`, formatted via `format` or `value_format`), placed near the stem. Dumbbell-local; not wired into the general `annotations` block.

#### 5. Interaction & export

- **Hover:** per-dot hover surfaces `{series_label}: {value}` (and the stem's gap when `gap_annotation` is on) through the engine's existing shared-tooltip mechanism — no bespoke tooltip.
- **Legend:** standard engine legend, one swatch per series honoring `series_marker`; legend toggle/pin/dim behave as for line/bar.
- **Export:** inherits the engine's standard PNG/SVG export and download-name plumbing.

#### 6. Edge cases

- **1 dot** in a category → just the dot, no stem.
- **2 vs 3+ dots** → N supported; connector spans min→max.
- **Negative values** → value axis includes zero when data crosses it; zero rule as bars.
- **Missing series for a category** → render present dots; connector spans what exists.
- **Exactly-coincident dots** → tiny dodge so both are visible; near-equal (non-coincident) dots are left as-is, distinguished by marker style.

### Tests & docs

- Golden-SVG fixtures mirroring bar/histogram fixture style: horizontal, vertical, faceted (quintiles + top-decile breakout), 2-dot, 3-dot, negative-crossing, missing-series, single-dot, `gap_annotation` on/off, each marker style.
- Unit test for `computeDumbbellValueExtent` (zero-crossing behavior).
- CONFIG-SPEC.md — new "Dumbbell options" section under the chart-type options.
- CHANGELOG entry.

---

## Out of scope (evaluated, not built)

The taxes-at-the-top request set contains three further notes. Per the cost/benefit review, none are built here:

- **`distribution-measure-simplification`** — asks for a reference dot/line targeting the top of a stacked segment. **Skip:** its real need (baseline-vs-ask comparison in one glance) is directly solved by the dumbbell above. The dollar-figures piece is self-described as not an engine gap (tool-side data threading).
- **`stack-static-vs-behavioral-overlay`** — asks for a paired slim/full bar mark and a user-mutable/drag-reorderable category order. **Keep custom (tool-side):** the paired-bar is a single tool's need, partly covered by the dumbbell (YAGNI for a second mark); drag-reorder + persistence is app interaction state, not the engine's static-spec mark model.
- **`frontier-line-and-live-marker`** — asks for plot-geometry exposure, a density/hexbin mark, a frontier/hull line mark, a live selection marker, and a tooltip opt-out. **Keep the visualization custom** (tool-specific; the source hand-rolls the entire scatter). **Future engine enhancement (noted, not planned here):** two sub-asks are genuinely general — exposing plot-area geometry (resolved scales + margins) from `mountChart`'s return value, and a hover/tooltip opt-out (or caller-supplied tooltip). Together they unlock a reusable "engine base + custom overlay" pattern for any tool. Worth a separate future ticket if a second tool needs it; not built now.

## Open questions resolved

From the dumbbell spec's "Open questions for the engine team":

1. **`series_marker` explicit vs. derived from `series_order`?** → Keep the explicit knob, consistent with how the engine handles `series_colors`/`series_labels` (explicit over convention).
2. **`gap_annotation` here vs. a general two-mark annotation?** → Dumbbell-local (YAGNI).
3. **Common vs. per-facet value scale default?** → Common, matching bars.
