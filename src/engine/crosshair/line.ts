// Continuous-x (line / area) hover: the crosshair with its card, and the coordinated echo cursor.
import { d3 } from "../vendor";
import { TBL } from "../theme";
import { readScaleDomain } from "../plot-scale";
import { isAnnualSeries } from "../util";
import type { IconSpec } from "../icon";
import type { OverlayTooltipLine } from "../overlays";
import type { XAxisType } from "../../spec/types";
import { getSharedTooltip, tooltipOwnership, buildLineTooltipHtml } from "./card";
import { spreadLabelYs } from "./layout-math";
import {
  COORD_PILL_H,
  addCoordDot,
  addCoordPill,
  makeCoordGroup,
  addCoordGuide,
  addCoordAxisLabel,
} from "./coord-draw";
import {
  type HiddenTick,
  readLinearYScale,
  makeAxisRows,
  hideAxisLabelsUnder,
  restoreAxisLabels,
  readFrame,
} from "./dom-geometry";
import { type HoverDetach, NO_DETACH, listen, pointerHoverDetach, placeCard, defaultYFormat, appendHitRect } from "./attach";

type Row = Record<string, unknown>;

export interface CrosshairOptions {
  rows: Row[];
  xField?: string;
  yField?: string;
  seriesField?: string;
  /** The x-adapter's `tooltipXParse`. Required: both readers of this type are continuous-x (a
   *  categorical chart is dispatched to the catline or band crosshair first), and every continuous
   *  adapter supplies it — see x-adapter.ts. */
  xParse: (v: unknown) => number;
  xFormat?: (v: number) => string;
  /** True when `xFormat` came from the spec's own `tooltip_x_format` rather than the x-adapter's
   *  axis-matching default. Read ONLY by `attachSecondaryLineCursor`, which shares this options
   *  type: its x echo annotates the axis ticks, so it draws the author's single-line format when
   *  the author asked for one and keeps the two-line `%b` / `%Y` (one line per axis tick row; the
   *  bare year on an annual series) when nobody did. `attachCrosshair`'s card has one line to fill either way and ignores this. */
  xFormatExplicit?: boolean;
  /** The spec's `xAxisType`. Read ONLY by `attachSecondaryLineCursor`, to choose its x echo's form
   *  from the axis rather than from the raw cell — see the fallback there for callers without it. */
  xAxisType?: XAxisType;
  yFormat?: (v: number) => string;
  /** Series → colour, for the COORDINATED cursor's echo dots and value pills
   *  (attachSecondaryLineCursor, which shares this options type). NOT the tooltip key's colour —
   *  that comes from `icons`, resolved once so it cannot disagree with the legend. */
  colors?: Map<string, string>;
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
  /** `chrome.tooltip: false` — suppress just the floating tooltip card. The guide, hit area, and
   *  `onResolve` emission still fire; independent of `emitOnly`, which suppresses all of them
   *  together for a coordinated pane. `undefined` keeps today's behaviour (tooltip shown). */
  showTooltip?: boolean;
  /** Reparent the floating tooltip card into this element instead of `document.body`. Threaded
   *  from MountOptions.tooltipContainer (render-live.ts) — see that option's doc for why
   *  reparenting is opt-in. `undefined` keeps today's behaviour (body). */
  tooltipContainer?: HTMLElement;
  /** series → marker symbol name (line charts with point markers). When set, the coordinated
   *  hover dot takes the series' shape so it matches the static marker. */
  symbols?: Map<string, string>;
  /** Append a cumulative "Total" row (sum of the shown series at the hovered x) to the tooltip —
   *  used for stacked area, where the stack height is the meaningful aggregate. Requested, not
   *  guaranteed: the row is still gated on the card having drawn MORE THAN ONE series row at the
   *  hovered x (see `shownRows > 1` in crosshair/card.ts buildLineTooltipHtml), because the sum
   *  of one row is that row. */
  showTotal?: boolean;
  /** Series → its resolved icon; see icon.ts resolveTooltipIcons. */
  icons?: Map<string, IconSpec>;
  /** `overlays[].tooltip: true` lines drawn in this frame (engine/overlays.ts
   *  `overlayTooltipLines`), each contributing ONE row at the snapped x. Read by `attachCrosshair`
   *  only — `attachSecondaryLineCursor` shares this options type and draws pills, not a card. */
  overlays?: OverlayTooltipLine[];
  /** `chrome.valuePills: false` — consumed only by `attachSecondaryLineCursor` (the
   *  coordinated/echo cursor): suppress just its per-series value pills. The guide line, the
   *  per-series highlight dot, and the active-pane x-value echo are untouched — same split as
   *  `SecondaryBandOptions.showPills` / `HistogramHoverOptions.showPills`. `undefined` keeps
   *  today's behaviour (pills shown). */
  showPills?: boolean;
}

