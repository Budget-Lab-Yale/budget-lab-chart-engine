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

// Ruling 69: CONFIG-SPEC says "min alone, or max alone, is read as ascending". A lone bound past ALL
// of the data used to come out reversed (line min: 50 on 8–31 rendered [50, 30]; bar max: -5 rendered
// [0, -5]), because resolveHardDomain put the pin on one end and the data's far extent on the other.
// Now the pinned end stays at the bound and, when the data leave nothing on the open side, the open
// end sits ONE TICK STEP past it: d3's tick step (at tickCount) across the span from the data's
// fitted extent to the bound. For data 8–31 (0 to about 33 on the bar-like types) and a bound of 50
// or -10, that span gives a step of 10 on every type.
const yTickValues = (svg: SVGSVGElement): Array<{ v: number; y: number }> =>
  Array.from(svg.querySelectorAll("g.tbl-y-tick-label text")).map((t) => ({
    v: parseFloat((t.textContent ?? "").replace(/[^0-9.-]/g, "")),
    y: parseFloat(/translate\([^,]+,([^)]+)\)/.exec(t.getAttribute("transform") ?? "")?.[1] ?? "NaN"),
  }));
/** The tick labels run upward as their values grow (an ascending axis, read off the drawn SVG);
 *  returns their values, lowest first. */
const ascendingTicks = (svg: SVGSVGElement): number[] => {
  const ticks = yTickValues(svg).sort((a, b) => a.v - b.v);
  expect(ticks.length).toBeGreaterThan(1);
  for (let i = 1; i < ticks.length; i++) expect(ticks[i]!.y).toBeLessThan(ticks[i - 1]!.y);
  return ticks.map((t) => t.v);
};

describe("Ruling 69: a lone bound past all of the data still gives an ascending axis", () => {
  for (const [type, c] of Object.entries(CASES)) {
    it(`${type}: min above the data pins the floor; the ceiling is one tick step above it`, () => {
      expect(domainOf(c, { min: 50 })).toEqual([50, 60]);
    });
    it(`${type}: max below the data pins the ceiling; the floor is one tick step below it`, () => {
      expect(domainOf(c, { max: -10 })).toEqual([-20, -10]);
    });
  }

  it("the brief's examples: line min 50 and max 2, bar max -5 (nice still rounds outward)", () => {
    expect(domainOf(CASES.line!, { min: 50 })).toEqual([50, 60]);
    expect(domainOf(CASES.line!, { max: 2 })).toEqual([-3, 2]);
    // [-15, -5] before nice; its 2-wide ticks round the pinned -5 out to -4, as for any bound.
    expect(domainOf(CASES.bar!, { max: -5 })).toEqual([-16, -4]);
  });

  it("the 0 base reaches the open end only when 0 is on the open side of the pin", () => {
    const negBar: Case = { ...CASES.bar!, rows: [r({ c: "a", v: -8 }), r({ c: "b", v: -20 })] };
    // 0 above a lone min: the bars hang from 0, which is the ceiling.
    expect(domainOf(negBar, { min: -40 })).toEqual([-40, 0]);
    // 0 below a lone min of 5: neither 0 nor the data is above it, so the ceiling is one step up.
    expect(domainOf(negBar, { min: 5 })).toEqual([5, 10]);
    // 0 below a lone max of 5 on positive bars: the floor is 0 and the bars are clipped at 5.
    expect(domainOf(CASES.bar!, { max: 5 })).toEqual([0, 5]);
  });

  it("every value exactly on the bound: the span is empty, so the step is 1", () => {
    const flat: Case = { ...CASES.line!, rows: [r({ t: 2020, v: 7 }), r({ t: 2021, v: 7 })] };
    expect(domainOf(flat, { min: 7 })).toEqual([7, 8]);
    expect(domainOf(flat, { max: 7 })).toEqual([6, 7]);
    // Positive bars under a lone max of 0: their 0 base sits on the bound, so nothing is below it.
    expect(domainOf(CASES.bar!, { max: 0 })).toEqual([-5, 0]);
  });

  it("an axis the data keep ascending is unchanged (the step rule never fires)", () => {
    expect(domainOf(CASES.line!, { min: 20 })).toEqual([20, 32]);
    expect(domainOf(CASES.line!, { max: 50 })).toEqual([0, 50]);
    expect(domainOf(CASES.bar!, { max: 50 })).toEqual([0, 50]);
  });

  it("small multiples, per-pane: a bar pane whose data lie below a lone min still ascends", () => {
    const spec = {
      ...CASES.bar!.spec, columns: { x: "c", value: "v", facet: "f" }, yAxisPolicy: { min: 50 },
      small_multiples: { columns: 2, mode: "per-pane" },
    } as unknown as ChartSpec;
    const rows = [
      r({ f: "A", c: "a", v: 8 }), r({ f: "A", c: "b", v: 31 }),
      r({ f: "B", c: "a", v: 60 }), r({ f: "B", c: "b", v: 80 }),
    ];
    const [a, b] = renderFigure(spec, rows, OPTS).panes.map((p) => ascendingTicks(p.svg!));
    expect([a![0], a![a!.length - 1]]).toEqual([50, 60]);
    expect([b![0], b![b!.length - 1]]).toEqual([50, 85]);
  });

  it("small multiples, shared: every pane's data below a lone min still ascends", () => {
    const spec = {
      ...CASES.line!.spec, columns: { x: "t", value: "v", facet: "f" }, yAxisPolicy: { min: 50 },
      small_multiples: { columns: 2, mode: "shared" },
    } as unknown as ChartSpec;
    const rows = [
      r({ f: "A", t: 2020, v: 8 }), r({ f: "A", t: 2021, v: 15 }),
      r({ f: "B", t: 2020, v: 12 }), r({ f: "B", t: 2021, v: 31 }),
    ];
    const ticks = ascendingTicks(renderFigure(spec, rows, OPTS).panes[0]!.svg!);
    expect([ticks[0], ticks[ticks.length - 1]]).toEqual([50, 60]);
  });
});

