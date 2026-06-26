// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildTableExportSvg } from "../../src/embed/export-table-png";
import { buildTableModel } from "../../src/table/model";
import { layoutTable } from "../../src/table/layout";
import type { TableSpec } from "../../src/spec/table-types";
import type { TidyRow } from "../../src/data/index";

const SPEC: TableSpec = {
  title: "Budget Effects by Year",
  subtitle: "Billions of dollars",
  source: "The Budget Lab",
  notes: "Numbers may not sum due to rounding.",
  data: "d.csv",
  stub: [{ label: "row" }],
  header: ["per"],
  value: "value",
  format: { default: { type: "number", decimals: 0 } },
};

const ROWS: TidyRow[] = [
  { row: "Revenue", per: "2026", value: "1234" },
  { row: "Revenue", per: "2027", value: "5678" },
  { row: "Outlays", per: "2026", value: "910" },
  { row: "Outlays", per: "2027", value: "1112" },
] as TidyRow[];

describe("buildTableExportSvg", () => {
  it("returns an <svg> sized to cover the table content + chrome", () => {
    const svg = buildTableExportSvg(SPEC, ROWS);
    expect(svg.tagName.toLowerCase()).toBe("svg");

    // Recompute the table content size to compare against the export frame.
    const model = buildTableModel(SPEC, ROWS);
    const layout = layoutTable(model, {
      width: 920,
      measureText: (s, fontPx) => s.length * fontPx * 0.6,
    });

    const width = Number(svg.getAttribute("width"));
    const height = Number(svg.getAttribute("height"));
    expect(width).toBeGreaterThanOrEqual(layout.totalWidth);
    expect(height).toBeGreaterThanOrEqual(layout.totalHeight);
  });

  it("contains the title text in the chrome", () => {
    const svg = buildTableExportSvg(SPEC, ROWS);
    expect(svg.textContent).toContain("Budget Effects by Year");
  });

  it("contains the source text", () => {
    const svg = buildTableExportSvg(SPEC, ROWS);
    expect(svg.textContent).toContain("The Budget Lab");
  });

  it("contains the table body cell <text> nodes", () => {
    const svg = buildTableExportSvg(SPEC, ROWS);
    // A known formatted cell value (1234 → "1234" with 0 decimals, no thousands grouping).
    expect(svg.textContent).toContain("1234");
    // Stub label text.
    expect(svg.textContent).toContain("Revenue");
    // The nested table body svg is present.
    expect(svg.querySelectorAll("svg").length).toBeGreaterThanOrEqual(1);
  });
});
