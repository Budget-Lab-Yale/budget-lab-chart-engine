// @vitest-environment jsdom
//
// POINT MARKS: the row array and the DOM markers must be the same list, in the same order.
//
// Point charts pair rows to rendered markers BY INDEX, in two places that must agree:
//   - `assemble-plot.ts` writes `data-series` / `data-shape` onto the i-th marker from the i-th
//     entry of the mark's tagging arrays (legend dim/pin and hatch textures read those), and
//   - `crosshair.ts` `attachPointHover` reads `opts.points[i]` for the i-th marker (the card).
// Both index arrays built from the row list, so any row that does NOT produce a marker shifts
// every later marker onto the wrong row. Two things drop a row silently:
//   - a blank value (the dot mark's `defined` guard), and
//   - a shape value outside an explicit `shape_order` domain.
// Neither is an error, and neither is visible until you hover or use the legend — which is why
// this is a test rather than a comment.
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const scatter = {
  chartType: "scatter",
  xAxisType: "numeric",
  columns: { x: "x", value: "y", series: "g" },
} as unknown as ChartSpec;

const rowsOf = (o: Record<string, string>[]): TidyRow[] => o as unknown as TidyRow[];

/** Every rendered dot, in DOM order, whatever element Plot chose for it (a shape channel makes
 *  them <path>, otherwise <circle>). */
function markers(svg: SVGSVGElement): Element[] {
  return Array.from(svg.querySelectorAll('g[aria-label="dot"] circle, g[aria-label="dot"] path'));
}

describe("point marks: row-to-marker alignment", () => {
  it("tags the surviving markers with their OWN series when a blank value drops a row", () => {
    const res = renderChart(
      scatter,
      rowsOf([
        { x: "1", y: "", g: "A" },
        { x: "2", y: "10", g: "B" },
        { x: "3", y: "20", g: "B" },
      ]),
    );
    const tags = markers(res.svg as SVGSVGElement).map((e) => e.getAttribute("data-series"));
    // Row 1 renders nothing, so both markers are series B. Before the fix this was ["A", "B"]:
    // the legend dimmed a B point when A was hovered, and A — with no marker at all — dimmed one.
    expect(tags).toEqual(["B", "B"]);
  });

  it("tags the surviving markers correctly when an out-of-domain shape drops a row", () => {
    const spec = {
      ...scatter,
      columns: { x: "x", value: "y", series: "g", shape: "s" },
      shape_order: ["one"],
    } as unknown as ChartSpec;
    const res = renderChart(
      spec,
      rowsOf([
        { x: "1", y: "10", g: "A", s: "two" },
        { x: "2", y: "20", g: "B", s: "one" },
      ]),
    );
    const els = markers(res.svg as SVGSVGElement);
    // `shape_order: [one]` excludes "two" from the symbol domain and Plot renders no marker for it.
    // (`shape_order` naming a value absent from the DATA is rejected by validation; this is the
    // reachable direction — data carrying a value the author did not order.)
    expect(els).toHaveLength(1);
    expect(els[0]!.getAttribute("data-series")).toBe("B");
    expect(els[0]!.getAttribute("data-shape")).toBe("one");
  });

  it("stays aligned when a row's x cannot be parsed", () => {
    // Validation rejects a malformed x before render in the normal path, so this is a belt-and-
    // braces case — but the filter that keeps the arrays aligned tests the VALUE, not the x, so
    // pin the behaviour rather than reason about which layer drops the row.
    const res = renderChart(
      scatter,
      rowsOf([
        { x: "notanumber", y: "10", g: "A" },
        { x: "2", y: "20", g: "B" },
      ]),
    );
    const els = markers(res.svg as SVGSVGElement);
    expect(els.map((e) => e.getAttribute("data-series"))).toEqual(["B"]);
  });

  it("leaves a fully-populated point chart's tagging untouched", () => {
    const res = renderChart(
      scatter,
      rowsOf([
        { x: "1", y: "10", g: "A" },
        { x: "2", y: "20", g: "B" },
      ]),
    );
    const tags = markers(res.svg as SVGSVGElement).map((e) => e.getAttribute("data-series"));
    expect(tags).toEqual(["A", "B"]);
  });
});
