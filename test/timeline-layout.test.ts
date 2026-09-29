import { describe, it, expect } from "vitest";
import { layoutTimeline, plainFirstFitFits, TL_GEOM, LANE_SIZE, LANE_LINE_H, type LayoutEvent, type TimelineLayoutInput, type TimelineLayout } from "../src/engine/timeline-layout";
import { parseDate } from "../src/spec/parse-time";
import { estimateLabelWidth } from "../src/engine/axes";
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
        const w = estimateLabelWidth(t.text, TBL.size.axis);
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
      // Two labels that each cover the other's stem: the same fallback, and still fits.
      const lane = [{ key: "p", label: "Policy" }];
      const pair = layoutTimeline(base([
        ev("2026", "Policy begins", { category: "p" }), ev("2030", "First cohort born", { category: "p" }), ev("2095", "z", { category: "p" }),
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
});

describe("vertical layout", () => {
  const v = (events: LayoutEvent[], o: Partial<TimelineLayoutInput> = {}) =>
    layoutTimeline(base(events, { orientation: "vertical", width: 360, ...o }));
  const datesOf = (l: TimelineLayout) => l.labels.flatMap((x) => x.lines.filter((ln) => ln.role === "date"));

  it("runs oldest at top, one rule, dates right-aligned in a left gutter", () => {
    const l = v(FIG7());
    const ys = l.order.map((id) => l.markers.find((m) => m.id === id)!.cy);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    expect(l.rules).toHaveLength(1);
    const dates = datesOf(l);
    expect(dates.every((d) => d.anchor === "end" && d.x < l.rules[0]!.x1)).toBe(true);
    const titles = l.labels.flatMap((x) => x.lines.filter((ln) => ln.role === "title"));
    expect(titles.every((t) => t.anchor === "start" && t.x > l.rules[0]!.x1)).toBe(true);
  });

  it("is at least 400px tall and grows with a dense cluster instead of overlapping", () => {
    expect(v(FIG7()).height).toBeGreaterThanOrEqual(400);
    // Thirty events in one January against a far 2030 event: proportionally they would all sit in
    // the top few px, so only the sweep keeps them apart. The last label wraps, so it hangs below
    // the end of the axis and the height must grow to hold it.
    const dense = Array.from({ length: 30 }, (_, i) => ev(`2026-01-${String(i + 1).padStart(2, "0")}`, `Event ${i} with a title that wraps onto a second line`));
    const l = v([...dense, ev("2030", "far, with a title long enough to wrap onto a second line")]);
    expect(l.height).toBeGreaterThan(400);
    const boxes = l.labels.map((x) => x.box);
    for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.y0).toBeGreaterThanOrEqual(boxes[i - 1]!.y1);
    for (const b of boxes) expect(b.y1).toBeLessThanOrEqual(l.height);
  });

  it("draws an elbow leader only for a displaced label", () => {
    const b = ev("2026-01-02", "b, pushed down by a");
    const l = v([ev("2026", "a"), b, ev("2090", "far")]);
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

  it("widens the gutter for span sub-tracks so dates never sit on a bar", () => {
    const one = v([ev("2020", "a", { endStr: "2030" }), ev("2040", "b")]);
    const two = v([ev("2020", "a", { endStr: "2030" }), ev("2025", "c", { endStr: "2035" }), ev("2040", "b")]);
    expect(two.rules[0]!.x1).toBeGreaterThan(one.rules[0]!.x1);
    const leftmostBar = Math.min(...two.spans.map((s) => s.x));
    expect(leftmostBar).toBeLessThan(two.rules[0]!.x1 - TL_GEOM.spanH); // c really is left of the rule
    expect(Math.max(...datesOf(two).map((d) => d.x))).toBeLessThanOrEqual(leftmostBar);
  });

  it("reserves a tick column left of the dates, sized to the widest tick, with axis:true", () => {
    const tickRight = (l: TimelineLayout) => Math.max(...l.ticks.map((t) => t.x + estimateLabelWidth(t.text, TBL.size.axis)));
    // Date text is bold (~8% wider than the estimator's regular-weight calibration).
    const dateLeft = (l: TimelineLayout) => Math.min(...datesOf(l).map((d) => d.x - estimateLabelWidth(d.text, 13) * 1.08));
    expect(v(FIG7()).ticks).toEqual([]);
    // Month-scale ticks ("October") are wider than a year's: a fixed-width column would collide.
    const months = Array.from({ length: 12 }, (_, i) =>
      ev(`2026-${String(i + 1).padStart(2, "0")}-01`, `m${i}`, { dateText: `Mon ${i + 1}, 2026` }));
    for (const l of [v(FIG7(), { axis: true }), v(months, { axis: true })]) {
      expect(l.ticks.length).toBeGreaterThanOrEqual(2);
      expect(l.ticks.every((t) => t.anchor === "start" && t.x >= 0)).toBe(true);
      expect(dateLeft(l)).toBeGreaterThan(tickRight(l));
    }
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

  it("breaks a date range after the en dash before breaking inside a date", () => {
    const e = ev("2017-12-22", "TCJA", { endStr: "2025-12-31", dateText: "Dec 22, 2017 – Dec 31, 2025" });
    const l = v([e, ev("2034", "z", { dateText: "Jan 1, 2034" })]);
    expect(labelOf(l, e.id).lines.filter((ln) => ln.role === "date").map((ln) => ln.text)).toEqual([
      "Dec 22, 2017 –", "Dec 31, 2025",
    ]);
  });

  it("starts a displaced outer-sub-track span's leader at its own bar", () => {
    const a = ev("2020-01-01", "a", { endStr: "2030" });
    const c = ev("2020-01-05", "c, pushed down by a", { endStr: "2035" });
    const l = v([a, c, ev("2090", "far")]);
    const sa = l.spans.find((s) => s.id === a.id)!;
    const sc = l.spans.find((s) => s.id === c.id)!;
    expect(sc.x).toBeLessThan(sa.x); // c is on sub-track 1, left of a
    const pts = l.stems.find((s) => s.id === c.id)!.points;
    const xLeg = l.rules[0]!.x1 + TL_GEOM.dotR + 2;
    // Out of c's own bar's right edge at its start, across to the leg beside the rule, down, in.
    expect(pts[0]).toEqual([sc.x + sc.w, sc.y]);
    expect(pts[1]).toEqual([xLeg, sc.y]);
    expect(pts[2]![0]).toBe(xLeg);
    expect(pts[3]![1]).toBe(pts[2]![1]);
    expect(pts[3]![0]).toBeLessThan(labelOf(l, c.id).box.x0);
    // A displaced sub-track-0 span keeps the leader that starts beside the rule.
    const b = ev("2020-01-01", "b", { endStr: "2021" });
    const d = ev("2021-01-01", "d, pushed down by b", { endStr: "2022" });
    const l0 = v([ev("2020-01-01", "p"), b, d, ev("2090", "far")]);
    for (const s of l0.stems) expect(s.points[0]![0]).toBe(l0.rules[0]!.x1 + TL_GEOM.dotR + 2);
  });
});

describe("vertical layout at narrow widths (left region capped at 45%)", () => {
  const v = (events: LayoutEvent[], o: Partial<TimelineLayoutInput> = {}) =>
    layoutTimeline(base(events, { orientation: "vertical", ...o }));
  const W = 280;
  const dateLines = (l: TimelineLayout) => l.labels.flatMap((x) => x.lines.filter((ln) => ln.role === "date"));
  // Bold date text: the estimator is calibrated on regular weight, bold runs ~8% wider.
  const dateLeft = (d: { x: number; text: string }) => d.x - estimateLabelWidth(d.text, 13) * 1.08;
  const leftmostMark = (l: TimelineLayout) => Math.min(l.rules[0]!.x1, ...l.spans.map((s) => s.x));
  const inFrame = (l: TimelineLayout) => {
    for (const lab of l.labels) {
      expect(lab.box.x0).toBeGreaterThanOrEqual(0);
      expect(lab.box.x1).toBeLessThanOrEqual(W + 1e-9);
      for (const ln of lab.lines) {
        expect(ln.x).toBeGreaterThanOrEqual(0);
        expect(ln.x).toBeLessThanOrEqual(W);
      }
    }
    for (const d of dateLines(l)) expect(dateLeft(d)).toBeGreaterThanOrEqual(-1e-9);
    // Rows still stack: a wrapped date is part of its row, so the next row starts below it.
    for (let i = 1; i < l.labels.length; i++) expect(l.labels[i]!.box.y0).toBeGreaterThanOrEqual(l.labels[i - 1]!.box.y1);
    for (const lab of l.labels) for (const ln of lab.lines) expect(ln.y).toBeLessThanOrEqual(lab.box.y1);
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
  const sixSeptembers = () => Array.from({ length: 6 }, (_, i) =>
    ev(`2026-0${i + 1}-01`, `Event ${i} title`, { dateText: "September 30, 2026" }));

  it("wraps long dates between words inside a capped gutter, keeping every label in the frame", () => {
    const events = sixSeptembers();
    const l = v(events, { width: W, axis: true });
    expect(allFinite(l)).toBe(true);
    inFrame(l);
    wholeWords(l, events);
    const textX = l.labels[0]!.box.x0;
    expect(textX).toBeLessThanOrEqual(0.45 * W + 1e-9); // the whole left region, rule and gaps included
    const dates = dateLines(l);
    expect(dates.length).toBeGreaterThan(events.length); // the dates did wrap
    expect(dates.every((d) => d.anchor === "end" && d.x <= leftmostMark(l))).toBe(true);
    // Month ticks ("February") do not fit beside a whole-word date gutter at 280: they are omitted
    // rather than breaking the dates mid-word.
    expect(l.ticks).toEqual([]);
  });

  it("omits the vertical tick column only when it does not fit", () => {
    for (const width of [W, 360]) {
      const l = v(FIG7(), { width, axis: true });
      expect(l.ticks.length).toBeGreaterThanOrEqual(2);
      const tickRight = Math.max(...l.ticks.map((t) => t.x + estimateLabelWidth(t.text, TBL.size.axis)));
      expect(Math.min(...dateLines(l).map(dateLeft))).toBeGreaterThan(tickRight);
      expect(l.labels[0]!.box.x0).toBeLessThanOrEqual(0.45 * width + 1e-9);
    }
  });

  it("compresses a crowded sub-track band instead of pushing text off-canvas", () => {
    const spans = Array.from({ length: 20 }, (_, i) =>
      ev(`${1990 + i}`, `Span ${i}`, { endStr: `${2030 + i}`, dateText: `${1990 + i} – ${2030 + i}` }));
    const l = v(spans, { width: W });
    expect(allFinite(l)).toBe(true);
    expect(l.spans).toHaveLength(20);
    inFrame(l);
    // The dash is now a real break point (D1's spaced range), so a crowded band no longer forces
    // the whole range onto one line: it wraps there — "<start> –" then "<end>" — never mid-date,
    // while the sub-track band still compresses to its floor rather than pushing anything off-canvas.
    wholeWords(l, spans);
    const dates = dateLines(l);
    expect(dates).toHaveLength(40);
    for (let i = 0; i < dates.length; i += 2) expect(dates[i]!.text.endsWith(" –")).toBe(true);
    for (const s of l.spans) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.w).toBeCloseTo(3, 6); // at the V_MIN_BAR floor
    }
    // Twenty distinct sub-tracks, none overlapping another.
    const xs = [...new Set(l.spans.map((s) => s.x))].sort((a, b) => a - b);
    expect(xs).toHaveLength(20);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(l.spans[0]!.w + 1 - 1e-9);
    expect(Math.max(...dateLines(l).map((d) => d.x))).toBeLessThanOrEqual(leftmostMark(l));
  });

  it("leaves layouts that fit under the cap exactly as they were", () => {
    // Values recorded from the layout before the cap (commit 0d9dca0).
    const digest = (l: TimelineLayout) => ({
      rule: l.rules[0], height: l.height,
      boxes: l.labels.map((x) => [x.box.x0, x.box.y0, x.box.x1, x.box.y1]),
      lines: l.labels.map((x) => x.lines.map((ln) => [ln.x, ln.y, ln.text])),
      spans: l.spans.map((s) => [s.x, s.y, s.w, s.h]), ticks: l.ticks.map((t) => [t.x, t.y, t.text]),
    });
    const close = (a: unknown, b: unknown): void => {
      if (typeof b === "number") expect(a as number).toBeCloseTo(b, 9);
      else if (b !== null && typeof b === "object") {
        expect(Object.keys(a as object)).toEqual(Object.keys(b));
        for (const k of Object.keys(b)) close((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]);
      } else expect(a).toBe(b);
    };
    const at360 = (e: LayoutEvent[], axis = false) => v(e, { width: 360, axis });
    close(digest(at360(FIG7())), JSON.parse(String.raw`{"rule":{"x1":72.5,"y1":8,"x2":72.5,"y2":400},"height":408,"boxes":[[87,0,172.8,16],[87,26,344.40000000000003,56],[87,161.38909610348387,232.20000000000002,177.38909610348387],[87,187.38909610348387,219,203.38909610348387],[87,384,219,400]],"lines":[[[56,13,"2026"],[87,12,"Policy begins"]],[[56,39,"2030"],[87,38,"First cohort born under fully phased-in"],[87,53,"policy"]],[[56,174.38909610348387,"2055"],[87,173.38909610348387,"Annual projection ends"]],[[56,200.38909610348387,"2057"],[87,199.38909610348387,"That cohort turns 27"]],[[56,397,"2095"],[87,396,"That cohort turns 65"]]],"spans":[],"ticks":[]}`));
    close(digest(at360(FIG7(), true)), JSON.parse(String.raw`{"rule":{"x1":103.6,"y1":8,"x2":103.6,"y2":400},"height":408,"boxes":[[118.1,0,203.9,16],[118.1,26,309.5,56],[118.1,161.38909610348387,263.3,177.38909610348387],[118.1,187.38909610348387,250.1,203.38909610348387],[118.1,384,250.1,400]],"lines":[[[87.1,13,"2026"],[118.1,12,"Policy begins"]],[[87.1,39,"2030"],[118.1,38,"First cohort born under fully"],[118.1,53,"phased-in policy"]],[[87.1,174.38909610348387,"2055"],[118.1,173.38909610348387,"Annual projection ends"]],[[87.1,200.38909610348387,"2057"],[118.1,199.38909610348387,"That cohort turns 27"]],[[87.1,397,"2095"],[118.1,396,"That cohort turns 65"]]],"spans":[],"ticks":[[0,89.90619792079994,"2040"],[0,201.211649869058,"2060"],[0,312.5171018173161,"2080"]]}`));
    close(
      digest(at360([ev("2020", "a", { endStr: "2030" }), ev("2025", "c", { endStr: "2035" }), ev("2040", "b")])),
      JSON.parse(String.raw`{"rule":{"x1":82,"y1":8,"x2":82,"y2":400},"height":408,"boxes":[[96.5,0,103.1,16],[96.5,96.0394250513347,103.1,112.0394250513347],[96.5,384,103.1,400]],"lines":[[[56,13,"2020"],[96.5,12,"a"]],[[56,109.0394250513347,"2025"],[96.5,108.0394250513347,"c"]],[[56,397,"2040"],[96.5,396,"b"]]],"spans":[[78,8,8,192.02628336755646],[68,104.0394250513347,8,191.97371663244348]],"ticks":[]}`),
    );
  });
});
