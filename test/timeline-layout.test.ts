import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { layoutTimeline, plainFirstFitFits, verticalNoSwapLayout, TL_GEOM, LANE_SIZE, LANE_LINE_H, LINE_STYLE, type LayoutEvent, type TimelineLayoutInput, type TimelineLayout } from "../src/engine/timeline-layout";
import { parseDate } from "../src/spec/parse-time";
import { timelineTextWidth } from "../src/engine/timeline-text";
import { TBL } from "../src/engine/theme";

let nextId = 0;
function ev(start: string, title: string, o: Partial<LayoutEvent> & { endStr?: string } = {}): LayoutEvent {
  const { endStr, ...rest } = o;
  return {
    id: nextId++, start: parseDate(start), end: endStr ? parseDate(endStr) : null, ongoing: false,
    category: "", dateText: start.slice(0, 4), title, description: null, projected: false, ...rest,
  };
}
const base = (events: LayoutEvent[], o: Partial<TimelineLayoutInput> = {}): TimelineLayoutInput => ({
  events, width: 900, orientation: "horizontal", spacing: "proportional", lanes: null,
  axis: false, labelWidth: 150, maxRows: 2, ...o,
});
const overlaps = (a: { x0: number; x1: number; y0: number; y1: number }, b: typeof a): boolean =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
// Walks every value: JSON.stringify writes NaN and ±Infinity as null, so a regex over the JSON
// could never see them.
const allFinite = (v: unknown): boolean =>
  typeof v === "number"
    ? Number.isFinite(v)
    : Array.isArray(v)
      ? v.every(allFinite)
      : v !== null && typeof v === "object"
        ? Object.values(v).every(allFinite)
        : true;
const labelOf = (l: TimelineLayout, id: number) => l.labels.find((x) => x.id === id)!;
const ruleY = (l: TimelineLayout): number => l.rules[0]!.y1;

const REL_X_KEYS = new Set(["x", "x0", "x1", "x2", "cx"]);
/** The layout with every x taken relative to the first rule and rounded, tick x dropped: what
 *  Ruling 43 must leave unchanged (it only moves the block, and the tick column within it). */
const relative = (l: TimelineLayout): unknown => {
  const r0 = l.rules[0]!.x1;
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  const walk = (p: unknown, key: string, path: string): unknown => {
    if (typeof p === "number") return round(REL_X_KEYS.has(key) && !path.startsWith(".ticks") ? p - r0 : key === "x" ? 0 : p);
    if (Array.isArray(p)) {
      const isPoint = p.length === 2 && typeof p[0] === "number" && path.includes("points");
      return p.map((x, i) => walk(x, isPoint ? (i === 0 ? "x" : "y") : key, `${path}[${i}]`));
    }
    if (p !== null && typeof p === "object") {
      return Object.fromEntries(Object.entries(p).map(([k, x]) => [k, walk(x, k, `${path}.${k}`)]));
    }
    return p;
  };
  return walk(l, "", "");
};
const inkOf = (l: TimelineLayout): [number, number] => {
  const nameW = (n: TimelineLayout["laneLabels"][number]) => Math.max(...n.lines.map((s) => timelineTextWidth(s, LANE_SIZE, 700)));
  const lo = [
    ...l.labels.map((x) => x.box.x0), ...l.markers.map((m) => m.cx - TL_GEOM.dotR), ...l.spans.map((s) => s.x),
    ...l.ticks.map((k) => k.x), ...l.laneLabels.map((n) => (n.anchor === "end" ? n.x - nameW(n) : n.x)),
  ];
  const hi = [
    ...l.labels.map((x) => x.box.x1), ...l.markers.map((m) => m.cx + TL_GEOM.dotR), ...l.spans.map((s) => s.x + s.w),
    ...l.ticks.map((k) => k.x + timelineTextWidth(k.text, TBL.size.axis, 500)),
    ...l.laneLabels.map((n) => (n.anchor === "end" ? n.x : n.x + nameW(n))),
  ];
  return [Math.min(...lo), Math.max(...hi)];
};
/** Ruling 43 leaves a vertical layout's geometry relative to its track unchanged and only moves
 *  the block: `l` is the pinned layout `pinned` (captured before Ruling 43, re-captured at Task
 *  16b), centred, with its tick column against the block's left. */
const expectPinnedUpToCentring = (l: TimelineLayout, pinned: string): void => {
  expect(JSON.stringify(relative(l))).toBe(JSON.stringify(relative(JSON.parse(pinned) as TimelineLayout)));
  const [lo, hi] = inkOf(l);
  for (const k of l.ticks) expect(k.x).toBeCloseTo(lo, 9);
  expect(Math.abs((lo + hi) / 2 - l.width / 2)).toBeLessThanOrEqual(1e-6);
};

// The reference image: five milestones, 2026–2095.
const FIG7 = () => [
  ev("2026", "Policy begins"),
  ev("2030", "First cohort born under fully phased-in policy"),
  ev("2055", "Annual projection ends"),
  ev("2057", "That cohort turns 27"),
  ev("2095", "That cohort turns 65"),
];
// FIG7's titles at dates spread far enough apart that no two labels collide on a vertical track, so
// a single-track vertical layout of it never swaps a label left (E1): the no-left-column budget and
// the Ruling 29 inset apply. (FIG7 itself swaps 2030 and 2057 left.)
const SPREAD = () => [
  ev("2026", "Policy begins"),
  ev("2050", "First cohort born under fully phased-in policy"),
  ev("2075", "Annual projection ends"),
  ev("2100", "That cohort turns 65"),
];

