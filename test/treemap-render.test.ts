// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderChart } from "../src/engine/index";
import { mountChart } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import { TREEMAP_CLASS, treemapChoice, treemapHeight, treemapWarnings } from "../src/engine/marks/treemap";
import { treemapAreaHeight, TM_GEOM } from "../src/engine/treemap-layout";
import { contrastText, fitTileLabel } from "../src/engine/treemap-labels";
import { tokens } from "../src/theme/tokens";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

function parseCsv(path: string): TidyRow[] {
  const text = readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8").trim();
  const [header, ...lines] = text.split(/\r?\n/);
  const cols = (header as string).split(",");
  return lines.map((line) => {
    const cells = line.split(",");
    const row: Record<string, string> = {};
    cols.forEach((c, i) => { row[c] = cells[i] ?? ""; });
    return row as TidyRow;
  });
}
const BLS = parseCsv("./fixtures/treemap-bls.csv");
const GROUPED = parseCsv("./fixtures/treemap-grouped.csv");
const WHITE = tokens.structural.background;
const NAVY = tokens.structural.text_heading;
const FLAT_SPEC = {
  chartType: "treemap", title: "Share of total annual expenditures, 2024", xAxisType: "categorical", data: "d.csv",
  columns: { x: "category", value: "amount" }, value_format: { prefix: "$" },
} as ChartSpec;
const GROUPED_SPEC = {
  ...FLAT_SPEC, title: "Federal outlays", columns: { x: "category", value: "amount", series: "group" },
  series_order: ["Mandatory", "Discretionary", "Net interest", "Other spending"],
} as ChartSpec;
const rowsOf = (pairs: Array<[string, number]>): TidyRow[] => pairs.map(([category, amount]) => ({ category, amount: String(amount) }) as TidyRow);
const q = <E extends Element = Element>(root: ParentNode, sel: string): E[] => [...root.querySelectorAll<E>(sel)];
const num = (e: Element, a: string): number => Number(e.getAttribute(a));
const tiles = (svg: SVGSVGElement) => q<SVGGElement>(svg, "g[role=img]");
const tileOf = (svg: SVGSVGElement, name: string): SVGGElement =>
  tiles(svg).find((g) => (g.getAttribute("aria-label") ?? "").split(", ")[0]!.split(" · ").pop() === name)!;
const render = (spec: ChartSpec, rows: TidyRow[], width = 920, extra = {}) => renderChart(spec, rows, { width, ...extra });

