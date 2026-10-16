// Live-DOM hit testing for mountChart / mountFigure: resolving the mark under a pointer through the
// crosshair's transparent overlay, the fat hit-paths for thin line strokes, and click-to-pin.
// Moved verbatim from render-live.ts.
import type { LegendHandle } from "../legend.js";
import { RUG_CLASS } from "../rug.js";
import { CROSSHAIR_HIT_SELECTOR } from "../hover-classes.js";

/**
 * Resolve the `data-series` of the chart mark under a click, hit-testing THROUGH the
 * transparent crosshair hit-overlay that sits on top of the bars/paths.
 *
 * The crosshair appends a full-SVG transparent rect with pointer-events:all, so the click
 * target is that overlay (no data-series). `elementsFromPoint` returns the element stack
 * top→bottom; we skip the overlay (and any other non-mark element) and return the first
 * element carrying a `data-series` attribute. Returns null if none is found.
 *
 * Guarded for jsdom: `elementsFromPoint` may be absent — feature-detect and no-op so SSR
 * and tests don't throw. (The toggle path itself is exercised directly in tests.)
 */
function resolveAttrAtPoint(
  svgEl: SVGSVGElement,
  evt: MouseEvent,
  attr: string,
  accept?: (el: Element) => boolean,
): string | null {
  const doc = svgEl.ownerDocument as Document & {
    elementsFromPoint?: (x: number, y: number) => Element[];
  };
  if (typeof doc.elementsFromPoint !== "function") return null;
  for (const el of doc.elementsFromPoint(evt.clientX, evt.clientY)) {
    const value = el.getAttribute?.(attr);
    if (value && (!accept || accept(el))) return value;
    if (el === svgEl) break; // don't search past the chart's own SVG
  }
  return null;
}

function resolveSeriesAtPoint(svgEl: SVGSVGElement, evt: MouseEvent): string | null {
  return resolveAttrAtPoint(svgEl, evt, "data-series");
}

/**
 * The annotation key of the RUG BLOCK under the cursor, or null. Hit-tests through the crosshair's
 * transparent overlay exactly like `resolveSeriesAtPoint`, then requires the hit to be inside the
 * rug strip.
 *
 * Deliberately scoped to the rug rather than to every `[data-annotation]` element. The in-frame
 * annotations — band rects and `shading` fills — are large regions sitting right where the reader
 * sweeps the crosshair to read values, so hovering them would dim the very line being read, on and
 * off, as the pointer crossed each region. The rug sits below the axis, its blocks are discrete, and
 * "what is this block?" is the question a reader actually has there — so it is the one place where
 * chart-to-legend hover helps rather than fights.
 */
export function resolveRugAnnotationAtPoint(svgEl: SVGSVGElement, evt: MouseEvent): string | null {
  return resolveAttrAtPoint(svgEl, evt, "data-annotation", (el) => !!el.closest?.(`g.${RUG_CLASS}`));
}

/** The y of the rug strip's top edge, or null when this chart has no strip. */
export function rugStripTop(svgEl: SVGSVGElement): number | null {
  const block = svgEl.querySelector(`g.${RUG_CLASS} rect`);
  if (!block) return null;
  const y = Number(block.getAttribute("y"));
  return Number.isFinite(y) ? y : null;
}

/**
 * Add transparent FAT "hit" paths for a LINE chart so clicking ON or NEAR a thin line
 * resolves that line's series. The visible lines are ~2px strokes that
 * `document.elementsFromPoint` almost never lands on; these clones are invisible but
 * carry a ~14px stroke with `pointer-events: stroke`, so the cursor is hit-tested
 * within ~7px of the line.
 *
 * Z-order: the crosshair appends its hover overlay LAST (pointer-events:all, topmost) so hover
 * works. We insert each hit-path BELOW that overlay (before the first `CROSSHAIR_HIT_SELECTOR`
 * match, so every family's overlay counts: a categorical-line pane's is `.tbl-catline-hit`, and a
 * list without it appended the hit-paths ABOVE it, where they took the pointer within ~7px of
 * every line and the overlay's pointerleave cleared the hover). The click handler resolves the series
 * via `elementsFromPoint` (the whole stack, not the event target), so it pierces the
 * transparent overlay and finds the fat hit-path's `data-series`. The hover (pointermove
 * on the overlay) is unaffected because the overlay stays on top.
 *
 * Each hit-path clones the visible path's `d` (geometry) and `data-series`. The clone is
 * inserted at the SVG root (just before the crosshair overlay), which is correct here
 * because this engine's Plot output bakes the margins into the path coordinates — the
 * `g[aria-label="line"]` group carries only a 0.5px crispness transform, so a root-level
 * clone lands within ~0.5px of the visible line (well inside the 14px hit stroke). No
 * in-function idempotency guard is needed: `draw()` rebuilds the SVG before each call, so
 * the hit-paths are always fresh.
 */
