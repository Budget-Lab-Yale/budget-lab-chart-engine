// chartType: timeline — prepares events from rows, runs the pure layout, and draws it as
// hand-built SVG. Static: no hover, no crosshair; the legend's existing
// `[data-series], [data-annotation]` dim selector handles pin/dim because every event element
// carries data-series. All text is SVG <text> (HTML inside an SVG does not rasterise).
//
// Imports buildColorMap back from ../index, which imports renderTimeline from here: the same
// ES-module cycle figure.ts uses. Safe because both references resolve at call time, never while
// either module is still evaluating.
import { d3 } from "../vendor";
import { TBL } from "../theme";
import { tokens } from "../../theme/tokens";
import { isTruthyFlag } from "../util";
import { LABEL_HALO } from "../assemble-plot";
import { buildColorMap } from "../index";
import type { LegendItem, RenderOptions, RenderResult } from "../index";
import type { ChartSpec } from "../../spec/types";
import type { TidyRow } from "../../data/index";
import { parseDate } from "../../spec/parse-time";
import { SINGLE_SERIES_KEY } from "../../spec/columns";
import { ownValue } from "../../spec/own-key";
import {
  resolveTimelineConfig, timelineColumns, parseEndCell, deriveDateFormat, TIMELINE_EVENT_WARN_COUNT,
} from "../../spec/timeline";
import {
  layoutTimeline, verticalBlockWidth, TL_GEOM, LINE_STYLE, LANE_SIZE, LANE_LINE_H,
  type LayoutEvent, type TimelineLayout, type TimelineLayoutInput, type PlacedSpan,
} from "../timeline-layout";
import { resolveLegendPosition, LEGEND_COLUMN_WIDTH, LEGEND_GAP } from "../legend-layout";
import { W, INNER_W, MARGIN } from "../../embed/figure-chrome";

const SVG_NS = "http://www.w3.org/2000/svg";
export const TIMELINE_CLASS = "tbl-timeline";

type Orientation = "horizontal" | "vertical";

/** Rows → layout events, filtered and ordered by `series_order` (inclusion filter and render
 *  order, as on every chart type). `id` is the 0-based CSV row index (the layout's tie-break). */
export function prepareTimeline(spec: ChartSpec, rows: TidyRow[]): { events: LayoutEvent[]; seriesNames: string[] } {
  const cfg = resolveTimelineConfig(spec);
  const cols = timelineColumns(spec, rows);
  const cell = (r: TidyRow, c: string | null): string => (c ? String(r[c] ?? "") : "");
  const categoryOf = (r: TidyRow): string => (cols.series ? cell(r, cols.series) : SINGLE_SERIES_KEY);
  const encounter: string[] = [];
  for (const r of rows) {
    const k = categoryOf(r);
    if (!encounter.includes(k)) encounter.push(k);
  }
  // An empty series_order is no filter, as on every other chart type.
  const seriesNames = spec.series_order?.length ? spec.series_order.filter((s) => encounter.includes(s)) : encounter;
  const kept = rows
    .map((r, id) => ({ r, id, category: categoryOf(r) }))
    .filter((e) => seriesNames.includes(e.category));
  const parsed = kept.map((e) => {
    const start = parseDate(cell(e.r, cols.x).trim());
    const endCell = parseEndCell(cell(e.r, cols.end));
    const end = endCell.kind === "date" ? parseDate(endCell.value) : null;
    return { ...e, start, end, ongoing: endCell.kind === "ongoing" };
  });
  // One granularity per chart, derived from every start and closed end actually drawn.
  const fmt: (d: Date) => string = d3.timeFormat(
    cfg.dateFormat ?? deriveDateFormat(parsed.flatMap((e) => (e.end ? [e.start, e.end] : [e.start]))),
  );
  const events = parsed.map((e): LayoutEvent => {
    const override = cell(e.r, cols.date_label).trim();
    const dateText =
      override || (e.end ? `${fmt(e.start)} – ${fmt(e.end)}` : e.ongoing ? `${fmt(e.start)} –` : fmt(e.start));
    // An auto-generated open-ended span's visible dash reads as "onward" to a screen reader; an
    // override is used verbatim (as today), so this only fires when there is none.
    const ariaDateText = !override && e.ongoing ? `${fmt(e.start)} onward` : undefined;
    const description = cell(e.r, cols.description).trim();
    return {
      id: e.id, start: e.start, end: e.end, ongoing: e.ongoing, category: e.category, dateText, ariaDateText,
      title: cell(e.r, cols.label).trim(), description: description || null,
      projected: spec.projected_field ? isTruthyFlag(e.r[spec.projected_field]) : false,
    };
  });
  return { events, seriesNames };
}

