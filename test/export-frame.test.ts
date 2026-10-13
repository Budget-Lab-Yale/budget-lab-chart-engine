// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildExportSvg } from "../src/embed/export-png";
import { W, H, MARGIN, W_SEMI, W_BODY, W_BOLD, FONT, LOGO_W, LOGO_H, LOGO_BASELINE_FRAC, measureText, bottomChromeHeight } from "../src/embed/figure-chrome";
import { LEGEND_COLUMN_WIDTH, LEGEND_GAP, LEGEND_RIGHT_MIN_CARD_WIDTH } from "../src/engine/legend-layout";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const realGetContext = HTMLCanvasElement.prototype.getContext;
beforeAll(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"]; });
afterAll(() => { HTMLCanvasElement.prototype.getContext = realGetContext; });

const LINE: ChartSpec = {
  chartType: "line", title: "Revenue by rate", subtitle: "Billions of dollars",
  xAxisType: "numeric", columns: { x: "rate", series: "regime", value: "rev" }, data: "d.csv",
};
const rows = [20, 25, 30, 35].flatMap((r, i) => [
  { rate: String(r), regime: "A", rev: String(100 + i * 50) },
  { rate: String(r), regime: "B", rev: String(80 + i * 30) },
]) as unknown as TidyRow[];
const ser = (el: Element) => new XMLSerializer().serializeToString(el);

describe("buildExportSvg frame option", () => {
  // Only for a chart with nothing a framed export wraps: an x-axis title wider than the frame, or a
  // legend label wider than a whole legend row, wraps under any explicit frame (see the wrap tests
  // below) and stays on one line without one. LINE has neither.
  it("an explicit default frame is byte-identical to no frame when nothing needs wrapping", () => {
    const a = ser(buildExportSvg(LINE, rows));
    const b = ser(buildExportSvg(LINE, rows, { frame: { width: W, height: H } }));
    expect(b).toBe(a);
  });
  it("sizes a single chart to the frame", () => {
    const svg = buildExportSvg(LINE, rows, { frame: { width: 1280, height: 618 } });
    expect(svg.getAttribute("width")).toBe("1280");
    expect(svg.getAttribute("height")).toBe("618");
  });
  it("logoTop moves the logo and title up by the difference", () => {
    const y = (svg: SVGSVGElement) => Number(svg.querySelector("image")!.getAttribute("y"));
    const d = y(buildExportSvg(LINE, rows, { frame: { width: 1280, height: 618 } }));
    const t = y(buildExportSvg(LINE, rows, { frame: { width: 1280, height: 618, logoTop: 20 } }));
    expect(d - t).toBeCloseTo(MARGIN - 20, 6);
  });
  it("rejects a frame smaller than 320×240", () => {
    expect(() => buildExportSvg(LINE, rows, { frame: { width: 200, height: 618 } })).toThrow(/frame/);
  });
  it("rejects a frame shorter than 240, and accepts exactly 320×240", () => {
    expect(() => buildExportSvg(LINE, rows, { frame: { width: 1280, height: 239 } })).toThrow(/320×240/);
    expect(() => buildExportSvg(LINE, rows, { frame: { width: 320, height: 240 } })).not.toThrow();
  });
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("rejects logoTop %s", (logoTop) => {
    expect(() => buildExportSvg(LINE, rows, { frame: { width: 1280, height: 618, logoTop } })).toThrow(/logoTop/);
  });
  it("accepts logoTop 0", () => {
    expect(() => buildExportSvg(LINE, rows, { frame: { width: 1280, height: 618, logoTop: 0 } })).not.toThrow();
  });
});

const FIG: ChartSpec = {
  chartType: "bar", title: "By sector", xAxisType: "categorical", orientation: "vertical",
  columns: { x: "cat", value: "v", facet: "grp" }, small_multiples: { mode: "shared", columns: 2 },
  data: "d.csv",
};
const figRows = [["A","G1",1],["B","G1",-2],["C","G1",3],["D","G2",2],["E","G2",-1]]
  .map(([cat, grp, v]) => ({ cat, grp, v: String(v) })) as unknown as TidyRow[];

describe("fillPanes and the frame-derived treemap cap", () => {
  it("fillPanes stretches a one-row figure to the frame height", () => {
    const plain = buildExportSvg(FIG, figRows, { frame: { width: 1280, height: 618 } });
    const filled = buildExportSvg(FIG, figRows, { frame: { width: 1280, height: 618, fillPanes: true } });
    expect(Number(plain.getAttribute("height"))).toBeLessThan(618); // figures size to content
    expect(Math.abs(Number(filled.getAttribute("height")) - 618)).toBeLessThanOrEqual(1);
  });
  it("fillPanes fills a two-row figure too", () => {
    const twoRow = { ...FIG, small_multiples: { mode: "shared" as const, columns: 1 } };
    // Two content-sized rows already need 795px, so the frame must be taller for there to be room to fill.
    const svg = buildExportSvg(twoRow, figRows, { frame: { width: 1280, height: 900, fillPanes: true } });
    expect(Math.abs(Number(svg.getAttribute("height")) - 900)).toBeLessThanOrEqual(1);
  });
  it("fillPanes shrinks panes below their content size to fill a short frame", () => {
    const twoRow = { ...FIG, small_multiples: { mode: "shared" as const, columns: 1 } };
    const plain = buildExportSvg(twoRow, figRows, { frame: { width: 1280, height: 720 } });
    const filled = buildExportSvg(twoRow, figRows, { frame: { width: 1280, height: 720, fillPanes: true } });
    expect(Number(plain.getAttribute("height"))).toBeGreaterThan(720);
    expect(Number(filled.getAttribute("height"))).toBe(720);
  });
  it("fillPanes without a frame changes nothing", () => {
    expect(ser(buildExportSvg(FIG, figRows, {}))).toBe(ser(buildExportSvg(FIG, figRows)));
  });
  it("a framed treemap fills more of a tall frame than the default cap allows", () => {
    const TM: ChartSpec = { chartType: "treemap", title: "Shares", xAxisType: "categorical",
      columns: { x: "cat", value: "v" }, data: "d.csv" };
    const tmRows = ["A","B","C","D"].map((c, i) => ({ cat: c, v: String(10 + i) })) as unknown as TidyRow[];
    const h0 = Number(buildExportSvg(TM, tmRows).getAttribute("height"));
    const h1 = Number(buildExportSvg(TM, tmRows, { frame: { width: 1280, height: 720 } }).getAttribute("height"));
    expect(h1).toBeGreaterThan(h0);
    expect(h1).toBeLessThanOrEqual(720);
  });
});

// ---------------------------------------------------------------------------
// Task 3b follow-ups
// ---------------------------------------------------------------------------

const TM: ChartSpec = { chartType: "treemap", title: "Shares", xAxisType: "categorical",
  columns: { x: "cat", value: "v" }, data: "d.csv" };
const tmRows = ["A","B","C","D"].map((c, i) => ({ cat: c, v: String(10 + i) })) as unknown as TidyRow[];
const treemapOf = (svg: SVGSVGElement) => svg.querySelector("svg.tbl-treemap") as SVGSVGElement;
const tilesBottom = (tm: SVGSVGElement) => Math.max(...[...tm.querySelectorAll("rect.tbl-treemap-tile")]
  .map((r) => Number(r.getAttribute("y")) + Number(r.getAttribute("height"))));

describe("framed treemap lays out at the frame-derived height", () => {
  it("1280×720: the treemap's own height and tiles fill the reserved region", () => {
    const svg = buildExportSvg(TM, tmRows, { frame: { width: 1280, height: 720 } });
    const tm = treemapOf(svg);
    const top = Number(tm.getAttribute("y"));
    const h = Number(tm.getAttribute("height"));
    // The region reserved for the chart ends where the bottom chrome begins.
    const reservedBottom = Number(svg.getAttribute("height")) - bottomChromeHeight({ note: "", source: "", width: 1280 });
    expect(Math.abs(top + h - reservedBottom)).toBeLessThanOrEqual(1);
    expect(Math.abs(tilesBottom(tm) - h)).toBeLessThanOrEqual(1);
    expect(tm.getAttribute("viewBox")).toBe(`0 0 ${tm.getAttribute("width")} ${h}`);
  });
  it("1280×400: nothing is drawn below the frame", () => {
    const svg = buildExportSvg(TM, tmRows, { frame: { width: 1280, height: 400 } });
    const tm = treemapOf(svg);
    const outerH = Number(svg.getAttribute("height"));
    expect(outerH).toBeLessThanOrEqual(400);
    const bottom = Number(tm.getAttribute("y")) + Number(tm.getAttribute("height"));
    expect(bottom).toBeLessThanOrEqual(outerH - bottomChromeHeight({ note: "", source: "", width: 1280 }) + 1);
    expect(tilesBottom(tm)).toBeLessThanOrEqual(Number(tm.getAttribute("height")) + 0.01);
  });
  it("frame-less treemap keeps the default 460px cap", () => {
    const tm = treemapOf(buildExportSvg(TM, tmRows));
    expect(Number(tm.getAttribute("height"))).toBe(460);
  });
});

describe("fillPanes leaves no per-row rounding shortfall", () => {
  const threeFacets = [["A","G1",1],["B","G1",-2],["C","G2",3],["D","G2",2],["E","G3",-1]]
    .map(([cat, grp, v]) => ({ cat, grp, v: String(v) })) as unknown as TidyRow[];
  const oneCol = { ...FIG, small_multiples: { mode: "shared" as const, columns: 1 } };
  it.each([1200, 1201, 1202, 1203])("a three-row figure fills a 1280×%i frame exactly", (fh) => {
    const svg = buildExportSvg(oneCol, threeFacets, { frame: { width: 1280, height: fh, fillPanes: true } });
    expect(Number(svg.getAttribute("height"))).toBe(fh);
  });
});

const longTitle = "Statutory marginal tax rate on ordinary income in the top bracket, percentage points";
const xTitleLines = (svg: SVGSVGElement) => [...svg.querySelectorAll("text")]
  .filter((t) => t.getAttribute("text-anchor") === "middle" && longTitle.includes(t.textContent ?? "\u0000"));

describe("framed export wraps the x-axis title to the frame", () => {
  it("640×618: the title wraps, stays inside the frame, and the output is not taller than the frame", () => {
    const spec = { ...LINE, x_axis_title: longTitle };
    const svg = buildExportSvg(spec, rows, { frame: { width: 640, height: 618 } });
    const lines = xTitleLines(svg);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((l) => l.textContent).join(" ")).toBe(longTitle);
    for (const l of lines) {
      const w = measureText(l.textContent ?? "", `${W_SEMI} 12px ${FONT}`);
      const x = Number(l.getAttribute("x"));
      expect(x - w / 2).toBeGreaterThanOrEqual(MARGIN - 0.01);
      expect(x + w / 2).toBeLessThanOrEqual(640 - MARGIN + 0.01);
    }
    expect(Number(svg.getAttribute("height"))).toBe(618);
  });
  it("beside a right legend it wraps to the plot it is centred on", () => {
    const spec = { ...LINE, x_axis_title: longTitle, legendPosition: "right" as const };
    const fw = 900; // inner 820 keeps the right column; the plot is 644 wide, narrower than the title
    const chartW = fw - 2 * MARGIN - LEGEND_COLUMN_WIDTH - LEGEND_GAP;
    const lines = xTitleLines(buildExportSvg(spec, rows, { frame: { width: fw, height: 618 } }));
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) {
      const w = measureText(l.textContent ?? "", `${W_SEMI} 12px ${FONT}`);
      const x = Number(l.getAttribute("x"));
      expect(x - w / 2).toBeGreaterThanOrEqual(MARGIN - 0.01);
      expect(x + w / 2).toBeLessThanOrEqual(MARGIN + chartW + 0.01);
    }
  });
  it("frame-less output keeps the title on one line", () => {
    const spec = { ...LINE, x_axis_title: longTitle };
    expect(xTitleLines(buildExportSvg(spec, rows))).toHaveLength(1);
  });
});

