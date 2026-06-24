# Scatter & Dot-Plot Chart Types — Design

**Date:** 2026-06-24
**Status:** Approved design; pending implementation plan.

## Goal

Add point-based chart types to the engine: data displayed as discrete markers
rather than lines or bars. Two distinct presentations, drawn from two reference
charts:

1. **`scatter`** — single pane, two numeric axes. Color encodes one categorical
   field and marker shape encodes a *second, independent* categorical field
   (e.g. color = Shock variant ×3, shape = Labor map ×3 → a 9-point grid with
   two side-by-side legends).
2. **`dotplot`** — categorical x-axis, numeric y, typically faceted into small
   multiples. Color and shape commonly encode the *same* series (redundant
   encoding for accessibility), shown as one combined legend of colored shapes.

Both are points at `(x, y)`; they differ in the x-scale and in whether the two
encoding channels point at the same field.

## Decisions

- **Two spec types** (`scatter`, `dotplot`), not one branching type — explicit
  at the spec surface.
- **Dual-encoding everywhere**: an independent color field and shape field are
  supported by both types. A chart opts into redundant encoding by pointing both
  channels at the same column (the dot-plot default).
- **Two-legend layout in v1.** Origin / L-shaped zero axes and per-point text
  labels are explicitly deferred to a follow-up.
- One shared mark builder implements both types (registered under both keys) to
  avoid duplication; the type only changes the x-scale.

## Spec surface

`src/spec/types.ts` and `src/spec/schema.ts`:

- `ChartType` gains `"scatter" | "dotplot"`.
- `ColumnMap` gains `shape?: string` — the column driving marker shape. The
  existing `series` column is reused as the **color** channel, so
  `series_colors` / `series_order` / `series_labels` work unchanged.
- New optional fields:
  - `shape_order?: string[]` — render order + inclusion filter for shape values
    (parallel to `series_order`).
  - `shape_labels?: Record<string, string>` — shape-value → display label
    (parallel to `series_labels`).
  - `color_legend_title?: string` and `shape_legend_title?: string` — explicit
    headings shown above each legend group (e.g. "Shock variant", "Labor map").
    Explicit fields rather than derived column names.

### Axis constraints (validation)

- `scatter` requires `xAxisType: "numeric"`.
- `dotplot` requires `xAxisType: "categorical"`.
- `validate.ts` enforces both; a mismatch is a spec error.

### Reused unchanged

`columns.value` (y), `columns.facet` + `small_multiples` (the dot-plot panes),
`xAxisPolicy`, `yAxisPolicy`, `series_*` (now the color channel).

## Mark builder — `src/engine/marks/point.ts`

`buildPointMarks(data, spec, ctx)` returns the standard `MarkLayers`. Registered
in `marks/index.ts` for **both** `scatter` and `dotplot`.

- A single `Plot.dot` with:
  - `x: ctx.xField`, `y: "_y"`
  - `fill: seriesField` (color channel) using the resolved color map
  - `symbol: shapeField` (shape channel) mapped through `MARKER_SYMBOLS`
  - `stroke: "#ffffff"`, thin stroke (matches existing line-point markers)
  - facet channels `fx`/`fy` bound when `ctx.fxField`/`fyField` are present
    (small multiples), exactly as `line.ts` does.
- **x-scale** is the only per-type difference:
  - `scatter` → numeric (linear) x, via the existing numeric x-adapter.
  - `dotplot` → categorical **point** scale (`{ type: "point", padding }`),
    reusing the logic `line.ts` already applies for categorical x.
- Marker symbols come from the shared `MARKER_SYMBOLS` order in `theme.ts` and
  the `symbolScaleOpts` channel already threaded through `MarkLayers`.
- When `shape` is omitted, all points use a single shape (circle) and no shape
  legend is emitted.

## Legend logic — the primary new work

`legend.ts` / the `LegendItem` model currently assume a single flat list. This
is the bulk of the implementation.

Rule, keyed on whether the two channels are the same column:

- **`shape` omitted, OR `shape` column == `series` column** → one **combined**
  legend of colored shapes. This is the existing `is-symbol` swatch behavior
  (line charts with point markers already render colored marker symbols).
- **`shape` column ≠ `series` column** → **two** legend groups side by side:
  1. Color legend — colored dots, headed by `color_legend_title`.
  2. Shape legend — neutral (gray) shapes, headed by `shape_legend_title`.

Changes required:

- Extend the legend data model to carry **two groups** with optional headings.
- Render group headings (a small label preceding each group's items).
- A shape-only legend group whose swatches are neutral-colored shapes (no fill
  color), distinct from the colored color-legend swatches.

## Interactivity (v1 scope)

- Points are tagged `data-series` by the **color** field, so the color legend's
  hover-dim / click-to-pin works as it does for existing charts.
- The **shape legend is static** in v1. Dimming by shape value is a follow-up.
- **No crosshair** for these types — a shared-x coordinated cursor does not fit
  a scatter. Per-point hover tooltips only.

## Chrome / axes

- Standard gridline frame (the L-shaped origin axes from the reference scatter
  are deferred).
- Numeric x reuses the existing numeric axis adapter.
- Categorical x reuses the band/point axis label layout (`wrap` / `rotate`
  collision handling).

## Testing

Snapshot tests via the `src/snapshot` harness:

1. Numeric `scatter` with two-field dual encoding + two legends (reference 1).
2. Faceted categorical `dotplot` with redundant color+shape, one combined
   legend (reference 2).
3. Single-series `scatter` with `shape` omitted (single shape, no shape legend).

Unit tests:

- `validate.ts`: the new type ↔ x-axis-type constraints (scatter→numeric,
  dotplot→categorical) accept valid specs and reject mismatches.
- Legend model: combined-vs-two-group selection given same vs. different
  color/shape columns.

## Deferred (explicit non-goals for v1)

- L-shaped origin axes (vertical line at x=0, horizontal baseline at y=0).
- Per-point text/value labels.
- Hover-dim / pin driven by the shape legend.
- Bubble encoding (marker size as a third channel).
