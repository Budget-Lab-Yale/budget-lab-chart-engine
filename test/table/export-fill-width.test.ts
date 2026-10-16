// @vitest-environment jsdom
//
// Table PNG export: a table narrower than the frame's content width is stretched to it, as the live
// table (width:100%, table-layout:fixed) fills its card. Single-pane: every <col> carries a px width
// live, so Chromium scales the stub and every column by the same factor; the export does the same.
// Multi-pane: the stub is pinned to the shared width and the data columns absorb the rest. A table
// at or wider than the content width lays out exactly as before.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildTableExportSvg } from "../../src/embed/export-table-png";
import { buildTableModel } from "../../src/table/model";
import { layoutTable, layoutOptionsFromSpec } from "../../src/table/layout";
import { layoutPanes } from "../../src/table/panes";
import type { TableSpec } from "../../src/spec/table-types";
import type { TidyRow } from "../../src/data/index";

// jsdom has no canvas: makeMeasureText falls back to this, and the test lays out with the same.
const measureText = (s: string, fontPx: number) => s.length * fontPx * 0.6;
const realGetContext = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
});

const FRAME = 560; // MIN_TABLE_FRAME
const MARGIN = 40;
const CONTENT = FRAME - 2 * MARGIN;

const rowsOf = (rs: Array<Record<string, string | number>>): TidyRow[] =>
  rs.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)]))) as unknown as TidyRow[];

/** The table-body <svg> children of the export root (one per pane). */
function bodies(root: SVGSVGElement): SVGSVGElement[] {
  return Array.from(root.children).filter((c) => c.tagName.toLowerCase() === "svg") as SVGSVGElement[];
}

function naturalLayout(spec: TableSpec, rows: TidyRow[]) {
  return layoutTable(buildTableModel(spec, rows), { measureText, ...layoutOptionsFromSpec(spec) });
}

const NARROW: TableSpec = {
  title: "Narrow", source: "The Budget Lab", data: "d.csv",
  stub: [{ label: "row" }], header: ["per"], value: "value",
  format: { default: { decimals: 0 } },
};
const NARROW_ROWS = rowsOf([
  { row: "Revenue", per: "2026", value: 1234 },
  { row: "Revenue", per: "2027", value: 5678 },
  { row: "Outlays", per: "2026", value: 910 },
  { row: "Outlays", per: "2027", value: 1112 },
]);

const WIDE_ROWS = rowsOf(["Individual income taxes", "Corporate income taxes"].flatMap((row, r) =>
  Array.from({ length: 12 }, (_, i) => ({ row, per: String(2026 + i), value: 100000 + r * 1000 + i }))));

