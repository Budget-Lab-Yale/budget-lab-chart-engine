// Band-axis (bar / stacked / waterfall) hover: the crosshair with its card, and the coordinated
// echo cursor.
import { TBL } from "../theme";
import { categoryText } from "../../spec/section-key";
import { SINGLE_SERIES_KEY } from "../../spec/columns";
import { resolveHatch } from "../hatch";
import { recolourIcons, type IconSpec } from "../icon";
import type { TotalRow } from "../../spec/bar-stack";
import type { TooltipHookCtx } from "../../spec/hooks";
import {
  getSharedTooltip,
  tooltipOwnership,
  resolveCategorySeriesValues,
  buildBandTooltipHtml,
} from "./card";
import {
  type CategoryBand,
  type CategoryBandH,
  widenBandsToMidpoints,
  resolveCategoryFromBands,
  resolveCategoryFromBandsH,
  rowStrip,
  rowStripX,
  spreadLabelYs,
  staggerBarLabels,
} from "./layout-math";
import {
  COORD_LABEL_DARK,
  COORD_PILL_H,
  labelAccenter,
  addCoordPill,
  makeCoordGroup,
  addCoordRegion,
  addCoordCategoryHighlight,
  coordPillWidth,
} from "./coord-draw";
import {
  type CatRect,
  readCategoryBands,
  readCategoryBandsH,
  readCategoryFills,
  makeAxisRows,
  detectBandLabelMode,
  buildRectsByCategory,
  readFrame,
} from "./dom-geometry";
import { type HoverDetach, NO_DETACH, listen, pointerHoverDetach, placeCard, defaultYFormat, appendHitRect } from "./attach";

// ---------------------------------------------------------------------------
// Band-axis (categorical) hover tooltip — bar / stacked charts
// ---------------------------------------------------------------------------

/** Resolved hover context for `BandCrosshairOptions.onHover` / render-live's `MountOptions.onHover`
 *  and the bubbling `tbl-hover` CustomEvent — the SAME category + per-series values the tooltip
 *  card is built from (see `resolveCategorySeriesValues`), never re-derived at a separate site.
 *  `null` reports pointer-leave (or no category resolved), so a consumer drawing its own card
 *  knows when to clear it. */
export interface BandHoverCtx {
  category: string;
  series: string[];
  values: Record<string, number>;
  facet?: string;
  /** The hovered row's raw `columns.section` value, as `category` is the raw category: two rows
   *  can share a category across sections, and this says which one. Absent without sections. */
  section?: string;
}

