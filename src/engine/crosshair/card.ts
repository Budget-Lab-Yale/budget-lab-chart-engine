// Hover card layer, split out of crosshair.ts (re-exported there): the shared floating card
// element and its ownership, and the PURE builders of the card's markup. No pointer handling here.
//
// `tooltipsByParent` and `tooltipOwners` are the ONLY module-level mutable state in the crosshair
// family. They live here and nowhere else: a second copy in another module would give two charts two
// "shared" cards, and an ownership check against the wrong map would hide another chart's card.
import { escapeHtml } from "../util";
import { TBL } from "../theme";
import { categoryText } from "../../spec/section-key";
import { ownValue } from "../../spec/own-key";
import { iconSvgMarkup, iconFromLegendItem, type IconSpec } from "../icon";
import { formatBinLabel, type BinLabelOpts } from "../histogram-label";
import { overlayValueAt } from "../overlays";
import type { OverlayTooltipLine } from "../overlays";
import type { TotalRow } from "../../spec/bar-stack";
import type { TooltipHookCtx } from "../../spec/hooks";
import type { HistogramBin } from "./layout-math";

/** The separator between a card row's LABEL span and its VALUE span: a NON-BREAKING space.
 *
 *  `.tbl-tooltip` wraps at its 320px `max-width` (it used to `nowrap` and clip the overflow
 *  instead -- see the rule in styles.ts, #41). A PLAIN space here is a break opportunity, so a
 *  label longer than one line filled that line and the number it labels dropped onto a line of its
 *  own -- "...(percentage points)" above a lone "2.59", which reads as two statements rather than
 *  one. Written as the escape rather than the character so it is greppable and cannot be mistaken
 *  for the plain space it replaced, and as a text node rather than `&nbsp;` so the markup carries
 *  no HTML-only entity.
 *
 *  Every row builder in this file reads this constant -- there are seven emission sites (the
 *  scatter card's x and y rows, the shared series row, the band card's two Total variants, the
 *  cumulative-area Total, and the overlay rows) and they drifted apart on smaller things than
 *  this. Gated by test/card-wrap.test.ts. The treemap card's rows (treemap-hover.ts) are an eighth
 *  site, importing this constant; test/treemap-live.test.ts gates that one. */
export const LABEL_VALUE_GAP = "\u00a0";

// One shared tooltip element PER PARENT, not one global element: render-live's
// `MountOptions.tooltipContainer` lets each mount choose where its card is appended, and two
// mounts that choose DIFFERENT parents must get their own element rather than fighting over one
// (the parent that lost would keep re-appending/repositioning the single node under the other's
// mount). Keyed by the parent itself (a WeakMap, so a removed/GC'd container's entry doesn't
// pin the tooltip element in memory) — the historical single-tooltip-per-document behaviour is
// just this map with exactly one key, `document.body`, which is the default below.
const tooltipsByParent = new WeakMap<Node, HTMLElement>();

export function getSharedTooltip(doc: Document, parent: HTMLElement = doc.body): HTMLElement {
  const existing = tooltipsByParent.get(parent);
  if (existing && parent.contains(existing)) return existing;
  const tip = doc.createElement("div");
  tip.className = "tbl-tooltip";
  parent.appendChild(tip);
  tooltipsByParent.set(parent, tip);
  return tip;
}

// The attachment that last showed each shared card. The card is shared per parent (above), so a
// detach that hid it unconditionally would hide ANOTHER chart's card: chart A torn down while the
// pointer sits on chart B. A pointerleave hide needs no check -- a pointer leaves A before it can
// reach B -- so the attach functions consult this only on detach.
const tooltipOwners = new WeakMap<HTMLElement, object>();

/** The card half of one hover attachment: `show` makes it visible and records this attachment as
 *  its owner; `release` hides it only while this attachment still owns it. */
export function tooltipOwnership(tip: HTMLElement | null): { show: () => void; release: () => void } {
  const owner = {};
  return {
    show: () => {
      if (!tip) return;
      tooltipOwners.set(tip, owner);
      tip.style.opacity = "1";
    },
    release: () => {
      if (!tip || tooltipOwners.get(tip) !== owner) return;
      tooltipOwners.delete(tip);
      tip.style.opacity = "0";
    },
  };
}

