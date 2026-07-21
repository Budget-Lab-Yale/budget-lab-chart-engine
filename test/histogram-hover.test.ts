// @vitest-environment jsdom
//
// Unit + integration tests for the histogram (continuous-bin) hover tooltip:
//   - buildHistogramBins        (PURE: binned rows → sorted unique bins)
//   - resolveHistogramBinIndex  (PURE: cursor x → bin index)
//   - buildHistogramTooltipHtml (PURE: bin → tooltip HTML with range header)
//   - attachHistogramHover      (smoke: does not throw, registers listeners + elements)
//   - mountChart dispatch       (integration: pointermove over a rendered histogram shows a
//                                bin-range tooltip + highlight; pointerleave clears them)

import { describe, it, expect } from "vitest";
import {
  buildHistogramBins,
  resolveHistogramBinIndex,
  buildHistogramTooltipHtml,
  attachHistogramHover,
  type HistogramBin,
} from "../src/engine/crosshair";
import { mountChart } from "../src/engine/render-live";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

// ---------------------------------------------------------------------------
// buildHistogramBins — PURE helper
// ---------------------------------------------------------------------------

describe("buildHistogramBins", () => {
  it("returns empty for empty input", () => {
    expect(buildHistogramBins([])).toEqual([]);
  });

  it("collapses rows into sorted unique bins with per-series heights", () => {
    const bins = buildHistogramBins([
      { _x0: 5, _x1: 10, series: "A", _y: 2 },
      { _x0: 0, _x1: 5, series: "A", _y: 3 },
      { _x0: 0, _x1: 5, series: "B", _y: 1 },
    ]);
    expect(bins.map((b) => [b.x0, b.x1])).toEqual([
      [0, 5],
      [5, 10],
    ]);
    expect(bins[0]!.bySeries.get("A")).toBe(3);
    expect(bins[0]!.bySeries.get("B")).toBe(1);
    expect(bins[1]!.bySeries.get("A")).toBe(2);
  });

  it("skips rows missing an edge and null/non-finite heights", () => {
    const bins = buildHistogramBins([
      { _x0: 0, _x1: 5, series: "A", _y: null },
      { _x0: 0, _x1: 5, series: "B", _y: 4 },
      { _x1: 5, series: "C", _y: 9 }, // missing _x0 → skipped
    ]);
    expect(bins.length).toBe(1);
    expect(bins[0]!.bySeries.has("A")).toBe(false); // null height not recorded
    expect(bins[0]!.bySeries.get("B")).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// resolveHistogramBinIndex — PURE helper
// ---------------------------------------------------------------------------

describe("resolveHistogramBinIndex", () => {
  const SPANS = [
    { min: 0, max: 50 },
    { min: 50, max: 100 },
    { min: 100, max: 150 },
  ];

  it("returns null for empty spans", () => {
    expect(resolveHistogramBinIndex([], 20)).toBeNull();
  });

  it("resolves a cursor inside a bin", () => {
    expect(resolveHistogramBinIndex(SPANS, 25)).toBe(0);
    expect(resolveHistogramBinIndex(SPANS, 120)).toBe(2);
  });

  it("resolves shared edges to the first containing bin", () => {
    expect(resolveHistogramBinIndex(SPANS, 50)).toBe(0);
  });

  it("snaps to the nearest bin when the cursor is outside the range", () => {
    expect(resolveHistogramBinIndex(SPANS, -30)).toBe(0);
    expect(resolveHistogramBinIndex(SPANS, 999)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// buildHistogramTooltipHtml — PURE helper
// ---------------------------------------------------------------------------

const COLORS = new Map([
  ["A", "#f00"],
  ["B", "#00f"],
]);

function bin(x0: number, x1: number, entries: Array<[string, number]>): HistogramBin {
  return { x0, x1, bySeries: new Map(entries) };
}

describe("buildHistogramTooltipHtml", () => {
  it("uses the bin RANGE [x0, x1) as the header, via xFormat", () => {
    const html = buildHistogramTooltipHtml(bin(0, 5, [["A", 3]]), {
      colors: COLORS,
      xFormat: (v) => `${v}`,
    });
    expect(html).toContain("tbl-tooltip-head");
    expect(html).toContain("[0, 5)");
  });

  it("emits one row per series with its height", () => {
    const html = buildHistogramTooltipHtml(bin(0, 5, [["A", 3], ["B", 1]]), { colors: COLORS });
    expect(html).toContain("A");
    expect(html).toContain("B");
    expect(html).toContain(">3<");
    expect(html).toContain(">1<");
  });

  it("respects seriesOrder", () => {
    const html = buildHistogramTooltipHtml(bin(0, 5, [["A", 3], ["B", 1]]), {
      colors: COLORS,
      seriesOrder: ["B", "A"],
    });
    expect(html.indexOf("B")).toBeLessThan(html.indexOf("A"));
  });

  it("uses seriesLabels + yFormat", () => {
    const html = buildHistogramTooltipHtml(bin(0, 5, [["A", 3]]), {
      colors: COLORS,
      seriesLabels: { A: "Alpha" },
      yFormat: (v) => `${v.toFixed(1)}%`,
    });
    expect(html).toContain("Alpha");
    expect(html).toContain("3.0%");
  });

  it("prefers renderedFills over colors for the swatch", () => {
    const html = buildHistogramTooltipHtml(bin(0, 5, [["A", 3]]), {
      colors: COLORS,
      renderedFills: new Map([["A", "#123456"]]),
    });
    expect(html).toContain("background: #123456");
    expect(html).not.toContain("background: #f00");
  });

  it("uses a filled-square swatch (is-square) matching the histogram legend", () => {
    const html = buildHistogramTooltipHtml(bin(0, 5, [["A", 3]]), { colors: COLORS });
    expect(html).toContain("tbl-tooltip-swatch is-square");
  });

  it("HTML-escapes dangerous characters", () => {
    const html = buildHistogramTooltipHtml(bin(0, 5, [["<b>x</b>", 1]]), {});
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;b&gt;");
  });
});

// ---------------------------------------------------------------------------
// attachHistogramHover — smoke (jsdom, no real layout)
// ---------------------------------------------------------------------------

function makeHistSvg(doc: Document = document): SVGSVGElement {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
  svg.setAttribute("width", "600");
  svg.setAttribute("height", "400");
  // Two bins rendered as edge-to-edge rects inside a rect mark group.
  const g = doc.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("aria-label", "rect");
  for (const [x, w, s] of [
    [50, 100, "A"],
    [150, 100, "A"],
  ] as const) {
    const rect = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(x));
    rect.setAttribute("width", String(w));
    rect.setAttribute("y", "50");
    rect.setAttribute("height", "200");
    rect.setAttribute("data-series", s);
    rect.setAttribute("fill", "#f00");
    g.appendChild(rect);
  }
  svg.appendChild(g);
  return svg;
}

const SMOKE_ROWS = [
  { _x0: 0, _x1: 5, series: "A", _y: 3 },
  { _x0: 5, _x1: 10, series: "A", _y: 2 },
];

describe("attachHistogramHover (smoke)", () => {
  it("does not throw on a minimal SVG", () => {
    const svg = makeHistSvg();
    expect(() => attachHistogramHover(svg, { rows: SMOKE_ROWS })).not.toThrow();
  });

  it("appends a hit + highlight rect", () => {
    const svg = makeHistSvg();
    attachHistogramHover(svg, { rows: SMOKE_ROWS });
    expect(svg.querySelector(".tbl-hist-hover-hit")).not.toBeNull();
    expect(svg.querySelector(".tbl-hist-hover-hl")).not.toBeNull();
  });

  it("highlight is hidden by default and drawn below the hit area", () => {
    const svg = makeHistSvg();
    attachHistogramHover(svg, { rows: SMOKE_ROWS });
    const hl = svg.querySelector(".tbl-hist-hover-hl") as SVGRectElement;
    expect(hl.getAttribute("opacity")).toBe("0");
    const children = Array.from(svg.children);
    const hlIdx = children.findIndex((el) => el.classList.contains("tbl-hist-hover-hl"));
    const hitIdx = children.findIndex((el) => el.classList.contains("tbl-hist-hover-hit"));
    expect(hitIdx).toBeGreaterThan(hlIdx);
  });

  it("does nothing when rows is empty", () => {
    const svg = makeHistSvg();
    const before = svg.children.length;
    attachHistogramHover(svg, { rows: [] });
    expect(svg.children.length).toBe(before);
  });

  it("re-attaching replaces (does not duplicate) the hit + highlight", () => {
    const svg = makeHistSvg();
    attachHistogramHover(svg, { rows: SMOKE_ROWS });
    attachHistogramHover(svg, { rows: SMOKE_ROWS });
    expect(svg.querySelectorAll(".tbl-hist-hover-hit").length).toBe(1);
    expect(svg.querySelectorAll(".tbl-hist-hover-hl").length).toBe(1);
  });

  it("pointer listeners fire without throwing", () => {
    const svg = makeHistSvg();
    document.body.appendChild(svg);
    attachHistogramHover(svg, { rows: SMOKE_ROWS, colors: COLORS });
    const hit = svg.querySelector(".tbl-hist-hover-hit") as Element;
    expect(() => {
      hit.dispatchEvent(new PointerEvent("pointermove", { clientX: 100, clientY: 100, bubbles: true }));
      hit.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    }).not.toThrow();
    document.body.removeChild(svg);
  });
});

// ---------------------------------------------------------------------------
// mountChart dispatch — integration (a real rendered histogram)
// ---------------------------------------------------------------------------

/** Mock getBoundingClientRect to a 1:1 mapping of the SVG viewBox so a client x maps to SVG x. */
function mock1to1(svg: SVGSVGElement): DOMRect {
  const vb = svg.viewBox.baseVal;
  Object.defineProperty(svg, "getBoundingClientRect", {
    value: () => ({
      width: vb.width, height: vb.height, top: 0, left: 0,
      right: vb.width, bottom: vb.height, x: 0, y: 0,
    }),
    configurable: true,
  });
  return vb as unknown as DOMRect;
}

describe("mountChart histogram hover dispatch", () => {
  it("single-series: hover shows a bin-range tooltip + highlight; leave clears them", () => {
    const spec: ChartSpec = {
      chartType: "histogram",
      title: "Hist single",
      xAxisType: "numeric",
      histogram: { bins: 4, domain: [0, 20] },
      columns: { x: "amount" },
      data: "inline",
    };
    const rows: TidyRow[] = Array.from({ length: 8 }, (_, i) => ({ amount: String(i) })) as TidyRow[];
    const container = document.createElement("div");
    mountChart(container, { spec, rows, width: 640, height: 360 });
    const svg = container.querySelector<SVGSVGElement>(".figure-canvas svg")!;
    expect(svg).not.toBeNull();
    // Dispatched to the histogram hover, NOT the continuous crosshair or the band crosshair.
    expect(svg.querySelector(".tbl-hist-hover-hit")).not.toBeNull();
    expect(svg.querySelector(".tbl-crosshair")).toBeNull();
    expect(svg.querySelector(".tbl-band-crosshair-hit")).toBeNull();

    mock1to1(svg);
    document.body.appendChild(container);
    const firstRect = svg.querySelector<SVGRectElement>('g[aria-label="rect"] rect')!;
    const cx = parseFloat(firstRect.getAttribute("x")!) + parseFloat(firstRect.getAttribute("width")!) / 2;

    const hit = svg.querySelector(".tbl-hist-hover-hit")!;
    hit.dispatchEvent(new PointerEvent("pointermove", { clientX: cx, clientY: 100, bubbles: true }));

    const tip = document.querySelector<HTMLElement>(".tbl-tooltip")!;
    expect(tip).not.toBeNull();
    const head = tip.querySelector(".tbl-tooltip-head")!.textContent ?? "";
    // Leftmost bin is [0, 5) — a formatted continuous range, not a single category.
    expect(head).toMatch(/^\[.*,.*\)$/);
    expect(head).toContain("[0");
    // A value row is present.
    expect(tip.querySelector(".tbl-tooltip-value")).not.toBeNull();
    // Highlight shown.
    const hl = svg.querySelector(".tbl-hist-hover-hl") as SVGRectElement;
    expect(hl.getAttribute("opacity")).not.toBe("0");
    expect(Number(hl.getAttribute("width"))).toBeGreaterThan(0);

    hit.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    expect(hl.getAttribute("opacity")).toBe("0");
    expect(tip.style.opacity).toBe("0");
    document.body.removeChild(container);
  });

  it("multi-series (overlapping bins): the tooltip lists both series' heights for the hovered bin", () => {
    const spec: ChartSpec = {
      chartType: "histogram",
      title: "Hist multi",
      xAxisType: "numeric",
      series_order: ["A", "B"],
      histogram: { bins: 4, domain: [0, 20] },
      columns: { x: "amount", series: "grp" },
      data: "inline",
    };
    // Both series populate the [0,5) bin so the hovered bin has two rows.
    const rows: TidyRow[] = [
      ...[0, 1, 2, 3].map((v) => ({ amount: String(v), grp: "A" })),
      ...[1, 2, 12].map((v) => ({ amount: String(v), grp: "B" })),
    ] as TidyRow[];
    const container = document.createElement("div");
    mountChart(container, { spec, rows, width: 640, height: 360 });
    const svg = container.querySelector<SVGSVGElement>(".figure-canvas svg")!;
    mock1to1(svg);
    document.body.appendChild(container);
    // Hover the leftmost bin (smallest rect x).
    const rects = Array.from(svg.querySelectorAll<SVGRectElement>('g[aria-label="rect"] rect'));
    const minX = Math.min(...rects.map((r) => parseFloat(r.getAttribute("x")!)));
    const leftRect = rects.find((r) => parseFloat(r.getAttribute("x")!) === minX)!;
    const cx = minX + parseFloat(leftRect.getAttribute("width")!) / 2;

    const hit = svg.querySelector(".tbl-hist-hover-hit")!;
    hit.dispatchEvent(new PointerEvent("pointermove", { clientX: cx, clientY: 120, bubbles: true }));

    const tip = document.querySelector<HTMLElement>(".tbl-tooltip")!;
    const rowsHtml = tip.querySelectorAll(".tbl-tooltip-row");
    expect(rowsHtml.length).toBe(2); // both A and B present in [0,5)
    expect(tip.textContent).toContain("A");
    expect(tip.textContent).toContain("B");
    document.body.removeChild(container);
  });

  it("temporal x: the bin-range header formats as dates, not raw epoch-ms", () => {
    const spec: ChartSpec = {
      chartType: "histogram",
      title: "Hist temporal",
      xAxisType: "temporal",
      histogram: { bins: 3 },
      columns: { x: "date" },
      data: "inline",
    };
    const rows: TidyRow[] = [
      "2020-01-15", "2020-03-10", "2020-06-01", "2020-09-20", "2020-12-05", "2021-02-01",
    ].map((d) => ({ date: d })) as TidyRow[];
    const container = document.createElement("div");
    mountChart(container, { spec, rows, width: 640, height: 360 });
    const svg = container.querySelector<SVGSVGElement>(".figure-canvas svg")!;
    expect(svg.querySelector(".tbl-hist-hover-hit")).not.toBeNull();
    mock1to1(svg);
    document.body.appendChild(container);
    const firstRect = svg.querySelector<SVGRectElement>('g[aria-label="rect"] rect')!;
    const cx = parseFloat(firstRect.getAttribute("x")!) + parseFloat(firstRect.getAttribute("width")!) / 2;
    const hit = svg.querySelector(".tbl-hist-hover-hit")!;
    hit.dispatchEvent(new PointerEvent("pointermove", { clientX: cx, clientY: 100, bubbles: true }));
    const tip = document.querySelector<HTMLElement>(".tbl-tooltip")!;
    const head = tip.querySelector(".tbl-tooltip-head")!.textContent ?? "";
    // The adapter's temporal tooltip format is "%b %Y" (e.g. "Jan 2020"): a year appears, and the
    // header is NOT a bare epoch-ms number.
    expect(head).toMatch(/\d{4}/);
    expect(head).not.toMatch(/\d{10,}/); // no epoch-ms leaking through
    document.body.removeChild(container);
  });
});
