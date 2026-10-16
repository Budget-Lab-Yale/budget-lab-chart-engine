// @vitest-environment jsdom
//
// Export goldens: pin today's PNG-export SVG (`buildExportSvg`, src/embed/export-png.ts) byte for
// byte, one case per chart type plus the export-specific chrome paths (small multiples, right
// legend, title selectors). The export re-renders from the spec instead of serialising the live
// DOM, so the live-render goldens in golden.test.ts say nothing about it. These goldens let a
// refactor of the export path prove itself output-neutral.
//
// They pin today's output INCLUDING known defects (finding ids from the 2026-10-15 debt review).
// A case marked "expected to change in phase 5" moves only under that phase's named exception.
//
// Text measurement: the same fallback the existing goldens (golden.test.ts) get under jsdom, which
// has no canvas. `measureText` in src/embed/figure-chrome.ts returns `text.length * 8` when
// `getContext("2d")` is null, and the engine's axis code uses its built-in Figtree advance table
// (`measuredLabelWidth`). getContext is stubbed to return null here, as export-frame.test.ts does,
// so the fallback holds even if a canvas package is ever installed.
//
// Serialisation: `serializeExportSvg` (test/helpers/export-golden.ts): XMLSerializer, as `rasterize()`
// uses, with each embedded `data:` payload (font, logo) replaced by its SHA-256 and length.
// Golden files: test/fixtures/export/*.golden.svg. Verify: `npm run goldens`. Record a NEW case
// only with `npm run goldens:record` (scripts/goldens.mjs); never re-record an existing one.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serializeExportSvg as ser } from "./helpers/export-golden";
import { buildExportSvg } from "../src/embed/export-png";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";
import { csvFixtureReader } from "./helpers/csv";

const realGetContext = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
});

const rowsOf = (rs: Array<Record<string, string | number>>): TidyRow[] =>
  rs.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)]))) as unknown as TidyRow[];

// Comma-free CSV fixture reader (same as timeline-golden.test.ts).
const parseCsv = csvFixtureReader(import.meta.url);

const MONTHS = ["2024-01-01", "2024-02-01", "2024-03-01", "2024-04-01", "2024-05-01", "2024-06-01"];
const twoSeriesTemporal = rowsOf(
  MONTHS.flatMap((t, i) => [
    { time: t, series: "Goods", value: 2 + i * 0.5 },
    { time: t, series: "Services", value: 4 - i * 0.25 },
  ]),
);