describe("horizontal layout", () => {
  it("places markers proportionally to elapsed time", () => {
    const l = layoutTimeline(base(FIG7()));
    const xs = l.markers.map((m) => m.cx);
    const gap = (i: number) => (xs[i + 1]! - xs[i]!);
    // 2026→2030 is 4 years, 2057→2095 is 38: the second gap is ~9.5× the first.
    expect(gap(3) / gap(0)).toBeCloseTo(38 / 4, 1);
  });

  it("alternates sides, starting above, and fits the reference image in one row per side", () => {
    const l = layoutTimeline(base(FIG7()));
    const above = (id: number) => labelOf(l, id).box.y1 <= ruleY(l);
    const ids = l.order;
    expect(ids.map(above)).toEqual([true, false, true, false, true]);
    expect(l.fits).toBe(true);
  });

  it("never overlaps two label boxes", () => {
    const l = layoutTimeline(base(FIG7(), { width: 600 }));
    for (const a of l.labels) for (const b of l.labels) if (a !== b) expect(overlaps(a.box, b.box)).toBe(false);
  });

  it("keeps every box inside the frame and the stem on its date", () => {
    const events = [ev("2026", "A label long enough to cross the left frame edge if centred")];
    events.push(ev("2027", "x"));
    const l = layoutTimeline(base(events, { width: 400 }));
    for (const lab of l.labels) {
      expect(lab.box.x0).toBeGreaterThanOrEqual(0);
      expect(lab.box.x1).toBeLessThanOrEqual(400);
    }
    for (const s of l.stems) {
      const m = l.markers.find((mk) => mk.id === s.id)!;
      expect(s.points[0]![0]).toBeCloseTo(m.cx, 6);
    }
  });

  it("clamps a box that would cross the frame, leaving its stem on the date", () => {
    // 2094 is not the edge date, so the range inset does not protect its wide label: centred, it
    // would run past 400. The clamp must move the box left while the stem stays at the marker.
    const wide = ev("2094", "A fairly wide label near the right edge");
    const l = layoutTimeline(base([ev("2000", "z"), wide, ev("2095", "y")], { width: 400 }));
    const box = labelOf(l, wide.id).box;
    const cx = l.markers.find((m) => m.id === wide.id)!.cx;
    expect(box.x0).toBeLessThan(cx - (box.x1 - box.x0) / 2);
    expect(box.x0).toBeGreaterThanOrEqual(0);
    expect(box.x1).toBeLessThanOrEqual(400);
    const stem = l.stems.find((s) => s.id === wide.id)!;
    for (const [x] of stem.points) expect(x).toBeCloseTo(cx, 6);
  });

  it("falls back to the other side when the preferred side is full", () => {
    // One row per side. c prefers above (b went below), but a's wide box still covers c's slot
    // above, while b's narrow box has ended below: c must take the other side, and still fit.
    const a = ev("2000", "A first label that is wide enough to wrap onto two lines");
    const b = ev("2003", "b");
    const c = ev("2008", "c");
    const l = layoutTimeline(base([a, b, c, ev("2100", "z")], { maxRows: 1 }));
    const below = (id: number) => labelOf(l, id).box.y0 >= ruleY(l);
    expect([below(a.id), below(b.id), below(c.id)]).toEqual([false, true, true]);
    expect(l.fits).toBe(true);
  });

  it("falls back to the other side, then reports fits:false when both are full", () => {
    // Ten events in one year at 300px: cannot fit in 2 rows per side.
    const dense = Array.from({ length: 10 }, (_, i) => ev(`2026-0${(i % 9) + 1}-01`, `Event number ${i}`));
    const l = layoutTimeline(base(dense, { width: 300 }));
    expect(l.fits).toBe(false);
    expect(l.labels).toHaveLength(10); // overflow adds rows, never drops a label
    for (const a of l.labels) for (const b of l.labels) if (a !== b) expect(overlaps(a.box, b.box)).toBe(false);
  });

  it("grows height with the rows used", () => {
    // Same labels (so the same row pitch) at two widths: only the number of rows used differs.
    const dense = Array.from({ length: 8 }, (_, i) => ev(`2026-0${i + 1}-01`, `Event number ${i}`));
    const one = layoutTimeline(base(dense, { width: 2000, maxRows: 4 }));
    const more = layoutTimeline(base(dense, { width: 400, maxRows: 4 }));
    expect(one.fits && more.fits).toBe(true);
    expect(more.height).toBeGreaterThan(one.height);
  });

  it("is deterministic and breaks date ties by CSV order", () => {
    const a = ev("2030", "first in csv");
    const b = ev("2030", "second in csv");
    const l1 = layoutTimeline(base([b, a]));
    const l2 = layoutTimeline(base([a, b]));
    expect(l1.order).toEqual([a.id, b.id].sort((x, y) => x - y));
    expect(JSON.stringify(l1)).toBe(JSON.stringify(l2));
  });

  it("gives even spacing one slot per distinct date, span ends included", () => {
    const events = [ev("2000", "a"), ev("2001", "b", { endStr: "2090" }), ev("2095", "c")];
    const l = layoutTimeline(base(events, { spacing: "even" }));
    const x = (id: number) => l.markers.find((m) => m.id === id)?.cx ?? l.spans.find((s) => s.id === id)!.x;
    const slots = [x(events[0]!.id), x(events[1]!.id), x(events[1]!.id) + l.spans[0]!.w, x(events[2]!.id)];
    const steps = slots.slice(1).map((v, i) => v - slots[i]!);
    for (const s of steps) expect(s).toBeCloseTo(steps[0]!, 6);
  });

  it("draws spans as bars and splits overlapping spans into sub-tracks", () => {
    const events = [ev("2020", "a", { endStr: "2030" }), ev("2025", "b", { endStr: "2035" }), ev("2031", "c", { endStr: "2040" })];
    const l = layoutTimeline(base(events));
    const ys = l.spans.map((s) => s.y);
    expect(ys[0]).not.toBe(ys[1]);        // a and b overlap → different sub-tracks
    expect(ys[2]).toBe(ys[0]);            // c starts after a ends → back on sub-track 0
    expect(l.spans.every((s) => s.h === TL_GEOM.spanH)).toBe(true);
  });

  it("runs an ongoing span to the frame edge with a right fade", () => {
    const l = layoutTimeline(base([ev("2020", "a"), ev("2022", "b", { ongoing: true })]));
    const s = l.spans[0]!;
    expect(s.x + s.w).toBeCloseTo(900, 6);
    expect(s.fade).toBe("right");
  });

  it("insets the range only for a label anchored at the edge date", () => {
    // The span's END is the last date; the wide point label sits mid-range, so it must not pull
    // the right end of the scale in.
    const l = layoutTimeline(base([ev("2000", "a", { endStr: "2090" }), ev("2050", "A wide label in the middle of the range")]));
    const s = l.spans[0]!;
    expect(s.x + s.w).toBeCloseTo(900 - TL_GEOM.dotR, 6);
  });

  it("draws a zero-length span at the minimum width", () => {
    const l = layoutTimeline(base([ev("2020", "a", { endStr: "2020" }), ev("2030", "b")]));
    expect(l.spans[0]!.w).toBe(TL_GEOM.minSpanPx);
    expect(l.labels).toHaveLength(2);
  });

  it("handles a single event without NaN, centred", () => {
    const l = layoutTimeline(base([ev("2026", "Only")]));
    expect(allFinite(l)).toBe(true);
    expect(l.markers[0]!.cx).toBeCloseTo(450, 0);
  });

  it("separates two events on the same date", () => {
    const a = ev("2026", "Alpha"), b = ev("2026", "Beta");
    const l = layoutTimeline(base([a, b, ev("2090", "z")]));
    expect(overlaps(labelOf(l, a.id).box, labelOf(l, b.id).box)).toBe(false);
  });

  it("widens a box to an unbreakable word, inside the frame", () => {
    const l = layoutTimeline(base([ev("2026", "Supercalifragilisticexpialidociously-long-unbroken-token"), ev("2090", "z")], { width: 320 }));
    expect(allFinite(l)).toBe(true);
    for (const lab of l.labels) { expect(lab.box.x0).toBeGreaterThanOrEqual(0); expect(lab.box.x1).toBeLessThanOrEqual(320); }
  });

  it("stacks lanes top to bottom with gutter labels, labels above each lane only", () => {
    const e = [ev("2026", "p1", { category: "policy" }), ev("2030", "c1", { category: "cohort" }), ev("2040", "p2", { category: "policy" })];
    const l = layoutTimeline(base(e, { lanes: [{ key: "policy", label: "Policy" }, { key: "cohort", label: "Cohort" }] }));
    expect(l.rules).toHaveLength(2);
    expect(l.rules[0]!.y1).toBeLessThan(l.rules[1]!.y1);
    expect(l.laneLabels.map((x) => x.text)).toEqual(["Policy", "Cohort"]);
    const gutterEnd = Math.min(...l.rules.map((r) => r.x1));
    expect(gutterEnd).toBeGreaterThan(0);
    for (const lab of l.labels) {
      const lane = l.rules[e.find((x) => x.id === lab.id)!.category === "policy" ? 0 : 1]!;
      expect(lab.box.y1).toBeLessThanOrEqual(lane.y1);
    }
  });

  it("emits ticks only with axis:true", () => {
    expect(layoutTimeline(base(FIG7())).ticks).toEqual([]);
    const withAxis = layoutTimeline(base(FIG7(), { axis: true }));
    expect(withAxis.ticks.length).toBeGreaterThanOrEqual(2);
    expect(withAxis.height).toBeGreaterThan(layoutTimeline(base(FIG7())).height);
  });

  it("keeps every horizontal tick's text inside the frame, end ticks included", () => {
    // Span labels are start-anchored, so the range inset only makes room for point labels: the
    // 2020 and 2030 ends sit a marker radius from each edge, where a centred tick would half-clip.
    const probe = () => [
      ev("2020", "Span one", { endStr: "2025" }), ev("2026", "Span two", { endStr: "2030" }), ev("2022", "A point"),
    ];
    for (const width of [920, 600]) {
      const l = layoutTimeline(base(probe(), { width, axis: true }));
      expect(l.ticks.length).toBeGreaterThanOrEqual(2);
      for (const t of l.ticks) {
        const w = timelineTextWidth(t.text, TBL.size.axis, 500);
        const x0 = t.anchor === "start" ? t.x : t.anchor === "end" ? t.x - w : t.x - w / 2;
        expect(x0).toBeGreaterThanOrEqual(0);
        expect(x0 + w).toBeLessThanOrEqual(width);
      }
      // Interior ticks stay centred on their date.
      expect(l.ticks.some((t) => t.anchor === "middle")).toBe(true);
    }
  });

  it("labels an outer sub-track span above, its stem rising from its own bar", () => {
    // b is second in date order, so alternation alone would send it below, where its stem would
    // hang off a's bar on sub-track 0.
    const a = ev("2020", "a", { endStr: "2030" });
    const b = ev("2021", "b", { endStr: "2035" });
    const l = layoutTimeline(base([a, b, ev("2090", "z")]));
    const spanA = l.spans.find((s) => s.id === a.id)!;
    const spanB = l.spans.find((s) => s.id === b.id)!;
    expect(spanB.y).toBeLessThan(spanA.y); // b is on sub-track 1, outward (up) from the rule
    expect(labelOf(l, b.id).box.y1).toBeLessThanOrEqual(ruleY(l));
    const stem = l.stems.find((s) => s.id === b.id)!;
    expect(stem.points[0]![1]).toBe(spanB.y);
    expect(stem.points[1]![1]).toBe(labelOf(l, b.id).box.y1);
  });

  it("caps the lanes gutter at 30% of the width and wraps a long lane name", () => {
    const name = "A lane name that is fifty characters long, really.";
    expect(name).toHaveLength(50);
    const e = [ev("2026", "p1", { category: "long" }), ev("2030", "s1", { category: "short" })];
    const l = layoutTimeline(base(e, { width: 280, lanes: [{ key: "long", label: name }, { key: "short", label: "S" }] }));
    expect(allFinite(l)).toBe(true);
    for (const r of l.rules) {
      expect(r.x1).toBeLessThanOrEqual(0.3 * 280 + 1e-6);
      expect(r.x1).toBeLessThan(r.x2);
    }
    for (const lab of l.labels) {
      expect(lab.box.x0).toBeGreaterThanOrEqual(0);
      expect(lab.box.x1).toBeLessThanOrEqual(280);
    }
    const long = l.laneLabels[0]!;
    expect(long.text).toBe(name);
    expect(long.lines.length).toBeGreaterThan(1);
    expect(long.anchor).toBe("end");
  });

  describe("lane-name block is reserved inside its lane", () => {
    const name = "A lane name that is fifty characters long, really.";
    // Line top = baseline - font size (as event labels place lines); line bottom = baseline plus a
    // 0.3-line descent, deliberately looser than the layout's own 3px.
    const top = (ll: { y: number }) => ll.y - LANE_SIZE;
    const bottom = (ll: { y: number; lines: string[] }) => ll.y + (ll.lines.length - 1) * LANE_LINE_H + LANE_LINE_H * 0.3;
    const lanesOf = (first: string, second: string) => [{ key: "a", label: first }, { key: "b", label: second }];
    const evs = () => [ev("2026", "a1", { category: "a" }), ev("2030", "b1", { category: "b" })];

    it("keeps a long LAST lane name inside the layout height", () => {
      const l = layoutTimeline(base(evs(), { width: 280, lanes: lanesOf("A", name) }));
      const ll = l.laneLabels[1]!;
      expect(ll.lines.length).toBeGreaterThan(3);
      expect(bottom(ll)).toBeLessThanOrEqual(l.height);
      for (const x of l.laneLabels) expect(top(x)).toBeGreaterThanOrEqual(0);
    });

    it("ends a long FIRST lane name above the next lane's labels and rule", () => {
      const e = evs();
      const l = layoutTimeline(base(e, { width: 280, lanes: lanesOf(name, "B") }));
      const ll = l.laneLabels[0]!;
      expect(top(ll)).toBeGreaterThanOrEqual(0);
      const nextLabelTop = Math.min(...l.labels.filter((x) => x.category === "b").map((x) => x.box.y0));
      expect(bottom(ll)).toBeLessThanOrEqual(Math.min(nextLabelTop, l.rules[1]!.y1));
    });

    it("leaves single-line lane names where they were", () => {
      const e = [ev("2026", "p1", { category: "policy" }), ev("2030", "c1", { category: "cohort" }), ev("2040", "p2", { category: "policy" })];
      const l = layoutTimeline(base(e, { lanes: [{ key: "policy", label: "Policy" }, { key: "cohort", label: "Cohort" }] }));
      // Values recorded from the layout before lane-name blocks were reserved, then shifted up
      // uniformly by 4px when the unused band above the top row was trimmed (was 49.5/119.5,
      // 53.5/123.5, 140).
      expect(l.rules.map((r) => r.y1)).toEqual([45.5, 115.5]);
      expect(l.laneLabels.map((x) => x.y)).toEqual([49.5, 119.5]);
      expect(l.height).toBe(136);
    });
  });

  describe("stem clearance (a soft preference within max_rows)", () => {
    // Every [stem, other label] pair where the stem's x is inside the box (widened by the stem
    // clearance) and the stem's y-range overlaps it. Horizontal stems are vertical segments.
    const crossings = (l: TimelineLayout, gap = 3): Array<[number, number]> => {
      const out: Array<[number, number]> = [];
      for (const s of l.stems) {
        const x = s.points[0]![0];
        const ys = s.points.map((p) => p[1]);
        for (const lab of l.labels) {
          if (lab.id === s.id) continue;
          const b = lab.box;
          if (x >= b.x0 - gap && x <= b.x1 + gap && Math.min(...ys) < b.y1 && Math.max(...ys) > b.y0) out.push([s.id, lab.id]);
        }
      }
      return out;
    };
    // The spans golden fixture (test/fixtures/timeline-spans.csv) as prepareTimeline builds it.
    const SPANS = () => [
      ev("2017-12-22", "TCJA individual provisions", { endStr: "2025-12-31", dateText: "Dec 22, 2017 – Dec 31, 2025", category: "law" }),
      ev("2021-03-11", "Expanded child tax credit", { endStr: "2021-12-31", dateText: "Mar 11, 2021 – Dec 31, 2021", category: "law" }),
      ev("2022-08-16", "IRA clean-energy credits", { ongoing: true, dateText: "Aug 16, 2022 –", category: "law" }),
      ev("2025-07-04", "OBBBA enacted", { dateText: "Jul 4, 2025", category: "law" }),
      ev("2026-01-01", "Phase-in period", { endStr: "2030-12-31", dateText: "Jan 1, 2026 – Dec 31, 2030", category: "projection", projected: true }),
      ev("2034-01-01", "Trust fund depletion", { dateText: "Jan 1, 2034", category: "projection", projected: true }),
    ];
    const LANES = [{ key: "law", label: "law" }, { key: "projection", label: "projection" }];

    it("takes a free row on the other side rather than rise through an inner-row box", () => {
      // c prefers above, where row 0 is taken by a's wide box and row 1 would put c's stem through
      // it. Plain first-fit took above row 1; below row 0 is free and keeps the stem clear.
      const a = ev("2000", "A first label that is wide enough to wrap onto two lines");
      const b = ev("2003", "b");
      const c = ev("2007", "c");
      const l = layoutTimeline(base([a, b, c, ev("2100", "z")]));
      expect(crossings(l)).toEqual([]);
      expect(labelOf(l, c.id).box.y0).toBeGreaterThanOrEqual(ruleY(l)); // below
      expect(l.fits).toBe(true);
    });

    it("keeps a later inner-row box off an earlier outer-row stem", () => {
      // b cannot share row 0 with a, so it takes row 1; c then fits row 0 after a, where its wide
      // box would cover b's stem. Row 2 is free and clear.
      const a = ev("2000", "a"), b = ev("2003-01-01", "b"), c = ev("2010-07-01", "A much longer title for c that wraps");
      const l = layoutTimeline(base([a, b, c, ev("2100", "z")], { lanes: [{ key: "", label: "L" }], maxRows: 3 }));
      expect(crossings(l)).toEqual([]);
      expect(l.fits).toBe(true);
    });

    it("falls back to the plain first-fit row when no in-cap row keeps the stem clear", () => {
      // The spans golden's law lane (labels above only): IRA's stem lies inside CTC's row-0 box, so
      // every outer row crosses it. IRA takes plain first-fit's row 1 (its stem passes under CTC's
      // label), and the layout still fits.
      const events = SPANS();
      const l = layoutTimeline(base(events, { width: 920, lanes: LANES }));
      expect(l.fits).toBe(true);
      expect(crossings(l)).toEqual([[events[2]!.id, events[1]!.id]]);
      // Without lanes the same pair falls back the same way: both are outer-sub-track spans, so both
      // label above only.
      const one = SPANS();
      const flat = layoutTimeline(base(one, { width: 920 }));
      expect(flat.fits).toBe(true);
      expect(crossings(flat)).toEqual([[one[2]!.id, one[1]!.id]]);
      // Two labels that each cover the other's stem: the same fallback, and still fits. (Titles
      // lengthened at Task 16b: at the measured Figtree widths "Policy begins" / "First cohort born"
      // no longer reach each other's stems.)
      const lane = [{ key: "p", label: "Policy" }];
      const pair = layoutTimeline(base([
        ev("2026", "Policy begins in earnest", { category: "p" }), ev("2030", "First cohort born under it", { category: "p" }), ev("2095", "z", { category: "p" }),
      ], { lanes: lane }));
      expect(pair.fits).toBe(true);
      expect(crossings(pair)).toHaveLength(1);
    });

    it("keeps the reference image horizontal with lanes at 900px", () => {
      const e = FIG7().map((x, i) => ({ ...x, category: i < 3 ? "policy" : "cohort" }));
      const l = layoutTimeline(base(e, { lanes: [{ key: "policy", label: "Policy" }, { key: "cohort", label: "Cohort" }] }));
      expect(l.fits).toBe(true);
    });

    it("holds across the existing fixtures", () => {
      const dense = Array.from({ length: 8 }, (_, i) => ev(`2026-0${i + 1}-01`, `Event number ${i}`));
      const cases: TimelineLayout[] = [
        layoutTimeline(base(FIG7())),
        layoutTimeline(base(FIG7(), { width: 600 })),
        layoutTimeline(base(FIG7(), { spacing: "even" })),
        layoutTimeline(base(dense, { width: 2000, maxRows: 4 })),
        layoutTimeline(base(dense, { width: 400, maxRows: 4 })),
        layoutTimeline(base([ev("2020", "a", { endStr: "2030" }), ev("2025", "b", { endStr: "2035" }), ev("2031", "c", { endStr: "2040" })])),
      ];
      cases.forEach((l, i) => expect([i, crossings(l)]).toEqual([i, []]));
    });

    it("never lets the preference turn a plain first-fit that fits into fits: false", () => {
      // The preference sent an early label to another row, and a later label's plain first-fit row
      // was then taken: fits false (a live switch to vertical) where plain §5.2 first-fit fits.
      const titles = ["Medium title", "A fairly wide title that wraps to two lines", "a", "A first label that is wide enough to wrap onto two lines"];
      const years = [2000, 2008, 2009, 2013, 2018, 2019, 2027, 2100];
      const inp = base(years.map((y, i) => ev(`${y}`, titles[i % titles.length]!)));
      expect(layoutTimeline(inp).fits).toBe(true);
      expect(plainFirstFitFits(inp)).toBe(true);
    });

    it("reports exactly plain first-fit's `fits` across a seeded batch of random layouts", () => {
      // mulberry32: a fixed seed, so the batch is the same on every run.
      let s = 0x9e3779b9;
      const rnd = (): number => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
      const words = ["policy", "begins", "cohort", "tax", "credit", "expires", "a", "the", "phase-in", "fully", "trust", "fund"];
      const mismatches: number[] = [];
      const seen = new Set<boolean>();
      for (let t = 0; t < 2000; t++) {
        const n = 3 + Math.floor(rnd() * 14);
        const lanesOn = rnd() < 0.3;
        const events = Array.from({ length: n }, (_, i) => {
          const y = 2000 + Math.floor(rnd() * 60);
          const title = Array.from({ length: 1 + Math.floor(rnd() * 8) }, () => pick(words)).join(" ");
          const endY = rnd() < 0.25 ? 2000 + Math.floor(rnd() * 60) : 0;
          return ev(`${y}`, title, { category: lanesOn ? (i % 2 ? "a" : "b") : "", ...(endY > y ? { endStr: `${endY}` } : {}) });
        });
        const inp = base(events, {
          maxRows: 1 + Math.floor(rnd() * 3),
          width: pick([600, 900, 1200]),
          lanes: lanesOn ? [{ key: "a", label: "A" }, { key: "b", label: "B" }] : null,
        });
        const fits = layoutTimeline(inp).fits;
        seen.add(fits);
        if (fits !== plainFirstFitFits(inp)) mismatches.push(t);
      }
      expect(mismatches).toEqual([]);
      expect([...seen].sort()).toEqual([false, true]); // the batch exercises both outcomes
    });

    it("lays out 300 monthly events in well under a second", () => {
      const many = Array.from({ length: 300 }, (_, i) =>
        ev(`${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`, `Event ${i}`));
      const t0 = performance.now();
      const l = layoutTimeline(base(many, { width: 900 }));
      expect(performance.now() - t0).toBeLessThan(500);
      expect(l.labels).toHaveLength(300);
    });
  });

  it("drops an event outside every lane from order and from every mark", () => {
    const stray = ev("2099", "not in any lane", { category: "other" });
    const e = [ev("2026", "p1", { category: "policy" }), stray, ev("2030", "c1", { category: "cohort" })];
    const l = layoutTimeline(base(e, { lanes: [{ key: "policy", label: "Policy" }, { key: "cohort", label: "Cohort" }] }));
    expect(l.order).toEqual([e[0]!.id, e[2]!.id]);
    for (const list of [l.labels, l.markers, l.spans, l.stems]) expect(list.some((x) => x.id === stray.id)).toBe(false);
    // The stray 2099 date must not stretch the scale: the latest drawn event sits at the right end.
    expect(l.markers.find((m) => m.id === e[2]!.id)!.cx).toBeGreaterThan(800);
  });

  it("trims unused space above the topmost label to a small pad", () => {
    // FIG7: the tallest box (2030, three lines) sits below the rule, so the uniform row pitch left a
    // band above the one-line boxes on top. The chart's top now sits TL_GEOM.topPad above them.
    const l = layoutTimeline(base(FIG7()));
    expect(Math.min(...l.labels.map((x) => x.box.y0))).toBe(TL_GEOM.topPad);
    const bottom = Math.max(...l.labels.map((x) => x.box.y1));
    expect(l.height).toBe(Math.ceil(bottom + TL_GEOM.rowGap));
    const lanes = layoutTimeline(base(FIG7().map((e, i) => ({ ...e, category: i < 3 ? "p" : "c" })), {
      lanes: [{ key: "p", label: "Policy" }, { key: "c", label: "Cohort" }],
    }));
    const tops = [...lanes.labels.map((x) => x.box.y0), ...lanes.laneLabels.map((x) => x.y - LANE_SIZE)];
    expect(Math.min(...tops)).toBe(TL_GEOM.topPad);
  });

  it("breaks a date range after the en dash before breaking inside a date", () => {
    const e = ev("2017-12-22", "TCJA", { endStr: "2025-12-31", dateText: "Dec 22, 2017 – Dec 31, 2025" });
    const l = layoutTimeline(base([e, ev("2030", "z")]));
    expect(labelOf(l, e.id).lines.filter((ln) => ln.role === "date").map((ln) => ln.text)).toEqual([
      "Dec 22, 2017 –", "Dec 31, 2025",
    ]);
    // A date with no dash still wraps between words, as before.
    const plain = ev("2017-12-22", "x", { dateText: "September 30, 2017 through the end" });
    const p = layoutTimeline(base([plain, ev("2030", "z")], { labelWidth: 80 }));
    const lines = labelOf(p, plain.id).lines.filter((ln) => ln.role === "date").map((ln) => ln.text);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe("September 30, 2017 through the end");
  });

  it("wraps an unspaced date_label override at the dash with no space inserted", () => {
    // Fix round 1: an authored override's own separator (none, here) must round-trip — wrapDate
    // must not assume the spaced form and glue in a space that was never authored.
    const e = ev("2017-12-22", "TCJA", { endStr: "2025-12-31", dateText: "Dec 22, 2017–Dec 31, 2025" });
    const l = layoutTimeline(base([e, ev("2030", "z")]));
    expect(labelOf(l, e.id).lines.filter((ln) => ln.role === "date").map((ln) => ln.text)).toEqual([
      "Dec 22, 2017–", "Dec 31, 2025",
    ]);
    const short = ev("2017", "y", { endStr: "2025", dateText: "2017–2025" });
    const s = layoutTimeline(base([short, ev("2030", "z")]));
    expect(labelOf(s, short.id).lines.filter((ln) => ln.role === "date").map((ln) => ln.text)).toEqual(["2017–2025"]);
  });

  it("never isolates the dash on its own line or leaves a stray space, across a label_width sweep", () => {
    // Fix round 1: wrapping the date body then appending " –" could emit a last line wider than
    // maxPx, which a downstream hardBreak then chopped at an arbitrary character — sometimes right
    // at the space before the dash. label_width 86-100 was the reported failing band.
    const RANGE = () => [
      ev("2017-12-22", "a", { endStr: "2025-12-31", dateText: "Dec 22, 2017 – Dec 31, 2025" }),
      ev("2034-01-01", "z", { dateText: "Jan 1, 2034" }),
    ];
    const OPEN = () => [ev("2040-06-01", "open", { ongoing: true, dateText: "2040 –" }), ev("2018", "a")];
    const atomic = (line: string): boolean => (line.endsWith(" –") ? line.slice(0, -2) : line).indexOf(" ") < 0;
    for (let labelWidth = 60; labelWidth <= 160; labelWidth++) {
      for (const events of [RANGE(), OPEN()]) {
        const l = layoutTimeline(base(events, { labelWidth }));
        for (const d of l.labels.flatMap((x) => x.lines.filter((ln) => ln.role === "date"))) {
          expect(d.text).not.toBe("–");
          expect(d.text).not.toBe(" –");
          expect(d.text.startsWith(" ")).toBe(false);
          expect(d.text.endsWith(" ")).toBe(false);
          // wrapDate measures its maxPx budget in the date line's own (bold) width.
          const w = timelineTextWidth(d.text, 13, 700);
          expect(w <= labelWidth + 1e-6 || atomic(d.text)).toBe(true);
        }
      }
    }
  });
  it("never strands the dash when a single date word is wider than the whole frame", () => {
    // Codex repro: a date unit wider than the frame fell through to plain hardBreak, which could
    // split "<word> –" at the space, leaving "–" alone on a line. hardBreakDate keeps it on its word.
    const X = (n: number) => "X".repeat(n);
    const texts = (n: number) => [`${X(n)} – ${X(n)}`, `${X(n)}–${X(n)}`, `${X(n)} –`];
    let split = 0;
    for (const [n, widths] of [[35, Array.from({ length: 36 }, (_, i) => 280 + 4 * i)], [118, [920]]] as const) {
      for (const width of widths) {
        for (const dateText of texts(n)) {
          const e = ev("2020", "t", { dateText, ...(dateText.endsWith("–") ? { ongoing: true } : { endStr: "2030" }) });
          const l = layoutTimeline(base([e, ev("2040", "z")], { width }));
          const d = labelOf(l, e.id).lines.filter((ln) => ln.role === "date").map((ln) => ln.text);
          if (d.length > 2) split++;
          expect(d.join("").replace(/\s/g, "")).toBe(dateText.replace(/\s/g, ""));
          for (const s of d) {
            expect(s).not.toBe("–");
            expect(s).not.toBe(" –");
            expect(s.startsWith(" ")).toBe(false);
            expect(s.endsWith(" ")).toBe(false);
          }
        }
      }
    }
    expect(split).toBeGreaterThan(0); // the words really were split
  });
});

