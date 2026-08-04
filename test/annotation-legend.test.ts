// @vitest-environment jsdom
//
// Legend rows for things that are not series: `annotations.bands`, `annotations.xAxis`/`yAxis`
// reference lines, and `shading` fills opted in with `legend: true`. Locks the three behaviors the
// feature exists for — the row appears, the in-chart label goes away, and entries sharing a label
// collapse to one row — plus the swatch tinting and the interaction opt-out.
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import { renderLegend } from "../src/engine/legend";
import { buildAnnotationLegendItems, flattenOverWhite } from "../src/engine/annotation-legend";
import { validateSpec } from "../src/spec/validate";
import { TBL } from "../src/engine/theme";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const BASE = {
  chartType: "line",
  title: "t",
  xAxisType: "numeric",
  columns: { x: "time", value: "value" },
} as unknown as ChartSpec;

const DATA: TidyRow[] = [
  { time: "2000", value: "1" },
  { time: "2005", value: "4" },
  { time: "2010", value: "2" },
] as unknown as TidyRow[];

const OPTS = { width: 720, height: 400, document };

const labelTexts = (svg: SVGSVGElement): string[] =>
  Array.from(svg.querySelectorAll("text")).map((t) => t.textContent ?? "");

describe("annotation legend rows", () => {
  it("gives a single-series chart a legend built from annotations alone", () => {
    const spec = {
      ...BASE,
      annotations: {
        bands: [{ start: "2001", end: "2003", label: "Recession", legend: true }],
        yAxis: [{ y: 3, label: "Threshold", legend: true }],
      },
    } as ChartSpec;
    const { legendItems } = renderChart(spec, DATA, OPTS);
    expect(legendItems?.map((i) => i.label)).toEqual(["Recession", "Threshold"]);
  });

  it("emits no rows without the flag, even when the entries carry labels", () => {
    const spec = {
      ...BASE,
      annotations: { bands: [{ start: "2001", end: "2003", label: "Recession" }] },
    } as ChartSpec;
    expect(renderChart(spec, DATA, OPTS).legendItems).toBeNull();
  });

  it("orders rows bands → shading → xAxis → yAxis, after the series rows", () => {
    const spec = {
      ...BASE,
      columns: { x: "time", value: "value", series: "series" },
      series_order: ["A", "B"],
      annotations: {
        bands: [{ start: "2001", end: "2003", label: "Band", legend: true }],
        xAxis: [{ x: "2004", label: "Event", legend: true }],
        yAxis: [{ y: 3, label: "Threshold", legend: true }],
      },
      shading: [{ series: "A", label: "Fill", legend: true }],
    } as ChartSpec;
    const data = [
      ...DATA.map((r) => ({ ...r, series: "A" })),
      ...DATA.map((r) => ({ ...r, series: "B" })),
    ] as unknown as TidyRow[];
    const { legendItems } = renderChart(spec, data, OPTS);
    expect(legendItems?.map((i) => i.label)).toEqual(["A", "B", "Band", "Fill", "Event", "Threshold"]);
  });

  it("collapses entries sharing one label into a single row", () => {
    const spec = {
      ...BASE,
      annotations: {
        bands: [
          { start: "2001", end: "2002", label: "US recessions", color: "grey", legend: true },
          { start: "2007", end: "2009", label: "US recessions", color: "grey", legend: true },
        ],
      },
      shading: [
        { from: "2001", to: "2002", label: "False negatives", color: "amber", legend: true },
        { from: "2007", to: "2008", label: "False negatives", color: "amber", legend: true },
      ],
    } as ChartSpec;
    const { legendItems } = renderChart(spec, DATA, OPTS);
    expect(legendItems?.map((i) => i.label)).toEqual(["US recessions", "False negatives"]);
  });

  it("suppresses the in-chart band label once it is keyed in the legend", () => {
    const withFlag = {
      ...BASE,
      annotations: { bands: [{ start: "2001", end: "2003", label: "Recession", legend: true }] },
    } as ChartSpec;
    const without = {
      ...BASE,
      annotations: { bands: [{ start: "2001", end: "2003", label: "Recession" }] },
    } as ChartSpec;
    expect(labelTexts(renderChart(without, DATA, OPTS).svg)).toContain("Recession");
    expect(labelTexts(renderChart(withFlag, DATA, OPTS).svg)).not.toContain("Recession");
  });

  it("suppresses the in-chart reference-line label too", () => {
    const spec = {
      ...BASE,
      annotations: {
        xAxis: [{ x: "2004", label: "Policy change", legend: true }],
        yAxis: [{ y: 3, label: "Threshold (3)", legend: true }],
      },
    } as ChartSpec;
    const { svg } = renderChart(spec, DATA, OPTS);
    const texts = labelTexts(svg);
    expect(texts).not.toContain("Policy change");
    expect(texts).not.toContain("Threshold (3)");
    // The rules themselves are untouched — only their labels moved.
    expect(svg.querySelectorAll('g[aria-label="rule"]').length).toBeGreaterThan(0);
  });

  it("keeps drawing the rule when the label is keyed and `legend: false` at chart level", () => {
    const spec = {
      ...BASE,
      legend: false,
      annotations: { yAxis: [{ y: 3, label: "Threshold", legend: true }] },
    } as ChartSpec;
    const { svg, legendItems } = renderChart(spec, DATA, OPTS);
    expect(legendItems).toBeNull();
    // With no legend to move it to, the in-chart label stays — the alternative is losing it.
    expect(labelTexts(svg)).toContain("Threshold");
  });

  it("`legend: false` on one entry suppresses only that row", () => {
    const spec = {
      ...BASE,
      annotations: {
        bands: [
          { start: "2001", end: "2002", label: "Kept", legend: true },
          { start: "2007", end: "2008", label: "Dropped", legend: false, rug: true },
        ],
      },
      rug: {},
    } as ChartSpec;
    expect(renderChart(spec, DATA, OPTS).legendItems?.map((i) => i.label)).toEqual(["Kept"]);
  });
});

