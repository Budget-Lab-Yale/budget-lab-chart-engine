# Reversed value axis, on every chart type

**Date:** 2026-07-31
**Repo:** `Budget-Lab-Yale/budget-lab-chart-engine`
**Status:** Implemented and released in v1.8.1.

## Background

Setting `yAxisPolicy.min` **greater than** `yAxisPolicy.max` reverses the value axis, putting the
numerically lower value at the top. It is the right treatment for indices where more-negative is
worse: CFNAI reads as "how far below trend," and the conventional presentation draws that downward
excursion upward. Plot handles a descending `domain` natively, so ticks, gridlines and mark geometry
already come out right.

Nothing in the engine ever declared this a feature. It worked because a descending domain is
ordinary Plot input, and it broke wherever engine code read the domain pair as `[lo, hi]`. A first
pass (this same day) fixed four such reads on line charts and added `domainBounds()` to `scales.ts`
as the one place that answers "what are this domain's numeric bounds":

- `marks/line.ts` — a `shading` threshold baseline clamped to the far edge, so every fill ran to
  the frame instead of stopping at its threshold. This was the reported bug.
- `assemble-plot.ts` — the zero rule was dropped from reversed domains that straddle zero.
- `index.ts` — the mark clip engaged unconditionally.
- `assemble-plot.ts` — `annotations.yAxis` label collision-avoidance skipped reversed axes.

That pass stopped at line charts. Probing the rest surfaced two further defects, both of which make
reversal unusable outside `chartType: line`.

### Defect 1 — a reference marker destroys a reversed domain

Five chart-type branches in `index.ts` fold reference-marker and callout values into the axis extent
so a marker stays visible. Every one of them does it like this (`index.ts:517`, the bar branch):

```js
const resolvedMin = policy.min ?? Math.min(barExtent.min, ...markerYs);
const resolvedMax = Math.max(policy.max ?? barExtent.max, ...markerYs);
hardDomain = [resolvedMin, resolvedMax];
```

`Math.max` assumes `policy.max` is the ceiling. On `{min: 0, max: -4}` with a marker at `-0.7`,
`Math.max(-4, -0.7)` is `-0.7`: the ceiling collapses from -4 to -0.7. Observed on a 720×400 bar
chart, the first bar renders at `y = -136` with `height = 514` — outside the SVG entirely, painting
over the title and off the top of the canvas. The same expression appears in the bar/stacked,
dumbbell, waterfall and area branches.

### Defect 2 — value labels land inside their bars

`marks/waterfall.ts:128` places a running-total label with

```js
dy: rising ? -TBL_VALUE_LABEL.gap : TBL_VALUE_LABEL.gapBelow,
```

`rising` is a data-space property (`value >= 0`, from `computeWaterfallSteps`); `dy` is a pixel
offset. On a reversed axis a rising bar grows *downward* in pixels, so `-gap` puts the label inside
the bar rather than clear of its end. `marks/stacked.ts:272` has the same defect on its net-total
text label, and its horizontal variant (`:271`) has it on `dx` plus `textAnchor`.

An audit of every `Plot.text` site found these are the only two. Stacked segment labels sit at
data-space segment midpoints, so Plot maps them correctly in either orientation; the dumbbell gap
label rides the connector midpoint with no mark end to clear; and `bar`, `histogram`, `area` and
`point` draw no value text.

## Goals

Reversal is a supported, documented, tested property of the value axis on every chart type, in
either orientation.

Non-goals: reversing the *category* axis; reversing an auto-fitted domain (reversal still requires
both bounds pinned); rescuing a degenerate `min == max` domain (pre-existing, unrelated).

## Decisions

| Question | Decision |
|---|---|
| How is reversal declared? | `min > max`, as today. No new key — one way to express it, and it is already what the CFNAI chart does. |
| Horizontal orientation (value axis on x)? | Supported; the same `hardDomain` feeds both orientations. `min` is the axis' NEAR edge — bottom vertically, **left** horizontally — so reversing puts the lower value at the right and negative bars grow left-to-right, the mirror of the ascending layout. (An earlier draft of this table had that backwards; the render corrected it.) |
| Forced domains (100%-normalized stacked, histogram)? | Honored. A reversed normalized stack puts 100 at the bottom; a reversed histogram hangs its bins from the ceiling. Uniform rule, no exceptions to document. |
| `autoWiden` on a reversed axis? | Orientation-aware: it extends whichever end the data overflows. |

## Design

### One resolver, not six guards

