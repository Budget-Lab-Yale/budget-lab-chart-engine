// Treemap geometry. PURE: no DOM, no measurement, no text. Squarified d3 treemap over the drawn
// data (spec §3) and the area height for a chart width (spec §6). Label fitting (treemap-labels)
// and drawing consume this output; the live mount and the PNG export call it with the same inputs,
// so both place every tile identically.
import { d3 } from "./vendor";
import type { TreemapDatum } from "../spec/treemap";

/** `stripH` is the header strip's height at 12px strip text, and layoutTreemap's default; the engine
 *  scales it with the chart's label size (treemapStripHeight). */
export const TM_GEOM = { tileGutter: 2, groupGutter: 4, stripH: 22, pad: 6, stripPad: 6,
  aspectWide: 2.0, aspectNarrow: 0.8, wideAt: 720, narrowAt: 280, maxHeight: 460, minLiveWidth: 280 } as const;

/** Treemap area height for a chart width (spec §6): aspect interpolated, capped. */
export function treemapAreaHeight(width: number): number {
  const { aspectWide, aspectNarrow, wideAt, narrowAt, maxHeight } = TM_GEOM;
  const t = Math.min(1, Math.max(0, (width - narrowAt) / (wideAt - narrowAt)));
  const aspect = aspectNarrow + t * (aspectWide - aspectNarrow);
  return Math.min(maxHeight, width / aspect);
}

/** `rank` is the tile's index within its group (overall when flat) by the layout sort, 0 = largest. */
export interface TileRect { datum: TreemapDatum; x0: number; y0: number; x1: number; y1: number; rank: number }
/** How tiles are laid out in their region: squarified, or one of these alternatives, which a group
 *  tries in this order when its largest tile's label does not fit under squarify, and which the
 *  whole frame can take (layoutTreemap `tiling`: the tiles of flat data, the group blocks of grouped
 *  data). */
export const TM_RETILINGS = ["slice", "dice", "binary"] as const;
export type TreemapTiling = "squarify" | (typeof TM_RETILINGS)[number];
/** A group's whole block, header strip included. `strip`: the block reserves the header strip.
 *  `tiling`: how its tiles are laid out inside it. */
export interface GroupRect { group: string; total: number; x0: number; y0: number; x1: number; y1: number; strip: boolean; tiling: TreemapTiling }
export interface TreemapLayout { width: number; height: number; tiles: TileRect[]; groups: GroupRect[]; total: number }

/** Hierarchy node input: the root, a group, or a tile. */
interface Node { group?: string; order?: number; datum?: TreemapDatum; children?: Node[]; raw?: number }

/** The raw value (a tile) or raw total (a group, summed in data order) the sort compares. */
const rawOf = (n: Node): number => n.datum?.value ?? n.raw ?? 0;

/** The sort key: rawOf at 12 significant digits, so a total summed in floating point (0.1 + 0.2)
 *  ties its decimal equal (0.3) and the tie-break decides. Sort only; geometry uses the exact values. */
const sortKey = (n: Node): number => Number(rawOf(n).toPrecision(12));

const r2 = (v: number): number => Math.round(v * 100) / 100;

const clamp = (v: number, hi: number): number => Math.min(hi, Math.max(0, v));

/** Rounded rect inside the `w` x `h` frame with x1 >= x0 and y1 >= y0. A sub-pixel tile never gets a
 *  negative size, and a collapsed one d3 centres past the frame (a sliver of a block whose strip it
 *  cannot hold) sits at the frame edge with 0 size. */
function rect(n: { x0: number; y0: number; x1: number; y1: number }, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } {
  const x0 = clamp(r2(n.x0), w);
  const y0 = clamp(r2(n.y0), h);
  return { x0, y0, x1: Math.max(x0, clamp(r2(n.x1), w)), y1: Math.max(y0, clamp(r2(n.y1), h)) };
}


/** The d3 tiling for each alternative. "slice" stacks full-width rows top to bottom and "dice" lays
 *  full-height columns left to right, both in sort order (largest first); "binary" splits by value
 *  into a balanced binary tree. (d3's sliceDice is not offered: at one level it is slice or dice.) */
const RETILE = { slice: d3.treemapSlice, dice: d3.treemapDice, binary: d3.treemapBinary } as const;

/** Fixed-point cap for the strip compensation (deterministic whether or not it converges first). */
const MAX_COMPENSATION_ROUNDS = 50;
/** Block widths (px) that move less than this between rounds count as converged. */
const CONVERGED_PX = 1e-6;

