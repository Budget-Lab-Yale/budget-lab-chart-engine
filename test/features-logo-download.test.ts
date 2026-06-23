// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mountChart } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

// Minimal spec + rows for testing
const SPEC: ChartSpec = {
  chartType: "line",
  title: "Test Chart Title",
  source: "Test Source",
  note: "Test note.",
  xAxisType: "temporal",
  data: { file: "fake.csv" },
};

const ROWS: TidyRow[] = [
  { time: "2020-01-01", series: "A", value: "10" },
  { time: "2020-07-01", series: "A", value: "20" },
  { time: "2021-01-01", series: "A", value: "15" },
];

describe("mountChart — logo and download buttons", () => {
  it("renders logo and two download buttons", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    mountChart(container, { spec: SPEC, rows: ROWS });

    const logo = container.querySelector(".figure-logo");
    expect(logo).not.toBeNull();

    const btns = container.querySelectorAll(".figure-download-btn");
    expect(btns.length).toBe(2);
    document.body.removeChild(container);
  });
});

describe("buildExportSvg — composition", () => {
  it("includes title text", () => {
    const svg = buildExportSvg(SPEC, ROWS);
    expect(svg.textContent).toContain("Test Chart Title");
  });

  it("includes an image element with logo data URL", () => {
    const svg = buildExportSvg(SPEC, ROWS);
    const img = svg.querySelector("image");
    expect(img).not.toBeNull();
    const href = img?.getAttribute("href") ?? "";
    expect(href.startsWith("data:image/svg+xml;base64,")).toBe(true);
  });

  it("includes @font-face in the style element", () => {
    const svg = buildExportSvg(SPEC, ROWS);
    const style = svg.querySelector("style");
    expect(style).not.toBeNull();
    expect(style?.textContent ?? "").toContain("@font-face");
  });

  it("includes source text", () => {
    const svg = buildExportSvg(SPEC, ROWS);
    expect(svg.textContent).toContain("Test Source");
  });

  it("uses a fixed 1000x750 (4:3) frame, matching AILMT", () => {
    const svg = buildExportSvg(SPEC, ROWS);
    expect(svg.getAttribute("width")).toBe("1000");
    expect(svg.getAttribute("height")).toBe("750");
  });

  it("omits the eyebrow / figure number from the export", () => {
    const svg = buildExportSvg({ ...SPEC, eyebrow: "Figure 9" }, ROWS);
    expect(svg.textContent ?? "").not.toContain("Figure 9");
  });

  it("includes the y-axis title caption when y_axis_title is set", () => {
    const svg = buildExportSvg({ ...SPEC, y_axis_title: "Percent of GDP" }, ROWS);
    expect(svg.textContent ?? "").toContain("Percent of GDP");
  });
});

// ---------------------------------------------------------------------------
// buildExportSvg — small-multiples figures (B7)