describe("export goldens — chart types", () => {
  // pins: temporal line, two series, top legend
  it("line (temporal)", async () => {
    const spec = {
      chartType: "line", title: "Prices by category", subtitle: "Percent change",
      source: "BLS, The Budget Lab analysis", note: "Seasonally adjusted.",
      xAxisType: "temporal", value_suffix: "%", data: "d.csv",
    } as ChartSpec;
    const svg = buildExportSvg(spec, twoSeriesTemporal);
    expect(svg.querySelectorAll("path").length).toBeGreaterThan(0);
    await expect(ser(svg)).toMatchFileSnapshot("./fixtures/export/line-temporal.golden.svg");
  });

  // pins: line on a categorical x axis
  it("line (categorical x)", async () => {
    const spec = {
      chartType: "line", title: "Effective rate by quintile", xAxisType: "categorical",
      columns: { x: "q", series: "s", value: "v" }, data: "d.csv",
    } as ChartSpec;
    const rows = rowsOf(["Bottom", "Second", "Middle", "Fourth", "Top"].flatMap((q, i) => [
      { q, s: "Current law", v: 5 + i * 3 },
      { q, s: "Proposal", v: 4 + i * 3.5 },
    ]));
    await expect(ser(buildExportSvg(spec, rows))).toMatchFileSnapshot("./fixtures/export/line-categorical.golden.svg");
  });

  // pins: two-series area, temporal
  it("area", async () => {
    const spec = {
      chartType: "area", title: "Spending by category", subtitle: "Billions of dollars",
      xAxisType: "temporal", data: "d.csv",
    } as ChartSpec;
    await expect(ser(buildExportSvg(spec, twoSeriesTemporal))).toMatchFileSnapshot("./fixtures/export/area.golden.svg");
  });

  // pins: single-series vertical bar with a negative value
  it("bar", async () => {
    const spec = {
      chartType: "bar", title: "Change by sector", xAxisType: "categorical", orientation: "vertical",
      columns: { x: "cat", value: "v" }, source: "The Budget Lab", data: "d.csv",
    } as ChartSpec;
    const rows = rowsOf([["Mining", 3], ["Retail", -2], ["Health", 5], ["Finance", 1]].map(([cat, v]) => ({ cat: cat!, v: v! })));
    await expect(ser(buildExportSvg(spec, rows))).toMatchFileSnapshot("./fixtures/export/bar.golden.svg");
  });

  // pins: grouped horizontal bar (row-sized export height)
  it("grouped bar (horizontal)", async () => {
    const spec = {
      chartType: "bar", title: "Tariff rate by partner", xAxisType: "categorical", orientation: "horizontal",
      columns: { x: "partner", series: "period", value: "rate" }, value_suffix: "%", data: "d.csv",
    } as ChartSpec;
    const rows = rowsOf(["China", "Canada", "Mexico", "EU"].flatMap((partner, i) => [
      { partner, period: "2024", rate: 2 + i },
      { partner, period: "2025", rate: 10 + i * 4 },
    ]));
    await expect(ser(buildExportSvg(spec, rows))).toMatchFileSnapshot("./fixtures/export/bar-grouped-horizontal.golden.svg");
  });

  // pins: vertical stacked bar with a negative series (default barStack)
  it("stacked bar", async () => {
    const spec = {
      chartType: "stacked", title: "Revenue by source", xAxisType: "categorical",
      columns: { x: "yr", series: "src", value: "v" }, data: "d.csv",
    } as ChartSpec;
    const rows = rowsOf(["2026", "2027", "2028"].flatMap((yr, i) => [
      { yr, src: "Income", v: 10 + i },
      { yr, src: "Payroll", v: 6 + i },
      { yr, src: "Excise", v: -2 - i },
    ]));
    await expect(ser(buildExportSvg(spec, rows))).toMatchFileSnapshot("./fixtures/export/stacked.golden.svg");
  });

  // pins: horizontal dumbbell with mixed markers and a coincident row
  it("dumbbell", async () => {
    const spec = {
      chartType: "dumbbell", title: "Effective rate by group", xAxisType: "categorical", orientation: "horizontal",
      columns: { category: "group", series: "measure", value: "rate" },
      series_order: ["current_law", "static", "collected"],
      series_marker: { current_law: "ink", static: "hollow", collected: "filled" },
      value_format: { decimals: 1, suffix: "%" }, data: "d.csv",
    } as unknown as ChartSpec;
    const rows = rowsOf([
      ["Q1", 2.1, 2.1, 2.1], ["Q2", 4.0, 5.2, 4.6], ["Q3", 6.5, 8.0, 7.1], ["Q4", 9.0, 11.5, 10.2], ["Q5", 14.0, 19.5, 16.8],
    ].flatMap(([group, a, b, c]) => [
      { group: group!, measure: "current_law", rate: a! },
      { group: group!, measure: "static", rate: b! },
      { group: group!, measure: "collected", rate: c! },
    ]));
    await expect(ser(buildExportSvg(spec, rows))).toMatchFileSnapshot("./fixtures/export/dumbbell.golden.svg");
  });

  // pins: waterfall with a total bar, increases and decreases
  it("waterfall", async () => {
    const spec = {
      chartType: "waterfall", title: "Price decomposition", xAxisType: "categorical",
      y_axis_title: "Short-run price effect (%)", columns: { x: "step", value: "value", kind: "kind" }, data: "d.csv",
    } as ChartSpec;
    const rows = rowsOf([["Initial", 2.3, "total"], ["A", -0.5, ""], ["B", 0.4, ""], ["C", -0.2, ""]]
      .map(([step, value, kind]) => ({ step: step!, value: value!, kind: kind! })));
    await expect(ser(buildExportSvg(spec, rows))).toMatchFileSnapshot("./fixtures/export/waterfall.golden.svg");
  });

  // pins: raw-binned numeric histogram with explicit bins
  it("histogram", async () => {
    const spec = {
      chartType: "histogram", title: "Distribution of scores", subtitle: "Count", xAxisType: "numeric",
      histogram: { binWidth: 10, domain: [0, 50] }, data: "d.csv",
    } as ChartSpec;
    const rows = rowsOf([3, 7, 11, 13, 15, 17, 21, 23, 25, 25, 27, 29, 31, 33, 35, 37, 41, 43].map((time) => ({ time })));
    await expect(ser(buildExportSvg(spec, rows))).toMatchFileSnapshot("./fixtures/export/histogram.golden.svg");
  });

  // pins: horizontal timeline export frame (timelineExportFrame), reusing the figure-7 fixture
  it("timeline", async () => {
    const spec = {
      chartType: "timeline", title: "Tariff actions", xAxisType: "temporal",
      columns: { x: "date", series: "kind" }, series_colors: { policy: "blue", cohort: "amber" }, data: "d.csv",
    } as ChartSpec;
    const rows = parseCsv("./fixtures/timeline-figure7.csv");
    await expect(ser(buildExportSvg(spec, rows))).toMatchFileSnapshot("./fixtures/export/timeline.golden.svg");
  });

  // pins: flat treemap at the default 460px export cap
  it("treemap", async () => {
    const spec = {
      chartType: "treemap", title: "Shares", xAxisType: "categorical", columns: { x: "cat", value: "v" }, data: "d.csv",
    } as ChartSpec;
    const rows = rowsOf(["Housing", "Food", "Transport", "Health", "Other"].map((cat, i) => ({ cat, v: 10 + i * 7 })));
    await expect(ser(buildExportSvg(spec, rows))).toMatchFileSnapshot("./fixtures/export/treemap.golden.svg");
  });

  // pins: two-series numeric scatter
  it("scatter", async () => {
    const spec = {
      chartType: "scatter", title: "Rate vs revenue", xAxisType: "numeric",
      columns: { x: "x", value: "v", series: "s" }, x_axis_title: "Rate (%)", data: "d.csv",
    } as ChartSpec;
    const rows = rowsOf([1, 2, 3, 4, 5].flatMap((x) => [
      { x, v: x * 2 + 1, s: "Static" },
      { x, v: x * 1.5 + 2, s: "Dynamic" },
    ]));
    await expect(ser(buildExportSvg(spec, rows))).toMatchFileSnapshot("./fixtures/export/scatter.golden.svg");
  });

  // pins: dot plot on a categorical x
  it("dotplot", async () => {
    const spec = {
      chartType: "dotplot", title: "Rate by state", xAxisType: "categorical",
      columns: { x: "st", value: "v", series: "s" }, data: "d.csv",
    } as ChartSpec;
    const rows = rowsOf(["CT", "NY", "NJ", "MA"].flatMap((st, i) => [
      { st, v: 3 + i, s: "2024" },
      { st, v: 4 + i * 1.5, s: "2025" },
    ]));
    await expect(ser(buildExportSvg(spec, rows))).toMatchFileSnapshot("./fixtures/export/dotplot.golden.svg");
  });
});