/**
 * Squarified layout (spec §3). Sort: tiles by value desc, ties by CSV `index`; groups by total desc,
 * ties by `opts.groupOrder` position (listed groups first), then first appearance in `data`.
 * Gutters: `groupGutter` between group blocks, `tileGutter` between tiles; no outer padding, so the
 * outermost tiles reach the frame edges.
 *
 * Header strips are compensated: a group whose strip fits gets `stripH` of top padding AND extra
 * block area equal to the strip's, so a tile's area per unit value is the same in every group, strip
 * or no strip (exactly with gutters 0; less the fixed gutters otherwise). A strip's area depends on
 * its block's width, which depends on the layout, so the extra is solved by fixed-point iteration.
 *
 * `stripFits` decides each group's strip from its block: asked first of every uncompensated block,
 * then again of each compensated final block that holds a strip. A strip whose final block fails is
 * dropped (with its extra area) and the layout re-solved, so every returned strip fits its final
 * block. Absent, every group reserves the strip. `stripH` is the strip's height (default
 * TM_GEOM.stripH). `gutters` is for tests only (0 isolates the proportionality from the fixed
 * gutters); every caller in the engine uses TM_GEOM's.
 *
 * `labelFits` rescues a group whose largest tile (by value; ties: layout order) cannot hold its
 * label: asked of that tile once the blocks are final, and if it fails, the group's tiles alone are
 * laid out again inside the same block (below the same strip) by each of TM_RETILINGS in turn,
 * keeping the first under which it passes, else squarify. Blocks never move and every tiling shares
 * the block by value, so areas stay proportional exactly as under squarify. Flat data is never
 * re-tiled this way, so it is not asked there.
 *
 * `tiling` lays the whole frame out by that tiling instead of squarify, in sort order: the tiles of
 * flat data, or the group blocks of grouped data (each block's tiles are still squarified, and
 * rescued as above). Every tiling shares the frame by value, and the strip compensation holds under
 * each. The caller (marks/treemap) picks it among candidates by how much each lets it label.
 */
