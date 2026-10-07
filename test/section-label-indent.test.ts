// @vitest-environment jsdom
//
// A sectioned horizontal chart (bar, stacked, dumbbell) reads like a table's row groups: the bold
// section header sits flush left and the category labels under it are indented by the table's
// member-row indent (src/table/layout.ts INDENT_STEP). The left gutter grows by the indent, so the
// label text keeps the width it has on an unsectioned chart (same wrapping), and the live render, the
// PNG export and the height models all agree. Unsectioned charts are untouched
// (their goldens guard that).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { renderChart } from "../src/engine/index";
import { mountChart } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import { INNER_W } from "../src/embed/figure-chrome";
import { horizontalBarChartHeight } from "../src/engine/figure";
import { INDENT_STEP } from "../src/table/layout";
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

const INDENT = 14;

function translateX(el: Element, svg: Element): number {
  let x = 0;
  for (let n: Element | null = el; n && n !== svg; n = n.parentElement) {
    const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(n.getAttribute("transform") ?? "");
    if (m) x += Number(m[1]);
    const xAttr = n.getAttribute("x");
    if (xAttr != null && n.tagName.toLowerCase() === "text") x += Number(xAttr);
  }
  return x;
}

const SECTION_NAMES = new Set(["First", "Second", "Third", "By income", "By wealth"]);
const headerXs = (svg: SVGSVGElement): number[] =>
  Array.from(svg.querySelectorAll('g[font-weight="700"] text'))
    .filter((t) => SECTION_NAMES.has(t.textContent ?? ""))
    .map((t) => translateX(t, svg));
const labelXs = (svg: SVGSVGElement): number[] =>
  Array.from(svg.querySelectorAll("g.tbl-cat-label text")).map((t) => translateX(t, svg));
const lineCounts = (svg: SVGSVGElement): number[] =>
  Array.from(svg.querySelectorAll("g.tbl-cat-label text")).map((t) => Math.max(1, t.querySelectorAll("tspan").length));
const marginLeft = (svg: SVGSVGElement): number => Number(svg.dataset.marginLeft);

// --- fixtures (as in section-gap.test.ts) ---

const LONG = "A rather long category label that has to wrap inside the gutter";
const barRows = (n: number, long = false): TidyRow[] =>
  Array.from({ length: n }, (_, i) => ({
    cat: long ? `${LONG} ${i + 1}` : `Row ${i + 1}`,
    sec: i < n / 2 ? "First" : "Second",
    v: String(1 + (i % 5)),
  })) as unknown as TidyRow[];
const BAR: ChartSpec = {
  chartType: "bar",
  orientation: "horizontal",
  title: "t",
  xAxisType: "categorical",
  columns: { x: "cat", value: "v", section: "sec" },
  data: "d.csv",
};

const SERIES = ["Income", "Gains", "Corporate"];
const stackRows = (n: number, long = false): TidyRow[] =>
  SERIES.flatMap((s, j) =>
    Array.from({ length: n }, (_, i) => ({
      bar: long ? `${LONG} ${i + 1}` : `Row ${i + 1}`,
      sec: ["First", "Second", "Third"][Math.floor((3 * i) / n)],
      tax: s,
      v: String(2 + ((i + j) % 4)),
    })),
  ) as unknown as TidyRow[];
const STACK: ChartSpec = {
  chartType: "stacked",
  orientation: "horizontal",
  title: "t",
  xAxisType: "categorical",
  columns: { x: "bar", series: "tax", value: "v", section: "sec" },
  series_order: SERIES,
  data: "d.csv",
};

const dbRows = (n: number, long = false): TidyRow[] =>
  Array.from({ length: n }, (_, i) => {
    const group = long ? `${LONG} ${i + 1}` : `Group ${i + 1}`;
    const ranking = i < n / 2 ? "By income" : "By wealth";
    return [
      { group, m: "Cash", v: String(20 + (i % 7)), ranking },
      { group, m: "Accrual", v: String(8 + (i % 5)), ranking },
    ];
  }).flat() as unknown as TidyRow[];
const DUMBBELL: ChartSpec = {
  chartType: "dumbbell",
  orientation: "horizontal",
  title: "t",
  xAxisType: "categorical",
  columns: { category: "group", series: "m", value: "v", section: "ranking" },
  series_order: ["Cash", "Accrual"],
  data: "d.csv",
};

// A grouped (multi-series) sectioned bar takes the fy grouped path, not the single-series one.
const groupedRows = (n: number): TidyRow[] =>
  ["A", "B"].flatMap((s) => barRows(n).map((r) => ({ ...r, s }))) as unknown as TidyRow[];
