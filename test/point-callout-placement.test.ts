// @vitest-environment jsdom
//
// Auto-placement for point-callout labels: a callout WITHOUT an explicit dx/dy is moved vertically
// off any other callout label it would sit on; one WITH an explicit dx or dy is pinned and the
// others route around it. The helper is pure and estimate-based (no getBBox), so live HTML, PNG
// export and SSR agree. Its "no collision ⇒ input returned unchanged" property is what keeps every
// pre-existing golden byte-identical — the goldens themselves are the other half of that proof.
import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";
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
  // Interior and isolated: the byte-identity gate needs a point whose CENTRED label sits wholly
  // inside the frame, which the two rows above (the x-domain's own endpoints, so px lands exactly
  // on an inner edge) cannot provide. MID shares 2009's y and sits ~145px to its left — clear of
  // 2009's centred label box, inside its flipped one.
  { x: "2.845", y: "1.5", g: "Earlier", period: "MID" },
  { x: "1.5", y: "0.4", g: "Earlier", period: "LONE" },
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
    // Both points are interior: a callout on an x-domain ENDPOINT sits exactly on an inner frame
    // edge, so half its label is outside and the edge flip (below) claims it.
    const auto = renderChart(withPoints([{ point: "LONE", label: "Lonely" }, { point: "MID", label: "Far" }]), ROWS, { width: 720, height: 400, document });
    const pinned = renderChart(withPoints([{ point: "LONE", label: "Lonely", dy: 6 }]), ROWS, { width: 720, height: 400, document });
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

// ---------------------------------------------------------------------------
// Rendered — the horizontal flip at the frame edges, and explicit line breaks
// ---------------------------------------------------------------------------

// The inner plot frame at 720x400 (TBL_MARGIN_LEFT 44, TBL_MARGIN_RIGHT 16). Plot adds a half-pixel
// crisp-edge offset to text, so the edge assertions carry a 1px tolerance. The two thresholds are
// asymmetric: CANVAS_RIGHT on the right (the empty right margin is fair game; past the canvas the
// label is truncated), FRAME_LEFT on the left (that margin holds the y-tick labels).
const FRAME_LEFT = 44;
const FRAME_RIGHT = 720 - 16;
const CANVAS_RIGHT = 720;
// 28 chars — the unreadable label from the 1.14.0 visual review, wide enough (~174px) that a
// centred box at either frame edge hangs well outside it.
const LONG = "2026a at x=2.285011857607663";

/** One callout label's anchor (null is Plot's omitted default, "middle") and the absolute box that
 *  anchor puts it in — the estimate the flip decision is made on. */
function anchoredBox(svg: SVGSVGElement, label: string): { anchor: string | null; x: number; y: number; x0: number; x1: number } {
  const el = Array.from(svg.querySelectorAll("text")).find((t) => (t.textContent ?? "") === label);
  expect(el, label).toBeDefined();
  const anchor = (el!.parentElement as Element).getAttribute("text-anchor");
  const { x, y } = absPos(el!);
  const w = label.length * LABEL_CHAR_PX;
  const x0 = anchor === "end" ? x - w : anchor === "start" ? x : x - w / 2;
  return { anchor, x, y, x0, x1: x0 + w };
}

/** The start point of the first arrow's path — the end the label is anchored at. */
function arrowStart(svg: SVGSVGElement): { x: number; y: number } {
  const d = svg.querySelector('g[aria-label="arrow"] path')!.getAttribute("d") ?? "";
  const m = /^M\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(d.trim());
  expect(m, d).not.toBeNull();
  return { x: Number(m![1]), y: Number(m![2]) };
}

