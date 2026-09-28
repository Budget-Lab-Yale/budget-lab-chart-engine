import { describe, it, expect } from "vitest";
import { layoutTimeline, TL_GEOM, type LayoutEvent, type TimelineLayoutInput, type TimelineLayout } from "../src/engine/timeline-layout";
import { parseDate } from "../src/spec/parse-time";

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
const noNaN = (l: TimelineLayout): boolean => !/NaN/.test(JSON.stringify(l));
const labelOf = (l: TimelineLayout, id: number) => l.labels.find((x) => x.id === id)!;
const ruleY = (l: TimelineLayout): number => l.rules[0]!.y1;

// The reference image: five milestones, 2026–2095.
const FIG7 = () => [
  ev("2026", "Policy begins"),
  ev("2030", "First cohort born under fully phased-in policy"),
  ev("2055", "Annual projection ends"),
  ev("2057", "That cohort turns 27"),
  ev("2095", "That cohort turns 65"),
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
    expect(noNaN(l)).toBe(true);
    expect(l.markers[0]!.cx).toBeCloseTo(450, 0);
  });

  it("separates two events on the same date", () => {
    const a = ev("2026", "Alpha"), b = ev("2026", "Beta");
    const l = layoutTimeline(base([a, b, ev("2090", "z")]));
    expect(overlaps(labelOf(l, a.id).box, labelOf(l, b.id).box)).toBe(false);
  });

  it("widens a box to an unbreakable word, inside the frame", () => {
    const l = layoutTimeline(base([ev("2026", "Supercalifragilisticexpialidociously-long-unbroken-token"), ev("2090", "z")], { width: 320 }));
    expect(noNaN(l)).toBe(true);
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
});
