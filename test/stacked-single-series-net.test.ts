// @vitest-environment jsdom
//
// A SINGLE-SERIES STACK DRAWS NO NET DOT AND NO LEGEND "Total" ROW — live and in the PNG.
//
// With one series the net of each bar is that bar's own end, so a dot there marks nothing a reader
// cannot already see, and a "Total" legend row keys it. The hover card already omitted the Total row
// for one series (`orderedSeries.length > 1`); the dot and the legend row are the static half.
//
// The count is of the CHART's series — on a small-multiples figure the figure's, not the pane's — so
// a figure whose first pane happens to hold one series still draws its dots and keeps its Total row.
//
// Everything else `netDisplay` resolving to a dot decides is unchanged on a single-series stack: the
// hover is still the floating card (with no Total row), and `valueLabels.show` still paints no segment
// labels. Multi-series diverging stacks are unchanged (their goldens pin them).
import { describe, it, expect, afterEach } from "vitest";
import { renderChart, TOTAL_SERIES_KEY } from "../src/engine/index";
import { renderFigure } from "../src/engine/figure";
import { mountChart } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import { INNER_W } from "../src/embed/figure-chrome";
import { mountHover, cardShown, cardText, coordShown, hoverFirstMark, BAR_MARK } from "./helpers/hover-harness";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

afterEach(() => document.body.replaceChildren());

const NET_DOTS = `g.tbl-net-marker circle, circle[data-series="${TOTAL_SERIES_KEY}"]`;

const STACKED = { chartType: "stacked", title: "S", xAxisType: "categorical", data: "d.csv" } as ChartSpec;

/** One series (`A`), negative in one category: a single-series DIVERGING stack. */
const ONE = [
  { time: "X", series: "A", value: "-3" },
  { time: "Y", series: "A", value: "2" },
] as TidyRow[];

/** Two series, one negative: the multi-series diverging control. */
const TWO = ["X", "Y"].flatMap((time) => [
  { time, series: "A", value: "-3" },
  { time, series: "B", value: "2" },
]) as TidyRow[];

/** No `series` column at all: the implicit single series. */
const NO_SERIES = [
  { time: "X", value: "-3" },
  { time: "Y", value: "2" },
] as unknown as TidyRow[];

const labels = (spec: ChartSpec, rows: TidyRow[]): string[] =>
  (renderChart(spec, rows, { width: INNER_W }).legendItems ?? []).map((i) => i.label);

function mount(spec: ChartSpec, rows: TidyRow[]): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  mountChart(host, { spec, rows, width: INNER_W });
  return host;
}

/** The chart svg the export composed: the widest nested svg. */
const exportChartSvg = (spec: ChartSpec, rows: TidyRow[]): SVGSVGElement => {
  const nested = [...buildExportSvg(spec, rows).querySelectorAll("svg")];
  return nested.reduce((a, b) => (Number(b.getAttribute("width")) > Number(a.getAttribute("width")) ? b : a));
};

describe("a single-series diverging stack: no net dot, no Total row", () => {
  const singles: Array<[string, ChartSpec, TidyRow[]]> = [
    ["one named series, default netDisplay", STACKED, ONE],
    ["no series column, default netDisplay", STACKED, NO_SERIES],
    ["explicit netDisplay: dot", { ...STACKED, barStack: { netDisplay: "dot" } } as ChartSpec, ONE],
    ["horizontal", { ...STACKED, orientation: "horizontal" } as ChartSpec, ONE],
    // series_order is an inclusion filter: listing one of two series leaves a one-series chart.
    ["series_order filtering two series to one", { ...STACKED, series_order: ["A"] } as ChartSpec, TWO],
    // A duplicated entry is accepted and renders one series; the count is of DISTINCT series.
    ["series_order naming the one series twice", { ...STACKED, series_order: ["A", "A"] } as ChartSpec, ONE],
    // Ruling 49: an explicit dot on ALL-POSITIVE single-series data is not drawn either.
    ["explicit netDisplay: dot on all-positive data", { ...STACKED, barStack: { netDisplay: "dot" } } as ChartSpec,
      ONE.map((r) => ({ ...r, value: "3" })) as TidyRow[]],
  ];
  for (const [name, spec, rows] of singles) {
    it(`${name}: none in renderChart, the live card, or the PNG`, () => {
      const r = renderChart(spec, rows, { width: INNER_W });
      // Precondition: the bars are drawn, so "no dot" is not "nothing rendered".
      expect(r.svg.querySelectorAll('g[aria-label="bar"] rect').length).toBe(2);
      expect(r.svg.querySelectorAll(NET_DOTS)).toHaveLength(0);
      // No Total row. (A duplicated series_order entry keeps its accepted duplicate series row.)
      expect((r.legendItems ?? []).map((i) => i.series)).not.toContain(TOTAL_SERIES_KEY);

      const host = mount(spec, rows);
      expect(host.querySelectorAll(NET_DOTS)).toHaveLength(0);
      expect(host.querySelector(`.tbl-legend-item[data-series="${TOTAL_SERIES_KEY}"]`)).toBeNull();

      const png = buildExportSvg(spec, rows);
      expect(png.querySelectorAll(NET_DOTS)).toHaveLength(0);
      expect(png.textContent ?? "").not.toContain("Total");
    });
  }

  it("the multi-series control keeps one dot per category and the Total row, live and in the PNG", () => {
    const r = renderChart(STACKED, TWO, { width: INNER_W });
    expect(r.svg.querySelectorAll(NET_DOTS)).toHaveLength(2);
    expect(labels(STACKED, TWO)).toEqual(["A", "B", "Total"]);
    const host = mount(STACKED, TWO);
    expect(host.querySelectorAll(NET_DOTS)).toHaveLength(2);
    expect(host.querySelector(`.tbl-legend-item[data-series="${TOTAL_SERIES_KEY}"]`)).not.toBeNull();
    expect(buildExportSvg(STACKED, TWO).querySelectorAll(NET_DOTS)).toHaveLength(2);
  });
});

