// @vitest-environment jsdom
//
// `section_order` is an inclusion filter: a section it leaves out is not drawn. Its rows must not be
// inspected by anything else either — net-mode detection, the value domain, axis fitting, the
// height — or a hidden section reshapes the visible chart. Each case renders the same chart twice,
// once with the excluded section's rows present and once with them removed, and requires the two to
// be identical (live SVG, height, PNG export).
//
// Also: the faceted ragged-pane check compares section + category, so a pane that carries a
// category under a different section than its sibling is rejected.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { renderChart, renderFigure } from "../src/engine/index";
import { computeChartHeight, mountChart } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import { validateChartData } from "../src/spec/validate";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const realGetContext = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
});

const base = {
  orientation: "horizontal",
  title: "t",
  xAxisType: "categorical",
  section_order: ["First"],
  data: "d.csv",
};
const STACKED = {
  ...base,
  chartType: "stacked",
  columns: { x: "bar", series: "tax", value: "v", section: "sec" },
  series_order: ["Income", "Gains"],
} as ChartSpec;
const BAR = { ...STACKED, chartType: "bar" } as ChartSpec;
const BAR_SINGLE = { ...base, chartType: "bar", columns: { x: "bar", value: "v", section: "sec" } } as ChartSpec;
const DUMBBELL = { ...STACKED, chartType: "dumbbell" } as ChartSpec;

// Codex's repro: the visible stack is all positive; the hidden one has a large negative.
const VISIBLE = [
  { sec: "First", bar: "A", tax: "Income", v: "10" },
  { sec: "First", bar: "A", tax: "Gains", v: "10" },
  { sec: "First", bar: "C", tax: "Income", v: "4" },
  { sec: "First", bar: "C", tax: "Gains", v: "6" },
] as TidyRow[];
const HIDDEN = [
  { sec: "Second", bar: "B", tax: "Income", v: "-2000" },
  { sec: "Second", bar: "B", tax: "Gains", v: "10" },
  { sec: "Second", bar: "D", tax: "Income", v: "900" },
  { sec: "Second", bar: "D", tax: "Gains", v: "5" },
] as TidyRow[];
// Enough hidden rows that counting them would lift the height off its 400px floor.
const MANY_HIDDEN = Array.from({ length: 30 }, (_, i) =>
  ["Income", "Gains"].map((tax) => ({ sec: "Second", bar: `Hidden ${i}`, tax, v: "1" })),
).flat() as TidyRow[];
// Interleaved, so neither section is simply a prefix of the data.
const WITH_HIDDEN = [
  VISIBLE[0]!, HIDDEN[0]!, VISIBLE[1]!, HIDDEN[1]!, VISIBLE[2]!, HIDDEN[2]!, VISIBLE[3]!, HIDDEN[3]!, ...MANY_HIDDEN,
];
const single = (rows: TidyRow[]) => rows.filter((r) => r.tax === "Income");

const cases: Array<[string, ChartSpec, TidyRow[], TidyRow[]]> = [
  ["stacked", STACKED, WITH_HIDDEN, VISIBLE],
  ["grouped bar", BAR, WITH_HIDDEN, VISIBLE],
  ["single-series bar", BAR_SINGLE, single(WITH_HIDDEN), single(VISIBLE)],
  ["dumbbell", DUMBBELL, WITH_HIDDEN, VISIBLE],
];

describe("section_order: rows of an excluded section reach nothing", () => {
  for (const [name, spec, withHidden, visible] of cases) {
    it(`${name}: the live SVG and the height equal the chart without those rows`, () => {
      const h = computeChartHeight(spec, visible);
      expect(computeChartHeight(spec, withHidden)).toBe(h);
      const a = renderChart(spec, withHidden, { width: 720, height: h, document }).svg.outerHTML;
      const b = renderChart(spec, visible, { width: 720, height: h, document }).svg.outerHTML;
      expect(a).toBe(b);
    });

    it(`${name}: the live mount (legend placement included) equals the chart without those rows`, () => {
      const mounted = (rows: TidyRow[]): string => {
        document.body.innerHTML = "";
        const c = document.createElement("div");
        document.body.appendChild(c);
        mountChart(c, { spec, rows, width: 720 });
        return c.innerHTML;
      };
      expect(mounted(withHidden)).toBe(mounted(visible));
    });

    it(`${name}: the PNG export equals the chart without those rows`, () => {
      expect(buildExportSvg(spec, withHidden).outerHTML).toBe(buildExportSvg(spec, visible).outerHTML);
    });
  }

  it("small multiples: every pane equals the figure without those rows", () => {
    const spec = {
      ...STACKED,
      columns: { ...STACKED.columns, facet: "pane" },
      small_multiples: { columns: 2, pane_order: ["P", "Q"] },
    } as ChartSpec;
    const inPanes = (rows: TidyRow[]) => ["P", "Q"].flatMap((pane) => rows.map((r) => ({ ...r, pane }))) as TidyRow[];
    const panes = (rows: TidyRow[]) =>
      renderFigure(spec, inPanes(rows), { width: 900, document }).panes.map((p) => (p.svg as SVGSVGElement).outerHTML);
    expect(panes(WITH_HIDDEN)).toEqual(panes(VISIBLE));
  });

  it("stacked: the visible all-positive stack gets net text, no net dot, and full-width segments", () => {
    const svg = renderChart(STACKED, WITH_HIDDEN, { width: 720, height: 400, document }).svg;
    expect(svg.querySelectorAll("g.tbl-net-marker circle").length).toBe(0);
    const widths = Array.from(svg.querySelectorAll('g[aria-label="bar"] rect')).map((r) => Number(r.getAttribute("width")));
    expect(Math.min(...widths)).toBeGreaterThan(50);
  });
});

describe("faceted ragged check: panes are compared by section + category", () => {
  // Codex's repro: pane Q carries B under "First", pane P under "Second".
  const rows = [
    { pane: "P", sec: "First", bar: "A", v: "10" },
    { pane: "P", sec: "Second", bar: "B", v: "20" },
    { pane: "Q", sec: "First", bar: "A", v: "10" },
    { pane: "Q", sec: "First", bar: "B", v: "20" },
  ] as TidyRow[];
  for (const chartType of ["stacked", "bar"] as const) {
    it(`${chartType}: rejected, naming the missing section + category`, () => {
      const spec = {
        ...base,
        section_order: undefined,
        chartType,
        columns: { x: "bar", value: "v", section: "sec", facet: "pane" },
        small_multiples: { columns: 2 },
      } as ChartSpec;
      const msg = validateChartData(spec, rows).errors.join("\n");
      expect(msg).toMatch(/facet "Q" is missing category "B" \(section "Second"\)/);
      expect(msg).toMatch(/facet "P" is missing category "B" \(section "First"\)/);
    });
  }
});
