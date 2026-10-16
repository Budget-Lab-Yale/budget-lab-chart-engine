// @vitest-environment jsdom
//
// A7 (review 2026-10-15): with `barStack.stackOrder`, the stacked builder reorders the rows Plot
// stacks, but the in-segment value labels walked the stack in `series_order`, so each label was
// placed at the midpoint of a segment it does not name (both labels of a two-series stack landed in
// the larger segment). Every label must sit inside the drawn segment of the series whose value it
// prints — read from the rendered rects, not from the builder's own arithmetic.
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import { buildExportSvg } from "../src/embed/export-png";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const OPTS = { width: 720, height: 400, document };
const rowsOf = (rs: Array<[string, string, number]>): TidyRow[] =>
  rs.map(([time, series, v]) => ({ time, series, value: String(v) })) as unknown as TidyRow[];
const spec = (s: Record<string, unknown>): ChartSpec =>
  ({
    title: "t", chartType: "stacked", xAxisType: "categorical", data: "d.csv",
    columns: { x: "time", value: "value", series: "series" },
    valueLabels: { show: true },
    ...s,
  }) as unknown as ChartSpec;

const translate = (el: Element): [number, number] => {
  const m = /translate\(([-\d.e]+),([-\d.e]+)\)/.exec(el.getAttribute("transform") ?? "");
  return m ? [Number(m[1]), Number(m[2])] : [NaN, NaN];
};

/** For every segment label: the series whose drawn rect (same category band) contains the label's
 *  position on the value axis. `seriesOfText` maps the printed text back to the series it names. */
function labelHomes(svg: Element, horizontal: boolean): Array<{ text: string; home: string[] }> {
  const rects = [...svg.querySelectorAll<SVGRectElement>('g[aria-label="bar"] rect')].map((r) => {
    const x = Number(r.getAttribute("x"));
    const y = Number(r.getAttribute("y"));
    const w = Number(r.getAttribute("width"));
    const h = Number(r.getAttribute("height"));
    return { series: r.getAttribute("data-series") ?? "", x, y, w, h };
  });
  return [...svg.querySelectorAll("g.tbl-segment-label text")].map((t) => {
    const [lx, ly] = translate(t);
    const home = rects
      .filter((r) =>
        horizontal
          ? lx > r.x && lx < r.x + r.w && ly >= r.y - 1 && ly <= r.y + r.h + 1
          : ly > r.y && ly < r.y + r.h && lx >= r.x - 1 && lx <= r.x + r.w + 1,
      )
      .map((r) => r.series);
    return { text: t.textContent ?? "", home };
  });
}

// Distinct magnitudes, so a label's text names its series unambiguously.
const TWO = rowsOf([["2026", "Income", 10], ["2026", "Gains", 30]]);
const BY_TEXT_RAW: Record<string, string> = { "10": "Income", "30": "Gains" };
// Normalized: 10/40 = 25%, 30/40 = 75%.
const BY_TEXT_NORM: Record<string, string> = { "25": "Income", "75": "Gains" };

function expectEachLabelInItsSegment(svg: Element, horizontal: boolean, byText: Record<string, string>, n: number) {
  const homes = labelHomes(svg, horizontal);
  expect(homes.length, "every segment earns a label here").toBe(n);
  for (const { text, home } of homes) {
    expect(home, `label "${text}" sits in ${JSON.stringify(home)}, not in "${byText[text]}"`).toEqual([byText[text]]);
  }
}

describe("A7: segment labels follow barStack.stackOrder", () => {
  const ordered = { series_order: ["Income", "Gains"], barStack: { stackOrder: ["Gains", "Income"] } };

  it("vertical", () => {
    const { svg } = renderChart(spec(ordered), TWO, OPTS);
    expectEachLabelInItsSegment(svg, false, BY_TEXT_RAW, 2);
  });

  it("horizontal", () => {
    const { svg } = renderChart(spec({ ...ordered, orientation: "horizontal" }), TWO, OPTS);
    expectEachLabelInItsSegment(svg, true, BY_TEXT_RAW, 2);
  });

  it("100%-normalized", () => {
    const { svg } = renderChart(spec({ ...ordered, barStack: { ...ordered.barStack, normalize: true } }), TWO, OPTS);
    expectEachLabelInItsSegment(svg, false, BY_TEXT_NORM, 2);
  });

  it("mixed sign (netDisplay: text keeps the labels): each side follows the order on its own side", () => {
    // Positives P1 (10), P2 (30) above zero; negatives N1 (-12), N2 (-36) below. stackOrder reverses
    // each side's declaration order.
    const rows = rowsOf([["2026", "P1", 10], ["2026", "N1", -12], ["2026", "P2", 30], ["2026", "N2", -36]]);
    const s = spec({
      series_order: ["P1", "N1", "P2", "N2"],
      barStack: { stackOrder: ["N2", "P2", "N1", "P1"], netDisplay: "text" },
    });
    const { svg } = renderChart(s, rows, OPTS);
    // A segment label prints its magnitude: the side of zero carries the sign.
    expectEachLabelInItsSegment(svg, false, { "10": "P1", "30": "P2", "12": "N1", "36": "N2" }, 4);
  });

  it("three series, stackOrder lists one (the rest keep series_order after it)", () => {
    const rows = rowsOf([["A", "x", 10], ["A", "y", 20], ["A", "z", 40], ["B", "x", 12], ["B", "y", 22], ["B", "z", 44]]);
    const s = spec({ series_order: ["x", "y", "z"], barStack: { stackOrder: ["z"] } });
    const { svg } = renderChart(s, rows, OPTS);
    expectEachLabelInItsSegment(svg, false, { "10": "x", "20": "y", "40": "z", "12": "x", "22": "y", "44": "z" }, 6);
  });

  it("the PNG export places them the same way (it re-renders from the spec)", () => {
    const exported = buildExportSvg(spec(ordered), TWO);
    const plot = exported.querySelector("svg.tblchart")!;
    expectEachLabelInItsSegment(plot, false, BY_TEXT_RAW, 2);
  });

  it("without stackOrder the labels already sit in their segments (control)", () => {
    const { svg } = renderChart(spec({ series_order: ["Income", "Gains"] }), TWO, OPTS);
    expectEachLabelInItsSegment(svg, false, BY_TEXT_RAW, 2);
  });
});
