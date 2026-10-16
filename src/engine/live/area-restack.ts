// Area click-to-restack: pinned series move to the bottom of the stack. Moved from render-live.ts.
import { attachCause, type LiveLifecycle } from "./lifecycle.js";

/** Snapshot each area band's data-series → its current `d`, so a restack can morph from it. */
function captureAreaDs(svg: SVGSVGElement): Map<string, string> {
  const m = new Map<string, string>();
  svg.querySelectorAll('g[aria-label="area"] path[data-series]').forEach((p) => {
    const s = p.getAttribute("data-series");
    const d = p.getAttribute("d");
    if (s && d) m.set(s, d);
  });
  return m;
}

// Match the numbers in a path `d` string (handles decimals, signs, exponents).
const D_NUM_RE = /-?\d*\.?\d+(?:e-?\d+)?/g;

/** Brief restack morph: the stacked total is order-invariant, so only the band paths' geometry
 *  changes. We interpolate each band's `d` from its OLD to its NEW value over ~320ms (the two
 *  share an identical command structure — same x points — so the numbers line up), so the bands
 *  visibly slide into their new stack positions. Snaps if the structures don't match. Pure JS, so
 *  it works regardless of CSS `d`-transition support. */
function animateAreaRestack(svg: Element, oldDs: Map<string, string>): void {
  type Anim = { p: Element; newD: string; from: number[]; to: number[] };
  const anims: Anim[] = [];
  for (const p of svg.querySelectorAll('g[aria-label="area"] path[data-series]')) {
    const s = p.getAttribute("data-series");
    const newD = p.getAttribute("d");
    const oldD = s ? oldDs.get(s) : undefined;
    if (!s || !newD || !oldD || oldD === newD) continue;
    const from = oldD.match(D_NUM_RE)?.map(Number);
    const to = newD.match(D_NUM_RE)?.map(Number);
    if (!from || !to || from.length !== to.length) continue; // structure differs → leave at new (snap)
    p.setAttribute("d", oldD); // start at the old geometry
    anims.push({ p, newD, from, to });
  }
  if (!anims.length) return;
  const win = svg.ownerDocument?.defaultView;
  const raf = win?.requestAnimationFrame?.bind(win);
  if (!raf) {
    for (const a of anims) a.p.setAttribute("d", a.newD); // no rAF (SSR) → just apply the new geometry
    return;
  }
  const DUR = 320;
  const ease = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);
  let start = -1;
  const step = (now: number): void => {
    if (start < 0) start = now;
    const t = Math.min(1, (now - start) / DUR);
    const e = ease(t);
    for (const a of anims) {
      if (t >= 1) {
        a.p.setAttribute("d", a.newD);
        continue;
      }
      let k = 0;
      a.p.setAttribute(
        "d",
        a.newD.replace(D_NUM_RE, () => {
          const v = a.from[k]! + (a.to[k]! - a.from[k]!) * e;
          k++;
          return v.toFixed(2);
        }),
      );
    }
    if (t < 1) raf(step);
  };
  raf(step);
}

/** An area chart's click-to-restack state, owned by mountChart for the mount's life. */
export interface RestackController {
  /** The live visual stack order (pinned series first, in click order), or undefined for the
   *  spec's own order. draw() passes it to renderChart as `stackOrder`. */
  readonly order: string[] | undefined;
  /** The full series list of the latest successful draw, in its default order. */
  setSeries(names: string[]): void;
  /** Called from a draw's legend onHighlight on an area chart. When the pins changed the stack
   *  order, re-renders through `redraw` (draw() in phase "restack") and morphs the bands from
   *  `svg`, the svg of the draw whose legend fired. Throws what `redraw` threw, after reporting
   *  `active` to onLegendSelect. A consumer may tear the mount down inside `redraw`, so the caller
   *  checks `life.disposed` on return. */
  update(active: Set<string>, svg: SVGSVGElement, redraw: () => void): void;
}

export function createRestackController(deps: {
  life: LiveLifecycle<number>;
  canvas: HTMLElement;
  /** Read when the error path notifies, not at creation: a host may swap or clear the callback
   *  on its MountOptions after mounting, and every other notify site reads it live. */
  getOnLegendSelect: () => ((ctx: { active: string[] }) => void) | undefined;
}): RestackController {
  const { life, canvas } = deps;
  // Area click-to-restack: the live visual stack order (selected series to the bottom, in click
  // order), the full series list, and a re-entrancy guard so re-applying pins after a rebuild
  // doesn't recurse (the latest legend handle is `life.legend`). Non-area charts never touch any of
  // this.
  let restackOrder: string[] | undefined;
  let suppressRestack = false;
  let currentSeriesNames: string[] = [];
  return {
    get order() {
      return restackOrder;
    },
    setSeries(names) {
      currentSeriesNames = names;
    },
    update(active, svg, redraw) {
      if (!suppressRestack) {
        const pins = life.legend?.pinnedSeries() ?? [];
        const next = pins.length
          ? [...pins, ...currentSeriesNames.filter((s) => !pins.includes(s))]
          : undefined;
        if (JSON.stringify(next) !== JSON.stringify(restackOrder)) {
          // Capture the current bands' geometry so the re-rendered ones can morph from it.
          const oldDs = captureAreaDs(svg);
          restackOrder = next;
          suppressRestack = true;
          life.invalidate(); // force draw() past its same-width early return
          // A stuck `suppressRestack` silently disables every future restack on this mount — a
          // permanent break, worse than any throw it could come from — so it is reset in a
          // `finally`. It stays true for the whole draw() on purpose: draw() carries the pins onto
          // the fresh legend and may hand keyboard focus back to it, and the focus handler re-enters
          // onHighlight, where the restack branch must skip rather than recurse.
          //
          // A throwing onRender (it fires at the tail of draw's "restack" branch, after the legend
          // is rebuilt and the pins carried) must not cost the host its onLegendSelect for this pin.
          // So the render error is CARRIED: the notification below still runs, and then the render
          // error surfaces, unwrapped and identical to what the consumer threw (so `instanceof` and
          // `.message` still hold at the catch site), with a throw from the notification attached as
          // its `.cause` when that slot is free. Nothing is swallowed.
          let renderError: { e: unknown } | null = null;
          try {
            redraw();
          } catch (e) {
            renderError = { e };
          } finally {
            suppressRestack = false;
          }
          if (renderError) {
            if (!life.disposed) {
              try {
                life.notify("tbl-legend-select", { active: [...active] }, deps.getOnLegendSelect());
              } catch (later) {
                attachCause(renderError.e, later);
              }
            }
            throw renderError.e;
          }
          // A consumer may have torn the mount down from that draw's onRender.
          if (life.disposed) return;
          // Brief morph: the stacked total is order-invariant, so only the band paths' `d` change.
          // Unreachable when draw() threw — the error above propagates past this point.
          const newSvg = canvas.querySelector("svg");
          if (newSvg) animateAreaRestack(newSvg, oldDs);
        }
      }
    },
  };
}
