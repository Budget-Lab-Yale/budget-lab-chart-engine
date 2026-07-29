// @vitest-environment jsdom
//
// End-to-end coverage for `shading` (line-to-baseline fills). The geometry itself is unit-tested in
// test/shade.test.ts; this file locks the wiring: which marks get emitted, where they paint, how they
// pick a color, that they tag data-series without catching confidence bands, and the clip/facet paths.
import { describe, it, expect } from "vitest";
import { renderChart, renderFigure } from "../src/engine/index";
import { SHADE_CLASS } from "../src/engine/marks/line";
import { validateSpec, validateChartData } from "../src/spec/validate";
import { TBL } from "../src/engine/theme";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const BASE = {
  chartType: "line",
  title: "t",
  xAxisType: "numeric",
  columns: { x: "time", value: "value", series: "series" },
} as unknown as ChartSpec;

function rows(pairs: Array<[number, number]>, series = "A"): TidyRow[] {
  return pairs.map(([t, v]) => ({ time: String(t), value: String(v), series })) as unknown as TidyRow[];
}

const CROSSING = rows([[2020, 10], [2021, -10], [2022, 10]]);
const OPTS = { width: 720, height: 400, document };

const shadePaths = (svg: SVGSVGElement) =>
  Array.from(svg.querySelectorAll<SVGPathElement>(`g.${SHADE_CLASS} path`));

describe("shading — mark emission", () => {
  it("emits nothing when `shading` is absent", () => {
    const { svg } = renderChart(BASE, CROSSING, OPTS);
    expect(shadePaths(svg).length).toBe(0);
  });

  it("emits one path for an unsplit region", () => {
    const spec = { ...BASE, shading: [{ series: "A" }] } as ChartSpec;
    const { svg } = renderChart(spec, CROSSING, OPTS);
    expect(shadePaths(svg).length).toBe(1);
  });

  it("emits one path per run when a side filter splits the series", () => {
    const spec = { ...BASE, shading: [{ series: "A", side: "positive" }] } as ChartSpec;
    const { svg } = renderChart(spec, CROSSING, OPTS);
    // +10 → -10 → +10 gives two positive runs.
    expect(shadePaths(svg).length).toBe(2);
  });

  it("emits a region per in-scope series when `series` is omitted", () => {
    const spec = { ...BASE, series_order: ["A", "B"], shading: [{}] } as ChartSpec;
    const data = [...rows([[2020, 5], [2021, 6]], "A"), ...rows([[2020, 2], [2021, 3]], "B")];
    const { svg } = renderChart(spec, data, OPTS);
    expect(shadePaths(svg).map((p) => p.getAttribute("data-series"))).toEqual(["A", "B"]);
  });

  it("emits both regions when two cover the same series", () => {
    const spec = {
      ...BASE,
      shading: [{ series: "A" }, { series: "A", from: "2020", to: "2021" }],
    } as ChartSpec;
    const { svg } = renderChart(spec, CROSSING, OPTS);
    expect(shadePaths(svg).length).toBe(2);
  });

  it("emits nothing for a region whose x range misses the data", () => {
    const spec = { ...BASE, shading: [{ series: "A", from: "2050", to: "2060" }] } as ChartSpec;
    const { svg } = renderChart(spec, CROSSING, OPTS);
    expect(shadePaths(svg).length).toBe(0);
  });
});

