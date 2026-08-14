// @vitest-environment jsdom
//
// A tooltip key must be the same drawing as the legend key beside it.
//
// It was not. The legend moved every filled chart type to a square chip and gave a textured series a
// centred glyph, but the LINE/AREA crosshair still drew a flat 18x3 line swatch — so a hatched area
// series showed a chip with a glyph in its legend and a plain line in its tooltip. Two divergences
// in one row: the shape and the texture.
//
// `seriesSwatchHtml` is now the one emitter behind every tooltip path, drawing engine/icon.ts's
// primitives. These assertions therefore read the DRAWING — the elements and their ink — and not the
// markup. They used to be byte-exact against HTML spans with `is-square` / `is-dashed` classes over
// CSS shape rules; that CSS is gone, and a test comparing bytes could only ever be rewritten
// wholesale whenever the emitter changed. `test/key-agreement.test.ts` is the structural gate that
// a key matches its mark; this file pins what each individual shape actually draws.
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import { renderLegend } from "../src/engine/legend";
import {
  buildFacetTooltipHtml,
  buildBandTooltipHtml,
  seriesSwatchHtml,
} from "../src/engine/crosshair";
import { resolveHatch, defaultHatchStroke } from "../src/engine/hatch";
import { ICON_BOX, resolveTooltipIcons, type IconSpec } from "../src/engine/icon";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const OPTS = { width: 640, height: 360, document };
const GROUND = "#58A3E7";

/** The `<svg>` a swatch draws, or null when it draws nothing. */
function swatchSvg(html: string): SVGElement | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.querySelector("svg");
}

/** Every drawn element as `tag:style`, in order — the drawing, independent of attribute spelling. */
function drawing(svg: Element): string[] {
  return [...svg.querySelectorAll("rect, line, circle, path")].map(
    (s) => `${s.tagName.toLowerCase()}:${s.getAttribute("style")}`,
  );
}

describe("seriesSwatchHtml — one emitter for every tooltip key", () => {
  it("draws a line swatch by default", () => {
    const svg = swatchSvg(seriesSwatchHtml({ shape: "line", color: "#0072B2" }))!;
    const line = svg.querySelector("line")!;
    expect(line.getAttribute("style")).toContain("stroke:#0072B2");
    expect(line.getAttribute("stroke-dasharray")).toBeNull();
    // Spans the box, so a line key and a square key weigh the same in a column.
    expect(line.getAttribute("x1")).toBe("0");
    expect(line.getAttribute("x2")).toBe(String(ICON_BOX));
    expect(svg.querySelector("rect")).toBeNull();
  });

  it("dashes the line swatch with the chart's own dash pattern", () => {
    const svg = swatchSvg(seriesSwatchHtml({ shape: "line", color: "#0072B2", dashed: true }))!;
    const line = svg.querySelector("line")!;
    expect(line.getAttribute("stroke-dasharray")).toBeTruthy();
    expect(line.getAttribute("style")).toContain("stroke:#0072B2");
  });

  it("draws a square for a filled mark", () => {
    const svg = swatchSvg(seriesSwatchHtml({ shape: "rect", color: "#0072B2" }))!;
    const rect = svg.querySelector("rect")!;
    expect(rect.getAttribute("style")).toContain("fill:#0072B2");
    expect(rect.getAttribute("width")).toBe(String(ICON_BOX));
    expect(rect.getAttribute("height")).toBe(String(ICON_BOX));
    expect(svg.querySelector("line")).toBeNull();
  });

  it("draws the centred glyph for a textured series, whatever shape was asked for", () => {
    const hatch = resolveHatch("/", GROUND);
    for (const shape of ["line", "rect"] as const) {
      const svg = swatchSvg(seriesSwatchHtml({ shape, color: GROUND, hatch }))!;
      const marks = drawing(svg);
      // The ground, then the glyph's bands in the derived stroke — never a bare line.
      expect(marks[0]).toContain(`fill:${GROUND}`);
      expect(marks.slice(1).join(" ")).toContain(defaultHatchStroke(GROUND));
      expect(marks.length).toBeGreaterThan(1);
    }
  });

  it("still honours the dumbbell's hollow ring", () => {
    const hollow = swatchSvg(seriesSwatchHtml({ shape: "dot", color: "#0072B2", marker: "hollow" }))!;
    const ring = hollow.querySelector("circle")!;
    // Hollow inverts the ink: the ground fills, the series colour becomes the ring.
    expect(ring.getAttribute("style")).toContain("stroke:#0072B2");
    expect(ring.getAttribute("style")).not.toContain("fill:#0072B2");
    expect(Number(ring.getAttribute("stroke-width"))).toBeGreaterThan(0);

    const filled = swatchSvg(seriesSwatchHtml({ shape: "dot", color: "#0072B2" }))!;
    expect(filled.querySelector("circle")!.getAttribute("style")).toContain("fill:#0072B2");
  });

  it("draws nothing for `none`, but keeps the box", () => {
    // A cumulative stack's Total row names no series. The span still has to be there, or its label
    // hangs left of every row above it.
    const html = seriesSwatchHtml({ shape: "none" });
    expect(html).toBe('<span class="tbl-tooltip-swatch"></span>');
  });
});

