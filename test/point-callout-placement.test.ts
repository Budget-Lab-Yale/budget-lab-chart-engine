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
import { MARK_POINT_R } from "../src/engine/theme";
import { renderChart } from "../src/engine/index";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const ROW_H = 13;
// `top`/`bottom` are the FRAME edges; placePointCallouts insets each label by its own half-height.
// They are written as the values that give a ONE-ROW box the centre range [30, 330] every
// expectation below is stated against, so a taller box gets a correspondingly tighter range.
const OPTS = { gap: 6, top: 30 - ROW_H / 2, bottom: 330 + ROW_H / 2 };
/** The centre limits a single-row box gets — what `LO`/`HI` used to mean. */
const LO = OPTS.top + ROW_H / 2;
const HI = OPTS.bottom - ROW_H / 2;
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
    const a = box(100, LO - 10);
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
    expect(Math.max(...ys)).toBeLessThanOrEqual(HI);
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
    const fixedAtTop = box(100, LO, 40, true);
    const ys = placePointCallouts([fixedAtTop, box(100, LO)], OPTS);
    expect(ys[0]).toBe(LO);
    expect(ys[1]).toBe(LO + ROW_H);
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
    expect(Math.max(...ys)).toBeLessThanOrEqual(HI);
    for (const k of [4, 5, 6, 7, 8]) expect(ys[k]).toBe(boxes[k]!.y);
    const stack = [ys[0]!, ys[1]!, ys[2]!, ys[3]!].sort((p, q) => p - q);
    for (let k = 1; k < 4; k++) expect(stack[k]! - stack[k - 1]!).toBeGreaterThanOrEqual(ROW_H - 1e-9);
  });

  it("clamps a MULTI-LINE label by its own height, not by half of one row", () => {
    // The clamp reserved half of ONE row for every box, so a two-line label (from `maxWidth`
    // wrapping or an explicit line break, both new in 1.14.0) had its CENTRE pulled to 6.5px
    // inside the frame while its half-height was 13px — leaving 6.5px of it outside, against a
    // documented guarantee that a pushed label is clamped to the frame.
    const tall = (x0: number, y: number) => box(x0, y, 40, false, 2 * ROW_H);
    const ys = placePointCallouts([tall(100, HI + 4), tall(100, HI + 20)], OPTS);
    for (const [k, y] of ys.entries()) {
      const half = 2 * ROW_H / 2;
      expect(y + half, `box ${k} bottom escapes the frame`).toBeLessThanOrEqual(OPTS.bottom + 1e-9);
    }
    // And the mirror at the top edge.
    const up = placePointCallouts([tall(100, LO - 20), tall(100, LO - 4)], OPTS);
    for (const [k, y] of up.entries()) {
      expect(y - ROW_H, `box ${k} top escapes the frame`).toBeGreaterThanOrEqual(OPTS.top - 1e-9);
    }
    // Non-vacuity: a one-row box in the same position still clamps to the OLD limit exactly, so
    // this fix moved nothing for single-line callouts.
    const short = placePointCallouts([box(100, HI - 2), box(100, HI + 1)], OPTS);
    // One of the pair keeps its default and the other is lifted clear; neither leaves the frame.
    expect(Math.max(...short)).toBeLessThanOrEqual(HI);
    expect(short.filter((y, k) => y === [HI - 2, HI + 1][k])).toHaveLength(1);
  });

  it("a colliding group is clamped into [lo, hi]", () => {
    const ys = placePointCallouts([box(100, HI - 2), box(100, HI + 1)], OPTS);
    expect(Math.max(...ys)).toBeLessThanOrEqual(HI);
    const top = placePointCallouts([box(100, LO - 5), box(100, LO - 1)], OPTS);
    expect(Math.min(...top)).toBeGreaterThanOrEqual(LO);
  });

  it("routes a label overlapping only a PINNED one through the search, not the sweep fallback", () => {
    // The regression the `mustKeep` guard introduced. `collidesAtDefault` excludes fixed boxes — it
    // answers a different question, for the frame clamp — so a movable label overlapping only a
    // PINNED label looked like it had nothing to resolve. `attempt` then refused to KEEP it (the
    // kept-vs-fixed check fails) while the prefilter refused to MOVE it: no assignment was feasible,
    // `best` stayed null, and the whole chart fell through to `sweepPlace`, which guarantees none of
    // the crossing, connector or visible-shaft properties the search exists to enforce.
    //
    // Neither box carries a disk under the other's label, so `onForeignMarker` is false and the
    // overlap with the pinned label is the ONLY reason to move — precisely the wedged case.
    // What separates the two code paths observably: the search clears a displaced leader-drawing
    // label by `h/2 + leaderClearance`, leaving a visible shaft; the sweep clears it by the marker
    // radius alone and can park the label right against its own point.
    const pinned = box(100, 200, 40, true);
    const movable: CalloutBox = {
      ...box(100, 206, 40),
      wantsLeader: true,
      disk: { x: 120, y: 206, r: MARK_POINT_R },
    };
    const ys = placePointCallouts([pinned, movable], { ...OPTS, leaderClearance: 12.6 });
    expect(ys[0]).toBe(pinned.y); // the pinned label never moves
    // It cleared the pinned label...
    expect(Math.abs(ys[1]! - pinned.y)).toBeGreaterThanOrEqual((pinned.h + movable.h) / 2 - 1e-9);
    // ...and did so with enough room for a leader that is actually visible, which is the property
    // only the search enforces. Under the sweep this assertion fails.
    expect(Math.abs(ys[1]! - movable.disk!.y)).toBeGreaterThanOrEqual(movable.h / 2 + 12.6 - 1e-9);
  });

  it("never moves a label that collides with nothing, even to clear a pinned leader's path", () => {
    // The byte-identity hole review found: a PINNED connector's long leader crosses a second label
    // that overlaps nothing and sits on no marker. Moving that second label scores zero crossings,
    // so ranking crossings first made the search move it — falsifying CONFIG-SPEC's promise that a
    // callout colliding with nothing keeps exactly its default offset, on a chart nobody touched.
    // The crossing is accepted instead; the paint order and the halo keep the text legible.
    // The geometry has to be built carefully or the test passes either way — two earlier drafts did.
    // The pinned shaft runs from its anchor (300, 60) to its point (150, 260), crossing x = 225 as
    // it passes y = 160. The free label is NARROW (220..230) and sits there, so it is crossed at its
    // default — and its one available move, ~13px down to clear its own marker, carries it to a band
    // the shaft has already swept past (x 201..211). So moving it really does score zero crossings,
    // which is what tempted the search. A wide box fails to reproduce this: the shaft sweeps only
    // ~14px of x across a 13px move, so every candidate position still crosses a 50px-wide label.
    const pinned = {
      ...box(300, 60, 40, true),
      wantsLeader: true,
      disk: { x: 150, y: 260, r: 6.6 },
    };
    const free = { ...box(220, 160, 10), wantsLeader: false, disk: { x: 225, y: 172, r: 6.6 } };
    const ys = placePointCallouts([pinned, free], { ...OPTS, leaderClearance: 12.6 });
    expect(ys[0]).toBe(pinned.y); // pinned never moves
    expect(ys[1]).toBe(free.y); // and neither does the label with nothing to resolve
  });

  it("moves the label that draws NO leader, so a colliding pair costs zero connectors", () => {
    // The second ranking key counts CONNECTORS, not displaced labels. With a colliding
    // `connector: true` / `connector: false` pair, either single move resolves the overlap — but
    // moving the connector-bearing one draws a line and moving the other draws none, so they must
    // not tie. They did while the key counted displaced labels, and the tie-break was then free to
    // pick the one that costs a line.
    const withLeader = { ...box(100, 200), wantsLeader: true, disk: { x: 120, y: 212, r: 6.6 } };
    const plain = { ...box(100, 206), wantsLeader: false, disk: { x: 120, y: 218, r: 6.6 } };
    const ys = placePointCallouts([withLeader, plain], { ...OPTS, leaderClearance: 12.6 });
    expect(ys[0]).toBe(withLeader.y); // the one that would draw a line stays put
    expect(ys[1]).not.toBe(plain.y);
    expect(Math.abs(ys[0]! - ys[1]!)).toBeGreaterThanOrEqual(ROW_H);
  });

  it("clears every NEAR pair, and leaves a pair that never touches horizontally alone", () => {
    // A–B and B–C are near; A–C are not (160 is past 140 + gap), so A and C may sit 12px apart
    // without overlapping anything a reader can see. The sweep this replaced grouped all three by
    // union-find and spread every one of them; the minimiser moves only B and keeps two labels at
    // their defaults — two fewer connectors for the same absence of overlap.
    const a = box(100, 200), b = box(130, 206), c = box(160, 212);
    const ys = placePointCallouts([a, b, c], OPTS);
    expect(ys[0]).toBe(a.y);
    expect(ys[2]).toBe(c.y);
    expect(ys[1]).not.toBe(b.y);
    const near = (p: CalloutBox, q: CalloutBox) => p.x0 < q.x1 + OPTS.gap && q.x0 < p.x1 + OPTS.gap;
    // Non-vacuity: A and C really are the pair that is NOT near, so nothing above requires them
    // to be apart — which is why the test asserts the near pairs only.
    expect(near(a, c)).toBe(false);
    for (const [i, j] of [[0, 1], [1, 2]] as Array<[number, number]>) {
      const p = [a, b, c][i]!, q = [a, b, c][j]!;
      expect(near(p, q)).toBe(true);
      expect(Math.abs(ys[i]! - ys[j]!)).toBeGreaterThanOrEqual((p.h + q.h) / 2);
    }
  });

  it("a five-label stack settles in one sweep (the case a bounded regrouping left 11px apart)", () => {
    const ys = placePointCallouts([209, 259, 242, 227, 209].map((y) => box(100, y)), OPTS);
    const sorted = [...ys].sort((p, q) => p - q);
    for (let k = 1; k < sorted.length; k++) expect(sorted[k]! - sorted[k - 1]!).toBeGreaterThanOrEqual(ROW_H - 1e-9);
    expect(Math.max(...ys)).toBeLessThanOrEqual(HI);
  });

  it("labels that share a column but never overlap horizontally do not push each other", () => {
    // A and C are 60px apart horizontally and 5px apart vertically; B joins them into one column
    // but sits far below. Nothing collides, so nothing moves.
    const a = box(100, 200, 40);
    const b = box(130, 300, 40);
    const c = box(160, 205, 40);
    expect(placePointCallouts([a, b, c], OPTS)).toEqual([a.y, b.y, c.y]);
  });

  // The marker disk a MOVED label may not come to rest on: the callout's point, at the leader's
  // own end inset (MARK_POINT_R + 2). Closest-point circle/rectangle test, written out here rather
  // than shared with the source so the invariant is checked independently of the algebra that
  // enforces it.
  const DISK_R = 6.6;
  const withDisk = (b: CalloutBox, cx: number, cy: number): CalloutBox => ({ ...b, disk: { x: cx, y: cy, r: DISK_R } });
  const onDisk = (b: CalloutBox, y: number, d: { x: number; y: number; r: number }): boolean => {
    const nx = Math.min(Math.max(d.x, b.x0), b.x1);
    const ny = Math.min(Math.max(d.y, y - b.h / 2), y + b.h / 2);
    return Math.hypot(d.x - nx, d.y - ny) < d.r - 1e-9;
  };

  it("a pushed label steps past its own point's marker instead of coming to rest on it", () => {
    // The rendered defect: two points 1.2px apart, each label 12px above its own point, so one
    // row's push (13px) drops the lower label onto its own dot — where the leader shaft, shorter
    // than the end gap, is not drawn at all. It must continue past the marker.
    const a = withDisk(box(100, 200 - 12), 120, 200);
    const b = withDisk(box(100, 201.2 - 12), 120, 201.2);
    const ys = placePointCallouts([a, b], OPTS);
    // One of the pair keeps its default (no connector) and the other is lifted clear — which of
    // the two, and in which direction, is the minimiser's choice; what must hold is that the moved
    // one rests on no marker and is far enough out to carry a visible leader.
    const moved = [0, 1].filter((k) => ys[k] !== [a, b][k]!.y);
    expect(moved).toHaveLength(1);
    const k = moved[0]!;
    for (const d of [a.disk!, b.disk!]) expect(onDisk([a, b][k]!, ys[k]!, d), `box ${k}`).toBe(false);
    expect(Math.abs(ys[k]! - [a, b][k]!.disk!.y)).toBeGreaterThanOrEqual([a, b][k]!.h / 2 + DISK_R);
  });

  it("a label that collided with nothing is never moved by a marker disk, even one it overlaps", () => {
    // A 13px box centred on the 12px connector default reaches to 5.5px above the point, inside a
    // 6.6px disk. That graze is the byte-identity carve-out: a lone callout must not move.
    const lone = withDisk(box(100, 200 - 12), 120, 200);
    expect(onDisk(lone, lone.y, lone.disk!)).toBe(true);
    expect(placePointCallouts([lone], OPTS)).toEqual([lone.y]);
    expect(placePointCallouts([lone, withDisk(box(400, 300), 420, 312)], OPTS)).toEqual([lone.y, 300]);
  });

  it("a disk outside the label's horizontal extent does not push it at all", () => {
    // Exact circle geometry, not a bounding box: a marker two label-widths away is irrelevant even
    // when it shares the label's row.
    const a = box(100, 200);
    const b = withDisk(box(100, 204), 400, 213);
    const ys = placePointCallouts([a, b], OPTS);
    // The two labels DO collide, so one must move — but the far-off disk plays no part in it, and
    // the label that owns the disk is free to keep its default despite "having" a marker.
    expect(ys[1]).toBe(b.y);
    expect(ys[0]).not.toBe(a.y);
    expect(Math.abs(ys[0]! - ys[1]!)).toBeGreaterThanOrEqual(ROW_H);
  });

  it("terminates when a push target is not a fixed point of the collision test", () => {
    // Regression, found by the seeded property check below (case 132) as a HUNG worker, not a
    // failed assertion. Two boxes end up 19.499999999999993 apart with a clearance of 19.5 — short
    // by 7e-15 — so `collide` reports an overlap, but `ys[j] + 19.5` rounds back to exactly the
    // value the pushed label already holds. The assignment moved nothing and the sweep re-armed on
    // it forever. Verbatim input; the disk pushes are what put a label on a coordinate where
    // `(a + c) - a < c` holds at all.
    const boxes: CalloutBox[] = [
      { x0: 77, x1: 110, y: 286.7306144395843, h: 13, fixed: false },
      { x0: 50, x1: 101, y: 45.67304653581232, h: 13, fixed: false, disk: { x: 75.5, y: 57.67304653581232, r: 6.6 } },
      { x0: 173, x1: 225, y: 92.08685528486967, h: 26, fixed: false },
      { x0: 29, x1: 71, y: 18.05119702592492, h: 13, fixed: false, disk: { x: 50, y: 30.05119702592492, r: 6.6 } },
      { x0: 10, x1: 57, y: 11.306475661695004, h: 26, fixed: false, disk: { x: 33.5, y: 23.306475661695004, r: 6.6 } },
    ];
    const ys = placePointCallouts(boxes, OPTS);
    expect(ys).toHaveLength(boxes.length);
    for (const y of ys) expect(Number.isFinite(y)).toBe(true);
    // And it settles CLEAR: the gap must satisfy the same exact comparison the property check uses,
    // so landing on the arithmetic target is not good enough.
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        if (!(a.x0 < b.x1 + OPTS.gap && b.x0 < a.x1 + OPTS.gap)) continue;
        expect(Math.abs(ys[i]! - ys[j]!), `${i} vs ${j}`).toBeGreaterThanOrEqual((a.h + b.h) / 2);
      }
    }
  });

  it("keeps as many labels at their defaults as the arrangement allows", () => {
    // A–B and B–C are near; A–C are not, so A and C can BOTH hold their defaults and only B has
    // to move. The sweep moved B and then C, because its single direction cascaded; the minimiser
    // moves one label and draws one connector. That is the objective the sweep did not have.
    const a = box(100, 200, 40), b = box(130, 200, 40), c = box(160, 205, 40);
    const ys = placePointCallouts([a, b, c], OPTS);
    expect(ys[0]).toBe(a.y);
    expect(ys[2]).toBe(c.y);
    expect(ys[1]).not.toBe(b.y);
    const near = (p: CalloutBox, q: CalloutBox) => p.x0 < q.x1 + OPTS.gap && q.x0 < p.x1 + OPTS.gap;
    for (const [i, j] of [[0, 1], [1, 2], [0, 2]] as Array<[number, number]>) {
      const p = [a, b, c][i]!, q = [a, b, c][j]!;
      if (!near(p, q)) continue;
      expect(Math.abs(ys[i]! - ys[j]!), `${i}/${j}`).toBeGreaterThanOrEqual((p.h + q.h) / 2);
    }
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

  const PROP_DISK_R = 6.6;
  const onDisk = (b: CalloutBox, y: number, d: { x: number; y: number; r: number }): boolean => {
    const nx = Math.min(Math.max(d.x, b.x0), b.x1);
    const ny = Math.min(Math.max(d.y, y - b.h / 2), y + b.h / 2);
    return Math.hypot(d.x - nx, d.y - ny) < d.r - 1e-9;
  };

  it("leaves no near overlap behind, never moves a fixed box, and returns collision-free input bit-for-bit", () => {
    const next = rng(37);
    let untouchedCases = 0;
    for (let c = 0; c < 1500; c++) {
      const count = 1 + Math.floor(next() * 8);
      const boxes: CalloutBox[] = [];
      for (let i = 0; i < count; i++) {
        const x0 = Math.floor(next() * 300);
        const x1 = x0 + 30 + Math.floor(next() * 30);
        const y = LO - 20 + next() * (HI - LO + 40);
        const b: CalloutBox = { x0, x1, y, h: next() < 0.3 ? 26 : 13, fixed: next() < 0.25 };
        // Most boxes carry their point's marker disk, 12px below the label as the connector default
        // puts it; the rest have none, so both branches of the disk rule are exercised.
        if (next() < 0.75) b.disk = { x: (x0 + x1) / 2, y: y + 12, r: PROP_DISK_R };
        boxes.push(b);
      }
      const ys = placePointCallouts(boxes, OPTS);
      const label = `case ${c}: ${JSON.stringify(boxes)} -> ${JSON.stringify(ys)}`;
      expect(ys.length, label).toBe(count);
      let anyInputCollision = false;
      for (let i = 0; i < count; i++) {
        expect(Number.isFinite(ys[i]!), label).toBe(true);
        if (boxes[i]!.fixed) expect(ys[i], label).toBe(boxes[i]!.y);
        // No movable label comes to rest on ANOTHER callout's marker, moved or not — a label parked
        // on a different labelled point cannot be read. Its OWN marker is exempt only while it sits
        // at its default (the 12px default grazes it, and enforcing it there would move every lone
        // callout). A FIXED label is the author's placement and is never swept.
        // (Reported via expect.fail rather than a message argument: interpolating `label` into a
        // per-pair string 96k times over the 1500 cases exhausted the worker's heap.)
        if (!boxes[i]!.fixed) {
          for (const [j, o] of boxes.entries()) {
            if (!o.disk) continue;
            if (j === i && ys[i] === boxes[i]!.y) continue;
            if (onDisk(boxes[i]!, ys[i]!, o.disk)) {
              expect.fail(`box ${i} came to rest on ${j === i ? "its own" : `box ${j}'s`} marker — ${label}`);
            }
          }
        }
        for (let j = i + 1; j < count; j++) {
          if (collideAt(boxes[i]!, boxes[i]!.y, boxes[j]!, boxes[j]!.y)) anyInputCollision = true;
          // Two FIXED boxes may overlap by the author's choice; every other near pair must be clear.
          if (boxes[i]!.fixed && boxes[j]!.fixed) continue;
          expect(collideAt(boxes[i]!, ys[i]!, boxes[j]!, ys[j]!), label).toBe(false);
        }
      }
      // Identity holds when nothing asked any label to move: no box collision AND no label parked
      // on another callout's marker. The second clause is what the other-marker rule cost this
      // guarantee — it is narrower than "no collision" now, deliberately.
      const anyForeignDisk = boxes.some(
        (b, i) => !b.fixed && boxes.some((o, j) => j !== i && o.disk != null && onDisk(b, b.y, o.disk)),
      );
      if (!anyInputCollision && !anyForeignDisk) {
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
    const boxes = labelBoxes(svg as SVGSVGElement, ["2025b", "2025b*"]);
    expect(boxesOverlap(boxes[0]!, boxes[1]!)).toBe(false);
    // One of the pair keeps its default and the other is lifted clear, so exactly one connector is
    // drawn — and it is drawn, because placement puts a displaced leader-drawing label far enough
    // out to earn a visible shaft rather than merely clear of the dot.
    expect(svg.querySelectorAll('g[aria-label="arrow"] path').length).toBe(1);
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
    // A LATERAL flip on its own no longer draws a leader, so this needs a callout that is both
    // flipped and pushed. Explicit x/y (still auto-placed — only dx/dy pin) puts both at an
    // INTERIOR y, where the frame clamp cannot claim them: the row-keyed edge points sit at the
    // y-domain's extremes, so a collision there is clamped and moves both labels. The short label
    // is listed first, so it settles at its default and the flipped LONG box — which reaches back
    // over it — is the one the sweep moves.
    const at = (x: string, label: string) => ({ x, y: 0.4, label, connector: true });
    const { svg } = renderChart(withPoints([at("2.845", "M"), at("3.5", LONG)]), ROWS, { width: 720, height: 400, document });
    const box = anchoredBox(svg as SVGSVGElement, LONG);
    expect(box.anchor).toBe("end");
    expect(svg.querySelectorAll('g[aria-label="arrow"]').length).toBe(1);
    // The shaft leaves the label at the edge FACING the point, and the flip is what decided which
    // edge that is: anchored "end", the box's right edge sits at the anchor, so the start lands
    // within a couple of px of `x1` rather than at the box's centre. Compared against the label's
    // own box, not against a `dy`-pinned render — pinning at the 12px default now draws no leader
    // at all, so there is nothing there to compare with.
    const s = arrowStart(svg as SVGSVGElement);
    expect(Math.abs(s.x - box.x1)).toBeLessThanOrEqual(3);
    // Non-vacuity: the box's centre is far from where the shaft starts, so this would fail if the
    // leader still began at the anchor-as-centre.
    expect(Math.abs(s.x - (box.x0 + box.x1) / 2)).toBeGreaterThan(LABEL_CHAR_PX);
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

// ---------------------------------------------------------------------------
// Rendered — connector leader defaults: 12px offset, headless line, gap at the marker
// ---------------------------------------------------------------------------

/** Every arrow-mark path in the plot, as its `d` string. */
function leaderPaths(svg: SVGSVGElement): string[] {
  return Array.from(svg.querySelectorAll('g[aria-label="arrow"] path')).map((p) => p.getAttribute("d") ?? "");
}

/** The two endpoints of a leader path. A headless leader is exactly `M x1,y1 L x2,y2`. */
function leaderEnds(d: string): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const m = /^M\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*L\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*$/.exec(d.trim());
  expect(m, d).not.toBeNull();
  return { start: { x: Number(m![1]), y: Number(m![2]) }, end: { x: Number(m![3]), y: Number(m![4]) } };
}

const DOT_GROUPS = (svg: SVGSVGElement): number => svg.querySelectorAll('g[aria-label="dot"]').length;

describe("annotations.points — connector leader defaults", () => {
  const DIMS = { width: 720, height: 400, document };

  it("a connector label's default offset is 12px above the point", () => {
    // Pinning the same callout with `dy: 12` must land on the identical pixel. LONE is interior and
    // isolated, so neither the vertical sweep nor the frame-edge flip can move it.
    const auto = renderChart(withPoints([{ point: "LONE", label: "Lonely", connector: true }]), ROWS, DIMS);
    const pinned = renderChart(withPoints([{ point: "LONE", label: "Lonely", connector: true, dy: 12 }]), ROWS, DIMS);
    const a = labelBoxes(auto.svg as SVGSVGElement, ["Lonely"])[0]!;
    const p = labelBoxes(pinned.svg as SVGSVGElement, ["Lonely"])[0]!;
    expect(a.y).toBe(p.y);
    expect(a.x0).toBe(p.x0);
  });

  it("and it is 6px lower than the old 28px default (this test is not vacuous)", () => {
    const auto = renderChart(withPoints([{ point: "LONE", label: "Lonely", connector: true }]), ROWS, DIMS);
    const old = renderChart(withPoints([{ point: "LONE", label: "Lonely", connector: true, dy: 28 }]), ROWS, DIMS);
    const a = labelBoxes(auto.svg as SVGSVGElement, ["Lonely"])[0]!;
    const o = labelBoxes(old.svg as SVGSVGElement, ["Lonely"])[0]!;
    expect(a.y - o.y).toBeCloseTo(16, 6);
  });

  it("the NO-connector default is unchanged at 6px above the point", () => {
    // Two published figures carry an unpinned connector-less callout; this pins that default.
    const auto = renderChart(withPoints([{ point: "LONE", label: "Lonely" }]), ROWS, DIMS);
    const pinned = renderChart(withPoints([{ point: "LONE", label: "Lonely", dy: 6 }]), ROWS, DIMS);
    const a = labelBoxes(auto.svg as SVGSVGElement, ["Lonely"])[0]!;
    const p = labelBoxes(pinned.svg as SVGSVGElement, ["Lonely"])[0]!;
    expect(a.y).toBe(p.y);
    expect(a.x0).toBe(p.x0);
  });

  it("an auto-placed callout sitting at its default draws NO leader and no fallback marker", () => {
    const { svg } = renderChart(withPoints([{ point: "LONE", label: "Lonely", connector: true }]), ROWS, DIMS);
    const bare = renderChart(withPoints([{ point: "LONE", label: "Lonely" }]), ROWS, DIMS);
    expect(leaderPaths(svg as SVGSVGElement)).toEqual([]);
    // The fallback dot must not stand in for the leader either: same number of dot marks as the
    // identical chart with no connector at all.
    expect(DOT_GROUPS(svg as SVGSVGElement)).toBe(DOT_GROUPS(bare.svg as SVGSVGElement));
  });

  it("a pinned callout at that same 12px offset has no room for a leader either", () => {
    // The leader starts at the label's EDGE now, not at its anchor, so a one-row label needs about
    // 19px of offset before a shaft fits between its own text (half a row plus 2) and the marker
    // gap (6.6). At the 12px default there is nothing left to draw — and drawing it anyway is what
    // ran a line up through the label's own text. Pinned further out it appears.
    const tight = renderChart(withPoints([{ point: "LONE", label: "Lonely", connector: true, dy: 12 }]), ROWS, DIMS);
    expect(leaderPaths(tight.svg as SVGSVGElement)).toEqual([]);
    const roomy = renderChart(withPoints([{ point: "LONE", label: "Lonely", connector: true, dy: 30 }]), ROWS, DIMS);
    expect(leaderPaths(roomy.svg as SVGSVGElement).length).toBe(1);
  });

  it("keeps what it can at the default and gives every label it DOES move a visible leader", () => {
    // Four keyed callouts, all colliding. Measured on this fixture: 2025a (11.5px) and 2026a
    // (10.4px) hold their defaults and draw nothing, while 2025b (23.4px) and 2025b* (36.4px) are
    // lifted ABOVE their points and each draws a shaft. Two connectors, not four — and no label is
    // left in the state the sweep produced, clear of its dot but too close to carry the line that
    // says which dot it names.
    const labels = ["2025a", "2025b", "2025b*", "2026a"];
    const four = labels.map((k) => ({ point: k, label: k, connector: true }));
    const { svg } = renderChart(withPoints(four), ROWS, DIMS);
    const paths = leaderPaths(svg as SVGSVGElement);
    // Exactly as many leaders as labels that moved: compare each against the same callout pinned
    // at its own default, which is where a kept label stays.
    const auto = labelBoxes(svg as SVGSVGElement, labels);
    const pinned = labelBoxes(
      renderChart(withPoints(labels.map((k) => ({ point: k, label: k, connector: true, dy: 12 }))), ROWS, DIMS).svg as SVGSVGElement,
      labels,
    );
    const movedCount = auto.filter((b, k) => Math.abs(b.y - pinned[k]!.y) > 1e-9).length;
    expect(movedCount).toBeGreaterThan(0); // non-vacuity: something did have to move
    expect(paths.length).toBe(movedCount);
    // Crossings are MINIMISED, not eliminated, and this fixture is where that shows: four callouts
    // within ~70px of one x, so whichever label keeps its default sits in the upward corridor and a
    // second label sent the same way sits in the first's. Placement ranks crossings ahead of the
    // connector count, and one is the least achievable here — asserted as a ceiling so a
    // regression that reintroduces the cascade (which crossed several) still fails.
    const crossings = paths.reduce((acc, d) => {
      const { start: s } = leaderEnds(d);
      return acc + auto.filter((b) => s.x >= b.x0 - 0.5 && s.x <= b.x1 + 0.5 && Math.abs(s.y - b.y) < LABEL_ROW_H / 2 - 1).length;
    }, 0);
    expect(crossings).toBeLessThanOrEqual(1);
    // Every displaced label is far enough from its own point to carry a shaft, which is what stops
    // a moved label being left with no line at all.
    const dots = Array.from(svg.querySelectorAll('g[aria-label="dot"] circle')).map((c) => ({
      x: Number(c.getAttribute("cx")),
      y: Number(c.getAttribute("cy")),
    }));
    for (const [k, b] of auto.entries()) {
      if (Math.abs(b.y - pinned[k]!.y) <= 1e-9) continue; // kept at its default: no leader owed
      const own = dots.filter((d) => d.x >= b.x0 - 40 && d.x <= b.x1 + 40)
        .sort((p, q) => Math.abs(p.y - b.y) - Math.abs(q.y - b.y))[0];
      expect(own, `no dot near "${b.label}"`).toBeDefined();
      expect(Math.abs(own!.y - b.y), `"${b.label}" too close to its point for a shaft`)
        .toBeGreaterThanOrEqual(LABEL_ROW_H / 2 + 2 + MARK_POINT_R + 2 - 1);
    }
  });

  it("draws a shaft from exactly 15.1px of offset — the two insets added together", () => {
    // The documented threshold, gated rather than asserted in prose: half a 13px row plus 2 at the
    // label, plus MARK_POINT_R + 2 at the marker. One px below it nothing is drawn; one px above it
    // a (hairline) shaft is. An earlier draft of the docs claimed ~19px, which was the figure for a
    // COMFORTABLE shaft, not for the code's actual cut-off.
    const threshold = LABEL_ROW_H / 2 + 2 + (MARK_POINT_R + 2);
    expect(threshold).toBeCloseTo(15.1, 10);
    const below = renderChart(withPoints([{ point: "LONE", label: "Lonely", connector: true, dy: 15 }]), ROWS, DIMS);
    expect(leaderPaths(below.svg as SVGSVGElement)).toEqual([]);
    const above = renderChart(withPoints([{ point: "LONE", label: "Lonely", connector: true, dy: 16 }]), ROWS, DIMS);
    expect(leaderPaths(above.svg as SVGSVGElement).length).toBe(1);
  });

  it("a PINNED label is never swept, so it may sit over another callout's marker", () => {
    // The marker-clearance rule reaches auto-placed labels only: a `dx`/`dy` box is `fixed` and is
    // excluded from every placement column, so it is never tested against a disk. That is the same
    // exemption pinning already carries for the frame-edge flip and the frame clamp, and CONFIG-SPEC
    // says so — this gates it. Pinned straight down onto the neighbouring callout's point.
    const pinned = withPoints([
      { point: "2025b", label: "2025b", dy: -12 },
      { point: "2025b*", label: "2025b*", dy: -12 },
    ]);
    const a = labelBoxes(renderChart(pinned, ROWS, DIMS).svg as SVGSVGElement, ["2025b", "2025b*"]);
    // Both sit exactly where `dy: -12` puts them: 12px BELOW their own points, which on this
    // fixture (the two points are 1.2px apart) lands each label across the other's marker.
    const solo = labelBoxes(
      renderChart(withPoints([{ point: "2025b", label: "2025b", dy: -12 }]), ROWS, DIMS).svg as SVGSVGElement,
      ["2025b"],
    );
    expect(a[0]!.y).toBe(solo[0]!.y);
    expect(Math.abs(a[0]!.y - a[1]!.y)).toBeLessThan(LABEL_ROW_H);
  });

  it("a leader with no room is not emitted at all — no mark, not an empty path", () => {
    // It used to be pushed regardless and Plot dropped its geometry, leaving an empty `d`. The mark
    // is now never created, and the categorical dot fallback must not stand in for it: that
    // fallback is for an axis with no pixel geometry, not for a label touching its own point.
    const { svg } = renderChart(withPoints([{ point: "LONE", label: "Lonely", connector: true, dy: 4 }]), ROWS, DIMS);
    expect(svg.querySelectorAll('g[aria-label="arrow"]').length).toBe(0);
    const bare = renderChart(withPoints([{ point: "LONE", label: "Lonely" }]), ROWS, DIMS);
    expect(DOT_GROUPS(svg as SVGSVGElement)).toBe(DOT_GROUPS(bare.svg as SVGSVGElement));
  });

  it("neither of the demo's two same-x labels ends on either marker", () => {
    // The 2025b / 2025b* pair: same x, 1.2px apart in y. Plot puts its half-pixel crisp-edge
    // offset on text but not on dots, so the label's true centre is its transform less 0.5.
    const { svg } = renderChart(
      withPoints([{ point: "2025b", label: "{point_label}", connector: true }, { point: "2025b*", label: "{point_label}", connector: true }]),
      ROWS,
      DIMS,
    );
    const boxes = labelBoxes(svg as SVGSVGElement, ["2025b", "2025b*"]);
    // The two callout points are the only pair of data dots sharing an x.
    const dots = Array.from(svg.querySelectorAll('g[aria-label="dot"] circle')).map((c) => ({ x: Number(c.getAttribute("cx")), y: Number(c.getAttribute("cy")) }));
    const disks = dots.filter((d) => dots.filter((e) => Math.abs(e.x - d.x) < 1e-9).length === 2).map((d) => ({ ...d, r: MARK_POINT_R + 2 }));
    expect(disks.length).toBe(2);
    const pinned = labelBoxes(renderChart(withPoints([{ point: "2025b", label: "{point_label}", connector: true, dy: 12 }, { point: "2025b*", label: "{point_label}", connector: true, dy: 12 }]), ROWS, DIMS).svg as SVGSVGElement, ["2025b", "2025b*"]);
    let movedCount = 0;
    for (const [k, b] of boxes.entries()) {
      const rect = { x0: b.x0 - 0.5, x1: b.x1 - 0.5, y: b.y - 0.5, h: LABEL_ROW_H };
      if (b.y === pinned[k]!.y) {
        // The label that stayed keeps its default bit for bit — the carve-out that keeps a lone
        // callout byte-identical. A 13px box centred 12px up grazes its own 6.6px disk by ~1px.
        expect(b.x0).toBe(pinned[k]!.x0);
        continue;
      }
      movedCount++;
      for (const d of disks) {
        const nx = Math.min(Math.max(d.x, rect.x0), rect.x1);
        const ny = Math.min(Math.max(d.y, rect.y - rect.h / 2), rect.y + rect.h / 2);
        expect(Math.hypot(d.x - nx, d.y - ny), `${b.label} vs marker at ${d.y}`).toBeGreaterThanOrEqual(d.r - 1e-9);
      }
    }
    expect(movedCount).toBe(1);
  });

  it("never leaves a moved label clear of its dot but too close to carry a leader", () => {
    // The state the sweep used to produce, and the reason the render read as ambiguous: it moved a
    // label just far enough to clear the marker (13.6px on this fixture) and the shaft then did not
    // fit, so a displaced label had nothing tying it to its point. Placement now requires the room
    // for a shaft before it will use a position, so a moved label always carries its line.
    const { svg } = renderChart(
      withPoints([{ point: "2025b", label: "{point_label}", connector: true }, { point: "2025b*", label: "{point_label}", connector: true }]),
      ROWS,
      DIMS,
    );
    const boxes = labelBoxes(svg as SVGSVGElement, ["2025b", "2025b*"]);
    const pinned = labelBoxes(
      renderChart(withPoints([
        { point: "2025b", label: "{point_label}", connector: true, dy: 12 },
        { point: "2025b*", label: "{point_label}", connector: true, dy: 12 },
      ]), ROWS, DIMS).svg as SVGSVGElement,
      ["2025b", "2025b*"],
    );
    const moved = boxes.filter((b, k) => Math.abs(b.y - pinned[k]!.y) > 1e-9);
    expect(moved).toHaveLength(1);
    expect(leaderPaths(svg as SVGSVGElement)).toHaveLength(1);
  });

  it("a purely LATERAL edge flip earns NO leader — the label still hugs its point", () => {
    // The flip moves a label 6px sideways and leaves it 12px above its own point; a leader there is
    // a ~7px stub that reads as noise, so only a VERTICAL push (or an explicit dx/dy) draws one.
    const { svg } = renderChart(withPoints([{ point: "2009", label: LONG, connector: true }]), ROWS, DIMS);
    // Non-vacuity: the flip really did fire — the label is anchored away from the right edge.
    expect(anchoredBox(svg as SVGSVGElement, LONG).anchor).toBe("end");
    expect(leaderPaths(svg as SVGSVGElement)).toEqual([]);
  });

  it("paints every leader BENEATH every callout label, so a shaft cannot cross out text", () => {
    // The defect this gates: the callout label was pushed into `marks` inline, inside the
    // per-callout loop, so callout N+1's shaft was drawn AFTER callout N's label and straight over
    // it — and the white LABEL_HALO cannot rescue text that a later stroke paints on. The label
    // belongs in `labelMarks`, which assemble-plot pushes after every line and rect for exactly
    // this reason; point callouts were the one annotation not using it. Placement minimises
    // crossings but cannot always reach zero, so the paint order is what keeps the text readable.
    const four = ["2025a", "2025b", "2025b*", "2026a"].map((k) => ({ point: k, label: k, connector: true }));
    const { svg } = renderChart(withPoints(four), ROWS, DIMS);
    const kids = Array.from(svg.children);
    const arrowIdx = kids.map((g, i) => (g.getAttribute("aria-label") === "arrow" ? i : -1)).filter((i) => i >= 0);
    const labelIdx = kids
      .map((g, i) => (Array.from(g.querySelectorAll("text")).some((x) => four.some((c) => c.label === (x.textContent ?? "").trim())) ? i : -1))
      .filter((i) => i >= 0);
    // Non-vacuity: there really are leaders and callout labels to order.
    expect(arrowIdx.length).toBeGreaterThan(0);
    expect(labelIdx.length).toBeGreaterThan(0);
    expect(Math.max(...arrowIdx)).toBeLessThan(Math.min(...labelIdx));
  });

  it("gives up half a row plus 2 at the label and MARK_POINT_R + 2 at the point", () => {
    // dx: 0, dy: 30 pins the label straight above the point, so the whole 30px is vertical and the
    // shaft is what survives both insets. Asserting the LENGTH pins both ends at once; the old
    // form reconstructed the point from the shaft's start, which only held while the shaft began
    // at the label's anchor.
    const { svg } = renderChart(withPoints([{ point: "LONE", label: "Lonely", connector: true, dx: 0, dy: 30 }]), ROWS, DIMS);
    const { start, end } = leaderEnds(leaderPaths(svg as SVGSVGElement)[0]!);
    const expected = 30 - (LABEL_ROW_H / 2 + 2) - (MARK_POINT_R + 2);
    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeCloseTo(expected, 6);
  });

  it("owes nothing horizontally when dx anchors the box by the edge facing the point", () => {
    // With an explicit dx the label is anchored BY that edge, so the shaft starts 2px out rather
    // than half a box in: 40px of offset less 2 at the label and 6.6 at the marker.
    const { svg } = renderChart(withPoints([{ point: "LONE", label: "Lonely", connector: true, dx: -40, dy: 0 }]), ROWS, DIMS);
    const { start, end } = leaderEnds(leaderPaths(svg as SVGSVGElement)[0]!);
    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeCloseTo(40 - 2 - (MARK_POINT_R + 2), 6);
  });

  it("the leader is a plain two-point line in the callout's colour, with no arrowhead geometry", () => {
    const { svg } = renderChart(withPoints([{ point: "LONE", label: "Lonely", connector: true, dy: 30, color: "#C1121F" }]), ROWS, DIMS);
    // Plot hoists the constant stroke onto the mark's <g>; the path carries only the geometry.
    const g = svg.querySelector('g[aria-label="arrow"]')!;
    expect(g.getAttribute("stroke")).toBe("#C1121F");
    const d = leaderPaths(svg as SVGSVGElement)[0]!;
    // An arrowhead is appended to the shaft as a second `M…L…L…` run; a headless leader has exactly
    // one M, one L and no third coordinate pair.
    expect(d.trim()).toMatch(/^M-?[\d.]+,-?[\d.]+L-?[\d.]+,-?[\d.]+$/);
    expect(Array.from(d.matchAll(/[ML]/g)).length).toBe(2);
    expect(svg.querySelector('g[aria-label="arrow"] path')!.getAttribute("marker-end")).toBeNull();
  });

  it("with no width/height, where no leader can be drawn either, only a PINNED callout keeps the fallback dot", () => {
    // The leader needs the rendered dimensions to convert its px offset into data space, and so
    // does placement — so an auto-placed callout here is always at its default and draws nothing.
    const bare = renderChart(withPoints([{ point: "LONE", label: "Lonely" }]), ROWS, { document });
    const auto = renderChart(withPoints([{ point: "LONE", label: "Lonely", connector: true }]), ROWS, { document });
    const pinned = renderChart(withPoints([{ point: "LONE", label: "Lonely", connector: true, dy: 20 }]), ROWS, { document });
    expect(leaderPaths(auto.svg as SVGSVGElement)).toEqual([]);
    expect(DOT_GROUPS(auto.svg as SVGSVGElement)).toBe(DOT_GROUPS(bare.svg as SVGSVGElement));
    expect(DOT_GROUPS(pinned.svg as SVGSVGElement)).toBe(DOT_GROUPS(bare.svg as SVGSVGElement) + 1);
  });

  it("on a categorical axis, where no leader can be drawn, only a PINNED callout keeps the fallback dot", () => {
    const spec = (points: unknown[]) =>
      ({
        title: "T", chartType: "bar", xAxisType: "categorical", data: "d.csv",
        annotations: { points },
      }) as unknown as ChartSpec;
    const rows = rowsOf([{ time: "a", series: "s", value: "1" }, { time: "b", series: "s", value: "2" }]);
    const bare = renderChart(spec([{ x: "a", y: 1, label: "One" }]), rows, DIMS);
    const auto = renderChart(spec([{ x: "a", y: 1, label: "One", connector: true }]), rows, DIMS);
    const pinned = renderChart(spec([{ x: "a", y: 1, label: "One", connector: true, dy: 20 }]), rows, DIMS);
    expect(DOT_GROUPS(auto.svg as SVGSVGElement)).toBe(DOT_GROUPS(bare.svg as SVGSVGElement));
    expect(DOT_GROUPS(pinned.svg as SVGSVGElement)).toBe(DOT_GROUPS(bare.svg as SVGSVGElement) + 1);
  });
});
