// Y-axis domain/tick computation + tick formatting. Pure; no DOM.
import { d3 } from "./vendor";
import type { ChartSpec, ChartType } from "../spec/types";
import type { PreparedRow } from "./marks/index";

export interface YAxisResult {
  domain: [number, number];
  ticks: number[];
}

export interface ComputeYAxisOptions {
  includeZero?: boolean;
  tickCount?: number;
  /** Hard override: ignore yValues and lock to this exact domain (ticks computed
   * against it). Used to pin a chart family to a fixed range. */
  domain?: [number, number] | null;
}

/** Compute a "nice" y-domain + tick array up front so gridlines and labels can be
 * rendered as explicit marks with full positioning control. */
export function computeYAxis(
  yValues: Array<number | null | undefined>,
  { includeZero = false, tickCount = 5, domain = null }: ComputeYAxisOptions = {},
): YAxisResult {
  if (domain) {
    const scale = d3.scaleLinear().domain(domain).nice(tickCount);
    return { domain: scale.domain(), ticks: scale.ticks(tickCount) };
  }
  const nums = yValues.map((v) => +(v as number)).filter(Number.isFinite);
  if (!nums.length) return { domain: [0, 1], ticks: [0, 1] };
  let [lo, hi] = d3.extent(nums) as [number, number];
  if (includeZero) {
    lo = Math.min(0, lo);
    hi = Math.max(0, hi);
  }
  const scale = d3.scaleLinear().domain([lo, hi]).nice(tickCount);
  return { domain: scale.domain(), ticks: scale.ticks(tickCount) };
}

/** Headroom factor: extra vertical clearance above the tallest bar so value labels clear.
 *  1.08 when a stacked chart draws a net total as text above the bars (stacked, no negatives,
 *  netDisplay resolves to "text"). 1.05 otherwise. */
const HEADROOM_DEFAULT = 1.05;
const HEADROOM_NET_TEXT = 1.08;

/** Guard a bar/stacked value extent against the degenerate all-zero case: when every in-scope
 *  value is 0 the raw extent collapses to [0, 0], which makes the value scale singular and paints
 *  full-height bars (bars are sized from real _y=0, but a [0,0] domain has no baseline to sit on).
 *  Floor the axis RANGE to [0, 1] so the scale is finite and a flat 0 line renders; bars stay
 *  zero-height because Plot draws them from their real _y (0), independent of this floor. */
function floorDegenerateExtent(ext: { min: number; max: number }): { min: number; max: number } {
  return ext.min === 0 && ext.max === 0 ? { min: 0, max: 1 } : ext;
}

/**
 * Compute the y-domain extent for bar/stacked charts.
 *
 * Returns `{ min, max }` ready to pass as `domain` to `computeYAxis`. Guarantees zero is
 * within range (mandatory baseline). Applies value-label headroom to the positive side only.
 *
 * @param data   Prepared rows (the engine's in-memory shape after parseX).
 * @param spec   Full chart spec (reads `barStack` options).
 * @param chartType  "bar" or "stacked".
 */
