// Legend-highlight value pills on categorical charts.
import { TOTAL_SERIES_KEY } from "../series-keys";
import { spreadLabelYs, staggerBarLabels } from "./layout-math";
import {
  COORD_NS,
  COORD_LABEL_DARK,
  TOTAL_PILL_COLOR,
  COORD_PILL_H,
  addCoordPill,
  coordPillWidth,
} from "./coord-draw";
import {
  type CatRect,
  readLinearYScale,
  buildRectsByCategory,
  readNetDotMarkers,
  readCategoryCentersFromMarks,
  readFrame,
} from "./dom-geometry";
import { defaultYFormat } from "./attach";

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
  /** Whether net-dot markers exist in the DOM (spec/bar-stack.ts's `hasNetDots`). When true,
   *  selecting the Total pseudo-series (TOTAL_SERIES_KEY) draws a black net-value pill at each
   *  category's net dot (below the dot, flipping above when space is tight). Absent/false → the
   *  Total selection draws nothing (it has no rect to pin to). */
  hasNetDots?: boolean;
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
  const yFormat = opts.yFormat ?? defaultYFormat;

  const { W, H, ml, mr, mt, mb } = readFrame(svgEl);
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
      isFaceted: opts.isFaceted,
      categories: opts.categories,
    }, opts.horizontal);
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
    if (opts.hasNetDots && active.has(TOTAL_SERIES_KEY)) {
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