describe("annotation legend swatches", () => {
  const colors = new Map([["A", "#1f4e79"]]);

  it("keys a fill by its tint flattened over white, not its full-strength hue", () => {
    const spec = {
      ...BASE,
      shading: [{ label: "Fill", legend: true, color: "#ff0000", fillOpacity: 0.5 }],
    } as ChartSpec;
    const [row] = buildAnnotationLegendItems(spec, ["A"], colors);
    expect(row?.markerShape).toBe("rect");
    expect(row?.color).toBe("#ff8080");
    expect(row?.outlined).toBe(true);
  });

  it("keys a rug-flagged entry by its SOLID block color", () => {
    const spec = {
      ...BASE,
      shading: [{ label: "Fill", rug: true, from: "2001", to: "2002", color: "#ff0000", fillOpacity: 0.3 }],
      rug: {},
    } as ChartSpec;
    const [row] = buildAnnotationLegendItems(spec, ["A"], colors);
    expect(row?.color).toBe("#ff0000");
  });

  it("falls back to the first series' color for a fill that names none", () => {
    const spec = { ...BASE, shading: [{ label: "Fill", legend: true, fillOpacity: 1 }] } as ChartSpec;
    const [row] = buildAnnotationLegendItems(spec, ["A"], colors);
    expect(row?.color).toBe("#1f4e79");
  });

  it("keys a reference line with a line swatch, dashed by default", () => {
    const spec = {
      ...BASE,
      annotations: {
        yAxis: [
          { y: 1, label: "Dashed", legend: true },
          { y: 2, label: "Solid", legend: true, style: "solid", color: "grey" },
        ],
      },
    } as ChartSpec;
    const rows = buildAnnotationLegendItems(spec, ["A"], colors);
    expect(rows.map((r) => [r.markerShape, r.dashed])).toEqual([
      ["line", true],
      ["line", false],
    ]);
    expect(rows[0]?.color).toBe(TBL.color.annotationDim);
  });

  it("flattenOverWhite passes non-hex colors through untouched", () => {
    expect(flattenOverWhite("currentColor", 0.5)).toBe("currentColor");
    expect(flattenOverWhite("#000000", 0)).toBe("#ffffff");
    expect(flattenOverWhite("#000000", 1)).toBe("#000000");
  });
});

describe("annotation legend interaction", () => {
  it("renders annotation rows as non-interactive spans with no data-series", () => {
    const spec = {
      ...BASE,
      annotations: { bands: [{ start: "2001", end: "2003", label: "Recession", legend: true }] },
    } as ChartSpec;
    const { legendItems, svg } = renderChart(spec, DATA, OPTS);
    const parent = document.createElement("div");
    const handle = renderLegend(parent, legendItems ?? [], { svg });
    const row = parent.querySelector(".tbl-legend-item");
    expect(row?.tagName.toLowerCase()).toBe("span");
    expect((row as HTMLElement).dataset.series).toBeUndefined();
    expect(handle?.pinnedSeries()).toEqual([]);
    expect(parent.querySelector(".tbl-legend-swatch.is-rect.is-outlined")).not.toBeNull();
  });
});

describe("legend/rug flag validation", () => {
  it("rejects `legend: true` with no label", () => {
    const spec = {
      ...BASE,
      data: "d.csv",
      annotations: { bands: [{ start: "2001", end: "2003", legend: true }] },
    };
    const res = validateSpec(spec);
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/needs a `label`/);
  });

  it("accepts a labelled, flagged band", () => {
    const spec = {
      ...BASE,
      data: "d.csv",
      annotations: { bands: [{ start: "2001", end: "2003", label: "R", legend: true }] },
    };
    expect(validateSpec(spec).valid).toBe(true);
  });
});

describe("keyed labels and the {value} token", () => {
  it("substitutes the token in the legend row, formatted like the value axis", () => {
    const spec = {
      ...BASE,
      annotations: { yAxis: [{ y: 2.5, label: "Target ({value})", legend: true }] },
      value_suffix: "%",
    } as ChartSpec;
    // The axis ticks for 1–4 carry one decimal, so the token renders "2.5%" — exactly what the
    // in-frame label would have shown.
    const { legendItems } = renderChart(spec, [
      { time: "2000", value: "1.5" },
      { time: "2010", value: "4.5" },
    ] as unknown as TidyRow[], OPTS);
    expect(legendItems?.[0]?.label).toBe("Target (2.5%)");
  });

  it("honors a per-marker value_format over the axis format", () => {
    const spec = {
      ...BASE,
      annotations: {
        yAxis: [{ y: 2.5, label: "Target ({value})", legend: true, value_format: { decimals: 2, prefix: "$" } }],
      },
    } as ChartSpec;
    expect(renderChart(spec, DATA, OPTS).legendItems?.[0]?.label).toBe("Target ($2.50)");
  });
});
