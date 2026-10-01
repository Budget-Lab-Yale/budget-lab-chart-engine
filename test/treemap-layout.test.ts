import { describe, it, expect } from "vitest";
import { layoutTreemap, treemapAreaHeight, TM_GEOM, type GroupRect, type TileRect, type TreemapLayout } from "../src/engine/treemap-layout";
import type { TreemapDatum } from "../src/spec/treemap";

function flat(values: number[]): TreemapDatum[] {
  return values.map((value, index) => ({ index, name: `t${index}`, group: null, value, row: {} }));
}
function grouped(rows: Array<[string, number]>): TreemapDatum[] {
  return rows.map(([group, value], index) => ({ index, name: `t${index}`, group, value, row: {} }));
}
const area = (r: { x0: number; y0: number; x1: number; y1: number }): number => (r.x1 - r.x0) * (r.y1 - r.y0);
const byRank = (l: TreemapLayout): TileRect[] => [...l.tiles].sort((a, b) => a.rank - b.rank);
const tilesOf = (l: TreemapLayout, g: string): TileRect[] => l.tiles.filter((t) => t.datum.group === g);
const coords = (r: { x0: number; y0: number; x1: number; y1: number }): number[] => [r.x0, r.y0, r.x1, r.y1];

describe("treemapAreaHeight", () => {
  it("caps at maxHeight on wide charts", () => {
    expect(treemapAreaHeight(920)).toBe(460);
    expect(treemapAreaHeight(1400)).toBe(460);
  });
  it("uses aspect 2.0 at the wide breakpoint and 0.8 at the narrow one", () => {
    expect(treemapAreaHeight(720)).toBe(360);
    expect(treemapAreaHeight(280)).toBe(350);
  });
  it("interpolates the aspect between breakpoints, monotone in width", () => {
    const h = treemapAreaHeight(500);
    expect(h).toBeGreaterThan(350);
    expect(h).toBeLessThan(360);
    let prev = treemapAreaHeight(280);
    for (let w = 290; w <= 720; w += 10) {
      const cur = treemapAreaHeight(w);
      expect(cur).toBeGreaterThan(prev);
      prev = cur;
    }
  });
});