function addLineHitPaths(svgEl: SVGSVGElement): void {
  const NS = "http://www.w3.org/2000/svg";
  const overlay = svgEl.querySelector(CROSSHAIR_HIT_SELECTOR);
  // A per-series `method`/`column` overlay on a line chart lands in this same
  // `g[aria-label="line"]` namespace (marks/overlay.ts): Plot.line wraps it in its own
  // `g[aria-label="line"]`, nesting the mark's `g.tbl-overlay-line` INSIDE that — so the base
  // selector below would otherwise also pick up the overlay's path and give it a 14px invisible
  // hit zone spanning its full `domain: axis` fit. `closest` (rather than a CSS `:not()`) is used
  // because the class sits on that inner wrapper, not on the path or the aria-label element itself.
  const linePaths = Array.from(
    svgEl.querySelectorAll<SVGPathElement>('g[aria-label="line"] path[data-series]'),
  ).filter((p) => !p.closest(".tbl-overlay-line"));
  for (const path of linePaths) {
    const series = path.getAttribute("data-series");
    const d = path.getAttribute("d");
    if (!series || !d) continue;
    const hit = svgEl.ownerDocument.createElementNS(NS, "path");
    hit.classList.add("tbl-line-hitpath");
    hit.setAttribute("data-series", series);
    hit.setAttribute("d", d);
    hit.setAttribute("fill", "none");
    // A truncated value axis clips the visible line to the frame, but `d` still carries the
    // off-frame geometry — an unclipped root-level clone would leave a phantom hit zone over the
    // title/legend. Plot's frame clip is a userSpaceOnUse rect, so the same reference works here.
    const clipRef = path.closest("[clip-path]")?.getAttribute("clip-path");
    if (clipRef) hit.setAttribute("clip-path", clipRef);
    // Invisible but reliably hit-testable: pointer-events:stroke is geometry-based, but a
    // painted-with-zero-opacity stroke is the safest cross-browser choice (some engines treat
    // stroke="transparent" as non-painted). The 14px width gives a ~7px-each-side hit zone.
    hit.setAttribute("stroke", "#000");
    hit.setAttribute("stroke-opacity", "0");
    hit.setAttribute("stroke-width", "14");
    hit.setAttribute("stroke-linecap", "round");
    hit.setAttribute("stroke-linejoin", "round");
    hit.style.pointerEvents = "stroke";
    hit.style.cursor = "pointer";
    // Insert below the topmost crosshair overlay so the overlay keeps handling hover and
    // the click handler (elementsFromPoint, full stack) still pierces down to this path.
    if (overlay) {
      svgEl.insertBefore(hit, overlay);
    } else {
      svgEl.appendChild(hit);
    }
  }
}

/**
 * Two-way selection: clicking a mark PINS its series through the legend handle. Used by mountChart
 * and by every figure pane in wireFigureSvg; the two paths wired this separately and drifted (a
 * standalone categorical line got no hit-paths, histogram and dumbbell panes got no click at all).
 *
 * The hover overlay (`CROSSHAIR_HIT_SELECTOR`) is a transparent full-SVG rect on top of the marks,
 * so the click lands on it; `resolveSeriesAtPoint` hit-tests through it with `elementsFromPoint`.
 * The overlay sets its cursor inline, which beats the `.is-selectable` CSS rule, so it is
 * overridden to `pointer` here. `lineHitPaths`: add the fat hit-paths for thin line strokes.
 * Live DOM only; renderChart and the PNG export never call this. Records `svg` in
 * `CLICK_TO_PIN_SVGS`, which mountFigure reads to decide `.is-selectable`.
 */
export const CLICK_TO_PIN_SVGS = new WeakSet<SVGSVGElement>();
export function wireClickToPin(
  svg: SVGSVGElement,
  handle: LegendHandle,
  opts: { lineHitPaths: boolean },
): void {
  if (opts.lineHitPaths) addLineHitPaths(svg);
  svg.querySelectorAll<SVGElement>(CROSSHAIR_HIT_SELECTOR).forEach((el) => { el.style.cursor = "pointer"; });
  svg.addEventListener("click", (evt) => {
    const series = resolveSeriesAtPoint(svg, evt as MouseEvent);
    if (series) handle.toggle(series);
  });
  CLICK_TO_PIN_SVGS.add(svg);
}