/** One tooltip key, for every tooltip path.
 *
 *  There were three near-copies of this, and each knew about a different subset of the channels — so
 *  the line/area path drew a flat line for a series whose legend key was a square with a texture in
 *  it. A shared emitter means a new channel is added once. The legend and the PNG export are on the
 *  same description too — all three read `iconShapes` (icon.ts) and differ only in what they hand
 *  back: an HTML string here, a DOM `<svg>` for the legend, a positioned `<g>` for the export.
 *
 *  A texture wins over the requested shape: the glyph carries its own ground, so a hatched series
 *  needs no colour fill underneath. */
export function seriesSwatchHtml(icon: IconSpec): string {
  return `<span class="tbl-tooltip-swatch">${iconSvgMarkup(icon)}</span>`;
}

/** The tooltip rows a set of `overlays[].tooltip: true` lines contributes at `x`.
 *
 *  ONE emitter, shared by the continuous crosshair and the scatter point hover, so the two cannot
 *  drift on what a modelled row looks like — the same discipline `seriesSwatchHtml` enforces for
 *  series keys.
 *
 *  A line with NO value at `x` contributes no row: `overlayValueAt` returns null outside the drawn
 *  extent (an `overlays[].domain` crop) and across a break, and the caller has already dropped the
 *  overlays that do not draw in this pane. A row for a line the reader cannot see at that x is the
 *  same class of defect as a legend row for a line drawn nowhere.
 *
 *  Every row draws a LINE swatch in the line's own colour and dash, and the first carries a
 *  separator rule. A modelled number set in a list of observed ones with no marker is the thing this
 *  guards against, and the dash is the engine's own statement of which kind of claim a line is
 *  (CONFIG-SPEC `overlays[].style`: computed FROM the data draws solid, asserted OVER it dashed).
 *
 *  The series name is appended only when it DISAMBIGUATES — a per-series fit resolves to one line
 *  per series under one label, and two rows reading "Trend" would be unreadable. A single line keeps
 *  the author's label exactly as written. */
export function overlayTooltipRows(
  overlays: OverlayTooltipLine[] | undefined,
  x: number,
  yFormat: (v: number) => string,
  seriesLabels?: Record<string, string>,
): string {
  if (!overlays?.length) return "";
  const drawn: Array<{ o: OverlayTooltipLine; v: number }> = [];
  for (const o of overlays) {
    const v = overlayValueAt(o.points, x);
    if (v != null && Number.isFinite(v)) drawn.push({ o, v });
  }
  if (!drawn.length) return "";
  const perLabel = new Map<string, number>();
  for (const d of drawn) perLabel.set(d.o.label, (perLabel.get(d.o.label) ?? 0) + 1);
  let html = "";
  drawn.forEach(({ o, v }, i) => {
    const name =
      o.series != null && (perLabel.get(o.label) ?? 0) > 1
        ? `${o.label} (${ownValue(seriesLabels, o.series) ?? o.series})`
        : o.label;
    const swatch = seriesSwatchHtml({
      shape: "line",
      color: o.color,
      ...(o.dashed ? { dashed: true } : {}),
    });
    const cls =
      "tbl-tooltip-row tbl-tooltip-row--overlay" + (i === 0 ? " tbl-tooltip-row--overlay-first" : "");
    html +=
      `<div class="${cls}">${swatch}<span><span class="tbl-tooltip-label">${escapeHtml(name)}:</span>${LABEL_VALUE_GAP}` +
      `<span class="tbl-tooltip-value">${escapeHtml(yFormat(v))}</span></span></div>`;
  });
  return html;
}

