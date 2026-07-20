# Engine fix: table stub wrap, column widths, and cell line breaks

**Date:** 2026-07-20
**Repo of the fix:** `Budget-Lab-Yale/budget-lab-chart-engine` (pinned dependency of
`budget-lab-charts`; this spec lives in the content repo and is handed off to the engine).
**Status:** Design approved, pending implementation plan.

## Background

`budget-lab-charts` renders tables through the pinned chart engine. A table spec
(`table.yaml`) with `stub_wrap: true` currently misbehaves at narrow viewport widths, and there
is no way to force a line break inside a cell or to wrap a text-valued data column. All three
issues trace to two coupled behaviors in the engine's table renderer.

Line numbers below reference the engine's built bundle
`node_modules/budget-lab-chart-engine/dist/embed/live.js` (v1.4.1); the source files are named
in the bundle's `// src/…` markers and are the files to edit.

## Problem statement

### 1. `stub_wrap` collapses data columns instead of scrolling

In `src/table/render-html.ts`:

```js
const stubWrap  = spec?.stub_wrap === true && !stubNowrap;   // ~31353
const flexData  = stubWrap || opts?.flexDataCols === true;    // ~31354
...
leaves.forEach((_, i) => {
  const col = doc.createElement("col");
  if (!flexData) col.style.width = `${colW[i]}px`;            // ~31364  ← skipped when flexData
  colgroup.appendChild(col);
});
```

With `table.style.tableLayout = "fixed"`, when `flexData` is true the data `<col>` elements get
**no explicit width**, so the columns distribute to fit the container. On a narrow viewport they
shrink below their content width; leaf-header `<th>`s are `white-space: nowrap`, so their text
overflows the cell and **overlaps** (table cells ignore overflow). When `flexData` is false,
each column gets `colW[i]px`, the table keeps its intrinsic width, and the existing horizontal
scroll pane engages.

Empirical confirmation (Playwright, 380px viewport):

| Table | `stub_wrap` | table width | leaf col width | overflowing headers | scroll |
|---|---|---|---|---|---|
| `headline-results` (Table 1) | true | 348px (squeezed) | 34px each | 8 of 8 | no |
| `update-decomposition` (Table 2) | false | 979px (intrinsic) | 66–173px | 0 | yes |

`column_width` (spec field, parsed to `opts.columnWidth` at ~31149, applied in layout ~31163) is
**also silently ignored** whenever `stub_wrap` is on, because the widths it computes are never
written to the `<col>` elements.

### 2. No explicit line break in cell text

`src/table/richtext.ts` `appendRichHtml` (~31012) builds cell content from parsed runs using
`doc.createTextNode(run.text)` (~31019). There is no `<br>`, and the wrapping CSS uses
`white-space: normal`, which collapses any literal newline to a space. Authors cannot force a
break at a chosen point (e.g. before a parenthetical in a long stub label).

### 3. No wrapping control for text-valued data columns

`stub_wrap` wraps the stub column; there is no equivalent for data columns whose values are text
rather than numbers.

## Goals

1. `stub_wrap` must not break the rest of the table: data columns keep their widths and the
   table scrolls horizontally when the viewport is narrow.
2. Explicit column widths (`column_width`) take effect even with `stub_wrap` on.
3. Authors can force a line break anywhere in cell text.
4. Authors can wrap text-valued data columns independently of the stub.

## Non-goals

- No change to chart (non-table) rendering.
- No new stub layout modes beyond decoupling width from wrap.
- No markdown/HTML in cells beyond the single line-break token.

## Design

Three changes. A and B are independent of C.

### Change A — decouple data-column widths from `stub_wrap`

**Files:** `src/table/render-html.ts`, `src/table/layout.ts`.

- Redefine the flag so `stub_wrap` no longer drives it:

  ```js
  const flexData = opts?.flexDataCols === true;   // was: stubWrap || opts?.flexDataCols === true
  ```

  `stubWrap` continues to drive **only** the stub: the `is-wrap`/`is-nowrap` class on the stub
  `<th>` (~31468) and the stub-width branch in `layout.ts` (~31226).