describe("vertical layout", () => {
  const v = (events: LayoutEvent[], o: Partial<TimelineLayoutInput> = {}) =>
    layoutTimeline(base(events, { orientation: "vertical", width: 360, ...o }));
  const ruleX = (l: TimelineLayout): number => l.rules[0]!.x1;
  const leftmostBar = (l: TimelineLayout): number => Math.min(...l.spans.map((s) => s.x));
  const tickRight = (l: TimelineLayout) => Math.max(...l.ticks.map((t) => t.x + timelineTextWidth(t.text, TBL.size.axis, 500)));
  const spanOf = (l: TimelineLayout, id: number) => l.spans.find((s) => s.id === id)!;

  it("runs oldest at top, one rule, each label beside its item: bold date above the title, right of the rule", () => {
    // No two labels collide here, so none swaps left (E1; see the swap tests below).
    const l = v(SPREAD());
    const ys = l.order.map((id) => l.markers.find((m) => m.id === id)!.cy);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    expect(l.rules).toHaveLength(1);
    expect(l.labels).toHaveLength(4);
    for (const lab of l.labels) {
      // One block per event: its date line(s) first, then the title, all left-aligned at the box's
      // left edge, which sits right of the rule and clear of the marker.
      expect(lab.lines[0]!.role).toBe("date");
      expect(lab.lines.every((ln) => ln.anchor === "start" && ln.x === lab.box.x0)).toBe(true);
      expect(lab.box.x0).toBeGreaterThan(ruleX(l) + TL_GEOM.dotR);
      const dateYs = lab.lines.filter((ln) => ln.role === "date").map((ln) => ln.y);
      const titleYs = lab.lines.filter((ln) => ln.role === "title").map((ln) => ln.y);
      expect(Math.max(...dateYs)).toBeLessThan(Math.min(...titleYs));
      expect(lab.box.y1 - lab.box.y0).toBeCloseTo(lab.lines.reduce((s, ln) => s + ({ date: 16, title: 15, description: 14 })[ln.role], 0), 9);
    }
  });

  it("is at least 400px tall and grows with a dense cluster instead of overlapping", () => {
    expect(v(FIG7()).height).toBeGreaterThanOrEqual(400);
    // Thirty events in one January against a far 2030 event: proportionally they would all sit in
    // the top few px, so only the sweep keeps them apart. The last label wraps, so it hangs below
    // the end of the axis and the height must grow to hold it.
    const dense = Array.from({ length: 30 }, (_, i) => ev(`2026-01-${String(i + 1).padStart(2, "0")}`, `Event ${i} with a title that wraps onto a second line`));
    const l = v([...dense, ev("2030", "far, with a title long enough to wrap onto a second line")]);
    expect(l.height).toBeGreaterThan(400);
    // The cluster fills both sides (E1: a label pushed on the right tries the left), each side
    // stacking in date order with no two boxes overlapping.
    const rule = l.rules[0]!.x1;
    for (const left of [true, false]) {
      const boxes = l.labels.map((x) => x.box).filter((b) => (b.x1 < rule) === left);
      expect(boxes.length).toBeGreaterThan(5);
      for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.y0).toBeGreaterThanOrEqual(boxes[i - 1]!.y1);
    }
    for (let i = 0; i < l.labels.length; i++) {
      for (let j = i + 1; j < l.labels.length; j++) expect(overlaps(l.labels[i]!.box, l.labels[j]!.box)).toBe(false);
    }
    for (const b of l.labels.map((x) => x.box)) expect(b.y1).toBeLessThanOrEqual(l.height);
  });

  it("draws an elbow leader only for a displaced label", () => {
    // a takes the right at its date and a's neighbour the left (E1), so b, free on neither side, is
    // pushed down below a with a leader.
    const b = ev("2026-01-03", "b, pushed down by a");
    const l = v([ev("2026", "a"), ev("2026-01-02", "a2"), b, ev("2090", "far")]);
    expect(l.stems.map((s) => s.id)).toEqual([b.id]);
    const pts = l.stems[0]!.points;
    expect(pts).toHaveLength(3);
    const m = l.markers.find((mk) => mk.id === b.id)!;
    const date = labelOf(l, b.id).lines.find((ln) => ln.role === "date")!;
    // Leaves beside the marker, drops parallel to the rule, turns into the label's first line.
    expect(pts[0]![1]).toBeCloseTo(m.cy, 6);
    expect(pts[0]![0]).toBeGreaterThan(m.cx + TL_GEOM.dotR);
    expect(pts[1]![0]).toBe(pts[0]![0]);
    expect(pts[1]![1]).toBe(pts[2]![1]);
    expect(pts[2]![1]).toBeGreaterThan(pts[0]![1]);
    expect(pts[2]![1]).toBeLessThan(date.y);
    expect(pts[2]![0]).toBeGreaterThan(pts[1]![0]);
    expect(pts[2]![0]).toBeLessThan(labelOf(l, b.id).box.x0);
  });

  it("fades an ongoing span downward to the bottom, at least a fade long", () => {
    const l = v([ev("2020", "a"), ev("2022", "b", { ongoing: true })]);
    expect(l.spans[0]!.fade).toBe("down");
    expect(l.spans[0]!.y + l.spans[0]!.h).toBeCloseTo(l.height - TL_GEOM.vPad, 6);
    // b starts on the last date: the bar still needs room to fade.
    expect(l.spans[0]!.h).toBeGreaterThanOrEqual(TL_GEOM.fade);
  });

  it("labels an outer-sub-track span on the left, right-aligned, ending just left of the band", () => {
    const a = ev("2020", "a", { endStr: "2030" });
    const c = ev("2025", "c, on the outer sub-track", { endStr: "2035" });
    const p = ev("2027", "a point on the rule");
    const b = ev("2040", "b");
    const l = v([a, c, p, b]);
    expect(spanOf(l, c.id).x).toBeLessThan(spanOf(l, a.id).x); // c is on sub-track 1, left of the rule
    const lab = labelOf(l, c.id);
    expect(lab.lines[0]!.role).toBe("date");
    expect(lab.lines.every((ln) => ln.anchor === "end" && ln.x === lab.box.x1)).toBe(true);
    // The box ends a small gap short of the band's leftmost bar, never on it.
    const gap = leftmostBar(l) - lab.box.x1;
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThanOrEqual(TL_GEOM.vLabelGap + 1e-9);
    expect(lab.box.x0).toBeGreaterThanOrEqual(0);
    // Sub-track-0 spans and points label on the right.
    for (const id of [a.id, p.id, b.id]) expect(labelOf(l, id).box.x0).toBeGreaterThan(ruleX(l) + TL_GEOM.dotR);
    // The band widens the layout by the left column: without c the rule sits at the left edge.
    expect(ruleX(v([a, p, b]))).toBeLessThan(ruleX(l));
  });

  it("pins a layout with a left label column relative to its track (Ruling 29: no inset beside a left column)", () => {
    // The Task 13b inset applies only with no left column at all. First captured at 46a6c7a (the
    // parent of that change) to prove it left this layout alone; re-captured at Task 16b, whose
    // measured Figtree widths (Ruling 45) move every coordinate, so it is now a regression pin.
    const a = ev("2020", "a", { id: 0, endStr: "2030" });
    const c = ev("2025", "c, on the outer sub-track", { id: 1, endStr: "2035" });
    const p = ev("2027", "a point on the rule", { id: 2 });
    const b = ev("2040", "b", { id: 3 });
    const l = v([a, c, p, b]);
    expectPinnedUpToCentring(l,
      '{"orientation":"vertical","width":360,"height":423,"fits":true,"order":[0,1,2,3],"rules":[{"x1":202.51,"y1":8,"x2":202.51,"y2":415}],"markers":[{"id":2,"category":"","cx":202.51,"cy":142.41314168377826,"projected":false},{"id":3,"category":"","cx":202.51,"cy":392,"projected":false}],"spans":[{"id":0,"category":"","x":198.51,"y":8,"w":8,"h":192.02628336755646,"projected":false,"fade":null},{"id":1,"category":"","x":188.51,"y":104.0394250513347,"w":8,"h":191.97371663244348,"projected":false,"fade":null}],"labels":[{"id":0,"category":"","box":{"x0":217.01,"y0":0,"x1":248.91199999999998,"y1":31},"lines":[{"role":"date","text":"2020","x":217.01,"y":13,"anchor":"start"},{"role":"title","text":"a","x":217.01,"y":28,"anchor":"start"}]},{"id":1,"category":"","box":{"x0":44.94999999999999,"y0":96.0394250513347,"x1":178.51,"y1":127.0394250513347},"lines":[{"role":"date","text":"2025","x":178.51,"y":109.0394250513347,"anchor":"end"},{"role":"title","text":"c, on the outer sub-track","x":178.51,"y":124.0394250513347,"anchor":"end"}]},{"id":2,"category":"","box":{"x0":217.01,"y0":134.41314168377826,"x1":315.05,"y1":165.41314168377826},"lines":[{"role":"date","text":"2027","x":217.01,"y":147.41314168377826,"anchor":"start"},{"role":"title","text":"a point on the rule","x":217.01,"y":162.41314168377826,"anchor":"start"}]},{"id":3,"category":"","box":{"x0":217.01,"y0":384,"x1":249.61399999999998,"y1":415},"lines":[{"role":"date","text":"2040","x":217.01,"y":397,"anchor":"start"},{"role":"title","text":"b","x":217.01,"y":412,"anchor":"start"}]}],"stems":[],"ticks":[],"laneLabels":[]}',
    );
  });

  it("wraps the right column as if the rule were inset for balance, then centres the block (Rulings 29, 43)", () => {
    // Wraps at every width tried, so its widest line fills the right column to within a word. That
    // column is what the rule inset to 15% of the width leaves; the block it makes is centred.
    const long = Array.from({ length: 40 }, () => "word").join(" ");
    const colR = (width: number) => width - width * TL_GEOM.vTrackInsetShare - TL_GEOM.dotR - TL_GEOM.vLabelGap;
    for (const width of [280, 375, 440]) {
      const plain = v([...SPREAD(), ev("2130", long)], { width });
      const x0 = ruleX(plain) + TL_GEOM.dotR + TL_GEOM.vLabelGap;
      const widest = Math.max(...plain.labels.map((x) => x.box.x1));
      expect(widest - x0).toBeLessThanOrEqual(colR(width) + 1e-9);
      expect(widest - x0).toBeGreaterThan(colR(width) - 40);
      const [lo, hi] = inkOf(plain);
      expect((lo + hi) / 2).toBeCloseTo(width / 2, 9);
      // Spans on the main rule only (sub-track 0) do not open a left column either.
      const s0 = v([ev("2020", "a", { endStr: "2025" }), ev("2026", "b", { endStr: "2030" }), ev("2040", "c")], { width });
      expect(s0.labels.every((x) => x.box.x0 > ruleX(s0))).toBe(true);
      // With the tick column drawn, it sits left of the rule, the block's left edge.
      const axis = v(SPREAD(), { width, axis: true });
      expect(axis.ticks.length).toBeGreaterThanOrEqual(2);
      expect(ruleX(axis)).toBeGreaterThan(tickRight(axis));
      expect(axis.ticks[0]!.x).toBeCloseTo(inkOf(axis)[0], 9);
    }
  });

  it("sweeps each side on its own: left labels never push right ones, nor the reverse", () => {
    // a (sub-track 0, right) and c (sub-track 1, left) start two days apart: in one column c would be
    // pushed below a's label. Beside each other, neither moves.
    const a = ev("2020-01-01", "a", { endStr: "2030" });
    const c = ev("2020-01-03", "c", { endStr: "2035" });
    const far = ev("2090", "far");
    const l = v([a, c, far]);
    expect(l.stems).toEqual([]);
    const la = labelOf(l, a.id).box, lc = labelOf(l, c.id).box;
    expect(lc.y0 < la.y1 && la.y0 < lc.y1).toBe(true); // side by side, overlapping in y
    // Each label's date line is centred on its own item.
    expect(lc.y0 + 8).toBeCloseTo(spanOf(l, c.id).y, 6);
    // A right-side neighbour pushed by a leaves c where it was, and vice versa.
    const p = ev("2020-01-05", "p, pushed down by a");
    const c2 = ev("2020-01-04", "c2, pushed down by c", { endStr: "2020-02-01" });
    const both = v([a, c, p, c2, far]);
    expect(both.stems.map((s) => s.id).sort()).toEqual([p.id, c2.id].sort());
    expect(labelOf(both, a.id).box.y0 + 8).toBeCloseTo(spanOf(both, a.id).y, 6);
    expect(labelOf(both, c.id).box.y0 + 8).toBeCloseTo(spanOf(both, c.id).y, 6);
    expect(labelOf(both, p.id).box.y0).toBeGreaterThanOrEqual(labelOf(both, a.id).box.y1);
    expect(labelOf(both, c2.id).box.y0).toBeGreaterThanOrEqual(labelOf(both, c.id).box.y1);
  });

  it("reserves a tick column left of every mark and label, sized to the widest tick, with axis:true", () => {
    expect(v(FIG7()).ticks).toEqual([]);
    // Month-scale ticks ("October") are wider than a year's: a fixed-width column would collide.
    const months = Array.from({ length: 12 }, (_, i) =>
      ev(`2026-${String(i + 1).padStart(2, "0")}-01`, `m${i}`, { dateText: `Mon ${i + 1}, 2026` }));
    for (const l of [v(FIG7(), { axis: true }), v(months, { axis: true })]) {
      expect(l.ticks.length).toBeGreaterThanOrEqual(2);
      expect(l.ticks.every((t) => t.anchor === "start" && t.x >= 0)).toBe(true);
      expect(Math.min(...l.labels.map((x) => x.box.x0))).toBeGreaterThan(tickRight(l));
      expect(ruleX(l) - TL_GEOM.dotR).toBeGreaterThan(tickRight(l));
    }
    // With a left column the ticks stay leftmost, outside the left labels.
    const a = ev("2020", "a", { endStr: "2030" });
    const c = ev("2025", "c", { endStr: "2035" });
    const l = v([a, c, ev("2040", "b")], { width: 600, axis: true });
    expect(l.ticks.length).toBeGreaterThanOrEqual(2);
    expect(labelOf(l, c.id).box.x0).toBeGreaterThan(tickRight(l));
  });

  it("always fits and has no NaN for a single event", () => {
    const l = v([ev("2026", "Only")]);
    expect(l.fits).toBe(true);
    expect(allFinite(l)).toBe(true);
    expect(l.height).toBeGreaterThanOrEqual(400);
  });

  it("is deterministic regardless of input order and ignores lanes", () => {
    const e = [
      ev("2020", "a", { endStr: "2030" }), ev("2025", "c", { endStr: "2035" }), ev("2030", "tie one"),
      ev("2030", "tie two"), ev("2031", "open", { ongoing: true }), ev("2040", "b"),
    ];
    const fwd = v(e, { axis: true });
    const rev = v([...e].reverse(), { axis: true });
    expect(JSON.stringify(rev)).toBe(JSON.stringify(fwd));
    expect(fwd.order).toEqual(e.map((x) => x.id));
    const laned = v(e, { axis: true, lanes: [{ key: "x", label: "X" }] });
    expect(JSON.stringify(laned)).toBe(JSON.stringify(fwd));
  });

  // A range too wide for its column. At 360 the right column holds the whole range on one line,
  // so the event sits on sub-track 1 (behind `outer`), where the left column is capped at 40%.
  const outer = () => ev("2017-01-01", "outer", { endStr: "2030" });

  it("breaks a date range after the en dash before breaking inside a date", () => {
    const e = ev("2017-12-22", "TCJA", { endStr: "2025-12-31", dateText: "Dec 22, 2017 – Dec 31, 2025" });
    const l = v([outer(), e, ev("2034", "z", { dateText: "Jan 1, 2034" })]);
    expect(labelOf(l, e.id).lines[0]!.anchor).toBe("end"); // on the left
    expect(labelOf(l, e.id).lines.filter((ln) => ln.role === "date").map((ln) => ln.text)).toEqual([
      "Dec 22, 2017 –", "Dec 31, 2025",
    ]);
  });

  it("wraps an unspaced date_label override at the dash with no space inserted", () => {
    const e = ev("2017-12-22", "TCJA", { endStr: "2025-12-31", dateText: "Dec 22, 2017–Dec 31, 2025" });
    const l = v([outer(), e, ev("2034", "z", { dateText: "Jan 1, 2034" })]);
    expect(labelOf(l, e.id).lines.filter((ln) => ln.role === "date").map((ln) => ln.text)).toEqual([
      "Dec 22, 2017–", "Dec 31, 2025",
    ]);
  });

  it("joins a displaced left label from its own bar's left edge, on the left of the band", () => {
    // a holds sub-track 0 and b sub-track 1 for a day, so d (after b ends) takes sub-track 1 again,
    // while c holds sub-track 2 outside it. d's label is pushed down by b's and c's.
    const a = ev("2020-01-01", "a", { endStr: "2040" });
    const b = ev("2020-01-01", "b", { endStr: "2020-01-02" });
    const c = ev("2020-01-01", "c", { endStr: "2040" });
    const d = ev("2020-01-03", "d, pushed down by b and c", { endStr: "2035" });
    const l = v([a, b, c, d, ev("2090", "far")]);
    const sd = spanOf(l, d.id), sc = spanOf(l, c.id);
    expect(sc.x).toBeLessThan(sd.x); // c is outside d
    const lab = labelOf(l, d.id);
    expect(lab.box.x1).toBeLessThan(leftmostBar(l));
    const pts = l.stems.find((s) => s.id === d.id)!.points;
    expect(pts).toHaveLength(4);
    // Out of d's own bar's left edge at its start, across c's bar to a leg just left of the band,
    // down parallel to the rule, then into the label's first line from its right.
    expect(pts[0]).toEqual([sd.x, sd.y]);
    expect(pts[1]![1]).toBe(sd.y);
    expect(pts[1]![0]).toBeLessThan(leftmostBar(l));
    expect(pts[1]![0]).toBeGreaterThan(lab.box.x1);
    expect(pts[2]![0]).toBe(pts[1]![0]);
    expect(pts[2]![1]).toBeGreaterThan(pts[1]![1]);
    expect(pts[2]![1]).toBeLessThan(lab.lines[0]!.y);
    expect(pts[3]![1]).toBe(pts[2]![1]);
    expect(pts[3]![0]).toBeLessThan(pts[2]![0]);
    expect(pts[3]![0]).toBeGreaterThan(lab.box.x1);
    // A displaced right-side item (a point, or a sub-track-0 span) keeps the leader that starts
    // beside the rule.
    const p = ev("2020-01-01", "p");
    const s0 = ev("2020-01-01", "s0", { endStr: "2021" });
    const s1 = ev("2021-01-01", "s1, pushed down by s0", { endStr: "2022" });
    const l0 = v([p, s0, s1, ev("2090", "far")]);
    expect(l0.stems.length).toBeGreaterThan(0);
    for (const s of l0.stems) expect(s.points[0]![0]).toBe(ruleX(l0) + TL_GEOM.dotR + 2);
  });
});