The five fold-and-resolve blocks in `index.ts` are copy-paste of one another, which is exactly why
Defect 1 exists in all five. Rather than guarding each, collapse them into one pure function in
`scales.ts`, beside `domainBounds`:

```ts
/** True when the value axis runs descending (a reversed axis), so a pixel offset that should
 *  clear a mark's data-space end has to point the other way. */
export function isReversedDomain(domain: readonly [number, number]): boolean;

/** Resolve a chart's hard value-axis domain from the author's pinned bounds, the chart type's
 *  computed extent, and values that must stay inside the frame. */
export function resolveHardDomain(opts: {
  min?: number;
  max?: number;
  /** The chart type's own extent, ascending (computeBarYExtent and friends). */
  auto?: { min: number; max: number };
  /** Reference-marker / callout values that should widen the domain to stay visible. */
  fold?: number[];
}): [number, number] | null;
```

`resolveHardDomain` works in numeric space and re-orients at the end:

```
reversed = min != null && max != null && min > max
pinnedLo = reversed ? max : min          // numeric floor, if pinned
pinnedHi = reversed ? min : max          // numeric ceiling, if pinned
lo = pinnedLo ?? min(auto.min, ...fold)
hi = max(pinnedHi ?? auto.max, ...fold)
return reversed ? [hi, lo] : [lo, hi]
```

The asymmetry in those last two lines is deliberate and is today's behavior, preserved exactly: a
pinned floor is authoritative, while a pinned ceiling can still be widened by a fold value. Changing
it would move every ascending chart that has a marker above its `max`. Because the arithmetic is
identical for an ascending request, ascending output must stay byte-identical — the golden PNG
snapshots are the check, and any diff there is a bug in the resolver, not a baseline to update.

Fold values widen the domain's numeric bounds and never its orientation. That is the whole of
Defect 1's fix, applied in one place.

### Call sites

`index.ts` — the six chart-type branches (bar/stacked, dumbbell, waterfall, area, histogram, line)
each build their `auto` extent as they do now and hand it to `resolveHardDomain` with their fold
list. The line branch additionally makes `autoWiden` orientation-aware: it rounds the overflowed end
outward, which means `Math.floor` toward the numeric floor on a reversed axis where today it only
ever `Math.ceil`s a ceiling.

`marks/waterfall.ts` and `marks/stacked.ts` — the two label offsets XOR with orientation, read off
`ctx.yDomain` via `isReversedDomain`:

```js
dy: (rising !== reversed) ? -TBL_VALUE_LABEL.gap : TBL_VALUE_LABEL.gapBelow,
```

Stacked's horizontal net label flips `dx` and swaps `textAnchor` between `start` and `end`.

## Testing

`test/reversed-value-axis.test.ts`, renamed from `test/reversed-y-axis.test.ts` (added in the first
pass, uncommitted) because the value axis is x on horizontal charts.

**Mirror invariance is the backbone.** For each of the nine chart types, render one spec twice —
`{min: lo, max: hi}` and `{min: hi, max: lo}` — and assert every mark coordinate satisfies
`reversed == top + bottom - ascending` (or `left + right - ascending` where the value axis is x).
This states the property directly instead of hand-writing expected pixels, so it catches cases the
design did not anticipate.

Layered on top:

- **Frame containment** — no mark coordinate outside `[marginTop, height - marginBottom]`, every
  chart type × reversed. This is the invariant Defect 1 violated.
- **Domain preservation under folding** — for each folding type, a reversed domain plus an
  in-range marker resolves to exactly the requested pair.
- **Label side** — waterfall running totals and stacked net text clear the mark end on the correct
  pixel side, across all four rising × orientation combinations.
- **Edge cases** — data flush against both bounds; data overflowing both ends at once (clip fires
  once); a single point; all-zero data; data entirely on one side of zero; zero outside a reversed
  domain (no zero rule); normalized stacked reversed; histogram reversed; horizontal bar and
  horizontal dumbbell reversed; `autoWiden` with data past the pinned floor; small-multiples shared
  domain (the per-pane union must not flip it); faceted + reversed + clip; reversed + confidence
  bands; reversed + `annotations.points` connector.

## Documentation

CONFIG-SPEC's "Reversing the axis" paragraph (added in the first pass) extends to state that
reversal works on every chart type and in both orientations, that markers never move the pinned
bounds, that `autoWiden` extends the overflowed end, and that value labels stay clear of the mark
end. CHANGELOG gets the behavior change under `[Unreleased]` alongside the first pass's fixes.
