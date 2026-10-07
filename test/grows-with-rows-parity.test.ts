// @vitest-environment jsdom
//
// Two places decide whether a chart's height grows with its category rows: the live mount
// (computeChartHeight) and the PNG export (buildExportSvg). They used to write the predicate out
// separately, and F14 was a drift between them (the export left horizontal dumbbells out). Both now
// ask `growsWithRows`; this pins that they agree for every chart type and orientation, omitted
// included. (A chart that grows with its rows is never a small-multiples figure: its facets draw as
// groups, spec/facet-groups.ts.)
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { computeChartHeight } from "../src/engine/render-live";
import { growsWithRows, horizontalBarChartHeight } from "../src/engine/figure";
import { buildExportSvg } from "../src/embed/export-png";
import { H } from "../src/embed/figure-chrome";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

// jsdom has no canvas: return null quietly; text measurement takes the same fallback either way.
const realGetContext = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
});

const r = (o: Record<string, string | number>): TidyRow =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) as unknown as TidyRow;

// Enough categories that a row-sized chart is far taller than the 400 live default.
const N = 40;
const cats = Array.from({ length: N }, (_, i) => `Category ${i + 1}`);
const nums = Array.from({ length: N }, (_, i) => 2000 + i);

const CASES: Record<string, { spec: Record<string, unknown>; rows: TidyRow[] }> = {
  line: {
    spec: { xAxisType: "numeric", columns: { x: "t", value: "v" } },
    rows: nums.map((t, i) => r({ t, v: 5 + (i % 9) })),
  },
  area: {
    spec: { xAxisType: "numeric", columns: { x: "t", value: "v", series: "s" } },
    rows: nums.flatMap((t, i) => [r({ t, s: "A", v: 5 + (i % 9) }), r({ t, s: "B", v: 3 })]),
  },
  scatter: {
    spec: { xAxisType: "numeric", columns: { x: "t", value: "v" } },
    rows: nums.map((t, i) => r({ t, v: 5 + (i % 9) })),
  },
  dotplot: {
    spec: { xAxisType: "categorical", columns: { x: "c", value: "v", series: "s" } },
    rows: cats.flatMap((c, i) => [r({ c, s: "A", v: 5 + (i % 9) }), r({ c, s: "B", v: 3 })]),
  },
  bar: {
    spec: { xAxisType: "categorical", columns: { x: "c", value: "v" } },
    rows: cats.map((c, i) => r({ c, v: 5 + (i % 9) })),
  },
  stacked: {
    spec: { xAxisType: "categorical", columns: { x: "c", value: "v", series: "s" } },
    rows: cats.flatMap((c, i) => [r({ c, s: "A", v: 5 + (i % 9) }), r({ c, s: "B", v: 3 })]),
  },
  waterfall: {
    spec: { xAxisType: "categorical", columns: { x: "c", value: "v", kind: "k" } },
    rows: cats.map((c, i) => r({ c, v: i === 0 ? 10 : 1 + (i % 3), k: i === 0 ? "total" : "delta" })),
  },
  histogram: {
    spec: { xAxisType: "numeric", columns: { x0: "lo", x1: "hi", value: "n" } },
    rows: nums.map((_, i) => r({ lo: i * 5, hi: i * 5 + 5, n: 5 + (i % 9) })),
  },
  dumbbell: {
    spec: { xAxisType: "categorical", series_order: ["A", "B"], columns: { category: "c", value: "v", series: "s" } },
    rows: cats.flatMap((c, i) => [r({ c, s: "A", v: 5 + (i % 9) }), r({ c, s: "B", v: 20 })]),
  },
};

const ORIENTATIONS = ["horizontal", "vertical", undefined] as const;
// The only chart types whose height follows their rows (orientation omitted is horizontal for a
// dumbbell and vertical for a bar/stacked chart).
const EXPECTED_GROWS = new Set(["bar|horizontal", "stacked|horizontal", "dumbbell|horizontal", "dumbbell|undefined"]);

/** The single chart SVG the export composed (the widest nested svg). */
const exportChartOf = (root: SVGSVGElement): SVGSVGElement =>
  Array.from(root.querySelectorAll("svg")).reduce((a, b) =>
    Number(b.getAttribute("width") ?? 0) > Number(a.getAttribute("width") ?? 0) ? b : a,
  ) as SVGSVGElement;

describe("growsWithRows: live and export agree on which charts grow with their rows", () => {
  for (const [type, c] of Object.entries(CASES)) {
    for (const orientation of ORIENTATIONS) {
      const key = `${type}|${String(orientation)}`;
      it(`${type}, orientation ${String(orientation)}`, () => {
        const spec = {
          chartType: type,
          title: "t",
          data: "d.csv",
          ...c.spec,
          ...(orientation ? { orientation } : {}),
        } as unknown as ChartSpec;
        const grows = growsWithRows(spec);
        expect(grows).toBe(EXPECTED_GROWS.has(key));

        // Live: a row-sized chart takes the shared helper's height; every other keeps the fixed one.
        const live = computeChartHeight(spec, c.rows);
        if (grows) {
          expect(live).toBe(horizontalBarChartHeight(spec, c.rows));
          expect(live).toBeGreaterThan(460);
        } else {
          expect(live).toBe(type === "waterfall" ? 460 : 400);
        }

        // Export: a row-sized chart is drawn at the live height in a content-sized frame; every
        // other keeps the fixed 750 frame and fills it, at a height the live mount does not use.
        const root = buildExportSvg(spec, c.rows);
        const chartH = Number(exportChartOf(root).getAttribute("height"));
        expect(chartH === live).toBe(grows);
        if (!grows) expect(Number(root.getAttribute("height"))).toBe(H);
      });
    }
  }

  it("timeline and treemap are content-sized by their own rules, not by row growth", () => {
    for (const chartType of ["timeline", "treemap"]) {
      expect(growsWithRows({ chartType, title: "t", data: "d.csv" } as unknown as ChartSpec)).toBe(false);
    }
  });
});
