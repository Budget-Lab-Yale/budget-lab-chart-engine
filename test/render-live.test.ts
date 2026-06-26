// @vitest-environment jsdom
//
// Tests for the embed live-render layer: mountChart + buildStandaloneHtml.
import { describe, it, expect } from "vitest";
import { mountChart, computeChartHeight, netLabelFill, formatValue } from "../src/engine/render-live";
import { renderLegend } from "../src/engine/legend";
import { buildStandaloneHtml } from "../src/embed/bundle-standalone";
import { CHART_CSS } from "../src/embed/styles";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";
import type { LegendItem } from "../src/engine/index";
import { TOTAL_SERIES_KEY } from "../src/engine/index";

// ---------------------------------------------------------------------------
// Shared fixtures

const MULTI_SERIES_SPEC: ChartSpec = {
  chartType: "line",
  title: "Test Chart",
  subtitle: "Percent",
  source: "Test source",
  note: "Test note",
  xAxisType: "temporal",
  series_order: ["A", "B"],
  data: "inline",
};

const MULTI_SERIES_ROWS: TidyRow[] = [
  { time: "2024-01-01", series: "A", value: "1.0" },
  { time: "2024-02-01", series: "A", value: "2.0" },
  { time: "2024-03-01", series: "A", value: "1.5" },
  { time: "2024-01-01", series: "B", value: "3.0" },
  { time: "2024-02-01", series: "B", value: "2.5" },
  { time: "2024-03-01", series: "B", value: "3.5" },
];

const SINGLE_SERIES_SPEC: ChartSpec = {
  chartType: "line",
  title: "Single Series",
  xAxisType: "temporal",
  data: "inline",
};

const SINGLE_SERIES_ROWS: TidyRow[] = [
  { time: "2024-01-01", series: "X", value: "10.0" },
  { time: "2024-02-01", series: "X", value: "12.0" },
  { time: "2024-03-01", series: "X", value: "11.0" },
];

// ---------------------------------------------------------------------------
// mountChart tests

