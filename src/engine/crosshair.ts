// Cursor-following crosshair tooltip (a live-layer DOM primitive). A vertical guide
// stays inside the SVG and snaps to the nearest x in the data; the tooltip is appended
// to document.body and positioned with position:fixed at the cursor's viewport coords.
//
// Also exports `attachBandCrosshair` for categorical (band-axis) charts (bar/stacked),
// which resolves the hovered category from rendered rect geometry and shows a tooltip.
import { d3 } from "./vendor";
import { TBL } from "./theme";
import { escapeHtml } from "./util";
import { symbolPathD } from "./symbols";
import { wrapBandLabel } from "./axes";
import { TOTAL_SERIES_KEY } from "./series-keys";
import { formatBinLabel, type BinLabelOpts } from "./histogram-label";

type Row = Record<string, unknown>;

export interface CrosshairOptions {
  rows: Row[];
  xField?: string;
  yField?: string;
  seriesField?: string;
  xParse?: (v: unknown) => number;
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  colors?: Map<string, string>;
  /** Series rendered dashed (mirrors the legend swatch in the tooltip). */
  dashedSeries?: Set<string>;
  /** Short data key → display label. */
  seriesLabels?: Record<string, string>;
  /** Fixed tooltip row order (matches the legend); else data-encounter order. */
  seriesOrder?: string[];
  /** Coordinated-cursor hook: called with the resolved x-value on each move (and null on
   *  leave) so the live layer can echo a secondary cursor on sibling small-multiples panes. */
  onResolve?: (xValue: number | null) => void;
  /** Hit-test only: keep the pointer hit area + `onResolve` emission but draw NO guide and show
   *  NO tooltip. Used by coordinated small-multiples figures, where the unified secondary-cursor
   *  renderer (driven by the figure bus) draws every pane's indicators instead. */
  emitOnly?: boolean;
  /** series → marker symbol name (line charts with point markers). When set, the coordinated
   *  hover dot takes the series' shape so it matches the static marker. */
  symbols?: Map<string, string>;
  /** Append a cumulative "Total" row (sum of the shown series at the hovered x) to the tooltip —
   *  used for stacked area, where the stack height is the meaningful aggregate. */
  showTotal?: boolean;
}

let activeTooltip: HTMLElement | null = null; // single shared tooltip element

function getSharedTooltip(doc: Document): HTMLElement {
  if (activeTooltip && doc.body.contains(activeTooltip)) return activeTooltip;
  const tip = doc.createElement("div");
  tip.className = "tbl-tooltip";
  doc.body.appendChild(tip);
  activeTooltip = tip;
  return tip;
}

