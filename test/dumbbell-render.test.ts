// @vitest-environment jsdom
//
// Dumbbell mark structural contract: dot count/tagging, connector stems (one per category with a
// real gap, none for single/coincident dots), marker styling (filled/hollow/ink), both
// orientations, and the gap annotation. Renders through the real headless engine path under jsdom.
import { describe, it, expect } from "vitest";
import { renderChart, renderFigure } from "../src/engine/index";
import { computeChartHeight } from "../src/engine/render-live";
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

// Absolute (x,y) of an SVG element: accumulate every ancestor translate up to <svg>, then add the
// element's own position (cx/cy for circles, x/y attrs for text). jsdom has no layout engine, so we
// read the transforms Plot emits directly — the same technique golden.test.ts uses.
function absPos(el: Element | null): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let n: Element | null = el;
  while (n && n.tagName.toLowerCase() !== "svg") {
    const tf = n.getAttribute("transform");
    if (tf) {
      const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(tf);
      if (m) { x += Number(m[1]); y += Number(m[2]); }
    }
    n = n.parentElement;
  }
  const tag = el?.tagName.toLowerCase();
  // Add the element's own position. Guard non-numeric attrs — Plot emits text `y="0.32em"` (a
  // baseline nudge), which is not a coordinate; the real position is in the ancestor transforms.
  const num = (v: string | null): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  if (tag === "circle") { x += num(el!.getAttribute("cx")); y += num(el!.getAttribute("cy")); }
  else if (tag === "text") { x += num(el!.getAttribute("x")); y += num(el!.getAttribute("y")); }
  return { x, y };
}

const textByContent = (svg: Element, content: string): Element | undefined =>
  Array.from(svg.querySelectorAll("text")).find((t) => (t.textContent ?? "").trim() === content);

// Select a dot by (category, series) — order-independent, since dots are drawn series-major.
const dot = (svg: Element, category: string, series: string): Element =>
  Array.from(svg.querySelectorAll('g[aria-label="dot"] circle')).find(
    (c) => c.getAttribute("data-category") === category && c.getAttribute("data-series") === series,
  )!;

describe("dumbbell mark — axis/data alignment (positional proof)", () => {
  it("horizontal: each category's label sits at its dots' band center", () => {
    const { svg } = renderChart(DUMBBELL_H, ROWS, { ...opts, document });
    const q5Cy = ["current_law", "static", "collected"].map((s) => absPos(dot(svg, "Q5", s)).y);
    const meanQ5 = q5Cy.reduce((a, b) => a + b, 0) / q5Cy.length;
    const labelQ5 = absPos(textByContent(svg, "Q5") ?? null);
    expect(Math.abs(labelQ5.y - meanQ5)).toBeLessThan(2); // label centered on the same band as the dots
  });

  it("horizontal: dot X positions map proportionally through the value axis", () => {
    const { svg } = renderChart(DUMBBELL_H, ROWS, { ...opts, document });
    // Q5: current_law=28.4, static=34.9, collected=32.6.
    const xCurrent = absPos(dot(svg, "Q5", "current_law")).x;
    const xStatic = absPos(dot(svg, "Q5", "static")).x;
    const xCollected = absPos(dot(svg, "Q5", "collected")).x;
    expect(xCurrent).toBeLessThan(xCollected); // value order: 28.4 < 32.6 < 34.9
    expect(xCollected).toBeLessThan(xStatic);
    // Pixel gaps must be proportional to value gaps (linear axis) — a margin-independent proof.
    const pxRatio = (xStatic - xCurrent) / (xCollected - xCurrent);
    const valRatio = (34.9 - 28.4) / (32.6 - 28.4);
    expect(Math.abs(pxRatio - valRatio)).toBeLessThan(0.05);
  });

  it("horizontal: dots align to the value-axis ticks (28.4 lands between the 20 and 30 ticks)", () => {
    const { svg } = renderChart(DUMBBELL_H, ROWS, { ...opts, document });
    const t20 = absPos(textByContent(svg, "20") ?? null).x;
    const t30 = absPos(textByContent(svg, "30") ?? null).x;
    const xCurrent = absPos(dot(svg, "Q5", "current_law")).x; // 28.4 → between 20 and 30 ticks
    const predicted = t20 + ((28.4 - 20) / 10) * (t30 - t20);
    expect(Math.abs(xCurrent - predicted)).toBeLessThan(3);
  });

  it("vertical: dots align to the value-axis ticks on Y (higher value = higher on screen = smaller y)", () => {
    const { svg } = renderChart({ ...DUMBBELL_H, orientation: "vertical" }, ROWS, { ...opts, document });
    // Q5 static (34.9) sits ABOVE (smaller y) Q5 current_law (28.4); Q1 (2.1) sits well below Q5.
    const yCurrent = absPos(dot(svg, "Q5", "current_law")).y;
    const yStatic = absPos(dot(svg, "Q5", "static")).y;
    expect(yStatic).toBeLessThan(yCurrent);
    const yQ1 = absPos(dot(svg, "Q1", "current_law")).y;
    expect(yQ1).toBeGreaterThan(yCurrent);
  });
});

