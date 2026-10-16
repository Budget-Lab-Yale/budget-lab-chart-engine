// Scatter per-point hover.
import type { IconSpec } from "../icon";
import type { OverlayTooltipLine } from "../overlays";
import { getSharedTooltip, tooltipOwnership, buildPointTooltipHtml } from "./card";
import { type HoverDetach, NO_DETACH, listen, placeCard } from "./attach";

// ---------------------------------------------------------------------------
// Per-point hover — scatter charts
// ---------------------------------------------------------------------------

export interface PointHoverOptions {
  /** Series → its resolved icon; see icon.ts resolveTooltipIcons. */
  icons?: Map<string, IconSpec>;
  /** One entry per RENDERED marker, in the SAME DOM order as `selector` matches. Rows that render
   *  nothing (a blank value, a shape outside the symbol domain) must already be excluded — pairing
   *  is positional, so a stale entry shifts every later marker onto the wrong row. */
  points: Array<{ series: string; shape?: string; x: number; y: number | null; pointLabel?: string }>;
  /** CSS selector for the marker elements (e.g. 'g[aria-label="dot"] path'). */
  selector: string;
  colors?: Map<string, string>;
  seriesLabels?: Record<string, string>;
  shapeLabels?: Record<string, string>;
  /** Combine the shape value into the header line ("series · shape") — dual encoding. */
  showShape?: boolean;
  /** Name the series in the header. False for a scatter whose points are identified some other way
   *  (`tooltip_series_name: false`); the shape and point-label tokens are unaffected. */
  showSeriesName?: boolean;
  /** shape value → d3 symbol name, so the tooltip header shows the point's actual marker shape
   *  (filled in the series color). Falls back to a circle. */
  symbols?: Map<string, string>;
  /** Row labels for the x / y tooltip rows. */
  xLabel?: string;
  yLabel?: string;
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  /** `overlays[].tooltip: true` lines drawn in this frame. A scatter's card names ONE point, so the
   *  row is the overlay's value at THAT point's x — and only the lines that apply to it: a per-series
   *  fit for another series is not this point's trend. */
  overlays?: OverlayTooltipLine[];
  /** `chrome.tooltip: false` — suppress the floating tooltip card. A scatter point's ONLY hover
   *  feedback is this card (no separate guide/highlight), so `undefined` keeps today's behaviour
   *  (tooltip shown) and `false` makes hovering a point a no-op. */
  showTooltip?: boolean;
  /** Reparent the floating tooltip card into this element instead of `document.body`. Threaded
   *  from MountOptions.tooltipContainer (render-live.ts) — see that option's doc for why
   *  reparenting is opt-in. `undefined` keeps today's behaviour (body). */
  tooltipContainer?: HTMLElement;
}

/**
 * Attach a per-point hover tooltip to a SCATTER chart. Each rendered marker (matched by
 * `selector`, in data order) shows a tooltip with its color (series), shape value, and x/y on
 * hover. No guide / snapping — a scatter's points aren't aligned on a shared x, so each marker
 * is its own hover target. The color legend's hover-dim continues to work independently.
 */
export function attachPointHover(svgEl: SVGSVGElement, opts: PointHoverOptions): HoverDetach {
  if (!svgEl || !opts.points?.length) return NO_DETACH;
  const doc = svgEl.ownerDocument;
  const tip = opts.showTooltip === false ? null : getSharedTooltip(doc, opts.tooltipContainer);
  const card = tooltipOwnership(tip);
  const unlisteners: Array<() => void> = [];
  const xFormat = opts.xFormat ?? ((v: number) => `${v}`);
  const yFormat = opts.yFormat ?? ((v: number) => `${v}`);
  const markers = svgEl.querySelectorAll<SVGElement>(opts.selector);

  const place = (evt: PointerEvent): void => {
    if (!tip) return;
    const win = doc.defaultView!;
    placeCard(tip, evt, win.innerWidth, win.innerHeight);
  };

  markers.forEach((el, i) => {
    const p = opts.points[i];
    if (!p) return;
    el.style.cursor = "pointer";
    const show = (evt: PointerEvent): void => {
      if (!tip) return;
      tip.innerHTML = buildPointTooltipHtml(p, opts, xFormat, yFormat);
      card.show();
      place(evt);
    };
    unlisteners.push(listen(el, {
      pointerenter: show as EventListener,
      pointermove: place as EventListener,
      pointerleave: () => { if (tip) tip.style.opacity = "0"; },
    }));
  });
  // A scatter point reports no onResolve / onHover, so the card is the only thing to end.
  return () => {
    for (const off of unlisteners) off();
    card.release();
  };
}
