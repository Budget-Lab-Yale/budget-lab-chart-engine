// @vitest-environment jsdom
//
// The `{value}` token in annotation labels: a pure substitution helper (unit-tested here) plus
// its wiring into assemble-plot.ts (rendered SVG tests below). See spec/annotations.ts.
import { describe, it, expect } from "vitest";
import { substituteValueToken } from "../src/spec/annotations";
import { renderChart } from "../src/engine/index";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

describe("substituteValueToken (pure helper)", () => {
  it("returns the label unchanged when it has no {value} token", () => {
    const fallback = () => "SHOULD NOT BE CALLED";
    expect(substituteValueToken("Overall", 1.23, undefined, fallback)).toBe("Overall");
    expect(substituteValueToken("Overall", 1.23, { decimals: 2 }, fallback)).toBe("Overall");
  });

  it("value_format takes precedence over the fallback formatter", () => {
    const fallback = () => "FALLBACK";
    const out = substituteValueToken("V: {value}", 5, { decimals: 1 }, fallback);
    expect(out).toBe("V: 5.0");
  });

  it("formats a negative value with suffix + decimals (brief example)", () => {
    const out = substituteValueToken(
      "Overall ({value})",
      -0.0738,
      { suffix: "%", decimals: 2 },
      () => "n/a",
    );
    expect(out).toBe("Overall (-0.07%)");
  });

  it("applies both prefix and suffix", () => {
    const out = substituteValueToken("{value}", 42, { prefix: "$", suffix: "M", decimals: 0 }, () => "n/a");
    expect(out).toBe("$42M");
  });

  it("defaults decimals to 2 when value_format omits it", () => {
    const out = substituteValueToken("{value}", 1.5, { suffix: "%" }, () => "n/a");
    expect(out).toBe("1.50%");
  });

  it("falls back to fallbackFormat(value) when value_format is absent", () => {
    const out = substituteValueToken("{value}", 7, undefined, (v) => `<${v}>`);
    expect(out).toBe("<7>");
  });
});

const rows: TidyRow[] = [
  { time: "2020", series: "a", value: "1" },
  { time: "2021", series: "a", value: "2" },
  { time: "2022", series: "a", value: "3" },
] as TidyRow[];

const textOf = (svg: SVGSVGElement, re: RegExp): string | undefined =>
  Array.from(svg.querySelectorAll("text"))
    .map((t) => t.textContent ?? "")
    .find((t) => re.test(t));

