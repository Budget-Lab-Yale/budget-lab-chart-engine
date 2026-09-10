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
  /** This callout draws a leader once it leaves its default, so a DISPLACED position has to leave
   *  room for a visible shaft between the label's edge and the marker's — not merely clear the
   *  marker. Without it the search would park a label 13px out, clear of the dot and still too
   *  close to draw the line that says which dot it names. */
  wantsLeader?: boolean;
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
 * assertion to read). One step of `EPSILON * max(|t|, 1)` settles it in practice — that is a
 * relative nudge of a couple of ULPs at plot coordinates, not literally `nextUp`, and the cap
 * bounds the walk. In every case where the plain sum already measures wide enough this returns it UNCHANGED,
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
  /** Px a displaced leader-drawing label owes BEYOND half its own height, so a shaft is actually
   *  visible: the gap at the label's edge, the gap at the marker, and a minimum shaft. Supplied by
   *  assemble-plot, which owns those constants. Absent ⇒ the marker radius alone. */
  leaderClearance?: number;
}

/**
 * Final label-centre y for each box, in input order. Only a MOVABLE box that actually collides
 * with another box — overlapping in both axes — is ever assigned a new y; every other entry is the
 * input `y` itself (copied, not recomputed), so a chart whose callouts never touched renders
 * byte-identically to before this existed. That is also why a lone label near the frame edge is
 * NOT clamped: the clamp considers only labels that took part in a collision.
 *
 * Every label clears every OTHER callout's marker disk (`box.disk`), moved or not, continuing past
 * the marker in the sweep direction: a label parked on a different labelled point cannot be read.
 * A label's OWN marker is exempt while the label sits at its input y — a 13px-tall box centred on
 * the 12px connector default grazes its own 6.6px disk by about a pixel, so enforcing it there
 * would move every lone callout and break the byte-identity guarantee above — and binds the moment
 * something pushes it, which is when the label would cross the marker rather than graze it. A lone
 * callout therefore still cannot move: there is no other marker for it to clear.
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
function sweepPlace(boxes: CalloutBox[], o: PlacementOpts): number[] {
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
  // Owner-tagged: a label's OWN marker is exempt while the label sits at its default, but ANOTHER
  // callout's marker never is (see the sweep below).
  const disks = boxes
    .map((b, i) => ({ owner: i, d: b.disk }))
    .filter((e): e is { owner: number; d: CalloutDisk } => e.d != null);

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
          // Re-read after the label pushes above. Every push here is monotone in `dir` and lands on
          // one of a finite set of obstacle-determined positions, so the loop cannot cycle.
          for (const { owner, d } of disks) {
            // A label's OWN marker is exempt WHILE THE LABEL IS STILL AT ITS DEFAULT: a one-row box
            // centred on the 12px connector default grazes its own 6.6px disk by about a pixel, and
            // enforcing it there would move every lone callout and break the byte-identity
            // guarantee above. ANOTHER callout's marker is never exempt, at any offset — a label
            // parked on top of a different labelled point is unreadable, and reading it as "which
            // of these two labels belongs to this dot?" is exactly the confusion reported on the
            // 1.14.0 demo. A lone callout has no other marker to clear, so it still cannot move.
            if (owner === i && ys[i] === boxes[i]!.y) continue;
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

// ---------------------------------------------------------------------------
// Connector-minimising placement
// ---------------------------------------------------------------------------

/** Above this many movable callouts the subset search is abandoned for the sweep: the search is
 *  3^n in the number of movable labels, and no real chart is near this. */
const MAX_SEARCH_CALLOUTS = 9;

/**
 * How far a DISPLACED label's centre must sit from its own point.
 *
 * Clearing the marker is not enough for a callout that draws a leader: the shaft gives up room at
 * the label's edge and again at the marker, so a label parked just clear of the dot has nothing
 * left to draw with — which is how a moved label ended up with no line to say which dot it named.
 */
function displacedNeed(b: CalloutBox, o: PlacementOpts): number {
  const marker = b.disk ? b.disk.r : 0;
  const leader = b.wantsLeader ? (o.leaderClearance ?? marker) : marker;
  return b.h / 2 + Math.max(marker, leader);
}

/**
 * The position closest to `from` in direction `dir` at which box `i` is clear of every obstacle and
 * every marker, or null if the frame runs out first.
 *
 * Same monotone push the sweep uses, run for ONE label against an already-settled arrangement:
 * every accepted step advances strictly in `dir` (see `clearBy`), and the obstacles do not move,
 * so it terminates.
 */
