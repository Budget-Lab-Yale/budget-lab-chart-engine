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
    return { min: dataMin, max: dataMax * HEADROOM_DEFAULT };
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

  return {
    min: Math.min(0, negMin),
    max: posMax * headroom,
  };
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