export function computeBarYExtent(
  data: PreparedRow[],
  spec: ChartSpec,
  chartType: ChartType,
): { min: number; max: number } {
  // Guard: empty data → safe default.
  const nums = data.map((r) => r._y).filter((v): v is number => Number.isFinite(v as number));
  if (!nums.length) return { min: 0, max: 1 };

  if (chartType === "bar") {
    // Grouped bar: bars rise/fall from zero; extent over raw _y values.
    const dataMax = Math.max(0, ...nums);
    const dataMin = Math.min(0, ...nums);
    return floorDegenerateExtent({ min: dataMin, max: dataMax * HEADROOM_DEFAULT });
  }

  // chartType === "stacked"

  // 100%-normalized: all bars fill 0–100 %, no dynamic extent needed.
  if (spec.barStack?.normalize === true) {
    return { min: 0, max: 100 };
  }

  // Stacked: compute, per category (_xc), the positive sum and negative sum of _y
  // across all series in that category.
  const posSumByCategory = new Map<string, number>();
  const negSumByCategory = new Map<string, number>();

  for (const row of data) {
    const cat = row._xc ?? "";
    const y = row._y;
    if (!Number.isFinite(y as number) || y == null) continue;
    if (y >= 0) {
      posSumByCategory.set(cat, (posSumByCategory.get(cat) ?? 0) + y);
    } else {
      negSumByCategory.set(cat, (negSumByCategory.get(cat) ?? 0) + y);
    }
  }

  const posMax = posSumByCategory.size
    ? Math.max(0, ...posSumByCategory.values())
    : 0;
  const negMin = negSumByCategory.size
    ? Math.min(0, ...negSumByCategory.values())
    : 0;

  const hasNegatives = negMin < 0;

  // Determine headroom: 1.08 when a net total is displayed as text above the stack
  // (stacked, no negatives, netDisplay resolves to "text" — either explicit "text" or
  // "auto" which defaults to "text" when all values are non-negative).
  const netDisplay = spec.barStack?.netDisplay ?? "auto";
  const netIsText =
    !hasNegatives &&
    (netDisplay === "text" || netDisplay === "auto");
  const headroom = netIsText ? HEADROOM_NET_TEXT : HEADROOM_DEFAULT;

  return floorDegenerateExtent({
    min: Math.min(0, negMin),
    max: posMax * headroom,
  });
}

/** Fraction of the data span added as breathing room on each side of a dumbbell's value axis, so
 *  the extreme dots don't sit flush against the frame. */
const DUMBBELL_PAD_FRACTION = 0.05;

/**
 * Value-axis extent for a dumbbell (connected dot plot). Unlike bars, dots are POSITIONS not
 * magnitudes-from-zero, so the axis fits the data extent and does NOT force zero in — a 2%..35%
 * rate view keeps its useful range. Zero is included only when the data genuinely crosses it
 * (some dots negative, some positive), which the padded [min, max] span already covers; the mark
 * draws a zero rule in that case. Padded on both sides for breathing room; a zero-span set
 * (all dots equal, including all-zero) still returns a finite, non-degenerate range.
 */
export function computeDumbbellValueExtent(
  values: Array<number | null | undefined>,
): { min: number; max: number } {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return { min: 0, max: 1 };
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const span = hi - lo;
  // Zero-span (all dots equal): pad off the value's magnitude so the axis is finite, or ±1 at 0.
  const pad = span > 0 ? span * DUMBBELL_PAD_FRACTION : Math.abs(hi) * DUMBBELL_PAD_FRACTION || 1;
  return { min: lo - pad, max: hi + pad };
}

export type WaterfallKind = "delta" | "total" | "skip";

/** One resolved waterfall step, in DATA (= category declaration) order. `base`/`top` are the
 *  bar's value-axis extent (bottom/top); `level` is the running cumulative AFTER this step (the
 *  value the running-total label and the outgoing connector sit at); `before` is the running
 *  value entering the step. Skip steps carry no bar (`base === top === before`). */
export interface WaterfallStep {
  row: PreparedRow;
  cat: string;
  kind: WaterfallKind;
  /** The step's own value: the signed delta (delta), the absolute level (total), 0 (skip). */
  delta: number;
  base: number;
  top: number;
  level: number;
  before: number;
  /** True when the bar grows in the positive direction (delta ≥ 0, or a non-negative total) —
   *  drives label placement (above) vs a falling bar (below). */
  rise: boolean;
}

/** Reads the `_kind` field set from `columns.kind` (delta/total/skip; empty ⇒ delta). */
function kindOf(row: PreparedRow): WaterfallKind {
  const k = ((row._kind as string | undefined) ?? "").trim();
  return k === "total" || k === "skip" ? k : "delta";
}

