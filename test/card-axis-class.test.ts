// @vitest-environment jsdom
//
// Task 34 (issue #34): the x-axis-title breathing-room CSS was keyed to the CHART type
// (`.chart-scatter .figure-x-axis-title`), but the cause is the AXIS type — a numeric x-axis
// leaves less whitespace below its tick labels than the two-row temporal axis the default was
// tuned for. This asserts the card carries a new `x-<xAxisType>` class (standalone AND figure),
// and that the CSS rule is keyed to it instead of `.chart-scatter`.
import { describe, it, expect } from "vitest";
import { mountChart } from "../src/engine/render-live";
import { CHART_CSS } from "../src/embed/styles";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const rowsOf = (o: Record<string, string>[]): TidyRow[] => o as unknown as TidyRow[];

function mount(spec: ChartSpec, rows: TidyRow[]): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  mountChart(container, { spec, rows, width: 720, height: 400 } as never);
  return container;
}

describe("card carries an x-<xAxisType> class (issue #34)", () => {
  it("a histogram (numeric x) standalone card carries figure-card, chart-histogram, x-numeric", () => {
    const spec = {
      chartType: "histogram",
      title: "hist",
      xAxisType: "numeric",
      columns: { x: "value" },
      data: "inline",
    } as unknown as ChartSpec;
    const rows = rowsOf([{ value: "1" }, { value: "2" }, { value: "3" }]);
    const card = mount(spec, rows).querySelector<HTMLElement>(".figure-card")!;
    expect(card.classList.contains("figure-card")).toBe(true);
    expect(card.classList.contains("chart-histogram")).toBe(true);
    expect(card.classList.contains("x-numeric")).toBe(true);
  });

  it("a scatter standalone card carries x-numeric", () => {
    const spec = {
      chartType: "scatter",
      title: "scatter",
      xAxisType: "numeric",
      columns: { x: "x", value: "y" },
      data: "inline",
    } as unknown as ChartSpec;
    const rows = rowsOf([{ x: "1", y: "10" }, { x: "2", y: "20" }]);
    const card = mount(spec, rows).querySelector<HTMLElement>(".figure-card")!;
    expect(card.classList.contains("x-numeric")).toBe(true);
  });

  it("a temporal line standalone card carries x-temporal, not x-numeric", () => {
    const spec = {
      chartType: "line",
      title: "line",
      xAxisType: "temporal",
      data: "inline",
    } as unknown as ChartSpec;
    const rows = rowsOf([
      { time: "2020-01-01", series: "A", value: "1" },
      { time: "2020-02-01", series: "A", value: "2" },
    ]);
    const card = mount(spec, rows).querySelector<HTMLElement>(".figure-card")!;
    expect(card.classList.contains("x-temporal")).toBe(true);
    expect(card.classList.contains("x-numeric")).toBe(false);
  });

  it("a two-pane small_multiples scatter figure card carries figure-card and x-numeric", () => {
    const spec = {
      chartType: "scatter",
      title: "scatter sm",
      xAxisType: "numeric",
      columns: { x: "x", value: "y", facet: "f" },
      small_multiples: { columns: 2 },
      data: "inline",
    } as unknown as ChartSpec;
    const rows = rowsOf([
      { x: "1", y: "10", f: "P" },
      { x: "2", y: "20", f: "P" },
      { x: "1", y: "5", f: "Q" },
      { x: "2", y: "15", f: "Q" },
    ]);
    const container = document.createElement("div");
    document.body.appendChild(container);
    mountChart(container, { spec, rows, width: 838, height: 420 } as never);
    const card = container.querySelector<HTMLElement>(".figure-card")!;
    expect(card).not.toBeNull();
    expect(card.classList.contains("figure-card")).toBe(true);
    expect(card.classList.contains("x-numeric")).toBe(true);
    const panes = container.querySelectorAll(".figure-pane svg");
    expect(panes.length).toBeGreaterThan(0);
  });
});

describe("CHART_CSS keys the axis-title gap to the axis class, not the chart class (issue #34)", () => {
  it("contains .x-numeric .figure-x-axis-title", () => {
    expect(CHART_CSS).toContain(".x-numeric .figure-x-axis-title");
  });

  it("no longer contains .chart-scatter .figure-x-axis-title", () => {
    expect(CHART_CSS).not.toContain(".chart-scatter .figure-x-axis-title");
  });
});