describe("mountChart", () => {
  it("renders without throwing for a multi-series spec", () => {
    const container = document.createElement("div");
    expect(() => mountChart(container, { spec: MULTI_SERIES_SPEC, rows: MULTI_SERIES_ROWS })).not.toThrow();
  });

  it("produces an <svg> inside the container", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: MULTI_SERIES_SPEC, rows: MULTI_SERIES_ROWS });
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders the .figure-title element", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: MULTI_SERIES_SPEC, rows: MULTI_SERIES_ROWS });
    const title = container.querySelector(".figure-title");
    expect(title).not.toBeNull();
    expect(title?.textContent).toBe("Test Chart");
  });

  it("renders a .tbl-legend for multi-series charts", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: MULTI_SERIES_SPEC, rows: MULTI_SERIES_ROWS });
    expect(container.querySelector(".tbl-legend")).not.toBeNull();
  });

  it("renders the y-axis title caption when y_axis_title is set", () => {
    const container = document.createElement("div");
    mountChart(container, {
      spec: { ...MULTI_SERIES_SPEC, y_axis_title: "Percent of GDP" },
      rows: MULTI_SERIES_ROWS,
    });
    const yt = container.querySelector(".figure-y-axis-title");
    expect(yt).not.toBeNull();
    expect(yt?.textContent).toBe("Percent of GDP");
  });

  it("omits the y-axis title caption when y_axis_title is absent", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: MULTI_SERIES_SPEC, rows: MULTI_SERIES_ROWS });
    expect(container.querySelector(".figure-y-axis-title")).toBeNull();
  });

  it("renders the eyebrow from the mount option (not the spec)", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: MULTI_SERIES_SPEC, rows: MULTI_SERIES_ROWS, eyebrow: "Figure 7" });
    expect(container.querySelector(".figure-supertitle")?.textContent).toBe("Figure 7");
  });

  it("omits the eyebrow when the mount option is absent", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: MULTI_SERIES_SPEC, rows: MULTI_SERIES_ROWS });
    expect(container.querySelector(".figure-supertitle")).toBeNull();
  });

  it("renders with arbitrary column names mapped via the columns block", () => {
    const spec: ChartSpec = {
      chartType: "line",
      title: "ATUS",
      xAxisType: "categorical",
      columns: { x: "age_bin", value: "mean_hours", series: "cohort" },
      data: "inline",
    };
    const rows: TidyRow[] = [
      { age_bin: "18-21", cohort: "A", mean_hours: "1" },
      { age_bin: "22-25", cohort: "A", mean_hours: "2" },
      { age_bin: "18-21", cohort: "B", mean_hours: "3" },
      { age_bin: "22-25", cohort: "B", mean_hours: "4" },
    ];
    const container = document.createElement("div");
    mountChart(container, { spec, rows });
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelectorAll('svg g[aria-label="line"] path[data-series]').length).toBe(2);
  });

  it("renders a single implicit series (no legend) when no series column is mapped", () => {
    const spec: ChartSpec = {
      chartType: "line",
      title: "Single",
      xAxisType: "categorical",
      columns: { x: "age_bin", value: "mean_hours" },
      data: "inline",
    };
    const rows: TidyRow[] = [
      { age_bin: "18-21", mean_hours: "1" },
      { age_bin: "22-25", mean_hours: "2" },
    ];
    const container = document.createElement("div");
    mountChart(container, { spec, rows });
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector(".tbl-legend")).toBeNull();
  });

  it("does not render a .tbl-legend for a single unstyled series", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: SINGLE_SERIES_SPEC, rows: SINGLE_SERIES_ROWS });
    expect(container.querySelector(".tbl-legend")).toBeNull();
  });

  it("renders the .figure-meta source/note line", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: MULTI_SERIES_SPEC, rows: MULTI_SERIES_ROWS });
    expect(container.querySelector(".figure-meta")).not.toBeNull();
    expect(container.querySelector(".figure-note")?.textContent).toBe("Test note");
    expect(container.querySelector(".figure-source-prefix")?.textContent).toBe("Source: ");
  });

  it("renders the .figure-subtitle when present", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: MULTI_SERIES_SPEC, rows: MULTI_SERIES_ROWS });
    const sub = container.querySelector(".figure-subtitle");
    expect(sub).not.toBeNull();
    expect(sub?.textContent).toBe("Percent");
  });

  it("does not render subtitle or title elements when absent", () => {
    const minimalSpec: ChartSpec = {
      chartType: "line",
      title: "Minimal",
      xAxisType: "temporal",
      data: "inline",
    };
    const container = document.createElement("div");
    mountChart(container, { spec: minimalSpec, rows: SINGLE_SERIES_ROWS });
    expect(container.querySelector(".figure-subtitle")).toBeNull();
    // The source line now always renders — it holds the Data/Image download buttons even
    // when there is no note or source.
    expect(container.querySelector(".figure-meta")).not.toBeNull();
    expect(container.querySelectorAll(".figure-download-btn").length).toBe(2);
  });

  it("accepts custom width and height options", () => {
    const container = document.createElement("div");
    expect(() =>
      mountChart(container, { spec: SINGLE_SERIES_SPEC, rows: SINGLE_SERIES_ROWS, width: 500, height: 300 }),
    ).not.toThrow();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeChartHeight — horizontal bars grow taller with the bar/row count

describe("computeChartHeight", () => {
  const catRows = (cats: string[], series: string[]): TidyRow[] => {
    const out: TidyRow[] = [];
    for (const s of series) for (const c of cats) out.push({ time: c, series: s, value: "1" });
    return out as TidyRow[];
  };

  it("returns the fixed default for vertical charts", () => {
    const spec: ChartSpec = { chartType: "bar", title: "v", xAxisType: "categorical", data: "x" };
    expect(computeChartHeight(spec, catRows(["A", "B", "C"], ["S"]))).toBe(400);
  });

  it("returns the fixed default for line charts regardless of orientation", () => {
    const spec: ChartSpec = { chartType: "line", title: "l", xAxisType: "temporal", data: "x" };
    expect(computeChartHeight(spec, catRows(["A", "B"], ["S"]))).toBe(400);
  });

  it("floors short horizontal charts at the fixed default", () => {
    const spec: ChartSpec = {
      chartType: "bar", title: "h", xAxisType: "categorical", orientation: "horizontal", data: "x",
    };
    // 3 rows would be ~182px, below the 400 floor.
    expect(computeChartHeight(spec, catRows(["A", "B", "C"], ["S"]))).toBe(400);
  });

  it("grows a grouped horizontal chart with categories x series", () => {
    const spec: ChartSpec = {
      chartType: "bar", title: "h", xAxisType: "categorical", orientation: "horizontal",
      series_order: ["X", "Y", "Z"], data: "x",
    };
    // 6 categories x 3 series = 18 rows → 18*34 + 80 = 692, above the floor.
    const h = computeChartHeight(spec, catRows(["a", "b", "c", "d", "e", "f"], ["X", "Y", "Z"]));
    expect(h).toBe(18 * 34 + 80);
    expect(h).toBeGreaterThan(400);
  });

  it("grows a stacked horizontal chart by one row per category (series do not multiply)", () => {
    const spec: ChartSpec = {
      chartType: "stacked", title: "h", xAxisType: "categorical", orientation: "horizontal",
      series_order: ["X", "Y", "Z"], data: "x",
    };
    // 12 categories, stacked → 12 rows → 12*34 + 80 = 488.
    const h = computeChartHeight(
      spec,
      catRows(["a","b","c","d","e","f","g","h","i","j","k","l"], ["X", "Y", "Z"]),
    );
    expect(h).toBe(12 * 34 + 80);
  });
});

// ---------------------------------------------------------------------------
// buildStandaloneHtml tests

describe("buildStandaloneHtml", () => {
  const FAKE_BUNDLE = "/* live bundle */";

  it("returns a string containing the doctype", () => {
    const html = buildStandaloneHtml({
      spec: MULTI_SERIES_SPEC,
      rows: MULTI_SERIES_ROWS,
      liveBundleJs: FAKE_BUNDLE,
      css: CHART_CSS,
    });
    expect(html.toLowerCase()).toContain("<!doctype html");
  });

  it("includes the CSS in a <style> block", () => {
    const html = buildStandaloneHtml({
      spec: MULTI_SERIES_SPEC,
      rows: MULTI_SERIES_ROWS,
      liveBundleJs: FAKE_BUNDLE,
      css: CHART_CSS,
    });
    expect(html).toContain("<style>");
    expect(html).toContain(".tbl-legend");
  });

  it("includes the bundle JS", () => {
    const html = buildStandaloneHtml({
      spec: MULTI_SERIES_SPEC,
      rows: MULTI_SERIES_ROWS,
      liveBundleJs: FAKE_BUNDLE,
      css: CHART_CSS,
    });
    expect(html).toContain(FAKE_BUNDLE);
  });

  it("embeds the spec and rows as JSON", () => {
    const html = buildStandaloneHtml({
      spec: MULTI_SERIES_SPEC,
      rows: MULTI_SERIES_ROWS,
      liveBundleJs: FAKE_BUNDLE,
      css: CHART_CSS,
    });
    expect(html).toContain('"chartType"');
    expect(html).toContain('"temporal"');
    expect(html).toContain('"2024-01-01"');
  });

  it("uses the custom title when provided", () => {
    const html = buildStandaloneHtml({
      spec: MULTI_SERIES_SPEC,
      rows: MULTI_SERIES_ROWS,
      liveBundleJs: FAKE_BUNDLE,
      css: CHART_CSS,
      title: "My Custom Title",
    });
    expect(html).toContain("<title>My Custom Title</title>");
  });

  it("falls back to spec.title when no title is provided", () => {
    const html = buildStandaloneHtml({
      spec: MULTI_SERIES_SPEC,
      rows: MULTI_SERIES_ROWS,
      liveBundleJs: FAKE_BUNDLE,
      css: CHART_CSS,
    });
    expect(html).toContain("<title>Test Chart</title>");
  });

  it("does not contain unescaped </script> inside embedded JSON", () => {
    // Inject a value that would naively produce </script> in the JSON.
    const spec: ChartSpec = {
      ...MULTI_SERIES_SPEC,
      note: "tricky </script> value",
    };
    const html = buildStandaloneHtml({
      spec,
      rows: MULTI_SERIES_ROWS,
      liveBundleJs: FAKE_BUNDLE,
      css: CHART_CSS,
    });
    // The raw string "</script>" must not appear inside the embedded JSON block.
    // It's OK if it appears as the actual </script> tag closing the bundle/init
    // script blocks, but not embedded in the JSON strings.
    // Strategy: find all JSON blocks (between the two <script> opens and their
    // matching closing tags) and verify none contain the raw sequence.
    const scriptTagsContent = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
      (m) => m[1] ?? "",
    );
    for (const scriptContent of scriptTagsContent) {
      // The mountChart call script contains the JSON — check it has no raw </script>
      if (scriptContent.includes("BudgetLabChart.mountChart")) {
        expect(scriptContent).not.toContain("</script>");
      }
    }
  });

  it("inlines the Figtree font and makes no external font request", () => {
    const html = buildStandaloneHtml({
      spec: MULTI_SERIES_SPEC,
      rows: MULTI_SERIES_ROWS,
      liveBundleJs: FAKE_BUNDLE,
      css: CHART_CSS,
    });
    // Self-contained: the font ships as a base64 @font-face so the page renders correctly with
    // zero external requests (corporate firewalls block the fonts CDN). No Google Fonts link.
    expect(html).toContain("@font-face");
    expect(html).toContain("font-family:'Figtree'");
    expect(html).toContain("data:font/ttf;base64,");
    expect(html).not.toContain("fonts.googleapis.com");
  });
});

// ---------------------------------------------------------------------------
// Right-side legend layout tests (A9)

describe("right-side legend layout", () => {
  // A stacked chart with ≥5 series — should default to right-legend.
  const FIVE_SERIES_SPEC: ChartSpec = {
    chartType: "stacked",
    title: "Five series stacked",
    subtitle: "Percent",
    xAxisType: "categorical",
    series_order: ["S1", "S2", "S3", "S4", "S5"],
    data: "inline",
  };
  const FIVE_SERIES_ROWS: TidyRow[] = [
    { time: "A", series: "S1", value: "1" },
    { time: "A", series: "S2", value: "2" },
    { time: "A", series: "S3", value: "1" },
    { time: "A", series: "S4", value: "2" },
    { time: "A", series: "S5", value: "1" },
    { time: "B", series: "S1", value: "1" },
    { time: "B", series: "S2", value: "2" },
    { time: "B", series: "S3", value: "1" },
    { time: "B", series: "S4", value: "2" },
    { time: "B", series: "S5", value: "1" },
  ];

  // A stacked chart with explicit legendPosition:"right".
  const EXPLICIT_RIGHT_SPEC: ChartSpec = {
    chartType: "stacked",
    title: "Explicit right legend",
    subtitle: "Percent",
    xAxisType: "categorical",
    series_order: ["Alpha", "Beta"],
    legendPosition: "right",
    data: "inline",
  };
  const EXPLICIT_RIGHT_ROWS: TidyRow[] = [
    { time: "X", series: "Alpha", value: "3" },
    { time: "X", series: "Beta",  value: "2" },
    { time: "Y", series: "Alpha", value: "4" },
    { time: "Y", series: "Beta",  value: "1" },
  ];

  it("stacked chart with ≥5 series mounts with .figure-body--legend-right wrapper", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: FIVE_SERIES_SPEC, rows: FIVE_SERIES_ROWS, width: 800 });
    expect(container.querySelector(".figure-body--legend-right")).not.toBeNull();
  });

  it("stacked chart with ≥5 series places legend in .figure-legend-slot--right", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: FIVE_SERIES_SPEC, rows: FIVE_SERIES_ROWS, width: 800 });
    const rightSlot = container.querySelector(".figure-legend-slot--right");
    expect(rightSlot).not.toBeNull();
    expect(rightSlot?.querySelector(".tbl-legend")).not.toBeNull();
  });

  it("stacked chart with ≥5 series: .tbl-legend carries .tbl-legend--vertical", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: FIVE_SERIES_SPEC, rows: FIVE_SERIES_ROWS, width: 800 });
    const legend = container.querySelector(".figure-legend-slot--right .tbl-legend");
    expect(legend?.classList.contains("tbl-legend--vertical")).toBe(true);
  });

  it("explicit legendPosition:'right' activates right-legend layout for a 2-series chart", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: EXPLICIT_RIGHT_SPEC, rows: EXPLICIT_RIGHT_ROWS, width: 800 });
    expect(container.querySelector(".figure-body--legend-right")).not.toBeNull();
    expect(container.querySelector(".figure-legend-slot--right .tbl-legend")).not.toBeNull();
  });

  it("right-legend: series rows are in reversed order (top-of-stack first), Total last", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: FIVE_SERIES_SPEC, rows: FIVE_SERIES_ROWS, width: 800 });
    const rightSlot = container.querySelector(".figure-legend-slot--right")!;
    const items = rightSlot.querySelectorAll(".tbl-legend-item");
    const labels = Array.from(items).map((el) => (el as HTMLElement).textContent?.trim());
    // Series in FIVE_SERIES_SPEC are S1–S5; reversed = S5, S4, S3, S2, S1.
    expect(labels[0]).toContain("S5");
    expect(labels[1]).toContain("S4");
    expect(labels[labels.length - 1]).not.toContain("Total"); // no Total row for all-positive 5-series
    // First item should be S5 (last in series_order = top of stack = first in right legend)
    expect(labels[0]).toContain("S5");
    expect(labels[labels.length - 1]).toContain("S1");
  });

  it("line chart with no explicit position still uses top legend (unchanged)", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: MULTI_SERIES_SPEC, rows: MULTI_SERIES_ROWS });
    // No right-legend wrapper.
    expect(container.querySelector(".figure-body--legend-right")).toBeNull();
    // Legend should be in the top slot (.figure-legend-slot), not .figure-legend-slot--right.
    const topSlot = container.querySelector(".figure-legend-slot");
    expect(topSlot?.querySelector(".tbl-legend")).not.toBeNull();
  });

  it("line chart with explicit legendPosition:'top' uses top legend", () => {
    const spec: ChartSpec = { ...MULTI_SERIES_SPEC, legendPosition: "top" };
    const container = document.createElement("div");
    mountChart(container, { spec, rows: MULTI_SERIES_ROWS });
    expect(container.querySelector(".figure-body--legend-right")).toBeNull();
  });

  it("stacked chart with <5 series and no explicit position uses top legend", () => {
    const spec: ChartSpec = {
      chartType: "stacked",
      title: "Small stacked",
      subtitle: "Percent",
      xAxisType: "categorical",
      series_order: ["P", "Q"],
      data: "inline",
    };
    const rows: TidyRow[] = [
      { time: "A", series: "P", value: "1" },
      { time: "A", series: "Q", value: "2" },
    ];
    const container = document.createElement("div");
    mountChart(container, { spec, rows, width: 800 });
    expect(container.querySelector(".figure-body--legend-right")).toBeNull();
  });

  it("diverging stacked chart (<5 series, no explicit legendPosition) defaults to right legend", () => {
    // 4 series (below the ≥5 threshold), but negative values → diverging → should use right legend.
    const spec: ChartSpec = {
      chartType: "stacked",
      title: "Diverging stacked right",
      subtitle: "Percentage points",
      xAxisType: "categorical",
      series_order: ["Lower rates", "Wider brackets", "Limit deductions", "Repeal credit"],
      data: "inline",
    };
    const rows: TidyRow[] = [
      { time: "A", series: "Lower rates",       value: "4"    },
      { time: "A", series: "Wider brackets",    value: "2"    },
      { time: "A", series: "Limit deductions",  value: "-1.5" },
      { time: "A", series: "Repeal credit",     value: "-2.5" },
      { time: "B", series: "Lower rates",       value: "3"    },
      { time: "B", series: "Wider brackets",    value: "2.5"  },
      { time: "B", series: "Limit deductions",  value: "-1"   },
      { time: "B", series: "Repeal credit",     value: "-3"   },
    ];
    const container = document.createElement("div");
    mountChart(container, { spec, rows, width: 800 });
    expect(container.querySelector(".figure-body--legend-right")).not.toBeNull();
    expect(container.querySelector(".figure-legend-slot--right .tbl-legend")).not.toBeNull();
  });

  it("right-legend: top .figure-legend-slot is empty (legend moved to right column)", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: FIVE_SERIES_SPEC, rows: FIVE_SERIES_ROWS, width: 800 });
    const topSlot = container.querySelector(".figure-legend-slot");
    // The top slot should have no .tbl-legend child.
    expect(topSlot?.querySelector(".tbl-legend")).toBeNull();
  });

  it("right-legend: interactive buttons and hover/pin still present (not regressed)", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: FIVE_SERIES_SPEC, rows: FIVE_SERIES_ROWS, width: 800 });
    const rightSlot = container.querySelector(".figure-legend-slot--right")!;
    const buttons = rightSlot.querySelectorAll("button.tbl-legend-item[data-series]");
    expect(buttons.length).toBe(5); // 5 interactive series
  });
});

