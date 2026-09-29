// Timeline geometry. PURE: no DOM, no measurement. Every position is computed from estimated text
// widths (estimateLabelWidth / wrapToWidth), so the live mount, the PNG export (which re-renders
// from the spec) and the jsdom goldens place every element identically — the rule
// callout-placement.ts follows for the same reason.
//
// Horizontal label rows are TimelineJS-style greedy first-fit in date order (ties: CSV order): each
// event prefers the side opposite the previous event's. Within `maxRows` it takes the first free row
// (preferred side outward, then the other) that keeps every stem clear of other labels, so a clear
// row on the other side beats a crossing row on the preferred side; failing that, the first free row.
// That preference is dropped for a track when it would not fit, so `fits` is always plain
// first-fit's (see assignRows). Overflow rows past `maxRows` never drop a label.
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
  /** Vertical axis inset, top and bottom. Must equal half the date line height (see placeColumn). */
  vPad: 8,
  /** Horizontal: space kept above the topmost label box (or lane name) once the band the uniform row
   *  pitch leaves above shorter top-row boxes is trimmed. */
  topPad: 4,
  vLabelGap: 10,
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
  /** Lane order and names, or null for one track. Horizontal: one lane per entry. Vertical:
   *  exactly two entries draw as lane columns (layoutLaneColumns); any other value is ignored and
   *  one track is drawn — the caller (marks/timeline.ts) decides when columns apply. */
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
/** A lane name. Horizontal: in the left gutter, right-aligned at `x`, the whole block inside its
 *  lane's vertical extent. Vertical lane columns: at the top of its track on the lane's outer side —
 *  lane 0's right-aligned (`end`) just left of its rule, lane 1's left-aligned (`start`) just right
 *  of its rule. `text` is the full name; `lines` is it wrapped to the gutter or side. `y` is the
 *  first line's baseline; each further line is `LANE_LINE_H` lower. Each line's box is
 *  [baseline - LANE_SIZE, baseline + LANE_LINE_H - LANE_SIZE]. */
export interface PlacedLaneLabel { text: string; lines: string[]; x: number; y: number; anchor: "start" | "end" }

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

/** `dateText` split into the units it may actually wrap between: whitespace-separated words, except
 *  a lone "–" is never its own unit — it glues to the word before it, matching `wrapDate`'s
 *  guarantee that the dash never starts a line of its own. A geometry that measured the raw
 *  whitespace-split words here would think "<end>" alone sets the floor and let a vertical column
 *  compress past what "<start> –" needs, then fall through to `hardBreak`'s character-level split. */
function dateWordUnits(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    if (w === "–" && out.length) out[out.length - 1] = `${out[out.length - 1]} –`;
    else out.push(w);
  }
  return out;
}

/** Greedily wraps pre-split units the way `wrapToWidth` wraps words, but never re-splits a unit at
 *  whitespace it contains (a glued "<word> –" from `dateWordUnits` must stay one piece): each unit
 *  joins the current line if that still fits `maxPx`, else starts a new one. A unit wider than
 *  `maxPx` alone still gets its own (over-wide) line — `hardBreak` is the caller's fallback for it. */
