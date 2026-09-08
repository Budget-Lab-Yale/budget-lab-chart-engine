// Vertical de-collision for point-callout labels (annotations.points without an explicit dx/dy).
// Deterministic on purpose: the live HTML, the PNG export (which re-renders from the spec) and SSR
// must put every label in the same place, so boxes are ESTIMATED from label length — the same
// reasoning as the x-marker stagger in assemble-plot — never measured with getBBox.

export interface CalloutBox {
  /** Horizontal px extent of the estimated label box at the callout's DEFAULT offset. */
  x0: number;
  x1: number;
  /** Vertical centre of the label box at the default offset (SVG px, down = +). */
  y: number;
  /** Box height: one row per rendered line (a `maxWidth`-wrapped label is taller than one row). */
  h: number;
  /** An explicit `dx` or `dy` pins the label: it keeps `y` exactly and the others route around it. */
  fixed: boolean;
  /** The callout's own point, as a disk no MOVED label may come to rest on: the marker radius plus
   *  the leader's end gap. Every box's disk constrains every moved label, its own included — a
   *  label pushed one row down from the 12px connector default would otherwise land ON its point,
   *  covering the marker and leaving a leader shorter than the gap, which draws nothing at all. */
  disk?: CalloutDisk;
}

export interface CalloutDisk {
  x: number;
  y: number;
  r: number;
}

/**
 * The nearest centre y in direction `dir` at which the box `b`, currently centred on `y`, is clear
 * of the disk `d` — or null if it already is. Exact circle/rectangle geometry, not a bounding box:
 * the vertical clearance a label owes a disk shrinks to nothing as the disk passes outside the
 * label's horizontal extent, so a label never steps aside for a marker it does not actually cover.
 */
function clearOfDisk(b: CalloutBox, y: number, d: CalloutDisk, dir: 1 | -1): number | null {
  const gapX = Math.abs(d.x - Math.min(Math.max(d.x, b.x0), b.x1));
  if (gapX >= d.r) return null; // the disk misses the label's column entirely
  const need = b.h / 2 + Math.sqrt(d.r * d.r - gapX * gapX);
  return Math.abs(y - d.y) >= need ? null : clearBy(d.y, need, dir);
}

/**
 * The coordinate `need` px from `from` in direction `dir`, adjusted until the gap MEASURES at least
 * `need` under the same comparison that asked for it.
 *
 * `(from + need) - from` can come back a hair UNDER `need`: at `from = 49.65119702592492`,
 * `need = 19.5` it is short by 7e-15, so the arithmetic target is not a fixed point of the test
 * that demanded it. Unadjusted that is not a rounding nit but an infinite loop — the push assigns
 * the value the label already holds, the collision test still reports an overlap, and the sweep
 * re-arms on a push that moved nothing (it hung the suite as a crashed worker, with no failing
 * assertion to read). One step to the next representable double settles it; the cap bounds the
 * walk. In every case where the plain sum already measures wide enough this returns it UNCHANGED,
 * so no position that previously settled moves by even one bit.
 */
function clearBy(from: number, need: number, dir: 1 | -1): number {
  let t = from + dir * need;
  for (let k = 0; k < 4 && Math.abs(t - from) < need; k++) {
    t += dir * Math.max(Math.abs(t), 1) * Number.EPSILON;
  }
  return t;
}

export interface PlacementOpts {
  /** Horizontal slack: two boxes this close count as sharing a column (assemble-plot's LABEL_GAP). */
  gap: number;
  /** The plot frame's top and bottom edge in px. A moved label is held inside them by its OWN
   *  half-height, so the guarantee is that the BOX stays in the frame rather than its centre. These
   *  used to be pre-inset centre bounds, computed once from half of ONE row: a label wrapped by
   *  `maxWidth`, or broken by an explicit line break, is taller than that, so its centre was
   *  clamped 6.5px from the edge while its half-height was 13px or more, and it hung outside the
   *  frame by half of every extra row — contradicting the clamp CONFIG-SPEC promises. */
  top: number;
  bottom: number;
}

/**
 * Final label-centre y for each box, in input order. Only a MOVABLE box that actually collides
 * with another box — overlapping in both axes — is ever assigned a new y; every other entry is the
 * input `y` itself (copied, not recomputed), so a chart whose callouts never touched renders
 * byte-identically to before this existed. That is also why a lone label near the frame edge is
 * NOT clamped: the clamp considers only labels that took part in a collision.
 *
 * A label that HAS left its default additionally clears every callout's marker disk (`box.disk`),
 * continuing past the marker in the sweep direction. That constraint deliberately does not apply
 * while a label sits at its input y: a 13px-tall box centred on the 12px connector default grazes
 * its own 6.6px disk by about a pixel, so enforcing it there would move every lone callout and
 * break the byte-identity guarantee above. It applies the moment something pushes the label, which
 * is when the label would otherwise cross the marker rather than graze it.
 *
 * Within each column of horizontally-near movable boxes, labels are settled by a sweep in the
 * current visual order: each label is pushed (down, or up in the mirror sweep) until it collides
 * with no near label already settled in this sweep and no near FIXED box (a pinned label is an
 * obstacle, never moved) and, once moved, no marker disk. A label already settled never moves again within a sweep, so every
 * branch below ends with a full sweep and therefore with no collision left behind. If the involved
 * stack overflows `hi`, its lowest label is pinned to `hi` and the column swept upward, repeated
 * while an involved label is still past `hi` (each pin is permanent, so this ends); if an involved
 * label then sits above `lo`, the top wins — it is pinned to `lo` and the column swept downward,
 * overflowing the bottom when a stack is taller than the frame.
 */
