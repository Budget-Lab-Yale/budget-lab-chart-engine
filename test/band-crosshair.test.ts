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
  resolveCategoryFromBandsH,
  widenBandsToMidpoints,
  buildBandTooltipHtml,
  attachBandCrosshair,
  attachSecondaryLineCursor,
  attachSecondaryBandCursor,
  type CategoryBand,
  type CategoryBandH,
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
// resolveCategoryFromBandsH — PURE helper (horizontal / Y-axis resolution)
// ---------------------------------------------------------------------------

describe("resolveCategoryFromBandsH", () => {
  const BANDS_H: CategoryBandH[] = [
    { category: "Northeast", yMin: 20, yMax: 80 },
    { category: "Midwest",   yMin: 90, yMax: 150 },
    { category: "South",     yMin: 160, yMax: 220 },
  ];

  it("returns null for empty bands", () => {
    expect(resolveCategoryFromBandsH([], 50)).toBeNull();
  });

  it("resolves a cursor inside the Northeast band (Y=50)", () => {
    expect(resolveCategoryFromBandsH(BANDS_H, 50)).toBe("Northeast");
  });

  it("resolves a cursor at the top edge of Midwest band (Y=90)", () => {
    expect(resolveCategoryFromBandsH(BANDS_H, 90)).toBe("Midwest");
  });

  it("resolves a cursor at the bottom edge of Midwest band (Y=150)", () => {
    expect(resolveCategoryFromBandsH(BANDS_H, 150)).toBe("Midwest");
  });

  it("resolves a cursor inside the South band (Y=190)", () => {
    expect(resolveCategoryFromBandsH(BANDS_H, 190)).toBe("South");
  });

  it("snaps to nearest band when cursor falls between rows", () => {
    // Gap between Northeast (yMax=80) and Midwest (yMin=90): cursor at 85
    // mid-Northeast=50, mid-Midwest=120 → dist-to-NE=35, dist-to-MW=35 — equidistant,
    // snap returns one of the two adjacent rows.
    const result = resolveCategoryFromBandsH(BANDS_H, 85);
    expect(["Northeast", "Midwest"]).toContain(result);
  });

  it("snaps to nearest when cursor is above all bands", () => {
    expect(resolveCategoryFromBandsH(BANDS_H, 0)).toBe("Northeast");
  });

  it("snaps to nearest when cursor is below all bands", () => {
    expect(resolveCategoryFromBandsH(BANDS_H, 999)).toBe("South");
  });

  it("resolves a single band regardless of Y position", () => {
    const single: CategoryBandH[] = [{ category: "Solo", yMin: 30, yMax: 70 }];
    expect(resolveCategoryFromBandsH(single, 0)).toBe("Solo");
    expect(resolveCategoryFromBandsH(single, 50)).toBe("Solo");
    expect(resolveCategoryFromBandsH(single, 999)).toBe("Solo");
  });

  it("does NOT return Northeast for a cursor in the Midwest row (regression: always-first bug)", () => {
    // This is the exact failure the fix addresses: before the fix, horizontal charts
    // always resolved via cursor-X and returned the first category for any Y position.
    expect(resolveCategoryFromBandsH(BANDS_H, 120)).toBe("Midwest");
    expect(resolveCategoryFromBandsH(BANDS_H, 200)).toBe("South");
  });
});

// ---------------------------------------------------------------------------
// widenBandsToMidpoints — PURE helper (tweak-r2 #2)
// ---------------------------------------------------------------------------

