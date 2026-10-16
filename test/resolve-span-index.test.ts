// One nearest-span resolver (`resolveSpanIndex`) replaced three hand-written copies:
// `resolveCategoryFromBands` (vertical band hover), `resolveCategoryFromBandsH` (horizontal band
// hover) and `resolveHistogramBinIndex` (histogram hover, its coordinated cursor, and its rect-to-bin
// bucketing). A fourth copy, `resolveFacetCell`, went with the dormant facet crosshair (T1.1).
//
// The ORACLES below are those three bodies exactly as they stood before the replacement. Every
// input in the table is run through the oracle, the exported function that now wraps
// `resolveSpanIndex`, and `resolveSpanIndex` directly, and all three must agree. The inputs follow
// the call sites: midpoint-widened bar bands (vertical), widened rows with section gaps
// (horizontal), edge-to-edge bin spans (histogram), queried at every edge, midpoint, just inside and
// outside each, the plot ends, and the non-finite values. A seeded random sweep adds overlapping,
// inverted, zero-width and duplicate spans.
import { describe, it, expect } from "vitest";
import {
  resolveSpanIndex,
  resolveCategoryFromBands,
  resolveCategoryFromBandsH,
  resolveHistogramBinIndex,
  widenBandsToMidpoints,
  type CategoryBand,
  type CategoryBandH,
} from "../src/engine/crosshair/layout-math";

// ---- oracles: the pre-replacement bodies, verbatim ----------------------------------------------

function oracleBands(bands: CategoryBand[], svgX: number): string | null {
  if (!bands.length) return null;

  // Check containment first.
  for (const b of bands) {
    if (svgX >= b.xMin && svgX <= b.xMax) return b.category;
  }

  // Snap to nearest band midpoint.
  let best: CategoryBand = bands[0]!;
  let bestDist = Infinity;
  for (const b of bands) {
    const mid = (b.xMin + b.xMax) / 2;
    const dist = Math.abs(svgX - mid);
    if (dist < bestDist) { bestDist = dist; best = b; }
  }
  return best.category;
}

function oracleBandsH(bands: CategoryBandH[], svgY: number): string | null {
  if (!bands.length) return null;

  // Check containment first.
  for (const b of bands) {
    if (svgY >= b.yMin && svgY <= b.yMax) return b.category;
  }

  // Snap to nearest band midpoint.
  let best: CategoryBandH = bands[0]!;
  let bestDist = Infinity;
  for (const b of bands) {
    const mid = (b.yMin + b.yMax) / 2;
    const dist = Math.abs(svgY - mid);
    if (dist < bestDist) { bestDist = dist; best = b; }
  }
  return best.category;
}

