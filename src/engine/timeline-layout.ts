// Timeline geometry. PURE: no DOM, no measurement. Every position is computed from estimated text
// widths (estimateLabelWidth / wrapToWidth), so the live mount, the PNG export (which re-renders
// from the spec) and the jsdom goldens place every element identically — the rule
// callout-placement.ts follows for the same reason.
//
// Horizontal label rows are TimelineJS-style greedy first-fit in date order (ties: CSV order):
// each event prefers the side opposite the previous event's, takes the nearest row on that side
// whose last box ends a column-gap before it starts (preferring, among those, a row where no stem
// would cross another label: see assignRows), else tries the other side, else overflows into a row
// past `maxRows` and reports `fits: false`. Overflow never drops a label.
import { d3 } from "./vendor";
import { estimateLabelWidth, wrapToWidth } from "./axes";
import { TBL } from "./theme";

export const TL_GEOM = {
  dotR: 4.5,
  spanH: 8,
  subTrackGap: 2,
  rowGap: 8,
  colGap: 8,
  /** Horizontal: a stem keeps at least this far from any other label box it would pass. */
  stemClear: 3,
  stemGap: 6,
  fade: 24,
  laneGap: 16,
  laneGutterPad: 12,
  axisH: 24,
  minVerticalHeight: 400,
  vPad: 8,
  /** Horizontal: space kept above the topmost label box (or lane name) once the band the uniform row
   *  pitch leaves above shorter top-row boxes is trimmed. */
  topPad: 4,
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

/** Lane-name type in the horizontal lanes gutter. */
export const LANE_SIZE = 12;
export const LANE_LINE_H = 15;
/** The lanes gutter never takes more than this share of the width, however long a lane name is. */
const LANE_GUTTER_MAX_SHARE = 0.3;

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
/** A lane name in the left gutter, right-aligned at `x`. `text` is the full name; `lines` is it
 *  wrapped to the gutter. `y` is the first line's baseline; each further line is `LANE_LINE_H` lower.
 *  Each line's box is [baseline - LANE_SIZE, baseline + LANE_LINE_H - LANE_SIZE], and the whole
 *  block lies inside its lane's vertical extent. */
export interface PlacedLaneLabel { text: string; lines: string[]; x: number; y: number; anchor: "end" }

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
function hardBreak(line: string, framePx: number, measure: (s: string) => number): string[] {
  if (measure(line) <= framePx) return [line];
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (cur && measure(cur + ch) > framePx) {
      out.push(cur);
      cur = "";
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** Date text wraps between words and after an en dash, preferring the dash: a range too wide for
 *  one line breaks as "<start>–" / "<end>" before either date breaks inside itself, and each part
 *  then wraps between words only if it still does not fit. `maxPx` is in estimateLabelWidth's
 *  (regular-weight) terms, as wrapToWidth's is. */
function wrapDate(text: string, maxPx: number, size: number): string[] {
  if (estimateLabelWidth(text, size) <= maxPx) return [text];
  // Split on the dash and re-append it to every piece but the last (no lookbehind: Safari < 16.4
  // cannot parse one, which would fail the whole bundle).
  const pieces = text.split("–");
  const parts = pieces.map((s, i) => (i < pieces.length - 1 ? `${s}–` : s).trim()).filter(Boolean);
  return parts.flatMap((part) => wrapToWidth(part, maxPx, size).split("\n"));
}

/** Each line wraps to `maxPx`; a single word wider than that widens the box, up to `framePx`. */
function buildBlock(e: LayoutEvent, maxPx: number, withDate: boolean, framePx: number): TextBlock {
  const roles: LineRole[] = [];
  const texts: string[] = [];
  const wrapPx = Math.min(maxPx, framePx);
  const push = (role: LineRole, text: string | null): void => {
    if (!text) return;
    const size = LINE_STYLE[role].size;
    const wrappedLines = role === "date" ? wrapDate(text, wrapPx, size) : wrapToWidth(text, wrapPx, size).split("\n");
    for (const wrapped of wrappedLines) {
      for (const line of hardBreak(wrapped, framePx, (s) => textW(role, s))) {
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

interface RowItem { id: number; x0: number; x1: number; stemX: number; aboveOnly: boolean }
type Slot = { side: Side; row: number };

/** Spec §5.2 greedy first-fit, with stem clearance as a soft preference. Within `maxRows`, in the
 *  usual order (preferred side's rows outward, then the other side's), an item takes the first row
 *  that is plainly free (the row's last box ends a column-gap before this box starts) AND keeps the
 *  stems clear: its stem crosses no box in a row nearer the rule on that side (a stem rises through
 *  every inner row), and its box covers no stem of an item already further out. When no in-cap row
 *  keeps the stems clear, the plain first-fit row is taken and the stem passes under a label (labels
 *  paint above stems, in white halos). Overflow and `fits: false` happen only when plain first-fit
 *  finds no row within `maxRows`. One pass: O(items × rows × placed). */
function assignRows(items: RowItem[], maxRows: number, sides: Side[]): { placed: Map<number, Slot>; fits: boolean } {
  const c = TL_GEOM.stemClear;
  const last: Record<Side, Array<number | undefined>> = { above: [], below: [] };
  const on: Record<Side, Array<{ row: number; x0: number; x1: number; stemX: number }>> = { above: [], below: [] };
  const placed = new Map<number, Slot>();
  let prev: Side | null = null;
  let fits = true;
  const covers = (x0: number, x1: number, x: number): boolean => x >= x0 - c && x <= x1 + c;
  const plain = (it: RowItem, side: Side, r: number): boolean => {
    const end = last[side][r];
    return end === undefined || end + TL_GEOM.colGap <= it.x0;
  };
  const stemsClear = (it: RowItem, side: Side, r: number): boolean =>
    on[side].every((p) => (p.row < r ? !covers(p.x0, p.x1, it.stemX) : p.row > r ? !covers(it.x0, it.x1, p.stemX) : true));
  const firstIn = (order: Side[], ok: (side: Side, r: number) => boolean): Slot | null => {
    for (const side of order) for (let r = 0; r < maxRows; r++) if (ok(side, r)) return { side, row: r };
    return null;
  };
  for (const it of items) {
    const allowed: Side[] = it.aboveOnly ? ["above"] : sides;
    const pref: Side = allowed.length === 1 ? (allowed[0] as Side) : prev === "above" ? "below" : "above";
    const order: Side[] = allowed.length === 1 ? [pref] : [pref, pref === "above" ? "below" : "above"];
    let got =
      firstIn(order, (side, r) => plain(it, side, r) && stemsClear(it, side, r)) ??
      firstIn(order, (side, r) => plain(it, side, r));
    if (!got) {
      fits = false;
      let r = maxRows;
      while (!plain(it, pref, r)) r++;
      got = { side: pref, row: r };
    }
    last[got.side][got.row] = it.x1;
    on[got.side].push({ row: got.row, x0: it.x0, x1: it.x1, stemX: it.stemX });
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
  // In lanes mode an event outside every lane is not drawn, so it is dropped here: `order` must list
  // exactly the drawn events, and an undrawn event must not stretch the scale.
  const laneKeys = inp.lanes ? new Set(inp.lanes.map((l) => l.key)) : null;
  const events = inp.events.filter((e) => !laneKeys || laneKeys.has(e.category)).sort(byTime);
  const gutter = inp.lanes
    ? Math.min(
        Math.max(0, ...inp.lanes.map((l) => estimateLabelWidth(l.label, LANE_SIZE))) + G.laneGutterPad,
        inp.width * LANE_GUTTER_MAX_SHARE,
      )
    : 0;
  const laneTextPx = Math.max(0, gutter - G.laneGutterPad);
  const laneLines = (label: string): string[] =>
    wrapToWidth(label, laneTextPx, LANE_SIZE)
      .split("\n")
      .flatMap((l) => hardBreak(l, laneTextPx, (s) => estimateLabelWidth(s, LANE_SIZE)));
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
    // A span on an outer sub-track labels above only: below, its stem would have to cross the
    // inner sub-tracks' bars to reach it.
    const { placed, fits } = assignRows(
      track.events.map((e) => ({
        id: e.id,
        ...(extent.get(e.id) as { x0: number; x1: number }),
        stemX: pos(e.start),
        aboveOnly: (sub.get(e.id) ?? 0) > 0,
      })),
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
    // A lane name is centred on its rule but never starts above the lane's top; whatever it then
    // extends below the rule is reserved in the lane's bottom (below), so it cannot clip or collide.
    let nameBottom = -Infinity;
    if (track.label !== null) {
      const lines = laneLines(track.label);
      const y = Math.max(ruleY + 4 - ((lines.length - 1) * LANE_LINE_H) / 2, cursor + LANE_SIZE);
      nameBottom = y + (lines.length - 1) * LANE_LINE_H + (LANE_LINE_H - LANE_SIZE);
      out.laneLabels.push({ text: track.label, lines, x: gutter - G.laneGutterPad / 2, y, anchor: "end" });
    }

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
      ? Math.max(ruleY + Math.max(G.dotR, G.spanH / 2) + G.laneGap, nameBottom + G.rowGap)
      : ruleY + clearBelow + rowsOn("below") * rowH;
  }

  if (inp.axis && scale) {
    const n = Math.max(2, Math.floor((inp.width - gutter) / 100));
    const fmt = scale.tickFormat(n);
    const y = cursor + G.axisH - 8;
    out.ticks = scale.ticks(n).map((t) => ({ x: scale(t), y, text: fmt(t), anchor: "middle" as const }));
    cursor += G.axisH;
  }
  // Rows share one pitch (the tallest box), so when the top row holds only shorter boxes a band is
  // left above them. Trim it: shift everything up uniformly so the topmost box or lane name sits
  // topPad below the top. Lanes stack downward, so this is the first lane's top.
  const tops = [
    ...out.labels.map((x) => x.box.y0),
    ...out.laneLabels.map((x) => x.y - LANE_SIZE),
    ...out.markers.map((m) => m.cy - G.dotR),
    ...out.spans.map((s) => s.y),
  ];
  const shift = tops.length ? Math.max(0, Math.min(...tops) - G.topPad) : 0;
  if (shift > 0) {
    for (const r of out.rules) { r.y1 -= shift; r.y2 -= shift; }
    for (const m of out.markers) m.cy -= shift;
    for (const s of out.spans) s.y -= shift;
    for (const s of out.stems) s.points = s.points.map(([x, y]): [number, number] => [x, y - shift]);
    for (const lab of out.labels) {
      lab.box = { ...lab.box, y0: lab.box.y0 - shift, y1: lab.box.y1 - shift };
      for (const ln of lab.lines) ln.y -= shift;
    }
    for (const ll of out.laneLabels) ll.y -= shift;
    for (const k of out.ticks) k.y -= shift;
    cursor -= shift;
  }
  out.height = Math.ceil(cursor);
  // Sort labels/markers/spans/stems into chronological order so DOM order = reading order.
  const rank = new Map(out.order.map((id, i) => [id, i]));
  const chrono = <T extends { id: number }>(a: T, b: T): number => (rank.get(a.id) as number) - (rank.get(b.id) as number);
  out.labels.sort(chrono); out.markers.sort(chrono); out.spans.sort(chrono); out.stems.sort(chrono);
  return out;
}

/** Gap between the vertical tick column and the date gutter. */
const V_TICK_GAP = 8;
/** Everything left of the vertical text column (ticks, dates, sub-tracks, rule) takes at most this
 *  share of the width, so the text column keeps at least 55% at the 280px live floor. */
const V_LEFT_SHARE = 0.45;
/** Floors for a compressed vertical sub-track band. */
const V_MIN_BAR = 3;
const V_MIN_TRACK_GAP = 1;

/** Vertical: time top → bottom. Left to right: [tick column] → date gutter (right-aligned) →
 *  span sub-tracks → rule → one text column. No left/right alternation: it would halve the text
 *  column on a phone. Labels sit at their date and a downward sweep pushes each below the one
 *  before; the axis length is chosen so the whole stack fits, which keeps pushes local. Lanes do
 *  not apply (they collapse to one track), so every event is drawn. */
function layoutVertical(inp: TimelineLayoutInput): TimelineLayout {
  const G = TL_GEOM;
  const events = [...inp.events].sort(byTime);
  const sub = assignSubTracks(events.filter(isSpan));
  const nSub = sub.size ? Math.max(...sub.values()) + 1 : 0;
  const dateNat = Math.max(G.vDateGutterMin, ...events.map((e) => textW("date", e.dateText)));
  // Sub-tracks stack leftward from the rule, bar width `w` at pitch `w + g`; `bandOf` is the rule
  // to the outermost bar's left edge. The gutter widens by it so a date never sits on a bar (that
  // edge is at least vRuleGap right of the dates).
  const bandOf = (w: number, g: number): number => (nSub ? w / 2 + (nSub - 1) * (w + g) : 0);
  // An open-ended span needs room below the last date to fade out, as horizontal reserves G.fade.
  const tail = events.some((e) => e.ongoing) ? G.fade : 0;

  // The widest single word of any date: the gutter never goes narrower, so dates wrap only between
  // words. Only a word wider than the whole cap is hard-broken.
  const cap = V_LEFT_SHARE * inp.width;
  const wordMax = Math.max(0, ...events.flatMap((e) => e.dateText.split(/\s+/).filter(Boolean).map((w) => textW("date", w))));
  const dateMin = Math.min(wordMax, cap);

  // Left-region budget inside the cap, by priority: the rule's fixed gaps; the dates' longest word;
  // the sub-track band (compressing its pitch, bars floored at V_MIN_BAR and gaps at
  // V_MIN_TRACK_GAP); the tick column, which is omitted (not squeezed) when it does not fit in what
  // remains; then the dates widen toward their natural width, wrapping between words to what they
  // get. A layout whose natural left region is inside the cap is untouched. When the longest word
  // plus the band at its floors exceeds the cap, the cap yields and the text column narrows.
  const geometry = (tickNeed: number) => {
    const rightOf = (w: number): number => Math.max(G.dotR, nSub ? w / 2 : 0) + G.vLabelGap;
    const free = cap - G.vRuleGap - rightOf(G.spanH);
    const bandRoom = free - dateMin;
    let barW: number = G.spanH;
    let gap: number = G.subTrackGap;
    if (Math.max(G.dotR, bandOf(barW, gap)) > bandRoom) {
      const s = Math.max(0, bandRoom) / bandOf(barW, gap);
      barW = G.spanH * s;
      gap = G.subTrackGap * s;
      if (gap < V_MIN_TRACK_GAP) {
        gap = V_MIN_TRACK_GAP;
        barW = (Math.max(0, bandRoom) - (nSub - 1) * gap) / (nSub - 0.5);
      }
      barW = Math.max(V_MIN_BAR, barW);
    }
    const band = Math.max(G.dotR, bandOf(barW, gap));
    let rest = bandRoom - band;
    const tickW = tickNeed > 0 && tickNeed <= rest ? tickNeed : 0;
    rest -= tickW;
    const dateW = dateMin + Math.min(Math.max(0, rest), dateNat - dateMin);
    const dateRight = tickW + dateW;
    const ruleX = dateRight + G.vRuleGap + band;
    const textX = ruleX + Math.max(G.dotR, nSub ? barW / 2 : 0) + G.vLabelGap;
    const colW = Math.max(0, inp.width - textX);
    const blocks = new Map(events.map((e) => [e.id, buildBlock(e, colW, false, colW)]));
    // A date wider than the gutter wraps between words (bold-aware). The gutter holds the longest
    // word, so hardBreak fires only for a word wider than the whole cap; its 1e-6 slack absorbs the
    // round trip through dateW / BOLD_FACTOR, which must never split a word that exactly fits.
    const dates = new Map(
      events.map((e) => [
        e.id,
        textW("date", e.dateText) <= dateW
          ? [e.dateText]
          : wrapDate(e.dateText, dateW / BOLD_FACTOR, LINE_STYLE.date.size)
              .flatMap((ln) => hardBreak(ln, dateW + 1e-6, (s) => textW("date", s))),
      ]),
    );
    const rowHOf = (e: LayoutEvent): number =>
      Math.max((blocks.get(e.id) as TextBlock).h, (dates.get(e.id) as string[]).length * LINE_STYLE.date.lineH);
    const stacked = events.reduce((s, e) => s + rowHOf(e), 0) + G.vLabelGap * Math.max(0, events.length - 1);
    const L = Math.max(G.minVerticalHeight - 2 * G.vPad - tail, stacked);
    return { tickW, dateRight, ruleX, textX, barW, gap, blocks, dates, rowHOf, L };
  };

  // Tick text depends only on the domain and the count, not the range, so the ticks are chosen
  // first (count from the tickless axis length) and the column is sized to the widest of them.
  let ticks: Date[] = [];
  let tickFmt: ((d: Date) => string) | null = null;
  let tickNeed = 0;
  const probe = inp.axis ? positioner(events, inp.spacing, 0, 1).scale : null;
  if (probe) {
    const n = Math.max(2, Math.floor(geometry(0).L / 80));
    ticks = probe.ticks(n);
    tickFmt = probe.tickFormat(n);
    const fmt = tickFmt;
    if (ticks.length) tickNeed = Math.max(...ticks.map((d) => estimateLabelWidth(fmt(d), TBL.size.axis))) + V_TICK_GAP;
  }
  const { tickW, dateRight, ruleX, textX, barW, gap, blocks, dates, rowHOf, L } = geometry(tickNeed);
  if (!tickW) ticks = []; // the column did not fit: omitted, not squeezed
  const { pos, scale } = positioner(events, inp.spacing, G.vPad, G.vPad + L);

  const out: TimelineLayout = {
    orientation: "vertical", width: inp.width, height: 0, fits: true, order: events.map((e) => e.id),
    rules: [], markers: [], spans: [], labels: [], stems: [], ticks: [], laneLabels: [],
  };

  let prevBottom = -Infinity;
  const tops = new Map<number, number>();
  for (const e of events) {
    const desired = pos(e.start) - LINE_STYLE.date.lineH / 2;
    const top = Math.max(desired, prevBottom + G.vLabelGap, 0);
    tops.set(e.id, top);
    prevBottom = top + rowHOf(e);
  }
  const height = Math.ceil(Math.max(G.vPad + L + tail + G.vPad, prevBottom + G.vPad));

  for (const e of events) {
    const y = pos(e.start);
    const top = tops.get(e.id) as number;
    const block = blocks.get(e.id) as TextBlock;
    if (isSpan(e)) {
      const k = sub.get(e.id) as number;
      const ye = e.ongoing ? height - G.vPad : pos(e.end as Date);
      out.spans.push({
        id: e.id, category: e.category, x: ruleX - barW / 2 - k * (barW + gap), y,
        w: barW, h: Math.max(G.minSpanPx, ye - y), projected: e.projected, fade: e.ongoing ? "down" : null,
      });
    } else {
      out.markers.push({ id: e.id, category: e.category, cx: ruleX, cy: y, projected: e.projected });
    }
    const box: Box = { x0: textX, y0: top, x1: textX + block.w, y1: top + rowHOf(e) };
    const lines: PlacedLine[] = [
      ...(dates.get(e.id) as string[]).map((text, i): PlacedLine => ({
        role: "date", text, x: dateRight, y: top + LINE_STYLE.date.size + i * LINE_STYLE.date.lineH, anchor: "end",
      })),
      ...placeLines(block, box, "start"),
    ];
    out.labels.push({ id: e.id, category: e.category, box, lines });
    // A label pushed off its date gets an elbow: out beside the marker (right of the rule, clear of
    // every sub-track bar), down parallel to the rule, then into the label's first line. Leaders in
    // a pushed cluster share the vertical leg instead of fanning into a smear. A span on an outer
    // sub-track starts its leader at its own bar's right edge, so it does not read as the inner bar's.
    const labelMid = top + LINE_STYLE.date.lineH / 2;
    if (labelMid - y > 0.5) {
      const xLeg = ruleX + G.dotR + 2;
      const k = isSpan(e) ? (sub.get(e.id) as number) : 0;
      const from: Array<[number, number]> = k > 0 ? [[ruleX + barW / 2 - k * (barW + gap), y], [xLeg, y]] : [[xLeg, y]];
      out.stems.push({ id: e.id, category: e.category, points: [...from, [xLeg, labelMid], [textX - 4, labelMid]] });
    }
  }

  out.rules.push({ x1: ruleX, y1: G.vPad, x2: ruleX, y2: height - G.vPad });
  if (scale && tickFmt) {
    const fmt = tickFmt;
    out.ticks = ticks.map((t) => ({ x: 0, y: scale(t) + 4, text: fmt(t), anchor: "start" as const }));
  }
  out.height = height;
  return out;
}

export function layoutTimeline(inp: TimelineLayoutInput): TimelineLayout {
  return inp.orientation === "vertical" ? layoutVertical(inp) : layoutHorizontal(inp);
}
