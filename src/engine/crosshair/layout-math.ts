// PURE hover layout math, split out of crosshair.ts (re-exported there): band widening, the
// nearest-span resolver, row strips, and label de-collision. No DOM access.

/** A resolved band: the category key and its [xMin, xMax] in SVG user units. */
export interface CategoryBand {
  category: string;
  xMin: number;
  xMax: number;
}

/** A resolved horizontal band: the category key and its [yMin, yMax] in SVG user units.
 *  Used for horizontal bar charts where categories are on the Y axis. */
export interface CategoryBandH {
  category: string;
  yMin: number;
  yMax: number;
}

// ---------------------------------------------------------------------------
// PURE helpers (exported for unit tests)

/**
 * Widen a set of 1-D bands so each spans to the MIDPOINT between its neighbors'
 * centers — i.e. the full band STEP, not just the bar width. The hover highlight then
 * covers the surrounding padding gutters (half the gap on each side), so hovering the
 * space between bars still feels attached to the nearer bar.
 *
 * `bands` are the bar/cluster extents `[min, max]` (ascending by center). `lo`/`hi` are
 * the plot's axis edges, used only as a clamp so a band never spills past the plot.
 * Inner edges sit at the midpoint between adjacent centers; the OUTER edges of the first
 * and last bands extend a SYMMETRIC half-step (mirroring the nearest gap) rather than
 * stretching to the plot edge — so the end bars' highlight is balanced with the inner ones.
 * PURE — input bands are not mutated; new `[min, max]` pairs are returned in input order.
 */
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
    // Outer edges extend half the nearest gap past the bar center (symmetric with the
    // inner midpoints); a single band falls back to its own half-width. Clamp to [lo, hi]
    // so the highlight never exceeds the plot area.
    const left =
      prev != null ? (prev + c) / 2 : next != null ? c - (next - c) / 2 : (bands[i] as { min: number }).min;
    const right =
      next != null ? (c + next) / 2 : prev != null ? c + (c - prev) / 2 : (bands[i] as { max: number }).max;
    return { min: Math.max(lo, left), max: Math.min(hi, right) };
  });
}

/**
 * The one nearest-span resolver behind every band / bin hover: the index of the FIRST span that
 * contains `v` (both ends inclusive, so a shared edge goes to the earlier span), else the span whose
 * midpoint is nearest `v` (first wins a tie), else null for no spans. A NaN `v` contains nowhere and
 * is nearer nothing, so it resolves to index 0. `resolveCategoryFromBands`, `resolveCategoryFromBandsH`
 * and `resolveHistogramBinIndex` are this function over their own span shapes;
 * test/resolve-span-index.test.ts holds the three original bodies and asserts all agree.
 */
