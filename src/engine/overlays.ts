// Overlay geometry: `overlays` spec entries + prepared rows → polylines. PURE — no DOM, no scales,
// the same contract shade.ts states in its header.
//
// Engine-side (not src/spec/) because it needs the palette, the theme and the fit. It deliberately
// does NOT import annotation-legend.ts: it reports `keyed` and lets the caller mint the annotation
// key, so annotation-legend.ts can import overlayLineColor from here without a cycle.
import { fitPoly, evalPolyFit, polyFitStdError, studentTQuantile } from "./fit";
import { resolveColor } from "./palette";
import { TBL } from "./theme";
import { overlayKind, overlayDashed, overlayPerSeries } from "../spec/overlays";
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
  /** Index of the spec entry this line came from. One entry can resolve to several lines (a
   *  per-series fit), and the caller needs the entry back to mint its annotation key — which this
   *  module cannot do itself without importing annotation-legend.ts. */
  entryIndex: number;
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

/** Does this entry draw in the pane being rendered? SINGLE SOURCE for the draw-time filter and the
 *  value-axis fold (both in index.ts): an overlay that is filtered OUT of a pane must not widen that
 *  pane's value axis either — and in `small_multiples.mode: "shared"` the unioned domain then
 *  flattens every pane, including the one that legitimately draws the line. Deriving the two
 *  separately is exactly how they drifted apart.
 *
 *  An entry with a `facet` on a NON-faceted chart (paneFacetValue undefined) draws nowhere, so it
 *  contributes nothing — the drawing and the axis agree on that too. */
export function overlayDrawsInPane(facet?: string, paneFacetValue?: string): boolean {
  return facet == null || facet === paneFacetValue;
}

/** Rows grouped by colour series. Built ONCE per call: a per-entry `rows.filter` per series is
 *  O(S·N) per overlay, and the target chart type is a scatter with many points and several
 *  overlays. */
function groupBySeries(rows: PreparedRow[]): Map<string, PreparedRow[]> {
  const bySeries = new Map<string, PreparedRow[]>();
  for (const r of rows) {
    const list = bySeries.get(r.series);
    if (list) list.push(r);
    else bySeries.set(r.series, [r]);
  }
  return bySeries;
}

/** The groups one entry resolves to: one per colour series for a per-series `method`/`column`, else
 *  a single pooled group with no series identity (the constructed kinds do not read the data). */
function overlayGroups(
  o: Overlay,
  rows: PreparedRow[],
  seriesNames: string[],
  bySeries: Map<string, PreparedRow[]>,
): Array<{ series?: string; rows: PreparedRow[] }> {
  return overlayPerSeries(o)
    ? seriesNames.map((s) => ({ series: s, rows: bySeries.get(s) ?? [] }))
    : [{ rows }];
}

/** The `column` kind's polyline for ONE group: x-ordered, cropped to the entry's `domain`, blank
 *  cells as breaks. Null ⇒ nothing is drawn at all.
 *
 *  A row that IS in scope but carries no value for this column emits a BREAK (`y: null`), not
 *  nothing: CONFIG-SPEC.md's `overlays[].column` row promises "a sparse column breaks its line
 *  rather than diving to the baseline", and skipping the row outright joined its neighbours instead
 *  — rerouting the line through a segment the data never claimed, which reads as a plausible wrong
 *  line rather than a gap. (Non-numeric cells never get here: validate.ts rejects them, for the same
 *  reason. "Absent" is the only non-number this can see.)
 *
 *  A row cropped OUT by the domain, or with no usable x, emits NOTHING — outside the drawn extent
 *  the line simply stops, which is not the same claim as a hole inside it.
 *
 *  SHARED with the value-axis fold (overlayColumnValues) so the axis can only ever be widened by
 *  values the line actually draws: same crop, same "too sparse to be a line" rule, one code path. */
function columnPoints(
  o: Overlay,
  rows: PreparedRow[],
  xField: "_xn" | "_xd",
  xDomain?: [number, number],
): Array<{ x: number; y: number | null }> | null {
  const dom = overlayDomain(
    o,
    "column",
    rows.map((r) => xOf(r, xField)),
    xDomain,
  );
  if (!dom) return null;
  const col = o.column as string;
  const pts: Array<{ x: number; y: number | null }> = [];
  for (const r of rows) {
    const x = xOf(r, xField);
    if (!Number.isFinite(x)) continue;
    if (x < dom[0] || x > dom[1]) continue;
    const y = r._overlayCols?.[col];
    pts.push(y != null && Number.isFinite(y) ? pt(x, y) : { x, y: null });
  }
  // Sorted by x with the breaks in place, so each one lands between the neighbours it separates
  // — that position is what the mark builder's run-splitting reads (marks/overlay.ts#runsOf).
  pts.sort((a, b) => a.x - b.x);
  // REAL points only: a break is not a vertex, and two blanks around one value is not a line.
  if (pts.reduce((n, p) => n + (p.y == null ? 0 : 1), 0) < 2) return null;
  return pts;
}

