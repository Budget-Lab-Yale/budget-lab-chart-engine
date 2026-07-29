# Line-to-axis area shading

**Date:** 2026-07-29
**Repo:** `Budget-Lab-Yale/budget-lab-chart-engine`
**Status:** Design approved, pending implementation plan.

## Background

Line charts can fill nothing. A `line` chart draws strokes (`src/engine/marks/line.ts`) plus
optional confidence bands — `Plot.areaY` with `y1: "_lo", y2: "_hi"` at `fillOpacity: 0.18`,
pushed into `layers.underlay` so it paints behind the gridlines. There is no way to fill the
region between a line and its baseline, which is the standard way to give a single series weight
(net deficit vs. surplus, a cumulative gap) without switching to `chartType: area` — and `area` is
a *stacked* mark that forces a zero baseline and a white hairline separator, so it is not a
substitute for "shade under this one line, on this side, over these years."

The engine already has the two adjacent pieces this borrows from:

- `annotations.bands` (`XAxisBand`: `start`, `end`, `label?`, `color?`) — shaded **vertical**
  x-regions spanning the full y-domain, drawn at the very back of `assemblePlot` (step 0). x edges
  are resolved through the x-adapter's `markerToX`, which returns `null` on a categorical band
  scale.
- `splitProjectedRuns` (`src/engine/marks/projected.ts`) — splits a series into maximal runs on a
  per-row boolean, tagging each with a `_seg` key so `Plot.line`'s `z` grouping cannot bridge the
  gap between disjoint runs.

## Goals

1. Fill the region between a line and its baseline, per series.
2. Restrict a fill to the **positive** or **negative** side of zero.
3. Restrict a fill to specific **x ranges**.
4. Multiple independent fills per chart, including several on one series with different tints.
5. Exact x edges: a range boundary between two data points renders where the author asked, not at
   the nearest point.

## Non-goals (v1)

- Chart types other than `line`. `area` already fills to the axis; bar/stacked/waterfall/
  histogram/dumbbell/scatter/dotplot have no line to fill under.
- Facet-scoped regions (no `facet` key). Matches `annotations.bands`, which is also global.
- A legend entry per region. Shading is chrome belonging to its series.
- Shading between two series (that is what `confidence_bands` is for).
- Expanding the y-domain to bring zero into view (see Baseline below).
- Labels on regions.

## Architecture

**Compute the fill geometry in data space, as a pure function, then hand runs to `Plot.areaY`.**
This matches how the engine already treats every other derived shape: a pure module turns prepared
rows into a run/segment model, and the mark builder is a thin translation of that model into Plot
calls. The x-range crop and the side split are both "cut this sequence, interpolating at the cut"
operations, so they share one implementation.

**Rejected alternative — SVG clip rects.** Draw one full line-to-baseline area per series and clip
it to `[from, to] × [0, yMax]` (or `[yMin, 0]`). Geometrically exact for free, and no interpolation
code at all: a dip below zero inside a `side: positive` region is removed by the `y ≥ 0` clip
exactly as it should be. Rejected because Plot's `clip` option accepts only `"frame"` and
`"sphere"` (`Kd()` in the vendored bundle normalizes `true` → `"frame"`), so arbitrary clip rects
require post-render DOM surgery. The engine keeps geometry declarative inside the mark pipeline;
going around it would also complicate PNG export (`XMLSerializer` on the live SVG) and the
`data-series` tagging the legend relies on. The data-space version costs roughly 60 lines and is
unit-testable without a DOM.

## Design

### 1. Spec surface

New optional top-level `shading`, a list of independent regions:

```yaml
chartType: line
shading:
  - series: Deficit          # omitted → every in-scope series gets its own fill
    side: negative           # both (default) | positive | negative
  - series: Deficit
    from: 2026               # omitted → the series' first point
    to: 2030                 # omitted → the series' last point
    color: gray              # omitted → the series' own resolved color
    fillOpacity: 0.18        # default; matches confidence bands
```

