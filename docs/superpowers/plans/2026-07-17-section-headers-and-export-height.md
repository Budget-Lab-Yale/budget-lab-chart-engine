# Section-Header Spacing + Responsive Export Height — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two defects in sectioned horizontal bar charts — cramped non-first section headers, and PNG exports that ignore row count — reported against `v1.4.0` (see spec `docs/specs/ENGINE-FIX-SPEC-section-headers.md`, git-ignored, contains unreleased data).

**Architecture:** Three coordinated changes sharing one per-row height model. (1) Extract the horizontal-bar height computation into a single `figure.ts` helper so the PNG export, the live mount, and the reserved section-spacer height all agree. (2) Give each non-first section a **2-slot spacer block** and draw every section header with one unified lifted-text mechanism (the current top-header mechanism), yielding symmetric whitespace above and below. (3) Make the crosshair band-widen **section-aware** so a section-boundary bar's hover highlight clamps at the spacer, never painting over the header.

**Tech Stack:** TypeScript, Observable Plot (vendored), Vitest (+ jsdom for golden/DOM tests), golden-SVG fixtures.

## Global Constraints

- Target repo `budget-lab-chart-engine`; all `src/`-relative paths below. Node/TS as configured; no new dependencies.
- **Sensitive data:** never commit the real tariff CSV from the spec or any real values. All new test fixtures use synthetic data. The spec file is git-ignored (`.gitignore`).
- **No regressions:** existing non-sectioned, single-section, vertical, and small-multiples charts must be visually unchanged. Golden fixtures that legitimately change (the sectioned ones) are regenerated with `-u` and reviewed in the visual pass.
- Single feature branch `feat/section-header-spacing-and-export-height`, one PR — only opened after the user's visual approval of the live version and on direct prompt.
- Section-spacer slot count is defined **once** as `SECTION_SPACER_SLOTS` in `axes.ts` and consumed by the domain builder (`bar.ts`) and both height computations (`figure.ts`, `render-live.ts`) so they never drift.

---

## File Structure

- `src/engine/axes.ts` — add `SECTION_SPACER_SLOTS`; add `sectionSpacerSlot(section, i)`; unify header rendering on `tblSectionTopHeader` (remove `tblSectionHeaderYAxis`).
- `src/engine/marks/bar.ts` — push `SECTION_SPACER_SLOTS` spacer slots per non-first section; draw all section headers via the unified lifted mechanism.
- `src/engine/figure.ts` — new exported `horizontalBarChartHeight(spec, rows)`; multiply spacer count by `SECTION_SPACER_SLOTS` in `horizontalBarHeight` inputs.
- `src/engine/render-live.ts` — `computeChartHeight` delegates its horizontal branch to `horizontalBarChartHeight`.
- `src/embed/export-png.ts` — single horizontal `bar`/`stacked` export sizes from `horizontalBarChartHeight` and grows the frame.
- `src/engine/crosshair.ts` — `widenBandsToMidpoints` gains an optional `boundaryAfter` mask; `readCategoryBandsH` returns section-boundary info; the horizontal caller threads it through.
- Tests: `test/figure-height.test.ts` (new), `test/golden.test.ts` (extend), `test/band-crosshair.test.ts` (extend), `test/fixtures/sectioned-dense.csv` (new synthetic fixture).

---

### Task 1: Extract the horizontal-bar height helper and make single-chart PNG export responsive (Fix 2)

**Files:**
- Modify: `src/engine/figure.ts` (add export near `horizontalBarHeight`, `figure.ts:49`)
- Modify: `src/engine/render-live.ts:78-135` (`computeChartHeight`)
- Modify: `src/embed/export-png.ts:191`, `:257-272`, `:347`
- Test: `test/figure-height.test.ts` (create)

**Interfaces:**
- Produces: `horizontalBarChartHeight(spec: ChartSpec, rows: TidyRow[]): number` in `figure.ts` — the intrinsic px height of a single horizontal `bar`/`stacked` chart (categories + section spacers + wrapped-label rows, floored at 400). Assumes the caller has already confirmed the chart is a horizontal bar/stacked; it does not re-check.
- Consumes: existing `horizontalBarHeight(...)`, `countSections(...)` semantics, `orderedCategories`-style scanning, `resolveColumns`, `horizontalLeftGutter`, `labelLineCount`, `GUTTER_TEXT_PAD`, `FACETED_CAT_LABEL_PX`, `SECTION_HEADER_TOP_PX`.

- [ ] **Step 1: Write the failing test**

