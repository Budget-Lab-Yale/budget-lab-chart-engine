// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderChart } from "../src/engine/index";
import { mountChart } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import { TREEMAP_CLASS, pickCandidate, treemapChoice, treemapHeight, treemapWarnings } from "../src/engine/marks/treemap";
import { treemapAreaHeight, TM_GEOM } from "../src/engine/treemap-layout";
import { contrastText, fitTileLabel, treemapShades } from "../src/engine/treemap-labels";
import { tokens } from "../src/theme/tokens";
import { d3 } from "../src/engine/vendor";
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
    expect(tileOf(svg, "Housing").querySelector("rect")!.getAttribute("fill")).toBe(tokens.scales.blue["500"]);
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
    // One large tile and eight small equal ones, as one group (so d3's default squarify lays them out
    // at 600px and wider): at 720 the last two are short enough to go inline.
    const INLINE = rowsOf([["Big", 500], ...Array.from({ length: 8 }, (_, i): [string, number] => [`Food ${i}`, 10])])
      .map((r) => ({ ...r, group: "G" }) as TidyRow);
    // The largest tile's one-word name fits no tile at any width, so labelling stops there and the
    // smaller tiles, which would fit, are cut.
    const CUT = rowsOf([["W".repeat(80), 100], ["B", 60], ["C", 40]]);
    for (const w of [375, 560, 720, 920]) {
      for (const [spec, rows] of [[FLAT_SPEC, BLS], [GROUPED_SPEC, GROUPED], [GROUPED_SPEC, INLINE], [FLAT_SPEC, CUT]] as const) {
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

  it("property: within every group (flat data is one), a smaller tile is never darker than a larger one (300 charts)", () => {
    let s = 41;
    const rand = (): number => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    const refs = ["blue", "amber-50", "violet-300", "green-700", "red", "rose-600", "russet-100", "blue-200"];
    let pairs = 0;
    for (let c = 0; c < 300; c++) {
      const grouped = c % 2 === 0;
      const groups = 1 + Math.floor(rand() * 6);
      const n = 1 + Math.floor(rand() * 30);
      const rows = Array.from({ length: n }, (_, i) => ({
        group: `G${i % groups}`, category: `t${i}`, amount: String(1 + Math.floor(rand() * (c % 3 === 0 ? 5 : 1000))),
      })) as TidyRow[];
      const spec = grouped
        ? ({ ...GROUPED_SPEC, series_order: [], ...(c % 4 === 0 ? { series_colors: { G0: refs[c % refs.length]! } } : {}) } as ChartSpec)
        : FLAT_SPEC;
      const tiles = renderChart(spec, rows, { width: [375, 599, 920][c % 3]! }).treemapTiles!;
      const byGroup = new Map<string | null, typeof tiles>();
      for (const t of tiles) byGroup.set(t.group, [...(byGroup.get(t.group) ?? []), t]);
      for (const members of byGroup.values()) {
        const sorted = [...members].sort((a, b) => b.value - a.value);
        for (let i = 1; i < sorted.length; i++) {
          // Equal values may sit on either side of a shade boundary; a strictly smaller one may not be darker.
          if (sorted[i]!.value === sorted[i - 1]!.value) continue;
          expect(d3.lab(sorted[i]!.fill).l).toBeGreaterThanOrEqual(d3.lab(sorted[i - 1]!.fill).l - 1e-9);
          pairs++;
        }
      }
    }
    expect(pairs).toBeGreaterThan(1000);
  });

  it("a group or a flat chart with exactly one tile draws it in its colour as resolved: the legend chip", () => {
    const one = ([["A", "a1", 300], ["B", "b1", 200], ["B", "b2", 100]] as const)
      .map(([group, category, amount]) => ({ group, category, amount: String(amount) }) as TidyRow);
    const res = renderChart(GROUPED_SPEC, one, { width: 920 });
    const fill = (n: string) => tileOf(res.svg, n).querySelector("rect")!.getAttribute("fill");
    expect(fill("a1")).toBe(tokens.categorical[0]!.base);
    expect(fill("a1")).toBe(res.legendItems!.find((i) => i.series === "A")!.color);
    // A two-tile group still runs its band's ends.
    const amber = treemapShades(tokens.categorical[1]!.base)!;
    expect(["b1", "b2"].map(fill)).toEqual([amber[0], amber[6]]);
    // A series_colors tier is drawn as written on a one-tile group.
    const tier = renderChart({ ...GROUPED_SPEC, series_colors: { A: "violet-300" } } as ChartSpec, one, { width: 920 });
    expect(tileOf(tier.svg, "a1").querySelector("rect")!.getAttribute("fill")).toBe(tokens.scales.violet["300"]);
    // Flat data with one tile: blue as resolved.
    const flat = renderChart(FLAT_SPEC, rowsOf([["Only", 5]]), { width: 920 });
    expect(tileOf(flat.svg, "Only").querySelector("rect")!.getAttribute("fill")).toBe(tokens.categorical[0]!.base);
  });

  it("extreme magnitudes draw finite rects live and in the PNG (Ruling 43)", () => {
    const rows = ([["A", "Huge", "1e282"], ["B", "Small", "1e-36"], ["B", "Tiny", "1e-267"]] as const)
      .map(([group, category, amount]) => ({ group, category, amount }) as TidyRow);
    const finite = (svg: SVGSVGElement) => {
      const rects = q(svg, "rect.tbl-treemap-tile");
      expect(rects).toHaveLength(3);
      for (const r of rects) for (const a of ["x", "y", "width", "height"]) expect(Number.isFinite(num(r, a)), `${a}=${r.getAttribute(a)}`).toBe(true);
    };
    finite(render(GROUPED_SPEC, rows, 920).svg);
    finite(buildExportSvg(GROUPED_SPEC, rows).querySelector<SVGSVGElement>(`svg.${TREEMAP_CLASS}`)!);
  });

  it("rescue targets the group's first tile under the same 12-significant-digit tie rule, so a tie that cannot fit is re-tiled", () => {
    const rows = ([["A", "WWWWWWWWWW", 1], ["A", "B", 1.0000000000001], ["Other", "C0", 2]] as const)
      .map(([group, category, amount]) => ({ group, category, amount: String(amount) }) as TidyRow);
    const { svg } = render(GROUPED_SPEC, rows, 600);
    // Squarified, A's tiles are 148px columns too narrow for the long name; re-tiled as full-width
    // rows inside the same block, both are labelled.
    for (const n of ["WWWWWWWWWW", "B", "C0"]) expect(tileOf(svg, n).querySelector("text.tbl-treemap-label"), n).not.toBeNull();
  });

  it("labelling visits tiles equal to 12 significant digits in layout (CSV) order, so the first unfit one stops it", () => {
    const long = "W".repeat(100);
    const res = renderChart(FLAT_SPEC, rowsOf([[long, 1], ["B", 1.0000000000001]]), { width: 920 });
    // Layout keeps CSV order for the tie ...
    expect(res.treemapTiles!.map((t) => t.name)).toEqual([long, "B"]);
    // ... and the long name cannot be labelled, so B, its equal, is not labelled either.
    expect(q(res.svg, "text.tbl-treemap-label")).toHaveLength(0);
  });

  it("grouped tiles shade by rank across their group's 7 shades (4-tier band plus midpoints), the largest darkest", () => {
    const two = ([["A", "a1", 300], ["A", "a2", 200], ["A", "a3", 100], ["B", "b1", 250], ["B", "b2", 150]] as const)
      .map(([group, category, amount]) => ({ group, category, amount: String(amount) }) as TidyRow);
    const { svg } = render(GROUPED_SPEC, two, 920);
    const fill = (n: string) => tileOf(svg, n).querySelector("rect")!.getAttribute("fill");
    // Blue's base sits at blue-400: band 500, 400, 300, 200, so shades 500, 450, … 200, and three
    // tiles take the 1st, 4th (the 400/300 midpoint) and 7th. Amber's sits at amber-100: band 300 … 50.
    expect(["a1", "a2", "a3"].map(fill)).toEqual([tokens.scales.blue["500"], treemapShades(tokens.categorical[0]!.base)![3], tokens.scales.blue["200"]]);
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
      expect(treemapHeight(w)).toBe(num(svg, "height"));
    }
  });
});

