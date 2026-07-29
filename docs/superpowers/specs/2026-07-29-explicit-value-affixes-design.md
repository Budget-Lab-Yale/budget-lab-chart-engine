# Explicit value prefix/suffix, replacing units inferred from the subtitle

**Date:** 2026-07-29
**Repo:** `Budget-Lab-Yale/budget-lab-chart-engine`
**Status:** Design approved, implementing.

## Background

The engine has no way to state a chart's value units. Instead it **guesses them from the subtitle**
(`src/engine/util.ts:9`):

```ts
export function inferUnitsFromSubtitle(subtitle?: string): string {
  if (!subtitle) return "";
  const lower = subtitle.toLowerCase();
  if (lower.includes("percent") || lower.includes("percentage point")) return "%";
  return "";
}
```

The inferred string is threaded as `units` and appended to numbers in six places: y-axis ticks, the
horizontal-bar value axis (`assemble-plot.ts:333`), stacked-bar segment and net labels
(`marks/stacked.ts:150`), waterfall value labels (`marks/waterfall.ts:112`), the `{value}`
annotation-token fallback format, and hover tooltips via `RenderResult.units`. Small multiples infer
per pane and again at figure level (`figure.ts` ×4).

Measured behaviour on a line chart with values 10–20:

| subtitle | inferred | ticks |
|---|---|---|
| *(none)* | `""` | 10, 12, … |
| `Percentage points` | `%` | 10%, 12%, … |
| `Percent of GDP` | `%` | 10%, … |
| `Percentiles` | `%` | 10%, … |
| `Billions of dollars` | `""` | 10, … |

Three defects:

1. **A subtitle is prose and should not change numbers.** This is the reported bug: `subtitle:
   "Percentage points"` puts `%` on the axis, so a 2 pp change reads as a 2 % rate.
2. **The match is a bare substring test**, so "Percentiles" — and anything else containing those
   letters — also gets `%`.
3. **The second clause is dead code.** Any string containing `"percentage point"` already contains
   `"percent"`, so the branch that presumably meant to distinguish them can never run.

There is also a **half-wired competing field**. Chart-level `value_format: {decimals, prefix,
suffix}` exists in the schema (`types.ts:480`, `schema.ts:442`) and its doc comment claims it formats
"axis ticks / hover / gap labels", but only `dumbbell.ts:212` reads it, for the gap label. Measured:

```
value_format: { suffix: "%", decimals: 0 }   (no subtitle)
  y-axis ticks: ["8","10","12","14","16","18","20","22"]   ← no %
  gap label:    "Δ10%"                                      ← has %
```

So a dumbbell today needs `value_format` for its gap label *and* a `%`-bearing subtitle for its axis.

## Goals

1. State value units explicitly, as a prefix and/or a suffix, e.g. `%`, `$`, ` pp`, ` billion`.
2. Apply them consistently everywhere a number is rendered: axis ticks, value labels, tooltips.
3. Stop deriving anything from `subtitle`.
4. Correct the three in-repo figures that currently rely on the inference.

## Non-goals

- A flat `value_decimals`. Decimals already have four homes (`tooltip_decimals`,
  `valueLabels.decimals`, `value_format.decimals`, axis auto-precision); a fifth would recreate the
  ambiguity this change removes.
- Removing chart-level `value_format`. It keeps working for the dumbbell gap label and per-annotation
  formatting; only its over-broad doc comment is corrected.
- Locale/currency formatting, thousands separators, or unit-aware scaling.

## Design

### 1. Spec surface

Two optional top-level string fields:

```yaml
subtitle: Percentage points     # prose; no longer read by anything
value_suffix: " pp"
```

```yaml
subtitle: Federal debt
value_prefix: "$"
value_suffix: " billion"        # -> "$1,200 billion" style: "$1200 billion"
```

```ts
/** Text placed before every rendered value — axis ticks, value labels, tooltips. Concatenated
 *  literally, so include any space you want ("$" vs "USD "). On a negative value it sits AFTER the
 *  minus sign ("-$5"). */
value_prefix?: string;
/** Text placed after every rendered value. Concatenated literally, so include any leading space
 *  (" pp", " billion"); "%" normally wants none. */
value_suffix?: string;
```

**Literal concatenation, no automatic spacing.** `%` wants no space and ` pp` does, and only the
author knows which — inserting one would make `%` wrong half the time.

