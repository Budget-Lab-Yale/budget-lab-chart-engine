// The live mount's lifecycle: what mountChart and mountFigure (render-live.ts) share across their
// redraws and teardown — the disposed contract, the hover detach handles, the svg(s) on screen,
// the legend pins carried over a rebuild, the width a redraw last committed, and the failed-draw
// cleanup. Type-only imports: this module adds no runtime edge to the engine graph.
import type { LegendFocus, LegendHandle, LegendPins, LegendState } from "../legend.js";
import type { BandHoverCtx, HoverDetach } from "../crosshair.js";

/** Fire `type`'s host callback (if any) then a bubbling CustomEvent of the same name from `card`,
 *  with the same `detail` — the `tbl-title-select` pattern (render-live.ts), generalised for `onHover` /
 *  `onRender` / `onLegendSelect`, each of which needs the identical callback-then-bubbling-event
 *  shape at more than one call site.
 *
 *  A disposed mount notifies nothing: `isDisposed` is read before the callback, and again between
 *  the callback and the event, since the callback itself may tear the mount down (the two are ONE
 *  notification). The single exception is `allowDisposed`, which only the teardown's own
 *  hover-ending null passes (hoverNotifierFor); it is delivered whole, callback and event. */
export function notify<T>(
  card: HTMLElement,
  type: string,
  detail: T,
  cb: ((detail: T) => void) | undefined,
  isDisposed: () => boolean,
  allowDisposed = false,
): void {
  const gate = allowDisposed ? () => false : isDisposed;
  if (gate()) return;
  cb?.(detail);
  if (gate()) return;
  card.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
}

/** The mount's `onHover` / `tbl-hover` notifier. Unchanged while the mount is live. Once it is
 *  disposed, the only thing it passes on is ONE null ending a hover the host was told about: the
 *  teardown's own. runHoverDetaches runs the detaches one at a time, so while the first sends that
 *  null a sibling pane's hover is still wired, and a hover the consumer starts there from inside
 *  the callback (and the null its own detach then sends) must not reach the host. */
function hoverNotifierFor(
  card: HTMLElement,
  onHover: ((ctx: BandHoverCtx | null) => void) | undefined,
  isDisposed: () => boolean,
): (ctx: BandHoverCtx | null) => void {
  let hostHovering = false;
  return (ctx) => {
    const teardownEnd = isDisposed() && ctx === null && hostHovering;
    if (isDisposed() && !teardownEnd) return;
    hostHovering = ctx !== null;
    notify(card, "tbl-hover", ctx, onHover, isDisposed, teardownEnd);
  };
}

/** Run, then forget, every hover detach handle a draw collected (crosshair.ts `HoverDetach`) — before
 *  each redraw and on teardown. A detach can reach a consumer's `onHover` (its `null`), and a throw
 *  there must not abort the redraw or teardown that called this: it is re-thrown on its own
 *  microtask, surfaced rather than swallowed, as the deferred "mount" onRender is. */
function runHoverDetaches(detaches: HoverDetach[]): void {
  for (const detach of detaches.splice(0)) {
    try {
      detach();
    } catch (e) {
      queueMicrotask(() => { throw e; });
    }
  }
}

/** What a redraw carries from the legend it is about to replace. Every draw() / drawGrid() rebuilds
 *  the legend from scratch, so without this a resize or a title-selector change silently unpinned
 *  everything (B5). */
export interface CarriedLegend {
  state: LegendState;
  focus: LegendFocus | null;
}
function carryLegend(handle: LegendHandle | null): CarriedLegend | null {
  return handle ? { state: handle.state(), focus: handle.focused() } : null;
}
/** Anything to re-apply: a pin or a hover in any dimension. */
function hasSelection({ pins, hovered }: LegendState): boolean {
  return pinCount(pins) > 0 || hovered.series != null || hovered.annotation != null || hovered.shape != null;
}
/** True when the rebuilt legend holds fewer pins than were carried into it: a pinned key the new
 *  render no longer has was dropped, and the host must be told. */