export function attachCrosshair(svgEl: SVGSVGElement, opts: CrosshairOptions): HoverDetach {
  const {
    rows,
    xField = "time",
    yField = "value",
    seriesField = "series",
    seriesLabels,
    seriesOrder,
  } = opts;
  const { xParse, xFormat } = opts;
  const yFormat = opts.yFormat ?? defaultYFormat;
  if (!svgEl || !rows?.length) return NO_DETACH;

  const { W, H, ml, mr, mt, mb } = readFrame(svgEl);

  const plotW = W - ml - mr;
  const plotH = H - mt - mb;

  const xs = Array.from(new Set(rows.map((r) => xParse(r[xField])))).sort((a, b) => a - b);
  const bySeries = new Map<string, Map<number, number>>();
  for (const r of rows) {
    const v = r[yField];
    if (v === "" || v == null) continue; // skip blank rows
    const k = r[seriesField] as string;
    if (!bySeries.has(k)) bySeries.set(k, new Map());
    bySeries.get(k)!.set(xParse(r[xField]), +(v as number));
  }
  // The range Plot drew, which can be wider than these rows (see readScaleDomain).
  const [xMin, xMax] = readScaleDomain(svgEl, "x") ?? [xs[0]!, xs[xs.length - 1]!];
  // One x value is a zero-width domain; d3 (and so Plot) maps it to the middle of the range.
  const xToPx = (x: number): number => ml + (xMax > xMin ? (x - xMin) / (xMax - xMin) : 0.5) * plotW;
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
  const hit = appendHitRect(svgEl, "tbl-crosshair-hit", W, H, "crosshair");

  const tip = emitOnly || opts.showTooltip === false ? null : getSharedTooltip(svgEl.ownerDocument, opts.tooltipContainer);
  const card = tooltipOwnership(tip);
  let active = false;

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
    active = true;
    opts.onResolve?.(snap);
    if (emitOnly) return;
    const gx = xToPx(snap);
    guide!.setAttribute("x1", String(gx));
    guide!.setAttribute("x2", String(gx));
    guide!.setAttribute("opacity", "1");

    if (!tip) return; // chrome.tooltip: false — guide shown, no card.

    tip!.innerHTML = buildLineTooltipHtml(snap, bySeries, {
      xFormat,
      yFormat,
      seriesLabels,
      seriesOrder,
      icons: opts.icons,
      showTotal: opts.showTotal,
      overlays: opts.overlays,
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
    if (guide) guide.setAttribute("opacity", "0");
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
 * Attach a coordinated cursor to a CONTINUOUS (line) small-multiples pane. Returns a driver:
 * `driver(xValue, active)` snaps to this pane's nearest x and renders the guide + per-series dot
 * and a compact value label (on a pill); when `active`, labels use a heavier weight and the
 * current x value is shown at the axis. `driver(null)` clears. No pointer handlers.
 *
 * The x echo has two forms. By DEFAULT it mirrors the axis ticks — one line per tick row, `%b`
 * over `%Y`, or the bare year alone on an annual series — and so needs tick rows to sit on: `makeAxisRows` finds none on a temporal span
 * shorter than a month, and the echo is skipped. With `xFormatExplicit` (the spec set
 * `tooltip_x_format`) it draws that format on ONE line, anchored to the tick rows where they exist
 * and just below the plot where they do not — an author who states an x format is telling us the x
 * value has to be readable, and a daily figure is exactly the case with no ticks to hang it on.
 * On that branch only, the tick labels the pill covers are hidden for as long as it is showing
 * (`hideAxisLabelsUnder`), because an author's format can be wider than the tick it lands on.
 */
export function attachSecondaryLineCursor(
  svgEl: SVGSVGElement,
  opts: CrosshairOptions,
): (xValue: number | null, active?: boolean) => void {
  const noop = (): void => {};
  if (!svgEl || !opts.rows?.length) return noop;
  const { rows, xField = "time", yField = "value", seriesField = "series", colors, seriesOrder } = opts;
  const { xParse } = opts;
  const yFormat = opts.yFormat ?? defaultYFormat;

  const { W, H, ml, mr, mt, mb } = readFrame(svgEl);
  const plotW = W - ml - mr;
  const plotH = H - mt - mb;

  // x PARSING is the caller's `xParse`; x FORMATTING is `opts.xFormat`, read in the `active` branch
  // below and gated on `opts.xFormatExplicit` — see this function's contract above and the
  // `attachSecondaryHistogramCursor` precedent (it re-uses the primary's own `formatBinLabel` opts
  // "so the coordinated label matches"). The gate is the load-bearing part: `tooltipXFormat` is
  // ALWAYS a function on a temporal axis (the x-adapter defaults it to `%b %Y`), so honouring it
  // unconditionally would collapse the default two-line echo — one line per axis tick row — into a
  // single "Jun 2026" on every published multi-pane temporal figure, including the ones that set
  // nothing. Only an author-set `tooltip_x_format` may change what a pane echoes.
  const xs = Array.from(new Set(rows.map((r) => xParse(r[xField])))).sort((a, b) => a - b);
  if (!xs.length) return noop;
  const bySeries = new Map<string, Map<number, number>>();
  for (const r of rows) {
    const v = r[yField];
    if (v === "" || v == null) continue;
    const k = r[seriesField] as string;
    if (!bySeries.has(k)) bySeries.set(k, new Map());
    bySeries.get(k)!.set(xParse(r[xField]), +(v as number));
  }
  // The range Plot drew, which can be wider than these rows (see readScaleDomain).
  const [xMin, xMax] = readScaleDomain(svgEl, "x") ?? [xs[0]!, xs[xs.length - 1]!];
  // A zero-width domain (one x value) maps to the middle, as in attachCrosshair and in Plot.
  const xToPx = (x: number): number => ml + (xMax > xMin ? (x - xMin) / (xMax - xMin) : 0.5) * plotW;
  const order =
    seriesOrder && seriesOrder.length ? seriesOrder.filter((s) => bySeries.has(s)) : [...bySeries.keys()];

  // x-axis label format: temporal (two lines: month / year; one line, the year, for an annual
  // series, as the axis and the card print it), quarterly, or plain. Drives the active pane's
  // highlighted x value so its line breaks match the axis. The form comes from `xAxisType` when the
  // caller passes it; sniffing the raw cell is only the fallback, and it misses a bare `YYYY` — a
  // valid temporal value, whose parsed timestamp then fell through to `String()`.
  const sampleX = String(rows[0]?.[xField] ?? "");
  const isDate = opts.xAxisType ? opts.xAxisType === "temporal" : /^\d{4}-\d{2}-\d{2}/.test(sampleX);
  const isQuarter = opts.xAxisType ? opts.xAxisType === "quarterly" : /Q\d/.test(sampleX);
  const isAnnual = isDate && isAnnualSeries(xs.map((x) => new Date(x)));

  const doc = svgEl.ownerDocument;
  const g = makeCoordGroup(svgEl);
  const axisRows = makeAxisRows(svgEl, mt + plotH);
  // Tick labels this pane's echo pill is currently covering. Restored at the TOP of every driver
  // call (the clear path included), so the axis is whole again before anything is redrawn — a pane
  // can never accumulate hidden ticks as the cursor moves across it.
  let hiddenTicks: HiddenTick[] = [];

  return (xValue: number | null, active = false): void => {
    while (g.firstChild) g.removeChild(g.firstChild);
    restoreAxisLabels(hiddenTicks);
    if (xValue == null) {
      g.setAttribute("opacity", "0");
      return;
    }
    // Snap to this pane's nearest x (panes may not share identical x-sets) — but only within this
    // pane's own data. Panes share one x range, so another pane can be hovered where this one has
    // no data at all; snapping there would show a neighbouring year's values as if they were the
    // hovered one's. Outside, the guide marks the hovered x and no value is drawn.
    let nx = xValue;
    if (xValue >= xs[0]! && xValue <= xs[xs.length - 1]!) {
      let best = Infinity;
      for (const x of xs) {
        const d = Math.abs(x - xValue);
        if (d < best) { best = d; nx = x; }
      }
    }
    const gx = xToPx(nx);
    addCoordGuide(g, doc, gx, mt, mt + plotH);
    // Active pane: draw the full current x value at the axis, matching its line breaks (a
    // temporal date shows month + year on two lines even mid-year, e.g. "Jul" / "2021") — unless
    // the spec named its own `tooltip_x_format`, which is one string and so one line.
    if (active) {
      const ys = axisRows.get();
      if (opts.xFormatExplicit && opts.xFormat) {
        // Centre the single line on the tick rows it replaces; with no rows to replace (a temporal
        // span under a month draws no ticks — the case the field exists for) sit just below the
        // plot, clamped inside the frame so the pill cannot spill out of the viewBox.
        const cy = ys.length
          ? (ys[0]! + ys[ys.length - 1]!) / 2
          : Math.min(mt + plotH + 11, H - 8);
        const box = addCoordAxisLabel(g, doc, gx, [{ text: opts.xFormat(nx), cy }]);
        // The pill is sized from the AUTHOR's format, not from the tick it lands on, so it can be
        // wider than that tick and spill onto its neighbours (issue #30). Below-the-rows is not
        // available to move it to: the bottom margin is sized for the tick rows it already has
        // (two 13px rows in a 38px margin), so a 14.5px pill under the last row falls outside the
        // viewBox. Hide the ticks it covers instead — the echo IS the x value those ticks name,
        // read finer. Only on this branch: the default echo is no wider than its tick, and this
        // must not move it.
        if (box) hiddenTicks = hideAxisLabelsUnder(svgEl, mt + plotH, box);
      } else if (ys.length) {
        let lines: Array<{ text: string; cy: number }>;
        if (isAnnual) {
          lines = [{ text: d3.timeFormat("%Y")(new Date(nx)), cy: ys[0]! }];
        } else if (isDate) {
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
      // showPills: false (chrome.valuePills) suppresses only these value pills — the guide
      // (above), the per-series highlight dot (just above), and the active-pane x-value echo are
      // untouched, matching SecondaryBandOptions'/HistogramHoverOptions' identical split.
      if (opts.showPills !== false) {
        const labelYs = spreadLabelYs(pts.map((p) => toPy(p.v)), COORD_PILL_H, mt, mt + plotH);
        pts.forEach((p, i) => {
          addCoordPill(g, doc, flip ? gx - 10 : gx + 10, labelYs[i]!, flip ? "end" : "start", yFormat(p.v), colors?.get(p.s) || "#666666", weight);
        });
      }
    }
    g.setAttribute("opacity", "1");
  };
}
