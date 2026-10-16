// Categorical-x line / area, dot plot and dumbbell hover: the crosshair with its card, and the
// coordinated echo cursor.
import { TBL } from "../theme";
import { readLinearScale } from "../plot-scale";
import { resolveHatch } from "../hatch";
import { recolourIcons, type IconSpec } from "../icon";
import type { TooltipHookCtx } from "../../spec/hooks";
import { getSharedTooltip, tooltipOwnership, buildBandTooltipHtml } from "./card";
import {
  rowStripX,
  spreadLabelYs,
  spreadPillCentersX,
  uniformBand,
  nearestCategory,
} from "./layout-math";
import {
  COORD_PILL_H,
  labelAccenter,
  addCoordDot,
  addCoordPill,
  makeCoordGroup,
  addCoordGuide,
  addCoordRegion,
  addCoordCategoryHighlight,
  coordPillWidth,
} from "./coord-draw";
import {
  readLinearYScale,
  makeAxisRows,
  detectBandLabelMode,
  readCategoryCentersFromAxis,
  readCategoryCentersFromMarks,
  readFrame,
} from "./dom-geometry";
import { type HoverDetach, NO_DETACH, listen, pointerHoverDetach, placeCard, defaultYFormat, appendHitRect } from "./attach";

// ---------------------------------------------------------------------------
// Categorical-x LINE charts — crosshair + coordinated cursor
// ---------------------------------------------------------------------------
// A line over ordinal categories (e.g. age bins) has no bars, so the band crosshair (which reads
// bar-rect geometry) can't resolve a category. These resolve the category from the rendered
// x-axis label positions (one centered label per category, at the same x as the line points) and
// render a line-style cursor (guide + per-series dot + value pill), reusing the coordinated-cursor
// helpers. The hovered x is keyed by the category string, exactly like the band path.

export interface CategoricalLineOptions {
  /** `_section` on a sectioned dumbbell, for `tooltipSection`. */
  rows: Array<{ _xc?: string; series: string; _y: number | null; _section?: string }>;
  colors?: Map<string, string>;
  seriesLabels?: Record<string, string>;
  seriesOrder?: string[];
  yFormat?: (v: number) => string;
  /** Hit-test + emit only (coordinated figures); no tooltip/guide. */
  emitOnly?: boolean;
  /** `chrome.tooltip: false` — suppress just the floating tooltip card. The guide/band highlight,
   *  hit area, and `onResolve` emission still fire; independent of `emitOnly`, which suppresses
   *  all of them together for a coordinated pane. `undefined` keeps today's behaviour (tooltip
   *  shown). */
  showTooltip?: boolean;
  /** Reparent the floating tooltip card into this element instead of `document.body`. Threaded
   *  from MountOptions.tooltipContainer (render-live.ts) — see that option's doc for why
   *  reparenting is opt-in. `undefined` keeps today's behaviour (body). */
  tooltipContainer?: HTMLElement;
  onResolve?: (category: string | null) => void;
  /** series → marker symbol name; the coordinated hover dot takes the series' shape. */
  symbols?: Map<string, string>;
  /** Dot plots: category → series → the symbol that series' point at that category is DRAWN with.
   *  When set it replaces `symbols` (a point's shape can change between categories within one
   *  series), and a series with no entry at the category, a point the chart never drew, gets no
   *  dot. */
  pointSymbols?: Map<string, Map<string, string>>;
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
  /** "horizontal" puts categories on the Y axis (dumbbell rows): the cursor resolves a category by
   *  its screen-Y, and the band highlight is a full-width horizontal strip. Default "vertical". */
  orientation?: "vertical" | "horizontal";
  /** Series → its resolved icon; see icon.ts resolveTooltipIcons. */
  icons?: Map<string, IconSpec>;
  /** `spec.x_labels` — category → display label for the CARD HEADER, exactly as
   *  `BandCrosshairOptions.categoryLabels`: this family (dot plot / dumbbell / categorical-x line)
   *  feeds the same `buildBandTooltipHtml`, and without the forward its cards showed the raw
   *  category while a band card showed the label. The coordinated cursor's category echo is
   *  deliberately NOT labelled from this: it overlays the rendered axis tick (taking that tick's
   *  box, wrap mode and rotation), and this field is for reading MORE verbosely than the tick. */
  categoryLabels?: Record<string, string>;
  /** `tooltip_section: true` (a sectioned chart): the card header reads "<section> · <category>",
   *  the section being the hovered category's `_section` row value through `sectionLabels`. */
  tooltipSection?: boolean;
  /** `spec.section_labels` — raw section value → its header text, for `tooltipSection`. */
  sectionLabels?: Record<string, string>;
  /** Series → resolved swatch fill (e.g. ink→ink token) so the tooltip marker matches the legend.
   *  Series-keyed, not category-keyed as the band crosshair's is: this is handed in by the CALLER
   *  from the series' own marker style, never read off the marks, and a line/dot mark carries no
   *  per-category fill override to disagree with it. */
  renderedFills?: Map<string, string>;
  /** Coordinated cursor: skip the white-fill highlight ring over each point. The dumbbell's own
   *  dots (filled/hollow/ink) are already visible, and a ring would recolor them — so it draws the
   *  band + value pills only (like bars). Dot plots keep the ring (it sits over dodged points). */
  markerless?: boolean;
  /** `chrome.valuePills: false` — consumed only by `attachSecondaryCategoricalLineCursor` (the
   *  coordinated/echo cursor; the primary crosshair above draws no pills): suppress just its
   *  per-series value pills, on EVERY pane. The guide line, the band echo, the per-series dots, the
   *  hovered pane's category highlight, and `onResolve`/hit-testing are untouched — same split as
   *  `SecondaryBandOptions.showPills` / `HistogramHoverOptions.showPills`. `undefined` keeps
   *  today's behaviour (pills shown). */
  showPills?: boolean;
  /** Screen-only content hook — see `BandCrosshairOptions.tooltipHook`. This is the categorical
   *  chart family's OTHER call into `buildBandTooltipHtml` (dot plots, dumbbells, categorical-x
   *  line charts); missing the forward here leaves the hook working on bar charts and silently
   *  not on these. */
  tooltipHook?: (ctx: TooltipHookCtx) => string | null;
  /** This pane facet value -- see BandCrosshairOptions.facet. undefined on the standalone
   *  mountChart path. */
  facet?: string;
  /** Categorical-x stacked AREA: append the card's Total row, as `CrosshairOptions.showTotal` does
   *  on a temporal axis. Built by `buildBandTooltipHtml`'s own Total row, so it carries that
   *  builder's gate (more than one series with a value at the hovered category). Read by the
   *  primary crosshair only; the coordinated cursor draws pills, not a card. */
  showTotal?: boolean;
  /** Horizontal: the row strip's x-extent and label accent, as `SecondaryBandOptions`' fields of
   *  the same names — start at the SVG's left edge (under the category label) and run to its right
   *  edge, and bold + darken the hovered row's label. Unset keeps the strip within the plot and the
   *  label as drawn. */
  regionFromLeftEdge?: boolean;
  accentLabel?: boolean;
}

