// @vitest-environment jsdom
//
// `x_ticks`: ticks on the data's own x values (`data`) or on listed values, on a temporal, quarterly
// or numeric axis, thinned to every k-th value from the first when the labels would overlap.

import { describe, it, expect } from "vitest";
import { renderChart, renderFigure } from "../src/engine/index";
import { measuredLabelWidth, thinTemporalTicks, everyKthThatFits } from "../src/engine/axes";
import { validateSpec } from "../src/spec/validate";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const SURVEYS = ["2001", "2004", "2007", "2010", "2013", "2016", "2019", "2022", "2025"];
const rows = (xs: string[], facet?: string): TidyRow[] =>
  xs.map((x, i) => ({ ...(facet ? { facet } : {}), time: x, value: String(10 + i) }));

const line = (extra: Record<string, unknown>): ChartSpec =>
  ({ chartType: "line", title: "t", xAxisType: "temporal", data: "x.csv", ...extra }) as unknown as ChartSpec;

const dateLabels = (svg: SVGSVGElement): string[] =>
  Array.from(svg.querySelectorAll("text"))
    .map((t) => t.textContent ?? "")
    .filter((t) => /^(\d{4}|[A-Z][a-z]{2})$/.test(t));

const numericLabels = (svg: SVGSVGElement): string[] =>
  Array.from(svg.querySelectorAll('g[aria-label="x-axis tick label"] text')).map((t) => t.textContent ?? "");

describe("x_ticks: data", () => {
  it("puts a tick on every data x when the labels fit", () => {
    const { svg } = renderChart(line({ x_ticks: "data" }), rows(SURVEYS), { width: 720, height: 300, document });
    expect(dateLabels(svg)).toEqual(SURVEYS);
  });

  it("thins to every k-th data x, from the first, when they would overlap", () => {
    const { svg } = renderChart(line({ x_ticks: "data" }), rows(SURVEYS), { width: 260, height: 300, document });
    const labels = dateLabels(svg);
    expect(labels[0]).toBe("2001");
    expect(labels.length).toBeLessThan(SURVEYS.length);
    const k = SURVEYS.indexOf(labels[1]!);
    expect(labels).toEqual(SURVEYS.filter((_, i) => i % k === 0));
    const sx = (svg as any).scale("x");
    const px = labels.map((y) => sx.apply(new Date(+y, 0, 1)) as number);
    for (let i = 1; i < px.length; i++) expect(px[i]! - px[i - 1]!).toBeGreaterThanOrEqual(measuredLabelWidth("2000") + 8);
  });

  it("labels monthly data on its own months, not the axis' quarter cadence", () => {
    const months = ["2024-02-01", "2024-05-01", "2024-08-01", "2024-11-01", "2025-01-01"];
    const { svg } = renderChart(line({ x_ticks: "data" }), rows(months), { width: 720, height: 300, document });
    expect(dateLabels(svg)).toEqual(["Feb", "May", "Aug", "Nov", "Jan", "2025"]);
  });

  it.each(["per-pane", "shared"] as const)("%s panes all draw every pane's x values", (mode) => {
    const spec = line({
      x_ticks: "data",
      columns: { facet: "facet" },
      small_multiples: { columns: 2, mode, pane_order: ["Holders", "Balances"] },
    });
    const size = mode === "per-pane" ? { width: 360, gridWidth: 720 } : { width: 720 };
    const fig = renderFigure(spec, [...rows(SURVEYS, "Holders"), ...rows(SURVEYS.slice(1), "Balances")], {
      ...size,
      height: 400,
      document,
    });
    const [a, b] = fig.panes.map((p) => dateLabels(p.svg as SVGSVGElement));
    expect(b).toEqual(a);
    expect(b![0]).toBe("2001");
  });

  it("quarterly: ticks on the data's quarters", () => {
    const qs = ["2024Q1", "2024Q3", "2025Q1"];
    const { svg } = renderChart(line({ xAxisType: "quarterly", x_ticks: "data" }), rows(qs), { width: 720, height: 300, document });
    expect(dateLabels(svg)).toEqual(["Jan", "Jul", "Jan", "2024", "2025"]);
  });
});

describe("x_ticks: a list", () => {
  it("draws the listed values inside the range and drops the rest", () => {
    const { svg } = renderChart(line({ x_ticks: ["2005", 2015, "2050"] }), rows(SURVEYS), { width: 720, height: 300, document });
    expect(dateLabels(svg)).toEqual(["2005", "2015"]);
  });

  it("numeric: replaces the automatic ticks", () => {
    const { svg } = renderChart(
      line({ xAxisType: "numeric", x_ticks: [0, 2.5, 10, 99] }),
      rows(["0", "5", "10"]),
      { width: 720, height: 300, document },
    );
    expect(numericLabels(svg)).toEqual(["0", "2.5", "10"]);
  });

  it("numeric: thins to every k-th value when the labels would overlap", () => {
    const many = Array.from({ length: 40 }, (_, i) => 125 + i * 250);
    const { svg } = renderChart(
      line({ xAxisType: "numeric", x_ticks: many }),
      rows(["0", "10000"]),
      { width: 300, height: 300, document },
    );
    const labels = numericLabels(svg);
    expect(labels[0]).toBe("125");
    expect(labels.length).toBeLessThan(many.length);
    expect(labels.length).toBeGreaterThan(1);
  });
});

