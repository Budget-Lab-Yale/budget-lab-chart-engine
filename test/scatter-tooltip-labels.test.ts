// @vitest-environment jsdom
//
// `tooltip_x_label` / `tooltip_y_label`: scatter-only overrides for the hover card's two value-row
// labels. An axis title is written to span the plot; a card row label is read in a narrow floating
// card, so a long title makes an oversized card. Absent, the rows fall back to the axis titles (the
// pre-existing behaviour, covered by scatter-point-label.test.ts). The axis itself is untouched.
import { describe, it, expect, beforeEach } from "vitest";
import { mountChart } from "../src/engine/render-live";
import { validateSpec } from "../src/spec/validate";
import { buildExportSvg } from "../src/embed/export-png";
import { formatNumericX } from "../src/engine/util";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const rowsOf = (o: Record<string, string>[]): TidyRow[] => o as unknown as TidyRow[];

function mount(spec: ChartSpec, rows: TidyRow[]): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  mountChart(container, { spec, rows, width: 720, height: 400 } as never);
  return container;
}

function hoverDot(svg: SVGSVGElement, i: number): void {
  const dots = svg.querySelectorAll('g[aria-label="dot"] path, g[aria-label="dot"] circle');
  dots[i]!.dispatchEvent(new PointerEvent("pointerenter", { clientX: 10, clientY: 10, bubbles: true }));
}

/** The two value-row labels, in order, read off the mounted card. */
function rowLabels(svg: SVGSVGElement, i: number): string[] {
  hoverDot(svg, i);
  const tip = document.body.querySelector<HTMLElement>(".tbl-tooltip")!;
  return [...tip.querySelectorAll(".tbl-tooltip-row .tbl-tooltip-label")].map((el) => el.textContent ?? "");
}

const canvas = (c: HTMLElement) => c.querySelector<SVGSVGElement>(".figure-canvas svg")!;

// The card is a DOCUMENT-level singleton, so a previous test's shown state would otherwise be read
// as this one's.
beforeEach(() => { document.body.innerHTML = ""; });

const SPEC = {
  chartType: "scatter",
  xAxisType: "numeric",
  x_axis_title: "Cumulative debt reduction, 2026-2035 (percent of baseline GDP)",
  y_axis_title: "Ten-year primary balance improvement (percent of baseline GDP)",
  columns: { x: "x", value: "y" },
} as unknown as ChartSpec;

const ROWS = rowsOf([{ x: "1", y: "10" }]);

describe("tooltip_x_label / tooltip_y_label", () => {
  it("override the card's row labels, and the axis titles do not appear in the card", () => {
    const spec = {
      ...SPEC,
      tooltip_x_label: "Debt change",
      tooltip_y_label: "Reduction",
    } as unknown as ChartSpec;
    const svg = canvas(mount(spec, ROWS));
    expect(rowLabels(svg, 0)).toEqual(["Debt change:", "Reduction:"]);
    const tip = document.body.querySelector<HTMLElement>(".tbl-tooltip")!;
    expect(tip.textContent).not.toContain(spec.x_axis_title);
    expect(tip.textContent).not.toContain(spec.y_axis_title);
  });

  it("falls back to the axis titles when absent (pre-existing behaviour)", () => {
    const svg = canvas(mount(SPEC, ROWS));
    expect(rowLabels(svg, 0)).toEqual([`${SPEC.x_axis_title}:`, `${SPEC.y_axis_title}:`]);
  });

  it("overrides only the field that is set, leaving the other on its axis-title fallback", () => {
    const spec = { ...SPEC, tooltip_x_label: "Debt change" } as unknown as ChartSpec;
    const svg = canvas(mount(spec, ROWS));
    expect(rowLabels(svg, 0)).toEqual(["Debt change:", `${SPEC.y_axis_title}:`]);
  });

  it("falls all the way through to the literal x/Value when neither the override nor the axis title is set", () => {
    // The terminal link of the three-tier `??` chain: no tooltip_x_label/tooltip_y_label AND no
    // x_axis_title/y_axis_title. Reading the fallback chain in render-live.ts is not the same as a
    // mounted-and-hovered assertion — this is the case none of the other tests exercise.
    const spec = {
      chartType: "scatter",
      xAxisType: "numeric",
      columns: { x: "x", value: "y" },
    } as unknown as ChartSpec;
    const svg = canvas(mount(spec, ROWS));
    expect(rowLabels(svg, 0)).toEqual(["x:", "Value:"]);
  });

  it("does not leak into the axis title element — the axis is untouched", () => {
    const spec = {
      ...SPEC,
      tooltip_x_label: "Debt change",
      tooltip_y_label: "Reduction",
    } as unknown as ChartSpec;
    const card = mount(spec, ROWS);
    const xAxisTitleEl = card.querySelector(".figure-x-axis-title");
    const yAxisTitleEl = card.querySelector(".figure-y-axis-title");
    expect(xAxisTitleEl?.textContent).toBe(SPEC.x_axis_title);
    expect(yAxisTitleEl?.textContent).toBe(SPEC.y_axis_title);
  });
});

