// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildExportSvg } from "../src/embed/export-png";
import { W, H, MARGIN, W_SEMI, FONT, measureText, bottomChromeHeight } from "../src/embed/figure-chrome";
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
  it("an explicit default frame is byte-identical to no frame", () => {
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
  it("fillPanes never shrinks panes below their content size in a short frame", () => {
    const twoRow = { ...FIG, small_multiples: { mode: "shared" as const, columns: 1 } };
    const plain = buildExportSvg(twoRow, figRows, { frame: { width: 1280, height: 720 } });
    const filled = buildExportSvg(twoRow, figRows, { frame: { width: 1280, height: 720, fillPanes: true } });
    expect(ser(filled)).toBe(ser(plain));
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