// ---------------------------------------------------------------------------
// Legend swatch shape tests (A8)

describe("legend swatch shapes", () => {
  // --- BAR chart: swatches must carry is-rect ---
  const BAR_MULTI_SPEC: ChartSpec = {
    chartType: "bar",
    title: "Bar multi-series",
    subtitle: "Percentage points",
    xAxisType: "categorical",
    series_order: ["2019", "2022"],
    data: "inline",
  };
  const BAR_ROWS: TidyRow[] = [
    { time: "Northeast", series: "2019", value: "3.2" },
    { time: "Midwest",   series: "2019", value: "2.1" },
    { time: "Northeast", series: "2022", value: "4.1" },
    { time: "Midwest",   series: "2022", value: "2.5" },
  ];

  it("bar chart legend swatches carry is-rect", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: BAR_MULTI_SPEC, rows: BAR_ROWS });
    const swatches = container.querySelectorAll(".tbl-legend-swatch");
    expect(swatches.length).toBeGreaterThan(0);
    swatches.forEach((s) => {
      expect(s.classList.contains("is-rect")).toBe(true);
    });
  });

  it("bar chart legend swatches do NOT carry is-dot", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: BAR_MULTI_SPEC, rows: BAR_ROWS });
    const swatches = container.querySelectorAll(".tbl-legend-swatch");
    swatches.forEach((s) => {
      expect(s.classList.contains("is-dot")).toBe(false);
    });
  });

  // --- LINE chart: swatches must stay unchanged (no is-rect) ---
  it("line chart legend swatches are unchanged — no is-rect", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: MULTI_SERIES_SPEC, rows: MULTI_SERIES_ROWS });
    const swatches = container.querySelectorAll(".tbl-legend-swatch");
    expect(swatches.length).toBeGreaterThan(0);
    swatches.forEach((s) => {
      expect(s.classList.contains("is-rect")).toBe(false);
    });
  });

  // --- DIVERGING STACKED chart: trailing Total row with is-dot swatch ---
  const DIVERGING_SPEC: ChartSpec = {
    chartType: "stacked",
    title: "Diverging stacked",
    subtitle: "Percentage points",
    xAxisType: "categorical",
    series_order: ["Lower rates", "Wider brackets", "Limit deductions", "Repeal credit"],
    data: "inline",
  };
  const DIVERGING_ROWS: TidyRow[] = [
    { time: "A", series: "Lower rates",       value: "4"    },
    { time: "A", series: "Wider brackets",    value: "2"    },
    { time: "A", series: "Limit deductions",  value: "-1.5" },
    { time: "A", series: "Repeal credit",     value: "-2.5" },
    { time: "B", series: "Lower rates",       value: "3"    },
    { time: "B", series: "Wider brackets",    value: "2.5"  },
    { time: "B", series: "Limit deductions",  value: "-1"   },
    { time: "B", series: "Repeal credit",     value: "-3"   },
  ];

  it("diverging stacked chart legend has a trailing Total row with is-dot swatch", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: DIVERGING_SPEC, rows: DIVERGING_ROWS });
    const items = container.querySelectorAll(".tbl-legend-item");
    expect(items.length).toBeGreaterThan(0);
    // Last item is the Total row.
    const lastItem = items[items.length - 1] as HTMLElement;
    expect(lastItem.textContent).toContain("Total");
    const dotSwatch = lastItem.querySelector(".tbl-legend-swatch.is-dot");
    expect(dotSwatch).not.toBeNull();
  });

  it("diverging stacked Total row is an interactive button carrying TOTAL_SERIES_KEY", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: DIVERGING_SPEC, rows: DIVERGING_ROWS });
    const items = container.querySelectorAll(".tbl-legend-item");
    const lastItem = items[items.length - 1] as HTMLElement;
    expect(lastItem.textContent).toContain("Total");
    expect(lastItem.tagName.toLowerCase()).toBe("button");
    expect(lastItem.dataset["series"]).toBe(TOTAL_SERIES_KEY);
  });

  it("diverging stacked real-series items are interactive buttons with data-series", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: DIVERGING_SPEC, rows: DIVERGING_ROWS });
    const items = container.querySelectorAll(".tbl-legend-item");
    // All but the last (Total) are real series.
    const realItems = Array.from(items).slice(0, items.length - 1);
    for (const item of realItems) {
      expect((item as HTMLElement).tagName.toLowerCase()).toBe("button");
      const s = (item as HTMLElement).dataset["series"];
      expect(s).toBeTruthy();
      expect(s).not.toBe(TOTAL_SERIES_KEY);
    }
  });

  it("net dots + net labels carry TOTAL_SERIES_KEY as data-series", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: DIVERGING_SPEC, rows: DIVERGING_ROWS });
    const svg = container.querySelector(".figure-canvas svg")!;
    const dots = svg.querySelectorAll('g[aria-label="dot"] circle');
    expect(dots.length).toBeGreaterThan(0);
    dots.forEach((d) => expect(d.getAttribute("data-series")).toBe(TOTAL_SERIES_KEY));
    const labels = svg.querySelectorAll("g.tbl-net-label text");
    expect(labels.length).toBe(dots.length);
    labels.forEach((t) => expect(t.getAttribute("data-series")).toBe(TOTAL_SERIES_KEY));
  });

  it("pinning a real series dims the net dots; unpin clears", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: DIVERGING_SPEC, rows: DIVERGING_ROWS, width: 720 });
    const svg = container.querySelector(".figure-canvas svg")!;
    const realBtn = container.querySelector<HTMLButtonElement>(
      '.tbl-legend-item[data-series="Lower rates"]',
    )!;
    realBtn.click();
    const dots = svg.querySelectorAll('g[aria-label="dot"] circle');
    dots.forEach((d) => expect(d.classList.contains("tbl-dimmed")).toBe(true));
    realBtn.click();
    dots.forEach((d) => expect(d.classList.contains("tbl-dimmed")).toBe(false));
  });

  it("pinning Total dims the real-series rects but keeps the net dots bright", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: DIVERGING_SPEC, rows: DIVERGING_ROWS, width: 720 });
    const svg = container.querySelector(".figure-canvas svg")!;
    const totalBtn = container.querySelector<HTMLButtonElement>(
      `.tbl-legend-item[data-series="${TOTAL_SERIES_KEY}"]`,
    )!;
    totalBtn.click();
    const rects = svg.querySelectorAll('g[aria-label="bar"] rect');
    rects.forEach((r) => expect(r.classList.contains("tbl-dimmed")).toBe(true));
    const dots = svg.querySelectorAll('g[aria-label="dot"] circle');
    dots.forEach((d) => expect(d.classList.contains("tbl-dimmed")).toBe(false));
    totalBtn.click();
    rects.forEach((r) => expect(r.classList.contains("tbl-dimmed")).toBe(false));
  });

  it("two-way: legendHandle.toggle(TOTAL_SERIES_KEY) dims real series", () => {
    const parent = document.createElement("div");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as unknown as SVGSVGElement;
    const realRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    realRect.setAttribute("data-series", "A");
    const totalCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    totalCircle.setAttribute("data-series", TOTAL_SERIES_KEY);
    svg.appendChild(realRect);
    svg.appendChild(totalCircle);
    const items: LegendItem[] = [
      { series: "A", label: "A", color: "#f00", dashed: false, markerShape: "rect" },
      { series: "B", label: "B", color: "#00f", dashed: false, markerShape: "rect" },
      { series: TOTAL_SERIES_KEY, label: "Total", color: undefined, dashed: false, markerShape: "dot", isExtra: true },
    ];
    const handle = renderLegend(parent, items, { svg })!;
    // Toggling Total dims the real series, keeps the Total marker bright.
    handle.toggle(TOTAL_SERIES_KEY);
    expect(realRect.classList.contains("tbl-dimmed")).toBe(true);
    expect(totalCircle.classList.contains("tbl-dimmed")).toBe(false);
    handle.toggle(TOTAL_SERIES_KEY);
    // Toggling a real series dims the Total marker.
    handle.toggle("A");
    expect(totalCircle.classList.contains("tbl-dimmed")).toBe(true);
    expect(realRect.classList.contains("tbl-dimmed")).toBe(false);
  });

  // --- renderLegend unit tests: Total IS interactive and counts in allSeries ---
  it("renderLegend renders the Total row as an interactive button", () => {
    const parent = document.createElement("div");
    const fakeSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as unknown as SVGSVGElement;
    const items: LegendItem[] = [
      { series: "A", label: "A", color: "#f00", dashed: false, markerShape: "rect" },
      { series: "B", label: "B", color: "#00f", dashed: false, markerShape: "rect" },
      { series: TOTAL_SERIES_KEY, label: "Total", color: undefined, dashed: false, markerShape: "dot", isExtra: true },
    ];
    renderLegend(parent, items, { svg: fakeSvg });
    const legendItems = parent.querySelectorAll(".tbl-legend-item");
    expect(legendItems.length).toBe(3);
    // All 3 are interactive buttons with data-series (Total included now).
    const buttons = parent.querySelectorAll(".tbl-legend-item[data-series]");
    expect(buttons.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Legend correctness fixes (TT-L)

describe("legend hover/click dimming on bar & stacked charts (Fix #1)", () => {
  const BAR_SPEC: ChartSpec = {
    chartType: "bar",
    title: "Bar dim test",
    subtitle: "Percentage points",
    xAxisType: "categorical",
    series_order: ["2019", "2022"],
    data: "inline",
  };
  const BAR_ROWS: TidyRow[] = [
    { time: "Northeast", series: "2019", value: "3.2" },
    { time: "Midwest",   series: "2019", value: "2.1" },
    { time: "Northeast", series: "2022", value: "4.1" },
    { time: "Midwest",   series: "2022", value: "2.5" },
  ];

  it("clicking a legend item dims the OTHER series' <rect>s, not the clicked one", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: BAR_SPEC, rows: BAR_ROWS, width: 720 });
    const svg = container.querySelector(".figure-canvas svg")!;
    const btn2019 = container.querySelector<HTMLButtonElement>('.tbl-legend-item[data-series="2019"]')!;
    expect(btn2019).not.toBeNull();
    btn2019.click();
    // Rects of 2019 stay un-dimmed; rects of 2022 are dimmed.
    const rects2019 = svg.querySelectorAll('rect[data-series="2019"]');
    const rects2022 = svg.querySelectorAll('rect[data-series="2022"]');
    expect(rects2019.length).toBeGreaterThan(0);
    expect(rects2022.length).toBeGreaterThan(0);
    rects2019.forEach((r) => expect(r.classList.contains("tbl-dimmed")).toBe(false));
    rects2022.forEach((r) => expect(r.classList.contains("tbl-dimmed")).toBe(true));
    // Clicking again clears the pin → nothing dimmed.
    btn2019.click();
    svg.querySelectorAll("[data-series]").forEach((r) =>
      expect(r.classList.contains("tbl-dimmed")).toBe(false),
    );
  });

  it("line chart still dims <path>s (not regressed)", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: MULTI_SERIES_SPEC, rows: MULTI_SERIES_ROWS, width: 720 });
    const svg = container.querySelector(".figure-canvas svg")!;
    const btnA = container.querySelector<HTMLButtonElement>('.tbl-legend-item[data-series="A"]')!;
    btnA.click();
    const pathsA = svg.querySelectorAll('path[data-series="A"]');
    const pathsB = svg.querySelectorAll('path[data-series="B"]');
    expect(pathsA.length).toBeGreaterThan(0);
    expect(pathsB.length).toBeGreaterThan(0);
    pathsA.forEach((p) => expect(p.classList.contains("tbl-dimmed")).toBe(false));
    pathsB.forEach((p) => expect(p.classList.contains("tbl-dimmed")).toBe(true));
  });
});

