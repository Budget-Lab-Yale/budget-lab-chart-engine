// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { Plot } from "../../src/engine/vendor";
import { buildHistogramMarks } from "../../src/engine/marks/histogram";
import type { PreparedRow, MarkContext } from "../../src/engine/marks/index";
import type { ChartSpec } from "../../src/spec/types";

const spec = { chartType: "histogram", title: "H", xAxisType: "numeric", data: "d" } as unknown as ChartSpec;
const ctx: MarkContext = { xField: "_x0", colors: new Map([["A", "#123456"], ["B", "#abcdef"]]), seriesNames: ["A", "B"] } as any;
const rows: PreparedRow[] = [
  { series: "A", time: "", _y: 2, _x0: 0, _x1: 5 }, { series: "A", time: "", _y: 0, _x0: 5, _x1: 10 },
  { series: "B", time: "", _y: 1, _x0: 0, _x1: 5 }, { series: "B", time: "", _y: 3, _x0: 5, _x1: 10 },
];

describe("buildHistogramMarks", () => {
  it("emits rect marks that render to a plot with <rect> bars", () => {
    const layers = buildHistogramMarks(rows, spec, ctx);
    const plot = Plot.plot({ marks: layers.overlay as any });
    expect(plot.querySelectorAll("rect").length).toBeGreaterThan(0);
    plot.remove();
  });
  it("overlapping multi-series bars are translucent (fill-opacity < 1)", () => {
    const layers = buildHistogramMarks(rows, spec, ctx);
    const plot = Plot.plot({ marks: layers.overlay as any });
    const op = Array.from((plot as Element).querySelectorAll("rect")).map((r) => Number(r.getAttribute("fill-opacity") ?? "1"));
    expect(op.some((o) => o < 1)).toBe(true);
    plot.remove();
  });
  it("tags rects with data-series for legend dim/pin", () => {
    const layers = buildHistogramMarks(rows, spec, ctx);
    expect(layers.tagging.some((t) => t.selector.includes("rect"))).toBe(true);
  });
});
