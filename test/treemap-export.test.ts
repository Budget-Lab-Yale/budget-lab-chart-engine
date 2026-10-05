// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildExportSvg } from "../src/embed/export-png";
import { renderTreemap, treemapHeight, TREEMAP_CLASS } from "../src/engine/marks/treemap";
import { treemapAreaHeight } from "../src/engine/treemap-layout";
import { INNER_W, MARGIN } from "../src/embed/figure-chrome";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const SPEC = {
  chartType: "treemap", title: "Outlays", xAxisType: "categorical", data: "d.csv", source: "The Budget Lab",
  columns: { x: "category", value: "amount" },
} as ChartSpec;
const rowsOf = (pairs: Array<[string, number]>): TidyRow[] =>
  pairs.map(([category, amount]) => ({ category, amount: String(amount) }) as TidyRow);
const BIG = rowsOf([["Alpha", 500], ["Beta", 300], ["Gamma", 150], ["Delta", 50]]);
// Many tiny tiles, unlabelled at the export width.
const TINY = rowsOf([["Big", 1_000_000], ...Array.from({ length: 12 }, (_, i): [string, number] => [`Tiny category ${i}`, 1])]);
const inner = (svg: SVGSVGElement) => svg.querySelector<SVGSVGElement>(`svg.${TREEMAP_CLASS}`)!;
const frameH = (svg: SVGSVGElement) => Number(svg.getAttribute("height"));

describe("treemap export", () => {
  it("re-renders the same tiles and labels as a direct renderTreemap at the export width", () => {
    for (const rows of [BIG, TINY]) {
      const direct = renderTreemap(SPEC, rows, { width: INNER_W }).svg;
      const exported = inner(buildExportSvg(SPEC, rows));
      expect(exported).not.toBeNull();
      expect(exported.innerHTML).toBe(direct.innerHTML);
      expect(exported.getAttribute("viewBox")).toBe(direct.getAttribute("viewBox"));
    }
    expect(inner(buildExportSvg(SPEC, TINY)).querySelectorAll("text.tbl-treemap-label").length).toBeLessThan(TINY.length);
  });

  it("re-renders grouped data the same way", () => {
    const spec = { ...SPEC, columns: { x: "category", value: "amount", series: "group" } } as ChartSpec;
    const rows = [["A", "Alpha", 120], ["A", "Beta", 80], ...Array.from({ length: 10 }, (_, i) => ["Other misc items", `Category number ${i}`, 1.5])]
      .map(([group, category, amount]) => ({ group, category, amount: String(amount) }) as TidyRow);
    const direct = renderTreemap(spec, rows, { width: INNER_W }).svg;
    const exported = inner(buildExportSvg(spec, rows));
    expect(exported.innerHTML).toBe(direct.innerHTML);
    expect(exported.querySelectorAll("g[data-series]")).toHaveLength(rows.length);
  });

  it("keeps the 1000px frame, places the treemap at the margin at full inner width, and draws no legend", () => {
    const svg = buildExportSvg(SPEC, BIG);
    expect(svg.getAttribute("width")).toBe("1000");
    const t = inner(svg);
    expect(t.getAttribute("x")).toBe(String(MARGIN));
    expect(t.getAttribute("width")).toBe(String(INNER_W));
    expect(MARGIN * 2 + INNER_W).toBe(1000);
    expect(svg.querySelector("[class*=legend]")).toBeNull();
  });

  it("sizes the frame to the treemap area alone, whatever is unlabelled, at a whole-pixel height", () => {
    const small = buildExportSvg(SPEC, BIG);
    const tiny = buildExportSvg(SPEC, TINY);
    expect(treemapHeight(INNER_W)).toBe(treemapAreaHeight(INNER_W));
    expect(frameH(tiny)).toBe(frameH(small));
    // The frame holds the whole chart: nothing is cropped at the bottom.
    for (const svg of [small, tiny]) {
      expect(Number(inner(svg).getAttribute("height"))).toBe(treemapAreaHeight(INNER_W));
      expect(frameH(svg)).toBeGreaterThanOrEqual(Number(inner(svg).getAttribute("y")) + Math.ceil(treemapAreaHeight(INNER_W)));
      expect(Number.isInteger(frameH(svg))).toBe(true);
    }
  });

  it("does not move another chart type's export", () => {
    const bar = { chartType: "bar", title: "B", xAxisType: "categorical", data: "d.csv", columns: { x: "category", value: "amount" } } as ChartSpec;
    const svg = buildExportSvg(bar, BIG);
    expect(svg.getAttribute("height")).toBe("750");
    expect(svg.querySelector(`svg.${TREEMAP_CLASS}`)).toBeNull();
  });
});
