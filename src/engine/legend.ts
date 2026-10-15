// Legend with hover-to-dim + click-to-pin. A live-layer (DOM) primitive: the engine's
// pure path produces the SVG + legend metadata (engine/index.ts); this renders the
// interactive legend against that SVG. Paths are matched by their `data-series` attr,
// which assemblePlot tags post-render.
import type { LegendItem } from "./index";
import { ICON_BOX, iconFromLegendItem, legendRowMarkup, iconSvgElement, iconWidth } from "./icon";
import { SHAPE_LEGEND_COLOR } from "./theme";
import type { RenderHooks } from "../spec/hooks";

/** One shape-legend row (point charts, dual encoding). */
export interface ShapeLegendEntry {
  /** The raw shape-value key — matches markers' data-shape so the row can drive hover-dim/pin. */
  shape: string;
  label: string;
  markerSymbol: string;
}

/** A legend's pin state in all three dimensions, each in click order. */
export interface LegendPins {
  series: string[];
  annotations: string[];
  shapes: string[];
}

/** A legend's selection state: its pins plus the row hovered (or focused) in each dimension. Read
 *  off the legend a redraw replaces and handed to its replacement (`renderLegend`'s `state`), since
 *  every live redraw rebuilds the legend from scratch. Hover is carried explicitly rather than
 *  re-derived from focus: a mouse click leaves a button focused, so focus says nothing about
 *  whether its row is still highlighted. */
export interface LegendState {
  pins: LegendPins;
  hovered: { series: string | null; annotation: string | null; shape: string | null };
}

/** The legend control holding keyboard focus, so a rebuilt legend can hand focus to its counterpart.
 *  `key` is null for the reset button. */
export interface LegendFocus {
  kind: "series" | "annotation" | "shape" | "reset";
  key: string | null;
}

/** Handle returned by renderLegend: the rendered element plus a `toggle(series)` that
 *  flips the SAME pin state a legend-button click would, keeping ONE source of truth
 *  (the internal `pinned` Set) so the chart can act as a second selection input. */
