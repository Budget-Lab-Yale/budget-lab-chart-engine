// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { horizontalBarChartHeight, figurePaneHeight } from "../src/engine/figure";
import { buildExportSvg } from "../src/embed/export-png";
import { renderFigure } from "../src/engine/index";
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

describe("figurePaneHeight", () => {
  const base = { columns: { x: "category", value: "value", facet: "panel" }, xAxisType: "categorical", data: "x" };
  it("waterfall figure panes are 420 (matches the live mount, not the old 240)", () => {
    expect(figurePaneHeight({ ...base, chartType: "waterfall" } as any)).toBe(420);
  });
  it("dotplot/bar/stacked (vertical) figure panes are 320", () => {
    expect(figurePaneHeight({ ...base, chartType: "dotplot" } as any)).toBe(320);
    expect(figurePaneHeight({ ...base, chartType: "bar" } as any)).toBe(320);
    expect(figurePaneHeight({ ...base, chartType: "stacked" } as any)).toBe(320);
  });
  it("line/scatter/area figure panes are 240", () => {
    expect(figurePaneHeight({ ...base, chartType: "line" } as any)).toBe(240);
    expect(figurePaneHeight({ ...base, chartType: "scatter" } as any)).toBe(240);
  });
  it("horizontal bar AND horizontal stacked figures grow (undefined ⇒ auto-height)", () => {
    expect(figurePaneHeight({ ...base, chartType: "bar", orientation: "horizontal" } as any)).toBeUndefined();
    expect(figurePaneHeight({ ...base, chartType: "stacked", orientation: "horizontal" } as any)).toBeUndefined();
  });
});

describe("figurePaneHeight — export-integration", () => {
  it("waterfall figure export renders 420px panes, not 240 (regression: export drift)", () => {
    const spec = {
      chartType: "waterfall",
      columns: { x: "step", value: "value", facet: "model" },
      xAxisType: "categorical",
      small_multiples: { facet_field: "model" },
      data: "x",
    } as any;
    const rows: TidyRow[] = [];
    for (const m of ["Original", "New"]) {
      ["Start", "Step 1", "Step 2", "End"].forEach((s, i) =>
        rows.push({ step: s, model: m, value: String(2 - i * 0.4) } as TidyRow),
      );
    }
    const fig = renderFigure(spec, rows, { gridWidth: 920, gridGap: 20, height: figurePaneHeight(spec), columns: 2 });
    const paneH = Number((fig.panes[0]!.svg as SVGSVGElement).getAttribute("height"));
    expect(paneH).toBe(420);
  });

  it("horizontal stacked figure grows its pane height with row count", () => {
    const spec = {
      chartType: "stacked",
      orientation: "horizontal",
      columns: { x: "category", value: "value", series: "series", facet: "panel" },
      xAxisType: "categorical",
      small_multiples: { facet_field: "panel" },
      data: "x",
    } as any;
    const rows: TidyRow[] = [];
    for (const p of ["P1", "P2"]) {
      for (let c = 0; c < 20; c++) {
        for (const s of ["A", "B"]) rows.push({ category: `C${c}`, series: s, value: "1", panel: p } as TidyRow);
      }
    }
    // undefined height ⇒ renderFigure auto-grows for horizontal bar/stacked.
    const fig = renderFigure(spec, rows, { gridWidth: 920, gridGap: 20, height: figurePaneHeight(spec), columns: 2 });
    const paneH = Number((fig.panes[0]!.svg as SVGSVGElement).getAttribute("height"));
    expect(paneH).toBeGreaterThan(420); // 20 categories ⇒ taller than any fixed pane height
  });
});