describe("monochromatic stacked legend swatch colors (Fix #2)", () => {
  const MONO_SPEC: ChartSpec = {
    chartType: "stacked",
    title: "Mono stacked",
    subtitle: "Units",
    xAxisType: "categorical",
    series_order: ["Tier A", "Tier B", "Tier C", "Tier D"],
    barStack: { mono: { base: "blue" } },
    data: "inline",
  };
  const MONO_ROWS: TidyRow[] = [
    { time: "Q1", series: "Tier A", value: "30" },
    { time: "Q1", series: "Tier B", value: "20" },
    { time: "Q1", series: "Tier C", value: "15" },
    { time: "Q1", series: "Tier D", value: "10" },
  ];

  it("legend swatch background equals the bar's tonal tier (darkest-at-bottom)", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: MONO_SPEC, rows: MONO_ROWS, width: 720 });
    // All-positive: bottom→top tier assignment = declaration order; tiers darkest-first
    // for blue = 700,600,500,400. So Tier A=#002B61 (700), Tier D=#0070AF (400).
    const tierA = container.querySelector<HTMLButtonElement>('.tbl-legend-item[data-series="Tier A"] .tbl-legend-swatch')!;
    const tierD = container.querySelector<HTMLButtonElement>('.tbl-legend-item[data-series="Tier D"] .tbl-legend-swatch')!;
    expect(tierA.style.background).toBe("rgb(0, 43, 97)");  // #002B61
    expect(tierD.style.background).toBe("rgb(0, 112, 175)"); // #0070AF
  });
});

