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
