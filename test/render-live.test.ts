// @vitest-environment jsdom
//
// Tests for the embed live-render layer: mountChart + buildStandaloneHtml.
import { describe, it, expect } from "vitest";
import { mountChart } from "../src/engine/render-live";
import { renderLegend } from "../src/engine/legend";
import { buildStandaloneHtml } from "../src/embed/bundle-standalone";
import { CHART_CSS } from "../src/embed/styles";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";
import type { LegendItem } from "../src/engine/index";

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

  it("includes the Google Fonts Figtree link", () => {
    const html = buildStandaloneHtml({
      spec: MULTI_SERIES_SPEC,
      rows: MULTI_SERIES_ROWS,
      liveBundleJs: FAKE_BUNDLE,
      css: CHART_CSS,
    });
    expect(html).toContain("fonts.googleapis.com");
    expect(html).toContain("Figtree");
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

  it("diverging stacked Total row is non-interactive — no data-series attribute", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: DIVERGING_SPEC, rows: DIVERGING_ROWS });
    const items = container.querySelectorAll(".tbl-legend-item");
    const lastItem = items[items.length - 1] as HTMLElement;
    expect(lastItem.textContent).toContain("Total");
    expect(lastItem.dataset["series"]).toBeUndefined();
  });

  it("diverging stacked Total row is a span, not a button", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: DIVERGING_SPEC, rows: DIVERGING_ROWS });
    const items = container.querySelectorAll(".tbl-legend-item");
    const lastItem = items[items.length - 1] as HTMLElement;
    expect(lastItem.tagName.toLowerCase()).toBe("span");
  });

  it("diverging stacked real-series items are interactive buttons with data-series", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: DIVERGING_SPEC, rows: DIVERGING_ROWS });
    const items = container.querySelectorAll(".tbl-legend-item");
    // All but the last are real series.
    const realItems = Array.from(items).slice(0, items.length - 1);
    for (const item of realItems) {
      expect((item as HTMLElement).tagName.toLowerCase()).toBe("button");
      expect((item as HTMLElement).dataset["series"]).toBeTruthy();
    }
  });

  // --- renderLegend unit tests: verify allSeries count is not inflated by Total row ---
  it("renderLegend allSeries count does not include the Total row", () => {
    const parent = document.createElement("div");
    const fakeSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as unknown as SVGSVGElement;
    const items: LegendItem[] = [
      { series: "A", label: "A", color: "#f00", dashed: false, markerShape: "rect" },
      { series: "B", label: "B", color: "#00f", dashed: false, markerShape: "rect" },
      { series: "__extra__Total", label: "Total", color: undefined, dashed: false, markerShape: "dot", nonInteractive: true },
    ];
    renderLegend(parent, items, { svg: fakeSvg });
    // The reset button is the first child; legend items follow.
    const legendItems = parent.querySelectorAll(".tbl-legend-item");
    // 3 items rendered.
    expect(legendItems.length).toBe(3);
    // Only 2 are buttons (the real series).
    const buttons = parent.querySelectorAll(".tbl-legend-item[data-series]");
    expect(buttons.length).toBe(2);
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
