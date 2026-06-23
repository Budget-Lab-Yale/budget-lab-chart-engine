// Legend with hover-to-dim + click-to-pin. A live-layer (DOM) primitive: the engine's
// pure path produces the SVG + legend metadata (engine/index.ts); this renders the
// interactive legend against that SVG. Paths are matched by their `data-series` attr,
// which assemblePlot tags post-render.
import type { LegendItem } from "./index";

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
  { svg, onHighlight }: { svg?: Element; onHighlight?: () => void } = {},
): LegendHandle | null {
  if (!items?.length) return null;

  const doc = parent.ownerDocument;
  const legend = doc.createElement("div");
  legend.className = "tbl-legend";

  // Only real (interactive) series participate in hover-dim and pin logic.
  const allSeries = items.filter((i) => !i.nonInteractive).map((i) => i.series);
  const pinned = new Set<string>();
  let hovered: string | null = null;

  // Circular reset button — declared up front (applyHighlight toggles its visibility) but
  // appended at the END of the legend so it sits after the last item. Hidden until pinned,
  // so toggling it in on the first pin does not shift the data-series rows above it.
  const resetBtn = doc.createElement("button");

  const applyHighlight = (): void => {
    const active = new Set(pinned);
    if (hovered) active.add(hovered);
    // Dim only when a subset is highlighted (not everything, not nothing).
    const dimAll = active.size > 0 && active.size < allSeries.length;
    if (svg) {
      // Dim ALL data-series elements: line charts tag <path>, bar/stacked tag <rect>.
      // Matching only path[data-series] left bar/stacked hover-dim + click-pin dead.
      svg.querySelectorAll("[data-series]").forEach((p) => {
        const s = p.getAttribute("data-series");
        p.classList.toggle("tbl-dimmed", dimAll && !active.has(s as string));
      });
    }
    legend.querySelectorAll<HTMLElement>(".tbl-legend-item").forEach((btn) => {
      const s = btn.dataset.series as string;
      btn.classList.toggle("is-pinned", pinned.has(s));
      btn.setAttribute("aria-pressed", String(pinned.has(s)));
    });
    resetBtn.hidden = pinned.size === 0;
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

  for (const { series, label: displayLabel, color, dashed = false, markerShape, nonInteractive } of items) {
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
    } else if (markerShape === "dot") {
      swatch.classList.add("is-dot");
      // White fill + black stroke via CSS — no inline color needed.
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

    legend.appendChild(btn);
  }

  resetBtn.type = "button";
  resetBtn.className = "tbl-legend-reset";
  resetBtn.setAttribute("aria-label", "Clear pinned highlights");
  resetBtn.innerHTML = '<span class="tbl-legend-reset-icon">⟲</span>';
  resetBtn.hidden = true;
  resetBtn.addEventListener("click", () => { pinned.clear(); applyHighlight(); });
  legend.appendChild(resetBtn);

  parent.appendChild(legend);
  return { element: legend, toggle: togglePin };
}
