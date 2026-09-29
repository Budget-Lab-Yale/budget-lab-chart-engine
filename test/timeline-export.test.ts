// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildExportSvg } from "../src/embed/export-png";
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

describe("timeline export", () => {
  it("re-renders the timeline marks, spans and gradient into the export SVG", () => {
    const svg = buildExportSvg(SPEC, ROWS);
    expect(svg.querySelectorAll("circle.tbl-timeline-marker")).toHaveLength(2);
    expect(svg.querySelectorAll("rect.tbl-timeline-span")).toHaveLength(1);
    expect(svg.querySelector('linearGradient[id^="tblfade-"]')).not.toBeNull();
  });

  it("keeps the authored horizontal orientation (no auto-switch in the export)", () => {
    const svg = buildExportSvg(SPEC, ROWS);
    const rule = svg.querySelector("line.tbl-timeline-rule")!;
    expect(rule.getAttribute("y1")).toBe(rule.getAttribute("y2"));
  });

  it("sizes the frame to content: a horizontal timeline is shorter than the 750 default frame", () => {
    expect(Number(buildExportSvg(SPEC, ROWS).getAttribute("height"))).toBeLessThan(750);
  });

  it("grows the frame for a tall vertical timeline", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`, end: "", title: `Event ${i} with enough words to wrap` })) as TidyRow[];
    const svg = buildExportSvg({ ...SPEC, orientation: "vertical" } as ChartSpec, many);
    expect(Number(svg.getAttribute("height"))).toBeGreaterThan(750);
  });
});
