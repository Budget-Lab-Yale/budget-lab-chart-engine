# Histogram chart type

**Date:** 2026-07-20
**Repo:** `Budget-Lab-Yale/budget-lab-chart-engine`
**Status:** Design approved, pending implementation plan.

## Background

The engine renders config-driven charts (Observable Plot 0.6.16 + D3) from a tidy long
dataset. Chart types are `line | area | bar | stacked | scatter | dotplot | waterfall`
(`src/spec/types.ts`). There is **no histogram**: `bar` always builds a **categorical band
scale** from distinct string x-values (`src/engine/marks/bar.ts` — `catField = xField`, band
domains, fixed `paddingInner: 0.2`), regardless of `xAxisType`. So a bar chart of numbers spaces
each distinct value evenly with gaps — it cannot place bars *by value* on a continuous axis, size
them to bin ranges, or make them touch. The engine also has no data binning and no
value-positioned rect mark for data.

## Goals

1. A first-class `histogram` chart type on a **continuous** x-axis (numeric or temporal).
2. **Bin raw data** in the engine, with author control over bin width or bin count and a sensible
   auto default.
3. **Accept pre-binned data** (author supplies bin edges + heights) through the same model.
4. **Faceted and unfaceted** (reuse `columns.facet` + `small_multiples`).
5. **Multiple series overlapping** on shared axes (translucent, shared bins).
6. Optional **normalization** (proportion / density) so different-sized series compare fairly.

## Non-goals (v1)

- Stacked or grouped (dodged) histograms — overlapping only.
- Horizontal orientation.
- 2-D / heatmap binning; cumulative (CDF) mode.
- Crosshair / coordinated cursor (those are x-point oriented, not bin oriented).

## Architecture

**Pre-compute bins in the data layer; render with a continuous-x rect mark.** This matches the
engine's existing shape — *normalize data → deterministic tidy model → render + interactivity off
that model*. A pure binning module turns raw tidy rows into binned tidy rows carrying bin edges +
height; the existing pane/mark/legend/tooltip/download pipeline then operates unchanged. Pre-binned
data enters the same model directly.

Rejected alternative — Observable Plot's `Plot.binX` transform at render time: it bins inside the
SVG, so the tidy model (hence tooltips, downloads, tag-based legend dimming) never sees bins;
shared thresholds across series/facets still need explicit threshold arrays; and pre-binned data
needs a separate render path. Two paths and weaker determinism.

## Design

### 1. Spec surface

`ChartType` gains `"histogram"`. `xAxisType` is `numeric` or `temporal` (validated; other values
rejected for histograms). New optional `histogram` config block:

```yaml
chartType: histogram
xAxisType: numeric
columns: { x: amount, series: scenario, facet: region }   # raw data
histogram:
  bins: 20                 # optional bin COUNT
  binWidth: 5              # optional bin WIDTH (number; temporal: number of days OR an interval name)
  domain: [0, 100]         # optional explicit binning range (else data extent)
  normalize: none | proportion | density   # default none (raw count)
  weight: value            # optional column summed per bin (weighted); default = row count
```

Binning precedence: `binWidth` > `bins` > **auto** (Freedman–Diaconis bin width; Sturges fallback
when the IQR is 0). All deterministic given the data — no `Date.now`/random, consistent with the
engine's golden-snapshot discipline.

Temporal `binWidth` accepts a calendar interval (`day | week | month | quarter | year`, via the
d3-time bundled with Plot) or a plain number interpreted as days. Temporal bin edges are computed
on epoch-ms and rendered on a time scale.

### 2. Pre-binned mode

Detected when both `columns.x0` and `columns.x1` (new role columns for bin edges) are mapped;
`columns.value` is then the bar height. Binning config (`bins`/`binWidth`/`domain`/`weight`) is
rejected by validation in this mode (it would be ignored). `normalize` still applies, computed from
the provided heights. The resulting tidy rows are identical in shape to the binned path, so series,
faceting, tooltips, and axes behave the same.

### 3. Data model

`PreparedRow` (`src/engine/marks/index.ts`) gains bin-edge fields:

- `_x0`, `_x1`: bin edges — `number` (numeric axis) or epoch-ms (temporal). `_y` is the bin height
  (count, weighted sum, or provided value; after normalization when requested).

A new pure module `src/engine/histogram-bin.ts` exports the binning transform:

- Input: raw tidy rows, resolved columns, `histogram` config, `xAxisType`, and a threshold scope
  (all-data for shared, per-facet-subset for per-pane).
- Steps: parse x (numeric/temporal) → resolve the binning domain → compute **one shared threshold
  array** → assign each row to a bin → aggregate per (bin × series) as count or weighted sum →
  apply normalization → emit binned `PreparedRow`s (`_x0`,`_x1`,`_y`,`series`,`_facet`).
- Output also returns the threshold array + domain so the axis can span exact edges.
- Deterministic and independently testable (no DOM, no Plot).

Binning runs on the **full dataset before pane splitting** so thresholds are shared across series
and (in `shared` facet mode) across panes; in `per-pane` mode thresholds are computed per facet
subset. This slots into the orchestration in `src/engine/figure.ts` / `src/engine/index.ts`
(`renderPane`) ahead of the existing per-pane prep, which then consumes binned rows.

