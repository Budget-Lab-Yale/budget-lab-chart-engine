// @vitest-environment jsdom
//
// A1 (review 2026-10-15): the PNG export's legend keys a single series in the title-selector accent
// it is drawn in. `buildExportSvg` renders twice: a metadata pass whose legend rows it draws, then
// the final pass it keeps. Only the final pass was given the accent, so the line came out amber and
// its legend swatch blue. Each case reads the swatch colour and the plotted line colour from the
// same export and requires them equal, and equal to the active option's colour.
import { describe, it, expect } from "vitest";
import { buildExportSvg } from "../src/embed/export-png";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const AMBER = "#e69f00";
const MONTHS = ["2024-01-01", "2024-02-01", "2024-03-01", "2024-04-01"];
const rowsOf = (rs: Array<Record<string, string | number>>): TidyRow[] =>
  rs.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)]))) as unknown as TidyRow[];

const SELECTORS = {
  title: "Real GDP by {dimension}",
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

const single = (extra: Record<string, unknown> = {}): ChartSpec =>
  ({
    chartType: "line", xAxisType: "temporal", data: "d.csv",
    series_styles: { A: { dashed: true } }, ...SELECTORS, ...extra,
  }) as unknown as ChartSpec;
const singleRows = rowsOf(MONTHS.map((time, i) => ({ time, series: "A", value: 1 + i })));

const figure = (): ChartSpec =>
  ({
    chartType: "line", xAxisType: "temporal", data: "d.csv",
    columns: { x: "time", series: "series", value: "value", facet: "region" },
    small_multiples: { columns: 2 },
    series_styles: { A: { dashed: true } }, ...SELECTORS,
  }) as unknown as ChartSpec;
const figureRows = rowsOf(
  ["ne", "s"].flatMap((region, r) => MONTHS.map((time, i) => ({ region, time, series: "A", value: 1 + i + r }))),
);

/** The colour of every legend swatch the export draws (its `g.tbl-icon` rows, outside the plot). */
function swatchColors(svg: SVGSVGElement): string[] {
  return [...svg.querySelectorAll("g.tbl-icon")]
    .filter((g) => !g.closest("svg.tblchart"))
    .flatMap((g) => [...g.querySelectorAll("line, rect, path, circle")])
    .map((el) => {
      const style = el.getAttribute("style") ?? "";
      const m = /stroke:\s*(#[0-9a-fA-F]{6})/.exec(style) ?? /fill:\s*(#[0-9a-fA-F]{6})/.exec(style);
      return (m?.[1] ?? el.getAttribute("stroke") ?? el.getAttribute("fill") ?? "").toLowerCase();
    })
    .filter((c) => c.startsWith("#"));
}

function lineColors(svg: SVGSVGElement): string[] {
  return [...svg.querySelectorAll('path[data-series="A"]')].map((p) => (p.getAttribute("stroke") ?? "").toLowerCase());
}

function expectKeyedInAccent(svg: SVGSVGElement): void {
  const lines = lineColors(svg);
  const swatches = swatchColors(svg);
  expect(lines.length).toBeGreaterThan(0);
  expect(swatches.length).toBeGreaterThan(0);
  expect(new Set(lines)).toEqual(new Set([AMBER]));
  expect(new Set(swatches)).toEqual(new Set([AMBER]));
}

describe("buildExportSvg — the legend keys a single series in the title-selector accent (A1)", () => {
  it("single chart, top legend", () => {
    expectKeyedInAccent(buildExportSvg(single(), singleRows, { selections: { dimension: "country" } }));
  });

  it("single chart, right legend", () => {
    const svg = buildExportSvg(single({ legendPosition: "right" }), singleRows, { selections: { dimension: "country" } });
    // The swatch is in the right-hand column, beside the plot rather than above it.
    const plotX = Number(svg.querySelector("svg.tblchart")?.getAttribute("x"));
    const icon = [...svg.querySelectorAll("g.tbl-icon")].find((g) => !g.closest("svg.tblchart"));
    const iconX = Number(/translate\(([\d.]+)/.exec(icon?.getAttribute("transform") ?? "")?.[1]);
    expect(iconX).toBeGreaterThan(plotX + 500);
    expectKeyedInAccent(svg);
  });

  it("single chart, the default option's accent when no selections are given", () => {
    const spec = single();
    (spec.title_selectors as Record<string, { default: string }>).dimension!.default = "country";
    expectKeyedInAccent(buildExportSvg(spec, singleRows));
  });

  it("small-multiples figure, figure-level legend", () => {
    const svg = buildExportSvg(figure(), figureRows, { selections: { dimension: "country" } });
    expect(lineColors(svg).length).toBe(2);
    expectKeyedInAccent(svg);
  });
});
