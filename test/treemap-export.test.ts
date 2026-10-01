// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildExportSvg } from "../src/embed/export-png";
import { renderTreemap, treemapHeight, TREEMAP_CLASS } from "../src/engine/marks/treemap";
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
// Many tiny tiles: unlabelled in the treemap, listed in the key, so the key grows the height.
const KEYED = rowsOf([["Big", 1_000_000], ...Array.from({ length: 12 }, (_, i): [string, number] => [`Tiny category ${i}`, 1])]);
const inner = (svg: SVGSVGElement) => svg.querySelector<SVGSVGElement>(`svg.${TREEMAP_CLASS}`)!;
const frameH = (svg: SVGSVGElement) => Number(svg.getAttribute("height"));

describe("treemap export", () => {
  it("re-renders the same tiles, labels and key as a direct renderTreemap at the export width", () => {
    for (const rows of [BIG, KEYED]) {
      const direct = renderTreemap(SPEC, rows, { width: INNER_W }).svg;
      const exported = inner(buildExportSvg(SPEC, rows));
      expect(exported).not.toBeNull();
      expect(exported.innerHTML).toBe(direct.innerHTML);
      expect(exported.getAttribute("viewBox")).toBe(direct.getAttribute("viewBox"));
    }
    expect(inner(buildExportSvg(SPEC, KEYED)).querySelectorAll("text.tbl-treemap-key").length).toBeGreaterThan(0);
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

  it("sizes the frame to the content: height grows with the key and uses a whole-pixel chart height", () => {
    const small = buildExportSvg(SPEC, BIG);
    const keyed = buildExportSvg(SPEC, KEYED);
    expect(treemapHeight(SPEC, KEYED, INNER_W)).toBeGreaterThan(treemapHeight(SPEC, BIG, INNER_W));
    expect(frameH(keyed) - frameH(small)).toBeGreaterThan(0);
    // The frame holds the whole chart: nothing is cropped at the bottom.
    for (const [svg, rows] of [[small, BIG], [keyed, KEYED]] as const) {
      const bottom = Number(inner(svg).getAttribute("y")) + Math.ceil(treemapHeight(SPEC, rows, INNER_W));
      expect(frameH(svg)).toBeGreaterThanOrEqual(bottom);
      expect(Number.isInteger(frameH(svg))).toBe(true);
    }
  });

  it("sizes the frame from the chart height rounded up to a whole pixel (heights at 920 are already whole today)", () => {
    // Same chrome for both, so the frames differ by exactly the difference of the ceilinged heights.
    const hB = treemapHeight(SPEC, BIG, INNER_W);
    const hK = treemapHeight(SPEC, KEYED, INNER_W);
    expect(frameH(buildExportSvg(SPEC, KEYED)) - frameH(buildExportSvg(SPEC, BIG))).toBe(Math.ceil(hK) - Math.ceil(hB));
  });

  it("does not move another chart type's export", () => {
    const bar = { chartType: "bar", title: "B", xAxisType: "categorical", data: "d.csv", columns: { x: "category", value: "amount" } } as ChartSpec;
    const svg = buildExportSvg(bar, BIG);
    expect(svg.getAttribute("height")).toBe("750");
    expect(svg.querySelector(`svg.${TREEMAP_CLASS}`)).toBeNull();
  });
});
