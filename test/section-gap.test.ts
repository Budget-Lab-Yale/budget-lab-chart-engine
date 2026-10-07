// @vitest-environment jsdom
//
// The gap between two sections of a sectioned horizontal chart (bar, stacked, dumbbell) is a FIXED
// number of px — room for the bold section header with SECTION_HEADER_GAP clear above and below
// it — not a run of empty band slots, which made the gap grow with the row pitch (114-120px centre to centre at a 38-40px pitch). Measured here as the
// slot gap: (first row of a section's centre − last row of the previous section's centre) − pitch.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { renderChart } from "../src/engine/index";
import { mountChart, computeChartHeight } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import { INNER_W } from "../src/embed/figure-chrome";
import { horizontalBarChartHeight } from "../src/engine/figure";
import { spreadSections } from "../src/engine/facet-chrome";
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

/** Header line (13px category font) + 10px clear above and below. */
const GAP = 33;

function translateY(el: Element, svg: Element): number {
  let y = 0;
  for (let n: Element | null = el; n && n !== svg; n = n.parentElement) {
    const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(n.getAttribute("transform") ?? "");
    if (m) y += Number(m[2]);
  }
  return y;
}

/** Row centres top to bottom, from the category labels. */
const rowCentres = (svg: SVGSVGElement): number[] =>
  Array.from(svg.querySelectorAll("g.tbl-cat-label text"))
    .map((t) => translateY(t, svg))
    .sort((a, b) => a - b);

/** Pitch (smallest centre step) and every section break's slot gap (step beyond the pitch). */
function gaps(centres: number[]): { pitch: number; breaks: number[] } {
  const steps = centres.slice(1).map((c, i) => c - centres[i]!);
  const pitch = Math.min(...steps);
  return { pitch, breaks: steps.filter((s) => s > pitch + 0.5).map((s) => +(s - pitch).toFixed(6)) };
}

const SECTION_NAMES = new Set(["First", "Second", "Third", "By income", "By wealth"]);
/** Each section header's em-box top (abs y), top to bottom. */
const headerTops = (svg: SVGSVGElement): number[] =>
  Array.from(svg.querySelectorAll('g[font-weight="700"] text'))
    .filter((t) => SECTION_NAMES.has(t.textContent ?? ""))
    .map((t) => translateY(t, svg))
    .sort((a, b) => a - b);

// --- fixtures ---

const barRows = (n: number): TidyRow[] =>
  Array.from({ length: n }, (_, i) => ({ cat: `Row ${i + 1}`, sec: i < n / 2 ? "First" : "Second", v: String(1 + (i % 5)) })) as unknown as TidyRow[];
const BAR: ChartSpec = {
  chartType: "bar",
  orientation: "horizontal",
  title: "t",
  xAxisType: "categorical",
  columns: { x: "cat", value: "v", section: "sec" },
  data: "d.csv",
};