function settle(
  i: number,
  from: number,
  dir: 1 | -1,
  boxes: CalloutBox[],
  ys: number[],
  obstacles: number[],
  o: PlacementOpts,
): number | null {
  const b = boxes[i]!;
  const clearance = (a: CalloutBox, c: CalloutBox): number => (a.h + c.h) / 2;
  const near = (a: CalloutBox, c: CalloutBox): boolean => a.x0 < c.x1 + o.gap && c.x0 < a.x1 + o.gap;
  let y = from;
  for (let guard = 0; guard < 4 * (boxes.length + 2); guard++) {
    let advanced = false;
    for (const j of obstacles) {
      if (j === i || !near(b, boxes[j]!)) continue;
      if (Math.abs(y - ys[j]!) >= clearance(b, boxes[j]!)) continue;
      const target = clearBy(ys[j]!, clearance(b, boxes[j]!), dir);
      if (dir * (target - y) > 0) {
        y = target;
        advanced = true;
      }
    }
    for (const [j, other] of boxes.entries()) {
      if (!other.disk) continue;
      // Its OWN marker is handled by `from` already being `displacedNeed` away; a foreign one is
      // never exempt, at any offset.
      const clear = clearOfDisk(b, y, other.disk, dir);
      if (clear != null && dir * (clear - y) > 0 && (j !== i || Math.abs(y - other.disk.y) < displacedNeed(b, o))) {
        y = clear;
        advanced = true;
      }
    }
    if (!advanced) break;
  }
  if (y - b.h / 2 < o.top - 1e-9 || y + b.h / 2 > o.bottom + 1e-9) return null;
  return y;
}

/** Does the segment a→b touch the axis-aligned rectangle? Liang-Barsky clip, so a shaft that only
 *  grazes a corner counts and one that passes outside does not. */
function segmentHitsRect(
  ax: number, ay: number, bx: number, by: number,
  x0: number, y0: number, x1: number, y1: number,
): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]] as Array<[number, number]>) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1;
}

/**
 * Where a label's leader starts horizontally. The shaft runs from the label's anchor to the point,
 * and the anchor is the box's own centre only when the label is centred on its point; an explicit
 * or flipped `dx` anchors the box BY the edge facing the point, which is what makes the shaft
 * slanted rather than vertical.
 */
function anchorX(b: CalloutBox, px: number): number {
  const mid = (b.x0 + b.x1) / 2;
  if (Math.abs(mid - px) < 0.5) return px;
  return b.x0 > px ? b.x0 : b.x1;
}

/**
 * How many labels the drawn leaders cross, over a WHOLE arrangement.
 *
 * Scored once every label has its final position, and over every leader that is actually drawn —
 * each displaced leader-drawing label, plus every PINNED one, which draws unconditionally. Scoring
 * incrementally as labels were placed missed two whole classes: an earlier-placed label's shaft
 * crossing a later-placed one, and a pinned label's shaft crossing anything the search moved.
 *
 * The shaft is the real segment from the label's anchor to just short of the marker, not a vertical
 * line at the point's x — for a flipped or pinned label those differ by the `dx` offset, and since
 * crossings are the first ranking key even a six-pixel discrepancy can pick a worse arrangement.
 *
 * A COUNT rather than a veto, because with several callouts sharing nearly one x no arrangement can
 * avoid every crossing: whichever label is kept sits in the upward corridor, and a second label
 * sent the same way sits in the first's. Treated as a hard constraint the search finds nothing at
 * all and falls back to the sweep, which is worse on both counts. Ranked ahead of the connector
 * count because a line drawn through text is a rendering defect, where an extra connector is only
 * noise — and the paint order (assemble-plot pushes callout labels last) keeps the residue legible.
 */
function arrangementCrossings(
  boxes: CalloutBox[],
  ys: number[],
  drawsLeader: boolean[],
  o: PlacementOpts,
): number {
  let crossings = 0;
  for (const [i, b] of boxes.entries()) {
    if (!drawsLeader[i] || !b.disk) continue;
    const px = b.disk.x;
    const ax = anchorX(b, px);
    const ay = ys[i]!;
    // The shaft assemble-plot actually draws: from the label's anchor toward the point, inset at
    // the label end and again at the marker. Modelled along the REAL direction, not vertically —
    // a pinned `dx: 16, dy: 12` leader is a diagonal that a vertical-only model skipped entirely,
    // so its crossings never reached the ranking.
    const vx = px - ax;
    const vy = b.disk.y - ay;
    const len = Math.hypot(vx, vy);
    if (len <= 0) continue;
    const startInset = (Math.abs(ax - px) < 0.5 ? b.h / 2 : 0) + 2;
    // The render-time fit gate, mirrored: a shaft with nothing left between the two insets is not
    // drawn, so scoring its corridor would let a line that does not exist move labels around.
    if (len - startInset - b.disk.r <= 0) continue;
    const ux = vx / len;
    const uy = vy / len;
    const sx = ax + ux * startInset;
    const sy = ay + uy * startInset;
    const ex = px - ux * b.disk.r;
    const ey = b.disk.y - uy * b.disk.r;
    for (const [j, other] of boxes.entries()) {
      if (j === i) continue;
      if (segmentHitsRect(sx, sy, ex, ey, other.x0, ys[j]! - other.h / 2, other.x1, ys[j]! + other.h / 2)) {
        crossings++;
      }
    }
  }
  return crossings;
}

