// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { horizontalBarChartHeight, horizontalBarHeight, figurePaneHeight } from "../src/engine/figure";
import { buildExportSvg } from "../src/embed/export-png";
import { renderFigure } from "../src/engine/index";
import { H } from "../src/embed/figure-chrome";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

// Synthetic dense two-section spec (no real data).
const spec: ChartSpec = {
  chartType: "bar",
  orientation: "horizontal",
  columns: { x: "category", value: "value", section: "panel" },
  xAxisType: "categorical",
  section_order: ["Group A", "Group B"],
  data: "inline",
} as unknown as ChartSpec;

function denseRows(nA: number, nB: number): TidyRow[] {
  const rows: TidyRow[] = [];
  for (let i = 0; i < nA; i++) rows.push({ category: `A${i}`, panel: "Group A", value: String(i + 1) } as TidyRow);
  for (let i = 0; i < nB; i++) rows.push({ category: `B${i}`, panel: "Group B", value: String(i + 1) } as TidyRow);
  return rows;
}

describe("horizontalBarChartHeight", () => {
  it("grows with row count (more rows ⇒ taller)", () => {
    const few = horizontalBarChartHeight(spec, denseRows(3, 3));
    const many = horizontalBarChartHeight(spec, denseRows(8, 38));
    expect(many).toBeGreaterThan(few);
    expect(many).toBeGreaterThan(H); // taller than the fixed 750 export frame
  });
});

describe("buildExportSvg — single horizontal sectioned chart", () => {
  it("grows the export frame past the fixed 750 height instead of cramming rows", () => {
    const svg = buildExportSvg(spec, denseRows(8, 38));
    const h = Number(svg.getAttribute("height"));
    expect(h).toBeGreaterThan(H);
  });

  it("leaves a non-horizontal single chart at the fixed frame height", () => {
    const vspec = { ...spec, orientation: "vertical" } as ChartSpec;
    const svg = buildExportSvg(vspec, denseRows(8, 38));
    expect(Number(svg.getAttribute("height"))).toBe(H);
  });
});

describe("figurePaneHeight", () => {
  const base = { columns: { x: "category", value: "value", facet: "panel" }, xAxisType: "categorical", data: "x" };
  it("waterfall figure panes are 420 (matches the live mount, not the old 240)", () => {
    expect(figurePaneHeight({ ...base, chartType: "waterfall" } as any)).toBe(420);
  });
  it("dotplot/bar/stacked (vertical) figure panes are 320", () => {
    expect(figurePaneHeight({ ...base, chartType: "dotplot" } as any)).toBe(320);
    expect(figurePaneHeight({ ...base, chartType: "bar" } as any)).toBe(320);
    expect(figurePaneHeight({ ...base, chartType: "stacked" } as any)).toBe(320);
  });
  it("line/scatter/area figure panes are 240", () => {
    expect(figurePaneHeight({ ...base, chartType: "line" } as any)).toBe(240);
    expect(figurePaneHeight({ ...base, chartType: "scatter" } as any)).toBe(240);
  });
  it("horizontal bar AND horizontal stacked figures grow (undefined ⇒ auto-height)", () => {
    expect(figurePaneHeight({ ...base, chartType: "bar", orientation: "horizontal" } as any)).toBeUndefined();
    expect(figurePaneHeight({ ...base, chartType: "stacked", orientation: "horizontal" } as any)).toBeUndefined();
  });
});

describe("figurePaneHeight — export-integration", () => {
  it("waterfall figure export renders 420px panes, not 240 (regression: export drift)", () => {
    const spec = {
      chartType: "waterfall",
      columns: { x: "step", value: "value", facet: "model" },
      xAxisType: "categorical",
      small_multiples: { facet_field: "model" },
      data: "x",
    } as any;
    const rows: TidyRow[] = [];
    for (const m of ["Original", "New"]) {
      ["Start", "Step 1", "Step 2", "End"].forEach((s, i) =>
        rows.push({ step: s, model: m, value: String(2 - i * 0.4) } as TidyRow),
      );
    }
    const fig = renderFigure(spec, rows, { gridWidth: 920, gridGap: 20, height: figurePaneHeight(spec), columns: 2 });
    const paneH = Number((fig.panes[0]!.svg as SVGSVGElement).getAttribute("height"));
    expect(paneH).toBe(420);
  });

  it("horizontal stacked figure grows its pane height with row count", () => {
    const spec = {
      chartType: "stacked",
      orientation: "horizontal",
      columns: { x: "category", value: "value", series: "series", facet: "panel" },
      xAxisType: "categorical",
      small_multiples: { facet_field: "panel" },
      data: "x",
    } as any;
    const rows: TidyRow[] = [];
    for (const p of ["P1", "P2"]) {
      for (let c = 0; c < 20; c++) {
        for (const s of ["A", "B"]) rows.push({ category: `C${c}`, series: s, value: "1", panel: p } as TidyRow);
      }
    }
    // undefined height ⇒ renderFigure auto-grows for horizontal bar/stacked.
    const fig = renderFigure(spec, rows, { gridWidth: 920, gridGap: 20, height: figurePaneHeight(spec), columns: 2 });
    const paneH = Number((fig.panes[0]!.svg as SVGSVGElement).getAttribute("height"));
    expect(paneH).toBeGreaterThan(420); // 20 categories ⇒ taller than any fixed pane height
  });
});

