// @vitest-environment jsdom
// The PNG export re-renders a figure's panes at the per-column widths `pane_widths` resolves to, so
// it must also LAY THEM OUT at those widths. Before 1.17.0 the export placed every pane in an
// equal-width cell, and the pane's viewBox (its rendered width) was scaled into it: with
// `pane_widths: "equal-bar"` the bars came out different widths in each pane, the opposite of what
// the option promises.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildExportSvg } from "../src/embed/export-png";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";
const realGetContext = HTMLCanvasElement.prototype.getContext;
beforeAll(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"]; });
afterAll(() => { HTMLCanvasElement.prototype.getContext = realGetContext; });

const SPEC: ChartSpec = {
  chartType: "bar", title: "GDP by sector", xAxisType: "categorical", orientation: "vertical",
  columns: { x: "cat", value: "v", facet: "grp" },
  small_multiples: { mode: "shared", columns: 2, pane_widths: "equal-bar" }, data: "d.csv",
};
const rows = [
  ...["Total","Ag","Mining","Mfg","Util","Constr","Services"].map((c, i) => ({ cat: c, grp: "Sectors", v: String(i - 3) })),
  ...["Durable","Nondurable","Advanced"].map((c, i) => ({ cat: c, grp: "Manufacturing detail", v: String(2 - i) })),
] as unknown as TidyRow[];

const panesOf = (svg: SVGSVGElement): SVGSVGElement[] =>
  [...svg.children].filter((c) => c.tagName === "svg") as SVGSVGElement[];
const num = (el: Element, attr: string): number => Number(el.getAttribute(attr));
// A pane is a nested <svg> carrying `viewBox="0 0 <renderedW> <renderedH>"` and a placed
// `width`/`height`. With no preserveAspectRatio it scales uniformly ("meet"): by the smaller of
// the two ratios, so a pane placed in a cell narrower than it was rendered shrinks as a whole.
const viewBox = (p: SVGSVGElement): number[] => (p.getAttribute("viewBox") ?? "").split(/\s+/).map(Number);
const drawScale = (p: SVGSVGElement): number => {
  const [, , vw, vh] = viewBox(p);
  return Math.min(num(p, "width") / vw!, num(p, "height") / vh!);
};

describe("export honours pane_widths", () => {
  it("places each pane at the width it was rendered at", () => {
    const panes = panesOf(buildExportSvg(SPEC, rows));
    expect(panes).toHaveLength(2);
    for (const p of panes) {
      expect(p.getAttribute("viewBox")).toBeTruthy();
      expect(viewBox(p)[2]).toBeCloseTo(num(p, "width"), 0);
    }
  });

  it("draws bars of equal width in both panes", () => {
    const panes = panesOf(buildExportSvg(SPEC, rows));
    // Bars are the rects of the pane's `bar` mark group, in viewBox units; scale to placed pixels.
    const barW = (p: SVGSVGElement): number => {
      const w = [...p.querySelectorAll('g[aria-label="bar"] rect')].map((r) => num(r, "width")).filter((n) => n > 0);
      expect(w.length).toBeGreaterThan(0);
      return Math.max(...w) * drawScale(p);
    };
    // Within 1px: both panes' bands are 82.2px wide, but Plot rounds band positions to whole pixels
    // (bars of 63 and 62). Before the fix they differed by ~15px.
    expect(Math.abs(barW(panes[0]!) - barW(panes[1]!))).toBeLessThanOrEqual(1);
  });

  it("per-pane mode: splits the row's data width by the pane_widths proportions", () => {
    const spec: ChartSpec = { ...SPEC, small_multiples: { mode: "per-pane", columns: 2, pane_widths: [7, 3] } };
    const root = buildExportSvg(spec, rows);
    const panes = panesOf(root);
    expect(panes).toHaveLength(2);
    for (const p of panes) expect(viewBox(p)[2]).toBeCloseTo(num(p, "width"), 0);
    // The row spans the frame's inner width: the right pane ends as far from the frame's right
    // edge as the left pane starts from its left edge.
    const [p0, p1] = panes as [SVGSVGElement, SVGSVGElement];
    expect(num(p1, "x") + num(p1, "width")).toBeCloseTo(num(root, "width") - num(p0, "x"), 0);
    // Each pane keeps its own y-label gutter; the DATA width between the margins splits 7:3.
    const dataW = (p: SVGSVGElement): number =>
      viewBox(p)[2]! - num(p, "data-margin-left") - num(p, "data-margin-right");
    expect(dataW(p0) / dataW(p1)).toBeCloseTo(7 / 3, 2);
  });
});
