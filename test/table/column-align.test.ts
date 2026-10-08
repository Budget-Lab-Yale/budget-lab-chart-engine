// @vitest-environment jsdom
// column_align: an opt-in per-column horizontal alignment for data cells AND their leaf header,
// regardless of cell type, honoured identically by the live HTML and the PNG export (SVG).
import { describe, it, expect } from "vitest";
import { buildTableModel } from "../../src/table/model";
import { layoutTable, layoutOptionsFromSpec } from "../../src/table/layout";
import { renderTableHtml } from "../../src/table/render-html";
import { renderTableSvg } from "../../src/table/render-svg";
import { validateTableSpec } from "../../src/spec/table-validate";
import { CHART_CSS } from "../../src/embed/styles";
import type { TableSpec } from "../../src/spec/table-types";
import type { TidyRow } from "../../src/data/index";

const measureText = (s: string) => (s ?? "").length * 7;

// A "Value" column mixing numbers and text (the appendix-parameters shape), plus a "Source" text column.
const SPEC: TableSpec = {
  title: "T", data: "d", value: "value",
  stub: [{ label: "row" }],
  header: ["col"],
};
const ROWS = [
  { row: "a", col: "Value", value: "5.49" },
  { row: "a", col: "Source", value: "Calibrated" },
  { row: "b", col: "Value", value: "100% / 50%" },
  { row: "b", col: "Source", value: "Assumption" },
] as unknown as TidyRow[];

function html(spec: TableSpec): HTMLTableElement {
  const m = buildTableModel(spec, ROWS);
  const l = layoutTable(m, { width: 800, measureText, ...layoutOptionsFromSpec(spec) });
  return renderTableHtml(m, l, document, spec);
}
function svg(spec: TableSpec): SVGSVGElement {
  const m = buildTableModel(spec, ROWS);
  const l = layoutTable(m, { width: 800, measureText, ...layoutOptionsFromSpec(spec) });
  return renderTableSvg(m, l, { document, spec, measure: measureText });
}
const colOf = (t: HTMLTableElement, key: string) =>
  Array.from(t.querySelectorAll(`tbody td[data-col="${key}"]`)) as HTMLElement[];

describe("column_align — validation", () => {
  it("accepts one value for all columns or a { leafKey: value } map", () => {
    expect(validateTableSpec({ ...SPEC, column_align: "right" }).valid).toBe(true);
    expect(validateTableSpec({ ...SPEC, column_align: { Value: "center", Source: "left" } }).valid).toBe(true);
  });
  it("rejects anything but left / center / right", () => {
    expect(validateTableSpec({ ...SPEC, column_align: "middle" } as any).valid).toBe(false);
    expect(validateTableSpec({ ...SPEC, column_align: { Value: "end" } } as any).valid).toBe(false);
    expect(validateTableSpec({ ...SPEC, column_align: 3 } as any).valid).toBe(false);
  });
});

describe("column_align — live HTML", () => {
  it("default: no alignment class anywhere (output unchanged)", () => {
    expect(html(SPEC).outerHTML).not.toContain("is-align-");
  });

  it("a map aligns the named column's body cells (number AND text) and its leaf header", () => {
    const t = html({ ...SPEC, column_align: { Value: "center" } });
    const cells = colOf(t, "Value");
    expect(cells).toHaveLength(2);
    for (const td of cells) expect(td.classList.contains("is-align-center")).toBe(true);
    // One numeric, one text cell — both carry the class.
    expect(cells.map((c) => c.className.split(" ")[0])).toEqual(["is-num", "is-text"]);
    const th = Array.from(t.querySelectorAll("thead th")).find((e) => e.textContent === "Value")!;
    expect(th.classList.contains("is-align-center")).toBe(true);
    // The unnamed column is untouched.
    for (const td of colOf(t, "Source")) expect(td.className).not.toContain("is-align-");
  });

  it("a single value applies to every data column but never the stub", () => {
    const t = html({ ...SPEC, column_align: "right" });
    for (const td of t.querySelectorAll("tbody td")) expect(td.classList.contains("is-align-right")).toBe(true);
    for (const th of t.querySelectorAll("th.tbl-table-stub, th.tbl-table-stub-header")) {
      expect(th.className).not.toContain("is-align-");
    }
  });

  it("the stylesheet's alignment rules outrank td.is-num / td.is-text / th.is-text", () => {
    for (const a of ["left", "center", "right"]) {
      expect(CHART_CSS).toMatch(new RegExp(`\\.tbl-table tbody td\\.is-align-${a}[^{]*\\{[^}]*text-align:\\s*${a}`));
      expect(CHART_CSS).toMatch(new RegExp(`\\.tbl-table thead th\\.is-align-${a}[^{]*\\{[^}]*text-align:\\s*${a}`));
    }
  });
});

