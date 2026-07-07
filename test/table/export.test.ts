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

describe("buildTableExportSvg — collapsed groups (Task 4)", () => {
  const GROUPED: TableSpec = {
    title: "Grouped",
    data: "d.csv",
    stub: ["country", { label: "scenario" }],
    header: ["per"],
    value: "value",
    collapsible: { default: "expanded" },
    format: { default: { type: "number", decimals: 0 } },
  };
  const GROUPED_ROWS: TidyRow[] = [
    { country: "China", scenario: "base", per: "2026", value: "111" },
    { country: "China", scenario: "reform", per: "2026", value: "222" },
    { country: "Canada", scenario: "base", per: "2026", value: "333" },
  ] as TidyRow[];

  it("omits a collapsed group's rows but keeps its header", () => {
    const svg = buildTableExportSvg(GROUPED, GROUPED_ROWS, { collapsed: ["China"] });
    // China's header remains…
    expect(svg.textContent).toContain("China");
    // …but its row values are gone.
    expect(svg.textContent).not.toContain("111");
    expect(svg.textContent).not.toContain("222");
    // Canada's subtree is intact.
    expect(svg.textContent).toContain("Canada");
    expect(svg.textContent).toContain("333");
  });

  it("renders all rows when nothing is collapsed", () => {
    const svg = buildTableExportSvg(GROUPED, GROUPED_ROWS, { collapsed: [] });
    expect(svg.textContent).toContain("111");
    expect(svg.textContent).toContain("333");
  });

  it("draws a caret glyph before group labels when spec.collapsible (SVG parity)", () => {
    const svg = buildTableExportSvg(GROUPED, GROUPED_ROWS, { collapsed: ["China"] });
    const carets = svg.querySelectorAll("path.tbl-table-caret");
    expect(carets.length).toBe(2); // one per visible group header (China + Canada)
  });

  it("draws no caret glyphs for a non-collapsible spec", () => {
    const plain: TableSpec = { ...GROUPED, collapsible: undefined };
    const svg = buildTableExportSvg(plain, GROUPED_ROWS);
    expect(svg.querySelectorAll("path.tbl-table-caret").length).toBe(0);
  });
});
