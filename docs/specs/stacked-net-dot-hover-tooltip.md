# Spec: total-dot stacked charts hover with the band tooltip, not value pills

Status: proposed · Target: minor release (can ride 1.4.0) · Author: The Budget Lab / drafted 2026-07-15

## Rule

When a bar chart shows the Total dot, hover must present the floating band tooltip — not the
per-segment value pills. "Total dot shown" is exactly `showTotalDot === true`, which only a
`stacked` chart produces when `barStack.netDisplay` resolves to `dot`
(`src/engine/marks/stacked.ts:133-144, 404-408`). Plain and grouped bars never set it and are
unaffected — they keep the pill behavior introduced in 1.3.0.

## Motivation

Since 1.3.0 every standalone bar/stacked chart hovers with the in-place shade +
per-segment value pills (CHANGELOG 1.3.0 "Changed — bars"; extended to single-facet figures
in 1.3.1). On a diverging stack with the net dot, that reads badly: the pills label each
segment but the *net* — the number the dot exists to communicate — has no pill, and the
per-segment chips crowd the dot and its permanent labels. The band tooltip already has a
purpose-built Total row with the dot swatch (`buildBandTooltipHtml`,
`src/engine/crosshair.ts:834-847`); it is the right hover surface whenever the dot is on.

## Current selection logic (what changes)

Pills vs tooltip is decided solely by `emitOnly`/`useCoord`, never by `showTotalDot`:

- Standalone categorical charts always take the pill path: `attachBandCrosshair(..., emitOnly:
  true)` at `src/engine/render-live.ts:994`, `attachHighlightPills` at :1013,
  `attachSecondaryBandCursor` at :1024.
- Faceted: `useCoord = ctx.onResolve != null` (`render-live.ts:1628`); `onResolve` is passed
  when `coordinated = sm.coordinated_cursor !== false && (panes > 1 || isCategoricalBarFig)`
  (`render-live.ts:2016-2017`). So the tooltip is only reachable for bars today via
  `small_multiples` + `coordinated_cursor: false`.
- `showTotalDot` is threaded all the way through (`MarkLayers` → `RenderResult` →
  `draw()`/:814, panes `figure.ts:484,520,621,657`, `ctx.showTotalDot`
  `render-live.ts:1540,1691,2043`) but today only styles the tooltip's Total row.

## Design

### Standalone charts (`render-live.ts:967-1040`)

Branch on `showTotalDot` (already in scope, :814) at the top of the categorical block:

- `showTotalDot === true` → call `attachBandCrosshair` in visible mode (omit `emitOnly`;
  same args as the existing :994 call — rows, categories, colors, seriesLabels, seriesOrder,
  yFormat, `orientation`, `showTotalDot`). Do NOT attach `attachSecondaryBandCursor`, and
  drop the `onResolve` → `setSuppressedCategory`/`secondaryDriver` wiring (:1008-1011); the
  visible crosshair manages its own band highlight.
- otherwise → existing pill path, unchanged.

Keep `attachHighlightPills` (:1013) in both modes: legend hover/pin pills are a different
gesture (legend-driven, not band-hover-driven) and the Total dot is a tagged
`TOTAL_SERIES_KEY` series there, so legend-hovering "Total" still pills the net values.

### Faceted figures (`render-live.ts:1628, 1671-1746, 2016-2017`)

The rule is unconditional — a pane whose stack shows the net dot hovers with the tooltip:

- In `wireFigureSvg`'s categorical branch, force the tooltip when `ctx.showTotalDot === true`:
  attach `attachBandCrosshair` visible (as in the `!useCoord` path today, :1688-1703) and
  skip `attachSecondaryBandCursor`.
- Cross-pane coordination: keep the band *echo* without pills. `attachSecondaryBandCursor`
  currently does shade + pills as one unit (:1860-2048); add a `pills: false` (shade-only)
  option so sibling panes still shade the hovered category while the hovered pane shows its
  tooltip. The hovered pane still emits `onResolve` — pass it alongside visible mode (today
  they're mutually exclusive via the `useCoord` ternary at :1688-1703; the attach API already
  supports `onResolve` independent of `emitOnly`).
- The figure-level `coordinated` gate (:2016) stays as is — coordination remains on; only the
  pill rendering is swapped for tooltip + shade-only echo in total-dot figures.

No config surface changes: `coordinated_cursor: false` keeps meaning "no coordination at
all" (per-pane tooltips), and there is deliberately no opt-out back to pills when the dot is
shown — the rule is a house style, not a preference.

## Interaction with the faceted-horizontal-stacked spec

`docs/specs/faceted-horizontal-stacked.md` adds horizontal stacked panes. If both land in
1.4.0, a faceted horizontal diverging stack with `netDisplay: dot` gets: net dot r: 7 in
panes (that spec) + tooltip-not-pills hover (this spec). Implement this spec's gate on
`showTotalDot`, not on orientation, and the two compose without coordination.

## QA

- `test/band-crosshair.test.ts`: add a standalone diverging-stack (`netDisplay: dot`) case
  asserting a `.tbl-tooltip` appears on hover with the `is-dot` Total row and that NO
  `addCoordPill` output exists (invert the pattern of the "no tooltip" assertions at
  :609-699, :752-800 — those cover single-series bars and must keep passing unchanged).
- Cumulative stack (`showTotalDot === false`) and plain/grouped bars: assert pills still
  attach (regression guard on the gate).
- Faceted: total-dot figure pane hover shows tooltip; sibling panes shade without pills;
  `coordinated_cursor: false` behavior unchanged.
- Gallery: extend the existing diverging-stack fixture's `note:` to say hover should show
  the tooltip with the Total row; visual pass via `npm run gallery`.
- Goldens are static SVG — unaffected; `npm test`, `npm run typecheck`.
- CHANGELOG under `### Changed — bars`: total-dot stacks hover with the band tooltip
  (partial, deliberate revert of the 1.3.0 pill change for this case).

## Acceptance criteria

1. Standalone diverging stacked chart with `netDisplay: dot` (or `auto` with negatives):
   hovering a category shows the floating tooltip with per-series rows and the circle-swatch
   Total row; no per-segment value pills appear.
2. Same chart with `netDisplay: text`/`none`, and any plain or grouped bar chart: hover
   pills unchanged.
3. Legend hover/pin pills (`attachHighlightPills`) work in both modes, including on the
   Total series.
4. In a multi-pane total-dot figure, the hovered pane shows the tooltip and sibling panes
   echo the category shade without pills; with `coordinated_cursor: false` every pane
   tooltips independently (existing behavior).
5. Existing tests for single-series/grouped pill hover pass unmodified.