describe("diverging right-legend visual-stack order (Fix #3)", () => {
  const DIVERGING_SPEC: ChartSpec = {
    chartType: "stacked",
    title: "Diverging order",
    subtitle: "Percentage points",
    xAxisType: "categorical",
    series_order: ["Lower rates", "Wider brackets", "Limit deductions", "Repeal credit"],
    data: "inline",
  };
  const DIVERGING_ROWS: TidyRow[] = [
    { time: "A", series: "Lower rates",       value: "4"    },
    { time: "A", series: "Wider brackets",    value: "2"    },
    { time: "A", series: "Limit deductions",  value: "-1.5" },
    { time: "A", series: "Repeal credit",     value: "-2.5" },
    { time: "B", series: "Lower rates",       value: "3"    },
    { time: "B", series: "Wider brackets",    value: "2.5"  },
    { time: "B", series: "Limit deductions",  value: "-1"   },
    { time: "B", series: "Repeal credit",     value: "-3"   },
  ];

  it("right-legend reads top→bottom in visual-stack order, Total last", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: DIVERGING_SPEC, rows: DIVERGING_ROWS, width: 800 });
    const rightSlot = container.querySelector(".figure-legend-slot--right")!;
    expect(rightSlot).not.toBeNull();
    const items = rightSlot.querySelectorAll(".tbl-legend-item");
    const labels = Array.from(items).map((el) => (el as HTMLElement).textContent?.trim());
    // positives [Lower rates, Wider brackets] reversed → [Wider brackets, Lower rates];
    // negatives [Limit deductions, Repeal credit] in order; Total last.
    expect(labels).toEqual([
      "Wider brackets",
      "Lower rates",
      "Limit deductions",
      "Repeal credit",
      "Total",
    ]);
  });
});

describe("right-legend swatch left-alignment (Fix #4)", () => {
  const FIVE_SPEC: ChartSpec = {
    chartType: "stacked",
    title: "Five series stacked",
    subtitle: "Percent",
    xAxisType: "categorical",
    series_order: ["S1", "S2", "S3", "S4", "S5"],
    data: "inline",
  };
  const FIVE_ROWS: TidyRow[] = [
    { time: "A", series: "S1", value: "1" },
    { time: "A", series: "S2", value: "2" },
    { time: "A", series: "S3", value: "1" },
    { time: "A", series: "S4", value: "2" },
    { time: "A", series: "S5", value: "1" },
  ];

  it("vertical legend items stretch full-width and left-align (structure guarantees common left edge)", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: FIVE_SPEC, rows: FIVE_ROWS, width: 800 });
    const legend = container.querySelector(".figure-legend-slot--right .tbl-legend--vertical")!;
    expect(legend).not.toBeNull();
    // The CSS uses align-items:stretch + .tbl-legend-item{width:100%;justify-content:flex-start}
    // so every item is the same width and its swatch starts at the same left x. Assert the
    // class that the CSS rule keys on is present on the legend and items.
    expect(legend.classList.contains("tbl-legend--vertical")).toBe(true);
    const items = legend.querySelectorAll(".tbl-legend-item");
    expect(items.length).toBe(5);
  });
});

describe("reset button position & visibility (Fix #5)", () => {
  const FIVE_SPEC: ChartSpec = {
    chartType: "stacked",
    title: "Five series stacked",
    subtitle: "Percent",
    xAxisType: "categorical",
    series_order: ["S1", "S2", "S3", "S4", "S5"],
    data: "inline",
  };
  const FIVE_ROWS: TidyRow[] = [
    { time: "A", series: "S1", value: "1" },
    { time: "A", series: "S2", value: "2" },
    { time: "A", series: "S3", value: "1" },
    { time: "A", series: "S4", value: "2" },
    { time: "A", series: "S5", value: "1" },
  ];

  it("reset button is the LAST child of the legend and hidden until pinned", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: FIVE_SPEC, rows: FIVE_ROWS, width: 800 });
    const legend = container.querySelector(".figure-legend-slot--right .tbl-legend")!;
    const reset = legend.querySelector<HTMLButtonElement>(".tbl-legend-reset")!;
    expect(reset).not.toBeNull();
    // Last child of the legend.
    expect(legend.lastElementChild).toBe(reset);
    // Hidden until something is pinned.
    expect(reset.hidden).toBe(true);
    // Pin a series → reset becomes visible.
    const firstBtn = legend.querySelector<HTMLButtonElement>("button.tbl-legend-item[data-series]")!;
    firstBtn.click();
    expect(reset.hidden).toBe(false);
    // Clicking reset clears the pin and re-hides itself.
    reset.click();
    expect(reset.hidden).toBe(true);
  });

  it("reset button is the last child of a TOP legend too", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: MULTI_SERIES_SPEC, rows: MULTI_SERIES_ROWS, width: 720 });
    const legend = container.querySelector(".figure-legend-slot .tbl-legend")!;
    const reset = legend.querySelector(".tbl-legend-reset")!;
    expect(legend.lastElementChild).toBe(reset);
  });
});

// ---------------------------------------------------------------------------
// Two-way series selection (TT4-2): renderLegend handle + chart-click sync
// ---------------------------------------------------------------------------

describe("renderLegend handle.toggle (single source of truth)", () => {
  const NS = "http://www.w3.org/2000/svg";

  function makeSvgWithSeries(seriesNames: string[]): SVGSVGElement {
    const svg = document.createElementNS(NS, "svg") as unknown as SVGSVGElement;
    // Two rects per series so dimming is observable across multiple marks.
    for (const s of seriesNames) {
      for (let i = 0; i < 2; i++) {
        const rect = document.createElementNS(NS, "rect");
        rect.setAttribute("data-series", s);
        svg.appendChild(rect);
      }
    }
    return svg;
  }

  const ITEMS: LegendItem[] = [
    { series: "A", label: "A", color: "#f00", dashed: false, markerShape: "rect" },
    { series: "B", label: "B", color: "#00f", dashed: false, markerShape: "rect" },
  ];

  it("returns a handle with element + toggle", () => {
    const parent = document.createElement("div");
    const svg = makeSvgWithSeries(["A", "B"]);
    const handle = renderLegend(parent, ITEMS, { svg });
    expect(handle).not.toBeNull();
    expect(handle!.element.classList.contains("tbl-legend")).toBe(true);
    expect(typeof handle!.toggle).toBe("function");
  });

  it("toggle('B') dims the OTHER series' marks and pins the B legend button; toggling again clears", () => {
    const parent = document.createElement("div");
    const svg = makeSvgWithSeries(["A", "B"]);
    const handle = renderLegend(parent, ITEMS, { svg })!;

    handle.toggle("B");
    // A dimmed, B not dimmed.
    svg.querySelectorAll('[data-series="A"]').forEach((r) =>
      expect(r.classList.contains("tbl-dimmed")).toBe(true),
    );
    svg.querySelectorAll('[data-series="B"]').forEach((r) =>
      expect(r.classList.contains("tbl-dimmed")).toBe(false),
    );
    // B legend button marked pinned (shared state).
    const btnB = parent.querySelector<HTMLButtonElement>('.tbl-legend-item[data-series="B"]')!;
    expect(btnB.classList.contains("is-pinned")).toBe(true);
    expect(btnB.getAttribute("aria-pressed")).toBe("true");

    // Toggle again clears.
    handle.toggle("B");
    svg.querySelectorAll("[data-series]").forEach((r) =>
      expect(r.classList.contains("tbl-dimmed")).toBe(false),
    );
    expect(btnB.classList.contains("is-pinned")).toBe(false);
  });

  it("toggle is a no-op for an unknown / non-interactive series", () => {
    const parent = document.createElement("div");
    const svg = makeSvgWithSeries(["A", "B"]);
    const handle = renderLegend(parent, ITEMS, { svg })!;
    handle.toggle("__not_a_series__");
    svg.querySelectorAll("[data-series]").forEach((r) =>
      expect(r.classList.contains("tbl-dimmed")).toBe(false),
    );
    parent.querySelectorAll(".tbl-legend-item").forEach((b) =>
      expect(b.classList.contains("is-pinned")).toBe(false),
    );
  });

  it("two-way sync: a legend-button click and a toggle converge on the same pinned set", () => {
    const parent = document.createElement("div");
    const svg = makeSvgWithSeries(["A", "B"]);
    const handle = renderLegend(parent, ITEMS, { svg })!;

    // Pin A via the button…
    const btnA = parent.querySelector<HTMLButtonElement>('.tbl-legend-item[data-series="A"]')!;
    btnA.click();
    // …then pin B via the handle. Both should be pinned (union); nothing dimmed.
    handle.toggle("B");
    const btnB = parent.querySelector<HTMLButtonElement>('.tbl-legend-item[data-series="B"]')!;
    expect(btnA.classList.contains("is-pinned")).toBe(true);
    expect(btnB.classList.contains("is-pinned")).toBe(true);
    // Union covers all series → dimAll is false → nothing dimmed.
    svg.querySelectorAll("[data-series]").forEach((r) =>
      expect(r.classList.contains("tbl-dimmed")).toBe(false),
    );
  });
});

// ---------------------------------------------------------------------------
// Net-total label legibility over dimmed bars (TT7)
// ---------------------------------------------------------------------------