// ---------------------------------------------------------------------------
// Per-facet pane heights (Task 6): a columns:1 horizontal stacked figure whose two facets carry
// DISJOINT categories of very different counts must size EACH pane to its own row count, not the
// busiest facet's — otherwise the "Few rows" pane is stretched to the "Many rows" pane's height
// and its bars render much too thick. Both facets are sized ABOVE HORIZONTAL_HEIGHT_FLOOR (400px,
// ~15 categories at this per-category budget) so the height difference reflects the per-pane
// category-count math, not both facets separately hitting the same readability floor.
// ---------------------------------------------------------------------------

const RAGGED_SPEC: ChartSpec = {
  chartType: "stacked",
  orientation: "horizontal",
  title: "Ragged facets",
  columns: { x: "group", value: "share", series: "cut_size", facet: "section" },
  xAxisType: "categorical",
  small_multiples: { columns: 1, pane_order: ["Many rows", "Few rows"] },
  barStack: { netDisplay: "none" },
  yAxisPolicy: { max: 100 },
  data: "x",
} as unknown as ChartSpec;

const RAGGED_MANY_CATS = 40;
const RAGGED_FEW_CATS = 15;

function raggedRows(): TidyRow[] {
  const rows: TidyRow[] = [];
  for (let i = 1; i <= RAGGED_MANY_CATS; i++) {
    const cat = `R${String(i).padStart(2, "0")}`;
    rows.push({ group: cat, section: "Many rows", cut_size: "A", share: "60" } as TidyRow);
    rows.push({ group: cat, section: "Many rows", cut_size: "B", share: "40" } as TidyRow);
  }
  for (let i = 1; i <= RAGGED_FEW_CATS; i++) {
    const cat = `Q${String(i).padStart(2, "0")}`;
    rows.push({ group: cat, section: "Few rows", cut_size: "A", share: "55" } as TidyRow);
    rows.push({ group: cat, section: "Few rows", cut_size: "B", share: "45" } as TidyRow);
  }
  return rows;
}

// Bar rect height (the fy-band bar thickness) from a horizontal stacked pane's svg: any rect in
// the bar layer — the stack segments all share one fy band height regardless of series count.
function firstBarRectHeight(svg: SVGSVGElement): number {
  const rect = svg.querySelector('g[aria-label="bar"] rect');
  return Number(rect?.getAttribute("height") ?? NaN);
}

