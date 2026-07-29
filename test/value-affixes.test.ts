// @vitest-environment jsdom
//
// Explicit `value_prefix` / `value_suffix`, replacing units guessed from the subtitle.
//
// The old `inferUnitsFromSubtitle` substring-matched the SUBTITLE for "percent" and appended `%` to
// every rendered number. That put `%` on percentage-POINT charts (a 2 pp change read as "2%"), and on
// any subtitle merely containing those letters — "Percentiles" got `%` too. Prose is prose; the
// regression block at the bottom is the guard against that behaviour coming back.
import { describe, it, expect } from "vitest";
import { renderChart, renderFigure } from "../src/engine/index";
import { applyValueAffixes, resolveValueAffixes } from "../src/engine/util";
import { formatValue } from "../src/engine/render-live";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const OPTS = { width: 720, height: 400, document };

const LINE = {
  chartType: "line",
  title: "t",
  xAxisType: "numeric",
  columns: { x: "time", value: "value", series: "series" },
} as unknown as ChartSpec;

const rows = (pairs: Array<[string, number]>, series = "A"): TidyRow[] =>
  pairs.map(([t, v]) => ({ time: t, value: String(v), series })) as unknown as TidyRow[];

const PLAIN = rows([["2020", 10], ["2021", 20]]);

const yTicks = (spec: ChartSpec, data: TidyRow[] = PLAIN): Array<string | null> => {
  const { svg } = renderChart(spec, data, OPTS);
  return Array.from(svg.querySelectorAll("g.tbl-y-tick-label text")).map((t) => t.textContent);
};

describe("resolveValueAffixes", () => {
  it("reads both fields", () => {
    expect(resolveValueAffixes({ value_prefix: "$", value_suffix: " bn" })).toEqual({
      prefix: "$",
      suffix: " bn",
    });
  });

  it("defaults each side to an empty string", () => {
    expect(resolveValueAffixes({})).toEqual({ prefix: "", suffix: "" });
    expect(resolveValueAffixes({ value_suffix: "%" })).toEqual({ prefix: "", suffix: "%" });
    expect(resolveValueAffixes({ value_prefix: "$" })).toEqual({ prefix: "$", suffix: "" });
  });
});

describe("applyValueAffixes", () => {
  it("is a no-op when both sides are empty", () => {
    expect(applyValueAffixes("12", { prefix: "", suffix: "" })).toBe("12");
    expect(applyValueAffixes("-12", { prefix: "", suffix: "" })).toBe("-12");
  });

  it("appends and prepends literally, inventing no spacing", () => {
    expect(applyValueAffixes("12", { prefix: "", suffix: "%" })).toBe("12%");
    expect(applyValueAffixes("12", { prefix: "$", suffix: "" })).toBe("$12");
    expect(applyValueAffixes("12", { prefix: "$", suffix: " bn" })).toBe("$12 bn");
    expect(applyValueAffixes("12", { prefix: "", suffix: " pp" })).toBe("12 pp");
  });

  it("puts the prefix AFTER a minus sign", () => {
    expect(applyValueAffixes("-5", { prefix: "$", suffix: "" })).toBe("-$5");
    expect(applyValueAffixes("-5", { prefix: "$", suffix: " bn" })).toBe("-$5 bn");
    expect(applyValueAffixes("-5", { prefix: "", suffix: "%" })).toBe("-5%");
  });

  it("leaves a decimal string's precision alone", () => {
    expect(applyValueAffixes("1.50", { prefix: "", suffix: "%" })).toBe("1.50%");
  });
});

describe("axis ticks carry the affixes", () => {
  it("suffix only", () => {
    expect(yTicks({ ...LINE, value_suffix: "%" } as ChartSpec)).toEqual([
      "10%", "12%", "14%", "16%", "18%", "20%",
    ]);
  });

  it("prefix only", () => {
    expect(yTicks({ ...LINE, value_prefix: "$" } as ChartSpec)[0]).toBe("$10");
  });

  it("both, and a negative tick keeps the prefix inside the sign", () => {
    const spec = { ...LINE, value_prefix: "$", value_suffix: " bn" } as ChartSpec;
    const ticks = yTicks(spec, rows([["2020", -20], ["2021", 20]]));
    expect(ticks).toContain("$0 bn");
    expect(ticks.some((t) => t?.startsWith("-$"))).toBe(true);
  });

  it("neither set renders bare numbers", () => {
    expect(yTicks(LINE)).toEqual(["10", "12", "14", "16", "18", "20"]);
  });

  it("reaches a horizontal bar's value axis (which runs along x)", () => {
    const spec = {
      chartType: "bar",
      title: "t",
      xAxisType: "categorical",
      orientation: "horizontal",
      columns: { x: "cat", value: "value", series: "series" },
      value_suffix: "%",
    } as unknown as ChartSpec;
    const data = [
      { cat: "a", value: "10", series: "A" },
      { cat: "b", value: "20", series: "A" },
    ] as unknown as TidyRow[];
    const { svg } = renderChart(spec, data, OPTS);
    const texts = Array.from(svg.querySelectorAll("text")).map((t) => t.textContent ?? "");
    expect(texts.some((t) => /^\d+%$/.test(t))).toBe(true);
  });
});

