// Overlay marks: the resolved polylines (engine/overlays.ts) turned into Plot marks.
//
// Not a chartType builder — overlays apply to every numeric/temporal-x chart type, so they are built
// once in index.ts and pushed into whichever builder's layers, for the same reason assemblePlot owns
// the generic chrome rather than each builder repeating it.
//
// The line paints in `overlay` (above the data marks: a fit hidden behind a dense scatter is not a fit
// anyone can read) and the confidence ribbon in `underlay` (behind them — ggplot paints geom_smooth's
// band over the points, Stata's lfitci paints it under, and a tint over a scatter buries the data).
// That split is what `confidence_bands` already does.
//
// CLIPPING: both carry `clip: true` UNCONDITIONALLY, not from ctx.clipMarks. That flag is computed
// from the DATA's drawn extent (index.ts) and knows nothing about overlays, while the y domain is
// pinned (assemble-plot.ts) — so `method: lm` with `domain: axis` on a steep slope, or `fun: "x^2"`,
// would paint over the axis labels and the title. Overlay LABELS are not clipped, per the standing
// decision recorded on MarkContext.clipMarks: a half-cut label reads worse than one past the axis.
import { Plot } from "../vendor";
import { SINGLE_SERIES_KEY } from "../../spec/columns";
import { annotationKey } from "../annotation-legend";
import { LABEL_HALO } from "../assemble-plot";
import { TBL } from "../theme";
import type { MarkLayers } from "./index";
import type { ResolvedOverlay } from "../overlays";
import type { Overlay } from "../../spec/types";

export const OVERLAY_LINE_CLASS = "tbl-overlay-line";
export const OVERLAY_BAND_CLASS = "tbl-overlay-band";

/** Dash pattern, matching `annotations` reference lines rather than the data-line dash — an overlay
 *  is a statement about the data, not another series. */
const OVERLAY_DASH = "4 3";

export interface OverlayMarkContext {
  xField: "_xn" | "_xd";
  fxField?: string;
  fyField?: string;
  /** The frame the reader can actually see, used to keep an in-frame LABEL on the canvas. Omitted
   *  ⇒ no filtering, which is the pre-1.13 behaviour (and what a caller with no resolved scales
   *  gets). Only the label builder reads these; the LINE still draws over its full domain and is
   *  clipped by the plot, as before. */
  xDomain?: [number, number];
  yDomain?: [number, number];
  /** Inner plot size in px. With the domains, this gives the line's SCREEN slope, which decides
   *  whether a label clears it by moving vertically or horizontally. Omitted ⇒ vertical, as before. */
  plotWidth?: number;
  plotHeight?: number;
}

/** Numeric x → the adapter's own x units. Shared with the label builder. */
export function toAxisX(x: number, xField: "_xn" | "_xd"): number | Date {
  return xField === "_xd" ? new Date(x) : x;
}

/** One drawable row. `_seg` separates the runs a `null` y broke the line into, so Plot draws two
 *  paths rather than joining across the gap. */
interface OverlayRow {
  x: number | Date;
  y: number;
  _seg: string;
}

/** Split a polyline at its nulls into contiguous drawable runs. */
function runsOf(o: ResolvedOverlay, xField: "_xn" | "_xd", id: number): OverlayRow[] {
  const out: OverlayRow[] = [];
  let seg = 0;
  let open = false;
  for (const p of o.points) {
    if (p.y == null) {
      if (open) seg++;
      open = false;
      continue;
    }
    open = true;
    out.push({ x: toAxisX(p.x, xField), y: p.y, _seg: `${id}:${seg}` });
  }
  return out;
}

