// @vitest-environment jsdom
//
// `series_patterns` end-to-end on the rendered chart. The point of putting this in the engine
// rather than leaving it to a CSS override is that export-png.ts re-renders from the SPEC
// (`renderFigure(spec, rows)`) instead of serialising the live DOM — so a consumer's stylesheet
// can never reach the downloaded image. These tests assert on the engine's own output, which is
// what both the on-page chart and the export are built from.
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import { hatchPatternId, defaultHatchStroke } from "../src/engine/hatch";
import { validateSpec } from "../src/spec/validate";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const ROWS: TidyRow[] = [
  { time: "Bottom 50%", series: "collectedNew", value: "3" },
  { time: "Bottom 50%", series: "lostToBehavior", value: "1" },
  { time: "Top 1%", series: "collectedNew", value: "7" },
  { time: "Top 1%", series: "lostToBehavior", value: "4" },
] as unknown as TidyRow[];

const STACKED = {
  chartType: "stacked",
  title: "Distribution",
  xAxisType: "categorical",
  columns: { x: "time", value: "value", series: "series" },
  series_colors: { collectedNew: "blue", lostToBehavior: "#58A3E7" },
} as unknown as ChartSpec;

const OPTS = { width: 720, height: 400, document };

const segments = (svg: SVGSVGElement) => [...svg.querySelectorAll<SVGElement>("rect[data-series]")];
/** jsdom serialises `url(#x)` as `url("#x")`; both are valid CSS and resolve identically. */
const patternRef = (slug: string) => new RegExp('^url\\("?#tblhatch-' + slug + '-');
const segmentsFor = (svg: SVGSVGElement, series: string) =>
  [...svg.querySelectorAll<SVGElement>(`rect[data-series="${series}"]`)];

describe("series_patterns on a stacked bar", () => {
  it("fills the textured series from a pattern and leaves the others flat", () => {
    const spec = { ...STACKED, series_patterns: { lostToBehavior: "/" } } as unknown as ChartSpec;
    const { svg } = renderChart(spec, ROWS, OPTS);

    const hatched = segmentsFor(svg, "lostToBehavior");
    expect(hatched.length).toBeGreaterThan(0);
    for (const rect of hatched) {
      expect(rect.style.fill).toMatch(patternRef("fwd"));
    }
    for (const rect of segmentsFor(svg, "collectedNew")) {
      expect(rect.style.fill).toBe("");
    }
  });

  it("defines the pattern once in <defs>, over the series' declared colour as the ground", () => {
    const spec = { ...STACKED, series_patterns: { lostToBehavior: "/" } } as unknown as ChartSpec;
    const { svg } = renderChart(spec, ROWS, OPTS);

    const id = hatchPatternId("/", "#58A3E7", defaultHatchStroke("#58A3E7"));
    const patterns = [...svg.querySelectorAll(`pattern[id="${id}"]`)];
    expect(patterns).toHaveLength(1);
    expect(patterns[0]!.closest("defs")).not.toBeNull();
    expect(patterns[0]!.querySelector("rect")!.getAttribute("style")).toContain("#58A3E7");
  });

  it("derives the band colour from the ground rather than taking it from the spec", () => {
    const spec = { ...STACKED, series_patterns: { lostToBehavior: "/" } } as unknown as ChartSpec;
    const { svg } = renderChart(spec, ROWS, OPTS);
    // The band is the pattern's SECOND rect; the first is the ground.
    const band = [...svg.querySelectorAll("pattern rect")][1]!;
    expect(band.getAttribute("style")).toContain(defaultHatchStroke("#58A3E7"));
  });

  it("rejects an attempt to author the band colour — it is not configurable", () => {
    const spec = {
      ...STACKED,
      series_patterns: { lostToBehavior: "/" },
      series_pattern_colors: { lostToBehavior: "navy" },
    };
    const r = validateSpec(spec);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/series_pattern_colors/);
  });

  it("renders every character, each as its own pattern", () => {
    for (const [char, slug] of [
      ["/", "fwd"],
      ["\\", "bwd"],
      ["|", "vert"],
      ["-", "horz"],
      ["+", "plus"],
      ["x", "cross"],
    ] as const) {
      const spec = { ...STACKED, series_patterns: { lostToBehavior: char } } as unknown as ChartSpec;
      const { svg } = renderChart(spec, ROWS, OPTS);
      expect(svg.querySelector(`pattern[id^="tblhatch-${slug}-"]`)).not.toBeNull();
    }
  });

  it("emits no <pattern> at all when the spec declares none", () => {
    const { svg } = renderChart(STACKED, ROWS, OPTS);
    expect(svg.querySelector("pattern")).toBeNull();
    for (const rect of segments(svg)) expect(rect.style.fill).toBe("");
  });
});

