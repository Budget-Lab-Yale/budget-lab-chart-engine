// DOM geometry readers for the hover layer, split out of crosshair.ts: rendered bar / bin / marker
// geometry, axis-label positions and rows, and the tick-label hide/restore pair. Attribute reads work
// in jsdom; the getBoundingClientRect readers need layout (or the hover harness's mocked rects).
import { readLinearScale } from "../plot-scale";
import { TOTAL_SERIES_KEY } from "../series-keys";
import { paintedFill } from "../painted-fill";
import {
  buildHistogramBins,
  type CategoryBand,
  type CategoryBandH,
  type HistogramBin,
} from "./layout-math";

/** The two option fields the band readers below use: whether the bars are fx/fy-faceted (one
 *  facet group per category) and the category order the rendered bands are matched to. */
export interface BandLayout {
  isFaceted?: boolean;
  categories?: string[];
}

/** A resolved band plus the `<rect>`s it was measured from, so the fill each bar is ACTUALLY
 *  painted can be read per CATEGORY without a second walk that could group them differently from
 *  the band it belongs to. See `readCategoryFills`. */
export type BandRects<T> = T & { rects: SVGRectElement[] };

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
export function readCategoryBands(svgEl: SVGSVGElement, opts: BandLayout): BandRects<CategoryBand>[] {
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
        return { category: cat, xMin: tx, xMax: tx + 1, rects };
      }
      let xMin = Infinity;
      let xMax = -Infinity;
      for (const rect of rects) {
        const rx = parseFloat(rect.getAttribute("x") ?? "0") + p.x;
        const rw = parseFloat(rect.getAttribute("width") ?? "0");
        if (rx < xMin) xMin = rx;
        if (rx + rw > xMax) xMax = rx + rw;
      }
      return { category: cat, xMin, xMax, rects };
    });
  }

  // Single-band: all rects for the bars share a common x for each category.
  // Group them by rounded x-coordinate.
  const allRects = Array.from(svgEl.querySelectorAll<SVGRectElement>('g[aria-label="bar"] rect'));
  if (!allRects.length) return [];

  // Group rects by their integer x (each category gets a distinct band x).
  const xToBand = new Map<number, { xMin: number; xMax: number; rects: SVGRectElement[] }>();
  for (const rect of allRects) {
    const rx = parseFloat(rect.getAttribute("x") ?? "0");
    const rw = parseFloat(rect.getAttribute("width") ?? "0");
    const key = Math.round(rx);
    const existing = xToBand.get(key);
    if (!existing) {
      xToBand.set(key, { xMin: rx, xMax: rx + rw, rects: [rect] });
    } else {
      existing.xMin = Math.min(existing.xMin, rx);
      existing.xMax = Math.max(existing.xMax, rx + rw);
      existing.rects.push(rect);
    }
  }

  // Sort by x position to match category declaration order.
  const sortedKeys = Array.from(xToBand.keys()).sort((a, b) => a - b);
  return sortedKeys.map((key, i) => {
    const band = xToBand.get(key)!;
    const cat = categories[i] ?? String(i);
    return { category: cat, xMin: band.xMin, xMax: band.xMax, rects: band.rects };
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
export function readCategoryBandsH(
  svgEl: SVGSVGElement,
  opts: BandLayout,
): { bands: BandRects<CategoryBandH>[]; boundaryAfter: boolean[] } {
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
      const bands: BandRects<CategoryBandH>[] = [];
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
        bands.push({ category: cat, yMin, yMax, rects });
        boundaryAfter.push(false);
      }
      return { bands, boundaryAfter };
    }
    // Fall through to the single-band path if no facet groups were found (defensive).
  }

  const allRects = Array.from(svgEl.querySelectorAll<SVGRectElement>('g[aria-label="bar"] rect'));
  if (!allRects.length) return { bands: [], boundaryAfter: [] };

  // Group rects by rounded y-coordinate (each horizontal category row has a distinct y).
  const yToBand = new Map<number, { yMin: number; yMax: number; rects: SVGRectElement[] }>();
  for (const rect of allRects) {
    const ry = parseFloat(rect.getAttribute("y") ?? "0");
    const rh = parseFloat(rect.getAttribute("height") ?? "0");
    const key = Math.round(ry);
    const existing = yToBand.get(key);
    if (!existing) {
      yToBand.set(key, { yMin: ry, yMax: ry + rh, rects: [rect] });
    } else {
      existing.yMin = Math.min(existing.yMin, ry);
      existing.yMax = Math.max(existing.yMax, ry + rh);
      existing.rects.push(rect);
    }
  }

  // Sort by y position (top to bottom) to match category declaration order.
  const sortedKeys = Array.from(yToBand.keys()).sort((a, b) => a - b);
  const bands = sortedKeys.map((key, i) => {
    const band = yToBand.get(key)!;
    const cat = categories[i] ?? String(i);
    return { category: cat, yMin: band.yMin, yMax: band.yMax, rects: band.rects };
  });
  return { bands, boundaryAfter: bands.map(() => false) };
}

