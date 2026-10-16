// @vitest-environment jsdom
//
// `xAxisPolicy.anchorAtZero: true` extends a numeric x-axis to include 0 (CONFIG-SPEC). Only the
// minimum used to move, so an axis whose x values were all negative stopped at its largest value and
// never reached 0. Checked on the drawn scale of a standalone chart and of a small-multiples figure,
// and on the PNG export's re-render of each (it renders from the spec, not from the live DOM).
import { describe, it, expect } from "vitest";
import { renderChart, renderFigure } from "../src/engine/index";
import { buildExportSvg } from "../src/embed/export-png";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const LINE = {
  chartType: "line",
  title: "T",
  xAxisType: "numeric",
  columns: { x: "x", value: "y", series: "s" },
  data: "d.csv",
} as unknown as ChartSpec;
const FIGURE = {
  ...LINE,
  columns: { x: "x", value: "y", series: "s", facet: "f" },
  small_multiples: { mode: "shared", columns: 2 },
} as unknown as ChartSpec;

const rowsAt = (xs: number[], facets = ["P"]): TidyRow[] =>
  facets.flatMap((f) => xs.map((x, i) => ({ f, x: String(x), s: "A", y: String(i + 1) }))) as unknown as TidyRow[];

const NEGATIVE = [-30, -20, -10];

/** [min, max] of the drawn x scale: Plot's own scale on the rendered svg. */
const xDomainOf = (svg: SVGSVGElement): number[] => {
  const scale = (svg as unknown as { scale: (n: string) => { domain: number[] } }).scale("x");
  return [Math.min(...scale.domain), Math.max(...scale.domain)];
};

/** The text of every x-axis tick label (Plot's x-axis tick-label group). */
const xTickTexts = (svg: SVGElement): string[] =>
  Array.from(svg.querySelectorAll('[aria-label="x-axis tick label"] text')).map((t) => (t.textContent ?? "").trim());

const OPTS = { width: 720, height: 400 };

describe("anchorAtZero on an axis whose x values are all negative", () => {
  it("a standalone chart's x scale runs to 0", () => {
    const { svg } = renderChart({ ...LINE, xAxisPolicy: { anchorAtZero: true } } as ChartSpec, rowsAt(NEGATIVE), OPTS);
    expect(xDomainOf(svg as SVGSVGElement)).toEqual([-30, 0]);
    expect(xTickTexts(svg as SVGSVGElement)).toContain("0");
  });

  it("without anchorAtZero the axis fits the data, as before (the test above is not vacuous)", () => {
    const { svg } = renderChart(LINE, rowsAt(NEGATIVE), OPTS);
    expect(xDomainOf(svg as SVGSVGElement)).toEqual([-30, -10]);
    expect(xTickTexts(svg as SVGSVGElement)).not.toContain("0");
  });

  it("every pane of a small-multiples figure runs to 0", () => {
    const fig = renderFigure(
      { ...FIGURE, xAxisPolicy: { anchorAtZero: true } } as ChartSpec,
      rowsAt(NEGATIVE, ["P", "Q"]),
      { gridWidth: 720, gridGap: 16, height: 300 },
    );
    expect(fig.panes).toHaveLength(2);
    for (const pane of fig.panes) expect(xDomainOf(pane.svg as SVGSVGElement)).toEqual([-30, 0]);
  });

  it("the PNG export draws the 0 tick, standalone and small multiples", () => {
    const standalone = buildExportSvg({ ...LINE, xAxisPolicy: { anchorAtZero: true } } as ChartSpec, rowsAt(NEGATIVE));
    expect(xTickTexts(standalone)).toContain("0");
    const figure = buildExportSvg({ ...FIGURE, xAxisPolicy: { anchorAtZero: true } } as ChartSpec, rowsAt(NEGATIVE, ["P", "Q"]));
    const panes = Array.from(figure.querySelectorAll("svg"));
    expect(panes.length).toBe(2);
    for (const pane of panes) expect(xTickTexts(pane)).toContain("0");
    // Control: the same export without the flag stops short of 0.
    expect(xTickTexts(buildExportSvg(LINE, rowsAt(NEGATIVE)))).not.toContain("0");
  });

  it("an axis that already spans 0, or lies above it, is unchanged by the fix", () => {
    const spanning = renderChart({ ...LINE, xAxisPolicy: { anchorAtZero: true } } as ChartSpec, rowsAt([-5, 5, 10]), OPTS);
    expect(xDomainOf(spanning.svg as SVGSVGElement)).toEqual([-5, 10]);
    const positive = renderChart({ ...LINE, xAxisPolicy: { anchorAtZero: true } } as ChartSpec, rowsAt([10, 20, 30]), OPTS);
    expect(xDomainOf(positive.svg as SVGSVGElement)).toEqual([0, 30]);
  });
});