function wrapUnits(units: string[], maxPx: number, size: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const u of units) {
    const trial = cur ? `${cur} ${u}` : u;
    if (!cur || estimateLabelWidth(trial, size) <= maxPx) cur = trial;
    else {
      lines.push(cur);
      cur = u;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Date text wraps between words and after a spaced en dash ("<start> – <end>"), preferring the
 *  dash: a range too wide for one line breaks as "<start> –" / "<end>" (the dash stays on line 1,
 *  the leading space before the tail is dropped) before either date breaks inside itself, and each
 *  part then wraps between words only if it still does not fit. `maxPx` is in estimateLabelWidth's
 *  (regular-weight) terms, as wrapToWidth's is. */
function wrapDate(text: string, maxPx: number, size: number): string[] {
  if (estimateLabelWidth(text, size) <= maxPx) return [text];
  // Wrap each part as `dateWordUnits` — the same units a vertical column's whole-word floor
  // measures — rather than a raw string: gluing "<end word> –" into one unit before wrapping (not
  // after) guarantees no emitted line exceeds maxPx unless that glued unit alone does, and reuses
  // whatever separator (space or none) the author's own text had at that boundary instead of
  // assuming one.
  return dateParts(text).flatMap((part) => wrapUnits(dateWordUnits(part), maxPx, size));
}

/** `text` split after each en dash, the dash kept on the piece before it and each piece trimmed:
 *  the parts `wrapDate` wraps independently (no lookbehind: Safari < 16.4 cannot parse one, which
 *  would fail the whole bundle). */
function dateParts(text: string): string[] {
  const pieces = text.split("–");
  return pieces.map((s, i) => (i < pieces.length - 1 ? `${s}–` : s).trim()).filter(Boolean);
}

/** Every unit `wrapDate` may put on a line of its own. */
const dateUnits = (text: string): string[] => dateParts(text).flatMap(dateWordUnits);

/** `hardBreak` for one date line, which is only ever over-wide as a single unit (see wrapUnits). A
 *  trailing dash — glued " –" or an unspaced "–" — stays on the last chunk of its word, so no chunk
 *  is a bare dash or starts or ends with a space. If the last chunk plus the dash is still too wide,
 *  its final character moves down with the dash. */
function hardBreakDate(line: string, framePx: number, measure: (s: string) => number): string[] {
  if (measure(line) <= framePx) return [line];
  const suffix = / ?–$/.exec(line)?.[0] ?? "";
  const body = line.slice(0, line.length - suffix.length);
  if (!suffix || !body) return hardBreak(line, framePx, measure);
  const chunks = hardBreak(body, framePx, measure);
  const last = chunks.pop() as string;
  if (measure(last + suffix) <= framePx || last.length < 2) chunks.push(last + suffix);
  else chunks.push(last.slice(0, -1), last.slice(-1) + suffix);
  return chunks;
}

/** Each line wraps to `maxPx`; a single word wider than that widens the box, up to `framePx`. */
function buildBlock(e: LayoutEvent, maxPx: number, framePx: number): TextBlock {
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
  push("date", e.dateText);
  push("title", e.title);
  push("description", e.description);
  return measureBlock(roles, texts);
}

function measureBlock(roles: LineRole[], texts: string[]): TextBlock {
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

/** One greedy pass of spec §5.2 first-fit. In the usual order (preferred side's rows outward, then
 *  the other side's), an item takes the first row within `maxRows` that is plainly free (the row's
 *  last box ends a column-gap before this box starts). With `keepStemsClear`, a plainly free row that
 *  also keeps the stems clear is taken first: the item's stem crosses no box in a row nearer the rule
 *  on that side (a stem rises through every inner row), and its box covers no stem of an item already
 *  further out; failing that, the plain row (the stem passes under a label, which paints above stems
 *  in a white halo). No in-cap row: overflow past `maxRows` and `fits: false`.
 *  O(items × rows × placed). */
function firstFit(items: RowItem[], maxRows: number, sides: Side[], keepStemsClear: boolean): { placed: Map<number, Slot>; fits: boolean } {
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
      (keepStemsClear ? firstIn(order, (side, r) => plain(it, side, r) && stemsClear(it, side, r)) : null) ??
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

/** Row assignment for one track. `fits` is exactly plain first-fit's: the stem-clearance preference
 *  moves earlier labels, which can take a row a later label's plain first-fit needed, so it is used
 *  only when plain first-fit fits AND the preferring pass also fits. Otherwise plain first-fit's rows
 *  (and overflow rows) stand. `preferClearStems: false` is plain first-fit alone. */
function assignRows(items: RowItem[], maxRows: number, sides: Side[], preferClearStems: boolean): { placed: Map<number, Slot>; fits: boolean } {
  const plain = firstFit(items, maxRows, sides, false);
  if (!preferClearStems || !plain.fits) return plain;
  const soft = firstFit(items, maxRows, sides, true);
  return soft.fits ? soft : plain;
}

function placeLines(block: TextBlock, box: Box, anchor: "start" | "middle" | "end"): PlacedLine[] {
  const x = anchor === "middle" ? (box.x0 + box.x1) / 2 : anchor === "end" ? box.x1 : box.x0;
  let top = box.y0;
  return block.roles.map((role, i) => {
    const st = LINE_STYLE[role];
    // Baseline ≈ line top + font size: Figtree's ascent fills most of a line box at these sizes.
    const line: PlacedLine = { role, text: block.texts[i] as string, x, y: top + st.size, anchor };
    top += st.lineH;
    return line;
  });
}

/** A lane name wrapped to `px` between words; a word wider than `px` alone is split. */
function laneNameLines(label: string, px: number): string[] {
  return wrapToWidth(label, px, LANE_SIZE)
    .split("\n")
    .flatMap((l) => hardBreak(l, px, (s) => estimateLabelWidth(s, LANE_SIZE)));
}

function layoutHorizontal(inp: TimelineLayoutInput, preferClearStems = true): TimelineLayout {
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
  const laneLines = (label: string): string[] => laneNameLines(label, laneTextPx);
  const framePx = Math.max(0, inp.width - gutter);
  const blocks = new Map(events.map((e) => [e.id, buildBlock(e, inp.labelWidth, framePx)]));
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
      preferClearStems,
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
    // A tick is centred on its date unless that would push its text off the frame: the range inset
    // makes room only for point labels, so a span's end can sit a marker radius from an edge. There
    // the tick anchors at its date and reads inward instead.
    out.ticks = scale.ticks(n).map((t) => {
      const x = scale(t);
      const text = fmt(t);
      const half = estimateLabelWidth(text, TBL.size.axis) / 2;
      const anchor = x - half < 0 ? "start" : x + half > inp.width ? "end" : "middle";
      return { x, y, text, anchor };
    });
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

/** Gap between the vertical tick column and whatever sits right of it. */
const V_TICK_GAP = 8;
/** A vertical text column's natural width is capped at this share of the width (see layoutVertical). */
const V_SIDE_SHARE = 0.4;
/** Space left of the band when no left column sits there: keeps the marker's halo inside the frame. */
const V_EDGE = 4;
/** Floors for a compressed vertical sub-track band. */
const V_MIN_BAR = 3;
const V_MIN_TRACK_GAP = 1;
/** Slack for a width that round-trips through BOLD_FACTOR: a date unit that exactly fits its
 *  column must never be split. */
const V_EPS = 1e-6;

/** One side's column of vertical label blocks: left-aligned at `x0` ("start") or right-aligned
 *  at `x1` ("end"). */
interface VColumn { x0: number; x1: number; anchor: "start" | "end" }
interface VPlaced { id: number; box: Box; lines: PlacedLine[]; mid: number; displaced: boolean }

/** A vertical label block: bold date line(s), then the title, then the description, each wrapped to
 *  `colW`. A date wraps only between `dateUnits` (bold-aware); `hardBreakDate` splits only a unit
 *  wider than the whole column. */
function vBlock(e: LayoutEvent, colW: number): TextBlock {
  const roles: LineRole[] = [];
  const texts: string[] = [];
  const add = (role: LineRole, lines: string[]): void => {
    for (const s of lines) { roles.push(role); texts.push(s); }
  };
  const frame = colW + V_EPS;
  const dateW = (s: string): number => textW("date", s);
  if (e.dateText) {
    const wrapped = dateW(e.dateText) <= frame ? [e.dateText] : wrapDate(e.dateText, frame / BOLD_FACTOR, LINE_STYLE.date.size);
    add("date", wrapped.flatMap((ln) => hardBreakDate(ln, frame, dateW)));
  }
  for (const role of ["title", "description"] as const) {
    const text = role === "title" ? e.title : e.description;
    if (!text) continue;
    const lines = wrapToWidth(text, colW, LINE_STYLE[role].size).split("\n");
    add(role, lines.flatMap((ln) => hardBreak(ln, colW, (s) => textW(role, s))));
  }
  return measureBlock(roles, texts);
}

/** Height of a column's blocks stacked with no slack: the shortest axis that can hold them. */
const vStack = (blocks: TextBlock[]): number =>
  blocks.reduce((s, b) => s + b.h, 0) + TL_GEOM.vLabelGap * Math.max(0, blocks.length - 1);

/** Places one column's blocks, given in date order with each item's y. A block's first (date) line
 *  is centred on its item and a downward sweep pushes it below the block before; a column sweeps
 *  only its own blocks, so two columns never push each other. `displaced` marks a block the sweep
 *  moved off its item (it gets a leader), and `mid` is its first line's centre, where a leader
 *  enters. No block starts above `minTop` (0, or the bottom of the lane-name header in lane
 *  columns). The first block is never pushed only because the axis starts vPad below `minTop` and
 *  vPad equals half the date line height: its desired top is then exactly `minTop`, so the clamp
 *  never moves it. */
function placeColumn(col: VColumn, items: Array<{ id: number; y: number; block: TextBlock }>, minTop = 0): VPlaced[] {
  const half = LINE_STYLE.date.lineH / 2;
  let prevBottom = -Infinity;
  return items.map(({ id, y, block }) => {
    const top = Math.max(y - half, prevBottom + TL_GEOM.vLabelGap, minTop);
    prevBottom = top + block.h;
    const [x0, x1] = col.anchor === "start" ? [col.x0, col.x0 + block.w] : [col.x1 - block.w, col.x1];
    const box: Box = { x0, y0: top, x1, y1: top + block.h };
    return { id, box, lines: placeLines(block, box, col.anchor), mid: top + half, displaced: top + half - y > 0.5 };
  });
}

/** The elbow leader joining a displaced vertical label to its item, on the side its label sits
 *  (`s`: -1 left, +1 right of the item's rule). A leader in a pushed cluster shares one vertical leg,
 *  2px outside the band (`band` is the rule to the outer edge of that side's outermost bar, at
 *  least a marker radius), instead of fanning into a smear. It leaves from `start` — a span on an
 *  outer sub-track leaves its own bar's outer edge, so it reads as that bar's, not a neighbour's —
 *  or, for a point or a sub-track-0 span, 2px off the marker; runs out to the leg across any outer
 *  bars, down parallel to the rule, and into the label's first line at `colEdge`. */
function vLeader(
  s: -1 | 1, rule: number, band: number, start: number | null, y: number, mid: number, colEdge: number,
): Array<[number, number]> {
  const leg = rule + s * band + s * 2;
  const from = start ?? rule + s * TL_GEOM.dotR + s * 2;
  return [...(from === leg ? [] : [[from, y] as [number, number]]), [leg, y], [leg, mid], [colEdge, mid]];
}

/** Vertical: time top → bottom, each event's label beside its item — one block of bold date line(s)
 *  above the title and description. Points and spans on the main rule (sub-track 0) label to the
 *  RIGHT of the track, left-aligned; spans on outer sub-tracks (k ≥ 1, stacked leftward from the
 *  rule) label to the LEFT, right-aligned, ending a label gap short of the band's leftmost bar. Each
 *  side sweeps on its own. Exactly two lanes draw as lane columns (layoutLaneColumns); any other
 *  `lanes` value is ignored here — one track, every event drawn.
 *
 *  Width budget, left to right: [tick column] → [left text column + gap, only when some span is on
 *  k ≥ 1; otherwise a V_EDGE pad] → span band → rule → marker half-width + gap → right text column.
 *  Each side's FLOOR is its widest date unit (dates wrap only between words or after an en dash),
 *  on the left capped at V_SIDE_SHARE (40%) of the width; its NEED is its widest unwrapped line
 *  capped at 40%, but never below its floor. Allocated in this priority:
 *   1. The tick column is drawn if it fits beside the left floor, the band at its floors (bars
 *      V_MIN_BAR, gaps V_MIN_TRACK_GAP), the right floor and the fixed gaps; otherwise it is omitted
 *      (not squeezed), and the x-axis title with it (amendment A8).
 *   2. In what remains, the left column takes its need.
 *   3. The band takes its natural width, compressed toward its floors as far as it takes to leave
 *      the right column its need.
 *   4. If the band at its floors still leaves the right column short, the left column yields, down
 *      to its floor.
 *   5. The right column gets everything that remains.
 *  A left date unit wider than 40% is split by hardBreakDate, so the left column never pushes the
 *  track off the frame; a right one is split to whatever the right column gets.
 *  With nothing on the left the track sits V_EDGE + a marker radius from the tick column (or the
 *  frame edge), and the right column gets the rest of the width. The axis length is chosen so the
 *  taller side's whole stack fits, which keeps pushes local. */
function layoutVertical(inp: TimelineLayoutInput): TimelineLayout {
  if (inp.lanes?.length === 2) return layoutLaneColumns(inp, inp.lanes);
  const G = TL_GEOM;
  const W = inp.width;
  const events = [...inp.events].sort(byTime);
  const sub = assignSubTracks(events.filter(isSpan));
  const nSub = sub.size ? Math.max(...sub.values()) + 1 : 0;
  const kOf = (e: LayoutEvent): number => sub.get(e.id) ?? 0;
  const left = events.filter((e) => kOf(e) > 0);
  const right = events.filter((e) => kOf(e) === 0);
  const hasLeft = left.length > 0;
  // Sub-tracks stack leftward from the rule, bar width `w` at pitch `w + g`; `bandOf` is the rule
  // to the outermost bar's left edge.
  const bandOf = (w: number, g: number): number => (nSub ? w / 2 + (nSub - 1) * (w + g) : 0);
  // An open-ended span needs room below the last date to fade out, as horizontal reserves G.fade.
  const tail = events.some((e) => e.ongoing) ? G.fade : 0;

  const share = V_SIDE_SHARE * W;
  // `word` is the side's widest date unit (the floor below which a date would split mid-word) and
  // `need` its widest unwrapped line, capped at `share`. On the left the floor is capped at `share`
  // too, so the left column never passes 40% of the width: a wider unit there is split by
  // hardBreakDate rather than pushing the track and the right column off the frame.
  const needOf = (evs: LayoutEvent[], capWord: boolean): { need: number; word: number } => {
    if (!evs.length) return { need: 0, word: 0 };
    const rawWord = Math.max(0, ...evs.flatMap((e) => dateUnits(e.dateText).map((u) => textW("date", u))));
    const word = capWord ? Math.min(share, rawWord) : rawWord;
    const widest = (role: LineRole, s: string | null): number[] => (s ? s.split("\n").map((x) => textW(role, x)) : []);
    const nat = Math.max(0, ...evs.flatMap((e) => [
      ...widest("date", e.dateText), ...widest("title", e.title), ...widest("description", e.description),
    ]));
    return { need: Math.max(word, Math.min(share, nat)), word };
  };
  const leftNeed = needOf(left, true);
  const rightNeeds = needOf(right, false);
  const rightNeed = rightNeeds.need;
  const rightOf = (w: number): number => Math.max(G.dotR, nSub ? w / 2 : 0) + G.vLabelGap;
  const leftOf = (lw: number): number => (hasLeft ? lw + G.vLabelGap : V_EDGE);

  // Step 1: the tick column fits if it leaves room for the left column's date-word floor, the band
  // at its floors, the right column's date-word floor and the fixed gaps.
  const bandFloor = Math.max(G.dotR, bandOf(V_MIN_BAR, V_MIN_TRACK_GAP));
  const tickRoom = W - leftOf(leftNeed.word) - bandFloor - rightOf(V_MIN_BAR) - rightNeeds.word;

  // Steps 2-4, in what the tick column leaves (`avail`).
  const allocate = (avail: number) => {
    // The band compresses to leave the right column its need beside the left's.
    const bandRoom = avail - leftOf(leftNeed.need) - rightNeed - rightOf(G.spanH);
    let barW: number = G.spanH;
    let gap: number = G.subTrackGap;
    // nSub = 0 has no bars to compress (bandOf is 0, so the scale below would divide by zero).
    if (nSub && Math.max(G.dotR, bandOf(barW, gap)) > bandRoom) {
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
    // The left column yields toward its date-word floor if the right is still short.
    const short = rightNeed - (avail - leftOf(leftNeed.need) - band - rightOf(barW));
    const leftW = hasLeft ? Math.max(leftNeed.word, leftNeed.need - Math.max(0, short)) : 0;
    return { barW, gap, band, leftW };
  };

  const geometry = (tickNeed: number) => {
    const tickW = tickNeed > 0 && tickNeed <= tickRoom ? tickNeed : 0;
    const { barW, gap, band, leftW } = allocate(W - tickW);
    const ruleX = tickW + leftOf(leftW) + band;
    const leftCol: VColumn = { x0: tickW, x1: tickW + leftW, anchor: "end" };
    const rightCol: VColumn = { x0: ruleX + rightOf(barW), x1: W, anchor: "start" };
    const colR = Math.max(0, W - rightCol.x0);
    const blocks = new Map(events.map((e) => [e.id, vBlock(e, kOf(e) > 0 ? leftW : colR)]));
    const stackOf = (evs: LayoutEvent[]): number => vStack(evs.map((e) => blocks.get(e.id) as TextBlock));
    const L = Math.max(G.minVerticalHeight - 2 * G.vPad - tail, stackOf(left), stackOf(right));
    return { tickW, ruleX, barW, gap, band, leftCol, rightCol, blocks, L };
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
  const { tickW, ruleX, barW, gap, band, leftCol, rightCol, blocks, L } = geometry(tickNeed);
  if (!tickW) ticks = []; // the column did not fit: omitted, not squeezed
  const { pos, scale } = positioner(events, inp.spacing, G.vPad, G.vPad + L);

  const itemsOf = (evs: LayoutEvent[]) => evs.map((e) => ({ id: e.id, y: pos(e.start), block: blocks.get(e.id) as TextBlock }));
  const placed = new Map([...placeColumn(leftCol, itemsOf(left)), ...placeColumn(rightCol, itemsOf(right))].map((p) => [p.id, p]));
  const bottom = Math.max(0, ...[...placed.values()].map((p) => p.box.y1));
  const height = Math.ceil(Math.max(G.vPad + L + tail + G.vPad, bottom + G.vPad));

  const out: TimelineLayout = {
    orientation: "vertical", width: W, height, fits: true, order: events.map((e) => e.id),
    rules: [], markers: [], spans: [], labels: [], stems: [], ticks: [], laneLabels: [],
  };
  const barX = (k: number): number => ruleX - barW / 2 - k * (barW + gap);
  for (const e of events) {
    const y = pos(e.start);
    const k = kOf(e);
    if (isSpan(e)) {
      const ye = e.ongoing ? height - G.vPad : pos(e.end as Date);
      out.spans.push({
        id: e.id, category: e.category, x: barX(k), y,
        w: barW, h: Math.max(G.minSpanPx, ye - y), projected: e.projected, fade: e.ongoing ? "down" : null,
      });
    } else {
      out.markers.push({ id: e.id, category: e.category, cx: ruleX, cy: y, projected: e.projected });
    }
    const p = placed.get(e.id) as VPlaced;
    out.labels.push({ id: e.id, category: e.category, box: p.box, lines: p.lines });
    if (!p.displaced) continue;
    // Left labels (k ≥ 1) sit beyond the band; right labels have only the marker (or the
    // sub-track-0 bar's half, never wider than it) between them and the rule.
    const points =
      k > 0
        ? vLeader(-1, ruleX, band, barX(k), y, p.mid, leftCol.x1 + 4)
        : vLeader(1, ruleX, G.dotR, null, y, p.mid, rightCol.x0 - 4);
    out.stems.push({ id: e.id, category: e.category, points });
  }

  out.rules.push({ x1: ruleX, y1: G.vPad, x2: ruleX, y2: height - G.vPad });
  if (scale && tickFmt) {
    const fmt = tickFmt;
    out.ticks = ticks.map((t) => ({ x: 0, y: scale(t) + 4, text: fmt(t), anchor: "start" as const }));
  }
  return out;
}

/** Lane columns: rule-to-rule distance between the two tracks. */
const V_LANE_GAP = 32;
/** Lane columns: a lane name ends (lane 0) or starts (lane 1) this far outside its rule. */
const V_LANE_NAME_INSET = 6;

/** Vertical with exactly two lanes (D3): two tracks near the centre, each named at the top on its
 *  outer side. Lane 0's labels sit LEFT of its track, right-aligned; lane 1's RIGHT of its track,
 *  left-aligned. Each lane's overlapping spans take sub-tracks stacked OUTWARD from its rule (lane 0
 *  leftward, lane 1 rightward), so a lane's labels always sit on its outer side, beyond its band,
 *  and the centre between the rules holds only the rules and their sub-track-0 marks. Each lane
 *  sweeps its own labels (placeColumn); a lane with no events still gets its track and name. An
 *  event outside both lanes is not drawn.
 *
 *  Width budget, left to right: [tick column] → lane 0 text column → gap → lane 0 band → rule 0 →
 *  V_LANE_GAP → rule 1 → lane 1 band → gap → lane 1 text column. The two text columns get equal
 *  widths — half of what the tick column, both bands and the fixed gaps leave — which keeps the
 *  tracks centred in the space right of the tick column. Each column's FLOOR is the wider of the two
 *  lanes' widest date unit (dates wrap only between words or after an en dash).
 *   1. The tick column (Ruling 28) is drawn if it fits beside both columns at that floor, both
 *      bands at their floors (bars V_MIN_BAR, gaps V_MIN_TRACK_GAP) and the fixed gaps; otherwise
 *      it is omitted, and the x-axis title with it.
 *   2. Both bands take their natural width, compressed together (one bar width for both lanes)
 *      toward their floors only as far as it takes to leave each column its floor.
 *   3. The columns split what remains equally; a date unit wider than its column is split by
 *      hardBreakDate, so no label leaves the frame.
 *  Lane names wrap to their side (the frame edge or tick column to 6px short of the rule) and the
 *  taller name block is reserved at the top: labels start below it (placeColumn's min-top) and the
 *  axis starts vPad below that. */
function layoutLaneColumns(inp: TimelineLayoutInput, lanes: Array<{ key: string; label: string }>): TimelineLayout {
  const G = TL_GEOM;
  const W = inp.width;
  const keys = lanes.map((l) => l.key);
  const events = inp.events.filter((e) => keys.includes(e.category)).sort(byTime);
  const laneEvs = keys.map((k) => events.filter((e) => e.category === k));
  const laneIx = new Map(events.map((e) => [e.id, keys.indexOf(e.category)]));
  const subs = laneEvs.map((evs) => assignSubTracks(evs.filter(isSpan)));
  const nSubs = subs.map((s) => (s.size ? Math.max(...s.values()) + 1 : 0));
  const kOf = (e: LayoutEvent): number => subs[laneIx.get(e.id) as number]!.get(e.id) ?? 0;
  const tail = events.some((e) => e.ongoing) ? G.fade : 0;
  const sideOf = (i: number): -1 | 1 => (i === 0 ? -1 : 1);

  // Rule to the outer edge of a lane's outermost bar, at least a marker radius.
  const bandOf = (n: number, w: number, g: number): number => Math.max(G.dotR, n ? w / 2 + (n - 1) * (w + g) : 0);
  const word = Math.max(0, ...events.flatMap((e) => dateUnits(e.dateText).map((u) => textW("date", u))));
  const fixed = 2 * G.vLabelGap + V_LANE_GAP;
  const tickRoom = W - 2 * word - fixed - nSubs.reduce((s, n) => s + bandOf(n, V_MIN_BAR, V_MIN_TRACK_GAP), 0);

  // Step 2: one bar width and gap for both lanes. Bands are linear in (w, g) — (n - 0.5)w + (n - 1)g
  // for a lane with spans — so the compressed bar solves directly, as layoutVertical's does.
  const bars = (avail: number): { barW: number; gap: number } => {
    const room = avail - fixed - 2 * word;
    let barW: number = G.spanH;
    let gap: number = G.subTrackGap;
    if (nSubs.reduce((s, n) => s + bandOf(n, barW, gap), 0) <= room) return { barW, gap };
    const spanned = nSubs.filter((n) => n > 0);
    if (!spanned.length) return { barW, gap };
    const roomBars = Math.max(0, room - (nSubs.length - spanned.length) * G.dotR);
    const a = spanned.reduce((s, n) => s + (n - 0.5), 0);
    const b = spanned.reduce((s, n) => s + (n - 1), 0);
    const sc = roomBars / (a * barW + b * gap);
    barW *= sc;
    gap *= sc;
    if (gap < V_MIN_TRACK_GAP) {
      gap = V_MIN_TRACK_GAP;
      barW = (roomBars - b * gap) / a;
    }
    return { barW: Math.max(V_MIN_BAR, barW), gap };
  };

  const geometry = (tickNeed: number) => {
    const tickW = tickNeed > 0 && tickNeed <= tickRoom ? tickNeed : 0;
    const { barW, gap } = bars(W - tickW);
    const bands = nSubs.map((n) => bandOf(n, barW, gap));
    const colW = Math.max(0, (W - tickW - fixed - bands[0]! - bands[1]!) / 2);
    const rules = [tickW + colW + G.vLabelGap + bands[0]!];
    rules.push(rules[0]! + V_LANE_GAP);
    const cols: VColumn[] = [
      { x0: tickW, x1: tickW + colW, anchor: "end" },
      { x0: rules[1]! + bands[1]! + G.vLabelGap, x1: W, anchor: "start" },
    ];
    const names = [
      laneNameLines(lanes[0]!.label, Math.max(0, rules[0]! - V_LANE_NAME_INSET - tickW)),
      laneNameLines(lanes[1]!.label, Math.max(0, W - rules[1]! - V_LANE_NAME_INSET)),
    ];
    const top = Math.max(...names.map((n) => n.length)) * LANE_LINE_H + G.rowGap;
    const blocks = new Map(events.map((e) => [e.id, vBlock(e, colW)]));
    const L = Math.max(
      G.minVerticalHeight - top - 2 * G.vPad - tail,
      ...laneEvs.map((evs) => vStack(evs.map((e) => blocks.get(e.id) as TextBlock))),
    );
    return { tickW, barW, gap, bands, rules, cols, names, top, blocks, L };
  };

  // Ticks as layoutVertical chooses them: count from the tickless axis, column sized to the widest.
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
  const { tickW, barW, gap, bands, rules, cols, names, top, blocks, L } = geometry(tickNeed);
  if (!tickW) ticks = [];
  const y0 = top + G.vPad;
  const { pos, scale } = positioner(events, inp.spacing, y0, y0 + L);

  const placed = new Map(
    laneEvs.flatMap((evs, i) =>
      placeColumn(cols[i]!, evs.map((e) => ({ id: e.id, y: pos(e.start), block: blocks.get(e.id) as TextBlock })), top),
    ).map((p) => [p.id, p]),
  );
  const bottom = Math.max(0, ...[...placed.values()].map((p) => p.box.y1));
  const height = Math.ceil(Math.max(y0 + L + tail + G.vPad, bottom + G.vPad));

  const out: TimelineLayout = {
    orientation: "vertical", width: W, height, fits: true, order: events.map((e) => e.id),
    rules: rules.map((x) => ({ x1: x, y1: y0, x2: x, y2: height - G.vPad })),
    markers: [], spans: [], labels: [], stems: [], ticks: [],
    laneLabels: lanes.map((l, i) => ({
      text: l.label, lines: names[i]!, x: rules[i]! + sideOf(i) * V_LANE_NAME_INSET, y: LANE_SIZE,
      anchor: i === 0 ? "end" : "start",
    })),
  };
  // A bar's centre sits k pitches outward from its lane's rule.
  const barX = (i: number, k: number): number => rules[i]! + sideOf(i) * k * (barW + gap) - barW / 2;
  for (const e of events) {
    const i = laneIx.get(e.id) as number;
    const s = sideOf(i);
    const y = pos(e.start);
    const k = kOf(e);
    if (isSpan(e)) {
      const ye = e.ongoing ? height - G.vPad : pos(e.end as Date);
      out.spans.push({
        id: e.id, category: e.category, x: barX(i, k), y,
        w: barW, h: Math.max(G.minSpanPx, ye - y), projected: e.projected, fade: e.ongoing ? "down" : null,
      });
    } else {
      out.markers.push({ id: e.id, category: e.category, cx: rules[i]!, cy: y, projected: e.projected });
    }
    const p = placed.get(e.id) as VPlaced;
    out.labels.push({ id: e.id, category: e.category, box: p.box, lines: p.lines });
    if (!p.displaced) continue;
    // An outer-sub-track span leaves its own bar's outer edge; anything on the rule leaves beside it.
    const start = isSpan(e) && k > 0 ? barX(i, k) + (s < 0 ? 0 : barW) : null;
    const colEdge = s < 0 ? cols[i]!.x1 + 4 : cols[i]!.x0 - 4;
    out.stems.push({ id: e.id, category: e.category, points: vLeader(s, rules[i]!, bands[i]!, start, y, p.mid, colEdge) });
  }
  if (scale && tickFmt) {
    const fmt = tickFmt;
    out.ticks = ticks.map((t) => ({ x: 0, y: scale(t) + 4, text: fmt(t), anchor: "start" as const }));
  }
  return out;
}

export function layoutTimeline(inp: TimelineLayoutInput): TimelineLayout {
  return inp.orientation === "vertical" ? layoutVertical(inp) : layoutHorizontal(inp);
}

/** Internal, for tests: `fits` of the horizontal layout under plain §5.2 first-fit alone (no
 *  stem-clearance preference), which `layoutTimeline`'s `fits` must always equal. */
export function plainFirstFitFits(inp: TimelineLayoutInput): boolean {
  return layoutHorizontal(inp, false).fits;
}