export function placePointCallouts(boxes: CalloutBox[], o: PlacementOpts): number[] {
  const n = boxes.length;
  const ys = boxes.map((b) => b.y);
  const near = (a: CalloutBox, b: CalloutBox): boolean => a.x0 < b.x1 + o.gap && b.x0 < a.x1 + o.gap;
  // Two boxes are clear when their centres are at least half of each height apart.
  const clearance = (a: CalloutBox, b: CalloutBox): number => (a.h + b.h) / 2;
  const collide = (i: number, j: number): boolean =>
    near(boxes[i]!, boxes[j]!) && Math.abs(ys[i]! - ys[j]!) < clearance(boxes[i]!, boxes[j]!);
  const fixed = boxes.map((_, i) => i).filter((i) => boxes[i]!.fixed);
  // Per-box centre limits: a taller label owes the frame more room. Equal for every one-row box, so
  // a chart of single-line callouts clamps exactly where it did before these became box-specific.
  const loOf = (b: CalloutBox): number => o.top + b.h / 2;
  const hiOf = (b: CalloutBox): number => o.bottom - b.h / 2;
  const disks = boxes.map((b) => b.disk).filter((d): d is CalloutDisk => d != null);

  // Columns: union-find over the movable boxes on horizontal nearness alone (A near B, B near C
  // joins A and C), so a whole stack is swept together even when its ends never touch.
  const parent = boxes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < n; i++) {
    if (boxes[i]!.fixed) continue;
    for (let j = i + 1; j < n; j++) {
      if (boxes[j]!.fixed || !near(boxes[i]!, boxes[j]!)) continue;
      parent[find(j)] = find(i);
    }
  }
  const columns = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    if (boxes[i]!.fixed) continue;
    const root = find(i);
    const col = columns.get(root);
    if (col) col.push(i);
    else columns.set(root, [i]);
  }

  for (const col of columns.values()) {
    // Labels that collided in some sweep (pushed, or pushed against): the only ones the clamp may
    // touch. Everything else keeps its input y bit for bit.
    const involved = new Set<number>();
    // One sweep in direction `dir` (+1 down, -1 up) over the column in CURRENT visual order (ties
    // by input index). Each label is pushed past every near label settled before it and every near
    // fixed box until it collides with none; pushes are monotone, so the loop ends.
    const sweep = (dir: 1 | -1): boolean => {
      const order = [...col].sort((a, b) => dir * (ys[a]! - ys[b]!) || a - b);
      let moved = false;
      for (let k = 0; k < order.length; k++) {
        const i = order[k]!;
        const obstacles = [...order.slice(0, k), ...fixed];
        for (let again = true; again; ) {
          again = false;
          for (const j of obstacles) {
            if (!collide(i, j)) continue;
            const target = clearBy(ys[j]!, clearance(boxes[i]!, boxes[j]!), dir);
            // The same monotonicity guard the disk push below carries, for the same reason. With
            // `clearBy` the target always advances, so this cannot fire; it is here so termination
            // is a property of THIS loop rather than of floating-point reasoning one call away —
            // a push that moves nothing must not re-arm the sweep. If it ever fires the pair is
            // left overlapping, which the property check reports as a failure instead of a hang.
            if (dir * (target - ys[i]!) <= 0) continue;
            ys[i] = target;
            involved.add(i);
            involved.add(j);
            moved = again = true;
          }
          // Re-read after the label pushes above: a label only owes the markers a berth once it has
          // left its default. Every push here is monotone in `dir` and lands on one of a finite set
          // of obstacle-determined positions, so the loop cannot cycle.
          if (ys[i] !== boxes[i]!.y) {
            for (const d of disks) {
              const clear = clearOfDisk(boxes[i]!, ys[i]!, d, dir);
              // The `<= 0` arm is a termination guard, not a nicety: `d.y + dir * need` can come
              // back a float hair SHORT of clearing the disk it was solved for, and re-solving it
              // to the same number forever is an infinite loop (it hung the suite once). Every
              // accepted push is therefore strictly monotone in `dir`.
              if (clear == null || dir * (clear - ys[i]!) <= 0) continue;
              ys[i] = clear;
              involved.add(i);
              moved = again = true;
            }
          }
        }
      }
      return moved;
    };
    if (!sweep(1)) continue;
    // The involved movable box that most overruns its OWN limit in `dir`, or null if none does.
    // Not simply the lowest/highest label: limits are per-box now, so a tall box can overrun while a
    // shorter one below it is still inside the frame, and picking by position alone would stop at the
    // shorter one and leave the tall one hanging out.
    const worst = (dir: 1 | -1): number | null => {
      let best: number | null = null;
      let bestOver = 0;
      for (const i of involved) {
        if (boxes[i]!.fixed) continue;
        const over = dir * (ys[i]! - (dir === 1 ? hiOf(boxes[i]!) : loOf(boxes[i]!)));
        if (over > 0 && (best == null || over > bestOver)) {
          best = i;
          bestOver = over;
        }
      }
      return best;
    };
    // Bottom overflow: pin the lowest involved label to `hi` and sweep up; each pin is permanent
    // (an upward sweep only raises labels), so at most one iteration per label.
    for (let g = 0; g < col.length; g++) {
      const low = worst(1);
      if (low == null) break;
      ys[low] = hiOf(boxes[low]!);
      sweep(-1);
    }
    // Top overflow: the top wins — pin the highest involved label to `lo` and sweep down, letting a
    // stack taller than the frame overflow the bottom. The sweep preserves the CURRENT visual order,
    // which the bottom-overflow pass above may already have shuffled relative to spec order, so once
    // a column overflows the frame no input-order guarantee survives — only "no collisions left".
    for (let g = 0; g < col.length; g++) {
      const high = worst(-1);
      if (high == null) break;
      ys[high] = loOf(boxes[high]!);
      sweep(1);
    }
  }
  return ys;
}
