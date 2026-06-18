// @vitest-environment jsdom
//
// Unit + smoke tests for the categorical (band-axis) hover tooltip:
//   - resolveCategoryFromBands (PURE: cursor x → category)
//   - buildBandTooltipHtml    (PURE: category rows → tooltip HTML)
//   - attachBandCrosshair      (smoke: does not throw, registers listeners)
//
// Pixel-accurate pointer hit-testing is not verified here (no real layout in jsdom);
// that is deferred to the Phase A visual pass.

import { describe, it, expect } from "vitest";
import {
  resolveCategoryFromBands,
  buildBandTooltipHtml,
  attachBandCrosshair,
  type CategoryBand,
} from "../src/engine/crosshair";
import { mountChart } from "../src/engine/render-live";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

// ---------------------------------------------------------------------------
// resolveCategoryFromBands — PURE helper
// ---------------------------------------------------------------------------

describe("resolveCategoryFromBands", () => {
  const BANDS: CategoryBand[] = [
    { category: "A", xMin: 10, xMax: 50 },
    { category: "B", xMin: 60, xMax: 100 },
    { category: "C", xMin: 110, xMax: 150 },
  ];

  it("returns null for empty bands", () => {
    expect(resolveCategoryFromBands([], 30)).toBeNull();
  });

  it("resolves a cursor inside band A", () => {
    expect(resolveCategoryFromBands(BANDS, 30)).toBe("A");
  });

  it("resolves a cursor at the left edge of band B", () => {
    expect(resolveCategoryFromBands(BANDS, 60)).toBe("B");
  });

  it("resolves a cursor at the right edge of band B", () => {
    expect(resolveCategoryFromBands(BANDS, 100)).toBe("B");
  });

  it("resolves a cursor inside band C", () => {
    expect(resolveCategoryFromBands(BANDS, 130)).toBe("C");
  });

  it("snaps to the nearest band when cursor falls between bands (closer to B)", () => {
    // midpoint of gap between A (max 50) and B (min 60): 55; closer to B mid (80)
    const result = resolveCategoryFromBands(BANDS, 55);
    // 55 is between A and B; mid-A = 30, mid-B = 80 → dist-to-A = 25, dist-to-B = 25
    // When equidistant the first-encountered wins in the current impl; just check it
    // returns one of the two adjacent categories.
    expect(["A", "B"]).toContain(result);
  });

  it("snaps to nearest when cursor is well to the left of all bands", () => {
    expect(resolveCategoryFromBands(BANDS, 0)).toBe("A");
  });

  it("snaps to nearest when cursor is well to the right of all bands", () => {
    expect(resolveCategoryFromBands(BANDS, 200)).toBe("C");
  });

  it("resolves a single band regardless of position", () => {
    const single: CategoryBand[] = [{ category: "Solo", xMin: 20, xMax: 40 }];
    expect(resolveCategoryFromBands(single, 0)).toBe("Solo");
    expect(resolveCategoryFromBands(single, 30)).toBe("Solo");
    expect(resolveCategoryFromBands(single, 999)).toBe("Solo");
  });
});

// ---------------------------------------------------------------------------
// buildBandTooltipHtml — PURE helper
// ---------------------------------------------------------------------------

type BandRow = { _xc?: string; series: string; _y: number | null };

const ROWS: BandRow[] = [
  { _xc: "Cat1", series: "Alpha", _y: 10 },
  { _xc: "Cat1", series: "Beta",  _y: 5  },
  { _xc: "Cat2", series: "Alpha", _y: 8  },
  { _xc: "Cat2", series: "Beta",  _y: 12 },
];

const COLORS = new Map([["Alpha", "#f00"], ["Beta", "#00f"]]);

