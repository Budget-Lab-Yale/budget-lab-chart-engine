// @vitest-environment jsdom
//
// Annotation-label stagger and point-callout connectors are measured against the RESOLVED x-axis
// domain, not the data extent. The two differ on a histogram (the domain is the bin-edge span and
// the binned rows carry no parsed x at all) and on a numeric axis with `anchorAtZero: true`, so
// every px <-> data conversion in assemble-plot.ts was scaled by dataSpan/axisSpan.
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import { numericAxisDomain } from "../src/engine/x-adapter";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

describe("numericAxisDomain (pure helper)", () => {
  it("passes a numeric pair through", () => {
    expect(numericAxisDomain([-1, 2.25])).toEqual([-1, 2.25]);
  });

  it("converts a Date pair (temporal histogram) to epoch ms", () => {
    const lo = new Date("2020-01-01T00:00:00Z");
    const hi = new Date("2021-01-01T00:00:00Z");
    expect(numericAxisDomain([lo, hi])).toEqual([lo.getTime(), hi.getTime()]);
  });

  it("rejects a categorical band domain (a list of categories is not a span)", () => {
    expect(numericAxisDomain(["A", "B", "C"])).toBeUndefined();
    expect(numericAxisDomain(["A", "B"])).toBeUndefined();
  });

  it("rejects a missing or wrong-length domain", () => {
    expect(numericAxisDomain(undefined)).toBeUndefined();
    expect(numericAxisDomain([1])).toBeUndefined();
    expect(numericAxisDomain([1, 2, 3])).toBeUndefined();
    expect(numericAxisDomain([1, Number.NaN])).toBeUndefined();
  });
});

// The <g> wrapper carries the mark's constant dx/dy, so the stagger row shows up as the parent
// transform's y offset (base 4 for row 0, +13 per row).
const rowDy = (el: Element | undefined): number => {
  const m = /translate\(\s*[-\d.]+\s*,\s*([-\d.]+)\s*\)/.exec(el?.parentElement?.getAttribute("transform") ?? "");
  return m ? Number(m[1]) : Number.NaN;
};
const findText = (svg: SVGSVGElement, re: RegExp): Element | undefined =>
  Array.from(svg.querySelectorAll("text")).find((t) => re.test(t.textContent ?? ""));

describe("histogram: colliding xAxis labels auto-stagger", () => {
  // The rows a histogram draws are binned (_x0/_x1/_y, no parsed _xn), so the DATA extent is
  // undefined and the stagger pass never ran — colliding labels overprinted silently.
  const raw: TidyRow[] = Array.from({ length: 20 }, (_, i) => ({
    amount: String(-1 + (i * 3.25) / 20),
  })) as any;
  const spec = {
    chartType: "histogram",
    title: "H",
    xAxisType: "numeric",
    columns: { x: "amount" },
    histogram: { bins: 8, domain: [-1, 2.25] },
    data: "d",
    annotations: {
      // ~10 px apart at width 728 on a [-1, 2.25] domain; ~62 px labels, so they collide.
      xAxis: [
        { x: "0.50", label: "Marker one" },
        { x: "0.55", label: "Marker two" },
      ],
    },
  } as unknown as ChartSpec;

  it("puts two colliding labels on different stagger rows", () => {
    const { svg } = renderChart(spec, raw, { width: 728, height: 400, document });
    const one = findText(svg, /^Marker one$/);
    const two = findText(svg, /^Marker two$/);
    expect(one).toBeDefined();
    expect(two).toBeDefined();
    expect(rowDy(one)).not.toBe(rowDy(two));
  });

  it("leaves well-separated labels on the same row", () => {
    const far = {
      ...spec,
      annotations: { xAxis: [{ x: "-0.90", label: "Left" }, { x: "2.20", label: "Right" }] },
    } as unknown as ChartSpec;
    const { svg } = renderChart(far, raw, { width: 728, height: 400, document });
    expect(rowDy(findText(svg, /^Left$/))).toBe(rowDy(findText(svg, /^Right$/)));
  });
});

describe("anchorAtZero: a connector's px offset is taken in the drawn coordinate space", () => {
  // Data x spans [1990, 2020] but the drawn axis is [0, 2020]. Converting the callout's `dx` px
  // through the DATA span shrank a 40 px leader to under a pixel — short enough that Plot's
  // insetEnd swallowed it and no arrow was drawn at all.
  const rows: TidyRow[] = [
    { yr: "1990", series: "a", value: "1" },
    { yr: "2005", series: "a", value: "2" },
    { yr: "2020", series: "a", value: "3" },
  ] as any;
  const spec = {
    chartType: "scatter",
    title: "S",
    xAxisType: "numeric",
    columns: { x: "yr", series: "series", y: "value" },
    xAxisPolicy: { anchorAtZero: true },
    data: "d",
    // dy: 0 keeps the leader horizontal so its start x is comparable to the point's x directly.
    annotations: { points: [{ x: "2005", y: 2, label: "Callout", connector: true, dx: -40, dy: 0 }] },
  } as unknown as ChartSpec;

  it("starts the arrow 40 px from the point it annotates", () => {
    const { svg } = renderChart(spec, rows, { width: 728, height: 400, document });
    const d = svg.querySelector('g[aria-label="arrow"] path')?.getAttribute("d") ?? "";
    expect(d).not.toBe("");
    const start = /^M([-\d.]+),([-\d.]+)/.exec(d);
    expect(start).not.toBeNull();
    // The label text mark sits AT the point (its dx/dy ride on the <g>), so its own transform x is
    // the point's drawn x.
    const label = findText(svg, /^Callout$/);
    const pointX = Number(
      /translate\(\s*([-\d.]+)/.exec(label?.getAttribute("transform") ?? "")?.[1] ?? Number.NaN,
    );
    expect(Number.isFinite(pointX)).toBe(true);
    expect(pointX - Number(start![1])).toBeCloseTo(40, 1);
  });
});