describe("treemap render", () => {
  it("draws one tile per non-zero row, in a tbl-treemap svg", () => {
    const rows = [...BLS, { category: "Nothing", amount: "0" } as TidyRow];
    const { svg } = render(FLAT_SPEC, rows);
    expect(svg.getAttribute("class")).toBe(TREEMAP_CLASS);
    expect(svg.getAttribute("aria-label")).toBe(FLAT_SPEC.title);
    expect(q(svg, "rect.tbl-treemap-tile")).toHaveLength(BLS.length);
    expect(tiles(svg)).toHaveLength(BLS.length);
  });

  it.each([375, 720, 920])("keeps every tile inside the treemap area at %ipx", (w) => {
    for (const [spec, rows] of [[FLAT_SPEC, BLS], [GROUPED_SPEC, GROUPED]] as const) {
      const { svg } = render(spec, rows, w);
      const areaH = treemapAreaHeight(w);
      for (const r of q(svg, "rect.tbl-treemap-tile")) {
        for (const a of ["x", "y", "width", "height"]) expect(Number.isFinite(num(r, a))).toBe(true);
        expect(num(r, "x")).toBeGreaterThanOrEqual(0);
        expect(num(r, "y")).toBeGreaterThanOrEqual(0);
        expect(num(r, "x") + num(r, "width")).toBeLessThanOrEqual(w + 0.01);
        expect(num(r, "y") + num(r, "height")).toBeLessThanOrEqual(areaH + 0.01);
      }
    }
  });

  it("labels each tile for assistive technology with both numbers (flat)", () => {
    const { svg } = render({ ...FLAT_SPEC, treemap: { label_value: "none" } } as ChartSpec, BLS);
    expect(tileOf(svg, "Housing").getAttribute("aria-label")).toBe("Housing, 33.4% of total, $28,452");
    expect(tileOf(svg, "Education").getAttribute("aria-label")).toBe("Education, 2.0% of total, $1,700");
    expect(tileOf(svg, "Housing").hasAttribute("data-series")).toBe(false);
  });

  it("labels each tile with its group's display label (grouped)", () => {
    const spec = { ...GROUPED_SPEC, series_labels: { Mandatory: "Mandatory spending" } } as ChartSpec;
    const { svg } = render(spec, GROUPED);
    expect(tileOf(svg, "Medicare").getAttribute("aria-label")).toBe("Mandatory spending · Medicare, 13.4% of total, $874");
    expect(tileOf(svg, "Defense").getAttribute("aria-label")).toBe("Discretionary · Defense, 13.0% of total, $850");
    expect(tileOf(svg, "Medicare").getAttribute("data-series")).toBe("Mandatory");
  });

  it("puts white text on a dark tile and navy on a light one, per contrastText", () => {
    const { svg } = render(FLAT_SPEC, BLS);
    const fills = new Set<string>();
    for (const g of tiles(svg)) {
      const text = g.querySelector("text");
      if (!text) continue;
      const rectFill = g.querySelector("rect")!.getAttribute("fill")!;
      expect(text.getAttribute("fill")).toBe(contrastText(rectFill));
      fills.add(text.getAttribute("fill")!);
    }
    expect(fills).toEqual(new Set([WHITE, NAVY]));
    expect(tileOf(svg, "Housing").querySelector("text")!.getAttribute("fill")).toBe(WHITE);
    expect(tileOf(svg, "Housing").querySelector("rect")!.getAttribute("fill")).toBe(tokens.scales.blue["700"]);
  });

  it("shows the share by default, the formatted value with label_value: value, the name alone with none", () => {
    const label = (spec: ChartSpec) => tileOf(render(spec, BLS).svg, "Housing").querySelector("text")!;
    expect([...label(FLAT_SPEC).children].map((s) => s.textContent)).toEqual(["Housing", "33.4%"]);
    const value = label({ ...FLAT_SPEC, treemap: { label_value: "value" } } as ChartSpec);
    expect([...value.children].map((s) => s.textContent)).toEqual(["Housing", "$28,452"]);
    const none = render({ ...FLAT_SPEC, treemap: { label_value: "none" } } as ChartSpec, BLS).svg;
    expect(tileOf(none, "Housing").querySelector("text")!.textContent).toBe("Housing");
    for (const t of q(none, "text.tbl-treemap-label")) expect(t.textContent).not.toMatch(/%|\$/);
  });

  it("draws every label exactly as fitTileLabel fitted it, top-left in its tile's inner box", () => {
    let inline = 0;
    let cut = 0;
    // One large tile and eight small equal ones: at 720 the last two are short enough to go inline.
    const INLINE = rowsOf([["Big", 500], ...Array.from({ length: 8 }, (_, i): [string, number] => [`Food ${i}`, 10])]);
    for (const w of [375, 560, 720, 920]) {
      for (const [spec, rows] of [[FLAT_SPEC, BLS], [GROUPED_SPEC, GROUPED], [FLAT_SPEC, INLINE]] as const) {
        const { svg } = render(spec, rows, w);
        const choice = treemapChoice(spec, rows, w);
        const size = choice.candidates[choice.chosen]!.size;
        for (const g of tiles(svg)) {
          const rect = g.querySelector("rect")!;
          const [x, y, rw, rh] = ["x", "y", "width", "height"].map((a) => num(rect, a)) as [number, number, number, number];
          const name = g.getAttribute("aria-label")!.split(", ")[0]!.split(" · ").pop()!;
          const share = g.getAttribute("aria-label")!.split(", ")[1]!.replace(" of total", "");
          const fit = fitTileLabel(name, share, rw, rh, size);
          const text = g.querySelector("text");
          if (fit.mode === "none") {
            expect(text).toBeNull();
            continue;
          }
          // A tile that fits can still be unlabelled: a larger tile in its group did not fit.
          if (text === null) {
            cut++;
            continue;
          }
          const spans = [...text!.children];
          // Left-aligned at the inner box's left edge; each line's box stacks down from its top edge,
          // the baseline centring the cap height in the line box.
          expect(text!.getAttribute("text-anchor")).toBe("start");
          const left = x + TM_GEOM.pad;
          let top = y + TM_GEOM.pad;
          const baseline = (size: number): number => top + (size * 1.2) / 2 + 0.35 * size;
          if (fit.mode === "stacked") {
            expect(spans.map((s) => s.textContent)).toEqual([...fit.nameLines, fit.number]);
            spans.forEach((s, i) => {
              const isNumber = i === spans.length - 1;
              const size = fit.size;
              expect(num(s, "font-weight")).toBe(isNumber ? 500 : 700);
              expect(num(s, "font-size")).toBe(size);
              expect(num(s, "x")).toBeCloseTo(left, 1);
              expect(num(s, "y")).toBeCloseTo(baseline(size), 1);
              top += size * 1.2;
            });
          } else {
            inline++;
            expect(spans.map((s) => s.textContent)).toEqual([fit.name, ` ${fit.number}`]);
            expect(spans.map((s) => num(s, "font-weight"))).toEqual([700, 500]);
            expect(num(text!, "font-size")).toBe(fit.size);
            expect(num(text!, "x")).toBeCloseTo(left, 1);
            expect(num(text!, "y")).toBeCloseTo(baseline(fit.size), 1);
            top += fit.size * 1.2;
          }
          // The block ends inside the inner box.
          expect(top).toBeLessThanOrEqual(y + rh - TM_GEOM.pad + 0.01);
        }
      }
    }
    expect(inline).toBeGreaterThan(0);
    expect(cut).toBeGreaterThan(0);
  });

  it("labels top-down by value in each group: no unlabelled tile is larger than a labelled one in its group", () => {
    let s = 11;
    const rand = (): number => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    const words = ["Housing", "Food", "Transportation", "Health care", "Education", "Personal insurance and pensions", "Other"];
    let charts = 0;
    let mixed = 0;
    for (let c = 0; c < 120; c++) {
      const grouped = c % 2 === 1;
      const n = 3 + Math.floor(rand() * 20);
      const rows = Array.from({ length: n }, (_, i) => ({
        group: `G${Math.floor(rand() * 4)}`, category: `${words[Math.floor(rand() * words.length)]} ${i}`,
        amount: String(Math.round(1 + rand() ** 3 * 1000)),
      })) as TidyRow[];
      const w = [280, 375, 560, 720, 920][c % 5]!;
      const { svg } = render(grouped ? GROUPED_SPEC : FLAT_SPEC, rows, w);
      charts++;
      const byGroup = new Map<string, Array<{ value: number; labelled: boolean }>>();
      for (const g of tiles(svg)) {
        const key = g.getAttribute("data-series") ?? "";
        const value = Number(g.getAttribute("aria-label")!.split(", ").pop()!.replace(/[$,]/g, ""));
        const list = byGroup.get(key) ?? [];
        list.push({ value, labelled: g.querySelector("text") !== null });
        byGroup.set(key, list);
      }
      for (const list of byGroup.values()) {
        const minLabelled = Math.min(...list.filter((t) => t.labelled).map((t) => t.value));
        const maxUnlabelled = Math.max(...list.filter((t) => !t.labelled).map((t) => t.value));
        expect(maxUnlabelled).toBeLessThanOrEqual(minLabelled);
        if (Number.isFinite(minLabelled) && Number.isFinite(maxUnlabelled)) mixed++;
      }
    }
    expect(charts).toBe(120);
    expect(mixed).toBeGreaterThan(30);
  });

  it("draws no key: the svg is the treemap area alone, and an unlabelled tile is named by its aria-label", () => {
    let unlabelledSeen = 0;
    for (const w of [280, 375, 720, 920]) {
      for (const [spec, rows] of [[FLAT_SPEC, BLS], [GROUPED_SPEC, GROUPED]] as const) {
        const { svg } = render(spec, rows, w);
        expect(num(svg, "height")).toBe(treemapAreaHeight(w));
        expect(svg.getAttribute("viewBox")).toBe(`0 0 ${w} ${treemapAreaHeight(w)}`);
        // Every text is drawn on the treemap, and every one is a tile's label.
        for (const t of q(svg, "text")) {
          expect(t.getAttribute("class")).toBe("tbl-treemap-label");
          for (const y of [t, ...t.children].filter((e) => e.hasAttribute("y"))) expect(num(y, "y")).toBeLessThan(treemapAreaHeight(w));
        }
        for (const g of tiles(svg).filter((t) => !t.querySelector("text"))) {
          unlabelledSeen++;
          expect(g.getAttribute("aria-label")).toMatch(/^.+, \d+\.\d% of total, \$[\d,]+$/);
        }
      }
    }
    expect(unlabelledSeen).toBeGreaterThan(0);
  });

  it("draws no header strips and no in-block group names: tiles and their labels are all there is", () => {
    const g = (rows: Array<[string, string, number]>) => rows.map(([group, category, amount]) => ({ group, category, amount: String(amount) }) as TidyRow);
    const thinGroup = g([["A", "a1", 50], ["A", "a2", 40], ...Array.from({ length: 8 }, (_, i): [string, string, number] => ["B", `Category number ${i}`, 1.25])]);
    for (const w of [280, 375, 599, 600, 920]) {
      for (const rows of [GROUPED, thinGroup]) {
        const { svg } = render(GROUPED_SPEC, rows, w);
        expect(q(svg, "rect").map((r) => r.getAttribute("class"))).toEqual(["tbl-treemap-bg", ...tiles(svg).map(() => "tbl-treemap-tile")]);
        for (const t of q(svg, "text")) {
          expect(t.getAttribute("class")).toBe("tbl-treemap-label");
          expect(t.parentElement!.getAttribute("role")).toBe("img");
        }
      }
    }
  });

  it("a one-tile group shows its tile's own name and number, as any tile does", () => {
    // In the fixture, Net interest is one tile named Net interest.
    for (const [labelValue, want] of [["share", ["Net interest", "13.5%"]], ["value", ["Net interest", "$881"]], ["none", ["Net interest"]]] as const) {
      const spec = { ...GROUPED_SPEC, treemap: { label_value: labelValue } } as ChartSpec;
      const text = tileOf(render(spec, GROUPED, 920).svg, "Net interest").querySelector("text")!;
      expect([...text.children].map((s) => s.textContent!.trim())).toEqual([...want]);
    }
  });

  it("grouped tiles shade by rank across their group's 4-tier band, the largest darkest", () => {
    const two = ([["A", "a1", 300], ["A", "a2", 200], ["A", "a3", 100], ["B", "b1", 250], ["B", "b2", 150]] as const)
      .map(([group, category, amount]) => ({ group, category, amount: String(amount) }) as TidyRow);
    const { svg } = render(GROUPED_SPEC, two, 920);
    const fill = (n: string) => tileOf(svg, n).querySelector("rect")!.getAttribute("fill");
    // Blue's base sits at blue-400: band 500, 400, 300, 200. Amber's sits at amber-100: band 300 … 50.
    expect(["a1", "a2", "a3"].map(fill)).toEqual([tokens.scales.blue["500"], tokens.scales.blue["300"], tokens.scales.blue["200"]]);
    expect(["b1", "b2"].map(fill)).toEqual([tokens.scales.amber["300"], tokens.scales.amber["50"]]);
  });

  it("re-tiles a group whose largest tile cannot hold its label: full-width rows inside the same block, every tile labelled", () => {
    // Squarified, A's largest tile is a 126px-wide cell, too narrow for "Intergovernmental" at 14px,
    // so the whole group would go unlabelled. Sliced into rows, every tile fits.
    const rows = [["A", "Intergovernmental transfers", 13], ...Array.from({ length: 6 }, (_, i) => ["A", `a${i}`, 12]),
      ["B", "Big", 90], ["C", "Mid", 40]].map(([group, category, amount]) => ({ group, category, amount: String(amount) }) as TidyRow);
    const { svg } = render(GROUPED_SPEC, rows, 920);
    const a = q<SVGGElement>(svg, 'g[data-series="A"]');
    const rs = a.map((g) => g.querySelector("rect")!);
    // The block: the union of A's tiles (its outermost tiles reach its edges).
    const block = { x: Math.min(...rs.map((r) => num(r, "x"))), y: Math.min(...rs.map((r) => num(r, "y"))),
      width: Math.max(...rs.map((r) => num(r, "x") + num(r, "width"))) - Math.min(...rs.map((r) => num(r, "x"))) };
    expect(a.map((g) => g.getAttribute("aria-label")!.split(", ")[0])).toEqual(
      ["A · Intergovernmental transfers", ...Array.from({ length: 6 }, (_, i) => `A · a${i}`)]);
    let top = block.y;
    for (const g of a) {
      const r = g.querySelector("rect")!;
      expect(g.querySelector("text")).not.toBeNull();
      expect([num(r, "x"), num(r, "width")]).toEqual([block.x, block.width]);
      expect(num(r, "y")).toBeCloseTo(top, 1);
      top = num(r, "y") + num(r, "height") + TM_GEOM.tileGutter;
    }
    // The rows fill the block to the bottom of the area, and their heights follow value (less gutters).
    expect(top - TM_GEOM.tileGutter).toBeCloseTo(treemapAreaHeight(920), 1);
    const h = (g: SVGGElement): number => num(g.querySelector("rect")!, "height") + TM_GEOM.tileGutter;
    expect(h(a[0]!) / h(a[1]!)).toBeCloseTo(13 / 12, 2);
  });

  it("shows 100.0% on a one-tile chart", () => {
    const { svg } = render(FLAT_SPEC, rowsOf([["Everything", 42]]));
    expect(q(svg, "rect.tbl-treemap-tile")).toHaveLength(1);
    expect(svg.querySelector("text.tbl-treemap-label")!.textContent).toBe("Everything100.0%");
  });

  it("keeps a sub-pixel tile's attributes finite and leaves it unlabelled", () => {
    const { svg } = render(FLAT_SPEC, rowsOf([["Big", 1_000_000], ["Tiny", 1]]), 720);
    const tiny = tileOf(svg, "Tiny").querySelector("rect")!;
    for (const a of ["x", "y", "width", "height"]) expect(Number.isFinite(num(tiny, a))).toBe(true);
    expect(tileOf(svg, "Tiny").querySelector("text")).toBeNull();
  });

  it("returns per-tile hover info in DOM order", () => {
    const res = render(GROUPED_SPEC, GROUPED);
    const rects = q(res.svg, "rect.tbl-treemap-tile");
    expect(res.treemapTiles).toHaveLength(rects.length);
    res.treemapTiles!.forEach((t, i) => {
      expect(t.fill).toBe(rects[i]!.getAttribute("fill"));
      expect(rects[i]!.parentElement!.getAttribute("aria-label")).toContain(`${t.name}, `);
    });
    const medicare = res.treemapTiles!.find((t) => t.name === "Medicare")!;
    expect(medicare).toMatchObject({ group: "Mandatory", groupLabel: "Mandatory", value: 874 });
    expect(medicare.share).toBeCloseTo(874 / 6531, 12);
    expect(medicare.row).toBe(GROUPED[1]);
    const flat = render(FLAT_SPEC, BLS).treemapTiles!;
    expect(flat[0]).toMatchObject({ name: "Housing", group: null, groupLabel: null, value: 28452 });
  });

  it("calls hooks.afterRender once with the svg and the phase", () => {
    const afterRender = vi.fn();
    const { svg } = render(FLAT_SPEC, BLS, 920, { hooks: { afterRender }, phase: "export" });
    expect(afterRender).toHaveBeenCalledTimes(1);
    expect(afterRender).toHaveBeenCalledWith(svg, { phase: "export" });
  });

  it.each([375, 720, 920])("treemapHeight equals the svg height at %ipx", (w) => {
    for (const [spec, rows] of [[FLAT_SPEC, BLS], [GROUPED_SPEC, GROUPED]] as const) {
      const { svg } = render(spec, rows, w);
      expect(treemapHeight(spec, rows, w)).toBe(num(svg, "height"));
    }
  });
});

