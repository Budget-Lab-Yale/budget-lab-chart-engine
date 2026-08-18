// @vitest-environment jsdom
//
// How an overlay is identified to the reader: an in-frame label at the line, or a legend row. Never
// both — `legend: true` MOVES the label, the convention annotations.yAxis follows — and never
// NEITHER, which is what would happen if the label were stripped on a chart whose legend is off.
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import { buildExportSvg } from "../src/embed/export-png";
import { OVERLAY_LABEL_CLASS } from "../src/engine/marks/overlay";
import { TBL } from "../src/engine/theme";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const BASE = {
  chartType: "scatter",
  title: "t",
  xAxisType: "numeric",
  data: "data.csv",
  columns: { x: "time", value: "value", series: "series" },
} as unknown as ChartSpec;

const ROWS: TidyRow[] = [
  { time: "1", value: "1", series: "A" },
  { time: "2", value: "3", series: "A" },
  { time: "3", value: "2", series: "A" },
] as unknown as TidyRow[];

const OPTS = { width: 720, height: 400, document };

const labelTexts = (svg: SVGSVGElement) =>
  Array.from(svg.querySelectorAll(`g.${OVERLAY_LABEL_CLASS} text`)).map((t) => t.textContent);

function spec(overlays: unknown[], patch: Record<string, unknown> = {}): ChartSpec {
  return { ...BASE, ...patch, overlays } as ChartSpec;
}

describe("overlays — in-frame label", () => {
  it("draws no label when none is given", () => {
    expect(labelTexts(renderChart(spec([{ method: "lm" }]), ROWS, OPTS).svg)).toEqual([]);
  });

  it("draws the label at the line", () => {
    expect(labelTexts(renderChart(spec([{ method: "lm", label: "Linear fit" }]), ROWS, OPTS).svg)).toEqual([
      "Linear fit",
    ]);
  });

  it("colours the label to match its line", () => {
    const { svg } = renderChart(spec([{ slope: 1, intercept: 0, label: "45 degrees" }]), ROWS, OPTS);
    // Plot hoists a CONSTANT fill onto the wrapping <g aria-label="text">, not each <text> — the
    // same behavior band-crosshair.test.ts and shading-render.test.ts already assert against for
    // other Plot-generated marks, so the fill is read off the group, not the leaf.
    expect(svg.querySelector(`g.${OVERLAY_LABEL_CLASS}`)!.getAttribute("fill")).toBe(
      TBL.color.annotationDim,
    );
  });

  it("is NOT clipped — a half-cut label reads worse than one past the axis", () => {
    const { svg } = renderChart(spec([{ method: "lm", label: "Linear fit" }]), ROWS, OPTS);
    const g = svg.querySelector(`g.${OVERLAY_LABEL_CLASS}`)!;
    expect(g.getAttribute("clip-path")).toBeNull();
  });

  it("reaches the export path", () => {
    expect(labelTexts(buildExportSvg(spec([{ method: "lm", label: "Linear fit" }]), ROWS))).toEqual([
      "Linear fit",
    ]);
  });
});

describe("overlays — legend row", () => {
  it("emits a line-swatch row and draws nothing in-frame", () => {
    const s = spec([{ fun: "2*x", label: "Fitted line (prelim slope)", legend: true }]);
    const { svg, legendItems } = renderChart(s, ROWS, OPTS);
    expect(labelTexts(svg)).toEqual([]);
    const row = (legendItems ?? []).find((i) => i.label === "Fitted line (prelim slope)");
    expect(row).toBeTruthy();
    expect(row!.markerShape).toBe("line");
    expect(row!.annotation).toBe(true);
  });

  it("keys a dashed overlay with a dashed swatch and a solid one with a solid swatch", () => {
    const dashed = renderChart(spec([{ fun: "x", label: "Asserted", legend: true }]), ROWS, OPTS);
    const solid = renderChart(spec([{ method: "lm", label: "Fitted", legend: true }]), ROWS, OPTS);
    expect((dashed.legendItems ?? []).find((i) => i.label === "Asserted")!.dashed).toBe(true);
    expect((solid.legendItems ?? []).find((i) => i.label === "Fitted")!.dashed).toBe(false);
  });

  it("gives a per-series fit ONE neutral row for the concept, not one per series", () => {
    const two = [
      ...ROWS,
      { time: "1", value: "10", series: "B" },
      { time: "2", value: "12", series: "B" },
    ] as unknown as TidyRow[];
    const { legendItems } = renderChart(
      spec([{ method: "lm", label: "Linear fit", legend: true }]),
      two,
      OPTS,
    );
    const rows = (legendItems ?? []).filter((i) => i.label === "Linear fit");
    expect(rows.length).toBe(1);
    expect(rows[0]!.color).toBe(TBL.color.annotationDim);
  });

  it("reaches the export path's composed legend", () => {
    const svg = buildExportSvg(spec([{ fun: "x", label: "Asserted", legend: true }]), ROWS);
    const texts = Array.from(svg.querySelectorAll("text")).map((t) => t.textContent ?? "");
    expect(texts).toContain("Asserted");
  });
});

describe("overlays — legend: false on the chart", () => {
  it("keeps the label IN-FRAME rather than deleting it", () => {
    // With no legend to move the label to, stripping it would remove it from the figure entirely.
    // annotation-legend.ts's labelMovedToLegend exists for exactly this; the resolver mirrors it.
    const s = spec([{ fun: "x", label: "Asserted", legend: true }], { legend: false });
    const { svg, legendItems } = renderChart(s, ROWS, OPTS);
    expect(labelTexts(svg)).toEqual(["Asserted"]);
    expect((legendItems ?? []).some((i) => i.label === "Asserted")).toBe(false);
  });
});
