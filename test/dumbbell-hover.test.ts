// @vitest-environment jsdom
//
// Dumbbell live-hover PLUMBING. The hover GEOMETRY (which category the pointer resolves to) is
// browser-runtime — jsdom has no layout so getBoundingClientRect returns 0 and mark centers can't
// be read — and is verified in the live demo. What we CAN prove here: the hover is wired (a hit
// target is attached for both orientations, pointer events don't throw), a faceted figure mounts
// with a coordinated grid, and the tooltip HTML the hover shows lists each series' value.
import { describe, it, expect } from "vitest";
import { mountChart } from "../src/engine/render-live";
import { buildBandTooltipHtml, spreadPillCentersX, uniformBand } from "../src/engine/crosshair";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const SPEC: ChartSpec = {
  chartType: "dumbbell",
  title: "Rates",
  xAxisType: "categorical",
  orientation: "horizontal",
  columns: { category: "group", series: "measure", value: "rate" },
  series_order: ["current_law", "static", "collected"],
  series_marker: { current_law: "ink", static: "hollow", collected: "filled" },
  series_labels: { current_law: "Current law", static: "Static", collected: "Collected" },
  value_format: { decimals: 1, suffix: "%" },
  data: "d",
};
const ROWS: TidyRow[] = [
  { group: "Q1", measure: "current_law", rate: "2.1" },
  { group: "Q1", measure: "static", rate: "2.1" },
  { group: "Q1", measure: "collected", rate: "2.1" },
  { group: "Q5", measure: "current_law", rate: "28.4" },
  { group: "Q5", measure: "static", rate: "34.9" },
  { group: "Q5", measure: "collected", rate: "32.6" },
] as TidyRow[];

function mount(spec: ChartSpec) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const teardown = mountChart(container, { spec, rows: ROWS, width: 720, height: 400 });
  return { container, teardown };
}