describe("candidate selection: squarify first, another tiling only by labelling at least 2 more (Ruling 45)", () => {
  /** Every drawn tile label's font size (an inline one carries it on the <text>, a stacked one on its tspans). */
  const labelSizes = (svg: SVGSVGElement): Set<string> => new Set(q(svg, "text.tbl-treemap-label").map((t) =>
    t.getAttribute("font-size") ?? t.firstElementChild!.getAttribute("font-size")!));
  const labelledCount = (svg: SVGSVGElement): number => tiles(svg).filter((g) => g.querySelector("text")).length;
  /** Ruling 45, restated independently: within each size step the best squarify variant (first max
   *  of squarify-1, squarify, squarify-2), unless the best of slice/dice/binary labels at least 2
   *  more; across steps the first step winner that labels the most. */
  const SQ = ["squarify-1", "squarify", "squarify-2"];
  const expectedChoice = (cs: Array<{ tiling: string; size: number; labelled: number }>): number => {
    const firstMaxOf = (ii: number[]): number => ii.reduce((a, b) => (cs[b]!.labelled > cs[a]!.labelled ? b : a));
    let best = -1;
    for (const size of [...new Set(cs.map((c) => c.size))]) {
      const idx = cs.map((_, i) => i).filter((i) => cs[i]!.size === size);
      const sq = idx.filter((i) => SQ.includes(cs[i]!.tiling));
      const other = idx.filter((i) => !SQ.includes(cs[i]!.tiling));
      let w = firstMaxOf(sq);
      if (other.length > 0) {
        const o = firstMaxOf(other);
        if (cs[o]!.labelled >= cs[w]!.labelled + 2) w = o;
      }
      if (best < 0 || cs[w]!.labelled > cs[best]!.labelled) best = w;
    }
    return best;
  };

  const ALL = (size: number): string[] => ["squarify-1", "squarify", "squarify-2", "slice", "dice", "binary"].map((t) => `${t}@${size}`);
  it("flat: the squarify variants (ratio 1, φ, ratio 2), then slice, dice, binary at the base size, then the same at 11px only below 400px wide", () => {
    const names = (w: number) => treemapChoice(FLAT_SPEC, BLS, w).candidates.map((c) => `${c.tiling}@${c.size}`);
    expect(names(920)).toEqual(ALL(14));
    expect(names(400)).toEqual(ALL(12));
    expect(names(399)).toEqual([...ALL(12), ...ALL(11)]);
  });

  it("grouped: squarified blocks at 600px and wider; below, the same six arrangements at the base size, then at 11px below 400px", () => {
    const names = (w: number) => treemapChoice(GROUPED_SPEC, GROUPED, w).candidates.map((c) => `${c.tiling}@${c.size}`);
    expect(names(920)).toEqual(["squarify@14"]);
    expect(names(600)).toEqual(["squarify@14"]);
    expect(names(599)).toEqual(ALL(12));
    expect(names(399)).toEqual([...ALL(12), ...ALL(11)]);
  });

  it("pickCandidate: squarify unless another tiling labels at least 2 more at the same size; 11px only when it labels more", () => {
    const at = (size: number, counts: number[]) =>
      (["squarify-1", "squarify", "squarify-2", "slice", "dice", "binary"] as const).map((tiling, i) => ({ tiling, size, labelled: counts[i]! }));
    // +1 is not enough: the best squarify variant (the first of the tied maxima) wins.
    expect(pickCandidate([...at(12, [3, 4, 3, 5, 1, 4])])).toBe(1);
    expect(pickCandidate([...at(12, [4, 4, 3, 5, 1, 4])])).toBe(0);
    // +2 is: the first of the other tilings with the most.
    expect(pickCandidate([...at(12, [3, 4, 3, 6, 1, 4])])).toBe(3);
    expect(pickCandidate([...at(12, [3, 3, 3, 5, 1, 5])])).toBe(3);
    expect(pickCandidate([...at(12, [3, 3, 3, 4, 1, 5])])).toBe(5);
    // The 11px step wins only by labelling more than the base step's winner.
    expect(pickCandidate([...at(12, [5, 4, 3, 6, 1, 4]), ...at(11, [5, 5, 5, 6, 1, 6])])).toBe(0);
    expect(pickCandidate([...at(12, [5, 4, 3, 6, 1, 4]), ...at(11, [5, 6, 5, 6, 1, 6])])).toBe(7);
    // ... and the 11px step applies the same margin within itself.
    expect(pickCandidate([...at(12, [1, 1, 1, 2, 1, 1]), ...at(11, [3, 3, 3, 5, 1, 4])])).toBe(9);
  });

  it("rows win when they label at least 2 more than every squarify variant: seven equal tiles at 280", () => {
    const seven = rowsOf(["Housing", "Transportation", "Food at home", "Health insurance", "Entertainment", "Apparel", "Education"]
      .map((n): [string, number] => [n, 1000]));
    const choice = treemapChoice(FLAT_SPEC, seven, 280);
    const chosen = choice.candidates[choice.chosen]!;
    expect(chosen).toMatchObject({ tiling: "slice", size: 12, labelled: 7 });
    expect(Math.max(...choice.candidates.filter((c) => c.size === 12 && SQ.includes(c.tiling)).map((c) => c.labelled))).toBeLessThanOrEqual(5);
  });

  it("the squarify variants are each exercised: ratio 1 and ratio 2 win where they label more than d3's default", () => {
    // BLS flat at 920: ratio 1 labels 9, the default 7, ratio 2 9 (ratio 1 is earlier).
    const flat = treemapChoice(FLAT_SPEC, BLS, 920);
    expect(flat.candidates.slice(0, 3).map((c) => c.labelled)).toEqual([9, 7, 9]);
    expect(flat.candidates[flat.chosen]!.tiling).toBe("squarify-1");
    // Grouped at 560 (blocks arranged): ratio 2 labels 9, the others 8.
    const grouped = treemapChoice(GROUPED_SPEC, GROUPED, 560);
    expect(grouped.candidates.slice(0, 3).map((c) => c.labelled)).toEqual([8, 8, 9]);
    expect(grouped.candidates[grouped.chosen]!.tiling).toBe("squarify-2");
  });

  it("demo 24 (22 grants) at 375: every squarify variant labels 3 and the balanced split 6, so the split is drawn", () => {
    const grants = rowsOf([["Medicaid", 650], ["Highway Planning", 293], ["Title I Education", 184], ["SNAP Administration", 132],
      ["TANF", 102], ["CHIP", 83], ["Special Education", 69], ["Child Nutrition", 59], ["Public Housing Operating", 52],
      ["Section 8 Vouchers", 46], ["Transit Formula", 41], ["Community Development", 37], ["Head Start", 34], ["WIC", 31],
      ["LIHEAP", 29], ["Child Care Block Grant", 27], ["Foster Care", 25], ["Vocational Rehabilitation", 23],
      ["Airport Improvement", 22], ["Homeland Security Grants", 21], ["Clean Water Revolving", 20], ["Drinking Water Revolving", 19]]);
    const choice = treemapChoice({ ...FLAT_SPEC, value_format: { prefix: "$", suffix: "m" } } as ChartSpec, grants, 375);
    expect(choice.candidates.map((c) => `${c.tiling}@${c.size}:${c.labelled}`)).toEqual([
      "squarify-1@12:3", "squarify@12:3", "squarify-2@12:3", "slice@12:3", "dice@12:1", "binary@12:6",
      "squarify-1@11:3", "squarify@11:3", "squarify-2@11:3", "slice@11:3", "dice@11:1", "binary@11:6",
    ]);
    expect(choice.candidates[choice.chosen]).toMatchObject({ tiling: "binary", size: 12 });
  });

  it("scores labelled tiles alone, and counts what is drawn", () => {
    for (const [spec, rows, w] of [[GROUPED_SPEC, GROUPED, 375], [GROUPED_SPEC, GROUPED, 920], [FLAT_SPEC, BLS, 340]] as const) {
      const choice = treemapChoice(spec, rows, w);
      for (const c of choice.candidates) expect(Object.keys(c).sort()).toEqual(["labelled", "size", "tiling"]);
      expect(choice.chosen).toBe(expectedChoice(choice.candidates));
      const chosen = choice.candidates[choice.chosen]!;
      const { svg } = render(spec, rows, w);
      expect(labelledCount(svg)).toBe(chosen.labelled);
    }
  });

  it("BLS at 280 and 340 labels far more than the one tile squarify@12 manages", () => {
    for (const [w, want] of [[280, { tiling: "squarify-1", size: 11, labelled: 5 }], [340, { tiling: "squarify", size: 11, labelled: 7 }]] as const) {
      const choice = treemapChoice(FLAT_SPEC, BLS, w);
      expect(choice.candidates.find((c) => c.tiling === "squarify" && c.size === 12)!.labelled).toBe(1);
      const chosen = choice.candidates[choice.chosen]!;
      expect(chosen).toMatchObject(want);
      const { svg } = render(FLAT_SPEC, BLS, w);
      expect(labelledCount(svg)).toBe(chosen.labelled);
      expect(labelSizes(svg)).toEqual(new Set([String(chosen.size)]));
    }
  });

  it("a wide chart keeps a squarify variant at 14px, flat or grouped", () => {
    for (const [spec, rows] of [[FLAT_SPEC, BLS], [GROUPED_SPEC, GROUPED]] as const) {
      const choice = treemapChoice(spec, rows, 920);
      expect(SQ).toContain(choice.candidates[choice.chosen]!.tiling);
      expect(choice.candidates[choice.chosen]!.size).toBe(14);
    }
  });

  it("ties go to the earlier candidate: every candidate labels every tile, squarify wins", () => {
    const choice = treemapChoice(FLAT_SPEC, rowsOf([["Alpha", 5], ["Beta", 4], ["Gamma", 3]]), 920);
    expect(choice.candidates.map((c) => c.labelled)).toEqual([3, 3, 3, 3, 3, 3]);
    expect(choice.chosen).toBe(0);
    expect(choice.candidates[0]!.tiling).toBe("squarify-1");
    // Grouped, below 600px: two large groups, each tile labelled under every arrangement.
    const two = ([["A", "a1", 300], ["A", "a2", 200], ["B", "b1", 250], ["B", "b2", 150]] as const)
      .map(([group, category, amount]) => ({ group, category, amount: String(amount) }) as TidyRow);
    const g = treemapChoice(GROUPED_SPEC, two, 560);
    expect(g.candidates.map((c) => c.labelled)).toEqual([4, 4, 4, 4, 4, 4]);
    expect(g.chosen).toBe(0);
  });

  it("property: the chosen candidate follows the squarify-first rule, drawn at one size (150 charts)", () => {
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
      expect(choice.chosen).toBe(expectedChoice(choice.candidates));
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
      expect(document.querySelector(".tbl-tooltip .tbl-tooltip-head")!.textContent).toBe("__proto__ one · __proto__");

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