describe("buildExportSvg — small multiples", () => {
  // 4 facets × 2 series, enough for a 2x2 grid (default) or a many-row figure.
  const FACET_ROWS: TidyRow[] = [];
  for (const region of ["Northeast", "Midwest", "South", "West"]) {
    for (let y = 2020; y <= 2023; y++) {
      FACET_ROWS.push({ facet: region, series: "A", time: `${y}-01-01`, value: String(2 + (y - 2020)) } as TidyRow);
      FACET_ROWS.push({ facet: region, series: "B", time: `${y}-01-01`, value: String(5 + (y - 2020)) } as TidyRow);
    }
  }
  // 6 facets for the "extended height with many rows" cases.
  const MANY_ROWS: TidyRow[] = [];
  for (const region of ["R1", "R2", "R3", "R4", "R5", "R6"]) {
    for (let y = 2020; y <= 2023; y++) {
      MANY_ROWS.push({ facet: region, series: "A", time: `${y}-01-01`, value: String(2 + (y - 2020)) } as TidyRow);
      MANY_ROWS.push({ facet: region, series: "B", time: `${y}-01-01`, value: String(5 + (y - 2020)) } as TidyRow);
    }
  }
  const SHARED_SPEC: ChartSpec = {
    chartType: "line",
    title: "Regions",
    subtitle: "Percent",
    source: "Test Source",
    note: "Test note.",
    xAxisType: "temporal",
    series_order: ["A", "B"],
    data: "inline",
    small_multiples: { facet_field: "facet", columns: 2, mode: "shared" },
  };
  const PERPANE_SPEC: ChartSpec = {
    ...SHARED_SPEC,
    small_multiples: { facet_field: "facet", columns: 2, mode: "per-pane" },
  };

  it("shared figure: N per-pane svgs (shared scale) laid in a grid + chrome", () => {
    const svg = buildExportSvg(SHARED_SPEC, FACET_ROWS);
    expect(svg.tagName.toLowerCase()).toBe("svg");
    // Shared mode is now a per-pane composition: one standalone svg per pane (4 regions).
    const inner = svg.querySelectorAll("svg");
    expect(inner.length).toBe(4);
    // Line marks are present in each pane.
    inner.forEach((s) => expect(s.querySelectorAll("path").length).toBeGreaterThan(0));
    // Each pane title is present (drawn as export text above its cell).
    for (const region of ["Northeast", "Midwest", "South", "West"]) {
      expect(svg.textContent).toContain(region);
    }
    // Panes are laid in a grid: at 2 cols there is more than one distinct column x.
    const xs = Array.from(inner).map((s) => Number(s.getAttribute("x")));
    expect(new Set(xs).size).toBeGreaterThan(1);
    // Chrome: title + source.
    expect(svg.textContent).toContain("Regions");
    expect(svg.textContent).toContain("Test Source");
  });

  it("shared figure with many rows extends the frame beyond 750", () => {
    // 6 panes at 2 cols → 3 rows → the per-pane grid is taller than the default avail.
    const svg = buildExportSvg({ ...SHARED_SPEC }, MANY_ROWS);
    expect(svg.querySelectorAll("svg").length).toBe(6);
    expect(Number(svg.getAttribute("height"))).toBeGreaterThan(750);
    // Background rect tracks the extended height (stays behind, first painted).
    const bg = svg.querySelector("rect");
    expect(bg?.getAttribute("height")).toBe(svg.getAttribute("height"));
  });

  it("per-pane figure: N pane titles + N pane svgs laid in a grid", () => {
    const svg = buildExportSvg(PERPANE_SPEC, FACET_ROWS);
    // One standalone svg per pane (4 regions).
    const inner = svg.querySelectorAll("svg");
    expect(inner.length).toBe(4);
    // Each pane title text is present.
    for (const region of ["Northeast", "Midwest", "South", "West"]) {
      expect(svg.textContent).toContain(region);
    }
    // Panes are laid in a grid: at 2 cols the second pane sits to the right of the first.
    const xs = Array.from(inner).map((s) => Number(s.getAttribute("x")));
    expect(new Set(xs).size).toBeGreaterThan(1); // more than one distinct column x
  });

  it("per-pane figure with >4 panes extends the frame beyond 750", () => {
    // 6 panes at 2 cols → 3 rows → grid taller than the default avail.
    const svg = buildExportSvg(PERPANE_SPEC, MANY_ROWS);
    expect(svg.querySelectorAll("svg").length).toBe(6);
    expect(Number(svg.getAttribute("height"))).toBeGreaterThan(750);
  });

  it("short figure (single row of panes) sizes to content — no 750 whitespace floor", () => {
    // 2 facets at 2 cols → a single row, so the export should be much shorter than 750.
    const twoFacets: TidyRow[] = [];
    for (const region of ["Men", "Women"]) {
      for (let y = 2020; y <= 2023; y++) {
        twoFacets.push({ facet: region, series: "A", time: `${y}-01-01`, value: String(2 + (y - 2020)) } as TidyRow);
        twoFacets.push({ facet: region, series: "B", time: `${y}-01-01`, value: String(5 + (y - 2020)) } as TidyRow);
      }
    }
    const svg = buildExportSvg(SHARED_SPEC, twoFacets);
    expect(svg.querySelectorAll("svg").length).toBe(2);
    expect(Number(svg.getAttribute("height"))).toBeLessThan(750);
  });

  it("draws per-series marker symbols in the legend when points is set", () => {
    // The legend symbol swatches use a thin white outline (stroke-width 0.75), distinct from the
    // pane markers (stroke-width 1), so we can detect them.
    const svg = buildExportSvg({ ...SHARED_SPEC, points: true }, FACET_ROWS);
    const legendSymbols = svg.querySelectorAll('path[stroke-width="0.75"]');
    expect(legendSymbols.length).toBe(2); // one per series (A, B)
  });

  it("single chart export stays at the fixed 750 frame (unchanged)", () => {
    const svg = buildExportSvg(SPEC, ROWS);
    expect(svg.getAttribute("width")).toBe("1000");
    expect(svg.getAttribute("height")).toBe("750");
  });
});
