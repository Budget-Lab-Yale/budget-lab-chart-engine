// @vitest-environment jsdom
//
// An unresolvable color name used to ship a BLANK figure. `resolveColor` returns an unknown name
// unchanged, it reaches Plot as a constant fill, Plot reads a string it cannot parse as a COLUMN
// name, the channel resolves all-undefined, and the marks are dropped — while `validateSpec` said
// `valid: true`. The first test measures that mechanism on the real renderer so the rest of the file
// is pinning something demonstrably real, not a rule for its own sake.
//
// The second block is the one that matters for coverage: EVERY spec field that takes a color, so a
// new color-valued field added without a check fails here rather than in a published figure.
import { describe, it, expect } from "vitest";
import { validateSpec } from "../src/spec/validate";
import { renderChart } from "../src/engine/index";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const ROWS: TidyRow[] = [
  { time: "A", series: "one", value: "6" },
  { time: "B", series: "one", value: "3" },
] as unknown as TidyRow[];

const BAR: ChartSpec = {
  chartType: "bar",
  title: "Demo",
  xAxisType: "categorical",
  data: "d.csv",
};

describe("an unpaintable color blanks the figure (the bug being gated)", () => {
  it("drops every bar when bar_color names nothing", () => {
    const good = renderChart({ ...BAR, bar_color: "blue-400" }, ROWS, { width: 600, height: 300, document });
    expect(good.svg.querySelectorAll("rect[width]").length).toBeGreaterThan(0);

    // One character off a real tier name, and the frame comes out empty.
    const blank = renderChart({ ...BAR, bar_color: "blue-450" }, ROWS, { width: 600, height: 300, document });
    expect(blank.svg.querySelectorAll('g[aria-label="bar"] rect').length).toBe(0);
  });

  it("rejects it at load instead", () => {
    expect(validateSpec({ ...BAR, bar_color: "blue-450" }).valid).toBe(false);
    expect(validateSpec({ ...BAR, series_colors: { "": "blu" } }).valid).toBe(false);
    expect(
      validateSpec({ ...BAR, chartType: "stacked", series_colors: { one: "amber-250" } }).valid,
    ).toBe(false);
  });
});

/** Every field in the schema that takes a color, with a value that names nothing. Keep this list
 *  exhaustive: it is the only thing standing between a new color field and a silently blank figure. */
const COLOR_FIELDS: Array<[field: string, spec: Record<string, unknown>]> = [
  ["series_colors", { ...BAR, series_colors: { one: "blu" } }],
  ["bar_color", { ...BAR, bar_color: "blu" }],
  ["category_colors", { ...BAR, category_colors: { A: "blu" } }],
  [
    "annotations.xAxis",
    { ...BAR, xAxisType: "temporal", annotations: { xAxis: [{ x: "2020-01-01", color: "blu" }] } },
  ],
  [
    "annotations.yAxis",
    { ...BAR, annotations: { yAxis: [{ y: 1, color: "blu" }] } },
  ],
  [
    "annotations.bands",
    {
      ...BAR,
      xAxisType: "temporal",
      annotations: { bands: [{ start: "2020-01-01", end: "2021-01-01", color: "blu" }] },
    },
  ],
  [
    "annotations.points",
    { ...BAR, xAxisType: "temporal", annotations: { points: [{ x: "2020-01-01", label: "p", color: "blu" }] } },
  ],
  [
    "xAxisPolicy.markers",
    { ...BAR, xAxisType: "temporal", xAxisPolicy: { markers: [{ x: "2020-01-01", color: "blu" }] } },
  ],
  [
    "xAxisPolicy.bands",
    {
      ...BAR,
      xAxisType: "temporal",
      xAxisPolicy: { bands: [{ start: "2020-01-01", end: "2021-01-01", color: "blu" }] },
    },
  ],
  ["yAxisPolicy.markers", { ...BAR, yAxisPolicy: { markers: [{ y: 1, color: "blu" }] } }],
  [
    "shading",
    { ...BAR, chartType: "line", xAxisType: "temporal", shading: [{ color: "blu" }] },
  ],
  [
    "rug.tracks",
    {
      ...BAR,
      chartType: "line",
      xAxisType: "temporal",
      rug: { tracks: [{ label: "t", color: "blu", intervals: [{ from: "2020-01-01", to: "2021-01-01" }] }] },
    },
  ],
  [
    "title_selectors",
    { ...BAR, title: "Demo {dim}", title_selectors: { dim: { options: [{ id: "a", color: "blu" }] } } },
  ],
  [
    "waterfall.colors.increase",
    { ...BAR, chartType: "waterfall", waterfall: { colors: { increase: "blu" } } },
  ],
  [
    "waterfall.colors.decrease",
    { ...BAR, chartType: "waterfall", waterfall: { colors: { decrease: "blu" } } },
  ],
  [
    "waterfall.colors.total",
    { ...BAR, chartType: "waterfall", waterfall: { colors: { total: "blu" } } },
  ],
  ["waterfall.connectorColor", { ...BAR, chartType: "waterfall", waterfall: { connectorColor: "blu" } }],
  ["connector.color", { ...BAR, chartType: "dumbbell", connector: { color: "blu" } }],
  ["barStack.mono.base", { ...BAR, chartType: "stacked", barStack: { mono: { base: "blu" } } }],
];

