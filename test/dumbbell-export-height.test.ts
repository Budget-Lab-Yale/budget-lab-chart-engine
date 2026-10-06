// @vitest-environment jsdom
//
// A standalone HORIZONTAL dumbbell grows with its rows on the page (computeChartHeight →
// horizontalBarChartHeight), so its PNG export must too: the export re-renders from the spec and has
// to match the live chart. It used to keep the fixed 750 frame (`isSingleHorizontalBar` in
// buildExportSvg left dumbbell out), so a long dumbbell's rows were squeezed into the frame and a
// short one was stretched to fill it — the download's row pitch differed from the page's.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mountChart } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import { H, INNER_W } from "../src/embed/figure-chrome";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

// jsdom has no canvas: return null quietly; text measurement takes the same fallback either way.
const realGetContext = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
});

const BASE: ChartSpec = {
  chartType: "dumbbell",
  orientation: "horizontal",
  title: "Effective rate by group",
  xAxisType: "categorical",
  columns: { category: "group", series: "m", value: "v" },
  series_order: ["Cash income", "Accrual income"],
  value_format: { decimals: 1, suffix: "%" },
  data: "d.csv",
};

// The shape of the pr67 figure effective-tax-rates-top-groups: two sections, long labels.
const SECTIONED: ChartSpec = {
  ...BASE,
  columns: { ...BASE.columns, section: "ranking" },
  note: "Taxes: individual income tax after refundable credits, payroll tax, estate tax.",
  source: "The Budget Lab",
};

const groupRows = (groups: string[], section?: string): TidyRow[] =>
  groups.flatMap((g, i) => [
    { group: g, m: "Cash income", v: String(25 + (i % 7)), ...(section ? { ranking: section } : {}) },
    { group: g, m: "Accrual income", v: String(8 + (i % 11)), ...(section ? { ranking: section } : {}) },
  ]) as unknown as TidyRow[];

const MANY = groupRows(Array.from({ length: 30 }, (_, i) => `Group ${i + 1}`));
const PR67 = [
  ...groupRows(["Top 1% by income", "Top 0.1% by income", "Top 0.01% by income"], "Ranked by income"),
  ...groupRows(
    ["Top 1% by net worth", "Top 0.1% by net worth", "Top 0.01% by net worth", "Net worth of $1 billion or more"],
    "Ranked by net worth",
  ),
];
const MANY_SECTIONED = [
  ...groupRows(Array.from({ length: 14 }, (_, i) => `Income group ${i + 1}`), "Ranked by income"),
  ...groupRows(Array.from({ length: 16 }, (_, i) => `Wealth group ${i + 1}`), "Ranked by net worth"),
];

/** The chart SVG the export composed (the widest nested svg). */
const exportChartOf = (root: SVGSVGElement): SVGSVGElement =>
  Array.from(root.querySelectorAll("svg")).reduce((a, b) =>
    Number(b.getAttribute("width") ?? 0) > Number(a.getAttribute("width") ?? 0) ? b : a,
  ) as SVGSVGElement;

/** The live mount's chart SVG at `width` (the svg that holds the dot marks). */
function liveChart(spec: ChartSpec, rows: TidyRow[], width: number): SVGSVGElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  mountChart(container, { spec, rows, width });
  const dot = container.querySelector('g[aria-label="dot"] circle');
  expect(dot).not.toBeNull();
  return dot!.closest("svg") as SVGSVGElement;
}

/** Each dot's y within its own chart svg (cy plus every ancestor translate below that svg). */
function dotYs(svg: SVGSVGElement): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of Array.from(svg.querySelectorAll('g[aria-label="dot"] circle'))) {
    let y = Number(c.getAttribute("cy")) || 0;
    for (let n: Element | null = c.parentElement; n && n !== svg; n = n.parentElement) {
      const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(n.getAttribute("transform") ?? "");
      if (m) y += Number(m[2]);
    }
    out.set(`${c.getAttribute("data-category")}|${c.getAttribute("data-series")}`, y);
  }
  return out;
}

describe("standalone horizontal dumbbell — the PNG export lays out like the live chart", () => {
  const cases: [string, ChartSpec, TidyRow[]][] = [
    ["30 rows", BASE, MANY],
    ["pr67 shape: 7 rows in 2 sections", SECTIONED, PR67],
    ["30 rows in 2 sections", SECTIONED, MANY_SECTIONED],
  ];

  for (const [name, spec, rows] of cases) {
    it(`${name}: chart height, frame and every row match the live mount at the export width`, () => {
      const root = buildExportSvg(spec, rows);
      const chart = exportChartOf(root);
      // Precondition: the export lays the chart out at INNER_W (top legend), the width we mount at.
      expect(Number(chart.getAttribute("width"))).toBe(INNER_W);
      const live = liveChart(spec, rows, INNER_W);

      const chartH = Number(chart.getAttribute("height"));
      expect(chartH).toBe(Number(live.getAttribute("height")));

      // Same rows at the same y: nothing squeezed or stretched, nothing clipped.
      const exportYs = dotYs(chart);
      const liveYs = dotYs(live);
      expect(exportYs.size).toBe(rows.length);
      expect([...exportYs.entries()]).toEqual([...liveYs.entries()]);
      for (const y of exportYs.values()) {
        expect(y).toBeGreaterThan(0);
        expect(y).toBeLessThan(chartH);
      }

      // The frame holds the chart plus its bottom chrome: it is sized to the content, not fixed.
      const frameH = Number(root.getAttribute("height"));
      expect(frameH).toBeGreaterThan(Number(chart.getAttribute("y")) + chartH);
    });
  }

  it("a long dumbbell grows the frame past the fixed 750 export height", () => {
    expect(Number(buildExportSvg(BASE, MANY).getAttribute("height"))).toBeGreaterThan(H);
  });

  it("a vertical dumbbell keeps the fixed frame", () => {
    expect(Number(buildExportSvg({ ...BASE, orientation: "vertical" }, MANY).getAttribute("height"))).toBe(H);
  });
});
