// @vitest-environment jsdom
//
// A8 (review 2026-10-15, render-live IMPORTANT #1): a callout that gives `series` and no `y` snaps to
// the top of that series' band on a stacked bar or area. The snap ranked series by `series_order`
// and summed every lower-ranked value, while the builders stack in `barStack.stackOrder` (stacked)
// or the live restack order (area), and Plot stacks each sign away from zero separately. So under a
// stackOrder, a restack, or a mixed-sign stack, the callout named one segment and pointed at another.
//
// The snapped y is read back through the label's `{value}` token, which prints the y the callout is
// drawn at.
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import { buildExportSvg } from "../src/embed/export-png";
import { mountChart } from "../src/engine/render-live";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const OPTS = { width: 720, height: 400, document };

const callout = (x: string, series: string) => ({
  x, series, label: `${x}/${series}={value}`, value_format: { decimals: 0 },
});
/** Callout label → the value it printed. */
const snapped = (svg: Element): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const t of svg.querySelectorAll("text")) {
    const m = /^([^=\s]+)=(-?\d+)$/.exec(t.textContent ?? "");
    if (m) out[m[1]!] = Number(m[2]);
  }
  return out;
};

// 2026 all positive; 2027 mixed sign (B is negative).
const CAT_ROWS = (
  [["2026", "A", 10], ["2026", "B", 20], ["2026", "C", 5], ["2027", "A", 10], ["2027", "B", -20], ["2027", "C", 5]] as const
).map(([time, series, v]) => ({ time, series, value: String(v) })) as unknown as TidyRow[];
const POINTS = [callout("2026", "A"), callout("2026", "B"), callout("2026", "C"), callout("2027", "B"), callout("2027", "C")];

const stacked = (s: Record<string, unknown> = {}): ChartSpec =>
  ({
    title: "t", chartType: "stacked", xAxisType: "categorical", data: "d.csv",
    series_order: ["A", "B", "C"],
    annotations: { points: POINTS },
    ...s,
  }) as unknown as ChartSpec;

describe("A8: a series-snapped callout on a stacked bar", () => {
  it("default order: the cumulative top in series_order", () => {
    const v = snapped(renderChart(stacked(), CAT_ROWS, OPTS).svg);
    expect(v["2026/A"]).toBe(10);
    expect(v["2026/B"]).toBe(30);
    expect(v["2026/C"]).toBe(35);
  });

  it("barStack.stackOrder: the top of the band as stacked, not as declared", () => {
    const v = snapped(renderChart(stacked({ barStack: { stackOrder: ["C", "A", "B"] } }), CAT_ROWS, OPTS).svg);
    expect(v["2026/C"]).toBe(5);
    expect(v["2026/A"]).toBe(15);
    expect(v["2026/B"]).toBe(35);
  });

  it("mixed sign: a positive series sums only positives, a negative one only negatives", () => {
    const v = snapped(renderChart(stacked(), CAT_ROWS, OPTS).svg);
    // C (+5) sits on A (+10); B (-20) hangs below zero on its own.
    expect(v["2027/C"]).toBe(15);
    expect(v["2027/B"]).toBe(-20);
  });

  it("two negatives: the lower one's callout sums both, below zero", () => {
    const rows = ([["2026", "A", -5], ["2026", "B", -20], ["2026", "C", 5]] as const)
      .map(([time, series, v]) => ({ time, series, value: String(v) })) as unknown as TidyRow[];
    const s = stacked({ annotations: { points: [callout("2026", "A"), callout("2026", "B"), callout("2026", "C")] } });
    const v = snapped(renderChart(s, rows, OPTS).svg);
    expect(v["2026/A"]).toBe(-5);
    expect(v["2026/B"]).toBe(-25);
    expect(v["2026/C"]).toBe(5);
  });

  it("the callout's point is the drawn segment's outer edge", () => {
    // A pixel check, so the agreement is with what Plot drew rather than with the snap's own sum. A
    // pinned connector callout on a categorical axis marks its point with a small dot.
    const s = stacked({ barStack: { stackOrder: ["C", "A", "B"] }, annotations: { points: [{ x: "2026", series: "C", label: "here", connector: true, dy: 40 }] } });
    // 2026 only: the mixed-sign year would add net dots.
    const { svg } = renderChart(s, CAT_ROWS.filter((r) => r.time === "2026"), OPTS);
    const top =Number(svg.querySelector('g[aria-label="bar"] rect[data-series="C"]')!.getAttribute("y"));
    const dots = [...svg.querySelectorAll('g[aria-label="dot"] circle')];
    expect(dots.length).toBe(1);
    expect(Number(dots[0]!.getAttribute("cy"))).toBeCloseTo(top, 0);
  });

  it("the PNG export snaps the same way (it re-renders from the spec)", () => {
    const v = snapped(buildExportSvg(stacked({ barStack: { stackOrder: ["C", "A", "B"] } }), CAT_ROWS));
    expect(v["2026/C"]).toBe(5);
    expect(v["2027/B"]).toBe(-20);
  });
});

const AREA_ROWS = (
  [["2024-01-01", "A", 10], ["2024-01-01", "B", 20], ["2024-01-01", "C", 5], ["2024-02-01", "A", 10], ["2024-02-01", "B", 20], ["2024-02-01", "C", 5]] as const
).map(([time, series, v]) => ({ time, series, value: String(v) })) as unknown as TidyRow[];
const AREA: ChartSpec = {
  title: "t", chartType: "area", xAxisType: "temporal", data: "d.csv",
  series_order: ["A", "B", "C"],
  annotations: { points: [callout("2024-01-01", "C"), callout("2024-01-01", "A")] },
} as unknown as ChartSpec;

describe("A8: a series-snapped callout on an area", () => {
  it("default order", () => {
    const v = snapped(renderChart(AREA, AREA_ROWS, OPTS).svg);
    expect(v["2024-01-01/C"]).toBe(35);
    expect(v["2024-01-01/A"]).toBe(10);
  });

  it("a restack order (RenderOptions.stackOrder) moves the callout with its band", () => {
    const v = snapped(renderChart(AREA, AREA_ROWS, { ...OPTS, stackOrder: ["C"] }).svg);
    expect(v["2024-01-01/C"]).toBe(5);
    expect(v["2024-01-01/A"]).toBe(15);
  });

  it("live: pinning a series restacks it to the bottom, and its callout follows", () => {
    const container = document.createElement("div");
    document.body.append(container);
    try {
      mountChart(container, { spec: AREA, rows: AREA_ROWS });
      const svg = () => container.querySelector(".figure-canvas svg")!;
      expect(snapped(svg())["2024-01-01/C"]).toBe(35);
      [...container.querySelectorAll<HTMLElement>(".tbl-legend-item")].find((b) => b.getAttribute("data-series") === "C")!.click();
      expect(snapped(svg())["2024-01-01/C"]).toBe(5);
      expect(snapped(svg())["2024-01-01/A"]).toBe(15);
    } finally {
      container.remove();
    }
  });

  it("barStack.stackOrder does not reach an area (its builder never reads it)", () => {
    const v = snapped(renderChart({ ...AREA, barStack: { stackOrder: ["C"] } } as ChartSpec, AREA_ROWS, OPTS).svg);
    expect(v["2024-01-01/C"]).toBe(35);
  });
});
