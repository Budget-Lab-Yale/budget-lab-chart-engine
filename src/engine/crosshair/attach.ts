// The pieces every hover attach function shares: its detach handle, its listener wiring, the hit
// rect it listens on, the card placement, and the default value format.
import type { CROSSHAIR_HIT_CLASSES } from "../hover-classes";

/** What every hover attach returns (treemap-hover's too): undo the attachment. It removes the
 *  attachment's listeners, hides the shared card only if this attachment is the one showing it, and
 *  ends a hover in progress (`onResolve(null)`, and `onHover(null)` where wired) so a consumer
 *  learns the hover is over. The card lives outside the svg, so a redraw or unmount under a still
 *  pointer would otherwise strand it: the hit rect's pointerleave never fires once its svg is gone.
 *  render-live calls every handle before each redraw and on teardown. */
export type HoverDetach = () => void;

export const NO_DETACH: HoverDetach = () => {};

/** Add each listener to `target`; returns the function that removes them again. */
export function listen(target: EventTarget, listeners: Record<string, EventListener>): () => void {
  for (const [type, fn] of Object.entries(listeners)) target.addEventListener(type, fn);
  return () => {
    for (const [type, fn] of Object.entries(listeners)) target.removeEventListener(type, fn);
  };
}

/** The detach of a pointer-tracking hover attach (crosshair, band, histogram, categorical line):
 *  `stop` its listeners (and mark it detached, where it keeps that flag), then end a hover in
 *  progress (`hide(true)` releases the card and reports the end) or, with none, only release the
 *  card. */
export function pointerHoverDetach(
  stop: () => void,
  isActive: () => boolean,
  hide: (detaching: boolean) => void,
  card: { release: () => void },
): HoverDetach {
  return () => {
    stop();
    if (isActive()) hide(true);
    else card.release();
  };
}

/** Position the floating card beside the pointer: `offset` (14px) below and right of it, flipped to
 *  the pointer's other side on an axis where it would cross the viewport's `vw` × `vh`, then kept at
 *  least 4px inside the viewport's top-left. Reads the card's size, so call it after the card's
 *  content is set and it is shown. */
export function placeCard(tip: HTMLElement, evt: PointerEvent, vw: number, vh: number): void {
  const offset = 14;
  let left = evt.clientX + offset;
  let top = evt.clientY + offset;
  if (left + tip.offsetWidth + 4 > vw) left = evt.clientX - tip.offsetWidth - offset;
  if (top + tip.offsetHeight + 4 > vh) top = evt.clientY - tip.offsetHeight - offset;
  tip.style.left = `${Math.max(4, left)}px`;
  tip.style.top = `${Math.max(4, top)}px`;
}

/** The value format when the caller passes no `yFormat`: at most two decimals, in the HOST locale —
 *  hover text is DOM that is never rasterised; see util.ts on why that differs from rendered text. */
export const defaultYFormat = (v: number): string =>
  `${(+v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/** Append the transparent full-SVG rect a pointer-tracking attach listens on. Its class is typed to
 *  hover-classes.ts's list, and test/hover-classes-sync.test.ts checks the other direction. The
 *  caller sets `pointer-events` just before it adds the listeners. */
export function appendHitRect(
  svgEl: SVGSVGElement,
  cls: (typeof CROSSHAIR_HIT_CLASSES)[number],
  W: number,
  H: number,
  cursor: "crosshair" | "default",
): SVGRectElement {
  const hit = svgEl.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "rect");
  hit.classList.add(cls);
  hit.setAttribute("x", "0");
  hit.setAttribute("y", "0");
  hit.setAttribute("width", String(W));
  hit.setAttribute("height", String(H));
  hit.setAttribute("fill", "transparent");
  hit.style.cursor = cursor;
  svgEl.appendChild(hit);
  return hit;
}