describe("shading — fill resolution", () => {
  it("defaults to the series' own color at the confidence-band opacity", () => {
    const spec = { ...BASE, series_order: ["A"], shading: [{ series: "A" }] } as ChartSpec;
    const { svg, colors } = renderChart(spec, CROSSING, OPTS) as unknown as {
      svg: SVGSVGElement;
      colors: Map<string, string>;
    };
    const group = svg.querySelector(`g.${SHADE_CLASS}`)!;
    expect(group.getAttribute("fill")).toBe(colors.get("A"));
    expect(group.getAttribute("fill-opacity")).toBe("0.18");
  });

  it("honors an explicit palette-token color", () => {
    const spec = { ...BASE, shading: [{ series: "A", color: "gray" }] } as ChartSpec;
    const { svg } = renderChart(spec, CROSSING, OPTS);
    const fill = svg.querySelector(`g.${SHADE_CLASS}`)!.getAttribute("fill");
    expect(fill).not.toBeNull();
    expect(fill).not.toBe(TBL.color.blue);
  });

  it("honors a raw hex color and an explicit fillOpacity", () => {
    const spec = {
      ...BASE,
      shading: [{ series: "A", color: "#123456", fillOpacity: 0.5 }],
    } as ChartSpec;
    const { svg } = renderChart(spec, CROSSING, OPTS);
    const group = svg.querySelector(`g.${SHADE_CLASS}`)!;
    expect(group.getAttribute("fill")).toBe("#123456");
    expect(group.getAttribute("fill-opacity")).toBe("0.5");
  });
});

