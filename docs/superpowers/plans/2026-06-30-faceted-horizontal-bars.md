# Faceted Horizontal Bar Charts + Sectioned Category Axis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `orientation: horizontal` + `small_multiples` render a correct faceted horizontal bar chart (shared category gutter on the leftmost pane, shared value axis, suppressed category labels on other panes), and add an optional section axis (`columns.section`) that groups categories into labeled sections.

**Architecture:** Keep the existing CSS-composed independent-pane small-multiples architecture (`figure.ts` renders N mini-SVGs). Make shared mode orientation-aware: for horizontal bars, size the left gutter to the longest category label, suppress category labels on non-leftmost panes via a new signal, and (Part 2) compute a section-ordered band domain with spacer rows that carry bold section headers.

**Tech Stack:** TypeScript, Observable Plot (vendored), vitest, jsdom, Playwright (screenshots), golden-SVG snapshots.

## Global Constraints

- Headless-safe render path: no `Date.now` / `Math.random` / locale formatting (golden output must be byte-stable).
- Never auto-sort categories or series — declaration / data-encounter order is authoritative.
- Non-faceted and vertical output must stay byte-identical (existing goldens unchanged). New behavior activates only for the horizontal+facet combination and only when `columns.section` is set.
- Do NOT bump the version in `package.json` (the user will decide separately).
- Commits are fine; do NOT push (user approves pushes).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/spec/types.ts` | Spec contract | Add `ColumnMap.section`, `ChartSpec.section_order`, `ChartSpec.section_labels`. |
| `src/spec/schema.ts` | ajv schema | Schema for the 3 new fields. |
| `src/spec/columns.ts` | Column-role resolution | Resolve `section`. |
| `src/engine/marks/index.ts` | MarkContext / PreparedRow types | Add `_section` to PreparedRow; `categoryGutter`, `hideCategoryLabels` to MarkContext. |
| `src/engine/index.ts` | renderPane / RenderOptions | Populate `_section`; add `categoryGutter`/`hideCategoryLabels` opts → MarkContext. |
| `src/engine/axes.ts` | Axis marks | Add `tblSectionHeaderYAxis` (section headers on spacer facets). |
| `src/engine/marks/bar.ts` | Bar mark builder | Honor `categoryGutter`/`hideCategoryLabels`; build section-ordered fy domain with spacers when `columns.section` set. |
| `src/engine/figure.ts` | Small-multiples orchestrator | Orientation-aware shared mode: horizontal gutter + label suppression. Parameterize `sharedColumnWidths`. |
| `test/fixtures/figure7-tariff.csv` | Fixture | Figure-7-derived tidy data. |
| `test/golden.test.ts` | Tests + goldens | Faceted-horizontal + sectioned assertions; goldens. |
| `CONFIG-SPEC.md` | Author docs | Document new fields + the combination. |

---

## PART 1 — Faceted horizontal layout

### Task 1: Thread `hideCategoryLabels` + `categoryGutter` signals

**Files:**
- Modify: `src/engine/marks/index.ts` (MarkContext)
- Modify: `src/engine/index.ts` (RenderOptions, renderPane → MarkContext)

**Interfaces:**
- Produces: `MarkContext.hideCategoryLabels?: boolean`, `MarkContext.categoryGutter?: number`; `RenderOptions.hideCategoryLabels?: boolean`, `RenderOptions.categoryGutter?: number`.

- [ ] **Step 1: Add fields to MarkContext** (`src/engine/marks/index.ts`, in the `MarkContext` interface):

```ts
  /** Horizontal bars in shared-mode small multiples, non-leftmost panes: omit the category
   *  (y-band) labels so they show only on the leftmost pane. The category band domain is shared,
   *  so rows still align. Absent → labels emitted (single-chart + leftmost pane unchanged). */
  hideCategoryLabels?: boolean;
  /** Horizontal bars in shared-mode small multiples: the shared left-gutter width (px) to use for
   *  the category labels + plot left margin, computed once by the figure orchestrator over the
   *  shared category set so every pane uses the SAME gutter. Absent → the builder computes its own
   *  via horizontalLeftGutter (single-chart unchanged). */
  categoryGutter?: number;