/**
 * Place the callouts so that as FEW of them as possible need a connector.
 *
 * A label sitting at its default offset needs no leader — its proximity says which point it belongs
 * to — so every label kept at its default is one line saved. The sweep this replaces went the other
 * way: it pushed labels in ONE direction on a collision, cascading, which maximised the number
 * displaced and therefore the number of lines. On the motivating chart it moved both of two close
 * callouts and drew two short leaders where lifting one clear and leaving the other alone draws one.
 *
 * Each label gets one of three treatments — keep at its default, lift ABOVE its point, or drop
 * BELOW it — and the whole assignment is searched. Direction has to be part of the search, not a
 * per-label preference: where several callouts share nearly one x, a lifted label's leader runs
 * down through whatever sits between it and its point, so the only arrangements that work send
 * some labels up and others down. An assignment is FEASIBLE when the kept labels hold their
 * defaults clear of each other and of every marker, and each displaced label settles clear of
 * everything with room for a visible shaft. A leader crossing another label does NOT make an
 * assignment infeasible — with several callouts near one x nothing can avoid every crossing, so it
 * is scored instead (see `arrangementCrossings`) and the paint order keeps the residue legible.
 *
 * Ranked by: fewest crossings, then fewest CONNECTORS (a displaced label with no leader costs no
 * line, so it is the one moved by preference), then fewest labels moved at all, then least total
 * movement, then the earliest assignment in a fixed enumeration — which puts "up" before "down", so
 * a tie lifts the label and runs its leader downward. Determinism matters as much as quality: the
 * live HTML, the PNG export and SSR must all agree, so nothing here may depend on iteration order
 * of a map or on floating-point luck.
 *
 * 3^n in the movable count, which is a handful on a real chart; past `MAX_SEARCH_CALLOUTS` it
 * defers to the sweep, as it does when no assignment at all is feasible.
 */
