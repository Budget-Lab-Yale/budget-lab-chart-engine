// Y-axis domain/tick computation + tick formatting. Pure; no DOM.
import { d3 } from "./vendor";

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