export interface LegendHandle {
  element: HTMLElement;
  /** Toggle a series' pinned state (no-op for an unknown/non-interactive series). */
  toggle(series: string): void;
  /** Hover an ANNOTATION key (or null to clear) — the reciprocal of hovering its legend row, for
   *  when the pointer is over the chart element instead. No-op for an unknown key. */
  hoverAnnotation(key: string | null): void;
  /** Toggle an annotation key's pinned state, so a click holds the highlight. No-op if unknown. */
  toggleAnnotation(key: string): void;
  /** Pinned series in click order (the live layer uses this to compute a restack order). */
  pinnedSeries(): string[];
  /** Pins and hover, all three dimensions — what a redraw hands to the legend that replaces this one. */
  state(): LegendState;
  /** The active color-series set onHighlight would be handed now: pinned series plus a hovered one. */
  active(): Set<string>;
  /** Re-apply the current dim/pin classes WITHOUT calling onHighlight. For marks the live layer adds
   *  to the svg after the legend was built (line hit paths, for one), which a carried state would
   *  otherwise leave undimmed. */
  restyle(): void;
  /** The legend control that has keyboard focus, or null when focus is elsewhere. */
  focused(): LegendFocus | null;
  /** Focus this legend's control matching `target` (a `focused()` read off the legend this one
   *  replaced), SILENTLY: the row's focus handler neither marks it hovered nor notifies, since the
   *  carried `state` already holds the hover. False when there is none, or it is hidden. */
  focus(target: LegendFocus): boolean;
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
    hooks,
    state: carried,
    abandoned,
  }: {
    svg?: Element;
    onHighlight?: (active: Set<string>) => void;
    shapeItems?: ShapeLegendEntry[] | null;
    colorTitle?: string;
    shapeTitle?: string;
    /** Programmatic render hooks (spec/hooks.ts). Only `legendKey` is consumed here, once per
     *  color-legend row (the neutral SHAPE-legend rows below have no `series` key and never
     *  invoke it). */
    hooks?: RenderHooks;
    /** State carried from the legend this one replaces. Keys this legend lacks are dropped; the rest
     *  are applied to the legend and `svg` WITHOUT calling `onHighlight` — the caller compares
     *  `state()` with what it passed and decides what to report. */
    state?: LegendState | null;
    /** Read once the rows are built, before the legend is attached: true when the owner was torn
     *  down meanwhile (a `legendKey` hook can do it). Then nothing is attached and the result is
     *  null. */
    abandoned?: () => boolean;
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
  const allSeries = safeItems.filter((i) => !i.nonInteractive && !i.annotation).map((i) => i.series);
  const allShapes = safeShapeItems.map((i) => i.shape);
  const pinned = new Set<string>();
  let hovered: string | null = null;
  const pinnedShape = new Set<string>();
  let hoveredShape: string | null = null;
  // ANNOTATION dimension (bands / fills / reference lines / rug tracks). Kept separate from
  // `pinned` so `pinnedSeries()` and the onHighlight callback — which feed the area restack and the
  // value pills — keep seeing series keys only, while dimming treats both dimensions as ONE
  // universe: selecting anything dims everything that doesn't carry the selected key.
  const allAnnotations = safeItems.filter((i) => i.annotation).map((i) => i.series);
  const pinnedAnn = new Set<string>();
  let hoveredAnn: string | null = null;

  // Circular reset button — declared up front (applyHighlight toggles its visibility) but
  // appended at the END of the legend so it sits after the last item. Hidden until pinned,
  // so toggling it in on the first pin does not shift the data-series rows above it.
  const resetBtn = doc.createElement("button");
  // Set while handle.focus() hands focus over from a replaced legend, so the focus handlers below
  // leave the carried hover alone and do not notify.
  let restoringFocus = false;

  const activeSeries = (): Set<string> => {
    const active = new Set(pinned);
    if (hovered) active.add(hovered);
    return active;
  };
  const applyHighlight = (notify = true): void => {
    const active = activeSeries();
    const activeShape = new Set(pinnedShape);
    if (hoveredShape) activeShape.add(hoveredShape);
    const activeAnn = new Set(pinnedAnn);
    if (hoveredAnn) activeAnn.add(hoveredAnn);
    // Series and annotations share ONE universe for dimming: a selection of either kind dims
    // everything else, which is what makes hovering "False negatives" spotlight the gold fills and
    // rug blocks and drop the line back. Dim only for a strict subset (not all, not none).
    const selected = active.size + activeAnn.size;
    const dimColor = selected > 0 && selected < allSeries.length + allAnnotations.length;
    const dimShape = activeShape.size > 0 && activeShape.size < allShapes.length;
    if (svg) {
      // An element stays bright when EITHER of its keys is selected: a keyed `shading` fill carries
      // both its series and its annotation key, so it lights up from its line's legend row and from
      // its annotation row alike. The shape test still intersects (point charts only; other marks
      // carry no data-shape).
      svg.querySelectorAll("[data-series], [data-annotation]").forEach((p) => {
        const s = p.getAttribute("data-series");
        const ann = p.getAttribute("data-annotation");
        const sh = p.getAttribute("data-shape");
        const colorOk =
          !dimColor || (s != null && active.has(s)) || (ann != null && activeAnn.has(ann));
        const shapeOk = !dimShape || (sh != null && activeShape.has(sh));
        p.classList.toggle("tbl-dimmed", !(colorOk && shapeOk));
      });
    }
    legend.querySelectorAll<HTMLElement>(".tbl-legend-item").forEach((btn) => {
      if (btn.dataset.shape != null) {
        const sh = btn.dataset.shape;
        btn.classList.toggle("is-pinned", pinnedShape.has(sh));
        btn.setAttribute("aria-pressed", String(pinnedShape.has(sh)));
      } else if (btn.dataset.annotation != null) {
        const key = btn.dataset.annotation;
        btn.classList.toggle("is-pinned", pinnedAnn.has(key));
        btn.setAttribute("aria-pressed", String(pinnedAnn.has(key)));
        // Hovering the chart element highlights its row too, so the reciprocity shows in the legend
        // and not only in the plot.
        btn.classList.toggle("is-hovered", hoveredAnn === key);
      } else {
        const s = btn.dataset.series as string;
        btn.classList.toggle("is-pinned", pinned.has(s));
        btn.setAttribute("aria-pressed", String(pinned.has(s)));
      }
    });
    resetBtn.hidden = pinned.size === 0 && pinnedShape.size === 0 && pinnedAnn.size === 0;
    // Notify after the dim classes are toggled so the callback reads the fresh dim state
    // (e.g. recoloring net-total labels by the behind-segment's dim class). Runs on every
    // highlight change — pin, hover, focus, blur, and reset. The active color-series set is
    // passed so the callback can drive the value-pill renderer (an empty set clears it).
    if (notify) onHighlight?.(active);
  };

  // Shared pin toggle — the single source of truth for both legend-button clicks and
  // chart clicks (via the returned handle). Unknown / non-interactive series are a no-op.
  const togglePin = (series: string): void => {
    if (!allSeries.includes(series)) return;
    if (pinned.has(series)) pinned.delete(series);
    else pinned.add(series);
    applyHighlight();
  };
  const togglePinAnnotation = (key: string): void => {
    if (!allAnnotations.includes(key)) return;
    if (pinnedAnn.has(key)) pinnedAnn.delete(key);
    else pinnedAnn.add(key);
    applyHighlight();
  };
  const togglePinShape = (shape: string): void => {
    if (!allShapes.includes(shape)) return;
    if (pinnedShape.has(shape)) pinnedShape.delete(shape);
    else pinnedShape.add(shape);
    applyHighlight();
  };

  for (const { series, label: displayLabel, color, colors: swatchColors, dashed = false, markerShape, markerSymbol, hollow = false, nonInteractive, annotation = false, outlined = false, hatch } of safeItems) {
    // Non-interactive rows (e.g. Total) are plain spans — they don't participate in
    // hover-dim / click-to-pin and carry no data-series attribute.
    const btn: HTMLElement = nonInteractive
      ? doc.createElement("span")
      : doc.createElement("button");
    if (!nonInteractive) {
      (btn as HTMLButtonElement).type = "button";
      // An annotation row's key lives on data-ANNOTATION, matching the chart elements it names
      // (bands / fills / rules / rug blocks) rather than any series' paths.
      if (annotation) btn.dataset.annotation = series;
      else btn.dataset.series = series; // data key — matches path[data-series]
      btn.setAttribute("aria-pressed", "false");
    }
    btn.className = "tbl-legend-item";
    // Series color exposed as a custom property so the pinned-state underline can
    // color-match the corresponding line.
    if (color) btn.style.setProperty("--legend-color", color);

    const icon = iconFromLegendItem({
      color,
      dashed,
      markerShape,
      ...(markerSymbol ? { markerSymbol } : {}),
      hollow,
      ...(swatchColors ? { colors: swatchColors } : {}),
      outlined,
      ...(hatch ? { hatch } : {}),
    });
    const label = displayLabel ?? series;
    // `rendered` is the SAME markup the default branch below builds as DOM — legendRowMarkup and
    // iconSvgElement both draw from iconShapes(icon), so a hook is never handed a second
    // construction of the key. `null` (or no hook) leaves this row exactly as it was before hooks
    // existed — required for `hooks: {}` to be byte-identical to no hooks at all.
    const custom = hooks?.legendKey
      ? hooks.legendKey({ series, label, color, medium: "html", rendered: legendRowMarkup(icon, label) })
      : null;
    if (custom != null) {
      btn.innerHTML = custom;
    } else {
      const swatch = doc.createElement("span");
      swatch.className = "tbl-legend-swatch";
      const drawing = iconSvgElement(doc, icon);
      if (drawing) swatch.appendChild(drawing);
      // Only a banded chip is wider than the box, and it must reserve the extra width.
      if (iconWidth(icon) !== ICON_BOX) swatch.style.width = `${iconWidth(icon)}px`;

      const labelEl = doc.createElement("span");
      labelEl.textContent = label;

      btn.appendChild(swatch);
      btn.appendChild(labelEl);
    }

    if (!nonInteractive) {
      const enter = annotation
        ? () => { hoveredAnn = series; applyHighlight(); }
        : () => { hovered = series; applyHighlight(); };
      const leave = annotation
        ? () => { hoveredAnn = null; applyHighlight(); }
        : () => { hovered = null; applyHighlight(); };
      btn.addEventListener("pointerenter", enter);
      btn.addEventListener("pointerleave", leave);
      btn.addEventListener("focus", () => { if (!restoringFocus) enter(); });
      btn.addEventListener("blur", leave);
      btn.addEventListener("click", () => {
        if (annotation) togglePinAnnotation(series);
        else togglePin(series);
      });
    }

    colorContainer.appendChild(btn);
  }

  resetBtn.type = "button";
  resetBtn.className = "tbl-legend-reset";
  resetBtn.setAttribute("aria-label", "Clear pinned highlights");
  resetBtn.innerHTML = '<span class="tbl-legend-reset-icon">⟲</span>';
  resetBtn.hidden = true;
  resetBtn.addEventListener("click", () => {
    pinned.clear();
    pinnedShape.clear();
    pinnedAnn.clear();
    applyHighlight();
  });
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
      swatch.className = "tbl-legend-swatch";
      const shapeIcon = iconSvgElement(doc, {
        shape: "symbol",
        color: SHAPE_LEGEND_COLOR,
        symbol: markerSymbol,
      });
      if (shapeIcon) swatch.appendChild(shapeIcon);
      const labelEl = doc.createElement("span");
      labelEl.textContent = label;
      btn.appendChild(swatch);
      btn.appendChild(labelEl);
      btn.addEventListener("pointerenter", () => { hoveredShape = shape; applyHighlight(); });
      btn.addEventListener("pointerleave", () => { hoveredShape = null; applyHighlight(); });
      btn.addEventListener("focus", () => {
        if (restoringFocus) return;
        hoveredShape = shape;
        applyHighlight();
      });
      btn.addEventListener("blur", () => { hoveredShape = null; applyHighlight(); });
      btn.addEventListener("click", () => { togglePinShape(shape); });
      shapeGroup!.appendChild(btn);
    }
    legend.appendChild(shapeGroup!);
  }

  if (abandoned?.()) return null;
  parent.appendChild(legend);
  if (carried) {
    const { pins: p, hovered: h } = carried;
    for (const s of p.series) if (allSeries.includes(s)) pinned.add(s);
    for (const k of p.annotations) if (allAnnotations.includes(k)) pinnedAnn.add(k);
    for (const sh of p.shapes) if (allShapes.includes(sh)) pinnedShape.add(sh);
    if (h.series != null && allSeries.includes(h.series)) hovered = h.series;
    if (h.annotation != null && allAnnotations.includes(h.annotation)) hoveredAnn = h.annotation;
    if (h.shape != null && allShapes.includes(h.shape)) hoveredShape = h.shape;
    if (pinned.size || pinnedAnn.size || pinnedShape.size || hovered || hoveredAnn || hoveredShape) {
      applyHighlight(false);
    }
  }
  return {
    element: legend,
    toggle: togglePin,
    hoverAnnotation: (key: string | null) => {
      const next = key != null && allAnnotations.includes(key) ? key : null;
      if (next === hoveredAnn) return;
      hoveredAnn = next;
      applyHighlight();
    },
    toggleAnnotation: togglePinAnnotation,
    pinnedSeries: () => [...pinned],
    state: () => ({
      pins: { series: [...pinned], annotations: [...pinnedAnn], shapes: [...pinnedShape] },
      hovered: { series: hovered, annotation: hoveredAnn, shape: hoveredShape },
    }),
    active: activeSeries,
    restyle: () => applyHighlight(false),
    focused: () => {
      const el = doc.activeElement as HTMLElement | null;
      if (!el || !legend.contains(el)) return null;
      if (el === resetBtn) return { kind: "reset", key: null };
      if (el.dataset.series != null) return { kind: "series", key: el.dataset.series };
      if (el.dataset.annotation != null) return { kind: "annotation", key: el.dataset.annotation };
      if (el.dataset.shape != null) return { kind: "shape", key: el.dataset.shape };
      return null;
    },
    focus: (target: LegendFocus) => {
      const el = target.kind === "reset"
        ? resetBtn
        : [...legend.querySelectorAll<HTMLElement>(".tbl-legend-item")]
            .find((b) => b.dataset[target.kind] === target.key);
      if (!el || (el as HTMLButtonElement).hidden) return false;
      restoringFocus = true;
      try {
        // A resize must not scroll the page back to the legend.
        el.focus({ preventScroll: true });
      } finally {
        restoringFocus = false;
      }
      return true;
    },
  };
}
