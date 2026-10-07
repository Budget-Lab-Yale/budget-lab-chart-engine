// @vitest-environment jsdom
//
// The zero rule on a HORIZONTAL chart (value axis on x) is drawn only when 0 lies inside the value
// domain, the same gate the vertical path has always had. Before, the horizontal branch drew it
// unconditionally, so a dot plot fitted to 8–31 painted a dark rule at x(0) — off the plot, through
// the category-label gutter. Bars and stacks always include 0 (unless an author truncates them with
// yAxisPolicy.min), so their rule is unchanged.
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import { TBL } from "../src/engine/theme";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const OPTS = { width: 720, height: 400, document } as const;

const DUMBBELL_H: ChartSpec = {
  chartType: "dumbbell",
  title: "t",
  xAxisType: "categorical",
  orientation: "horizontal",
  columns: { category: "group", series: "measure", value: "rate" },
  series_order: ["a", "b"],
  data: "d.csv",
};

const dumbbellRows = (vals: Array<[string, number, number]>, section?: string): TidyRow[] =>
  vals.flatMap(([g, a, b]) => [
    { group: g, measure: "a", rate: String(a), ...(section ? { band: section } : {}) },
    { group: g, measure: "b", rate: String(b), ...(section ? { band: section } : {}) },
  ]) as unknown as TidyRow[];

/** The zero rule is the only chart rule stroked with the axis colour (gridlines use the lighter
 *  gridline colour); Plot hoists a constant stroke onto the mark's <g>. */
const zeroRules = (svg: SVGSVGElement): Element[] =>
  Array.from(svg.querySelectorAll('g[aria-label="rule"]')).filter(
    (g) => g.getAttribute("stroke") === TBL.color.axisStroke,
  );

/** Absolute x of `el` (plus a local offset), accumulating its own and every ancestor translate. */
function absX(el: Element, local = 0): number {
  let x = local;
  let n: Element | null = el;
  while (n && n.tagName.toLowerCase() !== "svg") {
    const m = /translate\(\s*(-?[\d.]+)/.exec(n.getAttribute("transform") ?? "");
    if (m) x += Number(m[1]);
    n = n.parentElement;
  }
  return x;
}

describe("horizontal zero rule — drawn only when 0 is inside the value domain", () => {
  it("a dot plot spanning 8–31 draws no zero rule", () => {
    const { svg } = renderChart(DUMBBELL_H, dumbbellRows([["Q1", 8, 12], ["Q2", 25, 31]]), OPTS);
    // Sanity: the axis really is fitted (no "0" tick), so this is the case under test.
    const ticks = Array.from(svg.querySelectorAll("text")).map((t) => (t.textContent ?? "").trim());
    expect(ticks).not.toContain("0");
    expect(zeroRules(svg)).toHaveLength(0);
  });

  it("a dot plot crossing zero draws one zero rule, at x(0)", () => {
    const { svg } = renderChart(DUMBBELL_H, dumbbellRows([["Q1", -6, -2], ["Q2", 9, 14]]), OPTS);
    const rules = zeroRules(svg);
    expect(rules).toHaveLength(1);
    // It sits at the same x as the "0" value tick label.
    const zeroTick = Array.from(svg.querySelectorAll("text")).find((t) => (t.textContent ?? "").trim() === "0");
    expect(zeroTick).toBeTruthy();
    const rule = rules[0]!;
    const ruleAbsX = absX(rule, Number(rule.querySelector("line")?.getAttribute("x1")));
    expect(Math.abs(ruleAbsX - absX(zeroTick!))).toBeLessThan(1);
  });

  it("horizontal bar and horizontal stacked keep their zero rule (range always includes 0)", () => {
    const bar: ChartSpec = {
      chartType: "bar",
      title: "t",
      xAxisType: "categorical",
      orientation: "horizontal",
      columns: { x: "cat", value: "v" },
      data: "d.csv",
    };
    const barRows = [
      { cat: "A", v: "8" },
      { cat: "B", v: "31" },
    ] as unknown as TidyRow[];
    expect(zeroRules(renderChart(bar, barRows, OPTS).svg)).toHaveLength(1);

    const stacked: ChartSpec = {
      chartType: "stacked",
      title: "t",
      xAxisType: "categorical",
      orientation: "horizontal",
      columns: { x: "cat", series: "s", value: "v" },
      data: "d.csv",
    };
    const stackRows = [
      { cat: "A", s: "x", v: "8" },
      { cat: "A", s: "y", v: "4" },
      { cat: "B", s: "x", v: "20" },
      { cat: "B", s: "y", v: "11" },
    ] as unknown as TidyRow[];
    expect(zeroRules(renderChart(stacked, stackRows, OPTS).svg)).toHaveLength(1);
  });

  // Sectioned horizontal dumbbells live on fy row facets: the zero rule is tagged per facet and the
  // facet-chrome pass (collapseFacetChromeY) collapses + stretches it. With the rule absent that
  // pass must still run cleanly and leave the gridlines intact.
  describe("faceted (fy, sectioned) horizontal chart", () => {
    const SECTIONED: ChartSpec = {
      ...DUMBBELL_H,
      columns: { category: "group", series: "measure", value: "rate", section: "band" },
      section_order: ["Low", "High"],
    };
    const rowsFor = (lo: [number, number], hi: [number, number]): TidyRow[] => [
      ...dumbbellRows([["Q1", lo[0], lo[1]]], "Low"),
      ...dumbbellRows([["Top 1%", hi[0], hi[1]]], "High"),
    ];

    it("range excluding 0: no zero baseline, gridlines still collapsed and drawn", () => {
      const { svg } = renderChart(SECTIONED, rowsFor([8, 12], [25, 31]), OPTS);
      expect(svg.querySelectorAll("g.tbl-zero-baseline")).toHaveLength(0);
      expect(zeroRules(svg)).toHaveLength(0);
      // The gridline group was collapsed to one copy and still holds lines.
      expect(svg.querySelectorAll("g.tbl-gridline")).toHaveLength(1);
      expect(svg.querySelectorAll("g.tbl-gridline line").length).toBeGreaterThan(0);
      expect(svg.querySelectorAll('g[aria-label="dot"] circle')).toHaveLength(4);
    });

    it("range crossing 0: exactly one collapsed zero baseline", () => {
      const { svg } = renderChart(SECTIONED, rowsFor([-6, -2], [9, 14]), OPTS);
      expect(svg.querySelectorAll("g.tbl-zero-baseline")).toHaveLength(1);
    });
  });
});
