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
interface Node { group?: string; order?: number; datum?: TreemapDatum; children?: Node[] }

const r2 = (v: number): number => Math.round(v * 100) / 100;

/** Rounded rect with x1 >= x0 and y1 >= y0 (a sub-pixel tile never gets a negative size). */
function rect(n: { x0: number; y0: number; x1: number; y1: number }): { x0: number; y0: number; x1: number; y1: number } {
  const x0 = r2(n.x0);
  const y0 = r2(n.y0);
  return { x0, y0, x1: Math.max(x0, r2(n.x1)), y1: Math.max(y0, r2(n.y1)) };
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
        node = { group: g, order: listed >= 0 ? listed : opts.groupOrder.length + byGroup.size, children: [] };
        byGroup.set(g, node);
      }
      node.children!.push({ datum });
    }
    rootInput = { children: [...byGroup.values()] };
  } else {
    rootInput = { children: data.map((datum) => ({ datum })) };
  }

  const root = d3
    .hierarchy(rootInput)
    .sum((n: Node) => n.datum?.value ?? 0)
    .sort((a: { data: Node; value: number }, b: { data: Node; value: number }) =>
      b.value - a.value || (a.data.datum && b.data.datum ? a.data.datum.index - b.data.datum.index : a.data.order! - b.data.order!));

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
  const groupNodes = (): Array<{ data: Node; value: number; x0: number; y0: number; x1: number; y1: number }> =>
    grouped ? (root.children ?? []) : [];
  run(new Set());
  const strips = new Set<string>();
  for (const n of groupNodes()) {
    const g: GroupRect = { group: n.data.group!, total: n.value, ...rect(n), strip: false };
    if (!opts.stripFits || opts.stripFits(g)) strips.add(g.group);
  }
  if (strips.size) run(strips);

  const groups: GroupRect[] = groupNodes().map((n) => ({
    group: n.data.group!, total: n.value, ...rect(n), strip: strips.has(n.data.group!),
  }));
  const tiles: TileRect[] = root.leaves().map((n: { data: Node; parent: { children: unknown[] }; x0: number; y0: number; x1: number; y1: number }) => ({
    datum: n.data.datum!, ...rect(n), rank: n.parent.children.indexOf(n),
  }));
  return { width, height, tiles, groups, total: root.value };
}