const SERIES = ["Income", "Gains", "Corporate"];
const stackRows = (n: number): TidyRow[] =>
  SERIES.flatMap((s, j) =>
    Array.from({ length: n }, (_, i) => ({ bar: `Row ${i + 1}`, sec: ["First", "Second", "Third"][Math.floor((3 * i) / n)], tax: s, v: String(2 + ((i + j) % 4)) })),
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

const dbRows = (n: number): TidyRow[] =>
  Array.from({ length: n }, (_, i) => [
    { group: `Group ${i + 1}`, m: "Cash", v: String(20 + (i % 7)), ranking: i < n / 2 ? "By income" : "By wealth" },
    { group: `Group ${i + 1}`, m: "Accrual", v: String(8 + (i % 5)), ranking: i < n / 2 ? "By income" : "By wealth" },
  ]).flat() as unknown as TidyRow[];
const DUMBBELL: ChartSpec = {
  chartType: "dumbbell",
  orientation: "horizontal",
  title: "t",
  xAxisType: "categorical",
  columns: { category: "group", series: "m", value: "v", section: "ranking" },
  series_order: ["Cash", "Accrual"],
  data: "d.csv",
};

const CASES: Array<[string, ChartSpec, (n: number) => TidyRow[], number]> = [
  ["bar", BAR, barRows, 1],
  ["stacked", STACK, stackRows, 2],
  ["dumbbell", DUMBBELL, dbRows, 1],
];

describe("section gap: a fixed px gap that does not scale with row pitch", () => {
  for (const [name, spec, rowsOf, nBreaks] of CASES) {
    const rows = rowsOf(12);
    it(`${name}: every section break is ${GAP}px beyond the pitch, at two very different pitches`, () => {
      const pitches: number[] = [];
      for (const height of [500, 1100]) {
        const svg = renderChart(spec, rows, { width: 720, height, document }).svg;
        // The chart is exactly as tall as asked: the gap is carved out of the height, not added.
        expect(Number(svg.getAttribute("height"))).toBe(height);
        expect(svg.getAttribute("viewBox")).toBe(`0 0 720 ${height}`);
        const { pitch, breaks } = gaps(rowCentres(svg));
        pitches.push(pitch);
        expect(breaks, `${name} @${height}`).toEqual(Array(nBreaks).fill(GAP));
      }
      // Sanity: the two renders really do have different pitches.
      expect(pitches[1]! - pitches[0]!).toBeGreaterThan(20);
    });

    it(`${name}: the header sits in the gap with ~10px clear of the rows on both sides`, () => {
      const svg = renderChart(spec, rows, { width: 720, height: 900, document }).svg;
      const centres = rowCentres(svg);
      const { pitch } = gaps(centres);
      const half = 0.4 * pitch; // the drawn bar/row is 0.8 of the pitch, centred on the label
      const tops = headerTops(svg);
      // First header sits above the first row; the rest are in the breaks.
      expect(tops[0]!).toBeLessThan(centres[0]! - half);
      for (const top of tops.slice(1)) {
        const below = centres.find((c) => c > top)!;
        const above = [...centres].reverse().find((c) => c < top)!;
        const clearBelow = below - half - (top + 13);
        const clearAbove = top - (above + half);
        expect(clearBelow).toBeGreaterThanOrEqual(9);
        expect(clearBelow).toBeLessThanOrEqual(11);
        expect(clearAbove).toBeGreaterThanOrEqual(9);
        expect(clearAbove).toBeLessThanOrEqual(11 + 0.2 * pitch);
      }
    });

    it(`${name}: the value gridlines break around each header`, () => {
      const svg = renderChart(spec, rows, { width: 720, height: 900, document }).svg;
      const tops = headerTops(svg).slice(1);
      const lines = Array.from(svg.querySelectorAll("g.tbl-gridline line"));
      expect(lines.length).toBeGreaterThan(0);
      for (const l of lines) {
        const ty = translateY(l, svg);
        const y1 = ty + Number(l.getAttribute("y1"));
        const y2 = ty + Number(l.getAttribute("y2"));
        for (const top of tops) expect(y1 < top + 13 && y2 > top, `line ${y1}-${y2} vs header ${top}`).toBe(false);
      }
    });
  }

  it("the height model adds one fixed gap per break (plus the first header), whatever the row count", () => {
    for (const n of [24, 48]) {
      const rows = stackRows(n);
      const plain = { ...STACK, columns: { ...STACK.columns, section: undefined } };
      expect(horizontalBarChartHeight(STACK, rows) - horizontalBarChartHeight(plain, rows)).toBe(2 * GAP + 16);
      expect(computeChartHeight(STACK, rows)).toBe(horizontalBarChartHeight(STACK, rows));
    }
  });
});

describe("section gap: live, export and height model agree", () => {
  const exportChart = (root: SVGSVGElement): SVGSVGElement =>
    Array.from(root.querySelectorAll("svg")).reduce((a, b) =>
      Number(b.getAttribute("width") ?? 0) > Number(a.getAttribute("width") ?? 0) ? b : a,
    ) as SVGSVGElement;
  const live = (spec: ChartSpec, rows: TidyRow[]): SVGSVGElement => {
    const c = document.createElement("div");
    document.body.appendChild(c);
    mountChart(c, { spec, rows, width: INNER_W });
    return c.querySelector("g.tbl-cat-label")!.closest("svg") as SVGSVGElement;
  };
  for (const [name, spec, rowsOf, nBreaks] of CASES) {
    it(`${name}: same height and same row positions, with the fixed gap`, () => {
      const rows = rowsOf(30);
      const l = live(spec, rows);
      const e = exportChart(buildExportSvg(spec, rows));
      const h = horizontalBarChartHeight(spec, rows);
      expect(Number(l.getAttribute("height"))).toBe(h);
      expect(Number(e.getAttribute("height"))).toBe(h);
      expect(rowCentres(e)).toEqual(rowCentres(l));
      expect(gaps(rowCentres(l)).breaks).toEqual(Array(nBreaks).fill(GAP));
    });
  }
});

describe("section gap: spreadSections needs Plot's fy scale", () => {
  it("throws, rather than silently drawing no gaps, when the svg exposes no fy scale", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    expect(() => spreadSections(svg, { before: ["Row 4"], gapPx: GAP })).toThrow(/fy scale/);
    // No gaps asked for: nothing to open, nothing to read.
    expect(spreadSections(svg, { before: [], gapPx: GAP })).toEqual([]);
  });
});