describe("every color-valued field is checked", () => {
  for (const [field, spec] of COLOR_FIELDS) {
    it(`rejects an unresolvable color in ${field}`, () => {
      const r = validateSpec(spec);
      expect(r.valid).toBe(false);
      // The message must name the field, or an author cannot find it in a 200-line spec.
      expect(r.errors.join("\n")).toContain(field.split(".")[0] as string);
      expect(r.errors.join("\n")).toContain('"blu"');
    });
  }
});

describe("what still passes", () => {
  // The documented promise: an unknown-but-VALID CSS string is passed through untouched, and that
  // must not start failing. Everything here renders today.
  const OK = [
    "blue", "amber-light", "purple-600", "navy", "sky", "grey", "black",
    "#1A1A2E", "#abc", "#0072B2FF",
    "rgb(1, 2, 3)", "rgba(1,2,3,0.5)", "hsl(210, 50%, 40%)", "oklch(0.5 0.1 200)",
    "steelblue", "rebeccapurple", "transparent", "none", "currentColor", "var(--x)",
  ];
  for (const value of OK) {
    it(`accepts ${value}`, () => {
      expect(validateSpec({ ...BAR, bar_color: value }).valid).toBe(true);
    });
  }

  it("accepts a categorical hue (and an alias) for barStack.mono.base", () => {
    expect(validateSpec({ ...BAR, chartType: "stacked", barStack: { mono: { base: "blue" } } }).valid).toBe(true);
    expect(validateSpec({ ...BAR, chartType: "stacked", barStack: { mono: { base: "purple" } } }).valid).toBe(true);
  });

  it("rejects a hex for barStack.mono.base — monoScale throws on one mid-render", () => {
    const r = validateSpec({ ...BAR, chartType: "stacked", barStack: { mono: { base: "#003366" } } });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/not a known categorical hue/);
  });

  it("ignores a color in an axis policy the unified annotations block overrides", () => {
    // xAxisPolicy.markers is dead config once annotations.xAxis exists (resolveAnnotations), so its
    // color is never painted — failing the spec over it would break a chart that renders correctly.
    const r = validateSpec({
      ...BAR,
      xAxisType: "temporal",
      annotations: { xAxis: [{ x: "2020-01-01", color: "blue" }] },
      xAxisPolicy: { markers: [{ x: "2020-01-01", color: "blu" }] },
    });
    expect(r.valid).toBe(true);
  });
});

describe("the message points at the mistake", () => {
  it("names the tiers a hue actually ships", () => {
    const r = validateSpec({ ...BAR, bar_color: "blue-450" });
    expect(r.errors.join("\n")).toMatch(/"blue" ships tiers 50 100 200 300 400 500 600 700/);
  });

  it("suggests the near miss", () => {
    expect(validateSpec({ ...BAR, bar_color: "blu" }).errors.join("\n")).toMatch(/Did you mean "blue"\?/);
    expect(validateSpec({ ...BAR, bar_color: "stealblue" }).errors.join("\n")).toMatch(
      /Did you mean "steelblue"\?/,
    );
  });

  it("reports every bad color at once, not just the first", () => {
    const r = validateSpec({ ...BAR, series_colors: { one: "blu", two: "ambr" }, bar_color: "grene" });
    expect(r.errors.length).toBe(3);
  });

  it("rejects an empty color — on the `??` call sites it blanks marks exactly like a typo does", () => {
    const r = validateSpec({ ...BAR, bar_color: "" });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/empty/);
  });
});
