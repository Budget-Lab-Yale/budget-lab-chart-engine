// @vitest-environment jsdom
//
// Unit + smoke tests for the FACET-AWARE crosshair (SHARED-mode small-multiples line figures):
//   - computeFacetCells     (PURE: faceted scales → per-cell SVG-coord plot bounds)
//   - resolveFacetCell       (PURE: cursor (x,y) → facet cell, with nearest-snap)
//   - buildFacetTooltipHtml  (PURE: a facet's bySeries + snapped x → tooltip HTML)
//   - attachFacetCrosshair    (smoke: no-ops cleanly without a real scale API / layout)
//   - mountFigure shared      (smoke: attaches the FACET overlay, NOT the flat one)
//
// Pixel-accurate pointer hit-testing is verified in the browser (jsdom has no layout and no
// Plot scale API on the SVG); these tests cover the pure geometry/lookup pieces.

import { describe, it, expect } from "vitest";
import {
  computeFacetCells,
  resolveFacetCell,
  buildFacetTooltipHtml,
  attachFacetCrosshair,
  attachSecondaryBandCursor,
  type FacetCell,
} from "../src/engine/crosshair";
import { mountChart } from "../src/engine/render-live";
import { renderChart } from "../src/engine/index";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

// ---------------------------------------------------------------------------
// computeFacetCells — PURE: derive cell bounds from Plot's faceted scales.
// Values mirror the real rendered fig-shared figure (fx paddingInner 0.08, fy 0.22):
//   fx range [44,822] bandwidth 373 → col origins {0, 405}
//   fy range [18,382] bandwidth 159 → row origins {0, 204}
//   x range [44,417] local, y range [177,18] local
// ---------------------------------------------------------------------------

describe("computeFacetCells", () => {
  const fx = { domain: ["0", "1"], range: [44, 822] as [number, number], bandwidth: 373 };
  const fy = { domain: ["0", "1"], range: [18, 382] as [number, number], bandwidth: 159 };
  const x = { range: [44, 417] as [number, number] };
  const y = { range: [177, 18] as [number, number] }; // inverted (Plot y range)
  const panes = [
    { facet: "Northeast", col: 0, row: 0, title: "Northeast" },
    { facet: "South", col: 0, row: 1, title: "South" },
    { facet: "Midwest", col: 1, row: 0, title: "Midwest" },
    { facet: "West", col: 1, row: 1, title: "West" },
  ];

  it("places the top-left cell at the figure origin", () => {
    const cells = computeFacetCells(fx, fy, x, y, panes);
    const ne = cells.find((c) => c.facet === "Northeast")!;
    expect(ne.x0).toBe(44);
    expect(ne.x1).toBe(417);
    expect(ne.y0).toBe(18); // top of plot (min of inverted range)
    expect(ne.y1).toBe(177); // bottom of plot
  });

  it("offsets the bottom-left cell by the fy band stride (204)", () => {
    const cells = computeFacetCells(fx, fy, x, y, panes);
    const south = cells.find((c) => c.facet === "South")!;
    // fy stride = (span − bandwidth)/(n−1) = (364 − 159)/1 = 205 (rendered ≈204 incl. crispness).
    expect(south.x0).toBe(44); // same column → same x
    expect(south.x1).toBe(417);
    expect(south.y0).toBe(18 + 205);
    expect(south.y1).toBe(177 + 205);
  });

  it("offsets the right column by the fx band stride (405)", () => {
    const cells = computeFacetCells(fx, fy, x, y, panes);
    const mw = cells.find((c) => c.facet === "Midwest")!;
    expect(mw.x0).toBe(44 + 405);
    expect(mw.x1).toBe(417 + 405);
    expect(mw.y0).toBe(18); // top row
  });

  it("confines the two stacked rows of a column to NON-overlapping y bands", () => {
    const cells = computeFacetCells(fx, fy, x, y, panes);
    const ne = cells.find((c) => c.facet === "Northeast")!;
    const south = cells.find((c) => c.facet === "South")!;
    // The top pane's bottom is above the bottom pane's top (gap from fy paddingInner).
    expect(ne.y1).toBeLessThan(south.y0);
  });

  it("handles a single column/row (n=1) at origin 0", () => {
    const cells = computeFacetCells(
      { domain: ["0"], range: [44, 417] as [number, number], bandwidth: 373 },
      { domain: ["0"], range: [18, 177] as [number, number], bandwidth: 159 },
      x,
      y,
      [{ facet: "Only", col: 0, row: 0, title: "Only" }],
    );
    expect(cells[0]!.x0).toBe(44);
    expect(cells[0]!.y0).toBe(18);
  });
});

