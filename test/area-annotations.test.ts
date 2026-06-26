// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildAreaMarks } from "../src/engine/marks/area";
import { resolveAnnotations } from "../src/spec/annotations";
import { validateSpec } from "../src/spec/validate";
import type { ChartSpec } from "../src/spec/types";
import type { PreparedRow, MarkContext } from "../src/engine/marks/index";

const ctx = {
  xField: "_xd",
  colors: new Map([["A", "#111"], ["B", "#222"]]),
  seriesNames: ["A", "B"],
} as unknown as MarkContext;

const rows = [
  { series: "A", time: "2025-01-01", _y: 1 },
  { series: "B", time: "2025-01-01", _y: 2 },
  { series: "A", time: "2025-01-02", _y: 3 },
  { series: "B", time: "2025-01-02", _y: 4 },
] as unknown as PreparedRow[];

describe("buildAreaMarks", () => {
  it("emits a single areaY overlay tagged for legend interaction, in series order", () => {
    const layers = buildAreaMarks(rows, { chartType: "area" } as ChartSpec, ctx);
    expect(layers.overlay.length).toBe(1);
    expect(layers.tagging[0]!.selector).toBe('g[aria-label="area"] path');
    expect(layers.tagging[0]!.seriesOrder).toEqual(["A", "B"]); // bottom→top = series_order
  });

  it("stackOrder reorders the stack (and path tagging) without changing series_order", () => {
    const reordered = buildAreaMarks(rows, { chartType: "area" } as ChartSpec, {
      ...ctx,
      stackOrder: ["B", "A"], // B to the bottom
    } as MarkContext);
    // Paths are emitted in stack order, so tagging follows the new bottom→top order.
    expect(reordered.tagging[0]!.seriesOrder).toEqual(["B", "A"]);
  });

  it("handles a single series (fill to zero) without error", () => {
    const single = rows.filter((r) => r.series === "A");
    const layers = buildAreaMarks(single, { chartType: "area" } as ChartSpec, {
      ...ctx,
      seriesNames: ["A"],
    } as MarkContext);
    expect(layers.overlay.length).toBe(1);
    expect(layers.tagging[0]!.seriesOrder).toEqual(["A"]);
  });
});

describe("resolveAnnotations", () => {
  it("falls back to the legacy axis-policy fields when no annotations block", () => {
    const r = resolveAnnotations({
      xAxisPolicy: { markers: [{ x: "a" }], bands: [{ start: "a", end: "b" }] },
      yAxisPolicy: { markers: [{ y: 1 }] },
    } as ChartSpec);
    expect(r.xAxis).toHaveLength(1);
    expect(r.bands).toHaveLength(1);
    expect(r.yAxis).toHaveLength(1);
    expect(r.points).toEqual([]);
  });

  it("prefers the unified annotations block per field", () => {
    const r = resolveAnnotations({
      annotations: {
        xAxis: [{ x: "z" }],
        points: [{ x: "p", y: 5, label: "L" }],
      },
      xAxisPolicy: { markers: [{ x: "a" }] },
    } as ChartSpec);
    expect(r.xAxis[0]!.x).toBe("z"); // annotations wins over legacy
    expect(r.points).toHaveLength(1);
    expect(r.points[0]!.label).toBe("L");
  });
});

describe("schema", () => {
  it("accepts chartType: area and an annotations block", () => {
    const res = validateSpec({
      chartType: "area",
      title: "T",
      xAxisType: "temporal",
      data: "d.csv",
      annotations: {
        xAxis: [{ x: "2025-04-02", label: "Event", labelDy: 20, labelAnchor: "end" }],
        yAxis: [{ y: 10, label: "Target" }],
        bands: [{ start: "2026-04-01", end: "2026-12-31", label: "Future" }],
        points: [{ x: "2025-04-11", y: 21, label: "Peak", connector: true }],
      },
    });
    expect(res.valid).toBe(true);
  });

  it("rejects an unknown annotations key", () => {
    const res = validateSpec({
      chartType: "area",
      title: "T",
      xAxisType: "temporal",
      data: "d.csv",
      annotations: { bogus: [] },
    });
    expect(res.valid).toBe(false);
  });
});
