// @vitest-environment jsdom
//
// Ruling 78. On a horizontal bar, stack or dumbbell (a dumbbell with `orientation` omitted included)
// the value axis is x, so a value-axis reference line is an `annotations.xAxis` marker. An
// `annotations.yAxis` marker there is drawn with Plot.ruleY against the CATEGORICAL y scale, so it
// draws nothing — yet it used to be folded into the value domain, widening the axis for a line
// nobody sees. Validation rejects it, pointing at annotations.xAxis; renderChart (unvalidated) no
// longer folds it.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { renderPane, renderChart } from "../src/engine/index";
import { buildExportSvg } from "../src/embed/export-png";
import { domainBounds } from "../src/engine/scales";
import { validateSpec } from "../src/spec/validate";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const OPTS = { width: 720, height: 400, document } as const;
const r = (o: Record<string, string | number>): TidyRow =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) as unknown as TidyRow;

// Values 10 and 15 on every type, under `max: 20`.
const CASES: Record<string, { spec: Record<string, unknown>; rows: TidyRow[] }> = {
  bar: {
    spec: { chartType: "bar", orientation: "horizontal", columns: { x: "c", value: "v" } },
    rows: [r({ c: "a", v: 10 }), r({ c: "b", v: 15 })],
  },
  stacked: {
    spec: { chartType: "stacked", orientation: "horizontal", columns: { x: "c", value: "v", series: "s" } },
    rows: [r({ c: "a", s: "A", v: 10 }), r({ c: "b", s: "A", v: 15 })],
  },
  dumbbell: {
    spec: { chartType: "dumbbell", orientation: "horizontal", columns: { category: "c", value: "v", series: "s" } },
    rows: [r({ c: "a", s: "A", v: 10 }), r({ c: "a", s: "B", v: 15 })],
  },
  // A dumbbell is horizontal unless it says vertical (isHorizontalDumbbell).
  "dumbbell (orientation omitted)": {
    spec: { chartType: "dumbbell", columns: { category: "c", value: "v", series: "s" } },
    rows: [r({ c: "a", s: "A", v: 10 }), r({ c: "a", s: "B", v: 15 })],
  },
};
const specOf = (name: string, extra: Record<string, unknown> = {}): ChartSpec =>
  ({ title: "t", xAxisType: "categorical", data: "d.csv", ...CASES[name]!.spec, ...extra }) as unknown as ChartSpec;
const Y_MARKER = { annotations: { yAxis: [{ y: 40, label: "m" }] } };

describe("validation rejects annotations.yAxis on a horizontal chart, pointing at annotations.xAxis", () => {
  for (const name of Object.keys(CASES)) {
    it(name, () => {
      const res = validateSpec(specOf(name, Y_MARKER));
      expect(res.valid).toBe(false);
      expect(res.errors).toHaveLength(1);
      expect(res.errors[0]).toMatch(/annotations\.yAxis/);
      expect(res.errors[0]).toMatch(/horizontal/);
      expect(res.errors[0]).toMatch(/annotations\.xAxis/);
    });
  }

  it("names the legacy yAxisPolicy.markers when that is what the author wrote", () => {
    const res = validateSpec(specOf("bar", { yAxisPolicy: { markers: [{ y: 40 }] } }));
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toMatch(/yAxisPolicy\.markers/);
    expect(res.errors[0]).toMatch(/annotations\.xAxis/);
  });

  it("still accepts annotations.xAxis there, an empty yAxis list, and yAxis on vertical charts", () => {
    for (const name of Object.keys(CASES)) {
      expect(validateSpec(specOf(name, { annotations: { xAxis: [{ x: "40", label: "m" }] } })).errors, name).toEqual([]);
      expect(validateSpec(specOf(name, { annotations: { yAxis: [] } })).errors, name).toEqual([]);
    }
    for (const name of ["bar", "stacked", "dumbbell"]) {
      expect(validateSpec(specOf(name, { orientation: "vertical", ...Y_MARKER })).errors, name).toEqual([]);
    }
  });
});