describe("dumbbell hover — plumbing", () => {
  it("attaches a category hover hit target (horizontal)", () => {
    const { container } = mount(SPEC);
    expect(container.querySelector(".tbl-catline-hit")).not.toBeNull();
  });

  it("attaches a category hover hit target (vertical)", () => {
    const { container } = mount({ ...SPEC, orientation: "vertical" });
    expect(container.querySelector(".tbl-catline-hit")).not.toBeNull();
  });

  it("pointer events over the hit target do not throw", () => {
    const { container } = mount(SPEC);
    const hit = container.querySelector(".tbl-catline-hit") as SVGElement;
    expect(() => {
      hit.dispatchEvent(new PointerEvent("pointermove", { clientX: 200, clientY: 150, bubbles: true }));
      hit.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    }).not.toThrow();
  });

  it("faceted dumbbell mounts a coordinated multi-pane grid", () => {
    const facetRows: TidyRow[] = [
      { pane: "Quintiles", group: "Q1", measure: "static", rate: "2.1" },
      { pane: "Quintiles", group: "Q1", measure: "collected", rate: "2.0" },
      { pane: "Top decile", group: "Top 1%", measure: "static", rate: "39.0" },
      { pane: "Top decile", group: "Top 1%", measure: "collected", rate: "35.1" },
    ] as TidyRow[];
    const spec: ChartSpec = {
      ...SPEC,
      series_order: ["static", "collected"],
      columns: { category: "group", series: "measure", value: "rate", facet: "pane" },
      small_multiples: { columns: 2, mode: "shared" },
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    expect(() => mountChart(container, { spec, rows: facetRows, width: 838, height: 420 })).not.toThrow();
    expect(container.querySelectorAll(".figure-pane svg").length).toBe(2);
    // Each pane wired its own hover hit target (the coordinated cursor bus drives the rest live).
    expect(container.querySelectorAll(".figure-pane .tbl-catline-hit").length).toBe(2);
  });

  it("tooltip swatches are dots matching the legend markers (hollow ring / filled / ink)", () => {
    const rows = ROWS.map((r) => ({ _xc: r.group as string, series: r.measure as string, _y: Number(r.rate) }));
    const html = buildBandTooltipHtml("Q5", rows, {
      seriesLabels: SPEC.series_labels,
      seriesOrder: SPEC.series_order,
      yFormat: (v) => `${v.toFixed(1)}%`,
      swatchShape: "dot",
      swatchMarkers: new Map([
        ["current_law", "ink"],
        ["static", "hollow"],
        ["collected", "filled"],
      ]),
      renderedFills: new Map([
        ["current_law", "#1A1A2E"],
        ["static", "#E69F00"],
        ["collected", "#8856BF"],
      ]),
    });
    // Every swatch is a real circle: explicit width/height + border-radius (not the 18×3 line).
    expect(html).toContain("width:11px;height:11px;border-radius:50%");
    expect(html).not.toContain("is-square");
    // Hollow → a ring: white fill + series-color border.
    expect(html).toContain("background:#ffffff;border:2px solid #E69F00");
    // Ink → filled with the ink token; filled → the series color.
    expect(html).toContain("background:#1A1A2E");
    expect(html).toContain("background:#8856BF");
  });

  it("spreadPillCentersX de-collides overlapping coordinated pills (collision avoidance)", () => {
    // Two 40px-wide pills whose ideal centers are only 10px apart must be pushed to ≥ their
    // half-widths + gap (20+20+4 = 44) apart, order preserved, within bounds.
    const out = spreadPillCentersX([{ x: 100, w: 40 }, { x: 110, w: 40 }], 0, 1000);
    expect(out[1]! - out[0]!).toBeGreaterThanOrEqual(44 - 0.01);
    expect(out[0]!).toBeLessThan(out[1]!);
    // Non-overlapping pills are left essentially where they are.
    const far = spreadPillCentersX([{ x: 100, w: 30 }, { x: 400, w: 30 }], 0, 1000);
    expect(far[0]!).toBeCloseTo(100, 0);
    expect(far[1]!).toBeCloseTo(400, 0);
    // A pill near the left edge is clamped so its box stays inside [lo, hi].
    const clamped = spreadPillCentersX([{ x: 2, w: 40 }], 0, 1000);
    expect(clamped[0]!).toBeGreaterThanOrEqual(20 - 0.01);
  });

  it("tooltip HTML lists each series' value for the hovered category", () => {
    const html = buildBandTooltipHtml(
      "Q5",
      ROWS.map((r) => ({ _xc: r.group as string, series: r.measure as string, _y: Number(r.rate) })),
      {
        seriesLabels: SPEC.series_labels,
        seriesOrder: SPEC.series_order,
        yFormat: (v) => `${v.toFixed(1)}%`,
      },
    );
    expect(html).toContain("Q5");
    expect(html).toContain("Current law");
    expect(html).toContain("28.4%");
    expect(html).toContain("34.9%");
    expect(html).toContain("32.6%");
  });
});

// ---------------------------------------------------------------------------
// uniformBand — the hover strip's extent along the category axis.
//
// Sizing it from the GLOBAL average spacing, (last - first) / (n - 1), is only correct when the
// centers are evenly spaced. A sectioned horizontal dumbbell inserts spacer slots between sections,
// which inflates that average: on the 8-category / 3-section demo the real row pitch is 38px but the
// section gaps are 114px, so the average came out 59.71 and every band rendered 1.57x too tall,
// bleeding into the rows above and below. The true pitch is the SMALLEST adjacent gap — rows are
// evenly pitched within a section, and only spacers are wider.
// ---------------------------------------------------------------------------

describe("uniformBand — band extent along a category axis", () => {
  const at = (...cx: number[]) => cx.map((v, i) => ({ category: `c${i}`, cx: v }));
  const height = (b: { min: number; max: number }) => +(b.max - b.min).toFixed(4);

  it("uses the center pitch on evenly spaced categories", () => {
    const centers = at(50, 100, 150, 200);
    const b = uniformBand(centers, 1, 0, 400);
    expect(height(b)).toBe(50);
    expect(b.min).toBe(75);
    expect(b.max).toBe(125);
  });

  it("uses the ROW pitch, not the inflated average, when section spacers widen some gaps", () => {
    // The real geometry measured off the sectioned demo: 38px rows, 114px section gaps.
    const centers = at(38, 76, 114, 228, 266, 304, 418, 456);
    const clothing = uniformBand(centers, 4, 18, 480);
    expect(height(clothing)).toBe(38);
    expect(clothing.min).toBe(266 - 19);
    expect(clothing.max).toBe(266 + 19);
  });

  it("gives every category the same band height across sections", () => {
    const centers = at(38, 76, 114, 228, 266, 304, 418, 456);
    const heights = centers.map((_, i) => height(uniformBand(centers, i, 18, 480)));
    expect(new Set(heights).size).toBe(1);
    expect(heights[0]).toBe(38);
  });

  it("never spans into a neighbouring row", () => {
    const centers = at(38, 76, 114, 228, 266, 304, 418, 456);
    for (let i = 1; i < centers.length; i++) {
      const prev = uniformBand(centers, i - 1, 18, 480);
      const cur = uniformBand(centers, i, 18, 480);
      expect(prev.max).toBeLessThanOrEqual(cur.min + 0.0001);
    }
  });

  it("still clamps to the plot bounds, keeping the height", () => {
    const centers = at(38, 76, 114);
    const first = uniformBand(centers, 0, 30, 480);
    expect(first.min).toBe(30);
    expect(height(first)).toBe(38);
  });

  it("returns the full range for a single category", () => {
    expect(uniformBand(at(100), 0, 10, 200)).toEqual({ min: 10, max: 200 });
  });

  it("does not collapse to a zero-height band when two categories coincide", () => {
    // A duplicate center would make the smallest gap 0; fall back rather than emit nothing.
    const centers = at(50, 50, 150);
    expect(height(uniformBand(centers, 2, 0, 300))).toBeGreaterThan(0);
  });
});
