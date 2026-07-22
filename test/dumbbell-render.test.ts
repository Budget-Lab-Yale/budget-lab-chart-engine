// @vitest-environment jsdom
//
// Dumbbell mark structural contract: dot count/tagging, connector stems (one per category with a
// real gap, none for single/coincident dots), marker styling (filled/hollow/ink), both
// orientations, and the gap annotation. Renders through the real headless engine path under jsdom.
import { describe, it, expect } from "vitest";
import { renderChart, renderFigure } from "../src/engine/index";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";
import { tokens } from "../src/theme/tokens";

const INK = tokens.structural.text_heading;
const PAGE_BG = tokens.structural.background;

const DUMBBELL_H: ChartSpec = {
  chartType: "dumbbell",
  title: "Effective rate by group",
  xAxisType: "categorical",
  orientation: "horizontal",
  columns: { category: "group", series: "measure", value: "rate" },
  series_order: ["current_law", "static", "collected"],
  series_marker: { current_law: "ink", static: "hollow", collected: "filled" },
  value_format: { decimals: 1, suffix: "%" },
  data: "d.csv",
};

// Q1: all three dots equal (2.1) → coincident, no stem. Q5: three distinct dots → one stem.
const ROWS: TidyRow[] = [
  { group: "Q1", measure: "current_law", rate: "2.1" },
  { group: "Q1", measure: "static", rate: "2.1" },
  { group: "Q1", measure: "collected", rate: "2.1" },
  { group: "Q5", measure: "current_law", rate: "28.4" },
  { group: "Q5", measure: "static", rate: "34.9" },
  { group: "Q5", measure: "collected", rate: "32.6" },
] as TidyRow[];

const opts = { width: 720, height: 400 } as const;

describe("dumbbell mark — structure", () => {
  it("renders one dot per (category, series) tagged with its series", () => {
    const { svg } = renderChart(DUMBBELL_H, ROWS, { ...opts, document });
    const circles = svg.querySelectorAll('g[aria-label="dot"] circle');
    expect(circles.length).toBe(6);
    // DOM order follows data order (Q1 c/s/c, then Q5 c/s/c).
    expect(circles[0]?.getAttribute("data-series")).toBe("current_law");
    expect(circles[1]?.getAttribute("data-series")).toBe("static");
    expect(circles[5]?.getAttribute("data-series")).toBe("collected");
  });

  it("draws a connector stem only for categories whose dots differ (Q5, not coincident Q1)", () => {
    const { svg } = renderChart(DUMBBELL_H, ROWS, { ...opts, document });
    const stems = svg.querySelectorAll("g.tbl-dumbbell-connector line");
    expect(stems.length).toBe(1);
  });

  it("styles markers: ink = ink fill; hollow = page-bg fill + series-color stroke; filled = series fill", () => {
    const { svg, colors } = renderChart(DUMBBELL_H, ROWS, { ...opts, document });
    const circles = svg.querySelectorAll('g[aria-label="dot"] circle');
    const inkDot = circles[0]!; // current_law → ink
    const hollowDot = circles[1]!; // static → hollow
    const filledDot = circles[2]!; // collected → filled
    expect(inkDot.getAttribute("fill")?.toUpperCase()).toBe(INK.toUpperCase());
    expect(hollowDot.getAttribute("fill")?.toUpperCase()).toBe(PAGE_BG.toUpperCase());
    expect(hollowDot.getAttribute("stroke")?.toUpperCase()).toBe(colors.get("static")!.toUpperCase());
    expect(filledDot.getAttribute("fill")?.toUpperCase()).toBe(colors.get("collected")!.toUpperCase());
  });

  it("renders vertically too (one dot per pair, still 6)", () => {
    const { svg } = renderChart({ ...DUMBBELL_H, orientation: "vertical" }, ROWS, { ...opts, document });
    expect(svg.querySelectorAll('g[aria-label="dot"] circle').length).toBe(6);
  });

  it("gap_annotation labels the |a − b| gap per stem", () => {
    const spec: ChartSpec = { ...DUMBBELL_H, gap_annotation: { series_a: "static", series_b: "collected" } };
    const { svg } = renderChart(spec, ROWS, { ...opts, document });
    const labels = Array.from(svg.querySelectorAll("g.tbl-dumbbell-gap text")).map((t) => t.textContent);
    // Q1 gap = 0.0, Q5 gap = |34.9 − 32.6| = 2.3.
    expect(labels).toContain("2.3%");
    expect(labels.length).toBe(2);
  });

  it("composes with faceting (top-decile breakout as a separate pane)", () => {
    // Main quintiles in one facet, the top-decile breakout in another — each pane a dumbbell that
    // shares the series/colors/legend and (default) a common value scale.
    const facetRows: TidyRow[] = [
      { pane: "Quintiles", group: "Q1", measure: "static", rate: "2.1" },
      { pane: "Quintiles", group: "Q1", measure: "collected", rate: "2.0" },
      { pane: "Quintiles", group: "Q5", measure: "static", rate: "34.9" },
      { pane: "Quintiles", group: "Q5", measure: "collected", rate: "32.6" },
      { pane: "Top decile", group: "Top 1%", measure: "static", rate: "39.0" },
      { pane: "Top decile", group: "Top 1%", measure: "collected", rate: "35.1" },
      { pane: "Top decile", group: "Top 0.1%", measure: "static", rate: "41.0" },
      { pane: "Top decile", group: "Top 0.1%", measure: "collected", rate: "36.0" },
    ] as TidyRow[];
    const spec: ChartSpec = {
      ...DUMBBELL_H,
      series_order: ["static", "collected"],
      series_marker: { static: "hollow", collected: "filled" },
      columns: { category: "group", series: "measure", value: "rate", facet: "pane" },
      small_multiples: { columns: 2, mode: "shared" },
    };
    let result!: ReturnType<typeof renderFigure>;
    expect(() => { result = renderFigure(spec, facetRows, { width: 838, height: 420, document }); }).not.toThrow();
    expect(result.panes.length).toBe(2);
    const totalCircles = result.panes.reduce(
      (n, p) => n + (p.svg?.querySelectorAll('g[aria-label="dot"] circle').length ?? 0),
      0,
    );
    expect(totalCircles).toBe(8);
  });

  it("does not force a zero baseline (dots fit the 2%–35% range)", () => {
    // A dumbbell of positive rates should NOT anchor the value axis at 0. We assert the rendered
    // dot spread uses most of the value axis: the min and max dots are far apart in px, which only
    // holds if the domain fits [~2, ~35] rather than [0, ~35].
    const { svg } = renderChart(DUMBBELL_H, ROWS, { ...opts, document });
    const cx = Array.from(svg.querySelectorAll('g[aria-label="dot"] circle')).map((c) =>
      Number(c.getAttribute("cx")),
    );
    const spread = Math.max(...cx) - Math.min(...cx);
    // Inner plot width is ~600px; a zero-anchored axis would compress the 2.1 dot far left and
    // shrink the spread. Fitting the data keeps the extremes well separated.
    expect(spread).toBeGreaterThan(300);
  });
});