export function buildOverlayMarks(
  resolved: ResolvedOverlay[],
  entries: Overlay[],
  ctx: OverlayMarkContext,
): { underlay: unknown[]; overlay: unknown[]; tagging: MarkLayers["tagging"] } {
  const underlay: unknown[] = [];
  const overlay: unknown[] = [];
  const tagging: MarkLayers["tagging"] = [];
  if (!resolved.length) return { underlay, overlay, tagging };

  const facetChannels = ctx.fxField && ctx.fyField ? { fx: ctx.fxField, fy: ctx.fyField } : {};

  // Every overlay line shares ONE class (`OVERLAY_LINE_CLASS`) rather than a per-entry class:
  // Plot validates `className` as a single CSS-ident token with no whitespace, so a compound
  // "tbl-overlay-line tbl-overlay-line-0" throws at render time, and a custom `ariaLabel` (the
  // mechanism `line`/`point` marks use for the same kind of disambiguation, via
  // `g[aria-label=…]`) was tried and silently suppressed this mark's own path output instead —
  // so disambiguation for tagging happens in JS below, not through a second selector.
  //
  // Series tagging spans every overlay's paths through ONE selector (`g.OVERLAY_LINE_CLASS
  // path`), in push order — the same "one tagging entry, one flat seriesOrder built by walking
  // the marks in draw order" idiom `marks/line.ts` uses for its own multi-segment `line` layer.
  // An overlay with no series identity (fun / abline / a pooled fit) still needs an entry at its
  // position so later overlays' indices don't shift — but that entry is UNDEFINED, not
  // SINGLE_SERIES_KEY (""). "" is an attribute, and legend.ts's dim walk matches `[data-series]` by
  // PRESENCE: `data-series=""` is reached and matches no selection, so the line dimmed against every
  // real series. Only an absent attribute keeps it out of the walk. (See the sparseness contract on
  // MarkLayers.tagging.seriesOrder.)
  const combinedSeriesOrder: Array<string | undefined> = [];
  // Parallel to combinedSeriesOrder: the annotation key of the spec entry a keyed line came from, so
  // the same path carries BOTH keys — it dims with its series AND lights up when its legend row is
  // hovered. Undefined for a line whose label stayed in-frame (nothing moved to the legend for it).
  const combinedAnnotationOrder: Array<string | undefined> = [];
  // The CONFIDENCE RIBBON is a separate mark from the line it belongs to (areaY in `underlay` vs
  // line in `overlay`), so it needs its own tagging entry against its own selector — one band mark
  // emits exactly one `path`, so these are indexed per overlay, not per segment like the line's.
  // Without them the ribbon carried neither key, and legend.ts's dimming walk
  // (`[data-series], [data-annotation]`) never reached it: selecting the overlay's own annotation row
  // or its series dimmed the line and left the band permanently bright.
  const bandSeriesOrder: Array<string | undefined> = [];
  const bandAnnotationOrder: Array<string | undefined> = [];
  // Whether ANY overlay is keyed, which decides only whether the `annotationOrder` array is attached
  // at all. It is already sparse, so an unkeyed overlay's slot is undefined either way — this is not
  // a gate on which elements get tagged. Which of those is per-overlay: see `tagged` below.
  let anyAnnotation = false;

  resolved.forEach((o, i) => {
    const entry = entries[o.entryIndex];
    const key = o.keyed && entry?.label ? annotationKey(entry.label) : undefined;
    // PER OVERLAY, not per chart. With no series and no legend key THIS entry has no identity for the
    // legend to select on, so its paths must carry no `data-series` — while a sibling that does have
    // one still gets tagged. Deciding this once for the whole list (which is what accumulating the
    // flags outside the loop did) makes a mixed list wrong in one direction or the other: either the
    // reference line dims against every real series, or the real fit stops dimming with its own row.
    const tagged = o.series != null || key != null;
    const seriesTag = tagged ? (o.series ?? SINGLE_SERIES_KEY) : undefined;
    // Pushed ahead of the `rows.length < 2` return below on purpose, not by oversight: a populated
    // `o.band` requires >= 2 finite rows to exist at all (engine/overlays.ts), so that return can
    // never fire while a band is waiting to be pushed — there is no ordering bug to "fix" here.
    if (o.band?.length) {
      underlay.push(
        Plot.areaY(
          o.band.map((b) => ({ x: toAxisX(b.x, ctx.xField), lo: b.lo, hi: b.hi })),
          {
            x: "x",
            y1: "lo",
            y2: "hi",
            fill: o.color,
            // Matches confidence_bands (marks/line.ts) so two kinds of band on one chart read alike.
            fillOpacity: 0.18,
            className: OVERLAY_BAND_CLASS,
            clip: true,
            ...facetChannels,
          },
        ),
      );
      // Same keys the line below gets — computed ONCE above and used by both — so the ribbon dims
      // and brightens exactly as its line does in both directions: its series' legend row and its own
      // annotation row alike, and untagged wherever its line is untagged.
      bandSeriesOrder.push(seriesTag);
      bandAnnotationOrder.push(key);
    }

    const rows = runsOf(o, ctx.xField, i);
    if (rows.length < 2) return;
    overlay.push(
      Plot.line(rows, {
        x: "x",
        y: "y",
        z: "_seg",
        stroke: o.color,
        strokeWidth: o.strokeWidth,
        ...(o.dashed ? { strokeDasharray: OVERLAY_DASH } : {}),
        strokeLinecap: "round",
        className: OVERLAY_LINE_CLASS,
        clip: true,
        ...facetChannels,
      }),
    );

    // Selection: a per-series fit dims and pins with its series. Task 6 extends this to also tag a
    // keyed overlay's annotation key — that needs `annotationKey` from annotation-legend.ts, which
    // means it has to be minted HERE rather than in engine/overlays.ts (see the module-graph note).
    const segCount = new Set(rows.map((r) => r._seg)).size;
    if (key != null) anyAnnotation = true;
    for (let k = 0; k < segCount; k++) {
      combinedSeriesOrder.push(seriesTag);
      combinedAnnotationOrder.push(key);
    }
  });

  // Pushed UNCONDITIONALLY now. There is no chart-wide "does anything have an identity" question to
  // ask any more: both arrays are sparse, so an all-identity-less list tags nothing even with the
  // entry present, and a mixed list tags exactly the overlays that have an identity. The ribbon's
  // entry is built from the same per-overlay `seriesTag` as the line's, which is what keeps
  // "the ribbon behaves exactly as its line does" true by construction rather than by a shared flag.
  if (combinedSeriesOrder.length) {
    tagging.push({
      selector: `g.${OVERLAY_LINE_CLASS} path`,
      seriesOrder: combinedSeriesOrder,
      ...(anyAnnotation ? { annotationOrder: combinedAnnotationOrder } : {}),
    });
  }
  if (bandSeriesOrder.length) {
    tagging.push({
      selector: `g.${OVERLAY_BAND_CLASS} path`,
      seriesOrder: bandSeriesOrder,
      ...(anyAnnotation ? { annotationOrder: bandAnnotationOrder } : {}),
    });
  }

  return { underlay, overlay, tagging };
}

