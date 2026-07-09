// @vitest-environment jsdom
//
// Export surfaces for the inline title selector: the PNG export SVG title (active label as
// plain text, never a raw brace token) and the standalone HTML page <title> (defaults-resolved).
import { describe, it, expect } from "vitest";
import { buildExportSvg } from "../src/embed/export-png";
import { buildStandaloneHtml } from "../src/embed/bundle-standalone";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const ROWS: TidyRow[] = [
  { time: "2024-01-01", series: "A", value: "1.0" },
  { time: "2024-02-01", series: "A", value: "2.0" },
];

const SPEC: ChartSpec = {
  chartType: "line",
  title: "GDP by {dimension}",
  xAxisType: "temporal",
  data: "inline",
  title_selectors: {
    dimension: {
      options: [
        { id: "sector", label: "Sector" },
        { id: "country", label: "Country" },
      ],
      default: "sector",
    },
  },
};

const svgText = (svg: SVGSVGElement): string =>
  Array.from(svg.querySelectorAll("text"))
    .map((t) => t.textContent ?? "")
    .join("\n");

describe("buildExportSvg — title selector", () => {
  it("with selections: the exported title shows the ACTIVE option's label", () => {
    const svg = buildExportSvg(SPEC, ROWS, { selections: { dimension: "country" } });
    expect(svgText(svg)).toContain("GDP by Country");
  });

  it("without selections: the title resolves with the spec defaults (not the raw token)", () => {
    const svg = buildExportSvg(SPEC, ROWS);
    const text = svgText(svg);
    expect(text).toContain("GDP by Sector");
    expect(text).not.toContain("{dimension}");
  });

  it("no braces anywhere in the serialized export", () => {
    const svg = buildExportSvg(SPEC, ROWS, { selections: { dimension: "sector" } });
    const texts = Array.from(svg.querySelectorAll("text")).map((t) => t.textContent ?? "");
    for (const t of texts) expect(t).not.toMatch(/\{[A-Za-z0-9_-]+\}/);
  });

  it("a spec without title_selectors exports its title verbatim", () => {
    const plain: ChartSpec = { chartType: "line", title: "Plain Title", xAxisType: "temporal", data: "inline" };
    const svg = buildExportSvg(plain, ROWS);
    expect(svgText(svg)).toContain("Plain Title");
  });
});

describe("buildExportSvg — title selector color accent (single-series only)", () => {
  const SINGLE_SERIES_SPEC: ChartSpec = {
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

  it("a single-series chart's exported line adopts the active option's resolved color", () => {
    const svgDefault = buildExportSvg(SINGLE_SERIES_SPEC, ROWS);
    const pathDefault = svgDefault.querySelector('path[data-series]');
    expect(pathDefault?.getAttribute("stroke")?.toLowerCase()).toBe("#0072b2"); // blue

    const svgCountry = buildExportSvg(SINGLE_SERIES_SPEC, ROWS, { selections: { dimension: "country" } });
    const pathCountry = svgCountry.querySelector('path[data-series]');
    expect(pathCountry?.getAttribute("stroke")?.toLowerCase()).toBe("#e69f00"); // amber
  });

  it("a multi-series chart's exported series colors are untouched by the selector's color", () => {
    const multiSeriesRows: TidyRow[] = [
      { time: "2024-01-01", series: "Sector", value: "1.0" },
      { time: "2024-02-01", series: "Sector", value: "2.0" },
      { time: "2024-01-01", series: "Country", value: "3.0" },
      { time: "2024-02-01", series: "Country", value: "4.0" },
    ];
    const spec: ChartSpec = { ...SINGLE_SERIES_SPEC, series_order: ["Sector", "Country"] };
    const svgDefault = buildExportSvg(spec, multiSeriesRows);
    const svgCountry = buildExportSvg(spec, multiSeriesRows, { selections: { dimension: "country" } });
    const strokesOf = (svg: SVGSVGElement): (string | null)[] =>
      Array.from(svg.querySelectorAll("path[data-series]"))
        .map((p) => p.getAttribute("stroke")?.toLowerCase() ?? null)
        .sort();
    expect(strokesOf(svgCountry)).toEqual(strokesOf(svgDefault));
  });
});

describe("buildStandaloneHtml — page <title> resolves tokens with defaults", () => {
  const common = { rows: ROWS, liveBundleJs: "/*bundle*/", css: "/*css*/" };

  it("resolves the {token} to the default option's label", () => {
    const html = buildStandaloneHtml({ spec: SPEC, ...common });
    expect(html).toContain("<title>GDP by Sector</title>");
    expect(html).not.toContain("<title>GDP by {dimension}</title>");
  });

  it("an explicit `title` input is also token-resolved against the spec's selectors", () => {
    const html = buildStandaloneHtml({ spec: SPEC, ...common, title: "Override by {dimension}" });
    expect(html).toContain("<title>Override by Sector</title>");
  });

  it("a spec without title_selectors keeps its literal title", () => {
    const plain: ChartSpec = { chartType: "line", title: "Plain Title", xAxisType: "temporal", data: "inline" };
    const html = buildStandaloneHtml({ spec: plain, ...common });
    expect(html).toContain("<title>Plain Title</title>");
  });
});