Create `test/figure-height.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { horizontalBarChartHeight } from "../src/engine/figure";
import { buildExportSvg } from "../src/embed/export-png";
import { H } from "../src/embed/figure-chrome";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

// Synthetic dense two-section spec (no real data).
const spec: ChartSpec = {
  chartType: "bar",
  orientation: "horizontal",
  columns: { x: "category", value: "value", section: "panel" },
  xAxisType: "categorical",
  section_order: ["Group A", "Group B"],
  data: "inline",
} as unknown as ChartSpec;

function denseRows(nA: number, nB: number): TidyRow[] {
  const rows: TidyRow[] = [];
  for (let i = 0; i < nA; i++) rows.push({ category: `A${i}`, panel: "Group A", value: String(i + 1) } as TidyRow);
  for (let i = 0; i < nB; i++) rows.push({ category: `B${i}`, panel: "Group B", value: String(i + 1) } as TidyRow);
  return rows;
}

describe("horizontalBarChartHeight", () => {
  it("grows with row count (more rows ⇒ taller)", () => {
    const few = horizontalBarChartHeight(spec, denseRows(3, 3));
    const many = horizontalBarChartHeight(spec, denseRows(8, 38));
    expect(many).toBeGreaterThan(few);
    expect(many).toBeGreaterThan(H); // taller than the fixed 750 export frame
  });
});

describe("buildExportSvg — single horizontal sectioned chart", () => {
  it("grows the export frame past the fixed 750 height instead of cramming rows", () => {
    const svg = buildExportSvg(spec, denseRows(8, 38));
    const h = Number(svg.getAttribute("height"));
    expect(h).toBeGreaterThan(H);
  });

  it("leaves a non-horizontal single chart at the fixed frame height", () => {
    const vspec = { ...spec, orientation: "vertical" } as ChartSpec;
    const svg = buildExportSvg(vspec, denseRows(8, 38));
    expect(Number(svg.getAttribute("height"))).toBe(H);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/figure-height.test.ts`
Expected: FAIL — `horizontalBarChartHeight` is not exported; `buildExportSvg` returns height `750`.

- [ ] **Step 3: Add `horizontalBarChartHeight` to `figure.ts`**

Insert after `horizontalBarHeight` (`figure.ts:67`). It reuses the existing `countSections` and `orderedCategories` in this file:

```ts
/** Intrinsic px height of a SINGLE horizontal bar/stacked chart. Single source of truth shared by
 *  the live mount (computeChartHeight) and the PNG export (buildExportSvg), so per-row height,
 *  section-spacer reservation and the export frame all agree. Caller must confirm the chart is a
 *  horizontal bar/stacked before calling. */
export function horizontalBarChartHeight(spec: ChartSpec, rows: TidyRow[]): number {
  const cols = resolveColumns(spec, rows);
  const categories = orderedCategories(rows, cols.x, spec);
  const nCats = Math.max(1, categories.length);
  const series = new Set<string>();
  for (const r of rows) {
    const s = cols.series ? (r[cols.series] as string) : "";
    if (s) series.add(s);
  }
  const nSeries =
    spec.series_order && spec.series_order.length ? spec.series_order.length : Math.max(1, series.size);
  const grouped = spec.chartType === "bar" && nSeries > 1;
  const nSections = cols.section ? countSections(rows, cols.x, cols.section, spec, categories) : 0;
  const nSpacers = Math.max(0, nSections - 1) * SECTION_SPACER_SLOTS;
  const gutter = horizontalLeftGutter(categories, { fontSize: FACETED_CAT_LABEL_PX });
  const maxLabelLines = categories.reduce(
    (m, c) => Math.max(m, labelLineCount(c, gutter - GUTTER_TEXT_PAD, FACETED_CAT_LABEL_PX)),
    1,
  );
  return horizontalBarHeight({
    nCategories: nCats,
    nSeries,
    grouped,
    nSpacers,
    maxLabelLines,
    extraTopPx: nSections > 0 ? SECTION_HEADER_TOP_PX : 0,
  });
}
```