describe("renderFigure — per-facet pane heights (ragged horizontal facets, Task 6)", () => {
  it("ragged facets get proportional per-pane heights (fig.paneHeights defined, busiest pane taller)", () => {
    const rows = raggedRows();
    const fig = renderFigure(RAGGED_SPEC, rows, {
      gridWidth: 920,
      gridGap: 20,
      height: figurePaneHeight(RAGGED_SPEC),
      columns: 1,
    });
    expect(fig.paneHeights).toBeDefined();
    expect(fig.paneHeights!.length).toBe(2);
    const [manyH, fewH] = fig.paneHeights!;
    expect(manyH!).toBeGreaterThan(fewH! * 1.5);
    // Each pane's rendered SVG height matches its own entry in fig.paneHeights.
    fig.panes.forEach((p, i) => {
      expect(Number((p.svg as SVGSVGElement).getAttribute("height"))).toBe(fig.paneHeights![i]);
    });
  });

  it("uniform bar thickness across ragged facets (the actual proof: rect heights ~equal)", () => {
    const rows = raggedRows();
    const fig = renderFigure(RAGGED_SPEC, rows, {
      gridWidth: 920,
      gridGap: 20,
      height: figurePaneHeight(RAGGED_SPEC),
      columns: 1,
    });
    const h0 = firstBarRectHeight(fig.panes[0]!.svg as SVGSVGElement);
    const h1 = firstBarRectHeight(fig.panes[1]!.svg as SVGSVGElement);
    expect(h0).toBeGreaterThan(0);
    expect(Number.isNaN(h1)).toBe(false);
    expect(Math.abs(h0 - h1)).toBeLessThan(2);
  });

  it("shared-category horizontal figures are UNCHANGED: equal paneHeights across facets", () => {
    // Both facets share the SAME category count (5 each) — the common case. Busiest-pane sizing
    // and per-pane sizing must coincide exactly (byte-identical to the pre-fix single auto-height).
    const rows: TidyRow[] = [];
    for (const facet of ["F1", "F2"]) {
      for (let i = 1; i <= 5; i++) {
        rows.push({ group: `C${i}`, section: facet, cut_size: "A", share: "60" } as TidyRow);
        rows.push({ group: `C${i}`, section: facet, cut_size: "B", share: "40" } as TidyRow);
      }
    }
    const spec: ChartSpec = {
      ...RAGGED_SPEC,
      small_multiples: { columns: 1, pane_order: ["F1", "F2"] },
    };
    const fig = renderFigure(spec, rows, {
      gridWidth: 920,
      gridGap: 20,
      height: figurePaneHeight(spec),
      columns: 1,
    });
    expect(fig.paneHeights).toBeDefined();
    expect(fig.paneHeights![0]).toBe(fig.paneHeights![1]);
    // Matches the shared horizontalBarHeight computation directly (stacked ⇒ never grouped).
    const expected = horizontalBarHeight({
      nCategories: 5,
      nSeries: 2,
      grouped: false,
      nSpacers: 0,
      maxLabelLines: 1,
      extraTopPx: 0,
    });
    expect(fig.paneHeights![0]).toBe(expected);
  });

  it("an explicit caller height overrides auto per-pane sizing (uniform, not per-facet)", () => {
    const rows = raggedRows();
    const fig = renderFigure(RAGGED_SPEC, rows, { gridWidth: 920, gridGap: 20, height: 500, columns: 1 });
    expect(fig.paneHeights).toBeUndefined();
    fig.panes.forEach((p) => expect(Number((p.svg as SVGSVGElement).getAttribute("height"))).toBe(500));
  });
});

describe("buildExportSvg — per-facet pane heights (Task 6 export layout)", () => {
  it("ragged panes get different heights, laid out with no overlap, in a frame that fits both", () => {
    const rows = raggedRows();
    const svg = buildExportSvg(RAGGED_SPEC, rows);
    const inner = Array.from(svg.querySelectorAll("svg"));
    expect(inner.length).toBe(2);
    const h0 = Number(inner[0]!.getAttribute("height"));
    const h1 = Number(inner[1]!.getAttribute("height"));
    expect(h0).not.toBe(h1);
    expect(h0).toBeGreaterThan(h1);
    const y0 = Number(inner[0]!.getAttribute("y"));
    const y1 = Number(inner[1]!.getAttribute("y"));
    // No overlap: pane 1 starts at/after pane 0's bottom edge plus its title band (18px, matching
    // export-png.ts's PANE_TITLE_H).
    const PANE_TITLE_H = 18;
    expect(y1).toBeGreaterThanOrEqual(y0 + h0 + PANE_TITLE_H);
    // Frame fits both panes (no clipping): the root height reaches at least pane 1's bottom edge.
    const rootH = Number(svg.getAttribute("height"));
    expect(rootH).toBeGreaterThanOrEqual(y1 + h1);
  });

  it("a non-horizontal figure export is unchanged: every pane shares one height", () => {
    const rows: TidyRow[] = [];
    for (const region of ["Men", "Women", "Nonbinary"]) {
      for (let y = 2020; y <= 2023; y++) {
        rows.push({ facet: region, series: "A", time: `${y}-01-01`, value: String(2 + (y - 2020)) } as TidyRow);
      }
    }
    const spec: ChartSpec = {
      chartType: "line",
      title: "Vertical figure",
      xAxisType: "temporal",
      data: "inline",
      columns: { facet: "facet" },
      small_multiples: { columns: 2, mode: "shared" },
    };
    const svg = buildExportSvg(spec, rows);
    const inner = Array.from(svg.querySelectorAll("svg"));
    expect(inner.length).toBe(3);
    const heights = inner.map((s) => Number(s.getAttribute("height")));
    expect(new Set(heights).size).toBe(1);
  });
});
