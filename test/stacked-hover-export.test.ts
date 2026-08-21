// @vitest-environment jsdom
//
// Issue #29's acceptance criteria, asserted on the EXPORT path. `buildExportSvg` re-renders from the
// spec (renderChart for a single chart, renderFigure only for small multiples) rather than serialising
// the DOM, which is why the net dot hidden with CSS still reached the download.
import { describe, it, expect } from "vitest";
import { buildExportSvg } from "../src/embed/export-png";
import { renderChart } from "../src/engine/index";
import { NET_DOT_CLASS } from "../src/engine/marks/stacked";
import { validateSpec } from "../src/spec/validate";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const ROWS: TidyRow[] = [
  { time: "Q1", value: "10", series: "A" },
  { time: "Q1", value: "20", series: "B" },
  { time: "Q2", value: "30", series: "A" },
  { time: "Q2", value: "40", series: "B" },
] as unknown as TidyRow[];

const SPEC = {
  chartType: "stacked",
  title: "t",
  xAxisType: "categorical",
  data: "data.csv",
  columns: { x: "time", value: "value", series: "series" },
  barStack: { netDisplay: "none", hover: "tooltip" },
} as unknown as ChartSpec;

const netDots = (svg: SVGSVGElement) => svg.querySelectorAll(`g.${NET_DOT_CLASS} circle`).length;
const texts = (svg: SVGSVGElement) =>
  Array.from(svg.querySelectorAll("text")).map((t) => t.textContent ?? "");

describe("issue #29 acceptance — no dot, no Total legend row, tooltip retained", () => {
  it("validates", () => {
    expect(validateSpec(SPEC).valid).toBe(true);
  });

  it("paints no net dot on the live chart", () => {
    const { svg } = renderChart(SPEC, ROWS, { width: 720, height: 400, document });
    expect(netDots(svg)).toBe(0);
  });

  it("emits no Total legend row on the live chart", () => {
    const { legendItems } = renderChart(SPEC, ROWS, { width: 720, height: 400, document });
    expect((legendItems ?? []).map((i) => i.label)).not.toContain("Total");
  });

  it("paints no net dot in the exported SVG", () => {
    expect(netDots(buildExportSvg(SPEC, ROWS))).toBe(0);
  });

  it('draws no "Total" text anywhere in the exported SVG — plot or composed legend', () => {
    expect(texts(buildExportSvg(SPEC, ROWS))).not.toContain("Total");
  });
});