describe("Ruling 70: an area's value axis includes its 0 baseline", () => {
  const negArea: Case = {
    ...CASES.area!,
    rows: [r({ t: 2020, s: "A", v: -8 }), r({ t: 2021, s: "A", v: -20 }), r({ t: 2021, s: "B", v: -11 })],
  };

  it("an all-negative area's ceiling is 0, with or without includeZero", () => {
    expect(domainOf(negArea)[1]).toBe(0);
    expect(domainOf(negArea, { includeZero: true })[1]).toBe(0);
  });

  it("CONFIG-SPEC's min row: a lone min under all-negative bars, stacks, areas and waterfalls fits the ceiling up to 0", () => {
    const cases: Record<string, Case> = {
      bar: { ...CASES.bar!, rows: [r({ c: "a", v: -8 }), r({ c: "b", v: -31 })] },
      stacked: { ...CASES.stacked!, rows: [r({ c: "a", s: "A", v: -8 }), r({ c: "b", s: "A", v: -20 }), r({ c: "b", s: "B", v: -11 })] },
      area: negArea,
      waterfall: { ...CASES.waterfall!, rows: [r({ c: "Start", v: -8, k: "total" }), r({ c: "Down", v: -23, k: "delta" })] },
    };
    for (const [type, c] of Object.entries(cases)) expect(domainOf(c, { min: -40 }), type).toEqual([-40, 0]);
  });

  it("includeZero extends the open end to 0 on line, scatter, dot plot, dumbbell and area", () => {
    const neg = (c: Case, rows: TidyRow[]): Case => ({ ...c, rows });
    const cases: Record<string, Case> = {
      line: neg(CASES.line!, [r({ t: 2020, v: -8 }), r({ t: 2021, v: -31 })]),
      scatter: neg(CASES.scatter!, [r({ t: 1, v: -8 }), r({ t: 2, v: -31 })]),
      dotplot: neg(CASES.dotplot!, [r({ c: "a", s: "A", v: -8 }), r({ c: "b", s: "A", v: -31 })]),
      dumbbell: neg(CASES.dumbbell!, [r({ c: "a", s: "A", v: -8 }), r({ c: "a", s: "B", v: -31 })]),
      area: negArea,
    };
    for (const [type, c] of Object.entries(cases)) {
      expect(domainOf(c, { min: -40, includeZero: true }), type).toEqual([-40, 0]);
    }
  });
});

describe("yAxisPolicy.autoWiden acts on line, scatter and dot plot only", () => {
  it("widens a lone max the data overflow on those types, and nowhere else", () => {
    for (const type of ["line", "scatter", "dotplot"]) {
      expect(domainOf(CASES[type]!, { max: 20, autoWiden: { step: 25 } })[1], type).toBe(50);
    }
    for (const type of ["bar", "stacked", "area", "waterfall", "histogram", "dumbbell"]) {
      expect(domainOf(CASES[type]!, { max: 20, autoWiden: { step: 25 } })[1], type).toBe(20);
    }
  });
});