```

- [ ] **Step 2: Add fields to RenderOptions** (`src/engine/index.ts`, in `RenderOptions`):

```ts
  /** Shared-mode small multiples, horizontal bars, non-leftmost panes: omit the category labels
   *  (the horizontal analog of hideYAxisLabels, which only affects the vertical value axis).
   *  Threaded into MarkContext.hideCategoryLabels. Absent → labels emitted. */
  hideCategoryLabels?: boolean;
  /** Shared-mode small multiples, horizontal bars: the shared category-gutter width (px) every
   *  pane should use. Threaded into MarkContext.categoryGutter. Absent → builder computes its own. */
  categoryGutter?: number;
```

- [ ] **Step 3: Pass them into the MarkContext** in `renderPane`'s `markBuilderFor(...)` call (after the `opts.pane` spread, around `src/engine/index.ts:429`):

```ts
    ...(opts.hideCategoryLabels ? { hideCategoryLabels: true } : {}),
    ...(opts.categoryGutter != null ? { categoryGutter: opts.categoryGutter } : {}),
```

- [ ] **Step 4: Typecheck** — `npm run typecheck` — Expected: PASS (no behavior change yet; fields unused).

- [ ] **Step 5: Commit**

```bash
git add src/engine/marks/index.ts src/engine/index.ts
git commit -m "feat(engine): thread hideCategoryLabels + categoryGutter to mark context"
```

### Task 2: Bar builder honors the new signals (horizontal)

**Files:**
- Modify: `src/engine/marks/bar.ts`
- Test: `test/golden.test.ts`

**Interfaces:**
- Consumes: `MarkContext.hideCategoryLabels`, `MarkContext.categoryGutter`.

Behavior: in BOTH horizontal branches (single-series `!isMulti` and grouped), the gutter becomes
`ctx.categoryGutter ?? horizontalLeftGutter(categories)`. When `ctx.hideCategoryLabels` is true,
return `xAxisMarks: []` and `marginLeft: SHARED_LABELLESS_MARGIN_LEFT` (import the constant from
`../figure`), so non-leftmost panes drop the labels and use a thin margin.

- [ ] **Step 1: Write failing tests** in `test/golden.test.ts` (new `describe` block):

```ts
import { SHARED_LABELLESS_MARGIN_LEFT } from "../src/engine/figure";

