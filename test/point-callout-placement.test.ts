// @vitest-environment jsdom
//
// Auto-placement for point-callout labels: a callout WITHOUT an explicit dx/dy is moved vertically
// off any other callout label it would sit on; one WITH an explicit dx or dy is pinned and the
// others route around it. The helper is pure and estimate-based (no getBBox), so live HTML, PNG
// export and SSR agree. Its "no collision ⇒ input returned unchanged" property is what keeps every
// pre-existing golden byte-identical — the goldens themselves are the other half of that proof.
import { describe, it, expect } from "vitest";
import { placePointCallouts, type CalloutBox } from "../src/engine/callout-placement";
import { renderChart } from "../src/engine/index";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const ROW_H = 13;
const OPTS = { gap: 6, lo: 30, hi: 330 };
const box = (x0: number, y: number, w = 40, fixed = false, h = 13): CalloutBox => ({ x0, x1: x0 + w, y, h, fixed });

describe("placePointCallouts (pure helper)", () => {
  it("two overlapping defaults land on distinct rows, vertical order preserved", () => {
    const ys = placePointCallouts([box(100, 200), box(110, 204)], OPTS);
    expect(Math.abs(ys[0]! - ys[1]!)).toBeGreaterThanOrEqual(ROW_H);
    expect(ys[0]!).toBeLessThan(ys[1]!);
  });

  it("two non-overlapping boxes come back as the input positions, bit-for-bit", () => {
    const a = box(100, 200.123456789);
    const b = box(100, 260.987654321); // same x, far apart vertically
    const c = box(300, 200.123456789); // same y, far apart horizontally
    const ys = placePointCallouts([a, b, c], OPTS);
    expect(ys[0]).toBe(a.y);
    expect(ys[1]).toBe(b.y);
    expect(ys[2]).toBe(c.y);
  });

  it("boxes closer than the horizontal gap but clear vertically do not move", () => {
    const a = box(100, 200, 40);
    const b = box(143, 215, 40); // 3px apart horizontally (< gap 6), 15px apart vertically (> rowH)
    expect(placePointCallouts([a, b], OPTS)).toEqual([a.y, b.y]);
  });

  it("a lone label near the frame edge is not clamped — nothing collided, so nothing moves", () => {
    const a = box(100, OPTS.lo - 10);
    expect(placePointCallouts([a], OPTS)).toEqual([a.y]);
    expect(placePointCallouts([a, box(400, 200)], OPTS)).toEqual([a.y, 200]);
  });

  it("one movable + one fixed overlapping: the fixed one is unchanged, the movable one moves clear", () => {
    const fixed = box(100, 200, 40, true);
    const movable = box(105, 203);
    const ys = placePointCallouts([fixed, movable], OPTS);
    expect(ys[0]).toBe(fixed.y);
    expect(ys[1]).not.toBe(movable.y);
    expect(Math.abs(ys[1]! - fixed.y)).toBeGreaterThanOrEqual(ROW_H);
  });

  it("two movables that spread onto a fixed label step a row past it", () => {
    // A and B collide and spread; the lower one lands on the pinned C, so it is nudged below C.
    const a = box(100, 200);
    const b = box(100, 204);
    const c = box(100, 200 + 13, 40, true);
    const ys = placePointCallouts([a, b, c], OPTS);
    expect(ys[2]).toBe(c.y);
    for (const i of [0, 1]) {
      expect(Math.abs(ys[i]! - c.y)).toBeGreaterThanOrEqual(ROW_H);
    }
  });

  it("a group the clamp slides onto a third label is spread again, so all three end clear", () => {
    // Codex's case: 325/328 collide and clamp to 317/330; 305 was clear of both but is now 12px
    // from 317. A second pass groups all three.
    const ys = placePointCallouts([box(100, 325), box(100, 328), box(100, 305)], OPTS);
    const sorted = [...ys].sort((p, q) => p - q);
    expect(sorted[1]! - sorted[0]!).toBeGreaterThanOrEqual(ROW_H);
    expect(sorted[2]! - sorted[1]!).toBeGreaterThanOrEqual(ROW_H);
    expect(Math.max(...ys)).toBeLessThanOrEqual(OPTS.hi);
  });

  it("a movable between two fixed labels ends clear of BOTH, not bounced from one onto the other", () => {
    const f1 = box(100, 200, 40, true);
    const f2 = box(100, 220, 40, true);
    const m = box(100, 205);
    const ys = placePointCallouts([f1, f2, m], OPTS);
    expect(ys[0]).toBe(f1.y);
    expect(ys[1]).toBe(f2.y);
    expect(Math.abs(ys[2]! - f1.y)).toBeGreaterThanOrEqual(ROW_H);
    expect(Math.abs(ys[2]! - f2.y)).toBeGreaterThanOrEqual(ROW_H);
  });

  it("two-line labels spread by their full height, and a mixed pair by half of each", () => {
    const tall = placePointCallouts([box(100, 200, 40, false, 26), box(100, 204, 40, false, 26)], OPTS);
    expect(Math.abs(tall[0]! - tall[1]!)).toBeGreaterThanOrEqual(26);
    const mixed = placePointCallouts([box(100, 200, 40, false, 26), box(100, 204)], OPTS);
    expect(Math.abs(mixed[0]! - mixed[1]!)).toBeGreaterThanOrEqual((26 + 13) / 2);
    // Two two-line boxes 20px apart do NOT touch on the old one-row rule but collide on height.
    const clear = placePointCallouts([box(100, 200, 40, false, 26), box(100, 230, 40, false, 26)], OPTS);
    expect(clear).toEqual([200, 230]);
  });

  it("a movable on a fixed label at the frame top moves below it, into the frame", () => {
    const fixedAtTop = box(100, OPTS.lo, 40, true);
    const ys = placePointCallouts([fixedAtTop, box(100, OPTS.lo)], OPTS);
    expect(ys[0]).toBe(OPTS.lo);
    expect(ys[1]).toBe(OPTS.lo + ROW_H);
  });

  it("clearing a fixed label never drops a movable onto another movable (fixed boxes are sweep obstacles)", () => {
    // Codex's shape: 200 and 204 spread to 200/213, and a fixed label sits at exactly 213.
    const a = box(100, 200);
    const b = box(100, 204);
    const f = box(100, 213, 40, true);
    const ys = placePointCallouts([a, b, f], OPTS);
    expect(ys[2]).toBe(f.y);
    expect(Math.abs(ys[0]! - ys[1]!)).toBeGreaterThanOrEqual(ROW_H);
    expect(Math.abs(ys[0]! - f.y)).toBeGreaterThanOrEqual(ROW_H);
    expect(Math.abs(ys[1]! - f.y)).toBeGreaterThanOrEqual(ROW_H);
  });

  it("clamps on the column's ACTUAL lowest label, not the one with the largest input y (reviewer's reproduction)", () => {
    // A near-chain joins a four-label stack at the bottom to an unrelated box at 325 via boxes it
    // never touches. The stack is pushed to 320/333/346/359 — three past hi — but the box with the
    // largest INPUT y (325) is not the one that was pushed furthest.
    const boxes = [
      box(0, 320), box(0, 321), box(0, 322), box(0, 323),
      box(45, 50), box(90, 100), box(135, 150), box(180, 200), box(200, 325),
    ];
    const ys = placePointCallouts(boxes, OPTS);
    expect(Math.max(...ys)).toBeLessThanOrEqual(OPTS.hi);
    for (const k of [4, 5, 6, 7, 8]) expect(ys[k]).toBe(boxes[k]!.y);
    const stack = [ys[0]!, ys[1]!, ys[2]!, ys[3]!].sort((p, q) => p - q);
    for (let k = 1; k < 4; k++) expect(stack[k]! - stack[k - 1]!).toBeGreaterThanOrEqual(ROW_H - 1e-9);
  });

  it("a colliding group is clamped into [lo, hi]", () => {
    const ys = placePointCallouts([box(100, OPTS.hi - 2), box(100, OPTS.hi + 1)], OPTS);
    expect(Math.max(...ys)).toBeLessThanOrEqual(OPTS.hi);
    const top = placePointCallouts([box(100, OPTS.lo - 5), box(100, OPTS.lo - 1)], OPTS);
    expect(Math.min(...top)).toBeGreaterThanOrEqual(OPTS.lo);
  });

  it("collision is transitive: A–B and B–C form one group even when A and C are clear", () => {
    const ys = placePointCallouts([box(100, 200), box(130, 206), box(160, 212)], OPTS);
    const sorted = [...ys].sort((p, q) => p - q);
    expect(sorted[1]! - sorted[0]!).toBeGreaterThanOrEqual(ROW_H);
    expect(sorted[2]! - sorted[1]!).toBeGreaterThanOrEqual(ROW_H);
  });

  it("a five-label stack settles in one sweep (the case a bounded regrouping left 11px apart)", () => {
    const ys = placePointCallouts([209, 259, 242, 227, 209].map((y) => box(100, y)), OPTS);
    const sorted = [...ys].sort((p, q) => p - q);
    for (let k = 1; k < sorted.length; k++) expect(sorted[k]! - sorted[k - 1]!).toBeGreaterThanOrEqual(ROW_H - 1e-9);
    expect(Math.max(...ys)).toBeLessThanOrEqual(OPTS.hi);
  });

  it("labels that share a column but never overlap horizontally do not push each other", () => {
    // A and C are 60px apart horizontally and 5px apart vertically; B joins them into one column
    // but sits far below. Nothing collides, so nothing moves.
    const a = box(100, 200, 40);
    const b = box(130, 300, 40);
    const c = box(160, 205, 40);
    expect(placePointCallouts([a, b, c], OPTS)).toEqual([a.y, b.y, c.y]);
  });

  it("a pushed label cascades onto only the labels it is actually near", () => {
    // B moves off A and lands on C (near B, not near A), so C moves too; A never moves.
    const a = box(100, 200, 40);
    const b = box(130, 200, 40);
    const c = box(160, 205, 40);
    const ys = placePointCallouts([a, b, c], OPTS);
    expect(ys[0]).toBe(a.y);
    expect(ys[1]! - a.y).toBeGreaterThanOrEqual(ROW_H);
    expect(ys[2]! - ys[1]!).toBeGreaterThanOrEqual(ROW_H);
  });
});