function oracleHistogram(spans: Array<{ min: number; max: number }>, svgX: number): number | null {
  if (!spans.length) return null;
  for (let i = 0; i < spans.length; i++) {
    if (svgX >= spans[i]!.min && svgX <= spans[i]!.max) return i;
  }
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < spans.length; i++) {
    const mid = (spans[i]!.min + spans[i]!.max) / 2;
    const d = Math.abs(svgX - mid);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

// ---- inputs -------------------------------------------------------------------------------------

type Spans = Array<{ min: number; max: number }>;

/** Bar extents → the widened bands the band crosshair resolves against (attachBandCrosshair). */
const widened = (bars: Spans, lo: number, hi: number, boundaryAfter?: boolean[]): Spans =>
  widenBandsToMidpoints(bars, lo, hi, boundaryAfter);

/** Edge-to-edge bins, as buildHistogramGeom's `spans`. */
const bins = (x0: number, width: number, n: number): Spans =>
  Array.from({ length: n }, (_, i) => ({ min: x0 + i * width, max: x0 + (i + 1) * width }));

const SPAN_SETS: Array<[string, Spans]> = [
  ["empty", []],
  ["single bar", [{ min: 100, max: 140 }]],
  ["single zero-width", [{ min: 50, max: 50 }]],
  // Vertical band crosshair: 5 bars of width 40 on a 72px step, widened to midpoints in [40, 400].
  ["vertical bars, widened", widened(bins(0, 72, 5).map((s) => ({ min: s.min + 56, max: s.min + 96 })), 40, 400)],
  // Grouped (fx-faceted) clusters: uneven cluster widths.
  ["grouped clusters, widened", widened([{ min: 60, max: 130 }, { min: 170, max: 260 }, { min: 300, max: 330 }], 40, 380)],
  // Horizontal band crosshair: rows, with a section gap after row 1 (boundaryAfter), widened in [18, 372].
  ["horizontal rows with a section gap", widened(
    [{ min: 30, max: 50 }, { min: 60, max: 80 }, { min: 150, max: 170 }, { min: 180, max: 200 }],
    18, 372, [false, true, false, false],
  )],
  // Raw (unwidened) bars, which leave gaps between spans.
  ["raw bars with gaps", [{ min: 10, max: 20 }, { min: 40, max: 50 }, { min: 70, max: 80 }]],
  // Histogram: edge-to-edge bins (shared edges), as attachHistogramHover / the secondary cursor see.
  ["histogram bins", bins(40, 37.5, 8)],
  ["histogram one bin", bins(40, 600, 1)],
  ["fractional bins", bins(0.1, 0.3, 7)],
];

/** Query points for a span set: every edge and midpoint, a hair inside and outside each, the plot
 *  ends, far outside, and the non-finite values. */
function queries(spans: Spans): number[] {
  const out = [0, -0, -1e9, 1e9, NaN, Infinity, -Infinity, 40, 400, 18, 372];
  for (const s of spans) {
    const mid = (s.min + s.max) / 2;
    out.push(s.min, s.max, mid, s.min - 1e-9, s.min + 1e-9, s.max - 1e-9, s.max + 1e-9, s.min - 7, s.max + 7);
  }
  for (let i = 1; i < spans.length; i++) out.push((spans[i - 1]!.max + spans[i]!.min) / 2);
  return out;
}

/** mulberry32 — a fixed seed so the sweep is the same on every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSpans(r: () => number): Spans {
  const n = Math.floor(r() * 7);
  const out: Spans = [];
  for (let i = 0; i < n; i++) {
    const kind = r();
    const a = Math.round(r() * 400) / (r() < 0.5 ? 1 : 4);
    const w = kind < 0.15 ? 0 : kind < 0.25 ? -Math.round(r() * 30) : Math.round(r() * 80);
    out.push({ min: a, max: a + w }); // w < 0 → an inverted span, which contains nothing
    if (r() < 0.15) out.push({ ...out[out.length - 1]! }); // an exact duplicate
  }
  return out;
}

// ---- assertions ---------------------------------------------------------------------------------

/** Run one (spans, v) case through all three shapes; return a description of the first mismatch. */
function mismatch(spans: Spans, v: number): string | null {
  const viaResolver = resolveSpanIndex(spans, v);

  const vBands: CategoryBand[] = spans.map((s, i) => ({ category: `c${i}`, xMin: s.min, xMax: s.max }));
  const vExpect = oracleBands(vBands, v);
  const vGot = resolveCategoryFromBands(vBands, v);
  const vResolver = viaResolver == null ? null : vBands[viaResolver]!.category;
  if (vGot !== vExpect || vResolver !== vExpect) return `vertical: oracle ${vExpect}, export ${vGot}, resolver ${vResolver}`;

  const hBands: CategoryBandH[] = spans.map((s, i) => ({ category: `c${i}`, yMin: s.min, yMax: s.max }));
  const hExpect = oracleBandsH(hBands, v);
  const hGot = resolveCategoryFromBandsH(hBands, v);
  const hResolver = viaResolver == null ? null : hBands[viaResolver]!.category;
  if (hGot !== hExpect || hResolver !== hExpect) return `horizontal: oracle ${hExpect}, export ${hGot}, resolver ${hResolver}`;

  const binExpect = oracleHistogram(spans, v);
  const binGot = resolveHistogramBinIndex(spans, v);
  if (binGot !== binExpect || viaResolver !== binExpect) return `histogram: oracle ${binExpect}, export ${binGot}, resolver ${viaResolver}`;
  return null;
}

describe("resolveSpanIndex agrees with the three resolvers it replaced", () => {
  for (const [name, spans] of SPAN_SETS) {
    it(name, () => {
      const qs = queries(spans);
      const bad = qs.map((v) => ({ v, why: mismatch(spans, v) })).filter((x) => x.why);
      expect(bad).toEqual([]);
      expect(qs.length).toBeGreaterThan(10);
    });
  }

  it("a seeded random sweep: overlapping, inverted, zero-width and duplicate spans", () => {
    const r = rng(0x7a45);
    let cases = 0;
    const bad: Array<{ spans: Spans; v: number; why: string }> = [];
    for (let k = 0; k < 2000; k++) {
      const spans = randomSpans(r);
      for (const v of [...queries(spans), r() * 500 - 50, Math.round(r() * 400)]) {
        cases++;
        const why = mismatch(spans, v);
        if (why) bad.push({ spans, v, why });
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(cases).toBeGreaterThan(20000);
  });

  // Not vacuous: the cases exercise BOTH branches — containment and the nearest-midpoint snap.
  it("the table reaches containment, the snap, the shared-edge tie and null", () => {
    const hist = bins(40, 37.5, 8);
    expect(resolveSpanIndex(hist, 77.5)).toBe(0); // a shared edge goes to the EARLIER bin
    expect(resolveSpanIndex(hist, 78)).toBe(1); // containment
    expect(resolveSpanIndex(hist, 1e9)).toBe(7); // snap past the right end
    expect(resolveSpanIndex([{ min: 10, max: 20 }, { min: 40, max: 50 }], 30)).toBe(0); // equidistant: first wins
    expect(resolveSpanIndex([{ min: 10, max: 20 }, { min: 40, max: 50 }], 31)).toBe(1); // snap to the nearer
    expect(resolveSpanIndex(hist, NaN)).toBe(0);
    expect(resolveSpanIndex([], 5)).toBeNull();
  });
});