describe("series_patterns on a mono stack", () => {
  // barStack.mono replaces series_colors with tonal tiers, so the ground has to come from the map
  // the MARKS used, not the palette entry — otherwise the hatch sits on a colour that is not the
  // colour of the segment it fills.
  it("grounds the pattern in the tonal tier actually painted, not the palette entry", () => {
    const spec = {
      ...STACKED,
      series_colors: undefined,
      series_patterns: { lostToBehavior: "+" },
      barStack: { mono: { base: "blue" }, netDisplay: "none" },
    } as unknown as ChartSpec;
    const { svg, legendItems } = renderChart(spec, ROWS, OPTS);

    const groundStyle = svg.querySelector("pattern rect")!.getAttribute("style")!;
    const tier = legendItems!.find((i) => i.series === "lostToBehavior")!.color!;
    expect(groundStyle).toContain(tier);

    // And the tier is a mono ramp step, not the categorical blue the palette would have handed out.
    expect(tier.toUpperCase()).not.toBe("#0072B2");
  });
});

describe("series_patterns across chart types", () => {
  const BAR_ROWS: TidyRow[] = [
    { time: "A", series: "one", value: "3" },
    { time: "B", series: "one", value: "5" },
  ] as unknown as TidyRow[];

  it("applies to a grouped/single bar chart's rects", () => {
    const spec = {
      chartType: "bar",
      title: "t",
      xAxisType: "categorical",
      columns: { x: "time", value: "value", series: "series" },
      series_colors: { one: "blue" },
      series_patterns: { one: "x" },
    } as unknown as ChartSpec;
    const { svg } = renderChart(spec, BAR_ROWS, OPTS);
    expect(svg.querySelector('pattern[id^="tblhatch-cross-"]')).not.toBeNull();
    const rects = [...svg.querySelectorAll<SVGElement>('rect[data-series="one"]')];
    expect(rects.length).toBeGreaterThan(0);
    for (const r of rects) expect(r.style.fill).toMatch(patternRef("cross"));
  });

  it("applies to an area chart's fill path", () => {
    const spec = {
      chartType: "area",
      title: "t",
      xAxisType: "numeric",
      columns: { x: "time", value: "value", series: "series" },
      series_colors: { one: "blue" },
      series_patterns: { one: "/" },
    } as unknown as ChartSpec;
    const rows = [
      { time: "2020", series: "one", value: "1" },
      { time: "2021", series: "one", value: "2" },
    ] as unknown as TidyRow[];
    const { svg } = renderChart(spec, rows, OPTS);
    expect(svg.querySelector('pattern[id^="tblhatch-fwd-"]')).not.toBeNull();
    const filled = [...svg.querySelectorAll('path[data-series="one"]')].filter((p) =>
      (p as SVGElement).style.fill.startsWith("url("),
    );
    expect(filled.length).toBeGreaterThan(0);
  });

  it("leaves a line chart's stroked path alone — a 7px hatch on a 2px line is noise", () => {
    const spec = {
      chartType: "line",
      title: "t",
      xAxisType: "numeric",
      columns: { x: "time", value: "value", series: "series" },
      series_colors: { one: "blue" },
      series_patterns: { one: "/" },
    } as unknown as ChartSpec;
    const rows = [
      { time: "2020", series: "one", value: "1" },
      { time: "2021", series: "one", value: "2" },
    ] as unknown as TidyRow[];
    const { svg } = renderChart(spec, rows, OPTS);
    expect(svg.querySelector("pattern")).toBeNull();
  });
});