/** The icon a tooltip row should draw for `series`. `icons` (see icon.ts resolveTooltipIcons) is
 *  the ONLY source, and that is the whole point of this function existing.
 *
 *  It used to take a second set of loose channels — colour, shape, dashed, hatch, marker — and
 *  synthesise a key from them whenever `icons` had no entry. Two mechanisms for one job, and the
 *  second one was a partial copy of the legend's rules that drifted from them. It reached exactly
 *  the charts with no legend row — a single unstyled series on any chart type, and anything under
 *  `legend: false`; `legendShowsSeriesRows` (index.ts) is the rule — which is why a lone dot plot
 *  keyed a line and a lone dumbbell keyed a plain disc instead of the sized, box-centred symbol the
 *  multi-series version already drew. Those charts now resolve through the same resolver as the
 *  rest, from `seriesKeyRows` — the row the legend WOULD have drawn (see icon.ts resolveTooltipIcons
 *  and index.ts buildSeriesKeyRows).
 *
 *  A series with no entry draws an EMPTY box rather than a guessed one: guessing is what the second
 *  mechanism did, and a key asserting something false about a mark is worse than no key. The box
 *  still occupies its column or the label hangs left of every row above it. That case is a BUG, and
 *  test/key-agreement.test.ts gates it by asserting an icon resolves for every series of every chart
 *  type — including the ones that draw no legend. */
function rowIcon(series: string, icons: Map<string, IconSpec> | undefined): IconSpec {
  return icons?.get(series) ?? { shape: "none" };
}

/** PURE — one SERIES row of a tooltip card: the series' key, then `Label: value` — or the value
 *  ALONE when the series has no name.
 *
 *  **No name ⇒ no label AND no colon**, and this is the single place that rule lives. A chart with no
 *  series column has one implicit series keyed SINGLE_SERIES_KEY (""), and each of the four card
 *  builders below used to emit `<span class="tbl-tooltip-label">:</span>` for it regardless — so a
 *  single-series histogram, categorical-x line, dot plot, temporal line and area card each read
 *  ": 10.00", a colon labelling nothing.
 *
 *  No invented word instead, on any of them: what the value MEANS is whatever the value axis
 *  measures — dollars, a share, a count — which differs per figure and not per chart type, so
 *  "Value" would be a word standing in for the absence of one (the histogram case is sharper still:
 *  its height is a row count, a `histogram.weight` sum, or a pre-binned `value`, so "Count" would be
 *  false on two of the three). The swatch already identifies the mark, and an author who wants a word
 *  has `series_labels: {"": "…"}`, legal for exactly this case (see validate.ts) — it resolves into
 *  `display` here and prints normally.
 *
 *  Every label-bearing series row in this file routes through here so the builders cannot drift on
 *  this again. The `Total` rows deliberately do NOT: their label is a fixed word that is never
 *  empty, and they carry their own classes and rule/spacer markup.
 *  Gated by test/single-series-card-label.test.ts (all five types, at defaults). */
export function tooltipSeriesRowHtml(
  series: string,
  valueText: string,
  opts: { seriesLabels?: Record<string, string>; icons?: Map<string, IconSpec> },
): string {
  const display = ownValue(opts.seriesLabels, series) || series;
  const swatch = seriesSwatchHtml(rowIcon(series, opts.icons));
  const label = display === "" ? "" : `<span class="tbl-tooltip-label">${escapeHtml(display)}:</span>${LABEL_VALUE_GAP}`;
  return `<div class="tbl-tooltip-row">${swatch}<span>${label}<span class="tbl-tooltip-value">${escapeHtml(valueText)}</span></span></div>`;
}

/**
 * Build the inner HTML for the band tooltip: header row + one row per series
 * present for `category`, ordered by `seriesOrder`, plus an optional Total row
 * for stacked charts. PURE — no DOM access.
 *
 * The Total row rendering depends on `totalRow` (spec/bar-stack.ts's `TotalRow`):
 *   - "dot":  dot-swatch circle (is-dot) — diverging stack with a net-dot marker.
 *   - "text": plain text label only (no swatch) — cumulative stack with text callout.
 *   - "none" (or omitted): Total row is omitted — netDisplay:"none" / normalized stack.
 */
