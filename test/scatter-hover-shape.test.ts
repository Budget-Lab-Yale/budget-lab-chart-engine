// @vitest-environment jsdom
//
// The scatter card's header marker must be the marker the cursor is on.
//
// It is drawn from a symbol map the hover layer builds, and that map has to be the SAME scale the
// marks were drawn with (`MarkLayers.symbolScaleOpts`). Two ways it used to be built from something
// else, in opposite directions:
//   - standalone keyed off `shapeLegendItems`, which `legend: false` nulls — so hiding the legend
//     silently emptied the map and every header fell back to a circle, against CONFIG-SPEC's
//     promise that `legend: false` keeps tooltips.
//   - faceted keyed off raw `spec.shape_order`, which is optional and, when present, is FILTERED
//     per pane before it becomes the domain — so an absent or filtered order shifted the symbols.
// Both show up as "the header draws a circle over a triangle", which no golden can catch: the card
// is a runtime <div> outside the SVG.
import { describe, it, expect } from "vitest";
import { mountChart } from "../src/engine/render-live";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const rowsOf = (o: Record<string, string>[]): TidyRow[] => o as unknown as TidyRow[];

const SHAPED_ROWS = rowsOf([
  { x: "1", y: "10", g: "A", s: "one" },
  { x: "2", y: "20", g: "A", s: "two" },
]);

function mount(spec: ChartSpec, rows: TidyRow[], faceted = false) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  mountChart(container, {
    spec, rows, width: faceted ? 838 : 720, height: faceted ? 420 : 400,
  } as never);
  return container;
}

/** Hover the i-th dot of `svg` and return the card's markup. Scatter hover is per-point
 *  (`pointerenter` on the marker), not the shared crosshair hit rect. */
function hoverDot(svg: SVGSVGElement, i: number): string {
  const dots = svg.querySelectorAll('g[aria-label="dot"] path, g[aria-label="dot"] circle');
  dots[i]!.dispatchEvent(new PointerEvent("pointerenter", { clientX: 10, clientY: 10, bubbles: true }));
  return document.body.querySelector<HTMLElement>(".tbl-tooltip")!.innerHTML;
}

/** The header swatch's drawn markup. Comparing two points' swatches to EACH OTHER — rather than to
 *  a hardcoded path — keeps this independent of d3's symbol geometry, and of whether a given symbol
 *  happens to render as <path> or <circle>. */
function swatch(html: string): string {
  const m = /<span class="tbl-tooltip-swatch">(.*?)<\/span>/.exec(html);
  return m ? m[1]! : "NO-SWATCH";
}

describe("scatter card header: the marker matches the point", () => {
  it("keeps the shape name and the right symbol when legend: false", () => {
    const spec = {
      chartType: "scatter", xAxisType: "numeric", legend: false,
      columns: { x: "x", value: "y", series: "g", shape: "s" },
      shape_labels: { one: "First", two: "Second" },
    } as unknown as ChartSpec;
    const svg = mount(spec, SHAPED_ROWS).querySelector<SVGSVGElement>(".figure-canvas svg")!;

    const first = hoverDot(svg, 0);
    const second = hoverDot(svg, 1);

    expect(first).toContain("First");
    expect(second).toContain("Second");
    // Two different shape values must not draw one symbol. Before the fix both were the circle
    // fallback, so these were equal.
    expect(swatch(first)).not.toBe(swatch(second));
  });

  it("draws distinct symbols in a faceted pane with no shape_order", () => {
    const spec = {
      chartType: "scatter", xAxisType: "numeric",
      columns: { x: "x", value: "y", series: "g", shape: "s", facet: "f" },
      small_multiples: { columns: 2 },
    } as unknown as ChartSpec;
    const rows = rowsOf([
      { x: "1", y: "10", g: "A", s: "one", f: "P" },
      { x: "2", y: "20", g: "A", s: "two", f: "P" },
    ]);
    const panes = mount(spec, rows, true).querySelectorAll<SVGSVGElement>(".figure-pane svg");
    expect(panes.length).toBeGreaterThan(0);

    const first = hoverDot(panes[0]!, 0);
    const second = hoverDot(panes[0]!, 1);
    // With no `shape_order` the faceted map was empty, so every header drew a circle.
    expect(swatch(first)).not.toBe(swatch(second));
  });
});
