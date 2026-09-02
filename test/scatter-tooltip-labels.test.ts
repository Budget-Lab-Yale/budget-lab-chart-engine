// @vitest-environment jsdom
//
// `tooltip_x_label` / `tooltip_y_label`: scatter-only overrides for the hover card's two value-row
// labels. An axis title is written to span the plot; a card row label is read in a narrow floating
// card, so a long title makes an oversized card. Absent, the rows fall back to the axis titles (the
// pre-existing behaviour, covered by scatter-point-label.test.ts). The axis itself is untouched.
import { describe, it, expect, beforeEach } from "vitest";
import { mountChart } from "../src/engine/render-live";
import { validateSpec } from "../src/spec/validate";
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
