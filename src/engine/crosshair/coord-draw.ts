// Coordinated-cursor (echo) drawing helpers, split out of crosshair.ts: the `.tbl-coord` group and
// the guide / region / dot / pill / axis-label marks drawn into it, plus the category-label accent.
import { TBL } from "../theme";
import { categoryText } from "../../spec/section-key";
import { symbolPathD } from "../symbols";
import { wrapBandLabel } from "../axes";
import { findAxisLabelBox } from "./dom-geometry";

// ---------------------------------------------------------------------------
// Coordinated cursor — small-multiples cross-pane echo
// ---------------------------------------------------------------------------
// When the user hovers a pane, the live layer broadcasts the resolved x (a numeric x for line
// panes, a category key for band panes) to EVERY pane (including the hovered one), which renders
// a coordinated cursor. There is no floating tooltip: each pane shows compact in-place value
// labels, each on a frosted-glass pill for legibility (mirrors the tooltip surface). The hovered
// ("active") pane is distinguished by heavier label weight + the current x-axis value shown above
// the plot. Lines draw a guide + per-series dot; bars draw a shaded band region with value labels
// ABOVE each bar (centered); stacked draws the region with a label WITHIN each segment. Drivers
// attach NO pointer handlers — they are driven externally by `driver(key|null, active)`. They read
// the pane's y-scale via Plot's svg.scale("y"); without layout (jsdom) the value placement no-ops
// but the guide/region still render (browser carries pixel correctness).


export const COORD_NS = "http://www.w3.org/2000/svg";
/** Dark text for value labels on bars/stacked + the active x-axis value (matches bar value labels). */
export const COORD_LABEL_DARK = "#1A1A2E";

/** Bold + darken one category's axis label at a time, restoring the last one on the next call. The
 *  label is found by the `data-category` hook the tagging pass stamps (axes.ts CAT_LABEL_CLASS), not
 *  by text, so a category that reads like a tick label cannot be confused with it. Weight/colour
 *  only — the shaded row is the emphasis. One per attachment, so each tracks its own label. */
export function labelAccenter(svgEl: SVGSVGElement): { accent: (category: string) => void; restore: () => void } {
  const labelEls = new Map<string, SVGTextElement>();
  for (const t of Array.from(svgEl.querySelectorAll<SVGTextElement>("text[data-category]"))) {
    const cat = t.getAttribute("data-category");
    if (cat) labelEls.set(cat, t);
  }
  let accented: SVGTextElement | null = null;
  const restore = (): void => {
    if (!accented) return;
    accented.setAttribute("font-weight", "500");
    accented.setAttribute("fill", TBL.color.axis);
    accented = null;
  };
  return {
    accent: (category) => {
      restore();
      const el = labelEls.get(category);
      if (!el) return;
      el.setAttribute("font-weight", "700");
      el.setAttribute("fill", COORD_LABEL_DARK);
      accented = el;
    },
    restore,
  };
}

/** Net-total pill text: true black, matching the net dot's black stroke (Style-Guide mark-black). */
export const TOTAL_PILL_COLOR = "#000000";

/**
 * Append a hollow highlight marker (white fill, series-color ring) to the coord group. When a
 * `symbol` is given (the series' marker shape), the highlight takes that shape so it matches the
 * static point marker it sits over; otherwise a circle. Sized a touch larger than the static
 * marker so it reads as a highlight ring.
 */
export function addCoordDot(g: SVGGElement, doc: Document, cx: number, cy: number, color: string, symbol?: string): void {
  if (symbol && symbol !== "circle") {
    const p = doc.createElementNS(COORD_NS, "path");
    p.classList.add("tbl-coord-dot");
    // Area ~42 (≈ radius 3.7) — just larger than the static marker (~34) so it reads as a ring.
    p.setAttribute("d", symbolPathD(symbol, 42));
    p.setAttribute("transform", `translate(${cx},${cy})`);
    p.setAttribute("fill", "#ffffff");
    p.setAttribute("stroke", color);
    p.setAttribute("stroke-width", "1.5");
    g.appendChild(p);
    return;
  }
  const dot = doc.createElementNS(COORD_NS, "circle");
  dot.classList.add("tbl-coord-dot");
  dot.setAttribute("cx", String(cx));
  dot.setAttribute("cy", String(cy));
  dot.setAttribute("r", "3.6");
  dot.setAttribute("fill", "#ffffff");
  dot.setAttribute("stroke", color);
  dot.setAttribute("stroke-width", "1.5");
  g.appendChild(dot);
}