- Consequences (no further code change needed):
  - Data `<col>`s always receive `colW[i]px`, so `column_width` is honored regardless of
    `stub_wrap`.
  - The table retains its intrinsic width; the existing horizontal scroll pane engages on narrow
    viewports. Long headers no longer overlap.

- `flexDataCols` remains an internal `opts` flag with **no `table.yaml` surface** (it is not a
  spec field and is not added to the schema).

**Impact / rollout safety:** only tables that set `stub_wrap` change behavior. Audit of
`budget-lab-charts/charts` at spec time: exactly one table uses it
(`tariff-model-update-july2026/headline-results`, Table 1), which is the table this fix targets.
No other content is affected.

### Change B — new `column_wrap` spec field (data-cell wrapping)

**Files:** `src/spec/columns.ts` (parse), `src/table/render-html.ts` (apply), schema,
`CONFIG-SPEC.md`.

- New optional field on the table spec, parallel to `column_width`:

  ```yaml
  column_wrap: true                 # wrap every data column
  # or
  column_wrap: { notes: true }      # wrap only the leaf column keyed "notes"
  ```

  Type: `boolean | { <leafKey>: boolean }`. Default `false`.

- When wrap is enabled for a leaf column, its **body `<td>`** cells get
  `white-space: normal; overflow-wrap: break-word` (via an `is-wrap` class, mirroring the stub's
  `.is-wrap`). Text wraps within the column's fixed width; row height grows to fit.

- Scope is **body data cells only**. Column headers keep their existing controls
  (`header_max_lines` for soft wrap, and the `\\` token from Change C for hard breaks).

- Pair `column_wrap` with `column_width` to cap the column width — the same idiom as
  `stub_wrap` + `stub_width`/`stub_min_width`. Without a width cap, a wrapped text column still
  sizes to its natural (widest-segment) width.

- Schema: the table spec is validated with `additionalProperties: false`, so `column_wrap` must
  be added to the schema or it will fail validation.

### Change C — explicit line-break token `\\`

**Files:** `src/table/richtext.ts`, `src/table/render-svg.ts`, `src/table/layout.ts`,
`CONFIG-SPEC.md`, and (downstream) the content repo's `CONFIG-REFERENCE.md`.

Define `\\` (two backslashes) as a **hard line break** within text runs, i.e. everywhere
`appendRichHtml` / `renderRichSvgText` render cell text: stub labels, column/spanner headers,
group labels, and body cells.

- **HTML path** (`appendRichHtml`, ~31012): split each text run's text on `\\` and append the
  segments with a `doc.createElement("br")` between them, instead of a single `createTextNode`.
  Italic and math (`sup`/`sub`/`msubsup`) runs are unaffected — the break only applies to plain
  text segments.
- **SVG/export path** (`renderRichSvgText` in `src/table/render-svg.ts`, used by
  `src/embed/export-table-png.ts`): emit a new tspan line per segment so PNG/SVG exports match
  the live DOM.
- **Measurement** (`richWidth`, ~30996): a broken string's width is the **max** segment width,
  not the sum. `richToPlain` (~31008, used for measurement / aria / data download) joins
  segments with a single space.
- **Layout** (`src/table/layout.ts`): natural stub width and natural column width are computed
  from the **widest segment** (split on `\\`), after which soft-wrapping applies within the
  segment per `stub_wrap` / `column_wrap` / `header_max_lines`. `widestWord` (~31216) is measured
  per segment.
- **`<br>` is a hard break**, so it renders even inside `white-space: nowrap` cells. A break in a
  nowrap column forces two lines there without enabling general wrapping.

