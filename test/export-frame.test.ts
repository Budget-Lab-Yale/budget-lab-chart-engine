// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildExportSvg } from "../src/embed/export-png";
import { W, H, MARGIN } from "../src/embed/figure-chrome";
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