describe("framed export: right legend falls back to top on a narrow frame (the live rule)", () => {
  const RIGHT: ChartSpec = { ...LINE, legendPosition: "right" };
  const chartSvg = (svg: SVGSVGElement) =>
    [...svg.children].find((c) => c.tagName.toLowerCase() === "svg") as SVGSVGElement;
  const usesRight = (fw: number) =>
    Number(chartSvg(buildExportSvg(RIGHT, rows, { frame: { width: fw, height: 618 } })).getAttribute("width")) <
    fw - 2 * MARGIN;
  it.each([320, 640, 645, 646, 1280])("frame width %i: right column iff the live card would keep it", (fw) => {
    // Live: a card narrower than LEGEND_RIGHT_MIN_CARD_WIDTH takes the top legend. The export's card
    // is the frame's inner width (chartW = inner − column − gap, as live's chartTarget).
    expect(usesRight(fw)).toBe(fw - 2 * MARGIN >= LEGEND_RIGHT_MIN_CARD_WIDTH);
  });
  it("frame-less output keeps the right column", () => {
    const w = Number(chartSvg(buildExportSvg(RIGHT, rows)).getAttribute("width"));
    expect(w).toBe(W - 2 * MARGIN - LEGEND_COLUMN_WIDTH - LEGEND_GAP);
  });
});