describe("bar builder — faceted-horizontal label signals", () => {
  const HBASE = {
    chartType: "bar" as const,
    title: "t",
    subtitle: "Percentage points",
    xAxisType: "categorical" as const,
    orientation: "horizontal" as const,
    series_order: ["2019", "2022", "2025"],
    data: "bar-multi.csv",
  };

  it("hideCategoryLabels omits the y-band labels for grouped horizontal", () => {
    const rows = parseCsv("./fixtures/bar-multi.csv");
    const shown = renderChart(HBASE, rows, { width: 400, height: 400, document });
    const hidden = renderChart(
      { ...HBASE }, rows,
      { width: 400, height: 400, document, hideCategoryLabels: true } as any,
    );
    const labelCount = (svg: SVGSVGElement) =>
      Array.from(svg.querySelectorAll("text")).filter((t) =>
        /Northeast|Midwest|South/.test(t.textContent ?? "")).length;
    expect(labelCount(shown.svg)).toBeGreaterThan(0);
    expect(labelCount(hidden.svg)).toBe(0);
    expect(Number(hidden.svg.dataset.marginLeft)).toBe(SHARED_LABELLESS_MARGIN_LEFT);
  });

  it("categoryGutter overrides the computed gutter (margin + label dx agree)", () => {
    const rows = parseCsv("./fixtures/bar-multi.csv");
    const r = renderChart(HBASE, rows, { width: 400, height: 400, document, categoryGutter: 180 } as any);
    expect(Number(r.svg.dataset.marginLeft)).toBe(180);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/golden.test.ts -t "faceted-horizontal label signals"` — Expected: FAIL (labels still present / margin wrong).

- [ ] **Step 3: Implement in `src/engine/marks/bar.ts`.** Add the import at top:

```ts
import { SHARED_LABELLESS_MARGIN_LEFT } from "../figure";
```

In the single-series horizontal return (around `bar.ts:183`), replace the gutter line + return so labels/margin honor the signals:

```ts
      const gutter = ctx.hideCategoryLabels
        ? SHARED_LABELLESS_MARGIN_LEFT
        : ctx.categoryGutter ?? horizontalLeftGutter(categories);
      return {
        underlay: [],
        overlay,
        tagging: [{ selector: 'g[aria-label="bar"] rect', seriesOrder }],
        dashedNames: new Set<string>(),
        yScaleOpts: { type: "band", domain: categories, padding: 0.2, axis: null },
        xAxisMarks: ctx.hideCategoryLabels ? [] : tblBandYAxis(categories, gutter),
        marginLeft: gutter,
      };
```

In the grouped horizontal return (around `bar.ts:236`), the same treatment:

```ts
    const gutter = ctx.hideCategoryLabels
      ? SHARED_LABELLESS_MARGIN_LEFT
      : ctx.categoryGutter ?? horizontalLeftGutter(categories);
    return {
      underlay: [],
      overlay,
      tagging: [{ selector: 'g[aria-label="bar"] rect', seriesOrder: hRectSeriesOrder }],
      dashedNames: new Set<string>(),
      yScaleOpts: innerYBandOpts,
      fyScaleOpts: fyGroupOpts,
      xAxisMarks: ctx.hideCategoryLabels ? [] : tblFacetGroupYAxis(categories, gutter),
      marginLeft: gutter,
    };
```

(Note: `import` cycle bar.ts ↔ figure.ts is safe — figure.ts already imports from index.ts which imports the bar builder; the constant is resolved at call time. If the cycle causes an `undefined` at module-eval, move `SHARED_LABELLESS_MARGIN_LEFT` to `theme.ts` and import from there in both files.)

- [ ] **Step 4: Run tests** — `npx vitest run test/golden.test.ts -t "faceted-horizontal label signals"` — Expected: PASS.

- [ ] **Step 5: Full suite (no regressions)** — `npm test` — Expected: all existing goldens still PASS (signals default off → byte-identical).

- [ ] **Step 6: Commit**

```bash
git add src/engine/marks/bar.ts test/golden.test.ts
git commit -m "feat(bar): honor hideCategoryLabels + categoryGutter for horizontal bars"
```

### Task 3: Orientation-aware shared mode in figure.ts

**Files:**
- Modify: `src/engine/figure.ts`
- Test: `test/golden.test.ts`

**Interfaces:**
- Consumes: Task 1/2 signals.
- Produces: parameterized `sharedColumnWidths(availW, columns, gap, leftMargin?)`.

- [ ] **Step 1: Write failing test** in `test/golden.test.ts`:

```ts
describe("figure — faceted horizontal bars (shared mode)", () => {
  const SPEC = {
    chartType: "bar" as const,
    title: "Consumer Price Effects",
    subtitle: "Percent change in consumer prices",
    xAxisType: "categorical" as const,
    orientation: "horizontal" as const,
    series_order: ["Pre-Substitution", "Post-Substitution"],
    columns: { x: "category", value: "value", series: "series", facet: "facet" },
    small_multiples: { columns: 2, mode: "shared" as const,
      pane_order: ["Section 122 Expires", "Section 122 Extended"] },
    data: "figure7-tariff.csv",
  };

  it("leftmost pane has a wide category gutter; others suppress labels and share value domain", () => {
    const rows = parseCsv("./fixtures/figure7-tariff.csv");
    const fig = renderFigure(SPEC, rows, { width: 900, height: 700, document });
    expect(fig.panes.length).toBe(2);
    const p0 = fig.panes[0]!.svg as SVGSVGElement;
    const p1 = fig.panes[1]!.svg as SVGSVGElement;
    // Leftmost gutter wide enough for the longest label (well over the 44px default).
    expect(Number(p0.dataset.marginLeft)).toBeGreaterThan(120);
    // Non-leftmost pane: tiny margin, no category labels.
    expect(Number(p1.dataset.marginLeft)).toBe(SHARED_LABELLESS_MARGIN_LEFT);
    const labels = (svg: SVGSVGElement) =>
      Array.from(svg.querySelectorAll("text")).filter((t) => /Motor vehicles/.test(t.textContent ?? "")).length;
    expect(labels(p0)).toBe(1);
    expect(labels(p1)).toBe(0);
    // Shared value (x) axis: both panes show the same max value tick.
    const maxTick = (svg: SVGSVGElement) => Math.max(...Array.from(
      svg.querySelectorAll("text")).map((t) => parseFloat((t.textContent ?? "").replace("%","")))
      .filter(Number.isFinite));
    expect(maxTick(p0)).toBe(maxTick(p1));
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/golden.test.ts -t "faceted horizontal bars"` — Expected: FAIL (p0 margin ≈ 44, p1 has labels).

- [ ] **Step 3: Parameterize `sharedColumnWidths`** (`src/engine/figure.ts`) — add a `leftMargin` param defaulting to `TBL_MARGIN_LEFT`:

```ts
export function sharedColumnWidths(
  availW: number,
  columns: number,
  gap: number,
  leftMargin: number = TBL_MARGIN_LEFT,
): { dataW: number; colWidths: number[]; marginLeft: number[] } {
  const LM = leftMargin;
  // ...rest unchanged (it already uses LM)...
```

- [ ] **Step 4: Compute horizontal gutter + branch in shared mode** (`src/engine/figure.ts`, in the SHARED branch, before the per-row width math ~line 288). Import `horizontalLeftGutter`:

```ts
import { horizontalLeftGutter } from "./axes";
```

Then, in the shared branch:

```ts
  // Horizontal bars: the category axis is the left gutter (not the value axis). Size it to the
  // longest category label over the SHARED category set so every pane uses one gutter; the value
  // (x) axis is shared via sharedYDomain. Category labels show on the leftmost pane only.
  const isHorizontalBar = spec.chartType === "bar" && spec.orientation === "horizontal";
  const sharedCategories = isHorizontalBar
    ? orderedCategories(rows, resolveColumns(spec, rows), spec)
    : [];
  const hGutter = isHorizontalBar ? horizontalLeftGutter(sharedCategories) : TBL_MARGIN_LEFT;
```

Change the width call to pass the gutter as the left margin for horizontal:

```ts
  const { colWidths, marginLeft: colMarginLeft } = sharedColumnWidths(
    availW, columns, gridGap, isHorizontalBar ? hGutter : TBL_MARGIN_LEFT);
```

In the per-pane `renderPane` opts (the shared-branch `.map`), set the horizontal signals instead of the vertical ones when horizontal:

```ts
    const p = renderPane(
      spec, paneRows,
      {
        ...opts,
        pane: true,
        yDomain: sharedYDomain,
        width: colWidths[col],
        ...(isHorizontalBar
          ? {
              categoryGutter: col === 0 ? hGutter : SHARED_LABELLESS_MARGIN_LEFT,
              hideCategoryLabels: col > 0,
              marginLeft: undefined, // let the bar layer own the margin (gutter)
            }
          : {
              hideYAxisLabels: col > 0,
              marginLeft: colMarginLeft[col],
            }),
      },
      `p${i}`,
    );
```

Add a tiny helper `orderedCategories` near the top of `figure.ts` (flat order for Part 1; Part 2 extends it with sections):

```ts
import { resolveColumns } from "../spec/columns";
import type { ColumnMap } from "../spec/types";

/** The category (band) values in render order: x_order first (if set), then data-encounter order.
 *  Shared across panes so every pane's category band — and the gutter sizing — match. */
function orderedCategories(
  rows: TidyRow[], cols: ReturnType<typeof resolveColumns>, spec: ChartSpec,
): string[] {
  const xField = cols.x;
  const seen: string[] = [];
  const set = new Set<string>();
  for (const r of rows) {
    const v = r[xField] as string;
    if (v != null && v !== "" && !set.has(v)) { set.add(v); seen.push(v); }
  }
  if (spec.x_order && spec.x_order.length) {
    const rank = new Map(spec.x_order.map((c, i) => [c, i] as const));
    seen.sort((a, b) => (rank.get(a) ?? spec.x_order!.length) - (rank.get(b) ?? spec.x_order!.length));
  }
  return seen;
}
```

(Note: `resolveColumns` returns `{ x, value, series, facet, shape, section }` — `cols.x` is the resolved x column name.)

- [ ] **Step 5: Create the fixture** `test/fixtures/figure7-tariff.csv` — header `category,toplevel,series,facet,value`, 20 PCE categories × {Pre-Substitution, Post-Substitution} × {Section 122 Expires, Section 122 Extended}, pre-sorted descending by the Expires/Pre value. (Generated from the source xlsx sheet F7; values rounded to 4 dp.) Full content is produced in the implementation step from the source data.

- [ ] **Step 6: Run test** — `npx vitest run test/golden.test.ts -t "faceted horizontal bars"` — Expected: PASS.

- [ ] **Step 7: Visual check** — render the fixture to PNG via a throwaway Playwright script in the repo root, read the PNG, confirm: labels in the left gutter (not over bars), bars in both panes, shared value axis, pane titles. Delete the script after.

- [ ] **Step 8: Lock the golden** — add `await expect(serializePanes(fig)).toMatchFileSnapshot("./fixtures/figure7-tariff.golden.svg")` to the test; run with the snapshot written; re-run to confirm deterministic.

- [ ] **Step 9: Full suite** — `npm test` — Expected: PASS (existing goldens unchanged).

- [ ] **Step 10: Commit**

```bash
git add src/engine/figure.ts test/golden.test.ts test/fixtures/figure7-tariff.csv test/fixtures/figure7-tariff.golden.svg
git commit -m "feat(figure): faceted horizontal bar small-multiples (shared category gutter)"
```

---

## PART 2 — Sectioned category axis

### Task 4: Spec fields + column resolution for `section`

**Files:**
- Modify: `src/spec/types.ts`, `src/spec/schema.ts`, `src/spec/columns.ts`
- Test: `test/validate.test.ts`

**Interfaces:**
- Produces: `ColumnMap.section?: string`, `ChartSpec.section_order?: string[]`, `ChartSpec.section_labels?: Record<string,string>`; `resolveColumns(...).section?: string`.

- [ ] **Step 1: Write failing test** in `test/validate.test.ts`: a spec with `columns.section: "toplevel"`, `section_order: [...]`, `section_labels: {...}` validates OK; a `section_order` of wrong type fails.

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/validate.test.ts -t section` — Expected: FAIL (schema rejects unknown keys).

- [ ] **Step 3: Add to `ColumnMap`** (`src/spec/types.ts`):

```ts
  /** Horizontal bar charts: column whose distinct values group categories into labeled sections
   *  along the category axis (e.g. Durable goods / Nondurable goods / Services). Omit ⇒ no sections. */
  section?: string;
```

Add to `ChartSpec`:

```ts
  /** Section render order along the category axis (also an inclusion filter), like series_order. */
  section_order?: string[];
  /** Section value → display label for the section header. */
  section_labels?: Record<string, string>;
```

- [ ] **Step 4: Add schema entries** in `src/spec/schema.ts` (mirror `series_order`/`series_labels`; add `section` to the `columns` properties).

- [ ] **Step 5: Resolve in `src/spec/columns.ts`** — add `section: spec.columns?.section` to the returned object (follow the `shape` pattern).

- [ ] **Step 6: Run tests** — `npx vitest run test/validate.test.ts` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/spec/types.ts src/spec/schema.ts src/spec/columns.ts test/validate.test.ts
git commit -m "feat(spec): add columns.section + section_order/section_labels"
```

### Task 5: Carry `_section` on PreparedRow

**Files:**
- Modify: `src/engine/marks/index.ts` (PreparedRow), `src/engine/index.ts` (renderPane parse)

- [ ] **Step 1: Add to PreparedRow** (`src/engine/marks/index.ts`):

```ts
  /** Horizontal sectioned bars: the row's section value (from columns.section). Drives the
   *  section-ordered category band + section headers. Absent ⇒ no sections. */
  _section?: string;
```

- [ ] **Step 2: Populate in renderPane** (`src/engine/index.ts`, in the row `.map`, near the `cols.shape` line):

```ts
      if (cols.section) row._section = r[cols.section] ?? "";
```

- [ ] **Step 3: Typecheck** — `npm run typecheck` — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/engine/marks/index.ts src/engine/index.ts
git commit -m "feat(engine): carry _section on prepared rows"
```

### Task 6: Section header axis mark

**Files:**
- Modify: `src/engine/axes.ts`
- Test: `test/golden.test.ts` (unit on the mark structure is awkward; covered via Task 7 golden)

**Interfaces:**
- Produces: `SECTION_SPACER_PREFIX: string`; `sectionSpacer(section: string): string`; `isSectionSpacer(v: string): boolean`; `tblSectionHeaderYAxis(spacers: {value:string; label:string}[], marginLeft: number): Mark[]`.

- [ ] **Step 1: Add the spacer-sentinel helpers + header mark** to `src/engine/axes.ts`:

```ts
/** Sentinel prefix for the empty band slot inserted before each section (carries no data rows, so
 *  no bars). Uses a control char unlikely to collide with a real category value. */
export const SECTION_SPACER_PREFIX = " section:";
export function sectionSpacer(section: string): string { return SECTION_SPACER_PREFIX + section; }
export function isSectionSpacer(v: string): boolean { return v.startsWith(SECTION_SPACER_PREFIX); }

/** Section headers for a sectioned horizontal bar axis: a bold label at each section's spacer band
 *  slot, left-justified at svg x=0 (pushed left by marginLeft so its `textAnchor:"start"` origin
 *  lands at the canvas left edge, flush with the title above). Faceted on `fy` (the spacer value). */
export function tblSectionHeaderYAxis(
  spacers: { value: string; label: string }[],
  marginLeft: number = TBL_MARGIN_LEFT,
): Mark[] {
  return [
    Plot.text(spacers, {
      fy: (d: { value: string }) => d.value,
      text: (d: { label: string }) => d.label,
      frameAnchor: "left",
      dx: -marginLeft,
      dy: -2,
      textAnchor: "start",
      fill: TBL.color.heading,
      fontSize: TBL.size.axis,
      fontWeight: 700,
    }),
  ];
}
```

- [ ] **Step 2: Typecheck** — `npm run typecheck` — Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/engine/axes.ts
git commit -m "feat(axes): section spacer sentinels + section-header y-axis mark"
```

### Task 7: Section-ordered band domain in the bar builder

**Files:**
- Modify: `src/engine/marks/bar.ts`
- Test: `test/golden.test.ts`

**Interfaces:**
- Consumes: `resolveColumns(...).section`, `spec.section_order`, `spec.section_labels`, `_section`, the Task 6 helpers.

Behavior: when `columns.section` is set AND `horizontal`, build the fy/y category band domain as
`[spacer(S1), ...catsInS1, spacer(S2), ...catsInS2, ...]` with sections ordered by `section_order`
(else section-encounter order) and categories within a section in their existing order. Real bars
bind to real category values (spacers have no data). `xAxisMarks` becomes the category labels
(real categories) PLUS `tblSectionHeaderYAxis` for the spacers. Skip spacers in the value-label
density count. When `hideCategoryLabels`, also hide section headers.

- [ ] **Step 1: Write failing test** in `test/golden.test.ts` (sectioned single-pane horizontal, simplest):

```ts
import { isSectionSpacer } from "../src/engine/axes";

describe("bar builder — sectioned horizontal category axis", () => {
  it("orders categories by section and renders bold section headers", () => {
    const rows = parseCsv("./fixtures/figure7-tariff.csv").filter(
      (r: any) => r.facet === "Section 122 Expires");
    const spec = {
      chartType: "bar" as const, title: "t", subtitle: "Percent",
      xAxisType: "categorical" as const, orientation: "horizontal" as const,
      series_order: ["Pre-Substitution", "Post-Substitution"],
      columns: { x: "category", value: "value", series: "series", section: "toplevel" },
      section_order: ["Durable goods", "Nondurable goods", "Services"],
      data: "figure7-tariff.csv",
    };
    const { svg } = renderChart(spec, rows as any, { width: 500, height: 700, document });
    const texts = Array.from(svg.querySelectorAll("text")).map((t) => t.textContent);
    // Section headers present.
    expect(texts).toContain("Durable goods");
    expect(texts).toContain("Services");
    // Bold (700) headers exist.
    const bold = Array.from(svg.querySelectorAll('text[font-weight="700"]')).map((t) => t.textContent);
    expect(bold).toContain("Durable goods");
    // No spacer sentinel leaks into rendered text.
    expect(texts.some((t) => t && isSectionSpacer(t))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/golden.test.ts -t "sectioned horizontal"` — Expected: FAIL (no section headers).

- [ ] **Step 3: Implement.** In `src/engine/marks/bar.ts`, import helpers:

```ts
import { tblSectionHeaderYAxis, sectionSpacer } from "../axes";
import { resolveColumns } from "../../spec/columns";
```

After computing `categories` (the flat data-encounter list, ~bar.ts:104), derive the sectioned
domain + header list when sectioning is active. `resolveColumns` needs the rows; the builder only
has `data: PreparedRow[]` which carries `_section`. Compute the section map from `data`:

```ts
  // Sectioned horizontal category axis (columns.section): order categories grouped by section,
  // inserting an empty spacer band slot before each section to carry its bold header. Only for
  // horizontal; vertical + unsectioned output is unchanged.
  const sectioned = horizontal && data.some((r) => r._section != null);
  let bandDomain = categories;
  let sectionHeaders: { value: string; label: string }[] = [];
  if (sectioned) {
    const sectionOf = new Map<string, string>();
    for (const r of data) {
      const cat = (r as any)[catField] as string;
      if (cat && r._section != null && !sectionOf.has(cat)) sectionOf.set(cat, r._section);
    }
    // Section order: spec.section_order (filter+order) else section-encounter order.
    const encountered: string[] = [];
    const seenSec = new Set<string>();
    for (const cat of categories) {
      const s = sectionOf.get(cat) ?? "";
      if (!seenSec.has(s)) { seenSec.add(s); encountered.push(s); }
    }
    const order = spec.section_order && spec.section_order.length
      ? spec.section_order.filter((s) => seenSec.has(s))
      : encountered;
    const labels = spec.section_labels ?? {};
    const domain: string[] = [];
    for (const s of order) {
      const spacer = sectionSpacer(s);
      domain.push(spacer);
      sectionHeaders.push({ value: spacer, label: labels[s] ?? s });
      for (const cat of categories) if ((sectionOf.get(cat) ?? "") === s) domain.push(cat);
    }
    bandDomain = domain;
  }
```

In the grouped-horizontal branch, use `bandDomain` for the fy facet domain and append section
headers to the category labels:

```ts
    const fyGroupOpts = { domain: bandDomain, padding: 0.2, paddingOuter: 0.2, axis: null };
    // ...
      xAxisMarks: ctx.hideCategoryLabels
        ? []
        : [...tblFacetGroupYAxis(categories, gutter), ...tblSectionHeaderYAxis(sectionHeaders, gutter)],
```

Do the equivalent in the single-series horizontal branch (use `bandDomain` for `yScaleOpts.domain`
and append `tblSectionHeaderYAxis` to `tblBandYAxis`). When `!sectioned`, `bandDomain === categories`
and `sectionHeaders` is empty, so output is byte-identical to today.

- [ ] **Step 4: Run test** — `npx vitest run test/golden.test.ts -t "sectioned horizontal"` — Expected: PASS.

- [ ] **Step 5: Full suite** — `npm test` — Expected: PASS (unsectioned goldens unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/engine/marks/bar.ts test/golden.test.ts
git commit -m "feat(bar): sectioned horizontal category axis with section headers"
```

### Task 8: Wire sectioning through faceted figure + golden

**Files:**
- Modify: `src/engine/figure.ts` (extend `orderedCategories` so the shared gutter accounts for section headers width too — headers are usually shorter than categories, so the category gutter already fits; no domain change needed in figure.ts since the bar builder owns the sectioned domain per pane and the section set is shared)
- Test: `test/golden.test.ts`

- [ ] **Step 1: Write failing test** — faceted + sectioned (the full Figure 7): `columns.section: "toplevel"`, `section_order: [...]`, assert section headers appear once (leftmost pane), category order is section-grouped, both panes share the value axis.

```ts
  it("faceted + sectioned: headers on leftmost pane only, sections grouped", () => {
    const rows = parseCsv("./fixtures/figure7-tariff.csv");
    const spec = { /* SPEC from Task 3 */ ...,
      columns: { x: "category", value: "value", series: "series", facet: "facet", section: "toplevel" },
      section_order: ["Durable goods", "Nondurable goods", "Services"] };
    const fig = renderFigure(spec, rows, { width: 900, height: 760, document });
    const p0 = fig.panes[0]!.svg as SVGSVGElement;
    const p1 = fig.panes[1]!.svg as SVGSVGElement;
    const headerOn = (svg: SVGSVGElement) =>
      Array.from(svg.querySelectorAll('text[font-weight="700"]')).map((t) => t.textContent);
    expect(headerOn(p0)).toContain("Durable goods");
    expect(headerOn(p1)).not.toContain("Durable goods"); // suppressed on non-left pane
  });
```

- [ ] **Step 2: Run to verify failure / confirm** — `npx vitest run test/golden.test.ts -t "faceted + sectioned"` — Expected: FAIL or PASS; if the section headers already work per-pane via Task 7, the only fix is ensuring `hideCategoryLabels` also hides headers (done in Task 7 Step 3). Fix any gap.

- [ ] **Step 3: Visual check** — Playwright screenshot of the full Figure-7 faceted+sectioned figure; confirm the look (section headers, gutter, gaps, shared axis). Iterate on header `dy` / spacer position if needed.

- [ ] **Step 4: Update the Task-3 golden** (now sectioned) or add a separate `figure7-tariff-sectioned.golden.svg`. Lock + re-run for determinism.

- [ ] **Step 5: Full suite** — `npm test` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/engine/figure.ts test/golden.test.ts test/fixtures/*.golden.svg
git commit -m "feat(figure): faceted + sectioned horizontal bars (Figure 7)"
```

### Task 9: Document in CONFIG-SPEC.md

**Files:**
- Modify: `CONFIG-SPEC.md`

- [ ] **Step 1: Document** `columns.section`, `section_order`, `section_labels`, and a worked example of `orientation: horizontal` + `small_multiples` + sectioning (the Figure 7 shape). Note it is horizontal-bar-only.

- [ ] **Step 2: Commit**

```bash
git add CONFIG-SPEC.md
git commit -m "docs: document section axis + faceted horizontal bars in CONFIG-SPEC"
```

---

## Self-Review notes

- **Spec coverage:** Goals 1 (faceted horizontal) → Tasks 1-3; Goal 2 (sectioning) → Tasks 4-8; Goal 3 (fixture + golden) → Tasks 3, 8. Non-goals respected (no vertical sectioning, no auto-sort).
- **Type consistency:** `hideCategoryLabels`/`categoryGutter` named identically across RenderOptions + MarkContext; `sectionSpacer`/`isSectionSpacer`/`SECTION_SPACER_PREFIX`/`tblSectionHeaderYAxis` defined in Task 6 and consumed in Task 7; `resolveColumns(...).section` defined in Task 4 and consumed in Tasks 5, 7.
- **Risk:** the bar.ts ↔ figure.ts import of `SHARED_LABELLESS_MARGIN_LEFT` (ES-module cycle). Mitigation noted in Task 2 Step 3 (relocate the constant to theme.ts if it evaluates to undefined).
- **Verification:** every code task ends with the targeted test green AND `npm test` to guard the existing goldens; visual screenshot gates the goldens before locking.