interface Built {
  layout: TimelineLayout;
  events: LayoutEvent[];
  seriesNames: string[];
  lanesOn: boolean;
}

/** Whether `timeline.lanes` draws lanes in this orientation (D3). Horizontal: always. Vertical
 *  (authored or auto-switched): only as lane columns — exactly two lanes, unless
 *  `vertical_lanes: "single"`; three or more lanes draw one track and the legend names them. The
 *  one decision render, height, the export width and the warnings all share. */
function lanesDrawn(spec: ChartSpec, laneCount: number, orientation: Orientation): boolean {
  const cfg = resolveTimelineConfig(spec);
  if (!cfg.lanes) return false;
  return orientation === "horizontal" || (laneCount === 2 && cfg.verticalLanes === "columns");
}

/** The one place a spec + width + orientation becomes a layout input, so render, height, the
 *  auto-switch, the export frame and the warnings can never disagree about geometry. `budgetWidth`
 *  is the export's portrait budget (timelineExportFrame); absent everywhere else. */
function layoutInput(
  spec: ChartSpec, rows: TidyRow[], width: number, orientation: Orientation, budgetWidth?: number,
): Omit<Built, "layout"> & { input: TimelineLayoutInput } {
  const cfg = resolveTimelineConfig(spec);
  const { events, seriesNames } = prepareTimeline(spec, rows);
  const lanesOn = lanesDrawn(spec, seriesNames.length, orientation);
  const input: TimelineLayoutInput = {
    events, width, orientation, spacing: cfg.spacing,
    lanes: lanesOn ? seriesNames.map((k) => ({ key: k, label: ownValue(spec.series_labels, k) ?? k })) : null,
    axis: cfg.axis, labelWidth: cfg.labelWidth, maxRows: cfg.maxRows,
    ...(budgetWidth !== undefined ? { budgetWidth } : {}),
  };
  return { input, events, seriesNames, lanesOn };
}

function build(spec: ChartSpec, rows: TidyRow[], width: number, orientation: Orientation, budgetWidth?: number): Built {
  const { input, ...rest } = layoutInput(spec, rows, width, orientation, budgetWidth);
  return { layout: layoutTimeline(input), ...rest };
}

/** Live auto-switch (spec §5.4): an authored horizontal with `auto_vertical` renders vertical when
 *  the chart is narrower than TL_GEOM.autoVerticalMinWidth or the horizontal rows do not fit. An
 *  authored vertical never switches. */
export function resolveTimelineOrientation(spec: ChartSpec, rows: TidyRow[], chartWidth: number): Orientation {
  const authored = spec.orientation ?? "horizontal";
  if (authored === "vertical" || !resolveTimelineConfig(spec).autoVertical) return authored;
  if (chartWidth < TL_GEOM.autoVerticalMinWidth) return "vertical";
  return build(spec, rows, chartWidth, "horizontal").layout.fits ? "horizontal" : "vertical";
}

/** Content height at this width and orientation (default: the authored one), and, for the
 *  export's portrait frame, its budget width (timelineExportFrame). */
export function timelineHeight(
  spec: ChartSpec, rows: TidyRow[], width: number, orientation?: Orientation, budgetWidth?: number,
): number {
  return build(spec, rows, width, orientation ?? spec.orientation ?? "horizontal", budgetWidth).layout.height;
}

/** Non-fatal `tbl-chart validate` lines. The overflow check runs at the export width in the
 *  AUTHORED orientation, because that is what the PNG draws (the auto-switch is live only). */
