// @vitest-environment jsdom
//
// `netMode` has to survive the MarkLayers → FigurePane → FigureRenderResult chain, or a faceted
// stacked chart's hover silently falls back to `undefined` (which reads as "off"). No golden can
// catch that — goldens are static SVG and never hover — so it needs its own assertion.
import { describe, it, expect } from "vitest";
import { renderFigure } from "../src/engine/index";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const ROWS: TidyRow[] = [
  { facet: "pct", time: "Q1", value: "10", series: "A" },
  { facet: "pct", time: "Q1", value: "20", series: "B" },
  { facet: "dollars", time: "Q1", value: "30", series: "A" },
  { facet: "dollars", time: "Q1", value: "40", series: "B" },
] as unknown as TidyRow[];

function spec(barStack: Record<string, unknown>): ChartSpec {
  return {
    chartType: "stacked",
    title: "t",
    xAxisType: "categorical",
    data: "data.csv",
    columns: { x: "time", value: "value", series: "series", facet: "facet" },
    small_multiples: { mode: "shared", pane_order: ["pct", "dollars"], columns: 2 },
    barStack,
  } as unknown as ChartSpec;
}

describe("small multiples — netMode reaches the figure and its panes", () => {
  it("carries netMode: none for a dot-free tooltip chart", () => {
    const fig = renderFigure(spec({ netDisplay: "none", hover: "tooltip" }), ROWS, {
      width: 720,
      document,
    });
    expect(fig.netMode).toBe("none");
    expect(fig.panes.length).toBeGreaterThan(0);
    for (const pane of fig.panes) expect(pane.netMode).toBe("none");
  });

  it("carries netMode: text for an all-positive stack left on auto", () => {
    const fig = renderFigure(spec({}), ROWS, { width: 720, document });
    expect(fig.netMode).toBe("text");
    for (const pane of fig.panes) expect(pane.netMode).toBe("text");
  });
});
