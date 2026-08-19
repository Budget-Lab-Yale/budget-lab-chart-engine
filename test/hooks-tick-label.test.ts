// @vitest-environment jsdom
//
// The parity guarantee: a static hook's output must appear in the PNG export identically, because
// the export RE-RENDERS from the spec rather than serialising the DOM. That is exactly why a
// MutationObserver rewriting tick text never reached the download (#30).
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import { buildExportSvg } from "../src/embed/export-png";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";
import type { RenderHooks } from "../src/spec/hooks";

const ROWS: TidyRow[] = [
  { time: "2021", value: "1000", series: "A" },
  { time: "2022", value: "2000", series: "A" },
  { time: "2023", value: "3000", series: "A" },
] as unknown as TidyRow[];

const SPEC = {
  chartType: "line",
  title: "t",
  xAxisType: "categorical",
  data: "data.csv",
  columns: { x: "time", value: "value", series: "series" },
} as unknown as ChartSpec;

/** Thousands separators — the consumer's actual case, and impossible declaratively today. */
const hooks: RenderHooks = {
  tickLabel: (v) => v.toLocaleString("en-US"),
};

const texts = (svg: SVGSVGElement) =>
  Array.from(svg.querySelectorAll("text")).map((t) => t.textContent ?? "");

describe("hooks.tickLabel", () => {
  it("rewrites the value-axis tick text on the live render", () => {
    const { svg } = renderChart(SPEC, ROWS, { width: 720, height: 400, document, hooks });
    expect(texts(svg).some((t) => t.includes(","))).toBe(true);
  });

  it("leaves tick text alone when the hook returns null", () => {
    const { svg } = renderChart(SPEC, ROWS, {
      width: 720, height: 400, document,
      hooks: { tickLabel: () => null },
    });
    expect(texts(svg).some((t) => t.includes(","))).toBe(false);
  });

  it("appears IDENTICALLY in the export — the whole point", () => {
    const live = texts(renderChart(SPEC, ROWS, { width: 720, height: 400, document, hooks }).svg)
      .filter((t) => t.includes(","));
    const exported = texts(buildExportSvg(SPEC, ROWS, { hooks })).filter((t) => t.includes(","));
    expect(exported).toEqual(live);
    expect(exported.length).toBeGreaterThan(0);
  });

  it("renders byte-identically with no hooks at all", () => {
    const a = renderChart(SPEC, ROWS, { width: 720, height: 400, document }).svg.outerHTML;
    const b = renderChart(SPEC, ROWS, { width: 720, height: 400, document, hooks: {} }).svg.outerHTML;
    expect(b).toBe(a);
  });
});