/** Resolve `rows` down to the values for one category, in tooltip-row order: `series` filtered to
 *  those with a finite value for `category` (ordered by `seriesOrder` when given, else
 *  data-encounter order), and `values` keyed by series. The single source `buildBandTooltipHtml`'s
 *  card and `attachBandCrosshair`'s `onHover` notifier both read from, so the tooltip and the
 *  hover event can never disagree about what a category's values are. */
export function resolveCategorySeriesValues(
  category: string,
  rows: Array<{ _xc?: string; series: string; _y: number | null }>,
  seriesOrder?: string[],
): { series: string[]; values: Record<string, number> } {
  const valBySeries = new Map<string, number>();
  for (const r of rows) {
    if (r._xc === category && r._y != null && Number.isFinite(r._y)) valBySeries.set(r.series, r._y);
  }
  const series = seriesOrder && seriesOrder.length
    ? seriesOrder.filter((s) => valBySeries.has(s))
    : [...valBySeries.keys()];
  // defineProperty, not `values[s] =`: assigning to "__proto__" hits the inherited setter and
  // drops the series, which then read back as Object.prototype. Defined, it is an own key.
  const values: Record<string, number> = {};
  for (const s of series) {
    Object.defineProperty(values, s, {
      value: valBySeries.get(s)!, enumerable: true, writable: true, configurable: true,
    });
  }
  return { series, values };
}