const GROUPED: ChartSpec = { ...BAR, columns: { ...BAR.columns, series: "s" } };

const CASES: Array<[string, ChartSpec, (n: number, long?: boolean) => TidyRow[]]> = [
  ["bar", BAR, barRows],
  ["grouped bar", GROUPED, (n) => groupedRows(n)],
  ["stacked", STACK, stackRows],
  ["dumbbell", DUMBBELL, dbRows],
];

const unsectioned = (spec: ChartSpec): ChartSpec => ({ ...spec, columns: { ...spec.columns, section: undefined } });

it("the indent is the table's member-row indent", () => {
  expect(INDENT_STEP).toBe(INDENT);
});

describe("sectioned category labels are indented under a flush-left section header", () => {
  for (const [name, spec, rowsOf] of CASES) {
    it(`${name}: every label sits ${INDENT}px right of the headers, which stay at the gutter's left edge`, () => {
      const rows = rowsOf(6);
      const svg = renderChart(spec, rows, { width: 720, height: 500, document }).svg;
      const hx = headerXs(svg);
      expect(hx.length).toBeGreaterThan(1);
      expect(new Set(hx).size).toBe(1);
      const lx = labelXs(svg);
      expect(lx.length).toBeGreaterThan(0);
      for (const x of lx) expect(x - hx[0]!).toBeCloseTo(INDENT, 6);
      // The header is where an unsectioned chart puts its labels: flush left.
      const plain = renderChart(unsectioned(spec), rows, { width: 720, height: 500, document }).svg;
      expect(hx[0]!).toBeCloseTo(labelXs(plain)[0]!, 6);
    });

    it(`${name}: the gutter grows by the indent, so labels keep their width`, () => {
      const rows = rowsOf(6);
      const svg = renderChart(spec, rows, { width: 720, height: 500, document }).svg;
      const plain = renderChart(unsectioned(spec), rows, { width: 720, height: 500, document }).svg;
      expect(marginLeft(svg) - marginLeft(plain)).toBe(INDENT);
    });
  }

  for (const [name, spec, rowsOf] of CASES.filter(([n]) => n !== "grouped bar")) {
    it(`${name}: long labels at the gutter cap wrap exactly as unsectioned, and the height model agrees`, () => {
      const rows = rowsOf(6, true);
      const svg = renderChart(spec, rows, { width: 720, height: 600, document }).svg;
      const plain = renderChart(unsectioned(spec), rows, { width: 720, height: 600, document }).svg;
      expect(marginLeft(svg) - marginLeft(plain)).toBe(INDENT);
      expect(Math.max(...lineCounts(plain))).toBeGreaterThan(1);
      expect(lineCounts(svg)).toEqual(lineCounts(plain));
      // Same wrapped-label budget in the height model: the sectioned chart differs only by the
      // section chrome (one 33px gap per break plus the first header's 16px).
      const nBreaks = new Set(rows.map((r) => (r as Record<string, string>)[spec.columns!.section as string])).size - 1;
      expect(horizontalBarChartHeight(spec, rows) - horizontalBarChartHeight(unsectioned(spec), rows)).toBe(nBreaks * 33 + 16);
    });
  }
});

describe("indent: live and export agree", () => {
  const exportChart = (root: SVGSVGElement): SVGSVGElement =>
    Array.from(root.querySelectorAll("svg")).reduce((a, b) =>
      Number(b.getAttribute("width") ?? 0) > Number(a.getAttribute("width") ?? 0) ? b : a,
    ) as SVGSVGElement;
  for (const [name, spec, rowsOf] of CASES) {
    it(`${name}: the export indents the labels exactly as the live chart`, () => {
      const rows = rowsOf(8, name !== "grouped bar");
      const c = document.createElement("div");
      document.body.appendChild(c);
      mountChart(c, { spec, rows, width: INNER_W });
      const l = c.querySelector("g.tbl-cat-label")!.closest("svg") as SVGSVGElement;
      const e = exportChart(buildExportSvg(spec, rows));
      const lx = labelXs(l);
      for (const x of lx) expect(x - headerXs(l)[0]!).toBeCloseTo(INDENT, 6);
      expect(labelXs(e)).toEqual(lx);
      expect(headerXs(e)).toEqual(headerXs(l));
      expect(marginLeft(e)).toBe(marginLeft(l));
      expect(lineCounts(e)).toEqual(lineCounts(l));
    });
  }
});