function pinsDropped(carried: CarriedLegend | null, handle: LegendHandle | null): boolean {
  if (!carried) return false;
  return pinCount(carried.state.pins) > (handle ? pinCount(handle.state().pins) : 0);
}
/** A failed draw's message, as text: it can carry a data cell or a host hook's words, and a
 *  non-Error throw has no `.message`. */
function drawErrorNode(doc: Document, e: unknown): HTMLElement {
  const el = doc.createElement("div");
  el.className = "figure-error";
  const message = (e as { message?: unknown } | null)?.message;
  el.textContent = typeof message === "string" ? message : String(e);
  return el;
}
function pinCount(p: LegendPins): number {
  return p.series.length + p.annotations.length + p.shapes.length;
}
/** Attach `later` as `err.cause` when that slot is free. Best-effort only: never let annotating an
 *  error replace the error itself. */
export function attachCause(err: unknown, later: unknown): void {
  if (typeof err !== "object" || err === null) return;
  try {
    const withCause = err as { cause?: unknown };
    if (withCause.cause === undefined) withCause.cause = later;
  } catch { /* frozen/exotic error object — the first error still surfaces */ }
}
/** The tail of every redraw that rebuilt a legend: fire onRender, then report a dropped pin, then
 *  hand keyboard focus back. A throwing onRender must not cost the host its drop notification, so its
 *  error is CARRIED past the other two steps and rethrown unwrapped, with a throw from the
 *  notification attached as its `.cause`. A host that tore the mount down from onRender gets
 *  neither of the other two; one that tore it down from the drop report gets no focus hand-back. */
function finishRedraw(
  fireRender: () => void,
  reportDrop: (() => void) | null,
  restoreFocus: () => void,
  isDisposed: () => boolean,
): void {
  let first: { e: unknown } | null = null;
  try {
    fireRender();
  } catch (e) {
    first = { e };
  }
  if (isDisposed()) {
    if (first) throw first.e;
    return;
  }
  if (reportDrop) {
    try {
      reportDrop();
    } catch (e) {
      if (first) attachCause(first.e, e);
      else first = { e };
    }
  }
  // The drop report reaches onLegendSelect, which may tear the mount down too.
  if (!isDisposed()) restoreFocus();
  if (first) throw first.e;
}

/** One live mount's lifecycle state, shared by mountChart (one svg; commit key = the chart width)
 *  and mountFigure (one svg per pane; commit key = the grid signature). It owns:
 *  - the disposed flag the returned teardown sets, which every notification and redraw step reads;
 *  - the hover detach handles of the current draw, run before each redraw and on teardown;
 *  - the svg(s) on screen, re-read by the deferred "mount" onRender;
 *  - the legend of the current draw, whose pins and focus the next draw carries;
 *  - the key of the last successful draw, invalidated by a failed one so any width retries.
 *  The mounts keep their own order of steps: each method here is one step they already took. */
export class LiveLifecycle<K> {
  private disposedFlag = false;
  private readonly detaches: HoverDetach[] = [];
  private svgs: Array<SVGSVGElement | undefined> = [];
  private legendHandle: LegendHandle | null = null;
  private committed: K | null = null;

  constructor(private readonly card: HTMLElement) {}

  /** For callbacks that read the state later (title selectors, `renderLegend`'s `abandoned`). */
  readonly isDisposed = (): boolean => this.disposedFlag;

  get disposed(): boolean {
    return this.disposedFlag;
  }

  /** The teardown's first step: nothing notifies after this except the hover-ending null the
   *  detaches send (hoverNotifierFor). */
  dispose(): void {
    this.disposedFlag = true;
    runHoverDetaches(this.detaches);
  }

  notify<T>(type: string, detail: T, cb: ((detail: T) => void) | undefined): void {
    notify(this.card, type, detail, cb, this.isDisposed);
  }