/**
 * Append a value label on a frosted-glass pill (rounded translucent-white rect + faint border,
 * mirroring the tooltip surface — SVG can't blur a backdrop, so a high-opacity white panel stands
 * in). Anchored "start" | "middle" | "end" about (cx,cy). Width is estimated from the text length
 * (no getBBox, so it is deterministic and works without layout). The pill is inserted before the
 * text so it sits behind.
 */
export function addCoordPill(
  g: SVGGElement,
  doc: Document,
  cx: number,
  cy: number,
  anchor: "start" | "middle" | "end" | "pill-end" | "pill-start",
  text: string,
  color: string,
  weight: number,
): void {
  const fontSize = 10.5;
  const padX = 4;
  const padY = 2.5;
  const w = text.length * fontSize * 0.62 + padX * 2;
  const h = fontSize + padY * 2;
  // "pill-end"/"pill-start" position the rect by its inner EDGE at cx (right edge / left edge)
  // and CENTER the text within it — used to lay two pills side by side around a center line
  // without the edge-anchored text looking unbalanced. Plain start/middle/end keep the legacy
  // behavior (text anchored about cx).
  const x0 =
    anchor === "pill-end" ? cx - w
    : anchor === "pill-start" ? cx
    : anchor === "start" ? cx - padX
    : anchor === "end" ? cx - w + padX
    : cx - w / 2;
  // Text x: centered in the rect for the pill-edge modes; otherwise anchored about cx.
  const textCx = anchor === "pill-end" || anchor === "pill-start" ? x0 + w / 2 : cx;
  const textAnchor = anchor === "pill-end" || anchor === "pill-start" ? "middle" : anchor;
  const rect = doc.createElementNS(COORD_NS, "rect");
  // Named so a consumer stylesheet can select this capsule without depending on rx="3" (issue
  // #30) — it shares that attribute with addCoordAxisLabel's echo box below, which is otherwise
  // indistinguishable from this one by any presentation attribute.
  rect.classList.add("tbl-coord-pill");
  rect.setAttribute("x", String(x0));
  rect.setAttribute("y", String(cy - h / 2));
  rect.setAttribute("width", String(w));
  rect.setAttribute("height", String(h));
  rect.setAttribute("rx", "3");
  rect.setAttribute("fill", "#ffffff");
  rect.setAttribute("fill-opacity", "0.82");
  rect.setAttribute("stroke", "#c8cdd7");
  rect.setAttribute("stroke-opacity", "0.7");
  g.appendChild(rect);
  const t = doc.createElementNS(COORD_NS, "text");
  t.classList.add("tbl-coord-pill-text");
  t.setAttribute("x", String(textCx));
  t.setAttribute("y", String(cy));
  t.setAttribute("dy", "0.32em");
  t.setAttribute("text-anchor", textAnchor);
  t.setAttribute("fill", color);
  t.setAttribute("font-size", String(fontSize));
  t.setAttribute("font-weight", String(weight));
  t.textContent = text;
  g.appendChild(t);
}

/** Pill label height (text + vertical padding) — the minimum vertical gap between stacked pills. */
export const COORD_PILL_H = 16;

/** Create the (re-attachable) coordinated-cursor group on an SVG. */
export function makeCoordGroup(svgEl: SVGSVGElement): SVGGElement {
  svgEl.querySelectorAll(".tbl-coord").forEach((el) => el.remove());
  const g = svgEl.ownerDocument.createElementNS(COORD_NS, "g");
  g.classList.add("tbl-coord");
  g.setAttribute("opacity", "0");
  g.style.pointerEvents = "none";
  svgEl.appendChild(g);
  return g;
}

/** Draw the thin muted vertical guide line (line panes) into the coord group. */
export function addCoordGuide(g: SVGGElement, doc: Document, x: number, yTop: number, yBot: number): void {
  const guide = doc.createElementNS(COORD_NS, "line");
  guide.classList.add("tbl-coord-guide");
  guide.setAttribute("x1", String(x));
  guide.setAttribute("x2", String(x));
  guide.setAttribute("y1", String(yTop));
  guide.setAttribute("y2", String(yBot));
  guide.setAttribute("stroke", TBL.color.annotationDim);
  guide.setAttribute("stroke-width", "1");
  guide.setAttribute("stroke-dasharray", "2 3");
  guide.setAttribute("stroke-opacity", "0.55");
  g.appendChild(guide);
}

/** Draw the shaded band region (bar/stacked panes) into the coord group. */
export function addCoordRegion(g: SVGGElement, doc: Document, x: number, w: number, yTop: number, h: number): void {
  const r = doc.createElementNS(COORD_NS, "rect");
  r.classList.add("tbl-coord-region");
  r.setAttribute("x", String(x));
  r.setAttribute("y", String(yTop));
  r.setAttribute("width", String(Math.max(0, w)));
  r.setAttribute("height", String(Math.max(0, h)));
  r.setAttribute("fill", TBL.color.annotationDim);
  r.setAttribute("opacity", "0.12");
  g.appendChild(r);
}

