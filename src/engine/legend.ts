// Legend with hover-to-dim + click-to-pin. A live-layer (DOM) primitive: the engine's
// pure path produces the SVG + legend metadata (engine/index.ts); this renders the
// interactive legend against that SVG. Paths are matched by their `data-series` attr,
// which assemblePlot tags post-render.
import type { LegendItem } from "./index";
import { symbolPathD } from "./symbols";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Build a line+symbol legend swatch (an inline SVG): a short colored line with the series'
 *  marker centered on it, so series can be identified by shape as well as color. */
function buildSymbolSwatch(
  doc: Document,
  color: string | undefined,
  dashed: boolean,
  symbol: string,
): SVGSVGElement {
  const stroke = color || "currentColor";
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "12");
  svg.setAttribute("viewBox", "0 0 22 12");
  const line = doc.createElementNS(SVG_NS, "line");
  line.setAttribute("x1", "1");
  line.setAttribute("x2", "21");
  line.setAttribute("y1", "6");
  line.setAttribute("y2", "6");
  line.setAttribute("stroke", stroke);
  line.setAttribute("stroke-width", "2");
  if (dashed) line.setAttribute("stroke-dasharray", "4 2");
  svg.appendChild(line);
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", symbolPathD(symbol, 32));
  path.setAttribute("transform", "translate(11,6)");
  path.setAttribute("fill", stroke);
  path.setAttribute("stroke", "#ffffff");
  path.setAttribute("stroke-width", "0.75");
  svg.appendChild(path);
  return svg;
}

/** Build a point-marker legend swatch (an inline SVG): just the filled symbol, no line. Used
 *  for point charts — colored by series in the color legend, neutral gray in the shape legend. */
function buildPointSwatch(doc: Document, color: string, symbol: string): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 18 16");
  const path = doc.createElementNS(SVG_NS, "path");
  // Larger marker (was ~8px → ~12px) for legibility. Centered at x=9; nudged up to y=7 (box
  // center is 8) so it sits on the text's optical (cap-height) center rather than the line-box
  // center, which reads as slightly low for a small marker beside 12px text.
  path.setAttribute("d", symbolPathD(symbol, 100));
  path.setAttribute("transform", "translate(9,7)");
  path.setAttribute("fill", color);
  path.setAttribute("stroke", "#ffffff");
  path.setAttribute("stroke-width", "1");
  svg.appendChild(path);
  return svg;
}

/** Neutral gray used for the shape-legend markers (shape conveys the shape-channel value, not a
 *  color — so its swatches are uncolored). */
const SHAPE_LEGEND_COLOR = "#555B66";

/** One shape-legend row (point charts, dual encoding). */
export interface ShapeLegendEntry {
  /** The raw shape-value key — matches markers' data-shape so the row can drive hover-dim/pin. */
  shape: string;
  label: string;
  markerSymbol: string;
}

/** Handle returned by renderLegend: the rendered element plus a `toggle(series)` that
 *  flips the SAME pin state a legend-button click would, keeping ONE source of truth
 *  (the internal `pinned` Set) so the chart can act as a second selection input. */
export interface LegendHandle {
  element: HTMLElement;
  /** Toggle a series' pinned state (no-op for an unknown/non-interactive series). */
  toggle(series: string): void;
}