export function timelineWarnings(spec: ChartSpec, rows: TidyRow[], exportWidth: number): string[] {
  const out: string[] = [];
  const { events, seriesNames } = prepareTimeline(spec, rows);
  if (events.length > TIMELINE_EVENT_WARN_COUNT) {
    out.push(`timeline has ${events.length} events; more than ${TIMELINE_EVENT_WARN_COUNT} is hard to read — consider splitting it`);
  }
  // Ruling 25: an explicit "columns" that cannot apply renders one track rather than failing.
  if (resolveTimelineConfig(spec).lanes && spec.timeline?.vertical_lanes === "columns" && seriesNames.length >= 3) {
    out.push(
      `timeline.vertical_lanes "columns" draws lane columns only for exactly two lanes; with ${seriesNames.length} lanes a vertical render draws one track`,
    );
  }
  if ((spec.orientation ?? "horizontal") === "horizontal" && !build(spec, rows, exportWidth, "horizontal").layout.fits) {
    const n = resolveTimelineConfig(spec).maxRows;
    out.push(
      `horizontal layout needs more than ${n} label rows per side at the ${exportWidth}px export width; the PNG adds overflow rows — raise timeline.max_rows, shorten labels, or use orientation: vertical`,
    );
  }
  return out;
}

/** Ruling 33: the widest frame a vertical timeline's PNG export uses (its chart area is this less
 *  both margins). */
export const TIMELINE_PORTRAIT_MAX_FRAME = 640;

/** How the PNG export frames a timeline (`buildExportSvg` in embed/export-png.ts). */
export interface TimelineExportFrame {
  /** The export's frame width: `W`, or a vertical timeline's portrait width. */
  frameW: number;
  /** The chart width the timeline is laid out and drawn at. */
  chartW: number;
  /** Whether the legend is a column right of the chart (never in a portrait frame). */
  rightLegend: boolean;
  /** Portrait only: the width the vertical layout budgets its columns at (renderChart's
   *  `timelineBudgetWidth`), which `chartW` is trimmed to fit. */
  budgetWidth?: number;
}

/** How the PNG export frames this timeline. Always the AUTHORED orientation: `buildExportSvg` never
 *  resolves the live auto-switch (`resolveTimelineOrientation` only applies to a live mount), so
 *  lane mode here does not need to account for it either — matching `timelineWarnings`' own
 *  overflow check. DOM-free by construction, so `tbl-chart validate` and the export both call this
 *  ONE function instead of computing the width two ways that only happen to agree (Ruling 17 /
 *  task-8 fix round 1: a right-legend timeline overflowed `max_rows` in the PNG with no validate
 *  warning, because validate always checked the full 920px).
 *
 *  Vertical (E3, Ruling 33): a portrait frame. The layout budgets its columns at the widest chart
 *  area (TIMELINE_PORTRAIT_MAX_FRAME less both margins, 560px), and the chart width is that
 *  layout's block (verticalBlockWidth: each text column hugging its content, at most
 *  vTextColumnMax), rounded up and
 *  never below the live floor TL_GEOM.minLiveWidth — so the frame is 360-640px wide and hugs the
 *  timeline, which the layout centres in it. The legend always goes above the chart: a portrait
 *  frame is narrower than the card width at which the live card keeps a right-hand column.
 *
 *  Horizontal: the fixed `W` frame; the chart is `INNER_W`, minus the right-hand legend column when
 *  the export shows one. A timeline's legend row count is fully determined by its series count,
 *  `series_legend`/`legend`, and lane mode (the same decision `renderTimeline` makes for its
 *  `legendItems`). */
export function timelineExportFrame(spec: ChartSpec, rows: TidyRow[]): TimelineExportFrame {
  if ((spec.orientation ?? "horizontal") === "vertical") {
    const budgetWidth = TIMELINE_PORTRAIT_MAX_FRAME - 2 * MARGIN;
    const block = verticalBlockWidth(layoutInput(spec, rows, budgetWidth, "vertical").input);
    const chartW = Math.min(budgetWidth, Math.max(TL_GEOM.minLiveWidth, Math.ceil(block)));
    return { frameW: chartW + 2 * MARGIN, chartW, rightLegend: false, budgetWidth };
  }
  if (spec.legend === false) return { frameW: W, chartW: INNER_W, rightLegend: false };
  const { seriesNames } = prepareTimeline(spec, rows);
  const lanesOn = lanesDrawn(spec, seriesNames.length, "horizontal");
  const showRows =
    spec.series_legend === true || (spec.series_legend !== false && seriesNames.length > 1 && !lanesOn);
  const legendCount = showRows ? seriesNames.length : 0;
  const rightLegend = legendCount > 0 && resolveLegendPosition(spec, legendCount, rows) === "right";
  return { frameW: W, chartW: rightLegend ? INNER_W - LEGEND_COLUMN_WIDTH - LEGEND_GAP : INNER_W, rightLegend };
}