/**
 * Category → (series → the fill that category's bar is ACTUALLY painted).
 *
 * Keyed by CATEGORY, and that is the whole point. `category_colors` and a waterfall's per-direction
 * palette give ONE series' bars a different colour in every category, so a series-keyed map — which
 * kept the FIRST rect it saw per `data-series` — handed every category the FIRST category's fill,
 * and on a textured chart a hatch ground derived from it. The chart painted each bar correctly;
 * only the tooltip key lied.
 *
 * Takes the bands rather than re-querying, so a fill is grouped under exactly the category whose
 * band the cursor resolves to — a second walk with its own grouping rule could disagree with the
 * first, which is the class of bug this whole file keeps hitting.
 */
export function readCategoryFills(
  bands: ReadonlyArray<BandRects<{ category: string }>>,
  svgEl: SVGSVGElement,
): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const band of bands) {
    const fills = new Map<string, string>();
    for (const rect of band.rects) {
      const s = rect.getAttribute("data-series") ?? "";
      // First rect wins WITHIN a category, which is correct: a fill varies by series and by
      // category, never twice within one cell (a stack's segments each carry their own series).
      if (fills.has(s)) continue;
      const f = paintedFill(rect, svgEl);
      if (f) fills.set(s, f);
    }
    if (fills.size) out.set(band.category, fills);
  }
  return out;
}

/** The frame every hover attach starts from: the SVG's drawn size (its viewBox, else its width /
 *  height attributes, else its client box) and the plot margins the render stamps as
 *  `data-margin-*`. `+x || default` treats a stamped 0 as missing; no 0 margin is stamped today
 *  (assemble-plot.ts), so that is not observable, but keep it if this is ever rewritten. */
export function readFrame(svgEl: SVGSVGElement): {
  W: number; H: number; ml: number; mr: number; mt: number; mb: number;
} {
  const vb = svgEl.viewBox?.baseVal;
  const W = vb?.width || +(svgEl.getAttribute("width") ?? "") || svgEl.clientWidth;
  const H = vb?.height || +(svgEl.getAttribute("height") ?? "") || svgEl.clientHeight;
  const ml = +(svgEl.dataset.marginLeft ?? "") || 0;
  const mr = +(svgEl.dataset.marginRight ?? "") || 8;
  const mt = +(svgEl.dataset.marginTop ?? "") || 18;
  const mb = +(svgEl.dataset.marginBottom ?? "") || 28;
  return { W, H, ml, mr, mt, mb };
}

/** The shared bin GEOMETRY for a histogram SVG: the sorted bins, the data-x→pixel map anchored on
 *  the rendered rect extents, each bin's pixel span, the plot margins, and each series' rendered
 *  fill. Reads only rect x/width attributes + margins (no layout / no scale API — works in jsdom).
 *  Returns null when there are no bins. Shared by the primary hover and the coordinated (secondary)
 *  cursor so both resolve bins from the SAME map. */
export function buildHistogramGeom(
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

  const { W, H, ml, mr, mt, mb } = readFrame(svgEl);

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
      const f = paintedFill(r, svgEl);
      if (f) m.set(s, f);
    }
    return m;
  })();

  return { bins, W, H, ml, mr, mt, mb, xToPx, spans, renderedFills };
}

/** Read a linear value→pixel mapper from Plot's y-scale, or null if unavailable. */
/** The VALUE→pixel scale for the value axis (y for vertical charts). */
export function readLinearYScale(svgEl: SVGSVGElement): ((v: number) => number) | null {
  return readLinearScale(svgEl, "y");
}

/**
 * Read the x-axis label ROW y-centers for a pane (top→bottom, in user coords), so the active
 * pane's highlighted x value can be drawn on the SAME row(s) as the axis ticks — matching the
 * axis's line breaks (e.g. the two-tier temporal axis: a month row + a year row). Geometry is
 * read in screen space (getBoundingClientRect), cached per attach; without layout (jsdom) the
 * list is empty and the caller skips the label.
 */
