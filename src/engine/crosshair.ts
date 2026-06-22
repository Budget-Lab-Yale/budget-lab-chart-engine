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

  const NS = "http://www.w3.org/2000/svg";
  svgEl.querySelectorAll(".tbl-crosshair, .tbl-crosshair-hit").forEach((el) => el.remove());

  const guide = svgEl.ownerDocument.createElementNS(NS, "line");
  guide.classList.add("tbl-crosshair");
  guide.setAttribute("stroke", TBL.color.annotationDim);
  guide.setAttribute("stroke-dasharray", "3 3");
  guide.setAttribute("y1", String(mt));
  guide.setAttribute("y2", String(mt + plotH));
  guide.setAttribute("opacity", "0");
  guide.style.pointerEvents = "none";
  svgEl.appendChild(guide);

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

  const tip = getSharedTooltip(svgEl.ownerDocument);

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
    const gx = xToPx(snap);
    guide.setAttribute("x1", String(gx));
    guide.setAttribute("x2", String(gx));
    guide.setAttribute("opacity", "1");

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
    tip.innerHTML = html;

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

  const NS = "http://www.w3.org/2000/svg";

  // Remove any previously attached band-crosshair elements (hit area + highlight).
  svgEl.querySelectorAll(".tbl-band-crosshair-hit, .tbl-band-crosshair-hl").forEach((el) => el.remove());

  // Area highlight rect — drawn BEFORE the hit area so it sits above the bars but below
  // the pointer-events layer. Hidden by default (opacity 0).
  const hl = svgEl.ownerDocument.createElementNS(NS, "rect");
  hl.classList.add("tbl-band-crosshair-hl");
  hl.setAttribute("fill", TBL.color.annotationDim);
  hl.setAttribute("opacity", "0");
  hl.style.pointerEvents = "none";
  svgEl.appendChild(hl);

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

  const tip = getSharedTooltip(svgEl.ownerDocument);

  /** Show the highlight over the given band geometry, spanning the full plot axis. */
  function showHighlight(bandMin: number, bandMax: number): void {
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

    showHighlight(hlMin, hlMax);

    const html = buildBandTooltipHtml(category, opts.rows, {
      isStacked: opts.isStacked,
      showTotalDot: opts.showTotalDot,
      colors: opts.colors,
      seriesLabels: opts.seriesLabels,
      seriesOrder: opts.seriesOrder,
      yFormat,
    });
    tip.innerHTML = html;

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
    hl.setAttribute("opacity", "0");
    tip.style.opacity = "0";
  }

  hit.style.pointerEvents = "all";
  hit.addEventListener("pointermove", update as EventListener);
  hit.addEventListener("pointerleave", hide);
  hit.addEventListener("pointerdown", update as EventListener);
}
