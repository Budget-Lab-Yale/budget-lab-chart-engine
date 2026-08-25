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
import { buildExportSvg } from "../src/embed/export-png";
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

function mountRows(spec: ChartSpec, rows: TidyRow[]): HTMLElement {
  const c = document.createElement("div");
  document.body.appendChild(c);
  mountChart(c, { spec, rows, width: 720, height: 400 } as never);
  return c;
}

const mount = (spec: ChartSpec): HTMLElement => mountRows(spec, ROWS);

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
    // A DISTINCT shape column. Pointing shape at the series column would suppress the token as
    // redundant regardless, so the test would pass even if the field wrongly ate the shape too.
    const spec = {
      ...BASE,
      tooltip_series_name: false,
      columns: { x: "x", value: "y", series: "g", shape: "sh", point_label: "yr" },
      shape_labels: { round: "Rounded" },
    } as unknown as ChartSpec;
    const rows = rowsOf([{ x: "1", y: "10", g: "Other", sh: "round", yr: "2004" }]);
    expect(header(mountRows(spec, rows))).toBe("Rounded · 2004");
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

// The two CONFIG-SPEC sentences that were NARROWED rather than fixed in code. The repo's rule is
// that a documented claim is verified by a test before it is written, so these assert the narrowed
// wording rather than leaving it as reasoning about the source.
describe("documented interactions of series_legend", () => {
  const stackedRows = rowsOf(
    ["A", "B", "C", "D", "E"].flatMap((g) => [
      { x: "Q1", y: "10", g },
      { x: "Q2", y: "20", g },
    ]),
  );
  const stacked = (extra: Record<string, unknown>) =>
    ({
      chartType: "stacked", xAxisType: "categorical",
      columns: { x: "x", value: "y", series: "g" }, ...extra,
    }) as unknown as ChartSpec;

  const isRightLegend = (c: HTMLElement): boolean => !!c.querySelector(".figure-body--legend-right");

  it("puts a 5-series stacked legend on the right by default", () => {
    expect(isRightLegend(mountRows(stacked({}), stackedRows))).toBe(true);
  });

  it("falls back to top when series_legend removes the rows the ≥5 rule counts", () => {
    expect(isRightLegend(mountRows(stacked({ series_legend: false }), stackedRows))).toBe(false);
  });

  const clickRow = (c: HTMLElement, label: string): void => {
    const row = Array.from(c.querySelectorAll<HTMLElement>(".tbl-legend-item"))
      .find((e) => (e.textContent ?? "").trim() === label);
    expect(row, `no legend row labelled ${label}`).toBeTruthy();
    row!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  };

  it("still puts a DIVERGING stacked legend on the right — that test is on the data", () => {
    // The case the first version of this claim missed: `isDiverging` is decided from the rows, so
    // suppressing the series rows never reaches it. Only the count-based route falls back to top.
    const diverging = rowsOf([
      { x: "Q1", y: "10", g: "A" },
      { x: "Q1", y: "-5", g: "B" },
      { x: "Q2", y: "20", g: "A" },
    ]);
    expect(isRightLegend(mountRows(stacked({ series_legend: false }), diverging))).toBe(true);
  });

  it("ignores an explicit right legend on a card too narrow for the column", () => {
    const c = document.createElement("div");
    document.body.appendChild(c);
    mountChart(c, {
      spec: stacked({ legendPosition: "right" }), rows: stackedRows, width: 400, height: 400,
    } as never);
    expect(!!c.querySelector(".figure-body--legend-right")).toBe(false);
  });

  it("gives a small_multiples figure a top legend, explicit right or not", () => {
    const spec = stacked({ legendPosition: "right", facet: undefined, small_multiples: { columns: 2 } });
    (spec as unknown as { columns: Record<string, string> }).columns.facet = "f";
    const rows = rowsOf(stackedRows.map((r, i) =>
      ({ ...(r as unknown as Record<string, string>), f: i % 2 ? "P" : "Q" })));
    const c = document.createElement("div");
    document.body.appendChild(c);
    mountChart(c, { spec, rows, width: 900, height: 500 } as never);
    expect(!!c.querySelector(".figure-body--legend-right")).toBe(false);
    // Presence too: absence of the right wrapper would also hold if the legend vanished entirely.
    expect(legendLabels(c).length).toBeGreaterThan(0);
  });

  it("draws the exported legend above the chart even when the live one is on the right", () => {
    const live = mountRows(stacked({}), stackedRows);
    expect(!!live.querySelector(".figure-body--legend-right")).toBe(true);
    // Same spec through the export: the legend is composed into the top chrome, so no right column
    // exists to find. Asserted on the ORDER — the legend text sits above the plot.
    const svg = buildExportSvg(stacked({}), stackedRows);
    const texts = Array.from(svg.querySelectorAll("text"));
    const legendIdx = texts.findIndex((t) => (t.textContent ?? "").trim() === "A");
    expect(legendIdx).toBeGreaterThanOrEqual(0);
    // Position within the frame, not order among <text> nodes: the axis labels are placed by
    // transform and carry no `y`, so there is nothing to compare against that way. A top legend
    // sits in the upper-left chrome; a right column would be far across and vertically centred.
    const legendY = Number(texts[legendIdx]!.getAttribute("y"));
    const legendX = Number(texts[legendIdx]!.getAttribute("x"));
    const w = Number(svg.getAttribute("width"));
    const h = Number(svg.getAttribute("height"));
    expect([legendX, legendY, w, h].every(Number.isFinite)).toBe(true);
    expect(legendY).toBeLessThan(h / 2);
    expect(legendX).toBeLessThan(w / 2);
  });

  it("dims the other marks when one of SEVERAL rows is selected", () => {
    // The positive control: without it, the assertion below passes for any chart that never dims.
    const c = mount(BASE);
    clickRow(c, "Observed");
    expect(c.querySelectorAll(".tbl-dimmed").length).toBeGreaterThan(0);
  });

  it("dims nothing for a lone row in its OWN dimension, even beside live shape rows", () => {
    // series_legend strips colour rows but not SHAPE rows (those follow top-level `legend`), so a
    // dual-encoding scatter keeps three rows while the colour/annotation dimension holds only the
    // overlay — and each dimension dims on a strict subset of itself.
    const spec = {
      chartType: "scatter", xAxisType: "numeric", series_legend: false,
      columns: { x: "x", value: "y", series: "g", shape: "sh" },
      overlays: [{ method: "lm", domain: "axis", by: "none", label: "Linear fit", legend: true }],
    } as unknown as ChartSpec;
    const rows = rowsOf([
      { x: "1", y: "10", g: "Other", sh: "round" },
      { x: "2", y: "20", g: "Other", sh: "square" },
      { x: "3", y: "30", g: "2020", sh: "square" },
    ]);
    const c = mountRows(spec, rows);
    const labels = legendLabels(c);
    expect(labels).toContain("Linear fit");
    expect(labels).toContain("round"); // shape rows survive
    clickRow(c, "Linear fit");
    // The click must have LANDED: zero dimmed marks would also be true of a dead legend row.
    expect(c.querySelectorAll(".is-pinned").length).toBeGreaterThan(0);
    expect(c.querySelectorAll(".tbl-dimmed").length).toBe(0);
  });

  it("dims nothing when the only remaining row is selected", () => {
    const c = mount({ ...BASE, series_legend: false } as unknown as ChartSpec);
    clickRow(c, "Linear fit");
    // Selecting the sole row is selecting everything, so nothing is dimmed. Documented, and already
    // true of a single-series scatter with one keyed overlay.
    expect(c.querySelectorAll(".tbl-dimmed").length).toBe(0);
  });
});
