// Cursor-following crosshair tooltip (a live-layer DOM primitive). A vertical guide
// stays inside the SVG and snaps to the nearest x in the data; the tooltip is appended
// to document.body and positioned with position:fixed at the cursor's viewport coords.
//
// Also exports `attachBandCrosshair` for categorical (band-axis) charts (bar/stacked),
// which resolves the hovered category from rendered rect geometry and shows a tooltip.
import { d3 } from "./vendor";
import { TBL } from "./theme";
import { escapeHtml } from "./util";

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
    for (const series of tipSeries) {
      const m = bySeries.get(series)!;
      const v = m.get(snap);
      if (v == null || Number.isNaN(v)) continue;
      const dot = colors?.get(series) || "currentColor";
      const isDashed = dashedSeries?.has(series);
      const display = (seriesLabels && seriesLabels[series]) || series;
      const swatchClass = isDashed ? "tbl-tooltip-swatch is-dashed" : "tbl-tooltip-swatch";
      const swatchStyle = isDashed ? `--swatch-color: ${dot}` : `background: ${dot}`;
      html += `<div class="tbl-tooltip-row"><span class="${swatchClass}" style="${swatchStyle}"></span><span><span class="tbl-tooltip-label">${escapeHtml(display)}:</span> <span class="tbl-tooltip-value">${escapeHtml(yFormat(v))}</span></span></div>`;
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
): Array<{ min: number; max: number }> {
  if (!bands.length) return [];
  const centers = bands.map((b) => (b.min + b.max) / 2);
  return centers.map((c, i) => {
    const prev = i > 0 ? centers[i - 1]! : null;
    const next = i < centers.length - 1 ? centers[i + 1]! : null;
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
  },
): string {
  const { isStacked, showTotalDot, colors, seriesLabels, seriesOrder, yFormat } = opts;
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

  let html = `<div class="tbl-tooltip-head">${escapeHtml(category)}</div>`;
  let total = 0;
  for (const series of orderedSeries) {
    const v = valBySeries.get(series);
    if (v == null) continue;
    total += v;
    const dot = colors?.get(series) || "currentColor";
    const display = (seriesLabels && seriesLabels[series]) || series;
    html += `<div class="tbl-tooltip-row"><span class="tbl-tooltip-swatch" style="background: ${dot}"></span><span><span class="tbl-tooltip-label">${escapeHtml(display)}:</span> <span class="tbl-tooltip-value">${escapeHtml(fmt(v))}</span></span></div>`;
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
function readCategoryBandsH(svgEl: SVGSVGElement, opts: BandCrosshairOptions): CategoryBandH[] {
  const { isFaceted, categories = [] } = opts;

  if (isFaceted) {
    // Grouped horizontal: Plot wraps each fy category in a <g translate(0,ty)> inside the
    // bar mark group. Read each facet group's absolute y-range from its rects.
    const groups = Array.from(svgEl.querySelectorAll<SVGGElement>('g[aria-label="bar"] > g'));
    if (groups.length) {
      const parsed: Array<{ y: number; g: SVGGElement }> = [];
      for (const g of groups) {
        const transform = g.getAttribute("transform") ?? "";
        const m = /translate\(\s*-?[\d.]+\s*[ ,]\s*([\d.+-]+)/.exec(transform);
        const ty = m ? parseFloat(m[1]!) : 0;
        parsed.push({ y: ty, g });
      }
      parsed.sort((a, b) => a.y - b.y);
      return parsed.map((p, i) => {
        const cat = categories[i] ?? String(i);
        const rects = Array.from(p.g.querySelectorAll<SVGRectElement>("rect"));
        if (!rects.length) return { category: cat, yMin: p.y, yMax: p.y + 1 };
        let yMin = Infinity;
        let yMax = -Infinity;
        for (const rect of rects) {
          const ry = parseFloat(rect.getAttribute("y") ?? "0") + p.y;
          const rh = parseFloat(rect.getAttribute("height") ?? "0");
          if (ry < yMin) yMin = ry;
          if (ry + rh > yMax) yMax = ry + rh;
        }
        return { category: cat, yMin, yMax };
      });
    }
    // Fall through to the single-band path if no facet groups were found (defensive).
  }

  const allRects = Array.from(svgEl.querySelectorAll<SVGRectElement>('g[aria-label="bar"] rect'));
  if (!allRects.length) return [];

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
  return sortedKeys.map((key, i) => {
    const band = yToBand.get(key)!;
    const cat = categories[i] ?? String(i);
    return { category: cat, yMin: band.yMin, yMax: band.yMax };
  });
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
      const raw = readCategoryBandsH(svgEl, opts);
      const wide = widenBandsToMidpoints(
        raw.map((b) => ({ min: b.yMin, max: b.yMax })),
        mt,
        H - mb,
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

/** Append a small hollow dot (white fill, series-color ring) to the coord group. */
function addCoordDot(g: SVGGElement, doc: Document, cx: number, cy: number, color: string): void {
  const dot = doc.createElementNS(COORD_NS, "circle");
  dot.setAttribute("cx", String(cx));
  dot.setAttribute("cy", String(cy));
  dot.setAttribute("r", "3");
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
  anchor: "start" | "middle" | "end",
  text: string,
  color: string,
  weight: number,
): void {
  const fontSize = 10.5;
  const padX = 4;
  const padY = 2.5;
  const w = text.length * fontSize * 0.62 + padX * 2;
  const h = fontSize + padY * 2;
  const x0 = anchor === "start" ? cx - padX : anchor === "end" ? cx - w + padX : cx - w / 2;
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
  t.setAttribute("x", String(cx));
  t.setAttribute("y", String(cy));
  t.setAttribute("dy", "0.32em");
  t.setAttribute("text-anchor", anchor);
  t.setAttribute("fill", color);
  t.setAttribute("font-size", String(fontSize));
  t.setAttribute("font-weight", String(weight));
  t.textContent = text;
  g.appendChild(t);
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
      for (const series of order) {
        const v = bySeries.get(series)!.get(nx);
        if (v == null || Number.isNaN(v)) continue;
        const color = colors?.get(series) || "#666666";
        const py = toPy(v);
        addCoordDot(g, doc, gx, py, color);
        // Offset the pill clear of the dot (r=3) so they don't intersect.
        addCoordPill(g, doc, flip ? gx - 10 : gx + 10, py, flip ? "end" : "start", yFormat(v), color, weight);
      }
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
}

/** A rendered bar rect's geometry + series, for one category. */
interface CatRect {
  series: string;
  cx: number;
  y: number;
  h: number;
}

/** Bucket the rendered bar rects by category (fx-faceted: one group per category; single-band:
 *  grouped by rounded x). Returns category → its rects {series, cx, y(top), h}. Deterministic
 *  (reads attributes + facet translate; no layout). */
function buildRectsByCategory(svgEl: SVGSVGElement, opts: SecondaryBandOptions): Map<string, CatRect[]> {
  const { isFaceted, categories = [] } = opts;
  const out = new Map<string, CatRect[]>();
  const rectOf = (rect: SVGRectElement, dx: number): CatRect => {
    const x = parseFloat(rect.getAttribute("x") ?? "0");
    const w = parseFloat(rect.getAttribute("width") ?? "0");
    return {
      series: rect.getAttribute("data-series") ?? "",
      cx: dx + x + w / 2,
      y: parseFloat(rect.getAttribute("y") ?? "0"),
      h: parseFloat(rect.getAttribute("height") ?? "0"),
    };
  };

  if (isFaceted) {
    const groups = Array.from(svgEl.querySelectorAll<SVGGElement>('g[aria-label="bar"] > g'));
    const parsed: Array<{ tx: number; g: SVGGElement }> = [];
    for (const gg of groups) {
      const m = /translate\(\s*([\d.+-]+)/.exec(gg.getAttribute("transform") ?? "");
      if (m) parsed.push({ tx: parseFloat(m[1]!), g: gg });
    }
    parsed.sort((a, b) => a.tx - b.tx);
    parsed.forEach((p, i) => {
      const cat = categories[i] ?? String(i);
      out.set(cat, Array.from(p.g.querySelectorAll<SVGRectElement>("rect")).map((r) => rectOf(r, p.tx)));
    });
    return out;
  }

  const allRects = Array.from(svgEl.querySelectorAll<SVGRectElement>('g[aria-label="bar"] rect'));
  const byX = new Map<number, CatRect[]>();
  for (const rect of allRects) {
    const key = Math.round(parseFloat(rect.getAttribute("x") ?? "0"));
    if (!byX.has(key)) byX.set(key, []);
    byX.get(key)!.push(rectOf(rect, 0));
  }
  Array.from(byX.keys())
    .sort((a, b) => a - b)
    .forEach((k, i) => out.set(categories[i] ?? String(i), byX.get(k)!));
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
  const rectsByCat = buildRectsByCategory(svgEl, opts);

  const doc = svgEl.ownerDocument;
  const g = makeCoordGroup(svgEl);
  const axisRows = makeAxisRows(svgEl, mt + plotH);

  return (category: string | null, active = false): void => {
    while (g.firstChild) g.removeChild(g.firstChild);
    if (category == null) {
      g.setAttribute("opacity", "0");
      return;
    }
    const raw = readCategoryBands(svgEl, {
      rows: opts.rows,
      isFaceted: opts.isFaceted,
      categories: opts.categories,
    } as BandCrosshairOptions);
    const idx = raw.findIndex((b) => b.category === category);
    const vals = valByCat.get(category);
    if (idx < 0 || !vals) {
      g.setAttribute("opacity", "0");
      return;
    }
    // Region spans the full band STEP (widened to the midpoints between clusters), matching the
    // hovered pane's highlight, so the shaded column reads the same across panes.
    const wide = widenBandsToMidpoints(raw.map((b) => ({ min: b.xMin, max: b.xMax })), ml, W - mr)[idx]!;
    addCoordRegion(g, doc, wide.min, wide.max - wide.min, mt, plotH);
    const weight = active ? 700 : 600;
    if (active) {
      // Highlight the category on the x-axis row, centered on the bar band (single line — a
      // categorical axis label is one line, so this matches it).
      const ys = axisRows.get();
      if (ys.length) {
        const rawCenter = (raw[idx]!.xMin + raw[idx]!.xMax) / 2;
        addCoordAxisLabel(g, doc, rawCenter, [{ text: category, cy: ys[0]! }]);
      }
    }
    for (const rect of rectsByCat.get(category) ?? []) {
      const v = vals.get(rect.series);
      if (v == null || Number.isNaN(v)) continue;
      const color = opts.colors?.get(rect.series) || COORD_LABEL_DARK; // color-matched to the series
      if (opts.isStacked) {
        // WITHIN the segment, centered.
        addCoordPill(g, doc, rect.cx, rect.y + rect.h / 2, "middle", yFormat(v), color, weight);
      } else {
        // ABOVE the bar (centered), or below for a negative bar — like the normal value labels.
        const cy = v >= 0 ? rect.y - 9 : rect.y + rect.h + 9;
        addCoordPill(g, doc, rect.cx, cy, "middle", yFormat(v), color, weight);
      }
    }
    g.setAttribute("opacity", "1");
  };
}
