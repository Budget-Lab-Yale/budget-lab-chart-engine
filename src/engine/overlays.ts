// Overlay geometry: `overlays` spec entries + prepared rows → polylines. PURE — no DOM, no scales,
// the same contract shade.ts states in its header.
//
// Engine-side (not src/spec/) because it needs the palette, the theme and the fit. It deliberately
// does NOT import annotation-legend.ts: it reports `keyed` and lets the caller mint the annotation
// key, so annotation-legend.ts can import overlayLineColor from here without a cycle.
import { fitPoly, evalPolyFit } from "./fit";
import { resolveColor } from "./palette";
import { TBL } from "./theme";
import { overlayKind, overlayDashed } from "../spec/overlays";
import { parseExpression, evalExpression } from "../spec/expr";
import type { OverlayKind } from "../spec/overlays";
import type { ChartSpec, Overlay } from "../spec/types";
import type { PreparedRow } from "./marks/index";

/** Default sample count for a `fun`, matching ggplot's `geom_function`. */
const DEFAULT_SAMPLES = 100;

export interface ResolvedOverlay {
  /** The polyline, x-ordered, in NUMERIC x space (epoch ms on a temporal axis). A `null` y is a
   *  BREAK: the mark builder splits the line there, so a function undefined over part of its domain
   *  draws the part that exists. */
  points: Array<{ x: number; y: number | null }>;
  color: string;
  dashed: boolean;
  strokeWidth: number;
  /** In-frame label text. Undefined when there is none, or when the label moved to a legend row. */
  label?: string;
  /** True when the label moved to a legend row. The caller mints `annotationKey(label)` from the spec
   *  entry — this module does not import annotation-legend.ts, to keep that edge one-way. */
  keyed: boolean;
  labelSide: "top" | "middle" | "bottom";
  labelPosition: "left" | "middle" | "right";
  labelDx?: number;
  labelDy?: number;
  /** The colour series this line belongs to, for a per-series fit — so legend pin/dim reaches it.
   *  Undefined for a pooled fit, a `fun` or an abline, which belong to no series. */
  series?: string;
  /** Small multiples: the pane this overlay is scoped to. */
  facet?: string;
  /** Confidence ribbon, same x grid as `points`. Task 7. */
  band?: Array<{ x: number; lo: number; hi: number }>;
}

export interface ResolveOverlaysContext {
  /** The prepared-row field holding the parsed x — "_xn" (numeric) or "_xd" (temporal). Categorical
   *  x never reaches here: validation rejects overlays on it. */
  xField: "_xn" | "_xd";
  colors: Map<string, string>;
  seriesNames: string[];
  /** The resolved x-scale domain, for `domain: "axis"` and for the kinds that default to it. Absent
   *  (no numeric x extent at all) ⇒ those overlays are dropped. */
  xDomain?: [number, number];
  /** Is there a legend to move a label INTO? `spec.legend !== false`, computed by the caller.
   *  Mirrors annotation-legend.ts's `labelMovedToLegend`: with the legend off, `legend: true` must
   *  NOT strip the in-frame label, or the label vanishes from the figure entirely. Passed in rather
   *  than imported so this module stays free of annotation-legend.ts. */
  legendActive: boolean;
}

/** Numeric x of a prepared row on a continuous axis (epoch ms for dates). */
function xOf(row: PreparedRow, xField: "_xn" | "_xd"): number {
  return xField === "_xd" ? ((row._xd as Date | null)?.getTime() ?? NaN) : (row._xn as number);
}

/** Finite extent of a numeric list, or null. A loop rather than `Math.min(...vals)`: scatter charts
 *  are the target chart type here and a spread of ~100k arguments overflows the call stack. */
function extentOf(vals: number[]): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of vals) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo <= hi ? [lo, hi] : null;
}

/** Stroke colour. A per-series fit takes its series' colour; everything else is chrome-toned.
 *  Exported so the legend row and the line it keys resolve through the SAME code. */
export function overlayLineColor(
  o: Overlay,
  colors: Map<string, string>,
  series?: string,
): string {
  const explicit = resolveColor(o.color);
  if (explicit) return explicit;
  if (series != null) return colors.get(series) ?? TBL.color.annotationDim;
  return TBL.color.annotationDim;
}

/** Every `overlays[].column` value present in the rows. `column` is real per-row data, so unlike the
 *  constructed kinds it folds into the value-axis extent (see index.ts's yForAxis) — otherwise a
 *  fitted series that runs above the raw data would silently sit off-frame. */
export function overlayColumnValues(spec: ChartSpec, rows: PreparedRow[]): number[] {
  const cols = (spec.overlays ?? []).map((o) => o.column).filter((c): c is string => !!c);
  if (!cols.length) return [];
  const out: number[] = [];
  for (const r of rows) {
    const bag = r._overlayCols;
    if (!bag) continue;
    for (const c of cols) {
      const v = bag[c];
      if (v != null && Number.isFinite(v)) out.push(v);
    }
  }
  return out;
}

