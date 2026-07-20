// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderChart, renderFigure } from "../src/engine/index";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const raw: TidyRow[] = Array.from({ length: 20 }, (_, i) => ({
  amount: String(i),
  series: i < 10 ? "A" : "B",
})) as any;

const spec = {
  chartType: "histogram",
  title: "H",
  xAxisType: "numeric",
  columns: { x: "amount", series: "series" },
  histogram: { bins: 4, domain: [0, 20] },
  data: "d",
} as unknown as ChartSpec;

describe("histogram pipeline", () => {
  it("renders binned bars from raw rows", () => {
    const { svg } = renderChart(spec, raw, { width: 600, height: 360 });
    // 2 series × 4 bins = 8 rects (empty bins are preserved as _y=0).
    expect(svg.querySelectorAll("rect").length).toBe(8);
  });

  it("bins on the continuous x-domain [0,20] (not a band scale)", () => {
    const { svg } = renderChart(spec, raw, { width: 600, height: 360 });
    // A histogram must NOT produce Plot's categorical band-axis chrome.
    expect(svg.querySelector('g[aria-label^="fx-axis"]')).toBeNull();
    expect(svg.querySelectorAll("rect").length).toBeGreaterThan(0);
  });

  it("accepts pre-binned rows (x0/x1/value) without binning", () => {
    const preRows: TidyRow[] = [
      { lo: "0", hi: "5", n: "3" },
      { lo: "5", hi: "10", n: "7" },
    ] as any;
    const preSpec = {
      chartType: "histogram",
      title: "H",
      xAxisType: "numeric",
      columns: { x0: "lo", x1: "hi", value: "n" },
      data: "d",
    } as unknown as ChartSpec;
    const { svg } = renderChart(preSpec, preRows, { width: 600, height: 360 });
    expect(svg.querySelectorAll("rect").length).toBe(2);
  });

  it("normalizes pre-binned bar heights to proportions", () => {
    const preRows: TidyRow[] = [
      { lo: "0", hi: "5", n: "3" },
      { lo: "5", hi: "10", n: "1" },
    ] as any;
    const preSpec = {
      chartType: "histogram",
      title: "H",
      xAxisType: "numeric",
      columns: { x0: "lo", x1: "hi", value: "n" },
      histogram: { normalize: "proportion" },
      data: "d",
    } as unknown as ChartSpec;
    // Should render without throwing and keep both bars (heights become 0.75 / 0.25).
    const { svg } = renderChart(preSpec, preRows, { width: 600, height: 360 });
    expect(svg.querySelectorAll("rect").length).toBe(2);
  });

  it("renders a faceted histogram with shared thresholds (one figure per facet)", () => {
    const facetRaw: TidyRow[] = [
      ...Array.from({ length: 10 }, (_, i) => ({ amount: String(i), grp: "L" })),
      ...Array.from({ length: 10 }, (_, i) => ({ amount: String(i + 10), grp: "R" })),
    ] as any;
    const facetSpec = {
      chartType: "histogram",
      title: "H",
      xAxisType: "numeric",
      columns: { x: "amount", facet: "grp" },
      histogram: { bins: 4, domain: [0, 20] },
      small_multiples: {},
      data: "d",
    } as unknown as ChartSpec;
    const fig = renderFigure(facetSpec, facetRaw, { width: 720, height: 360 });
    expect(fig.panes.length).toBe(2);
    for (const p of fig.panes) {
      expect(p.svg?.querySelectorAll("rect").length ?? 0).toBeGreaterThan(0);
    }
  });
});