**Precedence vs. math.** Tokenize left-to-right at a backslash: two consecutive backslashes = a
break; a single `\` followed by `(` or `[` (or `$$`) is an existing math opener. Therefore `\\(`
parses as *break* then a literal `(`. The break token is recognized only **outside** math
delimiters — a `\\` inside `\( … \)` is left to the math parser (2-D math is already unsupported
and rejected at validation).

**Authoring / escaping.**
- In **CSV** (where stub/row labels live) there is no backslash escaping, so `\\` is two literal
  characters and works directly:
  `Without new Sec. 301 \\(Sec. 122 expires, not replaced)` renders as two lines with the
  parenthetical on the second.
- In **double-quoted YAML** `\\` collapses to a single backslash, so authors must use
  **single-quoted YAML** (`'Line one \\ line two'`) or write `\\\\`. This mirrors the existing
  math YAML gotcha already documented in `CONFIG-REFERENCE.md`.

### Edge cases

- Leading, trailing, or consecutive `\\` produce empty lines — allowed, not rejected (approved).
- `\\` inside `\( … \)` math is not a break (handled by the math parser).
- `header_max_lines` + explicit `\\` in a header: explicit breaks are always honored;
  `header_max_lines` caps only the *additional* soft-wrapping / clamping.
- Sorting, collapsible groups, sticky first column, and emphasis are unaffected by all three
  changes.

## Testing

**richtext unit tests** (`src/table/richtext.ts`)
- `\\` splits a text run and emits `<br>`; segment count and order correct.
- `\\(` parses as break + literal `(`; `\(x\)` still parses as math; `\$` still renders a literal
  `$`.
- Italic/`sup`/`sub` runs pass through unchanged around a break.
- `richWidth` returns the max segment width; `richToPlain` joins with a space.

**layout unit tests** (`src/table/layout.ts`)
- With `stub_wrap: true`, data-column widths are still assigned (regression guard for Change A).
- `column_width` is honored when `stub_wrap` is on.
- `column_wrap` produces `is-wrap` on body cells and wraps within the fixed width.
- Natural width uses the widest `\\`-segment.

**render regression** (Playwright, mirrors the harness used to diagnose this)
- `headline-results` at 380px: 0 overflowing leaf headers, horizontal scroll present (matches
  `update-decomposition`); at wide viewport, columns render at natural widths.
- A stub label containing `\\` breaks at the token (before the parenthetical).

**export parity**
- PNG/SVG export of a table with `\\` and with `column_wrap` matches the live DOM line structure.

## Docs and rollout

**Engine repo (`budget-lab-chart-engine`)**
1. Implement Changes A, B, C.
2. Add `column_wrap` to the table spec schema (`additionalProperties: false`).
3. Document `column_wrap` and the `\\` line-break token in `CONFIG-SPEC.md`.
4. `CHANGELOG.md` entry; version bump (minor — additive field + bug fix).

**Content repo (`budget-lab-charts`), after the engine bump**
1. Bump the pinned engine dependency; run `npm run validate`.
2. Update `CONFIG-REFERENCE.md`: document `column_wrap`; add the `\\` line-break token to the
   "Inline math & special characters" section.
3. In `charts/articles/2026/07/tariff-model-update-july2026/headline-results/data.csv`, insert
   `\\` before the parenthetical in each scenario label so it breaks onto a second line. Keep
   `stub_wrap: true`; optionally add `stub_min_width` if a wider default is wanted.
4. Rebuild and verify Table 1 at narrow and wide widths (no header overlap, horizontal scroll,
   label breaks correctly); regenerate `catalog/index.json` if any content changed.

## Files touched (engine)

| File | Change |
|---|---|
| `src/table/render-html.ts` | A: `flexData` no longer keys off `stubWrap`. B: `is-wrap` class on wrapped data `<td>`s. C: `<br>` in `appendRichHtml`. |
| `src/table/layout.ts` | A: widths always computed for data cols. C: natural widths from widest `\\`-segment; `widestWord` per segment. |
| `src/table/richtext.ts` | C: split runs on `\\`; `richWidth` max-segment; `richToPlain` join. |
| `src/table/render-svg.ts` | C: tspan-per-segment in `renderRichSvgText`. |
| `src/spec/columns.ts` | B: parse `column_wrap` → `opts`. |
| schema / `CONFIG-SPEC.md` / `CHANGELOG.md` | B, C: field + token docs; version bump. |
