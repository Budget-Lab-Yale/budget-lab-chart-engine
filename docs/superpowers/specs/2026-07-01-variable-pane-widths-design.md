# Variable pane widths for faceted (vertical bar) charts

Status: approved 2026-07-01.

## Problem

Faceted small-multiples currently give every pane the same inner data width (`sharedColumnWidths`
forces an identical `dataW` per column). When panes hold different numbers of bars, the bars render
at different widths — a pane with more categories has thinner bars. Authors want control over how a
row's width is split among its panes.

## Goal

Add `small_multiples.pane_widths` controlling per-column width distribution (applied to every row of
a shared-column grid):

- `equal` (default) — present behavior (equal data width per column).
- `equal-bar` — each column's width ∝ its bar count, so bars render at the same width. Exact for a
  single row; for multiple rows each column is sized to the **max** bar count among its panes.
- `[..]` (number array) — explicit per-column proportions, length == column count, applied to all
  rows. E.g. `[2, 1]` → column 0 twice as wide as column 1, every row.

## Non-goals

- Per-row *different* proportions (rows share one column template — the deliberate simplification).
- Horizontal bar facets / non-bar types (they keep equal width).
- Per-pane (as opposed to per-column) widths.

## Approach

Keep the single shared-column grid and the existing width → live-grid / PNG-export pipeline.
Generalize the width helper to accept per-column **weights**:

`sharedColumnWidths(availW, columns, gap, leftMargin, weights?)`
- `weights` defaults to all-ones ⇒ byte-identical to today.
- Otherwise the row's total DATA width (after the left gutter, per-column right margins and gaps) is
  split proportionally to `weights`: `dataW[c] = totalDataW * weights[c] / Σweights`.
- `colWidths[c] = dataW[c] + marginLeft[c] + R` (col 0 still carries the y-label gutter).

`renderFigure` (shared mode) computes the weights:
- `equal` → `[1, 1, …]`.
- `[..]` → the array (validated: length == columns).
- `equal-bar` → per-column bar count. Bar count for a pane = distinct categories × distinct series
  in that pane. For multiple rows, `weights[c] = max` bar count among the panes in column `c`.

Column-count default: when `pane_widths` is set (non-`equal`) and `small_multiples.columns` is unset,
lay all panes in a **single row** (`columns = paneCount`); otherwise honor `columns`.

The live grid already sets `grid-template-columns` from `columnWidths`; the PNG export already
positions columns from `sharedColumnWidths`. Both consume the new non-uniform widths unchanged. The
shared value (y) axis is unchanged (one domain; leftmost column keeps the gutter, others hide labels).

## Components touched

| File | Change |
|---|---|
| `src/spec/types.ts` | `SmallMultiplesConfig.pane_widths?: "equal" \| "equal-bar" \| number[]`. |
| `src/spec/schema.ts` | Schema for the field (string enum OR array of positive numbers). |
| `src/spec/validate.ts` | Cross-check: array length == resolved column count. |
| `src/engine/figure.ts` | `sharedColumnWidths` weights param; compute weights + column default in `renderFigure`. |
| `test/fixtures/` | Faceted vertical-bar fixture with unequal bar counts per pane + golden. |
| `test/golden.test.ts` | equal (unchanged), equal-bar, and custom-proportion assertions + goldens. |
| `test/render-live.test.ts` / `facet-crosshair.test.ts` | Grid-template-columns reflects weights. |
| `CONFIG-SPEC.md` | Document `pane_widths`. |

## Testing

- `sharedColumnWidths` unit: all-ones weights ⇒ identical to the equal result; `[2,1]` ⇒ col 0 data
  width = 2× col 1's; column widths still tile `availW` minus gaps.
- Golden: a shared-mode vertical-bar figure with panes of different bar counts — `equal` (bars differ),
  `equal-bar` (bars equal, columns wider for busier panes), `[2,1]` (2:1 data widths).
- Validation: a proportion array of the wrong length is rejected with a pointed message.
- Determinism preserved.

## Build order

1. `sharedColumnWidths` weights + unit tests.
2. Spec field + schema + validation.
3. `renderFigure` weight computation + column default.
4. Fixture + goldens + live-grid assertion.
5. Docs.
