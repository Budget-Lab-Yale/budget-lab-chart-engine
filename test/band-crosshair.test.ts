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
  spreadLabelYs,
  staggerBarLabels,
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

  it("SINGLE-SERIES SECTIONED horizontal bar mounts fy-faceted with a correctly-ordered coordinated cursor (Task 16 crosshair regression; task 17 coord-cursor rewrite)", () => {
    // Before the fy-topology fix (bar.ts) + the render-live `isFaceted` update, a sectioned
    // single-series horizontal chart rendered on a plain (unfaceted) y band, so `isFaceted` stayed
    // false and the hover resolver read raw <rect> y-coordinates directly. After the fix the bars
    // live inside per-category fy facet <g translate(0,ty)> groups (mirroring the multi-series
    // grouped case above) — isFaceted must follow, or the resolver misreads each rect's LOCAL y as
    // if it were absolute, breaking category resolution across facets.
    //
    // Task 17: standalone bars now drive the SAME coordinated-cursor primitive faceted panes use
    // (attachSecondaryBandCursor), not a floating tooltip — this test was rewritten from asserting
    // a tooltip header ("Care") to asserting the coord group's region/pill/label-accent contract.
    const sectionedSpec: ChartSpec = {
      chartType: "bar",
      title: "Sectioned single-series",
      xAxisType: "categorical",
      orientation: "horizontal",
      columns: { x: "cat", value: "value", section: "sec" },
      section_order: ["P", "Q"],
      data: "inline",
    };
    const rows: TidyRow[] = [
      { cat: "Cars", sec: "P", value: "3.2" },
      { cat: "Food", sec: "P", value: "2.1" },
      { cat: "Rent", sec: "Q", value: "4.1" },
      { cat: "Care", sec: "Q", value: "2.5" },
    ];
    const container = document.createElement("div");
    mountChart(container, { spec: sectionedSpec, rows, width: 720 });
    const svg = container.querySelector<SVGSVGElement>(".figure-canvas svg")!;
    expect(svg).not.toBeNull();

    // fy-faceted: one row-facet <g translate(0,ty)> per category (the section-2 spacer slot
    // carries no rect and is excluded).
    const facetGroups = Array.from(svg.querySelectorAll<SVGGElement>('g[aria-label="bar"] > g')).filter(
      (g) => g.querySelector("rect"),
    );
    expect(facetGroups.length).toBe(4);

    // The LAST facet by y-translate is "Care" (bandDomain render order: Cars, Food, <Q spacer>,
    // Rent, Care). Compute its absolute rect vertical midpoint.
    const withTy = facetGroups.map((g) => {
      const m = /translate\(\s*-?[\d.]+\s*[ ,]\s*([\d.+-]+)/.exec(g.getAttribute("transform") ?? "");
      const ty = m ? parseFloat(m[1]!) : 0;
      const rect = g.querySelector("rect")!;
      const ry = parseFloat(rect.getAttribute("y") ?? "0") + ty;
      const rh = parseFloat(rect.getAttribute("height") ?? "0");
      return { ty, yMid: ry + rh / 2 };
    });
    withTy.sort((a, b) => a.ty - b.ty);
    const careY = withTy[withTy.length - 1]!.yMid;

    // jsdom has no real layout: mock getBoundingClientRect to a 1:1 mapping of the SVG's viewBox
    // (top-left at 0,0) so a pointer's clientY maps directly to SVG user-space y.
    const vb = svg.viewBox.baseVal;
    Object.defineProperty(svg, "getBoundingClientRect", {
      value: () => ({
        width: vb.width, height: vb.height, top: 0, left: 0,
        right: vb.width, bottom: vb.height, x: 0, y: 0,
      }),
      configurable: true,
    });
    // The hover-accent hook (data-category, from the fonts/tagging commit) — stub its geometry so
    // the chip's additive, layout-gated code path actually runs (not just no-ops on a zero rect).
    const careLabel = svg.querySelector<SVGTextElement>('text[data-category="Care"]');
    expect(careLabel).not.toBeNull();
    Object.defineProperty(careLabel!, "getBoundingClientRect", {
      value: () => ({ width: 36, height: 14, top: careY - 7, left: 4, right: 40, bottom: careY + 7, x: 4, y: careY - 7 }),
      configurable: true,
    });
    document.body.appendChild(container);
    const tooltipHeadsBefore = document.body.querySelectorAll(".tbl-tooltip-head").length;
    const hit = svg.querySelector(".tbl-band-crosshair-hit")!;
    hit.dispatchEvent(new PointerEvent("pointermove", { clientX: 10, clientY: careY, bubbles: true }));

    // No tooltip: emitOnly mode never builds/shows the floating tooltip.
    expect(document.body.querySelectorAll(".tbl-tooltip-head").length).toBe(tooltipHeadsBefore);

    // Coordinated cursor: a shaded row spanning the FULL width from x=0 (covers the label gutter,
    // regionFromLeftEdge), plus a value pill at the bar's tip.
    const coord = svg.querySelector("g.tbl-coord")!;
    expect(coord.getAttribute("opacity")).toBe("1");
    const region = coord.querySelector('rect[opacity="0.12"]') as SVGRectElement;
    expect(region).not.toBeNull();
    expect(Number(region.getAttribute("x"))).toBe(0);
    expect(coord.querySelectorAll("text").length).toBeGreaterThan(0);

    // Hovered category's own axis label: bold + a frosted chip behind it.
    expect(careLabel!.getAttribute("font-weight")).toBe("700");
    expect(svg.querySelector(".tbl-coord-label-chip")).not.toBeNull();

    hit.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    expect(svg.querySelector("g.tbl-coord")!.getAttribute("opacity")).toBe("0");
    expect(careLabel!.getAttribute("font-weight")).toBe("500");
    document.body.removeChild(container);
  });

  it("uniform hover-row height across a section spacer (task 17, item 4): 'Food' (last of P) and 'Rent' (first of Q, across the spacer) get the SAME shaded-row height", () => {
    const sectionedSpec: ChartSpec = {
      chartType: "bar",
      title: "Sectioned single-series",
      xAxisType: "categorical",
      orientation: "horizontal",
      columns: { x: "cat", value: "value", section: "sec" },
      section_order: ["P", "Q"],
      data: "inline",
    };
    const rows: TidyRow[] = [
      { cat: "Cars", sec: "P", value: "3.2" },
      { cat: "Food", sec: "P", value: "2.1" },
      { cat: "Rent", sec: "Q", value: "4.1" },
      { cat: "Care", sec: "Q", value: "2.5" },
    ];
    const container = document.createElement("div");
    mountChart(container, { spec: sectionedSpec, rows, width: 720 });
    const svg = container.querySelector<SVGSVGElement>(".figure-canvas svg")!;
    const vb = svg.viewBox.baseVal;
    Object.defineProperty(svg, "getBoundingClientRect", {
      value: () => ({
        width: vb.width, height: vb.height, top: 0, left: 0,
        right: vb.width, bottom: vb.height, x: 0, y: 0,
      }),
      configurable: true,
    });
    document.body.appendChild(container);
    const facetGroups = Array.from(svg.querySelectorAll<SVGGElement>('g[aria-label="bar"] > g')).filter(
      (g) => g.querySelector("rect"),
    );
    const yMidFor = (cat: string): number => {
      const idx = ["Cars", "Food", "Rent", "Care"].indexOf(cat); // bandDomain render order (Q spacer excluded)
      const g = facetGroups[idx]!;
      const m = /translate\(\s*-?[\d.]+\s*[ ,]\s*([\d.+-]+)/.exec(g.getAttribute("transform") ?? "");
      const ty = m ? parseFloat(m[1]!) : 0;
      const rect = g.querySelector("rect")!;
      return ty + parseFloat(rect.getAttribute("y") ?? "0") + parseFloat(rect.getAttribute("height") ?? "0") / 2;
    };
    const hit = svg.querySelector(".tbl-band-crosshair-hit")!;
    const regionHeightAt = (clientY: number): number => {
      hit.dispatchEvent(new PointerEvent("pointermove", { clientX: 10, clientY, bubbles: true }));
      const region = svg.querySelector('g.tbl-coord rect[opacity="0.12"]') as SVGRectElement;
      return Number(region.getAttribute("height"));
    };
    const foodHeight = regionHeightAt(yMidFor("Food"));
    const rentHeight = regionHeightAt(yMidFor("Rent"));
    expect(foodHeight).toBeCloseTo(rentHeight, 5);
    document.body.removeChild(container);
  });

  it("standalone VERTICAL single-series bar drives a coordinated cursor: full-height column incl. the label gutter, top-of-bar pill, no tooltip", () => {
    const vertSpec: ChartSpec = {
      chartType: "bar",
      title: "Vertical smoke",
      xAxisType: "categorical",
      columns: { x: "cat", value: "value" },
      data: "inline",
    };
    const rows: TidyRow[] = [
      { cat: "Alpha", value: "3.2" },
      { cat: "Beta", value: "2.1" },
      { cat: "Gamma", value: "4.1" },
    ];
    const container = document.createElement("div");
    mountChart(container, { spec: vertSpec, rows, width: 600 });
    const svg = container.querySelector<SVGSVGElement>(".figure-canvas svg")!;
    expect(svg).not.toBeNull();
    const vb = svg.viewBox.baseVal;
    Object.defineProperty(svg, "getBoundingClientRect", {
      value: () => ({
        width: vb.width, height: vb.height, top: 0, left: 0,
        right: vb.width, bottom: vb.height, x: 0, y: 0,
      }),
      configurable: true,
    });
    document.body.appendChild(container);
    const rect = svg.querySelector<SVGRectElement>('g[aria-label="bar"] rect')!;
    const cx = parseFloat(rect.getAttribute("x")!) + parseFloat(rect.getAttribute("width")!) / 2;
    const tooltipHeadsBefore = document.body.querySelectorAll(".tbl-tooltip-head").length;
    const hit = svg.querySelector(".tbl-band-crosshair-hit")!;
    hit.dispatchEvent(new PointerEvent("pointermove", { clientX: cx, clientY: 50, bubbles: true }));

    expect(document.body.querySelectorAll(".tbl-tooltip-head").length).toBe(tooltipHeadsBefore);

    const coord = svg.querySelector("g.tbl-coord")!;
    expect(coord.getAttribute("opacity")).toBe("1");
    const region = coord.querySelector('rect[opacity="0.12"]') as SVGRectElement;
    expect(region).not.toBeNull();
    // regionToBottomEdge: the shaded column reaches the SVG's bottom edge (covers the x-axis
    // label), not just the plot's bottom margin.
    const regionBottom = Number(region.getAttribute("y")) + Number(region.getAttribute("height"));
    expect(regionBottom).toBeCloseTo(vb.height, 1);
    expect(coord.querySelectorAll("text").length).toBeGreaterThan(0); // the bar-top value pill

    hit.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    expect(svg.querySelector("g.tbl-coord")!.getAttribute("opacity")).toBe("0");
    document.body.removeChild(container);
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

  it("categorical-x LINE chart uses the categorical-line crosshair (not band, not continuous)", () => {
    const catLineSpec: ChartSpec = {
      chartType: "line",
      title: "Categorical line",
      xAxisType: "categorical",
      series_order: ["A", "B"],
      points: true,
      data: "inline",
    };
    const rows: TidyRow[] = [
      { time: "18-21", series: "A", value: "1" },
      { time: "22-25", series: "A", value: "2" },
      { time: "18-21", series: "B", value: "3" },
      { time: "22-25", series: "B", value: "4" },
    ];
    const container = document.createElement("div");
    mountChart(container, { spec: catLineSpec, rows });
    const chartSvg = container.querySelector<SVGSVGElement>(".figure-canvas svg")!;
    expect(chartSvg.querySelector(".tbl-catline-hit")).not.toBeNull();
    expect(chartSvg.querySelector(".tbl-band-crosshair-hit")).toBeNull();
    // points:true → per-series marker symbols (rendered as <path>), tagged with data-series.
    expect(chartSvg.querySelectorAll('g[aria-label="dot"] path[data-series]').length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Coordinated (secondary) cursor — small-multiples cross-pane echo
// ---------------------------------------------------------------------------
// These are externally-driven (no pointer handlers): the figure bus calls the returned driver
// with the hovered x-key (or null to clear). Pixel-accurate dot/label placement needs Plot's
// y-scale + real layout (browser); here we verify the contract — a guide group appears on a
// driven key and clears on null, re-attach is idempotent, and out-of-scope keys clear.

describe("spreadLabelYs (pill de-collision)", () => {
  it("leaves a single label untouched", () => {
    expect(spreadLabelYs([100], 16, 0, 400)).toEqual([100]);
  });

  it("pushes overlapping labels apart to at least minGap, preserving input order", () => {
    // Two near-identical values: must end up >= 16 apart, still mapped to original indices.
    const out = spreadLabelYs([200, 205], 16, 0, 400);
    expect(Math.abs(out[1]! - out[0]!)).toBeGreaterThanOrEqual(16);
    expect(out[0]).toBeLessThan(out[1]!); // 205 was the lower (greater y) of the two
  });

  it("keeps well-separated labels at their data positions", () => {
    expect(spreadLabelYs([50, 200, 350], 16, 0, 400)).toEqual([50, 200, 350]);
  });

  it("clamps the spread run within [lo, hi]", () => {
    const out = spreadLabelYs([398, 399, 400], 16, 0, 400);
    expect(Math.min(...out)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...out)).toBeLessThanOrEqual(400);
    // adjacent gaps still respected
    const sorted = [...out].sort((a, b) => a - b);
    expect(sorted[1]! - sorted[0]!).toBeGreaterThanOrEqual(16 - 1e-9);
  });
});

describe("staggerBarLabels (per-bar value-label de-collision)", () => {
  it("leaves horizontally-separated labels at their natural y", () => {
    const out = staggerBarLabels(
      [{ cx: 0, w: 20, value: 5, y: 100 }, { cx: 100, w: 20, value: 3, y: 100 }],
      16,
    );
    expect(out).toEqual([100, 100]);
  });

  it("keeps the higher-value label higher and pushes the lower one down when they overlap", () => {
    const out = staggerBarLabels(
      [{ cx: 10, w: 30, value: 5, y: 100 }, { cx: 20, w: 30, value: 3, y: 100 }],
      16,
    );
    expect(out[0]).toBe(100); // higher value stays put (higher = smaller y)
    expect(out[1]).toBeGreaterThanOrEqual(116); // lower value pushed down ≥ pad
  });

  it("breaks ties by putting the left (smaller cx) label on top", () => {
    const out = staggerBarLabels(
      [{ cx: 20, w: 30, value: 5, y: 100 }, { cx: 10, w: 30, value: 5, y: 100 }],
      16,
    );
    expect(out[1]).toBe(100); // the left bar (cx 10) is on top
    expect(out[0]).toBeGreaterThanOrEqual(116); // the right bar pushed down
  });
});

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

  // task 17: regionToBottomEdge extends the vertical shaded column through the bottom margin
  // (the x-label gutter), matching the horizontal cursor's regionFromLeftEdge parity item.
  it("regionToBottomEdge extends the shaded column's height into the bottom margin", () => {
    const svg = makeSvg(); // width 600 height 400, default margins ml=0/mr=8/mt=18/mb=28 → plotH=354
    const svgDefault = makeSvg();
    const driveDefault = attachSecondaryBandCursor(svgDefault, { rows: ROWS, categories: ["Cat1"] });
    driveDefault("Cat1");
    const regionDefault = svgDefault.querySelector('rect[opacity="0.12"]') as SVGRectElement;
    expect(regionDefault).not.toBeNull();
    expect(Number(regionDefault.getAttribute("height"))).toBeCloseTo(354, 5); // H - mt - mb

    const drive = attachSecondaryBandCursor(svg, {
      rows: ROWS,
      categories: ["Cat1"],
      regionToBottomEdge: true,
    });
    drive("Cat1");
    const region = svg.querySelector('rect[opacity="0.12"]') as SVGRectElement;
    expect(region).not.toBeNull();
    expect(Number(region.getAttribute("height"))).toBeCloseTo(382, 5); // H - mt (covers the label gutter)
  });
});

// ---------------------------------------------------------------------------
// attachSecondaryBandCursor — horizontal stacked pills + hover-accent chip (task 17)
// ---------------------------------------------------------------------------

/** A single-row horizontal "stack": two segments (different series) sharing one category row. */
function makeHorizontalStackedSvg(doc: Document = document): SVGSVGElement {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
  svg.setAttribute("width", "600");
  svg.setAttribute("height", "400");
  const g = doc.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("aria-label", "bar");
  const seg1 = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
  seg1.setAttribute("x", "50");
  seg1.setAttribute("width", "100");
  seg1.setAttribute("y", "30");
  seg1.setAttribute("height", "40");
  seg1.setAttribute("data-series", "Alpha");
  const seg2 = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
  seg2.setAttribute("x", "150");
  seg2.setAttribute("width", "80");
  seg2.setAttribute("y", "30");
  seg2.setAttribute("height", "40");
  seg2.setAttribute("data-series", "Beta");
  g.appendChild(seg1);
  g.appendChild(seg2);
  svg.appendChild(g);
  return svg;
}

describe("attachSecondaryBandCursor horizontal — isStacked segment-center pills (task 17)", () => {
  const ROWS: BandRow[] = [
    { _xc: "Northeast", series: "Alpha", _y: 5 },
    { _xc: "Northeast", series: "Beta", _y: 3 },
  ];

  it("isStacked: false (default) anchors the pill at the segment's tip, not its center", () => {
    const svg = makeHorizontalStackedSvg();
    const drive = attachSecondaryBandCursor(svg, {
      rows: ROWS,
      categories: ["Northeast"],
      seriesOrder: ["Alpha", "Beta"],
      horizontal: true,
    });
    drive("Northeast");
    const xs = Array.from(svg.querySelectorAll("g.tbl-coord text")).map((t) => Number(t.getAttribute("x")));
    // Tip-anchored: Alpha's rect ends at x=150 (+6px gap) = 156; Beta's ends at x=230 (+6) = 236.
    expect(xs.sort((a, b) => a - b)).toEqual([156, 236]);
  });

  it("isStacked: true centers each pill on its OWN segment (mirrors attachHighlightPills)", () => {
    const svg = makeHorizontalStackedSvg();
    const drive = attachSecondaryBandCursor(svg, {
      rows: ROWS,
      categories: ["Northeast"],
      seriesOrder: ["Alpha", "Beta"],
      horizontal: true,
      isStacked: true,
    });
    drive("Northeast");
    const xs = Array.from(svg.querySelectorAll("g.tbl-coord text")).map((t) => Number(t.getAttribute("x")));
    // Segment centers: Alpha [50,150] → 100; Beta [150,230] → 190.
    expect(xs.sort((a, b) => a - b)).toEqual([100, 190]);
  });
});

describe("attachSecondaryBandCursor horizontal — accentLabel chip (task 17)", () => {
  const ROWS: BandRow[] = [{ _xc: "Northeast", series: "Alpha", _y: 5 }];

  function makeSvgWithLabel(): { svg: SVGSVGElement; label: SVGTextElement } {
    const svg = makeHorizontalStackedSvg();
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text") as SVGTextElement;
    label.setAttribute("data-category", "Northeast");
    label.textContent = "Northeast";
    svg.appendChild(label);
    return { svg, label };
  }

  it("without chip: bolds the label but adds no chip rect (jsdom has no layout either way)", () => {
    const { svg, label } = makeSvgWithLabel();
    const drive = attachSecondaryBandCursor(svg, {
      rows: ROWS,
      categories: ["Northeast"],
      horizontal: true,
      accentLabel: { font: 13 },
    });
    drive("Northeast");
    expect(label.getAttribute("font-weight")).toBe("700");
    expect(svg.querySelector(".tbl-coord-label-chip")).toBeNull();
  });

  it("with chip + a stubbed layout: inserts a frosted chip rect behind the accented label", () => {
    const { svg, label } = makeSvgWithLabel();
    document.body.appendChild(svg);
    // jsdom has no layout engine (getBoundingClientRect is always a zero rect); stub just the two
    // elements the chip geometry reads so the additive, gated code path is actually exercised.
    const svgRect = { left: 0, top: 0, right: 300, bottom: 200, width: 300, height: 200, x: 0, y: 0, toJSON() {} };
    const labelRect = { left: 40, top: 96, right: 100, bottom: 110, width: 60, height: 14, x: 40, y: 96, toJSON() {} };
    svg.getBoundingClientRect = () => svgRect as DOMRect;
    label.getBoundingClientRect = () => labelRect as DOMRect;
    const drive = attachSecondaryBandCursor(svg, {
      rows: ROWS,
      categories: ["Northeast"],
      horizontal: true,
      accentLabel: { font: 13, chip: true },
    });
    drive("Northeast");
    const chip = svg.querySelector(".tbl-coord-label-chip") as SVGRectElement;
    expect(chip).not.toBeNull();
    expect(Number(chip.getAttribute("width"))).toBeGreaterThan(0);
    expect(Number(chip.getAttribute("height"))).toBeGreaterThan(0);
    // Inserted immediately before the label so it paints behind it.
    expect(chip.nextSibling).toBe(label);
    // Clearing the hover removes the chip along with the accent.
    drive(null);
    expect(svg.querySelector(".tbl-coord-label-chip")).toBeNull();
    expect(label.getAttribute("font-weight")).toBe("500");
    document.body.removeChild(svg);
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