describe("placePointCallouts — seeded property check", () => {
  // mulberry32: deterministic, so a failure is reproducible from the seed in the message.
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const near = (a: CalloutBox, b: CalloutBox) => a.x0 < b.x1 + OPTS.gap && b.x0 < a.x1 + OPTS.gap;
  const collideAt = (a: CalloutBox, ay: number, b: CalloutBox, by: number) =>
    near(a, b) && Math.abs(ay - by) < (a.h + b.h) / 2;

  it("leaves no near overlap behind, never moves a fixed box, and returns collision-free input bit-for-bit", () => {
    const next = rng(37);
    let untouchedCases = 0;
    for (let c = 0; c < 1500; c++) {
      const count = 1 + Math.floor(next() * 8);
      const boxes: CalloutBox[] = [];
      for (let i = 0; i < count; i++) {
        const x0 = Math.floor(next() * 300);
        boxes.push({ x0, x1: x0 + 30 + Math.floor(next() * 30), y: OPTS.lo - 20 + next() * (OPTS.hi - OPTS.lo + 40), h: next() < 0.3 ? 26 : 13, fixed: next() < 0.25 });
      }
      const ys = placePointCallouts(boxes, OPTS);
      const label = `case ${c}: ${JSON.stringify(boxes)} -> ${JSON.stringify(ys)}`;
      expect(ys.length, label).toBe(count);
      let anyInputCollision = false;
      for (let i = 0; i < count; i++) {
        expect(Number.isFinite(ys[i]!), label).toBe(true);
        if (boxes[i]!.fixed) expect(ys[i], label).toBe(boxes[i]!.y);
        for (let j = i + 1; j < count; j++) {
          if (collideAt(boxes[i]!, boxes[i]!.y, boxes[j]!, boxes[j]!.y)) anyInputCollision = true;
          // Two FIXED boxes may overlap by the author's choice; every other near pair must be clear.
          if (boxes[i]!.fixed && boxes[j]!.fixed) continue;
          expect(collideAt(boxes[i]!, ys[i]!, boxes[j]!, ys[j]!), label).toBe(false);
        }
      }
      if (!anyInputCollision) {
        untouchedCases++;
        expect(ys, label).toEqual(boxes.map((b) => b.y));
      }
    }
    // Sanity: the identity branch was actually exercised.
    expect(untouchedCases).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// Rendered — the four-callout scorecard shape from the issue
// ---------------------------------------------------------------------------

const rowsOf = (o: Record<string, string>[]): TidyRow[] => o as unknown as TidyRow[];
const LABEL_CHAR_PX = 6.2;
const LABEL_ROW_H = 13;

const SCORECARD = {
  title: "T",
  chartType: "scatter",
  xAxisType: "numeric",
  data: "d.csv",
  columns: { x: "x", value: "y", series: "g", point_label: "period" },
} as unknown as ChartSpec;

// Two points share an exact x; the other two sit within a few px of them. Their labels all default
// to 6px above their point, so they overlap in every pairing.
const ROWS = rowsOf([
  { x: "2.5936", y: "-0.121", g: "Recent", period: "2025a" },
  { x: "2.3211", y: "-0.150", g: "Recent", period: "2025b" },
  { x: "2.3211", y: "-0.140", g: "Recent", period: "2025b*" },
  { x: "2.2850", y: "-0.130", g: "Recent", period: "2026a" },
  { x: "0.5", y: "-1.5", g: "Earlier", period: "2001" },
  { x: "3.5", y: "1.5", g: "Earlier", period: "2009" },
]);

const withPoints = (points: unknown[]): ChartSpec => ({ ...SCORECARD, annotations: { points } }) as unknown as ChartSpec;

/** Absolute (x, y) of a <text>, accumulating every translate() up to the <svg> (Plot puts the mark's
 *  dx/dy on the group and the data position on the element). */
function absPos(el: Element): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let n: Element | null = el;
  while (n && n.tagName.toLowerCase() !== "svg") {
    const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(n.getAttribute("transform") ?? "");
    if (m) {
      x += Number(m[1]);
      y += Number(m[2]);
    }
    n = n.parentElement;
  }
  return { x, y };
}

function labelBoxes(svg: SVGSVGElement, labels: string[]): Array<{ label: string; x0: number; x1: number; y: number }> {
  return labels.map((label) => {
    const el = Array.from(svg.querySelectorAll("text")).find((t) => t.textContent === label);
    expect(el, label).toBeDefined();
    const { x, y } = absPos(el!);
    const w = label.length * LABEL_CHAR_PX;
    return { label, x0: x - w / 2, x1: x + w / 2, y };
  });
}

// Labels spread to exactly one row apart come back from the transform arithmetic a rounding hair
// under 13, so the vertical test carries an epsilon.
const boxesOverlap = (a: { x0: number; x1: number; y: number }, b: { x0: number; x1: number; y: number }): boolean =>
  a.x0 < b.x1 && b.x0 < a.x1 && Math.abs(a.y - b.y) < LABEL_ROW_H - 1e-6;

describe("annotations.points — rendered auto-placement", () => {
  const FOUR = ["2025a", "2025b", "2025b*", "2026a"];

  it("four colliding callouts with no dx/dy render four labels whose estimated boxes do not overlap", () => {
    const { svg } = renderChart(withPoints(FOUR.map((p) => ({ point: p, label: "{point_label}" }))), ROWS, { width: 720, height: 400, document });
    const boxes = labelBoxes(svg as SVGSVGElement, FOUR);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(boxesOverlap(boxes[i]!, boxes[j]!), `${boxes[i]!.label} vs ${boxes[j]!.label}`).toBe(false);
      }
    }
  });

  it("the same callouts WOULD overlap at their default offsets (the test above is not vacuous)", () => {
    // Pin every label with an explicit dy equal to the default, so placement leaves them alone.
    const { svg } = renderChart(withPoints(FOUR.map((p) => ({ point: p, label: "{point_label}", dy: 6 }))), ROWS, { width: 720, height: 400, document });
    const boxes = labelBoxes(svg as SVGSVGElement, FOUR);
    expect(boxesOverlap(boxes[1]!, boxes[2]!)).toBe(true);
  });

  it("an explicit dy on one callout is preserved exactly while the others move around it", () => {
    const pinnedAlone = renderChart(withPoints([{ point: "2025b*", label: "{point_label}", dy: 20 }]), ROWS, { width: 720, height: 400, document });
    const all = renderChart(
      withPoints(FOUR.map((p) => (p === "2025b*" ? { point: p, label: "{point_label}", dy: 20 } : { point: p, label: "{point_label}" }))),
      ROWS,
      { width: 720, height: 400, document },
    );
    const alone = labelBoxes(pinnedAlone.svg as SVGSVGElement, ["2025b*"])[0]!;
    const boxes = labelBoxes(all.svg as SVGSVGElement, FOUR);
    const pinned = boxes[2]!;
    expect(pinned.y).toBe(alone.y);
    expect(pinned.x0).toBe(alone.x0);
    for (const b of boxes) if (b !== pinned) expect(boxesOverlap(b, pinned), b.label).toBe(false);
  });

  it("an explicit dx also pins (the figure7 fixture shape: connector + dx) — its position is unchanged by a neighbour", () => {
    const one = renderChart(withPoints([{ point: "2025b", label: "Peak", connector: true, dx: -16 }]), ROWS, { width: 720, height: 400, document });
    const two = renderChart(
      withPoints([{ point: "2025b", label: "Peak", connector: true, dx: -16 }, { point: "2025b*", label: "Other", connector: true }]),
      ROWS,
      { width: 720, height: 400, document },
    );
    const a = labelBoxes(one.svg as SVGSVGElement, ["Peak"])[0]!;
    const b = labelBoxes(two.svg as SVGSVGElement, ["Peak"])[0]!;
    expect(b.y).toBe(a.y);
    expect(b.x0).toBe(a.x0);
  });

  it("a callout that collides with nothing keeps today's default offset exactly", () => {
    // The default is 6px up; pinning it with an explicit `dy: 6` must land on the same pixel. (Not
    // compared against the dot's cy: Plot adds its half-pixel crisp-edge offset to text, not dots.)
    const auto = renderChart(withPoints([{ point: "2001", label: "Lonely" }, { point: "2009", label: "Far" }]), ROWS, { width: 720, height: 400, document });
    const pinned = renderChart(withPoints([{ point: "2001", label: "Lonely", dy: 6 }]), ROWS, { width: 720, height: 400, document });
    const a = labelBoxes(auto.svg as SVGSVGElement, ["Lonely"])[0]!;
    const p = labelBoxes(pinned.svg as SVGSVGElement, ["Lonely"])[0]!;
    expect(a.y).toBe(p.y);
    expect(a.x0).toBe(p.x0);
  });

  it("two wrapped (maxWidth) labels at one point are spread by two rows, not one", () => {
    // maxWidth: 10 forces one word per line, so each label is two text rows tall.
    const { svg } = renderChart(
      withPoints([{ point: "2025b", label: "Alpha beta", maxWidth: 10 }, { point: "2025b*", label: "Gamma delta", maxWidth: 10 }]),
      ROWS,
      { width: 720, height: 400, document },
    );
    const texts = Array.from(svg.querySelectorAll("text"));
    const a = texts.find((t) => (t.textContent ?? "").includes("Alpha"))!;
    const g = texts.find((t) => (t.textContent ?? "").includes("Gamma"))!;
    expect(a.querySelectorAll("tspan").length).toBe(2);
    expect(Math.abs(absPos(a).y - absPos(g).y)).toBeGreaterThanOrEqual(2 * LABEL_ROW_H - 1e-6);
  });

  it("is gated off on a categorical x-axis: colliding callouts keep their default offsets", () => {
    // The band scale has no numeric domain to estimate px from, so — like the stagger and the
    // connector leader — placement does not run and both labels sit at the default 6px up.
    const spec = {
      title: "T", chartType: "bar", xAxisType: "categorical", data: "d.csv",
      annotations: { points: [{ x: "a", y: 1, label: "One" }, { x: "a", y: 1, label: "Two" }] },
    } as unknown as ChartSpec;
    const rows = rowsOf([{ time: "a", series: "s", value: "1" }, { time: "b", series: "s", value: "2" }]);
    const { svg } = renderChart(spec, rows, { width: 720, height: 400, document });
    const [one, two] = labelBoxes(svg as SVGSVGElement, ["One", "Two"]);
    expect(one!.y).toBe(two!.y);
  });

  it("is gated off when the render has no width/height: colliding callouts keep their default offsets", () => {
    const { svg } = renderChart(withPoints([{ point: "2025b", label: "PLAIN" }, { point: "2025b*", label: "STAR" }]), ROWS, { document });
    const [plain, star] = labelBoxes(svg as SVGSVGElement, ["PLAIN", "STAR"]);
    // 2025b and 2025b* share an x and differ by 0.01 in y, so at the default offset the two labels
    // overlap by a row — which placement would otherwise have fixed.
    expect(Math.abs(plain!.y - star!.y)).toBeLessThan(ROW_H);
  });

  it("the connector follows a moved label", () => {
    const { svg } = renderChart(
      withPoints([{ point: "2025b", label: "{point_label}", connector: true }, { point: "2025b*", label: "{point_label}", connector: true }]),
      ROWS,
      { width: 720, height: 400, document },
    );
    // Two arrows drawn; both labels present and not overlapping.
    expect(svg.querySelectorAll('g[aria-label="arrow"] path').length).toBe(2);
    const boxes = labelBoxes(svg as SVGSVGElement, ["2025b", "2025b*"]);
    expect(boxesOverlap(boxes[0]!, boxes[1]!)).toBe(false);
  });
});