/** Every `overlays[].column` value the overlay lines of THIS pane actually draw. `column` is real
 *  per-row data, so unlike the constructed kinds it folds into the value-axis extent (see index.ts's
 *  yForAxis) — otherwise a fitted series that runs above the raw data would silently sit off-frame.
 *
 *  Scoped to what is drawn, via the same `columnPoints`/`overlayDrawsInPane` the geometry uses: a
 *  pane the overlay is facet-filtered out of, an x range the `domain` crops away, and a group too
 *  sparse to be a line contribute nothing. A BREAK (`y: null`, a blank cell) is not a value and
 *  must never reach the extent as a zero. */
export function overlayColumnValues(
  spec: ChartSpec,
  rows: PreparedRow[],
  ctx: {
    /** The adapter's raw `xField`. Anything but "_xn"/"_xd" — i.e. "_xc", a categorical axis —
     *  renders no overlays at all, matching index.ts's own draw-side guard, so it folds nothing.
     *  Narrowed here rather than cast at the call site: a cast would silently make a categorical
     *  axis read `_xn` off every row as NaN. */
    xField: string;
    seriesNames: string[];
    paneFacetValue?: string;
    xDomain?: [number, number];
  },
): number[] {
  const entries = spec.overlays;
  const xField = ctx.xField;
  if (!entries?.length || (xField !== "_xn" && xField !== "_xd")) return [];
  const bySeries = groupBySeries(rows);
  const out: number[] = [];
  for (const o of entries) {
    if (overlayKind(o) !== "column") continue; // wrong kind, or an invalid spec validation rejects
    if (!overlayDrawsInPane(o.facet, ctx.paneFacetValue)) continue;
    for (const g of overlayGroups(o, rows, ctx.seriesNames, bySeries)) {
      const pts = columnPoints(o, g.rows, xField, ctx.xDomain);
      if (!pts) continue;
      for (const p of pts) if (p.y != null) out.push(p.y);
    }
  }
  return out;
}

/** One `overlays[].tooltip: true` line, ready to become a hover-tooltip row. Carries the DRAWN
 *  polyline rather than a value: the row's value depends on where the cursor is, and the polyline is
 *  the only thing that knows what the line is at an arbitrary x. */
export interface OverlayTooltipLine {
  /** The row's text — `overlays[].label`, which `tooltip: true` requires. */
  label: string;
  color: string;
  dashed: boolean;
  /** The colour series a per-series fit belongs to, so two rows of one label can be told apart.
   *  Undefined for a pooled fit, a `fun` or an abline. */
  series?: string;
  /** `ResolvedOverlay.points` — x-ordered, numeric x, `null` y at a break. */
  points: Array<{ x: number; y: number | null }>;
}

/** The `tooltip: true` lines among `resolved`, in draw order.
 *
 *  Takes RESOLVED overlays, not spec entries, and that is the whole point: `resolveOverlays` has
 *  already cropped each line to its `domain` and the caller has already dropped the entries that do
 *  not draw in this pane (`overlayDrawsInPane`), so a row can only ever exist for a line that is
 *  actually on screen. Re-deriving the crop or the pane filter for the tooltip is how a row for an
 *  invisible line would get back in — the same defect class as the phantom legend row.
 *
 *  The `label` comes from the SPEC entry rather than `ResolvedOverlay.label`, which `legend: true`
 *  deliberately strips (the label moved to a legend row). A keyed overlay still names itself in a
 *  tooltip row. */
export function overlayTooltipLines(
  entries: Overlay[] | undefined,
  resolved: ResolvedOverlay[],
): OverlayTooltipLine[] {
  if (!entries?.length) return [];
  const out: OverlayTooltipLine[] = [];
  for (const o of resolved) {
    const entry = entries[o.entryIndex];
    if (entry?.tooltip !== true || !entry.label) continue; // validation requires the label
    out.push({
      label: entry.label,
      color: o.color,
      dashed: o.dashed,
      points: o.points,
      ...(o.series != null ? { series: o.series } : {}),
    });
  }
  return out;
}

/** The value the DRAWN line has at `x`, or null when nothing is drawn there.
 *
 *  Reads the polyline itself — no fit object, no expression, no second evaluator. `marks/overlay.ts`
 *  hands these same points to `Plot.line` with no `curve` option, so the mark is straight segments
 *  between consecutive vertices and a linear interpolation here IS the line's height at that pixel.
 *  Re-evaluating the fit or the expression instead would be a second answer to the same question,
 *  correct at the sample points and quietly different everywhere between them.
 *
 *  Null in three cases, each of them "the line is not there": outside the drawn extent (an
 *  `overlays[].domain` crop is never extrapolated), on a break vertex, and inside a break's span. */
export function overlayValueAt(points: Array<{ x: number; y: number | null }>, x: number): number | null {
  const n = points.length;
  if (n < 2 || !Number.isFinite(x)) return null;
  if (x < points[0]!.x || x > points[n - 1]!.x) return null;
  // Bisect for the last vertex at or before x. Points are x-ordered (see ResolvedOverlay.points),
  // and a `column` overlay over a dense scatter can carry thousands of them — one per row.
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.x <= x) lo = mid;
    else hi = mid;
  }
  const a = points[lo]!;
  const b = points[hi]!;
  if (x === a.x) return a.y;
  if (x === b.x) return b.y;
  if (a.y == null || b.y == null) return null; // inside a break — the mark draws no segment here
  return a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
}

