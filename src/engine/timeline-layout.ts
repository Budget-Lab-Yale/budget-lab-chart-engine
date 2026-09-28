// Timeline geometry. PURE: no DOM, no measurement. Every position is computed from estimated text
// widths (estimateLabelWidth / wrapToWidth), so the live mount, the PNG export (which re-renders
// from the spec) and the jsdom goldens place every element identically — the rule
// callout-placement.ts follows for the same reason.
//
// Horizontal label rows are TimelineJS-style greedy first-fit in date order (ties: CSV order):
// each event prefers the side opposite the previous event's, takes the nearest row on that side
// whose last box ends a column-gap before it starts, else tries the other side, else overflows
// into a row past `maxRows` and reports `fits: false`. Overflow never drops a label.
import { d3 } from "./vendor";
import { estimateLabelWidth, wrapToWidth } from "./axes";

export const TL_GEOM = {
  dotR: 4.5,
  spanH: 8,
  subTrackGap: 2,
  rowGap: 8,
  colGap: 8,
  stemGap: 6,
  fade: 24,
  laneGap: 16,
  laneGutterPad: 12,
  axisH: 24,
  minVerticalHeight: 400,
  vPad: 8,
  vRuleGap: 12,
  vLabelGap: 10,
  vDateGutterMin: 56,
  minSpanPx: 2,
  /** Live auto-switch: a chart narrower than this renders vertical regardless of fit. */
  autoVerticalMinWidth: 480,
  /** Live floor for a timeline's width (vertical reads down to a small phone). */
  minLiveWidth: 280,
} as const;

export type LineRole = "date" | "title" | "description";

export const LINE_STYLE: Record<LineRole, { size: number; lineH: number; bold: boolean; muted: boolean }> = {
  date: { size: 13, lineH: 16, bold: true, muted: false },
  title: { size: 12, lineH: 15, bold: false, muted: false },
  description: { size: 11, lineH: 14, bold: false, muted: true },
};

/** estimateLabelWidth is calibrated on regular weight; bold Figtree advances ~8% wider. */
const BOLD_FACTOR = 1.08;

export interface LayoutEvent {
  /** Stable identity: the event's 0-based CSV row index. Also the tie-break for equal dates. */
  id: number;
  start: Date;
  /** Span end, or null for a point event or an open-ended span. */
  end: Date | null;
  ongoing: boolean;
  category: string;
  dateText: string;
  title: string;
  description: string | null;
  projected: boolean;
}

export const isSpan = (e: LayoutEvent): boolean => e.end !== null || e.ongoing;

export interface TimelineLayoutInput {
  events: LayoutEvent[];
  /** Plot width in px (the whole SVG is this wide). */
  width: number;
  orientation: "horizontal" | "vertical";
  spacing: "proportional" | "even";
  /** Lane order and gutter labels, or null for one track. Horizontal only. */
  lanes: Array<{ key: string; label: string }> | null;
  axis: boolean;
  labelWidth: number;
  maxRows: number;
}

export interface PlacedLine { role: LineRole; text: string; x: number; y: number; anchor: "start" | "middle" | "end" }
export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface PlacedLabel { id: number; category: string; lines: PlacedLine[]; box: Box }
export interface PlacedMarker { id: number; category: string; cx: number; cy: number; projected: boolean }
export interface PlacedSpan { id: number; category: string; x: number; y: number; w: number; h: number; projected: boolean; fade: "right" | "down" | null }
export interface PlacedStem { id: number; category: string; points: Array<[number, number]> }
export interface PlacedRule { x1: number; y1: number; x2: number; y2: number }
export interface PlacedTick { x: number; y: number; text: string; anchor: "start" | "middle" | "end" }
export interface PlacedLaneLabel { text: string; x: number; y: number }

export interface TimelineLayout {
  orientation: "horizontal" | "vertical";
  width: number;
  height: number;
  /** False when a horizontal layout needed rows past maxRows (the auto-switch trigger). */
  fits: boolean;
  /** Event ids in chronological order — the DOM/reading order. */
  order: number[];
  rules: PlacedRule[];
  markers: PlacedMarker[];
  spans: PlacedSpan[];
  labels: PlacedLabel[];
  stems: PlacedStem[];
  ticks: PlacedTick[];
  laneLabels: PlacedLaneLabel[];
}