export function renderLegend(
  parent: HTMLElement,
  items: LegendItem[],
  // `svg` is the highlight ROOT queried for `[data-series]` on dim — an SVG for a single
  // chart, or a container (e.g. the figure grid) so dimming spans every pane's SVG.
  //
  // Point charts with DUAL color/shape encoding pass `shapeItems` (+ optional group titles) to
  // render a second, non-interactive SHAPE legend group beside the color legend.
  {
    svg,
    onHighlight,
    shapeItems,
    colorTitle,
    shapeTitle,
  }: {
    svg?: Element;
    onHighlight?: () => void;
    shapeItems?: ShapeLegendEntry[] | null;
    colorTitle?: string;
    shapeTitle?: string;
  } = {},
): LegendHandle | null {
  const hasColor = !!items?.length;
  const hasShape = !!shapeItems?.length;
  if (!hasColor && !hasShape) return null;

  const doc = parent.ownerDocument;
  const legend = doc.createElement("div");
  legend.className = "tbl-legend";

  // Two-group layout: a color group + a shape group, each an inline cluster with an optional
  // heading. Single-group (the common case) appends items directly to the legend, unchanged.
  const twoGroup = hasShape;
  // Two-group (color + shape) point legend stacks the groups on separate lines.
  if (twoGroup) legend.classList.add("tbl-legend--grouped");
  let colorContainer: HTMLElement = legend;
  let shapeGroup: HTMLElement | null = null;
  if (twoGroup) {
    if (hasColor) {
      colorContainer = doc.createElement("div");
      colorContainer.className = "tbl-legend-group";
      if (colorTitle) {
        const h = doc.createElement("span");
        h.className = "tbl-legend-group-title";
        h.textContent = colorTitle;
        colorContainer.appendChild(h);
      }
    }
    shapeGroup = doc.createElement("div");
    shapeGroup.className = "tbl-legend-group";
    if (shapeTitle) {
      const h = doc.createElement("span");
      h.className = "tbl-legend-group-title";
      h.textContent = shapeTitle;
      shapeGroup.appendChild(h);
    }
  }

  const safeItems = items ?? [];
  const safeShapeItems = shapeItems ?? [];
  // Two independent selection dimensions: COLOR (series) and SHAPE. Point charts with dual
  // encoding use both; every other chart uses only color (shape sets stay empty → no-op).
  const allSeries = safeItems.filter((i) => !i.nonInteractive).map((i) => i.series);
  const allShapes = safeShapeItems.map((i) => i.shape);
  const pinned = new Set<string>();
  let hovered: string | null = null;
  const pinnedShape = new Set<string>();
  let hoveredShape: string | null = null;

  // Circular reset button — declared up front (applyHighlight toggles its visibility) but
  // appended at the END of the legend so it sits after the last item. Hidden until pinned,
  // so toggling it in on the first pin does not shift the data-series rows above it.
  const resetBtn = doc.createElement("button");

  const applyHighlight = (): void => {
    const active = new Set(pinned);
    if (hovered) active.add(hovered);
    const activeShape = new Set(pinnedShape);
    if (hoveredShape) activeShape.add(hoveredShape);
    // Dim a dimension only when a strict subset of it is active (not everything, not nothing).
    const dimColor = active.size > 0 && active.size < allSeries.length;
    const dimShape = activeShape.size > 0 && activeShape.size < allShapes.length;
    if (svg) {
      // A marker stays bright only if it matches the active selection in BOTH dimensions
      // (intersection). Line/bar marks carry only data-series → the shape test is a no-op.
      svg.querySelectorAll("[data-series]").forEach((p) => {
        const s = p.getAttribute("data-series");
        const sh = p.getAttribute("data-shape");
        const colorOk = !dimColor || active.has(s as string);
        const shapeOk = !dimShape || (sh != null && activeShape.has(sh));
        p.classList.toggle("tbl-dimmed", !(colorOk && shapeOk));
      });
    }
    legend.querySelectorAll<HTMLElement>(".tbl-legend-item").forEach((btn) => {
      if (btn.dataset.shape != null) {
        const sh = btn.dataset.shape;
        btn.classList.toggle("is-pinned", pinnedShape.has(sh));
        btn.setAttribute("aria-pressed", String(pinnedShape.has(sh)));
      } else {
        const s = btn.dataset.series as string;
        btn.classList.toggle("is-pinned", pinned.has(s));
        btn.setAttribute("aria-pressed", String(pinned.has(s)));
      }
    });
    resetBtn.hidden = pinned.size === 0 && pinnedShape.size === 0;
    // Notify after the dim classes are toggled so the callback reads the fresh dim state
    // (e.g. recoloring net-total labels by the behind-segment's dim class). Runs on every
    // highlight change — pin, hover, focus, blur, and reset.
    onHighlight?.();
  };

  // Shared pin toggle — the single source of truth for both legend-button clicks and
  // chart clicks (via the returned handle). Unknown / non-interactive series are a no-op.
  const togglePin = (series: string): void => {
    if (!allSeries.includes(series)) return;
    if (pinned.has(series)) pinned.delete(series);
    else pinned.add(series);
    applyHighlight();
  };
  const togglePinShape = (shape: string): void => {
    if (!allShapes.includes(shape)) return;
    if (pinnedShape.has(shape)) pinnedShape.delete(shape);
    else pinnedShape.add(shape);
    applyHighlight();
  };

  for (const { series, label: displayLabel, color, dashed = false, markerShape, markerSymbol, nonInteractive } of safeItems) {
    // Non-interactive rows (e.g. Total) are plain spans — they don't participate in
    // hover-dim / click-to-pin and carry no data-series attribute.
    const btn: HTMLElement = nonInteractive
      ? doc.createElement("span")
      : doc.createElement("button");
    if (!nonInteractive) {
      (btn as HTMLButtonElement).type = "button";
      btn.dataset.series = series; // data key — matches path[data-series]
      btn.setAttribute("aria-pressed", "false");
    }
    btn.className = "tbl-legend-item";
    // Series color exposed as a custom property so the pinned-state underline can
    // color-match the corresponding line.
    if (color) btn.style.setProperty("--legend-color", color);

    const swatch = doc.createElement("span");
    swatch.className = "tbl-legend-swatch";
    if (markerShape === "rect") {
      swatch.classList.add("is-rect");
      if (color) swatch.style.background = color;
    } else if (markerShape === "point") {
      // Point chart: a filled colored marker (no line). The symbol is the series' shape in the
      // redundant (combined) case, else a plain circle (shape lives in the shape legend).
      swatch.classList.add("is-point");
      swatch.appendChild(buildPointSwatch(doc, color || SHAPE_LEGEND_COLOR, markerSymbol || "circle"));
    } else if (markerShape === "dot") {
      swatch.classList.add("is-dot");
      // White fill + black stroke via CSS — no inline color needed.
    } else if (markerSymbol) {
      // Line chart with point markers: line + the series' marker symbol (shape conveys identity
      // alongside color). An inline SVG, sized via the .is-symbol class.
      swatch.classList.add("is-symbol");
      swatch.appendChild(buildSymbolSwatch(doc, color, dashed, markerSymbol));
    } else {
      // "line" — existing behavior preserved.
      if (dashed) {
        swatch.classList.add("is-dashed");
        if (color) swatch.style.setProperty("--swatch-color", color);
      } else if (color) {
        swatch.style.background = color;
      }
    }

    const labelEl = doc.createElement("span");
    labelEl.textContent = displayLabel ?? series;

    btn.appendChild(swatch);
    btn.appendChild(labelEl);

    if (!nonInteractive) {
      btn.addEventListener("pointerenter", () => { hovered = series; applyHighlight(); });
      btn.addEventListener("pointerleave", () => { hovered = null; applyHighlight(); });
      btn.addEventListener("focus", () => { hovered = series; applyHighlight(); });
      btn.addEventListener("blur", () => { hovered = null; applyHighlight(); });
      btn.addEventListener("click", () => { togglePin(series); });
    }

    colorContainer.appendChild(btn);
  }

  resetBtn.type = "button";
  resetBtn.className = "tbl-legend-reset";
  resetBtn.setAttribute("aria-label", "Clear pinned highlights");
  resetBtn.innerHTML = '<span class="tbl-legend-reset-icon">⟲</span>';
  resetBtn.hidden = true;
  resetBtn.addEventListener("click", () => { pinned.clear(); pinnedShape.clear(); applyHighlight(); });
  colorContainer.appendChild(resetBtn);

  // Two-group layout: assemble the color group then the SHAPE group. The shape markers are
  // neutral gray (shape conveys the shape-channel value, not a color); the rows are interactive
  // — hovering / clicking one dims markers of other shapes (independent of the color dimension).
  if (twoGroup) {
    if (hasColor && colorContainer !== legend) legend.appendChild(colorContainer);
    for (const { shape, label, markerSymbol } of safeShapeItems) {
      const btn = doc.createElement("button");
      btn.type = "button";
      btn.className = "tbl-legend-item";
      btn.dataset.shape = shape;
      btn.setAttribute("aria-pressed", "false");
      const swatch = doc.createElement("span");
      swatch.className = "tbl-legend-swatch is-point";
      swatch.appendChild(buildPointSwatch(doc, SHAPE_LEGEND_COLOR, markerSymbol));
      const labelEl = doc.createElement("span");
      labelEl.textContent = label;
      btn.appendChild(swatch);
      btn.appendChild(labelEl);
      btn.addEventListener("pointerenter", () => { hoveredShape = shape; applyHighlight(); });
      btn.addEventListener("pointerleave", () => { hoveredShape = null; applyHighlight(); });
      btn.addEventListener("focus", () => { hoveredShape = shape; applyHighlight(); });
      btn.addEventListener("blur", () => { hoveredShape = null; applyHighlight(); });
      btn.addEventListener("click", () => { togglePinShape(shape); });
      shapeGroup!.appendChild(btn);
    }
    legend.appendChild(shapeGroup!);
  }

  parent.appendChild(legend);
  return { element: legend, toggle: togglePin };
}