/** The chart width the PNG export lays a timeline out at (timelineExportFrame's `chartW`). */
export function timelineExportChartWidth(spec: ChartSpec, rows: TidyRow[]): number {
  return timelineExportFrame(spec, rows).chartW;
}

/** Where an open-ended span's fade begins, as a share of the bar along its fade direction: the bar
 *  fades over its last TL_GEOM.fade px (all of it, if shorter). Rounded so the id stays short. */
function fadeStart(s: PlacedSpan): number {
  const len = s.fade === "down" ? s.h : s.w;
  return Math.round(Math.max(0, 1 - TL_GEOM.fade / len) * 1000) / 1000;
}

/** Content-derived gradient id (hatch.ts's scheme): colour, direction and fade start fully
 *  determine the gradient, so goldens are deterministic and two charts on one page that share an id
 *  share identical content. The gradient is in objectBoundingBox units, so it has no position.
 *  The colour is escaped, not stripped: every non-alphanumeric character (including "_") becomes
 *  "_<hex code>_", so distinct colours never share an id ("rgb(255, 0, 0)" and "rgb(25, 50, 0)"
 *  both strip to "rgb25500"). */
function fadeId(color: string, dir: "right" | "down", start: number): string {
  const key = color.replace(/[^a-zA-Z0-9]/g, (c) => `_${c.charCodeAt(0).toString(16)}_`);
  return `tblfade-${key}-${dir}-${Math.round(start * 1000)}`;
}

/** Marker ring width: a projected (hollow) marker carries the heavier ring. */
const markerStroke = (projected: boolean): number => (projected ? 1.5 : 1);
/** How far a marker's background halo extends beyond its stroked edge. */
const MARKER_HALO = 1.5;

