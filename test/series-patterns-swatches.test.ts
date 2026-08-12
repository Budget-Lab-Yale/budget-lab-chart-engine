// @vitest-environment jsdom
//
// A texture that reaches the bars but not the key is worse than no texture: the legend then
// asserts a distinction the chart draws differently. Three surfaces have to carry it — the HTML
// legend swatch, the HTML tooltip swatch, and the PNG export's own SVG legend chip (the export
// composes its chrome from scratch rather than cloning the page's).
import { describe, it, expect } from "vitest";
import { renderChart, buildLegendItems } from "../src/engine/index";
import { renderLegend } from "../src/engine/legend";
import { hatchCss, defaultHatchStroke } from "../src/engine/hatch";
import { buildBandTooltipHtml } from "../src/engine/crosshair";
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
const EXPECTED = hatchCss("/", GROUND, defaultHatchStroke(GROUND));

describe("the legend swatch", () => {
  it("carries the texture on the textured series and nothing on the others", () => {
    const items = renderChart(SPEC, ROWS, OPTS).legendItems!;
    const parent = document.createElement("div");
    renderLegend(parent, items);

    const swatchFor = (series: string) =>
      parent.querySelector<HTMLElement>(`[data-series="${series}"] .tbl-legend-swatch`)!;

    const hatched = swatchFor("lostToBehavior");
    expect(hatched.style.backgroundImage).toContain("repeating-linear-gradient");
    expect(hatched.style.backgroundColor).toBeTruthy();

    // The flat swatch keeps the `background` shorthand, which jsdom normalises to
    // background-image: none — the point is only that it carries no gradient.
    expect(swatchFor("collectedNew").style.backgroundImage).not.toContain("gradient");
  });

  it("leans the same way as the mark — the CSS angle is the pattern rotation minus 90", () => {
    const items = renderChart(SPEC, ROWS, OPTS).legendItems!;
    const parent = document.createElement("div");
    renderLegend(parent, items);
    const swatch = parent.querySelector<HTMLElement>('[data-series="lostToBehavior"] .tbl-legend-swatch')!;
    // `/` is patternTransform rotate(45), so the gradient must be at -45deg.
    expect(swatch.style.backgroundImage).toContain("-45deg");
    expect(EXPECTED.backgroundImage).toContain("-45deg");
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
  const COLORS = new Map([
    ["collectedNew", "#0072B2"],
    ["lostToBehavior", GROUND],
  ]);

  it("carries the same texture as the legend and the mark", () => {
    const html = buildBandTooltipHtml("Top 1%", TIP_ROWS, {
      isStacked: true,
      swatchShape: "rect",
      colors: COLORS,
      hatches: new Map([["lostToBehavior", EXPECTED]]),
    });
    expect(html).toContain("repeating-linear-gradient");
    // Same lean as the mark: `/` is rotate(45) in SVG, so -45deg in CSS.
    expect(html).toContain("-45deg");
  });

  it("leaves an untextured series as a plain colour fill", () => {
    const html = buildBandTooltipHtml("Top 1%", TIP_ROWS, {
      isStacked: true,
      swatchShape: "rect",
      colors: COLORS,
      hatches: new Map([["lostToBehavior", EXPECTED]]),
    });
    const collectedRow = html
      .split('<div class="tbl-tooltip-row"')
      .find((chunk) => chunk.includes("collectedNew"))!;
    expect(collectedRow).not.toContain("repeating-linear-gradient");
    expect(collectedRow).toContain("#0072B2");
  });

  it("is unchanged when no textures are passed at all", () => {
    const html = buildBandTooltipHtml("Top 1%", TIP_ROWS, {
      isStacked: true,
      swatchShape: "rect",
      colors: COLORS,
    });
    expect(html).not.toContain("repeating-linear-gradient");
  });
});