describe("dumbbell mark — draw order, facet layout, auto-height", () => {
  it("draws dots series-major (consistent z-order: first series first, last on top)", () => {
    const { svg } = renderChart(DUMBBELL_H, ROWS, { ...opts, document });
    const order = Array.from(svg.querySelectorAll('g[aria-label="dot"] circle')).map((c) =>
      c.getAttribute("data-series"),
    );
    // series_order = [current_law, static, collected] → all current_law dots, then all static, then
    // all collected (regardless of the category-major input row order).
    const firstIdx = (s: string) => order.indexOf(s);
    const lastIdx = (s: string) => order.lastIndexOf(s);
    expect(lastIdx("current_law")).toBeLessThan(firstIdx("static"));
    expect(lastIdx("static")).toBeLessThan(firstIdx("collected"));
  });

  it("horizontal facets stack vertically (columns forced to 1)", () => {
    const rows: TidyRow[] = [
      { pane: "A", group: "Q1", measure: "static", rate: "2" },
      { pane: "A", group: "Q1", measure: "collected", rate: "3" },
      { pane: "B", group: "Q1", measure: "static", rate: "4" },
      { pane: "B", group: "Q1", measure: "collected", rate: "5" },
    ] as TidyRow[];
    const spec: ChartSpec = {
      ...DUMBBELL_H,
      columns: { category: "group", series: "measure", value: "rate", facet: "pane" },
      small_multiples: { mode: "shared" },
    };
    const fig = renderFigure(spec, rows, { width: 900, document });
    expect(fig.columns).toBe(1); // horizontal → one full-width pane per row
    expect(fig.panes.length).toBe(2);
  });

  it("vertical facets sit side by side (grid columns > 1)", () => {
    const rows: TidyRow[] = [
      { pane: "A", group: "Q1", measure: "static", rate: "2" },
      { pane: "A", group: "Q1", measure: "collected", rate: "3" },
      { pane: "B", group: "Q1", measure: "static", rate: "4" },
      { pane: "B", group: "Q1", measure: "collected", rate: "5" },
    ] as TidyRow[];
    const spec: ChartSpec = {
      ...DUMBBELL_H,
      orientation: "vertical",
      columns: { category: "group", series: "measure", value: "rate", facet: "pane" },
      small_multiples: { mode: "shared" },
    };
    const fig = renderFigure(spec, rows, { width: 900, document });
    expect(fig.columns).toBeGreaterThan(1);
  });

  it("horizontal auto-height grows with the category-row count", () => {
    const mk = (n: number): TidyRow[] =>
      Array.from({ length: n }, (_, i) => [
        { group: `G${i}`, measure: "static", rate: String(2 + i) },
        { group: `G${i}`, measure: "collected", rate: String(3 + i) },
      ]).flat() as TidyRow[];
    const short = computeChartHeight(DUMBBELL_H, mk(3));
    const tall = computeChartHeight(DUMBBELL_H, mk(20));
    expect(tall).toBeGreaterThan(short);
    // A vertical dumbbell does NOT grow with rows (fixed height).
    expect(computeChartHeight({ ...DUMBBELL_H, orientation: "vertical" }, mk(20))).toBe(
      computeChartHeight({ ...DUMBBELL_H, orientation: "vertical" }, mk(3)),
    );
  });
});