export function buildBandTooltipHtml(
  category: string,
  rows: Array<{ _xc?: string; series: string; _y: number | null; _section?: string }>,
  opts: {
    isStacked?: boolean;
    totalRow?: TotalRow;
    /** Where the Total row sits: "last" (default, after the series rows) or "first". */
    totalPosition?: "first" | "last";
    /** Bold the Total row. Default ON (opt-out: pass `false`) — this builder is the single
     *  source of that default; callers (attachBandCrosshair's forward, live/hover-options.ts's
     *  band plan) pass the spec value straight through un-defaulted. */
    totalBold?: boolean;
    /** Rule separating the Total row from the series rows; side flips with `totalPosition` —
     *  "last" (row sits below the series rows) draws the rule ABOVE it (border-top), "first" (row
     *  sits above them) draws it BELOW (border-bottom). A fixed top-only rule would, in "first"
     *  position, separate the category header from the Total row instead of the Total row from
     *  the series rows — the wrong pair. Default ON (opt-out: pass `false`), for the same
     *  single-source-of-default reason as totalBold above. */
    totalDivider?: boolean;
    seriesLabels?: Record<string, string>;
    seriesOrder?: string[];
    yFormat?: (v: number) => string;
    /** Raw category value → display label for the tooltip header (e.g. "1" → "1st Decile"). */
    categoryLabels?: Record<string, string>;
    /** Prefix the header with the category's section ("<section> · <category>"); see
     *  BandCrosshairOptions.tooltipSection. */
    tooltipSection?: boolean;
    sectionLabels?: Record<string, string>;
    /** Series → its resolved icon FOR THE CATEGORY being built. The ONLY source of a row's key; see
     *  resolveTooltipIcons. The caller re-colours it from the DRAWN fill first (recolourIcons, once
     *  per category — see `readCategoryFills`), which is what keeps a `bar_color` /
     *  `category_colors` / waterfall bar's key on the colour under the cursor. */
    icons?: Map<string, IconSpec>;
    /** Screen-only (see spec/hooks.ts's `TooltipHookCtx`) — replaces the returned markup; `null`
     *  keeps the engine's own `html` built below. Both callers (attachBandCrosshair,
     *  attachCategoricalLineCrosshair) forward their own `tooltipHook` option straight through. */
    tooltipHook?: (ctx: TooltipHookCtx) => string | null;
    /** This pane facet value, threaded straight into TooltipHookCtx.facet -- see
     *  BandCrosshairOptions.facet. undefined outside small multiples. */
    facet?: string;
  },
): string {
  const { isStacked, totalRow, seriesLabels, seriesOrder, yFormat, categoryLabels } = opts;
  const fmt = yFormat ?? ((v: number) => String(v));

  const { series: orderedSeries, values: valuesBySeries } = resolveCategorySeriesValues(
    category, rows, seriesOrder,
  );

  // `category` may be a section key; the card, the hook and x_labels see the display text.
  const shown = categoryText(category);
  const catHead = escapeHtml(ownValue(categoryLabels, shown) ?? shown);
  // The category's section is its first row's, as the band groups it (marks/category-band.ts).
  const section = opts.tooltipSection
    ? rows.find((r) => r._xc === category && r._section != null)?._section
    : undefined;
  const head = section
    ? `${escapeHtml(ownValue(opts.sectionLabels, section) ?? section)} · ${catHead}`
    : catHead;
  let html = `<div class="tbl-tooltip-head">${head}</div>`;
  let seriesRows = "";
  let total = 0;
  for (const series of orderedSeries) {
    const v = ownValue(valuesBySeries, series);
    if (v == null) continue;
    total += v;
    seriesRows += tooltipSeriesRowHtml(series, fmt(v), {
      ...(seriesLabels ? { seriesLabels } : {}),
      ...(opts.icons ? { icons: opts.icons } : {}),
    });
  }

  // Built but not yet placed — `totalPosition` decides which side of the series rows it lands on.
  // The two branches are kept separate rather than parameterised on an empty swatch string, so the
  // default path emits byte-identical markup to what it emitted before this field existed.
  const hasTotalRow = !!(isStacked && orderedSeries.length > 1 && totalRow && totalRow !== "none");
  let totalRowHtml = "";
  if (hasTotalRow) {
    const position = opts.totalPosition ?? "last";
    const rowClasses = [
      "tbl-tooltip-row",
      "tbl-tooltip-row--total",
      // Default ON (opt-out): (opts.totalBold ?? true). The builder is the single source of
      // this default — live/hover-options.ts passes spec.barStack?.total?.bold/.divider straight
      // through undefined-when-unset, and an explicit `false` in the spec still wins here.
      ...((opts.totalBold ?? true) ? ["tbl-tooltip-row--total-bold"] : []),
      ...((opts.totalDivider ?? true)
        ? [position === "first" ? "tbl-tooltip-row--total-rule-below" : "tbl-tooltip-row--total-rule-above"]
        : []),
    ].join(" ");
    if (totalRow === "dot") {
      // Keys the net-dot marker, so it draws the SAME icon the legend's "Total" row draws — a
      // colourless `dot`, which icon.ts resolves to the white disc with the black ring.
      const totalSwatch = seriesSwatchHtml(iconFromLegendItem({ markerShape: "dot" }));
      totalRowHtml = `<div class="${rowClasses}">${totalSwatch}<span><span class="tbl-tooltip-label">Total:</span>${LABEL_VALUE_GAP}<span class="tbl-tooltip-value">${escapeHtml(fmt(total))}</span></span></div>`;
    } else {
      // No real swatch (no dot on the chart) — but an EMPTY spacer with the SAME class as a real
      // swatch, so the label still sits at the swatch+gap indent every series row uses. Before
      // this the text row emitted no swatch element at all and sat flush left, one swatch-plus-gap
      // short of every row above it.
      const spacer = `<span class="tbl-tooltip-swatch" aria-hidden="true"></span>`;
      totalRowHtml = `<div class="${rowClasses}">${spacer}<span><span class="tbl-tooltip-label">Total:</span>${LABEL_VALUE_GAP}<span class="tbl-tooltip-value">${escapeHtml(fmt(total))}</span></span></div>`;
    }
  }

  html += (opts.totalPosition ?? "last") === "first" ? totalRowHtml + seriesRows : seriesRows + totalRowHtml;

  // hooks.tooltip (#30, Task 5): screen-only content replacement — the engine still does the
  // hit-testing/positioning/highlight around this card (see its two callers, band.ts and catline.ts). `total`
  // reuses `hasTotalRow` above so it is only handed to the hook when a Total row would actually
  // show — callers that never pass isStacked/totalRow (attachCategoricalLineCrosshair, except for a
  // categorical-x area's `showTotal`) have no "total" concept, and the raw series sum would
  // mislabel one for them.
  if (opts.tooltipHook) {
    const hooked = opts.tooltipHook({
      category: shown,
      series: orderedSeries,
      values: valuesBySeries,
      ...(hasTotalRow ? { total } : {}),
      ...(opts.facet != null ? { facet: opts.facet } : {}),
      rendered: html,
    });
    if (hooked != null) return hooked;
  }

  return html;
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
    seriesLabels?: Record<string, string>;
    seriesOrder?: string[];
    yFormat?: (v: number) => string;
    /** Drives the friendly bin-range header. Absent ⇒ a plain numeric en-dash range. */
    label?: BinLabelOpts;
    /** Series → its resolved icon. The ONLY source of a row's key; see resolveTooltipIcons. The
     *  caller re-colours it from the DRAWN bin fill first (recolourIcons), so a `bar_color`
     *  histogram keys the colour it painted rather than its palette entry. */
    icons?: Map<string, IconSpec>;
  },
): string {
  const { seriesLabels, seriesOrder } = opts;
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
    // No name ⇒ no label and no colon — the rule and its reasoning live in tooltipSeriesRowHtml,
    // which every card builder here shares so they cannot diverge on it.
    html += tooltipSeriesRowHtml(series, yFormat(v), {
      ...(seriesLabels ? { seriesLabels } : {}),
      ...(opts.icons ? { icons: opts.icons } : {}),
    });
  }
  return html;
}
/** PURE — the continuous (line / area) crosshair's card at the snapped x: the x header, one row per
 *  series with a value there (in `seriesOrder` when given, else data-encounter order), the optional
 *  cumulative Total, then the `overlays[].tooltip` rows. `bySeries` is series → x → value. */