describe("renderChart (unvalidated) does not fold an undrawn yAxis marker into the value domain", () => {
  const realGetContext = HTMLCanvasElement.prototype.getContext;
  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
  });
  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = realGetContext;
  });

  /** Every number the SVG prints, sorted: the value-axis ticks (unclassed on a single horizontal
   *  chart) plus any value labels. A marker that widened the axis adds ticks up to 40. */
  const xTickEnds = (svg: Element): number[] =>
    Array.from(svg.querySelectorAll("text"))
      .map((t) => (t.textContent ?? "").trim())
      .filter((s) => /^-?[0-9.]+$/.test(s))
      .map(Number)
      .sort((a, b) => a - b);
  const markerLines = (svg: Element) => svg.querySelectorAll('g[class^="tbl-annotation-line"] line').length;

  for (const name of Object.keys(CASES)) {
    it(`${name}: the domain is the one without the marker, live and in the PNG`, () => {
      const policy = { yAxisPolicy: { max: 20 } };
      const bare = specOf(name, policy);
      const marked = specOf(name, { ...policy, ...Y_MARKER });
      const rows = CASES[name]!.rows;
      const want = domainBounds(renderPane(bare, rows, OPTS).yDomain);
      expect(want[1]).toBe(20);
      expect(domainBounds(renderPane(marked, rows, OPTS).yDomain)).toEqual(want);
      // Drawn: the same value-axis ticks as without it, and still no marker line.
      const live = renderChart(marked, rows, OPTS).svg;
      expect(Math.max(...xTickEnds(live))).toBeLessThan(40);
      expect(xTickEnds(live)).toEqual(xTickEnds(renderChart(bare, rows, OPTS).svg));
      expect(markerLines(live)).toBe(0);
      const png = buildExportSvg(marked, rows);
      expect(Math.max(...xTickEnds(png))).toBeLessThan(40);
      expect(xTickEnds(png)).toEqual(xTickEnds(buildExportSvg(bare, rows)));
      expect(markerLines(png)).toBe(0);
    });
  }

  it("facets drawn as groups: a facet-scoped yAxis marker does not widen the axis", () => {
    const chart = (extra: Record<string, unknown>) =>
      renderChart(
        specOf("bar", {
          columns: { x: "c", value: "v", facet: "f" },
          yAxisPolicy: { max: 20 },
          small_multiples: { mode: "shared" },
          ...extra,
        }),
        [r({ f: "A", c: "a", v: 10 }), r({ f: "A", c: "b", v: 15 }), r({ f: "B", c: "a", v: 12 }), r({ f: "B", c: "b", v: 14 })],
        OPTS,
      );
    const bare = chart({});
    const marked = chart({ annotations: { yAxis: [{ y: 40, label: "m", facet: "B" }] } });
    expect(xTickEnds(marked.svg)).toEqual(xTickEnds(bare.svg));
  });

  it("a horizontal chart's annotations.xAxis marker still raises the ceiling (bar, stacked, dumbbell)", () => {
    for (const name of Object.keys(CASES)) {
      const spec = specOf(name, { yAxisPolicy: { max: 20 }, annotations: { xAxis: [{ x: 40, label: "m" }] } });
      expect(domainBounds(renderPane(spec, CASES[name]!.rows, OPTS).yDomain)[1], name).toBe(40);
    }
  });
});

describe("renderChart (unvalidated) keys no legend row for an undrawn yAxis marker", () => {
  const realGetContext = HTMLCanvasElement.prototype.getContext;
  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
  });
  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = realGetContext;
  });

  const KEYED = "keyedmark";
  const labels = (items: { label: string }[] | null) => (items ?? []).map((i) => i.label);
  const pngHas = (spec: ChartSpec, rows: TidyRow[]) =>
    Array.from(buildExportSvg(spec, rows).querySelectorAll("text")).some((t) => t.textContent === KEYED);

  for (const name of Object.keys(CASES)) {
    for (const [how, extra] of [
      ["annotations.yAxis", { annotations: { yAxis: [{ y: 12, label: KEYED, legend: true }] } }],
      ["yAxisPolicy.markers", { yAxisPolicy: { markers: [{ y: 12, label: KEYED, legend: true }] } }],
    ] as const) {
      it(`${name}, ${how}: no row live, none in the PNG, no dangling data-annotation`, () => {
        const spec = specOf(name, extra);
        const rows = CASES[name]!.rows;
        const live = renderChart(spec, rows, OPTS);
        expect(labels(live.legendItems)).not.toContain(KEYED);
        expect(live.svg.querySelector("[data-annotation]")).toBeNull();
        expect(pngHas(spec, rows)).toBe(false);
      });
    }
  }

  it("contrast: the same keyed marker keys a row on a vertical chart, and a keyed xAxis one on a horizontal chart", () => {
    for (const name of ["bar", "stacked", "dumbbell"]) {
      const spec = specOf(name, {
        orientation: "vertical",
        annotations: { yAxis: [{ y: 12, label: KEYED, legend: true }] },
      });
      const rows = CASES[name]!.rows;
      expect(labels(renderChart(spec, rows, OPTS).legendItems), name).toContain(KEYED);
      expect(pngHas(spec, rows), name).toBe(true);
    }
    for (const name of Object.keys(CASES)) {
      const spec = specOf(name, { annotations: { xAxis: [{ x: "12", label: KEYED, legend: true }] } });
      const rows = CASES[name]!.rows;
      expect(labels(renderChart(spec, rows, OPTS).legendItems), name).toContain(KEYED);
      expect(pngHas(spec, rows), name).toBe(true);
    }
  });
});

describe("CONFIG-SPEC annotations.xAxis row: a numeric xAxis marker draws a vertical rule on every horizontal type", () => {
  const realGetContext = HTMLCanvasElement.prototype.getContext;
  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
  });
  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = realGetContext;
  });

  /** Vertical rules in a dashed group: the marker's default `style: dashed`. */
  const vRules = (svg: Element) =>
    Array.from(svg.querySelectorAll("g[stroke-dasharray] line")).filter(
      (l) => l.getAttribute("x1") != null && l.getAttribute("x1") === l.getAttribute("x2"),
    ).length;
  const hasText = (svg: Element, s: string) => Array.from(svg.querySelectorAll("text")).some((t) => t.textContent === s);

  for (const name of Object.keys(CASES)) {
    it(`${name}: drawn live and in the PNG; a non-numeric x draws nothing`, () => {
      const rows = CASES[name]!.rows;
      const bare = specOf(name);
      const marked = specOf(name, { annotations: { xAxis: [{ x: "12", label: "xm" }] } });
      const junk = specOf(name, { annotations: { xAxis: [{ x: "twelve", label: "xm" }] } });
      for (const render of [(s: ChartSpec) => renderChart(s, rows, OPTS).svg, (s: ChartSpec) => buildExportSvg(s, rows)]) {
        expect(vRules(render(bare))).toBe(0);
        expect(vRules(render(marked))).toBe(1);
        expect(hasText(render(marked), "xm")).toBe(true);
        expect(vRules(render(junk))).toBe(0);
        expect(hasText(render(junk), "xm")).toBe(false);
      }
    });
  }
});
