// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { horizontalBarChartHeight } from "../src/engine/figure";
import { buildExportSvg } from "../src/embed/export-png";
import { H } from "../src/embed/figure-chrome";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

// Synthetic dense two-section spec (no real data).
const spec: ChartSpec = {
  chartType: "bar",
  orientation: "horizontal",
  columns: { x: "category", value: "value", section: "panel" },
  xAxisType: "categorical",
  section_order: ["Group A", "Group B"],
  data: "inline",
} as unknown as ChartSpec;

function denseRows(nA: number, nB: number): TidyRow[] {
  const rows: TidyRow[] = [];
  for (let i = 0; i < nA; i++) rows.push({ category: `A${i}`, panel: "Group A", value: String(i + 1) } as TidyRow);
  for (let i = 0; i < nB; i++) rows.push({ category: `B${i}`, panel: "Group B", value: String(i + 1) } as TidyRow);
  return rows;
}

describe("horizontalBarChartHeight", () => {
  it("grows with row count (more rows ⇒ taller)", () => {
    const few = horizontalBarChartHeight(spec, denseRows(3, 3));
    const many = horizontalBarChartHeight(spec, denseRows(8, 38));
    expect(many).toBeGreaterThan(few);
    expect(many).toBeGreaterThan(H); // taller than the fixed 750 export frame
  });
});

describe("buildExportSvg — single horizontal sectioned chart", () => {
  it("grows the export frame past the fixed 750 height instead of cramming rows", () => {
    const svg = buildExportSvg(spec, denseRows(8, 38));
    const h = Number(svg.getAttribute("height"));
    expect(h).toBeGreaterThan(H);
  });

  it("leaves a non-horizontal single chart at the fixed frame height", () => {
    const vspec = { ...spec, orientation: "vertical" } as ChartSpec;
    const svg = buildExportSvg(vspec, denseRows(8, 38));
    expect(Number(svg.getAttribute("height"))).toBe(H);
  });
});