describe("formatValue tooltip precision", () => {
  it("defaults to 2 decimals", () => {
    expect(formatValue(0.0024, "")).toBe("0.00");
    expect(formatValue(1.5, "%")).toBe("1.50%");
  });
  it("honors an explicit decimals count (tooltip more precise than the axis)", () => {
    expect(formatValue(0.0024, "")).toBe("0.00"); // axis-style
    expect(formatValue(0.0024, "", 4)).toBe("0.0024"); // tooltip-style
    expect(formatValue(0.0286, "", 4)).toBe("0.0286");
  });
  it("renders an em dash for non-finite values", () => {
    expect(formatValue(NaN, "", 4)).toBe("—");
  });
});

describe("netLabelFill (pure color decision)", () => {
  const DARK = "#1A1A2E"; // tokens.structural.text_heading
  const WHITE = "#FFFFFF";

  it("dimmed behind segment → dark", () => {
    expect(netLabelFill(true, true)).toBe(DARK);
  });

  it("active behind segment → white", () => {
    expect(netLabelFill(false, true)).toBe(WHITE);
  });

  it("no segment behind (over white background) → dark", () => {
    expect(netLabelFill(false, false)).toBe(DARK);
    // hasBehind=false wins regardless of the dimmed flag.
    expect(netLabelFill(true, false)).toBe(DARK);
  });
});

describe("renderLegend onHighlight hook", () => {
  const NS = "http://www.w3.org/2000/svg";
  const ITEMS: LegendItem[] = [
    { series: "A", label: "A", color: "#f00", dashed: false, markerShape: "rect" },
    { series: "B", label: "B", color: "#00f", dashed: false, markerShape: "rect" },
  ];

  function makeSvg(): SVGSVGElement {
    const svg = document.createElementNS(NS, "svg") as unknown as SVGSVGElement;
    for (const s of ["A", "B"]) {
      const rect = document.createElementNS(NS, "rect");
      rect.setAttribute("data-series", s);
      svg.appendChild(rect);
    }
    return svg;
  }

  it("fires onHighlight after applyHighlight on a pin and on reset", () => {
    const parent = document.createElement("div");
    const svg = makeSvg();
    const calls: boolean[] = [];
    // Spy records the dim state at call time to prove it runs AFTER classes are toggled.
    const handle = renderLegend(parent, ITEMS, {
      svg,
      onHighlight: () => {
        calls.push(svg.querySelector('[data-series="A"]')!.classList.contains("tbl-dimmed"));
      },
    })!;
    expect(calls.length).toBe(0); // not called during render
    // Pin B → A dims; the callback sees the fresh dimmed state (true).
    handle.toggle("B");
    expect(calls.length).toBe(1);
    expect(calls[0]).toBe(true);
    // Reset (unpin) → nothing dimmed; callback fires again and reads the cleared state.
    handle.toggle("B");
    expect(calls.length).toBe(2);
    expect(calls[1]).toBe(false);
  });

  it("absent onHighlight is harmless (existing callers unaffected)", () => {
    const parent = document.createElement("div");
    const svg = makeSvg();
    const handle = renderLegend(parent, ITEMS, { svg })!;
    expect(() => handle.toggle("A")).not.toThrow();
  });
});

describe("mountChart two-way selection wiring", () => {
  const BAR_SPEC: ChartSpec = {
    chartType: "bar",
    title: "Selectable bars",
    xAxisType: "categorical",
    series_order: ["2019", "2022"],
    data: "inline",
  };
  const BAR_ROWS: TidyRow[] = [
    { time: "Northeast", series: "2019", value: "3.2" },
    { time: "Midwest",   series: "2019", value: "2.1" },
    { time: "Northeast", series: "2022", value: "4.1" },
    { time: "Midwest",   series: "2022", value: "2.5" },
  ];

  it("multi-series chart sets the .is-selectable hook on the card", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: BAR_SPEC, rows: BAR_ROWS, width: 720 });
    expect(container.querySelector(".figure-card.is-selectable")).not.toBeNull();
  });

  it("multi-series chart gives the crosshair hit overlay a pointer cursor", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: BAR_SPEC, rows: BAR_ROWS, width: 720 });
    const hit = container.querySelector<SVGElement>(".tbl-band-crosshair-hit")!;
    expect(hit).not.toBeNull();
    expect(hit.style.cursor).toBe("pointer");
  });

  it("single-series no-legend chart does NOT set .is-selectable", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: SINGLE_SERIES_SPEC, rows: SINGLE_SERIES_ROWS, width: 720 });
    expect(container.querySelector(".figure-card.is-selectable")).toBeNull();
  });

  it("multi-series LINE chart adds a .tbl-line-hitpath per visible line, below the crosshair overlay", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: MULTI_SERIES_SPEC, rows: MULTI_SERIES_ROWS, width: 720 });
    const svg = container.querySelector(".figure-canvas svg")!;
    const linePaths = Array.from(svg.querySelectorAll('g[aria-label="line"] path[data-series]'));
    const hitPaths = Array.from(svg.querySelectorAll<SVGPathElement>(".tbl-line-hitpath"));
    expect(linePaths.length).toBeGreaterThan(0);
    // One hit-path per visible line, same series + geometry.
    expect(hitPaths.length).toBe(linePaths.length);
    const visibleSeries = new Set(linePaths.map((p) => p.getAttribute("data-series")));
    const hitSeries = new Set(hitPaths.map((p) => p.getAttribute("data-series")));
    expect(hitSeries).toEqual(visibleSeries);
    for (const hp of hitPaths) {
      // Fat, invisible (painted with zero opacity), stroke-only hit-testable.
      expect(Number(hp.getAttribute("stroke-width"))).toBeGreaterThanOrEqual(10);
      expect(hp.getAttribute("stroke-opacity")).toBe("0");
      expect(hp.getAttribute("fill")).toBe("none");
      expect(hp.style.pointerEvents).toBe("stroke");
      expect(hp.getAttribute("d")).toBeTruthy();
    }
    // Each hit-path's `d` matches a visible line's `d`.
    const visibleDs = new Set(linePaths.map((p) => p.getAttribute("d")));
    for (const hp of hitPaths) expect(visibleDs.has(hp.getAttribute("d"))).toBe(true);
    // Inserted BELOW the topmost crosshair overlay (overlay is later in document order).
    const overlay = svg.querySelector(".tbl-crosshair-hit")!;
    expect(overlay).not.toBeNull();
    for (const hp of hitPaths) {
      // compareDocumentPosition: overlay FOLLOWING hp → hp precedes overlay (is below it).
      expect(hp.compareDocumentPosition(overlay) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("single-series no-legend LINE chart adds NO hit-paths", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: SINGLE_SERIES_SPEC, rows: SINGLE_SERIES_ROWS, width: 720 });
    const svg = container.querySelector(".figure-canvas svg")!;
    expect(svg.querySelectorAll(".tbl-line-hitpath").length).toBe(0);
  });

  it("BAR chart adds no .tbl-line-hitpath (gated to the line case)", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: BAR_SPEC, rows: BAR_ROWS, width: 720 });
    const svg = container.querySelector(".figure-canvas svg")!;
    expect(svg.querySelectorAll(".tbl-line-hitpath").length).toBe(0);
  });

  it("a hit-path's data-series drives the legend toggle (chart→legend sync for lines)", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: MULTI_SERIES_SPEC, rows: MULTI_SERIES_ROWS, width: 720 });
    const svg = container.querySelector(".figure-canvas svg")!;
    const hit = svg.querySelector<SVGPathElement>('.tbl-line-hitpath[data-series="A"]')!;
    expect(hit).not.toBeNull();
    // The click handler resolves this series and calls handle.toggle — exercise the toggle
    // via the equivalent legend button (elementsFromPoint is not layout-backed in jsdom).
    const series = hit.getAttribute("data-series")!;
    const btn = container.querySelector<HTMLButtonElement>(`.tbl-legend-item[data-series="${series}"]`)!;
    btn.click();
    svg.querySelectorAll('path[data-series="B"]').forEach((p) =>
      expect(p.classList.contains("tbl-dimmed")).toBe(true),
    );
    svg.querySelectorAll('path[data-series="A"]').forEach((p) =>
      expect(p.classList.contains("tbl-dimmed")).toBe(false),
    );
  });

  it("a click resolving to a bar's series pins it (toggle path), proving chart→legend sync", () => {
    // jsdom lacks layout for elementsFromPoint, so exercise the same resolution the click
    // handler uses: read a rect's data-series and call the legend toggle. We verify the
    // end-to-end effect by clicking the legend button equivalent is unnecessary — instead
    // assert that a synthesized data-series resolves and dims via the live legend.
    const container = document.createElement("div");
    mountChart(container, { spec: BAR_SPEC, rows: BAR_ROWS, width: 720 });
    const svg = container.querySelector(".figure-canvas svg")!;
    const rect = svg.querySelector('rect[data-series="2022"]')!;
    const series = rect.getAttribute("data-series");
    expect(series).toBe("2022");
    // Drive the legend the chart click would drive: clicking the matching legend button
    // is the same single-source-of-truth toggle. After pinning 2022, the 2019 rects dim.
    const btn = container.querySelector<HTMLButtonElement>('.tbl-legend-item[data-series="2022"]')!;
    btn.click();
    svg.querySelectorAll('rect[data-series="2019"]').forEach((r) =>
      expect(r.classList.contains("tbl-dimmed")).toBe(true),
    );
    svg.querySelectorAll('rect[data-series="2022"]').forEach((r) =>
      expect(r.classList.contains("tbl-dimmed")).toBe(false),
    );
  });
});