describe("annotations.points — labels that would leave the frame flip to the inside", () => {
  it("a long auto-placed label at the right edge is anchored end and drawn 6px LEFT of its point", () => {
    const { svg } = renderChart(withPoints([{ point: "2009", label: LONG }]), ROWS, { width: 720, height: 400, document });
    // The pinned render carries dx: 0, so its x IS the point's px — the flip's own offset is the
    // difference between the two.
    const pinned = renderChart(withPoints([{ point: "2009", label: LONG, dy: 6 }]), ROWS, { width: 720, height: 400, document });
    const b = anchoredBox(svg as SVGSVGElement, LONG);
    expect(b.anchor).toBe("end");
    expect(b.x1).toBeLessThanOrEqual(FRAME_RIGHT + 1);
    expect(b.x).toBeCloseTo(anchoredBox(pinned.svg as SVGSVGElement, LONG).x - 6, 6);
  });

  it("runs on a temporal axis too, where the last point also sits on the inner right edge", () => {
    const spec = {
      title: "T", chartType: "line", xAxisType: "temporal", data: "d.csv",
      annotations: { points: [{ x: "2021-12-01", series: "a", label: LONG }] },
    } as unknown as ChartSpec;
    const rows = rowsOf([
      { time: "2021-01-01", series: "a", value: "1" },
      { time: "2021-06-15", series: "a", value: "2" },
      { time: "2021-12-01", series: "a", value: "3" },
    ]);
    const { svg } = renderChart(spec, rows, { width: 720, height: 400, document });
    const b = anchoredBox(svg as SVGSVGElement, LONG);
    expect(b.anchor).toBe("end");
    expect(b.x1).toBeLessThanOrEqual(FRAME_RIGHT + 1);
  });

  it("is gated off on a categorical x-axis, which has no numeric domain to measure px against", () => {
    const spec = {
      title: "T", chartType: "bar", xAxisType: "categorical", data: "d.csv",
      annotations: { points: [{ x: "b", y: 1, label: LONG }] },
    } as unknown as ChartSpec;
    const rows = rowsOf([{ time: "a", series: "s", value: "1" }, { time: "b", series: "s", value: "2" }]);
    const { svg } = renderChart(spec, rows, { width: 720, height: 400, document });
    expect(anchoredBox(svg as SVGSVGElement, LONG).anchor).toBeNull();
  });

  it("the same label centred would have run off the CANVAS (the test above is not vacuous)", () => {
    // Pinned by an explicit dy, so the flip never looks at it: it keeps the middle anchor and
    // hangs off the canvas exactly as it did before this change.
    const { svg } = renderChart(withPoints([{ point: "2009", label: LONG, dy: 6 }]), ROWS, { width: 720, height: 400, document });
    const b = anchoredBox(svg as SVGSVGElement, LONG);
    expect(b.anchor).toBeNull();
    expect(b.x1).toBeGreaterThan(CANVAS_RIGHT);
  });

  it("a right-side label that overhangs the FRAME but stays on the canvas does NOT flip", () => {
    // The asymmetry, and a byte-identity win: the right margin is empty, so this label was never
    // truncated and must render exactly where it always did.
    const auto = renderChart(withPoints([{ point: "2009", label: "Right" }]), ROWS, { width: 720, height: 400, document });
    const pinned = renderChart(withPoints([{ point: "2009", label: "Right", dx: 0 }]), ROWS, { width: 720, height: 400, document });
    const a = anchoredBox(auto.svg as SVGSVGElement, "Right");
    expect(a.anchor).toBeNull();
    expect(a.x1).toBeGreaterThan(FRAME_RIGHT);
    expect(a.x1).toBeLessThanOrEqual(CANVAS_RIGHT);
    expect(a.x).toBe(anchoredBox(pinned.svg as SVGSVGElement, "Right").x);
  });

  it("a right-side label whose flip would overrun the LEFT gutter stays centred", () => {
    // ~694px wide at the right edge of a 660px frame: it runs off the canvas centred, but anchoring
    // it end would put its start 3.6px from the canvas left, inside the tick-label gutter. Flipping
    // would only trade which end is cut off, so it does not happen.
    const nearlyFrameWide = LONG.repeat(4);
    const { svg } = renderChart(withPoints([{ point: "2009", label: nearlyFrameWide }]), ROWS, { width: 720, height: 400, document });
    expect(anchoredBox(svg as SVGSVGElement, nearlyFrameWide).anchor).toBeNull();
  });

  it("and the mirror: a left-side label whose flip would run off the CANVAS stays centred", () => {
    // The same ~694px label on the LEFTmost point. Centred it crosses the frame edge into the
    // gutter, so the left threshold asks for a flip; anchored start it would end at 744px, past the
    // 720px canvas. Same expression, opposite direction.
    const nearlyFrameWide = LONG.repeat(4);
    const { svg } = renderChart(withPoints([{ point: "2001", label: nearlyFrameWide }]), ROWS, { width: 720, height: 400, document });
    expect(anchoredBox(svg as SVGSVGElement, nearlyFrameWide).anchor).toBeNull();
  });

  it("mirrors at the left edge: anchored start and drawn to the RIGHT of its point", () => {
    const { svg } = renderChart(withPoints([{ point: "2001", label: LONG }]), ROWS, { width: 720, height: 400, document });
    const b = anchoredBox(svg as SVGSVGElement, LONG);
    expect(b.anchor).toBe("start");
    expect(b.x0).toBeGreaterThanOrEqual(FRAME_LEFT - 1);
  });

  it("a left-side label still inside the canvas flips, because that margin is the tick-label gutter", () => {
    // 14 chars (~87px) centred on the leftmost point: its left edge lands at 0.6px, on the canvas
    // but well inside the y-tick-label gutter. The right threshold would have let this pass; the
    // left one must not.
    const label = "Left edge here";
    const { svg } = renderChart(withPoints([{ point: "2001", label }]), ROWS, { width: 720, height: 400, document });
    const pinned = renderChart(withPoints([{ point: "2001", label, dy: 6 }]), ROWS, { width: 720, height: 400, document });
    const centred = anchoredBox(pinned.svg as SVGSVGElement, label);
    expect(centred.x0).toBeGreaterThan(0);
    expect(centred.x0).toBeLessThan(FRAME_LEFT);
    const b = anchoredBox(svg as SVGSVGElement, label);
    expect(b.anchor).toBe("start");
    expect(b.x0).toBeGreaterThanOrEqual(FRAME_LEFT - 1);
  });

  it("a label that overruns BOTH limits keeps the middle anchor — no anchor fits, so nothing moves", () => {
    // ~1215px wide centred on an interior point: it runs off the canvas on the right and into the
    // gutter on the left at once, so a flip could only make it worse.
    const tooWide = LONG.repeat(7);
    const { svg } = renderChart(withPoints([{ point: "MID", label: tooWide }]), ROWS, { width: 720, height: 400, document });
    expect(anchoredBox(svg as SVGSVGElement, tooWide).anchor).toBeNull();
  });

  it("a label that fits keeps the middle anchor and the identical position (byte-identity gate)", () => {
    const auto = renderChart(withPoints([{ point: "MID", label: "Fits" }]), ROWS, { width: 720, height: 400, document });
    // `dx: 0` pins the callout at the same middle anchor and the same default dy, so a flip is the
    // only thing that could separate the two renders.
    const pinned = renderChart(withPoints([{ point: "MID", label: "Fits", dx: 0 }]), ROWS, { width: 720, height: 400, document });
    const a = anchoredBox(auto.svg as SVGSVGElement, "Fits");
    const p = anchoredBox(pinned.svg as SVGSVGElement, "Fits");
    expect(a.anchor).toBeNull();
    expect(p.anchor).toBeNull();
    expect(a.x).toBe(p.x);
    expect(a.y).toBe(p.y);
  });

  it("the vertical sweep sees the FLIPPED box: a neighbour clear of the centred label collides with the flipped one", () => {
    const { svg } = renderChart(
      withPoints([{ point: "2009", label: LONG }, { point: "MID", label: "Mid" }]),
      ROWS,
      { width: 720, height: 400, document },
    );
    const long = anchoredBox(svg as SVGSVGElement, LONG);
    const mid = anchoredBox(svg as SVGSVGElement, "Mid");
    // The flip put LONG's box over MID's, so placement had to separate them vertically.
    expect(long.x0).toBeLessThan(mid.x1);
    expect(Math.abs(long.y - mid.y)).toBeGreaterThanOrEqual(LABEL_ROW_H - 1e-6);
  });

  it("without the flip those two labels share a row (the collision is the flip's own doing)", () => {
    const { svg } = renderChart(
      withPoints([{ point: "2009", label: LONG, dy: 6 }, { point: "MID", label: "Mid", dy: 6 }]),
      ROWS,
      { width: 720, height: 400, document },
    );
    const long = anchoredBox(svg as SVGSVGElement, LONG);
    const mid = anchoredBox(svg as SVGSVGElement, "Mid");
    expect(long.x0).toBeGreaterThan(mid.x1);
    expect(long.y).toBe(mid.y);
  });

  it("the connector's label coordinate follows the flip", () => {
    const { svg } = renderChart(withPoints([{ point: "2009", label: LONG, connector: true }]), ROWS, { width: 720, height: 400, document });
    // `dy: 28` equals the connector's own default offset and pins the callout, so this arrow starts
    // at the point's px and the difference between the two starts is the flip itself.
    const pinned = renderChart(withPoints([{ point: "2009", label: LONG, connector: true, dy: 28 }]), ROWS, { width: 720, height: 400, document });
    expect(anchoredBox(svg as SVGSVGElement, LONG).anchor).toBe("end");
    expect(arrowStart(svg as SVGSVGElement).x).toBeCloseTo(arrowStart(pinned.svg as SVGSVGElement).x - 6, 6);
  });

  it("is gated off with the rest of placement when the render has no width/height", () => {
    const { svg } = renderChart(withPoints([{ point: "2009", label: LONG }]), ROWS, { document });
    expect(anchoredBox(svg as SVGSVGElement, LONG).anchor).toBeNull();
  });
});

