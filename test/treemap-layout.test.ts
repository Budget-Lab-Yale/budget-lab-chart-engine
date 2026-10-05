import { describe, it, expect } from "vitest";
import { layoutTreemap, treemapAreaHeight, TM_GEOM, type GroupRect, type TileRect, type TreemapLayout } from "../src/engine/treemap-layout";
import type { TreemapDatum } from "../src/spec/treemap";
import { d3 } from "../src/engine/vendor";

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

describe("extreme magnitudes (Ruling 43)", () => {
  // Normalized, Small is ~1e-318 (subnormal) and Tiny 0: d3's reciprocal scale overflows and 0 x Infinity is NaN.
  const data: TreemapDatum[] = [
    { index: 0, name: "Huge", group: "A", value: 1e282, row: {} },
    { index: 1, name: "Small", group: "B", value: 1e-36, row: {} },
    { index: 2, name: "Tiny", group: "B", value: 1e-267, row: {} },
  ];
  it("every tile and group coordinate is finite and inside the frame, under every frame tiling", () => {
    for (const tiling of ["squarify", "slice", "dice", "binary"] as const) {
      const l = layoutTreemap(data, 920, 460, { groupOrder: [], tiling, labelFits: () => false });
      for (const r of [...l.tiles, ...l.groups]) {
        for (const v of coords(r)) expect(Number.isFinite(v), `${tiling}`).toBe(true);
        expect(r.x0).toBeGreaterThanOrEqual(0);
        expect(r.x1).toBeLessThanOrEqual(920);
        expect(r.y0).toBeGreaterThanOrEqual(0);
        expect(r.y1).toBeLessThanOrEqual(460);
      }
      // Huge keeps (all but the gutter of) the whole frame; the others have no area.
      const huge = l.tiles.find((t) => t.datum.name === "Huge")!;
      expect(area(huge)).toBeGreaterThan(920 * 460 * 0.98);
      for (const t of l.tiles.filter((t) => t.datum.name !== "Huge")) expect(area(t)).toBe(0);
    }
  });
});

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
    // Tile values equal to 12 significant digits tie too: CSV order decides.
    const near = layoutTreemap(flat([0.3, 0.1 + 0.2]), W, H, { groupOrder: [] });
    expect(byRank(near).map((t) => t.datum.index)).toEqual([0, 1]);
  });

  it("ranks distinct tiny values by raw value even where normalization underflows them to zero", () => {
    // 1e-300 / 1e300 and 2e-300 / 1e300 both underflow to 0; the raw values still differ.
    const tiny = layoutTreemap(flat([1e300, 1e-300, 2e-300]), W, H, { groupOrder: [] });
    expect(byRank(tiny).map((t) => t.datum.index)).toEqual([0, 2, 1]);
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

  it("sorts groups on raw totals, so a float-inexact normalized sum cannot defeat the groupOrder tie-break", () => {
    // A: seven tiles of 1; B: one tile of 7. Raw totals tie at 7; normalized (by the max, 7) A sums
    // to 0.9999999999999998 and B to 1, which would put B first.
    const tie = grouped([...Array.from({ length: 7 }, () => ["A", 1] as [string, number]), ["B", 7]]);
    const l = layoutTreemap(tie, W, H, { groupOrder: ["A", "B"] });
    expect(l.groups.map((g) => g.group)).toEqual(["A", "B"]);
    expect(l.groups[0]!.x0).toBe(0);
    expect(l.groups[0]!.y0).toBe(0);
  });

  it("compares raw totals at 12 significant digits, so a float-summed total ties its decimal equal", () => {
    // A: 0.1 + 0.2 = 0.30000000000000004 in data order; B: 0.3. Equal to 12 digits, so groupOrder decides.
    const tie = grouped([["A", 0.1], ["A", 0.2], ["B", 0.3]]);
    expect(layoutTreemap(tie, W, H, { groupOrder: ["B", "A"] }).groups.map((g) => g.group)).toEqual(["B", "A"]);
    expect(layoutTreemap(tie, W, H, { groupOrder: ["A", "B"] }).groups.map((g) => g.group)).toEqual(["A", "B"]);
    // The reported totals (and so the geometry) are untouched: only the sort rounds.
    expect(layoutTreemap(tie, W, H, { groupOrder: ["B", "A"] }).groups.map((g) => g.total)).toEqual([0.3, 0.1 + 0.2]);
    // A real difference past 12 digits still sorts.
    const near = grouped([["A", 0.3], ["B", 0.300000001]]);
    expect(layoutTreemap(near, W, H, { groupOrder: ["A", "B"] }).groups.map((g) => g.group)).toEqual(["B", "A"]);
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
    const l = layoutTreemap(grouped([["A", 50], ["B", 50]]), 400, 200, { groupOrder: [] });
    const [a, b] = l.groups;
    // Two equal groups in a 2:1 frame split side by side.
    expect(b!.x0 - a!.x1).toBe(TM_GEOM.groupGutter);
    const two = layoutTreemap(grouped([["A", 50], ["A", 50]]), 400, 200, { groupOrder: [] });
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

  it("clamps every tile and group to the frame, even a zero-area sliver", () => {
    const sliver = grouped([["A", 10_000], ["A", 9_000], ["B", 3], ["B", 2]]);
    for (const [w, h] of [[920, 460], [375, 354], [280, 350]] as const) {
      const l = layoutTreemap(sliver, w, h, { groupOrder: [] });
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

  describe("plain squarify: one area per unit of value in every group", () => {
    const mixed = grouped([
      ["A", 40], ["A", 25], ["A", 12], ["B", 35], ["B", 30], ["B", 8], ["C", 20], ["C", 9], ["D", 14], ["D", 6],
    ]);
    const perUnit = (l: TreemapLayout, g: string): number => {
      const ts = tilesOf(l, g);
      return ts.reduce((s, t) => s + area(t), 0) / ts.reduce((s, t) => s + t.datum.value, 0);
    };

    it.each([[920, 460], [600, 330], [375, 354], [280, 350]] as const)("with gutters 0, every tile at %ipx is value x (frame / total), in every group", (w, h) => {
      const l = layoutTreemap(mixed, w, h, { groupOrder: [], gutters: { tile: 0, group: 0 } });
      const k = (w * h) / l.total;
      for (const t of l.tiles) expect(Math.abs(area(t) / t.datum.value - k) / k).toBeLessThan(2e-3);
      for (const g of ["A", "B", "C", "D"]) expect(Math.abs(perUnit(l, g) - k) / k).toBeLessThan(1e-4);
      // No header reservation: a block's tiles start at its top edge.
      for (const g of l.groups) expect(Math.min(...tilesOf(l, g.group).map((t) => t.y0))).toBe(g.y0);
      expect(l.groups.every((g) => !("strip" in g))).toBe(true);
    });

    it.each(["slice", "dice", "binary"] as const)("arranges the group blocks by %s, with the same one factor (gutters 0)", (tiling) => {
      for (const [w, h] of [[920, 460], [375, 354]] as const) {
        const l = layoutTreemap(mixed, w, h, { groupOrder: [], tiling, gutters: { tile: 0, group: 0 } });
        if (tiling === "slice") for (const g of l.groups) expect([g.x0, g.x1]).toEqual([0, w]);
        if (tiling === "dice") for (const g of l.groups) expect([g.y0, g.y1]).toEqual([0, h]);
        const sq = layoutTreemap(mixed, w, h, { groupOrder: [], gutters: { tile: 0, group: 0 } });
        expect(l.groups.map(coords)).not.toEqual(sq.groups.map(coords));
        const k = (w * h) / l.total;
        for (const t of l.tiles) expect(Math.abs(area(t) / t.datum.value - k) / k).toBeLessThan(2e-3);
        for (const g of ["A", "B", "C", "D"]) expect(Math.abs(perUnit(l, g) - k) / k).toBeLessThan(1e-4);
      }
    });

    it("with the real gutters, equal values draw tiles within 2% of each other across groups", () => {
      const l = layoutTreemap(mixed, 920, 460, { groupOrder: [] });
      const a = perUnit(l, "A");
      const b = perUnit(l, "B");
      expect(Math.abs(a - b) / b).toBeLessThan(0.02);
    });

    it("binary arranges group blocks as d3's treemapBinary does", () => {
      const l = layoutTreemap(mixed, 920, 460, { groupOrder: [], tiling: "binary", gutters: { tile: 0, group: 0 } });
      const totals = l.groups.map((g) => g.total);
      const h = d3.hierarchy({ children: totals.map((v) => ({ v })) }).sum((d: { v?: number }) => d.v ?? 0);
      const want = d3.treemap().tile(d3.treemapBinary).size([920, 460])(h).leaves()
        .map((n: { x0: number; y0: number; x1: number; y1: number }) => [n.x0, n.y0, n.x1, n.y1]);
      l.groups.forEach((g, i) => coords(g).forEach((v, j) => expect(v).toBeCloseTo(want[i]![j]!, 1)));
    });
  });

  it("is deterministic", () => {
    const o = { groupOrder: ["C"] };
    expect(layoutTreemap(data, W, H, o).tiles).toHaveLength(data.length);
    expect(layoutTreemap(data, W, H, o)).toEqual(layoutTreemap(data, W, H, o));
  });
});

describe("layoutTreemap: a group re-tiled so its largest tile's label fits", () => {
  // Three groups; A's tiles are close in value, so squarify gives its largest tile a near-square cell.
  const data = grouped([
    ["A", 30], ["A", 26], ["A", 22], ["A", 18], ["A", 14], ["B", 50], ["B", 20], ["C", 30], ["C", 10],
  ]);
  const o = { groupOrder: [] as string[] };
  const base = layoutTreemap(data, 920, 460, o);
  const blockOf = (l: TreemapLayout, g: string): GroupRect => l.groups.find((x) => x.group === g)!;
  const largestOf = (l: TreemapLayout, g: string): TileRect => tilesOf(l, g).reduce((a, b) => (b.datum.value > a.datum.value ? b : a));
  /** Every rect the layout asked labelFits about for group `g`'s largest tile, in order. */
  const tried = (fits: (t: TileRect) => boolean, g = "A"): Array<{ x0: number; y0: number; x1: number; y1: number }> => {
    const seen: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
    layoutTreemap(data, 920, 460, { ...o, labelFits: (t) => {
      if (t.datum.group === g) seen.push({ x0: t.x0, y0: t.y0, x1: t.x1, y1: t.y1 });
      return fits(t);
    } });
    return seen;
  };
  const tileTop = (l: TreemapLayout, g: string): number => blockOf(l, g).y0;

  it("keeps squarify when the largest tile's label fits: labelFits is asked once per group, of that tile", () => {
    const asked: string[] = [];
    const l = layoutTreemap(data, 920, 460, { ...o, labelFits: (t) => { asked.push(t.datum.name); return true; } });
    expect(asked).toEqual(["t0", "t5", "t7"]);
    expect(l).toEqual({ ...base, groups: base.groups.map((g) => ({ ...g, tiling: "squarify" })) });
    expect(base.groups.every((g) => g.tiling === "squarify")).toBe(true);
  });

  it("tries slice (largest first, full-width rows), dice (full-height columns), binary, in that order", () => {
    const a = blockOf(base, "A");
    const seen = tried(() => false);
    expect(seen).toHaveLength(4);
    // squarify's cell, as drawn without labelFits.
    expect(seen[0]).toEqual((({ x0, y0, x1, y1 }) => ({ x0, y0, x1, y1 }))(largestOf(base, "A")));
    // slice: the largest tile is the top row, the block's full width.
    expect([seen[1]!.x0, seen[1]!.y0, seen[1]!.x1]).toEqual([a.x0, tileTop(base, "A"), a.x1]);
    // dice: the largest tile is the left column, the block's full height.
    expect([seen[2]!.x0, seen[2]!.y0, seen[2]!.y1]).toEqual([a.x0, tileTop(base, "A"), a.y1]);
    // binary differs from all of them.
    for (const i of [0, 1, 2]) expect(seen[3]).not.toEqual(seen[i]);
  });

  it("takes the first tiling under which the label fits, and keeps squarify when none does", () => {
    const seen = tried(() => false);
    const same = (r: { x0: number; y0: number; x1: number; y1: number }) => (t: TileRect) =>
      t.datum.group !== "A" || (t.x0 === r.x0 && t.y0 === r.y0 && t.x1 === r.x1 && t.y1 === r.y1);
    const tilingFor = (fits: (t: TileRect) => boolean) => blockOf(layoutTreemap(data, 920, 460, { ...o, labelFits: fits }), "A").tiling;
    expect(tilingFor(same(seen[1]!))).toBe("slice");
    expect(tilingFor(same(seen[2]!))).toBe("dice");
    expect(tilingFor(same(seen[3]!))).toBe("binary");
    // Full-width or full-height both pass: slice is first.
    expect(tilingFor((t) => t.datum.group !== "A" || !(t.x1 === seen[0]!.x1 && t.y1 === seen[0]!.y1))).toBe("slice");
    // Nothing fits: squarify stays, tile for tile.
    const none = layoutTreemap(data, 920, 460, { ...o, labelFits: (t) => t.datum.group !== "A" });
    expect(blockOf(none, "A").tiling).toBe("squarify");
    expect(none.tiles).toEqual(base.tiles);
  });

  it("moves only that group's tiles: every block, and every other group's tiles, stay where they were", () => {
    for (const fits of [(t: TileRect) => t.datum.group !== "A", (t: TileRect) => t.datum.group !== "A" || t.x1 - t.x0 > 400]) {
      const l = layoutTreemap(data, 920, 460, { ...o, labelFits: fits });
      expect(l.groups.map(({ tiling: _, ...g }) => g)).toEqual(base.groups.map(({ tiling: _, ...g }) => g));
      expect(l.tiles.filter((t) => t.datum.group !== "A")).toEqual(base.tiles.filter((t) => t.datum.group !== "A"));
    }
    const sliced = layoutTreemap(data, 920, 460, { ...o, labelFits: (t) => t.datum.group !== "A" || t.x1 - t.x0 > 400 });
    expect(blockOf(sliced, "A").tiling).toBe("slice");
    // Slice rows, largest first, top to bottom, each the block's width, inside the block.
    const a = blockOf(sliced, "A");
    const rows = tilesOf(sliced, "A").sort((p, q) => p.rank - q.rank);
    expect(rows.map((t) => t.datum.value)).toEqual([30, 26, 22, 18, 14]);
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.y0).toBeGreaterThan(rows[i - 1]!.y0);
    for (const t of rows) {
      expect([t.x0, t.x1]).toEqual([a.x0, a.x1]);
      expect(t.y0).toBeGreaterThanOrEqual(a.y0);
      expect(t.y1).toBeLessThanOrEqual(a.y1);
    }
  });

  it("keeps areas exactly proportional to value: with gutters 0, every tile under every tiling is value x one factor", () => {
    const g0 = { tile: 0, group: 0 };
    const sq = layoutTreemap(data, 920, 460, { ...o, gutters: g0 });
    const k = (920 * 460) / sq.total;
    const seen: string[] = [];
    // Accept the n-th alternative tiling for A, rejecting the ones before it.
    for (let n = 1; n <= 3; n++) {
      let calls = 0;
      const l = layoutTreemap(data, 920, 460, { ...o, gutters: g0, labelFits: (t) => t.datum.group !== "A" || calls++ === n });
      seen.push(blockOf(l, "A").tiling);
      for (const t of l.tiles) expect(Math.abs(area(t) / t.datum.value - k) / k).toBeLessThan(2e-3);
      const ts = tilesOf(l, "A");
      const sum = ts.reduce((s, t) => s + area(t), 0) / ts.reduce((s, t) => s + t.datum.value, 0);
      expect(Math.abs(sum - k) / k).toBeLessThan(1e-4);
    }
    expect(seen).toEqual(["slice", "dice", "binary"]);
  });

  it("property: re-tiling never moves a block and keeps areas proportional (gutters 0, 200 random charts)", () => {
    let s = 5;
    const rand = (): number => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    const used = new Set<string>();
    for (let c = 0; c < 200; c++) {
      const n = 4 + Math.floor(rand() * 20);
      const d = grouped(Array.from({ length: n }, (): [string, number] => [`G${Math.floor(rand() * 4)}`, 1 + Math.floor(rand() ** 2 * 100)]));
      const w = 280 + Math.floor(rand() * 640);
      const h = treemapAreaHeight(w);
      const minW = rand() * 200;
      const minH = rand() * 120;
      const opts = { groupOrder: [], gutters: { tile: 0, group: 0 } };
      const sq = layoutTreemap(d, w, h, opts);
      const l = layoutTreemap(d, w, h, { ...opts, labelFits: (t) => t.x1 - t.x0 >= minW && t.y1 - t.y0 >= minH });
      expect(l.groups.map(({ tiling: _, ...g }) => g)).toEqual(sq.groups.map(({ tiling: _, ...g }) => g));
      const k = (w * h) / l.total;
      for (const g of l.groups) {
        used.add(g.tiling);
        const ts = tilesOf(l, g.group);
        if (g.tiling === "squarify") expect(ts).toEqual(tilesOf(sq, g.group));
        const top = g.y0;
        for (const t of ts) {
          expect(t.x0).toBeGreaterThanOrEqual(g.x0);
          expect(t.x1).toBeLessThanOrEqual(g.x1);
          expect(t.y0).toBeGreaterThanOrEqual(top - 0.01);
          expect(t.y1).toBeLessThanOrEqual(g.y1);
          if (t.x1 - t.x0 >= 10 && t.y1 - t.y0 >= 10) expect(Math.abs(area(t) / t.datum.value - k) / k).toBeLessThan(5e-3);
        }
        const perUnit = ts.reduce((sum, t) => sum + area(t), 0) / ts.reduce((sum, t) => sum + t.datum.value, 0);
        // Under 1% of the chart, the 2-decimal output rounding alone can exceed 1e-3.
        if (g.total / l.total >= 0.01) expect(Math.abs(perUnit - k) / k).toBeLessThan(1e-3);
      }
    }
    // Binary rarely wins on a size threshold; the fixed-data tests above force it.
    for (const tiling of ["squarify", "slice", "dice"]) expect(used).toContain(tiling);
  });

  it("never re-tiles flat data: labelFits is not asked and the layout is squarify's", () => {
    const f = flat([30, 26, 22, 18, 5]);
    let asked = 0;
    const l = layoutTreemap(f, 920, 460, { groupOrder: [], labelFits: () => { asked++; return false; } });
    expect(asked).toBe(0);
    expect(l).toEqual(layoutTreemap(f, 920, 460, { groupOrder: [] }));
  });

  it("is deterministic", () => {
    const opts = { ...o, labelFits: (t: TileRect) => t.datum.group !== "A" || t.x1 - t.x0 > 400 };
    expect(layoutTreemap(data, 920, 460, opts)).toEqual(layoutTreemap(data, 920, 460, opts));
  });
});

describe("layoutTreemap: whole-frame tilings for flat data", () => {
  const f = flat([40, 25, 15, 10, 6, 4]);
  const W = 375;
  const H = treemapAreaHeight(375);
  const at = (tiling?: "squarify" | "slice" | "dice" | "binary", gutters?: { tile: number; group: number }) =>
    layoutTreemap(f, W, H, { groupOrder: [], ...(tiling ? { tiling } : {}), ...(gutters ? { gutters } : {}) });

  it("squarify is the default", () => {
    expect(at("squarify")).toEqual(at());
  });

  it("slice: full-width rows, largest on top; dice: full-height columns, largest on the left", () => {
    const rows = byRank(at("slice"));
    expect(rows.map((t) => t.datum.value)).toEqual([40, 25, 15, 10, 6, 4]);
    for (const t of rows) expect([t.x0, t.x1]).toEqual([0, W]);
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.y0).toBeGreaterThan(rows[i - 1]!.y1);
    expect(rows[0]!.y0).toBe(0);
    expect(rows[rows.length - 1]!.y1).toBeCloseTo(H, 1);
    const cols = byRank(at("dice"));
    for (const t of cols) expect([t.y0, t.y1]).toEqual([0, H]);
    for (let i = 1; i < cols.length; i++) expect(cols[i]!.x0).toBeGreaterThan(cols[i - 1]!.x1);
  });

  it("binary differs from squarify, slice and dice", () => {
    const all = (l: TreemapLayout) => byRank(l).map(coords);
    for (const other of ["squarify", "slice", "dice"] as const) expect(all(at("binary"))).not.toEqual(all(at(other)));
  });

  it.each(["squarify", "slice", "dice", "binary"] as const)("%s: areas are exactly proportional to value with gutters 0", (tiling) => {
    const l = at(tiling, { tile: 0, group: 0 });
    const k = (W * H) / l.total;
    for (const t of l.tiles) expect(Math.abs(area(t) / t.datum.value - k) / k).toBeLessThan(2e-3);
    expect(Math.abs(l.tiles.reduce((s, t) => s + area(t), 0) - W * H) / (W * H)).toBeLessThan(1e-4);
  });

  it("matches d3's treemapBinary for flat data", () => {
    const h = d3.hierarchy({ children: [40, 25, 15, 10, 6, 4].map((v) => ({ v })) })
      .sum((d: { v?: number }) => (d.v ?? 0) / 40);
    const d3l = d3.treemap().tile(d3.treemapBinary).size([W, H]).paddingInner(TM_GEOM.tileGutter)(h);
    const want = d3l.leaves().map((n: { x0: number; y0: number; x1: number; y1: number }) =>
      [n.x0, n.y0, n.x1, n.y1].map((v) => Math.round(v * 100) / 100));
    const got = byRank(at("binary")).map(coords);
    got.forEach((c, i) => c.forEach((v, j) => expect(v).toBeCloseTo(want[i]![j]!, 1)));
  });

  it("is deterministic", () => {
    for (const tiling of ["slice", "dice", "binary"] as const) expect(at(tiling)).toEqual(at(tiling));
  });
});