describe("section gap: an explicit height too small for the full gaps", () => {
  // Codex's repro: 26 rows in 13 sections at an explicit 400px. Twelve 33px gaps (396px) took the
  // whole plot, so the band step and every bar collapsed to 0. The gaps now share at most half the
  // plot (height less margins), so the rows always keep the other half.
  const SECS = Array.from({ length: 13 }, (_, i) => `S${i + 1}`);
  /** 13 sections: two rows each (per 2), or two rows in the first and one in each other (per 1,
   *  which keeps one in-section step for the pitch). */
  const secOf = (i: number, per: number): string => SECS[per === 2 ? Math.floor(i / 2) : Math.max(0, i - 1)]!;
  const nRows = (per: number): number => (per === 2 ? 26 : 14);
  const crampedBar = (per = 2): TidyRow[] =>
    Array.from({ length: nRows(per) }, (_, i) => ({ cat: `Row ${i + 1}`, sec: secOf(i, per), v: String(1 + (i % 5)) })) as unknown as TidyRow[];
  const crampedStack = (per = 2): TidyRow[] =>
    SERIES.flatMap((s, j) =>
      Array.from({ length: nRows(per) }, (_, i) => ({ bar: `Row ${i + 1}`, sec: secOf(i, per), tax: s, v: String(2 + ((i + j) % 4)) })),
    ) as unknown as TidyRow[];
  const crampedDb = (per = 2): TidyRow[] =>
    Array.from({ length: nRows(per) }, (_, i) => [
      { group: `Group ${i + 1}`, m: "Cash", v: String(20 + (i % 7)), ranking: secOf(i, per) },
      { group: `Group ${i + 1}`, m: "Accrual", v: String(8 + (i % 5)), ranking: secOf(i, per) },
    ]).flat() as unknown as TidyRow[];
  const CRAMPED: Array<[string, ChartSpec, (per?: number) => TidyRow[]]> = [
    ["bar", BAR, crampedBar],
    ["stacked", STACK, crampedStack],
    ["dumbbell", DUMBBELL, crampedDb],
  ];
  const plotPx = (svg: SVGSVGElement): number =>
    Number(svg.getAttribute("height")) - Number(svg.dataset.marginTop) - Number(svg.dataset.marginBottom);
  /** The rows keep at least half the plot; the gaps are equal and share the rest. */
  function expectRowsKeepHalf(svg: SVGSVGElement, what: string): void {
    const centres = rowCentres(svg);
    expect(centres, what).toHaveLength(26);
    const { pitch, breaks } = gaps(centres);
    expect(breaks, what).toHaveLength(12);
    expect(new Set(breaks.map((b) => b.toFixed(3))).size, what).toBe(1);
    const plot = plotPx(svg);
    expect(12 * breaks[0]!, what).toBeLessThanOrEqual(plot / 2 + 0.01);
    // Plot rounds the facet band step down to whole px, which can cost each row up to 1px.
    expect(26 * pitch, what).toBeGreaterThanOrEqual(plot / 2 - 26);
  }
  const barHeights = (svg: SVGSVGElement): number[] =>
    Array.from(svg.querySelectorAll('g[aria-label="bar"] rect')).map((r) => Number(r.getAttribute("height")));

  for (const [name, spec, rowsOf] of CRAMPED) {
    it(`${name}: renderChart at 400px keeps the rows (and draws real bars)`, () => {
      const svg = renderChart(spec, rowsOf(), { width: 720, height: 400, document }).svg;
      expect(Number(svg.getAttribute("height"))).toBe(400);
      expectRowsKeepHalf(svg, name);
      if (name !== "dumbbell") for (const h of barHeights(svg)) expect(h).toBeGreaterThan(3);
    });

    it(`${name}: the live mount at 400px matches renderChart`, () => {
      const c = document.createElement("div");
      document.body.appendChild(c);
      mountChart(c, { spec, rows: rowsOf(), width: 720, height: 400 });
      const svg = c.querySelector("g.tbl-cat-label")!.closest("svg") as SVGSVGElement;
      expectRowsKeepHalf(svg, `${name} live`);
      expect(rowCentres(svg)).toEqual(rowCentres(renderChart(spec, rowsOf(), { width: 720, height: 400, document }).svg));
    });

    it(`${name}: at auto height the gaps stay a full ${GAP}px, live, export and model agreeing`, () => {
      // per 1: the rows alone (14 x 22px) are shorter than the gaps (12 x 33px).
      for (const per of [1, 2]) {
        const rows = rowsOf(per);
        const h = horizontalBarChartHeight(spec, rows);
        expect(computeChartHeight(spec, rows)).toBe(h);
        const c = document.createElement("div");
        document.body.appendChild(c);
        mountChart(c, { spec, rows, width: INNER_W });
        const l = c.querySelector("g.tbl-cat-label")!.closest("svg") as SVGSVGElement;
        expect(Number(l.getAttribute("height"))).toBe(h);
        expect(gaps(rowCentres(l)).breaks, `per ${per}`).toEqual(Array(12).fill(GAP));
        const e = Array.from(buildExportSvg(spec, rows).querySelectorAll("svg")).find((s) => s.querySelector("g.tbl-cat-label")) as SVGSVGElement;
        expect(Number(e.getAttribute("height"))).toBe(h);
        expect(rowCentres(e)).toEqual(rowCentres(l));
      }
    });
  }

});
