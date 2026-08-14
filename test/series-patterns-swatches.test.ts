// @vitest-environment jsdom
//
// A texture that reaches the bars but not the key is worse than no texture: the legend then
// asserts a distinction the chart draws differently. Three surfaces have to carry it — the HTML
// legend swatch, the HTML tooltip swatch, and the PNG export's own SVG legend chip (the export
// composes its chrome from scratch rather than cloning the page's).
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import { renderLegend } from "../src/engine/legend";
import { defaultHatchStroke, resolveHatch } from "../src/engine/hatch";
import { buildBandTooltipHtml } from "../src/engine/crosshair";
import { ICON_BOX, type IconSpec } from "../src/engine/icon";
import { CHART_CSS } from "../src/embed/styles";
import { FILLED_CHART_TYPES } from "../src/spec/filled-chart-types";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const ROWS: TidyRow[] = [
  { time: "Bottom 50%", series: "collectedNew", value: "3" },
  { time: "Bottom 50%", series: "lostToBehavior", value: "1" },
  { time: "Top 1%", series: "collectedNew", value: "7" },
  { time: "Top 1%", series: "lostToBehavior", value: "4" },
] as unknown as TidyRow[];

const SPEC = {
  chartType: "stacked",
  title: "Distribution",
  xAxisType: "categorical",
  columns: { x: "time", value: "value", series: "series" },
  series_colors: { collectedNew: "blue", lostToBehavior: "#58A3E7" },
  series_patterns: { lostToBehavior: "/" },
} as unknown as ChartSpec;

const OPTS = { width: 720, height: 400, document };
const GROUND = "#58A3E7";
const EXPECTED = resolveHatch("/", GROUND);

describe("the legend swatch", () => {
  it("carries the texture on the textured series and nothing on the others", () => {
    const items = renderChart(SPEC, ROWS, OPTS).legendItems!;
    const parent = document.createElement("div");
    renderLegend(parent, items);

    const swatchFor = (series: string) =>
      parent.querySelector<HTMLElement>(`[data-series="${series}"] .tbl-legend-swatch`)!;

    // The textured key is a ground plus the glyph's bands; the flat one is that ground alone. Both
    // are SVG now, so the difference is the number of shapes drawn, not the presence of an <svg>.
    const shapesIn = (series: string) => swatchFor(series).querySelector("svg")!.children.length;
    expect(shapesIn("lostToBehavior")).toBeGreaterThan(1);
    expect(shapesIn("collectedNew")).toBe(1);
  });

  it("draws the key's band over the series' own ground and derived band colour", () => {
    const items = renderChart(SPEC, ROWS, OPTS).legendItems!;
    const parent = document.createElement("div");
    renderLegend(parent, items);
    const svg = parent.querySelector('[data-series="lostToBehavior"] .tbl-legend-swatch svg')!;
    const shapes = [...svg.querySelectorAll("rect, line")];
    expect(shapes[0]!.getAttribute("style")).toContain(GROUND);
    expect(shapes[1]!.getAttribute("style")).toContain(defaultHatchStroke(GROUND));
  });

  it("puts the resolved hatch on the legend item, so every consumer sees the same thing", () => {
    const { legendItems } = renderChart(SPEC, ROWS, OPTS);
    const item = legendItems!.find((i) => i.series === "lostToBehavior")!;
    expect(item.hatch).toEqual({
      char: "/",
      ground: GROUND,
      stroke: defaultHatchStroke(GROUND),
      id: expect.stringMatching(/^tblhatch-fwd-/),
    });
    expect(legendItems!.find((i) => i.series === "collectedNew")!.hatch).toBeUndefined();
  });

  it("omits the hatch entirely when the spec declares none", () => {
    const { series_patterns, ...plain } = SPEC as unknown as Record<string, unknown>;
    const items = renderChart(plain as unknown as ChartSpec, ROWS, OPTS).legendItems!;
    for (const item of items) expect(item.hatch).toBeUndefined();
  });
});

describe("the tooltip swatch", () => {
  const TIP_ROWS = [
    { _xc: "Top 1%", series: "collectedNew", _y: 7 },
    { _xc: "Top 1%", series: "lostToBehavior", _y: 4 },
  ];
  // The resolved keys the live layer hands the tooltip — one textured, one flat.
  const ICONS = new Map<string, IconSpec>([
    ["collectedNew", { shape: "rect", color: "#0072B2" }],
    ["lostToBehavior", { shape: "rect", color: GROUND, hatch: EXPECTED }],
  ]);
  const FLAT_ICONS = new Map<string, IconSpec>([
    ["collectedNew", { shape: "rect", color: "#0072B2" }],
    ["lostToBehavior", { shape: "rect", color: GROUND }],
  ]);

  it("carries the same texture as the legend and the mark", () => {
    const html = buildBandTooltipHtml("Top 1%", TIP_ROWS, {
      isStacked: true,
      icons: ICONS,
    });
    // The same inline-SVG glyph the legend key uses.
    expect(html).toContain("<svg");
    expect(html).toContain(defaultHatchStroke(GROUND));
  });

  it("leaves an untextured series as a plain colour fill", () => {
    const html = buildBandTooltipHtml("Top 1%", TIP_ROWS, {
      isStacked: true,
      icons: ICONS,
    });
    const collectedRow = html
      .split('<div class="tbl-tooltip-row"')
      .find((chunk) => chunk.includes("collectedNew"))!;
    const svg = new DOMParser().parseFromString(collectedRow, "text/html").querySelector("svg")!;
    // One shape, its own colour: a flat chip, with none of the glyph's bands over it.
    expect(svg.children).toHaveLength(1);
    expect(svg.firstElementChild!.getAttribute("style")).toContain("#0072B2");
  });

  it("draws every key flat when no textures are passed at all", () => {
    const html = buildBandTooltipHtml("Top 1%", TIP_ROWS, {
      isStacked: true,
      icons: FLAT_ICONS,
    });
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const svg of doc.querySelectorAll(".tbl-tooltip-swatch svg")) {
      expect(svg.children).toHaveLength(1);
    }
  });
});

