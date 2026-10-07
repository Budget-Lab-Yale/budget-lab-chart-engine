// @vitest-environment jsdom
//
// The left gutter of a horizontal bar, stack or dumbbell leaves GUTTER_TEXT_PAD clear between the
// category labels and the plot. It is sized from an average-advance estimate, which runs short on a
// short label of wide glyphs: "Gamma" at 13px renders 45.5px wide, estimated 35.75, so the gutter was
// 46 and the label reached the plot's left edge (on a dumbbell, the zero rule). The gutter is now
// floored at each one-line label's glyph-measured width plus the pad. A label that already had the
// room leaves the gutter unchanged.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { renderChart, renderFigure } from "../src/engine/index";
import { mountChart } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import { INNER_W } from "../src/embed/figure-chrome";
import * as axes from "../src/engine/axes";
import { GUTTER_TEXT_PAD, FACETED_CAT_LABEL_PX, horizontalLeftGutter, estimateLabelWidth } from "../src/engine/axes";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const realGetContext = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
});
beforeEach(() => {
  document.body.innerHTML = "";
});

/** "Gamma" at 13px, weight 500, measured with canvas.measureText in Chromium with Figtree loaded. */
const GAMMA_13 = 45.53;
const CATS = ["Alpha", "Beta", "Gamma"];
const marginLeft = (svg: SVGSVGElement): number => Number(svg.dataset.marginLeft);

const DUMBBELL: ChartSpec = {
  chartType: "dumbbell",
  title: "t",
  xAxisType: "categorical",
  orientation: "horizontal",
  columns: { category: "g", series: "m", value: "v" },
  series_order: ["A", "B"],
  yAxisPolicy: { includeZero: true },
  data: "d.csv",
};
const dbRows = (): TidyRow[] =>
  CATS.flatMap((g, i) => [
    { g, m: "A", v: String(8 + i) },
    { g, m: "B", v: String(12 + i) },
  ]) as unknown as TidyRow[];
const BAR: ChartSpec = {
  chartType: "bar",
  title: "t",
  xAxisType: "categorical",
  orientation: "horizontal",
  columns: { x: "g", value: "v" },
  data: "d.csv",
};
const barRows = (): TidyRow[] => CATS.map((g, i) => ({ g, v: String(8 + i) })) as unknown as TidyRow[];
const STACK: ChartSpec = {
  chartType: "stacked",
  title: "t",
  xAxisType: "categorical",
  orientation: "horizontal",
  columns: { x: "g", series: "m", value: "v" },
  data: "d.csv",
};

const exportChart = (root: SVGSVGElement): SVGSVGElement =>
  Array.from(root.querySelectorAll("svg")).find((s) => s.dataset.marginLeft != null) as SVGSVGElement;

describe("category label width", () => {
  it("measures a label from Figtree's glyph advances", () => {
    const measured = (axes as unknown as { measuredLabelWidth?: (t: string, f: number) => number }).measuredLabelWidth;
    expect(measured).toBeTypeOf("function");
    expect(measured!("Gamma", 13)).toBeCloseTo(GAMMA_13, 0);
    // The estimate this corrects runs ~10px short.
    expect(estimateLabelWidth("Gamma", 13)).toBeLessThan(GAMMA_13 - 9);
  });

  it("the gutter clears the widest one-line label by GUTTER_TEXT_PAD", () => {
    expect(horizontalLeftGutter(CATS, { fontSize: FACETED_CAT_LABEL_PX })).toBeGreaterThanOrEqual(GAMMA_13 + GUTTER_TEXT_PAD);
    // The section indent is added on top, unchanged.
    expect(horizontalLeftGutter(CATS, { fontSize: FACETED_CAT_LABEL_PX, indent: 14 })).toBe(
      horizontalLeftGutter(CATS, { fontSize: FACETED_CAT_LABEL_PX }) + 14,
    );
  });

  it("leaves the gutter unchanged where the estimate already gave the label room", () => {
    // Published label sets: the estimate (0.55em) over-measures mixed-case text of any length.
    for (const cats of [
      ["Other mining extraction", "Oil and gas extraction", "Utilities"],
      ["Top 1% by net worth", "Net worth of $1 billion or more"],
      ["Q1", "Q2"],
    ]) {
      const longest = Math.max(...cats.map((c) => estimateLabelWidth(c, FACETED_CAT_LABEL_PX)));
      expect(horizontalLeftGutter(cats, { fontSize: FACETED_CAT_LABEL_PX })).toBe(Math.round(Math.max(44, Math.min(240, longest + 10))));
    }
  });
});

describe("the label clears the plot: dumbbell, bar and stack, standalone, live and export", () => {
  const CASES: Array<[string, ChartSpec, () => TidyRow[]]> = [
    ["dumbbell", DUMBBELL, dbRows],
    ["bar", BAR, barRows],
    ["stacked", STACK, dbRows],
  ];
  for (const [name, spec, rowsOf] of CASES) {
    it(`${name}: render, live mount and PNG export reserve the padded gutter`, () => {
      const rows = rowsOf();
      const r = renderChart(spec, rows, { width: 720 });
      expect(marginLeft(r.svg as SVGSVGElement)).toBeGreaterThanOrEqual(GAMMA_13 + GUTTER_TEXT_PAD);
      const c = document.createElement("div");
      document.body.appendChild(c);
      mountChart(c, { spec, rows, width: INNER_W });
      const live = c.querySelector("g.tbl-cat-label")!.closest("svg") as SVGSVGElement;
      expect(marginLeft(live)).toBeGreaterThanOrEqual(GAMMA_13 + GUTTER_TEXT_PAD);
      expect(marginLeft(exportChart(buildExportSvg(spec, rows)))).toBe(marginLeft(live));
    });
  }

  it("a dumbbell's labels match a bar's: same gutter, font, weight, colour and start", () => {
    const db = renderChart(DUMBBELL, dbRows(), { width: 720 }).svg as SVGSVGElement;
    const bar = renderChart(BAR, barRows(), { width: 720 }).svg as SVGSVGElement;
    expect(marginLeft(db)).toBe(marginLeft(bar));
    const attrs = (svg: SVGSVGElement) => {
      const g = svg.querySelector("g.tbl-cat-label")!;
      return ["font-size", "font-weight", "fill", "text-anchor"].map((a) => g.getAttribute(a)).concat(
        /translate\(\s*(-?[\d.]+)/.exec(g.getAttribute("transform") ?? "")![1]!,
      );
    };
    expect(attrs(db)).toEqual(attrs(bar));
  });
});

describe("the label clears the plot: dumbbell panes", () => {
  it("every pane's gutter reserves the pad", () => {
    const spec: ChartSpec = {
      ...DUMBBELL,
      columns: { ...DUMBBELL.columns, facet: "pane" },
      small_multiples: { mode: "shared" },
    };
    const rows = ["P", "Q"].flatMap((pane) => dbRows().map((r) => ({ ...r, pane }))) as unknown as TidyRow[];
    const fig = renderFigure(spec, rows, { width: 720 });
    for (const p of fig.panes) expect(marginLeft(p.svg as SVGSVGElement)).toBeGreaterThanOrEqual(GAMMA_13 + GUTTER_TEXT_PAD);
  });
});