export interface BandCrosshairOptions {
  /** All rows in scope (dataInScope from renderChart). Each must have `_xc` (the category
   *  key), `series`, and `_y`; `_section` on a sectioned chart, for onHover's `section`. */
  rows: Array<{ _xc?: string; series: string; _y: number | null; _section?: string }>;
  /** True for stacked charts — enables the Total row logic in the tooltip. */
  isStacked?: boolean;
  /** The tooltip's Total row style for stacked charts — see spec/bar-stack.ts's `TotalRow`.
   *  - "dot":  diverging/net-dot stack — Total row uses a circle (is-dot) swatch.
   *  - "text": cumulative stack — Total row shows as plain text with no swatch.
   *  - "none" (or omitted): netDisplay:"none" or normalized — Total row is omitted entirely. */
  totalRow?: TotalRow;
  /** Where the tooltip's Total row sits: "last" (default, after the series rows) or "first". See
   *  spec/types.ts's `barStack.total.position`. */
  totalPosition?: "first" | "last";
  /** Bold the Total row. See spec/types.ts's `barStack.total.bold`. Default ON — pass `false`
   *  to opt out. */
  totalBold?: boolean;
  /** Rule separating the Total row from the series rows; side flips with `totalPosition` — see
   *  `buildBandTooltipHtml`. See spec/types.ts's `barStack.total.divider`. Default ON — pass
   *  `false` to opt out. */
  totalDivider?: boolean;
  /** True when grouped bars use fx-faceted layout (xScaleField === "fx"). */
  isFaceted?: boolean;
  /** Ordered list of categories (declaration order → facet index order for fx layout). */
  categories?: string[];
  seriesLabels?: Record<string, string>;
  seriesOrder?: string[];
  yFormat?: (v: number) => string;
  /** Raw category value → display label for the tooltip header. */
  categoryLabels?: Record<string, string>;
  /** `tooltip_section: true` (a sectioned chart): the card header reads "<section> · <category>",
   *  the section being the hovered category's `_section` row value through `sectionLabels`. */
  tooltipSection?: boolean;
  /** `spec.section_labels` — raw section value → its header text, for `tooltipSection`. */
  sectionLabels?: Record<string, string>;
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
  /** `chrome.tooltip: false` — suppress just the floating tooltip card. The highlight, hit area,
   *  and `onResolve` emission still fire; independent of `emitOnly`, which suppresses all of them
   *  together for a coordinated pane. `undefined` keeps today's behaviour (tooltip shown). */
  showTooltip?: boolean;
  /** Reparent the floating tooltip card into this element instead of `document.body`. Threaded
   *  from MountOptions.tooltipContainer (render-live.ts) — see that option's doc for why
   *  reparenting is opt-in. `undefined` keeps today's behaviour (body). */
  tooltipContainer?: HTMLElement;
  /** Series → its resolved icon; see icon.ts resolveTooltipIcons. */
  icons?: Map<string, IconSpec>;
  /** Screen-only hook (spec/hooks.ts's `RenderHooks.tooltip`) — replaces this band tooltip's
   *  CONTENT while the engine keeps doing the hit-testing, positioning and highlight around it.
   *  `null` (or no hook) keeps the engine's own card. Forwarded from render-live.ts through here
   *  into `buildBandTooltipHtml`. NOT reached by `attachCrosshair` / `attachHistogramHover` /
   *  `attachPointHover` — those build their card markup elsewhere; see
   *  spec/hooks.ts's module note and CONFIG-SPEC.md for that boundary.
   *
   *  Being forwarded here is NOT the same as being reachable. `buildBandTooltipHtml` is called
   *  below the `emitOnly` return and below `if (!tip)`, so this hook is silently skipped on every
   *  pane that hovers with the coordinated cursor instead of a card — which at default settings is
   *  every plain/grouped bar and every waterfall (hoverMode is always "pills" for them), every
   *  all-positive stack, and every coordinated small-multiples pane. That is by design: the hook
   *  replaces card CONTENT, so it has nothing to do where no card is drawn. Do NOT "fix" it by
   *  hoisting the call above the gate the way `onHover` is hoisted — `onHover` is an event that
   *  reports data, this one renders markup into a card that does not exist. The reachability table
   *  in CONFIG-SPEC.md is gated by test/hover-card-reach.test.ts. */
  tooltipHook?: (ctx: TooltipHookCtx) => string | null;
  /** This pane facet value (small multiples only; FigurePane.value via wireFigureSvg -- the same
   *  value paneFacetValue threads into MarkContext for the static hooks, e.g. Task 4 valueLabel).
   *  Forwarded into TooltipHookCtx.facet. undefined on the standalone mountChart path -- there is
   *  no facet there. */
  facet?: string;
  /** Fires with the resolved category + its per-series values on every pointer resolve, and with
   *  `null` on pointer-leave / no category resolved. Fired from the SAME values `update()` already
   *  resolves to build the tooltip (see `resolveCategorySeriesValues`) — BEFORE the `emitOnly` and
   *  `showTooltip` gates below, so it fires for a coordinated small-multiples pane and with
   *  `chrome.tooltip: false` alike (render-live's actual use case: hit-test without the engine's
   *  own card). */
  onHover?: (ctx: BandHoverCtx | null) => void;
  /** Horizontal: the row strip's x-extent and label accent, as `SecondaryBandOptions`' fields of
   *  the same names — start at the SVG's left edge (under the category label) and run to its right
   *  edge, and bold + darken the hovered row's label. Unset keeps the strip within the plot and the
   *  label as drawn. */
  regionFromLeftEdge?: boolean;
  accentLabel?: boolean;
}

