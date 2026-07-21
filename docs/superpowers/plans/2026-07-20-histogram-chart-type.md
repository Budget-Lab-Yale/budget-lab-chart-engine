# Histogram Chart Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `histogram` chart type on a continuous (numeric or temporal) x-axis, with engine binning, pre-binned input, faceting, and overlapping multi-series.

**Architecture:** A pure binning module turns already-parsed rows into binned rows carrying bin edges + height; a new rect mark draws them on a continuous scale. Binning thresholds are shared across series (always) and across facets (in `shared` mode). Pre-binned data skips binning and flows through the same model. See spec: `docs/superpowers/specs/2026-07-20-histogram-chart-type-design.md`.

**Tech Stack:** TypeScript (ESM, `strict`), Observable Plot 0.6.16 (vendored, imported as `Plot` from `../vendor`), Vitest (+ jsdom for DOM tests), ajv JSON Schema.

## Global Constraints

- Determinism: no `Date.now()`, `Math.random()`, or argless `new Date()` in engine/render code — golden SVG snapshots must stay stable. Temporal math uses explicit epoch-ms / UTC `Date` arithmetic.
- Byte-identical output for existing chart types: no golden fixture in `test/fixtures/*.svg` may change. New behavior is reached only when `chartType === "histogram"`.
- Strict schema: `additionalProperties: false` everywhere — every new spec field must be added to `src/spec/schema.ts` or it fails validation.
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit.
- Test commands: `npx vitest run <file>` for one file; `npm test` for the whole suite; `npm run typecheck` for types.
- Vitest deterministic measurer convention (DOM/layout tests): `const measureText = (s: string) => s.length * 7;`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/spec/types.ts` | `ChartType += "histogram"`; `ColumnMap += x0, x1`; new `HistogramConfig` block on `ChartSpec`. |
| `src/spec/schema.ts` | JSON Schema for the `histogram` block and `columns.x0/x1`. |
| `src/spec/validate.ts` | Histogram-specific cross-field validation. |
| `src/spec/columns.ts` | Resolve `x0`/`x1` roles; expose `isPreBinned`. |
| `src/engine/histogram-bin.ts` | **New.** Pure binning: thresholds (width/count/auto), aggregation (count/weight), normalization, temporal edges. |
| `src/engine/marks/index.ts` | `PreparedRow += _x0, _x1`; register `histogram` builder. |
| `src/engine/marks/histogram.ts` | **New.** `buildHistogramMarks` — rect mark, overlap opacity, tagging. |
| `src/engine/x-adapter.ts` | Continuous-x path for histogram (domain from bin edges; nice ticks). |
| `src/engine/index.ts` | In `renderPane`: parse pre-binned edges / call the binner; y-extent for histogram. |
| `src/engine/figure.ts` | Compute shared thresholds once (shared mode) and thread them to panes. |
| `CONFIG-SPEC.md`, `CHANGELOG.md`, `package.json` | Docs + minor version bump. |
| `test/engine/histogram-bin.test.ts`, `test/engine/histogram-render.test.ts`, `test/table/... n/a` | New tests. |

---

## Task 1: Spec surface — types, schema, validation

**Files:**
- Modify: `src/spec/types.ts`
- Modify: `src/spec/schema.ts`
- Modify: `src/spec/validate.ts`
- Test: `test/histogram-spec.test.ts` (create)

**Interfaces:**
- Produces: `ChartType` includes `"histogram"`; `ColumnMap` gains `x0?: string; x1?: string`; `ChartSpec` gains `histogram?: HistogramConfig` where
  ```ts
  export interface HistogramConfig {
    bins?: number;
    binWidth?: number | string;                 // number (numeric x); or "day"|"week"|"month"|"quarter"|"year"|number-of-days (temporal)
    domain?: [number, number];
    normalize?: "none" | "proportion" | "density";
    weight?: string;                            // column summed per bin; default = row count
  }
  ```

- [ ] **Step 1: Write the failing validation tests**

Create `test/histogram-spec.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { validateChart } from "../src/spec/validate";
import type { ChartSpec } from "../src/spec/types";

const base = {
  chartType: "histogram", title: "H", xAxisType: "numeric",
  columns: { x: "amount" }, data: "d.csv",
} as unknown as ChartSpec;

