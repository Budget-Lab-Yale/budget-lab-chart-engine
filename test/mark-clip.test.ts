// @vitest-environment jsdom
//
// Truncated value axis → clip the data marks to the plot frame. Before this, a `yAxisPolicy` min/max
// narrower than the data let marks paint outside the frame entirely (a line spike rendered at
// y = -1332 on a 400px chart whose frame top is y = 18, over the title and off the top of the SVG).
//
// The gate lives in renderPane and compares the resolved domain against the geometry each chart type
// actually PAINTS (`computeDrawnValueExtent`) — not the padded axis extent, so a chart whose data
// fits stays unclipped and byte-identical (Plot's `clip` wraps the mark in an extra <g>).
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import { computeDrawnValueExtent } from "../src/engine/scales";
import { mountChart } from "../src/engine/render-live";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";
import type { PreparedRow } from "../src/engine/marks/index";

function rows(vals: Array<[string, number]>, series = "A"): TidyRow[] {
  return vals.map(([time, value]) => ({ time, value: String(value), series })) as unknown as TidyRow[];
}

const LINE_BASE = {
  chartType: "line",
  title: "t",
  xAxisType: "numeric",
  columns: { x: "time", value: "value", series: "series" },
} as unknown as ChartSpec;

/** The clip lands on the mark group in a single frame; Plot nests it inside each facet group when
 *  the mark is faceted, so match either shape. */
function clipCount(svg: SVGSVGElement): number {
  return svg.querySelectorAll("clipPath").length;
}