describe("candidate selection: the tiling and size that label the most tiles", () => {
  /** Every drawn tile label's font size (an inline one carries it on the <text>, a stacked one on its tspans). */
  const labelSizes = (svg: SVGSVGElement): Set<string> => new Set(q(svg, "text.tbl-treemap-label").map((t) =>
    t.getAttribute("font-size") ?? t.firstElementChild!.getAttribute("font-size")!));
  const labelledCount = (svg: SVGSVGElement): number => tiles(svg).filter((g) => g.querySelector("text")).length;
  const firstMax = (counts: number[]): number => counts.indexOf(Math.max(...counts));

  it("flat: squarify, slice, dice, binary at the base size, then the same at 11px only below 400px wide", () => {
    const names = (w: number) => treemapChoice(FLAT_SPEC, BLS, w).candidates.map((c) => `${c.tiling}@${c.size}`);
    expect(names(920)).toEqual(["squarify@14", "slice@14", "dice@14", "binary@14"]);
    expect(names(400)).toEqual(["squarify@12", "slice@12", "dice@12", "binary@12"]);
    expect(names(399)).toEqual(["squarify@12", "slice@12", "dice@12", "binary@12", "squarify@11", "slice@11", "dice@11", "binary@11"]);
  });

  it("grouped: squarified blocks at 600px and wider; below, the four arrangements at the base size, then at 11px below 400px", () => {
    const names = (w: number) => treemapChoice(GROUPED_SPEC, GROUPED, w).candidates.map((c) => `${c.tiling}@${c.size}`);
    expect(names(920)).toEqual(["squarify@14"]);
    expect(names(600)).toEqual(["squarify@14"]);
    expect(names(599)).toEqual(["squarify@12", "slice@12", "dice@12", "binary@12"]);
    expect(names(399)).toEqual(["squarify@12", "slice@12", "dice@12", "binary@12", "squarify@11", "slice@11", "dice@11", "binary@11"]);
  });

  it("scores labelled tiles alone, and counts what is drawn", () => {
    for (const [spec, rows, w] of [[GROUPED_SPEC, GROUPED, 375], [GROUPED_SPEC, GROUPED, 920], [FLAT_SPEC, BLS, 340]] as const) {
      const choice = treemapChoice(spec, rows, w);
      for (const c of choice.candidates) expect(Object.keys(c).sort()).toEqual(["labelled", "size", "tiling"]);
      expect(choice.chosen).toBe(firstMax(choice.candidates.map((c) => c.labelled)));
      const chosen = choice.candidates[choice.chosen]!;
      const { svg } = render(spec, rows, w);
      expect(labelledCount(svg)).toBe(chosen.labelled);
    }
  });

  it("BLS at 280 and 340 labels far more than the one tile squarify@12 manages", () => {
    for (const [w, want] of [[280, { tiling: "squarify", size: 11, labelled: 5 }], [340, { tiling: "squarify", size: 11, labelled: 7 }]] as const) {
      const choice = treemapChoice(FLAT_SPEC, BLS, w);
      expect(choice.candidates[0]!.labelled).toBe(1);
      const chosen = choice.candidates[choice.chosen]!;
      expect(chosen).toMatchObject(want);
      const { svg } = render(FLAT_SPEC, BLS, w);
      expect(labelledCount(svg)).toBe(chosen.labelled);
      expect(labelSizes(svg)).toEqual(new Set([String(chosen.size)]));
    }
  });

  it("a wide chart keeps squarify at 14px, flat or grouped", () => {
    for (const [spec, rows] of [[FLAT_SPEC, BLS], [GROUPED_SPEC, GROUPED]] as const) {
      const choice = treemapChoice(spec, rows, 920);
      expect(choice.chosen).toBe(0);
      expect(choice.candidates[0]).toMatchObject({ tiling: "squarify", size: 14 });
    }
  });

  it("ties go to the earlier candidate: every candidate labels every tile, squarify wins", () => {
    const choice = treemapChoice(FLAT_SPEC, rowsOf([["Alpha", 5], ["Beta", 4], ["Gamma", 3]]), 920);
    expect(choice.candidates.map((c) => c.labelled)).toEqual([3, 3, 3, 3]);
    expect(choice.chosen).toBe(0);
    // Grouped, below 600px: two large groups, each tile labelled under every arrangement.
    const two = ([["A", "a1", 300], ["A", "a2", 200], ["B", "b1", 250], ["B", "b2", 150]] as const)
      .map(([group, category, amount]) => ({ group, category, amount: String(amount) }) as TidyRow);
    const g = treemapChoice(GROUPED_SPEC, two, 560);
    expect(g.candidates.map((c) => c.labelled)).toEqual([4, 4, 4, 4]);
    expect(g.chosen).toBe(0);
  });

  it("property: the chosen candidate is the first that labels the most tiles, drawn at one size (150 charts)", () => {
    let s = 3;
    const rand = (): number => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    const words = ["Housing", "Food", "Transportation", "Health care", "Education", "Personal insurance and pensions", "Other"];
    const picked = new Set<string>();
    for (let c = 0; c < 150; c++) {
      const grouped = c % 3 === 2;
      const rows = Array.from({ length: 3 + Math.floor(rand() * 15) }, (_, i) => ({
        group: `G${Math.floor(rand() * 3)}`, category: `${words[Math.floor(rand() * words.length)]} ${i}`,
        amount: String(Math.round(1 + rand() ** 2 * 1000)),
      })) as TidyRow[];
      const w = [280, 320, 360, 399, 400, 560, 920][c % 7]!;
      const spec = grouped ? GROUPED_SPEC : FLAT_SPEC;
      const choice = treemapChoice(spec, rows, w);
      expect(choice.chosen).toBe(firstMax(choice.candidates.map((x) => x.labelled)));
      if (grouped && w >= 600) for (const x of choice.candidates) expect(x.tiling).toBe("squarify");
      const chosen = choice.candidates[choice.chosen]!;
      picked.add(`${grouped ? "g" : "f"}:${chosen.tiling}@${chosen.size === 11 ? 11 : "base"}`);
      if (chosen.size === 11) expect(w).toBeLessThan(400);
      const { svg } = render(spec, rows, w);
      expect(labelledCount(svg)).toBe(chosen.labelled);
      const sizes = labelSizes(svg);
      expect(sizes.size).toBeLessThanOrEqual(1);
      for (const size of sizes) expect(size).toBe(String(chosen.size));
    }
    // Grouped charts below 600px take an arrangement other than squarify somewhere in this set.
    expect([...picked].some((p) => p.startsWith("g:") && !p.startsWith("g:squarify"))).toBe(true);
    expect(picked.size).toBeGreaterThan(3);
  });
});

