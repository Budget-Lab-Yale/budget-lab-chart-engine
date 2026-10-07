// @vitest-environment jsdom
//
// A dumbbell with `orientation` omitted is HORIZONTAL (CONFIG-SPEC "Dumbbell options"; the mark,
// marks/dumbbell.ts). Every other place that branches on a dumbbell's orientation — the facets drawn
// as groups (spec/facet-groups.ts), the live mount (chart height, hover band) and the PNG export —
// must agree, so an omitted orientation renders exactly like an explicit `orientation: horizontal`.
// Before, those places tested `=== "horizontal"`: a faceted dumbbell with no orientation sat side by
// side at a fixed 320px height and clipped long labels.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mountChart } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import { validateSpec } from "../src/spec/validate";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

// jsdom has no canvas: getContext logs "Not implemented" and returns null. Return the null quietly;
// the export's text measurement takes the same fallback either way.
const realGetContext = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
});

const BASE: ChartSpec = {
  chartType: "dumbbell",
  title: "t",
  xAxisType: "categorical",
  columns: { category: "group", series: "m", value: "v" },
  series_order: ["a", "b"],
  data: "d.csv",
};
const FACETED: ChartSpec = { ...BASE, columns: { ...BASE.columns, facet: "pane" } };

const paneRows = (pane: string, groups: string[]) =>
  groups.flatMap((g, i) => [
    { pane, group: g, m: "a", v: String(10 + i) },
    { pane, group: g, m: "b", v: String(20 + i) },
  ]);
const ROWS = [
  ...paneRows("Short", ["Q1", "Q2", "Q5"]),
  ...paneRows("Long", ["Top 1% by net worth", "Net worth of $1 billion or more"]),
] as unknown as TidyRow[];

const omitted = (spec: ChartSpec): ChartSpec => {
  const { orientation: _drop, ...rest } = spec;
  return rest as ChartSpec;
};
const horizontal = (spec: ChartSpec): ChartSpec => ({ ...spec, orientation: "horizontal" });

function liveHtml(spec: ChartSpec): string {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const teardown = mountChart(container, { spec, rows: ROWS, width: 720 });
  try {
    return container.innerHTML;
  } finally {
    if (typeof teardown === "function") teardown();
    container.remove();
  }
}

describe("dumbbell with orientation omitted lays out as horizontal", () => {
  {
    const spec: ChartSpec = { ...FACETED, small_multiples: { mode: "shared" } };

    it("faceted, live mount: one grouped chart, identical to orientation: horizontal", () => {
      const html = liveHtml(omitted(spec));
      expect(html).not.toContain("figure-pane");
      expect(html).toBe(liveHtml(horizontal(spec)));
    });

    it("faceted, PNG export: identical to orientation: horizontal", () => {
      expect(buildExportSvg(omitted(spec), ROWS).outerHTML).toBe(buildExportSvg(horizontal(spec), ROWS).outerHTML);
    });
  }

  // The marker at 50 sits past the data (10–22): the value axis must fold it in to show it.
  const STANDALONE: ChartSpec = { ...BASE, annotations: { xAxis: [{ x: "50", label: "Target" }] } };

  it("standalone, live mount: identical to orientation: horizontal (height, hover band, value-axis marker)", () => {
    expect(liveHtml(omitted(STANDALONE))).toBe(liveHtml(horizontal(STANDALONE)));
  });

  it("standalone, PNG export: identical to orientation: horizontal", () => {
    expect(buildExportSvg(omitted(STANDALONE), ROWS).outerHTML).toBe(
      buildExportSvg(horizontal(STANDALONE), ROWS).outerHTML,
    );
  });

  it("validation: columns.section is accepted with orientation omitted, still rejected when vertical", () => {
    const sectioned = { ...BASE, columns: { ...BASE.columns, section: "sec" } };
    expect(validateSpec(omitted(sectioned)).valid).toBe(true);
    expect(validateSpec({ ...sectioned, orientation: "vertical" }).valid).toBe(false);
  });
});