describe("line marks — truncated value axis", () => {
  const spiky = rows([["2020", 10], ["2021", 12], ["2022", 95], ["2023", 14], ["2024", 11]]);

  it("clips when a hard max cuts below the data", () => {
    const spec = { ...LINE_BASE, yAxisPolicy: { min: 0, max: 20 } } as ChartSpec;
    const { svg } = renderChart(spec, spiky, { width: 720, height: 400, document });
    const group = svg.querySelector('g[aria-label="line"]')!;
    expect(group.getAttribute("clip-path")).toMatch(/^url\(#/);
    expect(clipCount(svg)).toBe(1);
  });

  it("clips when a hard min cuts above the data (negative truncation)", () => {
    const spec = {
      ...LINE_BASE,
      yAxisPolicy: { min: -5, max: 20 },
    } as ChartSpec;
    const dipped = rows([["2020", 10], ["2021", -20], ["2022", 8]]);
    const { svg } = renderChart(spec, dipped, { width: 720, height: 400, document });
    expect(svg.querySelector('g[aria-label="line"]')!.getAttribute("clip-path")).toMatch(/^url\(#/);
  });

  it("clips on a confidence band whose bounds exceed the domain", () => {
    const spec = {
      ...LINE_BASE,
      yAxisPolicy: { min: 0, max: 20 },
      confidence_bands: [{ series: "A", lower: "lo", upper: "hi" }],
      columns: { x: "time", value: "value", series: "series" },
    } as unknown as ChartSpec;
    const banded = [
      { time: "2020", value: "10", series: "A", lo: "8", hi: "12" },
      { time: "2021", value: "12", series: "A", lo: "9", hi: "60" },
    ] as unknown as TidyRow[];
    const { svg } = renderChart(spec, banded, { width: 720, height: 400, document });
    expect(svg.querySelector('g[aria-label="area"]')!.getAttribute("clip-path")).toMatch(/^url\(#/);
  });

  it("does NOT clip when the domain covers the data (no DOM change for existing charts)", () => {
    const spec = { ...LINE_BASE, yAxisPolicy: { min: 0, max: 100 } } as ChartSpec;
    const { svg } = renderChart(spec, spiky, { width: 720, height: 400, document });
    expect(svg.querySelector('g[aria-label="line"]')!.getAttribute("clip-path")).toBeNull();
    expect(clipCount(svg)).toBe(0);
  });

  it("does NOT clip an auto-domain chart (no yAxisPolicy at all)", () => {
    const { svg } = renderChart(LINE_BASE, spiky, { width: 720, height: 400, document });
    expect(svg.querySelector('g[aria-label="line"]')!.getAttribute("clip-path")).toBeNull();
  });

  it("keeps the off-frame path geometry — the clip is geometric, not a data filter", () => {
    const spec = { ...LINE_BASE, yAxisPolicy: { min: 0, max: 20 } } as ChartSpec;
    const { svg } = renderChart(spec, spiky, { width: 720, height: 400, document });
    const d = svg.querySelector('g[aria-label="line"] path')!.getAttribute("d")!;
    // One unbroken path (no gap command) whose spike vertex is still above the frame, so the
    // rendered stroke exits and re-enters at the true axis crossings.
    expect(d).not.toMatch(/M.*M/);
    const ys = Array.from(d.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)).map((m) => Number(m[2]));
    expect(Math.min(...ys)).toBeLessThan(0);
  });

  it("still tags every path with its series through the extra clip wrapper", () => {
    const spec = {
      ...LINE_BASE,
      yAxisPolicy: { min: 0, max: 20 },
      series_order: ["A", "B"],
    } as ChartSpec;
    const { svg } = renderChart(spec, MULTI_ROWS, { width: 720, height: 400, document });
    const tagged = Array.from(svg.querySelectorAll('g[aria-label="line"] path[data-series]'));
    expect(tagged.map((p) => p.getAttribute("data-series"))).toEqual(["A", "B"]);
  });
});

// Multi-series so mountChart's line hit-paths (gated to selectable charts) are emitted.
const MULTI_ROWS: TidyRow[] = [
  ...rows([["2020", 10], ["2021", 95], ["2022", 12]], "A"),
  ...rows([["2020", 5], ["2021", 6], ["2022", 7]], "B"),
];

describe("line hit-paths inherit the clip", () => {
  const mount = (spec: ChartSpec): SVGSVGElement => {
    const container = document.createElement("div");
    mountChart(container, { spec, rows: MULTI_ROWS, width: 720 });
    return container.querySelector(".figure-canvas svg") as SVGSVGElement;
  };

  it("carries clip-path onto the root-level hover clone so there is no phantom hit zone", () => {
    const spec = {
      ...LINE_BASE,
      yAxisPolicy: { min: 0, max: 20 },
      series_order: ["A", "B"],
    } as ChartSpec;
    const svg = mount(spec);
    const clipRef = svg.querySelector('g[aria-label="line"]')!.getAttribute("clip-path");
    expect(clipRef).toMatch(/^url\(#/);
    const hits = Array.from(svg.querySelectorAll<SVGPathElement>(".tbl-line-hitpath"));
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.getAttribute("clip-path")).toBe(clipRef);
  });

  it("leaves the clone unclipped when the chart is not clipped", () => {
    const svg = mount({ ...LINE_BASE, series_order: ["A", "B"] } as ChartSpec);
    const hits = Array.from(svg.querySelectorAll<SVGPathElement>(".tbl-line-hitpath"));
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.getAttribute("clip-path")).toBeNull();
  });
});

describe("bar marks — the gate now fires in both directions", () => {
  const BAR_BASE = {
    chartType: "bar",
    title: "t",
    xAxisType: "categorical",
    columns: { x: "cat", value: "value", series: "series" },
  } as unknown as ChartSpec;

  const bars = (vals: Array<[string, number]>): TidyRow[] =>
    vals.map(([cat, value]) => ({ cat, value: String(value), series: "A" })) as unknown as TidyRow[];

  it("clips a raised floor (pre-existing behavior — bars are drawn from 0)", () => {
    const spec = { ...BAR_BASE, yAxisPolicy: { min: 40, max: 70 } } as ChartSpec;
    const { svg } = renderChart(spec, bars([["a", 50], ["b", 62]]), {
      width: 720,
      height: 400,
      document,
    });
    expect(clipCount(svg)).toBe(1);
  });

  it("clips a lowered ceiling — a bar taller than the hard max (was unclipped)", () => {
    const spec = { ...BAR_BASE, yAxisPolicy: { max: 50 } } as ChartSpec;
    const { svg } = renderChart(spec, bars([["a", 20], ["b", 90]]), {
      width: 720,
      height: 400,
      document,
    });
    expect(clipCount(svg)).toBe(1);
  });

  it("clips negative truncation — min above the most negative bar (was unclipped)", () => {
    const spec = { ...BAR_BASE, yAxisPolicy: { min: -5, max: 20 } } as ChartSpec;
    const { svg } = renderChart(spec, bars([["a", 10], ["b", -30]]), {
      width: 720,
      height: 400,
      document,
    });
    expect(clipCount(svg)).toBe(1);
  });

  it("does NOT clip an ordinary zero-baseline bar chart", () => {
    const { svg } = renderChart(BAR_BASE, bars([["a", 10], ["b", 30]]), {
      width: 720,
      height: 400,
      document,
    });
    expect(clipCount(svg)).toBe(0);
  });

  it("does NOT clip when the hard max only eats the label headroom, not the data", () => {
    // Auto-fit would ask for 30 * 1.05 = 31.5; a max of exactly 30 still contains every bar, so
    // clipping (and its extra <g>) must not kick in.
    const spec = { ...BAR_BASE, yAxisPolicy: { min: 0, max: 30 } } as ChartSpec;
    const { svg } = renderChart(spec, bars([["a", 10], ["b", 30]]), {
      width: 720,
      height: 400,
      document,
    });
    expect(clipCount(svg)).toBe(0);
  });
});

describe("waterfall marks — clipMarks is now actually set", () => {
  const WF_BASE = {
    chartType: "waterfall",
    title: "t",
    xAxisType: "categorical",
    columns: { x: "cat", value: "value", kind: "kind" },
  } as unknown as ChartSpec;

  const steps: TidyRow[] = [
    { cat: "Start", value: "100", kind: "total" },
    { cat: "Up", value: "40", kind: "delta" },
    { cat: "Down", value: "-10", kind: "delta" },
  ] as unknown as TidyRow[];

  it("clips when the cumulative path exceeds the hard max", () => {
    const spec = { ...WF_BASE, yAxisPolicy: { min: 0, max: 120 } } as ChartSpec;
    const { svg } = renderChart(spec, steps, { width: 720, height: 400, document });
    expect(clipCount(svg)).toBe(1);
  });

  it("does NOT clip when the domain covers the whole cumulative path", () => {
    const { svg } = renderChart(WF_BASE, steps, { width: 720, height: 400, document });
    expect(clipCount(svg)).toBe(0);
  });
});

describe("dumbbell marks — a fitted axis makes truncation ordinary", () => {
  // A dumbbell fits its data instead of forcing a zero baseline, so an author-set min/max is a
  // normal thing to write — which is exactly how an unclipped dot ended up ~4x beyond the canvas.
  const DB_BASE = {
    chartType: "dumbbell",
    title: "t",
    xAxisType: "categorical",
    series_order: ["Current", "Proposed"],
    columns: { category: "cat", value: "value", series: "series" },
  } as unknown as ChartSpec;

  const pairs = (vals: Array<[string, number, number]>): TidyRow[] =>
    vals.flatMap(([cat, a, b]) => [
      { cat, series: "Current", value: String(a) },
      { cat, series: "Proposed", value: String(b) },
    ]) as unknown as TidyRow[];

  const SPIKY = pairs([["A", 5, 12], ["B", 8, 85]]);

  for (const orientation of ["horizontal", "vertical"] as const) {
    it(`clips ${orientation} dots and stems when a dot exceeds the hard max`, () => {
      const spec = { ...DB_BASE, orientation, yAxisPolicy: { min: 0, max: 20 } } as ChartSpec;
      const { svg } = renderChart(spec, SPIKY, { width: 720, height: 400, document });
      expect(clipCount(svg)).toBe(1);
      // Both the dot mark and the connector stems sit inside the clip.
      expect(svg.querySelector('g[aria-label="dot"] circle')!.closest("[clip-path]")).not.toBeNull();
      expect(svg.querySelector('g[aria-label="rule"] line')).not.toBeNull();
    });
  }

  it("clips when a hard min cuts below the lowest dot", () => {
    const spec = { ...DB_BASE, yAxisPolicy: { min: 6, max: 20 } } as ChartSpec;
    const { svg } = renderChart(spec, pairs([["A", 2, 12]]), { width: 720, height: 400, document });
    expect(clipCount(svg)).toBe(1);
  });

  it("does NOT clip on the fitted auto domain (the padded extent contains every dot)", () => {
    const { svg } = renderChart(DB_BASE, SPIKY, { width: 720, height: 400, document });
    expect(clipCount(svg)).toBe(0);
  });

  it("does NOT clip when the hard domain contains every dot", () => {
    const spec = { ...DB_BASE, yAxisPolicy: { min: 0, max: 100 } } as ChartSpec;
    const { svg } = renderChart(spec, SPIKY, { width: 720, height: 400, document });
    expect(clipCount(svg)).toBe(0);
  });

  it("does NOT clip when the hard max only eats the dumbbell's breathing pad", () => {
    // computeDumbbellValueExtent pads 5% past the data, so a max at exactly the data max still
    // contains every dot and must not trigger the extra <g>.
    const spec = { ...DB_BASE, yAxisPolicy: { min: 5, max: 85 } } as ChartSpec;
    const { svg } = renderChart(spec, SPIKY, { width: 720, height: 400, document });
    expect(clipCount(svg)).toBe(0);
  });

  it("keeps the gap annotation unclipped so a label is never cut in half", () => {
    const spec = {
      ...DB_BASE,
      gap_annotation: true,
      yAxisPolicy: { min: 0, max: 20 },
    } as unknown as ChartSpec;
    const { svg } = renderChart(spec, SPIKY, { width: 720, height: 400, document });
    const texts = Array.from(svg.querySelectorAll('g[aria-label="text"]'));
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t.closest("[clip-path]")).toBeNull();
  });
});

describe("area / scatter / dotplot / histogram — the remaining types", () => {
  const spiky = rows([["2020", 10], ["2021", 95], ["2022", 12]]);

  it("area: clips when a stack top exceeds the hard max", () => {
    const spec = {
      chartType: "area",
      title: "t",
      xAxisType: "numeric",
      series_order: ["A"],
      columns: { x: "time", value: "value", series: "series" },
      yAxisPolicy: { min: 0, max: 20 },
    } as unknown as ChartSpec;
    const { svg } = renderChart(spec, spiky, { width: 720, height: 400, document });
    expect(clipCount(svg)).toBe(1);
  });

  it("area: keys the stack per x, so two series summing past the ceiling clip even when neither does", () => {
    const spec = {
      chartType: "area",
      title: "t",
      xAxisType: "numeric",
      series_order: ["A", "B"],
      columns: { x: "time", value: "value", series: "series" },
      yAxisPolicy: { min: 0, max: 20 },
    } as unknown as ChartSpec;
    // Each series peaks at 12 (inside the 20 ceiling); the stack reaches 24 (outside it).
    const data = [
      ...rows([["2020", 12], ["2021", 12]], "A"),
      ...rows([["2020", 12], ["2021", 12]], "B"),
    ];
    const { svg } = renderChart(spec, data, { width: 720, height: 400, document });
    expect(clipCount(svg)).toBe(1);
  });

  it("area: does NOT clip when the domain covers the stacked total", () => {
    const spec = {
      chartType: "area",
      title: "t",
      xAxisType: "numeric",
      series_order: ["A"],
      columns: { x: "time", value: "value", series: "series" },
      yAxisPolicy: { min: 0, max: 200 },
    } as unknown as ChartSpec;
    const { svg } = renderChart(spec, spiky, { width: 720, height: 400, document });
    expect(clipCount(svg)).toBe(0);
  });

  for (const chartType of ["scatter", "dotplot"] as const) {
    it(`${chartType}: clips an out-of-range point`, () => {
      const spec = {
        chartType,
        title: "t",
        xAxisType: chartType === "dotplot" ? "categorical" : "numeric",
        series_order: ["A"],
        columns: {
          x: chartType === "dotplot" ? "cat" : "time",
          value: "value",
          series: "series",
        },
        yAxisPolicy: { min: 0, max: 20 },
      } as unknown as ChartSpec;
      const data =
        chartType === "dotplot"
          ? ([
              { cat: "x", value: "10", series: "A" },
              { cat: "y", value: "95", series: "A" },
            ] as unknown as TidyRow[])
          : spiky;
      const { svg } = renderChart(spec, data, { width: 720, height: 400, document });
      expect(clipCount(svg)).toBe(1);
    });

    it(`${chartType}: does NOT clip when every point fits`, () => {
      const spec = {
        chartType,
        title: "t",
        xAxisType: chartType === "dotplot" ? "categorical" : "numeric",
        series_order: ["A"],
        columns: {
          x: chartType === "dotplot" ? "cat" : "time",
          value: "value",
          series: "series",
        },
        yAxisPolicy: { min: 0, max: 200 },
      } as unknown as ChartSpec;
      const data =
        chartType === "dotplot"
          ? ([
              { cat: "x", value: "10", series: "A" },
              { cat: "y", value: "95", series: "A" },
            ] as unknown as TidyRow[])
          : spiky;
      const { svg } = renderChart(spec, data, { width: 720, height: 400, document });
      expect(clipCount(svg)).toBe(0);
    });
  }

  it("histogram: clips when a hard min above zero would push bars below the frame", () => {
    const spec = {
      chartType: "histogram",
      title: "t",
      xAxisType: "numeric",
      columns: { x: "amount" },
      histogram: { bins: 4 },
      yAxisPolicy: { min: 1, max: 6 },
    } as unknown as ChartSpec;
    const data = [1, 1, 2, 2, 2, 3, 4, 4, 5, 5, 5, 5].map((n) => ({
      amount: String(n),
    })) as unknown as TidyRow[];
    const { svg } = renderChart(spec, data, { width: 720, height: 400, document });
    expect(clipCount(svg)).toBe(1);
  });

  it("histogram: does NOT clip on the default zero-baseline axis", () => {
    const spec = {
      chartType: "histogram",
      title: "t",
      xAxisType: "numeric",
      columns: { x: "amount" },
      histogram: { bins: 4 },
    } as unknown as ChartSpec;
    const data = [1, 1, 2, 2, 2, 3, 4, 4, 5].map((n) => ({
      amount: String(n),
    })) as unknown as TidyRow[];
    const { svg } = renderChart(spec, data, { width: 720, height: 400, document });
    expect(clipCount(svg)).toBe(0);
  });
});

describe("computeDrawnValueExtent", () => {
  const prep = (ys: number[]): PreparedRow[] =>
    ys.map((y, i) => ({ series: "A", _y: y, _xc: `c${i}` })) as unknown as PreparedRow[];

  it("line: the raw value extent, with no zero baseline and no padding", () => {
    expect(computeDrawnValueExtent(prep([12, 30, 21]), {} as ChartSpec, "line")).toEqual({
      min: 12,
      max: 30,
    });
  });

  it("line: folds confidence-band bounds in", () => {
    const withBand = [
      { series: "A", _y: 10, _lo: 2, _hi: 44 },
    ] as unknown as PreparedRow[];
    expect(computeDrawnValueExtent(withBand, {} as ChartSpec, "line")).toEqual({ min: 2, max: 44 });
  });

  it("bar: always includes zero, because every bar is drawn from it", () => {
    expect(computeDrawnValueExtent(prep([12, 30]), {} as ChartSpec, "bar")).toEqual({
      min: 0,
      max: 30,
    });
  });

  it("bar: no headroom factor (unlike computeBarYExtent)", () => {
    expect(computeDrawnValueExtent(prep([30]), {} as ChartSpec, "bar")!.max).toBe(30);
  });

  it("stacked: per-category cumulative tops, not raw values", () => {
    const stack = [
      { series: "A", _y: 10, _xc: "a" },
      { series: "B", _y: 15, _xc: "a" },
      { series: "A", _y: 4, _xc: "b" },
    ] as unknown as PreparedRow[];
    expect(computeDrawnValueExtent(stack, {} as ChartSpec, "stacked")).toEqual({ min: 0, max: 25 });
  });

  it("stacked: 100%-normalized is always 0–100", () => {
    expect(
      computeDrawnValueExtent(prep([3, 7]), { barStack: { normalize: true } } as ChartSpec, "stacked"),
    ).toEqual({ min: 0, max: 100 });
  });

  it("waterfall: spans the cumulative path, not the deltas", () => {
    const wf = [
      { _xc: "Start", _y: 100, _kind: "total" },
      { _xc: "Up", _y: 40, _kind: "delta" },
    ] as unknown as PreparedRow[];
    expect(computeDrawnValueExtent(wf, {} as ChartSpec, "waterfall")).toEqual({ min: 0, max: 140 });
  });

  it("dumbbell: raw dot positions, with neither zero nor the breathing pad", () => {
    expect(computeDrawnValueExtent(prep([12, 30]), {} as ChartSpec, "dumbbell")).toEqual({
      min: 12,
      max: 30,
    });
  });

  it("scatter / dotplot: raw positions, like a line", () => {
    for (const t of ["scatter", "dotplot"] as const) {
      expect(computeDrawnValueExtent(prep([12, 30]), {} as ChartSpec, t)).toEqual({
        min: 12,
        max: 30,
      });
    }
  });

  it("histogram: bin heights from zero", () => {
    expect(computeDrawnValueExtent(prep([3, 8]), {} as ChartSpec, "histogram")).toEqual({
      min: 0,
      max: 8,
    });
  });

  it("area: cumulative stack tops keyed per x, not raw values", () => {
    const stack = [
      { series: "A", _y: 10, _xn: 2020, time: "2020" },
      { series: "B", _y: 15, _xn: 2020, time: "2020" },
      { series: "A", _y: 4, _xn: 2021, time: "2021" },
    ] as unknown as PreparedRow[];
    expect(computeDrawnValueExtent(stack, {} as ChartSpec, "area")).toEqual({ min: 0, max: 25 });
  });

  it("covers every chart type — none silently opts out of clipping", () => {
    const ALL = [
      "line",
      "area",
      "bar",
      "stacked",
      "scatter",
      "dotplot",
      "waterfall",
      "histogram",
      "dumbbell",
    ] as const;
    for (const t of ALL) {
      expect(computeDrawnValueExtent(prep([1, 2]), {} as ChartSpec, t), t).not.toBeNull();
    }
  });

  it("returns null when there is nothing finite to paint", () => {
    expect(computeDrawnValueExtent([], {} as ChartSpec, "line")).toBeNull();
    expect(computeDrawnValueExtent([], {} as ChartSpec, "bar")).toBeNull();
  });
});
