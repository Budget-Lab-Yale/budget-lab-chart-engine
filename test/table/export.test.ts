// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildTableExportSvg } from "../../src/embed/export-table-png";
import { buildExportSvg } from "../../src/embed/export-png";
import type { ChartSpec } from "../../src/spec/types";
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

  // ---- Default-state seeding when the caller passes NO collapsed option ----
  // Without an explicit collapsed list the export must honor the spec's own declared default
  // view (collapsed-list > expanded-list > default), exactly like the mount seeding. An explicit
  // array — including [] — wins verbatim.
  const DEFAULT_COLLAPSED: TableSpec = {
    ...GROUPED,
    collapsible: { default: "collapsed", expanded: ["Canada"] },
  };

  it("seeds from spec.collapsible defaults when the collapsed option is omitted", () => {
    const svg = buildTableExportSvg(DEFAULT_COLLAPSED, GROUPED_ROWS);
    // China defaults collapsed: header remains, rows omitted.
    expect(svg.textContent).toContain("China");
    expect(svg.textContent).not.toContain("111");
    expect(svg.textContent).not.toContain("222");
    // Canada is in the expanded list: its row survives.
    expect(svg.textContent).toContain("Canada");
    expect(svg.textContent).toContain("333");
  });

  it("an explicit empty collapsed list overrides a 'collapsed' default (fully expanded)", () => {
    const svg = buildTableExportSvg(DEFAULT_COLLAPSED, GROUPED_ROWS, { collapsed: [] });
    expect(svg.textContent).toContain("111");
    expect(svg.textContent).toContain("222");
    expect(svg.textContent).toContain("333");
  });

  it("an explicit collapsed list wins verbatim over the spec defaults", () => {
    // Defaults would collapse China and expand Canada; the explicit list flips both.
    const svg = buildTableExportSvg(DEFAULT_COLLAPSED, GROUPED_ROWS, { collapsed: ["Canada"] });
    expect(svg.textContent).toContain("111"); // China expanded
    expect(svg.textContent).not.toContain("333"); // Canada collapsed
  });
});

// The live table is transparent on screen (it takes the host page's colour, like a chart), but the
// PNG export is a standalone image with no host page: it keeps the opaque white ground the chart
// export uses. Pinned so a change to either side shows up as a divergence between the two.
describe("buildTableExportSvg — background matches the chart export", () => {
  const realGetContext = HTMLCanvasElement.prototype.getContext;
  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
  });
  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = realGetContext;
  });

  const groundFill = (svg: SVGSVGElement): string | null =>
    svg.querySelector(":scope > rect")?.getAttribute("fill") ?? null;

  it("paints the same opaque white background rect as a chart export", () => {
    const chart = buildExportSvg(
      { chartType: "line", title: "t", xAxisType: "numeric", columns: { x: "t", value: "v", series: "s" }, data: "d.csv" } as unknown as ChartSpec,
      [{ t: "2020", s: "A", v: "1" }, { t: "2021", s: "A", v: "2" }] as unknown as TidyRow[],
    );
    const table = buildTableExportSvg(SPEC, ROWS);
    expect(groundFill(chart)).toBe("#FFFFFF");
    expect(groundFill(table)).toBe(groundFill(chart));
    const rect = table.querySelector(":scope > rect")!;
    expect(rect.getAttribute("width")).toBe(table.getAttribute("width"));
    expect(rect.getAttribute("height")).toBe(table.getAttribute("height"));
  });
});
