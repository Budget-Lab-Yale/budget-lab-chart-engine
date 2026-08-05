// @vitest-environment jsdom
//
// Legend rows for things that are not series: `annotations.bands`, `annotations.xAxis`/`yAxis`
// reference lines, and `shading` fills opted in with `legend: true`. Locks the three behaviors the
// feature exists for — the row appears, the in-chart label goes away, and entries sharing a label
// collapse to one row — plus the swatch tinting and the interaction opt-out.
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import { renderLegend } from "../src/engine/legend";
import { buildAnnotationLegendItems, flattenOverWhite, annotationKey } from "../src/engine/annotation-legend";
import { SHADE_CLASS } from "../src/engine/marks/line";
import { TBL_COLORS } from "../src/engine/palette";
import { validateSpec } from "../src/spec/validate";
import { TBL, swatchWidthFor } from "../src/engine/theme";
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
  it("renders annotation rows as buttons keyed on data-annotation, not data-series", () => {
    const spec = {
      ...BASE,
      annotations: { bands: [{ start: "2001", end: "2003", label: "Recession", legend: true }] },
    } as ChartSpec;
    const { legendItems, svg } = renderChart(spec, DATA, OPTS);
    const parent = document.createElement("div");
    const handle = renderLegend(parent, legendItems ?? [], { svg });
    const row = parent.querySelector<HTMLElement>(".tbl-legend-item");
    expect(row?.tagName.toLowerCase()).toBe("button");
    expect(row?.dataset.annotation).toBe(annotationKey("Recession"));
    expect(row?.dataset.series).toBeUndefined();
    // Annotation pins live in their own dimension, so the area-restack / value-pill consumers of
    // pinnedSeries() never see them.
    row?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(handle?.pinnedSeries()).toEqual([]);
    expect(row?.classList.contains("is-pinned")).toBe(true);
    expect(parent.querySelector(".tbl-legend-swatch.is-rect.is-outlined")).not.toBeNull();
  });
});

