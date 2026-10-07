// @vitest-environment jsdom
//
// Ruling 72: an area chart stacks its negative values downward from 0, so its value-axis floor is
// the stacked negative extent, mirroring the ceiling (the stacked top). The floor used to be the
// lowest SINGLE value, so a stack of two negatives (-20 and -11 at one x, reaching -31) got a floor
// of -20, and the clip gate cut the bottom band off.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { renderPane, renderChart } from "../src/engine/index";
import { domainBounds } from "../src/engine/scales";
import { mountChart } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
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

const OPTS = { width: 720, height: 400, document } as const;
const r = (o: Record<string, string | number>): TidyRow =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) as unknown as TidyRow;

const SPEC = {
  chartType: "area",
  title: "t",
  xAxisType: "numeric",
  columns: { x: "t", value: "v", series: "s" },
  data: "d.csv",
} as unknown as ChartSpec;

// Two negative series stacked: -8 at 2020; -20 and -11 at 2021, reaching -31.
const NEG = [r({ t: 2020, s: "A", v: -8 }), r({ t: 2021, s: "A", v: -20 }), r({ t: 2021, s: "B", v: -11 })];
// Mixed signs at one x: the negatives stack down from 0 on their own (-5 + -7 = -12), apart from +10.
const MIXED = [
  r({ t: 2020, s: "A", v: 10 }), r({ t: 2020, s: "B", v: -5 }), r({ t: 2020, s: "C", v: -7 }),
  r({ t: 2021, s: "A", v: 12 }), r({ t: 2021, s: "B", v: -2 }), r({ t: 2021, s: "C", v: -1 }),
];

const domainOf = (rows: TidyRow[]): [number, number] => domainBounds(renderPane(SPEC, rows, OPTS).yDomain);

describe("Ruling 72: an area's value-axis floor is its stacked negative extent", () => {
  it("a stack of two negatives gets a floor at or below their sum, and keeps 0 on the axis", () => {
    const [lo, hi] = domainOf(NEG);
    expect(lo).toBeLessThanOrEqual(-31);
    expect(hi).toBe(0);
  });

  it("with mixed signs the floor covers the negatives' own stack", () => {
    expect(domainOf(MIXED)[0]).toBeLessThanOrEqual(-12);
  });

  it("two negatives: nothing is clipped, standalone, live and in the PNG", () => {
    expect(renderChart(SPEC, NEG, OPTS).svg.querySelectorAll("clipPath").length).toBe(0);

    const container = document.createElement("div");
    document.body.appendChild(container);
    mountChart(container, { spec: SPEC, rows: NEG, width: 720 });
    const live = container.querySelector(".figure-canvas svg");
    expect(live).not.toBeNull();
    expect(live!.querySelector('g[aria-label="area"]')).not.toBeNull();
    expect(live!.querySelectorAll("clipPath").length).toBe(0);

    const root = buildExportSvg(SPEC, NEG);
    const chart = root.querySelector('svg g[aria-label="area"]')?.closest("svg");
    expect(chart).toBeTruthy();
    expect(chart!.querySelectorAll("clipPath").length).toBe(0);
  });
});

// Ruling 72 extended: the ceiling is the stacked POSITIVE extent, mirroring the floor. It was the net
// total per x, which with mixed signs (+10 -5 -7, +12 -2 -1) gave [-15, 10] while the +12 band
// reached 12 and was clipped.
describe("Ruling 72: an area's value-axis ceiling is its stacked positive extent", () => {
  it("with mixed signs the ceiling covers the positives' own stack, and nothing is clipped", () => {
    expect(domainOf(MIXED)[1]).toBeGreaterThanOrEqual(12);
    expect(renderChart(SPEC, MIXED, OPTS).svg.querySelectorAll("clipPath").length).toBe(0);
  });

  it("two positives with a negative at the same x: the ceiling is their sum, not the net", () => {
    const rows = [r({ t: 2020, s: "A", v: 20 }), r({ t: 2020, s: "B", v: 11 }), r({ t: 2020, s: "C", v: -25 })];
    expect(domainOf(rows)[1]).toBeGreaterThanOrEqual(31);
  });
});

// The stack is keyed by the PARSED x, the coordinate Plot stacks on: numeric x spelled "1" and "1.0"
// is one x, so A=-20 and B=-11 there reach -31. Keyed by the raw text they were two x's, the floor
// stayed at -20 and the second band ran out of the frame (live y=576 in a 400px svg).
describe("Ruling 72: an area's stacked extents key on the parsed x, not its spelling", () => {
  const spelled = (a: number, b: number): TidyRow[] => [
    r({ t: "1", s: "A", v: a }), r({ t: "1.0", s: "B", v: b }),
    r({ t: "2", s: "A", v: a }), r({ t: "2.0", s: "B", v: b }),
  ];
  const noClip = (rows: TidyRow[]) => {
    expect(renderChart(SPEC, rows, OPTS).svg.querySelectorAll("clipPath").length, "renderChart").toBe(0);
    const container = document.createElement("div");
    document.body.appendChild(container);
    mountChart(container, { spec: SPEC, rows, width: 720 });
    expect(container.querySelector(".figure-canvas svg")!.querySelectorAll("clipPath").length, "live").toBe(0);
    const chart = buildExportSvg(SPEC, rows).querySelector('svg g[aria-label="area"]')?.closest("svg");
    expect(chart!.querySelectorAll("clipPath").length, "export").toBe(0);
  };

  it("floor: '1' and '1.0' stack together to -31", () => {
    const rows = spelled(-20, -11);
    expect(domainOf(rows)[0]).toBeLessThanOrEqual(-31);
    noClip(rows);
  });

  it("ceiling: '1' and '1.0' stack together to 31", () => {
    const rows = spelled(20, 11);
    expect(domainOf(rows)[1]).toBeGreaterThanOrEqual(31);
    noClip(rows);
  });

  it("the clip gate measures the same stack: a pinned max of 20 under the 31 clips", () => {
    const pinned = { ...SPEC, yAxisPolicy: { max: 20 } } as ChartSpec;
    expect(renderChart(pinned, spelled(20, 11), OPTS).svg.querySelectorAll("clipPath").length).toBe(1);
  });
});
