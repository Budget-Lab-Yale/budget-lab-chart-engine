// @vitest-environment jsdom
//
// A9: a value label's data-derived precision counted float noise as precision. Stacked net labels
// over 1.1 + 2.2 printed "3.30" (String(3.3000000000000003) has 16 decimals, capped to 2), and a
// waterfall over 1.1, 2.2, 0.5 printed "1.10", "3.30", "3.80". CONFIG-SPEC promises "the minimum the
// data needs, capped at 2" (`valueLabels.decimals`) and, for a waterfall's labels and value pill,
// "the fewest decimals the data needs, at most 2" (`tooltip_decimals`). Both now hold, live and in
// the PNG export. The tick formatter shares the count: ticks below 1e-6 printed every tick as "0".
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { renderChart } from "../src/engine/index";
import { buildExportSvg } from "../src/embed/export-png";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const realGetContext = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
});

const texts = (svg: Element): string[] => Array.from(svg.querySelectorAll("text")).map((t) => t.textContent ?? "");
const both = (spec: ChartSpec, rows: TidyRow[]): Array<[string, string[]]> => [
  ["live", texts(renderChart(spec, rows, { width: 720, height: 400, document }).svg)],
  ["export", texts(buildExportSvg(spec, rows))],
];

describe("A9: value labels print the precision the data needs, not float noise", () => {
  it("stacked net labels: 1.1 + 2.2 and 1.5 + 2.5 read 3.3 and 4.0 (were 3.30 and 4.00)", () => {
    const rows = [
      { bar: "A", tax: "Income", v: "1.1" },
      { bar: "A", tax: "Gains", v: "2.2" },
      { bar: "B", tax: "Income", v: "1.5" },
      { bar: "B", tax: "Gains", v: "2.5" },
    ] as TidyRow[];
    const spec = {
      chartType: "stacked",
      title: "t",
      xAxisType: "categorical",
      columns: { x: "bar", series: "tax", value: "v" },
      series_order: ["Income", "Gains"],
      barStack: { netDisplay: "text" },
      valueLabels: { show: true },
      data: "d.csv",
    } as unknown as ChartSpec;
    for (const [where, t] of both(spec, rows)) {
      expect(t, where).toContain("3.3");
      expect(t, where).toContain("4.0");
      expect(t, where).not.toContain("3.30");
      expect(t, where).not.toContain("4.00");
    }
  });

  it("waterfall labels: 1.1, 2.2, 0.5 read 1.1, 3.3, 3.8 (were 1.10, 3.30, 3.80)", () => {
    const rows = [
      { step: "One", value: "1.1" },
      { step: "Two", value: "2.2" },
      { step: "Three", value: "0.5" },
    ] as unknown as TidyRow[];
    const spec = {
      chartType: "waterfall",
      title: "t",
      xAxisType: "categorical",
      columns: { x: "step", value: "value" },
      valueLabels: { show: true },
      data: "d.csv",
    } as unknown as ChartSpec;
    for (const [where, t] of both(spec, rows)) {
      for (const s of ["1.1", "3.3", "3.8"]) expect(t, where).toContain(s);
      for (const s of ["1.10", "3.30", "3.80"]) expect(t, where).not.toContain(s);
    }
  });
});

describe("value-axis ticks below 1e-6 are not all printed as 0", () => {
  it("a bar chart over 1e-7 .. 3e-7 labels its ticks with their values", () => {
    const rows = [
      { cat: "A", v: "1e-7" },
      { cat: "B", v: "2e-7" },
      { cat: "C", v: "3e-7" },
    ] as unknown as TidyRow[];
    const spec = {
      chartType: "bar",
      title: "t",
      xAxisType: "categorical",
      columns: { x: "cat", value: "v" },
      data: "d.csv",
    } as unknown as ChartSpec;
    for (const [where, t] of both(spec, rows)) {
      const ticks = t.filter((s) => /^0(\.\d+)?$/.test(s));
      expect(ticks.length, where).toBeGreaterThan(2);
      expect(new Set(ticks).size, `${where}: ${ticks.join(" ")}`).toBe(ticks.length);
      // d3 steps these ticks by 5e-8, so every tick prints 8 decimals.
      expect(ticks, where).toContain("0.00000010");
    }
  });

  // The decimals cut that drops float noise is relative to the largest tick; a pinned domain whose
  // step lies below it must still label every tick distinctly (it printed three "1000000000000").
  it("a pinned domain [1000000000000.1, 1000000000000.15] with tickCount 1 labels .10 and .15", () => {
    // Uniqueness alone stopped at 1 decimal and printed the upper tick as "…0.2", outside the domain.
    const lo = 1000000000000.1;
    const hi = 1000000000000.15;
    const rows = ["2020", "2021"].map((x, i) => ({ x, v: String(i ? hi : lo) })) as unknown as TidyRow[];
    const spec = {
      chartType: "line",
      title: "t",
      xAxisType: "categorical",
      columns: { x: "x", value: "v" },
      yAxisPolicy: { min: lo, max: hi, tickCount: 1 },
      data: "d.csv",
    } as unknown as ChartSpec;
    for (const [where, t] of both(spec, rows)) {
      const ticks = t.filter((s) => s.startsWith("1000000000000"));
      expect(ticks, where).toEqual(["1000000000000.10", "1000000000000.15"]);
    }
  });

  for (const [lo, hi] of [
    [1e12, 1e12 + 1],
    [1e8, 1e8 + 1e-4],
  ] as Array<[number, number]>) {
    it(`a line over the pinned domain [${lo}, ${hi}] gives every tick its own label`, () => {
      const rows = ["2020", "2021", "2022"].map((x, i) => ({ x, v: String(lo + ((hi - lo) * (i + 1)) / 4) })) as unknown as TidyRow[];
      const spec = {
        chartType: "line",
        title: "t",
        xAxisType: "categorical",
        columns: { x: "x", value: "v" },
        yAxisPolicy: { min: lo, max: hi },
        data: "d.csv",
      } as unknown as ChartSpec;
      const whole = String(Math.trunc(lo));
      for (const [where, t] of both(spec, rows)) {
        const ticks = t.filter((s) => s.startsWith(whole.slice(0, 6)));
        expect(ticks.length, `${where}: ${t.join(" | ")}`).toBeGreaterThan(2);
        expect(new Set(ticks).size, `${where}: ${ticks.join(" ")}`).toBe(ticks.length);
      }
    });
  }
});
