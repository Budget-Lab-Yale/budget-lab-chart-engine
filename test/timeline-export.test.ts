// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildExportSvg } from "../src/embed/export-png";
import { resolveTimelineOrientation, timelineExportChartWidth, TIMELINE_CLASS } from "../src/engine/marks/timeline";
import { INNER_W } from "../src/embed/figure-chrome";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const SPEC = {
  chartType: "timeline", title: "T", xAxisType: "temporal", data: "d.csv", source: "The Budget Lab",
  columns: { x: "date", end: "end", label: "title" },
} as ChartSpec;
const ROWS = [
  { date: "2026", end: "", title: "Policy begins" },
  { date: "2030", end: "ongoing", title: "Credits" },
  { date: "2095", end: "", title: "Cohort turns 65" },
] as TidyRow[];

// 40 events packed into one month: too dense to fit within `timeline.max_rows` (default 2) label
// rows per side at the export width, so with `auto_vertical` (default true) a LIVE mount switches
// this to vertical. Used below to prove the export does NOT do the same.
const PACKED_ROWS = Array.from({ length: 40 }, (_, i) => ({
  date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`, end: "", title: `Event ${i} with enough words to wrap`,
})) as TidyRow[];

describe("timeline export", () => {
  it("re-renders the timeline marks, spans and gradient into the export SVG", () => {
    const svg = buildExportSvg(SPEC, ROWS);
    expect(svg.querySelectorAll("circle.tbl-timeline-marker")).toHaveLength(2);
    expect(svg.querySelectorAll("rect.tbl-timeline-span")).toHaveLength(1);
    expect(svg.querySelector('linearGradient[id^="tblfade-"]')).not.toBeNull();
  });

  it("keeps the authored horizontal orientation (no auto-switch in the export), even for data that does not fit horizontally", () => {
    // Precondition: at the export width, PACKED_ROWS does NOT fit horizontally, so a live mount
    // (which passes timelineOrientation) would render this vertical. If it fit, this test could
    // pass even with auto-switch left wired in -- it needs data that actually forces the switch.
    expect(resolveTimelineOrientation(SPEC, PACKED_ROWS, INNER_W)).toBe("vertical");
    const svg = buildExportSvg(SPEC, PACKED_ROWS);
    const rule = svg.querySelector("line.tbl-timeline-rule")!;
    expect(rule.getAttribute("y1")).toBe(rule.getAttribute("y2"));
  });

  it("sizes the frame to content: a horizontal timeline is shorter than the 750 default frame", () => {
    expect(Number(buildExportSvg(SPEC, ROWS).getAttribute("height"))).toBeLessThan(750);
  });

  it("grows the frame for a tall vertical timeline", () => {
    const svg = buildExportSvg({ ...SPEC, orientation: "vertical" } as ChartSpec, PACKED_ROWS);
    expect(Number(svg.getAttribute("height"))).toBeGreaterThan(750);
  });
});

// Two alternating categories, so the legend actually shows rows (`lanes` defaults off, so a
// >1-series timeline draws a legend by default) -- otherwise there is nothing to put in a column.
const LEGEND_ROWS = Array.from({ length: 11 }, (_, i) => ({
  date: `${2016 + i}-01-01`, title: "Event headline here", category: i % 2 === 0 ? "alpha" : "beta",
})) as TidyRow[];
const LEGEND_SPEC = {
  chartType: "timeline", title: "T", xAxisType: "temporal", data: "d.csv",
  timeline: { spacing: "even", max_rows: 1 },
  columns: { x: "date", label: "title", series: "category" },
} as ChartSpec;

describe("timeline export — right-legend chart width (Ruling 17)", () => {
  it("matches timelineExportChartWidth for a right-legend timeline (narrower than INNER_W)", () => {
    const spec = { ...LEGEND_SPEC, legendPosition: "right" } as ChartSpec;
    const expected = timelineExportChartWidth(spec, LEGEND_ROWS);
    expect(expected).toBeLessThan(INNER_W);
    const svg = buildExportSvg(spec, LEGEND_ROWS);
    const chartSvg = svg.querySelector(`svg.${TIMELINE_CLASS}`)!;
    expect(Number(chartSvg.getAttribute("width"))).toBe(expected);
  });

  it("matches timelineExportChartWidth for a top-legend timeline (the full INNER_W)", () => {
    const spec = { ...LEGEND_SPEC, legendPosition: "top" } as ChartSpec;
    const expected = timelineExportChartWidth(spec, LEGEND_ROWS);
    expect(expected).toBe(INNER_W);
    const svg = buildExportSvg(spec, LEGEND_ROWS);
    const chartSvg = svg.querySelector(`svg.${TIMELINE_CLASS}`)!;
    expect(Number(chartSvg.getAttribute("width"))).toBe(expected);
  });
});