describe("framed export: a long legend label wraps inside a narrow frame", () => {
  const LONG = "Revenue under the current-law baseline with every scheduled expiration taking effect as written";
  // The label's own pieces, as drawn: root-level <text> whose words all come from LONG.
  const words = new Set(LONG.split(" "));
  const pieces = (svg: SVGSVGElement) =>
    [...svg.children].filter((c) => c.tagName.toLowerCase() === "text" &&
      (c.textContent ?? "").trim().split(" ").every((w) => words.has(w)) && (c.textContent ?? "").length > 3);
  const inside = (svg: SVGSVGElement, fw: number) => {
    const ps = pieces(svg);
    expect(ps.length).toBeGreaterThan(1); // wrapped onto several lines
    expect(ps.map((p) => p.textContent).join(" ")).toBe(LONG);
    for (const p of ps) {
      const x = Number(p.getAttribute("x"));
      expect(x).toBeGreaterThanOrEqual(MARGIN);
      expect(x + measureText(p.textContent ?? "", `${W_BODY} 13px ${FONT}`)).toBeLessThanOrEqual(fw - MARGIN + 0.01);
    }
  };
  it("colour legend: 640x618 with a right legend falls back on top and wraps the label", () => {
    const spec = { ...LINE, legendPosition: "right" as const };
    const longRows = rows.map((r) => (r.regime === "A" ? { ...r, regime: LONG } : r)) as unknown as TidyRow[];
    inside(buildExportSvg(spec, longRows, { frame: { width: 640, height: 618 } }), 640);
  });
  it("shape legend: 640x618 wraps the label too", () => {
    const spec = {
      chartType: "scatter", title: "T", xAxisType: "numeric",
      columns: { x: "x", value: "v", shape: "s" }, series_legend: false, legendPosition: "right", data: "d.csv",
    } as unknown as ChartSpec;
    const shapeRows = [["1", "1", LONG], ["2", "2", "square"]]
      .map(([x, v, s]) => ({ x, v, s })) as unknown as TidyRow[];
    inside(buildExportSvg(spec, shapeRows, { frame: { width: 640, height: 618 } }), 640);
  });
  it("frame-less output keeps the label on one line", () => {
    const longRows = rows.map((r) => (r.regime === "A" ? { ...r, regime: LONG } : r)) as unknown as TidyRow[];
    const svg = buildExportSvg(LINE, longRows);
    expect(pieces(svg).map((p) => p.textContent)).toEqual([LONG]);
  });
});

