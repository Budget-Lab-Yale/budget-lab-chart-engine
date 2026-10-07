// @vitest-environment jsdom
//
// `barStack.netDisplay: "text"` prints each stack's net beside it. A negative net printed its
// magnitude ("15" for -15), so a stack that nets below zero read as a gain. It now keeps its minus
// as formatValue (hover) and the waterfall labels write it: "-15", "-$15" with a prefix. Positive
// nets are unchanged (no "+"). Segment labels stay unsigned magnitudes, as before.
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

// Nets: A = 30, B = -15, C = 5.
const ROWS = [
  { bar: "A", sec: "First", tax: "Income", v: "20" },
  { bar: "A", sec: "First", tax: "Gains", v: "10" },
  { bar: "B", sec: "Second", tax: "Income", v: "5" },
  { bar: "B", sec: "Second", tax: "Gains", v: "-20" },
  { bar: "C", sec: "Second", tax: "Income", v: "25" },
  { bar: "C", sec: "Second", tax: "Gains", v: "-20" },
] as TidyRow[];

const base = {
  chartType: "stacked",
  title: "t",
  xAxisType: "categorical",
  columns: { x: "bar", series: "tax", value: "v" },
  series_order: ["Income", "Gains"],
  barStack: { netDisplay: "text" },
  data: "d.csv",
};

const texts = (svg: Element): string[] => Array.from(svg.querySelectorAll("text")).map((t) => t.textContent ?? "");

describe("netDisplay: text keeps a negative net's minus sign", () => {
  for (const [name, spec] of [
    ["vertical", base],
    ["horizontal", { ...base, orientation: "horizontal" }],
    ["horizontal, sectioned", { ...base, orientation: "horizontal", columns: { ...base.columns, section: "sec" } }],
  ] as Array<[string, ChartSpec]>) {
    it(`${name}: live and PNG export print -15, and 30 and 5 unsigned`, () => {
      for (const svg of [renderChart(spec, ROWS, { width: 720, height: 400, document }).svg, buildExportSvg(spec, ROWS)]) {
        const t = texts(svg);
        expect(t).toContain("-15");
        expect(t).not.toContain("15");
        expect(t).toContain("30");
        expect(t).toContain("5");
        expect(t.some((s) => s.startsWith("+"))).toBe(false);
      }
    });
  }

  it("the minus goes outside a prefix, as in the hover card: -$15", () => {
    const spec = { ...base, value_prefix: "$" } as ChartSpec;
    const t = texts(renderChart(spec, ROWS, { width: 720, height: 400, document }).svg);
    expect(t).toContain("-$15");
    expect(t).toContain("$30");
  });

  it("segment labels stay unsigned magnitudes", () => {
    const spec = { ...base, orientation: "horizontal", valueLabels: { show: true } } as ChartSpec;
    const svg = renderChart(spec, ROWS, { width: 720, height: 400, document }).svg;
    const seg = Array.from(svg.querySelectorAll("g.tbl-segment-label text")).map((t) => t.textContent);
    expect(seg).toContain("20");
    expect(seg.some((s) => s?.startsWith("-"))).toBe(false);
  });
});