describe("histogram spec validation", () => {
  it("accepts a minimal numeric histogram", () => {
    expect(validateChart(base).valid).toBe(true);
  });
  it("accepts bins / binWidth / normalize / weight", () => {
    expect(validateChart({ ...base, histogram: { bins: 20, normalize: "density", weight: "w" } } as any).valid).toBe(true);
    expect(validateChart({ ...base, histogram: { binWidth: 5 } } as any).valid).toBe(true);
  });
  it("rejects a non-numeric/temporal x-axis for histograms", () => {
    expect(validateChart({ ...base, xAxisType: "categorical" } as any).valid).toBe(false);
  });
  it("rejects an unknown normalize value", () => {
    expect(validateChart({ ...base, histogram: { normalize: "zscore" } } as any).valid).toBe(false);
  });
  it("accepts pre-binned (x0+x1+value) and rejects bin config alongside it", () => {
    const pre = { ...base, columns: { x0: "lo", x1: "hi", value: "n" } } as any;
    expect(validateChart(pre).valid).toBe(true);
    expect(validateChart({ ...pre, histogram: { bins: 10 } }).valid).toBe(false);
  });
  it("rejects pre-binned missing an edge column", () => {
    expect(validateChart({ ...base, columns: { x0: "lo", value: "n" } } as any).valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/histogram-spec.test.ts`
Expected: FAIL (histogram not a valid chartType / rules absent).

- [ ] **Step 3: Add the types**

In `src/spec/types.ts`:
- Change the `ChartType` union to include `"histogram"`:
  ```ts
  export type ChartType = "line" | "area" | "bar" | "stacked" | "scatter" | "dotplot" | "waterfall" | "histogram";
  ```
- Add to `ColumnMap` (after `kind?`):
  ```ts
  /** Histogram pre-binned data: columns holding each bin's lower/upper edge. When BOTH are mapped,
   *  the histogram treats data as pre-binned (no engine binning) and `value` is the bar height. */
  x0?: string;
  x1?: string;
  ```
- Add the config interface (near the other config interfaces) and the field on `ChartSpec` (in the bar/stacked area):
  ```ts
  export interface HistogramConfig {
    /** Bin COUNT. Ignored when binWidth is set. */
    bins?: number;
    /** Bin WIDTH: a number in x-units (numeric x), or for temporal x a calendar interval name
     *  ("day"|"week"|"month"|"quarter"|"year") or a number interpreted as days. */
    binWidth?: number | string;
    /** Explicit binning range [min, max]; default = data extent. */
    domain?: [number, number];
    /** Bar-height normalization. "proportion": each series sums to 1. "density": area = 1. Default "none". */
    normalize?: "none" | "proportion" | "density";
    /** Column summed per bin (weighted histogram); default = row count. Ignored when pre-binned. */
    weight?: string;
  }
  ```
  ```ts
  // Histogram (continuous-x binned bars). Ignored by other chart types.
  histogram?: HistogramConfig;
  ```

- [ ] **Step 4: Add the schema**

In `src/spec/schema.ts`, add to the `columns` object's `properties`: `x0: { type: "string" }, x1: { type: "string" }`. Add a top-level property on the chart schema:
```ts
histogram: {
  type: "object",
  additionalProperties: false,
  properties: {
    bins: { type: "number" },
    binWidth: { anyOf: [{ type: "number" }, { type: "string" }] },
    domain: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
    normalize: { type: "string", enum: ["none", "proportion", "density"] },
    weight: { type: "string" },
  },
},
```

- [ ] **Step 5: Add cross-field validation**

In `src/spec/validate.ts`, inside the chart-level checks, add a histogram branch (after schema validation passes):
```ts
if (spec.chartType === "histogram") {
  const c = spec.columns ?? {};
  const preBinned = c.x0 != null && c.x1 != null;
  if (spec.xAxisType !== "numeric" && spec.xAxisType !== "temporal") {
    errors.push('histogram requires xAxisType "numeric" or "temporal"');
  }
  if ((c.x0 != null) !== (c.x1 != null)) {
    errors.push("histogram pre-binned mode requires BOTH columns.x0 and columns.x1");
  }
  if (preBinned && spec.histogram && (spec.histogram.bins != null || spec.histogram.binWidth != null || spec.histogram.domain != null || spec.histogram.weight != null)) {
    errors.push("histogram: bin config (bins/binWidth/domain/weight) is not allowed with pre-binned data (columns.x0/x1)");
  }
}
```
(Match the surrounding error-collection idiom already used in `validate.ts`.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/histogram-spec.test.ts` → Expected: PASS.
Run: `npm run typecheck` → Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/spec/types.ts src/spec/schema.ts src/spec/validate.ts test/histogram-spec.test.ts
git commit -m "feat(histogram): spec type, schema, and validation"
```

---

## Task 2: Numeric binning core (`histogram-bin.ts`)

**Files:**
- Create: `src/engine/histogram-bin.ts`
- Test: `test/engine/histogram-bin.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks (pure module).
- Produces:
  ```ts
  export interface BinnedRow { series: string; _x0: number; _x1: number; _y: number; _facet?: string }
  export interface BinInput { series: string; x: number; weight?: number; _facet?: string }
  export interface BinSpec {
    bins?: number;
    binWidth?: number;                 // numeric width (temporal edges are supplied via `thresholds`)
    domain?: [number, number];
    normalize?: "none" | "proportion" | "density";
    thresholds?: number[];             // explicit shared edges (overrides bins/binWidth/domain)
  }
  export function computeThresholds(values: number[], spec: BinSpec): number[];
  export function binValues(rows: BinInput[], spec: BinSpec): BinnedRow[];
  ```

- [ ] **Step 1: Write the failing tests**

Create `test/engine/histogram-bin.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { computeThresholds, binValues } from "../../src/engine/histogram-bin";

const rows = (xs: number[], series = "") => xs.map((x) => ({ series, x }));

describe("computeThresholds", () => {
  it("uses an explicit binWidth stepping from the domain start", () => {
    expect(computeThresholds([0, 10], { binWidth: 5, domain: [0, 10] })).toEqual([0, 5, 10]);
  });
  it("uses a bin COUNT to divide the domain evenly", () => {
    expect(computeThresholds([0, 100], { bins: 4, domain: [0, 100] })).toEqual([0, 25, 50, 75, 100]);
  });
  it("closes the last (short) bin on max when the width does not divide evenly", () => {
    expect(computeThresholds([0, 12], { binWidth: 5, domain: [0, 12] })).toEqual([0, 5, 10, 12]);
  });
  it("auto-bins (returns >= 2 edges spanning the data extent) when neither is set", () => {
    const t = computeThresholds([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], {});
    expect(t.length).toBeGreaterThanOrEqual(2);
    expect(t[0]).toBe(1); expect(t[t.length - 1]).toBe(10);
  });
  it("returns a single unit bin for a zero-range domain (never divides by zero)", () => {
    expect(computeThresholds([5, 5, 5], {})).toEqual([5, 6]);
  });
});

describe("binValues", () => {
  it("counts values per bin, half-open [x0,x1) with the last bin closed on max", () => {
    const out = binValues(rows([0, 1, 5, 9, 10]), { binWidth: 5, domain: [0, 10] });
    // bins [0,5)->{0,1}, [5,10]->{5,9,10}
    expect(out.map((b) => [b._x0, b._x1, b._y])).toEqual([[0, 5, 2], [5, 10, 3]]);
  });
  it("emits one row per (bin x series), preserving empty bins as _y=0", () => {
    const out = binValues([...rows([0, 1], "A"), ...rows([9], "B")], { binWidth: 5, domain: [0, 10] });
    const a = out.filter((b) => b.series === "A").map((b) => b._y);
    const b = out.filter((b) => b.series === "B").map((b) => b._y);
    expect(a).toEqual([2, 0]); // A: [0,5)->2, [5,10]->0
    expect(b).toEqual([0, 1]); // B: [0,5)->0, [5,10]->1
  });
  it("sums weights when a weight is present (weighted histogram)", () => {
    const out = binValues([{ series: "", x: 1, weight: 3 }, { series: "", x: 2, weight: 4 }], { binWidth: 5, domain: [0, 5] });
    expect(out[0]!._y).toBe(7);
  });
  it("normalize=proportion makes each series sum to 1", () => {
    const out = binValues(rows([0, 1, 9]), { binWidth: 5, domain: [0, 10], normalize: "proportion" });
    expect(out.reduce((s, b) => s + b._y, 0)).toBeCloseTo(1, 9);
  });
  it("normalize=density makes area (sum of _y*width) = 1", () => {
    const out = binValues(rows([0, 1, 9]), { binWidth: 5, domain: [0, 10], normalize: "density" });
    const area = out.reduce((s, b) => s + b._y * (b._x1 - b._x0), 0);
    expect(area).toBeCloseTo(1, 9);
  });
  it("honors explicit shared thresholds (ignores bins/binWidth)", () => {
    const out = binValues(rows([0, 3, 8]), { thresholds: [0, 4, 8] });
    expect(out.map((b) => [b._x0, b._x1, b._y])).toEqual([[0, 4, 1], [4, 8, 2]]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/engine/histogram-bin.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `histogram-bin.ts`**

Create `src/engine/histogram-bin.ts`:
```ts
// Pure, deterministic histogram binning: thresholds + aggregation + normalization. No DOM, no Plot,
// no Date.now/random. Operates on already-parsed numeric x (temporal callers pass epoch-ms and
// usually explicit `thresholds` from calendarEdges/temporal helpers).

export interface BinnedRow { series: string; _x0: number; _x1: number; _y: number; _facet?: string }
export interface BinInput { series: string; x: number; weight?: number; _facet?: string }
export interface BinSpec {
  bins?: number;
  binWidth?: number;
  domain?: [number, number];
  normalize?: "none" | "proportion" | "density";
  thresholds?: number[];
}

/** Freedman–Diaconis bin count; falls back to Sturges when the IQR is 0. */
function autoBinCount(values: number[]): number {
  const n = values.length;
  if (n < 2) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => {
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
  };
  const iqr = q(0.75) - q(0.25);
  const min = sorted[0]!, max = sorted[sorted.length - 1]!;
  if (iqr <= 0) return Math.max(1, Math.ceil(Math.log2(n) + 1)); // Sturges
  const width = 2 * iqr * Math.pow(n, -1 / 3);
  return Math.max(1, Math.ceil((max - min) / width));
}

export function computeThresholds(values: number[], spec: BinSpec): number[] {
  if (spec.thresholds && spec.thresholds.length >= 2) return spec.thresholds;
  let [min, max] = spec.domain ?? [Math.min(...values), Math.max(...values)];
  if (!Number.isFinite(min) || !Number.isFinite(max)) { min = 0; max = 1; }
  if (max <= min) return [min, min + 1]; // zero-range → single unit bin
  const width = spec.binWidth != null && spec.binWidth > 0
    ? spec.binWidth
    : (max - min) / (spec.bins && spec.bins > 0 ? spec.bins : autoBinCount(values));
  const edges: number[] = [];
  for (let e = min; e < max - 1e-9; e += width) edges.push(e);
  edges.push(max); // always close on max (final bin may be short)
  return edges;
}

/** Index of the bin for x: half-open [t[i], t[i+1]); the last bin is closed on max. */
function binIndex(x: number, t: number[]): number {
  if (x < t[0]! || x > t[t.length - 1]!) return -1;
  if (x === t[t.length - 1]!) return t.length - 2; // closed last bin
  let lo = 0, hi = t.length - 1;
  while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (x < t[mid]!) hi = mid; else lo = mid; }
  return lo;
}

export function binValues(rows: BinInput[], spec: BinSpec): BinnedRow[] {
  const values = rows.map((r) => r.x).filter(Number.isFinite);
  const t = computeThresholds(values, spec);
  const nBins = t.length - 1;
  // Series in first-seen order; empty bins are preserved as _y=0 for a continuous axis.
  const seriesOrder: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) if (!seen.has(r.series)) { seen.add(r.series); seriesOrder.push(r.series); }
  if (!seriesOrder.length) seriesOrder.push("");
  const facetOf = new Map<string, string | undefined>();
  const acc = new Map<string, number[]>();
  for (const s of seriesOrder) acc.set(s, new Array(nBins).fill(0));
  for (const r of rows) {
    const i = binIndex(r.x, t);
    if (i < 0) continue;
    acc.get(r.series)![i]! += r.weight ?? 1;
    if (!facetOf.has(r.series)) facetOf.set(r.series, r._facet);
  }
  const out: BinnedRow[] = [];
  for (const s of seriesOrder) {
    const counts = acc.get(s)!;
    const total = counts.reduce((a, b) => a + b, 0) || 1;
    for (let i = 0; i < nBins; i++) {
      const x0 = t[i]!, x1 = t[i + 1]!;
      let y = counts[i]!;
      if (spec.normalize === "proportion") y = y / total;
      else if (spec.normalize === "density") y = y / (total * (x1 - x0));
      const row: BinnedRow = { series: s, _x0: x0, _x1: x1, _y: y };
      const f = facetOf.get(s); if (f !== undefined) row._facet = f;
      out.push(row);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/engine/histogram-bin.test.ts` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/histogram-bin.ts test/engine/histogram-bin.test.ts
git commit -m "feat(histogram): pure numeric binning core (thresholds, aggregation, normalization)"
```

---

## Task 3: Temporal bin edges

**Files:**
- Modify: `src/engine/histogram-bin.ts`
- Test: `test/engine/histogram-bin.test.ts` (add cases)

**Interfaces:**
- Produces: `export function calendarEdges(startMs: number, endMs: number, interval: "day"|"week"|"month"|"quarter"|"year"): number[]` and `export function temporalThresholds(valuesMs: number[], binWidth: number | string | undefined, bins: number | undefined, domain: [number, number] | undefined): number[]`.

- [ ] **Step 1: Write the failing tests**

Add to `test/engine/histogram-bin.test.ts`:
```ts
import { calendarEdges, temporalThresholds } from "../../src/engine/histogram-bin";

const ms = (iso: string) => Date.parse(iso + "T00:00:00Z");

describe("temporal edges", () => {
  it("calendarEdges by month covers the range on UTC month boundaries", () => {
    const e = calendarEdges(ms("2024-01-10"), ms("2024-03-05"), "month");
    expect(e[0]).toBe(ms("2024-01-01"));
    expect(e).toContain(ms("2024-02-01"));
    expect(e).toContain(ms("2024-03-01"));
    expect(e[e.length - 1]).toBeGreaterThanOrEqual(ms("2024-04-01"));
  });
  it("temporalThresholds with a day-count width steps in whole days", () => {
    const t = temporalThresholds([ms("2024-01-01"), ms("2024-01-08")], 7, undefined, undefined);
    expect(t[1]! - t[0]!).toBe(7 * 86400000);
  });
  it("temporalThresholds with a bin count divides the ms range evenly", () => {
    const t = temporalThresholds([0, 100], undefined, 4, [0, 100]);
    expect(t).toEqual([0, 25, 50, 75, 100]);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run test/engine/histogram-bin.test.ts` → Expected: FAIL (exports missing).

- [ ] **Step 3: Implement the temporal helpers**

Add to `src/engine/histogram-bin.ts`:
```ts
const DAY_MS = 86400000;

/** UTC calendar-boundary edges spanning [startMs, endMs], inclusive of a trailing edge past endMs. */
export function calendarEdges(
  startMs: number, endMs: number,
  interval: "day" | "week" | "month" | "quarter" | "year",
): number[] {
  const floor = (ms: number): number => {
    const d = new Date(ms);
    if (interval === "day") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    if (interval === "week") { const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); return day - ((new Date(day).getUTCDay()) * DAY_MS); }
    if (interval === "month") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    if (interval === "quarter") return Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1);
    return Date.UTC(d.getUTCFullYear(), 0, 1); // year
  };
  const next = (ms: number): number => {
    const d = new Date(ms);
    if (interval === "day") return ms + DAY_MS;
    if (interval === "week") return ms + 7 * DAY_MS;
    if (interval === "month") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    if (interval === "quarter") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1);
    return Date.UTC(d.getUTCFullYear() + 1, 0, 1);
  };
  const edges: number[] = [];
  let e = floor(startMs);
  edges.push(e);
  while (e <= endMs) { e = next(e); edges.push(e); }
  return edges;
}

/** Thresholds for a temporal axis. `binWidth` may be a calendar interval name, a day count, or
 *  undefined (then `bins`, then auto by day-count). */
export function temporalThresholds(
  valuesMs: number[], binWidth: number | string | undefined, bins: number | undefined,
  domain: [number, number] | undefined,
): number[] {
  const [min, max] = domain ?? [Math.min(...valuesMs), Math.max(...valuesMs)];
  if (typeof binWidth === "string") {
    if (["day", "week", "month", "quarter", "year"].includes(binWidth)) {
      return calendarEdges(min, max, binWidth as "day");
    }
    const days = Number(binWidth);
    if (Number.isFinite(days) && days > 0) return computeThresholds(valuesMs, { binWidth: days * DAY_MS, domain: [min, max] });
  }
  if (typeof binWidth === "number" && binWidth > 0) return computeThresholds(valuesMs, { binWidth: binWidth * DAY_MS, domain: [min, max] });
  return computeThresholds(valuesMs, { bins, domain: [min, max] });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/engine/histogram-bin.test.ts` → Expected: PASS. Then `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/engine/histogram-bin.ts test/engine/histogram-bin.test.ts
git commit -m "feat(histogram): temporal bin edges (calendar intervals + day counts)"
```

---

## Task 4: PreparedRow fields + column resolution

**Files:**
- Modify: `src/engine/marks/index.ts` (PreparedRow)
- Modify: `src/spec/columns.ts`
- Test: `test/histogram-columns.test.ts` (create)

**Interfaces:**
- Consumes: `ResolvedColumns` from `src/spec/columns.ts`.
- Produces: `ResolvedColumns` gains `x0: string | null; x1: string | null`; helper `export function isPreBinned(cols: ResolvedColumns): boolean`. `PreparedRow` gains `_x0?: number; _x1?: number`.

- [ ] **Step 1: Write the failing test**

Create `test/histogram-columns.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolveColumns, isPreBinned } from "../src/spec/columns";
import type { ChartSpec } from "../src/spec/types";

const spec = (columns: any) => ({ chartType: "histogram", title: "H", xAxisType: "numeric", data: "d", columns } as unknown as ChartSpec);

describe("histogram column resolution", () => {
  it("resolves x0/x1 roles", () => {
    const c = resolveColumns(spec({ x0: "lo", x1: "hi", value: "n" }));
    expect(c.x0).toBe("lo"); expect(c.x1).toBe("hi");
  });
  it("isPreBinned true only when both edges are present", () => {
    expect(isPreBinned(resolveColumns(spec({ x0: "lo", x1: "hi" })))).toBe(true);
    expect(isPreBinned(resolveColumns(spec({ x: "amount" })))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run test/histogram-columns.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/spec/columns.ts`:
- Add to `ResolvedColumns`: `x0: string | null;` and `x1: string | null;`.
- In `resolveColumns`, compute and return them:
  ```ts
  const x0 = c.x0 != null && c.x0 !== "" ? c.x0 : null;
  const x1 = c.x1 != null && c.x1 !== "" ? c.x1 : null;
  ```
  add `x0, x1` to the returned object.
- Append:
  ```ts
  export function isPreBinned(cols: ResolvedColumns): boolean {
    return cols.x0 != null && cols.x1 != null;
  }
  ```

In `src/engine/marks/index.ts`, add to `PreparedRow` (after `_xc?`):
```ts
/** Histogram bin edges (numeric, or epoch-ms for temporal). Present on binned/pre-binned rows. */
_x0?: number;
_x1?: number;
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/histogram-columns.test.ts` → PASS. Then `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/spec/columns.ts src/engine/marks/index.ts test/histogram-columns.test.ts
git commit -m "feat(histogram): x0/x1 column roles + PreparedRow bin-edge fields"
```

---

## Task 5: Histogram mark builder

**Files:**
- Create: `src/engine/marks/histogram.ts`
- Modify: `src/engine/marks/index.ts` (register builder)
- Test: `test/engine/histogram-render.test.ts` (create)

**Interfaces:**
- Consumes: `PreparedRow` (with `_x0/_x1/_y`), `MarkContext`, `MarkLayers` from `src/engine/marks/index.ts`; `resolveColor` from `../palette`; `Plot` from `../vendor`.
- Produces: `export function buildHistogramMarks(data: PreparedRow[], spec: ChartSpec, ctx: MarkContext): MarkLayers`.

- [ ] **Step 1: Write the failing test**

Create `test/engine/histogram-render.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { Plot } from "../../src/engine/vendor";
import { buildHistogramMarks } from "../../src/engine/marks/histogram";
import type { PreparedRow, MarkContext } from "../../src/engine/marks/index";
import type { ChartSpec } from "../../src/spec/types";

const spec = { chartType: "histogram", title: "H", xAxisType: "numeric", data: "d" } as unknown as ChartSpec;
const ctx: MarkContext = { xField: "_x0", colors: new Map([["A", "#123456"], ["B", "#abcdef"]]), seriesNames: ["A", "B"] } as any;
const rows: PreparedRow[] = [
  { series: "A", time: "", _y: 2, _x0: 0, _x1: 5 }, { series: "A", time: "", _y: 0, _x0: 5, _x1: 10 },
  { series: "B", time: "", _y: 1, _x0: 0, _x1: 5 }, { series: "B", time: "", _y: 3, _x0: 5, _x1: 10 },
];

describe("buildHistogramMarks", () => {
  it("emits rect marks that render to a plot with <rect> bars", () => {
    const layers = buildHistogramMarks(rows, spec, ctx);
    const plot = Plot.plot({ marks: layers.overlay as any });
    expect(plot.querySelectorAll("rect").length).toBeGreaterThan(0);
    plot.remove();
  });
  it("overlapping multi-series bars are translucent (fill-opacity < 1)", () => {
    const layers = buildHistogramMarks(rows, spec, ctx);
    const plot = Plot.plot({ marks: layers.overlay as any });
    const op = Array.from(plot.querySelectorAll("rect")).map((r) => Number(r.getAttribute("fill-opacity") ?? "1"));
    expect(op.some((o) => o < 1)).toBe(true);
    plot.remove();
  });
  it("tags rects with data-series for legend dim/pin", () => {
    const layers = buildHistogramMarks(rows, spec, ctx);
    expect(layers.tagging.some((t) => t.selector.includes("rect"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run test/engine/histogram-render.test.ts` → Expected: FAIL (module missing).

- [ ] **Step 3: Implement the mark builder**

Create `src/engine/marks/histogram.ts`:
```ts
// Histogram mark: continuous-x bars drawn from _x0 to _x1 (edge-to-edge, no band padding). Multiple
// series overlay with partial fill-opacity, z-ordered by series order. Mirrors the bar mark's
// data-series rect tagging so legend hover/pin dims the right bars.
import { Plot } from "../vendor";
import { TBL } from "../theme";
import { resolveColor } from "../palette";
import type { ChartSpec } from "../../spec/types";
import type { MarkContext, MarkLayers, PreparedRow } from "./index";

const OVERLAP_OPACITY = 0.5;

export function buildHistogramMarks(data: PreparedRow[], spec: ChartSpec, ctx: MarkContext): MarkLayers {
  const seriesNames = ctx.seriesNames ?? [""];
  const isMulti = seriesNames.length > 1;
  const { colors } = ctx;
  const barColor = resolveColor(spec.bar_color);
  const highlightSet = spec.highlightSeries && spec.highlightSeries.length ? new Set(spec.highlightSeries) : null;

  const fillFor = (s: string): string => {
    if (highlightSet && !highlightSet.has(s)) return TBL.color.annotationDim;
    return colors.get(s) || barColor || TBL.color.blue;
  };

  // One rect layer per series so z-order follows series order; overlap uses partial opacity.
  const overlay: unknown[] = [];
  for (const s of seriesNames) {
    const seriesData = data.filter((d) => d.series === s && d._y != null && d._x0 != null && d._x1 != null);
    overlay.push(
      Plot.rectY(seriesData, {
        x1: "_x0", x2: "_x1", y: "_y",
        fill: fillFor(s),
        fillOpacity: isMulti ? OVERLAP_OPACITY : 1,
        stroke: isMulti ? fillFor(s) : "none",
        strokeOpacity: 1,
      }),
    );
  }

  // Rect tag order: Plot emits one <rect> per datum in series-layer order, data-row order within.
  const seriesOrder: string[] = [];
  for (const s of seriesNames) for (const d of data) if (d.series === s && d._y != null) seriesOrder.push(s);

  return {
    underlay: [],
    overlay,
    tagging: [{ selector: 'g[aria-label="rect"] rect', seriesOrder }],
    dashedNames: new Set<string>(),
  };
}
```

In `src/engine/marks/index.ts`: import and register:
```ts
import { buildHistogramMarks } from "./histogram";
// ...in REGISTRY:
histogram: buildHistogramMarks,
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/engine/histogram-render.test.ts` → PASS. Then `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/engine/marks/histogram.ts src/engine/marks/index.ts test/engine/histogram-render.test.ts
git commit -m "feat(histogram): rect mark builder with overlap opacity + tagging"
```

---

## Task 6: Continuous-x adapter path for histogram

**Files:**
- Modify: `src/engine/x-adapter.ts`
- Test: `test/histogram-adapter.test.ts` (create)

**Interfaces:**
- Consumes: `makeXAdapter(xType, xAxisPolicy)` → `XAdapter` (see `x-adapter.ts`).
- Produces: an `XAdapter` variant that, for histogram, yields a continuous (linear/time) x scale whose domain spans a supplied `[minEdge, maxEdge]`. Add an optional overload/param: `makeXAdapter(xType, xAxisPolicy, histogramDomain?: [number, number])`.

- [ ] **Step 1: Write the failing test**

Create `test/histogram-adapter.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { makeXAdapter } from "../src/engine/x-adapter";

describe("histogram x adapter", () => {
  it("numeric histogram uses a continuous (non-band) x scale spanning the bin edges", () => {
    const a = makeXAdapter("numeric", undefined, [0, 40]);
    const opts = a.xScaleOpts();
    expect(opts.type).not.toBe("band");
    expect(opts.domain?.[0]).toBe(0);
    expect(opts.domain?.[1]).toBe(40);
  });
});
```
(If `xScaleOpts` is not the exact accessor on `XAdapter`, adapt the assertion to the real member surfaced by the interface at `x-adapter.ts:27` — read it before writing.)

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run test/histogram-adapter.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/engine/x-adapter.ts`:
- Add a third optional parameter `histogramDomain?: [number, number]` to `makeXAdapter`.
- When `histogramDomain` is set, in the `numeric` branch use `{ type: "linear", domain: histogramDomain, ... }` (keep the existing nice-tick logic), and in the `temporal` branch use `{ type: "utc", domain: [new Date(histogramDomain[0]), new Date(histogramDomain[1])] }` reusing the temporal tick formatting. Do NOT route histogram through the categorical/band branch.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/histogram-adapter.test.ts` → PASS. Then `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/engine/x-adapter.ts test/histogram-adapter.test.ts
git commit -m "feat(histogram): continuous x-adapter path (linear/time domain from bin edges)"
```

---

## Task 7: Pipeline wiring — bin in renderPane, share thresholds across facets

**Files:**
- Modify: `src/engine/index.ts` (`renderPane`, `RenderOptions`, y-extent)
- Modify: `src/engine/figure.ts` (compute + pass shared thresholds)
- Test: `test/histogram-pipeline.test.ts` (create)

**Interfaces:**
- Consumes: `binValues`, `computeThresholds`, `temporalThresholds` (Tasks 2–3); `isPreBinned` (Task 4); `makeXAdapter(…, histogramDomain)` (Task 6); `buildHistogramMarks` (Task 5).
- Produces: `RenderOptions` gains `binThresholds?: number[]`. `renderPane` produces binned `PreparedRow[]` (with `_x0/_x1/_y`) for histograms and drives the histogram adapter/mark.

- [ ] **Step 1: Write the failing test**

Create `test/histogram-pipeline.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const raw: TidyRow[] = Array.from({ length: 20 }, (_, i) => ({ amount: String(i), series: i < 10 ? "A" : "B" })) as any;
const spec = {
  chartType: "histogram", title: "H", xAxisType: "numeric",
  columns: { x: "amount", series: "series" }, histogram: { bins: 4, domain: [0, 20] }, data: "d",
} as unknown as ChartSpec;

describe("histogram pipeline", () => {
  it("renders binned bars from raw rows", () => {
    const { svg } = renderChart(spec, raw, { width: 600, height: 360 }) as any;
    expect(svg.querySelectorAll("rect").length).toBeGreaterThan(0);
  });
  it("accepts pre-binned rows (x0/x1/value) without binning", () => {
    const preRows: TidyRow[] = [
      { lo: "0", hi: "5", n: "3" }, { lo: "5", hi: "10", n: "7" },
    ] as any;
    const preSpec = {
      chartType: "histogram", title: "H", xAxisType: "numeric",
      columns: { x0: "lo", x1: "hi", value: "n" }, data: "d",
    } as unknown as ChartSpec;
    const { svg } = renderChart(preSpec, preRows, { width: 600, height: 360 }) as any;
    expect(svg.querySelectorAll("rect").length).toBe(2);
  });
});
```
(If `renderChart` returns a different shape than `{ svg }`, read `renderChart` at `src/engine/index.ts:688` first and adapt the destructuring + the `rect` query to the returned DOM.)

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run test/histogram-pipeline.test.ts` → Expected: FAIL.

- [ ] **Step 3: Implement the histogram branch in `renderPane`**

In `src/engine/index.ts`:
- Add `binThresholds?: number[]` to `RenderOptions`.
- After the existing parse step builds `data: PreparedRow[]` and `dataInScope` is computed, insert a histogram transform BEFORE mark building:
  ```ts
  if (chartType === "histogram") {
    const pre = isPreBinned(cols);
    let binned: PreparedRow[];
    if (pre) {
      binned = rows.map((r) => ({
        series: cols.series ? String(r[cols.series] ?? "") : "",
        time: "", _y: r[cols.value] === "" || r[cols.value] == null ? 0 : +r[cols.value]!,
        _x0: +r[cols.x0!]!, _x1: +r[cols.x1!]!,
        ...(cols.facet ? { _facet: String(r[cols.facet] ?? "") } : {}),
      }));
      // pre-binned still honors normalize (compute per series over provided values):
      binned = applyNormalize(binned, spec.histogram?.normalize);
    } else {
      const isTemporal = xType === "temporal";
      const inputs = dataInScope
        .map((d) => ({ series: d.series, x: isTemporal ? (d._xd ? d._xd.getTime() : NaN) : (d._xn ?? NaN),
          weight: spec.histogram?.weight ? Number(/* read weight col from original row */ 0) : undefined,
          _facet: d._facet }))
        .filter((r) => Number.isFinite(r.x));
      const values = inputs.map((r) => r.x);
      const thresholds = opts.binThresholds ?? (isTemporal
        ? temporalThresholds(values, spec.histogram?.binWidth, spec.histogram?.bins, spec.histogram?.domain)
        : computeThresholds(values, { bins: spec.histogram?.bins, binWidth: typeof spec.histogram?.binWidth === "number" ? spec.histogram!.binWidth : undefined, domain: spec.histogram?.domain }));
      binned = binValues(inputs, { thresholds, normalize: spec.histogram?.normalize }) as PreparedRow[];
    }
    return renderHistogramPane(spec, binned, opts, /* adapter */ makeXAdapter(xType, spec.xAxisPolicy, histogramDomainOf(binned)), classNameSuffix, facetInfo);
  }
  ```
  Notes for the implementer:
  - `histogramDomainOf(binned)` = `[min(_x0), max(_x1)]`.
  - `applyNormalize(rows, mode)` — a small local helper mirroring the binning module's normalization but over pre-binned `_y` grouped by series (proportion: divide by series sum; density: divide by series sum × width). Extract it into `histogram-bin.ts` as `export function normalizeBinned(rows: BinnedRow[], mode): BinnedRow[]` and reuse it in Task 2's `binValues` to keep one implementation (DRY) — do this refactor here and re-run Task 2 tests.
  - For `weight`, read the original row's weight column. Simplest: carry the weight during the parse step by stashing it on `PreparedRow` as a transient, OR bin from `rows` directly (map raw rows → `BinInput` using `cols.x`/`cols.weight` and the same numeric/temporal parse the adapter uses). Prefer binning from `rows` directly so the weight column is in hand; reuse the adapter's parse for x.
  - `renderHistogramPane` = the existing pane-assembly tail (compute y-extent from `binned._y`, call `assemblePlot` with the histogram adapter + `buildHistogramMarks`, default `includeZero: true`). Factor the shared tail rather than duplicating `renderPane`'s body.
- Add histogram to the y-extent computation (`_y` over binned rows; include 0).

In `src/engine/figure.ts`:
- When `chartType === "histogram"` and `small_multiples.mode !== "per-pane"` (shared, the default): before splitting panes, compute the shared thresholds once from ALL rows' parsed x, and pass them to every `renderPane` via `opts.binThresholds`. For `per-pane`, pass nothing (each pane bins itself).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/histogram-pipeline.test.ts` → PASS.
Run: `npm test` → Expected: all pass, and NO existing golden SVG fixture changed (histogram is a new code path).

- [ ] **Step 5: Commit**

```bash
git add src/engine/index.ts src/engine/figure.ts src/engine/histogram-bin.ts test/histogram-pipeline.test.ts
git commit -m "feat(histogram): wire binning into renderPane + shared facet thresholds"
```

---

## Task 8: Golden fixtures + export parity

**Files:**
- Test: `test/engine/histogram-golden.test.ts` (create); fixtures under `test/fixtures/histogram-*.svg`.

**Interfaces:**
- Consumes: `renderChart` / the figure renderer; the golden-SVG comparison harness used by `test/table/render-svg.test.ts` / `test/snapshot-compare.test.ts` (read one for the exact `--update` idiom and comparison helper).

- [ ] **Step 1: Write golden tests (single-series, overlapping, faceted shared, temporal, pre-binned)**

Create `test/engine/histogram-golden.test.ts` mirroring the existing golden-SVG test structure (build spec + rows, render to SVG, `expect(svg).toMatchGolden("histogram-<case>.svg")` or the repo's actual golden helper). Cover: `histogram-single`, `histogram-overlap`, `histogram-faceted-shared`, `histogram-temporal-month`, `histogram-prebinned`.

- [ ] **Step 2: Generate the baselines**

Run the repo's golden-update command (as `test/table` / `snapshot` tests use — e.g. `SNAPSHOT_UPDATE=1 npx vitest run test/engine/histogram-golden.test.ts` or the project's documented update flag; confirm from an existing golden test before running). Inspect each emitted `test/fixtures/histogram-*.svg` by eye for: touching bars, translucent overlap, correct facet panes, month-boundary ticks, pre-binned edges.

- [ ] **Step 3: Re-run to verify pass against committed baselines**

Run: `npx vitest run test/engine/histogram-golden.test.ts` → PASS.
Run: `npm test` → all pass; confirm no NON-histogram fixture changed (`git status test/fixtures` shows only new `histogram-*.svg`).

- [ ] **Step 4: Commit**

```bash
git add test/engine/histogram-golden.test.ts test/fixtures/histogram-*.svg
git commit -m "test(histogram): golden SVG fixtures (single/overlap/faceted/temporal/pre-binned)"
```

---

## Task 9: Docs + version bump

**Files:**
- Modify: `CONFIG-SPEC.md`, `CHANGELOG.md`, `package.json`

- [ ] **Step 1: Document in `CONFIG-SPEC.md`**

Add a "Histogram" subsection under the chart-type docs: the `chartType: histogram` surface, `histogram` block (`bins`/`binWidth`/`domain`/`normalize`/`weight`), pre-binned via `columns.x0`/`x1` + `value`, temporal interval names, overlapping multi-series, and faceting (`shared`/`per-pane`). Note x must be `numeric` or `temporal`.

- [ ] **Step 2: `CHANGELOG.md` + version bump**

Add an `## [X.Y.0]` entry (minor — additive chart type) summarizing the histogram feature. Bump `package.json` `version` accordingly (next minor above the current published version).

- [ ] **Step 3: Full verification**

Run: `npm run typecheck` → clean.
Run: `npm test` → all pass.
Run: `npm run build` → succeeds (bundle rebuilds).

- [ ] **Step 4: Commit**

```bash
git add CONFIG-SPEC.md CHANGELOG.md package.json
git commit -m "docs(histogram): CONFIG-SPEC + CHANGELOG; minor version bump"
```

---

## Post-implementation (required by the requester)

After all tasks pass, build a **live dev-server pressure test** (see memory `live-pressure-test-after-builds`): a gallery of `chart.yaml` histogram specs exercising hard cases — auto vs fixed bins, overlapping 3+ series of different sizes, `proportion`/`density` normalization, temporal month/quarter binning, pre-binned with uneven edges, faceted shared vs per-pane, single-bin/degenerate data — served via `node dist/cli/index.js serve <dir> --port <n>`, driven with Playwright at narrow/wide viewports with screenshots, plus PNG export-parity checks. Leave the server running and hand over the URL + per-case routes.

## Self-Review

- **Spec coverage:** binning width/count/auto (Task 2), temporal (Task 3), pre-binned (Tasks 4/7), faceting shared+per-pane (Task 7), overlapping series (Task 5), normalization (Task 2, reused for pre-binned in Task 7 via `normalizeBinned`), continuous axis (Task 6), validation + schema + types (Task 1), docs/version (Task 9), tests + goldens (all tasks + Task 8). All spec sections mapped.
- **Type consistency:** `BinnedRow`/`BinInput`/`BinSpec` and `computeThresholds`/`binValues`/`temporalThresholds`/`calendarEdges`/`normalizeBinned` are used consistently across Tasks 2–7; `ResolvedColumns.x0/x1` + `isPreBinned` (Task 4) consumed in Task 7; `PreparedRow._x0/_x1` (Task 4) produced in Task 7 and consumed in Task 5; `makeXAdapter`'s new `histogramDomain` param (Task 6) consumed in Task 7.
- **Known verify-before-code points (flagged inline):** exact `XAdapter` member name (Task 6), `renderChart` return shape (Task 7), and the golden-update idiom (Task 8) must be read from the existing code before writing those steps — each is called out in its task.