/**
 * Walk a waterfall's rows in order, accumulating the running cumulative into per-step geometry.
 * PURE. Shared by the value-axis extent (`computeWaterfallYExtent`) and the mark builder so the
 * axis and the bars agree exactly.
 *
 * - delta: bar spans `running → running + value`; `running += value`.
 * - total: an explicit value rebases (`running := value`, bar `0 → value`); a blank value draws
 *   the auto running total (bar `0 → running`) and leaves `running` unchanged.
 * - skip: no bar; `running` unchanged (a downstream connector bridges the slot).
 */
export function computeWaterfallSteps(data: PreparedRow[]): WaterfallStep[] {
  let running = 0;
  const steps: WaterfallStep[] = [];
  for (const row of data) {
    const cat = (row._xc ?? row.time ?? "") as string;
    const kind = kindOf(row);
    if (kind === "skip") {
      steps.push({ row, cat, kind, delta: 0, base: running, top: running, level: running, before: running, rise: true });
      continue;
    }
    const before = running;
    if (kind === "total") {
      const v = row._y;
      const level = v == null || !Number.isFinite(v) ? running : (v as number);
      running = level;
      steps.push({ row, cat, kind, delta: level, base: Math.min(0, level), top: Math.max(0, level), level, before, rise: level >= 0 });
      continue;
    }
    const v = Number.isFinite(row._y as number) ? (row._y as number) : 0;
    const after = before + v;
    running = after;
    steps.push({ row, cat, kind, delta: v, base: Math.min(before, after), top: Math.max(before, after), level: after, before, rise: v >= 0 });
  }
  return steps;
}

/** Value-axis extent for a waterfall: spans the whole cumulative PATH (every bar's base/top,
 *  including total bars) plus zero, with label headroom on whichever side(s) carry data. */
export function computeWaterfallYExtent(data: PreparedRow[]): { min: number; max: number } {
  const vals: number[] = [0];
  for (const s of computeWaterfallSteps(data)) {
    if (s.kind === "skip") continue;
    vals.push(s.base, s.top);
  }
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  return {
    min: lo < 0 ? lo * HEADROOM_NET_TEXT : lo,
    max: hi > 0 ? hi * HEADROOM_NET_TEXT : hi,
  };
}

/**
 * Value-axis extent of the geometry a chart type actually PAINTS — no label headroom, no breathing
 * pad. The `compute*Extent` helpers above answer "how big should the axis be?", so they add padding;
 * this answers "what will overflow the frame if the axis is narrower than the data?", which must be
 * padding-free or the clip gate (see assemblePaneResult) would fire on charts whose data fits and only their
 * headroom doesn't — churning the DOM (Plot's `clip` wraps the mark in an extra <g>) for no visual gain.
 *
 * Every chart type is covered. A new one needs a case here plus `...clipOpt` on its marks, or it
 * silently stops clipping — returning null is how a type opts out, not a default.
 */
/** Cumulative stack tops/bottoms per x — positives stack up from zero, negatives down — with zero
 *  always included because the stack is drawn from it. Shared by stacked bars and areas, which
 *  differ only in how an x is keyed. */
function stackedExtent(
  data: PreparedRow[],
  keyOf: (r: PreparedRow) => string,
): { min: number; max: number } | null {
  const posSum = new Map<string, number>();
  const negSum = new Map<string, number>();
  for (const r of data) {
    if (!Number.isFinite(r._y as number)) continue;
    const key = keyOf(r);
    const y = r._y as number;
    const into = y >= 0 ? posSum : negSum;
    into.set(key, (into.get(key) ?? 0) + y);
  }
  if (!posSum.size && !negSum.size) return null;
  return {
    min: negSum.size ? Math.min(0, ...negSum.values()) : 0,
    max: posSum.size ? Math.max(0, ...posSum.values()) : 0,
  };
}