describe("table PNG export stretches a narrow table to the frame content width", () => {
  it("single pane: the body is drawn at the content width", () => {
    const natural = naturalLayout(NARROW, NARROW_ROWS);
    expect(natural.totalWidth).toBeLessThan(CONTENT); // precondition: the table is narrow

    const svg = buildTableExportSvg(NARROW, NARROW_ROWS);
    expect(Number(svg.getAttribute("width"))).toBe(FRAME);
    const [body] = bodies(svg);
    expect(Number(body!.getAttribute("width"))).toBeCloseTo(CONTENT, 6);
  });

  it("single pane: the stub and every column scale by the same factor, as the live table does", () => {
    const natural = naturalLayout(NARROW, NARROW_ROWS);
    const f = CONTENT / natural.totalWidth;
    const svg = buildTableExportSvg(NARROW, NARROW_ROWS);
    // The numeric leaf headers are centred on their columns.
    const texts = Array.from(svg.querySelectorAll("text")).filter((t) => t.textContent === "2026" || t.textContent === "2027");
    const heads = texts.slice(0, 2).map((t) => Number(t.getAttribute("x")));
    const expected = [0, 1].map((i) => (natural.colX[i]! + natural.colW[i]! / 2) * f);
    heads.forEach((x, i) => expect(x).toBeCloseTo(expected[i]!, 6));
  });

  it("single pane: author-fixed stub_width and column_width stretch with the rest", () => {
    const spec: TableSpec = { ...NARROW, stub_width: 90, column_width: 60 };
    const natural = naturalLayout(spec, NARROW_ROWS);
    expect(natural.stubWidth).toBe(90);
    expect(natural.totalWidth).toBe(210);
    const svg = buildTableExportSvg(spec, NARROW_ROWS);
    const [body] = bodies(svg);
    expect(Number(body!.getAttribute("width"))).toBeCloseTo(CONTENT, 6);
    // The clip on a fixed stub_width follows the stretched stub, as the live clip follows its cell.
    const clip = svg.querySelector("clipPath rect");
    expect(Number(clip!.getAttribute("width"))).toBeCloseTo((90 * CONTENT) / 210, 6);
  });

  it("single pane: a table at or wider than the content width is laid out as before", () => {
    const natural = naturalLayout(NARROW, WIDE_ROWS);
    expect(natural.totalWidth).toBeGreaterThan(CONTENT); // precondition: the table is wide
    const svg = buildTableExportSvg(NARROW, WIDE_ROWS);
    expect(Number(svg.getAttribute("width"))).toBe(natural.totalWidth + 2 * MARGIN);
    const [body] = bodies(svg);
    expect(body!.getAttribute("width")).toBe(String(natural.totalWidth));
  });

  const PANE: TableSpec = { ...NARROW, pane: "pane" };
  const paneRows = (rows: TidyRow[]) =>
    ["A", "B"].flatMap((pane) => rows.map((r) => ({ ...r, pane }) as TidyRow));

  it("multi-pane: every pane is drawn at the content width, the stub keeps its shared width", () => {
    const rows = paneRows(NARROW_ROWS);
    const natural = layoutPanes(PANE, rows, measureText, true);
    expect(natural[0]!.layout.totalWidth).toBeLessThan(CONTENT);
    const svg = buildTableExportSvg(PANE, rows);
    expect(Number(svg.getAttribute("width"))).toBe(FRAME);
    const bs = bodies(svg);
    expect(bs).toHaveLength(2);
    for (const b of bs) expect(Number(b.getAttribute("width"))).toBeCloseTo(CONTENT, 6);
    const stretched = layoutPanes(PANE, rows, measureText, true, undefined, CONTENT);
    for (const lp of stretched) {
      expect(lp.layout.stubWidth).toBe(natural[0]!.layout.stubWidth);
      expect(lp.layout.totalWidth).toBeCloseTo(CONTENT, 6);
    }
  });

  it("multi-pane: panes at or wider than the content width are laid out as before", () => {
    const rows = paneRows(WIDE_ROWS);
    const natural = layoutPanes(PANE, rows, measureText, true);
    const w = natural[0]!.layout.totalWidth;
    expect(w).toBeGreaterThan(CONTENT);
    const svg = buildTableExportSvg(PANE, rows);
    expect(Number(svg.getAttribute("width"))).toBe(w + 2 * MARGIN);
    for (const b of bodies(svg)) expect(b.getAttribute("width")).toBe(String(w));
    const stretched = layoutPanes(PANE, rows, measureText, true, undefined, CONTENT);
    expect(JSON.stringify(stretched.map((l) => l.layout))).toBe(JSON.stringify(natural.map((l) => l.layout)));
  });

  // Boundary: a table a hair wider than the content width is not stretched, and its frame is the
  // `max(560, width + 80)` it always was, float digits included (Codex P1, U4 fix round 1).
  const BOUNDARY: TableSpec = { ...NARROW, stub_width: 100, column_width: 380.0000005 };
  const ONE_COL = rowsOf([{ row: "Revenue", per: "2026", value: 1 }, { row: "Outlays", per: "2026", value: 2 }]);

  it("single pane: a table just over the content width keeps its exact frame", () => {
    const natural = naturalLayout(BOUNDARY, ONE_COL);
    expect(natural.totalWidth).toBe(100 + 380.0000005);
    const svg = buildTableExportSvg(BOUNDARY, ONE_COL);
    expect(svg.getAttribute("width")).toBe(String(Math.max(FRAME, natural.totalWidth + 2 * MARGIN)));
    expect(svg.getAttribute("width")).not.toBe(String(FRAME));
    expect(bodies(svg)[0]!.getAttribute("width")).toBe(String(natural.totalWidth));
  });

  it("multi-pane: panes just over the content width keep their exact frame", () => {
    const spec: TableSpec = { ...BOUNDARY, pane: "pane" };
    const rows = paneRows(ONE_COL);
    const natural = layoutPanes(spec, rows, measureText, true);
    const w = Math.max(...natural.map((l) => l.layout.totalWidth));
    expect(w).toBeGreaterThan(CONTENT);
    const svg = buildTableExportSvg(spec, rows);
    expect(svg.getAttribute("width")).toBe(String(Math.max(FRAME, w + 2 * MARGIN)));
    expect(svg.getAttribute("width")).not.toBe(String(FRAME));
  });

  it("multi-pane: author-set column widths stretch in proportion, the stub stays", () => {
    const spec: TableSpec = { ...PANE, stub_width: 100, column_width: { "2026": 60, "2027": 120 } };
    const rows = paneRows(NARROW_ROWS);
    const stretched = layoutPanes(spec, rows, measureText, true, undefined, CONTENT);
    for (const lp of stretched) {
      expect(lp.layout.stubWidth).toBe(100);
      expect(lp.layout.colW[1]! / lp.layout.colW[0]!).toBeCloseTo(2, 9);
      expect(lp.layout.totalWidth).toBeCloseTo(CONTENT, 6);
    }
  });
});
