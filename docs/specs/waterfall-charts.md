# Spec: waterfall charts

Status: proposed · Target: minor release · Author: The Budget Lab / drafted 2026-07-16

## Rule

Add a new `chartType: "waterfall"`: a categorical, vertical-only bar chart whose bars float on
a running cumulative, with optional absolute total bars and per-step connectors. Single frame
and faceted (small-multiples) figures are both supported. Styling stays close to the existing
bar charts (same chrome, axes, value-label callout, hover surface).

The two target figures are the "April 2 price decomposition" waterfalls (Figure 3a/3b), rendered
as **two facets in one figure**: a gray opening total bar, a series of blue descending steps,
dotted connectors, running-total labels, a yAxis-annotation reference-line band, and — in one
facet — a "(no step in original)" placeholder where the other facet has a bar.

## Data model

New builder `buildWaterfallMarks` (`src/engine/marks/waterfall.ts`), registered in
`src/engine/marks/index.ts`. No series channel — one bar per step. Column roles (`columns`):

| role    | required | meaning |
|---------|----------|---------|
| `x`     | yes      | step / category (the band axis) |
| `value` | yes      | signed **delta** for delta rows; explicit **absolute** for total rows (optional there) |
| `kind`  | no       | row-type flag column; values `delta` (default), `total`, `skip` |
| `label` | no       | text for `skip` rows (the italic placeholder); falls back to `waterfall.skipLabel` |
| `facet` | no       | pane split (small multiples) |

Cumulative is computed **per pane**, in category (declaration) order, with `running` starting at 0:

- **delta** row: bar spans `running → running + value`; then `running += value`.
- **total** row with an explicit `value`: bar spans `0 → value`, and `running` is **set** to
  `value` (handles an opening balance and explicit checkpoints).
- **total** row with blank `value`: bar spans `0 → running` (auto subtotal / ending total);
  `running` unchanged.
- **skip** row: no bar drawn; the category slot is **kept** in the band domain (so facets stay
  aligned) and an italic placeholder label is rendered centered in the empty column, text from
  the `label` column else `waterfall.skipLabel` (default `"(no step in original)"`). `running`
  unchanged.

## Coloring

Default is **semantic**, resolved per bar by direction:

- increase (`value > 0`) → blue `#0072B2`
- decrease (`value < 0`) → red `#B8302C`
- total → navy `#101F5B`

Overridable at two levels (each resolved through the palette / color names):

- **Globally** via `waterfall.colors: { increase, decrease, total }` — any subset.
- **Per bar** via the existing `category_colors` (keyed by the x category), which wins over the
  semantic/global color for named categories.

(The Figure 3a/3b house style — all steps blue regardless of direction, gray opening total — is
reproduced by overriding `decrease` to blue and `total` to gray, or per bar via
`category_colors`.)

## Connectors

Thin **dotted** rules linking each bar's end level to the next bar's start level, on by default.

- `waterfall.connectors: boolean` (default `true`).
- `waterfall.connectorColor` (default the dim neutral, `TBL.color.annotationDim`).
- Connectors skip across `skip` rows (connect the bar before to the bar after the gap).

## Value labels

Two surfaces, per the design:

- **Always-on** (`valueLabels.show: true`): the **running total** (cumulative-so-far) at each
  step, reusing the existing callout label style (`theme.ts` value-label constants). Placement:
  - positive step → **above** the bar top;
  - negative step → **below** the bar bottom;
  - total / opening bar → **above**, **bold**.
  - `valueLabels.decimals` / `valueLabels.signed` apply as for bars (running totals are typically
    unsigned).
- **Hover:** a floating tooltip (reuse `getSharedTooltip`) showing the **delta** (signed) and the
  **running total**; the delta is also shown **on the bar itself** on hover.

## Faceting

Reuse the shared small-multiples mode (the chart-type-agnostic orchestrator in `figure.ts` /
`render-live.ts`, as bars/stacked do). Panes share the value (y) axis and the categorical (x)
band domain; `skip` rows keep a facet's missing step aligned to the shared band. Cumulative is
computed independently within each pane.

## Axes and annotations

- `xAxisType` forced categorical; vertical only.
- **Value-axis auto-domain must span the cumulative path**, not the raw deltas: the builder
  computes each bar's base/top (including intermediate lows/highs and total bars) and feeds the
  min/max (with 0) through the existing `yDomain` plumbing (`MarkContext.yDomain` /
  `MarkLayers`). This is the main implementation risk — the default extent logic sees only `_y`
  delta values otherwise.
- Horizontal reference lines with left italic labels (the Cavallo / Minton / Dvorkin lines) are
  the existing yAxis `annotations` (dashed, per-color, `facet`-scoped) — no new surface; confirm
  they compose with the waterfall value axis.

## Config surface (schema additions)

- `chartType` enum gains `"waterfall"` (`src/spec/schema.ts:242`).
- `columns` gains `kind` and `label` string roles (`schema.ts:245-256`).
- New `waterfall` object: `colors: {increase, decrease, total}`, `connectors: boolean`,
  `connectorColor: string`, `skipLabel: string`.
- `validate.ts`: reject `orientation: "horizontal"` for waterfall; require `xAxisType`
  categorical; validate `kind` values ∈ {delta, total, skip}.

## QA

- Gallery fixtures: (1) a single-frame waterfall (opening total → deltas → ending total,
  semantic colors, connectors, running-total labels); (2) the two-facet Figure 3a/3b
  reproduction (shared axes, blue-step + gray-total override, a `skip` row with the "(no step in
  original)" placeholder, and the three reference-line annotations).
- Unit: cumulative computation (delta / total-explicit / total-blank / skip); value-axis extent
  spanning the cumulative path; connector geometry across a skip; semantic vs override coloring.
- Interaction: hover shows delta + running total and the on-bar delta; always-on running-total
  label placement (above positive, below negative, bold above the total bar).
- Faceting: two panes, shared value + category axes, per-pane cumulative, skip alignment.
- `npm test`, `npm run typecheck`, `npm run gallery`.

## Acceptance criteria

1. `chartType: "waterfall"` renders a vertical waterfall: delta bars float on the running
   cumulative; `kind: total` bars anchor at 0 (explicit value rebases `running`, blank value =
   auto cumulative).
2. Default colors are semantic (blue increase / red decrease / navy total); `waterfall.colors`
   and `category_colors` override globally and per bar.
3. Dotted connectors link consecutive bars by default, skipping across `skip` rows; toggle and
   color are configurable.
4. Always-on labels show the running total (above positive steps, below negative, bold above the
   total bar); hover shows the delta + running total, with the delta on the bar.
5. `kind: "skip"` draws no bar, keeps the category slot aligned across facets, and renders the
   italic placeholder label.
6. Two-facet figures share the value and categorical axes with independent per-pane cumulatives;
   yAxis reference-line annotations render as today.
7. The Figure 3a/3b screenshots are reproducible from a single spec + data (with the color
   overrides noted above).
8. `orientation: horizontal` is rejected in validation.