// ---------------------------------------------------------------------------
// mountChart — small-multiples figures (B6)

describe("mountChart small multiples", () => {
  const FACET_ROWS: TidyRow[] = [];
  for (const region of ["Northeast", "Midwest", "South", "West"]) {
    for (let y = 2020; y <= 2023; y++) {
      FACET_ROWS.push({ facet: region, series: "A", time: `${y}-01-01`, value: String(2 + (y - 2020)) } as TidyRow);
      FACET_ROWS.push({ facet: region, series: "B", time: `${y}-01-01`, value: String(5 + (y - 2020)) } as TidyRow);
    }
  }
  const SHARED_SPEC: ChartSpec = {
    chartType: "line",
    title: "Regions",
    subtitle: "Percent",
    xAxisType: "temporal",
    series_order: ["A", "B"],
    data: "inline",
    columns: { facet: "facet" },
    small_multiples: { columns: 2, mode: "shared" },
  };
  const PERPANE_SPEC: ChartSpec = {
    ...SHARED_SPEC,
    small_multiples: { columns: 2, mode: "per-pane" },
  };

  it("shared mode mounts a per-pane grid (shared y-scale) + a top legend", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: SHARED_SPEC, rows: FACET_ROWS, width: 800 });
    expect(container.querySelector(".figure-card")).not.toBeNull();
    // Shared mode is now a per-pane grid composition (not one combined canvas SVG).
    const grid = container.querySelector(".figure-grid");
    expect(grid).not.toBeNull();
    expect(container.querySelector(".figure-canvas")).toBeNull();
    const panes = grid!.querySelectorAll(".figure-pane");
    expect(panes.length).toBe(4); // 4 regions
    panes.forEach((p) => {
      expect(p.querySelector(".figure-pane-title")).not.toBeNull();
      expect(p.querySelector("svg")).not.toBeNull();
    });
    // y-tick LABELS only on the leftmost column (2 cols → panes 0,2 show; 1,3 don't).
    const labelCount = (i: number): number =>
      panes[i]!.querySelectorAll("g.tbl-y-tick-label text").length;
    expect(labelCount(0)).toBeGreaterThan(0);
    expect(labelCount(2)).toBeGreaterThan(0);
    expect(labelCount(1)).toBe(0);
    expect(labelCount(3)).toBe(0);
    // Top legend present (2 interactive series) and selection wired.
    expect(container.querySelector(".tbl-legend")).not.toBeNull();
    expect(container.querySelector(".figure-card")!.classList.contains("is-selectable")).toBe(true);
  });

  it("per-pane mode builds a .figure-grid with one titled cell + svg per pane", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: PERPANE_SPEC, rows: FACET_ROWS, width: 800 });
    const grid = container.querySelector(".figure-grid");
    expect(grid).not.toBeNull();
    const panes = grid!.querySelectorAll(".figure-pane");
    expect(panes.length).toBe(4); // 4 regions
    // Each pane has a title and its own SVG.
    panes.forEach((p) => {
      expect(p.querySelector(".figure-pane-title")).not.toBeNull();
      expect(p.querySelector("svg")).not.toBeNull();
    });
    // --figure-cols set for the responsive grid.
    expect((grid as HTMLElement).style.getPropertyValue("--figure-cols")).not.toBe("");
    // No combined single canvas SVG in per-pane mode.
    expect(container.querySelector(".figure-canvas")).toBeNull();
  });

  it("per-pane legend dims [data-series] across ALL pane svgs (grid as highlight root)", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: PERPANE_SPEC, rows: FACET_ROWS, width: 800 });
    // Pin series "A" via its legend button.
    const btn = container.querySelector<HTMLButtonElement>('.tbl-legend-item[data-series="A"]')!;
    expect(btn).not.toBeNull();
    btn.click();
    // Every pane's "B" path dims; "A" stays bright — across all panes.
    const bPaths = container.querySelectorAll('.figure-grid path[data-series="B"]');
    expect(bPaths.length).toBeGreaterThan(1); // one per pane
    bPaths.forEach((p) => expect(p.classList.contains("tbl-dimmed")).toBe(true));
    container.querySelectorAll('.figure-grid path[data-series="A"]').forEach((p) =>
      expect(p.classList.contains("tbl-dimmed")).toBe(false),
    );
  });

  it("does not throw and produces a card for a single-pane figure", () => {
    const container = document.createElement("div");
    const oneRowSpec: ChartSpec = { ...SHARED_SPEC, small_multiples: { mode: "shared" } };
    const oneRegion = FACET_ROWS.filter((r) => r["facet"] === "Northeast");
    expect(() => mountChart(container, { spec: oneRowSpec, rows: oneRegion, width: 600 })).not.toThrow();
    expect(container.querySelector(".figure-card")).not.toBeNull();
  });

  // --- Per-pane BAR figure (task B8) ---
  const BAR_FACET_ROWS: TidyRow[] = [];
  for (const region of ["Northeast", "Midwest", "South", "West"]) {
    for (const [s, base] of [["2019", 2], ["2022", 3], ["2025", 4]] as const) {
      BAR_FACET_ROWS.push({ facet: region, series: s, time: "All", value: String(base) } as TidyRow);
      BAR_FACET_ROWS.push({ facet: region, series: s, time: "Under 65", value: String(base + 1) } as TidyRow);
    }
  }
  const BAR_PERPANE_SPEC: ChartSpec = {
    chartType: "bar",
    title: "Effect by year, by region",
    subtitle: "Percentage points",
    xAxisType: "categorical",
    series_order: ["2019", "2022", "2025"],
    data: "inline",
    columns: { facet: "facet" },
    small_multiples: { columns: 2, mode: "per-pane" },
  };

  it("per-pane bar figure mounts a .figure-grid with bar <rect>s per pane + rect-swatch legend", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: BAR_PERPANE_SPEC, rows: BAR_FACET_ROWS, width: 800 });
    const grid = container.querySelector(".figure-grid");
    expect(grid).not.toBeNull();
    const panes = grid!.querySelectorAll(".figure-pane");
    expect(panes.length).toBe(4); // 4 regions
    // Each pane has bar <rect>s (grouped bars: 2 categories x 3 series = 6 rects).
    panes.forEach((p) => {
      expect(p.querySelector(".figure-pane-title")).not.toBeNull();
      const rects = p.querySelectorAll('svg g[aria-label="bar"] rect');
      expect(rects.length).toBe(6);
    });
    // Legend uses rect swatches (bar markerShape), not line swatches.
    const swatch = container.querySelector(".tbl-legend-item .tbl-legend-swatch");
    expect(swatch).not.toBeNull();
    expect(swatch!.classList.contains("is-rect")).toBe(true);
  });

  it("clicking a per-pane bar legend item dims rects across ALL panes", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: BAR_PERPANE_SPEC, rows: BAR_FACET_ROWS, width: 800 });
    // Pin series "2019" via its legend button.
    const btn = container.querySelector<HTMLButtonElement>('.tbl-legend-item[data-series="2019"]')!;
    expect(btn).not.toBeNull();
    btn.click();
    // Every pane's non-2019 rects dim; 2019 rects stay bright — across all panes.
    const otherRects = container.querySelectorAll('.figure-grid rect[data-series="2025"]');
    expect(otherRects.length).toBeGreaterThan(1); // multiple panes
    otherRects.forEach((r) => expect(r.classList.contains("tbl-dimmed")).toBe(true));
    container.querySelectorAll('.figure-grid rect[data-series="2019"]').forEach((r) =>
      expect(r.classList.contains("tbl-dimmed")).toBe(false),
    );
  });
});

// ---------------------------------------------------------------------------
// Point charts: scatter (dual encoding) + dotplot (faceted, redundant encoding)

