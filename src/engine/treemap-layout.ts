// Treemap geometry. PURE: no DOM, no measurement, no text. Squarified d3 treemap over the drawn
// data (spec §3) and the area height for a chart width (spec §6). Label fitting (treemap-labels)
// and drawing consume this output; the live mount and the PNG export call it with the same inputs,
// so both place every tile identically.
import { d3 } from "./vendor";
import type { TreemapDatum } from "../spec/treemap";

export const TM_GEOM = { tileGutter: 2, groupGutter: 4, pad: 6,
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
/** The squarify variants the whole frame can take (Ruling 45), in candidate order: aspect-ratio
 *  target 1 (squarest), d3's default (the golden ratio φ), and 2. */
export const TM_SQUARIFY = ["squarify-1", "squarify", "squarify-2"] as const;
export type TreemapTiling = (typeof TM_SQUARIFY)[number] | (typeof TM_RETILINGS)[number];
/** A group's block. `tiling`: how its tiles are laid out inside it. */
export interface GroupRect { group: string; total: number; x0: number; y0: number; x1: number; y1: number; tiling: TreemapTiling }
export interface TreemapLayout { width: number; height: number; tiles: TileRect[]; groups: GroupRect[]; total: number }

/** Hierarchy node input: the root, a group, or a tile. */
interface Node { group?: string; order?: number; datum?: TreemapDatum; children?: Node[]; raw?: number }

/** The raw value (a tile) or raw total (a group, summed in data order) the sort compares. */
const rawOf = (n: Node): number => n.datum?.value ?? n.raw ?? 0;

/** A value at 12 significant digits: the tie rule for every treemap ordering (the layout's sort and
 *  label fitting's visiting order), so a total summed in floating point (0.1 + 0.2) ties its decimal
 *  equal (0.3) and the tie-break decides. Ordering only; geometry uses the exact values. */
export const treemapTieKey = (v: number): number => Number(v.toPrecision(12));

/** The sort key: rawOf under the tie rule. */
const sortKey = (n: Node): number => treemapTieKey(rawOf(n));

const r2 = (v: number): number => Math.round(v * 100) / 100;

const clamp = (v: number, hi: number): number => Math.min(hi, Math.max(0, v));

/** Rounded rect inside the `w` x `h` frame with x1 >= x0 and y1 >= y0. A sub-pixel tile never gets a
 *  negative size, and a collapsed one d3 centres past the frame sits at the frame edge with 0 size.
 *  A non-finite coordinate (Ruling 43: a value so small beside the largest that, normalized, it
 *  underflows to 0 or a subnormal, where d3's reciprocal scale overflows and 0 x Infinity is NaN)
 *  makes the whole rect a zero-size one at the frame's bottom-right corner: such a tile has no
 *  drawable area anyway, and every other tile keeps its exact geometry. */
function rect(n: { x0: number; y0: number; x1: number; y1: number }, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } {
  if (![n.x0, n.y0, n.x1, n.y1].every(Number.isFinite)) return { x0: w, y0: h, x1: w, y1: h };
  const x0 = clamp(r2(n.x0), w);
  const y0 = clamp(r2(n.y0), h);
  return { x0, y0, x1: Math.max(x0, clamp(r2(n.x1), w)), y1: Math.max(y0, clamp(r2(n.y1), h)) };
}


/** The d3 tiling for each alternative. "slice" stacks full-width rows top to bottom and "dice" lays
 *  full-height columns left to right, both in sort order (largest first); "binary" splits by value
 *  into a balanced binary tree. (d3's sliceDice is not offered: at one level it is slice or dice.) */
const RETILE = { slice: d3.treemapSlice, dice: d3.treemapDice, binary: d3.treemapBinary } as const;
/** Every frame tiling by name. */
const FRAME_TILE = {
  ...RETILE,
  squarify: d3.treemapSquarify,
  "squarify-1": d3.treemapSquarify.ratio(1),
  "squarify-2": d3.treemapSquarify.ratio(2),
} as const;

/**
 * Squarified layout (spec §3). Sort: tiles by value desc, ties by CSV `index`; groups by total
 * desc, ties by `opts.groupOrder` position (listed groups first), then first appearance in `data`.
 * Gutters: `groupGutter` between group blocks, `tileGutter` between tiles; no outer padding, so the
 * outermost tiles reach the frame edges. Every tile's area is its value times one factor across the
 * whole chart, less the fixed gutters (exactly so with gutters 0). `gutters` is for tests only (0
 * isolates the proportionality from the fixed gutters); every caller in the engine uses TM_GEOM's.
 *
 * `labelFits` rescues a group whose first tile in layout order (the sort above: values at 12
 * significant digits, ties by CSV order) cannot hold its label: asked of that tile once the blocks
 * are laid out, and if it fails, the group's tiles alone are laid out again inside the same block
 * by each of TM_RETILINGS in turn, keeping the first under which it passes, else squarify. Blocks
 * never move and every tiling shares the block by value, so areas stay proportional exactly as
 * under squarify. Flat data is never re-tiled this way, so it is not asked there.
 *
 * `tiling` lays the whole frame out by that tiling instead of d3's default squarify, in sort
 * order: the tiles of flat data, or the group blocks of grouped data (each block's tiles are still
 * squarified at d3's default ratio, and rescued as above). Every tiling shares the frame by value.
 * The caller (marks/treemap) picks it among candidates by how much each lets it label.
 */
export function layoutTreemap(data: TreemapDatum[], width: number, height: number,
  opts: {
    groupOrder: string[]; labelFits?: (largest: TileRect) => boolean; tiling?: TreemapTiling;
    gutters?: { tile: number; group: number };
  }): TreemapLayout {
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
  const root = d3
    .hierarchy(rootInput)
    .sum((n: Node) => (n.datum ? scaled(n.datum.value) : 0))
    .sort((a: { data: Node }, b: { data: Node }) => {
      const ra = sortKey(a.data);
      const rb = sortKey(b.data);
      if (ra !== rb) return rb > ra ? 1 : -1;
      return a.data.datum && b.data.datum ? a.data.datum.index - b.data.datum.index : a.data.order! - b.data.order!;
    });

  // The root takes the chosen tiling; a group's tiles are always squarified first (the rescue below
  // may re-tile them).
  type TNode = { depth: number };
  const rootTiling = FRAME_TILE[opts.tiling ?? "squarify"];
  d3.treemap()
    .tile((node: TNode, x0: number, y0: number, x1: number, y1: number) =>
      (node.depth === 0 ? rootTiling : d3.treemapSquarify)(node, x0, y0, x1, y1))
    .size([width, height])
    .paddingInner((n: TNode) => (grouped && n.depth === 0 ? groupGutter : tileGutter))(root);

  type GNode = { data: Node; x0: number; y0: number; x1: number; y1: number };
  const groupNodes = (): GNode[] => (grouped ? (root.children ?? []) : []);
  const totalOf = (g: string): number => data.reduce((s, d) => (d.group === g ? s + d.value : s), 0);

  type LNode = { data: Node; parent: { children: unknown[] }; x0: number; y0: number; x1: number; y1: number };
  const tileRect = (n: LNode): TileRect => ({ datum: n.data.datum!, ...rect(n, width, height), rank: n.parent.children.indexOf(n) });

  // Rescue: re-tile a group whose largest tile cannot hold its label (the blocks are final).
  const tilings = new Map<string, TreemapTiling>();
  if (opts.labelFits) {
    type Kid = LNode & { value: number };
    for (const n of groupNodes() as Array<GNode & { value: number; children: Kid[] }>) {
      const kids = n.children;
      // The group's first tile in layout order: the sort above (treemapTieKey, then CSV order), the
      // same order label fitting visits, so a tie past the 12th digit targets the tile labelled first.
      const largest = kids[0]!;
      if (opts.labelFits(tileRect(largest))) continue;
      const squarified = kids.map(({ x0, y0, x1, y1 }) => ({ x0, y0, x1, y1 }));
      // The region d3 tiled this block's tiles in: the block extended half a tile gutter past each
      // side; each tile is then inset by that half gutter (d3's positionNode).
      const p = tileGutter / 2;
      let [x0, y0, x1, y1] = [n.x0 - p, n.y0 - p, n.x1 + p, n.y1 + p];
      if (x1 < x0) x0 = x1 = (x0 + x1) / 2;
      if (y1 < y0) y0 = y1 = (y0 + y1) / 2;
      let found: TreemapTiling | null = null;
      for (const name of TM_RETILINGS) {
        RETILE[name](n, x0, y0, x1, y1);
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

  const groups: GroupRect[] = groupNodes().map((n) => ({
    group: n.data.group!, total: totalOf(n.data.group!), ...rect(n, width, height), tiling: tilings.get(n.data.group!) ?? "squarify",
  }));
  const tiles: TileRect[] = root.leaves().map(tileRect);
  return { width, height, tiles, groups, total: data.reduce((s, d) => s + d.value, 0) };
}
