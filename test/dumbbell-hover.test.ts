// @vitest-environment jsdom
//
// Dumbbell live-hover PLUMBING. The hover GEOMETRY (which category the pointer resolves to) is
// browser-runtime — jsdom has no layout so getBoundingClientRect returns 0 and mark centers can't
// be read — and is verified in the live demo. What we CAN prove here: the hover is wired (a hit
// target is attached for both orientations, pointer events don't throw), a faceted figure mounts
// with a coordinated grid, and the tooltip HTML the hover shows lists each series' value.
import { describe, it, expect } from "vitest";
import { mountChart } from "../src/engine/render-live";
import { buildBandTooltipHtml } from "../src/engine/crosshair";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const SPEC: ChartSpec = {
  chartType: "dumbbell",
  title: "Rates",
  xAxisType: "categorical",
  orientation: "horizontal",
  columns: { category: "group", series: "measure", value: "rate" },
  series_order: ["current_law", "static", "collected"],
  series_marker: { current_law: "ink", static: "hollow", collected: "filled" },
  series_labels: { current_law: "Current law", static: "Static", collected: "Collected" },
  value_format: { decimals: 1, suffix: "%" },
  data: "d",
};
const ROWS: TidyRow[] = [
  { group: "Q1", measure: "current_law", rate: "2.1" },
  { group: "Q1", measure: "static", rate: "2.1" },
  { group: "Q1", measure: "collected", rate: "2.1" },
  { group: "Q5", measure: "current_law", rate: "28.4" },
  { group: "Q5", measure: "static", rate: "34.9" },
  { group: "Q5", measure: "collected", rate: "32.6" },
] as TidyRow[];

function mount(spec: ChartSpec) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const teardown = mountChart(container, { spec, rows: ROWS, width: 720, height: 400 });
  return { container, teardown };
}

describe("dumbbell hover — plumbing", () => {
  it("attaches a category hover hit target (horizontal)", () => {
    const { container } = mount(SPEC);
    expect(container.querySelector(".tbl-catline-hit")).not.toBeNull();
  });

  it("attaches a category hover hit target (vertical)", () => {
    const { container } = mount({ ...SPEC, orientation: "vertical" });
    expect(container.querySelector(".tbl-catline-hit")).not.toBeNull();
  });

  it("pointer events over the hit target do not throw", () => {
    const { container } = mount(SPEC);
    const hit = container.querySelector(".tbl-catline-hit") as SVGElement;
    expect(() => {
      hit.dispatchEvent(new PointerEvent("pointermove", { clientX: 200, clientY: 150, bubbles: true }));
      hit.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    }).not.toThrow();
  });

  it("faceted dumbbell mounts a coordinated multi-pane grid", () => {
    const facetRows: TidyRow[] = [
      { pane: "Quintiles", group: "Q1", measure: "static", rate: "2.1" },
      { pane: "Quintiles", group: "Q1", measure: "collected", rate: "2.0" },
      { pane: "Top decile", group: "Top 1%", measure: "static", rate: "39.0" },
      { pane: "Top decile", group: "Top 1%", measure: "collected", rate: "35.1" },
    ] as TidyRow[];
    const spec: ChartSpec = {
      ...SPEC,
      series_order: ["static", "collected"],
      columns: { category: "group", series: "measure", value: "rate", facet: "pane" },
      small_multiples: { columns: 2, mode: "shared" },
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    expect(() => mountChart(container, { spec, rows: facetRows, width: 838, height: 420 })).not.toThrow();
    expect(container.querySelectorAll(".figure-pane svg").length).toBe(2);
    // Each pane wired its own hover hit target (the coordinated cursor bus drives the rest live).
    expect(container.querySelectorAll(".figure-pane .tbl-catline-hit").length).toBe(2);
  });

  it("tooltip swatches are dots matching the legend markers (hollow ring / filled / ink)", () => {
    const rows = ROWS.map((r) => ({ _xc: r.group as string, series: r.measure as string, _y: Number(r.rate) }));
    const html = buildBandTooltipHtml("Q5", rows, {
      seriesLabels: SPEC.series_labels,
      seriesOrder: SPEC.series_order,
      yFormat: (v) => `${v.toFixed(1)}%`,
      swatchShape: "dot",
      swatchMarkers: new Map([
        ["current_law", "ink"],
        ["static", "hollow"],
        ["collected", "filled"],
      ]),
      renderedFills: new Map([
        ["current_law", "#1A1A2E"],
        ["static", "#E69F00"],
        ["collected", "#8856BF"],
      ]),
    });
    // Every swatch is a circle (border-radius:50%), never a line/square.
    expect(html).toContain("border-radius:50%");
    expect(html).not.toContain("is-square");
    // Hollow → a ring: white fill + series-color border.
    expect(html).toMatch(/background:#ffffff;border-radius:50%;border:2px solid #E69F00/);
    // Ink → filled with the ink token; filled → the series color.
    expect(html).toContain("background:#1A1A2E;border-radius:50%");
    expect(html).toContain("background:#8856BF;border-radius:50%");
  });

  it("tooltip HTML lists each series' value for the hovered category", () => {
    const html = buildBandTooltipHtml(
      "Q5",
      ROWS.map((r) => ({ _xc: r.group as string, series: r.measure as string, _y: Number(r.rate) })),
      {
        seriesLabels: SPEC.series_labels,
        seriesOrder: SPEC.series_order,
        yFormat: (v) => `${v.toFixed(1)}%`,
      },
    );
    expect(html).toContain("Q5");
    expect(html).toContain("Current law");
    expect(html).toContain("28.4%");
    expect(html).toContain("34.9%");
    expect(html).toContain("32.6%");
  });
});