describe("vertical single track: a colliding label swaps left before any connector (E1)", () => {
  const v = (events: LayoutEvent[], o: Partial<TimelineLayoutInput> = {}) =>
    layoutTimeline(base(events, { orientation: "vertical", width: 360, ...o }));
  const ruleX = (l: TimelineLayout): number => l.rules[0]!.x1;
  const onLeft = (l: TimelineLayout, id: number): boolean => labelOf(l, id).box.x1 < ruleX(l);
  const itemY = (l: TimelineLayout, id: number): number => l.markers.find((m) => m.id === id)?.cy ?? l.spans.find((s) => s.id === id)!.y;
  // A label at its own date: its first (date) line is centred on its item.
  const atOwnDate = (l: TimelineLayout, id: number) =>
    expect(labelOf(l, id).box.y0 + LINE_STYLE.date.lineH / 2).toBeCloseTo(itemY(l, id), 6);
  const rightAligned = (l: TimelineLayout, id: number) => {
    const lab = labelOf(l, id);
    expect(lab.lines[0]!.role).toBe("date"); // date above the title
    expect(lab.lines.every((ln) => ln.anchor === "end" && ln.x === lab.box.x1)).toBe(true);
  };
  const bold = (s: string) => timelineTextWidth(s, LINE_STYLE.date.size, 700);
  const extent = (ln: { x: number; text: string; role: "date" | "title" | "description"; anchor: string }): [number, number] => {
    const w = timelineTextWidth(ln.text, LINE_STYLE[ln.role].size, ln.role === "date" ? 700 : 500);
    return ln.anchor === "end" ? [ln.x - w, ln.x] : [ln.x, ln.x + w];
  };

  it("puts the second of two close events LEFT of the track at its own date, right-aligned, with no connector", () => {
    const a = ev("2026", "a");
    const b = ev("2026-01-02", "b, which would collide on the right");
    const far = ev("2090", "far");
    const l = v([a, b, far]);
    expect(l.stems).toEqual([]);
    expect([a, b, far].map((e) => onLeft(l, e.id))).toEqual([false, true, false]);
    for (const e of [a, b, far]) atOwnDate(l, e.id);
    rightAligned(l, b.id);
    // The box ends a label gap short of the marker (the band, with no spans), inside the frame.
    const box = labelOf(l, b.id).box;
    expect(ruleX(l) - TL_GEOM.dotR - box.x1).toBeCloseTo(TL_GEOM.vLabelGap, 9);
    expect(box.x0).toBeGreaterThanOrEqual(0);
    // With a left column, the Ruling 29 inset no longer applies: the rule sits right after it.
    expect(ruleX(l)).toBeCloseTo(box.x1 + TL_GEOM.vLabelGap + TL_GEOM.dotR, 9);
  });

  it("three close events: right, left, then a connector for the third on the side it is pushed less", () => {
    const a = ev("2026", "a");
    const b = ev("2026-01-02", "b");
    const c = ev("2026-01-03", "c");
    const far = ev("2090", "far");
    const l = v([a, b, c, far]);
    expect([a, b, c].map((e) => onLeft(l, e.id))).toEqual([false, true, false]);
    atOwnDate(l, a.id);
    atOwnDate(l, b.id);
    // a and b are the same height and b sits a day lower, so c is pushed less on the right, below a,
    // and its leader leaves beside the marker on the right.
    expect(l.stems.map((s) => s.id)).toEqual([c.id]);
    expect(labelOf(l, c.id).box.y0).toBeCloseTo(labelOf(l, a.id).box.y1 + TL_GEOM.vLabelGap, 9);
    const pts = l.stems[0]!.points;
    expect(pts[0]).toEqual([ruleX(l) + TL_GEOM.dotR + 2, itemY(l, c.id)]);
    expect(pts.at(-1)![0]).toBeLessThan(labelOf(l, c.id).box.x0);
    // When a's label is the taller one, c is pushed less on the left: it goes there, below b, with
    // an elbow leader from the left of the rule into its first line's right end.
    const aTall = ev("2026", "a, whose title is long enough to wrap onto several lines in the right-hand column");
    const b2 = ev("2026-01-02", "b");
    const c2 = ev("2026-01-03", "c");
    const t = v([aTall, b2, c2, ev("2090", "far")]);
    expect([aTall, b2, c2].map((e) => onLeft(t, e.id))).toEqual([false, true, true]);
    expect(t.stems.map((s) => s.id)).toEqual([c2.id]);
    rightAligned(t, c2.id);
    const lab = labelOf(t, c2.id);
    expect(lab.box.y0).toBeCloseTo(labelOf(t, b2.id).box.y1 + TL_GEOM.vLabelGap, 9);
    const lp = t.stems[0]!.points;
    // No spans: it leaves 2px off the marker, which is also the leg, so the elbow has three points.
    expect(lp).toHaveLength(3);
    const leg = ruleX(t) - TL_GEOM.dotR - 2;
    expect(lp[0]).toEqual([leg, itemY(t, c2.id)]);
    expect(lp[1]).toEqual([leg, lab.box.y0 + LINE_STYLE.date.lineH / 2]);
    expect(lp[2]![1]).toBe(lp[1]![1]);
    expect(lp[2]![0]).toBeGreaterThan(lab.box.x1);
    expect(lp[2]![0]).toBeLessThan(leg);
  });

  it("leaves a layout with no collision exactly attempt A's (the no-swap layout)", () => {
    // Spread-out points with the axis drawn: no label is displaced, so layoutVertical returns
    // attempt A unchanged — no left column, the Ruling 29 inset in force.
    const events = [
      ev("2026", "Policy begins", { id: 0 }), ev("2050", "First cohort born under fully phased-in policy", { id: 1 }),
      ev("2075", "Annual projection ends", { id: 2 }), ev("2100", "That cohort turns 65", { id: 3 }),
    ];
    const inp = base(events, { orientation: "vertical", width: 375, axis: true });
    const l = layoutTimeline(inp);
    expect(l.stems).toEqual([]);
    expect(l.labels.some((x) => onLeft(l, x.id))).toBe(false);
    expect(JSON.stringify(l)).toBe(JSON.stringify(verticalNoSwapLayout(inp)));
  });

  it("keeps a label right, with a connector, when its date word would not fit the left column (attempt A exactly)", () => {
    // b collides with a, but its date is one word wider than 40% of the width: swapping would split
    // it, so it stays right and is pushed down with a leader, and with nothing swapped the layout is
    // attempt A's (the no-swap layout) exactly.
    const word = "X".repeat(24);
    expect(bold(word)).toBeGreaterThan(0.4 * 360);
    const events = [ev("2026", "a", { id: 0 }), ev("2026-01-02", "b", { id: 1, dateText: word }), ev("2090", "far", { id: 2 })];
    const inp = base(events, { orientation: "vertical", width: 360 });
    const l = layoutTimeline(inp);
    expect(l.stems.map((s) => s.id)).toEqual([1]);
    expect(onLeft(l, 1)).toBe(false);
    expect(JSON.stringify(l)).toBe(JSON.stringify(verticalNoSwapLayout(inp)));
  });

  it("sizes the left column to min(40% of the width, the widest need of the labels a no-swap layout displaced)", () => {
    // b's own need (its title, unwrapped) is under 40%: the column is exactly that wide.
    const a = ev("2026", "a, whose title is long enough to wrap onto two lines in a right column");
    const b = ev("2026-01-02", "b short");
    const l = v([a, b, ev("2090", "far")]);
    const need = Math.max(bold("2026"), timelineTextWidth("b short", LINE_STYLE.title.size, 500));
    expect(need).toBeLessThan(0.4 * 360);
    expect(labelOf(l, b.id).box.x1 - labelOf(l, b.id).box.x0).toBeCloseTo(need, 9);
    // a is not a candidate (a no-swap layout leaves it at its date), so its long title does not widen
    // the column; the right column gets the rest.
    expect(labelOf(l, a.id).box.x0 - labelOf(l, b.id).box.x1).toBeCloseTo(TL_GEOM.vLabelGap + 2 * TL_GEOM.dotR + TL_GEOM.vLabelGap, 9);
    // A candidate whose title is wider than 40% caps the column there, and wraps in it.
    const b2 = ev("2026-01-02", "b, whose title is far too long for forty percent of this width");
    const c = v([ev("2026", "a"), b2, ev("2090", "far")]);
    expect(onLeft(c, b2.id)).toBe(true);
    const b2Box = labelOf(c, b2.id).box;
    expect(b2Box.x1 - b2Box.x0).toBeLessThanOrEqual(0.4 * 360 + 1e-9);
    expect(b2Box.x1 - b2Box.x0).toBeGreaterThan(0.4 * 360 - 40);
    expect(labelOf(c, b2.id).lines.filter((ln) => ln.role === "title").length).toBeGreaterThan(1);
    expect(ruleX(c) - b2Box.x1).toBeCloseTo(TL_GEOM.vLabelGap + TL_GEOM.dotR, 9);
  });

  it("ends a swapped label a label gap short of an outer-sub-track band", () => {
    // s0 holds sub-track 0 and s1 sub-track 1. q sits on s0's start date, so on the right it would be
    // pushed below s0's label: it swaps left instead, where nothing is yet.
    const s0 = ev("2010", "s0", { endStr: "2030" });
    const q = ev("2010-01-02", "q");
    const s1 = ev("2025", "s1", { endStr: "2035" });
    const l = v([s0, q, s1, ev("2090", "far")]);
    expect(onLeft(l, q.id)).toBe(true);
    atOwnDate(l, q.id);
    rightAligned(l, q.id);
    const leftmostBar = Math.min(...l.spans.map((s) => s.x));
    expect(leftmostBar - labelOf(l, q.id).box.x1).toBeCloseTo(TL_GEOM.vLabelGap, 9);
    expect(l.stems).toEqual([]);
  });

  it("never moves an outer-sub-track span's label to make room for a swap (Ruling 34)", () => {
    // From the review probe (width 412, axis on): a point, then two spans a month apart. s0 (sub-track
    // 0) is pushed on the right by the point's label; the left at its date is where s1's (sub-track
    // 1) label sits. A shared left sweep put s0 there and pushed s1 off its date with a leader; s1's
    // label is fixed instead, so s0 stays right with the leader.
    const p = ev("2000-12-01", "Tax Cuts and Jobs Act individual provisions", { id: 0, dateText: "2026" });
    const s1 = ev("2001-02-01", "a", { id: 1, endStr: "2003-01-01", dateText: "Mar 2031 – 2035", description: "Short note" });
    const s0 = ev("2001-01-01", "Policy begins", { id: 2, endStr: "2009-01-01", dateText: "FY2030 – 2035", description: "Short note" });
    const l = v([p, s1, s0], { width: 412, axis: true });
    expect(onLeft(l, s1.id)).toBe(true);
    atOwnDate(l, s1.id);
    expect(l.stems.map((s) => s.id)).toEqual([s0.id]);
    expect(onLeft(l, s0.id)).toBe(false);
    // A point at r's date is pushed on the right; the left at its date is clear of s1b's label only
    // by less than a label gap, so it stays right too, and s1b keeps its date.
    const s = ev("2010", "s", { endStr: "2030" });
    const r = ev("2024-12-30", "r");
    const pt = ev("2025-01-01", "pt");
    const s1b = ev("2025-01-03", "s1b", { endStr: "2035" });
    const m = v([s, r, pt, s1b, ev("2090", "far")]);
    expect(onLeft(m, pt.id)).toBe(false);
    expect(onLeft(m, s1b.id)).toBe(true);
    atOwnDate(m, s1b.id);
    expect(m.stems.map((x) => x.id)).toEqual([pt.id]);
  });

  it("does not swap a label left where an outer bar is active at its date (Ruling 35)", () => {
    // s1 (sub-track 1) runs 2021-2039. b collides with a on the right at 2030, and the left at its
    // date is empty — but s1's bar runs there, so b beside it would read as s1's label and a leader
    // from b would cross it: b stays right, pushed, with its leader on the right.
    const s0 = ev("2020", "s0", { endStr: "2040" });
    const s1 = ev("2021", "s1", { endStr: "2039" });
    const a = ev("2030", "a");
    const b = ev("2030-01-02", "b");
    const l = v([s0, s1, a, b, ev("2090", "far")]);
    expect(onLeft(l, b.id)).toBe(false);
    expect(l.stems.map((s) => s.id)).toEqual([b.id]);
    expect(l.stems[0]!.points[0]![0]).toBeGreaterThan(ruleX(l));
    // Once s1 has ended above where b's block would start, the same pair swaps (ending in 2029, a few
    // pixels above b's date, it is still beside b's date line: see the M3 test below).
    const late = v([s0, ev("2021", "s1", { endStr: "2028" }), ev("2030", "a"), ev("2030-01-02", "b2", { id: 999 }), ev("2090", "far")]);
    expect(onLeft(late, 999)).toBe(true);
    expect(late.stems).toEqual([]);
    // The spans golden's data: the 2026 phase-in (sub-track 0) is pushed on both sides, and the
    // ongoing IRA bar (sub-track 1) runs at its date, so it stays right with a right-hand leader.
    const spans = [
      ev("2017-12-22", "TCJA individual provisions", { endStr: "2025-12-31", dateText: "Dec 22, 2017 – Dec 31, 2025" }),
      ev("2021-03-11", "Expanded child tax credit", { endStr: "2021-12-31", dateText: "Mar 11, 2021 – Dec 31, 2021" }),
      ev("2022-08-16", "IRA clean-energy credits", { ongoing: true, dateText: "Aug 16, 2022 –" }),
      ev("2025-07-04", "OBBBA enacted", { dateText: "Jul 4, 2025" }),
      ev("2026-01-01", "Phase-in period", { endStr: "2030-12-31", dateText: "Jan 1, 2026 – Dec 31, 2030" }),
      ev("2034-01-01", "Trust fund depletion", { dateText: "Jan 1, 2034" }),
    ];
    for (const width of [360, 375]) {
      const g = v(spans, { width });
      const phase = spans[4]!.id;
      expect(onLeft(g, phase)).toBe(false);
      expect(g.stems.find((s) => s.id === phase)!.points[0]![0]).toBeGreaterThan(ruleX(g));
    }
  });

  it("does not swap a label left where it would land beside an outer bar, though none runs at its date (Ruling 35)", () => {
    // b is pushed far down on the right by a's tall label. No outer bar runs at b's date, but s1's
    // label sits on the left there, so b would land below it — beside s1's bar while it still
    // runs. It stays right, with a leader; once s1 ends above that landing, b swaps left.
    const tall = "a, whose title is long enough to wrap onto several lines in the right-hand column of this chart";
    const mk = (s1End: string) => [
      ev("1990", "s0", { id: 0, endStr: "2060" }), ev("2010", tall, { id: 1 }), ev("2010-01-02", "b", { id: 2 }),
      ev("2010-01-05", "s1", { id: 3, endStr: s1End }), ev("2100", "far", { id: 4 }),
    ];
    const long = v(mk("2060"));
    const s1 = long.spans.find((s) => s.id === 3)!;
    expect(s1.x + s1.w).toBeLessThan(ruleX(long) - TL_GEOM.dotR); // s1 is on an outer sub-track
    expect(s1.y).toBeGreaterThan(itemY(long, 2)); // not running at b's date
    expect(onLeft(long, 2)).toBe(false);
    expect(long.stems.map((s) => s.id)).toEqual([2]);
    const short = v(mk("2011"));
    expect(onLeft(short, 2)).toBe(true);
    const lab = labelOf(short, 2).box;
    // It lands below s1's label, off its own date, past the end of s1's bar.
    expect(lab.y0).toBeCloseTo(labelOf(short, 3).box.y1 + TL_GEOM.vLabelGap, 9);
    const s1s = short.spans.find((s) => s.id === 3)!;
    expect(lab.y0 + LINE_STYLE.date.lineH / 2).toBeGreaterThan(s1s.y + s1s.h);
    expect(short.stems.map((s) => s.id)).toEqual([2]);
  });

  it("does not swap a label left beside an outer bar anywhere over the label's height, not just at its first line (Ruling 35, M3)", () => {
    // s1 (sub-track 1) ends a few pixels above b's date: not running at b's date, but beside the top
    // of b's date line were b on the left. b stays right, with its leader; once s1 ends above where
    // b's block would start, b swaps.
    const half = LINE_STYLE.date.lineH / 2;
    const mk = (s1End: string) => v([
      ev("2020", "s0", { id: 0, endStr: "2040" }), ev("2021", "s1", { id: 1, endStr: s1End }),
      ev("2030", "a", { id: 2 }), ev("2030-01-02", "b", { id: 3 }), ev("2090", "far", { id: 4 }),
    ]);
    const near = mk("2029-07-01");
    const s1 = near.spans.find((s) => s.id === 1)!;
    expect(s1.x + s1.w).toBeLessThan(ruleX(near) - TL_GEOM.dotR); // an outer sub-track
    const end = s1.y + s1.h;
    expect(end).toBeLessThan(itemY(near, 3)); // not running at b's date...
    expect(end).toBeGreaterThan(itemY(near, 3) - half); // ...but beside where b's block would start
    expect(onLeft(near, 3)).toBe(false);
    expect(near.stems.map((s) => s.id)).toEqual([3]);
    const clear = mk("2028-01-01");
    const s1c = clear.spans.find((s) => s.id === 1)!;
    expect(s1c.y + s1c.h).toBeLessThan(itemY(clear, 3) - half);
    expect(onLeft(clear, 3)).toBe(true);
    expect(clear.stems).toEqual([]);
  });

  it("does not let a label that can never swap widen the left column (Ruling 36)", () => {
    // b swaps; x is displaced too but its date is one word wider than 40% of the width, so it can
    // never go left. The column is sized to b alone, and the ticks keep their room.
    const word = "X".repeat(24);
    expect(bold(word)).toBeGreaterThan(0.4 * 360);
    const a = ev("2026", "a");
    const b = ev("2026-01-02", "b");
    const x = ev("2026-01-03", "x", { dateText: word });
    const l = v([a, b, x, ev("2090", "far")], { axis: true });
    expect(onLeft(l, b.id)).toBe(true);
    expect(onLeft(l, x.id)).toBe(false);
    expect(l.ticks.length).toBeGreaterThanOrEqual(2);
    const tickW = Math.max(...l.ticks.map((t) => timelineTextWidth(t.text, TBL.size.axis, 500))) + 8;
    expect(labelOf(l, b.id).box.x1 - l.ticks[0]!.x).toBeCloseTo(tickW + Math.max(bold("2026"), timelineTextWidth("b", LINE_STYLE.title.size, 500)), 9);
  });

  it("never starts a span's leader inside an outer bar, however compressed the band (single track and lane columns)", () => {
    // Five outer spans run through g's start. g reuses sub-track 0 after a ends and is pushed by the
    // point p's label, so its leader crosses the outer bars; on a narrow chart they compress to 3-5px
    // bars with 1px gaps (a wide date word leaves the band little room), where a start at the
    // marker's radius would land inside the first of them.
    const make = (lane?: string) => {
      const cat = lane ?? "";
      const d = (y: number) => `Late-September ${y}`;
      return [
        ev("1980", "a", { endStr: "1990", category: cat, dateText: d(1980) }),
        ...Array.from({ length: 5 }, (_, i) => ev(`198${5 + i}-01-01`, `outer ${i}`, { endStr: "2030", category: cat, dateText: d(1985 + i) })),
        ev("1989-12-25", "p, a point just before g", { category: cat, dateText: d(1989) }),
        ev("1990", "g, pushed by p", { endStr: "2000", category: cat, dateText: d(1990) }),
      ];
    };
    const inside = (l: TimelineLayout, id: number): boolean => {
      const [x, y] = l.stems.find((s) => s.id === id)!.points[0]!;
      return l.spans.some((s) => s.id !== id && x > s.x + 1e-9 && x < s.x + s.w - 1e-9 && y >= s.y && y <= s.y + s.h);
    };
    let compressed = 0;
    for (let width = 280; width <= 380; width += 4) {
      const lanes = [{ key: "L", label: "Lane" }, { key: "R", label: "Other" }];
      const evs = make("L");
      const g = evs.at(-1)!;
      const lc = layoutTimeline(base([...evs, ev("2010", "r", { category: "R" })], { orientation: "vertical", width, lanes }));
      if (lc.spans[0]!.w < 5) compressed++;
      expect(lc.stems.some((s) => s.id === g.id)).toBe(true);
      expect(inside(lc, g.id)).toBe(false);
      // Single track: g has outer bars active at its date, so it stays right (Ruling 35) and its
      // leader leaves on the right, clear of every bar.
      const st = make();
      const one = v(st, { width });
      const gs = st.at(-1)!;
      expect(onLeft(one, gs.id)).toBe(false);
      expect(one.stems.some((s) => s.id === gs.id)).toBe(true);
      expect(inside(one, gs.id)).toBe(false);
    }
    expect(compressed).toBeGreaterThan(0); // the sweep reaches compressed bands
    // Single track, a LEFT leader over a compressed band: five outer spans (ended by 1986) compress
    // the band; at 2020 p2 swaps left and p3, pushed less on the left than below p1's tall label,
    // goes left below p2 with a leader. No outer bar runs there, so it leaves beside the marker and
    // starts inside no bar.
    const d = (y: string) => `Late-September ${y}`;
    let thin = 0;
    for (let width = 280; width <= 340; width += 10) {
      const f = [
        ev("1980", "long", { endStr: "2030", dateText: d("1980") }),
        ...Array.from({ length: 5 }, (_, i) => ev(`198${1 + i}-01-01`, `o${i}`, { endStr: "1986", dateText: d(`198${1 + i}`) })),
        ev("2020", "p1, a title long enough to wrap onto several lines in the right-hand column", { dateText: d("2020") }),
        ev("2020-01-02", "p2", { dateText: d("2020") }),
        ev("2020-01-03", "p3", { dateText: d("2020") }),
        ev("2030", "far", { dateText: d("2030") }),
      ];
      const m = v(f, { width });
      const p3 = f[8]!.id;
      if (m.spans[0]!.w < 5) thin++;
      expect(onLeft(m, f[7]!.id)).toBe(true);
      expect(onLeft(m, p3)).toBe(true);
      const s = m.stems.find((x) => x.id === p3)!;
      expect(s.points[0]![0]).toBeLessThanOrEqual(ruleX(m) - TL_GEOM.dotR + 1e-9);
      expect(inside(m, p3)).toBe(false);
    }
    expect(thin).toBeGreaterThan(0);
  });

  it("searches the left column below fixed outer-span labels before comparing pushes (Ruling 38)", () => {
    // Codex repro (360, proportional, dates shown as the start year): outer and outer2 hold the top
    // of the left column. b, pushed far down on the right by the long label above it, could start on
    // the left one label gap below outer2's label: that is the smaller push, so it goes there, with
    // a leader, moving no fixed label and beside no active outer bar.
    const rows = [
      ev("2000-01-01", "a", { endStr: "2050-01-01" }),
      ev("2001-01-01", "outer", { endStr: "2002-01-01" }),
      ev("2002-01-01", "outer2", { endStr: "2003-01-01" }),
      ev("2003-01-01", "many words ".repeat(30).trim()),
      ev("2003-01-02", "b"),
      ev("2003-01-03", "c"),
      ev("2100-01-01", "far"),
    ];
    const [, outer, outer2, long, b] = rows as [LayoutEvent, LayoutEvent, LayoutEvent, LayoutEvent, LayoutEvent];
    const inp = base(rows, { orientation: "vertical", width: 360 });
    const l = layoutTimeline(inp);
    const a = verticalNoSwapLayout(inp);
    // The fixed labels are only where the left column's own sweep puts them: outer at its date,
    // outer2 pushed below outer alone.
    atOwnDate(l, outer.id);
    expect(labelOf(l, outer2.id).box.y0).toBeCloseTo(labelOf(l, outer.id).box.y1 + TL_GEOM.vLabelGap, 9);
    expect(onLeft(l, b.id)).toBe(true);
    const lowestFixed = Math.max(labelOf(l, outer.id).box.y1, labelOf(l, outer2.id).box.y1);
    const natural = itemY(l, b.id) - LINE_STYLE.date.lineH / 2;
    expect(natural).toBeLessThan(lowestFixed + TL_GEOM.vLabelGap);
    expect(labelOf(l, b.id).box.y0).toBeCloseTo(lowestFixed + TL_GEOM.vLabelGap, 9);
    // That is less of a push than the right, below the long label, would have been.
    expect(labelOf(l, b.id).box.y0).toBeLessThan(labelOf(l, long.id).box.y1 + TL_GEOM.vLabelGap);
    expect(l.stems.some((s) => s.id === b.id)).toBe(true);
    expect(l.stems.length).toBeLessThanOrEqual(a.stems.length);
  });

  it("never ends with more connectors than the no-swap layout, nor a swap beside an active outer bar, across seeded random layouts (Rulings 34-35)", () => {
    let seed = 4242;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)]!;
    const TITLES = ["Policy begins", "First cohort born under fully phased-in policy", "IRA", "a", "Supercalifragilisticexpialidocious"];
    const DATES = ["Dec 22, 2017", "2026", "Mar 2031", "September 30, 2040"];
    let swaps = 0, fewer = 0;
    for (let c = 0; c < 400; c++) {
      const n = 2 + Math.floor(rnd() * 12);
      const spanP = pick([0, 0.3, 0.6]);
      const yrs = pick([3, 20, 80]);
      const events: LayoutEvent[] = Array.from({ length: n }, (_, i) => {
        const y = 2000 + Math.floor(rnd() * yrs);
        const k = rnd();
        const span = k < spanP;
        const ongoing = span && k < spanP / 4;
        return {
          id: i, start: parseDate(`${y}-${String(1 + Math.floor(rnd() * 12)).padStart(2, "0")}-01`),
          end: span && !ongoing ? parseDate(`${y + 1 + Math.floor(rnd() * 8)}-01-01`) : null, ongoing, category: "",
          dateText: pick(DATES) + (span ? (ongoing ? " –" : " – 2035") : ""), title: pick(TITLES),
          description: pick([null, "A description long enough to wrap onto several lines"]), projected: false,
        };
      });
      const inp = base(events, { orientation: "vertical", width: 280 + Math.floor(rnd() * 141), axis: rnd() < 0.5, spacing: pick(["proportional", "even"]) });
      const l = layoutTimeline(inp);
      const a = verticalNoSwapLayout(inp);
      expect(l.stems.length).toBeLessThanOrEqual(a.stems.length);
      if (l.stems.length < a.stems.length) fewer++;
      const rule = ruleX(l);
      const outer = l.spans.filter((s) => s.x + s.w < rule - 1e-6);
      const outerIds = new Set(outer.map((s) => s.id));
      for (const lab of l.labels) {
        if (outerIds.has(lab.id) || lab.box.x1 >= rule) continue;
        swaps++;
        // A swapped main-track item: no outer bar runs at its date.
        const y = itemY(l, lab.id);
        expect(outer.some((s) => s.y <= y && y <= s.y + s.h)).toBe(false);
      }
      for (let i = 0; i < l.labels.length; i++) {
        for (let j = i + 1; j < l.labels.length; j++) expect(overlaps(l.labels[i]!.box, l.labels[j]!.box)).toBe(false);
      }
    }
    expect(swaps).toBeGreaterThan(100);
    expect(fewer).toBeGreaterThan(100);
  });

  it("keeps every box in the frame, no two boxes overlapping and every leader on its label's side, across 280-420", () => {
    const withDesc = () => FIG7().map((e) => ({ ...e, description: "A description long enough to wrap onto several lines in a narrow column" }));
    const dense = () => Array.from({ length: 12 }, (_, i) => ev(`2026-01-${String(i + 1).padStart(2, "0")}`, `Event ${i} with a title that wraps`));
    const spans = () => [
      ev("2017-12-22", "TCJA individual provisions", { endStr: "2025-12-31", dateText: "Dec 22, 2017 – Dec 31, 2025" }),
      ev("2021-03-11", "Expanded child tax credit", { endStr: "2021-12-31", dateText: "Mar 11, 2021 – Dec 31, 2021" }),
      ev("2022-08-16", "IRA clean-energy credits", { ongoing: true, dateText: "Aug 16, 2022 –" }),
      ev("2025-07-04", "OBBBA enacted", { dateText: "Jul 4, 2025" }),
      ev("2026-01-01", "Phase-in period", { endStr: "2030-12-31", dateText: "Jan 1, 2026 – Dec 31, 2030" }),
      ev("2034-01-01", "Trust fund depletion", { dateText: "Jan 1, 2034" }),
    ];
    let swappedFig7 = 0;
    for (let width = 280; width <= 420; width += 4) {
      for (const make of [FIG7, withDesc, dense, spans]) {
        for (const axis of [false, true]) {
          const events = make();
          const l = v(events, { width, axis });
          expect(allFinite(l)).toBe(true);
          expect(l.height).toBeGreaterThanOrEqual(400);
          for (const lab of l.labels) {
            expect(lab.box.x0).toBeGreaterThanOrEqual(-1e-6);
            expect(lab.box.x1).toBeLessThanOrEqual(width + 1e-6);
            expect(lab.box.y1).toBeLessThanOrEqual(l.height);
            for (const ln of lab.lines) {
              const [x0, x1] = extent(ln);
              expect(x0).toBeGreaterThanOrEqual(lab.box.x0 - 1e-6);
              expect(x1).toBeLessThanOrEqual(lab.box.x1 + 1e-6);
            }
          }
          for (let i = 0; i < l.labels.length; i++) {
            for (let j = i + 1; j < l.labels.length; j++) expect(overlaps(l.labels[i]!.box, l.labels[j]!.box)).toBe(false);
          }
          // A leader ends beside its own label, on the label's side of the rule.
          for (const s of l.stems) {
            const end = s.points.at(-1)![0];
            const box = labelOf(l, s.id).box;
            if (onLeft(l, s.id)) expect(end).toBeGreaterThan(box.x1);
            else expect(end).toBeLessThan(box.x0);
            expect(Math.sign(end - ruleX(l))).toBe(onLeft(l, s.id) ? -1 : 1);
          }
          if (make === FIG7 && l.labels.some((lab) => onLeft(l, lab.id))) swappedFig7++;
        }
      }
    }
    // The sweep really exercises swapping: FIG7's near pairs (2026/2030, 2055/2057) swap at every width.
    expect(swappedFig7).toBe(2 * 36);
  });
});

