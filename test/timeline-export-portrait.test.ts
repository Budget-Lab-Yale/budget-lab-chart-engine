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
import { renderChart } from "../src/engine/index";
import { timelineExportChartWidth, TIMELINE_CLASS } from "../src/engine/marks/timeline";
import { W, MARGIN, LOGO_W } from "../src/embed/figure-chrome";
import { TL_GEOM } from "../src/engine/timeline-layout";
import { timelineTextWidth } from "../src/engine/timeline-text";
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
// timeline, so none may move. The three horizontal-timeline pins were re-captured at Task 16b, which
// changed only how timeline text is measured (Ruling 45); the non-timeline pins are c60f9a8's.
describe("exports that are not a vertical timeline stay byte-identical (Task 16)", () => {
  const cases: Array<[string, ChartSpec, TidyRow[], string]> = [
    ["horizontal timeline, top legend", { ...TL, columns: { x: "date", series: "kind" } } as ChartSpec, FIG7, "f4f470f301117db5"],
    ["horizontal timeline, lanes", { ...TL, columns: { x: "date", end: "end_date", series: "kind" }, projected_field: "projected", timeline: { lanes: true } } as ChartSpec, SPANS, "3653532fbc4f53f4"],
    ["horizontal timeline, right legend", { ...TL, legendPosition: "right", timeline: { spacing: "even", max_rows: 1 }, columns: { x: "date", label: "title", series: "category" } } as ChartSpec, LEGEND_ROWS, "c39b64adbbc3a9e3"],
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
    // The widest title sets a block between the 280px floor and the 360px cap (Task 16b: sized for
    // the measured Figtree widths, which run ~20% narrower than the old 0.55em estimate).
    { date: "2026", title: "Policy begins" }, { date: "2050", title: "First cohort born under the fully phased-in new policy" },
    { date: "2075", title: "Annual projection ends" }, { date: "2100", title: "That cohort turns 65" },
  ] as TidyRow[];
  const VSPEC = { ...TL, orientation: "vertical", columns: { x: "date", label: "title" } } as ChartSpec;
  const chartOf = (svg: SVGSVGElement) => svg.querySelector(`svg.${TIMELINE_CLASS}`) as SVGSVGElement;
  const num = (el: Element, a: string): number => Number(el.getAttribute(a));
  /** Text drawn by the frame's chrome (not inside the chart SVG). */
  const chromeTexts = (svg: SVGSVGElement) => [...svg.querySelectorAll("text")].filter((t) => !t.closest(`svg.${TIMELINE_CLASS}`));

  /** Right edge of the chart's widest label line, from the layout's own width measure. */
  const inkRight = (chart: SVGSVGElement): number =>
    Math.max(...[...chart.querySelectorAll(".tbl-timeline-label text")].map((t) =>
      num(t, "x") + timelineTextWidth(t.textContent ?? "", num(t, "font-size"), t.getAttribute("font-weight") === "700" ? 700 : 500)));

  it("sizes the frame to the timeline's content, no wider than 640, with the chart centred in it (Ruling 39)", () => {
    const svg = buildExportSvg(VSPEC, POINTS);
    const chart = chartOf(svg);
    const chartW = num(chart, "width");
    // Points only, no tick column: the block runs from the 4px edge pad left of the markers to the
    // widest label and the same pad beyond it, narrower than a full 360px column.
    const ruleX = num(chart.querySelector(".tbl-timeline-rule")!, "x1");
    const block = inkRight(chart) + 4 - (ruleX - TL_GEOM.dotR - 4);
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
    const block = inkRight(chart) + 4 - (ruleX - TL_GEOM.dotR - 4);
    expect(ruleX - TL_GEOM.dotR - 4).toBeCloseTo((TL_GEOM.minLiveWidth - block) / 2, 1);
    expect(ruleX - TL_GEOM.dotR - 4).toBeGreaterThan(50);
  });

  /** Horizontal extent of the chart's ink: label and lane-name text, markers and bars. */
  const inkOfChart = (chart: SVGSVGElement): [number, number] => {
    const spans: Array<[number, number]> = [];
    for (const t of chart.querySelectorAll(".tbl-timeline-label text, .tbl-timeline-lane-label tspan, .tbl-timeline-tick")) {
      const el = t.tagName === "tspan" ? t.parentElement! : t;
      const w = timelineTextWidth(t.textContent ?? "", num(el, "font-size"), el.getAttribute("font-weight") === "700" ? 700 : 500);
      const x = num(t, "x");
      spans.push(el.getAttribute("text-anchor") === "end" ? [x - w, x] : [x, x + w]);
    }
    for (const c of chart.querySelectorAll(".tbl-timeline-marker")) spans.push([num(c, "cx") - TL_GEOM.dotR, num(c, "cx") + TL_GEOM.dotR]);
    for (const r of chart.querySelectorAll(".tbl-timeline-span")) spans.push([num(r, "x"), num(r, "x") + num(r, "width")]);
    return [Math.min(...spans.map((s) => s[0])), Math.max(...spans.map((s) => s[1]))];
  };
  const LONG = "a title long enough to wrap in any column a portrait frame can give it, twice over";
  const FIG7_ROWS = [
    { date: "2026", title: "Policy begins" }, { date: "2030", title: "First cohort born under fully phased-in policy" },
    { date: "2055", title: "Annual projection ends" }, { date: "2057", title: "That cohort turns 27" }, { date: "2095", title: "That cohort turns 65" },
  ] as TidyRow[];

  it("hugs every column in the export too: FIG7 (swapped labels) and short-label lanes frame narrower than 640, ink centred (Ruling 43)", () => {
    const shortLanes = [
      { date: "2025", title: "Signed", category: "alpha" }, { date: "2026", title: "Rules", category: "beta" },
      { date: "2027", title: "Fix", category: "alpha" }, { date: "2028", title: "Effective", category: "beta" },
    ] as TidyRow[];
    const lanes = { ...TL, orientation: "vertical", timeline: { lanes: true }, columns: { x: "date", label: "title", series: "category" } } as ChartSpec;
    const cases: Array<[ChartSpec, TidyRow[]]> = [
      [VSPEC, FIG7_ROWS], [{ ...VSPEC, timeline: { axis: true } } as ChartSpec, FIG7_ROWS],
      [lanes, shortLanes], [{ ...lanes, timeline: { lanes: true, axis: true } } as ChartSpec, shortLanes], [lanes, LEGEND_ROWS],
    ];
    for (const [spec, rows] of cases) {
      const svg = buildExportSvg(spec, rows);
      const chart = chartOf(svg);
      const chartW = num(chart, "width");
      expect(num(svg, "width")).toBeLessThan(640);
      expect(num(svg, "width")).toBe(chartW + 2 * MARGIN);
      expect(timelineExportChartWidth(spec, rows)).toBe(chartW);
      // At the 280px floor too: the block is centred in whatever chart area it gets.
      const [lo, hi] = inkOfChart(chart);
      expect(Math.abs((lo + hi) / 2 - chartW / 2)).toBeLessThanOrEqual(2);
    }
  });

  it("wraps every label as a 560px chart would, then trims the frame to the timeline (E3)", () => {
    // FIG7 with a long title on a label that swaps left: the left column's 40% share, and so that
    // label's wrap, depends on the width the layout is budgeted at.
    const rows = FIG7_ROWS.map((r, i) => (i === 1 ? { ...r, title: `${r.title}, ${LONG}` } : r)) as TidyRow[];
    const lines = (chart: SVGSVGElement) => [...chart.querySelectorAll(".tbl-timeline-label text")].map((t) => t.textContent);
    const svg = buildExportSvg(VSPEC, rows);
    const chart = chartOf(svg);
    const chartW = num(chart, "width");
    const budget = 640 - 2 * MARGIN;
    expect(chartW).toBeLessThan(budget);
    expect(lines(chart)).toEqual(lines(renderChart(VSPEC, rows, { width: budget }).svg));
    // Precondition: laid out at its own trimmed width, the same timeline would wrap differently.
    expect(lines(renderChart(VSPEC, rows, { width: chartW }).svg)).not.toEqual(lines(chart));
  });

  it("keeps the frame within 640 when two lane columns of long titles wrap in the widest chart area", () => {
    const spec = { ...TL, orientation: "vertical", timeline: { lanes: true }, columns: { x: "date", label: "title", series: "category" } } as ChartSpec;
    const rows = LEGEND_ROWS.map((r) => ({ ...r, title: LONG })) as TidyRow[];
    const svg = buildExportSvg(spec, rows);
    expect(num(svg, "width")).toBeLessThanOrEqual(640);
    expect(num(svg, "width")).toBeGreaterThan(600); // each column wraps within a word of its share
    expect(timelineExportChartWidth(spec, rows)).toBe(num(chartOf(svg), "width"));
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

  it("wraps chrome only at spaces: a word wider than the portrait frame stays whole", () => {
    const word = `https://example.org/${"x".repeat(100)}`;
    const svg = buildExportSvg({ ...VSPEC, note: `See ${word} for details.` } as ChartSpec, POINTS);
    const frameW = num(svg, "width");
    const line = chromeTexts(svg).find((t) => t.textContent === word)!;
    expect(line).toBeDefined(); // on a line of its own, unbroken
    expect(num(line, "x")).toBe(MARGIN);
    expect(num(line, "x") + 8 * word.length).toBeGreaterThan(frameW); // jsdom measures 8px a character
    // The words around it still wrap to the frame.
    expect(chromeTexts(svg).some((t) => t.textContent === "See")).toBe(true);
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
    // The export has no page CSS: the ticks carry the weight the layout measured them at.
    const ticks = [...chartOf(svg).querySelectorAll(".tbl-timeline-tick")];
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    for (const t of ticks) expect(t.getAttribute("font-weight")).toBe("500");
  });

});