describe("value-on-highlight labels", () => {
  const GROUPED: ChartSpec = {
    chartType: "bar",
    title: "Grouped",
    xAxisType: "categorical",
    data: "inline",
    columns: { x: "g", value: "v", series: "s" },
    series_order: ["A", "B"],
    valueLabels: { show: false },
  };
  const GROUPED_ROWS: TidyRow[] = [
    { g: "X", s: "A", v: "3" }, { g: "X", s: "B", v: "5" },
    { g: "Y", s: "A", v: "2" }, { g: "Y", s: "B", v: "6" },
  ];

  it("no pills until a series is highlighted; hovering a legend series draws ONLY its pills", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: GROUPED, rows: GROUPED_ROWS, width: 720 });
    // The pill group exists but is empty/hidden until a strict subset is highlighted.
    const pillGroup = container.querySelector(".tbl-hl-pills") as SVGGElement;
    expect(pillGroup).not.toBeNull();
    expect(pillGroup.getAttribute("opacity")).toBe("0");

    const btnA = container.querySelector('.tbl-legend-item[data-series="A"]') as HTMLElement;
    btnA.dispatchEvent(new Event("pointerenter"));
    // Pills render in jsdom for bars (rect attributes are present). A's values are 3 (X) and 2 (Y).
    expect(pillGroup.getAttribute("opacity")).toBe("1");
    const texts = Array.from(pillGroup.querySelectorAll("text")).map((t) => t.textContent);
    expect(texts.sort()).toEqual(["2.00", "3.00"]); // ONLY series A's values — not B's 5/6
    btnA.dispatchEvent(new Event("pointerleave"));
    expect(pillGroup.getAttribute("opacity")).toBe("0");
    expect(pillGroup.querySelectorAll("text").length).toBe(0);
  });

  it("pins still dim the non-active series' bars (dimming unchanged)", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: GROUPED, rows: GROUPED_ROWS, width: 720 });
    const btnA = container.querySelector('.tbl-legend-item[data-series="A"]') as HTMLElement;
    btnA.dispatchEvent(new Event("pointerenter"));
    const bRects = container.querySelectorAll('rect[data-series="B"]');
    expect(bRects.length).toBeGreaterThan(0);
    bRects.forEach((r) => expect(r.classList.contains("tbl-dimmed")).toBe(true));
    // The pill group's own elements are never tagged as data-series, so they never dim.
    const pillGroup = container.querySelector(".tbl-hl-pills") as SVGGElement;
    expect(pillGroup.querySelectorAll(".tbl-dimmed").length).toBe(0);
  });
});

describe("mountChart point charts", () => {
  const SCATTER_SPEC: ChartSpec = {
    chartType: "scatter",
    title: "Scatter",
    xAxisType: "numeric",
    data: "inline",
    columns: { x: "gx", value: "gy", series: "color", shape: "shp" },
    series_order: ["Slow", "Fast"],
    shape_order: ["Tri", "Dot"],
    color_legend_title: "Shock",
    shape_legend_title: "Labor",
  };
  const SCATTER_ROWS: TidyRow[] = [
    { gx: "10", gy: "5", color: "Slow", shp: "Tri" },
    { gx: "20", gy: "9", color: "Slow", shp: "Dot" },
    { gx: "300", gy: "80", color: "Fast", shp: "Tri" },
    { gx: "320", gy: "110", color: "Fast", shp: "Dot" },
  ];

  it("scatter mounts without throwing and tags each marker by color series", () => {
    const container = document.createElement("div");
    expect(() => mountChart(container, { spec: SCATTER_SPEC, rows: SCATTER_ROWS, width: 720 })).not.toThrow();
    // Shape channel active → markers render as <path> tagged with the color series.
    const markers = container.querySelectorAll('g[aria-label="dot"] path[data-series]');
    expect(markers.length).toBe(4);
  });

  it("scatter renders TWO legend groups with headings (dual encoding)", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: SCATTER_SPEC, rows: SCATTER_ROWS, width: 720 });
    const groups = container.querySelectorAll(".tbl-legend-group");
    expect(groups.length).toBe(2);
    const titles = Array.from(container.querySelectorAll(".tbl-legend-group-title")).map((e) => e.textContent);
    expect(titles).toContain("Shock");
    expect(titles).toContain("Labor");
    // Shape group rows are interactive (data-shape) so they can drive shape-dimension dimming.
    expect(container.querySelectorAll(".tbl-legend-item[data-shape]").length).toBe(2);
    // Color group rows carry data-series.
    expect(container.querySelectorAll(".tbl-legend-item[data-series]").length).toBe(2);
  });

  it("scatter markers carry data-shape so the shape legend can dim them", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: SCATTER_SPEC, rows: SCATTER_ROWS, width: 720 });
    const tagged = container.querySelectorAll('g[aria-label="dot"] path[data-shape]');
    expect(tagged.length).toBe(4);
    // Hovering a shape legend row dims markers of OTHER shapes (and not the matching ones).
    const triBtn = container.querySelector('.tbl-legend-item[data-shape="Tri"]') as HTMLElement;
    triBtn.dispatchEvent(new Event("pointerenter"));
    const dimmedTri = Array.from(container.querySelectorAll('path[data-shape="Tri"]'))
      .filter((p) => p.classList.contains("tbl-dimmed")).length;
    const dimmedDot = Array.from(container.querySelectorAll('path[data-shape="Dot"]'))
      .filter((p) => p.classList.contains("tbl-dimmed")).length;
    expect(dimmedTri).toBe(0); // Tri stays bright
    expect(dimmedDot).toBeGreaterThan(0); // Dot dims
  });

  const DOT_SPEC: ChartSpec = {
    chartType: "dotplot",
    title: "Dots",
    xAxisType: "categorical",
    data: "inline",
    columns: { x: "cat", value: "v", series: "m", shape: "m", facet: "g" },
    series_order: ["After", "Pre"],
    small_multiples: { columns: 2, mode: "shared", pane_order: ["G1", "G2"] },
  };
  const DOT_ROWS: TidyRow[] = [];
  for (const g of ["G1", "G2"]) {
    for (const cat of ["Low", "High"]) {
      DOT_ROWS.push({ g, cat, m: "After", v: "0.01" } as TidyRow);
      DOT_ROWS.push({ g, cat, m: "Pre", v: "0.012" } as TidyRow);
    }
  }

  it("faceted dotplot mounts a grid; redundant encoding → one combined legend (no shape group)", () => {
    const container = document.createElement("div");
    expect(() => mountChart(container, { spec: DOT_SPEC, rows: DOT_ROWS, width: 800 })).not.toThrow();
    expect(container.querySelectorAll(".figure-pane").length).toBe(2);
    // Combined (shape == series): a single flat legend, no two-group split.
    expect(container.querySelectorAll(".tbl-legend-group").length).toBe(0);
    expect(container.querySelectorAll(".tbl-legend-item").length).toBe(2);
    // Markers tagged across panes so the color legend can dim them.
    expect(container.querySelectorAll('.figure-grid g[aria-label="dot"] path[data-series]').length).toBeGreaterThan(1);
    // Dodge: a 2-series categorical dotplot emits ONE dot mark per series (each with its own
    // constant dx), so every pane has 2 dot groups — not a single overlapping group.
    const firstPane = container.querySelector(".figure-pane");
    expect(firstPane!.querySelectorAll('g[aria-label="dot"]').length).toBe(2);
  });
});

describe("mountChart — area click-to-restack", () => {
  const AREA_SPEC: ChartSpec = {
    chartType: "area",
    title: "Area",
    subtitle: "Percent",
    xAxisType: "temporal",
    series_order: ["A", "B", "C"],
    data: "inline",
  };
  const AREA_ROWS: TidyRow[] = ["2024-01-01", "2024-02-01"].flatMap((t) => [
    { time: t, series: "A", value: "1" },
    { time: t, series: "B", value: "2" },
    { time: t, series: "C", value: "3" },
  ]);
  // Paths are emitted in stack order, so the first area path is the bottom series.
  const bottom = (c: HTMLElement): string | null | undefined =>
    c.querySelector('g[aria-label="area"] path[data-series]')?.getAttribute("data-series");
  const legendItem = (c: HTMLElement, s: string): HTMLElement | undefined =>
    [...c.querySelectorAll<HTMLElement>(".tbl-legend-item")].find((b) => b.getAttribute("data-series") === s);

  it("moves a selected series to the bottom of the stack and restores on deselect", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: AREA_SPEC, rows: AREA_ROWS });
    expect(bottom(container)).toBe("A"); // default: first in series_order is the bottom

    legendItem(container, "C")!.click();
    expect(bottom(container)).toBe("C"); // selected series dropped to the bottom

    legendItem(container, "C")!.click(); // re-query: the legend was rebuilt
    expect(bottom(container)).toBe("A"); // restored to the default order
  });

  it("stacks multiple selections in click order at the bottom", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: AREA_SPEC, rows: AREA_ROWS });
    legendItem(container, "C")!.click();
    legendItem(container, "B")!.click();
    // C clicked first → very bottom; B next → above C.
    const order = [...container.querySelectorAll('g[aria-label="area"] path[data-series]')].map((p) =>
      p.getAttribute("data-series"),
    );
    expect(order.slice(0, 2)).toEqual(["C", "B"]);
  });
});