/**
 * Crosshair for a categorical-x LINE chart. Resolves the category from the x-axis label centers;
 * single charts get a guide + tooltip, coordinated figure panes pass `emitOnly` (hit-test + emit
 * only, the secondary renderer draws). No bar rects required.
 */
export function attachCategoricalLineCrosshair(svgEl: SVGSVGElement, opts: CategoricalLineOptions): HoverDetach {
  if (!svgEl || !opts.rows?.length) return NO_DETACH;
  const emitOnly = opts.emitOnly ?? false;
  const yFormat = opts.yFormat ?? defaultYFormat;

  const { W, H, ml, mr, mt, mb } = readFrame(svgEl);
  const plotBottom = mt + (H - mt - mb);
  const bandHighlight = opts.bandHighlight ?? false;
  const horizontal = opts.orientation === "horizontal";
  const plotRight = W - mr;

  const NS = "http://www.w3.org/2000/svg";
  svgEl.querySelectorAll(".tbl-catline-hit, .tbl-catline-guide, .tbl-catline-hl").forEach((el) => el.remove());

  // Band highlight: a strip over the hovered category. Vertical charts fix the y-extent (full plot
  // height) and vary x/width per category; horizontal charts fix the x-extent (full plot width) and
  // vary y/height. Line charts (no bandHighlight) draw a dashed guide instead.
  const hl = emitOnly || !bandHighlight ? null : svgEl.ownerDocument.createElementNS(NS, "rect");
  if (hl) {
    hl.classList.add("tbl-catline-hl");
    hl.setAttribute("fill", TBL.color.annotationDim);
    if (horizontal) {
      const { x, w } = rowStripX(W, ml, mr, opts);
      hl.setAttribute("x", String(x));
      hl.setAttribute("width", String(w));
    } else {
      hl.setAttribute("y", String(mt));
      hl.setAttribute("height", String(plotBottom - mt));
    }
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
  const hit = appendHitRect(svgEl, "tbl-catline-hit", W, H, "crosshair");

  const tip = emitOnly || opts.showTooltip === false ? null : getSharedTooltip(svgEl.ownerDocument, opts.tooltipContainer);
  const card = tooltipOwnership(tip);
  let active = false;
  let detached = false; // set by the detach; hooks.tooltip mid-update may run it
  const accenter = opts.accentLabel && horizontal && hl ? labelAccenter(svgEl) : null;
  let centers: Array<{ category: string; cx: number }> | null = null;
  // Re-coloured ONCE, not per pointermove: `opts.renderedFills` is handed in already resolved and
  // `resolveHatch` is a module function, so nothing here varies with the cursor.
  const tooltipIcons = opts.icons ? recolourIcons(opts.icons, opts.renderedFills, resolveHatch) : undefined;

  function update(evt: PointerEvent): void {
    const rect = svgEl.getBoundingClientRect();
    if (!rect.width) return;
    if (!centers)
      centers = opts.centersFromMarks
        ? readCategoryCentersFromMarks(svgEl, horizontal ? "y" : "x")
        : readCategoryCentersFromAxis(svgEl, plotBottom, opts.rows.map((r) => r._xc));
    if (!centers.length) return;
    // Resolve the category by the cursor's position ALONG the category axis (y for horizontal).
    const svgCoord = horizontal
      ? (evt.clientY - rect.top) * (H / rect.height)
      : (evt.clientX - rect.left) * (W / rect.width);
    const category = nearestCategory(centers, svgCoord);
    if (!category) { hide(); return; }
    active = true;
    opts.onResolve?.(category);
    if (emitOnly) return;
    const idx = centers.findIndex((c) => c.category === category);
    const cx = centers[idx]!.cx;
    if (bandHighlight && hl) {
      // Shade the category's band — a uniform extent (the center spacing) so every band is the
      // same size. Horizontal: vary y/height within the plot; vertical: vary x/width.
      const b = horizontal ? uniformBand(centers, idx, mt, plotBottom) : uniformBand(centers, idx, ml, plotRight);
      if (horizontal) {
        hl.setAttribute("y", String(b.min));
        hl.setAttribute("height", String(Math.max(0, b.max - b.min)));
      } else {
        hl.setAttribute("x", String(b.min));
        hl.setAttribute("width", String(Math.max(0, b.max - b.min)));
      }
      hl.setAttribute("opacity", "0.12");
      accenter?.accent(category);
    } else if (guide) {
      guide.setAttribute("x1", String(cx));
      guide.setAttribute("x2", String(cx));
      guide.setAttribute("opacity", "1");
    }

    if (!tip) return; // chrome.tooltip: false — guide/highlight shown, no card.

    const html = buildBandTooltipHtml(category, opts.rows, {
      seriesLabels: opts.seriesLabels,
      seriesOrder: opts.seriesOrder,
      yFormat,
      categoryLabels: opts.categoryLabels,
      tooltipHook: opts.tooltipHook,
      facet: opts.facet,
      ...(tooltipIcons ? { icons: tooltipIcons } : {}),
      ...(opts.showTotal ? { isStacked: true, totalRow: "text" as const } : {}),
      ...(opts.tooltipSection ? { tooltipSection: true, sectionLabels: opts.sectionLabels } : {}),
    });
    if (detached) return; // hooks.tooltip tore the chart down
    tip!.innerHTML = html;
    const win = svgEl.ownerDocument.defaultView!;
    card.show();
    placeCard(tip!, evt, win.innerWidth, win.innerHeight);
  }
  /** `detaching`: release the card rather than hide it, so another chart's card is left alone. */
  function hide(detaching = false): void {
    active = false;
    if (guide) guide.setAttribute("opacity", "0");
    if (hl) hl.setAttribute("opacity", "0");
    accenter?.restore();
    if (detaching) card.release();
    else if (tip) tip.style.opacity = "0";
    opts.onResolve?.(null);
  }
  hit.style.pointerEvents = "all";
  const unlisten = listen(hit, {
    pointermove: update as EventListener,
    pointerleave: () => hide(),
    pointerdown: update as EventListener,
  });
  return pointerHoverDetach(() => { detached = true; unlisten(); }, () => active, hide, card);
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
  const yFormat = opts.yFormat ?? defaultYFormat;

  const { W, H, ml, mr, mt, mb } = readFrame(svgEl);
  const plotH = H - mt - mb;
  const horizontal = opts.orientation === "horizontal";
  const plotW = W - ml - mr;

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

  // The hover dot's symbol for `series` at `cat`; null = that point was never drawn, so no dot.
  const dotSymbol = (cat: string, series: string): string | undefined | null =>
    opts.pointSymbols ? (opts.pointSymbols.get(cat)?.get(series) ?? null) : opts.symbols?.get(series);

  const doc = svgEl.ownerDocument;
  const g = makeCoordGroup(svgEl);
  const axisRows = makeAxisRows(svgEl, mt + plotH);
  let centers: Array<{ category: string; cx: number }> | null = null;
  const stripX = rowStripX(W, ml, mr, opts);
  const accenter = opts.accentLabel && horizontal ? labelAccenter(svgEl) : null;

  return (category: string | null, active = false): void => {
    while (g.firstChild) g.removeChild(g.firstChild);
    accenter?.restore();
    if (category == null) { g.setAttribute("opacity", "0"); return; }
    if (!centers)
      centers = opts.centersFromMarks
        ? readCategoryCentersFromMarks(svgEl, horizontal ? "y" : "x")
        : readCategoryCentersFromAxis(svgEl, mt + plotH, opts.rows.map((r) => r._xc));
    const c = centers.find((x) => x.category === category);
    const vals = valByCat.get(category);
    if (!c || !vals) { g.setAttribute("opacity", "0"); return; }
    const cx = c.cx;
    // Dumbbell (markerless): the coordinated cursor is a pure BAND ECHO — shade the hovered
    // category on the OTHER panes; the source pane shows its own tooltip + highlight via its
    // primary crosshair, and its value read-out is the tooltip (not pills). No dots, no pills.
    if (opts.markerless) {
      if (active) { g.setAttribute("opacity", "0"); return; }
      const idx = centers.findIndex((x) => x.category === category);
      if (horizontal) {
        const b = uniformBand(centers, idx, mt, mt + plotH);
        addCoordRegion(g, doc, stripX.x, stripX.w, b.min, b.max - b.min);
        accenter?.accent(category);
      } else {
        const b = uniformBand(centers, idx, ml, W - mr);
        addCoordRegion(g, doc, b.min, b.max - b.min, mt, plotH);
      }
      g.setAttribute("opacity", "1");
      return;
    }
    if (horizontal) {
      // Horizontal dumbbell facets: echo the hovered category as a full-width row strip. (The
      // per-series secondary dots/pills are a vertical-only nicety; the row echo is the coordinated
      // cursor's core across panes.)
      const idx = centers.findIndex((x) => x.category === category);
      const b = uniformBand(centers, idx, mt, mt + plotH);
      addCoordRegion(g, doc, stripX.x, stripX.w, b.min, b.max - b.min);
      accenter?.accent(category);
      // A value pill per series on EVERY pane (matching bars — the whole point of a coordinated
      // cursor is reading values across panes, not just the hovered one); `active` only bolds them.
      // Pills sit just above the row at each dot's value-x, de-collided along X so they never
      // overlap. No highlight ring (the dumbbell's own dots are visible; a ring would recolor them).
      const toPx = readLinearScale(svgEl, "x");
      const cy = c.cx; // for horizontal, centers' `cx` holds the category's Y position
      if (toPx) {
        const weight = active ? 700 : 600;
        const colorFor = (s: string): string => opts.colors?.get(s) || "#666666";
        const pts = orderFor(category).map((s) => ({ s, v: vals.get(s)!, x: toPx(vals.get(s)!) }));
        if (!opts.markerless) for (const p of pts) {
          const sym = dotSymbol(category, p.s);
          if (sym !== null) addCoordDot(g, doc, p.x, cy, colorFor(p.s), sym);
        }
        // showPills: false (chrome.valuePills) suppresses only these value pills — the row echo
        // above and the per-series dots just above are untouched, matching
        // SecondaryBandOptions'/HistogramHoverOptions' identical split.
        if (opts.showPills !== false) {
          const centersX = spreadPillCentersX(pts.map((p) => ({ x: p.x, w: coordPillWidth(yFormat(p.v)) })), ml, ml + plotW);
          const pillY = Math.max(mt + 9, b.min - 2); // just above the row strip
          pts.forEach((p, i) => addCoordPill(g, doc, centersX[i]!, pillY, "middle", yFormat(p.v), colorFor(p.s), weight));
        }
      }
      g.setAttribute("opacity", "1");
      return;
    }
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
      // Skipped for the dumbbell (markerless): its own dots are visible; a white ring would recolor them.
      if (!opts.markerless) for (const p of pts) {
        const sym = dotSymbol(category, p.s);
        if (sym !== null) addCoordDot(g, doc, cx + p.dx, p.y, colorFor(p.s), sym);
      }
      // showPills: false (chrome.valuePills) suppresses only the value pills in BOTH layouts
      // below — the guide/band echo, the per-series dots just above, and the active pane's
      // category highlight are untouched, matching SecondaryBandOptions'/
      // HistogramHoverOptions' identical split.
      if (opts.showPills !== false) {
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
    }
    g.setAttribute("opacity", "1");
  };
}