describe("shading — baseline", () => {
  /** The y of the fill's flat baseline edge, read off the path's most-repeated y coordinate. */
  function baselineY(svg: SVGSVGElement): number {
    const d = shadePaths(svg)[0]!.getAttribute("d")!;
    const ys = Array.from(d.matchAll(/[ML,](-?[\d.]+),(-?[\d.]+)/g)).map((m) => Number(m[2]));
    const counts = new Map<number, number>();
    for (const y of ys) counts.set(y, (counts.get(y) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  }

  const frame = (svg: SVGSVGElement) => ({
    top: Number(svg.getAttribute("data-margin-top")),
    bottom: 400 - Number(svg.getAttribute("data-margin-bottom")),
  });

  it("fills to zero when zero is inside the domain", () => {
    const spec = { ...BASE, shading: [{ series: "A" }] } as ChartSpec;
    const { svg } = renderChart(spec, CROSSING, OPTS);
    // ±10 data nices to a symmetric [-10, 10], so y(0) is the frame's vertical midpoint.
    const { top, bottom } = frame(svg);
    expect(baselineY(svg)).toBe((top + bottom) / 2);
  });

  it("fills to the domain floor when zero is below the domain", () => {
    const spec = {
      ...BASE,
      yAxisPolicy: { min: 40, max: 70 },
      shading: [{ series: "A" }],
    } as ChartSpec;
    const { svg } = renderChart(spec, rows([[2020, 50], [2021, 62]]), OPTS);
    expect(baselineY(svg)).toBe(frame(svg).bottom);
  });

  it("fills to the domain ceiling when zero is above the domain", () => {
    const spec = {
      ...BASE,
      yAxisPolicy: { min: -70, max: -40 },
      shading: [{ series: "A" }],
    } as ChartSpec;
    const { svg } = renderChart(spec, rows([[2020, -50], [2021, -62]]), OPTS);
    expect(baselineY(svg)).toBe(frame(svg).top);
  });
});

describe("shading — paint order", () => {
  it("paints behind the gridlines", () => {
    const spec = { ...BASE, shading: [{ series: "A" }] } as ChartSpec;
    const { svg } = renderChart(spec, CROSSING, OPTS);
    const all = Array.from(svg.querySelectorAll("g"));
    const shadeIdx = all.findIndex((g) => g.classList.contains(SHADE_CLASS) || g.querySelector(`g.${SHADE_CLASS}`));
    const gridIdx = all.findIndex((g) => g.getAttribute("aria-label")?.includes("rule"));
    expect(shadeIdx).toBeGreaterThanOrEqual(0);
    expect(gridIdx).toBeGreaterThanOrEqual(0);
    expect(shadeIdx).toBeLessThan(gridIdx);
  });

  it("paints under the confidence band, which is the more specific statement", () => {
    const spec = {
      ...BASE,
      series_order: ["A"],
      confidence_bands: [{ series: "A", lower: "lo", upper: "hi" }],
      shading: [{ series: "A" }],
    } as unknown as ChartSpec;
    const data = [
      { time: "2020", value: "10", series: "A", lo: "8", hi: "12" },
      { time: "2021", value: "14", series: "A", lo: "11", hi: "17" },
    ] as unknown as TidyRow[];
    const { svg } = renderChart(spec, data, OPTS);
    const areaGroups = Array.from(svg.querySelectorAll('g[aria-label="area"]'));
    expect(areaGroups.length).toBe(2);
    // Document order == paint order: the shade group comes first.
    expect(areaGroups[0]!.classList.contains(SHADE_CLASS)).toBe(true);
    expect(areaGroups[1]!.classList.contains(SHADE_CLASS)).toBe(false);
  });
});

describe("shading — tagging", () => {
  it("tags shade paths with data-series without touching confidence bands", () => {
    const spec = {
      ...BASE,
      series_order: ["A"],
      confidence_bands: [{ series: "A", lower: "lo", upper: "hi" }],
      shading: [{ series: "A", side: "positive" }],
    } as unknown as ChartSpec;
    const data = [
      { time: "2020", value: "10", series: "A", lo: "8", hi: "12" },
      { time: "2021", value: "-10", series: "A", lo: "-12", hi: "-8" },
      { time: "2022", value: "10", series: "A", lo: "8", hi: "12" },
    ] as unknown as TidyRow[];
    const { svg } = renderChart(spec, data, OPTS);
    const shade = shadePaths(svg);
    expect(shade.length).toBe(2);
    for (const p of shade) expect(p.getAttribute("data-series")).toBe("A");
    // The CI band path is the one area path OUTSIDE the shade group; it stays untagged.
    const ciPaths = Array.from(svg.querySelectorAll('g[aria-label="area"] path')).filter(
      (p) => !p.closest(`g.${SHADE_CLASS}`),
    );
    expect(ciPaths.length).toBe(1);
    expect(ciPaths[0]!.getAttribute("data-series")).toBeNull();
  });

  it("tags each series' own fill when `series` is omitted and runs split", () => {
    const spec = { ...BASE, series_order: ["A", "B"], shading: [{ side: "positive" }] } as ChartSpec;
    const data = [
      ...rows([[2020, 10], [2021, -10], [2022, 10]], "A"), // two positive runs
      ...rows([[2020, 4], [2021, 5], [2022, 6]], "B"), // one
    ];
    const { svg } = renderChart(spec, data, OPTS);
    expect(shadePaths(svg).map((p) => p.getAttribute("data-series"))).toEqual(["A", "A", "B"]);
  });
});

describe("shading — clip and facets", () => {
  it("carries the chart's clip reference on a truncated axis", () => {
    const spec = {
      ...BASE,
      yAxisPolicy: { min: 0, max: 5 },
      shading: [{ series: "A" }],
    } as ChartSpec;
    const { svg } = renderChart(spec, rows([[2020, 2], [2021, 90]]), OPTS);
    const wrapper = svg.querySelector(`g.${SHADE_CLASS}`)!.parentElement as Element;
    expect(wrapper.getAttribute("clip-path")).toMatch(/^url\(#/);
  });

  it("emits shading in every small-multiples pane", () => {
    const spec = {
      ...BASE,
      columns: { x: "time", value: "value", series: "series", facet: "facet" },
      small_multiples: { columns: 2, mode: "shared" },
      shading: [{ series: "A" }],
    } as unknown as ChartSpec;
    const data = [
      { time: "2020", value: "5", series: "A", facet: "P" },
      { time: "2021", value: "7", series: "A", facet: "P" },
      { time: "2020", value: "3", series: "A", facet: "Q" },
      { time: "2021", value: "9", series: "A", facet: "Q" },
    ] as unknown as TidyRow[];
    const fig = renderFigure(spec, data, OPTS);
    expect(fig.panes.length).toBe(2);
    for (const p of fig.panes) {
      expect(p.svg!.querySelectorAll(`g.${SHADE_CLASS} path`).length).toBe(1);
    }
  });
});

describe("shading — x bounds go through the chart's axis adapter", () => {
  it("crops a temporal range on dates", () => {
    const spec = {
      ...BASE,
      xAxisType: "temporal",
      shading: [{ series: "A", from: "2020-01-02", to: "2020-01-03" }],
    } as unknown as ChartSpec;
    const data = [
      { time: "2020-01-01", value: "10", series: "A" },
      { time: "2020-01-02", value: "20", series: "A" },
      { time: "2020-01-03", value: "30", series: "A" },
      { time: "2020-01-04", value: "40", series: "A" },
    ] as unknown as TidyRow[];
    const { svg } = renderChart(spec, data, OPTS);
    const d = shadePaths(svg)[0]!.getAttribute("d")!;
    // Two data points in range → the fill outline has 4 vertices (2 top + 2 baseline).
    expect(d.match(/[ML]/g)!.length).toBe(4);
  });

  it("crops a categorical range by category", () => {
    const spec = {
      chartType: "line",
      title: "t",
      xAxisType: "categorical",
      columns: { x: "cat", value: "value", series: "series" },
      shading: [{ series: "A", from: "b", to: "c" }],
    } as unknown as ChartSpec;
    const data = [
      { cat: "a", value: "10", series: "A" },
      { cat: "b", value: "20", series: "A" },
      { cat: "c", value: "30", series: "A" },
      { cat: "d", value: "40", series: "A" },
    ] as unknown as TidyRow[];
    const { svg } = renderChart(spec, data, OPTS);
    expect(shadePaths(svg).length).toBe(1);
    expect(shadePaths(svg)[0]!.getAttribute("d")!.match(/[ML]/g)!.length).toBe(4);
  });
});

describe("shading — validation", () => {
  const valid = (spec: unknown) => validateSpec(spec);

  it("accepts a minimal region on a line chart", () => {
    expect(valid({ ...BASE, data: "d.csv", shading: [{}] }).valid).toBe(true);
  });

  it("rejects shading on a non-line chart type", () => {
    const res = valid({ ...BASE, chartType: "area", data: "d.csv", shading: [{ series: "A" }] });
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toMatch(/chartType "line" only/);
  });

  it("rejects an unknown side value", () => {
    const res = valid({ ...BASE, data: "d.csv", shading: [{ side: "up" }] });
    expect(res.valid).toBe(false);
  });

  it("rejects an unknown key", () => {
    const res = valid({ ...BASE, data: "d.csv", shading: [{ colour: "gray" }] });
    expect(res.valid).toBe(false);
  });

  it("rejects a fillOpacity outside [0,1]", () => {
    expect(valid({ ...BASE, data: "d.csv", shading: [{ fillOpacity: 1.5 }] }).valid).toBe(false);
  });

  it("rejects a series the data does not have", () => {
    const res = validateChartData({ ...BASE, shading: [{ series: "Z" }] } as ChartSpec, CROSSING);
    expect(res.valid).toBe(false);
    expect(res.errors.join()).toMatch(/shading\[0\] names series "Z"/);
  });

  it("rejects a categorical bound the x column does not have", () => {
    const spec = {
      chartType: "line",
      title: "t",
      xAxisType: "categorical",
      columns: { x: "cat", value: "value", series: "series" },
      shading: [{ series: "A", from: "zz" }],
    } as unknown as ChartSpec;
    const data = [{ cat: "a", value: "1", series: "A" }] as unknown as TidyRow[];
    const res = validateChartData(spec, data);
    expect(res.valid).toBe(false);
    expect(res.errors.join()).toMatch(/shading\[0\]\.from names category "zz"/);
  });

  it("rejects a side filter that could never match", () => {
    const res = validateChartData(
      { ...BASE, shading: [{ series: "A", side: "negative" }] } as ChartSpec,
      rows([[2020, 5], [2021, 7]]),
    );
    expect(res.valid).toBe(false);
    expect(res.errors.join()).toMatch(/would fill nothing/);
  });

  it("accepts a side filter that matches some rows", () => {
    const res = validateChartData(
      { ...BASE, shading: [{ series: "A", side: "negative" }] } as ChartSpec,
      CROSSING,
    );
    expect(res.valid).toBe(true);
  });
});