function draw(doc: Document, layout: TimelineLayout, events: LayoutEvent[], colors: Map<string, string>): SVGSVGElement {
  const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] => {
    const n = doc.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
  };
  const r2 = (v: number): number => Math.round(v * 100) / 100;
  const colorOf = (cat: string): string => colors.get(cat) ?? TBL.color.blue;
  const byId = new Map(events.map((e) => [e.id, e]));
  const halo = {
    "paint-order": LABEL_HALO.paintOrder, stroke: LABEL_HALO.stroke, "stroke-width": LABEL_HALO.strokeWidth,
    "stroke-linejoin": "round",
  };

  const svg = el("svg", {
    class: TIMELINE_CLASS, width: layout.width, height: layout.height,
    viewBox: `0 0 ${layout.width} ${layout.height}`, "font-family": TBL.font,
  });

  // One gradient per distinct (colour, direction, fade start) actually drawn.
  const fadeOf = new Map<number, string>();
  const fades = new Map<string, { color: string; dir: "right" | "down"; start: number }>();
  for (const s of layout.spans) {
    if (!s.fade) continue;
    const color = colorOf(s.category);
    const start = fadeStart(s);
    const id = fadeId(color, s.fade, start);
    fadeOf.set(s.id, id);
    fades.set(id, { color, dir: s.fade, start });
  }
  if (fades.size) {
    const defs = el("defs", {});
    for (const [id, f] of fades) {
      const g = el("linearGradient", f.dir === "right" ? { id, x1: 0, y1: 0, x2: 1, y2: 0 } : { id, x1: 0, y1: 0, x2: 0, y2: 1 });
      g.append(el("stop", { offset: f.start, "stop-color": f.color, "stop-opacity": 1 }));
      g.append(el("stop", { offset: 1, "stop-color": f.color, "stop-opacity": 0 }));
      defs.append(g);
    }
    svg.append(defs);
  }

  const chrome = el("g", { class: "tbl-timeline-chrome" });
  for (const r of layout.rules) {
    chrome.append(el("line", {
      class: "tbl-timeline-rule", x1: r2(r.x1), y1: r2(r.y1), x2: r2(r.x2), y2: r2(r.y2),
      stroke: TBL.color.gridline, "stroke-width": 2,
    }));
  }
  // One <text> per lane name; each wrapped line is a <tspan> LANE_LINE_H below the last.
  for (const l of layout.laneLabels) {
    const t = el("text", {
      class: "tbl-timeline-lane-label", "text-anchor": l.anchor, "font-size": LANE_SIZE, "font-weight": 700,
      fill: TBL.color.text,
    });
    l.lines.forEach((line, i) => {
      const s = el("tspan", { x: r2(l.x), y: r2(l.y + i * LANE_LINE_H) });
      s.textContent = line;
      t.append(s);
    });
    chrome.append(t);
  }
  // TBL.size.axis at weight 500 is what the layout measured the ticks at; the weight is explicit
  // because the PNG export has no page CSS to inherit 500 from (it would draw 400). text_axis ink as
  // every other chart's tick labels (annotation_dim text would fail WCAG contrast).
  for (const k of layout.ticks) {
    const t = el("text", {
      class: "tbl-timeline-tick", x: r2(k.x), y: r2(k.y), "text-anchor": k.anchor, "font-size": TBL.size.axis,
      "font-weight": 500, fill: TBL.color.axis,
    });
    t.textContent = k.text;
    chrome.append(t);
  }
  svg.append(chrome);

  // Painted in layers, as callout leaders are elsewhere in the engine: stems beneath everything, then
  // span bars, then marker halos and markers (so a dot always paints over any bar, whatever the CSV
  // order of a same-date point and span), then labels, whose white text halos keep the text readable
  // where a stem passes beneath. Vertical only: the leaders paint above bars and markers (still below
  // labels). They run beside the track and never cross label text, and beneath, a left-side leader
  // leaving an inner sub-track's bar would hide under the outer bars it crosses. The mark layers
  // are aria-hidden; the list carries one listitem per event in chronological order. Every mark keeps
  // data-series for the legend's dimming.
  const stemsLayer = el("g", { class: "tbl-timeline-stems", "aria-hidden": "true" });
  const spansLayer = el("g", { class: "tbl-timeline-spans", "aria-hidden": "true" });
  const markersLayer = el("g", { class: "tbl-timeline-markers", "aria-hidden": "true" });
  const list = el("g", { role: "list", "aria-label": `Timeline, ${layout.order.length} events` });
  const stems = new Map(layout.stems.map((s) => [s.id, s]));
  const markers = new Map(layout.markers.map((m) => [m.id, m]));
  const spans = new Map(layout.spans.map((s) => [s.id, s]));
  const labels = new Map(layout.labels.map((l) => [l.id, l]));
  const halos: SVGCircleElement[] = [];
  const dots: SVGCircleElement[] = [];

  for (const id of layout.order) {
    const e = byId.get(id) as LayoutEvent;
    const color = colorOf(e.category);
    const series = e.category;
    const stem = stems.get(id);
    if (stem) {
      stemsLayer.append(el("polyline", {
        class: "tbl-timeline-stem", "data-series": series, fill: "none", stroke: TBL.color.annotationDim, "stroke-width": 1,
        points: stem.points.map(([x, y]) => `${r2(x)},${r2(y)}`).join(" "),
      }));
    }
    const span = spans.get(id);
    if (span) {
      const fade = fadeOf.get(id);
      const paint = fade ? `url(#${fade})` : color;
      spansLayer.append(el("rect", {
        class: "tbl-timeline-span", "data-series": series, x: r2(span.x), y: r2(span.y), width: r2(span.w), height: r2(span.h), rx: 2,
        // Projected: dashed outline over a light fill. An open-ended projected span fades both.
        ...(span.projected
          ? { fill: paint, "fill-opacity": 0.25, stroke: paint, "stroke-width": 1.5, "stroke-dasharray": TBL.dashArray }
          : { fill: paint }),
      }));
    }
    const m = markers.get(id);
    if (m) {
      // A background-colour halo keeps a dot visible on a same-colour bar (otherwise the same ink).
      // Every halo paints before every marker, so no halo can clip a neighbouring dot.
      halos.push(el("circle", {
        class: "tbl-timeline-marker-halo", "data-series": series, cx: r2(m.cx), cy: r2(m.cy),
        r: TL_GEOM.dotR + markerStroke(m.projected) / 2 + MARKER_HALO, fill: tokens.structural.background,
      }));
      // Projected: a white disc in a category-colour ring (spec §5.2). White, not a hole: the dot
      // sits on the rule, which would otherwise show through it.
      dots.push(el("circle", {
        class: "tbl-timeline-marker", "data-series": series, cx: r2(m.cx), cy: r2(m.cy), r: TL_GEOM.dotR,
        fill: m.projected ? tokens.structural.background : color, stroke: color, "stroke-width": markerStroke(m.projected),
      }));
    }
    const item = el("g", {
      role: "listitem",
      "aria-label": `${e.ariaDateText ?? e.dateText}: ${e.title}.${e.description ? ` ${e.description}` : ""}`,
    });
    const lab = labels.get(id);
    if (lab) {
      const g = el("g", { class: "tbl-timeline-label", "data-series": series });
      for (const ln of lab.lines) {
        const st = LINE_STYLE[ln.role];
        const t = el("text", {
          x: r2(ln.x), y: r2(ln.y), "text-anchor": ln.anchor, "font-size": st.size,
          "font-weight": st.bold ? 700 : 500, fill: st.muted ? TBL.color.muted : TBL.color.text, ...halo,
        });
        t.textContent = ln.text;
        g.append(t);
      }
      item.append(g);
    }
    list.append(item);
  }
  markersLayer.append(...halos, ...dots);
  if (layout.orientation === "vertical") svg.append(spansLayer, markersLayer, stemsLayer);
  else svg.append(stemsLayer, spansLayer, markersLayer);
  svg.append(list);
  return svg;
}