describe("vertical layout at narrow widths (side columns)", () => {
  const v = (events: LayoutEvent[], o: Partial<TimelineLayoutInput> = {}) =>
    layoutTimeline(base(events, { orientation: "vertical", ...o }));
  const W = 280;
  const dateLines = (l: TimelineLayout) => l.labels.flatMap((x) => x.lines.filter((ln) => ln.role === "date"));
  // A line's painted extent: estimated width (bold dates run ~8% wider), placed by its anchor.
  const extent = (ln: { x: number; text: string; role: "date" | "title" | "description"; anchor: string }): [number, number] => {
    const w = timelineTextWidth(ln.text, LINE_STYLE[ln.role].size, ln.role === "date" ? 700 : 500);
    return ln.anchor === "end" ? [ln.x - w, ln.x] : ln.anchor === "middle" ? [ln.x - w / 2, ln.x + w / 2] : [ln.x, ln.x + w];
  };
  const leftmostMark = (l: TimelineLayout) => Math.min(l.rules[0]!.x1, ...l.spans.map((s) => s.x));
  const isLeft = (l: TimelineLayout, lab: { box: { x1: number } }) => lab.box.x1 < l.rules[0]!.x1;
  const inFrame = (l: TimelineLayout, width = W) => {
    for (const lab of l.labels) {
      expect(lab.box.x0).toBeGreaterThanOrEqual(-1e-6);
      expect(lab.box.x1).toBeLessThanOrEqual(width + 1e-6);
      for (const ln of lab.lines) {
        const [x0, x1] = extent(ln);
        expect(x0).toBeGreaterThanOrEqual(-1e-6);
        expect(x1).toBeLessThanOrEqual(width + 1e-6);
        expect(ln.y).toBeLessThanOrEqual(lab.box.y1);
      }
    }
    // Each side's labels stack: a wrapped date is part of its block, so the next block starts below it.
    for (const left of [true, false]) {
      const side = l.labels.filter((x) => isLeft(l, x) === left);
      for (let i = 1; i < side.length; i++) expect(side[i]!.box.y0).toBeGreaterThanOrEqual(side[i - 1]!.box.y1);
    }
    for (const s of l.spans) expect(s.x).toBeGreaterThanOrEqual(0);
  };
  // Dates wrap only between words: each event's date lines, read in order, are exactly its
  // dateText's whitespace-separated words, with no word split across lines.
  const wholeWords = (l: TimelineLayout, events: LayoutEvent[]) => {
    for (const lab of l.labels) {
      const src = events.find((e) => e.id === lab.id)!.dateText.split(/\s+/).filter(Boolean);
      const got = lab.lines.filter((ln) => ln.role === "date").flatMap((ln) => ln.text.split(/\s+/).filter(Boolean));
      expect(got).toEqual(src);
    }
  };
  // Six overlapping spans with long dates: sub-tracks 0-5, so five label on the left.
  const sixSeptemberSpans = (dateText = "September 30, 2026") => Array.from({ length: 6 }, (_, i) =>
    ev(`2026-0${i + 1}-01`, `Event ${i} title`, { endStr: "2030", dateText }));
  // The spans golden's data (sub-tracks 0 and 1).
  const SPANS = () => [
    ev("2017-12-22", "TCJA individual provisions", { endStr: "2025-12-31", dateText: "Dec 22, 2017 – Dec 31, 2025" }),
    ev("2021-03-11", "Expanded child tax credit", { endStr: "2021-12-31", dateText: "Mar 11, 2021 – Dec 31, 2021" }),
    ev("2022-08-16", "IRA clean-energy credits", { ongoing: true, dateText: "Aug 16, 2022 –" }),
    ev("2025-07-04", "OBBBA enacted", { dateText: "Jul 4, 2025" }),
    ev("2026-01-01", "Phase-in period", { endStr: "2030-12-31", dateText: "Jan 1, 2026 – Dec 31, 2030" }),
    ev("2034-01-01", "Trust fund depletion", { dateText: "Jan 1, 2034" }),
  ];
  const bold = (s: string) => timelineTextWidth(s, 13, 700);
  // Ruling 28, from the documented floors: the left date-word floor (capped at 40%) plus its gap, or
  // the edge pad; the band at 3px bars and 1px gaps; the marker half-width and gap; the right
  // date-word floor. A tick column is drawn when it fits in what is left.
  const tickRoom = (width: number, leftWord: number, nSub: number, rightWord: number): number =>
    width - (leftWord ? Math.min(leftWord, 0.4 * width) + TL_GEOM.vLabelGap : 4)
    - Math.max(TL_GEOM.dotR, nSub ? 1.5 + (nSub - 1) * 4 : 0) - (TL_GEOM.dotR + TL_GEOM.vLabelGap) - rightWord;
  const tickCol = (l: TimelineLayout): number => Math.max(...l.ticks.map((t) => timelineTextWidth(t.text, TBL.size.axis, 500))) + 8;
  const tickRightOf = (l: TimelineLayout): number => Math.max(...l.ticks.map((t) => t.x + timelineTextWidth(t.text, TBL.size.axis, 500)));

  it("wraps long dates between words in the capped left column, keeping every label in the frame", () => {
    const events = sixSeptemberSpans();
    const l = v(events, { width: W, axis: true });
    expect(allFinite(l)).toBe(true);
    inFrame(l);
    wholeWords(l, events);
    const left = l.labels.filter((x) => isLeft(l, x));
    expect(left).toHaveLength(5);
    // The left column is held to 40% of the width, and its dates wrapped to fit it.
    for (const lab of left) expect(lab.box.x1 - lab.box.x0).toBeLessThanOrEqual(0.4 * W + 1e-6);
    expect(left.every((x) => x.lines.filter((ln) => ln.role === "date").length >= 2)).toBe(true);
    expect(Math.max(...left.map((x) => x.box.x1))).toBeLessThanOrEqual(leftmostMark(l));
    // The tick column is judged against the floors ("September" each side, the band at its
    // floors), so the month ticks fit here, leftmost, outside the left labels.
    expect(l.ticks.length).toBeGreaterThanOrEqual(2);
    expect(tickCol(l)).toBeLessThanOrEqual(tickRoom(W, bold("September"), 6, bold("September")));
    expect(Math.min(...left.map((x) => x.box.x0))).toBeGreaterThan(tickRightOf(l));
  });

  it("omits the vertical tick column only when it does not fit", () => {
    for (const width of [W, 360]) {
      const l = v(SPREAD(), { width, axis: true });
      expect(l.ticks.length).toBeGreaterThanOrEqual(2);
      const tickRight = Math.max(...l.ticks.map((t) => t.x + timelineTextWidth(t.text, TBL.size.axis, 500)));
      expect(Math.min(...l.labels.flatMap((x) => x.lines.map((ln) => extent(ln)[0])))).toBeGreaterThan(tickRight);
      expect(l.rules[0]!.x1).toBeLessThanOrEqual(tickRight + 40);
    }
    // The spans golden's data keeps its year ticks down to 280: each tick column fits beside the
    // floors ("<year> –" each side, two sub-tracks).
    for (const width of [343, 320, W]) {
      const l = v(SPANS(), { width, axis: true });
      expect(l.ticks.length).toBeGreaterThanOrEqual(2);
      expect(tickCol(l)).toBeLessThanOrEqual(tickRoom(width, bold("2021 –"), 2, bold("2017 –")));
      expect(Math.min(...l.labels.flatMap((x) => x.lines.map((ln) => extent(ln)[0])))).toBeGreaterThan(tickRightOf(l));
      inFrame(l, width);
    }
    // A date word too wide to leave any tick column room at 280 (less than the narrowest possible,
    // a four-digit year plus its gap) omits the ticks; the same data keeps them at 900.
    const late = sixSeptemberSpans("Mid-to-late-September 30, 2026");
    expect(tickRoom(W, bold("Mid-to-late-September"), 6, bold("Mid-to-late-September"))).toBeLessThan(timelineTextWidth("2027", TBL.size.axis, 500) + 8);
    const narrow = v(late, { width: W, axis: true });
    expect(narrow.ticks).toEqual([]);
    inFrame(narrow);
    const wide = v(sixSeptemberSpans("Mid-to-late-September 30, 2026"), { width: 900, axis: true });
    expect(wide.ticks.length).toBeGreaterThanOrEqual(2);
    inFrame(wide, 900);
  });

  it("judges the tick column on the left floor capped at 40% of the width", () => {
    // The left date unit ("AAA…A –", 42 characters) is far wider than 40% of 375px. Measured
    // uncapped it would leave no room for ticks; capped at 40% it leaves plenty, so they are drawn.
    const width = 375;
    const leftUnit = `${"A".repeat(40)} –`;
    const outer = ev("2020-01-02", "outer", { endStr: "2035", dateText: `${"A".repeat(40)} – 2035` });
    const events = [ev("2020", "inner", { endStr: "2030", dateText: "2020 – 2030" }), outer, ev("2040", "z")];
    const tickNeed = timelineTextWidth("2020", TBL.size.axis, 500) + 8;
    expect(bold(leftUnit)).toBeGreaterThan(0.4 * width);
    const uncapped = width - (bold(leftUnit) + TL_GEOM.vLabelGap) - Math.max(TL_GEOM.dotR, 1.5 + 4) - (TL_GEOM.dotR + TL_GEOM.vLabelGap) - bold("2020 –");
    expect(uncapped).toBeLessThan(tickNeed);
    expect(tickRoom(width, bold(leftUnit), 2, bold("2020 –"))).toBeGreaterThanOrEqual(tickNeed);
    const l = v(events, { width, axis: true });
    expect(l.ticks.length).toBeGreaterThanOrEqual(2);
    expect(labelOf(l, outer.id).box.x1).toBeLessThan(l.rules[0]!.x1); // on the left
    expect(labelOf(l, outer.id).box.x0).toBeGreaterThan(tickRightOf(l));
    inFrame(l, width);
  });

  it("keeps a lone sub-track's bar at full width however little room the right column leaves", () => {
    // One sub-track's band is a marker radius whatever the bar width, so thinning the bar gains nothing.
    const word = "X".repeat(34);
    expect(bold(word)).toBeGreaterThan(W - 4 - 2 * TL_GEOM.dotR - TL_GEOM.vLabelGap); // right column is short
    const l = v([ev("2020", "span", { endStr: "2030" }), ev("2025", "long date", { dateText: word }), ev("2040", "z")], { width: W });
    expect(l.spans).toHaveLength(1);
    expect(l.spans[0]!.w).toBe(TL_GEOM.spanH);
    inFrame(l);
  });

  it("compresses a crowded sub-track band instead of pushing text off-canvas", () => {
    const crowd = (n: number) => Array.from({ length: n }, (_, i) =>
      ev(`${1990 + i}`, `Span ${i}`, { endStr: `${2030 + i}`, dateText: `${1990 + i} – ${2030 + i}` }));
    const xsOf = (l: TimelineLayout) => [...new Set(l.spans.map((s) => s.x))].sort((a, b) => a - b);
    // Twenty sub-tracks: the band narrows (bars and gaps shrink together) and every range still
    // fits its column on one line.
    const twenty = crowd(20);
    const l = v(twenty, { width: W });
    expect(allFinite(l)).toBe(true);
    expect(l.spans).toHaveLength(20);
    inFrame(l);
    wholeWords(l, twenty);
    expect(dateLines(l)).toHaveLength(20);
    for (const s of l.spans) {
      expect(s.w).toBeLessThan(TL_GEOM.spanH);
      expect(s.w).toBeGreaterThanOrEqual(3 - 1e-9); // never below the V_MIN_BAR floor
    }
    const xs = xsOf(l);
    expect(xs).toHaveLength(20);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(l.spans[0]!.w + 1 - 1e-9);
    expect(Math.max(...l.labels.filter((x) => isLeft(l, x)).map((x) => x.box.x1))).toBeLessThanOrEqual(leftmostMark(l));
    // Thirty: the bars reach their floor and the left column yields down to its widest date word,
    // so each range wraps after its en dash — "<start> –" then "<end>" — never mid-date.
    const thirty = crowd(30);
    const t = v(thirty, { width: W });
    expect(allFinite(t)).toBe(true);
    inFrame(t);
    wholeWords(t, thirty);
    for (const s of t.spans) expect(s.w).toBeCloseTo(3, 6);
    const txs = xsOf(t);
    expect(txs).toHaveLength(30);
    for (let i = 1; i < txs.length; i++) expect(txs[i]! - txs[i - 1]!).toBeGreaterThanOrEqual(3 + 1 - 1e-9);
    const leftDates = t.labels.filter((x) => isLeft(t, x)).map((x) => x.lines.filter((ln) => ln.role === "date").map((ln) => ln.text));
    expect(leftDates).toHaveLength(29);
    for (const d of leftDates) {
      expect(d).toHaveLength(2);
      expect(d[0]!.endsWith(" –")).toBe(true);
    }
  });

  it("budgets the width: tick column, left column min(40%, need), band, rule, then the right column", () => {
    // Every value follows from the documented budget and the text estimator, not from a recording.
    const bold = (s: string) => timelineTextWidth(s, 13, 700);
    const edge = 4, gap = TL_GEOM.vLabelGap, dotR = TL_GEOM.dotR;
    const rightOfRule = dotR + gap; // the marker's half-width (≥ half a bar) plus the label gap
    // Nothing on the left: an edge pad, the marker, the rule, then the right column (Ruling 29's
    // balance inset sets only that column's wrap width; Ruling 43 trims it from the block).
    const plain = v(SPREAD(), { width: 360 });
    for (const lab of plain.labels) expect(lab.box.x0 - plain.rules[0]!.x1).toBeCloseTo(rightOfRule, 9);
    // The tick column goes first, sized to its widest tick plus its gap, then the edge pad.
    const axis = v(SPREAD(), { width: 360, axis: true });
    const tickW = Math.max(...axis.ticks.map((t) => timelineTextWidth(t.text, TBL.size.axis, 500))) + 8;
    expect(axis.rules[0]!.x1 - axis.ticks[0]!.x).toBeCloseTo(tickW + edge + dotR, 9);
    // A left column at its natural need (here, c's date), then the gap, then the band of two
    // sub-tracks (half a bar plus one pitch), then the rule.
    const a = ev("2020", "a", { endStr: "2030" });
    const c = ev("2025", "c", { endStr: "2035", dateText: "2025 – 2035" });
    const two = v([a, c, ev("2040", "b")], { width: 360 });
    const need = bold("2025 – 2035");
    const band = TL_GEOM.spanH / 2 + TL_GEOM.spanH + TL_GEOM.subTrackGap;
    const cBox = labelOf(two, c.id).box;
    expect(cBox.x1 - cBox.x0).toBeCloseTo(need, 9);
    expect(two.rules[0]!.x1 - cBox.x1).toBeCloseTo(gap + band, 9);
    expect(labelOf(two, a.id).box.x0 - two.rules[0]!.x1).toBeCloseTo(rightOfRule, 9);
    // A left label wider than 40% of the width is capped there and wraps.
    const cl = ev("2025", "c, whose title is far too long for forty percent of a phone", { endStr: "2035", dateText: "2025 – 2035" });
    const capped = v([a, cl, ev("2040", "b")], { width: 360 });
    const clBox = labelOf(capped, cl.id).box;
    expect(clBox.x1 - clBox.x0).toBeLessThanOrEqual(0.4 * 360 + 1e-9);
    expect(clBox.x1 - clBox.x0).toBeGreaterThan(0.4 * 360 - 40);
    expect(labelOf(capped, cl.id).lines.filter((ln) => ln.role === "title").length).toBeGreaterThan(1);
    expect(capped.rules[0]!.x1 - clBox.x1).toBeCloseTo(gap + band, 9);
    // With ticks, the tick column comes first and the left column starts where it ends.
    const ticked = v([a, c, ev("2040", "b")], { width: 360, axis: true });
    expect(ticked.ticks.length).toBeGreaterThanOrEqual(2);
    const tw = tickCol(ticked);
    expect(labelOf(ticked, c.id).box.x1 - ticked.ticks[0]!.x).toBeCloseTo(tw + need, 9);
    expect(ticked.rules[0]!.x1 - ticked.ticks[0]!.x).toBeCloseTo(tw + need + gap + band, 9);
  });

  it("balances a single-track vertical timeline with nothing on the left: its block is centred (Rulings 29, 43)", () => {
    // Point-only, no left column: the blank the balance inset leaves beside the right column is
    // split evenly either side of the block (the 4px edge pad mirrored), not left of the rule.
    const l = v(SPREAD(), { width: 375 });
    expect(l.labels.some((lab) => lab.box.x0 < l.rules[0]!.x1)).toBe(false); // sanity: nothing on the left
    const [lo, hi] = inkOf(l);
    expect(lo - 4).toBeCloseTo(375 - hi - 4, 9);
    expect(lo).toBeGreaterThan(20);
  });

  it("shrinks the balance inset to keep the right column's date-word floor, never below the natural extent (Ruling 29)", () => {
    const width = 280;
    // One long unbroken date unit: wide enough that the full 15% inset would compress the right
    // column below the width this word needs, but not so wide that even the natural (uninset)
    // position already fails it. (27 Xs at the measured bold Figtree width; 31 under the old estimate.)
    const wordDate = "X".repeat(27);
    const l = v([...SPREAD(), ev("2088", "z", { dateText: wordDate })], { width });
    const naturalRuleX = TL_GEOM.dotR + 4; // V_EDGE (4) + a marker radius: no left col, no ticks, no spans
    const fullInset = width * TL_GEOM.vTrackInsetShare;
    const wordFloor = timelineTextWidth(wordDate, LINE_STYLE.date.size, 700);
    // The inset only sets the right column's wrap width (Ruling 43 then centres the block): the word
    // keeps its line, so the inset shrank to leave it room, and the block is exactly that wide.
    const z = l.labels.find((x) => x.lines[0]!.text === wordDate)!;
    expect(z.lines.filter((ln) => ln.role === "date")).toHaveLength(1);
    expect(z.box.x1 - z.box.x0).toBeCloseTo(wordFloor, 6);
    // The full 15% inset would have split it; the natural (uninset) position leaves room to spare.
    expect(width - fullInset - TL_GEOM.dotR - TL_GEOM.vLabelGap).toBeLessThan(wordFloor);
    expect(width - naturalRuleX - TL_GEOM.dotR - TL_GEOM.vLabelGap).toBeGreaterThan(wordFloor);
    inFrame(l, width);
  });

  it("keeps every box inside the frame at 280 and 375", () => {
    const withDesc = () => FIG7().map((e) => ({ ...e, description: "A description long enough to wrap onto several lines in a narrow column" }));
    for (const width of [280, 375]) {
      for (const events of [FIG7(), withDesc(), SPANS(), sixSeptemberSpans()]) {
        for (const axis of [false, true]) {
          const l = v(events, { width, axis });
          expect(allFinite(l)).toBe(true);
          inFrame(l, width);
        }
      }
    }
  });

  it("never isolates the dash on its own line or leaves a stray space, across a width sweep", () => {
    // Fix round 1: the same append-after-wrap bug hit the vertical gutter too, where the
    // downstream hardBreak (fired when the appended line ran over dateW) could split "2017 –"
    // right at its space. Sweeps both a plain two-date-range fixture and a 3-sub-track one, plus
    // an open-ended range, since the reported failing widths depended on sub-track compression.
    const RANGE = () => [
      ev("2017-12-22", "a", { endStr: "2025-12-31", dateText: "Dec 22, 2017 – Dec 31, 2025" }),
      ev("2034-01-01", "z", { dateText: "Jan 1, 2034" }),
    ];
    const THREE_SUB = () => [
      ev("2018-01-01", "a", { endStr: "2028", dateText: "Jan 1, 2018 – Jan 1, 2028" }),
      ev("2018-01-05", "b", { endStr: "2029", dateText: "Jan 5, 2018 – Jan 1, 2029" }),
      ev("2018-01-10", "c", { endStr: "2030", dateText: "Jan 10, 2018 – Jan 1, 2030" }),
      ev("2040-06-01", "open", { ongoing: true, dateText: "2040 –" }),
    ];
    for (let width = 250; width <= 400; width++) {
      for (const events of [RANGE(), THREE_SUB()]) {
        const l = v(events, { width });
        for (const d of dateLines(l)) {
          expect(d.text).not.toBe("–");
          expect(d.text).not.toBe(" –");
          expect(d.text.startsWith(" ")).toBe(false);
          expect(d.text.endsWith(" ")).toBe(false);
          expect(extent(d)[0]).toBeGreaterThanOrEqual(-1e-6);
        }
      }
    }
  });

  it("splits a date word wider than its whole column without separating its dash", () => {
    // The only route to the character-level fallback: one unit wider than the right column itself.
    // Near 332-339px the column holds exactly the 40-letter word, which is
    // where a plain character split strands the dash, or a trailing space, on a line of its own.
    const word = "A".repeat(40);
    for (const dateText of [`${word} – 2030`, `${word}–2030`]) {
      for (let width = 280; width <= 339; width++) {
        const e = ev("2020", "t", { endStr: "2030", dateText });
        const l = v([e, ev("2040", "z")], { width });
        const d = labelOf(l, e.id).lines.filter((ln) => ln.role === "date").map((ln) => ln.text);
        expect(d.length).toBeGreaterThan(2); // the word really was split
        expect(d.join("").replace(/\s/g, "")).toBe(dateText.replace(/\s/g, ""));
        const dashLine = d.findIndex((s) => s.includes("–"));
        expect(d[dashLine]).toMatch(/^A+ ?–$/); // a word character travels with the dash
        for (const s of d) {
          expect(s).not.toBe("–");
          expect(s).not.toBe(" –");
          expect(s.startsWith(" ")).toBe(false);
          expect(s.endsWith(" ")).toBe(false);
        }
        inFrame(l, width);
      }
    }
    // On the left the floor is capped at 40% of the width, so a left-side unit wider than that is
    // split too rather than widening the left column past the frame (the track and the right
    // column would follow it off the chart).
    for (const dateText of [`${word} – 2035`, `${word}–2035`]) {
      for (const width of [280, 320, 375]) {
        const outer = ev("2020-01-02", "outer", { endStr: "2035", dateText });
        const l = v([ev("2020", "inner", { endStr: "2030" }), outer, ev("2040", "z")], { width });
        const lab = labelOf(l, outer.id);
        expect(lab.box.x1).toBeLessThan(l.rules[0]!.x1); // on the left
        expect(lab.box.x1 - lab.box.x0).toBeLessThanOrEqual(0.4 * width + 1e-6);
        const d = lab.lines.filter((ln) => ln.role === "date").map((ln) => ln.text);
        expect(d.length).toBeGreaterThan(2);
        for (const s of d) {
          expect(s).not.toBe("–");
          expect(s).not.toBe(" –");
          expect(s.startsWith(" ")).toBe(false);
          expect(s.endsWith(" ")).toBe(false);
        }
        expect(l.rules[0]!.x1).toBeLessThan(width);
        inFrame(l, width);
      }
    }
  });

  it("keeps a range's dash on its word in either column, for long and unspaced dates, across 280-420", () => {
    // Ruling 27: date wrapping reuses the dash-aware units, and no fallback may split a word from
    // its glued dash or leave an edge space. Each text is tried on the right (alone on sub-track 0)
    // and on the left (the outer two of three overlapping spans).
    const TEXTS = ["Dec 22, 2017–Dec 31, 2025", "September 30, 2017 – October 31, 2095"];
    const alone = (t: string) => [ev("2017-09-30", "a", { endStr: "2095", dateText: t }), ev("2100", "z")];
    const three = (t: string) => [
      ev("2017-09-30", "a", { endStr: "2095", dateText: t }),
      ev("2017-10-01", "b", { endStr: "2095", dateText: t }),
      ev("2017-10-02", "c", { endStr: "2095", dateText: t }),
      ev("2100", "z"),
    ];
    let sawLeftWrap = false;
    for (let width = 280; width <= 420; width++) {
      for (const t of TEXTS) {
        for (const events of [alone(t), three(t)]) {
          const l = v(events, { width });
          inFrame(l, width);
          for (const lab of l.labels) {
            const d = lab.lines.filter((ln) => ln.role === "date").map((ln) => ln.text);
            if (lab.box.x1 < l.rules[0]!.x1 && d.length > 1) sawLeftWrap = true;
            for (const s of d) {
              expect(s).not.toBe("–");
              expect(s).not.toBe(" –");
              expect(s.startsWith(" ")).toBe(false);
              expect(s.endsWith(" ")).toBe(false);
            }
            // Read back in order, the lines are the source text broken only at spaces or after the dash.
            if (lab.id !== events.at(-1)!.id) {
              const src = events.find((e) => e.id === lab.id)!.dateText;
              expect(d.join(" ").replace(/– /g, "–").replace(/\s+/g, " ")).toBe(src.replace(/– /g, "–"));
            }
          }
        }
      }
    }
    expect(sawLeftWrap).toBe(true); // the sweep really reaches wrapping widths
  });
});

