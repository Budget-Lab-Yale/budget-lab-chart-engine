// @vitest-environment jsdom
//
// Tests for the embed live-render layer: mountChart + buildStandaloneHtml.
import { describe, it, expect } from "vitest";
import { mountChart } from "../src/engine/render-live";
import { buildStandaloneHtml } from "../src/embed/bundle-standalone";
import { CHART_CSS } from "../src/embed/styles";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

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