describe("x_ticks validation", () => {
  const ok = (extra: Record<string, unknown>) => validateSpec(line(extra)).valid;
  it("accepts data, date strings and bare-year numbers on a temporal axis", () => {
    expect(ok({ x_ticks: "data" })).toBe(true);
    expect(ok({ x_ticks: ["2001", "2004-07-01", 2010] })).toBe(true);
  });
  it("accepts quarters on a quarterly axis and numbers on a numeric one", () => {
    expect(ok({ xAxisType: "quarterly", x_ticks: ["2001Q1", "2001Q3"] })).toBe(true);
    expect(ok({ xAxisType: "numeric", x_ticks: [0, "2.5"] })).toBe(true);
  });
  it("rejects a value outside the axis' grammar", () => {
    expect(ok({ x_ticks: ["2001Q1"] })).toBe(false);
    expect(ok({ xAxisType: "quarterly", x_ticks: ["2001"] })).toBe(false);
    expect(ok({ xAxisType: "numeric", x_ticks: ["abc"] })).toBe(false);
    expect(ok({ x_ticks: [] })).toBe(false);
    expect(ok({ x_ticks: "auto" })).toBe(false);
  });
  it("rejects a categorical axis, a histogram and a timeline", () => {
    expect(ok({ xAxisType: "categorical", x_ticks: "data" })).toBe(false);
    expect(
      validateSpec({ chartType: "histogram", title: "t", xAxisType: "numeric", data: "x.csv", x_ticks: "data" } as never).valid,
    ).toBe(false);
    expect(validateSpec({ chartType: "timeline", title: "t", xAxisType: "temporal", data: "x.csv", x_ticks: "data" } as never).valid).toBe(
      false,
    );
  });
});

describe("x_ticks thinning floor", () => {
  it("keeps the first value alone when no two labels fit", () => {
    const { svg } = renderChart(line({ x_ticks: "data" }), rows(SURVEYS), { width: 70, height: 300, document });
    expect(dateLabels(svg)).toEqual(["2001"]);
  });
});

describe("x_ticks on unequal pane_widths", () => {
  it.each(["per-pane", "shared"] as const)("%s numeric panes draw the same ticks", (mode) => {
    const xs = Array.from({ length: 21 }, (_, i) => String(i * 500));
    const spec = line({
      xAxisType: "numeric",
      x_ticks: "data",
      columns: { facet: "facet" },
      small_multiples: { columns: 2, mode, pane_order: ["A", "B"], pane_widths: [1, 3] },
    });
    const fig = renderFigure(spec, [...rows(xs, "A"), ...rows(xs, "B")], { width: 800, gridWidth: 800, height: 300, document });
    const [a, b] = fig.panes.map((p) => numericLabels(p.svg as SVGSVGElement));
    expect(b).toEqual(a);
    expect(a!.length).toBeLessThan(xs.length);
  });
});

describe("x_ticks labels follow the chosen ticks, not the data's cadence", () => {
  it("annual data with a mid-year tick reads as that month alone", () => {
    const { svg } = renderChart(line({ x_ticks: ["2005-07-01"] }), rows(SURVEYS), { width: 720, height: 300, document });
    expect(dateLabels(svg)).toEqual(["Jul"]);
  });

  it("monthly data with ticks only on 1 January reads as bare years", () => {
    const months = Array.from({ length: 25 }, (_, i) => `${2023 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`);
    const { svg } = renderChart(line({ x_ticks: ["2023", "2024", "2025"] }), rows(months), { width: 720, height: 300, document });
    expect(dateLabels(svg)).toEqual(["2023", "2024", "2025"]);
  });

  it("daily January data: every tick is in January, so each reads as the bare year", () => {
    const { svg } = renderChart(line({ x_ticks: "data" }), rows(["2026-01-02", "2026-01-03"]), { width: 720, height: 300, document });
    expect(dateLabels(svg)).toEqual(["2026", "2026"]);
  });

  it("daily data gets ticks from x_ticks, each reading as its month", () => {
    const days = ["2026-07-02", "2026-07-03"];
    const { svg } = renderChart(line({ x_ticks: "data" }), rows(days), { width: 720, height: 300, document });
    expect(dateLabels(svg)).toEqual(["Jul", "Jul"]);
  });
});

describe("x_ticks thinning cost", () => {
  it("skips the strides that leave more labels than could fit, building each by stride", () => {
    const values = Array.from({ length: 30000 }, (_, i) => i);
    let calls = 0;
    let measured = 0;
    const kept = everyKthThatFits(
      values,
      (s) => {
        calls++;
        measured += s.length;
        return s.length <= 4;
      },
      4,
    );
    expect(kept).toEqual([0, 7500, 15000, 22500]);
    expect(calls).toBe(1);
    expect(measured).toBe(4);
  });

  it("thins 30,000 daily ticks in a narrow plot to a handful, from the first", () => {
    const days = Array.from({ length: 30000 }, (_, i) => new Date(2000, 0, 1 + i));
    const ticks = thinTemporalTicks(days, 100, +days[days.length - 1]! - +days[0]!);
    expect(ticks[0]).toEqual(days[0]);
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks.length).toBeLessThanOrEqual(5); // 100px holds at most five 16px-plus-gap labels
  });

  it("keeps every candidate when the span is degenerate", () => {
    const same = Array.from({ length: 3 }, () => new Date(2020, 0, 1));
    expect(thinTemporalTicks(same, 10, 0)).toHaveLength(3);
  });
});