describe("vertical lane columns (exactly two lanes)", () => {
  const LANES = [{ key: "a", label: "Legislation" }, { key: "b", label: "Implementation" }];
  const vc = (events: LayoutEvent[], o: Partial<TimelineLayoutInput> = {}) =>
    layoutTimeline(base(events, { orientation: "vertical", width: 375, lanes: LANES, ...o }));
  const A = (start: string, title: string, o: Partial<LayoutEvent> & { endStr?: string } = {}) => ev(start, title, { category: "a", ...o });
  const B = (start: string, title: string, o: Partial<LayoutEvent> & { endStr?: string } = {}) => ev(start, title, { category: "b", ...o });
  // The mockup's two-lane data (scratchpad ab.html).
  const TWO = () => [
    A("2025-07-04", "Bill signed into law", { dateText: "Jul 4, 2025" }),
    B("2026-01-01", "Rulemaking period", { endStr: "2027-12-31", dateText: "Jan 1, 2026 – Dec 31, 2027" }),
    A("2027-06-01", "Technical corrections bill", { dateText: "Jun 1, 2027" }),
    B("2028-01-01", "Credits take effect", { dateText: "Jan 1, 2028" }),
    A("2033-01-01", "Scheduled sunset", { dateText: "Jan 1, 2033" }),
  ];
  const rx = (l: TimelineLayout, i: number): number => l.rules[i]!.x1;
  const spanOf = (l: TimelineLayout, id: number) => l.spans.find((s) => s.id === id)!;
  const markOf = (l: TimelineLayout, id: number) => l.markers.find((m) => m.id === id)!;
  const laneOf = (l: TimelineLayout, cat: string) => l.labels.filter((x) => x.category === cat);
  const nameBottom = (l: TimelineLayout): number =>
    Math.max(...l.laneLabels.map((n) => n.y + (n.lines.length - 1) * LANE_LINE_H + (LANE_LINE_H - LANE_SIZE)));
  const nameExtent = (n: TimelineLayout["laneLabels"][number]): [number, number] => {
    const w = Math.max(...n.lines.map((s) => timelineTextWidth(s, LANE_SIZE, 700)));
    return n.anchor === "end" ? [n.x - w, n.x] : [n.x, n.x + w];
  };
  const lineExtent = (ln: { x: number; text: string; role: "date" | "title" | "description"; anchor: string }): [number, number] => {
    const w = timelineTextWidth(ln.text, LINE_STYLE[ln.role].size, ln.role === "date" ? 700 : 500);
    return ln.anchor === "end" ? [ln.x - w, ln.x] : [ln.x, ln.x + w];
  };
  const tickRight = (l: TimelineLayout) => Math.max(...l.ticks.map((t) => t.x + timelineTextWidth(t.text, TBL.size.axis, 500)));

  it("draws two vertical rules near the centre, each lane named at the top of its own track", () => {
    const l = vc(TWO());
    expect(l.orientation).toBe("vertical");
    expect(l.rules).toHaveLength(2);
    for (const r of l.rules) expect(r.x1).toBe(r.x2);
    expect(rx(l, 0)).toBeLessThan(rx(l, 1));
    expect(Math.abs((rx(l, 0) + rx(l, 1)) / 2 - 375 / 2)).toBeLessThan(375 * 0.1);
    expect(l.laneLabels.map((n) => [n.text, n.anchor])).toEqual([["Legislation", "end"], ["Implementation", "start"]]);
    // Each name heads its own track, on the lane's outer side.
    expect(l.laneLabels[0]!.x).toBeLessThan(rx(l, 0));
    expect(l.laneLabels[0]!.x).toBeGreaterThan(rx(l, 0) - 16);
    expect(l.laneLabels[1]!.x).toBeGreaterThan(rx(l, 1));
    expect(l.laneLabels[1]!.x).toBeLessThan(rx(l, 1) + 16);
    // The header is reserved: no label or rule rides up into it.
    for (const lab of l.labels) expect(lab.box.y0).toBeGreaterThanOrEqual(nameBottom(l));
    for (const r of l.rules) expect(r.y1).toBeGreaterThan(nameBottom(l));
    // Each lane's items sit on its own rule.
    for (const m of l.markers) expect(m.cx).toBe(rx(l, m.category === "a" ? 0 : 1));
    for (const s of l.spans) expect(s.x + s.w / 2).toBeCloseTo(rx(l, s.category === "a" ? 0 : 1), 9);
    expect(l.height).toBeGreaterThanOrEqual(400);
    expect(l.fits).toBe(true);
    expect(allFinite(l)).toBe(true);
  });

  it("labels lane 0 on the left, right-aligned, and lane 1 on the right, each beyond its band", () => {
    const l = vc(TWO());
    const a = laneOf(l, "a"), b = laneOf(l, "b");
    expect(a).toHaveLength(3);
    expect(b).toHaveLength(2);
    for (const lab of a) {
      expect(lab.lines[0]!.role).toBe("date");
      expect(lab.lines.every((ln) => ln.anchor === "end" && ln.x === lab.box.x1)).toBe(true);
      expect(lab.box.x1).toBeLessThan(rx(l, 0) - TL_GEOM.dotR);
    }
    for (const lab of b) {
      expect(lab.lines[0]!.role).toBe("date");
      expect(lab.lines.every((ln) => ln.anchor === "start" && ln.x === lab.box.x0)).toBe(true);
      expect(lab.box.x0).toBeGreaterThan(rx(l, 1) + TL_GEOM.dotR);
      for (const s of l.spans.filter((x) => x.category === "b")) expect(lab.box.x0).toBeGreaterThan(s.x + s.w);
    }
    // Undisplaced: each block's date line is centred on its own item.
    expect(l.stems).toEqual([]);
    for (const m of l.markers) expect(l.labels.find((x) => x.id === m.id)!.box.y0 + 8).toBeCloseTo(m.cy, 6);
  });

  it("stacks each lane's overlapping spans outward and keeps their labels on the lane's outer side", () => {
    const a1 = A("2020", "a1", { endStr: "2030" }), a2 = A("2025", "a2, outer", { endStr: "2035" });
    const b1 = B("2020", "b1", { endStr: "2030" }), b2 = B("2025", "b2, outer", { endStr: "2035" });
    const l = vc([a1, a2, b1, b2, A("2040", "end")]);
    expect(spanOf(l, a1.id).x + spanOf(l, a1.id).w / 2).toBeCloseTo(rx(l, 0), 9);
    expect(spanOf(l, b1.id).x + spanOf(l, b1.id).w / 2).toBeCloseTo(rx(l, 1), 9);
    expect(spanOf(l, a2.id).x + spanOf(l, a2.id).w).toBeLessThan(spanOf(l, a1.id).x); // lane 0: leftward
    expect(spanOf(l, b2.id).x).toBeGreaterThan(spanOf(l, b1.id).x + spanOf(l, b1.id).w); // lane 1: rightward
    // Neither lane's bars cross the centre between the rules.
    const aRight = Math.max(...l.spans.filter((s) => s.category === "a").map((s) => s.x + s.w));
    const bLeft = Math.min(...l.spans.filter((s) => s.category === "b").map((s) => s.x));
    expect(aRight).toBeLessThan(bLeft);
    for (const lab of laneOf(l, "a")) expect(lab.box.x1).toBeLessThan(spanOf(l, a2.id).x);
    for (const lab of laneOf(l, "b")) expect(lab.box.x0).toBeGreaterThan(spanOf(l, b2.id).x + spanOf(l, b2.id).w);
  });

  it("gives a lane with no events its track and name", () => {
    const l = vc([A("2020", "only lane 0"), A("2030", "again")]);
    expect(l.rules).toHaveLength(2);
    expect(l.laneLabels.map((n) => n.text)).toEqual(["Legislation", "Implementation"]);
    expect(l.labels.every((x) => x.box.x1 < rx(l, 0))).toBe(true);
  });

  it("drops an event outside both lanes, and is deterministic regardless of input order", () => {
    const stray = ev("2029", "stray", { category: "z" });
    const e = [...TWO(), stray, A("2031", "open", { ongoing: true })];
    const l = vc(e, { axis: true });
    expect(l.order).not.toContain(stray.id);
    expect(l.labels.map((x) => x.id)).not.toContain(stray.id);
    expect(JSON.stringify(vc([...e].reverse(), { axis: true }))).toBe(JSON.stringify(l));
    // The open-ended span fades down to the bottom of its rule.
    const open = l.spans.find((s) => s.fade === "down")!;
    expect(open.y + open.h).toBeCloseTo(l.height - TL_GEOM.vPad, 6);
    expect(l.rules[0]!.y2).toBeCloseTo(l.height - TL_GEOM.vPad, 6);
  });

  it("sweeps each lane on its own and leads a displaced label from its item's outer side", () => {
    const a = A("2020-01-01", "a"), a2 = A("2020-01-03", "a2, pushed down by a");
    const b = B("2020-01-01", "b"), b2 = B("2020-01-02", "b2, pushed down by b");
    const l = vc([a, a2, b, b2, A("2090", "far")]);
    expect(l.stems.map((s) => s.id).sort()).toEqual([a2.id, b2.id].sort());
    // Side by side on the same date: neither lane pushes the other.
    expect(labelOf(l, a.id).box.y0 + 8).toBeCloseTo(markOf(l, a.id).cy, 6);
    expect(labelOf(l, b.id).box.y0 + 8).toBeCloseTo(markOf(l, b.id).cy, 6);
    const left = l.stems.find((s) => s.id === a2.id)!.points;
    const right = l.stems.find((s) => s.id === b2.id)!.points;
    // Lane 0: out of the marker's LEFT side, down, into the right end of the label's first line.
    expect(left).toHaveLength(3);
    expect(left[0]).toEqual([rx(l, 0) - TL_GEOM.dotR - 2, markOf(l, a2.id).cy]);
    expect(left[1]![0]).toBe(left[0]![0]);
    expect(left[2]![1]).toBe(left[1]![1]);
    expect(left[2]![0]).toBeLessThan(left[1]![0]);
    expect(left[2]![0]).toBeGreaterThan(labelOf(l, a2.id).box.x1);
    expect(left[2]![1]).toBeLessThan(labelOf(l, a2.id).lines[0]!.y);
    // Lane 1: the mirror image, out of the marker's right side.
    expect(right).toHaveLength(3);
    expect(right[0]).toEqual([rx(l, 1) + TL_GEOM.dotR + 2, markOf(l, b2.id).cy]);
    expect(right[2]![0]).toBeGreaterThan(right[1]![0]);
    expect(right[2]![0]).toBeLessThan(labelOf(l, b2.id).box.x0);
  });

  it("leads a displaced point across its lane's outer bars to a leg beyond the band", () => {
    const s0 = A("2020-01-01", "s0", { endStr: "2040" }), s1 = A("2020-01-01", "s1", { endStr: "2040" });
    const p = A("2020-01-02", "p, pushed down");
    const t0 = B("2020-01-01", "t0", { endStr: "2040" }), t1 = B("2020-01-01", "t1", { endStr: "2040" });
    const q = B("2020-01-02", "q, pushed down");
    const l = vc([s0, s1, p, t0, t1, q, A("2090", "far")]);
    const pp = l.stems.find((s) => s.id === p.id)!.points;
    expect(pp).toHaveLength(4);
    // It starts off the marker but not inside the outer bar: at most at that bar's inner edge.
    expect(pp[0]![1]).toBe(markOf(l, p.id).cy);
    expect(pp[0]![0]).toBeLessThan(rx(l, 0) - TL_GEOM.dotR);
    expect(pp[0]![0]).toBeGreaterThanOrEqual(spanOf(l, s1.id).x + spanOf(l, s1.id).w);
    expect(pp[1]![0]).toBeLessThan(spanOf(l, s1.id).x); // past the outer bar
    expect(pp[1]![0]).toBeGreaterThan(labelOf(l, p.id).box.x1);
    expect(pp[3]![0]).toBeGreaterThan(labelOf(l, p.id).box.x1);
    const qq = l.stems.find((s) => s.id === q.id)!.points;
    expect(qq).toHaveLength(4);
    expect(qq[0]![0]).toBeGreaterThan(rx(l, 1) + TL_GEOM.dotR);
    expect(qq[0]![0]).toBeLessThanOrEqual(spanOf(l, t1.id).x);
    expect(qq[1]![0]).toBeGreaterThan(spanOf(l, t1.id).x + spanOf(l, t1.id).w);
    expect(qq[3]![0]).toBeLessThan(labelOf(l, q.id).box.x0);
    // A displaced outer-sub-track span leaves its own bar's outer edge.
    const s2 = A("2020-01-02", "s2, outer and pushed", { endStr: "2020-06-01" });
    const l2 = vc([s0, s1, s2, A("2090", "far")]);
    const sp = spanOf(l2, s2.id);
    const pts = l2.stems.find((s) => s.id === s2.id)!.points;
    expect(sp.x).toBeLessThan(spanOf(l2, s0.id).x);
    expect(pts[0]).toEqual([sp.x, sp.y]);
  });

  it("keeps the tick column leftmost, outside lane 0's labels and name, with axis:true", () => {
    const l = vc(TWO(), { axis: true });
    expect(l.ticks.length).toBeGreaterThanOrEqual(2);
    expect(l.ticks.every((t) => t.x === l.ticks[0]!.x && t.anchor === "start")).toBe(true);
    expect(l.ticks[0]!.x).toBeCloseTo(inkOf(l)[0], 9);
    expect(Math.min(...l.labels.map((x) => x.box.x0))).toBeGreaterThan(tickRight(l));
    expect(nameExtent(l.laneLabels[0]!)[0]).toBeGreaterThan(tickRight(l));
    for (const t of l.ticks) expect(t.y - TBL.size.axis).toBeGreaterThan(nameBottom(l));
    expect(vc(TWO()).ticks).toEqual([]);
  });

  it("wraps long lane names to their side and keeps every box in the frame at 280 and 375", () => {
    const lanes = [
      { key: "a", label: "Legislation enacted by the Congress" },
      { key: "b", label: "Implementation by the Treasury Department" },
    ];
    const events = [
      ...TWO(),
      A("2026-03-01", "Overlapping authority", { endStr: "2030-01-01", dateText: "Mar 1, 2026 – Jan 1, 2030", description: "A description long enough to wrap onto more lines" }),
      A("2026-04-01", "Another overlap", { endStr: "2029-01-01", dateText: "Apr 1, 2026 – Jan 1, 2029" }),
      B("2026-06-01", "Guidance window", { endStr: "2029-06-01", dateText: "Jun 1, 2026 – Jun 1, 2029" }),
      B("2030-01-01", "Open-ended credit", { ongoing: true, dateText: "Jan 1, 2030 –" }),
    ];
    for (const width of [280, 375]) {
      for (const axis of [false, true]) {
        const l = vc(events, { width, lanes, axis });
        expect(allFinite(l)).toBe(true);
        expect(l.laneLabels.every((n) => n.lines.length >= 2)).toBe(true);
        for (const n of l.laneLabels) {
          const [x0, x1] = nameExtent(n);
          expect(x0).toBeGreaterThanOrEqual(-1e-6);
          expect(x1).toBeLessThanOrEqual(width + 1e-6);
        }
        expect(nameExtent(l.laneLabels[0]!)[1]).toBeLessThan(rx(l, 0));
        expect(nameExtent(l.laneLabels[1]!)[0]).toBeGreaterThan(rx(l, 1));
        for (const lab of l.labels) {
          expect(lab.box.x0).toBeGreaterThanOrEqual(-1e-6);
          expect(lab.box.x1).toBeLessThanOrEqual(width + 1e-6);
          expect(lab.box.y0).toBeGreaterThanOrEqual(nameBottom(l));
          expect(lab.box.y1).toBeLessThanOrEqual(l.height);
          for (const ln of lab.lines) {
            const [x0, x1] = lineExtent(ln);
            expect(x0).toBeGreaterThanOrEqual(-1e-6);
            expect(x1).toBeLessThanOrEqual(width + 1e-6);
          }
        }
        for (const cat of ["a", "b"]) {
          const side = laneOf(l, cat);
          for (let i = 1; i < side.length; i++) expect(side[i]!.box.y0).toBeGreaterThanOrEqual(side[i - 1]!.box.y1);
        }
        for (const s of l.spans) {
          expect(s.x).toBeGreaterThanOrEqual(0);
          expect(s.x + s.w).toBeLessThanOrEqual(width);
        }
        if (l.ticks.length) expect(Math.min(...l.labels.map((x) => x.box.x0))).toBeGreaterThan(tickRight(l));
      }
    }
  });

  it("compresses both lanes' crowded bands together rather than split a date word, at 280", () => {
    const crowd = (mk: typeof A) => Array.from({ length: 8 }, (_, i) =>
      mk(`2026-0${i + 1}-01`, `Event ${i}`, { endStr: "2030", dateText: "September 30, 2026" }));
    const events = [...crowd(A), ...crowd(B)];
    const l = vc(events, { width: 280 });
    const widths = new Set(l.spans.map((s) => s.w));
    expect(widths.size).toBe(1); // one bar width for both lanes
    const w = [...widths][0]!;
    expect(w).toBeLessThan(TL_GEOM.spanH);
    expect(w).toBeGreaterThanOrEqual(3);
    for (const s of l.spans) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x + s.w).toBeLessThanOrEqual(280);
    }
    // Every date wrapped only between its words: "September" was never split.
    for (const lab of l.labels) {
      const got = lab.lines.filter((ln) => ln.role === "date").flatMap((ln) => ln.text.split(/\s+/));
      expect(got).toEqual(["September", "30,", "2026"]);
      expect(lab.box.x0).toBeGreaterThanOrEqual(-1e-6);
      expect(lab.box.x1).toBeLessThanOrEqual(280 + 1e-6);
    }
  });

  it("meets both date-word floors when compressing asymmetric lanes, and whenever ticks are drawn (280-340)", () => {
    // Lane 0 holds one span and a point (a band of one marker radius, not half a bar); lane 1 a
    // crowd of overlapping spans. The compression must model lane 0's band exactly as drawn.
    const D = "September 30, 2026";
    const word = timelineTextWidth("September", 13, 700);
    const bandFloor = (n: number) => Math.max(TL_GEOM.dotR, n ? 1.5 + (n - 1) * 4 : 0);
    let sawCompressed = false;
    for (const nb of [6, 8, 12]) {
      const events = [
        A("2026-01-01", "one span", { endStr: "2030", dateText: D }),
        A("2027-01-01", "a point", { dateText: D }),
        ...Array.from({ length: nb }, (_, i) =>
          B(`2026-${String(i + 1).padStart(2, "0")}-01`, `Event ${i}`, { endStr: "2030", dateText: D })),
      ];
      for (let width = 280; width <= 340; width++) {
        const floorsFit = width - (2 * TL_GEOM.vLabelGap + 32) - bandFloor(1) - bandFloor(nb) - 2 * word >= 0;
        for (const axis of [false, true]) {
          const l = vc(events, { width, axis });
          if (l.ticks.length) expect(floorsFit).toBe(true);
          if (l.spans.some((s) => s.w < TL_GEOM.spanH)) sawCompressed = true;
          if (!floorsFit) continue;
          for (const lab of l.labels) {
            const got = lab.lines.filter((ln) => ln.role === "date").flatMap((ln) => ln.text.split(/\s+/));
            expect(got, `nb=${nb} width=${width} axis=${axis}`).toEqual(["September", "30,", "2026"]);
          }
        }
      }
    }
    expect(sawCompressed).toBe(true);
  });

  it("judges the tick column on one shared floor, the wider lane's date word, for both columns", () => {
    // Lane 0's dates are one long word; lane 1's are four-digit years. Both columns are held to the
    // wider word, so the fit test is 2 x lane 0's word: at 375 that leaves no room for ticks, although
    // lane 0's word plus lane 1's own (a per-lane reading) would.
    const bold = (s: string) => timelineTextWidth(s, 13, 700);
    const tickNeed = timelineTextWidth("2026", TBL.size.axis, 500) + 8;
    const fixed = 2 * TL_GEOM.vLabelGap + 32;
    const bands = 2 * TL_GEOM.dotR; // points only: each lane's band is a marker radius
    const word = "X".repeat(20); // 25 under the old estimate; the measured bold X is wider
    const events = [
      A("2026", "a1", { dateText: word }), A("2029", "a2", { dateText: word }), A("2033", "a3", { dateText: word }),
      B("2027", "b1"), B("2031", "b2"),
    ];
    const room = (width: number, w0: number, w1: number) => width - fixed - bands - w0 - w1;
    expect(room(375, bold(word), bold("2027"))).toBeGreaterThanOrEqual(tickNeed); // per-lane: would fit
    expect(room(375, bold(word), bold(word))).toBeLessThan(tickNeed); // shared: does not
    const narrow = vc(events, { width: 375, axis: true });
    expect(narrow.ticks).toEqual([]);
    // The same data draws ticks once the shared floor fits.
    expect(room(500, bold(word), bold(word))).toBeGreaterThanOrEqual(tickNeed);
    const wide = vc(events, { width: 500, axis: true });
    expect(wide.ticks.length).toBeGreaterThanOrEqual(2);
    expect(Math.min(...wide.labels.map((x) => x.box.x0))).toBeGreaterThan(tickRight(wide));
  });

  it("draws one track for one lane or three lanes, exactly as with no lanes", () => {
    const e = [...TWO(), ev("2030", "c", { category: "c" })];
    const none = layoutTimeline(base(e, { orientation: "vertical", width: 375 }));
    const three = vc(e, { lanes: [...LANES, { key: "c", label: "C" }] });
    const one = vc(e, { lanes: [LANES[0]!] });
    expect(none.rules).toHaveLength(1);
    expect(JSON.stringify(three)).toBe(JSON.stringify(none));
    expect(JSON.stringify(one)).toBe(JSON.stringify(none));
  });
});

