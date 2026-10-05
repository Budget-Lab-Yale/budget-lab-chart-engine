// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderChart } from "../src/engine/index";
import { mountChart } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import { TREEMAP_CLASS, treemapChoice, treemapHeight, treemapWarnings } from "../src/engine/marks/treemap";
import { treemapAreaHeight, TM_GEOM } from "../src/engine/treemap-layout";
import { contrastText, fitTileLabel, stripFill, treemapStripHeight } from "../src/engine/treemap-labels";
import { timelineTextWidth } from "../src/engine/timeline-text";
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

  it.each([375, 720, 920])("keeps every tile and strip inside the treemap area at %ipx", (w) => {
    for (const [spec, rows] of [[FLAT_SPEC, BLS], [GROUPED_SPEC, GROUPED]] as const) {
      const { svg } = render(spec, rows, w);
      const areaH = treemapAreaHeight(w);
      for (const r of q(svg, "rect.tbl-treemap-tile, rect.tbl-treemap-strip")) {
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
        // Every text is drawn on the treemap: a tile label, a strip label or a group label.
        for (const t of q(svg, "text")) {
          expect(["tbl-treemap-label", "tbl-treemap-strip-label", "tbl-treemap-group-label"]).toContain(t.getAttribute("class"));
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

  it("draws a header strip per group that fits, in the group's 700 tier with contrast text", () => {
    const { svg, colors } = render(GROUPED_SPEC, GROUPED);
    const strips = q(svg, "rect.tbl-treemap-strip");
    expect(strips.map((s) => s.getAttribute("data-series"))).toEqual(["Mandatory", "Discretionary", "Net interest"]);
    const labels = q(svg, "text.tbl-treemap-strip-label");
    strips.forEach((s, i) => {
      const fill = stripFill(colors.get(s.getAttribute("data-series")!)!);
      expect(s.getAttribute("fill")).toBe(fill);
      expect(labels[i]!.getAttribute("fill")).toBe(contrastText(fill));
      expect(num(labels[i]!, "x")).toBe(num(s, "x") + TM_GEOM.stripPad);
    });
    expect(colors.get("Mandatory")).toBe(tokens.categorical[0]!.base);
    expect(strips[0]!.getAttribute("fill")).toBe(tokens.scales.blue["700"]);
    expect([...labels[0]!.children].map((s) => [s.textContent, num(s, "font-weight")])).toEqual([["Mandatory", 700], [" 58.9%", 500]]);
  });

  it("draws strip text at the tile label size, in a strip that grows with it: 26px at 14px, 22px at 12px", () => {
    for (const [w, size, stripH] of [[920, 14, 26], [600, 14, 26], [599, 12, 22], [375, 12, 22]] as const) {
      const { svg } = render(GROUPED_SPEC, GROUPED, w);
      const strips = q(svg, "rect.tbl-treemap-strip");
      expect(strips.length).toBeGreaterThan(0);
      for (const s of strips) expect(num(s, "height")).toBe(stripH);
      expect(treemapStripHeight(size)).toBe(stripH);
      const labels = q(svg, "text.tbl-treemap-strip-label");
      expect(labels).toHaveLength(strips.length);
      labels.forEach((l, i) => {
        expect(num(l, "font-size")).toBe(size);
        // The baseline centres the cap height (0.7 em) in the strip.
        expect(num(l, "y")).toBeCloseTo(num(strips[i]!, "y") + stripH / 2 + 0.35 * size, 1);
        // The name fits the strip at that size (measured as drawn: name 700, share 500).
        const [name, share] = [...l.children].map((c) => c.textContent ?? "");
        const width = timelineTextWidth(name!, size, 700) + (share ? timelineTextWidth(share, size, 500) : 0);
        expect(width).toBeLessThanOrEqual(num(strips[i]!, "width") - 2 * TM_GEOM.stripPad);
      });
      // Tiles of a strip group start below its strip.
      for (const s of strips) {
        const top = Math.min(...q(svg, `g[data-series="${s.getAttribute("data-series")}"] rect`).map((r) => num(r, "y")));
        expect(top).toBeGreaterThanOrEqual(num(s, "y") + stripH - 0.01);
      }
    }
  });

  it("at 920 a block 44-52px tall has no strip: the floor is two of its 26px strips", () => {
    const g = (rows: Array<[string, string, number]>) => rows.map(([group, category, amount]) => ({ group, category, amount: String(amount) }) as TidyRow);
    // A takes a left column; C and B share the right one, B a band at its bottom about 48px tall.
    const { svg } = render(GROUPED_SPEC, g([["A", "a1", 800], ["C", "c1", 176], ["B", "b1", 24]]), 920);
    const b = q(svg, 'g[data-series="B"] rect')[0]!;
    expect(num(b, "height")).toBeGreaterThan(44);
    expect(num(b, "height")).toBeLessThan(52);
    expect(q(svg, "rect.tbl-treemap-strip").map((s) => s.getAttribute("data-series"))).toEqual(["A", "C"]);
  });

  it("re-tiles a group whose largest tile cannot hold its label: full-width rows inside the same block, every tile labelled", () => {
    // Squarified, A's largest tile is a 126px-wide cell, too narrow for "Intergovernmental" at 14px,
    // so the whole group would go unlabelled. Sliced into rows, every tile fits.
    const rows = [["A", "Intergovernmental transfers", 13], ...Array.from({ length: 6 }, (_, i) => ["A", `a${i}`, 12]),
      ["B", "Big", 90], ["C", "Mid", 40]].map(([group, category, amount]) => ({ group, category, amount: String(amount) }) as TidyRow);
    const { svg } = render(GROUPED_SPEC, rows, 920);
    const strip = q(svg, "rect.tbl-treemap-strip").find((s) => s.getAttribute("data-series") === "A")!;
    const a = q<SVGGElement>(svg, 'g[data-series="A"]');
    expect(a.map((g) => g.getAttribute("aria-label")!.split(", ")[0])).toEqual(
      ["A · Intergovernmental transfers", ...Array.from({ length: 6 }, (_, i) => `A · a${i}`)]);
    let top = num(strip, "y") + num(strip, "height");
    for (const g of a) {
      const r = g.querySelector("rect")!;
      expect(g.querySelector("text")).not.toBeNull();
      expect([num(r, "x"), num(r, "width")]).toEqual([num(strip, "x"), num(strip, "width")]);
      expect(num(r, "y")).toBeCloseTo(top, 1);
      top = num(r, "y") + num(r, "height") + TM_GEOM.tileGutter;
    }
    // The rows fill the block to the bottom of the area, and their heights follow value (less gutters).
    expect(top - TM_GEOM.tileGutter).toBeCloseTo(treemapAreaHeight(920), 1);
    const h = (g: SVGGElement): number => num(g.querySelector("rect")!, "height") + TM_GEOM.tileGutter;
    expect(h(a[0]!) / h(a[1]!)).toBeCloseTo(13 / 12, 2);
  });

  describe("a group with no labelled tile", () => {
    const g = (rows: Array<[string, string, number]>) => rows.map(([group, category, amount]) => ({ group, category, amount: String(amount) }) as TidyRow);
    const many = (group: string, n: number, value: number): Array<[string, string, number]> =>
      Array.from({ length: n }, (_, i) => [group, `Category number ${i}`, value]);
    const groupLabels = (svg: SVGSVGElement) => q(svg, "text.tbl-treemap-group-label");
    /** A group's block: the union of its tiles (the outermost tiles reach the block's edges). */
    const blockOf = (svg: SVGSVGElement, group: string) => {
      const rs = q(svg, `g[data-series="${group}"] rect`);
      return { x0: Math.min(...rs.map((r) => num(r, "x"))), y0: Math.min(...rs.map((r) => num(r, "y"))),
        x1: Math.max(...rs.map((r) => num(r, "x") + num(r, "width"))), y1: Math.max(...rs.map((r) => num(r, "y") + num(r, "height"))) };
    };

    it("and no strip is named in its block's top-left: name 700 + share 500 at the label size, contrast on its base colour", () => {
      // At 280px B is a full-width band under 44px tall (no strip) of eight tiles too narrow to label.
      const spec = { ...GROUPED_SPEC, series_order: ["A", "B"] } as ChartSpec;
      const { svg, colors } = render(spec, g([["A", "a1", 50], ["A", "a2", 40], ...many("B", 8, 1.25)]), 280);
      expect(q(svg, "rect.tbl-treemap-strip").map((s) => s.getAttribute("data-series"))).toEqual(["A"]);
      expect(q(svg, 'g[data-series="B"] text')).toHaveLength(0);
      const labels = groupLabels(svg);
      expect(labels).toHaveLength(1);
      const l = labels[0]!;
      const b = blockOf(svg, "B");
      const fit = fitTileLabel("B", "10.0%", b.x1 - b.x0, b.y1 - b.y0, 12);
      expect(fit.mode).toBe("inline");
      expect([...l.children].map((s) => [s.textContent, num(s, "font-weight")])).toEqual([["B", 700], [" 10.0%", 500]]);
      expect(num(l, "font-size")).toBe(12);
      expect(num(l, "x")).toBeCloseTo(b.x0 + TM_GEOM.pad, 1);
      expect(num(l, "y")).toBeCloseTo(b.y0 + TM_GEOM.pad + (12 * 1.2) / 2 + 0.35 * 12, 1);
      expect(l.getAttribute("fill")).toBe(contrastText(colors.get("B")!));
      expect(colors.get("B")).toBe(tokens.categorical[1]!.base);
      expect(l.getAttribute("aria-hidden")).toBe("true");
      // Hover passes through it to the tiles underneath.
      expect(l.getAttribute("pointer-events")).toBe("none");
      // Drawn above the tiles.
      expect(q(svg, "g[role=img]").every((t) => t.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    });

    it("stacks the name, wrapped, above the share where the block is narrow and tall", () => {
      // A 64px column: "Other misc items" does not fit across a strip, so it has none, but wraps in the block.
      const { svg } = render(GROUPED_SPEC, g([["A", "Alpha", 120], ["A", "Beta", 80], ...many("Other misc items", 10, 1.5)]), 920);
      expect(q(svg, "rect.tbl-treemap-strip").map((s) => s.getAttribute("data-series"))).toEqual(["A"]);
      const l = groupLabels(svg);
      expect(l).toHaveLength(1);
      expect([...l[0]!.children].map((s) => [s.textContent, num(s, "font-weight"), num(s, "font-size")]))
        .toEqual([["Other", 700, 14], ["misc", 700, 14], ["items", 700, 14], ["7.0%", 500, 14]]);
      const b = blockOf(svg, "Other misc items");
      for (const s of l[0]!.children) expect(num(s, "x")).toBeCloseTo(b.x0 + TM_GEOM.pad, 1);
    });

    it("names the group by its series_labels label", () => {
      const spec = { ...GROUPED_SPEC, series_order: ["A", "B"], series_labels: { B: "Bravo" } } as ChartSpec;
      const { svg } = render(spec, g([["A", "a1", 50], ["A", "a2", 40], ...many("B", 8, 1.25)]), 280);
      expect(groupLabels(svg)[0]!.firstElementChild!.textContent).toBe("Bravo");
    });

    it("draws nothing more when the group has a strip: the strip already names it", () => {
      const { svg } = render(GROUPED_SPEC, g([["A", "Alpha", 100], ...many("B", 30, 1)]), 920);
      expect(q(svg, "rect.tbl-treemap-strip").map((s) => s.getAttribute("data-series"))).toEqual(["A", "B"]);
      expect(q(svg, 'g[data-series="B"] text')).toHaveLength(0);
      expect(groupLabels(svg)).toHaveLength(0);
    });

    it("draws nothing when a tile in the group is labelled, or when the name does not fit the block", () => {
      // B's one tile labels itself.
      const one = render(GROUPED_SPEC, g([["A", "a1", 50], ["A", "a2", 40], ["B", "b1", 10]]), 280).svg;
      expect(q(one, 'g[data-series="B"] text')).toHaveLength(1);
      expect(groupLabels(one)).toHaveLength(0);
      // A 3% band is far too short for any text.
      const thin = render(GROUPED_SPEC, g([["A", "a1", 50], ["A", "a2", 47], ...many("B", 3, 1)]), 280).svg;
      expect(q(thin, 'g[data-series="B"] text')).toHaveLength(0);
      expect(groupLabels(thin)).toHaveLength(0);
    });
  });

  it("drops the strip of a block under two strips tall, even when its name fits", () => {
    const g = (rows: Array<[string, string, number]>) => rows.map(([group, category, amount]) => ({ group, category, amount: String(amount) }) as TidyRow);
    // At 280px wide the second group is a full-width band: 10% of 350px is 35px (< 44), 15% is 52.5px.
    const short = render(GROUPED_SPEC, g([["A", "a1", 50], ["A", "a2", 40], ["B", "b1", 10]]), 280).svg;
    expect(q(short, "rect.tbl-treemap-strip").map((s) => s.getAttribute("data-series"))).toEqual(["A"]);
    const tall = render(GROUPED_SPEC, g([["A", "a1", 45], ["A", "a2", 40], ["B", "b1", 15]]), 280).svg;
    expect(q(tall, "rect.tbl-treemap-strip").map((s) => s.getAttribute("data-series"))).toEqual(["A", "B"]);
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

  it("draws no legend and returns per-tile hover info in DOM order", () => {
    const res = render(GROUPED_SPEC, GROUPED);
    expect(res.legendItems).toBeNull();
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

  it("offers squarify, slice, dice, binary at the base size, then the same at 11px only below 400px wide", () => {
    const names = (w: number) => treemapChoice(FLAT_SPEC, BLS, w).candidates.map((c) => `${c.tiling}@${c.size}`);
    expect(names(920)).toEqual(["squarify@14", "slice@14", "dice@14", "binary@14"]);
    expect(names(400)).toEqual(["squarify@12", "slice@12", "dice@12", "binary@12"]);
    expect(names(399)).toEqual(["squarify@12", "slice@12", "dice@12", "binary@12", "squarify@11", "slice@11", "dice@11", "binary@11"]);
    // Grouped charts keep their group blocks: they take part in the size step only.
    expect(treemapChoice(GROUPED_SPEC, GROUPED, 920).candidates.map((c) => `${c.tiling}@${c.size}`)).toEqual(["squarify@14"]);
    expect(treemapChoice(GROUPED_SPEC, GROUPED, 375).candidates.map((c) => `${c.tiling}@${c.size}`)).toEqual(["squarify@12", "squarify@11"]);
  });

  it("BLS at 280 and 340 labels far more than the one tile squarify@12 manages", () => {
    for (const [w, want] of [[280, { tiling: "squarify", size: 11, labelled: 5 }], [340, { tiling: "squarify", size: 11, labelled: 7 }]] as const) {
      const choice = treemapChoice(FLAT_SPEC, BLS, w);
      expect(choice.candidates[0]!.labelled).toBe(1);
      const chosen = choice.candidates[choice.chosen]!;
      expect(chosen).toEqual(want);
      const { svg } = render(FLAT_SPEC, BLS, w);
      expect(labelledCount(svg)).toBe(chosen.labelled);
      expect(labelSizes(svg)).toEqual(new Set([String(chosen.size)]));
    }
  });

  it("a wide chart keeps squarify at 14px", () => {
    for (const [spec, rows] of [[FLAT_SPEC, BLS], [GROUPED_SPEC, GROUPED]] as const) {
      const choice = treemapChoice(spec, rows, 920);
      expect(choice.chosen).toBe(0);
      expect(choice.candidates[0]).toMatchObject({ tiling: "squarify", size: 14 });
    }
  });

  it("ties go to the earlier candidate: every candidate labels all three tiles, squarify wins", () => {
    const choice = treemapChoice(FLAT_SPEC, rowsOf([["Alpha", 5], ["Beta", 4], ["Gamma", 3]]), 920);
    expect(choice.candidates.map((c) => c.labelled)).toEqual([3, 3, 3, 3]);
    expect(choice.chosen).toBe(0);
  });

  it("property: the chosen candidate is the first with the most labelled tiles, and the chart draws it at one size (150 charts)", () => {
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
      const chosen = choice.candidates[choice.chosen]!;
      picked.add(`${chosen.tiling}@${chosen.size === 11 ? 11 : "base"}`);
      if (chosen.size === 11) expect(w).toBeLessThan(400);
      const { svg } = render(spec, rows, w);
      expect(labelledCount(svg)).toBe(chosen.labelled);
      const sizes = labelSizes(svg);
      expect(sizes.size).toBeLessThanOrEqual(1);
      for (const size of sizes) expect(size).toBe(String(chosen.size));
      // Strip text, when there is any, is the same one size.
      for (const st of q(svg, "text.tbl-treemap-strip-label")) expect(st.getAttribute("font-size")).toBe(String(chosen.size));
    }
    // More than squarify at the base size gets chosen across these charts.
    expect(picked.size).toBeGreaterThan(2);
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
  // must not find the inherited property. Each group is large enough for its strip at 920.
  const PROTO = ["constructor", "toString", "__proto__"];
  const protoRows = PROTO.flatMap((group, i) => [
    { group, category: `${group} one`, amount: String(300 - 10 * i) },
    { group, category: `${group} two`, amount: String(200 - 10 * i) },
  ]) as TidyRow[];
  const SPEC = { ...FLAT_SPEC, columns: { x: "category", value: "amount", series: "group" } } as ChartSpec;
  const stripNames = (svg: SVGSVGElement): string[] =>
    q(svg, "text.tbl-treemap-strip-label").map((t) => t.firstElementChild!.textContent ?? "");
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
      expect(new Set(stripNames(svg))).toEqual(new Set(want));
      expect(q(svg, "rect.tbl-treemap-strip").map((r) => r.getAttribute("fill"))).not.toContain(null);
      for (const f of q(svg, "rect.tbl-treemap-tile").map((r) => r.getAttribute("fill")!)) expect(f).toMatch(/^#[0-9A-F]{6}$/i);
      if (spec.series_colors) {
        expect(q(svg, "rect.tbl-treemap-strip").find((r) => r.getAttribute("data-series") === "constructor")!.getAttribute("fill"))
          .toBe(tokens.scales.green["700"]);
      }
      expect(tileOf(svg, "toString one").getAttribute("aria-label")).toMatch(new RegExp(`^${want[1]} · toString one, `));

      document.body.innerHTML = "";
      const host = document.createElement("div");
      document.body.append(host);
      mountChart(host, { spec, rows: protoRows, width: 920 });
      const live = host.querySelector<SVGSVGElement>("svg.tbl-treemap")!;
      expect(new Set(stripNames(live))).toEqual(new Set(want));
      tileOf(live, "__proto__ one").dispatchEvent(new PointerEvent("pointerenter", { clientX: 10, clientY: 10 }));
      expect(document.querySelector(".tbl-tooltip .tbl-tooltip-head")!.textContent).toBe("__proto__ · __proto__ one");

      const exported = buildExportSvg(spec, protoRows).querySelector<SVGSVGElement>(`svg.${TREEMAP_CLASS}`)!;
      expect(new Set(stripNames(exported))).toEqual(new Set(want));

      expect(treemapWarnings(spec, protoRows)).toEqual([]);
    });
  }

  it("an own __proto__ key in series_labels (as JSON or YAML parsing makes one) renames that group", () => {
    const spec = { ...SPEC, series_labels: JSON.parse('{"__proto__": "Proto group"}') } as ChartSpec;
    expect(Object.hasOwn(spec.series_labels!, "__proto__")).toBe(true);
    const { svg } = renderChart(spec, protoRows, { width: 920 });
    expect(new Set(stripNames(svg))).toEqual(new Set(["constructor", "toString", "Proto group"]));
  });
});

describe("treemap background", () => {
  it("paints the treemap area white under the tiles and strips, so gutters are white on any host", () => {
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