describe("export goldens — chrome paths", () => {
  // pins: small-multiples figure (three panes, two columns) with pane titles from pane_titles
  it("small multiples with pane titles", async () => {
    const spec = {
      chartType: "line", title: "Employment by region", subtitle: "Index, January 2024 = 100",
      xAxisType: "temporal", columns: { x: "time", series: "series", value: "value", facet: "region" },
      small_multiples: { mode: "shared", columns: 2, pane_titles: { ne: "Northeast", s: "South", w: "West" } },
      source: "BLS", data: "d.csv",
    } as ChartSpec;
    const rows = rowsOf(["ne", "s", "w"].flatMap((region, r) => MONTHS.flatMap((time, i) => [
      { region, time, series: "Goods", value: 100 + i * (r + 1) },
      { region, time, series: "Services", value: 100 - i + r },
    ])));
    const svg = buildExportSvg(spec, rows);
    expect(svg.textContent).toContain("Northeast");
    await expect(ser(svg)).toMatchFileSnapshot("./fixtures/export/small-multiples.golden.svg");
  });

  // pins A1, fixed in phase 5: the legend swatch takes the selector accent the line is drawn in (amber)
  it("title_selectors accent + dashed single series", async () => {
    const spec = {
      chartType: "line", title: "Real GDP by {dimension}", xAxisType: "temporal",
      series_styles: { A: { dashed: true } },
      title_selectors: {
        dimension: {
          options: [
            { id: "sector", label: "Sector", color: "blue" },
            { id: "country", label: "Country", color: "amber" },
          ],
          default: "sector",
        },
      },
      data: "d.csv",
    } as unknown as ChartSpec;
    const rows = rowsOf(MONTHS.map((time, i) => ({ time, series: "A", value: 1 + i })));
    const svg = buildExportSvg(spec, rows, { selections: { dimension: "country" } });
    expect(svg.textContent).toContain("Real GDP by Country");
    await expect(ser(svg)).toMatchFileSnapshot("./fixtures/export/title-selector-accent-dashed.golden.svg");
  });

  // pins: right-hand legend column wrapping a long series label
  it("right legend with a long series label", async () => {
    const LONG = "Cash income including employer-sponsored health insurance and retirement contributions";
    const spec = {
      chartType: "line", title: "Income growth", xAxisType: "temporal", legendPosition: "right",
      series_order: [LONG, "Market income"], data: "d.csv",
    } as ChartSpec;
    const rows = rowsOf(MONTHS.flatMap((time, i) => [
      { time, series: LONG, value: 3 + i * 0.2 },
      { time, series: "Market income", value: 2 + i * 0.3 },
    ]));
    await expect(ser(buildExportSvg(spec, rows))).toMatchFileSnapshot("./fixtures/export/right-legend-long-label.golden.svg");
  });

  // pins A7 (stackOrder + value labels: both labels land in the Gains segment) — expected to change in phase 5
  it("stacked with barStack.stackOrder + value labels", async () => {
    const spec = {
      chartType: "stacked", title: "Revenue by source", xAxisType: "categorical",
      columns: { x: "yr", series: "src", value: "v" },
      series_order: ["Income", "Gains"],
      barStack: { stackOrder: ["Gains", "Income"] },
      valueLabels: { show: true }, data: "d.csv",
    } as ChartSpec;
    const rows = rowsOf([{ yr: "2026", src: "Income", v: 10 }, { yr: "2026", src: "Gains", v: 30 }]);
    await expect(ser(buildExportSvg(spec, rows))).toMatchFileSnapshot("./fixtures/export/stacked-stackorder-labels.golden.svg");
  });
});