export function placePointCallouts(boxes: CalloutBox[], o: PlacementOpts): number[] {
  const movable = boxes.map((_, i) => i).filter((i) => !boxes[i]!.fixed);
  const fixed = boxes.map((_, i) => i).filter((i) => boxes[i]!.fixed);
  if (movable.length === 0) return boxes.map((b) => b.y);
  if (movable.length > MAX_SEARCH_CALLOUTS) return sweepPlace(boxes, o);

  const clearance = (a: CalloutBox, c: CalloutBox): number => (a.h + c.h) / 2;
  const near = (a: CalloutBox, c: CalloutBox): boolean => a.x0 < c.x1 + o.gap && c.x0 < a.x1 + o.gap;
  const onForeignMarker = (i: number, y: number): boolean =>
    boxes.some((other, j) => j !== i && other.disk != null && clearOfDisk(boxes[i]!, y, other.disk, 1) != null);

  // Whether a label's DEFAULT overlaps another movable label's default — "took part in a collision"
  // in the sense the frame clamp has always used. A label that did must end up inside the frame
  // whether the search moves it or keeps it; one that did not keeps its default untouched even off
  // the edge, which is the carve-out that leaves a lone callout byte-identical.
  const collidesAtDefault = boxes.map((b, i) =>
    !b.fixed &&
    boxes.some((c, j) => j !== i && !c.fixed && near(b, c) && Math.abs(b.y - c.y) < clearance(b, c)),
  );
  const insideFrame = (i: number, y: number): boolean =>
    y - boxes[i]!.h / 2 >= o.top - 1e-9 && y + boxes[i]!.h / 2 <= o.bottom + 1e-9;

  // A label with nothing to resolve MUST NOT move, at any score. CONFIG-SPEC promises that a callout
  // colliding with nothing and sitting on no other callout's marker keeps exactly its default
  // offset, and the byte-identity invariant rests on that promise — but ranking crossings first let
  // the search move such a label anyway, purely to stop a PINNED callout's leader crossing it, which
  // falsified the promise for a chart nobody had touched. Forcing them kept keeps both properties:
  // the search still chooses freely among the labels that DO have something to resolve, and it
  // prunes the enumeration at the same time. The cost is accepting that crossing, which the paint
  // order and the label halo already make legible.
  // NB this counts an overlap with a PINNED label too, where `collidesAtDefault` above deliberately
  // does not. `collidesAtDefault` answers "did this label take part in a collision", for the frame
  // clamp; this one answers "has this label any reason to move at all". Conflating them wedged the
  // search: a movable label overlapping only a pinned one was marked `mustKeep`, `attempt` then
  // refused to KEEP it (the kept-vs-fixed check fails), the prefilter refused to MOVE it, no
  // assignment was feasible, and the whole chart fell through to the sweep — losing the crossing,
  // connector and visible-shaft guarantees on a chart the search could have placed.
  const overlapsAnyAtDefault = boxes.map(
    (b, i) =>
      !b.fixed &&
      boxes.some((c, j) => j !== i && near(b, c) && Math.abs(b.y - c.y) < clearance(b, c)),
  );
  const mustKeep = boxes.map(
    (b, i) => !b.fixed && !overlapsAnyAtDefault[i] && !onForeignMarker(i, b.y),
  );

  /** 0 = keep at default, 1 = lift above the point, 2 = drop below it. */
  const attempt = (assign: number[]): { ys: number[]; connectors: number; moved: number; cost: number; crossings: number } | null => {
    const ys = boxes.map((b) => b.y);
    const keep = movable.filter((_, k) => assign[k] === 0);
    for (const i of keep) {
      if (onForeignMarker(i, ys[i]!)) return null;
      if (collidesAtDefault[i] && !insideFrame(i, ys[i]!)) return null;
    }
    for (let a = 0; a < keep.length; a++) {
      for (let b = a + 1; b < keep.length; b++) {
        const i = keep[a]!, j = keep[b]!;
        if (near(boxes[i]!, boxes[j]!) && Math.abs(ys[i]! - ys[j]!) < clearance(boxes[i]!, boxes[j]!)) return null;
      }
      for (const j of fixed) {
        const i = keep[a]!;
        if (near(boxes[i]!, boxes[j]!) && Math.abs(ys[i]! - ys[j]!) < clearance(boxes[i]!, boxes[j]!)) return null;
      }
    }
    const placed = [...fixed, ...keep];
    const drawsLeader = boxes.map((b) => b.fixed && b.wantsLeader === true);
    let cost = 0;
    let connectors = 0;
    let moved = 0;
    for (const [k, i] of movable.entries()) {
      if (assign[k] === 0) continue;
      const dir: 1 | -1 = assign[k] === 1 ? -1 : 1;
      const point = boxes[i]!.disk?.y ?? boxes[i]!.y;
      const need = displacedNeed(boxes[i]!, o);
      const y = settle(i, point + dir * need, dir, boxes, ys, placed, o);
      if (y == null) return null;
      ys[i] = y;
      cost += Math.abs(y - boxes[i]!.y);
      // CONNECTORS, not displaced labels: moving a label that draws no leader costs no line, so
      // counting it would tie a connector-bearing move against a free one and let the tie-break
      // draw a line that the other choice would not have drawn at all.
      moved++;
      if (boxes[i]!.wantsLeader) {
        connectors++;
        drawsLeader[i] = true;
      }
      placed.push(i);
    }
    return { ys, connectors, moved, cost, crossings: arrangementCrossings(boxes, ys, drawsLeader, o) };
  };

  const n = movable.length;
  let best: { ys: number[]; connectors: number; moved: number; cost: number; crossings: number } | null = null;
  const total = 3 ** n;
  for (let code = 0; code < total; code++) {
    const assign: number[] = [];
    let c = code;
    for (let k = 0; k < n; k++) {
      assign.push(c % 3);
      c = Math.floor(c / 3);
    }
    // Reject up front any assignment that displaces a label with no reason to move.
    let movesAnUntouchable = false;
    for (const [k, i] of movable.entries()) {
      if (assign[k] !== 0 && mustKeep[i]) {
        movesAnUntouchable = true;
        break;
      }
    }
    if (movesAnUntouchable) continue;
    const got = attempt(assign);
    if (!got) continue;
    // Fewest shafts drawn through text, then fewest connectors, then fewest labels moved at all,
    // then least total movement. `moved` earns its place below `connectors`: a label that draws no
    // leader costs no line to move, but a label sitting AT its point still reads better than one
    // shifted away from it, so among arrangements that draw the same lines the one that disturbs
    // fewest labels wins. Without it the search happily moved leader-less labels to save a pixel of
    // total displacement. The first assignment to reach a score keeps it, and "up" precedes "down"
    // in the enumeration, so a tie lifts the label and runs its leader downward.
    const better =
      best == null ||
      got.crossings < best.crossings ||
      (got.crossings === best.crossings &&
        (got.connectors < best.connectors ||
          (got.connectors === best.connectors &&
            (got.moved < best.moved || (got.moved === best.moved && got.cost < best.cost - 1e-9)))));
    if (better) best = got;
  }
  return best ? best.ys : sweepPlace(boxes, o);
}