describe("the line/area tooltip agrees with its legend", () => {
  const AREA_ROWS: TidyRow[] = [
    { time: "2020", series: "plain", value: "3" },
    { time: "2021", series: "plain", value: "4" },
    { time: "2020", series: "textured", value: "2" },
    { time: "2021", series: "textured", value: "5" },
  ] as unknown as TidyRow[];

  const AREA = {
    chartType: "area",
    title: "t",
    xAxisType: "numeric",
    columns: { x: "time", value: "value", series: "series" },
    series_colors: { plain: "blue", textured: "#58A3E7" },
    series_patterns: { textured: "/" },
  } as unknown as ChartSpec;

  const values = new Map([
    ["plain", new Map([[1, 4]])],
    ["textured", new Map([[1, 5]])],
  ]);

  it("shows a square, not a line, on a filled chart type", () => {
    const r = renderChart(AREA, AREA_ROWS, OPTS);
    const html = buildFacetTooltipHtml("pane", "2021", values, 1, {
      yFormat: String,
      icons: resolveTooltipIcons({ legendItems: r.legendItems, keyRows: r.seriesKeyRows }),
    });
    const doc = new DOMParser().parseFromString(html, "text/html");
    const svgs = [...doc.querySelectorAll(".tbl-tooltip-swatch svg")];
    expect(svgs).toHaveLength(2);
    // The untextured row is a bare square. (The textured one is a square GROUND under a glyph, whose
    // `/` band is drawn as a diagonal <line> — checked as a drawing by the next test.)
    expect(svgs[0]!.querySelector("rect")).not.toBeNull();
    expect(svgs[0]!.querySelector("line")).toBeNull();
    expect(svgs[1]!.querySelector("rect")).not.toBeNull();
  });

  it("carries the texture, so the row matches the key the reader just read", () => {
    const r = renderChart(AREA, AREA_ROWS, OPTS);
    const item = r.legendItems!.find((i) => i.series === "textured")!;
    const html = buildFacetTooltipHtml("pane", "2021", values, 1, {
      yFormat: String,
      icons: resolveTooltipIcons({ legendItems: r.legendItems, keyRows: r.seriesKeyRows }),
    });
    // The textured row carries the glyph's bands; the plain row is one flat rect.
    const rows = html.split('<div class="tbl-tooltip-row"').slice(1);
    const marksIn = (row: string) => drawing(swatchSvg(row)!);
    const textured = marksIn(rows.find((r) => r.includes("textured"))!);
    const plain = marksIn(rows.find((r) => r.includes("plain"))!);
    expect(textured.join(" ")).toContain(item.hatch!.stroke);
    expect(textured.length).toBeGreaterThan(1);
    expect(plain).toHaveLength(1);
  });

  it("renders the SAME glyph markup the legend renders — one drawing, not two", () => {
    const r = renderChart(AREA, AREA_ROWS, OPTS);

    const parent = document.createElement("div");
    renderLegend(parent, r.legendItems!);
    const legendGlyph = parent.querySelector('[data-series="textured"] .tbl-legend-swatch svg')!;

    const html = buildFacetTooltipHtml("pane", "2021", values, 1, {
      yFormat: String,
      icons: resolveTooltipIcons({ legendItems: r.legendItems, keyRows: r.seriesKeyRows }),
    });
    const rows = html.split('<div class="tbl-tooltip-row"').slice(1);
    const tooltipGlyph = swatchSvg(rows.find((r) => r.includes("textured"))!)!;

    expect(drawing(tooltipGlyph)).toEqual(drawing(legendGlyph));
  });

  it("leaves a plain LINE chart's tooltip a line", () => {
    const spec = {
      chartType: "line",
      title: "t",
      xAxisType: "numeric",
      columns: { x: "time", value: "value", series: "series" },
      series_colors: { plain: "blue" },
    } as unknown as ChartSpec;
    // ONE series, so this chart draws no legend at all — the key comes from `seriesKeyRows`, the
    // row the legend WOULD have drawn. Before the consolidation this reached a separate synthesised
    // default inside the tooltip builder, which is the path that drifted.
    const r = renderChart(spec, AREA_ROWS.filter((row) => row.series === "plain"), OPTS);
    expect(r.legendItems).toBeNull();
    const html = buildFacetTooltipHtml("pane", "2021", new Map([["plain", new Map([[1, 4]])]]), 1, {
      yFormat: String,
      icons: resolveTooltipIcons({ legendItems: r.legendItems, keyRows: r.seriesKeyRows }),
    });
    const svg = swatchSvg(html)!;
    expect(svg.querySelector("line")).not.toBeNull();
    expect(svg.querySelector("rect")).toBeNull();
  });
});