```ts
export interface ShadeRegion {
  /** Series to fill under. Omitted → every in-scope series gets its own region. */
  series?: string;
  /** Which side of ZERO to fill. Default "both". */
  side?: "both" | "positive" | "negative";
  /** Inclusive x lower bound, in the same string form as annotations.bands `start`. */
  from?: string;
  /** Inclusive x upper bound. */
  to?: string;
  /** Named palette color or "#hex". Default: the series' resolved color. */
  color?: ColorRef;
  /** Default 0.18. */
  fillOpacity?: number;
}
```

Entries are independent and paint in list order. Two entries covering the same x range on the same
series deliberately double up their opacity — that is the way to deepen a tint, so it is allowed
rather than detected.

### 2. Baseline

```
baseline = clamp(0, yDomain[0], yDomain[1])
```

Zero when zero is inside the resolved domain; otherwise the nearer domain edge. Consequences:

- On the ordinary zero-baseline chart, this is just zero.
- On a truncated axis (`yAxisPolicy: {min: 40, max: 70}`) the fill bottoms out at 40, so **the fill
  never leaves the frame** and shading has no dependency on the mark-clip work.
- It does **not** expand the domain. A chart that wants the zero baseline visible sets
  `yAxisPolicy.includeZero: true` explicitly. Letting a fill silently rewrite the axis would make
  the axis depend on decoration.

The side filter always keys off **zero**, never off `baseline`. On a domain entirely above zero
every point is positive, so `side: positive` fills everything and `side: negative` fills nothing —
coherent, and the validation below catches the case where that is provably a mistake.

### 3. `src/engine/shade.ts` — the pure core

```ts
export interface ShadeRun {
  /** Points of one contiguous fill segment, in x order, with `_seg` set. */
  rows: PreparedRow[];
}

export function buildShadeRuns(
  points: PreparedRow[],          // ONE series' rows, x-ordered, finite `_y` only
  xField: "_xn" | "_xd" | "_xc",
  opts: {
    side: "both" | "positive" | "negative";
    /** Already parsed through the x-adapter by the caller; null = open-ended on that end. */
    from: number | Date | string | null;
    to: number | Date | string | null;
  },
): ShadeRun[];
```

The function takes `side` and the **parsed** bounds, never the raw `ShadeRegion` — string parsing
and color/opacity resolution stay in `line.ts`, so the core has no dependency on the spec shape.

Three stages:

1. **Crop to `from`/`to`.** Drop points outside the bounds. Where a bound falls *strictly between*
   two retained/dropped neighbours, insert a synthetic point at exactly that x, with `_y`
   interpolated linearly along the segment. A bound landing exactly on a point inserts nothing.
   Numeric (`_xn`) and temporal (`_xd`, interpolated on epoch ms) only.
   **Categorical (`_xc`)** has no between-points position, so it crops by category order and
   interpolates nothing; `from`/`to` must name existing categories (enforced in validation).
2. **Side split.** For `positive`/`negative`, walk the cropped sequence and cut it into maximal
   runs whose values are on the requested side of zero. At each sign change, insert a synthetic
   point at the interpolated zero crossing with `_y = 0`, so adjacent runs meet the axis exactly
   and the fill closes flat on the baseline instead of ending on a slanted edge.
   A point whose value is **exactly zero** is included as the closing (or opening) point of an
   adjacent run — it *is* the boundary, and no crossing needs to be synthesized there — but it never
   forms a run on its own, so a series that merely touches zero without crossing yields one run, not
   two. `side: "both"` yields a single run (the crop, unsplit).
3. **Tag.** Each run gets a distinct `_seg` value so `Plot.areaY`'s `z` grouping keeps disjoint
   runs as separate paths.

Pure: no DOM, no `Date.now`, no scale access — bounds arrive pre-parsed from the caller.

### 4. Mark emission in `line.ts`

For each region × resolved series, push into **`underlay`**:

```ts
Plot.areaY(run.rows, {
  x: xField,
  y1: baseline,
  y2: "_y",
  z: "_seg",
  fill: regionColor,
  fillOpacity: region.fillOpacity ?? 0.18,
  className: SHADE_CLASS,
  defined: (r) => Number.isFinite(r._y),
  ...facetChannels,
  ...clipOpt,
})
```

