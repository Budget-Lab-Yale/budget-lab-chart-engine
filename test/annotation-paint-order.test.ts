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

  it("x-marker labelSide (side of the line) maps to text-anchor: left→end, right→start", () => {
    const anchorOf = (marker: object): string | null => {
      const s: ChartSpec = {
        chartType: "line",
        title: "t",
        xAxisType: "numeric",
        data: "x",
        annotations: { xAxis: [{ x: "2021", label: "LBL", ...marker }] },
      };
      const { svg } = renderChart(s, rows, { width: 720, height: 400, document });
      const t = Array.from(svg.querySelectorAll("text")).find((e) => e.textContent === "LBL");
      // Plot puts text-anchor on the wrapping <g>; "middle" is the SVG default so it's omitted.
      return t?.closest("g[text-anchor]")?.getAttribute("text-anchor") ?? t?.getAttribute("text-anchor") ?? null;
    };
    expect(anchorOf({ labelSide: "left" })).toBe("end"); // label to the LEFT of the line
    expect(anchorOf({ labelSide: "right" })).toBe("start"); // to the RIGHT
    expect(anchorOf({ labelSide: "middle" })).toBe(null); // centered → "middle" (omitted)
  });
});

// The translate-Y of an element's own transform (0 when absent). Plot puts the base position on the
// <text> transform and the dx/dy nudge on the wrapping <g> transform, so we sum both.
function transY(el: Element | null): number {
  const m = /translate\(\s*[-\d.]+\s*,\s*([-\d.]+)\s*\)/.exec(el?.getAttribute("transform") ?? "");
  return m ? Number(m[1]) : 0;
}
function transX(el: Element | null): number {
  const m = /translate\(\s*([-\d.]+)\s*,/.exec(el?.getAttribute("transform") ?? "");
  return m ? Number(m[1]) : 0;
}
function findLabel(spec: object, text: string): SVGTextElement {
  const s = { chartType: "line", title: "t", xAxisType: "numeric", data: "x", ...spec } as ChartSpec;
  const { svg } = renderChart(s, rows, { width: 720, height: 400, document });
  return Array.from(svg.querySelectorAll("text")).find((e) => e.textContent === text)! as unknown as SVGTextElement;
}
// Effective on-screen vertical position (larger = lower) of an x-marker label under `marker`.
function xLabelY(marker: object): number {
  const t = findLabel({ annotations: { xAxis: [{ x: "2021", label: "LBL", ...marker }] } }, "LBL");
  return transY(t) + transY(t.parentElement);
}
// Same, for a y-marker label at y=2.
function yLabelY(marker: object): number {
  const t = findLabel({ annotations: { yAxis: [{ y: 2, label: "YM", ...marker }] } }, "YM");
  return transY(t) + transY(t.parentElement);
}

describe("annotation label placement + sign conventions", () => {
  it("x-marker labelPosition places the label top / middle / bottom (relative to the x-axis)", () => {
    const top = xLabelY({ labelPosition: "top" });
    const middle = xLabelY({ labelPosition: "middle" });
    const bottom = xLabelY({ labelPosition: "bottom" });
    expect(top).toBeLessThan(middle);
    expect(middle).toBeLessThan(bottom);
    // Default (unset) matches "top".
    expect(xLabelY({})).toBeCloseTo(top, 3);
  });

  it("y-marker labelSide places the label top / middle / bottom (its side of the line)", () => {
    const top = yLabelY({ labelSide: "top" });
    const middle = yLabelY({ labelSide: "middle" });
    const bottom = yLabelY({ labelSide: "bottom" });
    expect(top).toBeLessThan(middle); // above the line = higher on screen (smaller y)
    expect(middle).toBeLessThan(bottom); // below the line = lower on screen
    // Default (unset) matches "top".
    expect(yLabelY({})).toBeCloseTo(top, 3);
  });

  it("labelDy is + = UP: a positive nudge raises the label, negative lowers it", () => {
    const base = xLabelY({ labelPosition: "middle" });
    const up = xLabelY({ labelPosition: "middle", labelDy: 12 });
    const down = xLabelY({ labelPosition: "middle", labelDy: -12 });
    expect(up).toBeLessThan(base); // + = up (smaller y)
    expect(down).toBeGreaterThan(base); // - = down
    expect(base - up).toBeCloseTo(12, 3);
    expect(down - base).toBeCloseTo(12, 3);
  });

  it("y-marker labelPosition places the label left / middle / right along the line", () => {
    const yl = (marker: object) => {
      const t = findLabel({ annotations: { yAxis: [{ y: 2, label: "YM", ...marker }] } }, "YM");
      return transX(t) + transX(t.parentElement);
    };
    const left = yl({ labelPosition: "left" });
    const right = yl({ labelPosition: "right" });
    const mid = yl({ labelPosition: "middle" });
    // Middle sits between the left- and right-anchored positions, near the horizontal center.
    expect(mid).toBeGreaterThan(left);
    expect(mid).toBeLessThan(right);
    expect(mid).toBeGreaterThan(720 * 0.35);
    expect(mid).toBeLessThan(720 * 0.65);
    // Default (unset) matches "right".
    expect(yl({})).toBeCloseTo(right, 3);
  });
});