const byTime = (a: LayoutEvent, b: LayoutEvent): number => +a.start - +b.start || a.id - b.id;

function textW(role: LineRole, s: string): number {
  const w = estimateLabelWidth(s, LINE_STYLE[role].size);
  return LINE_STYLE[role].bold ? w * BOLD_FACTOR : w;
}

interface TextBlock { roles: LineRole[]; texts: string[]; w: number; h: number }

/** Split a line wider than `framePx` into character chunks that each fit. wrapToWidth leaves a
 *  single over-long word whole, which is right up to the frame (the box widens to the word), but a
 *  word wider than the whole frame could otherwise only be clamped off one edge or the other. */
function hardBreak(role: LineRole, line: string, framePx: number): string[] {
  if (textW(role, line) <= framePx) return [line];
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (cur && textW(role, cur + ch) > framePx) {
      out.push(cur);
      cur = "";
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** Each line wraps to `maxPx`; a single word wider than that widens the box, up to `framePx`. */
function buildBlock(e: LayoutEvent, maxPx: number, withDate: boolean, framePx: number): TextBlock {
  const roles: LineRole[] = [];
  const texts: string[] = [];
  const wrapPx = Math.min(maxPx, framePx);
  const push = (role: LineRole, text: string | null): void => {
    if (!text) return;
    for (const wrapped of wrapToWidth(text, wrapPx, LINE_STYLE[role].size).split("\n")) {
      for (const line of hardBreak(role, wrapped, framePx)) {
        roles.push(role);
        texts.push(line);
      }
    }
  };
  if (withDate) push("date", e.dateText);
  push("title", e.title);
  push("description", e.description);
  const w = Math.max(0, ...texts.map((t, i) => textW(roles[i] as LineRole, t)));
  const h = roles.reduce((s, r) => s + LINE_STYLE[r].lineH, 0);
  return { roles, texts, w, h };
}

/** The slice of d3's time scale this module uses. The vendored d3 `.d.ts` types the whole bundle
 *  as `any` (no ScaleTime export), so this pins the calls down instead of letting `any` spread. */
interface TimeScale {
  (d: Date): number;
  ticks(count: number): Date[];
  tickFormat(count: number): (d: Date) => string;
}

/** Time → px along the axis. Proportional: a d3 time scale over every start and closed end.
 *  Even: one equal slot per distinct date (starts and closed span ends). A single distinct date
 *  sits at the midpoint. `scale` is returned only for proportional (the axis needs it). */
function positioner(
  events: LayoutEvent[],
  spacing: "proportional" | "even",
  r0: number,
  r1: number,
): { pos: (d: Date) => number; scale: TimeScale | null } {
  const times = events.flatMap((e) => (e.end ? [+e.start, +e.end] : [+e.start]));
  const distinct = [...new Set(times)].sort((a, b) => a - b);
  const mid = (r0 + r1) / 2;
  if (distinct.length <= 1) return { pos: () => mid, scale: null };
  if (spacing === "even") {
    const step = (r1 - r0) / (distinct.length - 1);
    const idx = new Map(distinct.map((t, i) => [t, i]));
    return { pos: (d) => r0 + (idx.get(+d) ?? 0) * step, scale: null };
  }
  const scale: TimeScale = d3.scaleTime().domain([new Date(distinct[0]!), new Date(distinct[distinct.length - 1]!)]).range([r0, r1]);
  return { pos: (d) => scale(d), scale };
}

/** First-fit sub-track per span, on TIME intervals (a span ending exactly when the next starts
 *  shares its track). Open-ended spans never end. */
function assignSubTracks(spans: LayoutEvent[]): Map<number, number> {
  const ends: number[] = [];
  const out = new Map<number, number>();
  for (const s of spans) {
    const start = +s.start;
    let k = ends.findIndex((end) => end <= start);
    if (k < 0) { k = ends.length; ends.push(0); }
    ends[k] = s.ongoing ? Infinity : +(s.end as Date);
    out.set(s.id, k);
  }
  return out;
}

type Side = "above" | "below";

function assignRows(
  items: Array<{ id: number; x0: number; x1: number }>,
  maxRows: number,
  sides: Side[],
): { placed: Map<number, { side: Side; row: number }>; fits: boolean } {
  const last: Record<Side, Array<number | undefined>> = { above: [], below: [] };
  const placed = new Map<number, { side: Side; row: number }>();
  let prev: Side | null = null;
  let fits = true;
  const clear = (side: Side, r: number, x0: number): boolean => {
    const end = last[side][r];
    return end === undefined || end + TL_GEOM.colGap <= x0;
  };
  for (const it of items) {
    const pref: Side = sides.length === 1 ? (sides[0] as Side) : prev === "above" ? "below" : "above";
    const order: Side[] = sides.length === 1 ? [pref] : [pref, pref === "above" ? "below" : "above"];
    let got: { side: Side; row: number } | null = null;
    for (const side of order) {
      for (let r = 0; r < maxRows && !got; r++) if (clear(side, r, it.x0)) got = { side, row: r };
      if (got) break;
    }
    if (!got) {
      fits = false;
      let r = maxRows;
      while (!clear(pref, r, it.x0)) r++;
      got = { side: pref, row: r };
    }
    last[got.side][got.row] = it.x1;
    prev = got.side;
    placed.set(it.id, got);
  }
  return { placed, fits };
}

function placeLines(block: TextBlock, box: Box, anchor: "start" | "middle"): PlacedLine[] {
  const x = anchor === "middle" ? (box.x0 + box.x1) / 2 : box.x0;
  let top = box.y0;
  return block.roles.map((role, i) => {
    const st = LINE_STYLE[role];
    // Baseline ≈ line top + font size: Figtree's ascent fills most of a line box at these sizes.
    const line: PlacedLine = { role, text: block.texts[i] as string, x, y: top + st.size, anchor };
    top += st.lineH;
    return line;
  });
}

function layoutHorizontal(inp: TimelineLayoutInput): TimelineLayout {
  const G = TL_GEOM;
  const events = [...inp.events].sort(byTime);
  const gutter = inp.lanes
    ? Math.max(0, ...inp.lanes.map((l) => estimateLabelWidth(l.label, 12))) + G.laneGutterPad
    : 0;
  const framePx = Math.max(0, inp.width - gutter);
  const blocks = new Map(events.map((e) => [e.id, buildBlock(e, inp.labelWidth, true, framePx)]));
  // Inset each end of the range by half the widest centred label anchored at that end's date, so an
  // edge label is not clipped. Only point events count: span labels are start-anchored, and the
  // last date may be a span's END, where no label sits.
  const times = events.flatMap((e) => (e.end ? [+e.start, +e.end] : [+e.start]));
  const halfAt = (t: number): number =>
    Math.max(0, ...events.filter((e) => !isSpan(e) && +e.start === t).map((e) => (blocks.get(e.id) as TextBlock).w / 2));
  const r0 = gutter + Math.max(G.dotR, times.length ? halfAt(Math.min(...times)) : 0);
  const r1 =
    inp.width -
    Math.max(G.dotR, times.length ? halfAt(Math.max(...times)) : 0, events.some((e) => e.ongoing) ? G.fade : 0);
  const { pos, scale } = positioner(events, inp.spacing, r0, Math.max(r0, r1));
  const rowH = Math.max(0, ...[...blocks.values()].map((b) => b.h)) + G.rowGap;

  // Horizontal extents, clamped inside [gutter, width]. The stem stays on the date; only the box moves.
  const extent = new Map<number, { x0: number; x1: number }>();
  for (const e of events) {
    const w = (blocks.get(e.id) as TextBlock).w;
    const ax = pos(e.start);
    let x0 = isSpan(e) ? ax - G.dotR : ax - w / 2;
    if (x0 + w > inp.width) x0 = inp.width - w;
    if (x0 < gutter) x0 = gutter;
    extent.set(e.id, { x0, x1: x0 + w });
  }

  const tracks: Array<{ key: string | null; label: string | null; events: LayoutEvent[] }> = inp.lanes
    ? inp.lanes.map((l) => ({ key: l.key, label: l.label, events: events.filter((e) => e.category === l.key) }))
    : [{ key: null, label: null, events }];

  const out: TimelineLayout = {
    orientation: "horizontal", width: inp.width, height: 0, fits: true, order: events.map((e) => e.id),
    rules: [], markers: [], spans: [], labels: [], stems: [], ticks: [], laneLabels: [],
  };

  let cursor = 0;
  for (const track of tracks) {
    const sub = assignSubTracks(track.events.filter(isSpan));
    const nSub = sub.size ? Math.max(...sub.values()) + 1 : 0;
    const sides: Side[] = inp.lanes ? ["above"] : ["above", "below"];
    const { placed, fits } = assignRows(
      track.events.map((e) => ({ id: e.id, ...(extent.get(e.id) as { x0: number; x1: number }) })),
      inp.maxRows,
      sides,
    );
    if (!fits) out.fits = false;
    const rowsOn = (side: Side): number =>
      Math.max(0, ...[...placed.values()].filter((p) => p.side === side).map((p) => p.row + 1));
    const clearAbove = Math.max(G.dotR, nSub ? G.spanH / 2 + (nSub - 1) * (G.spanH + G.subTrackGap) : 0) + G.stemGap;
    const clearBelow = Math.max(G.dotR, nSub ? G.spanH / 2 : 0) + G.stemGap;
    const ruleY = cursor + rowsOn("above") * rowH + clearAbove;

    out.rules.push({ x1: gutter, y1: ruleY, x2: inp.width, y2: ruleY });
    if (track.label !== null) out.laneLabels.push({ text: track.label, x: gutter - G.laneGutterPad / 2, y: ruleY + 4 });

    for (const e of track.events) {
      const x = pos(e.start);
      const block = blocks.get(e.id) as TextBlock;
      const ext = extent.get(e.id) as { x0: number; x1: number };
      const p = placed.get(e.id) as { side: Side; row: number };
      let markEdgeAbove = ruleY - G.dotR;
      let markEdgeBelow = ruleY + G.dotR;
      if (isSpan(e)) {
        const k = sub.get(e.id) as number;
        const y = ruleY - G.spanH / 2 - k * (G.spanH + G.subTrackGap);
        const xe = e.ongoing ? inp.width : pos(e.end as Date);
        out.spans.push({
          id: e.id, category: e.category, x, y, w: Math.max(G.minSpanPx, xe - x), h: G.spanH,
          projected: e.projected, fade: e.ongoing ? "right" : null,
        });
        markEdgeAbove = y;
        markEdgeBelow = ruleY + G.spanH / 2;
      } else {
        out.markers.push({ id: e.id, category: e.category, cx: x, cy: ruleY, projected: e.projected });
      }
      const box: Box =
        p.side === "above"
          ? { x0: ext.x0, x1: ext.x1, y1: ruleY - clearAbove - p.row * rowH, y0: ruleY - clearAbove - p.row * rowH - block.h }
          : { x0: ext.x0, x1: ext.x1, y0: ruleY + clearBelow + p.row * rowH, y1: ruleY + clearBelow + p.row * rowH + block.h };
      out.labels.push({ id: e.id, category: e.category, box, lines: placeLines(block, box, isSpan(e) ? "start" : "middle") });
      out.stems.push({
        id: e.id, category: e.category,
        points: p.side === "above" ? [[x, markEdgeAbove], [x, box.y1]] : [[x, markEdgeBelow], [x, box.y0]],
      });
    }
    cursor = inp.lanes
      ? ruleY + Math.max(G.dotR, G.spanH / 2) + G.laneGap
      : ruleY + clearBelow + rowsOn("below") * rowH;
  }

  if (inp.axis && scale) {
    const n = Math.max(2, Math.floor((inp.width - gutter) / 100));
    const fmt = scale.tickFormat(n);
    const y = cursor + G.axisH - 8;
    out.ticks = scale.ticks(n).map((t) => ({ x: scale(t), y, text: fmt(t), anchor: "middle" as const }));
    cursor += G.axisH;
  }
  out.height = Math.ceil(cursor);
  // Sort labels/markers/spans/stems into chronological order so DOM order = reading order.
  const rank = new Map(out.order.map((id, i) => [id, i]));
  const chrono = <T extends { id: number }>(a: T, b: T): number => (rank.get(a.id) as number) - (rank.get(b.id) as number);
  out.labels.sort(chrono); out.markers.sort(chrono); out.spans.sort(chrono); out.stems.sort(chrono);
  return out;
}

export function layoutTimeline(inp: TimelineLayoutInput): TimelineLayout {
  if (inp.orientation === "vertical") throw new Error("vertical layout: Task 4");
  return layoutHorizontal(inp);
}