describe("vertical in wide space: readable text columns, centred (E2, Ruling 32)", () => {
  const LANES = [{ key: "a", label: "Legislation" }, { key: "b", label: "Implementation" }];
  const v = (events: LayoutEvent[], o: Partial<TimelineLayoutInput> = {}) =>
    layoutTimeline(base(events, { orientation: "vertical", width: 1000, ...o }));
  const A = (start: string, title: string, o: Partial<LayoutEvent> & { endStr?: string } = {}) => ev(start, title, { category: "a", ...o });
  const B = (start: string, title: string, o: Partial<LayoutEvent> & { endStr?: string } = {}) => ev(start, title, { category: "b", ...o });
  const TWO = () => [
    A("2025-07-04", "Bill signed into law, with a title long enough to wrap in any column it is given", { dateText: "Jul 4, 2025" }),
    B("2026-01-01", "Rulemaking period", { endStr: "2027-12-31", dateText: "Jan 1, 2026 – Dec 31, 2027" }),
    A("2027-06-01", "Technical corrections bill", { dateText: "Jun 1, 2027" }),
    B("2028-01-01", "Credits take effect, with a title long enough to wrap in any column it is given", { dateText: "Jan 1, 2028" }),
    A("2033-01-01", "Scheduled sunset", { dateText: "Jan 1, 2033" }),
  ];
  const long = Array.from({ length: 40 }, () => "word").join(" ");
  const cap = TL_GEOM.vTextColumnMax;
  const ruleX = (l: TimelineLayout): number => l.rules[0]!.x1;
  const rightX0 = (l: TimelineLayout): number =>
    Math.min(...l.labels.flatMap((x) => x.lines.filter((ln) => ln.anchor === "start").map((ln) => ln.x)));
  /** Horizontal extent of everything drawn: label boxes, markers, bars, ticks and lane names. */
  const inkOf = (l: TimelineLayout): [number, number] => {
    const nameW = (n: TimelineLayout["laneLabels"][number]) => Math.max(...n.lines.map((s) => timelineTextWidth(s, LANE_SIZE, 700)));
    const lo = [
      ...l.labels.map((x) => x.box.x0), ...l.markers.map((m) => m.cx - TL_GEOM.dotR), ...l.spans.map((s) => s.x),
      ...l.ticks.map((k) => k.x), ...l.laneLabels.map((n) => (n.anchor === "end" ? n.x - nameW(n) : n.x)),
    ];
    const hi = [
      ...l.labels.map((x) => x.box.x1), ...l.markers.map((m) => m.cx + TL_GEOM.dotR), ...l.spans.map((s) => s.x + s.w),
      ...l.ticks.map((k) => k.x + timelineTextWidth(k.text, TBL.size.axis, 500)),
      ...l.laneLabels.map((n) => (n.anchor === "end" ? n.x : n.x + nameW(n))),
    ];
    return [Math.min(...lo), Math.max(...hi)];
  };
  // The block starts 4px (V_EDGE) left of a marker's edge when nothing is left of the track, so
  // its ink can sit up to 2px right of the block's centre.
  const expectInkCentred = (l: TimelineLayout): void => {
    const [lo, hi] = inkOf(l);
    expect(Math.abs((lo + hi) / 2 - l.width / 2)).toBeLessThanOrEqual(2 + 1e-9);
    expect(lo).toBeGreaterThan(0);
  };
  const lineTexts = (l: TimelineLayout) => l.labels.map((x) => x.lines.map((ln) => ln.text));
  const X_KEYS = new Set(["x", "x0", "x1", "x2", "cx"]);
  // Every x in `a` is `b`'s moved by `dx` (a stem point's first coordinate included); every other
  // value is equal, the width aside.
  const expectShifted = (a: TimelineLayout, b: TimelineLayout, dx: number): void => {
    const walk = (p: unknown, q: unknown, key: string, path: string): void => {
      if (typeof p === "number") {
        if (X_KEYS.has(key)) expect(Math.abs(p - ((q as number) + dx)), path).toBeLessThan(1e-9);
        else expect(p, path).toBe(q);
      } else if (Array.isArray(p)) {
        expect((q as unknown[]).length, path).toBe(p.length);
        const isPoint = p.length === 2 && typeof p[0] === "number" && path.includes("points");
        p.forEach((x, i) => walk(x, (q as unknown[])[i], isPoint ? (i === 0 ? "x" : "y") : key, `${path}[${i}]`));
      } else if (p !== null && typeof p === "object") {
        for (const k of Object.keys(p)) {
          if (k !== "width") walk((p as Record<string, unknown>)[k], (q as Record<string, unknown>)[k], k, `${path}.${k}`);
        }
      } else {
        expect(p, path).toBe(q);
      }
    };
    walk(a, b, "", "layout");
  };

  it("caps the right column at vTextColumnMax and centres the track and column in the width", () => {
    expect(cap).toBe(360);
    for (const axis of [false, true]) {
      const l = v([...SPREAD(), ev("2130", long)], { axis });
      const x0 = rightX0(l);
      const widest = Math.max(...l.labels.map((x) => x.box.x1));
      // The long title fills the capped column to within a word, and never passes it.
      expect(widest).toBeLessThanOrEqual(x0 + cap + 1e-9);
      expect(widest).toBeGreaterThan(x0 + cap - 40);
      for (const lab of l.labels) expect(lab.box.x1 - lab.box.x0).toBeLessThanOrEqual(cap + 1e-9);
      // The block runs from the tick column (without one, from the marker's 4px edge pad, mirrored
      // on the right) to the widest wrapped label, and sits in the middle of the width.
      const left = axis ? l.ticks[0]!.x : ruleX(l) - TL_GEOM.dotR - 4;
      if (axis) expect(l.ticks.length).toBeGreaterThanOrEqual(2);
      expect((left + widest + (axis ? 0 : 4)) / 2).toBeCloseTo(500, 9);
      expect(left).toBeGreaterThan(250);
      for (const t of l.ticks) expect(t.x).toBe(left);
    }
  });

  it("adds extra width as equal margins on both sides, for every kind of vertical layout", () => {
    const outer = [
      ev("2020", "a", { endStr: "2030" }), ev("2025", `c, on the outer sub-track: ${long}`, { endStr: "2035" }),
      ev("2027", `a point on the rule ${long}`), ev("2040", "b"),
    ];
    const cases: Array<[LayoutEvent[], Partial<TimelineLayoutInput>]> = [
      [[...SPREAD(), ev("2130", long)], {}],
      [[...SPREAD(), ev("2130", long)], { axis: true }],
      [FIG7(), { axis: true }],
      [outer, {}],
      [TWO(), { lanes: LANES }],
      [TWO(), { lanes: LANES, axis: true }],
    ];
    for (const [events, o] of cases) {
      const a = v(events, { ...o, width: 1000 });
      const b = v(events, { ...o, width: 1600 });
      expect(b.width).toBe(1600);
      expectShifted(b, a, 300);
    }
  });

  it("caps the left column (outer-span and swapped labels) at vTextColumnMax too", () => {
    const lefty = [ev("2020", "a", { endStr: "2030" }), ev("2025", `c, on the outer sub-track: ${long}`, { endStr: "2035" }), ev("2040", "b")];
    const l = v(lefty, { width: 1400 });
    const leftLabel = l.labels.find((x) => x.lines[0]!.anchor === "end")!;
    // 40% of 1400 is 560: without the cap the column would take 560px of the unwrapped title.
    expect(leftLabel.box.x1 - leftLabel.box.x0).toBeLessThanOrEqual(cap + 1e-9);
    expect(leftLabel.box.x1 - leftLabel.box.x0).toBeGreaterThan(cap - 40);
    // The ink (the long left label to the short right ones) is centred.
    expectInkCentred(l);
    // FIG7 swaps labels left (E1) in wide space as at a phone width, and is centred too.
    const f = v(FIG7(), { width: 1000 });
    expect(f.labels.some((x) => x.lines[0]!.anchor === "end")).toBe(true);
    for (const lab of f.labels) expect(lab.box.x1 - lab.box.x0).toBeLessThanOrEqual(cap + 1e-9);
    expectInkCentred(f);
  });

  it("caps both lane columns and centres the two tracks", () => {
    const l = v(TWO(), { lanes: LANES });
    const [r0, r1] = [l.rules[0]!.x1, l.rules[1]!.x1];
    expectInkCentred(l);
    for (const lab of l.labels) expect(lab.box.x1 - lab.box.x0).toBeLessThanOrEqual(cap + 1e-9);
    // Each lane's long title fills its capped column to within a word.
    const lane0 = l.labels.filter((x) => x.category === "a");
    const lane1 = l.labels.filter((x) => x.category === "b");
    expect(Math.max(...lane0.map((x) => x.box.x1)) - Math.min(...lane0.map((x) => x.box.x0))).toBeGreaterThan(cap - 40);
    expect(Math.max(...lane1.map((x) => x.box.x1)) - Math.min(...lane1.map((x) => x.box.x0))).toBeGreaterThan(cap - 40);
    // Lane names move with their tracks.
    expect(l.laneLabels.map((n) => n.x)).toEqual([r0 - 6, r1 + 6]);
  });

  it("moves the block continuously between reflows, 280-1400 (Ruling 43)", () => {
    // A position may change only where the text visibly reflows — some label's lines, or its side,
    // change. Between such widths a 1px wider chart moves the rule by at most 2px.
    const lanesLong = [
      ev("2025", `Bill signed into law ${long}`, { category: "a" }), ev("2026", "Rulemaking", { category: "b", endStr: "2027" }),
      ev("2027", "Technical corrections bill", { category: "a" }), ev("2028", `Credits take effect ${long}`, { category: "b" }),
    ];
    const outer = () => [ev("2020", "a", { endStr: "2030" }), ev("2025", `c, on the outer sub-track: ${long}`, { endStr: "2035" }), ev("2027", "a point"), ev("2040", "b")];
    const cases: Array<[string, () => LayoutEvent[], Partial<TimelineLayoutInput>]> = [
      ["FIG7", FIG7, {}], ["FIG7 axis", FIG7, { axis: true }], ["outer", outer, {}], ["outer axis", outer, { axis: true }],
      ["lanes", () => lanesLong, { lanes: LANES }], ["lanes axis", () => lanesLong, { lanes: LANES, axis: true }],
    ];
    const text = (l: TimelineLayout) => JSON.stringify(l.labels.map((x) => [x.id, x.lines[0]!.anchor, x.lines.map((ln) => ln.text)]));
    for (const [name, mk, o] of cases) {
      const events = mk();
      let prev: TimelineLayout | null = null;
      let steps = 0;
      for (let w = 280; w <= 1400; w++) {
        const l = v(events, { ...o, width: w });
        if (prev && text(l) === text(prev)) {
          steps++;
          expect(Math.abs(ruleX(l) - ruleX(prev)), `${name} @${w}`).toBeLessThanOrEqual(2);
        }
        prev = l;
      }
      expect(steps, name).toBeGreaterThan(900);
    }
  });

  it("hugs each column's widest line past the cap, so the ink is centred, without changing any wrap (Ruling 39)", () => {
    const outer = [ev("2020", "a", { endStr: "2030" }), ev("2025", "c, on the outer sub-track", { endStr: "2035" }), ev("2027", "a point"), ev("2040", "b")];
    const shortLanes = [A("2025", "Signed"), B("2026", "Rules", { endStr: "2027" }), A("2027", "Fix"), B("2028", "Effective")];
    const cases: Array<[LayoutEvent[], Partial<TimelineLayoutInput>]> = [
      [SPREAD(), {}], [SPREAD(), { axis: true }], [FIG7(), {}], [FIG7(), { axis: true }], [outer, {}], [outer, { axis: true }],
      [shortLanes, { lanes: LANES }], [shortLanes, { lanes: LANES, axis: true }], [TWO(), { lanes: LANES }],
    ];
    for (const [events, o] of cases) {
      const wide = v(events, { ...o, width: 1400 });
      expectInkCentred(wide);
      // From 900px (where 40% of the width no longer narrows the left column below the cap) every
      // width wraps each label exactly as 1400 does, and as a full 360px column would.
      for (let w = 900; w <= 1400; w += 10) expect(lineTexts(v(events, { ...o, width: w }))).toEqual(lineTexts(wide));
    }
    // Short labels leave a block much narrower than a 360px column would.
    const [lo, hi] = inkOf(v(SPREAD().map((e) => ({ ...e, title: "x" })), { width: 1000 }));
    expect(hi - lo).toBeLessThan(120);
    // A hugged lane name wraps as it would in a full column: on one line.
    const named = v(shortLanes, { lanes: [{ key: "a", label: "Legislation and statute" }, { key: "b", label: "Implementation" }], width: 1400 });
    expect(named.laneLabels.map((n) => n.lines.length)).toEqual([1, 1]);
    expectInkCentred(named);
  });

  it("never lets a date unit widen a column past the cap: the unit is split, its dash kept (Ruling 40)", () => {
    const word = "W".repeat(65);
    for (const dateText of [word, `${word} – 2030`]) {
      const l = v([ev("2026", "a"), ev("2050", "b", { dateText }), ev("2090", "c")], { width: 1000 });
      const lab = l.labels.find((x) => x.lines.some((ln) => ln.text.startsWith("WWW")))!;
      expect(lab.box.x1 - lab.box.x0).toBeLessThanOrEqual(cap + 1e-9);
      const dates = lab.lines.filter((ln) => ln.role === "date").map((ln) => ln.text);
      expect(dates.length).toBeGreaterThan(1);
      expect(dates.join("").replace(/\s/g, "")).toBe(dateText.replace(/\s/g, ""));
      for (const d of dates) {
        expect(d.trim()).not.toBe("–");
        expect(d.startsWith("–")).toBe(false);
        expect(d).toBe(d.trim());
      }
      for (const x of l.labels) {
        expect(x.box.x0).toBeGreaterThanOrEqual(0);
        expect(x.box.x1).toBeLessThanOrEqual(1000);
      }
    }
    // Lane columns likewise.
    const lanes = v([A("2026", "a", { dateText: word }), B("2027", "b")], { lanes: LANES, width: 1400 });
    for (const x of lanes.labels) expect(x.box.x1 - x.box.x0).toBeLessThanOrEqual(cap + 1e-9);
  });

  it("lays out at budgetWidth and centres the block in width when it fits, else at width", () => {
    const events = [...SPREAD(), ev("2130", long)];
    const at560 = v(events, { width: 560, axis: true });
    const trimmed = v(events, { width: 440, budgetWidth: 560, axis: true });
    expect(trimmed.width).toBe(440);
    expectShifted(trimmed, at560, -60);
    // Lane columns fill 560, which does not fit 420: laid out at 420 as if no budget were given.
    const two = TWO();
    expect(JSON.stringify(v(two, { width: 420, budgetWidth: 560, lanes: LANES }))).toBe(JSON.stringify(v(two, { width: 420, lanes: LANES })));
    // Horizontal ignores it.
    const fig7 = FIG7();
    expect(JSON.stringify(layoutTimeline(base(fig7, { budgetWidth: 1400 })))).toBe(JSON.stringify(layoutTimeline(base(fig7))));
  });

  it("leaves every phone-width vertical layout as pinned relative to its track (280-440; Ruling 43 moves only the block)", () => {
    // Pinned at c60f9a8, before Ruling 43; re-pinned at Task 16b, whose measured Figtree widths
    // (Ruling 45) change every wrap and position.
    const outer = () => [ev("2020", "a", { endStr: "2030" }), ev("2025", "c, on the outer sub-track", { endStr: "2035" }), ev("2027", "a point on the rule"), ev("2040", "b")];
    const out: string[] = [];
    for (let w = 280; w <= 440; w += 8) {
      for (const axis of [false, true]) {
        nextId = 0;
        out.push(JSON.stringify(relative(v([...SPREAD(), ev("2130", long)], { width: w, axis }))));
        out.push(JSON.stringify(relative(v(FIG7(), { width: w, axis }))));
        out.push(JSON.stringify(relative(v(outer(), { width: w, axis }))));
        out.push(JSON.stringify(relative(v(TWO(), { width: w, axis, lanes: LANES }))));
      }
    }
    expect(createHash("sha256").update(out.join("\n")).digest("hex").slice(0, 16)).toBe("de4dfde56eeba34d");
  });
});