export function attachCrosshair(svgEl: SVGSVGElement, opts: CrosshairOptions): void {
  const {
    rows,
    xField = "time",
    yField = "value",
    seriesField = "series",
    colors,
    dashedSeries,
    seriesLabels,
    seriesOrder,
  } = opts;
  let { xParse, xFormat } = opts;
  const yFormat =
    opts.yFormat ??
    ((v: number) => `${(+v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
  if (!svgEl || !rows?.length) return;

  const vb = svgEl.viewBox?.baseVal;
  const W = vb?.width || +(svgEl.getAttribute("width") ?? "") || svgEl.clientWidth;
  const H = vb?.height || +(svgEl.getAttribute("height") ?? "") || svgEl.clientHeight;

  const ml = +(svgEl.dataset.marginLeft ?? "") || 0;
  const mr = +(svgEl.dataset.marginRight ?? "") || 8;
  const mt = +(svgEl.dataset.marginTop ?? "") || 18;
  const mb = +(svgEl.dataset.marginBottom ?? "") || 28;

  const plotW = W - ml - mr;
  const plotH = H - mt - mb;

  if (!xParse) {
    const sample = rows[0]?.[xField];
    if (/^\d{4}-\d{2}-\d{2}/.test(String(sample))) {
      xParse = (v) => +new Date(String(v));
      if (!xFormat) xFormat = (v) => d3.timeFormat("%b %Y")(new Date(v));
    } else if (/Q\d/.test(String(sample))) {
      xParse = (v) => {
        const m = /(\d{4})Q(\d)/.exec(String(v));
        return +new Date(+(m as RegExpExecArray)[1]!, (+(m as RegExpExecArray)[2]! - 1) * 3, 1);
      };
      if (!xFormat)
        xFormat = (v) => {
          const d = new Date(v);
          const q = Math.floor(d.getMonth() / 3) + 1;
          return `${d.getFullYear()}Q${q}`;
        };
    } else {
      xParse = (v) => +(v as number);
      if (!xFormat) xFormat = (v) => String(v);
    }
  }

  const xs = Array.from(new Set(rows.map((r) => xParse!(r[xField])))).sort((a, b) => a - b);
  const bySeries = new Map<string, Map<number, number>>();
  for (const r of rows) {
    const v = r[yField];
    if (v === "" || v == null) continue; // skip blank rows
    const k = r[seriesField] as string;
    if (!bySeries.has(k)) bySeries.set(k, new Map());
    bySeries.get(k)!.set(xParse!(r[xField]), +(v as number));
  }
  const xMin = xs[0]!;
  const xMax = xs[xs.length - 1]!;
  const xToPx = (x: number): number => ml + ((x - xMin) / (xMax - xMin)) * plotW;
  const pxToX = (px: number): number => xMin + ((px - ml) / plotW) * (xMax - xMin);
  const bisect = d3.bisector((d: number) => d).left;

  const emitOnly = opts.emitOnly ?? false;
  const NS = "http://www.w3.org/2000/svg";
  svgEl.querySelectorAll(".tbl-crosshair, .tbl-crosshair-hit").forEach((el) => el.remove());

  // emitOnly (coordinated figure): no guide, no tooltip — the secondary renderer draws visuals.
  const guide = emitOnly ? null : svgEl.ownerDocument.createElementNS(NS, "line");
  if (guide) {
    guide.classList.add("tbl-crosshair");
    guide.setAttribute("stroke", TBL.color.annotationDim);
    guide.setAttribute("stroke-dasharray", "3 3");
    guide.setAttribute("y1", String(mt));
    guide.setAttribute("y2", String(mt + plotH));
    guide.setAttribute("opacity", "0");
    guide.style.pointerEvents = "none";
    svgEl.appendChild(guide);
  }

  // Transparent hit-area covering the full SVG so events fire over any region.
  const hit = svgEl.ownerDocument.createElementNS(NS, "rect");
  hit.classList.add("tbl-crosshair-hit");
  hit.setAttribute("x", "0");
  hit.setAttribute("y", "0");
  hit.setAttribute("width", String(W));
  hit.setAttribute("height", String(H));
  hit.setAttribute("fill", "transparent");
  hit.style.cursor = "crosshair";
  svgEl.appendChild(hit);

  const tip = emitOnly ? null : getSharedTooltip(svgEl.ownerDocument);

  function snapX(svgX: number): number | null {
    if (svgX < ml || svgX > ml + plotW) return null;
    const xVal = pxToX(svgX);
    const i = bisect(xs, xVal);
    const cand = [xs[i - 1], xs[i]].filter((v) => v != null) as number[];
    if (!cand.length) return null;
    return cand.length === 1
      ? cand[0]!
      : Math.abs(cand[0]! - xVal) < Math.abs(cand[1]! - xVal)
        ? cand[0]!
        : cand[1]!;
  }

  function update(evt: PointerEvent): void {
    const rect = svgEl.getBoundingClientRect();
    if (!rect.width) return;
    const scaleX = W / rect.width;
    const svgX = (evt.clientX - rect.left) * scaleX;

    const snap = snapX(svgX);
    if (snap == null) {
      hide();
      return;
    }
    opts.onResolve?.(snap);
    if (emitOnly) return;
    const gx = xToPx(snap);
    guide!.setAttribute("x1", String(gx));
    guide!.setAttribute("x2", String(gx));
    guide!.setAttribute("opacity", "1");

    let html = `<div class="tbl-tooltip-head">${escapeHtml(xFormat!(snap))}</div>`;
    const tipSeries =
      seriesOrder && seriesOrder.length
        ? seriesOrder.filter((s) => bySeries.has(s))
        : [...bySeries.keys()];
    let total = 0;
    let totalAny = false;
    for (const series of tipSeries) {
      const m = bySeries.get(series)!;
      const v = m.get(snap);
      if (v == null || Number.isNaN(v)) continue;
      total += v;
      totalAny = true;
      const dot = colors?.get(series) || "currentColor";
      const isDashed = dashedSeries?.has(series);
      const display = (seriesLabels && seriesLabels[series]) || series;
      const swatchClass = isDashed ? "tbl-tooltip-swatch is-dashed" : "tbl-tooltip-swatch";
      const swatchStyle = isDashed ? `--swatch-color: ${dot}` : `background: ${dot}`;
      html += `<div class="tbl-tooltip-row"><span class="${swatchClass}" style="${swatchStyle}"></span><span><span class="tbl-tooltip-label">${escapeHtml(display)}:</span> <span class="tbl-tooltip-value">${escapeHtml(yFormat(v))}</span></span></div>`;
    }
    // Cumulative total (stacked area): a bold summary row, set off by a top rule.
    if (opts.showTotal && totalAny) {
      html += `<div class="tbl-tooltip-row" style="border-top:1px solid var(--tbl-gridline,#eee);margin-top:3px;padding-top:3px;font-weight:600"><span class="tbl-tooltip-swatch" style="background:transparent"></span><span><span class="tbl-tooltip-label">Total:</span> <span class="tbl-tooltip-value">${escapeHtml(yFormat(total))}</span></span></div>`;
    }
    tip!.innerHTML = html;

    const offset = 14;
    const win = svgEl.ownerDocument.defaultView!;
    const vw = win.innerWidth;
    const vh = win.innerHeight;
    tip!.style.opacity = "1";
    let left = evt.clientX + offset;
    let top = evt.clientY + offset;
    if (left + tip!.offsetWidth + 4 > vw) left = evt.clientX - tip!.offsetWidth - offset;
    if (top + tip!.offsetHeight + 4 > vh) top = evt.clientY - tip!.offsetHeight - offset;
    if (left < 4) left = 4;
    if (top < 4) top = 4;
    tip!.style.left = `${left}px`;
    tip!.style.top = `${top}px`;
  }

  function hide(): void {
    if (guide) guide.setAttribute("opacity", "0");
    if (tip) tip.style.opacity = "0";
    opts.onResolve?.(null);
  }

  hit.style.pointerEvents = "all";
  hit.addEventListener("pointermove", update as EventListener);
  hit.addEventListener("pointerleave", hide);
  hit.addEventListener("pointerdown", update as EventListener);
}

// ---------------------------------------------------------------------------
// Facet-aware crosshair — SHARED-mode small-multiples LINE figures
// ---------------------------------------------------------------------------
// A shared figure is ONE faceted SVG (fx columns x fy rows) sharing a y-scale. The flat
// `attachCrosshair` above would span the guide across BOTH stacked rows of a column and
// collide tooltip data across panes. This variant treats each facet CELL as a separate
// chart: it resolves the cell under the cursor, draws a guide confined to that cell's plot
// y-range, snaps to the shared x-domain within the cell, and shows a tooltip headed by the
// pane's title with only that pane's series values.

/** One facet's data + identity, supplied by the live layer (grouped from dataInScope). */
export interface FacetCrosshairPane {
  /** The facet value (e.g. "Northeast"). */
  facet: string;
  /** Grid column index. */
  col: number;
  /** Grid row index. */
  row: number;
  /** Pane display title (header of the tooltip). */
  title: string;
  /** This pane's rows (already restricted to this facet). */
  rows: Row[];
}

export interface FacetCrosshairOptions {
  panes: FacetCrosshairPane[];
  xField?: string;
  yField?: string;
  seriesField?: string;
  xParse?: (v: unknown) => number;
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  colors?: Map<string, string>;
  dashedSeries?: Set<string>;
  seriesLabels?: Record<string, string>;
  seriesOrder?: string[];
}

/** A resolved facet cell's geometry in SVG user coords. The plot area of the cell is
 *  [x0,x1] x [y0,y1]; the guide is confined to [y0,y1]; the shared x-domain maps linearly
 *  across [x0,x1]. */
export interface FacetCell {
  facet: string;
  col: number;
  row: number;
  title: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** A minimal view of a Plot band scale (what `svg.scale("fx"|"fy")` returns). */
export interface BandScaleLike {
  domain: unknown[];
  range: [number, number] | number[];
  bandwidth?: number;
}

/** A minimal view of a Plot continuous scale (what `svg.scale("x"|"y")` returns). */
export interface ContinuousScaleLike {
  range: [number, number] | number[];
}

/**
 * PURE — compute the absolute SVG-user-coordinate plot bounds of every facet cell from
 * Plot's faceted scales. Each cell's origin is the band START of its (fx col, fy row); the
 * within-cell plot area is the shared x/y scale ranges (which are cell-LOCAL), offset by the
 * cell origin. Verified against the rendered figure (fy paddingInner 0.22, fx 0.08):
 *   fx range [44,822] bandwidth 373 → col origins {0,405} (= bandStart − range[0]).
 *   x range [44,417] local, y range [177,18] local → cell plot [tx+44,tx+417] x [ty+18,ty+177].
 *
 * Band-start derivation (no `.apply` is exposed): origin(i) = i * step, where step is the
 * inter-band stride. With n>1 bands sharing the range, step = (rangeSpan − bandwidth)/(n−1).
 * For n=1 there is a single band at origin 0. `panes` supplies the (col,row)→facet/title map;
 * cells with no matching pane are skipped.
 */
export function computeFacetCells(
  fx: BandScaleLike,
  fy: BandScaleLike,
  x: ContinuousScaleLike,
  y: ContinuousScaleLike,
  panes: Array<{ facet: string; col: number; row: number; title: string }>,
): FacetCell[] {
  const bandOrigin = (scale: BandScaleLike): number[] => {
    const n = scale.domain.length;
    const r0 = scale.range[0]!;
    const r1 = scale.range[1]!;
    const span = r1 - r0;
    const bw = scale.bandwidth ?? span;
    if (n <= 1) return [0];
    const step = (span - bw) / (n - 1);
    return Array.from({ length: n }, (_, i) => i * step);
  };

  const colOrigins = bandOrigin(fx);
  const rowOrigins = bandOrigin(fy);

  // Within-cell plot ranges are cell-LOCAL (the same in every cell — shared scales).
  const xLo = Math.min(x.range[0]!, x.range[1]!);
  const xHi = Math.max(x.range[0]!, x.range[1]!);
  const yLo = Math.min(y.range[0]!, y.range[1]!);
  const yHi = Math.max(y.range[0]!, y.range[1]!);

  const cells: FacetCell[] = [];
  for (const p of panes) {
    const tx = colOrigins[p.col] ?? 0;
    const ty = rowOrigins[p.row] ?? 0;
    cells.push({
      facet: p.facet,
      col: p.col,
      row: p.row,
      title: p.title,
      x0: tx + xLo,
      x1: tx + xHi,
      y0: ty + yLo,
      y1: ty + yHi,
    });
  }
  return cells;
}

/**
 * PURE — resolve which facet cell a cursor (svgX, svgY) is over. A cursor inside a cell's
 * plot rect [x0,x1] x [y0,y1] matches that cell directly. Outside every plot rect we still
 * snap to the nearest cell BY ROW then COLUMN band, so hovering a pane's title row / inter-
 * pane gutter still attaches to the intended pane (mirrors the band crosshair's snap). Pass
 * `strict` to disable the nearest-snap and require containment (returns null outside). Returns
 * null when there are no cells.
 */
export function resolveFacetCell(
  cells: FacetCell[],
  svgX: number,
  svgY: number,
  strict = false,
): FacetCell | null {
  if (!cells.length) return null;
  for (const c of cells) {
    if (svgX >= c.x0 && svgX <= c.x1 && svgY >= c.y0 && svgY <= c.y1) return c;
  }
  if (strict) return null;
  // Nearest by clamped distance to each cell's plot rect.
  let best: FacetCell | null = null;
  let bestDist = Infinity;
  for (const c of cells) {
    const dx = svgX < c.x0 ? c.x0 - svgX : svgX > c.x1 ? svgX - c.x1 : 0;
    const dy = svgY < c.y0 ? c.y0 - svgY : svgY > c.y1 ? svgY - c.y1 : 0;
    const d = dx * dx + dy * dy;
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}

/**
 * PURE — build the tooltip inner HTML for ONE facet cell at the snapped x. Header is the
 * pane title + the formatted x label; then one row per series in `seriesOrder` that has a
 * finite value at `snappedX` in this facet's `bySeries` lookup. Mirrors attachCrosshair's
 * row markup (swatch + label + value, dashed handling). No DOM access.
 */
export function buildFacetTooltipHtml(
  title: string,
  xLabel: string,
  bySeries: Map<string, Map<number, number>>,
  snappedX: number,
  opts: {
    colors?: Map<string, string>;
    dashedSeries?: Set<string>;
    seriesLabels?: Record<string, string>;
    seriesOrder?: string[];
    yFormat: (v: number) => string;
  },
): string {
  const { colors, dashedSeries, seriesLabels, seriesOrder, yFormat } = opts;
  let html = `<div class="tbl-tooltip-head">${escapeHtml(title)} · ${escapeHtml(xLabel)}</div>`;
  const tipSeries =
    seriesOrder && seriesOrder.length
      ? seriesOrder.filter((s) => bySeries.has(s))
      : [...bySeries.keys()];
  for (const series of tipSeries) {
    const v = bySeries.get(series)!.get(snappedX);
    if (v == null || Number.isNaN(v)) continue;
    const dot = colors?.get(series) || "currentColor";
    const isDashed = dashedSeries?.has(series);
    const display = (seriesLabels && seriesLabels[series]) || series;
    const swatchClass = isDashed ? "tbl-tooltip-swatch is-dashed" : "tbl-tooltip-swatch";
    const swatchStyle = isDashed ? `--swatch-color: ${dot}` : `background: ${dot}`;
    html += `<div class="tbl-tooltip-row"><span class="${swatchClass}" style="${swatchStyle}"></span><span><span class="tbl-tooltip-label">${escapeHtml(display)}:</span> <span class="tbl-tooltip-value">${escapeHtml(yFormat(v))}</span></span></div>`;
  }
  return html;
}

/**
 * Attach a facet-aware crosshair to a SHARED-mode small-multiples LINE figure (one faceted
 * SVG). Resolves the cell under the cursor from Plot's faceted scales, draws a guide confined
 * to that cell's plot y-range, snaps to the shared x-domain, and shows a per-pane tooltip.
 *
 * Resilient to non-layout environments (jsdom/SSR): if `svg.scale` is unavailable or the
 * scales can't be read, it no-ops cleanly (browser verification carries correctness).
 */
export function attachFacetCrosshair(svgEl: SVGSVGElement, opts: FacetCrosshairOptions): void {
  const {
    panes,
    xField = "time",
    yField = "value",
    seriesField = "series",
    colors,
    dashedSeries,
    seriesLabels,
    seriesOrder,
  } = opts;
  let { xParse, xFormat } = opts;
  const yFormat =
    opts.yFormat ??
    ((v: number) => `${(+v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
  if (!svgEl || !panes?.length) return;

  const vb = svgEl.viewBox?.baseVal;
  const W = vb?.width || +(svgEl.getAttribute("width") ?? "") || svgEl.clientWidth;
  const H = vb?.height || +(svgEl.getAttribute("height") ?? "") || svgEl.clientHeight;

  // Feature-detect Plot's scale API; without it we cannot compute cell geometry → no-op.
  const scaleFn = (svgEl as unknown as { scale?: (name: string) => unknown }).scale;
  if (typeof scaleFn !== "function") return;
  let fx: BandScaleLike, fy: BandScaleLike, xS: ContinuousScaleLike, yS: ContinuousScaleLike;
  try {
    fx = scaleFn.call(svgEl, "fx") as BandScaleLike;
    fy = scaleFn.call(svgEl, "fy") as BandScaleLike;
    xS = scaleFn.call(svgEl, "x") as ContinuousScaleLike;
    yS = scaleFn.call(svgEl, "y") as ContinuousScaleLike;
  } catch {
    return;
  }
  if (!fx?.range || !fy?.range || !xS?.range || !yS?.range) return;

  const cells = computeFacetCells(
    fx,
    fy,
    xS,
    yS,
    panes.map((p) => ({ facet: p.facet, col: p.col, row: p.row, title: p.title })),
  );
  if (!cells.length) return;

  // x-parse/format inference (mirrors attachCrosshair) when the adapter didn't thread them.
  if (!xParse) {
    const sample = panes.find((p) => p.rows.length)?.rows[0]?.[xField];
    if (/^\d{4}-\d{2}-\d{2}/.test(String(sample))) {
      xParse = (v) => +new Date(String(v));
      if (!xFormat) xFormat = (v) => d3.timeFormat("%b %Y")(new Date(v));
    } else if (/Q\d/.test(String(sample))) {
      xParse = (v) => {
        const m = /(\d{4})Q(\d)/.exec(String(v));
        return +new Date(+(m as RegExpExecArray)[1]!, (+(m as RegExpExecArray)[2]! - 1) * 3, 1);
      };
      if (!xFormat)
        xFormat = (v) => {
          const d = new Date(v);
          const q = Math.floor(d.getMonth() / 3) + 1;
          return `${d.getFullYear()}Q${q}`;
        };
    } else {
      xParse = (v) => +(v as number);
      if (!xFormat) xFormat = (v) => String(v);
    }
  }

  // Per-facet lookup: facet → (sorted unique xs, series → x → value).
  interface FacetData { xs: number[]; bySeries: Map<string, Map<number, number>>; }
  const dataByFacet = new Map<string, FacetData>();
  for (const p of panes) {
    const xsSet = new Set<number>();
    const bySeries = new Map<string, Map<number, number>>();
    for (const r of p.rows) {
      const xv = xParse!(r[xField]);
      xsSet.add(xv);
      const v = r[yField];
      if (v === "" || v == null) continue;
      const k = r[seriesField] as string;
      if (!bySeries.has(k)) bySeries.set(k, new Map());
      bySeries.get(k)!.set(xv, +(v as number));
    }
    dataByFacet.set(p.facet, { xs: [...xsSet].sort((a, b) => a - b), bySeries });
  }

  const bisect = d3.bisector((d: number) => d).left;
  const NS = "http://www.w3.org/2000/svg";
  // Remove only THIS crosshair's own elements on re-attach (not the flat crosshair's
  // .tbl-crosshair*, which attachCrosshair owns) so the two never clobber each other.
  svgEl.querySelectorAll(".tbl-facet-crosshair, .tbl-facet-crosshair-hit").forEach((el) => el.remove());

  const guide = svgEl.ownerDocument.createElementNS(NS, "line");
  guide.classList.add("tbl-facet-crosshair");
  guide.setAttribute("stroke", TBL.color.annotationDim);
  guide.setAttribute("stroke-dasharray", "3 3");
  guide.setAttribute("opacity", "0");
  guide.style.pointerEvents = "none";
  svgEl.appendChild(guide);

  const hit = svgEl.ownerDocument.createElementNS(NS, "rect");
  hit.classList.add("tbl-facet-crosshair-hit");
  hit.setAttribute("x", "0");
  hit.setAttribute("y", "0");
  hit.setAttribute("width", String(W));
  hit.setAttribute("height", String(H));
  hit.setAttribute("fill", "transparent");
  hit.style.cursor = "crosshair";
  svgEl.appendChild(hit);

  const tip = getSharedTooltip(svgEl.ownerDocument);

  /** Snap an absolute svgX to the nearest x in `xs`, given this cell's [x0,x1] plot range. */
  function snapXInCell(svgX: number, cell: FacetCell, xs: number[]): number | null {
    if (!xs.length) return null;
    const xMin = xs[0]!;
    const xMax = xs[xs.length - 1]!;
    // Linear: shared x-domain maps across [cell.x0, cell.x1].
    const span = cell.x1 - cell.x0;
    const frac = span > 0 ? (svgX - cell.x0) / span : 0;
    const xVal = xMin + frac * (xMax - xMin);
    const i = bisect(xs, xVal);
    const cand = [xs[i - 1], xs[i]].filter((v) => v != null) as number[];
    if (!cand.length) return null;
    return cand.length === 1
      ? cand[0]!
      : Math.abs(cand[0]! - xVal) < Math.abs(cand[1]! - xVal)
        ? cand[0]!
        : cand[1]!;
  }

  /** Map a snapped x value to its absolute pixel within the cell. */
  function xToPxInCell(xVal: number, cell: FacetCell, xs: number[]): number {
    const xMin = xs[0]!;
    const xMax = xs[xs.length - 1]!;
    const frac = xMax > xMin ? (xVal - xMin) / (xMax - xMin) : 0;
    return cell.x0 + frac * (cell.x1 - cell.x0);
  }

  function update(evt: PointerEvent): void {
    const rect = svgEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const scaleX = W / rect.width;
    const scaleY = H / rect.height;
    const svgX = (evt.clientX - rect.left) * scaleX;
    const svgY = (evt.clientY - rect.top) * scaleY;

    const cell = resolveFacetCell(cells, svgX, svgY);
    if (!cell) { hide(); return; }
    const fd = dataByFacet.get(cell.facet);
    if (!fd || !fd.xs.length) { hide(); return; }

    const snap = snapXInCell(svgX, cell, fd.xs);
    if (snap == null) { hide(); return; }

    const gx = xToPxInCell(snap, cell, fd.xs);
    guide.setAttribute("x1", String(gx));
    guide.setAttribute("x2", String(gx));
    guide.setAttribute("y1", String(cell.y0));
    guide.setAttribute("y2", String(cell.y1));
    guide.setAttribute("opacity", "1");

    tip.innerHTML = buildFacetTooltipHtml(cell.title, xFormat!(snap), fd.bySeries, snap, {
      colors,
      dashedSeries,
      seriesLabels,
      seriesOrder,
      yFormat,
    });

    const offset = 14;
    const win = svgEl.ownerDocument.defaultView!;
    const vw = win.innerWidth;
    const vh = win.innerHeight;
    tip.style.opacity = "1";
    let left = evt.clientX + offset;
    let top = evt.clientY + offset;
    if (left + tip.offsetWidth + 4 > vw) left = evt.clientX - tip.offsetWidth - offset;
    if (top + tip.offsetHeight + 4 > vh) top = evt.clientY - tip.offsetHeight - offset;
    if (left < 4) left = 4;
    if (top < 4) top = 4;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  function hide(): void {
    guide.setAttribute("opacity", "0");
    tip.style.opacity = "0";
  }

  hit.style.pointerEvents = "all";
  hit.addEventListener("pointermove", update as EventListener);
  hit.addEventListener("pointerleave", hide);
  hit.addEventListener("pointerdown", update as EventListener);
}

// ---------------------------------------------------------------------------
// Band-axis (categorical) hover tooltip — bar / stacked charts
// ---------------------------------------------------------------------------

export interface BandCrosshairOptions {
  /** All rows in scope (dataInScope from renderChart). Each must have `_xc` (the category
   *  key), `series`, and `_y`. */
  rows: Array<{ _xc?: string; series: string; _y: number | null }>;
  /** True for stacked charts — enables the Total row logic in the tooltip. */
  isStacked?: boolean;
  /** Controls the Total row style for stacked charts (mirrors MarkLayers.showTotalDot).
   *  - true:      diverging/net-dot stack — Total row uses a circle (is-dot) swatch.
   *  - false:     cumulative stack — Total row shows as plain text with no swatch.
   *  - undefined: netDisplay:"none" or normalized — Total row is omitted entirely. */
  showTotalDot?: boolean;
  /** True when grouped bars use fx-faceted layout (xScaleField === "fx"). */
  isFaceted?: boolean;
  /** Ordered list of categories (declaration order → facet index order for fx layout). */
  categories?: string[];
  colors?: Map<string, string>;
  seriesLabels?: Record<string, string>;
  seriesOrder?: string[];
  yFormat?: (v: number) => string;
  /** Raw category value → display label for the tooltip header. */
  categoryLabels?: Record<string, string>;
  /** Series swatch shape in the tooltip — "rect" for bars (matches the legend), else line. */
  swatchShape?: "line" | "rect";
  /** Chart orientation — "horizontal" puts categories on the Y axis (band rows).
   *  Defaults to vertical (categories on X axis). */
  orientation?: "vertical" | "horizontal";
  /** Coordinated-cursor hook: called with the resolved category (and null on leave) so the
   *  live layer can echo a secondary cursor on sibling small-multiples panes. */
  onResolve?: (category: string | null) => void;
  /** Hit-test only: keep the pointer hit area + `onResolve` emission but draw NO highlight and
   *  show NO tooltip (the coordinated secondary renderer draws every pane's shaded region +
   *  labels instead). */
  emitOnly?: boolean;
}

/** A resolved band: the category key and its [xMin, xMax] in SVG user units. */
export interface CategoryBand {
  category: string;
  xMin: number;
  xMax: number;
}

/** A resolved horizontal band: the category key and its [yMin, yMax] in SVG user units.
 *  Used for horizontal bar charts where categories are on the Y axis. */
export interface CategoryBandH {
  category: string;
  yMin: number;
  yMax: number;
}

// ---------------------------------------------------------------------------
// PURE helpers (exported for unit tests)

/**
 * Widen a set of 1-D bands so each spans to the MIDPOINT between its neighbors'
 * centers — i.e. the full band STEP, not just the bar width. The hover highlight then
 * covers the surrounding padding gutters (half the gap on each side), so hovering the
 * space between bars still feels attached to the nearer bar.
 *
 * `bands` are the bar/cluster extents `[min, max]` (ascending by center). `lo`/`hi` are
 * the plot's axis edges, used only as a clamp so a band never spills past the plot.
 * Inner edges sit at the midpoint between adjacent centers; the OUTER edges of the first
 * and last bands extend a SYMMETRIC half-step (mirroring the nearest gap) rather than
 * stretching to the plot edge — so the end bars' highlight is balanced with the inner ones.
 * PURE — input bands are not mutated; new `[min, max]` pairs are returned in input order.
 */
export function widenBandsToMidpoints(
  bands: Array<{ min: number; max: number }>,
  lo: number,
  hi: number,
  boundaryAfter?: boolean[],
): Array<{ min: number; max: number }> {
  if (!bands.length) return [];
  const centers = bands.map((b) => (b.min + b.max) / 2);
  return centers.map((c, i) => {
    // A section boundary BEFORE band i (boundaryAfter[i-1]) or AFTER it (boundaryAfter[i]) removes
    // that neighbor for widening, so the edge falls back to a symmetric self half-step and never
    // crosses the spacer/header gap.
    const hasPrev = i > 0 && !(boundaryAfter?.[i - 1]);
    const hasNext = i < centers.length - 1 && !(boundaryAfter?.[i]);
    const prev = hasPrev ? centers[i - 1]! : null;
    const next = hasNext ? centers[i + 1]! : null;
    // Outer edges extend half the nearest gap past the bar center (symmetric with the
    // inner midpoints); a single band falls back to its own half-width. Clamp to [lo, hi]
    // so the highlight never exceeds the plot area.
    const left =
      prev != null ? (prev + c) / 2 : next != null ? c - (next - c) / 2 : (bands[i] as { min: number }).min;
    const right =
      next != null ? (c + next) / 2 : prev != null ? c + (c - prev) / 2 : (bands[i] as { max: number }).max;
    return { min: Math.max(lo, left), max: Math.min(hi, right) };
  });
}

/**
 * Given a list of CategoryBands and a cursor x in SVG user units, return the
 * category whose band contains x, or snap to the nearest band if x falls
 * between two bands. Returns null when bands is empty.
 */
export function resolveCategoryFromBands(
  bands: CategoryBand[],
  svgX: number,
): string | null {
  if (!bands.length) return null;

  // Check containment first.
  for (const b of bands) {
    if (svgX >= b.xMin && svgX <= b.xMax) return b.category;
  }

  // Snap to nearest band midpoint.
  let best: CategoryBand = bands[0]!;
  let bestDist = Infinity;
  for (const b of bands) {
    const mid = (b.xMin + b.xMax) / 2;
    const dist = Math.abs(svgX - mid);
    if (dist < bestDist) { bestDist = dist; best = b; }
  }
  return best.category;
}

/**
 * Given a list of CategoryBandH entries and a cursor y in SVG user units, return the
 * category whose y-band contains the cursor, or snap to the nearest band.
 * Used for horizontal bar charts where categories map to Y-axis rows.
 * Returns null when bands is empty.
 */
export function resolveCategoryFromBandsH(
  bands: CategoryBandH[],
  svgY: number,
): string | null {
  if (!bands.length) return null;

  // Check containment first.
  for (const b of bands) {
    if (svgY >= b.yMin && svgY <= b.yMax) return b.category;
  }

  // Snap to nearest band midpoint.
  let best: CategoryBandH = bands[0]!;
  let bestDist = Infinity;
  for (const b of bands) {
    const mid = (b.yMin + b.yMax) / 2;
    const dist = Math.abs(svgY - mid);
    if (dist < bestDist) { bestDist = dist; best = b; }
  }
  return best.category;
}

/**
 * Build the inner HTML for the band tooltip: header row + one row per series
 * present for `category`, ordered by `seriesOrder`, plus an optional Total row
 * for stacked charts. PURE — no DOM access.
 *
 * The Total row rendering depends on `showTotalDot`:
 *   - true:      dot-swatch circle (is-dot) — diverging stack with a net-dot marker.
 *   - false:     plain text label only (no swatch) — cumulative stack with text callout.
 *   - undefined: Total row is omitted — netDisplay:"none" / normalized stack.
 */
export function buildBandTooltipHtml(
  category: string,
  rows: Array<{ _xc?: string; series: string; _y: number | null }>,
  opts: {
    isStacked?: boolean;
    showTotalDot?: boolean;
    colors?: Map<string, string>;
    seriesLabels?: Record<string, string>;
    seriesOrder?: string[];
    yFormat?: (v: number) => string;
    /** Raw category value → display label for the tooltip header (e.g. "1" → "1st Decile"). */
    categoryLabels?: Record<string, string>;
    /** Series swatch shape — "rect" (filled square, matching a bar legend) or the default line. */
    swatchShape?: "line" | "rect";
    /** Series → the bar's ACTUAL rendered fill (bar_color / accent / category_colors), preferred
     *  over the series' base `colors` for the swatch so the tooltip marker matches the drawn bar
     *  — the same fill-first rule the 1.3.x value pill uses. Absent → fall back to `colors`. */
    renderedFills?: Map<string, string>;
  },
): string {
  const { isStacked, showTotalDot, colors, seriesLabels, seriesOrder, yFormat, categoryLabels, swatchShape, renderedFills } = opts;
  const fmt = yFormat ?? ((v: number) => String(v));

  // Collect values for this category, keyed by series.
  const catRows = rows.filter((r) => r._xc === category);
  const valBySeries = new Map<string, number>();
  for (const r of catRows) {
    if (r._y != null && Number.isFinite(r._y)) valBySeries.set(r.series, r._y);
  }

  const orderedSeries = seriesOrder && seriesOrder.length
    ? seriesOrder.filter((s) => valBySeries.has(s))
    : [...valBySeries.keys()];

  let html = `<div class="tbl-tooltip-head">${escapeHtml(categoryLabels?.[category] ?? category)}</div>`;
  let total = 0;
  for (const series of orderedSeries) {
    const v = valBySeries.get(series);
    if (v == null) continue;
    total += v;
    const dot = renderedFills?.get(series) || colors?.get(series) || "currentColor";
    const display = (seriesLabels && seriesLabels[series]) || series;
    // Swatch matches the chart's legend marker: a filled square for bars (default here is the
    // small line swatch, used by line charts).
    const swCls = swatchShape === "rect" ? "tbl-tooltip-swatch is-square" : "tbl-tooltip-swatch";
    html += `<div class="tbl-tooltip-row"><span class="${swCls}" style="background: ${dot}"></span><span><span class="tbl-tooltip-label">${escapeHtml(display)}:</span> <span class="tbl-tooltip-value">${escapeHtml(fmt(v))}</span></span></div>`;
  }

  // Total row: only for stacked charts with 2+ series, and only when showTotalDot is not
  // undefined (undefined = netDisplay:"none"/normalized — no net marker, no Total row).
  if (isStacked && orderedSeries.length > 1 && showTotalDot !== undefined) {
    if (showTotalDot) {
      // Diverging stack: Total row matches the net-dot marker and legend "Total" entry —
      // a CIRCLE swatch (white fill, black inset stroke). `is-dot` carries the circle
      // styling (see styles.ts); no inline color needed.
      html += `<div class="tbl-tooltip-row tbl-tooltip-row--total"><span class="tbl-tooltip-swatch is-dot"></span><span><span class="tbl-tooltip-label">Total:</span> <span class="tbl-tooltip-value">${escapeHtml(fmt(total))}</span></span></div>`;
    } else {
      // Cumulative stack: net callout is a text-above marker, not a dot — no swatch in
      // the tooltip either. Show Total as a plain label + value row.
      html += `<div class="tbl-tooltip-row tbl-tooltip-row--total"><span><span class="tbl-tooltip-label">Total:</span> <span class="tbl-tooltip-value">${escapeHtml(fmt(total))}</span></span></div>`;
    }
  }

  return html;
}

// ---------------------------------------------------------------------------

/**
 * Read the rendered bar rect geometry from `svgEl` and return one CategoryBand
 * per distinct category (vertical orientation — categories on X axis).
 *
 * - Single-band charts (stacked, single-series bar): all rects share the same
 *   `data-series` namespace; each distinct x-position (rounded to int) is a
 *   separate category. We derive category labels from `opts.categories` by
 *   matching sorted x-positions to sorted category order.
 * - Fx-faceted charts (grouped bars): each facet `<g>` wraps one category;
 *   we read the bounding box of each facet group and map them in fx-domain index
 *   order to `opts.categories`.
 */
function readCategoryBands(svgEl: SVGSVGElement, opts: BandCrosshairOptions): CategoryBand[] {
  const { isFaceted, categories = [] } = opts;

  if (isFaceted) {
    // Grouped bars: Plot wraps each fx category in a <g> with a translate transform.
    // The aria-label on the outer group may vary by Plot version; we match any <g>
    // that has a translate transform inside the facets container.
    const facetGroups = Array.from(
      svgEl.querySelectorAll<SVGGElement>('g[aria-label^="facet"]'),
    );
    // If that yields nothing, fall back to any <g> with role="presentation" that
    // contains bars — Plot's internal structure.
    const groups = facetGroups.length
      ? facetGroups
      : Array.from(svgEl.querySelectorAll<SVGGElement>('g[aria-label="bar"] > g'));

    if (!groups.length) return [];

    // Sort by x-translate to match facet order (category order).
    const parsed: Array<{ x: number; g: SVGGElement }> = [];
    for (const g of groups) {
      const transform = g.getAttribute("transform") ?? "";
      const m = /translate\(\s*([\d.+-]+)/.exec(transform);
      if (!m) continue;
      parsed.push({ x: parseFloat(m[1]!), g });
    }
    parsed.sort((a, b) => a.x - b.x);

    return parsed.map((p, i) => {
      const cat = categories[i] ?? String(i);
      // Use the rects inside the group to determine the x-range.
      const rects = Array.from(p.g.querySelectorAll<SVGRectElement>("rect"));
      if (!rects.length) {
        const tx = p.x;
        return { category: cat, xMin: tx, xMax: tx + 1 };
      }
      let xMin = Infinity;
      let xMax = -Infinity;
      for (const rect of rects) {
        const rx = parseFloat(rect.getAttribute("x") ?? "0") + p.x;
        const rw = parseFloat(rect.getAttribute("width") ?? "0");
        if (rx < xMin) xMin = rx;
        if (rx + rw > xMax) xMax = rx + rw;
      }
      return { category: cat, xMin, xMax };
    });
  }

  // Single-band: all rects for the bars share a common x for each category.
  // Group them by rounded x-coordinate.
  const allRects = Array.from(svgEl.querySelectorAll<SVGRectElement>('g[aria-label="bar"] rect'));
  if (!allRects.length) return [];

  // Group rects by their integer x (each category gets a distinct band x).
  const xToBand = new Map<number, { xMin: number; xMax: number }>();
  for (const rect of allRects) {
    const rx = parseFloat(rect.getAttribute("x") ?? "0");
    const rw = parseFloat(rect.getAttribute("width") ?? "0");
    const key = Math.round(rx);
    const existing = xToBand.get(key);
    if (!existing) {
      xToBand.set(key, { xMin: rx, xMax: rx + rw });
    } else {
      existing.xMin = Math.min(existing.xMin, rx);
      existing.xMax = Math.max(existing.xMax, rx + rw);
    }
  }

  // Sort by x position to match category declaration order.
  const sortedKeys = Array.from(xToBand.keys()).sort((a, b) => a - b);
  return sortedKeys.map((key, i) => {
    const band = xToBand.get(key)!;
    const cat = categories[i] ?? String(i);
    return { category: cat, xMin: band.xMin, xMax: band.xMax };
  });
}

/**
 * Read the rendered bar rect geometry from `svgEl` and return one CategoryBandH
 * per distinct category for HORIZONTAL orientation (categories on Y axis).
 *
 * - Single-band (single-series / stacked horizontal): all rects share the same y per
 *   category row; group by rounded y-coordinate.
 * - Fy-faceted (grouped horizontal): each category is its own ROW facet `<g>` translated
 *   by the facet's y origin (`translate(0,ty)`); the rect `y` is LOCAL to the facet, so we
 *   must add the facet translate. We read each facet group's absolute y-extent and map them
 *   in fy-domain (translate) order to `opts.categories` — the analog of the vertical
 *   fx-faceted branch in readCategoryBands.
 */
function readCategoryBandsH(
  svgEl: SVGSVGElement,
  opts: BandCrosshairOptions,
): { bands: CategoryBandH[]; boundaryAfter: boolean[] } {
  const { isFaceted, categories = [] } = opts;

  if (isFaceted) {
    // Grouped horizontal: Plot wraps each fy category in a <g translate(0,ty)> inside the
    // bar mark group. Read each facet group's absolute y-range from its rects. Sectioned axes
    // also emit an empty fy facet per section spacer slot (no <rect>); a real band immediately
    // followed by one of these is flagged in `boundaryAfter` so the hover highlight clamps at
    // the spacer instead of widening across it into the section header.
    const groups = Array.from(svgEl.querySelectorAll<SVGGElement>('g[aria-label="bar"] > g'));
    if (groups.length) {
      const parsed: Array<{ y: number; g: SVGGElement; hasRect: boolean }> = [];
      for (const g of groups) {
        const transform = g.getAttribute("transform") ?? "";
        const m = /translate\(\s*-?[\d.]+\s*[ ,]\s*([\d.+-]+)/.exec(transform);
        const ty = m ? parseFloat(m[1]!) : 0;
        parsed.push({ y: ty, g, hasRect: !!g.querySelector("rect") });
      }
      parsed.sort((a, b) => a.y - b.y);
      const bands: CategoryBandH[] = [];
      const boundaryAfter: boolean[] = [];
      let sawEmptySinceLastReal = false;
      let ci = 0;
      for (const p of parsed) {
        if (!p.hasRect) {
          if (bands.length) sawEmptySinceLastReal = true; // spacer block AFTER a real band
          continue;
        }
        if (sawEmptySinceLastReal && bands.length) boundaryAfter[bands.length - 1] = true;
        sawEmptySinceLastReal = false;
        const cat = categories[ci] ?? String(ci);
        ci++;
        const rects = Array.from(p.g.querySelectorAll<SVGRectElement>("rect"));
        let yMin = Infinity;
        let yMax = -Infinity;
        for (const rect of rects) {
          const ry = parseFloat(rect.getAttribute("y") ?? "0") + p.y;
          const rh = parseFloat(rect.getAttribute("height") ?? "0");
          if (ry < yMin) yMin = ry;
          if (ry + rh > yMax) yMax = ry + rh;
        }
        bands.push({ category: cat, yMin, yMax });
        boundaryAfter.push(false);
      }
      return { bands, boundaryAfter };
    }
    // Fall through to the single-band path if no facet groups were found (defensive).
  }

  const allRects = Array.from(svgEl.querySelectorAll<SVGRectElement>('g[aria-label="bar"] rect'));
  if (!allRects.length) return { bands: [], boundaryAfter: [] };

  // Group rects by rounded y-coordinate (each horizontal category row has a distinct y).
  const yToBand = new Map<number, { yMin: number; yMax: number }>();
  for (const rect of allRects) {
    const ry = parseFloat(rect.getAttribute("y") ?? "0");
    const rh = parseFloat(rect.getAttribute("height") ?? "0");
    const key = Math.round(ry);
    const existing = yToBand.get(key);
    if (!existing) {
      yToBand.set(key, { yMin: ry, yMax: ry + rh });
    } else {
      existing.yMin = Math.min(existing.yMin, ry);
      existing.yMax = Math.max(existing.yMax, ry + rh);
    }
  }

  // Sort by y position (top to bottom) to match category declaration order.
  const sortedKeys = Array.from(yToBand.keys()).sort((a, b) => a - b);
  const bands = sortedKeys.map((key, i) => {
    const band = yToBand.get(key)!;
    const cat = categories[i] ?? String(i);
    return { category: cat, yMin: band.yMin, yMax: band.yMax };
  });
  return { bands, boundaryAfter: bands.map(() => false) };
}

/**
 * Attach a category-based hover tooltip to a categorical (band-axis) chart SVG.
 * Resolves cursor x (vertical) or cursor y (horizontal) → category using rendered
 * rect geometry, shows a tooltip with per-series values and (for stacked) a Total
 * row, and draws a translucent area highlight over the hovered category's band.
 */
export function attachBandCrosshair(svgEl: SVGSVGElement, opts: BandCrosshairOptions): void {
  if (!svgEl || !opts.rows?.length) return;

  const horizontal = opts.orientation === "horizontal";

  const yFormat =
    opts.yFormat ??
    ((v: number) => `${(+v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

  const vb = svgEl.viewBox?.baseVal;
  const W = vb?.width || +(svgEl.getAttribute("width") ?? "") || svgEl.clientWidth;
  const H = vb?.height || +(svgEl.getAttribute("height") ?? "") || svgEl.clientHeight;

  const ml = +(svgEl.dataset.marginLeft ?? "") || 0;
  const mr = +(svgEl.dataset.marginRight ?? "") || 8;
  const mt = +(svgEl.dataset.marginTop ?? "") || 18;
  const mb = +(svgEl.dataset.marginBottom ?? "") || 28;

  const emitOnly = opts.emitOnly ?? false;
  const NS = "http://www.w3.org/2000/svg";

  // Remove any previously attached band-crosshair elements (hit area + highlight).
  svgEl.querySelectorAll(".tbl-band-crosshair-hit, .tbl-band-crosshair-hl").forEach((el) => el.remove());

  // Area highlight rect — drawn BEFORE the hit area so it sits above the bars but below
  // the pointer-events layer. Hidden by default (opacity 0). emitOnly (coordinated figure):
  // the secondary renderer draws the shaded region + labels, so skip the highlight + tooltip.
  const hl = emitOnly ? null : svgEl.ownerDocument.createElementNS(NS, "rect");
  if (hl) {
    hl.classList.add("tbl-band-crosshair-hl");
    hl.setAttribute("fill", TBL.color.annotationDim);
    hl.setAttribute("opacity", "0");
    hl.style.pointerEvents = "none";
    svgEl.appendChild(hl);
  }

  // Transparent hit area.
  const hit = svgEl.ownerDocument.createElementNS(NS, "rect");
  hit.classList.add("tbl-band-crosshair-hit");
  hit.setAttribute("x", "0");
  hit.setAttribute("y", "0");
  hit.setAttribute("width", String(W));
  hit.setAttribute("height", String(H));
  hit.setAttribute("fill", "transparent");
  hit.style.cursor = "default";
  svgEl.appendChild(hit);

  const tip = emitOnly ? null : getSharedTooltip(svgEl.ownerDocument);

  // Bar tooltips: color each series' swatch from the bar's ACTUAL rendered fill (bar_color /
  // accent / category_colors), not the series' base color — matching the 1.3.x value pill. Built
  // once from the rendered rects (fill is uniform per series; category_colors is single-series).
  // Only for bar swatches (swatchShape "rect"); line tooltips keep their series-color swatch,
  // which already equals the rendered stroke.
  const renderedFills = !emitOnly && opts.swatchShape === "rect"
    ? (() => {
        const m = new Map<string, string>();
        svgEl.querySelectorAll<SVGRectElement>('g[aria-label="bar"] rect').forEach((r) => {
          const s = r.getAttribute("data-series") ?? "";
          if (m.has(s)) return;
          const f = renderedRectFill(r, svgEl);
          if (f) m.set(s, f);
        });
        return m;
      })()
    : undefined;

  /** Show the highlight over the given band geometry, spanning the full plot axis. */
  function showHighlight(bandMin: number, bandMax: number): void {
    if (!hl) return;
    if (horizontal) {
      // Band is a y-row; highlight spans full plot width.
      hl.setAttribute("x", String(ml));
      hl.setAttribute("y", String(bandMin));
      hl.setAttribute("width", String(W - ml - mr));
      hl.setAttribute("height", String(Math.max(0, bandMax - bandMin)));
    } else {
      // Band is an x-column; highlight spans full plot height.
      hl.setAttribute("x", String(bandMin));
      hl.setAttribute("y", String(mt));
      hl.setAttribute("width", String(Math.max(0, bandMax - bandMin)));
      hl.setAttribute("height", String(H - mt - mb));
    }
    hl.setAttribute("opacity", "0.12");
  }

  function update(evt: PointerEvent): void {
    const rect = svgEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    let category: string | null = null;
    let hlMin = 0;
    let hlMax = 0;

    if (horizontal) {
      // Horizontal: resolve cursor Y → category via y-bands, widened to the midpoints
      // between adjacent rows (clamped to the plot's vertical edges).
      const scaleY = H / rect.height;
      const svgY = (evt.clientY - rect.top) * scaleY;
      const { bands: raw, boundaryAfter } = readCategoryBandsH(svgEl, opts);
      const wide = widenBandsToMidpoints(
        raw.map((b) => ({ min: b.yMin, max: b.yMax })),
        mt,
        H - mb,
        boundaryAfter,
      );
      const bands: CategoryBandH[] = raw.map((b, i) => ({
        category: b.category,
        yMin: wide[i]!.min,
        yMax: wide[i]!.max,
      }));
      category = resolveCategoryFromBandsH(bands, svgY);
      if (category) {
        const b = bands.find((x) => x.category === category);
        if (b) { hlMin = b.yMin; hlMax = b.yMax; }
      }
    } else {
      // Vertical: resolve cursor X → category via x-bands, widened to the midpoints
      // between adjacent bar/cluster centers (clamped to the plot's horizontal edges).
      const scaleX = W / rect.width;
      const svgX = (evt.clientX - rect.left) * scaleX;
      const raw = readCategoryBands(svgEl, opts);
      const wide = widenBandsToMidpoints(
        raw.map((b) => ({ min: b.xMin, max: b.xMax })),
        ml,
        W - mr,
      );
      const bands: CategoryBand[] = raw.map((b, i) => ({
        category: b.category,
        xMin: wide[i]!.min,
        xMax: wide[i]!.max,
      }));
      category = resolveCategoryFromBands(bands, svgX);
      if (category) {
        const b = bands.find((x) => x.category === category);
        if (b) { hlMin = b.xMin; hlMax = b.xMax; }
      }
    }

    if (!category) { hide(); return; }

    opts.onResolve?.(category);
    if (emitOnly) return;

    showHighlight(hlMin, hlMax);

    const html = buildBandTooltipHtml(category, opts.rows, {
      isStacked: opts.isStacked,
      showTotalDot: opts.showTotalDot,
      colors: opts.colors,
      seriesLabels: opts.seriesLabels,
      seriesOrder: opts.seriesOrder,
      yFormat,
      categoryLabels: opts.categoryLabels,
      swatchShape: opts.swatchShape,
      renderedFills,
    });
    tip!.innerHTML = html;

    const offset = 14;
    const win = svgEl.ownerDocument.defaultView!;
    const vw = win.innerWidth;
    const vh = win.innerHeight;
    tip!.style.opacity = "1";
    let left = evt.clientX + offset;
    let top = evt.clientY + offset;
    if (left + tip!.offsetWidth + 4 > vw) left = evt.clientX - tip!.offsetWidth - offset;
    if (top + tip!.offsetHeight + 4 > vh) top = evt.clientY - tip!.offsetHeight - offset;
    if (left < 4) left = 4;
    if (top < 4) top = 4;
    tip!.style.left = `${left}px`;
    tip!.style.top = `${top}px`;
  }

  function hide(): void {
    if (hl) hl.setAttribute("opacity", "0");
    if (tip) tip.style.opacity = "0";
    opts.onResolve?.(null);
  }

  hit.style.pointerEvents = "all";
  hit.addEventListener("pointermove", update as EventListener);
  hit.addEventListener("pointerleave", hide);
  hit.addEventListener("pointerdown", update as EventListener);
}

// ---------------------------------------------------------------------------
// Histogram (continuous-bin) hover tooltip
// ---------------------------------------------------------------------------
// Histograms have a numeric/temporal x, but their bars are BINNED — each row carries the bin's
// edge values (`_x0`/`_x1`) and height (`_y`), not a single x. The continuous `attachCrosshair`
// needs a `time` field the binned rows don't have, so it never fires. This primitive mirrors
// `attachBandCrosshair`, but resolves a continuous BIN by x-extent (rather than a category): it
// shades the hovered bin's full x-span across the plot height and shows a shared tooltip headed
// by the bin RANGE `[x0, x1)` with one row per in-scope series' height in that bin.

export interface HistogramHoverOptions {
  /** Binned rows in scope (dataInScope). Each carries `_x0`/`_x1` (bin edges — numeric, or epoch-ms
   *  for a temporal x), `series`, and `_y` (bar height). Rows missing either edge are ignored. */
  rows: Array<{ _x0?: number; _x1?: number; _y: number | null; series: string }>;
  colors?: Map<string, string>;
  seriesLabels?: Record<string, string>;
  seriesOrder?: string[];
  yFormat?: (v: number) => string;
  /** Legacy: a bin-edge formatter. Superseded by `label` for the histogram header (kept so existing
   *  callers don't break); no longer used to build the range header. */
  xFormat?: (v: number) => string;
  /** Drives the friendly bin-range header (numeric range / temporal period-or-range). See
   *  `formatBinLabel`. When absent, defaults to a plain numeric en-dash range. */
  label?: BinLabelOpts;
  /** Coordinated small-multiples: on each resolve, emit the hovered bin's `x0` (a DATA-x value, not
   *  the index — so echo panes re-resolve their own bin robustly), or null on leave. */
  onResolve?: (key: number | null) => void;
  /** Coordinated small-multiples: hit-test + emit only (no highlight/tooltip drawn); the secondary
   *  cursor renders the echo on every pane. */
  emitOnly?: boolean;
}

/** A histogram bin: its edge values + per-series height. Derived from the binned rows. */
export interface HistogramBin {
  x0: number;
  x1: number;
  /** series key → bar height in this bin (only finite, non-null heights present). */
  bySeries: Map<string, number>;
}

/**
 * PURE — collapse binned rows into sorted unique bins (ascending by `_x0`). Every distinct
 * `_x0`/`_x1` pair is a bin; each in-scope series' finite `_y` is recorded under it. Rows missing
 * an edge are skipped. No DOM access.
 */
export function buildHistogramBins(
  rows: Array<{ _x0?: number; _x1?: number; _y: number | null; series: string }>,
): HistogramBin[] {
  const byKey = new Map<string, HistogramBin>();
  for (const r of rows) {
    if (r._x0 == null || r._x1 == null) continue;
    const key = `${r._x0}:${r._x1}`;
    let bin = byKey.get(key);
    if (!bin) {
      bin = { x0: r._x0, x1: r._x1, bySeries: new Map() };
      byKey.set(key, bin);
    }
    if (r._y != null && Number.isFinite(r._y)) bin.bySeries.set(r.series, r._y);
  }
  return [...byKey.values()].sort((a, b) => a.x0 - b.x0);
}

/**
 * PURE — given bin pixel spans `[min,max]` (ascending) and a cursor x in SVG user units, return
 * the index of the bin whose span contains x, or snap to the nearest bin center when x falls in a
 * gap / outside. Returns null only when there are no spans. Mirrors resolveCategoryFromBands.
 */
export function resolveHistogramBinIndex(
  spans: Array<{ min: number; max: number }>,
  svgX: number,
): number | null {
  if (!spans.length) return null;
  for (let i = 0; i < spans.length; i++) {
    if (svgX >= spans[i]!.min && svgX <= spans[i]!.max) return i;
  }
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < spans.length; i++) {
    const mid = (spans[i]!.min + spans[i]!.max) / 2;
    const d = Math.abs(svgX - mid);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

/**
 * PURE — build the tooltip inner HTML for ONE histogram bin. Header is the friendly bin label from
 * `formatBinLabel` (numeric en-dash range / temporal period-or-range); then one row per series
 * (ordered by `seriesOrder`) with a finite height in this bin. Mirrors attachBandCrosshair's
 * bar-swatch row markup (filled square + label + value). No DOM access.
 */
export function buildHistogramTooltipHtml(
  bin: HistogramBin,
  opts: {
    colors?: Map<string, string>;
    seriesLabels?: Record<string, string>;
    seriesOrder?: string[];
    yFormat?: (v: number) => string;
    /** Drives the friendly bin-range header. Absent ⇒ a plain numeric en-dash range. */
    label?: BinLabelOpts;
    /** series → the bar's ACTUAL rendered fill, preferred over `colors` for the swatch so the
     *  tooltip marker matches the drawn bar (mirrors the band tooltip's fill-first rule). */
    renderedFills?: Map<string, string>;
  },
): string {
  const { colors, seriesLabels, seriesOrder, renderedFills } = opts;
  const yFormat = opts.yFormat ?? ((v: number) => String(v));

  const header = formatBinLabel(bin.x0, bin.x1, opts.label ?? { xType: "numeric", interval: null });
  let html = `<div class="tbl-tooltip-head">${escapeHtml(header)}</div>`;

  const ordered =
    seriesOrder && seriesOrder.length
      ? seriesOrder.filter((s) => bin.bySeries.has(s))
      : [...bin.bySeries.keys()];
  for (const series of ordered) {
    const v = bin.bySeries.get(series);
    if (v == null || Number.isNaN(v)) continue;
    const dot = renderedFills?.get(series) || colors?.get(series) || "currentColor";
    const display = (seriesLabels && seriesLabels[series]) || series;
    // Filled-square swatch matches the histogram legend (bars, not lines) — same as bar tooltips.
    html += `<div class="tbl-tooltip-row"><span class="tbl-tooltip-swatch is-square" style="background: ${dot}"></span><span><span class="tbl-tooltip-label">${escapeHtml(display)}:</span> <span class="tbl-tooltip-value">${escapeHtml(yFormat(v))}</span></span></div>`;
  }
  return html;
}

/**
 * Attach a per-bin hover tooltip to a histogram SVG (numeric/temporal x, binned bars). Resolves
 * the bin under the cursor from a data-x → pixel map anchored on the rendered rect geometry (robust
 * across the multi-layer, one-`<g aria-label="rect">`-per-series DOM), shades that bin's full x-span
 * across the plot height, and shows a shared tooltip headed by the bin range with each in-scope
 * series' height. Lifecycle mirrors attachBandCrosshair (idempotent re-attach; hide on leave).
 */
/** The shared bin GEOMETRY for a histogram SVG: the sorted bins, the data-x→pixel map anchored on
 *  the rendered rect extents, each bin's pixel span, the plot margins, and each series' rendered
 *  fill. Reads only rect x/width attributes + margins (no layout / no scale API — works in jsdom).
 *  Returns null when there are no bins. Shared by the primary hover and the coordinated (secondary)
 *  cursor so both resolve bins from the SAME map. */
function buildHistogramGeom(
  svgEl: SVGSVGElement,
  rows: Array<{ _x0?: number; _x1?: number; _y: number | null; series: string }>,
): {
  bins: HistogramBin[];
  W: number; H: number; ml: number; mr: number; mt: number; mb: number;
  xToPx: (x: number) => number;
  spans: Array<{ min: number; max: number }>;
  renderedFills: Map<string, string>;
} | null {
  const bins = buildHistogramBins(rows);
  if (!bins.length) return null;

  const vb = svgEl.viewBox?.baseVal;
  const W = vb?.width || +(svgEl.getAttribute("width") ?? "") || svgEl.clientWidth;
  const H = vb?.height || +(svgEl.getAttribute("height") ?? "") || svgEl.clientHeight;
  const ml = +(svgEl.dataset.marginLeft ?? "") || 0;
  const mr = +(svgEl.dataset.marginRight ?? "") || 8;
  const mt = +(svgEl.dataset.marginTop ?? "") || 18;
  const mb = +(svgEl.dataset.marginBottom ?? "") || 28;

  // Establish the data-x → pixel mapping from the rendered rect geometry: the leftmost rect edge
  // maps to the smallest bin edge and the rightmost to the largest. Histogram bars are edge-to-edge
  // (no band padding), so this single linear map places every bin's [x0,x1] span exactly. Falls
  // back to plot margins if no rects.
  const rects = Array.from(svgEl.querySelectorAll<SVGRectElement>('g[aria-label="rect"] rect'));
  let pxMinAll = Infinity;
  let pxMaxAll = -Infinity;
  for (const r of rects) {
    const rx = parseFloat(r.getAttribute("x") ?? "0");
    const rw = parseFloat(r.getAttribute("width") ?? "0");
    if (rx < pxMinAll) pxMinAll = rx;
    if (rx + rw > pxMaxAll) pxMaxAll = rx + rw;
  }
  const dataXmin = bins[0]!.x0;
  const dataXmax = bins[bins.length - 1]!.x1;
  const span = dataXmax - dataXmin;
  const haveGeom =
    Number.isFinite(pxMinAll) && Number.isFinite(pxMaxAll) && pxMaxAll > pxMinAll && span > 0;
  const xToPx = haveGeom
    ? (x: number) => pxMinAll + ((x - dataXmin) / span) * (pxMaxAll - pxMinAll)
    : (x: number) => ml + ((x - dataXmin) / (span || 1)) * (W - ml - mr);
  const spans = bins.map((b) => ({ min: xToPx(b.x0), max: xToPx(b.x1) }));

  // Bar tooltips/pills color each swatch from the bar's ACTUAL rendered fill (bar_color / accent /
  // palette), matching the band tooltip — built once from the rendered rects (fill uniform per series).
  const renderedFills = (() => {
    const m = new Map<string, string>();
    for (const r of rects) {
      const s = r.getAttribute("data-series") ?? "";
      if (m.has(s)) continue;
      const f = renderedRectFill(r, svgEl);
      if (f) m.set(s, f);
    }
    return m;
  })();

  return { bins, W, H, ml, mr, mt, mb, xToPx, spans, renderedFills };
}

export function attachHistogramHover(svgEl: SVGSVGElement, opts: HistogramHoverOptions): void {
  if (!svgEl || !opts.rows?.length) return;

  const geom = buildHistogramGeom(svgEl, opts.rows);
  if (!geom) return;
  const { bins, W, H, mt, mb, spans, renderedFills } = geom;
  const emitOnly = opts.emitOnly ?? false;

  const yFormat =
    opts.yFormat ??
    ((v: number) => `${(+v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

  const NS = "http://www.w3.org/2000/svg";
  svgEl.querySelectorAll(".tbl-hist-hover-hit, .tbl-hist-hover-hl").forEach((el) => el.remove());

  // Highlight rect — drawn BEFORE the hit area so it sits above the bars but below the pointer
  // layer. Hidden by default (opacity 0). emitOnly (coordinated figure): the secondary renderer
  // draws the shaded region + labels on every pane, so skip the highlight + tooltip.
  const hl = emitOnly ? null : svgEl.ownerDocument.createElementNS(NS, "rect");
  if (hl) {
    hl.classList.add("tbl-hist-hover-hl");
    hl.setAttribute("fill", TBL.color.annotationDim);
    hl.setAttribute("opacity", "0");
    hl.style.pointerEvents = "none";
    svgEl.appendChild(hl);
  }

  const hit = svgEl.ownerDocument.createElementNS(NS, "rect");
  hit.classList.add("tbl-hist-hover-hit");
  hit.setAttribute("x", "0");
  hit.setAttribute("y", "0");
  hit.setAttribute("width", String(W));
  hit.setAttribute("height", String(H));
  hit.setAttribute("fill", "transparent");
  hit.style.cursor = "default";
  svgEl.appendChild(hit);

  const tip = emitOnly ? null : getSharedTooltip(svgEl.ownerDocument);

  /** Shade the hovered bin's x-span across the full plot height. */
  function showHighlight(min: number, max: number): void {
    if (!hl) return;
    hl.setAttribute("x", String(min));
    hl.setAttribute("y", String(mt));
    hl.setAttribute("width", String(Math.max(0, max - min)));
    hl.setAttribute("height", String(H - mt - mb));
    hl.setAttribute("opacity", "0.12");
  }

  function update(evt: PointerEvent): void {
    const rect = svgEl.getBoundingClientRect();
    if (!rect.width) return;
    const scaleX = W / rect.width;
    const svgX = (evt.clientX - rect.left) * scaleX;

    const idx = resolveHistogramBinIndex(spans, svgX);
    if (idx == null) { hide(); return; }
    const bin = bins[idx]!;

    // Emit the bin CENTER (a DATA-x value) so echo panes re-resolve their own bin. Must be the
    // center, not an edge: bars are edge-to-edge (bins[k-1].x1 === bins[k].x0) and
    // resolveHistogramBinIndex is inclusive on both ends returning the FIRST match, so an edge value
    // would resolve to the PREVIOUS bin. When emitOnly, draw nothing here (the secondary renders all).
    opts.onResolve?.((bin.x0 + bin.x1) / 2);
    if (emitOnly) return;

    showHighlight(spans[idx]!.min, spans[idx]!.max);

    tip!.innerHTML = buildHistogramTooltipHtml(bin, {
      colors: opts.colors,
      seriesLabels: opts.seriesLabels,
      seriesOrder: opts.seriesOrder,
      yFormat,
      label: opts.label,
      renderedFills,
    });

    const offset = 14;
    const win = svgEl.ownerDocument.defaultView!;
    const vw = win.innerWidth;
    const vh = win.innerHeight;
    tip!.style.opacity = "1";
    let left = evt.clientX + offset;
    let top = evt.clientY + offset;
    if (left + tip!.offsetWidth + 4 > vw) left = evt.clientX - tip!.offsetWidth - offset;
    if (top + tip!.offsetHeight + 4 > vh) top = evt.clientY - tip!.offsetHeight - offset;
    if (left < 4) left = 4;
    if (top < 4) top = 4;
    tip!.style.left = `${left}px`;
    tip!.style.top = `${top}px`;
  }

  function hide(): void {
    if (hl) hl.setAttribute("opacity", "0");
    if (tip) tip.style.opacity = "0";
    opts.onResolve?.(null);
  }

  hit.style.pointerEvents = "all";
  hit.addEventListener("pointermove", update as EventListener);
  hit.addEventListener("pointerleave", hide);
  hit.addEventListener("pointerdown", update as EventListener);
}

/**
 * Attach a coordinated cursor to a HISTOGRAM small-multiples pane. Returns a driver keyed by a bin
 * `x0` (data-x): `driver(x0, active)` re-resolves THIS pane's bin (shared mode guarantees identical
 * thresholds, so the bin sets match; keying on x0 also degrades gracefully if edges ever drift),
 * shades its span, and lays a per-series height pill above each bar (staggered on collision). When
 * `active`, the bin range is drawn as an axis pill (same `formatBinLabel` as the hover tooltip).
 * `driver(null)` clears. No pointer handlers (externally driven by the figure bus). Built on the
 * SAME bin geometry as the primary hover (buildHistogramGeom). */
export function attachSecondaryHistogramCursor(
  svgEl: SVGSVGElement,
  opts: HistogramHoverOptions,
): (key: number | null, active?: boolean) => void {
  const noop = (): void => {};
  if (!svgEl || !opts.rows?.length) return noop;
  const geom = buildHistogramGeom(svgEl, opts.rows);
  if (!geom) return noop;
  const { bins, H, mt, mb, xToPx, spans, renderedFills } = geom;
  const plotH = H - mt - mb;
  const yFormat =
    opts.yFormat ?? ((v: number) => `${(+v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

  // Bucket the rendered bar rects by bin (via each rect center → its span), reading only attributes
  // so it works in jsdom (mirrors buildRectsByCategory for bars). Each carries the pill anchor.
  const rectsByBin = new Map<number, Array<{ series: string; cx: number; y: number; fill: string | null }>>();
  for (const r of Array.from(svgEl.querySelectorAll<SVGRectElement>('g[aria-label="rect"] rect'))) {
    const rx = parseFloat(r.getAttribute("x") ?? "0");
    const rw = parseFloat(r.getAttribute("width") ?? "0");
    const cx = rx + rw / 2;
    const idx = resolveHistogramBinIndex(spans, cx);
    if (idx == null) continue;
    if (!rectsByBin.has(idx)) rectsByBin.set(idx, []);
    rectsByBin.get(idx)!.push({
      series: r.getAttribute("data-series") ?? "",
      cx,
      y: parseFloat(r.getAttribute("y") ?? "0"),
      fill: renderedRectFill(r, svgEl),
    });
  }

  const order = opts.seriesOrder && opts.seriesOrder.length ? opts.seriesOrder : null;
  const colorFor = (s: string) => renderedFills.get(s) || opts.colors?.get(s) || COORD_LABEL_DARK;
  const doc = svgEl.ownerDocument;
  const g = makeCoordGroup(svgEl);
  const axisRows = makeAxisRows(svgEl, mt + plotH);

  return (key: number | null, active = false): void => {
    while (g.firstChild) g.removeChild(g.firstChild);
    if (key == null) {
      g.setAttribute("opacity", "0");
      return;
    }
    const idx = resolveHistogramBinIndex(spans, xToPx(key));
    if (idx == null) {
      g.setAttribute("opacity", "0");
      return;
    }
    const bin = bins[idx]!;
    // Shade the bin's full x-span across the plot height (same visual as the hover highlight).
    addCoordRegion(g, doc, spans[idx]!.min, spans[idx]!.max - spans[idx]!.min, mt, plotH);
    const weight = active ? 700 : 600;

    // Per-series height pill ABOVE each bar (staggered on horizontal collision), matching the
    // vertical-bar secondary convention. Ordered by seriesOrder when given.
    const rects = rectsByBin.get(idx) ?? [];
    const orderedRects = order
      ? (order.map((s) => rects.find((r) => r.series === s)).filter(Boolean) as typeof rects)
      : rects;
    const valid = orderedRects
      .map((rect) => ({ rect, v: bin.bySeries.get(rect.series) }))
      .filter((x) => x.v != null && Number.isFinite(x.v)) as Array<
      { rect: { series: string; cx: number; y: number; fill: string | null }; v: number }
    >;
    const ys = staggerBarLabels(
      valid.map((x) => ({ cx: x.rect.cx, w: coordPillWidth(yFormat(x.v)), value: x.v, y: x.rect.y - 9 })),
      COORD_PILL_H,
    );
    valid.forEach((x, i) =>
      addCoordPill(g, doc, x.rect.cx, ys[i]!, "middle", yFormat(x.v), x.rect.fill ?? colorFor(x.rect.series), weight),
    );

    // Active (hovered) pane: draw the bin range on the x-axis row as a frosted pill, using the SAME
    // label formatter/opts as the hover tooltip so the coordinated label matches.
    if (active) {
      const rowYs = axisRows.get();
      if (rowYs.length) {
        const cx = (spans[idx]!.min + spans[idx]!.max) / 2;
        const text = formatBinLabel(bin.x0, bin.x1, opts.label ?? { xType: "numeric", interval: null });
        addCoordAxisLabel(g, doc, cx, [{ text, cy: rowYs[0]! }]);
      }
    }
    g.setAttribute("opacity", "1");
  };
}

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

/** Read a linear value→pixel mapper from Plot's y-scale, or null if unavailable. */
function readLinearYScale(svgEl: SVGSVGElement): ((v: number) => number) | null {
  const scaleFn = (svgEl as unknown as { scale?: (n: string) => unknown }).scale;
  if (typeof scaleFn !== "function") return null;
  try {
    const y = scaleFn.call(svgEl, "y") as { domain?: number[]; range?: number[] } | undefined;
    const d = y?.domain;
    const r = y?.range;
    if (!d || !r || d.length < 2 || r.length < 2 || d[1] === d[0]) return null;
    const d0 = d[0]!, d1 = d[1]!, r0 = r[0]!, r1 = r[1]!;
    return (v: number) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
  } catch {
    return null;
  }
}

const COORD_NS = "http://www.w3.org/2000/svg";
/** Dark text for value labels on bars/stacked + the active x-axis value (matches bar value labels). */
const COORD_LABEL_DARK = "#1A1A2E";
/** Net-total pill text: true black, matching the net dot's black stroke (Style-Guide mark-black). */
const TOTAL_PILL_COLOR = "#000000";

/**
 * Append a hollow highlight marker (white fill, series-color ring) to the coord group. When a
 * `symbol` is given (the series' marker shape), the highlight takes that shape so it matches the
 * static point marker it sits over; otherwise a circle. Sized a touch larger than the static
 * marker so it reads as a highlight ring.
 */
function addCoordDot(g: SVGGElement, doc: Document, cx: number, cy: number, color: string, symbol?: string): void {
  if (symbol && symbol !== "circle") {
    const p = doc.createElementNS(COORD_NS, "path");
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
function addCoordPill(
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
const COORD_PILL_H = 16;

/**
 * PURE — de-collide a set of label y-centers so adjacent pills don't overlap. Labels are pushed
 * apart to at least `minGap`, preserving their order (sorted by y), then the run is clamped into
 * [lo, hi]. Input `ys` are the ideal positions (the data points); the returned array (same order
 * as input) is where the LABELS should sit — the dots still mark the true points.
 */
export function spreadLabelYs(ys: number[], minGap: number, lo: number, hi: number): number[] {
  const n = ys.length;
  if (n <= 1) return ys.slice();
  const order = ys.map((_, i) => i).sort((a, b) => ys[a]! - ys[b]!);
  const placed = order.map((i) => ys[i]!);
  for (let i = 1; i < n; i++) {
    if (placed[i]! < placed[i - 1]! + minGap) placed[i] = placed[i - 1]! + minGap;
  }
  // Clamp the run into [lo, hi]: shift up if it overflows the bottom, then down if it then
  // overflows the top (when the stack is taller than the range, the top wins / it overflows down).
  const overflow = placed[n - 1]! - hi;
  if (overflow > 0) for (let i = 0; i < n; i++) placed[i]! -= overflow;
  if (placed[0]! < lo) { const s = lo - placed[0]!; for (let i = 0; i < n; i++) placed[i]! += s; }
  const out = new Array<number>(n);
  order.forEach((origIdx, k) => { out[origIdx] = placed[k]!; });
  return out;
}

/** Create the (re-attachable) coordinated-cursor group on an SVG. */
function makeCoordGroup(svgEl: SVGSVGElement): SVGGElement {
  svgEl.querySelectorAll(".tbl-coord").forEach((el) => el.remove());
  const g = svgEl.ownerDocument.createElementNS(COORD_NS, "g");
  g.classList.add("tbl-coord");
  g.setAttribute("opacity", "0");
  g.style.pointerEvents = "none";
  svgEl.appendChild(g);
  return g;
}

/** Draw the thin muted vertical guide line (line panes) into the coord group. */
function addCoordGuide(g: SVGGElement, doc: Document, x: number, yTop: number, yBot: number): void {
  const guide = doc.createElementNS(COORD_NS, "line");
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
function addCoordRegion(g: SVGGElement, doc: Document, x: number, w: number, yTop: number, h: number): void {
  const r = doc.createElementNS(COORD_NS, "rect");
  r.setAttribute("x", String(x));
  r.setAttribute("y", String(yTop));
  r.setAttribute("width", String(Math.max(0, w)));
  r.setAttribute("height", String(Math.max(0, h)));
  r.setAttribute("fill", TBL.color.annotationDim);
  r.setAttribute("opacity", "0.12");
  g.appendChild(r);
}

/**
 * Read the x-axis label ROW y-centers for a pane (top→bottom, in user coords), so the active
 * pane's highlighted x value can be drawn on the SAME row(s) as the axis ticks — matching the
 * axis's line breaks (e.g. the two-tier temporal axis: a month row + a year row). Geometry is
 * read in screen space (getBoundingClientRect), cached per attach; without layout (jsdom) the
 * list is empty and the caller skips the label.
 */
function makeAxisRows(svgEl: SVGSVGElement, plotBottom: number) {
  let rows: number[] | null = null;
  const build = (): void => {
    rows = [];
    const svgRect = svgEl.getBoundingClientRect();
    if (!svgRect.width || !svgRect.height) return;
    const vb = svgEl.viewBox?.baseVal;
    const Hd = vb?.height || +(svgEl.getAttribute("height") ?? "") || svgRect.height;
    const sy = Hd / svgRect.height;
    const ys: number[] = [];
    for (const t of Array.from(svgEl.querySelectorAll<SVGTextElement>("text"))) {
      if (t.closest(".tbl-coord") || t.closest(".tbl-y-tick-label")) continue;
      const r = t.getBoundingClientRect();
      if (!r.width) continue;
      const top = (r.top - svgRect.top) * sy;
      if (top < plotBottom - 2) continue; // only labels below the plot area (the x-axis)
      ys.push(((r.top + r.bottom) / 2 - svgRect.top) * sy);
    }
    ys.sort((a, b) => a - b);
    // Cluster into distinct rows (month tier, year tier, …).
    const clustered: number[] = [];
    for (const y of ys) {
      if (!clustered.length || y - clustered[clustered.length - 1]! > 4) clustered.push(y);
    }
    rows = clustered;
  };
  return {
    get(): number[] {
      if (!rows) build();
      return rows ?? [];
    },
  };
}

/**
 * Draw the active pane's highlighted x value as text on a frosted pill, one line per axis row so
 * the line breaks match the axis (e.g. month on the first row, year on the second). Centered on
 * `cx`; bold + dark so it reads as the highlighted axis label.
 */
function addCoordAxisLabel(
  g: SVGGElement,
  doc: Document,
  cx: number,
  lines: Array<{ text: string; cy: number }>,
): void {
  if (!lines.length) return;
  const fontSize = 10.5;
  const padX = 4;
  const padY = 2;
  const w = Math.max(...lines.map((l) => l.text.length)) * fontSize * 0.62 + padX * 2;
  const top = Math.min(...lines.map((l) => l.cy)) - fontSize / 2 - padY;
  const bot = Math.max(...lines.map((l) => l.cy)) + fontSize / 2 + padY;
  const rect = doc.createElementNS(COORD_NS, "rect");
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
}

/** Detect how the rendered categorical x-axis labels are laid out, so the active-pane highlight
 *  can match: "rotate" if a below-plot label carries a rotate transform, "wrap" if one renders as
 *  multiple lines (>1 tspan), else "single". */
function detectBandLabelMode(svgEl: SVGSVGElement, plotBottom: number): "single" | "wrap" | "rotate" {
  const svgRect = svgEl.getBoundingClientRect();
  if (!svgRect.height) return "single";
  const vb = svgEl.viewBox?.baseVal;
  const Hd = vb?.height || +(svgEl.getAttribute("height") ?? "") || svgRect.height;
  const sy = Hd / svgRect.height;
  // Scan ALL x-axis labels: rotation is all-or-nothing (short-circuit), but only MULTI-word
  // labels wrap — so a single-word label (e.g. "Total") must not mask a wrapped neighbour.
  let mode: "single" | "wrap" = "single";
  for (const t of Array.from(svgEl.querySelectorAll<SVGTextElement>("text"))) {
    if (t.closest(".tbl-coord") || t.closest(".tbl-y-tick-label")) continue;
    const r = t.getBoundingClientRect();
    if (!r.width) continue;
    if ((r.top - svgRect.top) * sy < plotBottom - 2) continue; // x-axis labels only
    if (/rotate/.test(t.getAttribute("transform") ?? "")) return "rotate";
    if (t.querySelectorAll("tspan").length > 1) mode = "wrap";
  }
  return mode;
}

/** Locate the rendered x-axis label for `category` and return its box in SVG user coords (center
 *  + top/bottom), so the highlight can be aligned exactly to it regardless of mode. Matches on
 *  whitespace-insensitive text (a wrapped label's tspans concatenate without the space). */
function findAxisLabelBox(
  svgEl: SVGSVGElement,
  plotBottom: number,
  category: string,
): { cx: number; cy: number; top: number; bot: number } | null {
  const svgRect = svgEl.getBoundingClientRect();
  if (!svgRect.width || !svgRect.height) return null;
  const vb = svgEl.viewBox?.baseVal;
  const Wd = vb?.width || +(svgEl.getAttribute("width") ?? "") || svgRect.width;
  const Hd = vb?.height || +(svgEl.getAttribute("height") ?? "") || svgRect.height;
  const sx = Wd / svgRect.width;
  const sy = Hd / svgRect.height;
  const norm = (s: string | null): string => (s ?? "").replace(/\s+/g, "").toLowerCase();
  const target = norm(category);
  for (const t of Array.from(svgEl.querySelectorAll<SVGTextElement>("text"))) {
    if (t.closest(".tbl-coord") || t.closest(".tbl-y-tick-label")) continue;
    const r = t.getBoundingClientRect();
    if (!r.width) continue;
    if ((r.top - svgRect.top) * sy < plotBottom - 2) continue; // x-axis labels only
    if (norm(t.textContent) !== target) continue;
    return {
      cx: ((r.left + r.right) / 2 - svgRect.left) * sx,
      cy: ((r.top + r.bottom) / 2 - svgRect.top) * sy,
      top: (r.top - svgRect.top) * sy,
      bot: (r.bottom - svgRect.top) * sy,
    };
  }
  return null;
}

/** Draw the active-pane current-category highlight so it matches the axis labels' layout AND
 *  position: it locates the actual rendered axis label for the category and overlays it (single
 *  line / wrapped two lines / rotated 45° about the label's center). Falls back to the row-cluster
 *  y when the label can't be located (e.g. no layout). */
function addCoordCategoryHighlight(
  g: SVGGElement,
  doc: Document,
  svgEl: SVGSVGElement,
  plotBottom: number,
  cx: number,
  category: string,
  mode: "single" | "wrap" | "rotate",
  axisRows: number[],
): void {
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

/**
 * PURE — vertically de-collide per-bar value labels within a hovered cluster. Labels sit above
 * their bars (their natural y); when two horizontally overlap, the HIGHER-VALUE bar's label keeps
 * the higher position and the lower-value one is pushed down (ties: the left/earlier bar stays on
 * top). Returns the y per input label (input order). `pad` is the min vertical gap.
 */
export function staggerBarLabels(
  labels: Array<{ cx: number; w: number; value: number; y: number }>,
  pad: number,
): number[] {
  const n = labels.length;
  const out = new Array<number>(n);
  if (n === 0) return out;
  // Priority: higher value first (kept higher); ties → smaller cx (left) first.
  const order = labels.map((_, i) => i).sort((a, b) => labels[b]!.value - labels[a]!.value || labels[a]!.cx - labels[b]!.cx);
  const placed: number[] = [];
  for (const i of order) {
    let y = labels[i]!.y;
    let moved = true;
    while (moved) {
      moved = false;
      for (const j of placed) {
        const horiz = Math.abs(labels[i]!.cx - labels[j]!.cx) < (labels[i]!.w + labels[j]!.w) / 2;
        if (horiz && Math.abs(y - out[j]!) < pad) { y = out[j]! + pad; moved = true; }
      }
    }
    out[i] = y;
    placed.push(i);
  }
  return out;
}

/** Estimated pill width for a value label (matches addCoordPill's sizing). */
function coordPillWidth(text: string): number {
  return text.length * 10.5 * 0.62 + 8;
}

/**
 * Attach a coordinated cursor to a CONTINUOUS (line) small-multiples pane. Returns a driver:
 * `driver(xValue, active)` snaps to this pane's nearest x and renders the guide + per-series dot
 * and a compact value label (on a pill); when `active`, labels use a heavier weight and the
 * current x value is shown above the plot. `driver(null)` clears. No pointer handlers.
 */
export function attachSecondaryLineCursor(
  svgEl: SVGSVGElement,
  opts: CrosshairOptions,
): (xValue: number | null, active?: boolean) => void {
  const noop = (): void => {};
  if (!svgEl || !opts.rows?.length) return noop;
  const { rows, xField = "time", yField = "value", seriesField = "series", colors, seriesOrder } = opts;
  let { xParse } = opts;
  const yFormat =
    opts.yFormat ?? ((v: number) => `${(+v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

  const vb = svgEl.viewBox?.baseVal;
  const W = vb?.width || +(svgEl.getAttribute("width") ?? "") || svgEl.clientWidth;
  const H = vb?.height || +(svgEl.getAttribute("height") ?? "") || svgEl.clientHeight;
  const ml = +(svgEl.dataset.marginLeft ?? "") || 0;
  const mr = +(svgEl.dataset.marginRight ?? "") || 8;
  const mt = +(svgEl.dataset.marginTop ?? "") || 18;
  const mb = +(svgEl.dataset.marginBottom ?? "") || 28;
  const plotW = W - ml - mr;
  const plotH = H - mt - mb;

  // The active pane highlights the EXISTING x-axis label(s), so only x PARSING is needed here
  // (no x formatting — we never draw our own x text).
  if (!xParse) {
    const sample = rows[0]?.[xField];
    if (/^\d{4}-\d{2}-\d{2}/.test(String(sample))) xParse = (v) => +new Date(String(v));
    else if (/Q\d/.test(String(sample)))
      xParse = (v) => {
        const m = /(\d{4})Q(\d)/.exec(String(v));
        return +new Date(+(m as RegExpExecArray)[1]!, (+(m as RegExpExecArray)[2]! - 1) * 3, 1);
      };
    else xParse = (v) => +(v as number);
  }
  const xs = Array.from(new Set(rows.map((r) => xParse!(r[xField])))).sort((a, b) => a - b);
  if (!xs.length) return noop;
  const bySeries = new Map<string, Map<number, number>>();
  for (const r of rows) {
    const v = r[yField];
    if (v === "" || v == null) continue;
    const k = r[seriesField] as string;
    if (!bySeries.has(k)) bySeries.set(k, new Map());
    bySeries.get(k)!.set(xParse!(r[xField]), +(v as number));
  }
  const xMin = xs[0]!;
  const xMax = xs[xs.length - 1]!;
  const xToPx = (x: number): number => ml + (xMax > xMin ? (x - xMin) / (xMax - xMin) : 0) * plotW;
  const order =
    seriesOrder && seriesOrder.length ? seriesOrder.filter((s) => bySeries.has(s)) : [...bySeries.keys()];

  // x-axis label format: temporal (two lines: month / year), quarterly, or plain. Drives the
  // active pane's highlighted x value so its line breaks match the axis.
  const sampleX = String(rows[0]?.[xField] ?? "");
  const isDate = /^\d{4}-\d{2}-\d{2}/.test(sampleX);
  const isQuarter = /Q\d/.test(sampleX);

  const doc = svgEl.ownerDocument;
  const g = makeCoordGroup(svgEl);
  const axisRows = makeAxisRows(svgEl, mt + plotH);

  return (xValue: number | null, active = false): void => {
    while (g.firstChild) g.removeChild(g.firstChild);
    if (xValue == null) {
      g.setAttribute("opacity", "0");
      return;
    }
    // Snap to this pane's nearest x (panes may not share identical x-sets).
    let nx = xs[0]!;
    let best = Infinity;
    for (const x of xs) {
      const d = Math.abs(x - xValue);
      if (d < best) { best = d; nx = x; }
    }
    const gx = xToPx(nx);
    addCoordGuide(g, doc, gx, mt, mt + plotH);
    // Active pane: draw the full current x value at the axis, matching its line breaks (a
    // temporal date shows month + year on two lines even mid-year, e.g. "Jul" / "2021").
    if (active) {
      const ys = axisRows.get();
      if (ys.length) {
        let lines: Array<{ text: string; cy: number }>;
        if (isDate) {
          const dt = new Date(nx);
          lines = [
            { text: d3.timeFormat("%b")(dt), cy: ys[0]! },
            { text: d3.timeFormat("%Y")(dt), cy: ys[1] ?? ys[0]! + 12 },
          ];
        } else if (isQuarter) {
          const dt = new Date(nx);
          lines = [{ text: `${dt.getFullYear()}Q${Math.floor(dt.getMonth() / 3) + 1}`, cy: ys[0]! }];
        } else {
          lines = [{ text: String(nx), cy: ys[0]! }];
        }
        addCoordAxisLabel(g, doc, gx, lines);
      }
    }
    const weight = active ? 700 : 600;
    const toPy = readLinearYScale(svgEl);
    const flip = gx > ml + plotW * 0.72;
    if (toPy) {
      // Dot stays on the true point; the label pill is de-collided vertically.
      const pts = order
        .map((s) => ({ s, v: bySeries.get(s)!.get(nx) }))
        .filter((p) => p.v != null && !Number.isNaN(p.v)) as Array<{ s: string; v: number }>;
      for (const p of pts) addCoordDot(g, doc, gx, toPy(p.v), colors?.get(p.s) || "#666666", opts.symbols?.get(p.s));
      const labelYs = spreadLabelYs(pts.map((p) => toPy(p.v)), COORD_PILL_H, mt, mt + plotH);
      pts.forEach((p, i) => {
        addCoordPill(g, doc, flip ? gx - 10 : gx + 10, labelYs[i]!, flip ? "end" : "start", yFormat(p.v), colors?.get(p.s) || "#666666", weight);
      });
    }
    g.setAttribute("opacity", "1");
  };
}

export interface SecondaryBandOptions {
  rows: Array<{ _xc?: string; series: string; _y: number | null }>;
  isStacked?: boolean;
  isFaceted?: boolean;
  categories?: string[];
  colors?: Map<string, string>;
  seriesLabels?: Record<string, string>;
  seriesOrder?: string[];
  yFormat?: (v: number) => string;
  /** Horizontal bars: categories on the Y axis. The coordinated cursor then shades the category
   *  ROW (a horizontal strip) and places value pills at each bar's tip (x = value). */
  horizontal?: boolean;
  /** Horizontal: start the shaded row at the SVG's left edge (x=0) so it covers the category
   *  label gutter too, making the highlight read as one continuous row. Default false (starts at
   *  the plot's left margin). */
  regionFromLeftEdge?: boolean;
  /** Horizontal: extend the shaded row this many px past the plot's right edge — used to bridge
   *  the inter-pane grid gap so the row looks continuous across panes. Default 0. */
  regionExtendRight?: number;
  /** Horizontal: when set, re-draw the hovered category's Y-axis label in bold/dark (accent) — by
   *  weight/color ONLY, no background pill. (Vertical's x-axis category name IS shown on a frosted
   *  pill via addCoordCategoryHighlight; horizontal's row label is not.) Only the label-bearing
   *  (leftmost) pane passes this; `font` is the label size. */
  accentLabel?: { font: number };
  /** Gap (px) between a bar's tip and its value pill. Default 6. */
  pillGap?: number;
  /** Waterfall mode (vertical only). When set: EVERY category shades on hover (even total/skip
   *  steps that carry no `_y`), and only `deltaCats` categories get a value pill — drawn CENTERED
   *  in the bar and SIGNED (explicit + on gains). Total/skip steps shade without a pill (their
   *  value is the always-on running-total label). */
  waterfall?: { deltaCats: Set<string> };
}

/** A rendered bar rect's geometry + series, for one category. */
interface CatRect {
  series: string;
  cx: number;
  y: number;
  h: number;
  /** Left edge (x) and width — used by horizontal highlight pills to find the bar tip. */
  x: number;
  w: number;
  /** The rect's ACTUAL rendered fill color, or null. Value pills color-match this so a
   *  differently-colored bar (category_colors / bar_color / mono / highlight-dim) gets a pill in
   *  its OWN color, not the series' base color. */
  fill: string | null;
}

/** The rect's rendered fill: its own `fill` attribute if present, else the nearest ancestor's
 *  (Plot hoists a CONSTANT fill onto the parent `<g aria-label="bar">`, but emits a per-`<rect>`
 *  fill when the mark's fill is a function channel — e.g. category_colors, mono stacks, highlight
 *  dimming). Walks up to (not past) the SVG root; `none`/empty resolve to null. */
function renderedRectFill(rect: SVGRectElement, svgEl: SVGSVGElement): string | null {
  let el: Element | null = rect;
  while (el && el !== svgEl) {
    const f = el.getAttribute("fill");
    if (f && f !== "none") return f;
    el = el.parentElement;
  }
  return null;
}

/** Bucket the rendered bar rects by category. Vertical (default): fx-faceted → one group per
 *  category, single-band → grouped by rounded x. Horizontal: categories are on Y, so fy-faceted
 *  → group per facet (translate-y), single-band → grouped by rounded y. Returns category → its
 *  rects {series, cx, y(top), h, x, w}. Deterministic (reads attributes + facet translate). */
function buildRectsByCategory(
  svgEl: SVGSVGElement,
  opts: SecondaryBandOptions,
  horizontal = false,
): Map<string, CatRect[]> {
  const { isFaceted, categories = [] } = opts;
  const out = new Map<string, CatRect[]>();
  const rectOf = (rect: SVGRectElement, dx: number, dy: number): CatRect => {
    const x = parseFloat(rect.getAttribute("x") ?? "0");
    const w = parseFloat(rect.getAttribute("width") ?? "0");
    return {
      series: rect.getAttribute("data-series") ?? "",
      cx: dx + x + w / 2,
      y: dy + parseFloat(rect.getAttribute("y") ?? "0"),
      h: parseFloat(rect.getAttribute("height") ?? "0"),
      x: dx + x,
      w,
      fill: renderedRectFill(rect, svgEl),
    };
  };

  if (isFaceted) {
    // Vertical: each category is an fx column (translate-x). Horizontal: an fy row (translate-y).
    const groups = Array.from(svgEl.querySelectorAll<SVGGElement>('g[aria-label="bar"] > g'));
    const parsed: Array<{ t: number; g: SVGGElement }> = [];
    for (const gg of groups) {
      // Skip empty facet groups (section spacer slots) so they don't shift the facet→category map.
      if (!gg.querySelector("rect")) continue;
      const tf = gg.getAttribute("transform") ?? "";
      const m = horizontal
        ? /translate\(\s*-?[\d.]+\s*[ ,]\s*([\d.+-]+)/.exec(tf)
        : /translate\(\s*([\d.+-]+)/.exec(tf);
      if (m) parsed.push({ t: parseFloat(m[1]!), g: gg });
    }
    parsed.sort((a, b) => a.t - b.t);
    parsed.forEach((p, i) => {
      const cat = categories[i] ?? String(i);
      const dx = horizontal ? 0 : p.t;
      const dy = horizontal ? p.t : 0;
      out.set(cat, Array.from(p.g.querySelectorAll<SVGRectElement>("rect")).map((r) => rectOf(r, dx, dy)));
    });
    return out;
  }

  // Single-band: group by the category axis position — rounded y (horizontal) or x (vertical).
  const allRects = Array.from(svgEl.querySelectorAll<SVGRectElement>('g[aria-label="bar"] rect'));
  const byKey = new Map<number, CatRect[]>();
  for (const rect of allRects) {
    const key = Math.round(parseFloat(rect.getAttribute(horizontal ? "y" : "x") ?? "0"));
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(rectOf(rect, 0, 0));
  }
  Array.from(byKey.keys())
    .sort((a, b) => a - b)
    .forEach((k, i) => out.set(categories[i] ?? String(i), byKey.get(k)!));
  return out;
}

/** The rendered net-dot markers of a diverging stack, in USER (viewBox) coordinates — the same
 *  space `buildRectsByCategory` reads rects in, so a dot can be matched to a category by its
 *  band-axis center. Reads each `<circle cx cy r>` and accumulates ancestor `translate()`
 *  transforms (facet panes translate their marks). Attribute-based, so it works in jsdom. */
function readNetDotMarkers(svgEl: SVGSVGElement): Array<{ cx: number; cy: number; r: number }> {
  const circles = svgEl.querySelectorAll<SVGCircleElement>(
    `g.tbl-net-marker circle, circle[data-series="${TOTAL_SERIES_KEY}"]`,
  );
  const seen = new Set<Element>();
  const out: Array<{ cx: number; cy: number; r: number }> = [];
  for (const c of circles) {
    if (seen.has(c)) continue;
    seen.add(c);
    let cx = parseFloat(c.getAttribute("cx") ?? "0");
    let cy = parseFloat(c.getAttribute("cy") ?? "0");
    const r = parseFloat(c.getAttribute("r") ?? "8");
    let el: Element | null = c.parentElement;
    while (el && el !== svgEl) {
      const m = /translate\(\s*(-?[\d.]+)(?:\s*[ ,]\s*(-?[\d.]+))?/.exec(el.getAttribute("transform") ?? "");
      if (m) {
        cx += parseFloat(m[1]!);
        cy += parseFloat(m[2] ?? "0");
      }
      el = el.parentElement;
    }
    out.push({ cx, cy, r });
  }
  return out;
}

/**
 * Attach a coordinated cursor to a CATEGORICAL (band-axis) small-multiples pane. Returns a driver:
 * `driver(category, active)` renders a shaded band region over the hovered category and a value
 * label per series — ABOVE each bar (centered) for bar/grouped, or WITHIN each segment for stacked
 * — each on a pill. When `active`, labels use heavier weight and the category value is shown above
 * the plot. `driver(null)` clears. No pointer handlers (externally driven). Vertical only.
 */
export function attachSecondaryBandCursor(
  svgEl: SVGSVGElement,
  opts: SecondaryBandOptions,
): (category: string | null, active?: boolean) => void {
  const noop = (): void => {};
  if (!svgEl || !opts.rows?.length) return noop;
  const yFormat =
    opts.yFormat ?? ((v: number) => `${(+v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

  const vb = svgEl.viewBox?.baseVal;
  const W = vb?.width || +(svgEl.getAttribute("width") ?? "") || svgEl.clientWidth;
  const H = vb?.height || +(svgEl.getAttribute("height") ?? "") || svgEl.clientHeight;
  const ml = +(svgEl.dataset.marginLeft ?? "") || 0;
  const mr = +(svgEl.dataset.marginRight ?? "") || 8;
  const mt = +(svgEl.dataset.marginTop ?? "") || 18;
  const mb = +(svgEl.dataset.marginBottom ?? "") || 28;
  const plotH = H - mt - mb;

  const valByCat = new Map<string, Map<string, number>>();
  for (const r of opts.rows) {
    if (!r._xc || r._y == null || !Number.isFinite(r._y)) continue;
    if (!valByCat.has(r._xc)) valByCat.set(r._xc, new Map());
    valByCat.get(r._xc)!.set(r.series, r._y);
  }
  const horizontal = opts.horizontal === true;
  const rectsByCat = buildRectsByCategory(svgEl, opts, horizontal);
  const plotW = W - ml - mr;

  const doc = svgEl.ownerDocument;
  const g = makeCoordGroup(svgEl);
  const axisRows = makeAxisRows(svgEl, mt + plotH);

  // Accent (bold/dark) the hovered category's Y-axis label by mutating the EXISTING label element
  // (pixel-perfect alignment, vs drawing a duplicate). Found via the `data-category` hook the
  // axes/tagging layer stamps on every category label (axes.ts CAT_LABEL_CLASS + assemble-plot's
  // tagging pass) — robust against a category string that happens to equal a tick label's text
  // (the old textContent-matching approach's collision risk). Track + restore on clear.
  const labelEls = new Map<string, SVGTextElement>();
  if (opts.accentLabel) {
    for (const t of Array.from(svgEl.querySelectorAll<SVGTextElement>("text[data-category]"))) {
      const cat = t.getAttribute("data-category");
      if (cat) labelEls.set(cat, t);
    }
  }
  let accented: SVGTextElement | null = null;
  const restoreAccent = (): void => {
    if (accented) {
      accented.setAttribute("font-weight", "500");
      accented.setAttribute("fill", TBL.color.axis);
      accented = null;
    }
  };

  return (category: string | null, active = false): void => {
    while (g.firstChild) g.removeChild(g.firstChild);
    restoreAccent();
    if (category == null) {
      g.setAttribute("opacity", "0");
      return;
    }
    if (horizontal) {
      // Horizontal bars: categories on Y. Shade the category ROW (a full-width strip widened to
      // the band midpoints) and place a value pill at each bar's tip (to the right of a positive
      // bar's end, left of a negative one). No x-axis category highlight (categories are on Y).
      const { bands: rawH } = readCategoryBandsH(svgEl, {
        rows: opts.rows,
        isFaceted: opts.isFaceted,
        categories: opts.categories,
      } as BandCrosshairOptions);
      const idx = rawH.findIndex((b) => b.category === category);
      const vals = valByCat.get(category);
      if (idx < 0 || !vals) {
        g.setAttribute("opacity", "0");
        return;
      }
      // EQUAL-height row for every category: use the UNIFORM band step (centred on each category),
      // not the neighbour-midpoint widening — otherwise categories at a section boundary (whose
      // neighbour is a spacer-gap away) get a taller strip than the rest.
      const centers = rawH.map((bb) => (bb.yMin + bb.yMax) / 2);
      let step = Infinity;
      for (let i = 1; i < centers.length; i++) step = Math.min(step, centers[i]! - centers[i - 1]!);
      if (!Number.isFinite(step)) step = rawH[idx]!.yMax - rawH[idx]!.yMin + 8;
      const c = centers[idx]!;
      const regYmin = Math.max(mt, c - step / 2);
      const regYmax = Math.min(mt + plotH, c + step / 2);
      // Shade the whole category row. Optionally start at the SVG left edge (cover the label gutter)
      // and extend past the right edge (bridge the inter-pane gap) so it reads as one continuous row.
      const regX0 = opts.regionFromLeftEdge ? 0 : ml;
      // Cover the pane's full width (incl. the right margin) and, for non-last panes, bridge the
      // inter-pane grid gap (SVG overflow is visible) so the row reads as one continuous strip.
      const regX1 = W + (opts.regionExtendRight ?? 0);
      addCoordRegion(g, doc, regX0, regX1 - regX0, regYmin, regYmax - regYmin);
      const weight = active ? 700 : 600;
      // Pill color: prefer the bar's ACTUAL rendered fill (so a category_colors/bar_color/mono/
      // highlight-dimmed bar gets a matching pill), falling back to the series' legend color.
      const colorFor = (s: string) => opts.colors?.get(s) || COORD_LABEL_DARK;
      const pillColor = (r: CatRect) => r.fill ?? colorFor(r.series);
      // Accent the hovered category's Y label by bolding + darkening the existing label element
      // (weight/color only, no background pill — the shaded row already provides the emphasis).
      if (opts.accentLabel) {
        const el = labelEls.get(category);
        if (el) {
          el.setAttribute("font-weight", "700");
          el.setAttribute("fill", COORD_LABEL_DARK);
          accented = el;
        }
      }
      const pillGap = opts.pillGap ?? 6;
      const valid = (rectsByCat.get(category) ?? [])
        .map((rect) => ({ rect, v: vals.get(rect.series) }))
        .filter((x) => x.v != null && !Number.isNaN(x.v)) as Array<{ rect: CatRect; v: number }>;
      for (const x of valid) {
        const cy = x.rect.y + x.rect.h / 2;
        if (opts.isStacked) {
          // Stacked: one pill per segment, centered on the segment (mirrors attachHighlightPills'
          // horizontal stacked branch) — a tip-anchored pill would land at the segment's own edge,
          // not a meaningful "value" position, for anything but the outermost segment.
          addCoordPill(g, doc, x.rect.cx, cy, "middle", yFormat(x.v), pillColor(x.rect), weight);
        } else {
          const tipX = x.v >= 0 ? x.rect.x + x.rect.w : x.rect.x;
          addCoordPill(
            g,
            doc,
            tipX + (x.v >= 0 ? pillGap : -pillGap),
            cy,
            x.v >= 0 ? "start" : "end",
            yFormat(x.v),
            pillColor(x.rect),
            weight,
          );
        }
      }
      g.setAttribute("opacity", "1");
      return;
    }
    const raw = readCategoryBands(svgEl, {
      rows: opts.rows,
      isFaceted: opts.isFaceted,
      categories: opts.categories,
    } as BandCrosshairOptions);
    const idx = raw.findIndex((b) => b.category === category);
    const vals = valByCat.get(category);
    // Waterfall shades EVERY step (incl. total/skip, which carry no `_y`); every other chart keeps
    // the "no values → no hover" behavior.
    if (idx < 0 || (!vals && !opts.waterfall)) {
      g.setAttribute("opacity", "0");
      return;
    }
    // Region spans the full band STEP (widened to the midpoints between clusters), matching the
    // hovered pane's highlight, so the shaded column reads the same across panes. It stops at the
    // baseline (plotH), NOT down through the x-axis label — standalone and faceted vertical match.
    const wide = widenBandsToMidpoints(raw.map((b) => ({ min: b.xMin, max: b.xMax })), ml, W - mr)[idx]!;
    addCoordRegion(g, doc, wide.min, wide.max - wide.min, mt, plotH);
    const weight = active ? 700 : 600;
    if (active) {
      // Highlight the current category on the x-axis row, matching the axis labels' layout
      // (single / wrapped two lines / rotated 45°), centered on the bar band.
      const ys = axisRows.get();
      if (ys.length) {
        const rawCenter = (raw[idx]!.xMin + raw[idx]!.xMax) / 2;
        addCoordCategoryHighlight(g, doc, svgEl, mt + plotH, rawCenter, category, detectBandLabelMode(svgEl, mt + plotH), ys);
      }
    }
    const valid = (rectsByCat.get(category) ?? [])
      .map((rect) => ({ rect, v: vals?.get(rect.series) }))
      .filter((x) => x.v != null && !Number.isNaN(x.v)) as Array<{ rect: CatRect; v: number }>;
    // Pill color: prefer the bar's ACTUAL rendered fill (category_colors/bar_color/mono/dim),
    // falling back to the series' legend color.
    const colorFor = (s: string) => opts.colors?.get(s) || COORD_LABEL_DARK;
    const pillColor = (r: CatRect) => r.fill ?? colorFor(r.series);
    if (opts.waterfall) {
      // Delta steps: a signed value pill CENTERED in the bar. Total/skip steps shade only.
      if (opts.waterfall.deltaCats.has(category)) {
        for (const x of valid) {
          const cy = x.rect.y + x.rect.h / 2;
          const text = `${x.v >= 0 ? "+" : ""}${yFormat(x.v)}`;
          addCoordPill(g, doc, x.rect.cx, cy, "middle", text, pillColor(x.rect), weight);
        }
      }
    } else if (opts.isStacked) {
      // Segments share one x (single band), so de-collide the within-segment labels vertically.
      const cys = spreadLabelYs(valid.map((x) => x.rect.y + x.rect.h / 2), COORD_PILL_H, mt, mt + plotH);
      valid.forEach((x, i) => addCoordPill(g, doc, x.rect.cx, cys[i]!, "middle", yFormat(x.v), pillColor(x.rect), weight));
    } else {
      // ABOVE each bar (centered), or below a negative bar. When narrow bars bring the labels
      // close enough to collide, stagger vertically: higher value stays higher (ties: left on top).
      const ys = staggerBarLabels(
        valid.map((x) => ({
          cx: x.rect.cx,
          w: coordPillWidth(yFormat(x.v)),
          value: x.v,
          y: x.v >= 0 ? x.rect.y - 9 : x.rect.y + x.rect.h + 9,
        })),
        COORD_PILL_H,
      );
      valid.forEach((x, i) => addCoordPill(g, doc, x.rect.cx, ys[i]!, "middle", yFormat(x.v), pillColor(x.rect), weight));
    }
    g.setAttribute("opacity", "1");
  };
}

// ---------------------------------------------------------------------------
// Categorical-x LINE charts — crosshair + coordinated cursor
// ---------------------------------------------------------------------------
// A line over ordinal categories (e.g. age bins) has no bars, so the band crosshair (which reads
// bar-rect geometry) can't resolve a category. These resolve the category from the rendered
// x-axis label positions (one centered label per category, at the same x as the line points) and
// render a line-style cursor (guide + per-series dot + value pill), reusing the coordinated-cursor
// helpers. The hovered x is keyed by the category string, exactly like the band path.

/** Read the categorical x-axis label centers (one row of labels below the plot): category → cx
 *  in SVG user coords. Screen-space measurement; empty without layout (jsdom). */
function readCategoryCentersFromAxis(svgEl: SVGSVGElement, plotBottom: number): Array<{ category: string; cx: number }> {
  const svgRect = svgEl.getBoundingClientRect();
  if (!svgRect.width || !svgRect.height) return [];
  const vb = svgEl.viewBox?.baseVal;
  const Wd = vb?.width || +(svgEl.getAttribute("width") ?? "") || svgRect.width;
  const Hd = vb?.height || +(svgEl.getAttribute("height") ?? "") || svgRect.height;
  const sx = Wd / svgRect.width;
  const sy = Hd / svgRect.height;
  const out: Array<{ category: string; cx: number }> = [];
  const seen = new Set<string>();
  for (const t of Array.from(svgEl.querySelectorAll<SVGTextElement>("text"))) {
    if (t.closest(".tbl-coord") || t.closest(".tbl-y-tick-label")) continue;
    const r = t.getBoundingClientRect();
    if (!r.width) continue;
    if ((r.top - svgRect.top) * sy < plotBottom - 2) continue; // x-axis labels sit below the plot
    const category = (t.textContent ?? "").trim();
    if (!category || seen.has(category)) continue;
    seen.add(category);
    out.push({ category, cx: ((r.left + r.right) / 2 - svgRect.left) * sx });
  }
  return out;
}

/** Read category centers from the rendered DATA MARKERS (elements carrying data-category): for
 *  each category, the mean marker x in SVG user coords. Robust to rotated x-axis labels (whose
 *  bounding-box centers are offset and uneven) and to the dodge (symmetric offsets average back
 *  to the band center). Dot plots use this instead of the axis-label centers. */
function readCategoryCentersFromMarks(svgEl: SVGSVGElement): Array<{ category: string; cx: number }> {
  const svgRect = svgEl.getBoundingClientRect();
  if (!svgRect.width) return [];
  const vb = svgEl.viewBox?.baseVal;
  const Wd = vb?.width || +(svgEl.getAttribute("width") ?? "") || svgRect.width;
  const sx = Wd / svgRect.width;
  const byCat = new Map<string, number[]>();
  for (const el of Array.from(svgEl.querySelectorAll<SVGElement>("[data-category]"))) {
    const cat = el.getAttribute("data-category");
    if (!cat) continue;
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    const cx = ((r.left + r.right) / 2 - svgRect.left) * sx;
    (byCat.get(cat) ?? byCat.set(cat, []).get(cat)!).push(cx);
  }
  return Array.from(byCat, ([category, xs]) => ({
    category,
    cx: xs.reduce((a, b) => a + b, 0) / xs.length,
  })).sort((a, b) => a.cx - b.cx);
}

/** A uniform-width hover band for category `idx`: width = the center-to-center spacing (so every
 *  category band is the SAME size), centered on the category, shifted inward to stay within
 *  [lo, hi]. Only one band shows at a time, so the inward shift overlapping a neighbour is never
 *  visible. Fixes the point-scale outer-padding asymmetry that made edge bands narrower than the
 *  interior ones. */
function uniformBand(
  centers: Array<{ category: string; cx: number }>,
  idx: number,
  lo: number,
  hi: number,
): { min: number; max: number } {
  const n = centers.length;
  if (n < 2) return { min: lo, max: hi };
  const step = (centers[n - 1]!.cx - centers[0]!.cx) / (n - 1);
  let min = centers[idx]!.cx - step / 2;
  let max = centers[idx]!.cx + step / 2;
  if (min < lo) { max += lo - min; min = lo; }
  if (max > hi) { min -= max - hi; max = hi; }
  return { min, max };
}

/** Resolve the category whose axis-label center is nearest the cursor x. */
function nearestCategory(centers: Array<{ category: string; cx: number }>, svgX: number): string | null {
  let best: string | null = null;
  let bd = Infinity;
  for (const c of centers) {
    const d = Math.abs(c.cx - svgX);
    if (d < bd) { bd = d; best = c.category; }
  }
  return best;
}

export interface CategoricalLineOptions {
  rows: Array<{ _xc?: string; series: string; _y: number | null }>;
  colors?: Map<string, string>;
  seriesLabels?: Record<string, string>;
  seriesOrder?: string[];
  yFormat?: (v: number) => string;
  /** Hit-test + emit only (coordinated figures); no tooltip/guide. */
  emitOnly?: boolean;
  onResolve?: (category: string | null) => void;
  /** series → marker symbol name; the coordinated hover dot takes the series' shape. */
  symbols?: Map<string, string>;
  /** Dot plots: shade the hovered category's full band (like a bar-chart hover) instead of
   *  drawing a dashed vertical guide line. The band extents are derived from the x-axis label
   *  centers (midpoints to neighbors). */
  bandHighlight?: boolean;
  /** Dot plots: per-series horizontal dodge offset (px from the band center). When set, the
   *  coordinated cursor places each series' dot OVER its dodged data point, and lays the value
   *  pills side by side around the center line (both on the same vertical side of the dots). */
  dodge?: Map<string, number>;
  /** Dot plots: derive category centers from the data markers (data-category) rather than the
   *  x-axis labels — robust to rotated labels (whose bbox centers are offset / uneven). */
  centersFromMarks?: boolean;
}

/**
 * Crosshair for a categorical-x LINE chart. Resolves the category from the x-axis label centers;
 * single charts get a guide + tooltip, coordinated figure panes pass `emitOnly` (hit-test + emit
 * only, the secondary renderer draws). No bar rects required.
 */
export function attachCategoricalLineCrosshair(svgEl: SVGSVGElement, opts: CategoricalLineOptions): void {
  if (!svgEl || !opts.rows?.length) return;
  const emitOnly = opts.emitOnly ?? false;
  const yFormat =
    opts.yFormat ?? ((v: number) => `${(+v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

  const vb = svgEl.viewBox?.baseVal;
  const W = vb?.width || +(svgEl.getAttribute("width") ?? "") || svgEl.clientWidth;
  const H = vb?.height || +(svgEl.getAttribute("height") ?? "") || svgEl.clientHeight;
  const ml = +(svgEl.dataset.marginLeft ?? "") || 0;
  const mr = +(svgEl.dataset.marginRight ?? "") || 8;
  const mt = +(svgEl.dataset.marginTop ?? "") || 18;
  const mb = +(svgEl.dataset.marginBottom ?? "") || 28;
  const plotBottom = mt + (H - mt - mb);
  const bandHighlight = opts.bandHighlight ?? false;

  const NS = "http://www.w3.org/2000/svg";
  svgEl.querySelectorAll(".tbl-catline-hit, .tbl-catline-guide, .tbl-catline-hl").forEach((el) => el.remove());

  // Dot plots shade the hovered category band (bar-style); line charts draw a dashed guide.
  const hl = emitOnly || !bandHighlight ? null : svgEl.ownerDocument.createElementNS(NS, "rect");
  if (hl) {
    hl.classList.add("tbl-catline-hl");
    hl.setAttribute("fill", TBL.color.annotationDim);
    hl.setAttribute("y", String(mt));
    hl.setAttribute("height", String(plotBottom - mt));
    hl.setAttribute("opacity", "0");
    hl.style.pointerEvents = "none";
    svgEl.appendChild(hl);
  }
  const guide = emitOnly || bandHighlight ? null : svgEl.ownerDocument.createElementNS(NS, "line");
  if (guide) {
    guide.classList.add("tbl-catline-guide");
    guide.setAttribute("stroke", TBL.color.annotationDim);
    guide.setAttribute("stroke-dasharray", "3 3");
    guide.setAttribute("y1", String(mt));
    guide.setAttribute("y2", String(plotBottom));
    guide.setAttribute("opacity", "0");
    guide.style.pointerEvents = "none";
    svgEl.appendChild(guide);
  }
  const hit = svgEl.ownerDocument.createElementNS(NS, "rect");
  hit.classList.add("tbl-catline-hit");
  hit.setAttribute("x", "0");
  hit.setAttribute("y", "0");
  hit.setAttribute("width", String(W));
  hit.setAttribute("height", String(H));
  hit.setAttribute("fill", "transparent");
  hit.style.cursor = "crosshair";
  svgEl.appendChild(hit);

  const tip = emitOnly ? null : getSharedTooltip(svgEl.ownerDocument);
  let centers: Array<{ category: string; cx: number }> | null = null;

  function update(evt: PointerEvent): void {
    const rect = svgEl.getBoundingClientRect();
    if (!rect.width) return;
    if (!centers) centers = opts.centersFromMarks ? readCategoryCentersFromMarks(svgEl) : readCategoryCentersFromAxis(svgEl, plotBottom);
    if (!centers.length) return;
    const svgX = (evt.clientX - rect.left) * (W / rect.width);
    const category = nearestCategory(centers, svgX);
    if (!category) { hide(); return; }
    opts.onResolve?.(category);
    if (emitOnly) return;
    const idx = centers.findIndex((c) => c.category === category);
    const cx = centers[idx]!.cx;
    if (bandHighlight && hl) {
      // Shade the category's band — a uniform width (the center spacing) so every category band
      // is the same size, shifted to stay within the plot.
      const b = uniformBand(centers, idx, ml, W - mr);
      hl.setAttribute("x", String(b.min));
      hl.setAttribute("width", String(Math.max(0, b.max - b.min)));
      hl.setAttribute("opacity", "0.12");
    } else if (guide) {
      guide.setAttribute("x1", String(cx));
      guide.setAttribute("x2", String(cx));
      guide.setAttribute("opacity", "1");
    }
    tip!.innerHTML = buildBandTooltipHtml(category, opts.rows, {
      colors: opts.colors,
      seriesLabels: opts.seriesLabels,
      seriesOrder: opts.seriesOrder,
      yFormat,
    });
    const offset = 14;
    const win = svgEl.ownerDocument.defaultView!;
    tip!.style.opacity = "1";
    let left = evt.clientX + offset;
    let top = evt.clientY + offset;
    if (left + tip!.offsetWidth + 4 > win.innerWidth) left = evt.clientX - tip!.offsetWidth - offset;
    if (top + tip!.offsetHeight + 4 > win.innerHeight) top = evt.clientY - tip!.offsetHeight - offset;
    tip!.style.left = `${Math.max(4, left)}px`;
    tip!.style.top = `${Math.max(4, top)}px`;
  }
  function hide(): void {
    if (guide) guide.setAttribute("opacity", "0");
    if (hl) hl.setAttribute("opacity", "0");
    if (tip) tip.style.opacity = "0";
    opts.onResolve?.(null);
  }
  hit.style.pointerEvents = "all";
  hit.addEventListener("pointermove", update as EventListener);
  hit.addEventListener("pointerleave", hide);
  hit.addEventListener("pointerdown", update as EventListener);
}

/**
 * Coordinated (secondary) cursor for a categorical-x LINE pane. Mirrors attachSecondaryLineCursor
 * but keys off the category (x-axis label centers) instead of a numeric x: guide + per-series dot
 * and value pill at the category's x; when active, the category is highlighted on the axis row.
 */
export function attachSecondaryCategoricalLineCursor(
  svgEl: SVGSVGElement,
  opts: CategoricalLineOptions,
): (category: string | null, active?: boolean) => void {
  const noop = (): void => {};
  if (!svgEl || !opts.rows?.length) return noop;
  const yFormat =
    opts.yFormat ?? ((v: number) => `${(+v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

  const vb = svgEl.viewBox?.baseVal;
  const W = vb?.width || +(svgEl.getAttribute("width") ?? "") || svgEl.clientWidth;
  const H = vb?.height || +(svgEl.getAttribute("height") ?? "") || svgEl.clientHeight;
  const ml = +(svgEl.dataset.marginLeft ?? "") || 0;
  const mr = +(svgEl.dataset.marginRight ?? "") || 8;
  const mt = +(svgEl.dataset.marginTop ?? "") || 18;
  const mb = +(svgEl.dataset.marginBottom ?? "") || 28;
  const plotH = H - mt - mb;

  const valByCat = new Map<string, Map<string, number>>();
  for (const r of opts.rows) {
    if (!r._xc || r._y == null || !Number.isFinite(r._y)) continue;
    if (!valByCat.has(r._xc)) valByCat.set(r._xc, new Map());
    valByCat.get(r._xc)!.set(r.series, r._y);
  }
  const orderFor = (cat: string): string[] => {
    const vals = valByCat.get(cat);
    if (!vals) return [];
    return opts.seriesOrder && opts.seriesOrder.length
      ? opts.seriesOrder.filter((s) => vals.has(s))
      : [...vals.keys()];
  };

  const doc = svgEl.ownerDocument;
  const g = makeCoordGroup(svgEl);
  const axisRows = makeAxisRows(svgEl, mt + plotH);
  let centers: Array<{ category: string; cx: number }> | null = null;

  return (category: string | null, active = false): void => {
    while (g.firstChild) g.removeChild(g.firstChild);
    if (category == null) { g.setAttribute("opacity", "0"); return; }
    if (!centers) centers = opts.centersFromMarks ? readCategoryCentersFromMarks(svgEl) : readCategoryCentersFromAxis(svgEl, mt + plotH);
    const c = centers.find((x) => x.category === category);
    const vals = valByCat.get(category);
    if (!c || !vals) { g.setAttribute("opacity", "0"); return; }
    const cx = c.cx;
    if (opts.bandHighlight) {
      // Shade the category's band (bar-style) on every pane — uniform width (center spacing) so
      // every category band is the same size, matching the primary hover.
      const idx = centers.findIndex((x) => x.category === category);
      const b = uniformBand(centers, idx, ml, W - mr);
      addCoordRegion(g, doc, b.min, b.max - b.min, mt, plotH);
    } else {
      addCoordGuide(g, doc, cx, mt, mt + plotH);
    }
    if (active) {
      const ys = axisRows.get();
      if (ys.length) addCoordCategoryHighlight(g, doc, svgEl, mt + plotH, cx, category, detectBandLabelMode(svgEl, mt + plotH), ys);
    }
    const weight = active ? 700 : 600;
    const toPy = readLinearYScale(svgEl);
    if (toPy) {
      const colorFor = (s: string): string => opts.colors?.get(s) || "#666666";
      const pts = orderFor(category).map((s) => ({ s, v: vals.get(s)!, y: toPy(vals.get(s)!), dx: opts.dodge?.get(s) ?? 0 }));
      // Dots sit OVER the actual data points (dodged x for dot plots, band center otherwise).
      for (const p of pts) addCoordDot(g, doc, cx + p.dx, p.y, colorFor(p.s), opts.symbols?.get(p.s));
      if (opts.dodge) {
        // Value pills: side by side around the center line (each on its series' side), both on
        // the SAME vertical side of the dots — above when there's room, else below.
        const minY = Math.min(...pts.map((p) => p.y));
        const maxY = Math.max(...pts.map((p) => p.y));
        const aboveY = minY - 13;
        const pillY = aboveY >= mt + 9 ? aboveY : Math.min(maxY + 13, mt + plotH - 9);
        // Each pill sits fully on its series' side of the center line, with its inner EDGE a small
        // gap from center and its TEXT centered within the rect (so short values don't look
        // unbalanced). A series exactly on the center line falls back to a centered pill.
        const PILL_GAP = 3;
        for (const p of pts) {
          const [anchor, ax] =
            p.dx < 0 ? (["pill-end", cx - PILL_GAP] as const)
            : p.dx > 0 ? (["pill-start", cx + PILL_GAP] as const)
            : (["middle", cx] as const);
          addCoordPill(g, doc, ax, pillY, anchor, yFormat(p.v), colorFor(p.s), weight);
        }
      } else {
        const flip = cx > ml + (W - ml - mr) * 0.72;
        const labelYs = spreadLabelYs(pts.map((p) => p.y), COORD_PILL_H, mt, mt + plotH);
        pts.forEach((p, i) => {
          addCoordPill(g, doc, flip ? cx - 10 : cx + 10, labelYs[i]!, flip ? "end" : "start", yFormat(p.v), colorFor(p.s), weight);
        });
      }
    }
    g.setAttribute("opacity", "1");
  };
}

// ---------------------------------------------------------------------------
// Legend-highlight value pills — categorical bar / stacked / dot-plot charts
// ---------------------------------------------------------------------------

export interface HighlightPillsOptions {
  /** dataInScope rows (each with `_xc` category, `series`, `_y`). */
  rows: Array<{ _xc?: string; series: string; _y: number | null }>;
  /** "stacked" → segment-center pills; "bar" → above-bar pills; "dotplot" → beside-dot pills. */
  chartType: "bar" | "stacked" | "dotplot";
  isStacked?: boolean;
  /** Grouped bars use fx-faceted layout (xScaleField === "fx"). */
  isFaceted?: boolean;
  /** Ordered category list (declaration / fx-domain order). */
  categories?: string[];
  colors?: Map<string, string>;
  seriesOrder?: string[];
  yFormat?: (v: number) => string;
  /** Dot-plot dodge offsets (series → px), so pills land beside the dodged dots. */
  dodge?: Map<string, number>;
  /** Horizontal bars (categories on Y): pills sit beside the bar tip / at the segment center. */
  horizontal?: boolean;
  /** Diverging / net-dot stack: when true, selecting the Total pseudo-series (TOTAL_SERIES_KEY)
   *  draws a black net-value pill at each category's net dot (below the dot, flipping above when
   *  space is tight). Absent/false → the Total selection draws nothing (it has no rect). */
  showTotalDot?: boolean;
}

export interface HighlightPillsHandle {
  /** Set the active (pinned/hovered) series; redraws pills for all non-suppressed categories. */
  setActive(active: Set<string>): void;
  /** Suppress one category's pills (the one under a coordinated-cursor hover), or null to clear. */
  setSuppressedCategory(cat: string | null): void;
}

/**
 * Attach a legend-highlight value-pill renderer to a categorical chart SVG. Returns a driver
 * `setActive(active)` that draws a value pill for EVERY mark of the active series (across all
 * categories), then clears when `active` is empty or covers every series (i.e. no highlight).
 *
 * The pills are drawn with the SAME primitive (`addCoordPill`) and the SAME positioning rules
 * as the coordinated-cursor secondary renderer, so a highlighted series' values look identical
 * to what a hover would show — segment-centered (stacked), above the bar (grouped/single), or
 * beside the dodged dot (dot plot), color-matched to the series, on the frosted pill.
 *
 * Geometry is read lazily on each call (bars: rect attributes; dots: data-category centers +
 * the y-scale). In non-layout environments (jsdom) the dot path no-ops cleanly; the bar path
 * still reads rect attributes, so the bar pills render. Lives in its own `.tbl-hl-pills` group
 * so it never clobbers the cursor's `.tbl-coord` group.
 */
export function attachHighlightPills(
  svgEl: SVGSVGElement,
  opts: HighlightPillsOptions,
): HighlightPillsHandle {
  const noop: HighlightPillsHandle = { setActive: () => {}, setSuppressedCategory: () => {} };
  if (!svgEl || !opts.rows?.length) return noop;
  const yFormat =
    opts.yFormat ?? ((v: number) => `${(+v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

  const vb = svgEl.viewBox?.baseVal;
  const W = vb?.width || +(svgEl.getAttribute("width") ?? "") || svgEl.clientWidth;
  const H = vb?.height || +(svgEl.getAttribute("height") ?? "") || svgEl.clientHeight;
  const ml = +(svgEl.dataset.marginLeft ?? "") || 0;
  const mr = +(svgEl.dataset.marginRight ?? "") || 8;
  const mt = +(svgEl.dataset.marginTop ?? "") || 18;
  const mb = +(svgEl.dataset.marginBottom ?? "") || 28;
  const plotH = H - mt - mb;

  const valByCat = new Map<string, Map<string, number>>();
  for (const r of opts.rows) {
    if (!r._xc || r._y == null || !Number.isFinite(r._y)) continue;
    if (!valByCat.has(r._xc)) valByCat.set(r._xc, new Map());
    valByCat.get(r._xc)!.set(r.series, r._y);
  }
  const colorFor = (s: string): string => opts.colors?.get(s) || COORD_LABEL_DARK;
  // Value pills color-match the bar's ACTUAL rendered fill (category_colors/bar_color/mono/dim),
  // falling back to the series' legend color; dot-plot pills have no rect and stay series-keyed.
  const pillColor = (r: CatRect): string => r.fill ?? colorFor(r.series);
  const orderFor = (cat: string, active: Set<string>): string[] => {
    const vals = valByCat.get(cat);
    if (!vals) return [];
    const base = opts.seriesOrder && opts.seriesOrder.length
      ? opts.seriesOrder.filter((s) => vals.has(s))
      : [...vals.keys()];
    return base.filter((s) => active.has(s));
  };

  // Own group, separate from the cursor's `.tbl-coord`.
  svgEl.querySelectorAll(".tbl-hl-pills").forEach((el) => el.remove());
  const g = svgEl.ownerDocument.createElementNS(COORD_NS, "g");
  g.classList.add("tbl-hl-pills");
  g.setAttribute("opacity", "0");
  g.style.pointerEvents = "none";
  svgEl.appendChild(g);
  const doc = svgEl.ownerDocument;

  // `lastActive` is the pinned/hovered series set (driven by the legend). `suppressedCat` is the
  // category currently under a coordinated-cursor hover: its pills are skipped so the hover's own
  // per-category value pills don't double up with the series-wide ones. Only the hovered category
  // is suppressed (not the whole pane), and only the coordinated-cursor path sets it — single-pane
  // charts (which show a floating tooltip, not in-place pills) never suppress.
  let lastActive: Set<string> = new Set();
  let suppressedCat: string | null = null;

  function render(): void {
    const active = lastActive;
    while (g.firstChild) g.removeChild(g.firstChild);
    // No highlight = nothing pinned/hovered → no pills. (Selecting EVERY series still shows pills:
    // "all selected" is a deliberate state, distinct from "none selected".)
    if (!active || active.size === 0) {
      g.setAttribute("opacity", "0");
      return;
    }
    const weight = 700;

    if (opts.chartType === "dotplot") {
      const toPy = readLinearYScale(svgEl);
      const centers = readCategoryCentersFromMarks(svgEl);
      if (!toPy || !centers.length) { g.setAttribute("opacity", "0"); return; }
      for (const c of centers) {
        if (c.category === suppressedCat) continue;
        const vals = valByCat.get(c.category);
        if (!vals) continue;
        const series = orderFor(c.category, active);
        if (!series.length) continue;
        const pts = series.map((s) => ({ s, v: vals.get(s)!, y: toPy(vals.get(s)!), dx: opts.dodge?.get(s) ?? 0 }));
        if (opts.dodge) {
          // Pills above the cluster, each on its dodge side (matches the coordinated cursor).
          const minY = Math.min(...pts.map((p) => p.y));
          const maxY = Math.max(...pts.map((p) => p.y));
          const aboveY = minY - 13;
          const pillY = aboveY >= mt + 9 ? aboveY : Math.min(maxY + 13, mt + plotH - 9);
          const PILL_GAP = 3;
          for (const p of pts) {
            const [anchor, ax] =
              p.dx < 0 ? (["pill-end", c.cx - PILL_GAP] as const)
              : p.dx > 0 ? (["pill-start", c.cx + PILL_GAP] as const)
              : (["middle", c.cx] as const);
            addCoordPill(g, doc, ax, pillY, anchor, yFormat(p.v), colorFor(p.s), weight);
          }
        } else {
          const flip = c.cx > ml + (W - ml - mr) * 0.72;
          const labelYs = spreadLabelYs(pts.map((p) => p.y), COORD_PILL_H, mt, mt + plotH);
          pts.forEach((p, i) => {
            addCoordPill(g, doc, flip ? c.cx - 10 : c.cx + 10, labelYs[i]!, flip ? "end" : "start", yFormat(p.v), colorFor(p.s), weight);
          });
        }
      }
      g.setAttribute("opacity", "1");
      return;
    }

    // Bars / stacked: read rect geometry per category, draw pills for the active series only.
    const rectsByCat = buildRectsByCategory(svgEl, {
      rows: opts.rows,
      isFaceted: opts.isFaceted,
      categories: opts.categories,
    } as SecondaryBandOptions, opts.horizontal);
    // Vertical stacked: the y-centers of the segment pills already drawn per category, so the Total
    // pill below can flip above to avoid landing on one (e.g. Total + a segment both selected).
    const segPillYByCat = new Map<string, number[]>();
    for (const [category, rects] of rectsByCat) {
      if (category === suppressedCat) continue;
      const vals = valByCat.get(category);
      const valid = rects
        .filter((r) => active.has(r.series))
        .map((rect) => ({ rect, v: vals?.get(rect.series) }))
        .filter((x) => x.v != null && !Number.isNaN(x.v)) as Array<{ rect: CatRect; v: number }>;
      if (!valid.length) continue;
      if (opts.horizontal) {
        // Categories on Y: stacked → segment center; single/grouped → just past the bar tip,
        // anchored on the value's side, at the bar's row center.
        for (const x of valid) {
          const yc = x.rect.y + x.rect.h / 2;
          if (opts.isStacked) {
            addCoordPill(g, doc, x.rect.cx, yc, "middle", yFormat(x.v), pillColor(x.rect), weight);
          } else {
            const tip = x.v >= 0 ? x.rect.x + x.rect.w : x.rect.x;
            const [anchor, ax] = x.v >= 0 ? (["start", tip + 6] as const) : (["end", tip - 6] as const);
            addCoordPill(g, doc, ax, yc, anchor, yFormat(x.v), pillColor(x.rect), weight);
          }
        }
      } else if (opts.isStacked) {
        const cys = spreadLabelYs(valid.map((x) => x.rect.y + x.rect.h / 2), COORD_PILL_H, mt, mt + plotH);
        segPillYByCat.set(category, cys);
        valid.forEach((x, i) => addCoordPill(g, doc, x.rect.cx, cys[i]!, "middle", yFormat(x.v), pillColor(x.rect), weight));
      } else {
        const ys = staggerBarLabels(
          valid.map((x) => ({
            cx: x.rect.cx,
            w: coordPillWidth(yFormat(x.v)),
            value: x.v,
            y: x.v >= 0 ? x.rect.y - 9 : x.rect.y + x.rect.h + 9,
          })),
          COORD_PILL_H,
        );
        valid.forEach((x, i) => addCoordPill(g, doc, x.rect.cx, ys[i]!, "middle", yFormat(x.v), pillColor(x.rect), weight));
      }
    }

    // Total pseudo-series (diverging / net-dot stack): selecting "Total" has no rect to pill, so
    // draw a black net-value pill at each category's net dot. Vertical: centered under the dot,
    // flipping above when it would fall out of the plot; horizontal: just past the dot on the side
    // with room. Additive — composes with any segment series also selected.
    if (opts.showTotalDot && active.has(TOTAL_SERIES_KEY)) {
      const dots = readNetDotMarkers(svgEl);
      if (dots.length) {
        const loY = mt + COORD_PILL_H / 2;
        const hiY = mt + plotH - COORD_PILL_H / 2;
        const midX = ml + (W - ml - mr) / 2;
        for (const [category, rects] of rectsByCat) {
          if (category === suppressedCat || !rects.length) continue;
          const vals = valByCat.get(category);
          if (!vals) continue;
          let net = 0;
          let any = false;
          for (const v of vals.values()) {
            if (v != null && Number.isFinite(v)) { net += v; any = true; }
          }
          if (!any) continue;
          if (opts.horizontal) {
            const yc = rects[0]!.y + rects[0]!.h / 2;
            const dot = dots.reduce((a, b) => (Math.abs(b.cy - yc) < Math.abs(a.cy - yc) ? b : a));
            const toRight = dot.cx <= midX;
            const ax = toRight ? dot.cx + dot.r + 4 : dot.cx - dot.r - 4;
            addCoordPill(g, doc, ax, dot.cy, toRight ? "start" : "end", yFormat(net), TOTAL_PILL_COLOR, weight);
          } else {
            const cx = rects[0]!.cx;
            const dot = dots.reduce((a, b) => (Math.abs(b.cx - cx) < Math.abs(a.cx - cx) ? b : a));
            const below = dot.cy + dot.r + COORD_PILL_H / 2 + 2;
            const above = dot.cy - dot.r - COORD_PILL_H / 2 - 2;
            // Avoid landing on a segment pill drawn at the same x (Total + a segment both selected):
            // prefer below the dot, else above, each only if it fits the plot and clears the pills.
            const segYs = segPillYByCat.get(category) ?? [];
            const clear = (y: number): boolean => segYs.every((sy) => Math.abs(sy - y) >= COORD_PILL_H);
            const py =
              below <= hiY && clear(below) ? below
              : above >= loY && clear(above) ? above
              : Math.min(Math.max(below <= hiY ? below : above, loY), hiY);
            addCoordPill(g, doc, dot.cx, py, "middle", yFormat(net), TOTAL_PILL_COLOR, weight);
          }
        }
      }
    }
    g.setAttribute("opacity", "1");
  }

  return {
    setActive(active: Set<string>): void {
      lastActive = active;
      render();
    },
    setSuppressedCategory(cat: string | null): void {
      const c = cat ?? null;
      if (c === suppressedCat) return;
      suppressedCat = c;
      render();
    },
  };
}

// ---------------------------------------------------------------------------
// Per-point hover — scatter charts
// ---------------------------------------------------------------------------

export interface PointHoverOptions {
  /** One entry per rendered marker, in the SAME DOM order as `selector` matches. */
  points: Array<{ series: string; shape?: string; x: number; y: number | null }>;
  /** CSS selector for the marker elements (e.g. 'g[aria-label="dot"] path'). */
  selector: string;
  colors?: Map<string, string>;
  seriesLabels?: Record<string, string>;
  shapeLabels?: Record<string, string>;
  /** Combine the shape value into the header line ("series · shape") — dual encoding. */
  showShape?: boolean;
  /** shape value → d3 symbol name, so the tooltip header shows the point's actual marker shape
   *  (filled in the series color). Falls back to a circle. */
  symbols?: Map<string, string>;
  /** Row labels for the x / y tooltip rows. */
  xLabel?: string;
  yLabel?: string;
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
}

/**
 * Attach a per-point hover tooltip to a SCATTER chart. Each rendered marker (matched by
 * `selector`, in data order) shows a tooltip with its color (series), shape value, and x/y on
 * hover. No guide / snapping — a scatter's points aren't aligned on a shared x, so each marker
 * is its own hover target. The color legend's hover-dim continues to work independently.
 */
export function attachPointHover(svgEl: SVGSVGElement, opts: PointHoverOptions): void {
  if (!svgEl || !opts.points?.length) return;
  const doc = svgEl.ownerDocument;
  const tip = getSharedTooltip(doc);
  const xFormat = opts.xFormat ?? ((v: number) => `${v}`);
  const yFormat = opts.yFormat ?? ((v: number) => `${v}`);
  const markers = svgEl.querySelectorAll<SVGElement>(opts.selector);

  const place = (evt: PointerEvent): void => {
    const offset = 14;
    const win = doc.defaultView!;
    let left = evt.clientX + offset;
    let top = evt.clientY + offset;
    if (left + tip.offsetWidth + 4 > win.innerWidth) left = evt.clientX - tip.offsetWidth - offset;
    if (top + tip.offsetHeight + 4 > win.innerHeight) top = evt.clientY - tip.offsetHeight - offset;
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${Math.max(4, top)}px`;
  };

  markers.forEach((el, i) => {
    const p = opts.points[i];
    if (!p) return;
    el.style.cursor = "pointer";
    const show = (evt: PointerEvent): void => {
      const color = opts.colors?.get(p.series) || TBL.color.navy;
      const sLabel = opts.seriesLabels?.[p.series] ?? p.series;
      // Header: the point's actual marker (its symbol, filled in the series color) followed by
      // "series · shape" on one line (e.g. a navy triangle + "Slow · Compressive").
      const symbolName = (p.shape && opts.symbols?.get(p.shape)) || "circle";
      const swatch =
        `<span class="tbl-tooltip-swatch is-symbol"><svg width="16" height="14" viewBox="0 0 16 14">` +
        `<path d="${symbolPathD(symbolName, 95)}" transform="translate(8,6)" fill="${color}" stroke="#ffffff" stroke-width="1"/>` +
        `</svg></span>`;
      const headText =
        opts.showShape && p.shape
          ? `${escapeHtml(sLabel)} · ${escapeHtml(opts.shapeLabels?.[p.shape] ?? p.shape)}`
          : escapeHtml(sLabel);
      let html = `<div class="tbl-tooltip-head">${swatch}${headText}</div>`;
      html += `<div class="tbl-tooltip-row"><span><span class="tbl-tooltip-label">${escapeHtml(opts.xLabel ?? "x")}:</span> <span class="tbl-tooltip-value">${escapeHtml(xFormat(p.x))}</span></span></div>`;
      if (p.y != null && Number.isFinite(p.y)) {
        html += `<div class="tbl-tooltip-row"><span><span class="tbl-tooltip-label">${escapeHtml(opts.yLabel ?? "y")}:</span> <span class="tbl-tooltip-value">${escapeHtml(yFormat(p.y))}</span></span></div>`;
      }
      tip.innerHTML = html;
      tip.style.opacity = "1";
      place(evt);
    };
    el.addEventListener("pointerenter", show as EventListener);
    el.addEventListener("pointermove", place as EventListener);
    el.addEventListener("pointerleave", () => { tip.style.opacity = "0"; });
  });
}
