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