describe("vertical: every column hugs its placed content and the block is centred (Ruling 43)", () => {
  const LANES = [{ key: "a", label: "Legislation" }, { key: "b", label: "Implementation" }];
  const v = (events: LayoutEvent[], o: Partial<TimelineLayoutInput> = {}) =>
    layoutTimeline(base(events, { orientation: "vertical", width: 728, ...o }));
  const A = (start: string, title: string, o: Partial<LayoutEvent> & { endStr?: string } = {}) => ev(start, title, { category: "a", ...o });
  const B = (start: string, title: string, o: Partial<LayoutEvent> & { endStr?: string } = {}) => ev(start, title, { category: "b", ...o });
  const long = Array.from({ length: 40 }, () => "word").join(" ");
  // Fresh events each call, ids from 0, so layouts are comparable across calls.
  const DATA: Record<string, [() => LayoutEvent[], Partial<TimelineLayoutInput>]> = {
    spreadLong: [() => [...SPREAD(), ev("2130", long)], {}],
    fig7: [FIG7, {}],
    fig7Axis: [FIG7, { axis: true }],
    outerLong: [() => [ev("2020", "a", { endStr: "2030" }), ev("2025", `outer: ${long}`, { endStr: "2035" }), ev("2027", "pt"), ev("2040", "b")], {}],
    outerLongAxis: [() => [ev("2020", "a", { endStr: "2030" }), ev("2025", `outer: ${long}`, { endStr: "2035" }), ev("2027", "pt"), ev("2040", "b")], { axis: true }],
    shortLanes: [() => [A("2025", "Signed"), B("2026", "Rules", { endStr: "2027" }), A("2027", "Fix"), B("2028", "Effective")], { lanes: LANES }],
    shortLanesAxis: [() => [A("2025", "Signed"), B("2026", "Rules", { endStr: "2027" }), A("2027", "Fix"), B("2028", "Effective")], { lanes: LANES, axis: true }],
    longLanes: [() => [A("2025", long), B("2026", `Rules ${long}`, { endStr: "2027" }), A("2027", "Fix"), B("2028", "Effective")], { lanes: LANES }],
  };
  const make = (name: string, o: Partial<TimelineLayoutInput>) => {
    const [mk, base0] = DATA[name]!;
    nextId = 0;
    return v(mk(), { ...base0, ...o });
  };
  it("centres the ink of every kind of vertical layout, cap binding or not, with the ticks against it", () => {
    for (const name of Object.keys(DATA)) {
      for (const width of [375, 728, 800, 900, 1100]) {
        const l = make(name, { width });
        const [lo, hi] = inkOf(l);
        expect(Math.abs((lo + hi) / 2 - width / 2), `${name} @${width}`).toBeLessThanOrEqual(2);
        for (const k of l.ticks) expect(k.x).toBeCloseTo(lo, 9);
      }
    }
    // Short labels leave a narrow block: nothing reserves the unused column width.
    const [lo, hi] = inkOf(make("shortLanesAxis", { width: 900 }));
    expect(hi - lo).toBeLessThan(260);
  });

  it("floors every column's date word at the cap too: an oversized unit never costs the tick column (Ruling 40)", () => {
    const word = "W".repeat(65);
    expect(timelineTextWidth(word, 13, 700)).toBeGreaterThan(TL_GEOM.vTextColumnMax);
    // Lanes need two columns at the (capped) floor beside the tick column: 2 x 360 + the tracks
    // leaves it room from ~830px (at 800 it is still correctly omitted).
    for (const width of [900, 1000]) {
      nextId = 0;
      const lanes = v([A("2026", "a", { dateText: word }), B("2027", "b"), A("2035", "c")], { lanes: LANES, axis: true, width });
      expect(lanes.ticks.length, `lanes @${width}`).toBeGreaterThanOrEqual(2);
      nextId = 0;
      const single = v([ev("2026", "a"), ev("2050", "b", { dateText: word }), ev("2090", "c")], { axis: true, width: width - 480 });
      expect(single.ticks.length, `single @${width - 480}`).toBeGreaterThanOrEqual(2);
      for (const l of [lanes, single]) for (const x of l.labels) expect(x.box.x1 - x.box.x0).toBeLessThanOrEqual(TL_GEOM.vTextColumnMax + 1e-9);
    }
  });

  it("leaves wrapping and every position relative to the track as pinned, at every width", () => {
    // Pinned at 1bbc859; re-pinned at Task 16b for the measured Figtree widths (Ruling 45).
    const out: string[] = [];
    for (const name of Object.keys(DATA)) {
      for (let w = 280; w <= 1400; w += 8) out.push(JSON.stringify(relative(make(name, { width: w }))));
    }
    expect(createHash("sha256").update(out.join("\n")).digest("hex").slice(0, 16)).toBe("ce344858b9d58fe6");
  });
});

describe("hard breaks never split a grapheme (F5)", () => {
  // A word wider than the frame is split into chunks (hardBreak, hardBreakDate, a lane name's
  // hardBreak). Cutting by code point could strand a regional-indicator half of a flag, a skin-tone
  // modifier, a ZWJ part, a keycap's combining mark or a combining accent at the start of a line.
  const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
  const RUN = "🇺🇸👍🏽👨‍👩‍👧1️⃣🇬🇧é🧔🏻‍♂️".repeat(5);
  /** Lines that rejoin to `text` and each start on one of its grapheme boundaries. */
  const expectWholeGraphemes = (lines: string[], text: string): void => {
    expect(lines.join("")).toBe(text);
    const bounds = new Set([...seg.segment(text)].map((s) => s.index));
    let at = 0;
    for (const ln of lines) {
      expect(bounds.has(at), `line "${ln}" starts mid-grapheme`).toBe(true);
      at += ln.length;
    }
  };
  it("splits titles, dates and lane names only between graphemes", () => {
    let splits = 0;
    for (const orientation of ["horizontal", "vertical"] as const) {
      for (let width = 280; width <= 440; width += 8) {
        const lanes = [{ key: "a", label: RUN }, { key: "b", label: "Second" }];
        const e = ev("2020", RUN, { category: "a", dateText: `${RUN} –`, ongoing: true });
        const l = layoutTimeline(base([e, ev("2040", "z", { category: "b" })], { width, orientation, lanes }));
        const lab = labelOf(l, e.id);
        const title = lab.lines.filter((ln) => ln.role === "title").map((ln) => ln.text);
        expectWholeGraphemes(title, RUN);
        const date = lab.lines.filter((ln) => ln.role === "date").map((ln) => ln.text);
        expectWholeGraphemes(date, `${RUN} –`);
        const lane = l.laneLabels.find((n) => n.text === RUN)!;
        expectWholeGraphemes(lane.lines, RUN);
        splits += title.length + date.length + lane.lines.length - 3;
      }
    }
    expect(splits).toBeGreaterThan(0); // the runs really were split
  });
});