/** The x extent this entry draws over, per the `domain` rules. Null ⇒ nothing to draw. */
function overlayDomain(
  o: Overlay,
  kind: OverlayKind,
  groupXs: number[],
  xDomain?: [number, number],
): [number, number] | null {
  if (Array.isArray(o.domain)) return [o.domain[0]!, o.domain[1]!];
  if (o.domain === "axis") return xDomain ?? null;
  // Default: the fitted group's data extent for the kinds that read the data (matching Stata `lfit`'s
  // own default, which stops at the data), the axis for the kinds that do not.
  if (kind === "method" || kind === "column") {
    const ext = extentOf(groupXs);
    return ext && ext[0] !== ext[1] ? ext : null;
  }
  return xDomain ?? null;
}

/** n evenly spaced samples across [lo, hi]; a single sample sits at lo. */
function sampleGrid(lo: number, hi: number, n: number): number[] {
  if (n <= 1) return [lo];
  const step = (hi - lo) / (n - 1);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? hi : lo + i * step));
}

/** Finite → a drawn point; anything else → a break. */
function pt(x: number, y: number): { x: number; y: number | null } {
  return { x, y: Number.isFinite(y) ? y : null };
}

export function resolveOverlays(
  spec: ChartSpec,
  rows: PreparedRow[],
  ctx: ResolveOverlaysContext,
): ResolvedOverlay[] {
  const entries = spec.overlays;
  if (!entries?.length) return [];

  // Grouped ONCE, outside the entries loop: a per-entry `rows.filter` per series is O(S·N) per
  // overlay, and the target chart type is a scatter with many points and several overlays.
  const rowsBySeries = new Map<string, PreparedRow[]>();
  for (const r of rows) {
    const list = rowsBySeries.get(r.series);
    if (list) list.push(r);
    else rowsBySeries.set(r.series, [r]);
  }

  const out: ResolvedOverlay[] = [];

  for (const o of entries) {
    const kind = overlayKind(o);
    if (!kind) continue; // validation already rejected this spec

    // `legend: true` MOVES the label out of the frame into a row — but only when there is a legend to
    // move it to (see ctx.legendActive).
    const keyed = ctx.legendActive && o.legend === true && !!o.label;
    const shared = {
      dashed: overlayDashed(o),
      strokeWidth: o.strokeWidth ?? 1.5,
      keyed,
      ...(!keyed && o.label ? { label: o.label } : {}),
      labelSide: o.labelSide ?? ("top" as const),
      labelPosition: o.labelPosition ?? ("right" as const),
      ...(o.labelDx != null ? { labelDx: o.labelDx } : {}),
      ...(o.labelDy != null ? { labelDy: o.labelDy } : {}),
      ...(o.facet != null ? { facet: o.facet } : {}),
    };

    // Which groups to draw. `method`/`column` split by series unless pooled; the other kinds do not
    // read the data at all, so they are one group with no series identity.
    const perSeries = (kind === "method" || kind === "column") && (o.by ?? "series") === "series";
    const groups: Array<{ series?: string; rows: PreparedRow[] }> = perSeries
      ? ctx.seriesNames.map((s) => ({ series: s, rows: rowsBySeries.get(s) ?? [] }))
      : [{ rows }];

    for (const g of groups) {
      const groupXs = g.rows.map((r) => xOf(r, ctx.xField));
      const dom = overlayDomain(o, kind, groupXs, ctx.xDomain);
      if (!dom) continue;
      const color = overlayLineColor(o, ctx.colors, g.series);
      const base = { ...shared, color, ...(g.series != null ? { series: g.series } : {}) };

      if (kind === "abline") {
        const f = (x: number): number => (o.intercept as number) + (o.slope as number) * x;
        out.push({ ...base, points: [pt(dom[0], f(dom[0])), pt(dom[1], f(dom[1]))] });
        continue;
      }

      if (kind === "fun") {
        const parsed = parseExpression(o.fun as string);
        if (!parsed.ok) continue; // validation already rejected this spec
        const params = o.params ?? {};
        const grid = sampleGrid(dom[0], dom[1], o.n ?? DEFAULT_SAMPLES);
        out.push({
          ...base,
          points: grid.map((x) => pt(x, evalExpression(parsed.ast, { ...params, x }))),
        });
        continue;
      }

      if (kind === "method") {
        const pairs: Array<[number, number]> = [];
        for (const r of g.rows) {
          const x = xOf(r, ctx.xField);
          const y = r._y;
          if (y != null) pairs.push([x, y]);
        }
        const degree = o.method === "poly" ? (o.degree ?? 2) : 1;
        const fit = fitPoly(pairs, degree);
        if (!fit) continue;
        // A straight line needs two points; a curve is sampled. (`n` is rejected on a fit, so the
        // grid is always the default — plenty for degree ≤ 5 across one frame.)
        const grid = sampleGrid(dom[0], dom[1], degree === 1 ? 2 : DEFAULT_SAMPLES);
        out.push({ ...base, points: grid.map((x) => pt(x, evalPolyFit(fit, x))) });
        continue;
      }

      // kind === "column": the values are already in the data — order by x and crop to the domain.
      const col = o.column as string;
      const pts: Array<{ x: number; y: number | null }> = [];
      for (const r of g.rows) {
        const x = xOf(r, ctx.xField);
        const y = r._overlayCols?.[col];
        if (!Number.isFinite(x) || y == null || !Number.isFinite(y)) continue;
        if (x < dom[0] || x > dom[1]) continue;
        pts.push(pt(x, y));
      }
      pts.sort((a, b) => a.x - b.x);
      if (pts.length < 2) continue;
      out.push({ ...base, points: pts });
    }
  }

  return out;
}
