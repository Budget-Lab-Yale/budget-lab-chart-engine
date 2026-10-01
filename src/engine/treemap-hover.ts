// Treemap hover (spec §6), live only: the hovered tile gets a 2px navy outline drawn above its
// neighbours, every other tile dims to 0.85, and the shared tooltip card names the tile with its
// Value, Share and the `treemap.tooltip` rows. Leaving the tile restores the static render exactly,
// so a later redraw (or the PNG export, which re-renders from the spec) never sees hover state.
import { tokens } from "../theme/tokens";
import { escapeHtml } from "./util";
import { getSharedTooltip, LABEL_VALUE_GAP } from "./crosshair";
import { formatTreemapShare, formatTreemapValue, resolveTreemapConfig } from "../spec/treemap";
import type { TreemapTileInfo } from "./marks/treemap";
import type { ChartSpec } from "../spec/types";

const SVG_NS = "http://www.w3.org/2000/svg";
const DIM_OPACITY = "0.85";

function rowHtml(label: string, value: string): string {
  return `<div class="tbl-tooltip-row"><span><span class="tbl-tooltip-label">${escapeHtml(label)}:</span>${LABEL_VALUE_GAP}<span class="tbl-tooltip-value">${escapeHtml(value)}</span></span></div>`;
}

/** The card's HTML for one tile: header `[Group · ]Name`, then Value, Share and each configured
 *  `treemap.tooltip` row whose cell is not blank. */
function cardHtml(t: TreemapTileInfo, spec: ChartSpec): string {
  const cfg = resolveTreemapConfig(spec);
  const valueFmt = spec.tooltip_decimals != null ? { ...spec.value_format, decimals: spec.tooltip_decimals } : spec.value_format;
  const head = t.groupLabel !== null ? `${t.groupLabel} · ${t.name}` : t.name;
  let html = `<div class="tbl-tooltip-head">${escapeHtml(head)}</div>`;
  html += rowHtml("Value", formatTreemapValue(t.value, valueFmt));
  html += rowHtml("Share", formatTreemapShare(t.share, cfg.shareDecimals));
  for (const row of cfg.tooltip) {
    const cell = t.row[row.column];
    const text = cell == null ? "" : String(cell);
    if (text.trim() === "") continue;
    const n = Number(text);
    html += rowHtml(row.label ?? row.column, Number.isFinite(n) ? formatTreemapValue(n, row.format ?? spec.value_format) : text);
  }
  return html;
}

/** Wire hover on every `rect.tbl-treemap-tile`, paired by index with `tiles` (renderTreemap's
 *  `treemapTiles`, same DOM order). Listeners sit on the tile's `<g>`, so moving onto its label
 *  does not count as leaving the tile. */
export function attachTreemapHover(
  svg: SVGSVGElement,
  opts: { tiles: TreemapTileInfo[]; spec: ChartSpec; showTooltip: boolean; tooltipContainer?: HTMLElement },
): void {
  const doc = svg.ownerDocument;
  const rects = Array.from(svg.querySelectorAll<SVGRectElement>("rect.tbl-treemap-tile"));
  if (!rects.length) return;
  const tip = opts.showTooltip ? getSharedTooltip(doc, opts.tooltipContainer) : null;
  const targets = rects.map((r) => (r.parentElement ?? r) as unknown as SVGElement);
  const baseOpacity = targets.map((g) => g.getAttribute("opacity"));
  let outline: SVGRectElement | null = null;

  const clear = (): void => {
    outline?.remove();
    outline = null;
    targets.forEach((g, j) => {
      const o = baseOpacity[j];
      if (o == null) g.removeAttribute("opacity");
      else g.setAttribute("opacity", o);
    });
  };

  const place = (evt: PointerEvent): void => {
    if (!tip) return;
    const offset = 14;
    const win = doc.defaultView!;
    let left = evt.clientX + offset;
    let top = evt.clientY + offset;
    if (left + tip.offsetWidth + 4 > win.innerWidth) left = evt.clientX - tip.offsetWidth - offset;
    if (top + tip.offsetHeight + 4 > win.innerHeight) top = evt.clientY - tip.offsetHeight - offset;
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${Math.max(4, top)}px`;
  };

  rects.forEach((rect, i) => {
    const t = opts.tiles[i];
    if (!t) return;
    const target = targets[i]!;
    const show = (evt: PointerEvent): void => {
      clear();
      targets.forEach((g, j) => { if (j !== i) g.setAttribute("opacity", DIM_OPACITY); });
      // A separate element appended last, so the stroke is not covered by later tiles or strips.
      const o = doc.createElementNS(SVG_NS, "rect");
      for (const a of ["x", "y", "width", "height"]) o.setAttribute(a, rect.getAttribute(a) ?? "0");
      o.setAttribute("class", "tbl-treemap-hover-outline");
      o.setAttribute("fill", "none");
      o.setAttribute("stroke", tokens.structural.text_heading);
      o.setAttribute("stroke-width", "2");
      o.setAttribute("pointer-events", "none");
      o.setAttribute("aria-hidden", "true");
      svg.append(o);
      outline = o;
      if (!tip) return;
      tip.innerHTML = cardHtml(t, opts.spec);
      tip.style.opacity = "1";
      place(evt);
    };
    target.addEventListener("pointerenter", show as EventListener);
    target.addEventListener("pointermove", place as EventListener);
    target.addEventListener("pointerleave", () => {
      clear();
      if (tip) tip.style.opacity = "0";
    });
  });
}