export function buildLineTooltipHtml(
  snap: number,
  bySeries: Map<string, Map<number, number>>,
  opts: {
    xFormat?: (v: number) => string;
    yFormat: (v: number) => string;
    seriesLabels?: Record<string, string>;
    seriesOrder?: string[];
    icons?: Map<string, IconSpec>;
    showTotal?: boolean;
    overlays?: OverlayTooltipLine[];
  },
): string {
  const { xFormat, yFormat, seriesLabels, seriesOrder } = opts;
  let html = `<div class="tbl-tooltip-head">${escapeHtml(xFormat!(snap))}</div>`;
  const tipSeries =
    seriesOrder && seriesOrder.length
      ? seriesOrder.filter((s) => bySeries.has(s))
      : [...bySeries.keys()];
  let total = 0;
  let shownRows = 0;
  for (const series of tipSeries) {
    const m = bySeries.get(series)!;
    const v = m.get(snap);
    if (v == null || Number.isNaN(v)) continue;
    total += v;
    shownRows++;
    html += tooltipSeriesRowHtml(series, yFormat(v), {
      ...(seriesLabels ? { seriesLabels } : {}),
      ...(opts.icons ? { icons: opts.icons } : {}),
    });
  }
  // Cumulative total (stacked area): a bold summary row, set off by a top rule.
  //
  // `shownRows > 1`, not `> 0`: a Total row states the sum of the rows above it, and the sum of
  // one row is that row — a single-series area card read "4.00" and then "Total: 4.00". The count
  // is of the rows this card actually DREW at the snapped x, not of the chart's series, which is
  // the same rule `buildBandTooltipHtml` applies with `orderedSeries.length > 1` (also a
  // per-hovered-category count). The two card builders have to agree: they are the same promise.
  if (opts.showTotal && shownRows > 1) {
    // The Total of a cumulative stack names no series, so it draws no key — but it still occupies
    // the box, or its label hangs left of every row above it. `shape: "none"` IS that empty box.
    const blank = seriesSwatchHtml({ shape: "none" });
    html += `<div class="tbl-tooltip-row" style="border-top:1px solid var(--tbl-gridline,#eee);margin-top:3px;padding-top:3px;font-weight:600">${blank}<span><span class="tbl-tooltip-label">Total:</span>${LABEL_VALUE_GAP}<span class="tbl-tooltip-value">${escapeHtml(yFormat(total))}</span></span></div>`;
  }
  // `overlays[].tooltip: true` lines LAST — a fitted or asserted line is a third kind of claim,
  // after the observed series and the total OF those series, and its own separator rule says so.
  html += overlayTooltipRows(opts.overlays, snap, yFormat, seriesLabels);
  return html;
}