Add `SECTION_SPACER_SLOTS` to the existing `./axes` import in `figure.ts:18` (the constant is created in Task 2; for Task 1, temporarily define it inline as `const SECTION_SPACER_SLOTS = 1;` at the top of `figure.ts` and delete that line in Task 2 Step 4 when the import is added — noted so this task's tests pass in isolation).

- [ ] **Step 4: Delegate `computeChartHeight`'s horizontal branch to the helper**

In `render-live.ts`, replace the horizontal-bar body of `computeChartHeight` (`render-live.ts:83-134`) with a delegation, keeping the guard/fallback (`render-live.ts:79-82`) intact:

```ts
export function computeChartHeight(spec: ChartSpec, rows: TidyRow[]): number {
  if (spec.orientation !== "horizontal" || (spec.chartType !== "bar" && spec.chartType !== "stacked")) {
    return spec.chartType === "waterfall" ? 460 : FIXED_CHART_HEIGHT;
  }
  return horizontalBarChartHeight(spec, rows);
}
```

Add `horizontalBarChartHeight` to the existing `figure` import in `render-live.ts` (the file already imports `horizontalBarHeight`/`SECTION_HEADER_TOP_PX` from `./figure` — confirm and extend that import; remove now-unused imports flagged by `tsc`).

- [ ] **Step 5: Grow the single-chart export frame in `buildExportSvg`**

In `export-png.ts`, add the guard just after `const isFigure` (`export-png.ts:191`):

```ts
const isSingleHorizontalBar =
  !isFigure && (spec.chartType === "bar" || spec.chartType === "stacked") && spec.orientation === "horizontal";
```

Replace the `!isFigure` content-height block (`export-png.ts:260-272`) so the horizontal case sizes from the helper:

```ts
if (!isFigure) {
  contentHeight = isSingleHorizontalBar
    ? horizontalBarChartHeight(spec, rows)
    : Math.max(160, H - chartTop - bottomH);
  const { svg: chartSvg } = renderChart(spec, rows, {
    width: INNER_W,
    height: contentHeight,
    ...(accentColor ? { accentColor } : {}),
  });
  chartSvg.setAttribute("x", String(MARGIN));
  chartSvg.setAttribute("y", String(chartTop));
  chartSvg.setAttribute("width", String(INNER_W));
  chartSvg.setAttribute("height", String(contentHeight));
  root.appendChild(chartSvg);
} else {
```

Extend the frame at `export-png.ts:347`:

```ts
const H_eff = isFigure || isSingleHorizontalBar ? Math.round(chartTop + contentHeight + bottomH) : H;
```

Add `horizontalBarChartHeight` to the `../engine/figure.js` import in `export-png.ts:9`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run test/figure-height.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 7: Guard against regressions and commit**

Run: `npx vitest run test/figure-widths.test.ts test/title-selector-export.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

```bash
git add src/engine/figure.ts src/engine/render-live.ts src/embed/export-png.ts test/figure-height.test.ts
git commit -m "fix: responsive PNG export height for single horizontal bar charts"
```

---

### Task 2: 2-slot spacer block + unified section-header rendering (Fix 1 — spacing)

**Files:**
- Modify: `src/engine/axes.ts:554-615` (spacer helpers + header marks)
- Modify: `src/engine/marks/bar.ts:20-31` (imports), `:138-143` (domain), `:170-179` (margin), `:227-233` and `:344-350` (header marks)
- Modify: `src/engine/figure.ts` (delete the temporary inline `SECTION_SPACER_SLOTS`, import it; multiply in `renderFigure` auto-height at `figure.ts:305`)
- Test: `test/golden.test.ts` (extend "sectioned horizontal category axis"), `test/fixtures/sectioned-dense.csv` (create)

**Interfaces:**
- Consumes: `horizontalBarChartHeight` (Task 1); `tblSectionTopHeader(header, marginLeft, lift, fontSize)` (`axes.ts:596`).
- Produces: `SECTION_SPACER_SLOTS: number` (=2) and `sectionSpacerSlot(section: string, i: number): string` in `axes.ts`; `isSectionSpacer` unchanged (still matches the `" section:"` prefix). All section headers drawn by `tblSectionTopHeader`.

- [ ] **Step 1: Create the synthetic dense fixture**

Create `test/fixtures/sectioned-dense.csv` (comma-free values so the test parser's plain split works; two sections, many thin rows):

```csv
category,panel,value
Alpha,Group A,3.1
Bravo,Group A,2.0
Charlie,Group A,1.8
Delta,Group A,1.4
Echo,Group A,1.1
Foxtrot,Group A,0.9
Golf,Group A,0.3
Hotel,Group A,0.2
P01,Group B,10.7
P02,Group B,8.4
P03,Group B,5.2
P04,Group B,2.5
P05,Group B,1.5
P06,Group B,0.9
P07,Group B,0.7
P08,Group B,0.5
P09,Group B,0.4
P10,Group B,0.3
P11,Group B,0.26
P12,Group B,0.2
P13,Group B,0.09
P14,Group B,0.03
P15,Group B,0.01
P16,Group B,0.008
P17,Group B,0.003
P18,Group B,0.001
P19,Group B,0
P20,Group B,0
```

- [ ] **Step 2: Write the failing spacing test**

Add to `test/golden.test.ts` inside the `describe("bar builder — sectioned horizontal category axis", …)` block. It asserts the second header has **comparable** whitespace above and below (the defect made "above" collapse toward zero):

```ts
it("non-first section header has comparable whitespace above and below (dense chart)", () => {
  const rows = parseCsv("./fixtures/sectioned-dense.csv");
  const spec: ChartSpec = {
    chartType: "bar",
    orientation: "horizontal",
    columns: { x: "category", value: "value", section: "panel" },
    xAxisType: "categorical",
    section_order: ["Group A", "Group B"],
    data: "sectioned-dense.csv",
  } as unknown as ChartSpec;
  const { svg } = renderChart(spec, rows, { width: 720, height: 900 });

  const texts = Array.from(svg.querySelectorAll("text"));
  const header = texts.find((t) => t.textContent === "Group B");
  expect(header).toBeTruthy();
  const headerY = absY(header ?? null);

  // Last bar of Group A (category "Hotel") and first bar of Group B (category "P01").
  const rectY = (cat: string): number => {
    const label = texts.find((t) => (t.textContent ?? "").trim() === cat);
    return absY(label ?? null);
  };
  const lastAbove = rectY("Hotel");
  const firstBelow = rectY("P01");

  const gapAbove = headerY - lastAbove; // header sits below the last Group A row
  const gapBelow = firstBelow - headerY; // and above the first Group B row
  expect(gapAbove).toBeGreaterThan(8); // no longer collapsed against the bar above
  // Comparable, not identical — within ~2x of each other.
  expect(Math.max(gapAbove, gapBelow) / Math.min(gapAbove, gapBelow)).toBeLessThan(2.2);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/golden.test.ts -t "comparable whitespace"`
Expected: FAIL — `gapAbove` is far smaller than `gapBelow` (cramped header) on the current one-slot spacer.

- [ ] **Step 4: Add the spacer-slot constant and slot helper in `axes.ts`**

Replace `sectionSpacer` (`axes.ts:554-563`) region with:

```ts
/** Sentinel prefix marking a section's empty spacer band slot. */
export const SECTION_SPACER_PREFIX = " section:";
/** Number of empty band slots reserved above each non-first section. Two slots (~2×row) give the
 *  header symmetric whitespace above and below at the dense row heights that exposed the defect;
 *  the header is lifted a fixed px from its section's first bar, so both gaps read as deliberate. */
export const SECTION_SPACER_SLOTS = 2;
/** The i-th spacer band value for a section (unique per slot so the band domain has no dup keys). */
export function sectionSpacerSlot(section: string, i: number): string {
  return `${SECTION_SPACER_PREFIX}${i}:${section}`;
}
/** Whether a band value is a section spacer sentinel (not a real category). */
export function isSectionSpacer(v: string): boolean {
  return v.startsWith(SECTION_SPACER_PREFIX);
}
```

Delete `tblSectionHeaderYAxis` (`axes.ts:565-591`) — all headers now use `tblSectionTopHeader`. (Confirm no other importers: `grep -rn tblSectionHeaderYAxis src test`.)

- [ ] **Step 5: Push a spacer block and unify header marks in `bar.ts`**

Update the `../axes` import (`bar.ts:20-31`): remove `tblSectionHeaderYAxis`, add `sectionSpacerSlot`, `SECTION_SPACER_SLOTS`.

Replace the section-domain build (`bar.ts:129-144`) so non-first sections get a block of slots, and headers are collected as `{ category, label }` on the section's first category:

```ts
const domain: string[] = [];
const sectionHeaders: { category: string; label: string }[] = [];
let firstRendered = false;
for (const s of order) {
  const catsInSection = categories.filter((cat) => (sectionOf.get(cat) ?? "") === s);
  if (!catsInSection.length) continue;
  if (!firstRendered) {
    topSectionHeader = { category: catsInSection[0] as string, label: labels[s] ?? s };
    firstRendered = true;
  } else {
    for (let i = 0; i < SECTION_SPACER_SLOTS; i++) domain.push(sectionSpacerSlot(s, i));
    sectionHeaders.push({ category: catsInSection[0] as string, label: labels[s] ?? s });
  }
  for (const cat of catsInSection) domain.push(cat);
}
bandDomain = domain;
```

Change `sectionHeaders`'s declared type (`bar.ts:105`) to `{ category: string; label: string }[]`. Delete the now-unused `topSectionHeader` special-casing? No — keep it; the first section still routes through `tblSectionTopHeader` via `topSectionHeader`.

In both header-mark sites, replace the `tblSectionHeaderYAxis(...)` call with per-header `tblSectionTopHeader` marks lifted by `topHeaderLift`. At `bar.ts:227-233` (`fyCategoryBandLayer`):

```ts
xAxisMarks: ctx.hideCategoryLabels
  ? []
  : [
      ...tblFacetGroupYAxis(categories, gutter, catFont),
      ...sectionHeaders.flatMap((h) => tblSectionTopHeader(h, gutter, topHeaderLift, catFont)),
      ...(topSectionHeader ? tblSectionTopHeader(topSectionHeader, gutter, topHeaderLift, catFont) : []),
    ],
```

Apply the identical change at the single-series non-faceted-return site (`bar.ts:344-350`), swapping `tblBandYAxis` for `tblFacetGroupYAxis`'s sibling already used there — keep that path's existing `tblBandYAxis(categories, …)` and only replace the `tblSectionHeaderYAxis(...)` line with the same `sectionHeaders.flatMap(...)` expression. (Note: this return path is dead for sectioned charts — sectioned single-series routes through `fyCategoryBandLayer` at `bar.ts:334` — but update it for consistency so the two paths can't drift.)

`SECTION_HEADER_GAP` (`bar.ts:40`) is now only used by `topHeaderLift` (`bar.ts:170`); leave it. The `hMarginTop` floor (`bar.ts:176-179`) already reserves the first header's block — unchanged.

- [ ] **Step 6: Keep the height model in sync (`figure.ts`)**

Delete the temporary `const SECTION_SPACER_SLOTS = 1;` added in Task 1 Step 3 and import the real constant: add `SECTION_SPACER_SLOTS` to the `./axes` import (`figure.ts:18`). In `renderFigure`'s auto-height (`figure.ts:305`), multiply the spacer count:

```ts
const nSpacers = Math.max(0, nSections - 1) * SECTION_SPACER_SLOTS;
```

(`horizontalBarChartHeight` from Task 1 already multiplies, and `computeChartHeight` delegates to it, so the live mount is covered.)

- [ ] **Step 7: Run the spacing test to verify it passes**

Run: `npx vitest run test/golden.test.ts -t "comparable whitespace"`
Expected: PASS.

- [ ] **Step 8: Regenerate and eyeball the sectioned golden fixtures**

The sectioned goldens legitimately change (header y-positions + reserved height). Regenerate and inspect the diff (headers should gain space above; no sentinel text leaks; bars unaffected):

Run: `npx vitest run test/golden.test.ts -u`
Then: `git diff --stat test/fixtures/*.golden.svg` and open `test/fixtures/figure7-tariff-sectioned.golden.svg` to confirm only section-header/height geometry moved.

- [ ] **Step 9: Full non-sectioned regression + commit**

Run: `npx vitest run test/golden.test.ts && npx tsc --noEmit`
Expected: PASS (unsectioned/vertical goldens byte-unchanged; sectioned goldens updated).

```bash
git add src/engine/axes.ts src/engine/marks/bar.ts src/engine/figure.ts test/golden.test.ts test/fixtures/sectioned-dense.csv test/fixtures/*.golden.svg
git commit -m "fix: symmetric section-header spacing via 2-slot spacer block"
```

---

### Task 3: Section-aware hover widen (Fix 1 — highlight must not spill into the header)

**Files:**
- Modify: `src/engine/crosshair.ts:701-720` (`widenBandsToMidpoints`), `:956-1018` (`readCategoryBandsH`), `:1125-1135` (horizontal caller)
- Test: `test/band-crosshair.test.ts` (extend `describe("widenBandsToMidpoints", …)`)

**Interfaces:**
- Produces: `widenBandsToMidpoints(bands, lo, hi, boundaryAfter?: boolean[])` — when `boundaryAfter[i]` is true, band `i` and band `i+1` are treated as having **no neighbor** on the shared side (each falls back to a symmetric self half-step), so neither widens across the section gap. Omitting `boundaryAfter` is byte-identical to today.
- Produces: `readCategoryBandsH(svgEl, opts): { bands: CategoryBandH[]; boundaryAfter: boolean[] }` (was `CategoryBandH[]`). `boundaryAfter[i]` marks a real band immediately followed by ≥1 skipped (empty) spacer facet.
- Consumes: the empty spacer facet `<g translate>` groups that Task 2 emits (`SECTION_SPACER_SLOTS` per non-first section), which `readCategoryBandsH` already skips.

- [ ] **Step 1: Write the failing unit test**

Add to `test/band-crosshair.test.ts` in the `describe("widenBandsToMidpoints", …)` block:

```ts
it("does NOT widen across a section boundary (boundaryAfter clamps the gap)", () => {
  // Three rows; a section gap sits between row 1 (index 1) and row 2 (index 2).
  const bands = [
    { min: 0, max: 20 },
    { min: 24, max: 44 }, // last row of section 1 (center 34)
    { min: 90, max: 110 }, // first row of section 2 (center 100), big gap above (spacer block)
  ];
  const plain = widenBandsToMidpoints(bands, 0, 200);
  // Without boundary info, band 1's bottom stretches to the midpoint across the gap (34↔100 ⇒ 67).
  expect(plain[1]!.max).toBeCloseTo(67, 0);

  const clamped = widenBandsToMidpoints(bands, 0, 200, [false, true, false]);
  // With the boundary after band 1, band 1 must NOT reach toward band 2 across the gap.
  expect(clamped[1]!.max).toBeLessThan(60);
  // And band 2's top must NOT reach back up across the gap toward band 1.
  expect(clamped[2]!.min).toBeGreaterThan(67);
  // Within-section edge (band 0↔1) is unchanged from the plain widen.
  expect(clamped[0]!.max).toBeCloseTo(plain[0]!.max, 5);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/band-crosshair.test.ts -t "section boundary"`
Expected: FAIL — `widenBandsToMidpoints` takes 3 args; `clamped[1].max` still ~67.

- [ ] **Step 3: Make `widenBandsToMidpoints` boundary-aware**

Replace the body (`crosshair.ts:706-719`):

```ts
export function widenBandsToMidpoints(
  bands: Array<{ min: number; max: number }>,
  lo: number,
  hi: number,
  boundaryAfter?: boolean[],
): Array<{ min: number; max: number }> {
  if (!bands.length) return [];
  const centers = bands.map((b) => (b.min + b.max) / 2);
  return centers.map((c, i) => {
    // A section boundary BEFORE band i (boundaryAfter[i-1]) or AFTER it (boundaryAfter[i]) removes
    // that neighbor for widening, so the edge falls back to a symmetric self half-step and never
    // crosses the spacer/header gap.
    const hasPrev = i > 0 && !(boundaryAfter?.[i - 1]);
    const hasNext = i < centers.length - 1 && !(boundaryAfter?.[i]);
    const prev = hasPrev ? centers[i - 1]! : null;
    const next = hasNext ? centers[i + 1]! : null;
    const left =
      prev != null ? (prev + c) / 2 : next != null ? c - (next - c) / 2 : (bands[i] as { min: number }).min;
    const right =
      next != null ? (c + next) / 2 : prev != null ? c + (c - prev) / 2 : (bands[i] as { max: number }).max;
    return { min: Math.max(lo, left), max: Math.min(hi, right) };
  });
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `npx vitest run test/band-crosshair.test.ts -t "section boundary"`
Expected: PASS. Also run the whole file to confirm the existing widen cases are unchanged: `npx vitest run test/band-crosshair.test.ts`.

- [ ] **Step 5: Return boundary info from `readCategoryBandsH`**

In the `isFaceted` branch (`crosshair.ts:962-989`), stop discarding empty facets — record every facet group's y and whether it has a rect, sort by y, then emit real bands while flagging boundaries:

```ts
const groups = Array.from(svgEl.querySelectorAll<SVGGElement>('g[aria-label="bar"] > g'));
if (groups.length) {
  const parsed: Array<{ y: number; g: SVGGElement; hasRect: boolean }> = [];
  for (const g of groups) {
    const transform = g.getAttribute("transform") ?? "";
    const m = /translate\(\s*-?[\d.]+\s*[ ,]\s*([\d.+-]+)/.exec(transform);
    const ty = m ? parseFloat(m[1]!) : 0;
    parsed.push({ y: ty, g, hasRect: !!g.querySelector("rect") });
  }
  parsed.sort((a, b) => a.y - b.y);
  const bands: CategoryBandH[] = [];
  const boundaryAfter: boolean[] = [];
  let sawEmptySinceLastReal = false;
  let ci = 0;
  for (const p of parsed) {
    if (!p.hasRect) {
      if (bands.length) sawEmptySinceLastReal = true; // spacer block AFTER a real band
      continue;
    }
    if (sawEmptySinceLastReal && bands.length) boundaryAfter[bands.length - 1] = true;
    sawEmptySinceLastReal = false;
    const cat = categories[ci] ?? String(ci);
    ci++;
    const rects = Array.from(p.g.querySelectorAll<SVGRectElement>("rect"));
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const rect of rects) {
      const ry = parseFloat(rect.getAttribute("y") ?? "0") + p.y;
      const rh = parseFloat(rect.getAttribute("height") ?? "0");
      if (ry < yMin) yMin = ry;
      if (ry + rh > yMax) yMax = ry + rh;
    }
    bands.push({ category: cat, yMin, yMax });
    boundaryAfter.push(false);
  }
  return { bands, boundaryAfter };
}
```

Change the single-band fall-through path (`crosshair.ts:993-1017`) to return `{ bands: <existing array>, boundaryAfter: <same-length false array> }`, and the empty-return (`crosshair.ts:994`) to `return { bands: [], boundaryAfter: [] };`. Update the function's return type annotation.

- [ ] **Step 6: Thread `boundaryAfter` through the horizontal caller**

Update the horizontal branch of `attachBandCrosshair` (`crosshair.ts:1125-1135`):

```ts
const { bands: raw, boundaryAfter } = readCategoryBandsH(svgEl, opts);
const wide = widenBandsToMidpoints(
  raw.map((b) => ({ min: b.yMin, max: b.yMax })),
  mt,
  H - mb,
  boundaryAfter,
);
```

(`raw` is now `CategoryBandH[]` destructured from the object; the following `raw.map((b, i) => …)` at `crosshair.ts:1131` is unchanged.)

- [ ] **Step 7: Verify types and full crosshair suite**

Run: `npx vitest run test/band-crosshair.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/engine/crosshair.ts test/band-crosshair.test.ts
git commit -m "fix: section-aware hover widen so highlight never spills into section headers"
```

---

### Task 4: Shared figure pane-height helper — fix waterfall export squash + grow horizontal-stacked figures (Fix 2 extension)

**Files:**
- Modify: `src/engine/figure.ts` (add `figurePaneHeight` export near `horizontalBarChartHeight`)
- Modify: `src/engine/render-live.ts:1906-1921` (mountFigure pane-height + horizontal-bar gate)
- Modify: `src/embed/export-png.ts:67-73` (delete local pane-height constants), `:284-303`, `:312-333` (figure branch uses the helper; broaden the horizontal-bar gate to include stacked)
- Test: `test/figure-height.test.ts` (extend)

**Interfaces:**
- Produces: `figurePaneHeight(spec: ChartSpec): number | undefined` in `figure.ts` — the fixed per-pane px height for a small-multiples figure by chart type; **`undefined` for horizontal `bar`/`stacked`** (those grow with row count via `renderFigure`'s auto-height when `opts.height` is undefined). Values: waterfall → 420, dotplot/bar/stacked (non-horizontal) → 320, everything else → 240. This is the single source of truth shared by the live figure mount and the PNG export.
- Consumes: existing `renderFigure` auto-height for horizontal bar/stacked (`figure.ts:288-330`, which already treats stacked as horizontal-bar for gutter/height via `isHorizontalBar`/`isHorizontalStacked`).

**Why:** `render-live.ts:1914` sizes waterfall figure panes at 420px but the export (`export-png.ts:70-71`) omitted that case, exporting them at 240px (squashed). And horizontal *stacked* figures don't grow on either path (only horizontal *bar* does), though `renderFigure` already computes a correct grown height for them. One shared helper fixes both and stops the two paths drifting.

- [ ] **Step 1: Write the failing tests**

Add to `test/figure-height.test.ts`:

```ts
import { figurePaneHeight } from "../src/engine/figure";

describe("figurePaneHeight", () => {
  const base = { columns: { x: "category", value: "value", facet: "panel" }, xAxisType: "categorical", data: "x" };
  it("waterfall figure panes are 420 (matches the live mount, not the old 240)", () => {
    expect(figurePaneHeight({ ...base, chartType: "waterfall" } as any)).toBe(420);
  });
  it("dotplot/bar/stacked (vertical) figure panes are 320", () => {
    expect(figurePaneHeight({ ...base, chartType: "dotplot" } as any)).toBe(320);
    expect(figurePaneHeight({ ...base, chartType: "bar" } as any)).toBe(320);
    expect(figurePaneHeight({ ...base, chartType: "stacked" } as any)).toBe(320);
  });
  it("line/scatter/area figure panes are 240", () => {
    expect(figurePaneHeight({ ...base, chartType: "line" } as any)).toBe(240);
    expect(figurePaneHeight({ ...base, chartType: "scatter" } as any)).toBe(240);
  });
  it("horizontal bar AND horizontal stacked figures grow (undefined ⇒ auto-height)", () => {
    expect(figurePaneHeight({ ...base, chartType: "bar", orientation: "horizontal" } as any)).toBeUndefined();
    expect(figurePaneHeight({ ...base, chartType: "stacked", orientation: "horizontal" } as any)).toBeUndefined();
  });
});
```

Also add an export-integration test proving the waterfall figure pane grows and a horizontal-stacked figure grows. Build a synthetic small-multiples spec (facet column, ≥2 panes) for each and assert the rendered pane height:

```ts
import { renderFigure } from "../src/engine/index";

it("waterfall figure export renders 420px panes, not 240 (regression: export drift)", () => {
  const spec = {
    chartType: "waterfall",
    columns: { x: "step", value: "value", facet: "model" },
    xAxisType: "categorical",
    small_multiples: { facet_field: "model" },
    data: "x",
  } as any;
  const rows: TidyRow[] = [];
  for (const m of ["Original", "New"]) {
    ["Start", "Step 1", "Step 2", "End"].forEach((s, i) =>
      rows.push({ step: s, model: m, value: String(2 - i * 0.4) } as TidyRow),
    );
  }
  const fig = renderFigure(spec, rows, { gridWidth: 920, gridGap: 20, height: figurePaneHeight(spec), columns: 2 });
  const paneH = Number((fig.panes[0]!.svg as SVGSVGElement).getAttribute("height"));
  expect(paneH).toBe(420);
});

it("horizontal stacked figure grows its pane height with row count", () => {
  const spec = {
    chartType: "stacked",
    orientation: "horizontal",
    columns: { x: "category", value: "value", series: "series", facet: "panel" },
    xAxisType: "categorical",
    small_multiples: { facet_field: "panel" },
    data: "x",
  } as any;
  const rows: TidyRow[] = [];
  for (const p of ["P1", "P2"]) {
    for (let c = 0; c < 20; c++) {
      for (const s of ["A", "B"]) rows.push({ category: `C${c}`, series: s, value: "1", panel: p } as TidyRow);
    }
  }
  // undefined height ⇒ renderFigure auto-grows for horizontal bar/stacked.
  const fig = renderFigure(spec, rows, { gridWidth: 920, gridGap: 20, height: figurePaneHeight(spec), columns: 2 });
  const paneH = Number((fig.panes[0]!.svg as SVGSVGElement).getAttribute("height"));
  expect(paneH).toBeGreaterThan(420); // 20 categories ⇒ taller than any fixed pane height
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/figure-height.test.ts -t "figurePaneHeight"` and `-t "waterfall figure export"` and `-t "horizontal stacked figure grows"`.
Expected: FAIL — `figurePaneHeight` not exported; and (before the caller change) the horizontal-stacked figure comes back at the fixed 320, not grown.

- [ ] **Step 3: Add `figurePaneHeight` to `figure.ts`**

Insert after `horizontalBarChartHeight`:

```ts
/** Fixed per-pane px height for a small-multiples figure, by chart type — the single source of
 *  truth shared by the live figure mount (render-live) and the PNG export (export-png), so the
 *  two can't drift (the export previously omitted waterfall's taller pane, squashing it to 240).
 *  Returns undefined for horizontal bar/stacked figures, whose height GROWS with row count:
 *  renderFigure computes it from horizontalBarHeight when opts.height is undefined. */
export function figurePaneHeight(spec: ChartSpec): number | undefined {
  const horizontal = spec.orientation === "horizontal";
  if (horizontal && (spec.chartType === "bar" || spec.chartType === "stacked")) return undefined;
  if (spec.chartType === "waterfall") return 420;
  if (spec.chartType === "dotplot" || spec.chartType === "bar" || spec.chartType === "stacked") return 320;
  return 240;
}
```

- [ ] **Step 4: Use the helper in the live figure mount (`render-live.ts`)**

At `render-live.ts:1913-1921`, replace the local `TALL_PANE_TYPES`/`paneHeight`/`figHeight` height computation and broaden the horizontal gate to include stacked (keep `paneMinWidth` at `:1910` unchanged — that's a width heuristic):

```ts
const isHorizontalBarFig =
  (spec.chartType === "bar" || spec.chartType === "stacked") && spec.orientation === "horizontal";
const isCategoricalBarFig = spec.chartType === "bar" || spec.chartType === "stacked";
const figHeight = figurePaneHeight(spec); // undefined for horizontal bar/stacked ⇒ auto-grow
```

Add `figurePaneHeight` to the existing `./figure` import. **Then grep every use of `isHorizontalBarFig` in this function and confirm broadening it to include horizontal stacked is correct at each site** (it drives pane-title offset + the horizontal-bar height read-back — both apply equally to horizontal stacked, which shares the left-gutter fy topology). Report each site you checked.

- [ ] **Step 5: Use the helper in the PNG export (`export-png.ts`)**

Delete the local constants `PANE_CHART_H`, `TALL_PANE_CHART_H`, `TALL_PANE_TYPES` (`export-png.ts:67-71`). Broaden the figure horizontal gate (`:284`) and source the pane height from the helper (`:287`):

```ts
const isHorizontalBarFig =
  (spec.chartType === "bar" || spec.chartType === "stacked") && spec.orientation === "horizontal";
```

```ts
const paneChartH = figurePaneHeight(spec); // undefined ⇒ grows (horizontal bar/stacked)
```

Since `figurePaneHeight` already returns `undefined` for horizontal bar/stacked, simplify the two `renderFigure` calls (`:302-303`) to pass `height: paneChartH` directly (drop the `isHorizontalBarFig ? undefined : paneChartH` ternary). The effPaneH read-back (`:312-321`), `useGridW` (`:294`/`:300`), and `titleDx` (`:325-327`) stay gated on the now-broadened `isHorizontalBarFig`. Add `figurePaneHeight` to the `../engine/figure.js` import. Confirm `paneChartH`'s remaining uses tolerate `undefined` (the `?? paneChartH` fallbacks at `:321`/`:302` and `effPaneH` read-back already handle the horizontal-bar undefined case).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run test/figure-height.test.ts`
Expected: PASS (all figurePaneHeight + both growth integration tests).

- [ ] **Step 7: Regenerate any affected figure goldens and eyeball**

Growing horizontal-stacked figures and fixing waterfall panes changes those goldens' heights. Run `npx vitest run -u` scoped to golden/figure tests, then `git diff --stat test/**/*.golden.svg` — confirm ONLY waterfall-figure and horizontal-stacked-figure heights changed (and their dependent layout), and that no unrelated (vertical bar, line, single-chart) golden moved. If an unrelated golden changes, stop and report.

- [ ] **Step 8: Full suite, typecheck, commit**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

```bash
git add src/engine/figure.ts src/engine/render-live.ts src/embed/export-png.ts test/figure-height.test.ts test/**/*.golden.svg
git commit -m "fix: unify figure pane-height (fixes waterfall export squash; grows horizontal-stacked figures)"
```

---

### Task 5: Full verification + live/PNG visual proof

**Files:** none (verification only).

- [ ] **Step 1: Full test suite + typecheck + build**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all green.

- [ ] **Step 2: Build a synthetic sectioned chart and render it live + export**

Use the gallery/CLI with a **synthetic** dense two-section spec (never the spec's real CSV). Serve the gallery (`npm run gallery`) or render the example, then in the browser: (a) confirm the second header has clear space above and below matching the first; (b) hover the section-boundary bars and the header band — the highlight stays within each section and never paints the header; (c) Download PNG and confirm every category label is on its own row with no overlap and bar thickness matches the live mount.

- [ ] **Step 3: Capture before/after screenshots**

Save live + PNG screenshots (synthetic data only) for the user's visual approval. Do not open a PR until the user approves the live version and directly prompts for it.

- [ ] **Step 4: Report for visual approval**

Summarize the three commits and attach the screenshots. Await the user's visual sign-off and explicit go-ahead before `finishing-a-development-branch` / opening the PR.

---

## Self-Review

**Spec coverage:**
- Fix 1 spacing (spec §"Fix 1 → Required behavior") → Task 2. Inter-section gap no longer scales toward zero; symmetric above/below via 2-slot block + unified lifted header.
- Fix 1 hover constraint (spec §"Constraint — do NOT let hover highlight spill") → Task 3. `boundaryAfter` clamps section-boundary bars; header band inert.
- Fix 1 height-helper sync (spec §"Required behavior" note) → Tasks 1+2: `SECTION_SPACER_SLOTS` consumed by `bar.ts` domain and both height paths.
- Fix 2 export height (spec §"Fix 2") → Task 1: single horizontal export sizes from `horizontalBarChartHeight`, frame grows; vertical/other single charts and figure exports unchanged.
- Acceptance — existing charts unchanged → Task 2 Step 9 / Task 4 Step 1 (golden gate); sectioned goldens regenerated + reviewed (Task 2 Step 8).

**Placeholder scan:** No TBD/TODO. Every code step shows the code; every run step shows the command + expected result. The one tunable (2-slot count / 28px lift) has a concrete starting value grounded in the existing `topHeaderLift`, validated in Task 2 Step 7 and the Task 4 visual pass.

**Type consistency:** `horizontalBarChartHeight(spec, rows): number` used identically in Tasks 1 (figure/render-live/export). `SECTION_SPACER_SLOTS` (number) and `sectionSpacerSlot(section, i)` (string) consistent across `axes.ts`/`bar.ts`/`figure.ts`. `readCategoryBandsH` return shape `{ bands, boundaryAfter }` updated at its one caller. `widenBandsToMidpoints`'s new 4th param is optional ⇒ existing 3-arg calls (vertical branch, tests) still typecheck.

**Note on the temporary constant:** Task 1 Step 3 introduces a temporary `SECTION_SPACER_SLOTS = 1` in `figure.ts` so Task 1 lands independently green; Task 2 Step 6 removes it and imports the real `= 2`. Between Task 1 and Task 2 the export height is correct for the 1-slot layout then updated to 2-slot — no broken intermediate state.
