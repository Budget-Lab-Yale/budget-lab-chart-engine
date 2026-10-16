// Live-only axis chrome: the sticky y-axis label overlay and the HTML axis-title captions. The
// PNG export draws its own axis titles (embed/export-png.ts). Moved verbatim from render-live.ts.

export type OverlayEl = HTMLElement & { _ro?: ResizeObserver };

// Sticky y-axis: the SVG's y-tick labels scroll off-screen when the chart overflows
// horizontally. Hide them and recreate each as a floating span (with a semi-transparent
// pill) pinned at the left; the controller translateX's the overlay by scrollLeft so the
// labels stay put. The gridlines/zero baseline stay in the SVG (visible across the chart),
// so we get frozen-y-axis behavior without rebuilding any SVG primitive in HTML.
export function attachYAxisOverlay(canvasScroll: HTMLElement, svg: SVGSVGElement): OverlayEl | null {
  const textEls = Array.from(svg.querySelectorAll<SVGTextElement>("g.tbl-y-tick-label text"));
  if (!textEls.length) return null;

  const doc = canvasScroll.ownerDocument;
  const overlay = doc.createElement("div") as OverlayEl;
  overlay.className = "figure-y-axis-overlay";
  const pairs = textEls.map((textEl) => {
    const span = doc.createElement("span");
    span.textContent = textEl.textContent;
    overlay.appendChild(span);
    return { textEl, span };
  });
  textEls.forEach((el) => { el.style.visibility = "hidden"; });
  canvasScroll.appendChild(overlay);

  const reposition = (): void => {
    const svgRect = svg.getBoundingClientRect();
    const scrollRect = canvasScroll.getBoundingClientRect();
    if (!svgRect.height) return;
    overlay.style.height = `${svgRect.height}px`;
    for (const { textEl, span } of pairs) {
      const r = textEl.getBoundingClientRect();
      span.style.top = `${r.top - scrollRect.top}px`;
    }
  };
  reposition();
  // ResizeObserver keeps the spans aligned as fonts load / the box re-lays-out. Guard for
  // environments without it (e.g. jsdom): the one-time reposition above still runs.
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(reposition);
    ro.observe(svg);
    overlay._ro = ro;
  }
  return overlay;
}

/** X-axis title below the chart, sized to the visible viewport (sticky + centered in CSS). */
export function appendXAxisTitle(canvasScroll: HTMLElement, axisTitle: string | null): void {
  if (!axisTitle) return;
  const el = canvasScroll.ownerDocument.createElement("div");
  el.className = "figure-x-axis-title";
  el.textContent = axisTitle;
  canvasScroll.appendChild(el);
}

/** Append an axis-title caption (`cls`) to `parent` when `title` is set. Used for the y-axis
 *  caption (above the plot) and the figure-level x-axis title (below the grid). */
export function appendAxisTitleEl(parent: HTMLElement, doc: Document, cls: string, title: string | null): void {
  if (!title) return;
  const el = doc.createElement("div");
  el.className = cls;
  el.textContent = title;
  parent.appendChild(el);
}