### 4. Rendering & overlapping series

New `src/engine/marks/histogram.ts` (`buildHistogramMarks`) draws one `Plot.rectY` per series with
`x1 = _x0`, `x2 = _x1`, `y = _y`, filled by series color. Bars touch (edge-to-edge; no band
padding). Multiple series overlay with `fill-opacity ≈ 0.5`, z-ordered by `series_order`; the shared
bin edges make the overlap read cleanly. Standard top/right legend with click pin/dim (rects tagged
`data-series`, mirroring the bar mark's tagging). Single-series honors `bar_color`.

### 5. Faceting

Reuses `columns.facet` + `small_multiples`. `shared` mode (default): one global threshold set and a
shared x/y scale, so panes are directly comparable. `per-pane` mode: thresholds and scales computed
per pane. Bars, legend, and pane chrome reuse the existing small-multiples machinery.

### 6. Axis

A histogram-aware **continuous** x path in `src/engine/x-adapter.ts`: linear scale (numeric) or
time scale (temporal), domain = `[first edge, last edge]`, **nice ticks** from the existing
numeric/temporal tick logic (ticks are not forced onto bin edges). y-axis is count or normalized
(proportion: each series sums to 1; density: area = 1, dividing by bin width so unequal widths are
handled). Existing y-axis policy (`min`/`max`/`includeZero`/`tickCount`) applies; histograms default
to `includeZero: true`.

### 7. Interactivity

Per-bin hover tooltip via the existing tooltip layer: the hovered bin shows its range `[x0, x1)` and
each in-scope series' value. Legend pin/dim reuses the shared mechanism. Data download emits the
binned rows (edges + heights). Crosshair/coordinated-cursor are out of scope (v1).

## Files touched

| File | Change |
|---|---|
| `src/spec/types.ts` | `ChartType += "histogram"`; `ColumnMap += x0`, `x1`; new `histogram` config block; `weight`. |
| `src/spec/schema.ts` | Schema for the `histogram` block + `x0`/`x1` roles (strict `additionalProperties`). |
| `src/spec/validate.ts` | Histogram rules: x must be numeric/temporal; bin config sanity; pre-binned requires `x0`+`x1`+`value` and forbids bin config; overlapping requires a series column; normalize enum. |
| `src/spec/columns.ts` | Resolve `x0`/`x1` roles; detect pre-binned mode. |
| `src/engine/histogram-bin.ts` | **New.** Pure, deterministic binning + aggregation + normalization; returns binned rows + thresholds. |
| `src/engine/marks/histogram.ts` | **New.** `buildHistogramMarks` (rectY on `_x0`/`_x1`, overlap opacity, tagging). |
| `src/engine/marks/index.ts` | Register `histogram`; add `_x0`/`_x1` to `PreparedRow`. |
| `src/engine/x-adapter.ts` | Continuous-x histogram path (linear/time; domain from bin edges). |
| `src/engine/index.ts` / `figure.ts` | Invoke binning before pane split (shared vs per-pane thresholds); thread binned rows + edge domain through `renderPane`. |
| `src/engine/assemble-plot.ts` | Histogram y-extent + chrome wiring (gridlines, zero baseline, tooltip). |
| `CONFIG-SPEC.md` / `CHANGELOG.md` | Document `histogram` type + block; version bump (minor — additive). |

## Testing

- **Binning unit tests** (`histogram-bin.ts`): fixed `binWidth`; fixed `bins`; auto (FD/Sturges);
  explicit `domain` clipping; weighted sums; normalize `proportion` (series sums to 1) and `density`
  (area = 1); temporal binning (calendar intervals + day counts); shared vs per-pane thresholds;
  empty/degenerate input (all-equal values, single row).
- **Pre-binned tests**: `x0`/`x1`/`value` flow through unchanged; bin config rejected by validation;
  normalize still applies.
- **Validation tests**: non-numeric/temporal x rejected; missing series for multi-series overlap;
  pre-binned missing an edge column; conflicting pre-binned + bin config.
- **Mark/render tests** (jsdom): rects positioned at bin edges (touching); overlap opacity present;
  `data-series` tagging order; single-series `bar_color`.
- **Golden SVG fixtures**: unfaceted single-series, overlapping multi-series, faceted (shared +
  per-pane), temporal, pre-binned. Assert existing non-histogram goldens are byte-identical.
- **Export parity**: PNG/SVG export of a histogram matches the live DOM.

## Edge cases

- All values identical / zero-range domain → a single bin (or a small nominal width); never divide
  by zero.
- Bins with zero count render as empty slots (no rect), preserving the continuous axis.
- Values on a bin boundary use half-open `[x0, x1)` bins; the last bin is closed `[.., max]`.
- `binWidth` that doesn't divide the domain evenly → the final bin is shorter (closed on max).
- Pre-binned rows with gaps/overlaps between edges are drawn as given (author's responsibility);
  validation only checks `x1 > x0` per row.

## Rollout

1. Implement per the plan; add fixtures; `CHANGELOG` + minor version bump.
2. Document `histogram` in `CONFIG-SPEC.md` (spec surface, binning, pre-binned, normalize,
   temporal intervals, overlap).
3. Downstream (`budget-lab-charts`): bump the pinned engine; document in `CONFIG-REFERENCE.md`.