describe("layoutTreemap: flat", () => {
  const W = 920;
  const H = 460;
  const data = flat([10, 50, 30, 5, 20, 8, 3, 2]);
  const l = layoutTreemap(data, W, H, { groupOrder: [] });

  it("returns one tile per datum, no groups, and the grand total", () => {
    expect(l.tiles).toHaveLength(data.length);
    expect(l.groups).toEqual([]);
    expect(l.total).toBe(128);
    expect(l.width).toBe(W);
    expect(l.height).toBe(H);
  });

  it("covers the frame: tiles plus gutters fill w x h within 1%", () => {
    // Grow each tile by half the tile gutter on every side not on the frame edge: the grown cells
    // tile the frame exactly.
    const half = TM_GEOM.tileGutter / 2;
    let sum = 0;
    for (const t of l.tiles) {
      const x0 = t.x0 <= 0 ? 0 : t.x0 - half;
      const y0 = t.y0 <= 0 ? 0 : t.y0 - half;
      const x1 = t.x1 >= W ? W : t.x1 + half;
      const y1 = t.y1 >= H ? H : t.y1 + half;
      sum += (x1 - x0) * (y1 - y0);
      expect(t.x0).toBeGreaterThanOrEqual(0);
      expect(t.y0).toBeGreaterThanOrEqual(0);
      expect(t.x1).toBeLessThanOrEqual(W);
      expect(t.y1).toBeLessThanOrEqual(H);
    }
    expect(Math.abs(sum - W * H) / (W * H)).toBeLessThan(0.01);
    expect(Math.min(...l.tiles.map((t) => t.x0))).toBe(0);
    expect(Math.min(...l.tiles.map((t) => t.y0))).toBe(0);
    expect(Math.max(...l.tiles.map((t) => t.x1))).toBe(W);
    expect(Math.max(...l.tiles.map((t) => t.y1))).toBe(H);
  });

  it("sizes tiles in proportion to value (two largest within 2%)", () => {
    const [a, b] = byRank(l);
    expect(a!.datum.value).toBe(50);
    expect(b!.datum.value).toBe(30);
    const ratio = area(a!) / area(b!);
    expect(Math.abs(ratio - 50 / 30) / (50 / 30)).toBeLessThan(0.02);
  });

  it("puts the largest tile top-left", () => {
    const [a] = byRank(l);
    expect(a!.x0).toBe(0);
    expect(a!.y0).toBe(0);
  });

  it("ranks 0..n-1 by value descending, ties by CSV index", () => {
    const ranked = byRank(l).map((t) => t.datum.value);
    expect(byRank(l).map((t) => t.rank)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(ranked).toEqual([50, 30, 20, 10, 8, 5, 3, 2]);
    // Reversed input, so the tie-break must come from `index`, not from a stable sort.
    const tie = layoutTreemap(flat([5, 9, 5, 5]).reverse(), W, H, { groupOrder: [] });
    expect(byRank(tie).map((t) => t.datum.index)).toEqual([1, 0, 2, 3]);
  });

  it("is deterministic", () => {
    expect(l.tiles).toHaveLength(data.length);
    expect(layoutTreemap(data, W, H, { groupOrder: [] })).toEqual(layoutTreemap(data, W, H, { groupOrder: [] }));
  });

  it("rounds every coordinate to 2 decimals", () => {
    const odd = layoutTreemap(flat([7, 3, 1.3, 0.9]), 333.3, 211.7, { groupOrder: [] });
    expect(odd.tiles).toHaveLength(4);
    expect(odd.tiles.some((t) => coords(t).some((v) => !Number.isInteger(v)))).toBe(true);
    for (const t of odd.tiles) for (const v of coords(t)) expect(Math.round(v * 100) / 100).toBe(v);
  });

  it("gives a single tile the full frame", () => {
    const one = layoutTreemap(flat([42]), W, H, { groupOrder: [] });
    expect(one.tiles).toHaveLength(1);
    expect(coords(one.tiles[0]!)).toEqual([0, 0, W, H]);
    expect(one.tiles[0]!.rank).toBe(0);
  });

  it.each([
    ["one tile of 1e308", [1e308]],
    ["two tiles of 1e308 (their total overflows)", [1e308, 1e308]],
    ["two tiles of 1e-308", [1e-308, 1e-308]],
  ])("lays out %s with finite coordinates covering the frame", (_label, values) => {
    const l = layoutTreemap(flat(values), W, H, { groupOrder: [] });
    expect(l.tiles).toHaveLength(values.length);
    for (const t of l.tiles) for (const v of coords(t)) expect(Number.isFinite(v)).toBe(true);
    expect(Math.min(...l.tiles.map((t) => t.x0))).toBe(0);
    expect(Math.min(...l.tiles.map((t) => t.y0))).toBe(0);
    expect(Math.max(...l.tiles.map((t) => t.x1))).toBe(W);
    expect(Math.max(...l.tiles.map((t) => t.y1))).toBe(H);
    const covered = l.tiles.reduce((s, t) => s + area(t), 0);
    expect(covered).toBeGreaterThan(0.98 * W * H);
  });

  it("keeps a 0.0001% tile finite and non-negative", () => {
    const tiny = layoutTreemap(flat([1_000_000, 1]), W, H, { groupOrder: [] });
    const t = tiny.tiles.find((x) => x.datum.value === 1)!;
    for (const v of coords(t)) expect(Number.isFinite(v)).toBe(true);
    expect(t.x1).toBeGreaterThanOrEqual(t.x0);
    expect(t.y1).toBeGreaterThanOrEqual(t.y0);
  });
});

describe("layoutTreemap: grouped", () => {
  const W = 920;
  const H = 460;
  const data = grouped([
    ["B", 30], ["A", 40], ["B", 25], ["C", 15], ["A", 20], ["C", 10], ["B", 5], ["A", 10],
  ]);
  // totals: A 70, B 60, C 25

  it("orders groups by total descending and reports their totals", () => {
    const l = layoutTreemap(data, W, H, { groupOrder: [] });
    expect(l.groups.map((g) => [g.group, g.total])).toEqual([["A", 70], ["B", 60], ["C", 25]]);
    expect(l.total).toBe(155);
    expect(l.groups[0]!.x0).toBe(0);
    expect(l.groups[0]!.y0).toBe(0);
  });

  it("breaks equal group totals by groupOrder, then first appearance", () => {
    const tied = grouped([["X", 10], ["Y", 10], ["Z", 10]]);
    expect(layoutTreemap(tied, W, H, { groupOrder: [] }).groups.map((g) => g.group)).toEqual(["X", "Y", "Z"]);
    expect(layoutTreemap(tied, W, H, { groupOrder: ["Z", "X"] }).groups.map((g) => g.group)).toEqual(["Z", "X", "Y"]);
  });

  it("sizes group blocks in proportion to totals (within 3%)", () => {
    const l = layoutTreemap(data, W, H, { groupOrder: [] });
    expect(l.groups).toHaveLength(3);
    const blocks = l.groups.reduce((s, g) => s + area(g), 0);
    for (const g of l.groups) {
      const want = g.total / l.total;
      expect(Math.abs(area(g) / blocks - want) / want).toBeLessThan(0.03);
    }
  });

  it("separates group blocks by the group gutter and tiles by the tile gutter", () => {
    const l = layoutTreemap(grouped([["A", 50], ["B", 50]]), 400, 200, { groupOrder: [], stripFits: () => false });
    const [a, b] = l.groups;
    // Two equal groups in a 2:1 frame split side by side.
    expect(b!.x0 - a!.x1).toBe(TM_GEOM.groupGutter);
    const two = layoutTreemap(grouped([["A", 50], ["A", 50]]), 400, 200, { groupOrder: [], stripFits: () => false });
    const [t0, t1] = byRank(two);
    expect(t1!.x0 - t0!.x1).toBe(TM_GEOM.tileGutter);
  });

  it("ranks tiles within their group", () => {
    const l = layoutTreemap(data, W, H, { groupOrder: [] });
    expect(tilesOf(l, "A").sort((x, y) => x.rank - y.rank).map((t) => [t.rank, t.datum.value])).toEqual([[0, 40], [1, 20], [2, 10]]);
    expect(tilesOf(l, "C").sort((x, y) => x.rank - y.rank).map((t) => [t.rank, t.datum.value])).toEqual([[0, 15], [1, 10]]);
  });

  it("keeps every tile inside its group block", () => {
    const l = layoutTreemap(data, W, H, { groupOrder: [] });
    expect(l.groups).toHaveLength(3);
    for (const g of l.groups) {
      const ts = tilesOf(l, g.group);
      expect(ts.length).toBeGreaterThan(0);
      for (const t of ts) {
        expect(t.x0).toBeGreaterThanOrEqual(g.x0);
        expect(t.y0).toBeGreaterThanOrEqual(g.y0);
        expect(t.x1).toBeLessThanOrEqual(g.x1);
        expect(t.y1).toBeLessThanOrEqual(g.y1);
      }
    }
  });

  it("reserves the header strip above the tiles of a strip group", () => {
    const l = layoutTreemap(data, W, H, { groupOrder: [], stripFits: () => true });
    expect(l.groups).toHaveLength(3);
    for (const g of l.groups) {
      expect(g.strip).toBe(true);
      const top = Math.min(...tilesOf(l, g.group).map((t) => t.y0));
      expect(top).toBeGreaterThanOrEqual(g.y0 + TM_GEOM.stripH);
    }
  });

  it("gives a block whose strip does not fit no top reservation", () => {
    const seen: GroupRect[] = [];
    const l = layoutTreemap(data, W, H, {
      groupOrder: [],
      stripFits: (g) => {
        seen.push({ ...g });
        return g.group !== "B";
      },
    });
    // stripFits is asked once per group with the final block geometry, before any strip is decided.
    expect(seen.map((g) => g.group)).toEqual(["A", "B", "C"]);
    expect(seen.every((g) => g.strip === false)).toBe(true);
    expect(seen.map(coords)).toEqual(l.groups.map(coords));
    const b = l.groups.find((g) => g.group === "B")!;
    expect(b.strip).toBe(false);
    expect(Math.min(...tilesOf(l, "B").map((t) => t.y0))).toBe(b.y0);
    const a = l.groups.find((g) => g.group === "A")!;
    expect(a.strip).toBe(true);
    expect(Math.min(...tilesOf(l, "A").map((t) => t.y0))).toBeGreaterThanOrEqual(a.y0 + TM_GEOM.stripH);
  });

  it("clamps every tile and group to the frame, even a sliver under a strip it cannot hold", () => {
    // B's block is a thin sliver along the frame edge; with every strip forced on, d3 centres its
    // collapsed tiles below the block's bottom (past the frame) unless rect() clamps them.
    const sliver = grouped([["A", 10_000], ["A", 9_000], ["B", 3], ["B", 2]]);
    for (const [w, h] of [[920, 460], [375, 354], [280, 350]] as const) {
      const l = layoutTreemap(sliver, w, h, { groupOrder: [], stripFits: () => true });
      for (const r of [...l.tiles, ...l.groups]) {
        expect(r.x0).toBeGreaterThanOrEqual(0);
        expect(r.y0).toBeGreaterThanOrEqual(0);
        expect(r.x1).toBeLessThanOrEqual(w);
        expect(r.y1).toBeLessThanOrEqual(h);
        expect(r.x1).toBeGreaterThanOrEqual(r.x0);
        expect(r.y1).toBeGreaterThanOrEqual(r.y0);
      }
    }
  });

  it("is deterministic", () => {
    const o = { groupOrder: ["C"], stripFits: (g: GroupRect) => g.x1 - g.x0 > 200 };
    expect(layoutTreemap(data, W, H, o).tiles).toHaveLength(data.length);
    expect(layoutTreemap(data, W, H, o)).toEqual(layoutTreemap(data, W, H, o));
  });
});