describe("treemapWarnings", () => {
  it("passes the data warnings through and is otherwise empty for a well-labelled chart", () => {
    expect(treemapWarnings(FLAT_SPEC, BLS)).toEqual([]);
    const rows = [...BLS, { category: "Nothing", amount: "0" } as TidyRow];
    expect(treemapWarnings(FLAT_SPEC, rows)).toEqual([`treemap: 1 zero-value row not drawn: row 11 ("Nothing")`]);
  });

  it("warns when more than half the tiles are unlabelled at the 920px export width", () => {
    const rows = rowsOf([["Big", 1_000_000], ...Array.from({ length: 6 }, (_, i): [string, number] => [`Tiny ${i}`, 1])]);
    expect(treemapWarnings(FLAT_SPEC, rows)).toEqual([
      `treemap: 6 of 7 tiles are unlabelled at 920px wide (hover still names them); consider grouping small categories into "Other"`,
    ]);
    // The message names the width it was measured at, not a fixed "export width".
    expect(treemapWarnings(FLAT_SPEC, rows, 640)[0]).toMatch(/unlabelled at 640px wide/);
    // Exactly half unlabelled is not more than half.
    const half = rowsOf([["Big", 1_000_000], ["Big 2", 1_000_000], ["Tiny 0", 1], ["Tiny 1", 1]]);
    expect(treemapWarnings(FLAT_SPEC, half)).toEqual([]);
  });
});