describe("widenBandsToMidpoints", () => {
  it("returns empty for empty input", () => {
    expect(widenBandsToMidpoints([], 0, 100)).toEqual([]);
  });

  it("falls back to a single band's own width when it has no neighbors", () => {
    // Lone band: no neighbor to derive a half-step, so it keeps its own extents (clamped).
    expect(widenBandsToMidpoints([{ min: 40, max: 60 }], 10, 200)).toEqual([
      { min: 40, max: 60 },
    ]);
  });

  it("extends inner edges to midpoints and outer edges by a symmetric half-step", () => {
    // Bars centered at 30, 80, 130 (each width 40). Step = 50; inner edges at the center
    // midpoints (55, 105). Outer edges extend a half-step (25) past the end centers — NOT
    // to the plot edge — so the end bands are balanced (width 50, same as the middle band).
    const bands = [
      { min: 10, max: 50 }, // center 30
      { min: 60, max: 100 }, // center 80
      { min: 110, max: 150 }, // center 130
    ];
    expect(widenBandsToMidpoints(bands, 0, 200)).toEqual([
      { min: 5, max: 55 }, // left = 30 - (80-30)/2 = 5; right = (30+80)/2
      { min: 55, max: 105 }, // (30+80)/2 .. (80+130)/2
      { min: 105, max: 155 }, // left = (80+130)/2; right = 130 + (130-80)/2 = 155
    ]);
  });

  it("clamps an outer half-step to the plot edge when it would overflow", () => {
    // Center 10 with a right neighbor at 90: half-step left = 10 - 40 = -30, clamped to lo=0.
    const bands = [
      { min: 0, max: 20 }, // center 10
      { min: 80, max: 100 }, // center 90
    ];
    const wide = widenBandsToMidpoints(bands, 0, 200);
    expect(wide[0]!.min).toBe(0); // -30 clamped up to lo
  });

  it("widened bands cover the gaps with no holes (adjacent bands share an edge)", () => {
    const bands = [
      { min: 10, max: 30 },
      { min: 50, max: 70 },
    ];
    const wide = widenBandsToMidpoints(bands, 0, 100);
    expect(wide[0]!.max).toBe(wide[1]!.min); // shared midpoint, no gap
  });

  it("does not mutate the input bands", () => {
    const bands = [{ min: 10, max: 50 }, { min: 60, max: 100 }];
    const copy = bands.map((b) => ({ ...b }));
    widenBandsToMidpoints(bands, 0, 200);
    expect(bands).toEqual(copy);
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

  it("adds a Total row for diverging stacked charts (isStacked=true, showTotalDot=true)", () => {
    const html = buildBandTooltipHtml("Cat1", ROWS, { isStacked: true, showTotalDot: true, colors: COLORS });
    expect(html).toContain("Total");
    // Total = 10 + 5 = 15
    expect(html).toContain("15");
  });

  it("Total row swatch carries the is-dot (circle) class for diverging stacks; per-series rows do not", () => {
    const html = buildBandTooltipHtml("Cat1", ROWS, { isStacked: true, showTotalDot: true, colors: COLORS });
    // The Total row's swatch is a circle matching the net dot / legend.
    expect(html).toContain('class="tbl-tooltip-swatch is-dot"');
    // Per-series rows keep the plain colored-square swatch (no is-dot): Cat1 has 2 series.
    const perSeries = html.match(/class="tbl-tooltip-swatch"/g) ?? [];
    expect(perSeries.length).toBe(2);
    // Exactly one is-dot swatch (the Total row).
    expect((html.match(/is-dot/g) ?? []).length).toBe(1);
  });

  it("Total row does NOT use is-dot for cumulative stacked charts (showTotalDot=false)", () => {
    // Cumulative (all-positive) stacks show a text-above net callout, not a dot marker,
    // so the tooltip Total row must match: plain label + value, no circle swatch.
    const html = buildBandTooltipHtml("Cat1", ROWS, { isStacked: true, showTotalDot: false, colors: COLORS });
    expect(html).toContain("Total");
    expect(html).not.toContain("is-dot");
    // Total = 10 + 5 = 15
    expect(html).toContain("15");
  });

  it("omits Total row when showTotalDot is undefined (netDisplay:none / normalized)", () => {
    // No net marker on the chart → no Total row in the tooltip.
    const html = buildBandTooltipHtml("Cat1", ROWS, { isStacked: true, colors: COLORS });
    expect(html).not.toContain("Total");
  });

  it("Total row has the correct signed sum for diverging data", () => {
    const divergingRows: BandRow[] = [
      { _xc: "X", series: "Up",   _y:  8 },
      { _xc: "X", series: "Down", _y: -3 },
    ];
    const html = buildBandTooltipHtml("X", divergingRows, {
      isStacked: true,
      showTotalDot: true,
      colors: new Map([["Up", "#0f0"], ["Down", "#f00"]]),
    });
    expect(html).toContain("Total");
    // Net = 8 + (-3) = 5
    expect(html).toContain("5");
  });

  it("does NOT add a Total row for a single-series stacked", () => {
    const singleRows: BandRow[] = [{ _xc: "X", series: "Only", _y: 42 }];
    const html = buildBandTooltipHtml("X", singleRows, { isStacked: true, showTotalDot: true });
    // Only 1 series → no Total row regardless of showTotalDot
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

  it("appends a .tbl-band-crosshair-hl (highlight) rect to the SVG", () => {
    const svg = makeSvg();
    attachBandCrosshair(svg, { rows: ROWS, categories: ["Cat1"] });
    expect(svg.querySelector(".tbl-band-crosshair-hl")).not.toBeNull();
  });

  it("highlight rect is hidden by default (opacity 0)", () => {
    const svg = makeSvg();
    attachBandCrosshair(svg, { rows: ROWS, categories: ["Cat1"] });
    const hl = svg.querySelector(".tbl-band-crosshair-hl") as SVGRectElement;
    expect(hl).not.toBeNull();
    expect(hl.getAttribute("opacity")).toBe("0");
  });

  it("highlight rect is inserted before the hit area (z-order: hl below hit)", () => {
    const svg = makeSvg();
    attachBandCrosshair(svg, { rows: ROWS, categories: ["Cat1"] });
    const children = Array.from(svg.children);
    const hlIdx = children.findIndex((el) => el.classList.contains("tbl-band-crosshair-hl"));
    const hitIdx = children.findIndex((el) => el.classList.contains("tbl-band-crosshair-hit"));
    expect(hlIdx).toBeGreaterThanOrEqual(0);
    expect(hitIdx).toBeGreaterThan(hlIdx);
  });

  it("re-attaching replaces BOTH highlight and hit elements (not duplicated)", () => {
    const svg = makeSvg();
    attachBandCrosshair(svg, { rows: ROWS, categories: ["Cat1"] });
    attachBandCrosshair(svg, { rows: ROWS, categories: ["Cat1"] });
    expect(svg.querySelectorAll(".tbl-band-crosshair-hl").length).toBe(1);
    expect(svg.querySelectorAll(".tbl-band-crosshair-hit").length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// attachBandCrosshair horizontal smoke tests
// ---------------------------------------------------------------------------

function makeHorizontalSvg(doc: Document = document): SVGSVGElement {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
  svg.setAttribute("width", "600");
  svg.setAttribute("height", "400");
  // Horizontal bars: rects have distinct y values (category rows on Y axis).
  const g = doc.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("aria-label", "bar");
  // Two category rows at different y positions.
  const rect1 = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect1.setAttribute("x", "50");
  rect1.setAttribute("width", "200");
  rect1.setAttribute("y", "30");
  rect1.setAttribute("height", "40");
  const rect2 = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect2.setAttribute("x", "50");
  rect2.setAttribute("width", "150");
  rect2.setAttribute("y", "90");
  rect2.setAttribute("height", "40");
  g.appendChild(rect1);
  g.appendChild(rect2);
  svg.appendChild(g);
  return svg;
}

describe("attachBandCrosshair horizontal (smoke)", () => {
  const H_ROWS = [
    { _xc: "Northeast", series: "Alpha", _y: 10 },
    { _xc: "Midwest",   series: "Alpha", _y: 8  },
  ];

  it("does not throw for horizontal orientation", () => {
    const svg = makeHorizontalSvg();
    expect(() =>
      attachBandCrosshair(svg, {
        rows: H_ROWS,
        categories: ["Northeast", "Midwest"],
        orientation: "horizontal",
      }),
    ).not.toThrow();
  });

  it("creates both .tbl-band-crosshair-hl and .tbl-band-crosshair-hit for horizontal", () => {
    const svg = makeHorizontalSvg();
    attachBandCrosshair(svg, {
      rows: H_ROWS,
      categories: ["Northeast", "Midwest"],
      orientation: "horizontal",
    });
    expect(svg.querySelector(".tbl-band-crosshair-hl")).not.toBeNull();
    expect(svg.querySelector(".tbl-band-crosshair-hit")).not.toBeNull();
  });

  it("pointermove on horizontal chart fires without throwing", () => {
    const svg = makeHorizontalSvg();
    document.body.appendChild(svg);
    attachBandCrosshair(svg, {
      rows: H_ROWS,
      categories: ["Northeast", "Midwest"],
      orientation: "horizontal",
    });
    const hit = svg.querySelector(".tbl-band-crosshair-hit") as Element;
    expect(() => {
      hit.dispatchEvent(new PointerEvent("pointermove", { clientX: 200, clientY: 110, bubbles: true }));
    }).not.toThrow();
    document.body.removeChild(svg);
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

  it("grouped HORIZONTAL bar chart mounts, faceted on fy, with a band crosshair", () => {
    const hSpec: ChartSpec = { ...BAR_SPEC, orientation: "horizontal" };
    const container = document.createElement("div");
    mountChart(container, { spec: hSpec, rows: BAR_ROWS, width: 720, height: 400 });
    const chartSvg = container.querySelector<SVGSVGElement>(".figure-canvas svg")!;
    expect(chartSvg).not.toBeNull();
    // fy-faceted: each category is its own row-facet <g translate(0,ty)> inside the bar mark.
    const facetGroups = chartSvg.querySelectorAll('g[aria-label="bar"] > g');
    expect(facetGroups.length).toBe(2); // Northeast, Midwest
    // Band crosshair attached (categorical hover), not the continuous line crosshair.
    expect(chartSvg.querySelector(".tbl-band-crosshair-hit")).not.toBeNull();
    expect(chartSvg.querySelector(".tbl-crosshair")).toBeNull();
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

// ---------------------------------------------------------------------------
// Coordinated (secondary) cursor — small-multiples cross-pane echo
// ---------------------------------------------------------------------------
// These are externally-driven (no pointer handlers): the figure bus calls the returned driver
// with the hovered x-key (or null to clear). Pixel-accurate dot/label placement needs Plot's
// y-scale + real layout (browser); here we verify the contract — a guide group appears on a
// driven key and clears on null, re-attach is idempotent, and out-of-scope keys clear.

describe("attachSecondaryBandCursor (coordinated cursor)", () => {
  const ROWS: BandRow[] = [
    { _xc: "Cat1", series: "Alpha", _y: 10 },
    { _xc: "Cat1", series: "Beta", _y: 5 },
  ];

  it("returns a driver; driving a known category shows a .tbl-coord guide, null clears it", () => {
    const svg = makeSvg();
    document.body.appendChild(svg);
    const drive = attachSecondaryBandCursor(svg, {
      rows: ROWS,
      categories: ["Cat1"],
      colors: COLORS,
      seriesOrder: ["Alpha", "Beta"],
    });
    expect(typeof drive).toBe("function");
    drive("Cat1");
    const g = svg.querySelector("g.tbl-coord");
    expect(g).not.toBeNull();
    expect(g!.getAttribute("opacity")).toBe("1");
    expect(g!.querySelector("rect")).not.toBeNull(); // the shaded band region
    drive(null);
    expect(svg.querySelector("g.tbl-coord")!.getAttribute("opacity")).toBe("0");
    document.body.removeChild(svg);
  });

  it("an unknown category clears the cursor", () => {
    const svg = makeSvg();
    document.body.appendChild(svg);
    const drive = attachSecondaryBandCursor(svg, { rows: ROWS, categories: ["Cat1"] });
    drive("Nope");
    expect(svg.querySelector("g.tbl-coord")!.getAttribute("opacity")).toBe("0");
    document.body.removeChild(svg);
  });

  it("empty rows → a callable no-op driver", () => {
    const svg = makeSvg();
    const drive = attachSecondaryBandCursor(svg, { rows: [] });
    expect(() => drive("Cat1")).not.toThrow();
  });

  it("re-attaching replaces the previous coord group (not duplicated)", () => {
    const svg = makeSvg();
    attachSecondaryBandCursor(svg, { rows: ROWS, categories: ["Cat1"] });
    attachSecondaryBandCursor(svg, { rows: ROWS, categories: ["Cat1"] });
    expect(svg.querySelectorAll("g.tbl-coord").length).toBe(1);
  });
});

describe("attachSecondaryLineCursor (coordinated cursor)", () => {
  const ROWS = [
    { time: "2020-01-01", series: "A", value: 3 },
    { time: "2021-01-01", series: "A", value: 5 },
    { time: "2020-01-01", series: "B", value: 1 },
    { time: "2021-01-01", series: "B", value: 2 },
  ];

  it("driving an x shows a .tbl-coord guide; null clears it", () => {
    const svg = makeSvg();
    document.body.appendChild(svg);
    const drive = attachSecondaryLineCursor(svg, {
      rows: ROWS,
      xField: "time",
      yField: "value",
      seriesField: "series",
      colors: new Map([["A", "#f00"], ["B", "#00f"]]),
    });
    drive(+new Date("2021-01-01"));
    const g = svg.querySelector("g.tbl-coord");
    expect(g).not.toBeNull();
    expect(g!.getAttribute("opacity")).toBe("1");
    expect(g!.querySelector("line")).not.toBeNull();
    drive(null);
    expect(svg.querySelector("g.tbl-coord")!.getAttribute("opacity")).toBe("0");
    document.body.removeChild(svg);
  });

  it("empty rows → a callable no-op driver", () => {
    const svg = makeSvg();
    const drive = attachSecondaryLineCursor(svg, { rows: [] });
    expect(() => drive(123)).not.toThrow();
  });
});