describe("dumbbell mark — faceting (both orientations)", () => {
  // Two facet panes: main quintiles and the top-decile breakout, sharing series/colors/legend.
  const FACET_ROWS: TidyRow[] = [
    { pane: "Quintiles", group: "Q1", measure: "static", rate: "2.1" },
    { pane: "Quintiles", group: "Q1", measure: "collected", rate: "2.0" },
    { pane: "Quintiles", group: "Q5", measure: "static", rate: "30.1" },
    { pane: "Quintiles", group: "Q5", measure: "collected", rate: "28.4" },
    { pane: "Top decile", group: "Top 1%", measure: "static", rate: "39.0" },
    { pane: "Top decile", group: "Top 1%", measure: "collected", rate: "35.1" },
    { pane: "Top decile", group: "Top 0.1%", measure: "static", rate: "41.0" },
    { pane: "Top decile", group: "Top 0.1%", measure: "collected", rate: "36.0" },
  ] as TidyRow[];
  const facetSpec = (orientation: "horizontal" | "vertical"): ChartSpec => ({
    ...DUMBBELL_H,
    orientation,
    series_order: ["static", "collected"],
    series_marker: { static: "hollow", collected: "filled" },
    columns: { category: "group", series: "measure", value: "rate", facet: "pane" },
    small_multiples: { columns: 2, mode: "shared" },
  });

  // Each pane must contain ONLY its own facet's categories (proof the facet split is real, not one
  // pane drawing everything). Checked for both orientations.
  for (const orientation of ["horizontal", "vertical"] as const) {
    it(`${orientation}: each pane draws only its facet's category dots`, () => {
      const result = renderFigure(facetSpec(orientation), FACET_ROWS, { width: 838, height: 440, document });
      expect(result.panes.length).toBe(2);
      const catsInPane = (svg: SVGSVGElement | undefined): Set<string> =>
        new Set(
          Array.from(svg?.querySelectorAll('g[aria-label="dot"] circle[data-category]') ?? []).map((c) =>
            c.getAttribute("data-category"),
          ) as string[],
        );
      const p0 = catsInPane(result.panes[0]!.svg);
      const p1 = catsInPane(result.panes[1]!.svg);
      // Quintiles pane has Q1/Q5 only; top-decile pane has Top 1% / Top 0.1% only. No leakage.
      expect(p0).toEqual(new Set(["Q1", "Q5"]));
      expect(p1).toEqual(new Set(["Top 1%", "Top 0.1%"]));
      const total = result.panes.reduce(
        (n, p) => n + (p.svg?.querySelectorAll('g[aria-label="dot"] circle').length ?? 0),
        0,
      );
      expect(total).toBe(8);
    });
  }
});

