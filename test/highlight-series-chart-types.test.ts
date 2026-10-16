// @vitest-environment jsdom
//
// `highlightSeries` is read by marks/bar.ts and marks/histogram.ts only. On every other chart type it
// rendered byte-identically to its absence, so validation rejects it there rather than let an author
// believe it does something. Backs CONFIG-SPEC "Bar / stacked-bar options" (the `highlightSeries`
// row) and "CSV format" (fields checked only on some charts).
//
// Stacked bars dimmed for a while on the debt/5 branch and were taken back off (owner ruling
// 2026-10-16: unclear on a stack). The render test below pins that a stacked chart draws as if the
// field were absent, live and in the PNG export.
import { describe, it, expect } from "vitest";
import { validateSpec } from "../src/spec/validate";
import { CHART_SPEC_SCHEMA } from "../src/spec/schema";
import { renderChart } from "../src/engine/index";
import { buildExportSvg } from "../src/embed/export-png";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const BASES: Record<string, Record<string, unknown>> = {
  line: { chartType: "line", xAxisType: "temporal" },
  area: { chartType: "area", xAxisType: "temporal" },
  bar: { chartType: "bar", xAxisType: "categorical" },
  stacked: { chartType: "stacked", xAxisType: "categorical" },
  scatter: { chartType: "scatter", xAxisType: "numeric" },
  dotplot: { chartType: "dotplot", xAxisType: "categorical" },
  waterfall: { chartType: "waterfall", xAxisType: "categorical" },
  histogram: { chartType: "histogram", xAxisType: "numeric", columns: { x: "amount" } },
  dumbbell: { chartType: "dumbbell", xAxisType: "categorical", columns: { category: "c", series: "s", value: "v" } },
  timeline: { chartType: "timeline", xAxisType: "temporal" },
  treemap: { chartType: "treemap", xAxisType: "categorical" },
};
const base = (type: string) => ({ title: "t", data: "d.csv", ...BASES[type] });

const READERS = ["bar", "histogram"];
// The timeline and treemap gates reject every field outside their allow-lists, and a failing gate
// ends validation, so those two report the gate's message.
const GATED = ["timeline", "treemap"];

describe("highlightSeries: accepted on bar and histogram only", () => {
  it("BASES covers every chart type the schema accepts", () => {
    const types = CHART_SPEC_SCHEMA.properties.chartType.enum;
    expect(Object.keys(BASES).sort()).toEqual([...types].sort());
  });

  for (const type of Object.keys(BASES)) {
    it(`${type}: ${READERS.includes(type) ? "accepted" : "rejected"}`, () => {
      expect(validateSpec(base(type)), "base without the field").toEqual({ valid: true, errors: [] });
      const r = validateSpec({ ...base(type), highlightSeries: ["a"] });
      if (READERS.includes(type)) {
        expect(r).toEqual({ valid: true, errors: [] });
      } else if (GATED.includes(type)) {
        expect(r.valid).toBe(false);
        expect(r.errors).toContain(`highlightSeries is not supported on chartType "${type}"`);
      } else {
        expect(r).toEqual({
          valid: false,
          errors: [`highlightSeries is supported on chartType "bar" and "histogram" only (got "${type}")`],
        });
      }
    });
  }

  it("presence, not value: an empty list is rejected too", () => {
    const r = validateSpec({ ...base("stacked"), highlightSeries: [] });
    expect(r.errors).toEqual([`highlightSeries is supported on chartType "bar" and "histogram" only (got "stacked")`]);
  });
});

describe("highlightSeries has no rendering effect on a stacked bar", () => {
  const ROWS = (
    [["A", "one", 6], ["A", "two", 4], ["A", "three", -3], ["B", "one", 3], ["B", "two", 7], ["B", "three", 5]] as const
  ).map(([time, series, v]) => ({ time, series, value: String(v) })) as unknown as TidyRow[];
  const stacked = (s: Record<string, unknown> = {}): ChartSpec =>
    ({
      ...base("stacked"),
      columns: { x: "time", value: "value", series: "series" },
      series_colors: { one: "blue", two: "amber", three: "teal" },
      valueLabels: { show: true },
      ...s,
    }) as unknown as ChartSpec;
  const OPTS = { width: 720, height: 600, document };

  for (const variant of [{}, { barStack: { mono: { base: "blue" }, netDisplay: "text" } }, { orientation: "horizontal" }]) {
    it(`live and PNG export are byte-identical with and without it: ${JSON.stringify(variant)}`, () => {
      const without = stacked(variant);
      const withField = stacked({ ...variant, highlightSeries: ["two"] });
      const a = renderChart(withField, ROWS, OPTS);
      const b = renderChart(without, ROWS, OPTS);
      expect(a.svg.outerHTML).toBe(b.svg.outerHTML);
      expect(JSON.stringify(a.legendItems)).toBe(JSON.stringify(b.legendItems));
      expect(buildExportSvg(withField, ROWS).outerHTML).toBe(buildExportSvg(without, ROWS).outerHTML);
    });
  }
});