describe("a single-series diverging stack's legend position (no rows, so no right column)", () => {
  it("the diverging default `right` takes no column: full width live and in the PNG", () => {
    const host = mount(STACKED, ONE);
    expect(host.querySelector(".figure-body--legend-right")).toBeNull();
    expect(Number(host.querySelector(".figure-canvas-scroll svg")!.getAttribute("width"))).toBe(INNER_W);
    expect(Number(exportChartSvg(STACKED, ONE).getAttribute("width"))).toBe(INNER_W);
  });

  it("an explicit `legendPosition: right` takes no column either", () => {
    const spec = { ...STACKED, legendPosition: "right" } as ChartSpec;
    const host = mount(spec, ONE);
    expect(host.querySelector(".figure-body--legend-right")).toBeNull();
    expect(Number(exportChartSvg(spec, ONE).getAttribute("width"))).toBe(INNER_W);
  });
});

describe("the rest of the dot treatment is unchanged on a single-series stack", () => {
  it("the hover is still the floating card, with no Total row", () => {
    const m = mountHover(STACKED, ONE);
    hoverFirstMark(m.svgs[0]!, BAR_MARK);
    expect(cardShown()).toBe(true);
    expect(m.calls()).toBeGreaterThan(0);
    expect(cardText()).not.toContain("Total");
  });

  it("an explicit dot on all-positive single-series data still cards, with no dot drawn", () => {
    const spec = { ...STACKED, barStack: { netDisplay: "dot" } } as ChartSpec;
    const m = mountHover(spec, ONE.map((r) => ({ ...r, value: "3" })) as TidyRow[]);
    expect(m.container.querySelectorAll(NET_DOTS)).toHaveLength(0);
    hoverFirstMark(m.svgs[0]!, BAR_MARK);
    expect(cardShown()).toBe(true);
  });

  it("valueLabels.show still paints no segment labels", () => {
    const spec = { ...STACKED, valueLabels: { show: true } } as ChartSpec;
    const { svg } = renderChart(spec, ONE, { width: INNER_W, height: 400 });
    expect(svg.querySelectorAll("g.tbl-segment-label text")).toHaveLength(0);
    // Control: the same bars, all positive with netDisplay: text, do get labels.
    const pos = ONE.map((r) => ({ ...r, value: "3" })) as TidyRow[];
    expect(renderChart(spec, pos, { width: INNER_W, height: 400 }).svg.querySelectorAll("g.tbl-segment-label text").length).toBe(2);
  });
});

// CONFIG-SPEC `barStack.netDisplay`: what a value resolving to `dot` decides, separately — the marker,
// the default hover (the card, with `barStack.hover` omitted) and the refusal of segment labels — on
// multi-series stacks, where the marker is drawn, so each effect is seen apart from the others.
describe("netDisplay's three effects, apart", () => {
  const LABELLED = { ...STACKED, valueLabels: { show: true } } as ChartSpec;
  const POS = TWO.map((r) => ({ ...r, value: "3" })) as TidyRow[];

  it("an explicit dot on all-positive data: dots drawn, the card, no segment labels", () => {
    const spec = { ...LABELLED, barStack: { netDisplay: "dot" } } as ChartSpec;
    const { svg } = renderChart(spec, POS, { width: INNER_W, height: 400 });
    expect(svg.querySelectorAll(NET_DOTS)).toHaveLength(2);
    expect(svg.querySelectorAll("g.tbl-segment-label text")).toHaveLength(0);
    const m = mountHover(spec, POS);
    hoverFirstMark(m.svgs[0]!, BAR_MARK);
    expect(cardShown()).toBe(true);
  });

  it("text on diverging data: no dots, value pills rather than the card, segment labels painted", () => {
    const spec = { ...LABELLED, barStack: { netDisplay: "text" } } as ChartSpec;
    const { svg } = renderChart(spec, TWO, { width: INNER_W, height: 400 });
    expect(svg.querySelectorAll(NET_DOTS)).toHaveLength(0);
    expect(svg.querySelectorAll("g.tbl-segment-label text").length).toBeGreaterThan(0);
    const m = mountHover(spec, TWO);
    hoverFirstMark(m.svgs[0]!, BAR_MARK);
    expect(coordShown(m.svgs[0]!)).toBe(true);
    expect(cardShown()).toBe(false);
  });

  it("barStack.hover decouples the hover: a dot with value pills", () => {
    const spec = { ...STACKED, barStack: { hover: "pills" } } as ChartSpec;
    expect(renderChart(spec, TWO, { width: INNER_W }).svg.querySelectorAll(NET_DOTS)).toHaveLength(2);
    const m = mountHover(spec, TWO);
    hoverFirstMark(m.svgs[0]!, BAR_MARK);
    expect(coordShown(m.svgs[0]!)).toBe(true);
    expect(cardShown()).toBe(false);
  });
});