/**
 * Draw the active pane's highlighted x value as text on a frosted pill, one line per axis row so
 * the line breaks match the axis (e.g. month on the first row, year on the second). Centered on
 * `cx`; bold + dark so it reads as the highlighted axis label. Returns the pill's box in SVG user
 * coords (null when there was nothing to draw) — the caller needs it to tell which tick labels the
 * pill has landed on top of; see `hideAxisLabelsUnder`.
 */
export function addCoordAxisLabel(
  g: SVGGElement,
  doc: Document,
  cx: number,
  lines: Array<{ text: string; cy: number }>,
): { left: number; right: number; top: number; bot: number } | null {
  if (!lines.length) return null;
  const fontSize = 10.5;
  const padX = 4;
  const padY = 2;
  const w = Math.max(...lines.map((l) => l.text.length)) * fontSize * 0.62 + padX * 2;
  const top = Math.min(...lines.map((l) => l.cy)) - fontSize / 2 - padY;
  const bot = Math.max(...lines.map((l) => l.cy)) + fontSize / 2 + padY;
  const rect = doc.createElementNS(COORD_NS, "rect");
  // See addCoordPill's identical note: this echo box needs its own class for the same reason.
  rect.classList.add("tbl-coord-axis-label");
  rect.setAttribute("x", String(cx - w / 2));
  rect.setAttribute("y", String(top));
  rect.setAttribute("width", String(w));
  rect.setAttribute("height", String(bot - top));
  rect.setAttribute("rx", "3");
  rect.setAttribute("fill", "#ffffff");
  rect.setAttribute("fill-opacity", "0.82");
  rect.setAttribute("stroke", "#c8cdd7");
  rect.setAttribute("stroke-opacity", "0.7");
  g.appendChild(rect);
  for (const l of lines) {
    const t = doc.createElementNS(COORD_NS, "text");
    t.classList.add("tbl-coord-axis-label-text");
    t.setAttribute("x", String(cx));
    t.setAttribute("y", String(l.cy));
    t.setAttribute("dy", "0.32em");
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("fill", COORD_LABEL_DARK);
    t.setAttribute("font-size", String(fontSize));
    t.setAttribute("font-weight", "700");
    t.textContent = l.text;
    g.appendChild(t);
  }
  return { left: cx - w / 2, right: cx + w / 2, top, bot };
}

/** Draw the active-pane current-category highlight so it matches the axis labels' layout AND
 *  position: it locates the actual rendered axis label for the category and overlays it (single
 *  line / wrapped two lines / rotated 45° about the label's center). Falls back to the row-cluster
 *  y when the label can't be located (e.g. no layout). */
export function addCoordCategoryHighlight(
  g: SVGGElement,
  doc: Document,
  svgEl: SVGSVGElement,
  plotBottom: number,
  cx: number,
  key: string,
  mode: "single" | "wrap" | "rotate",
  axisRows: number[],
): void {
  // The echo reads, and finds its axis label by, the display text (spec/section-key.ts).
  const category = categoryText(key);
  const box = findAxisLabelBox(svgEl, plotBottom, category);
  const anchorX = box?.cx ?? cx;
  const anchorY = box?.cy ?? axisRows[0];
  if (anchorY == null) return;

  if (mode === "rotate") {
    // Tilt the whole pill+label 45° about the label's center, mirroring the rotated axis label.
    const sub = doc.createElementNS(COORD_NS, "g");
    sub.setAttribute("transform", `rotate(-45 ${anchorX} ${anchorY})`);
    addCoordAxisLabel(sub, doc, anchorX, [{ text: category, cy: anchorY }]);
    g.appendChild(sub);
    return;
  }
  if (mode === "wrap") {
    const lines = wrapBandLabel(category).split("\n");
    if (lines.length > 1) {
      // Place the two highlight lines at the two tspan centers (¼ and ¾ of the label box) so it
      // sits exactly over the wrapped axis label.
      const top = box?.top ?? anchorY - 6.5;
      const h = box ? box.bot - box.top : 13;
      addCoordAxisLabel(g, doc, anchorX, [
        { text: lines[0]!, cy: top + h * 0.25 },
        { text: lines.slice(1).join(" "), cy: top + h * 0.75 },
      ]);
      return;
    }
  }
  addCoordAxisLabel(g, doc, anchorX, [{ text: category, cy: anchorY }]);
}

/** Estimated pill width for a value label (matches addCoordPill's sizing). */
export function coordPillWidth(text: string): number {
  return text.length * 10.5 * 0.62 + 8;
}
