// @vitest-environment jsdom
//
// CONFIG-SPEC calls `yAxisPolicy.min` a "Hard floor" and `max` a "Hard ceiling", with no "both
// required" qualifier. A LONE bound (the other left unset) must therefore pin its own end on every
// chart type that has a value axis, while the open end stays fitted exactly as it is without a pin.
// Line, scatter, dotplot and histogram used to drop a lone bound on the floor: resolveHardDomain
// had no fitted extent for the open end there, so it returned null and the axis auto-fitted.
//
// Pins are chosen as multiples of the tick step the resulting span gets, so the outward nice
// leaves them where they were written and the assertion can be exact.
import { describe, it, expect } from "vitest";
import { renderPane, renderChart, renderFigure } from "../src/engine/index";
import { domainBounds } from "../src/engine/scales";
import { validateSpec } from "../src/spec/validate";
import { TBL } from "../src/engine/theme";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const OPTS = { width: 720, height: 400, document } as const;

interface Case {
  spec: ChartSpec;
  rows: TidyRow[];
}

const r = (o: Record<string, string | number>): TidyRow =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) as unknown as TidyRow;

// Every case's drawn data spans 8–31 on the value axis (the bar-like types also reach down to 0,
// which they always include).
const CASES: Record<string, Case> = {
  line: {
    spec: { chartType: "line", title: "t", xAxisType: "numeric", columns: { x: "t", value: "v" } } as unknown as ChartSpec,
    rows: [r({ t: 2020, v: 8 }), r({ t: 2021, v: 15 }), r({ t: 2022, v: 31 })],
  },
  scatter: {
    spec: { chartType: "scatter", title: "t", xAxisType: "numeric", columns: { x: "t", value: "v" } } as unknown as ChartSpec,
    rows: [r({ t: 1, v: 8 }), r({ t: 2, v: 15 }), r({ t: 3, v: 31 })],
  },
  dotplot: {
    spec: { chartType: "dotplot", title: "t", xAxisType: "categorical", columns: { x: "c", value: "v", series: "s" } } as unknown as ChartSpec,
    rows: [r({ c: "a", s: "A", v: 8 }), r({ c: "b", s: "A", v: 15 }), r({ c: "b", s: "B", v: 31 })],
  },
  bar: {
    spec: { chartType: "bar", title: "t", xAxisType: "categorical", columns: { x: "c", value: "v" } } as unknown as ChartSpec,
    rows: [r({ c: "a", v: 8 }), r({ c: "b", v: 31 })],
  },
  stacked: {
    spec: { chartType: "stacked", title: "t", xAxisType: "categorical", columns: { x: "c", value: "v", series: "s" } } as unknown as ChartSpec,
    rows: [r({ c: "a", s: "A", v: 8 }), r({ c: "b", s: "A", v: 20 }), r({ c: "b", s: "B", v: 11 })],
  },
  area: {
    spec: { chartType: "area", title: "t", xAxisType: "numeric", columns: { x: "t", value: "v", series: "s" } } as unknown as ChartSpec,
    rows: [r({ t: 2020, s: "A", v: 8 }), r({ t: 2021, s: "A", v: 20 }), r({ t: 2021, s: "B", v: 11 })],
  },
  waterfall: {
    spec: { chartType: "waterfall", title: "t", xAxisType: "categorical", columns: { x: "c", value: "v", kind: "k" } } as unknown as ChartSpec,
    rows: [r({ c: "Start", v: 8, k: "total" }), r({ c: "Up", v: 23, k: "delta" })],
  },
  histogram: {
    spec: { chartType: "histogram", title: "t", xAxisType: "numeric", columns: { x0: "lo", x1: "hi", value: "n" } } as unknown as ChartSpec,
    rows: [r({ lo: 0, hi: 5, n: 8 }), r({ lo: 5, hi: 10, n: 31 })],
  },
  dumbbell: {
    spec: {
      chartType: "dumbbell", title: "t", xAxisType: "categorical", series_order: ["A", "B"],
      columns: { category: "c", value: "v", series: "s" },
    } as unknown as ChartSpec,
    rows: [r({ c: "a", s: "A", v: 8 }), r({ c: "a", s: "B", v: 15 }), r({ c: "b", s: "A", v: 12 }), r({ c: "b", s: "B", v: 31 })],
  },
};

const domainOf = (c: Case, yAxisPolicy?: Record<string, unknown>): [number, number] =>
  domainBounds(renderPane({ ...c.spec, ...(yAxisPolicy ? { yAxisPolicy } : {}) } as ChartSpec, c.rows, OPTS).yDomain);

