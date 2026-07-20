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
    if (!Number.isFinite(r.x)) continue; // non-finite x: excluded from counts and totals
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
