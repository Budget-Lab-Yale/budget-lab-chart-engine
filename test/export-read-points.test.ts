// @vitest-environment jsdom
//
// buildExportSvg reads the caller's `opts.selections` and `opts.hooks` at fixed points: the
// metadata pass's hooks and accent before that pass; the selections (title, final-pass accent)
// after it; the hooks again at each later legend draw and at the final render. Hooks run in between, so a hook that mutates
// caller-owned state is seen by every read after it and by none before it. These tests pin those
// read points: a refactor that resolves a value earlier or later changes what is drawn.
import { describe, it, expect } from "vitest";
import { buildExportSvg } from "../src/embed/export-png";
import type { ChartSpec } from "../src/spec/types";
import type { RenderHooks } from "../src/spec/hooks";
import type { TidyRow } from "../src/data/index";

const SINGLE_ROWS: TidyRow[] = [
  { time: "2024-01-01", series: "A", value: "1.0" },
  { time: "2024-02-01", series: "A", value: "2.0" },
];

const ACCENT_SPEC: ChartSpec = {
  chartType: "line",
  title: "GDP by {dimension}",
  xAxisType: "temporal",
  data: "inline",
  title_selectors: {
    dimension: {
      options: [
        { id: "sector", label: "Sector", color: "blue" },
        { id: "country", label: "Country", color: "amber" },
      ],
      default: "sector",
    },
  },
};

const strokeOf = (svg: SVGSVGElement): string | undefined =>
  svg.querySelector("path[data-series]")?.getAttribute("stroke")?.toLowerCase();

describe("buildExportSvg — caller state mutated by a hook is read where it always was", () => {
  it("a metadata-pass tickLabel that changes selections and replaces hooks reaches the final pass", () => {
    let originalTickCalls = 0;
    let replacementTickCalls = 0;
    let afterRenderCalls = 0;
    const opts: { selections: Record<string, string>; hooks?: RenderHooks } = {
      selections: { dimension: "sector" },
    };
    const replacement: RenderHooks = {
      tickLabel: () => {
        replacementTickCalls++;
        return null;
      },
      afterRender: () => {
        afterRenderCalls++;
      },
    };
    opts.hooks = {
      tickLabel: () => {
        originalTickCalls++;
        // First call happens inside the metadata pass.
        opts.selections.dimension = "country";
        opts.hooks = replacement;
        return null;
      },
    };
    const svg = buildExportSvg(ACCENT_SPEC, SINGLE_ROWS, opts);
    // Selections are read after the metadata pass: title and accent follow the mutation.
    expect(svg.textContent).toContain("GDP by Country");
    expect(strokeOf(svg)).toBe("#e69f00"); // amber
    // The final pass reads `opts.hooks` after the metadata pass: it runs the replacement.
    expect(afterRenderCalls).toBe(1);
    // Every metadata-pass tick goes to the original hook, every final-pass tick to the replacement.
    expect(originalTickCalls).toBe(6);
    expect(replacementTickCalls).toBe(6);
  });

  it("the metadata pass's accent is read before that pass, so its legend rows take it", () => {
    // Pins the read point (A1 gave the metadata pass an accent), not a wanted result: a hook that
    // changes the selections during the metadata pass leaves the legend keyed in the accent read
    // before it, while the final pass draws the series in the accent read after.
    const opts: { selections: Record<string, string>; hooks?: RenderHooks } = {
      selections: { dimension: "sector" },
      hooks: {
        tickLabel: () => {
          opts.selections.dimension = "country";
          return null;
        },
      },
    };
    const spec = { ...ACCENT_SPEC, series_styles: { A: { dashed: true } } } as unknown as ChartSpec;
    const svg = buildExportSvg(spec, SINGLE_ROWS, opts);
    const swatch = [...svg.querySelectorAll("g.tbl-icon line")].find((l) => !l.closest("svg.tblchart"));
    expect(swatch?.getAttribute("style")?.toLowerCase()).toContain("stroke:#0072b2"); // blue, before
    expect(strokeOf(svg)).toBe("#e69f00"); // amber, after
  });

  it("a top-legend legendKey that replaces hooks reaches the final pass", () => {
    const rows: TidyRow[] = [
      { time: "2024-01-01", series: "A", value: "1.0" },
      { time: "2024-02-01", series: "A", value: "2.0" },
      { time: "2024-01-01", series: "B", value: "3.0" },
      { time: "2024-02-01", series: "B", value: "4.0" },
    ];
    const spec: ChartSpec = { chartType: "line", title: "T", xAxisType: "temporal", data: "inline" };
    let legendKeyCalls = 0;
    let afterRenderCalls = 0;
    const opts: { hooks?: RenderHooks } = {};
    const replacement: RenderHooks = {
      afterRender: () => {
        afterRenderCalls++;
      },
    };
    opts.hooks = {
      legendKey: () => {
        legendKeyCalls++;
        opts.hooks = replacement;
        return null;
      },
    };
    buildExportSvg(spec, rows, opts);
    // Both legend rows are drawn with the hooks read at the legend draw (the original object is
    // read once for the whole legend); the final render reads `opts.hooks` after it.
    expect(legendKeyCalls).toBe(2);
    expect(afterRenderCalls).toBe(1);
  });
});