describe("lone-bound coverage: histogram clipping, non-line small multiples", () => {
  const hist = CASES.histogram!;
  const clips = (policy?: Record<string, unknown>) =>
    renderChart({ ...hist.spec, ...(policy ? { yAxisPolicy: policy } : {}) } as ChartSpec, hist.rows, OPTS).svg.querySelectorAll("clipPath").length;

  it("a histogram truncated by a lone min or max clips its bars; unpinned it does not", () => {
    expect(clips()).toBe(0);
    expect(clips({ min: 20 })).toBe(1);
    expect(clips({ max: 20 })).toBe(1);
  });

  it("bar small multiples, shared and per-pane: every pane takes the lone ceiling and keeps its 0 base", () => {
    const spec = { ...CASES.bar!.spec, columns: { x: "c", value: "v", facet: "f" }, yAxisPolicy: { max: 50 } } as unknown as ChartSpec;
    const rows = [
      r({ f: "A", c: "a", v: 8 }), r({ f: "A", c: "b", v: 15 }),
      r({ f: "B", c: "a", v: 12 }), r({ f: "B", c: "b", v: 31 }),
    ];
    for (const mode of ["shared", "per-pane"]) {
      const fig = renderFigure({ ...spec, small_multiples: { columns: 2, mode } } as ChartSpec, rows, OPTS);
      for (const p of mode === "shared" ? fig.panes.slice(0, 1) : fig.panes) {
        const ticks = ascendingTicks(p.svg!);
        expect([ticks[0], ticks[ticks.length - 1]], `${mode} ${p.value}`).toEqual([0, 50]);
      }
    }
  });
});

// Ruling 74: the lone-bound contract, simplified. CONFIG-SPEC promises only that a lone bound keeps
// the axis ascending with the pinned end at the bound (then nice'd outward) and the open end past it,
// otherwise fitted. The tests below check each of those words, the shared-figure rule, and the
// numeric edges.
describe("Ruling 74: shared small multiples decide the fallback on the figure's domain", () => {
  const firstLast = (svg: SVGSVGElement): [number, number] => {
    const t = ascendingTicks(svg);
    return [t[0]!, t[t.length - 1]!];
  };
  const shared = (base: Case, policy: Record<string, unknown>, mode = "shared") =>
    ({
      ...base.spec,
      columns: { ...(base.spec as unknown as { columns: Record<string, string> }).columns, facet: "f" },
      yAxisPolicy: policy,
      small_multiples: { columns: 2, mode },
    }) as unknown as ChartSpec;

  it("a pane past the bound does not widen an axis another pane already ascends (line, min 50)", () => {
    const rows = [
      r({ f: "A", t: 2020, v: 8 }), r({ f: "A", t: 2021, v: 31 }),
      r({ f: "B", t: 2020, v: 45 }), r({ f: "B", t: 2021, v: 51 }),
    ];
    const fig = renderFigure(shared(CASES.line!, { min: 50 }), rows, OPTS);
    // bc87c77 drew 50–51: pane A probed reversed and never won the union's ceiling.
    expect(firstLast(fig.panes[0]!.svg!)).toEqual([50, 51]);
    // ...which is pane B's own axis: pane A contributes nothing to the shared domain.
    const bOnly = renderPane({ ...CASES.line!.spec, yAxisPolicy: { min: 50 } } as ChartSpec, rows.filter((x) => x.f === "B"), OPTS);
    expect(domainBounds(bOnly.yDomain)).toEqual([50, 51]);
  });

  it("a [b, b] pane does not widen it either (positive bars under max 0 beside a negative pane)", () => {
    const rows = [
      r({ f: "A", c: "a", v: 8 }), r({ f: "A", c: "b", v: 31 }),
      r({ f: "B", c: "a", v: -1 }), r({ f: "B", c: "b", v: -2 }),
    ];
    const fig = renderFigure(shared(CASES.bar!, { max: 0 }), rows, OPTS);
    const bOnly = renderPane({ ...CASES.bar!.spec, yAxisPolicy: { max: 0 } } as ChartSpec, rows.filter((x) => x.f === "B"), OPTS);
    const [lo, hi] = domainBounds(bOnly.yDomain);
    expect(lo).toBeGreaterThan(-5); // pane A alone would fall back a whole step (5) below 0
    expect(firstLast(fig.panes[0]!.svg!)).toEqual([lo, hi]);
  });

  it("per-pane mode keeps each pane's own fallback", () => {
    const rows = [
      r({ f: "A", t: 2020, v: 8 }), r({ f: "A", t: 2021, v: 31 }),
      r({ f: "B", t: 2020, v: 45 }), r({ f: "B", t: 2021, v: 51 }),
    ];
    const [a, b] = renderFigure(shared(CASES.line!, { min: 50 }, "per-pane"), rows, OPTS).panes.map((p) => firstLast(p.svg!));
    expect(a).toEqual([50, 60]);
    expect(b).toEqual([50, 51]);
  });
});