describe("framed export: the title never runs under the logo", () => {
  const logo = (svg: SVGSVGElement) => {
    const img = svg.querySelector("image")!;
    return { x: Number(img.getAttribute("x")), y: Number(img.getAttribute("y")) };
  };
  // The title's lines: root-level <text> in the title's 22px bold.
  const titleLines = (svg: SVGSVGElement) =>
    [...svg.children].filter((c) => c.tagName.toLowerCase() === "text" && c.getAttribute("font-size") === "22");
  it("320x400: a one-word title too wide for the column beside the logo moves below it", () => {
    const spec = { ...LINE, title: "Macroeconomic" };
    const svg = buildExportSvg(spec, rows, { frame: { width: 320, height: 400 } });
    const lines = titleLines(svg);
    expect(lines.length).toBeGreaterThan(0);
    const l = logo(svg);
    for (const line of lines) {
      const x = Number(line.getAttribute("x"));
      const right = x + measureText(line.textContent ?? "", `${W_BOLD} 22px ${FONT}`);
      const baseline = Number(line.getAttribute("y"));
      // No overlap: either clear of the logo horizontally, or its cap height starts below the logo.
      const clearH = right <= l.x;
      const clearV = baseline - 22 >= l.y + LOGO_H;
      expect(clearH || clearV).toBe(true);
      expect(right).toBeLessThanOrEqual(320 - MARGIN + 0.01);
    }
  });
  it.each([
    [640, 618], [1280, 618], [1280, 720],
  ])("%ix%i with logoTop 20 (the slide frames): logo and title stay side by side", (fw, fh) => {
    const spec = { ...LINE, title: "Tariff revenue under current policy" };
    const svg = buildExportSvg(spec, rows, { frame: { width: fw, height: fh, logoTop: 20 } });
    expect(logo(svg)).toEqual({ x: fw - MARGIN - LOGO_W, y: 20 + 22 - LOGO_H * LOGO_BASELINE_FRAC });
    expect(Number(titleLines(svg)[0]!.getAttribute("y"))).toBe(20 + 22);
  });
});
