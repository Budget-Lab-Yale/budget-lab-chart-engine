// @vitest-environment jsdom
//
// Task 16 (E3, Ruling 33): a timeline that renders vertical in the PNG export (authored
// `orientation: vertical`; the export never auto-switches) gets a portrait frame, sized to the
// timeline's block and never wider than 640px. Every other export must stay byte-identical.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { buildExportSvg } from "../src/embed/export-png";
import { timelineExportChartWidth, TIMELINE_CLASS } from "../src/engine/marks/timeline";
import { W, MARGIN, LOGO_W } from "../src/embed/figure-chrome";
import { TL_GEOM } from "../src/engine/timeline-layout";
import { estimateLabelWidth } from "../src/engine/axes";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

function parseCsv(path: string): TidyRow[] {
  const text = readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8").trim();
  const [header, ...lines] = text.split(/\r?\n/);
  const cols = (header as string).split(",");
  return lines.map((line) => {
    const cells = line.split(",");
    const row: Record<string, string> = {};
    cols.forEach((c, i) => { row[c] = cells[i] ?? ""; });
    return row as TidyRow;
  });
}
const FIG7 = parseCsv("./fixtures/timeline-figure7.csv");
const SPANS = parseCsv("./fixtures/timeline-spans.csv");
const sha = (svg: SVGSVGElement): string => createHash("sha256").update(svg.outerHTML).digest("hex").slice(0, 16);

const TL = {
  chartType: "timeline", xAxisType: "temporal", data: "d.csv",
  title: "Key dates in the implementation of the 2025 reconciliation law and its successors",
  subtitle: "Enactment, effective dates and scheduled sunsets",
  note: "Dates are as scheduled in current law and may change with future legislation.",
  source: "The Budget Lab analysis of enacted legislation",
} as const;

const LEGEND_ROWS = Array.from({ length: 11 }, (_, i) => ({
  date: `${2016 + i}-01-01`, title: "Event headline here", category: i % 2 === 0 ? "alpha" : "beta",
})) as TidyRow[];

// Captured at c60f9a8, before the portrait frame existed. None of these renders a vertical
// timeline, so none may move.
describe("exports that are not a vertical timeline stay byte-identical (Task 16)", () => {
  const cases: Array<[string, ChartSpec, TidyRow[], string]> = [
    ["horizontal timeline, top legend", { ...TL, columns: { x: "date", series: "kind" } } as ChartSpec, FIG7, "e94c7202ec08cf11"],
    ["horizontal timeline, lanes", { ...TL, columns: { x: "date", end: "end_date", series: "kind" }, projected_field: "projected", timeline: { lanes: true } } as ChartSpec, SPANS, "a0c0de92184efa78"],
    ["horizontal timeline, right legend", { ...TL, legendPosition: "right", timeline: { spacing: "even", max_rows: 1 }, columns: { x: "date", label: "title", series: "category" } } as ChartSpec, LEGEND_ROWS, "b0a1fc54129975e3"],
    ["line chart", { chartType: "line", title: TL.title, subtitle: TL.subtitle, note: TL.note, source: TL.source, xAxisType: "temporal", data: "d.csv" } as ChartSpec, parseCsv("./fixtures/grads-recent.csv"), "dc0d7b55c8fc2b8c"],
    ["stacked, right legend", { chartType: "stacked", title: "T", source: "S", xAxisType: "categorical", columns: { x: "g", value: "v", series: "s" }, data: "d.csv" } as unknown as ChartSpec,
      ["A", "B"].flatMap((g) => Array.from({ length: 5 }, (_, i) => ({ g, s: `s${i}`, v: String(i + 1) }))) as unknown as TidyRow[], "a0e6a480e0cb3f81"],
    ["small multiples", { chartType: "bar", title: "Variable widths", source: "S", xAxisType: "categorical", columns: { x: "category", value: "value", facet: "facet" }, data: "d.csv", small_multiples: { mode: "shared", pane_order: ["Durable goods", "Services"] } } as ChartSpec, parseCsv("./fixtures/facet-varwidth.csv"), "d7b0794204d39d2d"],
  ];
  for (const [name, spec, rows, pin] of cases) {
    it(name, () => {
      const svg = buildExportSvg(spec, rows);
      expect(Number(svg.getAttribute("width"))).toBe(W);
      expect(sha(svg)).toBe(pin);
    });
  }
});

