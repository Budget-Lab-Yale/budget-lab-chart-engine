// The x-axis rug: a thin strip of solid interval blocks between the plot frame's bottom edge and
// the x-axis tick labels. For timeline categories that are illegible as fills — a one-month
// false-positive run on a 26-year axis is a hairline — or that would clutter the frame as labelled
// bands.
//
// Drawn by POST-RENDER injection rather than as a Plot mark, for three reasons: the strip lives
// outside the plot frame (Plot marks position against the frame), it needs exact pixel geometry, and
// any mark carrying an fx/fy channel would facet the whole plot (see assemblePlot's invariant
// guard). Pixel positions come from Plot's own `svg.scale("x")` — the accessor crosshair.ts reads —
// so blocks land on the real scale, not a re-derivation of it. No layout measurement, so the strip
// is identical in live HTML, the PNG export, and the jsdom goldens, which all consume this one SVG.
import { TBL } from "./theme";
import { resolveColor } from "./palette";
import { RUG_GAP } from "../spec/rug";
import type { ResolvedRugTrack } from "../spec/rug";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Class on the wrapping <g>, so the strip is findable in tests and stylable if that is ever wanted. */
export const RUG_CLASS = "tbl-rug";

/** Narrowest block drawn. A single month on a 26-year axis is well under a pixel, and a block too
 *  thin to see defeats the whole feature. */
const MIN_BLOCK_WIDTH = 2;

export interface DrawRugOptions {
  /** Strip height in px (`rug.height`). */
  height: number;
  /** The chart's x-value parser (the adapter's `parseX`) — turns a track's bound STRINGS into the
   *  numeric/Date values the x scale takes. */
  parseX: (v: string) => number | Date | string | null;
  /** Document to build into (jsdom in tests); defaults to the svg's own. */
  document?: Document;
  /** The annotation key a track's blocks should carry as `data-annotation`, so the strip joins the
   *  legend's hover-dim in both directions. Return undefined for a track with no legend row. */
  keyFor?: (track: ResolvedRugTrack) => string | undefined;
}

/** Plot's `svg.scale("x")` as a value→pixel function, or null when the scale is unreadable
 *  (a band scale, a degenerate domain, or an SVG that didn't come from Plot). */
function readXScale(svg: SVGSVGElement): ((v: number) => number) | null {
  const scaleFn = (svg as unknown as { scale?: (n: string) => unknown }).scale;
  if (typeof scaleFn !== "function") return null;
  try {
    const s = scaleFn.call(svg, "x") as { domain?: unknown[]; range?: number[] } | undefined;
    const d = s?.domain;
    const r = s?.range;
    if (!d || !r || d.length < 2 || r.length < 2) return null;
    const d0 = Number(d[0]);
    const d1 = Number(d[1]);
    const r0 = r[0] as number;
    const r1 = r[1] as number;
    if (!Number.isFinite(d0) || !Number.isFinite(d1) || d0 === d1) return null;
    return (v: number) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
  } catch {
    return null;
  }
}

/**
 * Append the rug strip to a rendered chart SVG. No-op when there are no tracks, when the x scale is
 * unreadable (a categorical chart — validation rejects that combination), or when the SVG carries no
 * height/margin metadata.
 *
 * The caller must already have grown `marginBottom` by `rugAllowance(spec)` (renderPane does), so
 * the space this draws into is space the plot frame gave up. Nothing here re-derives that allowance.
 */
export function drawRug(
  svg: SVGSVGElement,
  tracks: ResolvedRugTrack[],
  { height, parseX, document: docOpt, keyFor }: DrawRugOptions,
): void {
  if (!tracks.length) return;
  const toPx = readXScale(svg);
  if (!toPx) return;

  const svgHeight = Number(svg.getAttribute("height"));
  const marginBottom = Number(svg.dataset.marginBottom);
  const marginLeft = Number(svg.dataset.marginLeft);
  const marginRight = Number(svg.dataset.marginRight);
  const svgWidth = Number(svg.getAttribute("width"));
  if (!Number.isFinite(svgHeight) || !Number.isFinite(marginBottom)) return;

  const plotLeft = Number.isFinite(marginLeft) ? marginLeft : 0;
  const plotRight = Number.isFinite(svgWidth) && Number.isFinite(marginRight)
    ? svgWidth - marginRight
    : Infinity;
  const top = svgHeight - marginBottom + RUG_GAP;

  const doc = docOpt ?? svg.ownerDocument;
  const g = doc.createElementNS(SVG_NS, "g");
  g.setAttribute("class", RUG_CLASS);
  // The legend rows are the strip's accessible name; the blocks themselves are decoration.
  g.setAttribute("aria-hidden", "true");

  for (const track of tracks) {
    const fill = (track.color && (resolveColor(track.color) || track.color)) || TBL.color.annotationDim;
    const key = keyFor?.(track);
    for (const iv of track.intervals) {
      const from = parseX(iv.from);
      const to = parseX(iv.to);
      if (from == null || to == null || typeof from === "string" || typeof to === "string") continue;
      const a = toPx(Number(from));
      const b = toPx(Number(to));
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const lo = Math.max(Math.min(a, b), plotLeft);
      const hi = Math.min(Math.max(a, b), plotRight);
      // Wholly outside the visible x-domain: the interval isn't on this chart's timeline at all.
      if (hi < plotLeft || lo > plotRight) continue;
      const width = Math.max(hi - lo, MIN_BLOCK_WIDTH);
      const rect = doc.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", String(round(lo)));
      rect.setAttribute("y", String(round(top)));
      rect.setAttribute("width", String(round(width)));
      rect.setAttribute("height", String(round(height)));
      rect.setAttribute("fill", fill);
      if (key) rect.setAttribute("data-annotation", key);
      g.appendChild(rect);
    }
  }

  if (g.childElementCount) svg.appendChild(g);
}

/** Two decimals — enough for sub-pixel placement, short enough to keep the golden SVGs readable
 *  and stable across platforms' float formatting. */
function round(v: number): number {
  return Math.round(v * 100) / 100;
}
