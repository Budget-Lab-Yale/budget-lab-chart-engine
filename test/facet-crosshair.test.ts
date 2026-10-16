// @vitest-environment jsdom
//
// Hover wiring for small-multiples figures (per-pane crosshair, secondary band cursor, coordinated
// histogram cursor), plus the live line crosshair card's row rules.
//
// Pixel-accurate pointer hit-testing is verified in the browser (jsdom has no layout); these tests
// stub the SVG's client rect where they hover.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { attachSecondaryBandCursor } from "../src/engine/crosshair";
import { mountChart } from "../src/engine/render-live";
import { renderChart } from "../src/engine/index";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";
import { mountHover, hoverPlotAt, cardHtml } from "./helpers/hover-harness";

// ---------------------------------------------------------------------------
// The line crosshair card (attachCrosshair, reached through a live mount): which rows it draws at
// the snapped x, in what order, and how it labels and keys them.
// ---------------------------------------------------------------------------

describe("line crosshair card", () => {
  // The card is a body-level singleton, so one case's card would leak into the next.
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const SPEC = {
    chartType: "line",
    title: "t",
    xAxisType: "numeric",
    columns: { x: "time", value: "value", series: "series" },
  } as unknown as ChartSpec;
  const ROWS = [
    { time: "1", series: "<5 Weeks", value: "3.2" },
    { time: "2", series: "<5 Weeks", value: "4.1" },
    { time: "1", series: "27+ Weeks", value: "1.5" },
    { time: "2", series: "27+ Weeks", value: "1.8" },
  ] as unknown as TidyRow[];

  /** Mount `spec`, hover near the right edge (x = 2), and return the card's HTML. */
  const cardAtLastX = (spec: ChartSpec, rows: TidyRow[] = ROWS): string => {
    const { svgs } = mountHover(spec, rows);
    hoverPlotAt(svgs[0]!, 0.95);
    return cardHtml();
  };

  it("shows only the values at the snapped x", () => {
    const html = cardAtLastX(SPEC);
    expect(html).toContain("4.1");
    expect(html).toContain("1.8");
    expect(html).not.toContain("3.2");
    expect(html).not.toContain("1.5");
  });

  it("orders its rows by series_order", () => {
    const html = cardAtLastX({ ...SPEC, series_order: ["27+ Weeks", "<5 Weeks"] } as ChartSpec);
    // "<5 Weeks" is HTML-escaped to "&lt;5 Weeks" in the output.
    expect(html.indexOf("27+ Weeks")).toBeGreaterThan(-1);
    expect(html.indexOf("27+ Weeks")).toBeLessThan(html.indexOf("&lt;5 Weeks"));
  });

  it("skips a series with no value at the snapped x", () => {
    const rows = ROWS.map((r) =>
      (r as unknown as Record<string, string>).series === "27+ Weeks" && (r as unknown as Record<string, string>).time === "2"
        ? ({ ...r, value: "" } as unknown as TidyRow)
        : r,
    );
    const html = cardAtLastX(SPEC, rows);
    expect(html).toContain("&lt;5 Weeks");
    expect(html).not.toContain("27+ Weeks");
  });

  it("applies series_labels and draws a dashed series' key dashed", () => {
    const html = cardAtLastX({
      ...SPEC,
      series_labels: { "<5 Weeks": "Short term" },
      series_colors: { "<5 Weeks": "#123456" },
      series_styles: { "<5 Weeks": { dashed: true } },
    } as unknown as ChartSpec);
    expect(html).toContain("Short term");
    // The dash is drawn, not classed: `is-dashed` + a `--swatch-color` custom property used to feed
    // a hard-stop CSS gradient, which had to be kept in sync with the SVG dash by hand.
    const row = [...new DOMParser().parseFromString(html, "text/html").querySelectorAll(".tbl-tooltip-row")]
      .find((r) => r.textContent!.includes("Short term"))!;
    const line = row.querySelector("svg line")!;
    expect(line.getAttribute("stroke-dasharray")).toBeTruthy();
    expect(line.getAttribute("style")).toContain("stroke:#123456");
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

// A horizontal chart has no panes to coordinate (columns.facet is rejected there,
// spec/facet-groups.ts); the secondary band cursor still draws a horizontal bar's hover.
describe("secondary band cursor — horizontal bars (row highlight + tip pills)", () => {
  const spec: ChartSpec = {
    chartType: "bar",
    title: "h",
    subtitle: "Percentage points",
    xAxisType: "categorical",
    orientation: "horizontal",
    series_order: ["2019", "2022", "2025"],
  } as ChartSpec;

  const rows: TidyRow[] = [];
  for (const facet of ["A", "B"]) {
    for (const cat of ["Northeast", "Midwest", "South"]) {
      for (const s of ["2019", "2022", "2025"]) {
        rows.push({ facet, time: cat, series: s, value: "2" } as TidyRow);
      }
    }
  }

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

  // chrome.valuePills: false was threaded to the PRIMARY per-pane hover and to the legend-hover
  // pills, but attachSecondaryHistogramCursor's own addCoordPill call had no gate at all — a
  // faceted histogram with the switch off still drew pills on the coordinated (echoed) panes.
  // Asserts the concrete DOM fact (no .tbl-coord-pill node) rather than that a function was
  // called, and includes the default-true case as a regression guard so the selector is proven
  // to match something real, not merely absent for an unrelated reason.
  it("chrome.valuePills: false suppresses the coordinated cursor's pills too — band echo untouched", () => {
    function hoverLeftBin(container: HTMLElement, spec: ChartSpec): { pane0: SVGSVGElement; pane1: SVGSVGElement; teardown: () => void } {
      const teardown = mountChart(container, { spec, rows: histRows, width: 838, height: 420 });
      const [pane0, pane1] = Array.from(container.querySelectorAll<SVGSVGElement>(".figure-pane svg")) as [
        SVGSVGElement,
        SVGSVGElement,
      ];
      mockRect1to1(pane0);
      const rects0 = Array.from(pane0.querySelectorAll<SVGRectElement>('g[aria-label="rect"] rect'));
      const minX = Math.min(...rects0.map((r) => parseFloat(r.getAttribute("x")!)));
      const leftRect = rects0.find((r) => parseFloat(r.getAttribute("x")!) === minX)!;
      const cx = minX + parseFloat(leftRect.getAttribute("width")!) / 2;
      const hit = pane0.querySelector(".tbl-hist-hover-hit")!;
      hit.dispatchEvent(new PointerEvent("pointermove", { clientX: cx, clientY: 120, bubbles: true }));
      return { pane0, pane1, teardown };
    }

    // Regression guard: the default (chrome unset) case DOES draw a pill on the echoed pane, so
    // the absence asserted below is the switch's doing, not a selector that never matches.
    const defaultContainer = document.createElement("div");
    document.body.appendChild(defaultContainer);
    const { pane1: defaultPane1, teardown: defaultTeardown } = hoverLeftBin(defaultContainer, histSpec);
    expect(defaultPane1.querySelector("g.tbl-coord .tbl-coord-pill")).not.toBeNull();
    defaultTeardown();
    defaultContainer.remove();

    const noPillsSpec: ChartSpec = { ...histSpec, chrome: { valuePills: false } } as ChartSpec;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const { pane0, pane1, teardown } = hoverLeftBin(container, noPillsSpec);

    // The band echo (region) is untouched — same "highlight stays, pills go" split as
    // chrome.tooltip's own contract.
    const echo = pane1.querySelector<SVGGElement>("g.tbl-coord");
    expect(echo).not.toBeNull();
    expect(echo!.getAttribute("opacity")).toBe("1");
    expect(echo!.querySelectorAll('rect[opacity="0.12"]').length).toBe(1);
    // No pill on the OTHER (echoed) pane's coordinated cursor.
    expect(echo!.querySelector(".tbl-coord-pill")).toBeNull();
    // ...nor on the source (actively-hovered) pane's own coordinated cursor.
    const sourceCoord = pane0.querySelector<SVGGElement>('g.tbl-coord[opacity="1"]');
    expect(sourceCoord).not.toBeNull();
    expect(sourceCoord!.querySelector(".tbl-coord-pill")).toBeNull();

    teardown();
    container.remove();
  });
});
