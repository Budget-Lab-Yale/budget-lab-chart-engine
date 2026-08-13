// @vitest-environment jsdom
//
// A tooltip key must be the same drawing as the legend key beside it.
//
// It was not. The legend moved every filled chart type to a square chip and gave a textured series a
// centred glyph, but the LINE/AREA crosshair still drew a flat 18x3 line swatch — so a hatched area
// series showed a chip with a glyph in its legend and a plain line in its tooltip. Two divergences
// in one row: the shape and the texture.
//
// The cause is structural: five separate renderers each re-derive a swatch from raw option bags
// instead of consuming the resolved icon, so every new channel has to be threaded into each by hand.
// This locks the two line paths. `seriesSwatchHtml` is now the one emitter behind all three tooltip
// paths, which is as far as the fix goes — the full single-source-of-truth refactor is its own job.
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import { renderLegend } from "../src/engine/legend";
import {
  buildFacetTooltipHtml,
  buildBandTooltipHtml,
  seriesSwatchHtml,
} from "../src/engine/crosshair";
import { resolveHatch, defaultHatchStroke } from "../src/engine/hatch";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const OPTS = { width: 640, height: 360, document };
const GROUND = "#58A3E7";

describe("seriesSwatchHtml — one emitter for every tooltip key", () => {
  it("draws a line swatch by default, exactly as before", () => {
    expect(seriesSwatchHtml({ shape: "line", color: "#0072B2" })).toBe(
      '<span class="tbl-tooltip-swatch" style="background: #0072B2"></span>',
    );
  });

  it("keeps the dashed line swatch's custom-property form", () => {
    expect(seriesSwatchHtml({ shape: "line", color: "#0072B2", dashed: true })).toBe(
      '<span class="tbl-tooltip-swatch is-dashed" style="--swatch-color: #0072B2"></span>',
    );
  });

  it("draws a square for a filled mark", () => {
    expect(seriesSwatchHtml({ shape: "rect", color: "#0072B2" })).toBe(
      '<span class="tbl-tooltip-swatch is-square" style="background: #0072B2"></span>',
    );
  });

  it("draws the centred glyph for a textured series, whatever shape was asked for", () => {
    const hatch = resolveHatch("/", GROUND);
    for (const shape of ["line", "rect"] as const) {
      const html = seriesSwatchHtml({ shape, color: GROUND, hatch });
      expect(html).toContain("is-hatched");
      expect(html).toContain("<svg");
      expect(html).toContain(GROUND);
      expect(html).toContain(defaultHatchStroke(GROUND));
    }
  });

  it("still honours the dumbbell's hollow ring", () => {
    const hollow = seriesSwatchHtml({ shape: "dot", color: "#0072B2", hollow: true });
    expect(hollow).toContain("border-radius:50%");
    expect(hollow).toContain("border:2px solid #0072B2");
    expect(seriesSwatchHtml({ shape: "dot", color: "#0072B2" })).toContain("background:#0072B2");
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
    const { colors } = renderChart(AREA, AREA_ROWS, OPTS);
    const html = buildFacetTooltipHtml("pane", "2021", values, 1, {
      colors,
      yFormat: String,
      swatchShape: "rect",
    });
    expect(html).toContain("is-square");
    expect(html).not.toMatch(/class="tbl-tooltip-swatch"/);
  });

  it("carries the texture, so the row matches the key the reader just read", () => {
    const { legendItems, colors } = renderChart(AREA, AREA_ROWS, OPTS);
    const item = legendItems!.find((i) => i.series === "textured")!;
    const html = buildFacetTooltipHtml("pane", "2021", values, 1, {
      colors,
      yFormat: String,
      swatchShape: "rect",
      hatches: new Map([["textured", item.hatch!]]),
    });
    // The textured row carries the glyph; the plain row does not.
    const rows = html.split('<div class="tbl-tooltip-row"').slice(1);
    const textured = rows.find((r) => r.includes("textured"))!;
    const plain = rows.find((r) => r.includes("plain"))!;
    expect(textured).toContain("<svg");
    expect(textured).toContain(item.hatch!.stroke);
    expect(plain).not.toContain("<svg");
  });

  it("renders the SAME glyph markup the legend renders — one drawing, not two", () => {
    const { legendItems, colors } = renderChart(AREA, AREA_ROWS, OPTS);
    const item = legendItems!.find((i) => i.series === "textured")!;

    const parent = document.createElement("div");
    renderLegend(parent, legendItems!);
    const legendGlyph = parent.querySelector('[data-series="textured"] .tbl-legend-swatch svg')!;

    const html = buildFacetTooltipHtml("pane", "2021", values, 1, {
      colors,
      yFormat: String,
      swatchShape: "rect",
      hatches: new Map([["textured", item.hatch!]]),
    });
    const tooltipGlyph = new DOMParser().parseFromString(html, "text/html").querySelector("svg")!;

    const shapes = (svg: Element) =>
      [...svg.querySelectorAll("rect, line")].map(
        (s) => `${s.tagName}:${s.getAttribute("style")}`,
      );
    expect(shapes(tooltipGlyph)).toEqual(shapes(legendGlyph));
  });

  it("leaves a plain LINE chart's tooltip exactly as it was", () => {
    const spec = {
      chartType: "line",
      title: "t",
      xAxisType: "numeric",
      columns: { x: "time", value: "value", series: "series" },
      series_colors: { plain: "blue" },
    } as unknown as ChartSpec;
    const { colors } = renderChart(spec, AREA_ROWS, OPTS);
    const html = buildFacetTooltipHtml("pane", "2021", new Map([["plain", new Map([[1, 4]])]]), 1, {
      colors,
      yFormat: String,
    });
    expect(html).toContain('class="tbl-tooltip-swatch" style="background:');
    expect(html).not.toContain("is-square");
    expect(html).not.toContain("<svg");
  });
});

describe("the band tooltip is unchanged by the shared emitter", () => {
  const ROWS = [
    { _xc: "A", series: "flat", _y: 6 },
    { _xc: "A", series: "textured", _y: 4 },
  ];
  const COLORS = new Map([
    ["flat", "#0072B2"],
    ["textured", GROUND],
  ]);

  it("keeps the square swatch for a bar series", () => {
    const html = buildBandTooltipHtml("A", ROWS, { swatchShape: "rect", colors: COLORS });
    expect(html).toContain('class="tbl-tooltip-swatch is-square" style="background: #0072B2"');
  });

  it("keeps the Total row's circle for a diverging stack", () => {
    const html = buildBandTooltipHtml("A", ROWS, {
      isStacked: true,
      showTotalDot: true,
      swatchShape: "rect",
      colors: COLORS,
    });
    expect(html).toContain('class="tbl-tooltip-swatch is-dot"');
  });

  it("still carries a hatch glyph", () => {
    const html = buildBandTooltipHtml("A", ROWS, {
      swatchShape: "rect",
      colors: COLORS,
      hatches: new Map([["textured", resolveHatch("/", GROUND)]]),
    });
    expect(html).toContain("is-hatched");
    expect(html).toContain("<svg");
  });
});