for (const mode of ["shared", "per-pane"] as const) {
  describe(`small multiples (${mode}): the count is of the distinct series the figure draws, not the pane's`, () => {
    const FIG = {
      ...STACKED,
      columns: { x: "time", facet: "facet" },
      small_multiples: { columns: 2, mode, pane_order: ["P", "Q"] },
    } as unknown as ChartSpec;
    const withFacet = (rows: TidyRow[], facet: string) => rows.map((r) => ({ ...r, facet })) as TidyRow[];
    const paneDots = (spec: ChartSpec, rows: TidyRow[]): number[] =>
      renderFigure(spec, rows, { width: INNER_W }).panes.map((p) => (p.svg as SVGSVGElement).querySelectorAll(NET_DOTS).length);

    it("a single-series figure: no dot on any pane, no Total row, live and in the PNG", () => {
      const rows = [...withFacet(ONE, "P"), ...withFacet(ONE, "Q")];
      const fig = renderFigure(FIG, rows, { width: INNER_W });
      expect(fig.panes).toHaveLength(2);
      for (const p of fig.panes) {
        expect((p.svg as SVGSVGElement).querySelectorAll('g[aria-label="bar"] rect').length).toBe(2);
        expect((p.svg as SVGSVGElement).querySelectorAll(NET_DOTS)).toHaveLength(0);
      }
      expect(fig.legendItems ?? []).toHaveLength(0);
      const host = mount(FIG, rows);
      expect(host.querySelectorAll(NET_DOTS)).toHaveLength(0);
      expect(host.querySelector(`.tbl-legend-item[data-series="${TOTAL_SERIES_KEY}"]`)).toBeNull();
      const png = buildExportSvg(FIG, rows);
      expect(png.querySelectorAll(NET_DOTS)).toHaveLength(0);
      expect(png.textContent ?? "").not.toContain("Total");
    });

    it("series_order naming the one series twice: still no dot, live and in the PNG", () => {
      const spec = { ...FIG, series_order: ["A", "A"] } as ChartSpec;
      const rows = [...withFacet(ONE, "P"), ...withFacet(ONE, "Q")];
      expect(paneDots(spec, rows)).toEqual([0, 0]);
      expect(mount(spec, rows).querySelectorAll(NET_DOTS)).toHaveLength(0);
      expect(buildExportSvg(spec, rows).querySelectorAll(NET_DOTS)).toHaveLength(0);
    });

    it("a second series only in a pane that pane_order leaves out does not count", () => {
      const spec = { ...FIG, small_multiples: { columns: 2, mode, pane_order: ["P"] } } as unknown as ChartSpec;
      const rows = [...withFacet(ONE, "P"), ...withFacet(TWO, "Q")];
      const fig = renderFigure(spec, rows, { width: INNER_W });
      expect(fig.panes.map((p) => p.value)).toEqual(["P"]);
      expect(paneDots(spec, rows)).toEqual([0]);
      expect((fig.legendItems ?? []).map((i) => i.label)).not.toContain("Total");
      expect(buildExportSvg(spec, rows).querySelectorAll(NET_DOTS)).toHaveLength(0);
    });

    it("a single-series figure's pane still hovers with the card, with no Total row", () => {
      const rows = [...withFacet(ONE, "P"), ...withFacet(ONE, "Q")];
      const m = mountHover(FIG, rows, true);
      expect(m.svgs).toHaveLength(2);
      hoverFirstMark(m.svgs[0]!, BAR_MARK);
      expect(cardShown()).toBe(true);
      expect(m.calls()).toBeGreaterThan(0);
      expect(cardText()).not.toContain("Total");
    });

    it("a two-series figure whose first pane holds one series keeps its dots on every pane and its Total row", () => {
      const rows = [...withFacet(ONE, "P"), ...withFacet(TWO, "Q")];
      expect(paneDots(FIG, rows)).toEqual([2, 2]);
      expect((renderFigure(FIG, rows, { width: INNER_W }).legendItems ?? []).map((i) => i.label)).toEqual(["A", "B", "Total"]);
    });
  });
}
