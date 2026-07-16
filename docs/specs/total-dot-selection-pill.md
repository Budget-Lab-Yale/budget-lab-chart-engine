# Spec: selecting the Total series shows a value pill at the net dot

Status: proposed · Target: patch/minor release · Author: The Budget Lab / drafted 2026-07-16

## Rule

On a diverging / net-dot stacked chart, selecting the **Total** legend row must draw a value
pill at each category's net dot, the same way selecting a segment series draws per-segment
value pills today. The Total pill's text is **black**, positioned **below the dot by default,
flipping above when there isn't room**.

## Current behavior (what changes)

Legend selection pills are drawn by `attachHighlightPills` (`src/engine/crosshair.ts:2421`),
driven by the legend's pinned/hovered active set (`setActive`). For stacked bars it reads rect
geometry per category and draws one pill per active series at the segment center
(`crosshair.ts:2550-2552` vertical, `:2542-2543` horizontal).

The diverging Total is a legend row tagged `TOTAL_SERIES_KEY` (`legendExtras`,
`marks/index.ts:172-176`), sharing that key with the net dot/label markers so it pins and dims
with them. But `attachHighlightPills` filters to series that have a **rect**
(`rects.filter(r => active.has(r.series))`, `crosshair.ts:2533`); the Total has no rect, so
selecting it draws nothing. That is the gap.

The hover band tooltip (1.3.2, `stacked-net-dot-hover-tooltip.md`) is a different gesture and is
**not** touched by this change.

## Design

In `attachHighlightPills`, after the existing per-segment loop, add a Total branch that runs
when `TOTAL_SERIES_KEY` is in the active set and `opts.showTotalDot === true`:

- **Net value per category:** sum the segment values already in `valByCat` for that category
  (the same sum the net dot represents), or read the dot's rendered position from the DOM
  (`g.tbl-net-label`/net-dot markers, tagged `data-series="${TOTAL_SERIES_KEY}"`,
  `render-live.ts:304`). Prefer reading the rendered dot position so the pill lands exactly on
  the marker regardless of rounding.
- **Color:** black (`TBL.color` mark-black `#000000`), not the segment fill.
- **Vertical placement:** center the pill on the dot's `cx`; default `y` = dot `y + gap`
  (below). If that would fall outside the plot bottom (`> mt + plotH - COORD_PILL_H`), flip to
  `dot y - gap` (above). Reuse the existing clamp/spread helpers so it never clips.
- **Horizontal placement:** at the dot's row center `y`; anchor just past the dot on its value
  side — `start` to the right when the dot is left of center, flipping to `end` on the left near
  the right edge (mirrors the single-bar horizontal pill anchor, `crosshair.ts:2545-2547`).
- **Composition:** the Total pill is additive. Selecting Total AND segment series shows both
  the segment pills and the Total pill. Selecting only Total shows only the Total pills.

Faceted panes: the pill path already runs per pane via the same handle; the Total branch keys
off `opts.showTotalDot`, which is threaded per pane (`render-live.ts:2059`), so total-dot panes
get Total pills and non-dot panes do not — no facet-specific wiring.

## QA

- `test/highlight-pills.test.ts` (or the band-crosshair suite): standalone diverging stack with
  `barStack.netDisplay: dot` — assert selecting Total (`setActive(new Set([TOTAL_SERIES_KEY]))`)
  produces one black pill per category at the net value; assert the pill flips above when the dot
  sits near the plot bottom.
- Regression: selecting a segment series still draws segment pills unchanged; a `netDisplay:
  text`/`none` stack draws no Total pill (Total row absent / no dot).
- Horizontal diverging stack: Total pill anchors past the dot, flipping side near the right edge.
- Gallery: extend the diverging-stack fixture note to mention selecting Total shows the net pill.
- `npm test`, `npm run typecheck`; goldens (static SVG) unaffected.

## Acceptance criteria

1. Selecting the Total legend row on a `netDisplay: dot` stack draws a black value pill at each
   category's net dot; below the dot by default, above when space is tight.
2. Selecting Total plus one or more segment series shows both sets of pills.
3. Horizontal orientation: Total pill sits just past the dot on its value side, flipping side
   near the frame edge.
4. `netDisplay: text`/`none` and plain/grouped bars: no Total pill; existing segment-pill
   behavior unchanged.
5. Hover band tooltip behavior (1.3.2) is unchanged.
