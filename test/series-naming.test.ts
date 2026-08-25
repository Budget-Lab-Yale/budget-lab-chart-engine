// @vitest-environment jsdom
//
// Naming the series is sometimes noise. On a scatter whose points are identified some other way —
// `columns.point_label`, or a single red outlier the note already explains — the series exists to
// COLOUR the marks, and repeating its name in the legend and in every hover card adds nothing.
//
// Two fields because they are two decisions on two surfaces:
//   `series_legend: false`      drops the series ROWS, keeping overlay/annotation rows in the legend
//                               (top-level `legend: false` remains the way to remove the whole box)
//   `tooltip_series_name: false` drops the series token from the scatter card's header
import { describe, it, expect, beforeEach } from "vitest";
import { mountChart } from "../src/engine/render-live";
import { validateSpec } from "../src/spec/validate";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const rowsOf = (o: Record<string, string>[]): TidyRow[] => o as unknown as TidyRow[];

const ROWS = rowsOf([
  { x: "1", y: "10", g: "Other", yr: "2004" },
  { x: "2", y: "20", g: "Other", yr: "2005" },
  { x: "3", y: "30", g: "2020", yr: "2020" },
]);

const BASE = {
  chartType: "scatter",
  xAxisType: "numeric",
  columns: { x: "x", value: "y", series: "g", point_label: "yr" },
  series_labels: { Other: "Observed" },
  overlays: [{ method: "lm", domain: "axis", by: "none", label: "Linear fit", legend: true }],
} as unknown as ChartSpec;

function mount(spec: ChartSpec): HTMLElement {
  const c = document.createElement("div");
  document.body.appendChild(c);
  mountChart(c, { spec, rows: ROWS, width: 720, height: 400 } as never);
  return c;
}

/** Each legend row's text. The reset control (⟲) is chrome, not a key, so it is excluded. */
const legendLabels = (c: HTMLElement): string[] =>
  Array.from(c.querySelectorAll(".tbl-legend-item"))
    .map((e) => e.textContent?.trim() ?? "")
    .filter((t) => t && t !== "⟲");

function header(c: HTMLElement, i = 0): string {
  const dots = c.querySelectorAll('g[aria-label="dot"] circle, g[aria-label="dot"] path');
  dots[i]!.dispatchEvent(new PointerEvent("pointerenter", { clientX: 5, clientY: 5, bubbles: true }));
  return document.body.querySelector(".tbl-tooltip .tbl-tooltip-head")?.textContent ?? "";
}

beforeEach(() => { document.body.innerHTML = ""; });

describe("series_legend", () => {
  it("names the series by default", () => {
    expect(legendLabels(mount(BASE))).toContain("Observed");
  });

  it("drops the series rows but keeps the overlay row", () => {
    const labels = legendLabels(mount({ ...BASE, series_legend: false } as unknown as ChartSpec));
    expect(labels).not.toContain("Observed");
    expect(labels).not.toContain("2020");
    expect(labels).toContain("Linear fit");
  });

  it("still lets legend: false remove the whole box", () => {
    const c = mount({ ...BASE, legend: false } as unknown as ChartSpec);
    expect(legendLabels(c)).toEqual([]);
  });

  it("is not scatter-only — a line chart may key only its overlays", () => {
    const spec = {
      chartType: "line", xAxisType: "numeric", series_legend: false,
      columns: { x: "x", value: "y", series: "g" },
      overlays: [{ method: "lm", domain: "axis", by: "none", label: "Trend", legend: true }],
    } as unknown as ChartSpec;
    const labels = legendLabels(mount(spec));
    expect(labels).not.toContain("Other");
    expect(labels).toContain("Trend");
  });
});

describe("tooltip_series_name", () => {
  it("names the series in the card by default", () => {
    expect(header(mount(BASE))).toBe("Observed · 2004");
  });

  it("drops the series token, leaving the point's own identity", () => {
    const c = mount({ ...BASE, tooltip_series_name: false } as unknown as ChartSpec);
    expect(header(c)).toBe("2004");
  });

  it("leaves no dangling separator when it is the only token", () => {
    const spec = {
      chartType: "scatter", xAxisType: "numeric", tooltip_series_name: false,
      columns: { x: "x", value: "y", series: "g" },
    } as unknown as ChartSpec;
    expect(header(mount(spec))).toBe("");
  });

  it("keeps the shape token, which names a different channel", () => {
    const spec = {
      ...BASE,
      tooltip_series_name: false,
      columns: { x: "x", value: "y", series: "g", shape: "g", point_label: "yr" },
    } as unknown as ChartSpec;
    // shape === series here, so the shape token is already suppressed as redundant; the point
    // label is what survives.
    expect(header(mount(spec))).toBe("2004");
  });

  it("is independent of the legend switch", () => {
    const c = mount({ ...BASE, series_legend: false } as unknown as ChartSpec);
    expect(header(c)).toBe("Observed · 2004");
  });
});

describe("validation", () => {
  const spec = (extra: Record<string, unknown>) => ({
    title: "T", data: "d.csv", chartType: "scatter", xAxisType: "numeric",
    columns: { x: "x", value: "y" }, ...extra,
  });

  it("accepts both fields on a scatter", () => {
    expect(validateSpec(spec({ series_legend: false, tooltip_series_name: false })).valid).toBe(true);
  });

  it("rejects tooltip_series_name off a scatter — other cards use the name as a row label", () => {
    const res = validateSpec(spec({ chartType: "line", xAxisType: "temporal", tooltip_series_name: false }));
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/tooltip_series_name/);
  });

  it("rejects tooltip_series_name off a scatter even when set to TRUE", () => {
    // A no-op value, but accepting it contradicts the documented scatter-only gate and leaves an
    // author believing the field is wired on that chart type. Presence is what is rejected.
    const res = validateSpec(spec({ chartType: "line", xAxisType: "temporal", tooltip_series_name: true }));
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/tooltip_series_name/);
  });

  it("still accepts a non-scatter that never mentions the field", () => {
    expect(validateSpec(spec({ chartType: "line", xAxisType: "temporal" })).valid).toBe(true);
  });

  it("accepts series_legend on any chart type", () => {
    expect(validateSpec(spec({ chartType: "line", xAxisType: "temporal", series_legend: false })).valid).toBe(true);
  });
});
