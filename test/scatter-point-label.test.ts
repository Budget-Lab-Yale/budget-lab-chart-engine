// @vitest-environment jsdom
//
// `columns.point_label`: name the OBSERVATION under the cursor (a year, a state, a firm).
//
// It encodes nothing — no colour, no symbol, no position — so it is deliberately not a scale. It is
// a trailing token on the card's header, after series and shape, so every header that existed
// before this field reads exactly as it did.
import { describe, it, expect, beforeEach } from "vitest";
import { mountChart } from "../src/engine/render-live";
import { validateSpec, validateChartData } from "../src/spec/validate";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const rowsOf = (o: Record<string, string>[]): TidyRow[] => o as unknown as TidyRow[];

function mount(spec: ChartSpec, rows: TidyRow[], faceted = false): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  mountChart(container, {
    spec, rows, width: faceted ? 838 : 720, height: faceted ? 420 : 400,
  } as never);
  return container;
}

function hoverDot(svg: SVGSVGElement, i: number): { text: string; shown: boolean } {
  const dots = svg.querySelectorAll('g[aria-label="dot"] path, g[aria-label="dot"] circle');
  dots[i]!.dispatchEvent(new PointerEvent("pointerenter", { clientX: 10, clientY: 10, bubbles: true }));
  const tip = document.body.querySelector<HTMLElement>(".tbl-tooltip");
  return { text: tip?.textContent ?? "", shown: tip?.style.opacity === "1" };
}

/** The header line only — the x/y rows carry numbers, not identity. */
function header(svg: SVGSVGElement, i: number): string {
  hoverDot(svg, i);
  const head = document.body.querySelector<HTMLElement>(".tbl-tooltip .tbl-tooltip-head");
  return head?.textContent ?? "";
}

const SPEC = {
  chartType: "scatter",
  xAxisType: "numeric",
  columns: { x: "x", value: "y", series: "g", point_label: "yr" },
  series_labels: { A: "Observed" },
} as unknown as ChartSpec;

const ROWS = rowsOf([
  { x: "1", y: "10", g: "A", yr: "2004" },
  { x: "2", y: "20", g: "A", yr: "2005" },
]);

const canvas = (c: HTMLElement) => c.querySelector<SVGSVGElement>(".figure-canvas svg")!;

// The card is a DOCUMENT-level singleton, so a previous test's shown state would otherwise be read
// as this one's — which is exactly how a `chrome.tooltip: false` assertion passes for free.
beforeEach(() => { document.body.innerHTML = ""; });

describe("columns.point_label", () => {
  it("appends the label to the header, after the series", () => {
    const svg = canvas(mount(SPEC, ROWS));
    expect(header(svg, 0)).toBe("Observed · 2004");
    expect(header(svg, 1)).toBe("Observed · 2005");
  });

  it("orders series · shape · label when a shape channel is also active", () => {
    const spec = {
      ...SPEC,
      columns: { x: "x", value: "y", series: "g", shape: "s", point_label: "yr" },
      shape_labels: { one: "Compressive" },
    } as unknown as ChartSpec;
    const rows = rowsOf([{ x: "1", y: "10", g: "A", s: "one", yr: "2004" }]);
    expect(header(canvas(mount(spec, rows)), 0)).toBe("Observed · Compressive · 2004");
  });

  it("omits the token for a blank cell without affecting its neighbour", () => {
    const rows = rowsOf([
      { x: "1", y: "10", g: "A", yr: "" },
      { x: "2", y: "20", g: "A", yr: "2005" },
    ]);
    const svg = canvas(mount(SPEC, rows));
    expect(header(svg, 0)).toBe("Observed");
    expect(header(svg, 1)).toBe("Observed · 2005");
  });

  it("suppresses a label that just repeats the series", () => {
    const spec = {
      ...SPEC,
      columns: { x: "x", value: "y", series: "g", point_label: "g" },
    } as unknown as ChartSpec;
    expect(header(canvas(mount(spec, ROWS)), 0)).toBe("Observed");
  });

  it("suppresses a label that just repeats the shape", () => {
    const spec = {
      ...SPEC,
      columns: { x: "x", value: "y", series: "g", shape: "s", point_label: "s" },
      shape_labels: { one: "Compressive" },
    } as unknown as ChartSpec;
    const rows = rowsOf([{ x: "1", y: "10", g: "A", s: "one", yr: "2004" }]);
    expect(header(canvas(mount(spec, rows)), 0)).toBe("Observed · Compressive");
  });

  it("escapes markup in the label", () => {
    const rows = rowsOf([{ x: "1", y: "10", g: "A", yr: "<State & County>" }]);
    const svg = canvas(mount(SPEC, rows));
    hoverDot(svg, 0);
    const tip = document.body.querySelector<HTMLElement>(".tbl-tooltip")!;
    expect(tip.textContent).toContain("<State & County>");
    expect(tip.querySelector("state")).toBeNull();
  });

  it("shows no card at all under chrome.tooltip: false", () => {
    const spec = { ...SPEC, chrome: { tooltip: false } } as unknown as ChartSpec;
    expect(hoverDot(canvas(mount(spec, ROWS)), 0).shown).toBe(false);
  });

  it("reads the same in a faceted pane", () => {
    const spec = {
      ...SPEC,
      columns: { x: "x", value: "y", series: "g", facet: "f", point_label: "yr" },
      small_multiples: { columns: 2 },
    } as unknown as ChartSpec;
    const rows = rowsOf([
      { x: "1", y: "10", g: "A", yr: "2004", f: "P" },
      { x: "2", y: "20", g: "A", yr: "2005", f: "Q" },
    ]);
    const panes = mount(spec, rows, true).querySelectorAll<SVGSVGElement>(".figure-pane svg");
    expect(header(panes[0]!, 0)).toBe("Observed · 2004");
  });
});

describe("columns.point_label validation", () => {
  const withType = (chartType: string, extra: Record<string, unknown> = {}) => ({
    title: "T",
    chartType,
    xAxisType: chartType === "scatter" ? "numeric" : "temporal",
    data: "d.csv",
    columns: { x: "x", value: "y", point_label: "yr" },
    ...extra,
  });

  it("rejects the field on a non-point chart", () => {
    const res = validateSpec(withType("line"));
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/point_label/);
  });

  it("rejects the field on a histogram, which returns early from data validation", () => {
    const res = validateSpec(withType("histogram", { xAxisType: "numeric", histogram: { binWidth: 1 } }));
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/point_label/);
  });

  it("accepts it on a scatter", () => {
    expect(validateSpec(withType("scatter")).valid).toBe(true);
  });

  it("reports a point_label column that is not in the data", () => {
    const spec = {
      chartType: "scatter", xAxisType: "numeric",
      columns: { x: "x", value: "y", point_label: "nope" },
    } as unknown as ChartSpec;
    const res = validateChartData(spec, rowsOf([{ x: "1", y: "2" }]));
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/point_label/);
  });
});