export function layoutTreemap(data: TreemapDatum[], width: number, height: number,
  opts: {
    groupOrder: string[]; stripFits?: (g: GroupRect) => boolean; stripH?: number;
    labelFits?: (largest: TileRect) => boolean; tiling?: TreemapTiling; gutters?: { tile: number; group: number };
  }): TreemapLayout {
  const stripH = opts.stripH ?? TM_GEOM.stripH;
  const tileGutter = opts.gutters?.tile ?? TM_GEOM.tileGutter;
  const groupGutter = opts.gutters?.group ?? TM_GEOM.groupGutter;
  const grouped = data.some((d) => d.group !== null);
  let rootInput: Node;
  if (grouped) {
    const byGroup = new Map<string, Node>();
    for (const datum of data) {
      const g = datum.group ?? "";
      let node = byGroup.get(g);
      if (!node) {
        const listed = opts.groupOrder.indexOf(g);
        // Listed groups by their groupOrder position, then the rest by first appearance.
        node = { group: g, order: listed >= 0 ? listed : opts.groupOrder.length + byGroup.size, children: [], raw: 0 };
        byGroup.set(g, node);
      }
      node.children!.push({ datum });
      node.raw! += datum.value;
    }
    rootInput = { children: [...byGroup.values()] };
  } else {
    rootInput = { children: data.map((datum) => ({ datum })) };
  }

  // Geometry is scale-free: d3 sees every value divided by the largest, so neither 1e308 (whose
  // areas overflow) nor 1e-308 (whose areas underflow) reaches its arithmetic. The SORT compares raw
  // values and totals instead (to 12 significant digits, sortKey): normalized sums are float-inexact
  // (seven 1/7s sum below 1, defeating the groupOrder tie-break) and distinct tiny values can
  // underflow to the same 0.
  const max = data.reduce((m, d) => Math.max(m, d.value), 0);
  const scaled = (v: number): number => (max > 0 ? v / max : 0);
  // A group node's own weight is its strip compensation (none without a strip); d3 adds its tiles'.
  let extra = new Map<string, number>();
  const weight = (n: Node): number =>
    n.datum ? scaled(n.datum.value) : n.group !== undefined ? extra.get(n.group) ?? 0 : 0;
  const root = d3
    .hierarchy(rootInput)
    .sum(weight)
    .sort((a: { data: Node }, b: { data: Node }) => {
      const ra = sortKey(a.data);
      const rb = sortKey(b.data);
      if (ra !== rb) return rb > ra ? 1 : -1;
      return a.data.datum && b.data.datum ? a.data.datum.index - b.data.datum.index : a.data.order! - b.data.order!;
    });
  /** The tiles' normalized total (no compensation yet). */
  const tilesTotal: number = root.value;
  const reweigh = (): void => {
    root.sum(weight);
  };

  // The root is tiled by resquarify: its first run squarifies and caches the rows on the root, and
  // every later run keeps those rows and only re-divides them by the new weights. So the
  // compensation moves block edges continuously and its iteration converges; re-squarifying each
  // round can flip a row decision back and forth and never settle.
  // squarify shares a parent's area by parent.value. At the root that value includes the groups'
  // compensation, so a block grows by its strip; inside a group its tiles must share the block
  // (below the strip) by their own values alone, so there the group's value is its tiles' sum.
  type TNode = { depth: number; value: number; children?: TNode[] };
  const tile = (node: TNode, x0: number, y0: number, x1: number, y1: number): void => {
    if (node.depth === 0) {
      // Like resquarify, binary keeps the partition its first run chose (binaryPlan): the
      // compensation re-runs it with slightly different weights, and a split that flipped between
      // rounds would never settle. Slice and dice have no decisions to keep.
      if (opts.tiling === "binary") return binaryPlanned(node, x0, y0, x1, y1);
      if (opts.tiling === "slice" || opts.tiling === "dice") return RETILE[opts.tiling](node, x0, y0, x1, y1);
      return d3.treemapResquarify(node, x0, y0, x1, y1);
    }
    const own = node.value;
    node.value = node.children!.reduce((s, c) => s + c.value, 0);
    d3.treemapSquarify(node, x0, y0, x1, y1);
    node.value = own;
  };
  // d3.treemapBinary, with its decisions (split index, split direction) recorded on the first run and
  // replayed on every later one. The first run is exactly d3's.
  let binaryPlan: Array<[number, boolean]> | null = null;
  const binaryPlanned = (parent: TNode, px0: number, py0: number, px1: number, py1: number): void => {
    type BNode = TNode & { x0: number; y0: number; x1: number; y1: number };
    const nodes = parent.children as BNode[];
    const sums = [0];
    for (const c of nodes) sums.push(sums[sums.length - 1]! + c.value);
    const record = binaryPlan === null;
    const plan: Array<[number, boolean]> = binaryPlan ?? [];
    let step = 0;
    const partition = (i: number, j: number, value: number, x0: number, y0: number, x1: number, y1: number): void => {
      if (i >= j - 1) {
        Object.assign(nodes[i]!, { x0, y0, x1, y1 });
        return;
      }
      let k: number;
      let wide: boolean;
      if (record) {
        const valueOffset = sums[i]!;
        const valueTarget = value / 2 + valueOffset;
        k = i + 1;
        let hi = j - 1;
        while (k < hi) {
          const mid = (k + hi) >>> 1;
          if (sums[mid]! < valueTarget) k = mid + 1;
          else hi = mid;
        }
        if (valueTarget - sums[k - 1]! < sums[k]! - valueTarget && i + 1 < k) --k;
        wide = x1 - x0 > y1 - y0;
        plan.push([k, wide]);
      } else {
        [k, wide] = plan[step++]!;
      }
      const valueLeft = sums[k]! - sums[i]!;
      const valueRight = value - valueLeft;
      if (wide) {
        const xk = value ? (x0 * valueRight + x1 * valueLeft) / value : x1;
        partition(i, k, valueLeft, x0, y0, xk, y1);
        partition(k, j, valueRight, xk, y0, x1, y1);
      } else {
        const yk = value ? (y0 * valueRight + y1 * valueLeft) / value : y1;
        partition(i, k, valueLeft, x0, y0, x1, yk);
        partition(k, j, valueRight, x0, yk, x1, y1);
      }
    };
    partition(0, nodes.length, parent.value, px0, py0, px1, py1);
    binaryPlan = plan;
  };

  const run = (strips: Set<string>) =>
    d3.treemap()
      .tile(tile)
      .size([width, height])
      .paddingInner((n: { depth: number }) => (grouped && n.depth === 0 ? groupGutter : tileGutter))
      .paddingTop((n: { depth: number; data: Node }) => (n.depth === 1 && grouped && strips.has(n.data.group!) ? stripH : 0))(root);

  const totalOf = (g: string): number => data.reduce((s, d) => (d.group === g ? s + d.value : s), 0);
  type GNode = { data: Node; x0: number; y0: number; x1: number; y1: number };
  const groupNodes = (): GNode[] => (grouped ? (root.children ?? []) : []);
  /** A block as stripFits sees it: before (or regardless of) its strip decision. */
  const block = (n: GNode): GroupRect =>
    ({ group: n.data.group!, total: totalOf(n.data.group!), ...rect(n, width, height), strip: false, tiling: "squarify" });

  // The strip takes stripH off the region its block's tiles are laid out in, whose width is the
  // block's plus one tile gutter (d3 extends a parent's tiling region half a gutter past each side).
  const stripArea = (n: GNode): number => stripH * (n.x1 - n.x0 + tileGutter);
  // Solve the compensation for a strip set. The root's tiling region (the frame, extended half a
  // group gutter past each edge) is shared by value: each tile's value at one area-per-unit factor,
  // plus each strip group's strip. So factor = (region - all strips) / tiles' total, and a strip
  // group's extra weight is its strip's area / factor. The strips' areas follow the block widths,
  // so iterate from the current layout until the widths stop moving.
  const region = (width + groupGutter) * (height + groupGutter);
  const solve = (strips: Set<string>): void => {
    for (let round = 0; round < MAX_COMPENSATION_ROUNDS; round++) {
      const nodes = groupNodes().filter((n) => strips.has(n.data.group!));
      const before = nodes.map((n) => n.x1 - n.x0);
      const factor = (region - nodes.reduce((s, n) => s + stripArea(n), 0)) / tilesTotal;
      // Unreachable in the engine: a strip is granted only on a block at least two strips tall, so
      // the strips cover well under the region and factor > 0. The guard keeps a caller's stripFits
      // that grants strips on degenerate blocks from dividing by a non-positive factor.
      if (!(factor > 0)) return;
      extra = new Map(nodes.map((n) => [n.data.group!, stripArea(n) / factor]));
      reweigh();
      run(strips);
      if (nodes.every((n, i) => Math.abs(n.x1 - n.x0 - before[i]!) <= CONVERGED_PX)) return;
    }
  };

  // Pass 1: no strips, no compensation (this run fixes the root's rows); ask stripFits of every block.
  run(new Set());
  const strips = new Set<string>();
  for (const n of groupNodes()) if (!opts.stripFits || opts.stripFits(block(n))) strips.add(n.data.group!);
  // Compensate, then drop any strip whose final block no longer fits it and solve again. The set
  // only shrinks, so this ends.
  while (strips.size) {
    solve(strips);
    const lost = opts.stripFits ? groupNodes().filter((n) => strips.has(n.data.group!) && !opts.stripFits!(block(n))) : [];
    if (!lost.length) break;
    for (const n of lost) strips.delete(n.data.group!);
    extra = new Map();
    reweigh();
    run(strips);
  }

  type LNode = { data: Node; parent: { children: unknown[] }; x0: number; y0: number; x1: number; y1: number };
  const tileRect = (n: LNode): TileRect => ({ datum: n.data.datum!, ...rect(n, width, height), rank: n.parent.children.indexOf(n) });

  // Rescue: re-tile a group whose largest tile cannot hold its label (blocks and strips are final).
  const tilings = new Map<string, TreemapTiling>();
  if (opts.labelFits) {
    type Kid = LNode & { value: number };
    for (const n of groupNodes() as Array<GNode & { value: number; children: Kid[] }>) {
      const kids = n.children;
      // Largest by raw value; on a tie the first in layout order (strict >).
      const largest = kids.reduce((a, b) => (b.data.datum!.value > a.data.datum!.value ? b : a));
      if (opts.labelFits(tileRect(largest))) continue;
      const squarified = kids.map(({ x0, y0, x1, y1 }) => ({ x0, y0, x1, y1 }));
      // The region d3 tiled this block's tiles in: the block below its strip, extended half a tile
      // gutter past each side; each tile is then inset by that half gutter (d3's positionNode).
      const p = tileGutter / 2;
      let [x0, y0, x1, y1] = [n.x0 - p, n.y0 + (strips.has(n.data.group!) ? stripH : 0) - p, n.x1 + p, n.y1 + p];
      if (x1 < x0) x0 = x1 = (x0 + x1) / 2;
      if (y1 < y0) y0 = y1 = (y0 + y1) / 2;
      const own = n.value;
      let found: TreemapTiling | null = null;
      for (const name of TM_RETILINGS) {
        // As in `tile`: the block is shared by its tiles' own values, not the strip compensation.
        n.value = kids.reduce((s, c) => s + c.value, 0);
        RETILE[name](n, x0, y0, x1, y1);
        n.value = own;
        for (const c of kids) {
          c.x0 += p; c.y0 += p; c.x1 -= p; c.y1 -= p;
          if (c.x1 < c.x0) c.x0 = c.x1 = (c.x0 + c.x1) / 2;
          if (c.y1 < c.y0) c.y0 = c.y1 = (c.y0 + c.y1) / 2;
        }
        if (opts.labelFits(tileRect(largest))) {
          found = name;
          break;
        }
      }
      if (found) tilings.set(n.data.group!, found);
      else kids.forEach((c, i) => Object.assign(c, squarified[i]));
    }
  }

  const groups: GroupRect[] = groupNodes().map((n) =>
    ({ ...block(n), strip: strips.has(n.data.group!), tiling: tilings.get(n.data.group!) ?? "squarify" }));
  const tiles: TileRect[] = root.leaves().map(tileRect);
  return { width, height, tiles, groups, total: data.reduce((s, d) => s + d.value, 0) };
}