describe("value labels carry the affixes", () => {
  it("stacked segment and net labels", () => {
    const spec = {
      chartType: "stacked",
      title: "t",
      xAxisType: "categorical",
      series_order: ["A", "B"],
      columns: { x: "cat", value: "value", series: "series" },
      value_suffix: "%",
    } as unknown as ChartSpec;
    const data = [
      { cat: "x", value: "10", series: "A" },
      { cat: "x", value: "20", series: "B" },
    ] as unknown as TidyRow[];
    const { svg } = renderChart(spec, data, OPTS);
    const texts = Array.from(svg.querySelectorAll("text")).map((t) => t.textContent ?? "");
    expect(texts.filter((t) => t.endsWith("%")).length).toBeGreaterThan(0);
  });

  it("waterfall running-total labels", () => {
    const spec = {
      chartType: "waterfall",
      title: "t",
      xAxisType: "categorical",
      columns: { x: "cat", value: "value", kind: "kind" },
      value_prefix: "$",
    } as unknown as ChartSpec;
    const data = [
      { cat: "Start", value: "100", kind: "total" },
      { cat: "Up", value: "40", kind: "delta" },
    ] as unknown as TidyRow[];
    const { svg } = renderChart(spec, data, OPTS);
    const texts = Array.from(svg.querySelectorAll("text")).map((t) => t.textContent ?? "");
    expect(texts.some((t) => t.startsWith("$"))).toBe(true);
  });
});

describe("tooltips carry the affixes", () => {
  it("through the rendered result, not a second inference", () => {
    const { valueAffixes } = renderChart(
      { ...LINE, value_prefix: "$", value_suffix: " bn" } as ChartSpec,
      PLAIN,
      OPTS,
    );
    expect(valueAffixes).toEqual({ prefix: "$", suffix: " bn" });
    expect(formatValue(12, valueAffixes, 1)).toBe("$12.0 bn");
  });
});

describe("small multiples", () => {
  const spec = {
    ...LINE,
    columns: { x: "time", value: "value", series: "series", facet: "facet" },
    small_multiples: { columns: 2, mode: "shared" },
    value_suffix: "%",
  } as unknown as ChartSpec;
  const data = [
    { time: "2020", value: "5", series: "A", facet: "P" },
    { time: "2021", value: "7", series: "A", facet: "P" },
    { time: "2020", value: "3", series: "A", facet: "Q" },
    { time: "2021", value: "9", series: "A", facet: "Q" },
  ] as unknown as TidyRow[];

  it("every pane and the figure result carry them", () => {
    const fig = renderFigure(spec, data, OPTS);
    expect(fig.valueAffixes).toEqual({ prefix: "", suffix: "%" });
    for (const p of fig.panes) expect(p.valueAffixes).toEqual({ prefix: "", suffix: "%" });
  });

  it("suffixes the tick labels that are actually drawn", () => {
    // Shared mode suppresses y-tick labels on non-leftmost panes (only the left column shows
    // values), so assert over the panes that HAVE ticks rather than expecting every pane to.
    const fig = renderFigure(spec, data, OPTS);
    const ticks = fig.panes.flatMap((p) =>
      Array.from(p.svg!.querySelectorAll("g.tbl-y-tick-label text")).map((t) => t.textContent ?? ""),
    );
    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) expect(t.endsWith("%")).toBe(true);
  });
});

describe("narrower explicit formats still win", () => {
  it("a yAxis marker's own value_format beats the chart-wide affixes", () => {
    const spec = {
      ...LINE,
      value_suffix: "%",
      annotations: {
        yAxis: [{ y: 15, label: "target {value}", value_format: { decimals: 1, suffix: " pp" } }],
      },
    } as unknown as ChartSpec;
    const { svg } = renderChart(spec, PLAIN, OPTS);
    const texts = Array.from(svg.querySelectorAll("text")).map((t) => t.textContent ?? "");
    expect(texts).toContain("target 15.0 pp");
  });

  it("a dumbbell gap label uses value_format; its axis uses the chart-wide affixes", () => {
    const spec = {
      chartType: "dumbbell",
      title: "t",
      xAxisType: "categorical",
      orientation: "vertical",
      series_order: ["Current", "Proposed"],
      columns: { category: "cat", value: "value", series: "series" },
      value_suffix: "%",
      value_format: { suffix: " pp", decimals: 0 },
      gap_annotation: true,
    } as unknown as ChartSpec;
    const data = [
      { cat: "A", series: "Current", value: "10" },
      { cat: "A", series: "Proposed", value: "20" },
    ] as unknown as TidyRow[];
    const { svg } = renderChart(spec, data, OPTS);
    const ticks = Array.from(svg.querySelectorAll("g.tbl-y-tick-label text")).map(
      (t) => t.textContent ?? "",
    );
    for (const t of ticks) expect(t.endsWith("%")).toBe(true);
    const texts = Array.from(svg.querySelectorAll("text")).map((t) => t.textContent ?? "");
    expect(texts).toContain("Δ10 pp");
  });
});

describe("regression — the subtitle is prose and changes nothing", () => {
  const BARE = ["10", "12", "14", "16", "18", "20"];

  for (const subtitle of [
    "Percentage points",
    "Percent of GDP",
    "Percentiles",
    "PERCENTAGE POINTS",
    "Change in percentage points",
    "percent",
  ]) {
    it(`subtitle ${JSON.stringify(subtitle)} leaves the ticks bare`, () => {
      expect(yTicks({ ...LINE, subtitle } as ChartSpec)).toEqual(BARE);
    });
  }

  it("a percent subtitle does not override an explicit prefix", () => {
    const spec = { ...LINE, subtitle: "Percent of GDP", value_prefix: "$" } as ChartSpec;
    expect(yTicks(spec)[0]).toBe("$10");
  });
});