describe("column_align — PNG export (SVG)", () => {
  const cellTexts = (s: SVGSVGElement) =>
    Array.from(s.querySelectorAll("g.tbl-table-cell text")) as SVGElement[];

  it("right-aligns a text cell at the cell's right inset", () => {
    const spec: TableSpec = { ...SPEC, column_align: { Value: "right" } };
    const m = buildTableModel(spec, ROWS);
    const l = layoutTable(m, { width: 800, measureText, ...layoutOptionsFromSpec(spec) });
    const vi = m.leaves.findIndex((x) => x.lastValue === "Value");
    const s = renderTableSvg(m, l, { document, spec, measure: measureText });
    const t = cellTexts(s).find((e) => e.textContent === "100% / 50%")!;
    expect(t.getAttribute("text-anchor")).toBe("end");
    expect(Number(t.getAttribute("x"))).toBeCloseTo(l.colX[vi]! + l.colW[vi]! - 8, 5);
  });

  it("left-aligns a numeric cell and its header at the left inset", () => {
    const spec: TableSpec = { ...SPEC, column_align: { Value: "left" } };
    const m = buildTableModel(spec, ROWS);
    const l = layoutTable(m, { width: 800, measureText, ...layoutOptionsFromSpec(spec) });
    const vi = m.leaves.findIndex((x) => x.lastValue === "Value");
    const s = renderTableSvg(m, l, { document, spec, measure: measureText });
    const numText = (m.body.find((b) => b.kind === "row") as any).row.cells[vi].text as string;
    const num = cellTexts(s).find((e) => e.textContent === numText)!;
    expect(num.getAttribute("text-anchor")).toBe("start");
    expect(Number(num.getAttribute("x"))).toBeCloseTo(l.colX[vi]! + 8, 5);
    const head = Array.from(s.querySelectorAll("g.tbl-table-header text")).find((e) => e.textContent === "Value")!;
    expect(head.getAttribute("text-anchor")).toBe("start");
    expect(Number(head.getAttribute("x"))).toBeCloseTo(l.colX[vi]! + 8, 5);
  });

  it("centers a text cell on the column", () => {
    const spec: TableSpec = { ...SPEC, column_align: { Value: "center" } };
    const m = buildTableModel(spec, ROWS);
    const l = layoutTable(m, { width: 800, measureText, ...layoutOptionsFromSpec(spec) });
    const vi = m.leaves.findIndex((x) => x.lastValue === "Value");
    const t = cellTexts(renderTableSvg(m, l, { document, spec, measure: measureText }))
      .find((e) => e.textContent === "100% / 50%")!;
    expect(t.getAttribute("text-anchor")).toBe("middle");
    expect(Number(t.getAttribute("x"))).toBeCloseTo(l.colX[vi]! + l.colW[vi]! / 2, 5);
  });

  it("default: SVG output is unchanged by an absent column_align", () => {
    const a = svg(SPEC).outerHTML;
    const b = svg({ ...SPEC }).outerHTML;
    expect(a).toBe(b);
    expect(a).not.toContain('text-anchor="end"');
  });
});