/** PURE — the scatter card for ONE point: its marker and "series · shape · label" header, the x and
 *  y rows, then the overlay rows that apply to the point's series. */
export function buildPointTooltipHtml(
  p: { series: string; shape?: string; x: number; y: number | null; pointLabel?: string },
  opts: {
    icons?: Map<string, IconSpec>;
    colors?: Map<string, string>;
    seriesLabels?: Record<string, string>;
    shapeLabels?: Record<string, string>;
    showShape?: boolean;
    showSeriesName?: boolean;
    symbols?: Map<string, string>;
    xLabel?: string;
    yLabel?: string;
    overlays?: OverlayTooltipLine[];
  },
  xFormat: (v: number) => string,
  yFormat: (v: number) => string,
): string {
  const color = opts.colors?.get(p.series) || TBL.color.navy;
  const sLabel = ownValue(opts.seriesLabels, p.series) ?? p.series;
  // Header: the point's actual marker (its symbol, filled in the series color) followed by
  // "series · shape" on one line (e.g. a navy triangle + "Slow · Compressive").
  const symbolName = (p.shape && opts.symbols?.get(p.shape)) || "circle";
  // SPLIT ON PURPOSE — shape from the point, colour from the resolved icon. Everywhere else a
  // tooltip key names a SERIES, so it defers wholly to the resolved icon and cannot drift from
  // the legend. This header names ONE POINT, so the resolved icon is the wrong authority for its
  // shape: when colour and shape encode different fields, buildLegendItems keys the colour
  // legend with a `chip` (index.ts), so deferring drew a rounded square next to
  // "Slow · Compressive" while the point under the cursor was a triangle. COLOUR is the half the
  // resolved icon does own — legend recolouring and marker paint live there — so it still wins
  // that. Do not "restore consistency" by taking the resolved icon whole.
  const resolved = opts.icons?.get(p.series);
  const swatch = seriesSwatchHtml({
    shape: "symbol",
    color: resolved?.color ?? color,
    symbol: symbolName,
    ...(resolved?.marker ? { marker: resolved.marker } : {}),
  });
  // series · shape · identity. The identity token comes last so every header that existed
  // before this field reads exactly as it did. EMPTY tokens are dropped rather than joined: a
  // single-series chart resolves to SINGLE_SERIES_KEY (""), and joining that produced a header
  // opening with a dangling "· ".
  const tokens = opts.showSeriesName === false ? [] : [sLabel];
  if (opts.showShape && p.shape) tokens.push(ownValue(opts.shapeLabels, p.shape) ?? p.shape);
  if (p.pointLabel) tokens.push(p.pointLabel);
  const headText = tokens.filter((t) => t !== "").map(escapeHtml).join(" · ");
  let html = `<div class="tbl-tooltip-head">${swatch}${headText}</div>`;
  html += `<div class="tbl-tooltip-row"><span><span class="tbl-tooltip-label">${escapeHtml(opts.xLabel ?? "x")}:</span>${LABEL_VALUE_GAP}<span class="tbl-tooltip-value">${escapeHtml(xFormat(p.x))}</span></span></div>`;
  if (p.y != null && Number.isFinite(p.y)) {
    html += `<div class="tbl-tooltip-row"><span><span class="tbl-tooltip-label">${escapeHtml(opts.yLabel ?? "y")}:</span>${LABEL_VALUE_GAP}<span class="tbl-tooltip-value">${escapeHtml(yFormat(p.y))}</span></span></div>`;
  }
  // Scoped to the hovered point: a pooled fit / `fun` / abline applies to every point, a
  // per-series fit only to its own series. The header already names that series, so the rows
  // carry the author's label unadorned (see overlayTooltipRows on when the suffix appears).
  html += overlayTooltipRows(
    opts.overlays?.filter((o) => o.series == null || o.series === p.series),
    p.x,
    yFormat,
  );
  return html;
}