describe("Ruling 74: CONFIG-SPEC's lone-bound sentence, claim by claim", () => {
  it("the open end lies past the bound and is otherwise fitted: bar label headroom sets it", () => {
    // Bars 8–31 under min: 32 — nothing is above 32 but the 31 bar's value-label headroom (×1.05).
    const [lo, hi] = domainOf(CASES.bar!, { min: 32 });
    expect(lo).toBe(32);
    expect(hi).toBeGreaterThanOrEqual(31 * 1.05);
    expect(hi).toBeLessThan(33);
  });

  it("the open end lies past the bound and is otherwise fitted: a reference marker sets it", () => {
    const spec = { ...CASES.line!.spec, annotations: { yAxis: [{ y: 52, label: "m" }] } } as unknown as ChartSpec;
    const [lo, hi] = domainBounds(renderPane({ ...spec, yAxisPolicy: { min: 50 } } as ChartSpec, CASES.line!.rows, OPTS).yDomain);
    expect(lo).toBe(50);
    expect(hi).toBeGreaterThanOrEqual(52);
    expect(hi).toBeLessThan(60); // not the bare fallback a marker-less chart gets
  });

  it("the validate warning describes the data, not the drawing: autoWiden can widen over it", () => {
    // cli.test.ts: this spec warns "yAxisPolicy.max (2) is below every value in the data".
    const [lo, hi] = domainOf(CASES.scatter!, { max: 2, autoWiden: { step: 25 } });
    expect(lo).toBeLessThanOrEqual(8);
    expect(hi).toBeGreaterThanOrEqual(31);
  });

  it("the pinned end is at the bound, then nice'd outward, on every type", () => {
    // min: 51 on data below it: the floor is 51 before nice, and nice only ever moves it down.
    for (const [type, c] of Object.entries(CASES)) {
      const [lo, hi] = domainOf(c, { min: 51 });
      expect(lo, type).toBeLessThanOrEqual(51);
      expect(hi, type).toBeGreaterThan(51);
    }
  });
});

describe("Ruling 74: extreme bounds stay finite and ascending", () => {
  const line = CASES.line!;
  const rowsAt = (...vs: number[]): TidyRow[] => vs.map((v, i) => r({ t: 2020 + i, v }));
  const check = (rows: TidyRow[], policy: Record<string, number>): [number, number] => {
    const pane = renderPane({ ...line.spec, yAxisPolicy: policy } as ChartSpec, rows, OPTS);
    const [lo, hi] = pane.yDomain;
    expect(Number.isFinite(lo) && Number.isFinite(hi), `${lo}, ${hi}`).toBe(true);
    expect(lo, "ascending").toBeLessThan(hi);
    return [lo, hi];
  };
  // One unit in the last place of a normal double.
  const ulp = (x: number) => 2 ** (Math.floor(Math.log2(Math.abs(x))) - 52);

  it("1e20: a step of 1 rounds back to the bound, so the step is widened to move it", () => {
    const [lo, hi] = check(rowsAt(1e20, 1e20), { min: 1e20 });
    expect(lo).toBe(1e20);
    expect(hi - lo).toBeGreaterThanOrEqual(4 * ulp(1e20));
    const [lo2, hi2] = check(rowsAt(1e20, 1e20), { max: 1e20 });
    expect(hi2).toBe(1e20);
    expect(hi2 - lo2).toBeGreaterThanOrEqual(4 * ulp(1e20));
  });

  it("5e-324: a tick step of 0 at subnormal magnitude still moves the open end", () => {
    const [lo, hi] = check(rowsAt(5e-324, 5e-324), { min: 1e-323 });
    expect(lo).toBeLessThanOrEqual(1e-323);
    expect(hi).toBeGreaterThan(1e-323);
    check(rowsAt(1e-323, 1e-323), { max: 5e-324 });
  });

  it("an open end that would overflow is clamped to ±Number.MAX_VALUE", () => {
    // The span from -MAX_VALUE up to 1e300 overflows, so the tick step is Infinity.
    expect(check(rowsAt(-Number.MAX_VALUE, -1e308), { min: 1e300 })).toEqual([1e300, Number.MAX_VALUE]);
    expect(check(rowsAt(Number.MAX_VALUE, 1e308), { max: -1e300 })).toEqual([-Number.MAX_VALUE, -1e300]);
  });

  it("1e308: the schema rejects a bound beyond ±1e300, with a message naming the range", () => {
    for (const [key, v] of [["min", 1e308], ["max", -1e308], ["min", Number.MAX_VALUE], ["max", -Number.MAX_VALUE]] as const) {
      const errors = validateSpec({ chartType: "line", title: "t", xAxisType: "numeric", data: "d.csv", yAxisPolicy: { [key]: v } }).errors;
      expect(errors, `${key} ${v}`).toEqual([`/yAxisPolicy/${key}: must be between -1e300 and 1e300`]);
    }
    for (const v of [1e300, -1e300]) {
      expect(validateSpec({ chartType: "line", title: "t", xAxisType: "numeric", data: "d.csv", yAxisPolicy: { min: v } }).errors).toEqual([]);
    }
  });
});