// ---------------------------------------------------------------------------
// resolveFacetCell — PURE: cursor → cell
// ---------------------------------------------------------------------------

describe("resolveFacetCell", () => {
  const CELLS: FacetCell[] = [
    { facet: "NE", col: 0, row: 0, title: "NE", x0: 44, x1: 417, y0: 18, y1: 177 },
    { facet: "S", col: 0, row: 1, title: "S", x0: 44, x1: 417, y0: 222, y1: 381 },
    { facet: "MW", col: 1, row: 0, title: "MW", x0: 449, x1: 822, y0: 18, y1: 177 },
    { facet: "W", col: 1, row: 1, title: "W", x0: 449, x1: 822, y0: 222, y1: 381 },
  ];

  it("returns null for empty cells", () => {
    expect(resolveFacetCell([], 100, 100)).toBeNull();
  });

  it("resolves a cursor inside the top-left cell", () => {
    expect(resolveFacetCell(CELLS, 100, 80)!.facet).toBe("NE");
  });

  it("resolves a cursor inside the bottom-left cell", () => {
    expect(resolveFacetCell(CELLS, 100, 300)!.facet).toBe("S");
  });

  it("does NOT bleed the top cell into the bottom cell's y band", () => {
    // y=300 is firmly in the bottom row; must resolve to S, never NE.
    expect(resolveFacetCell(CELLS, 200, 300)!.facet).toBe("S");
  });

  it("snaps the inter-pane gutter to the nearer cell", () => {
    // y=200 sits in the gap between NE (≤177) and S (≥222); nearer to S? 200-177=23, 222-200=22.
    const r = resolveFacetCell(CELLS, 100, 200);
    expect(r!.facet).toBe("S");
  });

  it("returns null outside all cells in strict mode", () => {
    expect(resolveFacetCell(CELLS, 100, 200, true)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildFacetTooltipHtml — PURE: facet rows → HTML
// ---------------------------------------------------------------------------

describe("buildFacetTooltipHtml", () => {
  const bySeries = new Map<string, Map<number, number>>([
    ["<5 Weeks", new Map([[100, 3.2], [200, 4.1]])],
    ["27+ Weeks", new Map([[100, 1.5], [200, 1.8]])],
  ]);

  it("headers with the pane title + x label", () => {
    const html = buildFacetTooltipHtml("Northeast", "Jan 2020", bySeries, 100, {
      seriesOrder: ["<5 Weeks", "27+ Weeks"],
      yFormat: (v) => `${v}%`,
    });
    expect(html).toContain("Northeast");
    expect(html).toContain("Jan 2020");
  });

  it("shows only this facet's values at the snapped x (no cross-facet collision)", () => {
    const html = buildFacetTooltipHtml("Northeast", "Jan 2020", bySeries, 100, {
      seriesOrder: ["<5 Weeks", "27+ Weeks"],
      yFormat: (v) => `${v}%`,
    });
    expect(html).toContain("3.2%");
    expect(html).toContain("1.5%");
    // The other x's values must not appear.
    expect(html).not.toContain("4.1%");
    expect(html).not.toContain("1.8%");
  });

  it("respects seriesOrder", () => {
    const html = buildFacetTooltipHtml("X", "t", bySeries, 100, {
      seriesOrder: ["27+ Weeks", "<5 Weeks"],
      yFormat: (v) => String(v),
    });
    // "<5 Weeks" is HTML-escaped to "&lt;5 Weeks" in the output.
    expect(html.indexOf("27+ Weeks")).toBeLessThan(html.indexOf("&lt;5 Weeks"));
  });

  it("skips series with no value at the snapped x", () => {
    const html = buildFacetTooltipHtml("X", "t", bySeries, 999, {
      seriesOrder: ["<5 Weeks", "27+ Weeks"],
      yFormat: (v) => String(v),
    });
    // No data rows for x=999 → header only, no series rows.
    expect(html).not.toContain("tbl-tooltip-row");
  });

  it("applies seriesLabels and dashed swatch class", () => {
    const html = buildFacetTooltipHtml("X", "t", bySeries, 100, {
      seriesOrder: ["<5 Weeks"],
      seriesLabels: { "<5 Weeks": "Short term" },
      dashedSeries: new Set(["<5 Weeks"]),
      colors: new Map([["<5 Weeks", "#123456"]]),
      yFormat: (v) => String(v),
    });
    expect(html).toContain("Short term");
    expect(html).toContain("is-dashed");
    expect(html).toContain("--swatch-color: #123456");
  });
});

// ---------------------------------------------------------------------------
// attachFacetCrosshair — smoke (no real layout / scale API in jsdom → clean no-op)
// ---------------------------------------------------------------------------

describe("attachFacetCrosshair (smoke)", () => {
  it("no-ops cleanly on an SVG without the Plot scale API", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 800 400");
    document.body.appendChild(svg);
    expect(() =>
      attachFacetCrosshair(svg as SVGSVGElement, {
        panes: [{ facet: "A", col: 0, row: 0, title: "A", rows: [{ time: "2020-01-01", series: "s", value: 1 }] }],
      }),
    ).not.toThrow();
    // Without scale() it bails before appending the overlay.
    expect(svg.querySelector(".tbl-facet-crosshair-hit")).toBeNull();
    svg.remove();
  });

  it("attaches the overlay + guide when a scale API is present", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement & {
      scale?: (n: string) => unknown;
    };
    svg.setAttribute("viewBox", "0 0 838 420");
    (svg as { scale?: (n: string) => unknown }).scale = (n: string) => {
      if (n === "fx") return { domain: ["0", "1"], range: [44, 822], bandwidth: 373 };
      if (n === "fy") return { domain: ["0", "1"], range: [18, 382], bandwidth: 159 };
      if (n === "x") return { range: [44, 417] };
      if (n === "y") return { range: [177, 18] };
      return null;
    };
    document.body.appendChild(svg);
    attachFacetCrosshair(svg, {
      panes: [
        { facet: "NE", col: 0, row: 0, title: "Northeast", rows: [{ time: "2020-01-01", series: "s", value: 1 }] },
        { facet: "S", col: 0, row: 1, title: "South", rows: [{ time: "2020-01-01", series: "s", value: 2 }] },
      ],
    });
    expect(svg.querySelector(".tbl-facet-crosshair")).not.toBeNull();
    expect(svg.querySelector(".tbl-facet-crosshair-hit")).not.toBeNull();
    svg.remove();
  });
});

// ---------------------------------------------------------------------------
// mountFigure shared — shared mode is now a per-pane grid composition: each pane is its OWN
// mini-SVG with its OWN flat per-pane crosshair, confined to that pane. (The old combined
// faceted SVG + facet-aware crosshair model was retired.)
// ---------------------------------------------------------------------------

describe("mountFigure shared crosshair wiring", () => {
  const spec: ChartSpec = {
    chartType: "line",
    title: "Regions",
    xAxisType: "temporal",
    series_order: ["<5 Weeks", "27+ Weeks"],
    columns: { facet: "facet" },
    small_multiples: { columns: 2, mode: "shared" },
  } as ChartSpec;

  const rows: TidyRow[] = [];
  let seed = 0;
  for (const facet of ["Northeast", "South"]) {
    for (const t of ["2020-01-01", "2020-02-01", "2020-03-01"]) {
      for (const s of ["<5 Weeks", "27+ Weeks"]) {
        rows.push({ facet, time: t, series: s, value: String(1 + (++seed % 5)) } as TidyRow);
      }
    }
  }

  it("mounts a per-pane grid with one flat crosshair overlay PER pane", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let teardown: () => void = () => {};
    expect(() => { teardown = mountChart(container, { spec, rows, width: 838, height: 420 }); }).not.toThrow();
    // Shared mode renders into the responsive per-pane grid (not a single combined canvas).
    const grid = container.querySelector(".figure-grid");
    expect(grid).not.toBeNull();
    const paneSvgs = container.querySelectorAll(".figure-pane svg");
    expect(paneSvgs.length).toBe(2);
    // Each pane carries its OWN flat crosshair hit overlay (confined to that pane).
    paneSvgs.forEach((svg) => {
      expect(svg.querySelector(".tbl-crosshair-hit")).not.toBeNull();
    });
    teardown();
    container.remove();
  });
});

describe("coordinated cursor — horizontal bars (row highlight + tip pills, no tooltip)", () => {
  const spec: ChartSpec = {
    chartType: "bar",
    title: "h",
    subtitle: "Percentage points",
    xAxisType: "categorical",
    orientation: "horizontal",
    series_order: ["2019", "2022", "2025"],
    columns: { facet: "facet" },
    small_multiples: { columns: 2, mode: "shared" },
  } as ChartSpec;

  const rows: TidyRow[] = [];
  for (const facet of ["A", "B"]) {
    for (const cat of ["Northeast", "Midwest", "South"]) {
      for (const s of ["2019", "2022", "2025"]) {
        rows.push({ facet, time: cat, series: s, value: "2" } as TidyRow);
      }
    }
  }

  it("faceted horizontal panes wire a band crosshair (coordinated), not a line tooltip", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const teardown = mountChart(container, { spec, rows, width: 838, height: 600 });
    const paneSvgs = container.querySelectorAll(".figure-pane svg");
    expect(paneSvgs.length).toBe(2);
    paneSvgs.forEach((svg) => {
      // Band crosshair (categorical) hit overlay present; NOT the continuous-line crosshair.
      expect(svg.querySelector(".tbl-band-crosshair-hit")).not.toBeNull();
    });
    teardown();
    container.remove();
  });

  it("faceted horizontal bars never stack — one row inside a horizontal-scroll wrapper, even when narrow", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    // A narrow width would normally reflow 2 panes to 1 column (2 rows); horizontal bars must not.
    const teardown = mountChart(container, { spec, rows, width: 300, height: 600 });
    expect(container.querySelector(".figure-grid-scroll")).not.toBeNull();
    const grid = container.querySelector(".figure-grid") as HTMLElement;
    // Both panes stay in a single row (2 explicit column widths, 2 panes).
    expect(container.querySelectorAll(".figure-pane").length).toBe(2);
    expect(grid.style.gridTemplateColumns.trim().split(/\s+/).length).toBe(2);
    teardown();
    container.remove();
  });

  it("the horizontal secondary band cursor shades the category row and labels each bar tip", () => {
    const { svg } = renderChart(spec, rows.filter((r) => r.facet === "A"), {
      width: 420,
      height: 600,
      document,
    });
    const driver = attachSecondaryBandCursor(svg, {
      rows: rows.filter((r) => r.facet === "A").map((r) => ({ _xc: r.time as string, series: r.series as string, _y: 2 })),
      isFaceted: true,
      categories: ["Northeast", "Midwest", "South"],
      colors: new Map([["2019", "#1"], ["2022", "#2"], ["2025", "#3"]]),
      seriesOrder: ["2019", "2022", "2025"],
      horizontal: true,
    });
    driver("Midwest", true);
    // One shaded row region (opacity 0.12) + one pill per series (3) labelling the bar tips.
    const coordGroup = svg.querySelector('g[opacity="1"]');
    expect(coordGroup).not.toBeNull();
    expect(coordGroup!.querySelectorAll('rect[opacity="0.12"]').length).toBe(1);
    expect(coordGroup!.querySelectorAll("text").length).toBe(3);
    driver(null);
    expect(svg.querySelector('g[opacity="1"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Single-facet small multiples: a small_multiples chart whose facet resolves to ONE value gets
// the standalone bar treatment (shade + bar-end pill) instead of the legacy floating tooltip.
// Discriminator: the coordinated path attaches the band crosshair with emitOnly:true, which does
// NOT create the tooltip highlight rect (.tbl-band-crosshair-hl); the tooltip path does.
// ---------------------------------------------------------------------------

describe("single-facet small multiples — bar panes get the pill hover, not the tooltip", () => {
  const barSpec: ChartSpec = {
    chartType: "bar",
    title: "One facet",
    subtitle: "Percentage points",
    xAxisType: "categorical",
    columns: { facet: "facet" },
    small_multiples: { columns: 2, mode: "shared" },
  } as ChartSpec;
  const barRows: TidyRow[] = ["Northeast", "Midwest", "South"].map(
    (cat) => ({ facet: "Countries", time: cat, value: "2" } as TidyRow),
  );

  it("a lone bar pane wires the crosshair in emitOnly/coordinated mode (no tooltip highlight rect)", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const teardown = mountChart(container, { spec: barSpec, rows: barRows, width: 838, height: 420 });
    const paneSvgs = container.querySelectorAll(".figure-pane svg");
    expect(paneSvgs.length).toBe(1); // single facet → one pane
    const svg = paneSvgs[0]!;
    expect(svg.querySelector(".tbl-band-crosshair-hit")).not.toBeNull(); // hover wired
    expect(svg.querySelector(".tbl-band-crosshair-hl")).toBeNull(); // emitOnly → no tooltip highlight
    teardown();
    container.remove();
  });

  it("a lone LINE pane is unchanged (continuous crosshair, still the tooltip path)", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const lineSpec = { ...barSpec, chartType: "line", xAxisType: "temporal" } as ChartSpec;
    const lineRows: TidyRow[] = ["2020-01-01", "2020-02-01", "2020-03-01"].map(
      (t) => ({ facet: "Countries", time: t, value: "2" } as TidyRow),
    );
    const teardown = mountChart(container, { spec: lineSpec, rows: lineRows, width: 838, height: 420 });
    const paneSvgs = container.querySelectorAll(".figure-pane svg");
    expect(paneSvgs.length).toBe(1);
    expect(paneSvgs[0]!.querySelector(".tbl-crosshair-hit")).not.toBeNull();
    teardown();
    container.remove();
  });
});

// ---------------------------------------------------------------------------
// Coordinated cursor — FACETED HISTOGRAM panes (shared mode). Hovering one pane echoes the same
// bin (shaded region + per-series pills) on every OTHER pane. Shared mode bins all panes to ONE
// set of thresholds, so the echo bin matches. Per-pane mode bins each pane independently, so it
// must NOT coordinate.
// ---------------------------------------------------------------------------

/** Map a client x to SVG x 1:1 with the viewBox (jsdom has no layout). */
function mockRect1to1(svg: SVGSVGElement): void {
  const vb = svg.viewBox.baseVal;
  Object.defineProperty(svg, "getBoundingClientRect", {
    value: () => ({
      width: vb.width, height: vb.height, top: 0, left: 0,
      right: vb.width, bottom: vb.height, x: 0, y: 0,
    }),
    configurable: true,
  });
}

describe("coordinated cursor — faceted histogram (shared mode: cross-pane bin echo)", () => {
  const histSpec: ChartSpec = {
    chartType: "histogram",
    title: "Faceted hist",
    xAxisType: "numeric",
    histogram: { bins: 4, domain: [0, 20] },
    columns: { x: "amount", facet: "facet" },
    small_multiples: { columns: 2, mode: "shared" },
    data: "inline",
  } as ChartSpec;

  const histRows: TidyRow[] = [];
  for (const facet of ["A", "B"]) {
    for (let v = 0; v < 16; v++) histRows.push({ facet, amount: String(v) } as TidyRow);
  }

  it("hovering one pane draws a coordinated bin region on the OTHER pane", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const teardown = mountChart(container, { spec: histSpec, rows: histRows, width: 838, height: 420 });
    const paneSvgs = Array.from(container.querySelectorAll<SVGSVGElement>(".figure-pane svg"));
    expect(paneSvgs.length).toBe(2);
    // Coordinated (not tooltip) path: primary hover is emitOnly (no tooltip highlight rect).
    paneSvgs.forEach((svg) => {
      expect(svg.querySelector(".tbl-hist-hover-hit")).not.toBeNull();
      expect(svg.querySelector(".tbl-hist-hover-hl")).toBeNull();
    });

    const [pane0, pane1] = paneSvgs as [SVGSVGElement, SVGSVGElement];
    mockRect1to1(pane0);
    // Hover the leftmost bin of pane 0.
    const rects0 = Array.from(pane0.querySelectorAll<SVGRectElement>('g[aria-label="rect"] rect'));
    const minX = Math.min(...rects0.map((r) => parseFloat(r.getAttribute("x")!)));
    const leftRect = rects0.find((r) => parseFloat(r.getAttribute("x")!) === minX)!;
    const cx = minX + parseFloat(leftRect.getAttribute("width")!) / 2;
    const hit = pane0.querySelector(".tbl-hist-hover-hit")!;
    hit.dispatchEvent(new PointerEvent("pointermove", { clientX: cx, clientY: 120, bubbles: true }));

    // The OTHER pane echoes: a visible coord group with the shaded bin region (opacity 0.12).
    const echo = pane1.querySelector<SVGGElement>("g.tbl-coord");
    expect(echo).not.toBeNull();
    expect(echo!.getAttribute("opacity")).toBe("1");
    expect(echo!.querySelectorAll('rect[opacity="0.12"]').length).toBe(1);
    // The source pane also renders its own (active) coord group.
    expect(pane0.querySelector('g.tbl-coord[opacity="1"]')).not.toBeNull();

    // Leaving clears the echo on both panes.
    hit.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    expect(pane1.querySelector('g.tbl-coord[opacity="1"]')).toBeNull();
    teardown();
    container.remove();
  });

  it("hovering a MIDDLE bin echoes the SAME bin (not the previous one) — off-by-one regression", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const teardown = mountChart(container, { spec: histSpec, rows: histRows, width: 838, height: 420 });
    const paneSvgs = Array.from(container.querySelectorAll<SVGSVGElement>(".figure-pane svg"));
    const [pane0, pane1] = paneSvgs as [SVGSVGElement, SVGSVGElement];
    mockRect1to1(pane0);

    // Rects sorted left→right are the bins (single series → one rect per bin). Hover bin index 2.
    const binRects = (svg: SVGSVGElement) =>
      Array.from(svg.querySelectorAll<SVGRectElement>('g[aria-label="rect"] rect')).sort(
        (a, b) => parseFloat(a.getAttribute("x")!) - parseFloat(b.getAttribute("x")!),
      );
    const rects0 = binRects(pane0);
    expect(rects0.length).toBeGreaterThanOrEqual(3);
    const target = rects0[2]!;
    const tx = parseFloat(target.getAttribute("x")!);
    const tw = parseFloat(target.getAttribute("width")!);
    const cx = tx + tw / 2;

    const hit = pane0.querySelector(".tbl-hist-hover-hit")!;
    hit.dispatchEvent(new PointerEvent("pointermove", { clientX: cx, clientY: 120, bubbles: true }));

    // The echo region on the OTHER pane must cover bin 2's x-span, NOT bin 1's (panes share
    // thresholds + width, so pane 1's bin-2 rect geometry equals pane 0's).
    const rects1 = binRects(pane1);
    const bin2 = rects1[2]!;
    const bin1 = rects1[1]!;
    const region = pane1.querySelector<SVGRectElement>('g.tbl-coord rect[opacity="0.12"]')!;
    expect(region).not.toBeNull();
    const rx = parseFloat(region.getAttribute("x")!);
    expect(rx).toBeCloseTo(parseFloat(bin2.getAttribute("x")!), 1);
    expect(Math.abs(rx - parseFloat(bin1.getAttribute("x")!))).toBeGreaterThan(1);
    expect(parseFloat(region.getAttribute("width")!)).toBeCloseTo(parseFloat(bin2.getAttribute("width")!), 1);

    // The source/active pane shades bin 2 as well.
    const region0 = pane0.querySelector<SVGRectElement>('g.tbl-coord[opacity="1"] rect[opacity="0.12"]')!;
    expect(region0).not.toBeNull();
    expect(parseFloat(region0.getAttribute("x")!)).toBeCloseTo(tx, 1);

    teardown();
    container.remove();
  });

  it("per-pane mode does NOT coordinate (each pane keeps its own tooltip, no cross-pane echo)", () => {
    const perPaneSpec = {
      ...histSpec,
      small_multiples: { columns: 2, mode: "per-pane" },
    } as ChartSpec;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const teardown = mountChart(container, { spec: perPaneSpec, rows: histRows, width: 838, height: 420 });
    const paneSvgs = Array.from(container.querySelectorAll<SVGSVGElement>(".figure-pane svg"));
    expect(paneSvgs.length).toBe(2);
    // Per-pane mode → plain tooltip hover (highlight rect present), no coordinated cursor.
    paneSvgs.forEach((svg) => {
      expect(svg.querySelector(".tbl-hist-hover-hl")).not.toBeNull();
    });

    const [pane0, pane1] = paneSvgs as [SVGSVGElement, SVGSVGElement];
    mockRect1to1(pane0);
    const rects0 = Array.from(pane0.querySelectorAll<SVGRectElement>('g[aria-label="rect"] rect'));
    const minX = Math.min(...rects0.map((r) => parseFloat(r.getAttribute("x")!)));
    const leftRect = rects0.find((r) => parseFloat(r.getAttribute("x")!) === minX)!;
    const cx = minX + parseFloat(leftRect.getAttribute("width")!) / 2;
    const hit = pane0.querySelector(".tbl-hist-hover-hit")!;
    hit.dispatchEvent(new PointerEvent("pointermove", { clientX: cx, clientY: 120, bubbles: true }));

    // No coordinated echo on the other pane.
    expect(pane1.querySelector("g.tbl-coord")).toBeNull();
    teardown();
    container.remove();
  });
});
