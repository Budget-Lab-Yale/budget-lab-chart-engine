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
}

export interface PlacementOpts {
  /** Horizontal slack: two boxes this close count as sharing a column (assemble-plot's LABEL_GAP). */
  gap: number;
  /** Range for the centres of MOVED labels — the plot's inner height, inset half a row. */
  lo: number;
  hi: number;
}

/**
 * Final label-centre y for each box, in input order. Only a MOVABLE box that actually collides
 * with another box — overlapping in both axes — is ever assigned a new y; every other entry is the
 * input `y` itself (copied, not recomputed), so a chart whose callouts never touched renders
 * byte-identically to before this existed. That is also why a lone label near the frame edge is
 * NOT clamped: the clamp considers only labels that took part in a collision.
 *
 * Within each column of horizontally-near movable boxes, labels are settled by a sweep in the
 * current visual order: each label is pushed (down, or up in the mirror sweep) until it collides
 * with no near label already settled in this sweep and no near FIXED box (a pinned label is an
 * obstacle, never moved). A label already settled never moves again within a sweep, so every
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
            ys[i] = ys[j]! + dir * clearance(boxes[i]!, boxes[j]!);
            involved.add(i);
            involved.add(j);
            moved = again = true;
          }
        }
      }
      return moved;
    };
    if (!sweep(1)) continue;
    const extreme = (dir: 1 | -1): number | null => {
      let best: number | null = null;
      for (const i of involved) {
        if (boxes[i]!.fixed) continue;
        if (best == null || dir * (ys[i]! - ys[best]!) > 0) best = i;
      }
      return best;
    };
    // Bottom overflow: pin the lowest involved label to `hi` and sweep up; each pin is permanent
    // (an upward sweep only raises labels), so at most one iteration per label.
    for (let g = 0; g < col.length; g++) {
      const low = extreme(1);
      if (low == null || ys[low]! <= o.hi) break;
      ys[low] = o.hi;
      sweep(-1);
    }
    // Top overflow: the top wins — pin the highest involved label to `lo` and sweep down, letting a
    // stack taller than the frame overflow the bottom. The sweep preserves the CURRENT visual order,
    // which the bottom-overflow pass above may already have shuffled relative to spec order, so once
    // a column overflows the frame no input-order guarantee survives — only "no collisions left".
    for (let g = 0; g < col.length; g++) {
      const high = extreme(-1);
      if (high == null || ys[high]! >= o.lo) break;
      ys[high] = o.lo;
      sweep(1);
    }
  }
  return ys;
}
