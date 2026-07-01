// @vitest-environment jsdom
//
// Observable Plot paints marks in array (DOM) order — later marks on top. Annotation LABELS must
// therefore be pushed AFTER every annotation line/band/rule, or a later line paints over an earlier
// label (the white halo can't help when a line is drawn after the text). This locks that ordering.
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const rows: TidyRow[] = [
  { time: "2020", series: "a", value: "1" },
  { time: "2021", series: "a", value: "3" },
  { time: "2022", series: "a", value: "2" },
] as TidyRow[];

const spec: ChartSpec = {
  chartType: "line",
  title: "t",
  xAxisType: "numeric",
  data: "x",
  annotations: {
    bands: [{ start: "2020", end: "2021", label: "BANDLABEL" }],
    xAxis: [
      { x: "2020.5", label: "MARKA" },
      { x: "2021.5", label: "MARKB" },
    ],
    yAxis: [
      { y: 1.5, label: "YMARKA" },
      { y: 2.5, label: "YMARKB" },
    ],
  },
};

describe("annotation paint order", () => {
  it("paints every annotation label AFTER every line/band rule (labels on top)", () => {
    const { svg } = renderChart(spec, rows, { width: 720, height: 400, document });
    // Flat document order (querySelectorAll returns document order = SVG paint order).
    const all = Array.from(svg.querySelectorAll("*"));
    const idx = (el: Element) => all.indexOf(el);

    // Plot styles marks via CSS classes (not attributes), so identify structurally: ALL <line>
    // (gridlines, zero baseline, x/y marker rules) and ALL <rect> (the band) must precede the
    // annotation LABEL texts (found by content). That's the invariant: all lines/rects, then text.
    const lines = Array.from(svg.querySelectorAll("line"));
    const rects = Array.from(svg.querySelectorAll("rect"));
    const labels = Array.from(svg.querySelectorAll("text")).filter((t) =>
      /^(BANDLABEL|MARKA|MARKB|YMARKA|YMARKB)$/.test(t.textContent ?? ""),
    );

    expect(labels.length).toBe(5);
    expect(lines.length).toBeGreaterThan(0);
    expect(rects.length).toBeGreaterThan(0);

    const lastLineOrRect = Math.max(...lines.map(idx), ...rects.map(idx));
    const firstLabel = Math.min(...labels.map(idx));
    // Every annotation label comes after the last line/rect in the DOM (so nothing paints over it).
    expect(firstLabel).toBeGreaterThan(lastLineOrRect);
  });
});