export const OVERLAY_LABEL_CLASS = "tbl-overlay-label";

/** One run's vertices CLIPPED to the visible frame, as the sub-runs that survive.
 *
 *  Liang-Barsky per segment. Three properties are load-bearing:
 *
 *  - **Original vertices are returned by identity, never recomputed.** `a + 1 * (b - a)` is not
 *    guaranteed to equal `b` in floating point, so reconstructing an unclipped endpoint could move
 *    it by an ulp — enough to alter rendered output for a figure that is entirely in frame, and
 *    enough to make the `wasClipped` identity check below fire when nothing was clipped.
 *  - **Input duplicates survive.** `column` overlays may repeat a row, and a `middle` anchor counts
 *    positions; only the SEAM between two adjacent segments is de-duplicated.
 *  - **Sub-runs stay separate.** A curve that leaves and re-enters the frame yields two runs. Joining
 *    them would put the exit and re-entry points side by side, and the slope measured between them
 *    is meaningless — it is not a direction the line ever travels.
 */
function clipRunToFrame(
  pts: Array<{ x: number; y: number }>,
  xDomain?: [number, number],
  yDomain?: [number, number],
): Array<Array<{ x: number; y: number }>> {
  const xLo = xDomain ? Math.min(...xDomain) : -Infinity;
  const xHi = xDomain ? Math.max(...xDomain) : Infinity;
  const yLo = yDomain ? Math.min(...yDomain) : -Infinity;
  const yHi = yDomain ? Math.max(...yDomain) : Infinity;
  const inside = (p: { x: number; y: number }): boolean =>
    p.x >= xLo && p.x <= xHi && p.y >= yLo && p.y <= yHi;
  // A non-finite coordinate has no position to clip against; treat the run as undrawable rather
  // than letting NaN fall through every comparison and emit NaN vertices.
  if (pts.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return [];
  if (!xDomain && !yDomain) return pts.length ? [pts] : [];
  if (pts.length === 1) return inside(pts[0]!) ? [[pts[0]!]] : [];

  /** An intersection, clamped so rounding cannot land it a hair outside the frame. */
  const at = (a: { x: number; y: number }, dx: number, dy: number, t: number) => ({
    x: Math.min(Math.max(a.x + t * dx, xLo), xHi),
    y: Math.min(Math.max(a.y + t * dy, yLo), yHi),
  });

  const runs: Array<Array<{ x: number; y: number }>> = [];
  let cur: Array<{ x: number; y: number }> = [];
  /** Index of the input vertex most recently pushed, so a shared seam is not duplicated. */
  let lastIdx = -1;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let t0 = 0;
    let t1 = 1;
    // Each boundary is `t * den >= num`. A POSITIVE den bounds t from below (t0), a negative one
    // from above (t1); den === 0 means the segment is parallel to that edge, so it survives only if
    // it starts on the inside.
    const clip = (num: number, den: number): boolean => {
      if (den === 0) return num <= 0;
      const t = num / den;
      if (den > 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
      return true;
    };
    const kept =
      clip(xLo - a.x, dx) && clip(a.x - xHi, -dx) && clip(yLo - a.y, dy) && clip(a.y - yHi, -dy);
    if (!kept) {
      if (cur.length) { runs.push(cur); cur = []; }
      lastIdx = -1;
      continue;
    }
    const startWhole = t0 === 0;
    const endWhole = t1 === 1;
    // Identity, not arithmetic, whenever the endpoint is the input vertex itself.
    const A = startWhole ? a : at(a, dx, dy, t0);
    const B = endWhole ? b : at(a, dx, dy, t1);
    if (!(startWhole && lastIdx === i)) {
      if (lastIdx !== -1 && !startWhole) { runs.push(cur); cur = []; }
      cur.push(A);
    }
    cur.push(B);
    lastIdx = endWhole ? i + 1 : -1;
    if (!endWhole) { runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/** In-frame labels for the overlays that carry one.
 *
 *  An overlay line is SLOPED, so unlike an `annotations.yAxis` label this cannot anchor to a frame
 *  edge — it anchors at a point ON the line, chosen by `labelPosition` (first / middle / last drawn
 *  point). `labelSide` then places it relative to the line, with the same base offsets assemble-plot
 *  uses for its yAxis marker labels, and the dx/dy conventions match `annotations` exactly:
 *  +labelDx = right, +labelDy = UP. Text stays horizontal; rotating it to the line's angle reads
 *  worse at these sizes and does not survive a resize.
 *
 *  NOT clipped, per the standing decision on MarkContext.clipMarks: "annotations and reference
 *  markers are deliberately never clipped: a half-cut label reads worse than one sitting past the
 *  axis." The line and band it labels DO clip.
 */
export function buildOverlayLabelMarks(
  resolved: ResolvedOverlay[],
  ctx: OverlayMarkContext,
): unknown[] {
  const marks: unknown[] = [];
  const facetChannels = ctx.fxField && ctx.fyField ? { fx: ctx.fxField, fy: ctx.fyField } : {};

  for (const o of resolved) {
    // A keyed overlay's text moved to a legend row, so there is nothing in-frame to draw.
    if (!o.label) continue;
    // Per RUN, not over the flattened points: a `column` overlay's blank cell is a BREAK, and the
    // line is drawn as separate paths either side of it (see `runsOf`). Flattening first and then
    // clipping would invent a segment across the gap — two points outside the frame on opposite
    // sides would manufacture a crossing, and hang a label on a line that is not drawn there.
    const runs: Array<Array<{ x: number; y: number }>> = [];
    let run: Array<{ x: number; y: number }> = [];
    for (const pt of o.points) {
      if (pt.y == null) {
        if (run.length) runs.push(run);
        run = [];
        continue;
      }
      run.push({ x: pt.x, y: pt.y });
    }
    if (run.length) runs.push(run);
    const drawn = runs.flat();
    if (!drawn.length) continue;
    // Anchor on the VISIBLE line, not the whole line. A line is sampled across its `domain`, which
    // routinely leaves the frame — a steep `domain: axis` fit exceeds the value axis, and an
    // explicit domain can run past the x axis. Anchoring at the last sampled point put the label
    // off-canvas, and because labels are never clipped it simply vanished.
    //
    // CLIPPED, not filtered: a `slope`+`intercept` line is sampled at its two domain endpoints and
    // nothing between, so filtering samples to the frame would leave one point (whichever end
    // happens to be inside) and drop the label at that end instead of where the line leaves the
    // view. Clipping produces the crossing point, which is where the visible line actually ends.
    const visibleRuns = runs.flatMap((r) => clipRunToFrame(r, ctx.xDomain, ctx.yDomain));
    const visible = visibleRuns.flat();
    // A label for a line the reader cannot see anywhere is the same defect as a legend row for a
    // line drawn nowhere, which validation already rejects.
    if (!visible.length) continue;
    const pick = <T,>(arr: T[]): T =>
      o.labelPosition === "left"
        ? arr[0]!
        : o.labelPosition === "middle"
          ? arr[Math.floor(arr.length / 2)]!
          : arr[arr.length - 1]!;
    const anchor = pick(visible);
    const raw = pick(drawn);
    // Did clipping move the anchor? Only then is the text's own direction in question. On an
    // unclipped line the pairing is already right — `right` anchors at the line's right end and
    // extends LEFT, `left` the mirror — so leaving that case alone keeps existing figures identical.
    const wasClipped = anchor.x !== raw.x || anchor.y !== raw.y;

    // How steep is the line WHERE THE LABEL SITS, in screen terms? `labelSide`'s ±7px vertical nudge
    // clears a shallow line and does nothing against a steep one: over the width of the text the
    // line climbs far more than 7px, so it runs straight through. Past ~45° the clearing direction
    // has to be horizontal instead — the label sits beside the line and its text extends away from
    // it. Needs the pixel geometry, since "steep" is a screen property, not a data one.
    const screenSlope = ((): number | null => {
      if (!ctx.xDomain || !ctx.yDomain || !ctx.plotWidth || !ctx.plotHeight) return null;
      // Within the anchor's own run. Across a gap the neighbour is a point the line never travels
      // to from here, and the slope between them describes nothing.
      const own = visibleRuns.find((r) => r.includes(anchor));
      if (!own || own.length < 2) return null;
      const i = own.indexOf(anchor);
      const other = own[i > 0 ? i - 1 : 1]!;
      if (other === anchor) return null;
      const xSpan = Math.max(...ctx.xDomain) - Math.min(...ctx.xDomain);
      const ySpan = Math.max(...ctx.yDomain) - Math.min(...ctx.yDomain);
      if (!xSpan || !ySpan) return null;
      const dxPx = ((anchor.x - other.x) / xSpan) * ctx.plotWidth;
      const dyPx = ((anchor.y - other.y) / ySpan) * ctx.plotHeight;
      return dxPx === 0 ? Infinity : Math.abs(dyPx / dxPx);
    })();
    const steep = screenSlope != null && screenSlope > 1;

    const lineAnchor =
      o.labelSide === "middle" ? "middle" : o.labelSide === "bottom" ? "top" : undefined;
    const baseDy = steep ? 0 : o.labelSide === "middle" ? 0 : o.labelSide === "bottom" ? 6 : -7;
    // A clipped line ends wherever it crosses the frame, which may be nothing like the side
    // `labelPosition` names: a steep `right`-labelled fit exits through the TOP, often near the left
    // edge, and extending the text leftward from there pushes it off the canvas. So when the anchor
    // has moved, the text extends INWARD from whichever edge it landed near.
    const edgeAnchor = ((): "start" | "middle" | "end" | null => {
      if (!wasClipped || !ctx.xDomain) return null;
      const lo = Math.min(...ctx.xDomain);
      const hi = Math.max(...ctx.xDomain);
      if (hi === lo) return null;
      const frac = (anchor.x - lo) / (hi - lo);
      return frac < 0.25 ? "start" : frac > 0.75 ? "end" : "middle";
    })();
    // On a steep line the label goes to whichever side has more room, with its text running away
    // from the line rather than across it. `labelSide` still chooses which side when the author has
    // said: `bottom`/`middle` read as "the far side", `top` as the near one.
    const steepSide = ((): "start" | "end" | null => {
      if (!steep || !ctx.xDomain) return null;
      const lo = Math.min(...ctx.xDomain);
      const hi = Math.max(...ctx.xDomain);
      if (hi === lo) return null;
      // Default to the side with more room. `bottom` is the author's way to say "the other side" —
      // above/below is meaningless on a near-vertical line, so the field becomes a side TOGGLE
      // rather than being silently ignored.
      const roomier: "start" | "end" = (anchor.x - lo) / (hi - lo) > 0.5 ? "end" : "start";
      if (o.labelSide === "bottom") return roomier === "end" ? "start" : "end";
      return roomier;
    })();
    const textAnchor =
      steepSide ??
      edgeAnchor ??
      (o.labelPosition === "left" ? "start" : o.labelPosition === "middle" ? "middle" : "end");
    const steepGap = 9;
    const baseDx = steep
      ? textAnchor === "start" ? steepGap : -steepGap
      : textAnchor === "start" ? 6 : textAnchor === "middle" ? 0 : -6;

    marks.push(
      Plot.text([{ x: toAxisX(anchor.x, ctx.xField), y: anchor.y, t: o.label }], {
        x: "x",
        y: "y",
        text: "t",
        textAnchor,
        ...(lineAnchor ? { lineAnchor } : {}),
        dx: o.labelDx != null ? o.labelDx : baseDx,
        // labelDy is + = UP → subtract it from the side's base SVG dy.
        dy: baseDy - (o.labelDy ?? 0),
        fill: o.color,
        fontSize: TBL.size.annotation,
        fontWeight: 600,
        className: OVERLAY_LABEL_CLASS,
        ...LABEL_HALO,
        ...facetChannels,
      }),
    );
  }
  return marks;
}
