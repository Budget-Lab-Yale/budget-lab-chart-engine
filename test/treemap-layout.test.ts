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
    // stripFits is asked of every uncompensated block (no strip decided yet), then again of each
    // compensated final block that holds a strip; the second answers are on the final geometry.
    expect(seen.map((g) => g.group)).toEqual(["A", "B", "C", "A", "C"]);
    expect(seen.every((g) => g.strip === false)).toBe(true);
    expect(seen.slice(3).map(coords)).toEqual(l.groups.filter((g) => g.strip).map(coords));
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

  describe("header strips are compensated: the same area per unit value in every group", () => {
    // Groups of several tiles; A and C keep their strips, B and D do not.
    const mixed = grouped([
      ["A", 40], ["A", 25], ["A", 12], ["B", 35], ["B", 30], ["B", 8], ["C", 20], ["C", 9], ["D", 14], ["D", 6],
    ]);
    const fits = (g: GroupRect): boolean => g.group === "A" || g.group === "C";
    const perUnit = (l: TreemapLayout, g: string): number => {
      const ts = tilesOf(l, g);
      return ts.reduce((s, t) => s + area(t), 0) / ts.reduce((s, t) => s + t.datum.value, 0);
    };

    it.each([[920, 460], [600, 330], [375, 354]] as const)("with gutters 0, every tile at %ipx is value x one factor (strip and strip-less groups alike)", (w, h) => {
      const l = layoutTreemap(mixed, w, h, { groupOrder: [], stripFits: fits, gutters: { tile: 0, group: 0 } });
      expect(l.groups.map((g) => [g.group, g.strip])).toEqual([["A", true], ["B", false], ["C", true], ["D", false]]);
      // Tiles plus strips cover the frame, so the one factor is (frame - strips) / total.
      const strips = l.groups.filter((g) => g.strip).reduce((s, g) => s + (g.x1 - g.x0) * TM_GEOM.stripH, 0);
      const k = (w * h - strips) / l.total;
      for (const t of l.tiles) expect(Math.abs(area(t) / t.datum.value - k) / k).toBeLessThan(2e-3);
      for (const g of ["A", "B", "C", "D"]) expect(Math.abs(perUnit(l, g) - k) / k).toBeLessThan(1e-4);
      // The strip sits on top of the block, its tiles below it.
      for (const g of l.groups.filter((x) => x.strip)) {
        expect(Math.min(...tilesOf(l, g.group).map((t) => t.y0))).toBeCloseTo(g.y0 + TM_GEOM.stripH, 1);
      }
    });

    it("with the real gutters, a strip group's tiles are within 2% per unit of a strip-less group's", () => {
      const l = layoutTreemap(mixed, 920, 460, { groupOrder: [], stripFits: fits });
      const a = perUnit(l, "A");
      const b = perUnit(l, "B");
      expect(Math.abs(a - b) / b).toBeLessThan(0.02);
    });

    it("a group that loses its strip gets no extra area: no strips, no compensation", () => {
      const none = layoutTreemap(mixed, 920, 460, { groupOrder: [], stripFits: () => false, gutters: { tile: 0, group: 0 } });
      const k = (920 * 460) / none.total;
      for (const g of ["A", "B", "C", "D"]) expect(Math.abs(perUnit(none, g) - k) / k).toBeLessThan(1e-4);
    });

    it("every strip it reserves fits its final, compensated block: one that stops fitting is dropped", () => {
      // Compensating every group's strip makes A's block shorter than it was uncompensated, so a
      // height floor on A between the two admits A's strip first and must then drop it.
      const h = (l: TreemapLayout, g: string): number => { const b = l.groups.find((x) => x.group === g)!; return b.y1 - b.y0; };
      const before = h(layoutTreemap(mixed, 920, 460, { groupOrder: [], stripFits: () => false }), "A");
      const after = h(layoutTreemap(mixed, 920, 460, { groupOrder: [], stripFits: () => true }), "A");
      expect(after).toBeLessThan(before);
      const floor = (g: GroupRect): boolean => g.group !== "A" || g.y1 - g.y0 >= (before + after) / 2;
      const asked: Array<[string, boolean]> = [];
      const l = layoutTreemap(mixed, 920, 460, { groupOrder: [], stripFits: (g) => { asked.push([g.group, floor(g)]); return floor(g); } });
      expect(asked.slice(0, 4)).toEqual([["A", true], ["B", true], ["C", true], ["D", true]]);
      expect(asked).toContainEqual(["A", false]);
      expect(l.groups.map((g) => [g.group, g.strip])).toEqual([["A", false], ["B", true], ["C", true], ["D", true]]);
      for (const g of l.groups.filter((x) => x.strip)) expect(floor(g)).toBe(true);
      // A lost its strip and its extra area with it: the result is the layout that never gave A a strip.
      const never = layoutTreemap(mixed, 920, 460, { groupOrder: [], stripFits: (g) => g.group !== "A" });
      expect(never.groups.map((g) => g.strip)).toEqual(l.groups.map((g) => g.strip));
      [...l.tiles, ...l.groups].forEach((r, i) => {
        const n = [...never.tiles, ...never.groups][i]!;
        coords(r).forEach((v, j) => expect(Math.abs(v - coords(n)[j]!)).toBeLessThanOrEqual(0.011));
      });
    });

    it("is deterministic", () => {
      const o = { groupOrder: [], stripFits: fits };
      expect(layoutTreemap(mixed, 920, 460, o)).toEqual(layoutTreemap(mixed, 920, 460, o));
    });
  });

  it("is deterministic", () => {
    const o = { groupOrder: ["C"], stripFits: (g: GroupRect) => g.x1 - g.x0 > 200 };
    expect(layoutTreemap(data, W, H, o).tiles).toHaveLength(data.length);
    expect(layoutTreemap(data, W, H, o)).toEqual(layoutTreemap(data, W, H, o));
  });
});
