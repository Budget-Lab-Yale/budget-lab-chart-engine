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

/** Normalize pre-computed bin heights (`_y`) per series. "proportion": each series' bins sum to 1;
 *  "density": each series' area (Σ _y·width) sums to 1. "none"/undefined → returned unchanged.
 *  Shared by `binValues` (raw counts) and the pipeline's pre-binned path so both normalize
 *  identically. */
export function normalizeBinned(rows: BinnedRow[], mode: BinSpec["normalize"]): BinnedRow[] {
  if (!mode || mode === "none") return rows;
  const totalBySeries = new Map<string, number>();
  for (const r of rows) totalBySeries.set(r.series, (totalBySeries.get(r.series) ?? 0) + r._y);
  return rows.map((r) => {
    const total = totalBySeries.get(r.series) || 1;
    let y = r._y;
    if (mode === "proportion") y = y / total;
    else if (mode === "density") y = y / (total * (r._x1 - r._x0));
    return { ...r, _y: y };
  });
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
    if (!Number.isFinite(r.x)) continue; // non-finite x: excluded from counts and totals
    const i = binIndex(r.x, t);
    if (i < 0) continue;
    acc.get(r.series)![i]! += r.weight ?? 1;
    if (!facetOf.has(r.series)) facetOf.set(r.series, r._facet);
  }
  const out: BinnedRow[] = [];
  for (const s of seriesOrder) {
    const counts = acc.get(s)!;
    for (let i = 0; i < nBins; i++) {
      const row: BinnedRow = { series: s, _x0: t[i]!, _x1: t[i + 1]!, _y: counts[i]! };
      const f = facetOf.get(s); if (f !== undefined) row._facet = f;
      out.push(row);
    }
  }
  // Normalize per series (over raw counts) — one implementation, shared with the pre-binned path.
  return normalizeBinned(out, spec.normalize);
}