describe("buildBandTooltipHtml", () => {
  it("includes the category as the header", () => {
    const html = buildBandTooltipHtml("Cat1", ROWS, { colors: COLORS });
    expect(html).toContain("Cat1");
    expect(html).toContain("tbl-tooltip-head");
  });

  it("emits one row per series present in the category", () => {
    const html = buildBandTooltipHtml("Cat1", ROWS, { colors: COLORS });
    expect(html).toContain("Alpha");
    expect(html).toContain("Beta");
  });

  it("does not include series from a different category", () => {
    // Rows for Cat2 only differ in _y; we verify Cat1 rows do not leak Cat2 values.
    const html = buildBandTooltipHtml("Cat1", ROWS, { colors: COLORS });
    // Cat1 Alpha=10, Beta=5; Cat2 Alpha=8, Beta=12 → "12" should not appear
    expect(html).toContain("10");
    expect(html).toContain("5");
    expect(html).not.toContain(">12<");
  });

  it("respects seriesOrder", () => {
    const html = buildBandTooltipHtml("Cat1", ROWS, {
      seriesOrder: ["Beta", "Alpha"],
      colors: COLORS,
    });
    const betaIdx = html.indexOf("Beta");
    const alphaIdx = html.indexOf("Alpha");
    expect(betaIdx).toBeLessThan(alphaIdx);
  });

  it("uses seriesLabels for display names", () => {
    const html = buildBandTooltipHtml("Cat1", ROWS, {
      colors: COLORS,
      seriesLabels: { Alpha: "Greek A", Beta: "Greek B" },
    });
    expect(html).toContain("Greek A");
    expect(html).toContain("Greek B");
    // The raw key should not appear as a visible label.
    expect(html).not.toContain("Alpha:");
  });

  it("uses the provided yFormat for values", () => {
    const html = buildBandTooltipHtml("Cat1", ROWS, {
      colors: COLORS,
      yFormat: (v) => `${v.toFixed(1)}%`,
    });
    expect(html).toContain("10.0%");
    expect(html).toContain("5.0%");
  });

  it("does NOT add a Total row for non-stacked (isStacked omitted)", () => {
    const html = buildBandTooltipHtml("Cat1", ROWS, { colors: COLORS });
    expect(html).not.toContain("Total");
  });

  it("adds a Total row for stacked charts (isStacked=true)", () => {
    const html = buildBandTooltipHtml("Cat1", ROWS, { isStacked: true, colors: COLORS });
    expect(html).toContain("Total");
    // Total = 10 + 5 = 15
    expect(html).toContain("15");
  });

  it("Total row has the correct signed sum for diverging data", () => {
    const divergingRows: BandRow[] = [
      { _xc: "X", series: "Up",   _y:  8 },
      { _xc: "X", series: "Down", _y: -3 },
    ];
    const html = buildBandTooltipHtml("X", divergingRows, {
      isStacked: true,
      colors: new Map([["Up", "#0f0"], ["Down", "#f00"]]),
    });
    expect(html).toContain("Total");
    // Net = 8 + (-3) = 5
    expect(html).toContain("5");
  });

  it("does NOT add a Total row for a single-series stacked", () => {
    const singleRows: BandRow[] = [{ _xc: "X", series: "Only", _y: 42 }];
    const html = buildBandTooltipHtml("X", singleRows, { isStacked: true });
    // Only 1 series → no Total row
    expect(html).not.toContain("Total");
  });

  it("skips rows with null _y", () => {
    const withNull: BandRow[] = [
      { _xc: "Cat1", series: "Alpha", _y: null },
      { _xc: "Cat1", series: "Beta",  _y: 7 },
    ];
    const html = buildBandTooltipHtml("Cat1", withNull, { colors: COLORS });
    expect(html).toContain("Beta");
    expect(html).not.toContain("Alpha");
  });

  it("HTML-escapes dangerous characters in category and series names", () => {
    const xssRows: BandRow[] = [
      { _xc: "<script>", series: "<b>bold</b>", _y: 1 },
    ];
    const html = buildBandTooltipHtml("<script>", xssRows, {});
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<b>bold</b>");
  });
});

// ---------------------------------------------------------------------------
// attachBandCrosshair smoke tests (jsdom — no real layout)
// ---------------------------------------------------------------------------

function makeSvg(doc: Document = document): SVGSVGElement {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
  svg.setAttribute("width", "600");
  svg.setAttribute("height", "400");
  // Add a minimal bar rect so readCategoryBands has something to traverse.
  const g = doc.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("aria-label", "bar");
  const rect = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", "50");
  rect.setAttribute("width", "100");
  rect.setAttribute("y", "50");
  rect.setAttribute("height", "200");
  rect.setAttribute("data-series", "Alpha");
  g.appendChild(rect);
  svg.appendChild(g);
  return svg;
}

