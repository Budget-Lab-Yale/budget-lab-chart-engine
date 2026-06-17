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
});