describe("vertical timeline export: portrait frame (E3, Ruling 33)", () => {
  const POINTS = [
    { date: "2026", title: "Policy begins" }, { date: "2050", title: "First cohort born under fully phased-in policy" },
    { date: "2075", title: "Annual projection ends" }, { date: "2100", title: "That cohort turns 65" },
  ] as TidyRow[];
  const VSPEC = { ...TL, orientation: "vertical", columns: { x: "date", label: "title" } } as ChartSpec;
  const chartOf = (svg: SVGSVGElement) => svg.querySelector(`svg.${TIMELINE_CLASS}`) as SVGSVGElement;
  const num = (el: Element, a: string): number => Number(el.getAttribute(a));
  /** Text drawn by the frame's chrome (not inside the chart SVG). */
  const chromeTexts = (svg: SVGSVGElement) => [...svg.querySelectorAll("text")].filter((t) => !t.closest(`svg.${TIMELINE_CLASS}`));

  /** Right edge of the chart's widest label line, from the layout's own width estimate. */
  const inkRight = (chart: SVGSVGElement): number =>
    Math.max(...[...chart.querySelectorAll(".tbl-timeline-label text")].map((t) =>
      num(t, "x") + estimateLabelWidth(t.textContent ?? "", num(t, "font-size")) * (t.getAttribute("font-weight") === "700" ? 1.08 : 1)));

  it("sizes the frame to the timeline's content, no wider than 640, with the chart centred in it (Ruling 39)", () => {
    const svg = buildExportSvg(VSPEC, POINTS);
    const chart = chartOf(svg);
    const chartW = num(chart, "width");
    // Points only, no tick column: the block runs from the 4px edge pad left of the markers to the
    // widest label, which is narrower than a full 360px column.
    const ruleX = num(chart.querySelector(".tbl-timeline-rule")!, "x1");
    const block = inkRight(chart) - (ruleX - TL_GEOM.dotR - 4);
    expect(block).toBeLessThan(TL_GEOM.vTextColumnMax);
    expect(block).toBeGreaterThan(TL_GEOM.minLiveWidth);
    expect(timelineExportChartWidth(VSPEC, POINTS)).toBe(chartW);
    expect(chartW - block).toBeGreaterThanOrEqual(-0.02);
    expect(chartW - block).toBeLessThan(1.02);
    expect(chart.getAttribute("viewBox")!.split(" ")[2]).toBe(String(chartW));
    expect(num(chart, "x")).toBe(MARGIN);
    expect(num(svg, "width")).toBe(chartW + 2 * MARGIN);
    // Round 0 sized this frame to the 360px column: 4 + 4.5 + 4.5 + 10 + 360, rounded up, + margins.
    expect(num(svg, "width")).toBeLessThan(383 + 2 * MARGIN);
    expect(svg.querySelector("rect")!.getAttribute("width")).toBe(svg.getAttribute("width"));
    // The block is centred in the chart area it fills to within a pixel, so the frame's margins
    // either side of it are equal.
    expect(ruleX - TL_GEOM.dotR - 4).toBeCloseTo((chartW - block) / 2, 1);
  });

  it("never frames narrower than the live floor: short labels centre in a 280px chart area", () => {
    const tiny = POINTS.map((r) => ({ ...r, title: "x" })) as TidyRow[];
    const svg = buildExportSvg(VSPEC, tiny);
    const chart = chartOf(svg);
    expect(num(svg, "width")).toBe(TL_GEOM.minLiveWidth + 2 * MARGIN);
    expect(num(chart, "width")).toBe(TL_GEOM.minLiveWidth);
    const ruleX = num(chart.querySelector(".tbl-timeline-rule")!, "x1");
    const block = inkRight(chart) - (ruleX - TL_GEOM.dotR - 4);
    expect(ruleX - TL_GEOM.dotR - 4).toBeCloseTo((TL_GEOM.minLiveWidth - block) / 2, 1);
    expect(ruleX - TL_GEOM.dotR - 4).toBeGreaterThan(50);
  });

  it("caps the frame at 640 when the block fills the widest chart area (two lane columns)", () => {
    const spec = { ...TL, orientation: "vertical", timeline: { lanes: true }, columns: { x: "date", label: "title", series: "category" } } as ChartSpec;
    const svg = buildExportSvg(spec, LEGEND_ROWS);
    expect(num(svg, "width")).toBe(640);
    expect(num(chartOf(svg), "width")).toBe(640 - 2 * MARGIN);
    expect(timelineExportChartWidth(spec, LEGEND_ROWS)).toBe(640 - 2 * MARGIN);
    expect(chartOf(svg).querySelectorAll("line.tbl-timeline-rule")).toHaveLength(2);
  });

  it("lays the title, logo, note and source out at the portrait frame's width", () => {
    const svg = buildExportSvg(VSPEC, POINTS);
    const frameW = num(svg, "width");
    const logo = svg.querySelector("image")!;
    expect(num(logo, "x")).toBe(frameW - MARGIN - LOGO_W);
    // The same title wraps onto more lines in the portrait frame than in the landscape one.
    const titleLines = (s: SVGSVGElement) => chromeTexts(s).filter((t) => t.getAttribute("font-size") === "22").length;
    const landscape = buildExportSvg({ ...VSPEC, orientation: "horizontal" } as ChartSpec, POINTS);
    expect(num(landscape, "width")).toBe(W);
    expect(titleLines(svg)).toBeGreaterThan(titleLines(landscape));
    // Every chrome line starts at the left margin and ends inside the frame's right margin — the
    // title short of the logo (jsdom measures 8px a character, as wrapText does here).
    for (const t of chromeTexts(svg)) {
      const right = t.getAttribute("font-size") === "22" ? frameW - MARGIN - LOGO_W - 24 : frameW - MARGIN;
      expect(num(t, "x")).toBe(MARGIN);
      expect(num(t, "x") + 8 * (t.textContent ?? "").length).toBeLessThanOrEqual(right);
    }
    // Note and source sit below the chart, the source last.
    const chart = chartOf(svg);
    const below = chromeTexts(svg).filter((t) => num(t, "y") > num(chart, "y") + num(chart, "height"));
    expect(below.map((t) => t.textContent).join(" ")).toContain("Source:");
    expect(below.map((t) => t.textContent).join(" ")).toContain("Dates are as scheduled");
    expect(num(svg, "height")).toBeGreaterThan(Math.max(...below.map((t) => num(t, "y"))));
  });

  it("draws the legend above the chart, wrapped to the frame, even when legendPosition is right", () => {
    const kinds = ["First category", "Second category", "Third category", "Fourth category", "Fifth category"];
    const rows = kinds.map((k, i) => ({ date: `${2020 + i * 3}`, title: `Event ${i}`, kind: k })) as TidyRow[];
    const spec = { ...VSPEC, legendPosition: "right", columns: { x: "date", label: "title", series: "kind" } } as ChartSpec;
    const svg = buildExportSvg(spec, rows);
    const chart = chartOf(svg);
    expect(num(chart, "width")).toBe(timelineExportChartWidth(spec, rows));
    expect(num(svg, "width")).toBe(num(chart, "width") + 2 * MARGIN);
    const legend = chromeTexts(svg).filter((t) => kinds.includes(t.textContent ?? ""));
    expect(legend).toHaveLength(kinds.length);
    for (const t of legend) {
      expect(num(t, "y")).toBeLessThan(num(chart, "y"));
      expect(num(t, "x") + 8 * (t.textContent ?? "").length).toBeLessThanOrEqual(num(svg, "width") - MARGIN);
    }
    // Five items do not fit one row of a portrait frame.
    expect(new Set(legend.map((t) => t.getAttribute("y"))).size).toBeGreaterThan(1);
  });

  it("wraps a legend label wider than the portrait frame, and starts the chart below it (Ruling 41)", () => {
    const rows = [
      { date: "2026", title: "Policy begins", k: "a" }, { date: "2050", title: "Credits", k: "b" },
      { date: "2090", title: "Sunset", k: "a" },
    ] as TidyRow[];
    const long = "First category includes an unusually long but valid explanatory label";
    const spec = { ...VSPEC, columns: { x: "date", label: "title", series: "k" }, series_labels: { a: long, b: "Second" } } as ChartSpec;
    const svg = buildExportSvg(spec, rows);
    const frameW = num(svg, "width");
    expect(frameW).toBeLessThan(8 * long.length + 2 * MARGIN);
    const chart = chartOf(svg);
    const words = new Set([...long.split(" "), "Second"]);
    const legend = chromeTexts(svg).filter((t) => (t.textContent ?? "").split(" ").every((w) => words.has(w)));
    expect(legend.map((t) => t.textContent).join(" ")).toBe(`${long} Second`);
    expect(legend.length).toBeGreaterThan(2);
    for (const t of legend) {
      expect(num(t, "x")).toBeGreaterThanOrEqual(MARGIN);
      expect(num(t, "x") + 8 * (t.textContent ?? "").length).toBeLessThanOrEqual(frameW - MARGIN);
      expect(num(t, "y")).toBeLessThan(num(chart, "y"));
    }
    // "Second" starts its own row below the wrapped label's last line.
    const ys = legend.map((t) => num(t, "y"));
    expect(ys[ys.length - 1]).toBeGreaterThan(ys[ys.length - 2]!);
    expect(new Set(ys).size).toBe(legend.length);
  });

  it("centres the x-axis title on the portrait frame", () => {
    const spec = { ...VSPEC, timeline: { axis: true }, x_axis_title: "Axis caption" } as ChartSpec;
    const svg = buildExportSvg(spec, POINTS);
    const cap = chromeTexts(svg).find((t) => t.textContent === "Axis caption")!;
    expect(cap.getAttribute("text-anchor")).toBe("middle");
    expect(num(cap, "x")).toBe(num(svg, "width") / 2);
  });

});