/** The x extent this entry draws over, per the `domain` rules. Null ⇒ nothing to draw.
 *
 *  `dataXs` is the x of the group's OBSERVATIONS, not of its rows: for `method` the caller passes
 *  the xs of the (x, y) pairs the fit uses, so a row the fit skipped cannot widen the default
 *  domain. `column` passes every row's x, which is equivalent for what it draws — a row past the
 *  last value emits a break, and a trailing break opens no segment. */
function overlayDomain(
  o: Overlay,
  kind: OverlayKind,
  dataXs: number[],
  xDomain?: [number, number],
): [number, number] | null {
  if (Array.isArray(o.domain)) return [o.domain[0]!, o.domain[1]!];
  if (o.domain === "axis") return xDomain ?? null;
  // Default: the extent of the OBSERVATIONS for the kinds that read the data (matching Stata `lfit`'s
  // own default, which stops at the data), the axis for the kinds that do not. See `dataXs` above:
  // what counts as an observation is the caller's call, and for `method` it excludes a blank value.
  if (kind === "method" || kind === "column") {
    const ext = extentOf(dataXs);
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

/** The observations a `method` fit uses: rows with BOTH a finite x and a finite value. The single
 *  source for the fit's input and for its default domain — see the note at the call site. */
function fitPairs(rows: PreparedRow[], xField: "_xn" | "_xd"): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (const r of rows) {
    const x = xOf(r, xField);
    const y = r._y;
    if (y != null && Number.isFinite(x) && Number.isFinite(y)) pairs.push([x, y]);
  }
  return pairs;
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

  // Grouped ONCE, outside the entries loop — see groupBySeries.
  const rowsBySeries = groupBySeries(rows);

  const out: ResolvedOverlay[] = [];

  for (const [entryIndex, o] of entries.entries()) {
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
    const groups = overlayGroups(o, rows, ctx.seriesNames, rowsBySeries);

    for (const g of groups) {
      // A `method` fit reads (x, y) PAIRS: a row whose value cell is blank (or whose x did not
      // parse) is not an observation, and the fitting loop below skips it. Its x must therefore not
      // reach the DEFAULT domain either — the default is "the fitted group's data extent"
      // (CONFIG-SPEC.md), and taking the extent of every row in the group drew the line out to an
      // observation the fit never saw, i.e. extrapolation presented as fit. Built ONCE here so the
      // domain and the fit can only ever read the same pairs.
      const pairs = kind === "method" ? fitPairs(g.rows, ctx.xField) : null;
      const domXs = pairs ? pairs.map((pr) => pr[0]) : g.rows.map((r) => xOf(r, ctx.xField));
      const dom = overlayDomain(o, kind, domXs, ctx.xDomain);
      if (!dom) continue;
      const color = overlayLineColor(o, ctx.colors, g.series);
      const base = { ...shared, entryIndex, color, ...(g.series != null ? { series: g.series } : {}) };

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
        const degree = o.method === "poly" ? (o.degree ?? 2) : 1;
        const fit = fitPoly(pairs!, degree);
        if (!fit) continue;
        // A straight line needs two points; a curve is sampled. (`n` is rejected on a fit, so the
        // grid is always the default — plenty for degree ≤ 5 across one frame.) A banded fit samples
        // like a curve even at degree 1: the ribbon's edges are hyperbolic, and a two-point grid
        // would draw them as straight lines.
        const ciLevel = o.ci;
        const grid = sampleGrid(
          dom[0],
          dom[1],
          degree === 1 && ciLevel == null ? 2 : DEFAULT_SAMPLES,
        );
        let band: Array<{ x: number; lo: number; hi: number }> | undefined;
        if (ciLevel != null && Number.isFinite(fit.s)) {
          const t = studentTQuantile(1 - (1 - ciLevel) / 2, fit.n - fit.p);
          const bandRows: Array<{ x: number; lo: number; hi: number }> = [];
          for (const x of grid) {
            const yhat = evalPolyFit(fit, x);
            const se = polyFitStdError(fit, x);
            if (!Number.isFinite(yhat) || !Number.isFinite(se) || !Number.isFinite(t)) continue;
            bandRows.push({ x, lo: yhat - t * se, hi: yhat + t * se });
          }
          if (bandRows.length >= 2) band = bandRows;
        }
        out.push({
          ...base,
          points: grid.map((x) => pt(x, evalPolyFit(fit, x))),
          ...(band ? { band } : {}),
        });
        continue;
      }

      // kind === "column": the values are already in the data — order by x, crop to the domain,
      // blanks as breaks. Shared with the value-axis fold; see columnPoints.
      const pts = columnPoints(o, g.rows, ctx.xField, ctx.xDomain);
      if (!pts) continue;
      out.push({ ...base, points: pts });
    }
  }

  return out;
}
