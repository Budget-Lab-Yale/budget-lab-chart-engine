// Histogram hover: the per-bin crosshair with its card, and the coordinated echo cursor.
import { TBL } from "../theme";
import { paintedFill } from "../painted-fill";
import { resolveHatch } from "../hatch";
import { recolourIcons, type IconSpec } from "../icon";
import { formatBinLabel, type BinLabelOpts } from "../histogram-label";
import { getSharedTooltip, tooltipOwnership, buildHistogramTooltipHtml } from "./card";
import { resolveHistogramBinIndex, staggerBarLabels } from "./layout-math";
import {
  COORD_LABEL_DARK,
  COORD_PILL_H,
  addCoordPill,
  makeCoordGroup,
  addCoordRegion,
  addCoordAxisLabel,
  coordPillWidth,
} from "./coord-draw";
import {
  type HiddenTick,
  buildHistogramGeom,
  makeAxisRows,
  hideAxisLabelsUnder,
  restoreAxisLabels,
} from "./dom-geometry";
import { type HoverDetach, NO_DETACH, listen, pointerHoverDetach, placeCard, defaultYFormat, appendHitRect } from "./attach";

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
  /** `chrome.valuePills: false` — consumed only by `attachSecondaryHistogramCursor` (the
   *  coordinated/echo cursor): suppress just its per-series value pills. The shaded bin region,
   *  the active-pane bin-range echo, and `onResolve`/hit-testing on the PRIMARY path above are
   *  untouched — same split as `SecondaryBandOptions.showPills` for bar/stacked/waterfall.
   *  `undefined` keeps today's behaviour (pills shown). */
  showPills?: boolean;
}

/**
 * Attach a per-bin hover tooltip to a histogram SVG (numeric/temporal x, binned bars). Resolves
 * the bin under the cursor from a data-x → pixel map anchored on the rendered rect geometry (robust
 * across the multi-layer, one-`<g aria-label="rect">`-per-series DOM), shades that bin's full x-span
 * across the plot height, and shows a shared tooltip headed by the bin range with each in-scope
 * series' height. Lifecycle mirrors attachBandCrosshair (idempotent re-attach; hide on leave).
 */
export function attachHistogramHover(svgEl: SVGSVGElement, opts: HistogramHoverOptions): HoverDetach {
  if (!svgEl || !opts.rows?.length) return NO_DETACH;

  const geom = buildHistogramGeom(svgEl, opts.rows);
  if (!geom) return NO_DETACH;
  const { bins, W, H, mt, mb, spans, renderedFills } = geom;
  const emitOnly = opts.emitOnly ?? false;

  const yFormat = opts.yFormat ?? defaultYFormat;

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

  const hit = appendHitRect(svgEl, "tbl-hist-hover-hit", W, H, "default");

  const tip = emitOnly || opts.showTooltip === false ? null : getSharedTooltip(svgEl.ownerDocument, opts.tooltipContainer);
  const card = tooltipOwnership(tip);
  let active = false;

  // Re-coloured ONCE, not per pointermove: `renderedFills` is read from the bars at attach time, so
  // a `bar_color` histogram's key is settled before the first hover. (This is where that colour is
  // settled at all — the icons arrive on the palette colour; see the `icons:` note in render-live.)
  //
  // Per SERIES is right HERE, unlike the band crosshair's per-category map: a histogram's fill comes
  // from `bar_color` / the palette / highlight-dim, all of which are per series, and the one
  // per-category override — `category_colors` — is validated against a CATEGORICAL x, which a
  // histogram never has. So a series' bins are one colour and there is no hovered bin to key by.
  const tooltipIcons = opts.icons ? recolourIcons(opts.icons, renderedFills, resolveHatch) : undefined;

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
    active = true;

    // Emit the bin CENTER (a DATA-x value) so echo panes re-resolve their own bin. Must be the
    // center, not an edge: bars are edge-to-edge (bins[k-1].x1 === bins[k].x0) and
    // resolveHistogramBinIndex is inclusive on both ends returning the FIRST match, so an edge value
    // would resolve to the PREVIOUS bin. When emitOnly, draw nothing here (the secondary renders all).
    opts.onResolve?.((bin.x0 + bin.x1) / 2);
    if (emitOnly) return;

    showHighlight(spans[idx]!.min, spans[idx]!.max);

    if (!tip) return; // chrome.tooltip: false — highlight shown, no card.

    tip!.innerHTML = buildHistogramTooltipHtml(bin, {
      seriesLabels: opts.seriesLabels,
      seriesOrder: opts.seriesOrder,
      yFormat,
      label: opts.label,
      ...(tooltipIcons ? { icons: tooltipIcons } : {}),
    });

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
  return pointerHoverDetach(unlisten, () => active, hide, card);
}

/**
 * Attach a coordinated cursor to a HISTOGRAM small-multiples pane. Returns a driver keyed by a bin
 * `x0` (data-x): `driver(x0, active)` re-resolves THIS pane's bin (shared mode guarantees identical
 * thresholds, so the bin sets match; keying on x0 also degrades gracefully if edges ever drift),
 * shades its span, and lays a per-series height pill above each bar (staggered on collision). When
 * `active`, the bin range is drawn as an axis pill (same `formatBinLabel` as the hover tooltip),
 * hiding the tick labels it covers (`hideAxisLabelsUnder`). `driver(null)` clears. No pointer
 * handlers (externally driven by the figure bus). Built on the SAME bin geometry as the primary
 * hover (buildHistogramGeom). */
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
  const yFormat = opts.yFormat ?? defaultYFormat;

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
      fill: paintedFill(r, svgEl),
    });
  }

  const order = opts.seriesOrder && opts.seriesOrder.length ? opts.seriesOrder : null;
  const colorFor = (s: string) => renderedFills.get(s) || opts.colors?.get(s) || COORD_LABEL_DARK;
  const doc = svgEl.ownerDocument;
  const g = makeCoordGroup(svgEl);
  const axisRows = makeAxisRows(svgEl, mt + plotH);
  // Tick labels the active pane's bin-range echo is covering; restored at the top of every driver
  // call, as in attachSecondaryLineCursor.
  let hiddenTicks: HiddenTick[] = [];

  return (key: number | null, active = false): void => {
    while (g.firstChild) g.removeChild(g.firstChild);
    restoreAxisLabels(hiddenTicks);
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
    // showPills: false (chrome.valuePills) suppresses only these value pills — the bin region
    // above and the active-pane bin-range echo below are untouched, matching
    // SecondaryBandOptions' identical split (see its two call sites' comments).
    if (opts.showPills !== false) {
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
    }

    // Active (hovered) pane: draw the bin range on the x-axis row as a frosted pill, using the SAME
    // label formatter/opts as the hover tooltip so the coordinated label matches.
    if (active) {
      const rowYs = axisRows.get();
      if (rowYs.length) {
        const cx = (spans[idx]!.min + spans[idx]!.max) / 2;
        const text = formatBinLabel(bin.x0, bin.x1, opts.label ?? { xType: "numeric", interval: null });
        const box = addCoordAxisLabel(g, doc, cx, [{ text, cy: rowYs[0]! }]);
        // A numeric bin range ("10 – 20") is wider than the edge ticks it is centred between, so on
        // narrow bins the pill covers them and leaves a neighbour's fragment past its edge. Hide
        // what it covers, as the line cursor does for a wide `tooltip_x_format` echo. Ungated:
        // the default label is already a range; where it covers nothing, nothing is hidden.
        if (box) hiddenTicks = hideAxisLabelsUnder(svgEl, mt + plotH, box);
      }
    }
    g.setAttribute("opacity", "1");
  };
}
