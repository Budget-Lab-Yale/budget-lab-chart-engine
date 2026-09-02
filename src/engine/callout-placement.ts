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
 * NOT clamped: the clamp only runs on a column in which something moved.
 *
 * Within each column of horizontally-near movable boxes, labels are pushed apart by a cascaded
 * sweep, top to bottom: each label moves just clear of every near movable label above it and of
 * every near FIXED box (a pinned label is an obstacle, never moved), so a pushed label pushes the
 * next, however many there are — monotone, so no iteration to bound and no collision left behind.
 * If the stack overflows `hi`, a mirror sweep from `hi` pushes it back up (again clearing fixed
 * boxes); if its top then sits above `lo`, the top wins: it is pinned to `lo` and the stack
 * overflows downward, which keeps the labels in reading order when a stack is taller than the frame.
 */
export function placePointCallouts(boxes: CalloutBox[], o: PlacementOpts): number[] {
  const n = boxes.length;
  const ys = boxes.map((b) => b.y);
  const near = (a: CalloutBox, b: CalloutBox): boolean => a.x0 < b.x1 + o.gap && b.x0 < a.x1 + o.gap;
  // Two boxes are clear when their centres are at least half of each height apart.
  const clearance = (a: CalloutBox, b: CalloutBox): number => (a.h + b.h) / 2;
  const collide = (a: CalloutBox, ay: number, b: CalloutBox, by: number): boolean =>
    near(a, b) && Math.abs(ay - by) < clearance(a, b);
  const fixedUp = boxes.map((_, i) => i).filter((i) => boxes[i]!.fixed).sort((a, b) => ys[a]! - ys[b]!);
  const fixedDown = [...fixedUp].reverse();

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

  // Push label i down past every near fixed box it collides with. Fixed boxes are visited in
  // ascending y and the label only ever moves down, so a box already passed cannot be hit again;
  // the loop re-runs only for two fixed boxes of different heights stacked on one y.
  const clearFixedDown = (i: number): boolean => {
    let moved = false;
    for (let again = true; again; ) {
      again = false;
      for (const f of fixedUp) {
        if (!collide(boxes[i]!, ys[i]!, boxes[f]!, ys[f]!)) continue;
        ys[i] = ys[f]! + clearance(boxes[i]!, boxes[f]!);
        moved = again = true;
      }
    }
    return moved;
  };
  const clearFixedUp = (i: number): void => {
    for (let again = true; again; ) {
      again = false;
      for (const f of fixedDown) {
        if (!collide(boxes[i]!, ys[i]!, boxes[f]!, ys[f]!)) continue;
        ys[i] = ys[f]! - clearance(boxes[i]!, boxes[f]!);
        again = true;
      }
    }
  };

  for (const col of columns.values()) {
    // Stable by input index, then by default y: the sweep order is the visual order.
    const order = [...col].sort((a, b) => ys[a]! - ys[b]! || a - b);
    // Downward sweep. Non-near labels in the same column are not obstacles — they do not overlap,
    // so they must not move anything.
    const down = (): boolean => {
      let moved = false;
      for (let k = 0; k < order.length; k++) {
        const i = order[k]!;
        for (let m = 0; m < k; m++) {
          const j = order[m]!;
          if (!near(boxes[i]!, boxes[j]!)) continue;
          const floor = ys[j]! + clearance(boxes[i]!, boxes[j]!);
          if (ys[i]! < floor) {
            ys[i] = floor;
            moved = true;
          }
        }
        if (clearFixedDown(i)) moved = true;
      }
      return moved;
    };
    if (!down()) continue;
    const last = order[order.length - 1]!;
    if (ys[last]! > o.hi) {
      ys[last] = o.hi;
      clearFixedUp(last);
      for (let k = order.length - 2; k >= 0; k--) {
        const i = order[k]!;
        for (let m = order.length - 1; m > k; m--) {
          const j = order[m]!;
          if (!near(boxes[i]!, boxes[j]!)) continue;
          const ceil = ys[j]! - clearance(boxes[i]!, boxes[j]!);
          if (ys[i]! > ceil) ys[i] = ceil;
        }
        clearFixedUp(i);
      }
    }
    const first = order[0]!;
    if (ys[first]! < o.lo) {
      ys[first] = o.lo;
      down();
    }
  }
  return ys;
}