**Sign placement.** A prefix goes after the minus sign: `-$5`, not `$-5`. This is the only formatting
rule the engine imposes.

### 2. Precedence

Flat fields are the chart-wide front door. Narrower, explicitly-set formats still win locally:

1. A per-annotation `value_format` (xAxis / yAxis / points markers) — unchanged.
2. A `gap_annotation.format`, else chart-level `value_format`, for a dumbbell gap label — unchanged.
3. Otherwise `value_prefix`/`value_suffix`.

Nothing consults `subtitle`.

### 3. Plumbing

The threaded `units: string` becomes a pair. A tiny type replaces it rather than adding a second
parallel string:

```ts
export interface ValueAffixes {
  prefix: string;
  suffix: string;
}
```

Renamed `units` → `valueAffixes` on `AssembleOptions`, `PaneResult`, `RenderResult`, `FigurePane` and
`FigureRenderResult`, so the compiler locates every site. Most sites are pass-through and only change
name; the real edits are the four formatter builders that consume it:

| Consumer | File |
|---|---|
| `makeTickFormatter(ticks, …)` | `engine/scales.ts` |
| `makeValueFormatter(values, …)` | `engine/marks/stacked.ts` |
| `makeLevelFormatter(…)` | `engine/marks/waterfall.ts` |
| `formatValue(v, …)` | `engine/render-live.ts` |

Each gains prefix support with the sign rule above. One resolver replaces the six
`inferUnitsFromSubtitle(spec.subtitle)` calls:

```ts
export function resolveValueAffixes(spec: ChartSpec): ValueAffixes {
  return { prefix: spec.value_prefix ?? "", suffix: spec.value_suffix ?? "" };
}
```

`inferUnitsFromSubtitle` is deleted.

### 4. Migration

Removing the inference silently drops `%` from any chart that depended on it, so the in-repo callers
are corrected in the same change set. In `budget-lab-charts`, 8 figures have subtitles that trigger
it:

**Gain a correct label** (they say percentage points and were wrongly showing `%`) — no spec edit
needed, the wrong suffix simply stops appearing: `ai-fiscal/atr-by-decile`,
`recession-indicators/michez-rule`, `recession-indicators/sahm-rule`, `recession-indicators/ui-pp`,
`recession-indicators/yield-curve`.

**Need `value_suffix: "%"` added** (they genuinely mean percent): `ai-fiscal/debt-to-gdp`,
`tariff-model-update-july2026/etr-vintages`, `recession-indicators/ui-percent`.

This is a **breaking change for consumers outside this repo** that relied on the sniff: their axes
lose `%` until they set `value_suffix`. Called out in the changelog. Version → **1.8.0** (new fields
plus a behaviour change).

### 5. Testing

- `resolveValueAffixes`: both fields, either alone, neither.
- Formatting: suffix only, prefix only, both; negative values put the prefix after the minus;
  empty-string fields are inert; no space is invented.
- Render: y-axis ticks, horizontal-bar value axis, stacked segment + net labels, waterfall level
  labels, and tooltips all carry the affixes.
- Small multiples: every pane and the figure result carry them.
- Precedence: a per-annotation `value_format` and a dumbbell `gap_annotation.format` still beat the
  chart-wide affixes.
- Regression: a `subtitle` containing "percent", "percentage points" or "percentiles" now changes
  **nothing** — the guard against this bug returning.
- Every existing golden stays byte-identical (no fixture sets these fields or a percent subtitle).

### 6. Files

| File | Change |
|---|---|
| `src/spec/types.ts` | `ValueAffixes`; `value_prefix`/`value_suffix`; correct `value_format`'s doc comment |
| `src/spec/schema.ts` | the two string properties |
| `src/engine/util.ts` | delete `inferUnitsFromSubtitle`, add `resolveValueAffixes` |
| `src/engine/scales.ts` | `makeTickFormatter` applies both affixes |
| `src/engine/index.ts`, `figure.ts`, `assemble-plot.ts` | thread `valueAffixes` |
| `src/engine/marks/stacked.ts`, `waterfall.ts` | formatters apply both affixes |
| `src/engine/render-live.ts` | `formatValue` applies both affixes |
| `CONFIG-SPEC.md`, `CHANGELOG.md`, `package.json` | docs + 1.8.0 |
| `test/value-affixes.test.ts` | **new** |
