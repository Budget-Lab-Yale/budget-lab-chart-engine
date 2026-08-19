// @vitest-environment jsdom
//
// hooks.afterRender (#30, Task 6): the escape hatch for whatever the engine has not anticipated.
// Unlike the four content hooks, it hands the consumer the assembled SVG itself and mutates in
// place. Its whole value is firing on BOTH the live render and the PNG export re-render — so a
// consumer's DOM customisation cannot silently apply to only the screen, which is the exact defect
// #30 exists to eliminate. `ctx.phase` tells the hook which path it is on.
import { describe, it, expect } from "vitest";
import { renderChart, renderFigure } from "../src/engine/index";
import { mountChart } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";
import type { RenderHooks } from "../src/spec/hooks";

const OPTS = { width: 720, height: 400, document };

const SPEC: ChartSpec = {
  chartType: "bar",
  title: "t",
  xAxisType: "categorical",
  data: "data.csv",
  columns: { x: "cat", value: "value" },
} as unknown as ChartSpec;
const ROWS: TidyRow[] = [
  { cat: "A", value: "3" },
  { cat: "B", value: "6" },
] as unknown as TidyRow[];

describe("hooks.afterRender — single chart", () => {
  it("mutates the live-rendered SVG, exactly once", () => {
    let calls = 0;
    const hooks: RenderHooks = {
      afterRender: (svg) => { calls++; svg.setAttribute("data-mine", "1"); },
    };
    const { svg } = renderChart(SPEC, ROWS, { ...OPTS, hooks });
    expect(svg.getAttribute("data-mine")).toBe("1");
    expect(calls).toBe(1);
  });

  it("ctx.phase is 'live' on a direct renderChart call", () => {
    let phase: string | undefined;
    renderChart(SPEC, ROWS, {
      ...OPTS,
      hooks: { afterRender: (_svg, ctx) => { phase = ctx.phase; } },
    });
    expect(phase).toBe("live");
  });

  it("mutates buildExportSvg's output too, with ctx.phase 'export', exactly once", () => {
    let phase: string | undefined;
    let calls = 0;
    const hooks: RenderHooks = {
      afterRender: (svg, ctx) => { calls++; phase = ctx.phase; svg.setAttribute("data-mine", "1"); },
    };
    const root = buildExportSvg(SPEC, ROWS, { hooks });
    expect(phase).toBe("export");
    expect(calls).toBe(1); // not once more for the discarded legend-metadata pre-render
    // The export's chart-region SVG is nested inside `root` as its own <svg> sub-element.
    const chartSvg = root.querySelector("svg");
    expect(chartSvg?.getAttribute("data-mine")).toBe("1");
  });

  it("live mount (mountChart) fires exactly once, not once more for the pre-render used to detect series count", () => {
    let calls = 0;
    const container = document.createElement("div");
    mountChart(container, {
      spec: SPEC,
      rows: ROWS,
      width: 600,
      height: 360,
      hooks: { afterRender: () => { calls++; } },
    });
    expect(calls).toBe(1);
  });

  it("renders byte-identically with hooks: {} vs no hooks at all (live)", () => {
    const a = renderChart(SPEC, ROWS, OPTS).svg.outerHTML;
    const b = renderChart(SPEC, ROWS, { ...OPTS, hooks: {} }).svg.outerHTML;
    expect(b).toBe(a);
  });

  it("renders byte-identically with hooks: {} vs no hooks at all (export)", () => {
    const a = buildExportSvg(SPEC, ROWS, {}).outerHTML;
    const b = buildExportSvg(SPEC, ROWS, { hooks: {} }).outerHTML;
    expect(b).toBe(a);
  });
});

describe("hooks.afterRender — small multiples (per pane)", () => {
  const FACETED_ROWS: TidyRow[] = [
    { pane: "P1", cat: "A", value: "3" },
    { pane: "P1", cat: "B", value: "6" },
    { pane: "P2", cat: "A", value: "9" },
    { pane: "P2", cat: "B", value: "1" },
  ] as unknown as TidyRow[];
  const FACETED_SPEC: ChartSpec = {
    chartType: "bar",
    title: "faceted",
    xAxisType: "categorical",
    data: "data.csv",
    columns: { x: "cat", value: "value", facet: "pane" },
    small_multiples: { columns: 2 },
  } as unknown as ChartSpec;

  // A single hardcoded facet value would pass even if ctx.facet were wired from the wrong (e.g.
  // first-pane-only) source — hover/call TWO panes and require two DIFFERENT values back.
  it("fires once per pane on the live figure render, with a distinct ctx.facet each time", () => {
    const seenFacets: (string | undefined)[] = [];
    const fig = renderFigure(FACETED_SPEC, FACETED_ROWS, {
      width: 720,
      height: 240,
      document,
      hooks: {
        afterRender: (svg, ctx) => { seenFacets.push(ctx.facet); svg.setAttribute("data-mine", "1"); },
      },
    });
    expect(seenFacets).toEqual(["P1", "P2"]);
    expect(fig.panes.length).toBe(2);
    for (const pane of fig.panes) expect(pane.svg?.getAttribute("data-mine")).toBe("1");
  });

  it("fires once per pane on the export figure render too, with the same two facet values", () => {
    const seenFacets: (string | undefined)[] = [];
    const root = buildExportSvg(FACETED_SPEC, FACETED_ROWS, {
      hooks: {
        afterRender: (svg, ctx) => { seenFacets.push(ctx.facet); svg.setAttribute("data-mine", "1"); },
      },
    });
    expect(seenFacets).toEqual(["P1", "P2"]);
    const paneSvgs = Array.from(root.querySelectorAll("svg"));
    expect(paneSvgs.length).toBe(2);
    for (const svg of paneSvgs) expect(svg.getAttribute("data-mine")).toBe("1");
  });

  it("renders byte-identically with hooks: {} on a figure, live and export", () => {
    const liveA = renderFigure(FACETED_SPEC, FACETED_ROWS, { width: 720, height: 240, document })
      .panes.map((p) => p.svg?.outerHTML);
    const liveB = renderFigure(FACETED_SPEC, FACETED_ROWS, { width: 720, height: 240, document, hooks: {} })
      .panes.map((p) => p.svg?.outerHTML);
    expect(liveB).toEqual(liveA);

    const exportA = buildExportSvg(FACETED_SPEC, FACETED_ROWS, {}).outerHTML;
    const exportB = buildExportSvg(FACETED_SPEC, FACETED_ROWS, { hooks: {} }).outerHTML;
    expect(exportB).toBe(exportA);
  });
});
