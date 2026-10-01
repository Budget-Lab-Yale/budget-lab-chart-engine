// Treemap geometry. PURE: no DOM, no measurement, no text. Squarified d3 treemap over the drawn
// data (spec §3) and the area height for a chart width (spec §6). Label fitting (treemap-labels)
// and drawing consume this output; the live mount and the PNG export call it with the same inputs,
// so both place every tile identically.
import { d3 } from "./vendor";
import type { TreemapDatum } from "../spec/treemap";

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
/** A group's whole block, header strip included. `strip`: the block reserves the header strip. */
export interface GroupRect { group: string; total: number; x0: number; y0: number; x1: number; y1: number; strip: boolean }
export interface TreemapLayout { width: number; height: number; tiles: TileRect[]; groups: GroupRect[]; total: number }

/** Hierarchy node input: the root, a group, or a tile. */
interface Node { group?: string; order?: number; datum?: TreemapDatum; children?: Node[]; raw?: number }

/** The raw value (a tile) or raw total (a group, summed in data order) the sort compares. */
const rawOf = (n: Node): number => n.datum?.value ?? n.raw ?? 0;

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

/**
 * Squarified layout (spec §3). Sort: tiles by value desc, ties by CSV `index`; groups by total desc,
 * ties by `opts.groupOrder` position (listed groups first), then first appearance in `data`.
 * Gutters: `groupGutter` between group blocks, `tileGutter` between tiles; no outer padding, so the
 * outermost tiles reach the frame edges. A group whose strip fits gets `stripH` of top padding, so
 * its tiles are laid out below the strip and stay proportional within the block.
 *
 * `stripFits` decides each group's strip from its block. Absent, every group reserves the strip.
 */
export function layoutTreemap(data: TreemapDatum[], width: number, height: number,
  opts: { groupOrder: string[]; stripFits?: (g: GroupRect) => boolean }): TreemapLayout {
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
  // values and totals instead: normalized sums are float-inexact (seven 1/7s sum below 1, defeating
  // the groupOrder tie-break) and distinct tiny values can underflow to the same 0.
  const max = data.reduce((m, d) => Math.max(m, d.value), 0);
  const scaled = (v: number): number => (max > 0 ? v / max : 0);
  const root = d3
    .hierarchy(rootInput)
    .sum((n: Node) => scaled(n.datum?.value ?? 0))
    .sort((a: { data: Node }, b: { data: Node }) => {
      const ra = rawOf(a.data);
      const rb = rawOf(b.data);
      if (ra !== rb) return rb > ra ? 1 : -1;
      return a.data.datum && b.data.datum ? a.data.datum.index - b.data.datum.index : a.data.order! - b.data.order!;
    });

  const run = (strips: Set<string>) =>
    d3.treemap()
      .tile(d3.treemapSquarify)
      .size([width, height])
      .paddingInner((n: { depth: number }) => (grouped && n.depth === 0 ? TM_GEOM.groupGutter : TM_GEOM.tileGutter))
      .paddingTop((n: { depth: number; data: Node }) => (n.depth === 1 && grouped && strips.has(n.data.group!) ? TM_GEOM.stripH : 0))(root);

  // Two passes. The strip decision needs each block's size, which d3 only knows after layout, so
  // pass 1 lays out with no strips and asks `stripFits` of every block; pass 2 lays out again with
  // `paddingTop` on the groups whose strip fits. Group padding never feeds back into the root-level
  // tiling, so the blocks `stripFits` saw are exactly the final blocks; only tiles move.
  const totalOf = (g: string): number => data.reduce((s, d) => (d.group === g ? s + d.value : s), 0);
  const groupNodes = (): Array<{ data: Node; value: number; x0: number; y0: number; x1: number; y1: number }> =>
    grouped ? (root.children ?? []) : [];
  run(new Set());
  const strips = new Set<string>();
  for (const n of groupNodes()) {
    const g: GroupRect = { group: n.data.group!, total: totalOf(n.data.group!), ...rect(n, width, height), strip: false };
    if (!opts.stripFits || opts.stripFits(g)) strips.add(g.group);
  }
  if (strips.size) run(strips);

  const groups: GroupRect[] = groupNodes().map((n) => ({
    group: n.data.group!, total: totalOf(n.data.group!), ...rect(n, width, height), strip: strips.has(n.data.group!),
  }));
  const tiles: TileRect[] = root.leaves().map((n: { data: Node; parent: { children: unknown[] }; x0: number; y0: number; x1: number; y1: number }) => ({
    datum: n.data.datum!, ...rect(n, width, height), rank: n.parent.children.indexOf(n),
  }));
  return { width, height, tiles, groups, total: data.reduce((s, d) => s + d.value, 0) };
}