describe("{value} token — yAxis markers", () => {
  it("formats with the marker's own value_format (brief example: Overall (-0.07%))", () => {
    const spec: ChartSpec = {
      chartType: "line",
      title: "t",
      xAxisType: "numeric",
      data: "x",
      yAxisPolicy: { min: -1, max: 1 },
      annotations: {
        yAxis: [{ y: -0.0738, label: "Overall ({value})", value_format: { suffix: "%", decimals: 2 } }],
      },
    };
    const { svg } = renderChart(spec, rows, { width: 720, height: 400, document });
    expect(textOf(svg, /^Overall \(/)).toBe("Overall (-0.07%)");
  });

  it("falls back to the chart's y-tick format when value_format is absent", () => {
    const spec: ChartSpec = {
      chartType: "line",
      title: "t",
      xAxisType: "numeric",
      data: "x",
      yAxisPolicy: { min: -1, max: 1 },
      annotations: { yAxis: [{ y: 0.5, label: "NoFmt ({value})" }] },
    };
    const { svg } = renderChart(spec, rows, { width: 720, height: 400, document });
    // makeTickFormatter([-1,-0.5,0,0.5,1], "") → one decimal place, no units.
    expect(textOf(svg, /^NoFmt \(/)).toBe("NoFmt (0.5)");
  });

  it("a label without the token is untouched", () => {
    const spec: ChartSpec = {
      chartType: "line",
      title: "t",
      xAxisType: "numeric",
      data: "x",
      annotations: { yAxis: [{ y: 1.5, label: "Plain label" }] },
    };
    const { svg } = renderChart(spec, rows, { width: 720, height: 400, document });
    expect(textOf(svg, /^Plain label$/)).toBe("Plain label");
  });
});

describe("{value} token — xAxis markers", () => {
  it("a temporal marker substitutes the raw date string (not numeric-formatted)", () => {
    const dateRows: TidyRow[] = [
      { time: "2021-01-01", series: "a", value: "1" },
      { time: "2021-06-15", series: "a", value: "2" },
      { time: "2021-12-01", series: "a", value: "3" },
    ] as TidyRow[];
    const spec: ChartSpec = {
      chartType: "line",
      title: "t",
      xAxisType: "temporal",
      data: "x",
      annotations: { xAxis: [{ x: "2021-06-15", label: "Date ({value})" }] },
    };
    const { svg } = renderChart(spec, dateRows, { width: 720, height: 400, document });
    expect(textOf(svg, /^Date \(/)).toBe("Date (2021-06-15)");
  });

  it("a numeric-axis marker with value_format substitutes the numerically-formatted x", () => {
    const spec: ChartSpec = {
      chartType: "line",
      title: "t",
      xAxisType: "numeric",
      data: "x",
      annotations: {
        xAxis: [{ x: "2021", label: "Year ({value})", value_format: { decimals: 1 } }],
      },
    };
    const { svg } = renderChart(spec, rows, { width: 720, height: 400, document });
    expect(textOf(svg, /^Year \(/)).toBe("Year (2021.0)");
  });
});

describe("{value} token — points callouts", () => {
  it("prints the series-snapped value (no explicit y given)", () => {
    const twoSeries: TidyRow[] = [
      { time: "2020", series: "a", value: "1" },
      { time: "2021", series: "a", value: "2" },
      { time: "2022", series: "a", value: "3" },
      { time: "2020", series: "b", value: "4" },
      { time: "2021", series: "b", value: "5" },
      { time: "2022", series: "b", value: "6" },
    ] as TidyRow[];
    const spec: ChartSpec = {
      chartType: "line",
      title: "t",
      xAxisType: "numeric",
      data: "x",
      annotations: {
        points: [{ x: "2021", series: "a", label: "Snap ({value})", value_format: { decimals: 0 } }],
      },
    };
    const { svg } = renderChart(spec, twoSeries, { width: 720, height: 400, document });
    // Series "a" at x=2021 is 2 (the explicit-y path is untouched by this feature).
    expect(textOf(svg, /^Snap \(/)).toBe("Snap (2)");
  });
});

describe("{value} token — stagger interaction", () => {
  // The auto-stagger estimates each label's px width from label.length BEFORE it decides which
  // row a label lands in. If substitution ran AFTER the stagger pass, the stagger would measure
  // the short literal "{value}" token instead of the (much longer) substituted number, sizing the
  // collision box wrong. These two markers sit close enough in x that the SUBSTITUTED text
  // collides (forcing a second row) while the raw "{value}" text would not.
  it("substitutes before staggering — collision is computed from the substituted text", () => {
    const spec: ChartSpec = {
      chartType: "line",
      title: "t",
      xAxisType: "numeric",
      data: "x",
      annotations: {
        xAxis: [
          { x: "2020.3", label: "Alpha marker value reads ({value})", value_format: { decimals: 2 } },
          { x: "2020.5", label: "Beta marker value reads ({value})", value_format: { decimals: 2 } },
        ],
      },
    };
    const { svg } = renderChart(spec, rows, { width: 720, height: 400, document });
    const alpha = Array.from(svg.querySelectorAll("text")).find((t) => /^Alpha marker/.test(t.textContent ?? ""));
    const beta = Array.from(svg.querySelectorAll("text")).find((t) => /^Beta marker/.test(t.textContent ?? ""));
    expect(alpha?.textContent).toBe("Alpha marker value reads (2020.30)");
    expect(beta?.textContent).toBe("Beta marker value reads (2020.50)");
    // Staggered onto different rows: their <g> wrapper dy (row offset) differs.
    const dy = (el: Element | undefined) => {
      const m = /translate\(\s*[-\d.]+\s*,\s*([-\d.]+)\s*\)/.exec(el?.parentElement?.getAttribute("transform") ?? "");
      return m ? Number(m[1]) : 0;
    };
    expect(dy(alpha)).not.toBe(dy(beta));
  });
});