describe("two figures on one page", () => {
  it("share an id only when the texture and both colours match, and then the defs are identical", () => {
    const spec = { ...STACKED, series_patterns: { lostToBehavior: "/" } } as unknown as ChartSpec;
    const a = renderChart(spec, ROWS, OPTS).svg;
    const b = renderChart(spec, ROWS, OPTS).svg;
    const idA = a.querySelector("pattern")!.getAttribute("id");
    const idB = b.querySelector("pattern")!.getAttribute("id");
    expect(idA).toBe(idB);
    // Sharing is safe precisely because the definitions agree — whichever one the document
    // resolves to paints the same texture.
    expect(a.querySelector("pattern")!.outerHTML).toBe(b.querySelector("pattern")!.outerHTML);
  });

  it("gives a different texture over the same colour a different id", () => {
    const one = renderChart(
      { ...STACKED, series_patterns: { lostToBehavior: "/" } } as unknown as ChartSpec,
      ROWS,
      OPTS,
    ).svg;
    const two = renderChart(
      { ...STACKED, series_patterns: { lostToBehavior: "\\" } } as unknown as ChartSpec,
      ROWS,
      OPTS,
    ).svg;
    expect(one.querySelector("pattern")!.getAttribute("id")).not.toBe(
      two.querySelector("pattern")!.getAttribute("id"),
    );
  });
});

// The ground has to be the colour the mark is ACTUALLY painted, which is not always the series
// colour: bar_color, category_colors and the title-selector accent all override the fill per mark.
// Reading the series map instead produced a hatch tile whose ground painted OVER the override — an
// amber bar came out blue.
describe("series_patterns over a per-mark fill override", () => {
  const ROWS_1S = [
    { time: "A", value: "3" },
    { time: "B", value: "5" },
    { time: "Total", value: "8" },
  ] as unknown as TidyRow[];

  const singleBar = (extra: Record<string, unknown>) =>
    ({
      chartType: "bar",
      title: "t",
      xAxisType: "categorical",
      columns: { x: "time", value: "value" },
      series_patterns: { "": "/" },
      ...extra,
    }) as unknown as ChartSpec;

  const grounds = (svg: SVGSVGElement) =>
    [...svg.querySelectorAll("pattern")].map((p) =>
      (p.querySelector("rect")!.getAttribute("style") ?? "").replace("fill:", "").toUpperCase(),
    );

  it("grounds the hatch in bar_color, not the default series colour", () => {
    const { svg } = renderChart(singleBar({ bar_color: "amber" }), ROWS_1S, OPTS);
    expect(grounds(svg)).toContain("#E69F00");
    expect(grounds(svg)).not.toContain("#0072B2");
  });

  it("gives a category_colors bar its own hatch, grounded in its own colour", () => {
    const { svg } = renderChart(
      singleBar({ bar_color: "blue", category_colors: { Total: "navy" } }),
      ROWS_1S,
      OPTS,
    );
    // Two distinct grounds in play, so two patterns — one per colour actually painted.
    expect(grounds(svg).sort()).toEqual(["#0072B2", "#101F5B"]);

    const fillOf = (i: number) =>
      [...svg.querySelectorAll<SVGElement>('rect[data-series=""]')][i]!.style.fill;
    // The overridden bar must reference the navy-ground pattern, not the blue one.
    expect(fillOf(2)).toContain("101F5B");
    expect(fillOf(0)).toContain("0072B2");
  });
});