describe("reciprocal annotation highlight", () => {
  // Two labelled tracks that also produce in-frame marks + rug blocks, plus a series line to dim.
  const SPEC = {
    ...BASE,
    annotations: {
      bands: [
        { start: "2001", end: "2002", color: "grey", label: "US recessions", rug: true },
        { start: "2007", end: "2008", color: "grey", label: "US recessions", rug: true },
      ],
      yAxis: [{ y: 3, label: "Threshold", color: "grey", legend: true }],
    },
    shading: [
      { from: "2001", to: "2002", label: "False negatives", color: "amber", rug: true },
    ],
    rug: {},
  } as ChartSpec;

  const RECESSIONS = annotationKey("US recessions");
  const FALSE_NEG = annotationKey("False negatives");

  const mount = () => {
    const { legendItems, svg } = renderChart(SPEC, DATA, OPTS);
    const parent = document.createElement("div");
    const handle = renderLegend(parent, legendItems ?? [], { svg })!;
    return { handle, parent, svg };
  };
  const dimmed = (svg: SVGSVGElement, selector: string): boolean[] =>
    Array.from(svg.querySelectorAll(selector)).map((el) => el.classList.contains("tbl-dimmed"));
  const rowFor = (parent: HTMLElement, key: string): HTMLElement =>
    parent.querySelector<HTMLElement>(`.tbl-legend-item[data-annotation="${key}"]`)!;

  it("tags every chart element a row names with that row's key", () => {
    const { svg } = mount();
    const keys = Array.from(svg.querySelectorAll("[data-annotation]")).map((el) =>
      el.getAttribute("data-annotation"),
    );
    // Two band rects + one shading fill + one threshold rule + three rug blocks (2 grey, 1 gold).
    expect(keys.filter((k) => k === RECESSIONS).length).toBe(4);
    expect(keys.filter((k) => k === FALSE_NEG).length).toBe(2);
    expect(keys.filter((k) => k === annotationKey("Threshold")).length).toBe(1);
  });

  it("keeps the series key on a keyed shading fill, so it still dims with its line", () => {
    const { svg } = mount();
    const fill = svg.querySelector(`g.${SHADE_CLASS} path`);
    expect(fill?.getAttribute("data-annotation")).toBe(FALSE_NEG);
    expect(fill?.getAttribute("data-series")).not.toBeNull();
  });

  it("legend → chart: hovering a row brightens its parts and dims the rest", () => {
    const { handle, parent, svg } = mount();
    rowFor(parent, RECESSIONS).dispatchEvent(new window.PointerEvent("pointerenter"));
    // Its own elements stay bright...
    expect(dimmed(svg, `[data-annotation="${RECESSIONS}"]`)).not.toContain(true);
    // ...while the other annotations and the data line drop back.
    expect(dimmed(svg, `[data-annotation="${FALSE_NEG}"]`)).not.toContain(false);
    expect(dimmed(svg, 'g[aria-label="line"] path')).not.toContain(false);
    rowFor(parent, RECESSIONS).dispatchEvent(new window.PointerEvent("pointerleave"));
    expect(dimmed(svg, "[data-annotation]")).not.toContain(true);
    expect(handle.pinnedSeries()).toEqual([]);
  });

  it("chart → legend: hoverAnnotation lights the row and its parts", () => {
    const { handle, parent, svg } = mount();
    handle.hoverAnnotation(FALSE_NEG);
    expect(rowFor(parent, FALSE_NEG).classList.contains("is-hovered")).toBe(true);
    expect(rowFor(parent, RECESSIONS).classList.contains("is-hovered")).toBe(false);
    expect(dimmed(svg, `[data-annotation="${FALSE_NEG}"]`)).not.toContain(true);
    expect(dimmed(svg, `[data-annotation="${RECESSIONS}"]`)).not.toContain(false);
    handle.hoverAnnotation(null);
    expect(dimmed(svg, "[data-annotation]")).not.toContain(true);
  });

  it("ignores an unknown annotation key", () => {
    const { handle, svg } = mount();
    handle.hoverAnnotation("__annotation:nope");
    expect(dimmed(svg, "[data-annotation]")).not.toContain(true);
    handle.toggleAnnotation("__annotation:nope");
    expect(dimmed(svg, "[data-annotation]")).not.toContain(true);
  });

  it("toggleAnnotation pins the highlight, and the reset button clears it", () => {
    const { handle, parent, svg } = mount();
    handle.toggleAnnotation(RECESSIONS);
    expect(dimmed(svg, `[data-annotation="${FALSE_NEG}"]`)).not.toContain(false);
    const reset = parent.querySelector<HTMLButtonElement>(".tbl-legend-reset")!;
    expect(reset.hidden).toBe(false);
    reset.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(dimmed(svg, "[data-annotation]")).not.toContain(true);
    expect(reset.hidden).toBe(true);
  });

  it("a series row dims the annotations too — one universe, not two", () => {
    const spec = {
      ...SPEC,
      columns: { x: "time", value: "value", series: "series" },
      series_order: ["A", "B"],
    } as ChartSpec;
    const data = [
      ...DATA.map((r) => ({ ...r, series: "A" })),
      ...DATA.map((r) => ({ ...r, series: "B" })),
    ] as unknown as TidyRow[];
    const { legendItems, svg } = renderChart(spec, data, OPTS);
    const parent = document.createElement("div");
    renderLegend(parent, legendItems ?? [], { svg });
    parent
      .querySelector<HTMLElement>('.tbl-legend-item[data-series="A"]')!
      .dispatchEvent(new window.PointerEvent("pointerenter"));
    expect(dimmed(svg, `[data-annotation="${RECESSIONS}"]`)).not.toContain(false);
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

describe("multi-series charts with shaded areas", () => {
  const BASE_MS = {
    ...BASE,
    columns: { x: "time", value: "value", series: "series" },
    series_order: ["A", "B", "C"],
  } as ChartSpec;
  const ROWS_MS = ["A", "B", "C"].flatMap((s) =>
    [2000, 2010, 2020].map((t) => ({ time: String(t), series: s, value: "-1" })),
  ) as unknown as TidyRow[];
  const key = (spec: ChartSpec) => renderChart(spec, ROWS_MS, OPTS).legendItems ?? [];
  const annRow = (spec: ChartSpec) => key(spec).find((i) => i.annotation)!;

  it("keys one region covering every series with ONE row showing every tint", () => {
    const spec = { ...BASE_MS, shading: [{ label: "Below zero", legend: true }] } as ChartSpec;
    const rows = key(spec);
    expect(rows.filter((i) => i.annotation).length).toBe(1);
    // Three fills get painted, one per series, so the chip carries three tints in series order.
    expect(annRow(spec).colors?.length).toBe(3);
  });

  it("collapses per-series regions sharing a label into that same one row", () => {
    const perSeries = {
      ...BASE_MS,
      shading: ["A", "B", "C"].map((s) => ({ series: s, label: "Below zero", legend: true })),
    } as ChartSpec;
    const shared = { ...BASE_MS, shading: [{ label: "Below zero", legend: true }] } as ChartSpec;
    // The two ways to write the same thing key identically.
    expect(annRow(perSeries).colors).toEqual(annRow(shared).colors);
  });

  it("keys a region by the series it NAMES, not by the first series", () => {
    const spec = {
      ...BASE_MS,
      shading: [{ series: "C", label: "C shortfall", legend: true, fillOpacity: 1 }],
    } as ChartSpec;
    const row = annRow(spec);
    expect(row.colors).toBeUndefined(); // one fill, one tint
    const { colors } = renderChart(spec, ROWS_MS, OPTS);
    expect(row.color).toBe(colors.get("C"));
  });

  it("an explicit color overrides the per-series tints", () => {
    const spec = {
      ...BASE_MS,
      shading: [{ label: "Below zero", legend: true, color: "grey", fillOpacity: 1 }],
    } as ChartSpec;
    expect(annRow(spec).colors).toBeUndefined();
    expect(annRow(spec).color).toBe(TBL_COLORS.grey);
  });

  it("keeps a rect and a rule that share a label as separate rows", () => {
    const spec = {
      ...BASE_MS,
      shading: [{ label: "Balance", legend: true }],
      annotations: { yAxis: [{ y: 0, label: "Balance", legend: true }] },
    } as ChartSpec;
    expect(key(spec).filter((i) => i.annotation).map((i) => i.markerShape)).toEqual(["rect", "line"]);
  });

  it("a keyed fill keeps its own series key, so it stays with its line", () => {
    const spec = { ...BASE_MS, shading: [{ label: "Below zero", legend: true }] } as ChartSpec;
    const { svg } = renderChart(spec, ROWS_MS, OPTS);
    const fills = Array.from(svg.querySelectorAll(`g.${SHADE_CLASS} path`));
    expect(fills.map((f) => f.getAttribute("data-series"))).toEqual(["A", "B", "C"]);
    expect(new Set(fills.map((f) => f.getAttribute("data-annotation")))).toEqual(
      new Set([annotationKey("Below zero")]),
    );
  });

  it("renders the multi-tint chip as banded hard stops", () => {
    const spec = { ...BASE_MS, shading: [{ label: "Below zero", legend: true }] } as ChartSpec;
    const { legendItems, svg } = renderChart(spec, ROWS_MS, OPTS);
    const parent = document.createElement("div");
    renderLegend(parent, legendItems ?? [], { svg });
    const chip = parent.querySelector<HTMLElement>(
      `.tbl-legend-item[data-annotation] .tbl-legend-swatch.is-rect`,
    )!;
    expect(chip.style.background).toContain("linear-gradient");
    expect(chip.style.background.match(/33\.3333%/g)?.length).toBe(2);
  });
});

describe("keyed annotations on point / dumbbell charts", () => {
  // These chart types build their legend rows on their own branch. Before the fix that branch
  // RETURNED, so the annotation rows were never appended — while assemble-plot still suppressed the
  // in-frame label (it asks the spec, not the legend), losing the name from the chart entirely.
  const cases: Array<[string, ChartSpec, TidyRow[]]> = [
    [
      "scatter",
      {
        chartType: "scatter",
        title: "t",
        xAxisType: "numeric",
        columns: { x: "time", value: "value" },
        annotations: { yAxis: [{ y: 3, label: "Target", legend: true }] },
      } as unknown as ChartSpec,
      DATA,
    ],
    [
      "dumbbell",
      {
        chartType: "dumbbell",
        title: "t",
        xAxisType: "categorical",
        columns: { category: "cat", value: "value", series: "series" },
        annotations: { yAxis: [{ y: 3, label: "Target", legend: true }] },
      } as unknown as ChartSpec,
      [
        { cat: "x", series: "A", value: "1" },
        { cat: "x", series: "B", value: "5" },
      ] as unknown as TidyRow[],
    ],
  ];

  for (const [name, spec, rows] of cases) {
    it(`keys the annotation on a single-series ${name} chart`, () => {
      const { legendItems, svg } = renderChart(spec, rows, OPTS);
      expect(legendItems?.map((i) => i.label)).toContain("Target");
      expect(labelTexts(svg)).not.toContain("Target");
    });
  }
});

describe("dead-configuration validation", () => {
  it("rejects a shading label with neither legend nor rug", () => {
    const res = validateSpec({ ...BASE, data: "d.csv", shading: [{ label: "Below zero" }] });
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/has no effect without/);
  });

  it("accepts it once opted in", () => {
    expect(
      validateSpec({ ...BASE, data: "d.csv", shading: [{ label: "Below zero", legend: true }] }).valid,
    ).toBe(true);
  });
});

describe("banded chip width", () => {
  it("grows so each band stays legible, then caps", () => {
    expect(swatchWidthFor(1)).toBe(14);
    expect(swatchWidthFor(3)).toBe(14); // 3 bands already fit the default chip
    expect(swatchWidthFor(7)).toBe(21);
    expect(swatchWidthFor(9)).toBe(27);
    expect(swatchWidthFor(40)).toBe(30); // capped — a chip cannot key forty series
  });

  it("applies the width to the rendered chip", () => {
    const spec = {
      ...BASE,
      columns: { x: "time", value: "value", series: "series" },
      series_order: ["A", "B", "C", "D", "E", "F", "G"],
      shading: [{ label: "Below zero", legend: true }],
    } as ChartSpec;
    const rows = ["A", "B", "C", "D", "E", "F", "G"].flatMap((s) =>
      [2000, 2010].map((t) => ({ time: String(t), series: s, value: "-1" })),
    ) as unknown as TidyRow[];
    const { legendItems, svg } = renderChart(spec, rows, OPTS);
    const parent = document.createElement("div");
    renderLegend(parent, legendItems ?? [], { svg });
    const chip = parent.querySelector<HTMLElement>(
      ".tbl-legend-item[data-annotation] .tbl-legend-swatch.is-rect",
    )!;
    expect(chip.style.width).toBe(`${swatchWidthFor(7)}px`);
  });
});

describe("indistinguishable keyed fills", () => {
  it("rejects two derived-color fills that would key the same", () => {
    const res = validateSpec({
      ...BASE,
      data: "d.csv",
      shading: [
        { side: "negative", label: "Below", legend: true },
        { side: "positive", label: "Above", legend: true },
      ],
    });
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/would key with the SAME legend swatch/);
  });

  it("accepts them once one carries an explicit color", () => {
    expect(
      validateSpec({
        ...BASE,
        data: "d.csv",
        shading: [
          { side: "negative", label: "Below", legend: true, color: "amber" },
          { side: "positive", label: "Above", legend: true },
        ],
      }).valid,
    ).toBe(true);
  });

  it("accepts them when they differ by opacity, or by series scope", () => {
    expect(
      validateSpec({
        ...BASE,
        data: "d.csv",
        shading: [
          { side: "negative", label: "Below", legend: true, fillOpacity: 0.5 },
          { side: "positive", label: "Above", legend: true, fillOpacity: 0.25 },
        ],
      }).valid,
    ).toBe(true);
    expect(
      validateSpec({
        ...BASE,
        data: "d.csv",
        columns: { x: "time", value: "value", series: "series" },
        shading: [
          { series: "A", label: "A below", legend: true },
          { series: "B", label: "B below", legend: true },
        ],
      }).valid,
    ).toBe(true);
  });
});
