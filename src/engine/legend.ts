// Legend with hover-to-dim + click-to-pin. A live-layer (DOM) primitive: the engine's
// pure path produces the SVG + legend metadata (engine/index.ts); this renders the
// interactive legend against that SVG. Paths are matched by their `data-series` attr,
// which assemblePlot tags post-render.
import type { LegendItem } from "./index";

export function renderLegend(
  parent: HTMLElement,
  items: LegendItem[],
  { svg }: { svg?: SVGSVGElement } = {},
): HTMLElement | null {
  if (!items?.length) return null;

  const doc = parent.ownerDocument;
  const legend = doc.createElement("div");
  legend.className = "tbl-legend";

  const allSeries = items.map((i) => i.series);
  const pinned = new Set<string>();
  let hovered: string | null = null;

  const applyHighlight = (): void => {
    const active = new Set(pinned);
    if (hovered) active.add(hovered);
    // Dim only when a subset is highlighted (not everything, not nothing).
    const dimAll = active.size > 0 && active.size < allSeries.length;
    if (svg) {
      svg.querySelectorAll("path[data-series]").forEach((p) => {
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
  };

  for (const { series, label: displayLabel, color, dashed = false } of items) {
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "tbl-legend-item";
    btn.dataset.series = series; // data key — matches path[data-series]
    btn.setAttribute("aria-pressed", "false");
    // Series color exposed as a custom property so the pinned-state underline can
    // color-match the corresponding line.
    if (color) btn.style.setProperty("--legend-color", color);

    const swatch = doc.createElement("span");
    swatch.className = "tbl-legend-swatch";
    if (dashed) {
      swatch.classList.add("is-dashed");
      if (color) swatch.style.setProperty("--swatch-color", color);
    } else if (color) {
      swatch.style.background = color;
    }

    const labelEl = doc.createElement("span");
    labelEl.textContent = displayLabel ?? series;

    btn.appendChild(swatch);
    btn.appendChild(labelEl);

    btn.addEventListener("pointerenter", () => { hovered = series; applyHighlight(); });
    btn.addEventListener("pointerleave", () => { hovered = null; applyHighlight(); });
    btn.addEventListener("focus", () => { hovered = series; applyHighlight(); });
    btn.addEventListener("blur", () => { hovered = null; applyHighlight(); });
    btn.addEventListener("click", () => {
      if (pinned.has(series)) pinned.delete(series);
      else pinned.add(series);
      applyHighlight();
    });

    legend.appendChild(btn);
  }

  // Circular reset button — placed before the first legend item so it stays in a
  // stable, visible position regardless of how the items wrap. Hidden until pinned.
  const resetBtn = doc.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "tbl-legend-reset";
  resetBtn.setAttribute("aria-label", "Clear pinned highlights");
  resetBtn.innerHTML = '<span class="tbl-legend-reset-icon">⟲</span>';
  resetBtn.hidden = true;
  resetBtn.addEventListener("click", () => { pinned.clear(); applyHighlight(); });
  legend.insertBefore(resetBtn, legend.firstChild);

  parent.appendChild(legend);
  return legend;
}