export function renderTimeline(spec: ChartSpec, rows: TidyRow[], opts: RenderOptions = {}): RenderResult {
  const width = opts.width ?? 720;
  const orientation = opts.timelineOrientation ?? spec.orientation ?? "horizontal";
  const { layout, events, seriesNames, lanesOn } = build(spec, rows, width, orientation, opts.timelineBudgetWidth);
  const colors = buildColorMap(seriesNames, spec.series_colors);
  const svg = draw(opts.document ?? document, layout, events, colors);

  const seriesLabels = spec.series_labels ?? {};
  const seriesKeyRows: LegendItem[] = seriesNames.map((name) => ({
    series: name, label: ownValue(seriesLabels, name) ?? name, color: colors.get(name), dashed: false,
    markerShape: "point", markerSymbol: "circle",
  }));
  // Drawn lanes name their categories (the horizontal gutter, or the vertical lane columns'
  // headers), so the legend's series rows default off there (Ruling 26); a vertical render that
  // draws one track instead must name its colours in the legend.
  const showRows =
    spec.series_legend === true || (spec.series_legend !== false && seriesNames.length > 1 && !lanesOn);
  const legendItems = spec.legend === false || !showRows ? null : seriesKeyRows;

  // Last, as on every chart type: nothing below touches the SVG.
  if (opts.hooks?.afterRender) opts.hooks.afterRender(svg, { phase: opts.phase ?? "live" });
  return {
    svg, legendItems, seriesKeyRows, colorLegendTitle: spec.color_legend_title, seriesLabels,
    seriesOrder: seriesNames, dashedNames: new Set(), colors, valueAffixes: { prefix: "", suffix: "" },
    // The title captions the ticks, so it goes wherever they do: a vertical render too narrow for the
    // tick column draws neither, nor does a single distinct date (no scale).
    xAxisTitle: layout.ticks.length ? (spec.x_axis_title ?? null) : null,
    dataInScope: [], overlayTooltips: [], timelineOrientation: orientation,
  };
}