export function resolveSpanIndex(
  spans: ReadonlyArray<{ min: number; max: number }>,
  v: number,
): number | null {
  if (!spans.length) return null;
  for (let i = 0; i < spans.length; i++) {
    if (v >= spans[i]!.min && v <= spans[i]!.max) return i;
  }
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < spans.length; i++) {
    const mid = (spans[i]!.min + spans[i]!.max) / 2;
    const d = Math.abs(v - mid);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

/**
 * Given a list of CategoryBands and a cursor x in SVG user units, return the
 * category whose band contains x, or snap to the nearest band if x falls
 * between two bands. Returns null when bands is empty.
 */
export function resolveCategoryFromBands(
  bands: CategoryBand[],
  svgX: number,
): string | null {
  const i = resolveSpanIndex(bands.map((b) => ({ min: b.xMin, max: b.xMax })), svgX);
  return i == null ? null : bands[i]!.category;
}

/**
 * Given a list of CategoryBandH entries and a cursor y in SVG user units, return the
 * category whose y-band contains the cursor, or snap to the nearest band.
 * Used for horizontal bar charts where categories map to Y-axis rows.
 * Returns null when bands is empty.
 */
export function resolveCategoryFromBandsH(
  bands: CategoryBandH[],
  svgY: number,
): string | null {
  const i = resolveSpanIndex(bands.map((b) => ({ min: b.yMin, max: b.yMax })), svgY);
  return i == null ? null : bands[i]!.category;
}

/** A histogram bin: its edge values + per-series height. Derived from the binned rows. */
export interface HistogramBin {
  x0: number;
  x1: number;
  /** series key → bar height in this bin (only finite, non-null heights present). */
  bySeries: Map<string, number>;
}

/**
 * PURE — collapse binned rows into sorted unique bins (ascending by `_x0`). Every distinct
 * `_x0`/`_x1` pair is a bin; each in-scope series' finite `_y` is recorded under it. Rows missing
 * an edge are skipped. No DOM access.
 */
export function buildHistogramBins(
  rows: Array<{ _x0?: number; _x1?: number; _y: number | null; series: string }>,
): HistogramBin[] {
  const byKey = new Map<string, HistogramBin>();
  for (const r of rows) {
    if (r._x0 == null || r._x1 == null) continue;
    const key = `${r._x0}:${r._x1}`;
    let bin = byKey.get(key);
    if (!bin) {
      bin = { x0: r._x0, x1: r._x1, bySeries: new Map() };
      byKey.set(key, bin);
    }
    if (r._y != null && Number.isFinite(r._y)) bin.bySeries.set(r.series, r._y);
  }
  return [...byKey.values()].sort((a, b) => a.x0 - b.x0);
}

/**
 * PURE — given bin pixel spans `[min,max]` (ascending) and a cursor x in SVG user units, return
 * the index of the bin whose span contains x, or snap to the nearest bin center when x falls in a
 * gap / outside. Returns null only when there are no spans. See resolveSpanIndex.
 */
export function resolveHistogramBinIndex(
  spans: Array<{ min: number; max: number }>,
  svgX: number,
): number | null {
  return resolveSpanIndex(spans, svgX);
}

/** A horizontal category row's hover strip: ONE row pitch tall (the smallest step between adjacent
 *  rows) centred on the row, clamped to the plot's [top, bottom]. Every row gets the same strip, and
 *  a row beside a section gap does not reach into the gap or its header — which midpoint widening
 *  does, since the neighbour across the gap is far away. */
export function rowStrip(
  bands: ReadonlyArray<{ yMin: number; yMax: number }>,
  idx: number,
  top: number,
  bottom: number,
): { min: number; max: number; centre: number } {
  const centers = bands.map((b) => (b.yMin + b.yMax) / 2);
  let step = Infinity;
  for (let i = 1; i < centers.length; i++) step = Math.min(step, centers[i]! - centers[i - 1]!);
  if (!Number.isFinite(step)) step = bands[idx]!.yMax - bands[idx]!.yMin + 8;
  const c = centers[idx]!;
  return { min: Math.max(top, c - step / 2), max: Math.min(bottom, c + step / 2), centre: c };
}

/** A horizontal row strip's x-extent: within the plot, or from the SVG's left edge (under the label)
 *  to its right edge. */
export function rowStripX(W: number, ml: number, mr: number, opts: { regionFromLeftEdge?: boolean }): { x: number; w: number } {
  if (!opts.regionFromLeftEdge) return { x: ml, w: Math.max(0, W - ml - mr) };
  return { x: 0, w: W };
}

/**
 * PURE — de-collide a set of label y-centers so adjacent pills don't overlap. Labels are pushed
 * apart to at least `minGap`, preserving their order (sorted by y), then the run is clamped into
 * [lo, hi]. Input `ys` are the ideal positions (the data points); the returned array (same order
 * as input) is where the LABELS should sit — the dots still mark the true points.
 */
export function spreadLabelYs(ys: number[], minGap: number, lo: number, hi: number): number[] {
  const n = ys.length;
  if (n <= 1) return ys.slice();
  const order = ys.map((_, i) => i).sort((a, b) => ys[a]! - ys[b]!);
  const placed = order.map((i) => ys[i]!);
  for (let i = 1; i < n; i++) {
    if (placed[i]! < placed[i - 1]! + minGap) placed[i] = placed[i - 1]! + minGap;
  }
  // Clamp the run into [lo, hi]: shift up if it overflows the bottom, then down if it then
  // overflows the top (when the stack is taller than the range, the top wins / it overflows down).
  const overflow = placed[n - 1]! - hi;
  if (overflow > 0) for (let i = 0; i < n; i++) placed[i]! -= overflow;
  if (placed[0]! < lo) { const s = lo - placed[0]!; for (let i = 0; i < n; i++) placed[i]! += s; }
  const out = new Array<number>(n);
  order.forEach((origIdx, k) => { out[origIdx] = placed[k]!; });
  return out;
}

/**
 * PURE — de-collide pill CENTERS along X so adjacent pills (each `w` wide) don't overlap. Pills are
 * pushed apart to at least half-width-sums + a small gap, preserving input order (sorted by x), then
 * the run is clamped into [lo, hi]. Returns centers in the INPUT order.
 */
export function spreadPillCentersX(items: Array<{ x: number; w: number }>, lo: number, hi: number): number[] {
  const n = items.length;
  if (n === 0) return [];
  if (n === 1) return [Math.max(lo + items[0]!.w / 2, Math.min(items[0]!.x, hi - items[0]!.w / 2))];
  const GAP = 4;
  const order = items.map((_, i) => i).sort((a, b) => items[a]!.x - items[b]!.x);
  const placed = order.map((i) => items[i]!.x);
  for (let k = 1; k < n; k++) {
    const prev = order[k - 1]!, cur = order[k]!;
    const minC = placed[k - 1]! + items[prev]!.w / 2 + items[cur]!.w / 2 + GAP;
    if (placed[k]! < minC) placed[k] = minC;
  }
  // Clamp the run within [lo, hi]: shift left if it overflows the right, then right if it overflows left.
  const lastHalf = items[order[n - 1]!]!.w / 2;
  const over = placed[n - 1]! + lastHalf - hi;
  if (over > 0) for (let k = 0; k < n; k++) placed[k]! -= over;
  const firstHalf = items[order[0]!]!.w / 2;
  if (placed[0]! - firstHalf < lo) { const s = lo - (placed[0]! - firstHalf); for (let k = 0; k < n; k++) placed[k]! += s; }
  const out = new Array<number>(n);
  order.forEach((origIdx, k) => { out[origIdx] = placed[k]!; });
  return out;
}

/**
 * PURE — vertically de-collide per-bar value labels within a hovered cluster. Labels sit above
 * their bars (their natural y); when two horizontally overlap, the HIGHER-VALUE bar's label keeps
 * the higher position and the lower-value one is pushed down (ties: the left/earlier bar stays on
 * top). Returns the y per input label (input order). `pad` is the min vertical gap.
 */
export function staggerBarLabels(
  labels: Array<{ cx: number; w: number; value: number; y: number }>,
  pad: number,
): number[] {
  const n = labels.length;
  const out = new Array<number>(n);
  if (n === 0) return out;
  // Priority: higher value first (kept higher); ties → smaller cx (left) first.
  const order = labels.map((_, i) => i).sort((a, b) => labels[b]!.value - labels[a]!.value || labels[a]!.cx - labels[b]!.cx);
  const placed: number[] = [];
  for (const i of order) {
    let y = labels[i]!.y;
    let moved = true;
    while (moved) {
      moved = false;
      for (const j of placed) {
        const horiz = Math.abs(labels[i]!.cx - labels[j]!.cx) < (labels[i]!.w + labels[j]!.w) / 2;
        if (horiz && Math.abs(y - out[j]!) < pad) {
          // Progress guard: `(out[j] + pad) - out[j]` is not exactly `pad` in IEEE-754 (can be a
          // hair < pad), so without requiring strict upward progress the `< pad` test stays true,
          // y is reassigned to the same value, and `while (moved)` spins forever.
          const ny = out[j]! + pad;
          if (ny - y > 1e-6) { y = ny; moved = true; }
        }
      }
    }
    out[i] = y;
    placed.push(i);
  }
  return out;
}

/** A uniform-width hover band for category `idx`: width = one ROW PITCH (so every category band is
 *  the SAME size), centered on the category, shifted inward to stay within [lo, hi]. Only one band
 *  shows at a time, so the inward shift overlapping a neighbour is never visible. Fixes the
 *  point-scale outer-padding asymmetry that made edge bands narrower than the interior ones. */
export function uniformBand(
  centers: Array<{ category: string; cx: number }>,
  idx: number,
  lo: number,
  hi: number,
): { min: number; max: number } {
  const n = centers.length;
  if (n < 2) return { min: lo, max: hi };
  // The band is one ROW PITCH tall, taken as the smallest gap between adjacent centers. The pitch is
  // NOT the global average `(last - first) / (n - 1)`: a sectioned axis inserts spacer slots between
  // sections, and averaging over them inflated every band (38px rows, 114px section gaps → a 59.7px
  // band that bled into the neighbouring rows). Rows are evenly pitched WITHIN a section and only
  // spacers are wider, so the minimum gap is the true pitch — and on an unsectioned axis every gap
  // is equal, so this is exactly the old value. Coincident centers give a 0 gap and are skipped;
  // if that leaves nothing, fall back to the span so the band is still visible.
  let step = Infinity;
  for (let i = 1; i < n; i++) {
    const gap = centers[i]!.cx - centers[i - 1]!.cx;
    if (gap > 0 && gap < step) step = gap;
  }
  if (!Number.isFinite(step)) step = (centers[n - 1]!.cx - centers[0]!.cx) / (n - 1) || hi - lo;
  let min = centers[idx]!.cx - step / 2;
  let max = centers[idx]!.cx + step / 2;
  if (min < lo) { max += lo - min; min = lo; }
  if (max > hi) { min -= max - hi; max = hi; }
  return { min, max };
}

/** Resolve the category whose axis-label center is nearest the cursor x. */
export function nearestCategory(centers: Array<{ category: string; cx: number }>, svgX: number): string | null {
  let best: string | null = null;
  let bd = Infinity;
  for (const c of centers) {
    const d = Math.abs(c.cx - svgX);
    if (d < bd) { bd = d; best = c.category; }
  }
  return best;
}