describe("the band tooltip is unchanged by the shared emitter", () => {
  const ROWS = [
    { _xc: "A", series: "flat", _y: 6 },
    { _xc: "A", series: "textured", _y: 4 },
  ];
  const ICONS = new Map<string, IconSpec>([
    ["flat", { shape: "rect", color: "#0072B2" }],
    ["textured", { shape: "rect", color: GROUND }],
  ]);

  it("keeps the square swatch for a bar series", () => {
    const html = buildBandTooltipHtml("A", ROWS, { icons: ICONS });
    const svg = swatchSvg(html)!;
    expect(svg.querySelector("rect")!.getAttribute("style")).toContain("fill:#0072B2");
  });

  it("keeps the Total row's circle for a diverging stack", () => {
    const html = buildBandTooltipHtml("A", ROWS, {
      isStacked: true,
      showTotalDot: true,
      icons: ICONS,
    });
    const doc = new DOMParser().parseFromString(html, "text/html");
    // The Total row keys the net-dot marker, so it must actually DRAW the ring. It carried a bare
    // `is-dot` class after the CSS behind it was deleted — a class name over an empty box.
    const total = doc.querySelector(".tbl-tooltip-row--total .tbl-tooltip-swatch svg circle")!;
    expect(total).not.toBeNull();
    expect(total.getAttribute("style")).toContain("stroke:");
  });

  it("still carries a hatch glyph", () => {
    const html = buildBandTooltipHtml("A", ROWS, {
      icons: new Map<string, IconSpec>([
        ...ICONS,
        ["textured", { shape: "rect", color: GROUND, hatch: resolveHatch("/", GROUND) }],
      ]),
    });
    const rows = html.split('<div class="tbl-tooltip-row"').slice(1);
    const textured = drawing(swatchSvg(rows.find((r) => r.includes("textured"))!)!);
    expect(textured.length).toBeGreaterThan(1);
    expect(textured.join(" ")).toContain(defaultHatchStroke(GROUND));
  });
});