export function computeDrawnValueExtent(
  data: PreparedRow[],
  spec: ChartSpec,
  chartType: ChartType,
): { min: number; max: number } | null {
  const finite = (v: unknown): v is number => Number.isFinite(v as number);

  if (chartType === "line" || chartType === "scatter" || chartType === "dotplot") {
    // Positions, not magnitudes: no zero baseline, no padding. CI band bounds count as painted
    // geometry on a line; the point types have no bands, so those fields are simply absent.
    const vals: number[] = [];
    for (const r of data) {
      if (finite(r._y)) vals.push(r._y as number);
      if (finite(r._lo)) vals.push(r._lo as number);
      if (finite(r._hi)) vals.push(r._hi as number);
    }
    if (!vals.length) return null;
    return { min: Math.min(...vals), max: Math.max(...vals) };
  }

  if (chartType === "histogram") {
    // Bin heights, drawn from zero. `_y` is already the (possibly normalized) height.
    const vals = data.map((r) => r._y).filter(finite);
    if (!vals.length) return null;
    return { min: Math.min(0, ...vals), max: Math.max(0, ...vals) };
  }

  if (chartType === "bar") {
    // Every bar spans 0 → value, so zero is always painted.
    const vals = data.map((r) => r._y).filter(finite);
    if (!vals.length) return null;
    return { min: Math.min(0, ...vals), max: Math.max(0, ...vals) };
  }

  if (chartType === "stacked") {
    if (spec.barStack?.normalize === true) return { min: 0, max: 100 };
    // Stacked bars key on the category band. Mirrors computeBarYExtent's stacking, minus headroom.
    return stackedExtent(data, (r) => r._xc ?? "");
  }

  if (chartType === "area") {
    // Same cumulative-top geometry as a stacked bar, but an area's x may be numeric or temporal, so
    // key the stack the way renderPane's own area branch does.
    return stackedExtent(data, (r) => r.time || String(r._xn ?? r._xc ?? ""));
  }

  if (chartType === "dumbbell") {
    // Dots are POSITIONS, not magnitudes from zero, so zero is not part of the painted geometry
    // (see computeDumbbellValueExtent) — and no padding here, unlike that one.
    const vals = data.map((r) => r._y).filter(finite);
    if (!vals.length) return null;
    return { min: Math.min(...vals), max: Math.max(...vals) };
  }

  if (chartType === "waterfall") {
    // The painted geometry is every bar's base/top along the cumulative path, plus the zero baseline.
    const vals: number[] = [0];
    for (const s of computeWaterfallSteps(data)) {
      if (s.kind === "skip") continue;
      vals.push(s.base, s.top);
    }
    return { min: Math.min(...vals), max: Math.max(...vals) };
  }

  return null;
}

/** Decimal places for a waterfall's value text: an explicit `valueLabels.decimals` wins; else the
 *  minimum precision the data needs (capped at 2), computed across BOTH the step deltas AND the
 *  running totals so the hover delta and the always-on running-total label always agree. */
export function waterfallValueDecimals(data: PreparedRow[], explicit?: number): number {
  if (explicit != null) return explicit;
  const vals: number[] = [];
  for (const s of computeWaterfallSteps(data)) {
    if (s.kind === "skip") continue;
    vals.push(s.delta, s.level);
  }
  return Math.min(
    2,
    vals.reduce((max, v) => {
      if (!Number.isFinite(v)) return max;
      const str = String(v);
      const i = str.indexOf(".");
      return Math.max(max, i < 0 ? 0 : str.length - i - 1);
    }, 0),
  );
}

/** A tick formatter that uses the minimum decimal precision needed across the whole
 * tick array — no ".0" when every tick is an integer; one decimal when ticks step by
 * 0.5; etc. Optionally appends a units suffix (e.g. "%"). */
export function makeTickFormatter(ticks: number[], units = ""): (d: number) => string {
  const maxFrac = ticks.reduce((max, t) => {
    if (!Number.isFinite(t)) return max;
    const s = String(t);
    const i = s.indexOf(".");
    return Math.max(max, i < 0 ? 0 : s.length - i - 1);
  }, 0);
  return (d: number) => {
    if (!Number.isFinite(d)) return "";
    const s = d.toFixed(maxFrac);
    return units ? `${s}${units}` : s;
  };
}