- **`underlay`** puts shading behind the gridlines (`assemblePlot` step 1, before gridlines), like
  confidence bands, so gridlines stay legible over the fill.
- **Paint order within `underlay`:** shading first, then confidence bands. Shading is the broader,
  subtler layer; a CI band is more specific and should read on top of it.
- **`className`** is required for tagging: shade marks and CI bands both render as
  `g[aria-label="area"]`, so the tagging selector must be `g.<SHADE_CLASS> path` to avoid dimming
  one when the legend means the other. Note Plot puts `class` on the **inner** `<g>` when a mark is
  clipped (`aria-label` and `clip-path` go on the wrapper), so the selector must stay a descendant
  selector.
- Shade paths carry `data-series` through the existing `tagging` mechanism, so legend hover / pin /
  dim covers them with no new wiring.
- `...clipOpt` for consistency with the other line marks. With the clamped baseline it should be a
  no-op, but a region is not special-cased out of the chart's clip.
- Bounds are resolved once in `line.ts` via the x-adapter (`markerToX`-equivalent parsing), matching
  how `annotations.bands` resolves `start`/`end`.

Shading is independent of dash and projected-run treatment — it reflects values, not line style. To
stop a fill at the forecast boundary, scope it with `from`/`to`.

### 5. Validation

Structural, in `schema.ts` (`SHADE_REGION`, `additionalProperties: false`): `side` enum;
`fillOpacity` in `[0, 1]`; `from`/`to`/`series`/`color` strings.

In `validateSpec` (spec-only):

- `shading` present with `chartType !== "line"` → error.

In `validateChartData` (has `rows`, alongside the existing `confidence_bands` cross-refs):

- `shading[].series` not found in the data → error, worded like the `confidence_bands` check.
- Categorical x: `from`/`to` naming a category the x column lacks → error, worded like the
  `x_order` check.
- **`side` that provably selects nothing** → error: `side: negative` where every in-scope value for
  that series is `>= 0`, or `side: positive` where every value is `<= 0`. This is the real authoring
  mistake, and it is decidable from the data without knowing the resolved domain. `ValidationResult`
  carries only `valid` + `errors` (no warnings channel), so this is an error rather than a warning;
  adding a warnings channel would touch every caller and is out of scope here.

### 6. Testing

Pure tests on `shade.ts` carry the weight:

- Crop: bound between points interpolates; bound exactly on a point does not; bound outside the data
  is a no-op; `from` > `to` yields nothing; open-ended `from`/`to`.
- Side split: all-positive, all-negative, single crossing, multiple crossings, a point exactly at
  zero, a series that touches zero without crossing, single-point input, empty input.
- Crop and side split composed, with a bound landing inside a negative run.
- Temporal x interpolation on epoch ms; categorical crop by order with no interpolation.

Render tests:

- Mark presence and count per region; `fill` / `fillOpacity` resolution including `color` override.
- Paint order: shading behind gridlines, and before confidence bands within `underlay`.
- `data-series` tagging targets shade paths without touching CI band paths.
- Truncated axis: shading marks carry the chart's clip reference.
- Small multiples: each pane emits its own shading.

Validation tests for each error above.

### 7. Files

| File | Change |
|---|---|
| `src/spec/types.ts` | `ShadeRegion`, `shading?: ShadeRegion[]` on `ChartSpec` |
| `src/spec/schema.ts` | `SHADE_REGION` + `shading` property |
| `src/spec/validate.ts` | chartType gate; series / categorical-bound / empty-side cross-refs |
| `src/engine/shade.ts` | **new** — `buildShadeRuns`, pure |
| `src/engine/marks/line.ts` | resolve bounds + baseline, emit `areaY` runs into `underlay`, tagging |
| `CONFIG-SPEC.md` | `shading` table + the baseline and side-vs-zero semantics |
| `CHANGELOG.md` | Unreleased → Added |
| `test/shade.test.ts` | **new** — pure algorithm |
| `test/shading-render.test.ts` | **new** — marks, paint order, tagging, clip, facets |
