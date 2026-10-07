// @vitest-environment jsdom
//
// A dumbbell (connected dot plot) fits its value axis to the dots by default; `yAxisPolicy.includeZero:
// true` extends it to 0, as it does on a line chart. The dumbbell branch used to hard-code
// includeZero = false and, because it always resolves a hard domain, never reached computeYAxis's
// own includeZero step either — so the policy was ignored.
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const OPTS = { width: 720, height: 400, document } as const;

const BASE: ChartSpec = {
  chartType: "dumbbell",
  title: "t",
  xAxisType: "categorical",
  orientation: "horizontal",
  columns: { category: "group", series: "measure", value: "rate" },
  series_order: ["a", "b"],
  data: "d.csv",
};

const ROWS = [
  { group: "Q1", measure: "a", rate: "8" },
  { group: "Q1", measure: "b", rate: "12" },
  { group: "Q2", measure: "a", rate: "25" },
  { group: "Q2", measure: "b", rate: "31" },
] as unknown as TidyRow[];

/** The numeric value-tick labels (category labels are "Q1"/"Q2"). */
const ticks = (svg: Element): number[] =>
  Array.from(svg.querySelectorAll("text"))
    .map((t) => (t.textContent ?? "").trim())
    .filter((s) => /^-?\d+(\.\d+)?$/.test(s))
    .map(Number);

const withPolicy = (policy: ChartSpec["yAxisPolicy"], extra: Partial<ChartSpec> = {}): ChartSpec => ({
  ...BASE,
  ...extra,
  ...(policy ? { yAxisPolicy: policy } : {}),
});

describe("dumbbell — yAxisPolicy.includeZero", () => {
  it("omitted: the axis stays fitted to the dots (no 0 tick)", () => {
    const t = ticks(renderChart(withPolicy(undefined), ROWS, OPTS).svg);
    expect(t.length).toBeGreaterThan(1);
    expect(Math.min(...t)).toBeGreaterThan(0);
  });

  it("false: same fitted axis as omitted", () => {
    expect(ticks(renderChart(withPolicy({ includeZero: false }), ROWS, OPTS).svg)).toEqual(
      ticks(renderChart(withPolicy(undefined), ROWS, OPTS).svg),
    );
  });

  for (const orientation of ["horizontal", "vertical"] as const) {
    it(`true (${orientation}): the range starts at 0`, () => {
      const t = ticks(renderChart(withPolicy({ includeZero: true }, { orientation }), ROWS, OPTS).svg);
      expect(Math.min(...t)).toBe(0);
      expect(Math.max(...t)).toBeGreaterThanOrEqual(31);
    });
  }

  it("true on all-negative dots: the range ends at 0", () => {
    const neg = ROWS.map((r) => ({ ...r, rate: String(-Number((r as unknown as { rate: string }).rate)) })) as unknown as TidyRow[];
    const t = ticks(renderChart(withPolicy({ includeZero: true }), neg, OPTS).svg);
    expect(Math.max(...t)).toBe(0);
    expect(Math.min(...t)).toBeLessThanOrEqual(-31);
  });

  it("true with a pinned min: the pinned floor still wins", () => {
    const t = ticks(renderChart(withPolicy({ includeZero: true, min: 5 }), ROWS, OPTS).svg);
    expect(Math.min(...t)).toBe(5);
  });

  it("true with a pinned max: the max sets the top, the bottom extends to 0", () => {
    const t = ticks(renderChart(withPolicy({ includeZero: true, max: 50 }), ROWS, OPTS).svg);
    expect(Math.min(...t)).toBe(0);
    expect(Math.max(...t)).toBe(50);
  });

  it("true on a faceted chart (its facets drawn as groups): the one range starts at 0", () => {
    const rows = [
      ...ROWS.map((r) => ({ ...r, pane: "A" })),
      ...ROWS.map((r) => ({ ...r, pane: "B", rate: String(Number((r as unknown as { rate: string }).rate) + 5) })),
    ] as unknown as TidyRow[];
    const spec = withPolicy(
      { includeZero: true },
      {
        columns: { category: "group", series: "measure", value: "rate", facet: "pane" },
        small_multiples: { mode: "shared" },
      },
    );
    const svg = renderChart(spec, rows, { width: 720, document }).svg as SVGSVGElement;
    expect(Math.min(...ticks(svg))).toBe(0);
  });
});