  hoverNotifier(onHover: ((ctx: BandHoverCtx | null) => void) | undefined): (ctx: BandHoverCtx | null) => void {
    return hoverNotifierFor(this.card, onHover, this.isDisposed);
  }

  addDetach(detach: HoverDetach): void {
    this.detaches.push(detach);
  }

  /** Before a redraw. A detach can end a hover and a consumer may tear down from that null, so the
   *  caller checks `disposed` straight after. */
  runDetaches(): void {
    runHoverDetaches(this.detaches);
  }

  /** The draw's key matches the last successful one: nothing to redraw. */
  isCommitted(key: K): boolean {
    return key === this.committed;
  }

  /** Record a successful draw's key. */
  commit(key: K): void {
    this.committed = key;
  }

  /** Force the next draw past `isCommitted` (a reselect, a restack, a failed draw). */
  invalidate(): void {
    this.committed = null;
  }

  /** The svg(s) now on screen, by pane index (mountChart: index 0). */
  setSvgs(svgs: Array<SVGSVGElement | undefined>): void {
    this.svgs = svgs;
  }

  /** The "mount" onRender for pane `index`, one microtask later: skipped if the mount was torn down
   *  or has no svg there by then, and handed the svg on screen THEN rather than the one this draw
   *  made (a reselect can land in the gap). See mountChart's dispatch comment. The callback is
   *  looked up THEN too (`getOnRender`), so a host that swaps or clears `opts.onRender` right after
   *  mounting is obeyed. */
  deferMountRender(
    index: number,
    getOnRender: () => ((ctx: { svg: SVGSVGElement; phase: "mount" }) => void) | undefined,
  ): void {
    queueMicrotask(() => {
      const live = this.svgs[index];
      if (this.disposedFlag || !live) return;
      this.notify("tbl-render", { svg: live, phase: "mount" as const }, getOnRender());
    });
  }

  /** A draw threw. Unless a hook tore the mount down, put the message in `host`, forget the svgs,
   *  take down the chrome that described the last good draw (`clearChrome`), and invalidate the
   *  commit. The legend handle is kept, so a recovered draw carries its pins. */
  failDraw(host: HTMLElement, e: unknown, clearChrome: () => void): void {
    if (this.disposedFlag) return;
    host.replaceChildren(drawErrorNode(host.ownerDocument, e));
    this.svgs = [];
    clearChrome();
    this.card.classList.remove("is-selectable");
    this.invalidate();
  }

  /** The current draw's legend (null without one, or before the first draw). */
  get legend(): LegendHandle | null {
    return this.legendHandle;
  }

  /** Read before the old legend leaves the DOM: focus falls to <body> once it does. */
  carryLegend(): CarriedLegend | null {
    return carryLegend(this.legendHandle);
  }

  /** Make `handle` the current legend; true when it dropped a pin `carried` held. */
  adoptLegend(handle: LegendHandle | null, carried: CarriedLegend | null): boolean {
    this.legendHandle = handle;
    return pinsDropped(carried, handle);
  }

  /** The carried state reached the new legend without its onHighlight: restyle the marks added
   *  since it was built and hand a non-empty active set to `setActive` (the pill drivers). Returns
   *  the active set, which a dropped pin reports. */
  reapplyCarried(
    carried: CarriedLegend | null,
    handle: LegendHandle | null,
    setActive: (active: Set<string>) => void,
  ): Set<string> {
    const carriedActive = handle?.active() ?? new Set<string>();
    if (carried && hasSelection(carried.state) && handle) handle.restyle();
    if (carriedActive.size) setActive(carriedActive);
    return carriedActive;
  }

  finishRedraw(fireRender: () => void, reportDrop: (() => void) | null, restoreFocus: () => void): void {
    finishRedraw(fireRender, reportDrop, restoreFocus, this.isDisposed);
  }
}
