// @vitest-environment jsdom
//
// The PNG export must put the legend where the live card puts it.
//
// It never used to: `legendPosition` was resolved inside render-live.ts, so a stacked chart with
// five or more series — or a diverging one — showed its legend BESIDE the chart on screen and ABOVE
// it in the download. Reported from a real download. The decision now lives in
// engine/legend-layout.ts and both paths call it, which is what stops the two drifting again.
import { describe, it, expect } from "vitest";
import { buildExportSvg } from "../src/embed/export-png";
import { INNER_W, MARGIN } from "../src/embed/figure-chrome";
import { LEGEND_COLUMN_WIDTH, LEGEND_GAP, resolveLegendPosition } from "../src/engine/legend-layout";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const rowsOf = (o: Record<string, string>[]): TidyRow[] => o as unknown as TidyRow[];

const stackedSpec = (extra: Record<string, unknown> = {}): ChartSpec =>
  ({
    chartType: "stacked",
    title: "T",
    xAxisType: "categorical",
    columns: { x: "g", value: "v", series: "s" },
    data: "d.csv",
    ...extra,
  }) as unknown as ChartSpec;

/** Rows for `n` series over two categories; `diverging` makes one series negative. */
const stackRows = (n: number, diverging = false): TidyRow[] =>
  rowsOf(
    ["A", "B"].flatMap((g) =>
      Array.from({ length: n }, (_, i) => ({
        g,
        s: `s${i}`,
        v: String(diverging && i === 0 ? -3 : i + 1),
      })),
    ),
  );

/** The single chart SVG the export composed (the widest nested svg). */
const chartSvgOf = (root: SVGSVGElement): SVGSVGElement => {
  const nested = Array.from(root.querySelectorAll("svg"));
  expect(nested.length).toBeGreaterThan(0);
  return nested.reduce((a, b) =>
    Number(b.getAttribute("width") ?? 0) > Number(a.getAttribute("width") ?? 0) ? b : a,
  ) as SVGSVGElement;
};

/** x of every legend LABEL drawn straight onto the export root (not inside the chart svg). */
const legendLabelXs = (root: SVGSVGElement, labels: string[]): number[] =>
  Array.from(root.querySelectorAll("text"))
    .filter((t) => labels.includes((t.textContent ?? "").trim()))
    .filter((t) => t.closest("svg") === root)
    .map((t) => Number(t.getAttribute("x")));

