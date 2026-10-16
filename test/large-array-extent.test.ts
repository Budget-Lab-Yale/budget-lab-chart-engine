// @vitest-environment jsdom
// B7: `Math.min(...arr)` / `Math.max(...arr)` over a row-sized array throws RangeError (call-stack
// overflow) somewhere past ~125k arguments. These render a 200k-row histogram and a 200k-point line
// chart (with a CI band, so ~600k values reach the value-extent fold), standalone and faceted.
import { describe, it, expect } from "vitest";
import { renderChart, renderFigure } from "../src/engine/index";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";
import { minMax } from "../src/engine/util";

const N = 200_000;

describe("minMax matches [Math.min(...xs), Math.max(...xs)] exactly", () => {
  const cases: Array<[string, unknown[]]> = [
    ["empty", []],
    ["one", [3]],
    ["mixed", [3, -1, 7, 2]],
    ["NaN first", [NaN, 1, 2]],
    ["NaN middle", [1, NaN, 2]],
    ["NaN last", [1, 2, NaN]],
    ["undefined coerces to NaN", [1, undefined, 2]],
    ["null coerces to 0", [1, null, 2]],
    ["-0 then 0", [-0, 0]],
    ["0 then -0", [0, -0]],
    ["only -0", [-0]],
    ["only 0", [0]],
    ["-0 among positives", [3, -0, 5]],
    ["0 among negatives", [-3, 0, -5]],
    ["infinities", [Infinity, -Infinity, 4]],
  ];
  for (const [name, xs] of cases) {
    it(name, () => {
      const [lo, hi] = minMax(xs as number[]);
      expect(Object.is(lo, Math.min(...(xs as number[])))).toBe(true);
      expect(Object.is(hi, Math.max(...(xs as number[])))).toBe(true);
    });
  }

  it("accepts any iterable (a Map's values)", () => {
    expect(minMax(new Map([["a", 2], ["b", -4]]).values())).toEqual([-4, 2]);
  });

  it("handles 1M values", () => {
    const xs = Array.from({ length: 1_000_000 }, (_, i) => i - 500_000);
    expect(minMax(xs)).toEqual([-500_000, 499_999]);
  });
});

describe("200k-row charts render without overflowing the call stack (B7)", () => {
  it("numeric histogram, auto bins, standalone and faceted", () => {
    const raw = Array.from({ length: N }, (_, i) => ({
      amount: String((i * 7919) % 100_003),
      grp: i % 2 ? "L" : "R",
    })) as unknown as TidyRow[];
    const spec = {
      chartType: "histogram",
      title: "H",
      xAxisType: "numeric",
      columns: { x: "amount" },
      data: "d",
    } as unknown as ChartSpec;
    const { svg } = renderChart(spec, raw, { width: 600, height: 360 });
    expect(svg.querySelectorAll("rect").length).toBeGreaterThan(0);

    const facetSpec = { ...spec, columns: { x: "amount", facet: "grp" }, small_multiples: {} } as unknown as ChartSpec;
    const fig = renderFigure(facetSpec, raw, { width: 720, height: 360 });
    expect(fig.panes.length).toBe(2);
    for (const p of fig.panes) expect(p.svg?.querySelectorAll("rect").length ?? 0).toBeGreaterThan(0);
  }, 120_000);

  it("temporal histogram, calendar bins", () => {
    const day = 86_400_000;
    const t0 = Date.UTC(2000, 0, 1);
    const raw = Array.from({ length: N }, (_, i) => ({
      d: new Date(t0 + (i % 3000) * day).toISOString().slice(0, 10),
    })) as unknown as TidyRow[];
    const spec = {
      chartType: "histogram",
      title: "H",
      xAxisType: "temporal",
      columns: { x: "d" },
      histogram: { binWidth: "year" },
      data: "d",
    } as unknown as ChartSpec;
    const { svg } = renderChart(spec, raw, { width: 600, height: 360 });
    expect(svg.querySelectorAll("rect").length).toBeGreaterThan(0);
  }, 120_000);

  it("dumbbell with 200k rows in one category", () => {
    const raw = Array.from({ length: N }, (_, i) => ({
      group: "All",
      measure: i % 2 ? "a" : "b",
      rate: String((i % 1000) / 10),
    })) as unknown as TidyRow[];
    const spec = {
      chartType: "dumbbell",
      title: "D",
      xAxisType: "categorical",
      orientation: "horizontal",
      columns: { category: "group", series: "measure", value: "rate" },
      data: "d",
    } as unknown as ChartSpec;
    const { svg } = renderChart(spec, raw, { width: 600, height: 360 });
    expect(svg.querySelectorAll("circle").length).toBeGreaterThan(0);
  }, 120_000);

  it("line chart with a CI band and autoWiden, standalone and faceted", () => {
    const raw = Array.from({ length: N }, (_, i) => {
      const v = Math.sin(i / 5000) * 10;
      return { t: String(i), v: String(v), lo: String(v - 1), hi: String(v + 1), s: "A", grp: i % 2 ? "L" : "R" };
    }) as unknown as TidyRow[];
    const spec = {
      chartType: "line",
      title: "t",
      xAxisType: "numeric",
      columns: { x: "t", value: "v", series: "s" },
      confidence_bands: [{ series: "A", lower: "lo", upper: "hi" }],
      yAxisPolicy: { max: 5, autoWiden: { step: 5 } },
      data: "d",
    } as unknown as ChartSpec;
    const { svg } = renderChart(spec, raw, { width: 600, height: 360 });
    expect(svg.querySelectorAll("path").length).toBeGreaterThan(0);

    const facetSpec = { ...spec, columns: { x: "t", value: "v", series: "s", facet: "grp" }, small_multiples: {} } as unknown as ChartSpec;
    const fig = renderFigure(facetSpec, raw, { width: 720, height: 360 });
    expect(fig.panes.length).toBe(2);
  }, 120_000);
});