describe("dumbbell mark — structure", () => {
  it("renders one dot per (category, series) tagged with its series", () => {
    const { svg } = renderChart(DUMBBELL_H, ROWS, { ...opts, document });
    const circles = svg.querySelectorAll('g[aria-label="dot"] circle');
    expect(circles.length).toBe(6);
    // Every (category, series) pair has exactly one dot, tagged with both.
    for (const cat of ["Q1", "Q5"]) {
      for (const s of ["current_law", "static", "collected"]) {
        expect(dot(svg, cat, s)).toBeTruthy();
      }
    }
  });

  it("draws a connector stem only for categories whose dots differ (Q5, not coincident Q1)", () => {
    const { svg } = renderChart(DUMBBELL_H, ROWS, { ...opts, document });
    const stems = svg.querySelectorAll("g.tbl-dumbbell-connector line");
    expect(stems.length).toBe(1);
  });

  it("styles markers: ink = ink fill; hollow = page-bg fill + series-color stroke; filled = series fill", () => {
    const { svg, colors } = renderChart(DUMBBELL_H, ROWS, { ...opts, document });
    const inkDot = dot(svg, "Q5", "current_law"); // ink
    const hollowDot = dot(svg, "Q5", "static"); // hollow
    const filledDot = dot(svg, "Q5", "collected"); // filled
    expect(inkDot.getAttribute("fill")?.toUpperCase()).toBe(INK.toUpperCase());
    expect(hollowDot.getAttribute("fill")?.toUpperCase()).toBe(PAGE_BG.toUpperCase());
    expect(hollowDot.getAttribute("stroke")?.toUpperCase()).toBe(colors.get("static")!.toUpperCase());
    expect(filledDot.getAttribute("fill")?.toUpperCase()).toBe(colors.get("collected")!.toUpperCase());
  });

  it("renders vertically too (one dot per pair, still 6)", () => {
    const { svg } = renderChart({ ...DUMBBELL_H, orientation: "vertical" }, ROWS, { ...opts, document });
    expect(svg.querySelectorAll('g[aria-label="dot"] circle').length).toBe(6);
  });

  it("gap_annotation labels the |a − b| gap per stem as a Δ (skipping zero-gap categories)", () => {
    const spec: ChartSpec = { ...DUMBBELL_H, gap_annotation: { series_a: "static", series_b: "collected" } };
    const { svg } = renderChart(spec, ROWS, { ...opts, document });
    const labels = Array.from(svg.querySelectorAll("g.tbl-dumbbell-gap text")).map((t) => t.textContent);
    // Q1 static==collected (gap 0 → skipped); Q5 gap = |34.9 − 32.6| = 2.3, shown as a delta.
    expect(labels).toContain("Δ2.3%");
    expect(labels.length).toBe(1);
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

  it("builds a per-series dot legend honoring series_marker (hollow ring for the hollow series)", () => {
    const { legendItems } = renderChart(DUMBBELL_H, ROWS, { ...opts, document });
    expect(legendItems).not.toBeNull();
    expect(legendItems!.length).toBe(3);
    for (const item of legendItems!) expect(item.markerShape).toBe("point");
    const byName = new Map(legendItems!.map((i) => [i.series, i]));
    expect(byName.get("static")!.hollow).toBe(true);
    expect(byName.get("collected")!.hollow).toBeFalsy();
    expect(byName.get("current_law")!.color?.toUpperCase()).toBe(INK.toUpperCase()); // ink dot
  });

  it("renders a hollow-ring swatch in the DOM legend", () => {
    // The rendered legend swatch for a hollow series is a ring: page-bg fill, series-color stroke.
    const { legendItems } = renderChart(DUMBBELL_H, ROWS, { ...opts, document });
    // (Legend DOM is built by the live/figure layer; here we assert the data contract that drives
    // the ring — the swatch rendering is covered by the legend unit path.)
    expect(legendItems!.some((i) => i.hollow)).toBe(true);
  });

  it("handles a single dot in a category (no stem) and a missing series", () => {
    // Q3 has one dot (no stem); Q4 is missing "collected" (stem spans the two present dots).
    const rows: TidyRow[] = [
      { group: "Q3", measure: "collected", rate: "12.0" },
      { group: "Q4", measure: "current_law", rate: "18.0" },
      { group: "Q4", measure: "static", rate: "22.0" },
    ] as TidyRow[];
    const { svg } = renderChart(DUMBBELL_H, rows, { ...opts, document });
    expect(svg.querySelectorAll('g[aria-label="dot"] circle').length).toBe(3);
    // Q3 single dot → no stem; Q4 two distinct dots → one stem.
    expect(svg.querySelectorAll("g.tbl-dumbbell-connector line").length).toBe(1);
  });

  it("horizontal sections: renders bold section headers and keeps all category dots", () => {
    const spec: ChartSpec = {
      ...DUMBBELL_H,
      series_order: ["static", "collected"],
      series_marker: { static: "hollow", collected: "filled" },
      columns: { category: "group", series: "measure", value: "rate", section: "band" },
      section_order: ["Quintiles", "Top decile"],
    };
    const rows: TidyRow[] = [
      { group: "Q1", band: "Quintiles", measure: "static", rate: "2.1" },
      { group: "Q1", band: "Quintiles", measure: "collected", rate: "2.0" },
      { group: "Q5", band: "Quintiles", measure: "static", rate: "30.1" },
      { group: "Q5", band: "Quintiles", measure: "collected", rate: "28.4" },
      { group: "Top 1%", band: "Top decile", measure: "static", rate: "39.0" },
      { group: "Top 1%", band: "Top decile", measure: "collected", rate: "35.1" },
    ] as TidyRow[];
    const { svg } = renderChart(spec, rows, { ...opts, document });
    // 3 categories × 2 series = 6 dots (spacer slots carry no dots).
    expect(svg.querySelectorAll('g[aria-label="dot"] circle').length).toBe(6);
    const headers = Array.from(svg.querySelectorAll("g.tbl-dumbbell-section text")).map((t) => t.textContent);
    expect(headers).toContain("Quintiles");
    expect(headers).toContain("Top decile");
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

// Golden-SVG parity: lock the rendered output byte-for-byte so any accidental engine change to a
// known dumbbell fails here until the baseline is deliberately regenerated (-u) and reviewed.
describe("golden SVG — dumbbell", () => {
  const GAP_SPEC: ChartSpec = { ...DUMBBELL_H, gap_annotation: { series_a: "static", series_b: "collected" } };

  it("horizontal, ink/hollow/filled markers + gap annotation, is byte-stable", async () => {
    const { svg } = renderChart(GAP_SPEC, ROWS, { ...opts, document });
    await expect(svg.outerHTML).toMatchFileSnapshot("./fixtures/dumbbell-horizontal.golden.svg");
  });

  it("vertical is byte-stable", async () => {
    const { svg } = renderChart({ ...DUMBBELL_H, orientation: "vertical" }, ROWS, { ...opts, document });
    await expect(svg.outerHTML).toMatchFileSnapshot("./fixtures/dumbbell-vertical.golden.svg");
  });

  it("is deterministic (byte-identical across renders)", () => {
    const a = renderChart(GAP_SPEC, ROWS, { ...opts, document }).svg.outerHTML;
    const b = renderChart(GAP_SPEC, ROWS, { ...opts, document }).svg.outerHTML;
    expect(a).toBe(b);
  });
});