describe("attachBandCrosshair (smoke)", () => {
  const ROWS: BandRow[] = [
    { _xc: "Cat1", series: "Alpha", _y: 10 },
    { _xc: "Cat1", series: "Beta",  _y: 5  },
  ];

  it("does not throw when attached to a minimal SVG", () => {
    const svg = makeSvg();
    expect(() =>
      attachBandCrosshair(svg, { rows: ROWS, categories: ["Cat1"] }),
    ).not.toThrow();
  });

  it("appends a .tbl-band-crosshair-hit rect to the SVG", () => {
    const svg = makeSvg();
    attachBandCrosshair(svg, { rows: ROWS, categories: ["Cat1"] });
    expect(svg.querySelector(".tbl-band-crosshair-hit")).not.toBeNull();
  });

  it("does nothing when rows is empty", () => {
    const svg = makeSvg();
    const childCountBefore = svg.children.length;
    attachBandCrosshair(svg, { rows: [] });
    // Should not add hit element when no rows.
    expect(svg.children.length).toBe(childCountBefore);
  });

  it("re-attaching replaces the previous hit element (not duplicated)", () => {
    const svg = makeSvg();
    attachBandCrosshair(svg, { rows: ROWS, categories: ["Cat1"] });
    attachBandCrosshair(svg, { rows: ROWS, categories: ["Cat1"] });
    const hitEls = svg.querySelectorAll(".tbl-band-crosshair-hit");
    expect(hitEls.length).toBe(1);
  });

  it("pointermove listener is registered (fires without throwing)", () => {
    const svg = makeSvg();
    document.body.appendChild(svg);
    attachBandCrosshair(svg, { rows: ROWS, categories: ["Cat1"], colors: COLORS });
    const hit = svg.querySelector(".tbl-band-crosshair-hit") as Element;
    expect(hit).not.toBeNull();
    // Fire a synthetic pointermove — should not throw.
    expect(() => {
      hit.dispatchEvent(new PointerEvent("pointermove", { clientX: 100, clientY: 100, bubbles: true }));
    }).not.toThrow();
    document.body.removeChild(svg);
  });

  it("pointerleave listener is registered (fires without throwing)", () => {
    const svg = makeSvg();
    attachBandCrosshair(svg, { rows: ROWS, categories: ["Cat1"] });
    const hit = svg.querySelector(".tbl-band-crosshair-hit") as Element;
    expect(() => {
      hit.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Smoke: mountChart with categorical spec dispatches band crosshair (no throw)
// ---------------------------------------------------------------------------

describe("mountChart + attachBandCrosshair dispatch", () => {
  const BAR_SPEC: ChartSpec = {
    chartType: "bar",
    title: "Smoke bar",
    xAxisType: "categorical",
    series_order: ["2019", "2022"],
    data: "inline",
  };
  const BAR_ROWS: TidyRow[] = [
    { time: "Northeast", series: "2019", value: "3.2" },
    { time: "Midwest",   series: "2019", value: "2.1" },
    { time: "Northeast", series: "2022", value: "4.1" },
    { time: "Midwest",   series: "2022", value: "2.5" },
  ];

  const STACKED_SPEC: ChartSpec = {
    chartType: "stacked",
    title: "Smoke stacked",
    xAxisType: "categorical",
    series_order: ["Alpha", "Beta"],
    data: "inline",
  };
  const STACKED_ROWS: TidyRow[] = [
    { time: "A", series: "Alpha", value: "10" },
    { time: "A", series: "Beta",  value: "5"  },
    { time: "B", series: "Alpha", value: "8"  },
    { time: "B", series: "Beta",  value: "12" },
  ];

  it("bar categorical chart mounts without throwing", () => {
    const container = document.createElement("div");
    expect(() => mountChart(container, { spec: BAR_SPEC, rows: BAR_ROWS })).not.toThrow();
  });

  it("stacked categorical chart mounts without throwing", () => {
    const container = document.createElement("div");
    expect(() => mountChart(container, { spec: STACKED_SPEC, rows: STACKED_ROWS })).not.toThrow();
  });

  it("categorical chart gets a .tbl-band-crosshair-hit element (not the line crosshair)", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: BAR_SPEC, rows: BAR_ROWS });
    // The chart SVG lives inside .figure-canvas; the logo SVG is in .figure-logo.
    const chartSvg = container.querySelector<SVGSVGElement>(".figure-canvas svg")!;
    expect(chartSvg).not.toBeNull();
    expect(chartSvg.querySelector(".tbl-band-crosshair-hit")).not.toBeNull();
    // The continuous crosshair line element should NOT be present.
    expect(chartSvg.querySelector(".tbl-crosshair")).toBeNull();
  });

  it("line chart does NOT get .tbl-band-crosshair-hit (continuous crosshair unchanged)", () => {
    const lineSpec: ChartSpec = {
      chartType: "line",
      title: "Line smoke",
      xAxisType: "temporal",
      series_order: ["A", "B"],
      data: "inline",
    };
    const lineRows: TidyRow[] = [
      { time: "2024-01-01", series: "A", value: "1" },
      { time: "2024-02-01", series: "A", value: "2" },
      { time: "2024-01-01", series: "B", value: "3" },
      { time: "2024-02-01", series: "B", value: "4" },
    ];
    const container = document.createElement("div");
    mountChart(container, { spec: lineSpec, rows: lineRows });
    // The chart SVG lives inside .figure-canvas.
    const chartSvg = container.querySelector<SVGSVGElement>(".figure-canvas svg")!;
    expect(chartSvg).not.toBeNull();
    expect(chartSvg.querySelector(".tbl-band-crosshair-hit")).toBeNull();
    // The continuous crosshair line element should be present.
    expect(chartSvg.querySelector(".tbl-crosshair")).not.toBeNull();
  });
});
