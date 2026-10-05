// Treemap hover (spec §6), live only: the hovered tile gets a 2px navy outline drawn above its
// neighbours, every other tile dims to 0.85, and the shared tooltip card names the tile with the
// built-in rows `treemap.tooltip_values` selects, the `treemap.tooltip` rows and the
// `treemap.tooltip_note` cell. Leaving the tile restores the static render exactly,
// so a later redraw (or the PNG export, which re-renders from the spec) never sees hover state. The
// card lives outside the svg, so the caller hides it through the returned function on every redraw
// and on unmount (the old tile's pointerleave never fires once its svg is gone).
import { tokens } from "../theme/tokens";
import { escapeHtml } from "./util";
import { getSharedTooltip, LABEL_VALUE_GAP } from "./crosshair";
import { formatTreemapShare, formatTreemapValue, resolveTreemapConfig } from "../spec/treemap";
import type { TreemapTileInfo } from "./marks/treemap";
import type { ChartSpec } from "../spec/types";

const SVG_NS = "http://www.w3.org/2000/svg";
const DIM_OPACITY = "0.85";
const r2 = (v: number): number => Math.round(v * 100) / 100;

function rowHtml(label: string, value: string): string {
  return `<div class="tbl-tooltip-row"><span><span class="tbl-tooltip-label">${escapeHtml(label)}:</span>${LABEL_VALUE_GAP}<span class="tbl-tooltip-value">${escapeHtml(value)}</span></span></div>`;
}

/** The card's HTML for one tile: header `[Group · ]Name`, then the built-in Value and Share rows that
 *  `treemap.tooltip_values` selects (labelled by `value_label` / `share_label`), and each configured
 *  `treemap.tooltip` row whose cell is not blank. A row with a `format` formats a numeric cell with
 *  it; every other cell (any cell of a row without `format`, e.g. a Year) prints verbatim. */
function cardHtml(t: TreemapTileInfo, spec: ChartSpec): string {
  const cfg = resolveTreemapConfig(spec);
  const valueFmt = spec.tooltip_decimals != null ? { ...spec.value_format, decimals: spec.tooltip_decimals } : spec.value_format;
  const head = t.groupLabel !== null ? `${t.groupLabel} · ${t.name}` : t.name;
  let html = `<div class="tbl-tooltip-head">${escapeHtml(head)}</div>`;
  const values = cfg.tooltipValues;
  if (values === "both" || values === "value") html += rowHtml(cfg.valueLabel, formatTreemapValue(t.value, valueFmt));
  if (values === "both" || values === "share") html += rowHtml(cfg.shareLabel, formatTreemapShare(t.share, cfg.shareDecimals));
  for (const row of cfg.tooltip) {
    const cell = t.row[row.column];
    const text = cell == null ? "" : String(cell);
    if (text.trim() === "") continue;
    const n = Number(text);
    html += rowHtml(row.label ?? row.column, row.format && Number.isFinite(n) ? formatTreemapValue(n, row.format) : text);
  }
  // treemap.tooltip_note: the cell closes the card, below a divider (.tbl-tooltip-note, styles.ts);
  // a blank cell adds nothing, divider included.
  if (cfg.tooltipNote !== null) {
    const cell = t.row[cfg.tooltipNote];
    const note = cell == null ? "" : String(cell);
    if (note.trim() !== "") html += `<div class="tbl-tooltip-note">${escapeHtml(note)}</div>`;
  }
  return html;
}

/** Wire hover on every `rect.tbl-treemap-tile`, paired by index with `tiles` (renderTreemap's
 *  `treemapTiles`, same DOM order). Listeners sit on the tile's `<g>`, so moving onto its label
 *  does not count as leaving the tile. Returns `hide`: clears this chart's hover state and hides the
 *  card if this chart is the one showing it (the card is shared, so another chart's is left alone). */
export function attachTreemapHover(
  svg: SVGSVGElement,
  opts: { tiles: TreemapTileInfo[]; spec: ChartSpec; showTooltip: boolean; tooltipContainer?: HTMLElement },
): () => void {
  const doc = svg.ownerDocument;
  const rects = Array.from(svg.querySelectorAll<SVGRectElement>("rect.tbl-treemap-tile"));
  if (!rects.length) return () => {};
  const tip = opts.showTooltip ? getSharedTooltip(doc, opts.tooltipContainer) : null;
  let showing = false;
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

  const hide = (): void => {
    clear();
    if (tip && showing) tip.style.opacity = "0";
    showing = false;
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
      // A separate element appended last, so the stroke is not covered by later tiles;
      // inset 1px so the whole 2px stroke shows on a tile at the svg edge too.
      const o = doc.createElementNS(SVG_NS, "rect");
      const at = (a: string): number => Number(rect.getAttribute(a) ?? 0);
      o.setAttribute("x", String(r2(at("x") + 1)));
      o.setAttribute("y", String(r2(at("y") + 1)));
      o.setAttribute("width", String(r2(Math.max(0, at("width") - 2))));
      o.setAttribute("height", String(r2(Math.max(0, at("height") - 2))));
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
      showing = true;
      place(evt);
    };
    target.addEventListener("pointerenter", show as EventListener);
    target.addEventListener("pointermove", place as EventListener);
    target.addEventListener("pointerleave", hide);
  });
  return hide;
}
