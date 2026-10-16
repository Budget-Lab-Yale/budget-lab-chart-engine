// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import type { ChartSpec } from "../src/spec/types";
import { csvFixtureReader } from "./helpers/csv";

const parseCsv = csvFixtureReader(import.meta.url);
const FIG7 = parseCsv("./fixtures/timeline-figure7.csv");
const SPANS = parseCsv("./fixtures/timeline-spans.csv");
const base = { chartType: "timeline", title: "t", xAxisType: "temporal", data: "d.csv" } as const;

describe("timeline goldens", () => {
  it("reference image (horizontal, two categories, points)", async () => {
    const spec = { ...base, columns: { x: "date", series: "kind" }, series_colors: { policy: "blue", cohort: "amber" } } as ChartSpec;
    await expect(renderChart(spec, FIG7, { width: 920 }).svg.outerHTML).toMatchFileSnapshot("./fixtures/timeline-figure7.golden.svg");
  });
  it("spans + lanes + projected + ongoing", async () => {
    const spec = { ...base, columns: { x: "date", end: "end_date", series: "kind" }, projected_field: "projected", timeline: { lanes: true } } as ChartSpec;
    await expect(renderChart(spec, SPANS, { width: 920 }).svg.outerHTML).toMatchFileSnapshot("./fixtures/timeline-spans-lanes.golden.svg");
  });
  it("vertical", async () => {
    const spec = { ...base, orientation: "vertical", columns: { x: "date", end: "end_date", series: "kind" }, projected_field: "projected" } as ChartSpec;
    await expect(renderChart(spec, SPANS, { width: 360 }).svg.outerHTML).toMatchFileSnapshot("./fixtures/timeline-vertical.golden.svg");
  });
  it("vertical two-lane columns", async () => {
    const spec = { ...base, orientation: "vertical", columns: { x: "date", end: "end_date", series: "kind" }, projected_field: "projected", timeline: { lanes: true } } as ChartSpec;
    await expect(renderChart(spec, SPANS, { width: 375 }).svg.outerHTML).toMatchFileSnapshot("./fixtures/timeline-vertical-lanes.golden.svg");
  });
  it("even spacing", async () => {
    const spec = { ...base, columns: { x: "date", series: "kind" }, timeline: { spacing: "even" } } as ChartSpec;
    await expect(renderChart(spec, FIG7, { width: 920 }).svg.outerHTML).toMatchFileSnapshot("./fixtures/timeline-even.golden.svg");
  });
});