describe("a lone yAxisPolicy.min / max pins its own end on every value-axis chart type", () => {
  for (const [type, c] of Object.entries(CASES)) {
    describe(type, () => {
      // The open end is fitted, not pinned: it covers the data, within one nice step (at most 10
      // for these spans) of it, and no lower than the unpinned axis' own floor.
      const free = () => domainOf(c);

      it("min below the data (extends the floor): pinned, ceiling still covers the data", () => {
        const [lo, hi] = domainOf(c, { min: -10 });
        expect(lo).toBe(-10);
        expect(hi).toBeGreaterThanOrEqual(31);
        expect(hi).toBeLessThanOrEqual(40);
      });

      it("min inside the data (truncates the floor): pinned, ceiling still covers the data", () => {
        const [lo, hi] = domainOf(c, { min: 20 });
        expect(lo).toBe(20);
        expect(hi).toBeGreaterThanOrEqual(31);
        expect(hi).toBeLessThanOrEqual(40);
      });

      it("max above the data (extends the ceiling): pinned, floor still fitted", () => {
        const [lo, hi] = domainOf(c, { max: 50 });
        expect(hi).toBe(50);
        expect(lo).toBeLessThanOrEqual(8);
        expect(lo).toBeGreaterThanOrEqual(Math.min(0, free()[0]));
      });

      it("max inside the data (truncates the ceiling): pinned, floor still fitted", () => {
        const [lo, hi] = domainOf(c, { max: 20 });
        expect(hi).toBe(20);
        expect(lo).toBeLessThanOrEqual(8);
        expect(lo).toBeGreaterThanOrEqual(Math.min(0, free()[0]));
      });
    });
  }

  it("a lone max leaves bars, stacks, areas, waterfalls and histograms growing from 0", () => {
    for (const type of ["bar", "stacked", "area", "waterfall", "histogram"]) {
      expect(domainOf(CASES[type]!, { max: 50 }), type).toEqual([0, 50]);
      expect(domainOf(CASES[type]!, { max: 20 }), type).toEqual([0, 20]);
    }
  });

  it("timeline and treemap have no value axis and reject yAxisPolicy outright", () => {
    for (const chartType of ["timeline", "treemap"]) {
      const errors = validateSpec({ chartType, title: "t", xAxisType: "categorical", data: "d.csv", yAxisPolicy: { min: 0 } }).errors;
      expect(errors.join("\n")).toContain(`yAxisPolicy is not supported on chartType "${chartType}"`);
    }
  });
});

describe("a lone bound on a fitted (line) axis — exact domains and composition", () => {
  const line = CASES.line!;

  it("the open end is nice'd as it is without a pin", () => {
    expect(domainOf(line)).toEqual([5, 35]);
    expect(domainOf(line, { max: 50 })).toEqual([0, 50]);
    expect(domainOf(line, { min: 20 })).toEqual([20, 32]);
  });

  it("autoWiden now applies to a lone max (it read `max` but the max itself was dropped)", () => {
    expect(domainOf(line, { max: 20, autoWiden: { step: 25 } })).toEqual([0, 50]);
  });

  it("includeZero extends the OPEN end to 0; a pinned end stays where it was written", () => {
    expect(domainOf(line, { max: 50, includeZero: true })).toEqual([0, 50]);
    expect(domainOf(line, { min: 20, includeZero: true })).toEqual([20, 32]);
    const neg: Case = { ...line, rows: [r({ t: 2020, v: -8 }), r({ t: 2021, v: -31 })] };
    expect(domainOf(neg, { min: -40, includeZero: true })).toEqual([-40, 0]);
    expect(domainOf(neg, { min: -40 })).toEqual([-40, -5]);
    // Both ends pinned: nothing is left open, so includeZero has no effect.
    expect(domainOf(line, { min: 10, max: 40, includeZero: true })).toEqual([10, 40]);
  });

  it("small multiples, shared and per-pane: every pane takes the lone ceiling", () => {
    const spec = {
      ...line.spec, columns: { x: "t", value: "v", facet: "f" }, yAxisPolicy: { max: 50 },
    } as unknown as ChartSpec;
    const rows = [
      r({ f: "A", t: 2020, v: 8 }), r({ f: "A", t: 2021, v: 15 }),
      r({ f: "B", t: 2020, v: 12 }), r({ f: "B", t: 2021, v: 31 }),
    ];
    for (const mode of ["shared", "per-pane"]) {
      const fig = renderFigure({ ...spec, small_multiples: { columns: 2, mode } } as ChartSpec, rows, OPTS);
      expect(fig.panes).toHaveLength(2);
      // Shared mode drops the y-tick labels from every column but the first; its one domain is
      // the union of the per-pane probes, each of which must already carry the pin.
      for (const p of mode === "shared" ? fig.panes.slice(0, 1) : fig.panes) {
        const texts = Array.from(p.svg!.querySelectorAll("text")).map((n) => (n.textContent ?? "").trim());
        expect(texts, `${mode} ${p.value}`).toContain("50");
      }
    }
  });

  it("reaches the drawn chart: a lone max clips a line that crosses it", () => {
    const { svg } = renderChart({ ...line.spec, yAxisPolicy: { max: 20 } } as ChartSpec, line.rows, OPTS);
    expect(svg.querySelectorAll("clipPath").length).toBe(1);
  });
});

describe("horizontal bar truncated with yAxisPolicy.min", () => {
  it("draws no zero rule when the pinned floor puts 0 outside the value domain", () => {
    const spec = {
      chartType: "bar", title: "t", xAxisType: "categorical", orientation: "horizontal",
      columns: { x: "c", value: "v" }, data: "d.csv", yAxisPolicy: { min: 5 },
    } as unknown as ChartSpec;
    const rows = [r({ c: "a", v: 8 }), r({ c: "b", v: 31 })];
    const zeroRules = (svg: SVGSVGElement) =>
      Array.from(svg.querySelectorAll('g[aria-label="rule"]')).filter((g) => g.getAttribute("stroke") === TBL.color.axisStroke);
    // Sanity: the same chart without the pin does draw its zero rule.
    const { yAxisPolicy: _drop, ...unpinned } = spec;
    expect(zeroRules(renderChart(unpinned as ChartSpec, rows, OPTS).svg)).toHaveLength(1);
    expect(zeroRules(renderChart(spec, rows, OPTS).svg)).toHaveLength(0);
  });
});