describe("group names that are Object.prototype keys", () => {
  // series_labels / series_colors are plain objects: a lookup keyed by a group named "constructor"
  // must not find the inherited property.
  const PROTO = ["constructor", "toString", "__proto__"];
  const protoRows = PROTO.flatMap((group, i) => [
    { group, category: `${group} one`, amount: String(300 - 10 * i) },
    { group, category: `${group} two`, amount: String(200 - 10 * i) },
  ]) as TidyRow[];
  const SPEC = { ...FLAT_SPEC, columns: { x: "category", value: "amount", series: "group" } } as ChartSpec;
  /** The group display names the tiles' aria-labels carry. */
  const groupNames = (svg: SVGSVGElement): string[] =>
    [...new Set(tiles(svg).map((g) => g.getAttribute("aria-label")!.split(" · ")[0]!))];
  const variants: Array<[string, ChartSpec]> = [
    ["no series_labels or series_colors", SPEC],
    // Set, but keyed by one group only: the other two must fall through to their own name and hue.
    ["series_labels and series_colors set for one group", { ...SPEC, series_labels: { toString: "Renamed" }, series_colors: { constructor: "green" } } as ChartSpec],
  ];

  for (const [what, spec] of variants) {
    it(`render, mount, export and warnings all work with ${what}`, () => {
      const renamed = spec.series_labels ? { toString: "Renamed" } as Record<string, string> : {};
      const want = PROTO.map((g) => (Object.hasOwn(renamed, g) ? renamed[g]! : g));
      const { svg } = renderChart(spec, protoRows, { width: 920 });
      expect(new Set(groupNames(svg))).toEqual(new Set(want));
      for (const f of q(svg, "rect.tbl-treemap-tile").map((r) => r.getAttribute("fill")!)) expect(f).toMatch(/^#[0-9A-F]{6}$/i);
      if (spec.series_colors) {
        expect(tileOf(svg, "constructor one").querySelector("rect")!.getAttribute("fill")).toBe(tokens.scales.green["400"]);
      }
      expect(tileOf(svg, "toString one").getAttribute("aria-label")).toMatch(new RegExp(`^${want[1]} · toString one, `));

      document.body.innerHTML = "";
      const host = document.createElement("div");
      document.body.append(host);
      mountChart(host, { spec, rows: protoRows, width: 920 });
      const live = host.querySelector<SVGSVGElement>("svg.tbl-treemap")!;
      expect(new Set(groupNames(live))).toEqual(new Set(want));
      tileOf(live, "__proto__ one").dispatchEvent(new PointerEvent("pointerenter", { clientX: 10, clientY: 10 }));
      expect(document.querySelector(".tbl-tooltip .tbl-tooltip-head")!.textContent).toBe("__proto__ · __proto__ one");

      const exported = buildExportSvg(spec, protoRows).querySelector<SVGSVGElement>(`svg.${TREEMAP_CLASS}`)!;
      expect(new Set(groupNames(exported))).toEqual(new Set(want));

      expect(treemapWarnings(spec, protoRows)).toEqual([]);
    });
  }

  it("an own __proto__ key in series_labels (as JSON or YAML parsing makes one) renames that group", () => {
    const spec = { ...SPEC, series_labels: JSON.parse('{"__proto__": "Proto group"}') } as ChartSpec;
    expect(Object.hasOwn(spec.series_labels!, "__proto__")).toBe(true);
    const { svg } = renderChart(spec, protoRows, { width: 920 });
    expect(new Set(groupNames(svg))).toEqual(new Set(["constructor", "toString", "Proto group"]));
  });
});

describe("treemap background", () => {
  it("paints the treemap area white under the tiles, so gutters are white on any host", () => {
    const rows = rowsOf([["Big", 1_000_000], ...Array.from({ length: 4 }, (_, i): [string, number] => [`Tiny ${i}`, 1])]);
    for (const [spec, data, width] of [[FLAT_SPEC, rows, 375], [GROUPED_SPEC, GROUPED, 920]] as const) {
      const { svg } = render(spec, data, width);
      const bg = svg.firstElementChild!;
      expect(bg.tagName).toBe("rect");
      expect(bg.getAttribute("class")).toBe("tbl-treemap-bg");
      expect(bg.getAttribute("fill")).toBe(WHITE);
      expect([num(bg, "x"), num(bg, "y"), num(bg, "width"), num(bg, "height")])
        .toEqual([0, 0, width, Math.round(treemapAreaHeight(width) * 100) / 100]);
      expect(q(svg, "rect.tbl-treemap-bg")).toHaveLength(1);
      // The area is the whole svg: the background covers it all.
      expect(num(bg, "height")).toBe(Math.round(num(svg, "height") * 100) / 100);
    }
  });
});
