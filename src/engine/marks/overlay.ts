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
  // position so later overlays' indices don't shift — SINGLE_SERIES_KEY ("") is inert there: no
  // real series is ever named "", so it never mis-dims when hovering an unrelated series.
  const combinedSeriesOrder: string[] = [];
  // Parallel to combinedSeriesOrder: the annotation key of the spec entry a keyed line came from, so
  // the same path carries BOTH keys — it dims with its series AND lights up when its legend row is
  // hovered. Undefined for a line whose label stayed in-frame (nothing moved to the legend for it).
  const combinedAnnotationOrder: Array<string | undefined> = [];
  let anySeries = false;
  let anyAnnotation = false;

  resolved.forEach((o, i) => {
    const entry = entries[o.entryIndex];
    const key = o.keyed && entry?.label ? annotationKey(entry.label) : undefined;
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
    if (o.series != null) anySeries = true;
    if (key != null) anyAnnotation = true;
    for (let k = 0; k < segCount; k++) {
      combinedSeriesOrder.push(o.series ?? SINGLE_SERIES_KEY);
      combinedAnnotationOrder.push(key);
    }
  });

  if (anySeries || anyAnnotation) {
    tagging.push({
      selector: `g.${OVERLAY_LINE_CLASS} path`,
      seriesOrder: combinedSeriesOrder,
      ...(anyAnnotation ? { annotationOrder: combinedAnnotationOrder } : {}),
    });
  }

  return { underlay, overlay, tagging };
}

export const OVERLAY_LABEL_CLASS = "tbl-overlay-label";

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
    const drawn = o.points.filter((p): p is { x: number; y: number } => p.y != null);
    if (!drawn.length) continue;
    const anchor =
      o.labelPosition === "left"
        ? drawn[0]!
        : o.labelPosition === "middle"
          ? drawn[Math.floor(drawn.length / 2)]!
          : drawn[drawn.length - 1]!;

    const lineAnchor =
      o.labelSide === "middle" ? "middle" : o.labelSide === "bottom" ? "top" : undefined;
    const baseDy = o.labelSide === "middle" ? 0 : o.labelSide === "bottom" ? 6 : -7;
    const textAnchor =
      o.labelPosition === "left" ? "start" : o.labelPosition === "middle" ? "middle" : "end";
    const baseDx = o.labelPosition === "left" ? 6 : o.labelPosition === "middle" ? 0 : -6;

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
