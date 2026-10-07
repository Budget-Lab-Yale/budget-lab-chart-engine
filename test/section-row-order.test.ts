// @vitest-environment jsdom
//
// The row order of a sectioned category axis (`columns.section`): sections in `section_order`, else
// in the order the data first reaches them; within each section, `x_order` / `category_order`, then
// data order. `x_order` orders categories WITHIN each section and never moves a section.
//
// Small multiples: every pane draws its rows in ONE figure-wide order, so a pane whose own data
// reaches the sections in another order still lines up with the headers the left pane draws.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { renderChart, renderFigure } from "../src/engine/index";
import { buildExportSvg } from "../src/embed/export-png";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const realGetContext = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
});

/** Absolute y of an element: its own y/cy (px, not em) plus every ancestor translate. */
function absY(el: Element): number {
  const own = el.getAttribute("cy") ?? el.getAttribute("y");
  let y = own != null && !own.endsWith("em") ? Number(own) : 0;
  for (let n: Element | null = el; n && n.tagName.toLowerCase() !== "svg"; n = n.parentElement) {
    const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(n.getAttribute("transform") ?? "");
    if (m) y += Number(m[2]);
  }
  return y;
}

const SECTIONS = new Set(["First", "Second"]);

/** The left gutter top to bottom: section headers (bold) and category labels, as a reader sees it. */
function gutter(svg: SVGSVGElement): string[] {
  const headers = Array.from(svg.querySelectorAll('g[font-weight="700"] text'))
    .filter((t) => SECTIONS.has(t.textContent ?? ""))
    .map((t) => ({ t: `[${t.textContent}]`, y: absY(t) }));
  const labels = Array.from(svg.querySelectorAll("g.tbl-cat-label text")).map((t) => ({ t: t.textContent ?? "", y: absY(t) }));
  return [...headers, ...labels].sort((a, b) => a.y - b.y).map((e) => e.t);
}

/** Each drawn row's right end, top to bottom (every value is positive): the furthest bar end. */
function rowEndsTopDown(svg: SVGSVGElement): number[] {
  const byRow = new Map<number, number>();
  for (const r of Array.from(svg.querySelectorAll('g[aria-label="bar"] rect'))) {
    const y = Math.round(absY(r));
    const end = Number(r.getAttribute("x")) + Number(r.getAttribute("width"));
    byRow.set(y, Math.max(byRow.get(y) ?? -Infinity, end));
  }
  return [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

const base = { orientation: "horizontal", title: "t", xAxisType: "categorical", data: "d.csv" };
const SPECS: Record<string, ChartSpec> = {
  bar: { ...base, chartType: "bar", columns: { x: "cat", value: "v", section: "sec" } } as ChartSpec,
  stacked: { ...base, chartType: "stacked", columns: { x: "cat", series: "s", value: "v", section: "sec" } } as ChartSpec,
  dumbbell: { ...base, chartType: "dumbbell", columns: { x: "cat", series: "s", value: "v", section: "sec" } } as ChartSpec,
};
/** Rows for (section, category) pairs in this order; a dumbbell/stack needs two series. */
const rowsFor = (chartType: string, pairs: Array<[string, string, number]>, extra: Record<string, string> = {}): TidyRow[] =>
  pairs.flatMap(([sec, cat, v]) =>
    chartType === "bar"
      ? [{ sec, cat, v: String(v), ...extra }]
      : [
          { sec, cat, s: "Lo", v: String(v), ...extra },
          { sec, cat, s: "Hi", v: String(v + 5), ...extra },
        ],
  ) as TidyRow[];

describe("x_order orders categories within each section and never moves a section", () => {
  // Codex final-3 repro: First is reached first; x_order names a category of the second section.
  const REPEATED: Array<[string, string, number]> = [["First", "Z", 10], ["First", "A", 20], ["Second", "B", 30], ["Second", "A", 40]];
  const DISTINCT: Array<[string, string, number]> = [["First", "Z", 10], ["First", "A", 20], ["Second", "B", 30], ["Second", "C", 40]];
  for (const chartType of Object.keys(SPECS)) {
    const spec = { ...SPECS[chartType]!, x_order: ["B"] } as ChartSpec;
    for (const [name, pairs, want] of [
      ["a label repeated across sections", REPEATED, ["[First]", "Z", "A", "[Second]", "B", "A"]],
      ["no repeated label", DISTINCT, ["[First]", "Z", "A", "[Second]", "B", "C"]],
    ] as const) {
      it(`${chartType}, ${name}: First stays above Second, live and in the PNG export`, () => {
        const rows = rowsFor(chartType, pairs as Array<[string, string, number]>);
        const live = renderChart(spec, rows, { width: 720, height: 500, document }).svg;
        expect(gutter(live)).toEqual(want);
        expect(gutter(buildExportSvg(spec, rows))).toEqual(want);
      });
    }
  }

  it("section_order still sets the section order, and x_order the order inside each", () => {
    const spec = { ...SPECS.bar!, x_order: ["A"], section_order: ["Second", "First"] } as ChartSpec;
    const rows = rowsFor("bar", REPEATED);
    expect(gutter(renderChart(spec, rows, { width: 720, height: 500, document }).svg)).toEqual(["[Second]", "A", "B", "[First]", "A", "Z"]);
  });

  it("category_order behaves as x_order", () => {
    const spec = { ...SPECS.stacked!, category_order: ["B"] } as ChartSpec;
    const rows = rowsFor("stacked", REPEATED);
    expect(gutter(renderChart(spec, rows, { width: 720, height: 500, document }).svg)).toEqual(["[First]", "Z", "A", "[Second]", "B", "A"]);
  });
});

describe("small multiples: every pane draws its rows in one figure-wide order", () => {
  // Codex final-3 repro: same sections and categories in both panes; P reaches First first, Q
  // reaches Second first. Values are distinct so a row read from the wrong section shows.
  const P: Array<[string, string, number]> = [["First", "A", 10], ["Second", "A", 40]];
  const Q: Array<[string, string, number]> = [["Second", "A", 200], ["First", "A", 300]];
  for (const chartType of ["bar", "stacked"]) {
    for (const mode of ["shared", "per-pane"] as const) {
      const spec = {
        ...SPECS[chartType]!,
        columns: { ...SPECS[chartType]!.columns, facet: "pane" },
        small_multiples: { columns: 2, mode, pane_order: ["P", "Q"] },
      } as ChartSpec;
      const rows = [...rowsFor(chartType, P, { pane: "P" }), ...rowsFor(chartType, Q, { pane: "Q" })];
      it(`${chartType}, ${mode}: each pane's top row is its First row (live and PNG export)`, () => {
        const panes = (fig: { panes: Array<{ svg?: unknown }> }) => fig.panes.map((x) => x.svg as SVGSVGElement);
        const live = panes(renderFigure(spec, rows, { width: 900, document }));
        const exported = Array.from(buildExportSvg(spec, rows).querySelectorAll("svg")).filter((s) =>
          s.querySelector('g[aria-label="bar"]'),
        );
        expect(exported.length).toBe(2);
        for (const [p, q] of [live, exported]) {
          expect(gutter(p!)).toEqual(["[First]", "A", "[Second]", "A"]);
          // P: First 10 above Second 40. Q: First 300 above Second 200.
          const [pTop, pBottom] = rowEndsTopDown(p!);
          const [qTop, qBottom] = rowEndsTopDown(q!);
          expect(pTop!).toBeLessThan(pBottom!);
          expect(qTop!).toBeGreaterThan(qBottom!);
        }
      });
    }
  }
});