describe("annotations.points — an explicit newline is a hard line break", () => {
  const lines = (svg: SVGSVGElement, first: string): string[] => {
    const el = Array.from(svg.querySelectorAll("text")).find((t) => (t.textContent ?? "").startsWith(first))!;
    const tspans = Array.from(el.querySelectorAll("tspan"));
    return tspans.length ? tspans.map((t) => t.textContent ?? "") : [el.textContent ?? ""];
  };

  it("survives maxWidth wrapping, which used to destroy it", () => {
    const { svg } = renderChart(withPoints([{ point: "MID", label: "brk one\nbrk two", maxWidth: 200 }]), ROWS, { width: 720, height: 400, document });
    expect(lines(svg as SVGSVGElement, "brk one")).toEqual(["brk one", "brk two"]);
  });

  it("is honoured with no maxWidth, as before", () => {
    const { svg } = renderChart(withPoints([{ point: "MID", label: "brk one\nbrk two" }]), ROWS, { width: 720, height: 400, document });
    expect(lines(svg as SVGSVGElement, "brk one")).toEqual(["brk one", "brk two"]);
  });

  it("each segment still wraps at word boundaries within maxWidth", () => {
    const { svg } = renderChart(withPoints([{ point: "MID", label: "alpha beta\ngamma", maxWidth: 10 }]), ROWS, { width: 720, height: 400, document });
    expect(lines(svg as SVGSVGElement, "alpha")).toEqual(["alpha", "beta", "gamma"]);
  });

  it("reaches the renderer as a real newline from both YAML spellings an author would use", () => {
    // The break has to survive the spec file, not just the API: a double-quoted "\n" and a literal
    // block scalar are the two ways a figure author writes one.
    const parsed = parseYaml('dq: "line one\\nline two"\nblock: |-\n  line one\n  line two\n') as Record<string, string>;
    expect(parsed.dq).toBe("line one\nline two");
    expect(parsed.block).toBe("line one\nline two");
    for (const label of [parsed.dq!, parsed.block!]) {
      const { svg } = renderChart(withPoints([{ point: "MID", label, maxWidth: 200 }]), ROWS, { width: 720, height: 400, document });
      expect(lines(svg as SVGSVGElement, "line one")).toEqual(["line one", "line two"]);
    }
  });

  it("the placement box counts the lines the text actually draws", () => {
    // Two two-line labels on points 0.01 apart in y: they must clear each other by TWO rows, which
    // they only do if 6b's box saw both hard-broken lines that 6c drew.
    const { svg } = renderChart(
      withPoints([{ point: "2025b", label: "one\ntwo", maxWidth: 200 }, { point: "2025b*", label: "three\nfour", maxWidth: 200 }]),
      ROWS,
      { width: 720, height: 400, document },
    );
    const a = Array.from(svg.querySelectorAll("text")).find((t) => (t.textContent ?? "").startsWith("one"))!;
    const b = Array.from(svg.querySelectorAll("text")).find((t) => (t.textContent ?? "").startsWith("three"))!;
    expect(a.querySelectorAll("tspan").length).toBe(2);
    expect(b.querySelectorAll("tspan").length).toBe(2);
    expect(Math.abs(absPos(a).y - absPos(b).y)).toBeGreaterThanOrEqual(2 * LABEL_ROW_H - 1e-6);
  });
});