export function makeAxisRows(svgEl: SVGSVGElement, plotBottom: number) {
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

/** A tick label hidden while an echo pill covers it, plus the inline `visibility` to put back. */
export type HiddenTick = { el: SVGTextElement; prev: string };

/**
 * Hide the x-axis tick labels an echo pill overlaps, and return what to restore.
 *
 * WHY THIS EXISTS: the echo pill is centred on the CURSOR's x and sized from its own text, so it
 * is only as wide as what it says — it is not the tick's box. That is harmless while the echo says
 * what the tick says (the default `%b` / `%Y` is never wider than the tick it covers), but an
 * author-set `tooltip_x_format` is arbitrary: `"%b %-d, %Y"` renders `Jun 1, 2026` over a monthly
 * axis whose ticks are `Jun`, so the pill reaches across its neighbour and leaves a fragment of it
 * sticking out past the pill's edge (`Apr` read as `pr`). Hiding just the ticks the pill actually
 * covers keeps the echo where the reader expects it — on the axis row — while the ticks it does
 * NOT reach stay put, so the axis keeps its context. A histogram pane's bin-range echo hits the
 * same collision at defaults (a numeric `"10 – 20"` is wider than either edge tick) and uses this.
 * Restored on the next cursor move and on clear; the export path re-renders from the spec and
 * never sees this.
 */
export function hideAxisLabelsUnder(
  svgEl: SVGSVGElement,
  plotBottom: number,
  box: { left: number; right: number; top: number; bot: number },
): HiddenTick[] {
  const svgRect = svgEl.getBoundingClientRect();
  if (!svgRect.width || !svgRect.height) return [];
  const vb = svgEl.viewBox?.baseVal;
  const Wd = vb?.width || +(svgEl.getAttribute("width") ?? "") || svgRect.width;
  const Hd = vb?.height || +(svgEl.getAttribute("height") ?? "") || svgRect.height;
  const sx = Wd / svgRect.width;
  const sy = Hd / svgRect.height;
  const PAD = 1; // a tick a hair from the pill's edge still reads as a collision
  const hidden: HiddenTick[] = [];
  for (const t of Array.from(svgEl.querySelectorAll<SVGTextElement>("text"))) {
    if (t.closest(".tbl-coord") || t.closest(".tbl-y-tick-label")) continue;
    const r = t.getBoundingClientRect();
    if (!r.width) continue;
    const top = (r.top - svgRect.top) * sy;
    if (top < plotBottom - 2) continue; // x-axis labels only
    const left = (r.left - svgRect.left) * sx;
    const right = (r.right - svgRect.left) * sx;
    const bot = (r.bottom - svgRect.top) * sy;
    const overlapX = Math.min(box.right + PAD, right) - Math.max(box.left - PAD, left);
    const overlapY = Math.min(box.bot + PAD, bot) - Math.max(box.top - PAD, top);
    if (overlapX <= 0 || overlapY <= 0) continue;
    hidden.push({ el: t, prev: t.style.visibility });
    t.style.visibility = "hidden";
  }
  return hidden;
}

/** Put back every tick label `hideAxisLabelsUnder` hid. Safe to call on an empty list. */
export function restoreAxisLabels(hidden: HiddenTick[]): void {
  for (const h of hidden) h.el.style.visibility = h.prev;
  hidden.length = 0;
}

/** Detect how the rendered categorical x-axis labels are laid out, so the active-pane highlight
 *  can match: "rotate" if a below-plot label carries a rotate transform, "wrap" if one renders as
 *  multiple lines (>1 tspan), else "single". */
export function detectBandLabelMode(svgEl: SVGSVGElement, plotBottom: number): "single" | "wrap" | "rotate" {
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

/** The text an axis label READS. A wrapped label is one `<tspan>` per line, and `textContent` joins
 *  the lines with no space, so a wrapped "A B" read as "AB": another category's name when both are
 *  on the axis. Joining the lines with one space reads it as drawn. Trimmed. */
function axisLabelText(t: SVGTextElement): string {
  const lines = Array.from(t.children).filter((c) => c.localName === "tspan");
  const text = lines.length ? lines.map((l) => l.textContent ?? "").join(" ") : (t.textContent ?? "");
  return text.trim();
}

/** Whitespace runs as one space, trimmed: the form an axis label and a category are compared in, so
 *  a doubled or non-breaking space does not stop a label from matching its category. */
function collapseSpace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Locate the rendered x-axis label for `category` and return its box in SVG user coords (center
 *  + top/bottom), so the highlight can be aligned exactly to it regardless of mode. Matches on the
 *  label's text as read by `axisLabelText`, case-insensitively and with whitespace runs collapsed. */
export function findAxisLabelBox(
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
  const norm = (s: string): string => collapseSpace(s).toLowerCase();
  const target = norm(category);
  for (const t of Array.from(svgEl.querySelectorAll<SVGTextElement>("text"))) {
    if (t.closest(".tbl-coord") || t.closest(".tbl-y-tick-label")) continue;
    const r = t.getBoundingClientRect();
    if (!r.width) continue;
    if ((r.top - svgRect.top) * sy < plotBottom - 2) continue; // x-axis labels only
    if (norm(axisLabelText(t)) !== target) continue;
    return {
      cx: ((r.left + r.right) / 2 - svgRect.left) * sx,
      cy: ((r.top + r.bottom) / 2 - svgRect.top) * sy,
      top: (r.top - svgRect.top) * sy,
      bot: (r.bottom - svgRect.top) * sy,
    };
  }
  return null;
}

/** A rendered bar rect's geometry + series, for one category. */
export interface CatRect {
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

/** Bucket the rendered bar rects by category. Vertical (default): fx-faceted → one group per
 *  category, single-band → grouped by rounded x. Horizontal: categories are on Y, so fy-faceted
 *  → group per facet (translate-y), single-band → grouped by rounded y. Returns category → its
 *  rects {series, cx, y(top), h, x, w}. Deterministic (reads attributes + facet translate). */
export function buildRectsByCategory(
  svgEl: SVGSVGElement,
  opts: BandLayout,
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
      fill: paintedFill(rect, svgEl),
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
export function readNetDotMarkers(svgEl: SVGSVGElement): Array<{ cx: number; cy: number; r: number }> {
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

/** Read the categorical x-axis label centers (one row of labels below the plot): category → cx
 *  in SVG user coords. Screen-space measurement; empty without layout (jsdom).
 *
 *  A label's text (`axisLabelText`: a wrapped label's lines joined by one space) is mapped back to
 *  one of `categories` (the rows' `_xc` values). Reading a wrapped label by `textContent` gave
 *  "Lowest incomehouseholds", which matched no row, so the card listed no values and a coordinated
 *  pane drew nothing. An exact match wins; otherwise whitespace runs compare as one space, as in
 *  `findAxisLabelBox`. Text that matches no category is kept as read. */
export function readCategoryCentersFromAxis(
  svgEl: SVGSVGElement,
  plotBottom: number,
  categories: ReadonlyArray<string | undefined>,
): Array<{ category: string; cx: number }> {
  const exact = new Set<string>();
  const byCollapsed = new Map<string, string>();
  for (const c of categories) {
    if (!c) continue;
    exact.add(c);
    if (!byCollapsed.has(collapseSpace(c))) byCollapsed.set(collapseSpace(c), c);
  }
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
    const text = axisLabelText(t);
    const category = exact.has(text) ? text : (byCollapsed.get(collapseSpace(text)) ?? text);
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
// `cx` is the center along the CATEGORY axis: the screen-x for vertical charts (categories on x),
// the screen-y for horizontal charts (categories on y). `axis` selects which. Reads the data
// markers' bounding boxes (browser-only geometry — jsdom returns 0, so this is exercised live).
export function readCategoryCentersFromMarks(
  svgEl: SVGSVGElement,
  axis: "x" | "y" = "x",
): Array<{ category: string; cx: number }> {
  const svgRect = svgEl.getBoundingClientRect();
  if (!svgRect.width) return [];
  const vb = svgEl.viewBox?.baseVal;
  const Wd = vb?.width || +(svgEl.getAttribute("width") ?? "") || svgRect.width;
  const Hd = vb?.height || +(svgEl.getAttribute("height") ?? "") || svgRect.height;
  const scale = axis === "y" ? Hd / svgRect.height : Wd / svgRect.width;
  const byCat = new Map<string, number[]>();
  for (const el of Array.from(svgEl.querySelectorAll<SVGElement>("[data-category]"))) {
    const cat = el.getAttribute("data-category");
    if (!cat) continue;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    const c =
      axis === "y"
        ? ((r.top + r.bottom) / 2 - svgRect.top) * scale
        : ((r.left + r.right) / 2 - svgRect.left) * scale;
    (byCat.get(cat) ?? byCat.set(cat, []).get(cat)!).push(c);
  }
  return Array.from(byCat, ([category, cs]) => ({
    category,
    cx: cs.reduce((a, b) => a + b, 0) / cs.length,
  })).sort((a, b) => a.cx - b.cx);
}