// Two gaps the glyph work exposed, both in the feature as shipped rather than pre-existing.
describe("a textured series is keyed by a chip on any chart type", () => {
  const AREA_ROWS: TidyRow[] = [
    { time: "2020", series: "plain", value: "1" },
    { time: "2021", series: "plain", value: "2" },
    { time: "2020", series: "textured", value: "1" },
    { time: "2021", series: "textured", value: "3" },
  ] as unknown as TidyRow[];

  const AREA = {
    chartType: "area",
    title: "t",
    xAxisType: "numeric",
    columns: { x: "time", value: "value", series: "series" },
    series_colors: { plain: "blue", textured: "amber" },
    series_patterns: { textured: "/" },
  } as unknown as ChartSpec;

  it("keys EVERY area series with a chip, so one legend is not half lines and half squares", () => {
    // An area mark is a filled region, so a line swatch always misrepresented it — and a 3px line
    // cannot hold the glyph, so a hatched area series had no way to show its texture in the key.
    // Keying only the textured ones as chips would have split a single legend between two shapes.
    const { legendItems } = renderChart(AREA, AREA_ROWS, OPTS);
    for (const item of legendItems!) {
      expect(item.markerShape, `series ${item.series}`).toBe("rect");
    }
  });

  it("draws the glyph in that chip", () => {
    const { legendItems } = renderChart(AREA, AREA_ROWS, OPTS);
    const parent = document.createElement("div");
    renderLegend(parent, legendItems!);
    const swatch = parent.querySelector<HTMLElement>('[data-series="textured"] .tbl-legend-swatch')!;
    expect(swatch.querySelector("svg")!.children.length).toBeGreaterThan(1);
  });

  it("gives flat and textured keys the SAME box, so a mixed legend lines up", () => {
    // A 14x12 flat chip beside a 14x14 textured one reads as sloppy in a row of keys. The shapes
    // shared one box only by coincidence before — two hand-written CSS rules that happened to agree.
    // There is one box now, and the CSS interpolates it, so this checks the two cannot drift apart:
    // the boxes the drawings declare, and the box the stylesheet reserves for them.
    const { legendItems } = renderChart(AREA, AREA_ROWS, OPTS);
    const parent = document.createElement("div");
    renderLegend(parent, legendItems!);
    const boxes = [...parent.querySelectorAll(".tbl-legend-swatch svg")].map((s) => [
      s.getAttribute("width"),
      s.getAttribute("height"),
    ]);
    expect(boxes.length).toBeGreaterThan(1);
    // Square, so `|` and `-` carry equal weight in the glyph — and the same square for every key.
    for (const box of boxes) expect(box).toEqual([String(ICON_BOX), String(ICON_BOX)]);

    // The CSS box is the same constant, in both the legend's rule and the tooltip's.
    for (const cls of ["tbl-legend-swatch", "tbl-tooltip-swatch"]) {
      const rule = new RegExp(`\\.${cls}\\s*\\{[^}]*\\}`).exec(CHART_CSS)![0];
      expect(/width:\s*(\d+)px/.exec(rule)?.[1]).toBe(String(ICON_BOX));
      expect(/height:\s*(\d+)px/.exec(rule)?.[1]).toBe(String(ICON_BOX));
    }
  });
});

describe("every filled chart type keys with a chip", () => {
  // The tie that stops a texture disappearing from a key: a chart type that ACCEPTS series_patterns
  // must key with a chip, because a line swatch is 3px tall and cannot hold the glyph. Asserted
  // against the very set validate.ts uses to decide what may be textured, so adding a filled chart
  // type to one and not the other fails here rather than shipping a blank key.
  const LEGEND_BEARING: Array<{ chartType: string; xAxisType: string }> = [
    { chartType: "bar", xAxisType: "categorical" },
    { chartType: "stacked", xAxisType: "categorical" },
    { chartType: "area", xAxisType: "numeric" },
    { chartType: "histogram", xAxisType: "numeric" },
  ];

  it("covers every filled type that can produce a multi-series legend", () => {
    const covered = new Set(LEGEND_BEARING.map((c) => c.chartType));
    for (const t of FILLED_CHART_TYPES) {
      // waterfall is single-series by construction, so it has no series legend to check.
      if (t === "waterfall") continue;
      expect(covered.has(t), `${t} is filled but untested here`).toBe(true);
    }
  });

  it("uses a rect swatch on each of them, textured or not", () => {
    for (const { chartType, xAxisType } of LEGEND_BEARING) {
      const spec = {
        chartType,
        title: "t",
        xAxisType,
        columns: { x: "time", value: "value", series: "series" },
        series_colors: { a: "blue", b: "amber" },
        ...(chartType === "histogram" ? { histogram: { bins: 4 } } : {}),
      } as unknown as ChartSpec;
      const rows = [
        { time: "1", series: "a", value: "3" },
        { time: "2", series: "a", value: "4" },
        { time: "3", series: "b", value: "2" },
        { time: "4", series: "b", value: "5" },
      ] as unknown as TidyRow[];
      const { legendItems } = renderChart(spec, rows, OPTS);
      expect(legendItems, `${chartType} produced no legend`).toBeTruthy();
      for (const item of legendItems!.filter((i) => !i.annotation)) {
        expect(item.markerShape, `${chartType} / ${item.series}`).toBe("rect");
      }
    }
  });
});