describe("tooltip_x_label / tooltip_y_label in the PNG export", () => {
  it("does not appear — CONFIG-SPEC says hover-only, and a PNG has no hover", () => {
    // The claim is only as good as this assertion: the export re-renders from the spec, so a
    // channel wired into the render rather than the hover would silently show up here. Mirrors
    // test/scatter-point-label.test.ts's identical check for columns.point_label.
    const spec = {
      ...SPEC,
      title: "Exported",
      tooltip_x_label: "Debt change",
      tooltip_y_label: "Reduction",
    } as unknown as ChartSpec;
    const svg = buildExportSvg(spec, ROWS);
    // Positive control: without it, an export that rendered nothing would pass the absence checks.
    expect(svg.textContent).toContain("Exported");
    expect(svg.querySelectorAll("text").length).toBeGreaterThan(1);
    expect(svg.textContent).not.toContain("Debt change");
    expect(svg.textContent).not.toContain("Reduction");
  });
});

describe("tooltip_x_label / tooltip_y_label validation", () => {
  it("rejects tooltip_x_label on a line chart", () => {
    const res = validateSpec({
      title: "T", chartType: "line", xAxisType: "temporal", data: "d.csv",
      columns: { x: "x", value: "y" }, tooltip_x_label: "Debt change",
    });
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/tooltip_x_label/);
  });

  it("rejects tooltip_y_label on a histogram", () => {
    const res = validateSpec({
      title: "T", chartType: "histogram", xAxisType: "numeric", data: "d.csv",
      columns: { x: "x", value: "y" }, histogram: { binWidth: 1 }, tooltip_y_label: "Reduction",
    });
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/tooltip_y_label/);
  });

  it("accepts both on a scatter", () => {
    const res = validateSpec({
      title: "T", chartType: "scatter", xAxisType: "numeric", data: "d.csv",
      columns: { x: "x", value: "y" },
      tooltip_x_label: "Debt change", tooltip_y_label: "Reduction",
    });
    expect(res.valid).toBe(true);
  });

  it("still accepts a non-scatter that never mentions either field", () => {
    const res = validateSpec({
      title: "T", chartType: "line", xAxisType: "temporal", data: "d.csv",
      columns: { x: "x", value: "y" },
    });
    expect(res.valid).toBe(true);
  });
});

describe("the scatter card's x value formatting", () => {
  /** The card's value cells, in row order (x then y). */
  function rowValues(svg: SVGSVGElement, i: number): string[] {
    hoverDot(svg, i);
    const tip = document.body.querySelector<HTMLElement>(".tbl-tooltip")!;
    return [...tip.querySelectorAll(".tbl-tooltip-row .tbl-tooltip-value")].map((el) => el.textContent ?? "");
  }

  it("rounds to two decimals and does NOT group thousands, matching the axis ticks", () => {
    // The card and the `{x}` callout token share `formatNumericX`. It groups nothing on purpose: a
    // numeric x is most often a year or an index and the axis ticks are ungrouped for that reason,
    // so a card reading `2,000` under a `2000` tick is the divergence, not the fix.
    const rows = rowsOf([{ x: "2.593569308310415", y: "10" }, { x: "2000", y: "20" }, { x: "2021", y: "30" }]);
    const svg = canvas(mount(SPEC, rows));
    expect(rowValues(svg, 0)[0]).toBe("2.59");
    expect(rowValues(svg, 1)[0]).toBe("2000");
    expect(rowValues(svg, 2)[0]).toBe("2021");
  });

  it("is locale-fixed: the same string on any host, because the token it shares is drawn into the SVG", () => {
    // `toLocaleString()` with no locale renders `2,59` on a de-DE host, and `{x}` reaches the SVG
    // and the PNG export. Asserting the formatter directly is the only way to pin the locale
    // argument itself — a card assertion passes on an en-US test runner either way.
    expect(formatNumericX(2.593569308310415)).toBe("2.59");
    expect(formatNumericX(2000)).toBe("2000");
    expect(formatNumericX(-1234.5678)).toBe("-1234.57");
    expect(formatNumericX(1e6)).toBe("1000000");
  });
});