describe("the PNG export honours the live legend position", () => {
  it("reserves a right-hand column for a DIVERGING stacked chart, as the live card does", () => {
    const spec = stackedSpec();
    const rows = stackRows(4, true);
    // Precondition: this is a case the live card lays out on the right. Without it the assertions
    // below would pass against a chart that was never supposed to have a column.
    expect(resolveLegendPosition(spec, 4, rows)).toBe("right");

    const root = buildExportSvg(spec, rows);
    const chart = chartSvgOf(root);
    const chartW = Number(chart.getAttribute("width"));
    expect(chartW).toBe(INNER_W - LEGEND_COLUMN_WIDTH - LEGEND_GAP);

    // Every legend label sits to the RIGHT of the plot, in the reserved column.
    const xs = legendLabelXs(root, ["s0", "s1", "s2", "s3"]);
    expect(xs.length).toBeGreaterThan(0);
    for (const x of xs) expect(x).toBeGreaterThanOrEqual(MARGIN + chartW + LEGEND_GAP);
    // And below the plot's top, not above it — a column, not a top row.
    const chartTop = Number(chart.getAttribute("y"));
    const ys = Array.from(root.querySelectorAll("text"))
      .filter((t) => ["s0", "s1", "s2", "s3"].includes((t.textContent ?? "").trim()))
      .filter((t) => t.closest("svg") === root)
      .map((t) => Number(t.getAttribute("y")));
    for (const y of ys) expect(y).toBeGreaterThanOrEqual(chartTop);
  });

  it("reserves a column for a stacked chart with five or more series", () => {
    const spec = stackedSpec();
    const rows = stackRows(5);
    expect(resolveLegendPosition(spec, 5, rows)).toBe("right");
    const chart = chartSvgOf(buildExportSvg(spec, rows));
    expect(Number(chart.getAttribute("width"))).toBe(INNER_W - LEGEND_COLUMN_WIDTH - LEGEND_GAP);
  });

  it("honours an explicit legendPosition: right on a chart type that would not choose it", () => {
    const spec = stackedSpec({ chartType: "line", xAxisType: "categorical", legendPosition: "right" });
    const rows = stackRows(2);
    const chart = chartSvgOf(buildExportSvg(spec, rows));
    expect(Number(chart.getAttribute("width"))).toBe(INNER_W - LEGEND_COLUMN_WIDTH - LEGEND_GAP);
  });

  it("grows the frame when the legend column is taller than the plot", () => {
    // The column is laid out BESIDE the plot but is not bounded by it: enough series and it runs
    // past the plot's bottom, over the x-axis title, note and source, and then off a fixed frame.
    // The column is measured by the same routine that draws it, and the frame grows to fit.
    const spec = stackedSpec({ note: "n", source: "s" });
    const many = buildExportSvg(spec, stackRows(30));
    const few = buildExportSvg(spec, stackRows(5));
    const h = (s: SVGSVGElement) => Number(s.getAttribute("height"));
    expect(h(few)).toBe(750);
    expect(h(many)).toBeGreaterThan(750);
    // Non-vacuity: the tall case really did take the column path.
    expect(Number(chartSvgOf(many).getAttribute("width"))).toBe(INNER_W - LEGEND_COLUMN_WIDTH - LEGEND_GAP);
    // And every legend row is inside the grown frame rather than clipped by it.
    const labels = Array.from(many.querySelectorAll("text"))
      .filter((n) => n.closest("svg") === many)
      .filter((n) => /^s\d+$/.test((n.textContent ?? "").trim()));
    expect(labels.length).toBeGreaterThan(20);
    for (const n of labels) expect(Number(n.getAttribute("y"))).toBeLessThanOrEqual(h(many));
    // Rows must not sit on top of each other. Taking `drawLines`' return as the next baseline
    // advanced a single-line row by the ROW GAP alone (8px), so thirty rows overlapped inside a
    // quarter of the height they needed — the frame looked fine and the legend was unreadable.
    const ys = labels.map((n) => Number(n.getAttribute("y"))).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]! - ys[i - 1]!, `rows ${i - 1}/${i} too close`).toBeGreaterThanOrEqual(16);
    }
  });

  it("breaks a single over-long token inside the column instead of running off the frame", () => {
    // `wrapText` only breaks BEFORE a word, so a label that is one long token — an identifier or a
    // URL — came back as one over-wide line. Every row must stay within the column.
    const long = "Averyveryverylongunbrokenseriesidentifierwithnospacesatall";
    const rows = rowsOf(["A", "B"].flatMap((g) => [
      { g, s: long, v: "-3" },
      { g, s: "s1", v: "2" },
    ]));
    const spec = stackedSpec();
    const root = buildExportSvg(spec, rows);
    const chartW = Number(chartSvgOf(root).getAttribute("width"));
    expect(chartW).toBe(INNER_W - LEGEND_COLUMN_WIDTH - LEGEND_GAP);
    // The label is split across rows, and no piece starts beyond the column's own right edge.
    const pieces = Array.from(root.querySelectorAll("text"))
      .filter((n) => n.closest("svg") === root)
      .filter((n) => long.startsWith((n.textContent ?? "").trim()) || long.includes((n.textContent ?? "").trim()))
      .filter((n) => (n.textContent ?? "").trim().length > 3);
    expect(pieces.length).toBeGreaterThan(1);
    const colRight = MARGIN + chartW + LEGEND_GAP + LEGEND_COLUMN_WIDTH;
    for (const n of pieces) expect(Number(n.getAttribute("x"))).toBeLessThan(colRight);
  });

  it("keeps the full width and a TOP legend for a small, all-positive stack", () => {
    // The control: nothing about this chart asks for a column, so the export must be unchanged —
    // this is what keeps every published figure but the two named under Upgrading byte-identical.
    const spec = stackedSpec();
    const rows = stackRows(3);
    expect(resolveLegendPosition(spec, 3, rows)).toBe("top");
    const root = buildExportSvg(spec, rows);
    const chart = chartSvgOf(root);
    expect(Number(chart.getAttribute("width"))).toBe(INNER_W);
    // Labels above the plot, at the left margin.
    const chartTop = Number(chart.getAttribute("y"));
    const tops = Array.from(root.querySelectorAll("text"))
      .filter((t) => ["s0", "s1", "s2"].includes((t.textContent ?? "").trim()))
      .filter((t) => t.closest("svg") === root);
    expect(tops.length).toBeGreaterThan(0);
    for (const t of tops) expect(Number(t.getAttribute("y"))).toBeLessThan(chartTop);
  });

  it("leaves a legend-less chart at full width", () => {
    const spec = stackedSpec({ legend: false });
    const rows = stackRows(6, true);
    expect(resolveLegendPosition(spec, 6, rows)).toBe("top");
    const chart = chartSvgOf(buildExportSvg(spec, rows));
    expect(Number(chart.getAttribute("width"))).toBe(INNER_W);
  });
});