/**
 * Attach a category-based hover tooltip to a categorical (band-axis) chart SVG.
 * Resolves cursor x (vertical) or cursor y (horizontal) → category using rendered
 * rect geometry, shows a tooltip with per-series values and (for stacked) a Total
 * row, and draws a translucent area highlight over the hovered category's band.
 */
export function attachBandCrosshair(svgEl: SVGSVGElement, opts: BandCrosshairOptions): HoverDetach {
  if (!svgEl || !opts.rows?.length) return NO_DETACH;

  const horizontal = opts.orientation === "horizontal";

  const yFormat = opts.yFormat ?? defaultYFormat;

  const { W, H, ml, mr, mt, mb } = readFrame(svgEl);

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
  const hit = appendHitRect(svgEl, "tbl-band-crosshair-hit", W, H, "default");

  const tip = emitOnly || opts.showTooltip === false ? null : getSharedTooltip(svgEl.ownerDocument, opts.tooltipContainer);
  const card = tooltipOwnership(tip);
  let active = false;
  let detached = false; // set by the detach; a host callback mid-update may run it

  // Bar tooltips: colour each series' swatch from the bar's ACTUAL rendered fill (bar_color /
  // accent / category_colors / a waterfall's per-direction palette), not the series' base colour —
  // matching the 1.3.x value pill.
  //
  // Resolved once PER CATEGORY at attach time, then merely selected on hover. Both halves matter.
  // Per CATEGORY because a single series' bars are not one colour — `category_colors` and the
  // waterfall palette repaint them per bar, and one series-keyed map keyed every category with the
  // first category's fill. At ATTACH time because the alternative, re-reading on every pointermove,
  // allocates a Map per event for an answer that cannot change: the rects, the resolved icons and
  // the module's `resolveHatch` are all fixed for the life of this attachment.
  //
  // Ungated on chart type on purpose: the readers name bar rects, so a band figure with none yields
  // an EMPTY map and every category falls back to `opts.icons` — the same no-op the old empty
  // `recolourIcons` gave. The gate used to be `swatchShape === "rect"`, a channel that no longer
  // exists. Skipped entirely under `emitOnly`, which draws no tooltip to key.
  const iconsByCategory =
    !emitOnly && opts.icons
      ? (() => {
          const bands = horizontal
            ? readCategoryBandsH(svgEl, opts).bands
            : readCategoryBands(svgEl, opts);
          const out = new Map<string, Map<string, IconSpec>>();
          for (const [category, fills] of readCategoryFills(bands, svgEl)) {
            out.set(category, recolourIcons(opts.icons!, fills, resolveHatch));
          }
          return out;
        })()
      : undefined;

  const accenter = opts.accentLabel && horizontal && !emitOnly ? labelAccenter(svgEl) : null;

  /** Show the highlight over the given band geometry, spanning the full plot axis. */
  function showHighlight(bandMin: number, bandMax: number): void {
    if (!hl) return;
    if (horizontal) {
      // Band is a y-row; highlight spans the plot width, or from under the label (rowStripX).
      const { x, w } = rowStripX(W, ml, mr, opts);
      hl.setAttribute("x", String(x));
      hl.setAttribute("y", String(bandMin));
      hl.setAttribute("width", String(w));
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
      // The pointer resolves by the widened bands (so a gap still picks its nearer row), but the
      // highlight is the row's own strip, which never covers a section gap or header.
      const idx = category ? raw.findIndex((x) => x.category === category) : -1;
      if (idx >= 0) {
        const s = rowStrip(raw, idx, mt, H - mb);
        hlMin = s.min;
        hlMax = s.max;
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

    active = true;
    opts.onResolve?.(category);
    // Fires from the SAME resolver the tooltip card below reads (resolveCategorySeriesValues) —
    // BEFORE the emitOnly/tip gates, so a coordinated small-multiples pane and `chrome.tooltip:
    // false` still report what the engine resolved even though neither draws its own card.
    if (opts.onHover) {
      const { series, values } = resolveCategorySeriesValues(category, opts.rows, opts.seriesOrder);
      // A category's section is its first row's, as the band groups it (marks/category-band.ts).
      const section = opts.rows.find((r) => r._xc === category && r._section != null)?._section;
      opts.onHover({
        category: categoryText(category),
        series,
        values,
        ...(opts.facet != null ? { facet: opts.facet } : {}),
        ...(section != null ? { section } : {}),
      });
      // The host may have torn the chart down from inside onHover; the detach has run. Stop.
      if (detached) return;
    }
    if (emitOnly) return;

    showHighlight(hlMin, hlMax);
    accenter?.accent(category);

    if (!tip) return; // chrome.tooltip: false — highlight shown, no card.

    // The key set for THIS category (see iconsByCategory). Falling back to `opts.icons` keeps a
    // category with no rect of its own on the palette colour rather than on a neighbour's.
    const icons = opts.icons ? iconsByCategory?.get(category) ?? opts.icons : undefined;

    const html = buildBandTooltipHtml(category, opts.rows, {
      isStacked: opts.isStacked,
      totalRow: opts.totalRow,
      totalPosition: opts.totalPosition,
      totalBold: opts.totalBold,
      totalDivider: opts.totalDivider,
      seriesLabels: opts.seriesLabels,
      seriesOrder: opts.seriesOrder,
      yFormat,
      categoryLabels: opts.categoryLabels,
      tooltipHook: opts.tooltipHook,
      facet: opts.facet,
      ...(icons ? { icons } : {}),
      ...(opts.tooltipSection ? { tooltipSection: true, sectionLabels: opts.sectionLabels } : {}),
    });
    if (detached) return; // hooks.tooltip tore the chart down
    tip!.innerHTML = html;

    const win = svgEl.ownerDocument.defaultView!;
    const vw = win.innerWidth;
    const vh = win.innerHeight;
    card.show();
    placeCard(tip!, evt, vw, vh);
  }

  /** `detaching`: release the card rather than hide it, so another chart's card is left alone. */
  function hide(detaching = false): void {
    active = false;
    if (hl) hl.setAttribute("opacity", "0");
    accenter?.restore();
    if (detaching) card.release();
    else if (tip) tip.style.opacity = "0";
    opts.onResolve?.(null);
    opts.onHover?.(null);
  }

  hit.style.pointerEvents = "all";
  const unlisten = listen(hit, {
    pointermove: update as EventListener,
    pointerleave: () => hide(),
    pointerdown: update as EventListener,
  });
  return pointerHoverDetach(() => { detached = true; unlisten(); }, () => active, hide, card);
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
  /** Horizontal: when set, re-draw the hovered category's Y-axis label in bold/dark (accent) — by
   *  weight/color ONLY, no background pill. (Vertical's x-axis category name IS shown on a frosted
   *  pill via addCoordCategoryHighlight; horizontal's row label is not.) `font` is the label size. */
  accentLabel?: { font: number };
  /** Gap (px) between a bar's tip and its value pill. Default 6. */
  pillGap?: number;
  /** Waterfall mode (vertical only). When set: EVERY category shades on hover (even total/skip
   *  steps that carry no `_y`), and only `deltaCats` categories get a value pill — drawn CENTERED
   *  in the bar and SIGNED (explicit + on gains). Total/skip steps shade without a pill (their
   *  value is the always-on running-total label). */
  waterfall?: { deltaCats: Set<string> };
  /** `chrome.valuePills: false` — suppress only the per-series value pills; the shaded band region
   *  and the accented category label still render. Default true. */
  showPills?: boolean;
  /** Echo-only mode, for a pane that draws its OWN hover card + highlight (a stacked pane under
   *  `barStack.hover: "tooltip"`): shade the hovered category's band on the OTHER panes and draw
   *  nothing else — no pills, no category-name pill — and stay blank on the active (hovered) pane,
   *  whose primary crosshair already highlights it. The stacked analogue of
   *  `CategoricalLineOptions.markerless`. */
  echoOnly?: boolean;
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
  const yFormat = opts.yFormat ?? defaultYFormat;

  const { W, H, ml, mr, mt, mb } = readFrame(svgEl);
  const plotH = H - mt - mb;

  const valByCat = new Map<string, Map<string, number>>();
  // A pill is matched to its bar by SERIES: this map is keyed by the ROW's series and read back
  // with the rendered rect's `data-series`. A waterfall breaks that symmetry — it is single-series
  // by construction (validate.ts rejects data with more than one series) and its tagging layer
  // stamps every bar SINGLE_SERIES_KEY (""), while its rows carry whatever `columns.series` holds.
  // A single-valued series column is legal and passes validation, and there the two keys disagree
  // and EVERY pill was dropped. Key the waterfall's values the way its rects are keyed. Fixed here
  // rather than at the stamp: changing what `data-series` holds would alter the RENDERED svg (and
  // would newly activate series-keyed paint like `series_patterns`) on published figures.
  const seriesKeyOf = (r: { series: string }): string => (opts.waterfall ? SINGLE_SERIES_KEY : r.series);
  for (const r of opts.rows) {
    if (!r._xc || r._y == null || !Number.isFinite(r._y)) continue;
    if (!valByCat.has(r._xc)) valByCat.set(r._xc, new Map());
    valByCat.get(r._xc)!.set(seriesKeyOf(r), r._y);
  }
  const horizontal = opts.horizontal === true;
  const rectsByCat = buildRectsByCategory(svgEl, opts, horizontal);

  const doc = svgEl.ownerDocument;
  const g = makeCoordGroup(svgEl);
  const axisRows = makeAxisRows(svgEl, mt + plotH);

  // Accent (bold/dark) the hovered category's Y-axis label by mutating the EXISTING label element
  // (pixel-perfect alignment, vs drawing a duplicate); see labelAccenter.
  const accenter = opts.accentLabel ? labelAccenter(svgEl) : null;

  /** The shaded band for `category` — a rect in viewBox coords — plus that band's centre on the
   *  category axis (which the active pane's category highlight is placed on). ONE computation for
   *  both the pills path and `echoOnly`: a figure can show a card pane beside an echo pane, so the
   *  two must shade identically, and a second copy of this geometry is how they would drift.
   *  Returns null when the category has no rendered band in this pane. */
  const bandRegion = (
    category: string,
  ): { x: number; y: number; w: number; h: number; centre: number } | null => {
    if (horizontal) {
      const { bands } = readCategoryBandsH(svgEl, {
        isFaceted: opts.isFaceted,
        categories: opts.categories,
      });
      const idx = bands.findIndex((b) => b.category === category);
      if (idx < 0) return null;
      // EQUAL-height row for every category (rowStrip), the same strip the primary crosshair draws.
      const { min: yMin, max: yMax, centre: c } = rowStrip(bands, idx, mt, mt + plotH);
      // Shade the whole category row, to the SVG's right edge (incl. the right margin). Optionally
      // start at the SVG left edge, covering the label gutter, so it reads as one continuous row.
      const x0 = opts.regionFromLeftEdge ? 0 : ml;
      const x1 = W;
      return { x: x0, y: yMin, w: x1 - x0, h: yMax - yMin, centre: c };
    }
    // Vertical: the region spans the full band STEP (widened to the midpoints between clusters),
    // matching the hovered pane's highlight, so the shaded column reads the same across panes. It
    // stops at the baseline (plotH), NOT down through the x-axis label — standalone and faceted match.
    const bands = readCategoryBands(svgEl, {
      isFaceted: opts.isFaceted,
      categories: opts.categories,
    });
    const idx = bands.findIndex((b) => b.category === category);
    if (idx < 0) return null;
    const wide = widenBandsToMidpoints(bands.map((b) => ({ min: b.xMin, max: b.xMax })), ml, W - mr)[idx]!;
    return {
      x: wide.min,
      y: mt,
      w: wide.max - wide.min,
      h: plotH,
      centre: (bands[idx]!.xMin + bands[idx]!.xMax) / 2,
    };
  };

  return (category: string | null, active = false): void => {
    while (g.firstChild) g.removeChild(g.firstChild);
    accenter?.restore();
    if (category == null) {
      g.setAttribute("opacity", "0");
      return;
    }
    if (opts.echoOnly) {
      // Blank on the ACTIVE (hovered) pane: its own primary crosshair already draws that pane's
      // highlight rect and its card, so shading here too would read as a darker band on one pane.
      const echo = active ? null : bandRegion(category);
      if (!echo) {
        g.setAttribute("opacity", "0");
        return;
      }
      addCoordRegion(g, doc, echo.x, echo.w, echo.y, echo.h);
      accenter?.accent(category);
      g.setAttribute("opacity", "1");
      return;
    }
    if (horizontal) {
      // Horizontal bars: categories on Y. Shade the category ROW (a full-width strip widened to
      // the band midpoints) and place a value pill at each bar's tip (to the right of a positive
      // bar's end, left of a negative one). No x-axis category highlight (categories are on Y).
      const region = bandRegion(category);
      const vals = valByCat.get(category);
      if (!region || !vals) {
        g.setAttribute("opacity", "0");
        return;
      }
      addCoordRegion(g, doc, region.x, region.w, region.y, region.h);
      const weight = active ? 700 : 600;
      // Pill color: prefer the bar's ACTUAL rendered fill (so a category_colors/bar_color/mono/
      // highlight-dimmed bar gets a matching pill), falling back to the series' legend color.
      const colorFor = (s: string) => opts.colors?.get(s) || COORD_LABEL_DARK;
      const pillColor = (r: CatRect) => r.fill ?? colorFor(r.series);
      // Accent the hovered category's Y label by bolding + darkening the existing label element
      // (weight/color only, no background pill — the shaded row already provides the emphasis).
      accenter?.accent(category);
      const pillGap = opts.pillGap ?? 6;
      // showPills: false (chrome.valuePills) suppresses only the per-series value pills below — the
      // shaded row region and the accented Y-axis label (above) still render, mirroring
      // chrome.tooltip's "hit-testing and the band/point highlight are untouched" contract.
      if (opts.showPills !== false) {
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
      }
      g.setAttribute("opacity", "1");
      return;
    }
    const region = bandRegion(category);
    const vals = valByCat.get(category);
    // Waterfall shades EVERY step (incl. total/skip, which carry no `_y`); every other chart keeps
    // the "no values → no hover" behavior.
    if (!region || (!vals && !opts.waterfall)) {
      g.setAttribute("opacity", "0");
      return;
    }
    addCoordRegion(g, doc, region.x, region.w, region.y, region.h);
    const weight = active ? 700 : 600;
    if (active) {
      // Highlight the current category on the x-axis row, matching the axis labels' layout
      // (single / wrapped two lines / rotated 45°), centered on the bar band.
      const ys = axisRows.get();
      if (ys.length) {
        addCoordCategoryHighlight(g, doc, svgEl, mt + plotH, region.centre, category, detectBandLabelMode(svgEl, mt + plotH), ys);
      }
    }
    const valid = (rectsByCat.get(category) ?? [])
      .map((rect) => ({ rect, v: vals?.get(rect.series) }))
      .filter((x) => x.v != null && !Number.isNaN(x.v)) as Array<{ rect: CatRect; v: number }>;
    // Pill color: prefer the bar's ACTUAL rendered fill (category_colors/bar_color/mono/dim),
    // falling back to the series' legend color.
    const colorFor = (s: string) => opts.colors?.get(s) || COORD_LABEL_DARK;
    const pillColor = (r: CatRect) => r.fill ?? colorFor(r.series);
    // showPills: false (chrome.valuePills) suppresses only the value pills below — the shaded
    // column region and the accented x-axis category pill (above) still render.
    if (opts.showPills !== false) {
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
    }
    g.setAttribute("opacity", "1");
  };
}
