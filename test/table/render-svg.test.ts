// @vitest-environment jsdom
//
// Golden-SVG gate for the table BODY renderer (header + rows; no title/source chrome — that
// is composed by the PNG export in a later task). For each of the three reference header
// shapes (1-tier, 2-tier + sublabels, 3-tier with a blank interior tier → rowspan) we build
// the model + layout, render to SVG, assert structural facts, and lock the output to a golden.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildTableModel } from "../../src/table/model";
import { layoutTable } from "../../src/table/layout";
import { renderTableSvg } from "../../src/table/render-svg";
import type { TableSpec } from "../../src/spec/table-types";
import type { TidyRow } from "../../src/data/index";

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

// Shared layout knobs: fixed width + a deterministic char-width measurer (no canvas in jsdom).
const layoutOpts = { width: 720, measureText: (s: string) => s.length * 7 };

// Count of distinct HeaderCells across all tiers (== expected header <text> nodes).
function headerCellCount(model: ReturnType<typeof buildTableModel>): number {
  return model.headerRows.reduce((n, tier) => n + tier.length, 0);
}

const BUDGET_SPEC: TableSpec = {
  title: "Revenue effect by proposal",
  data: "budget.csv",
  stub: ["proposal", { label: "method" }],
  header: ["period"],
  value: "value",
  format: { default: { decimals: 1 } },
  sign_color: true,
};

const KEYPARAMS_SPEC: TableSpec = {
  title: "Key parameters by scenario",
  data: "keyparams.csv",
  stub: ["group", { label: "parameter" }],
  header: ["scenario_group", "scenario"],
  value: "value",
  header_labels: { "Baseline static": "Static", "Baseline moderate": "Moderate", "Reform static": "Static" },
  sublabels: { "Baseline static": "(S)", "Baseline moderate": "(M)", "Reform static": "(R)" },
  format: {
    default: { type: "percent", decimals: 0 },
    groups: { Elasticities: { type: "number", decimals: 2 } },
  },
};

const TARIFF_SPEC: TableSpec = {
  title: "Tariff impacts",
  data: "tariff.csv",
  stub: [{ label: "row" }],
  header: ["tier1", "tier2", "metric"],
  value: "value",
  format: { default: { decimals: 1 } },
};

describe("renderTableSvg — golden bodies", () => {
  it("budget: 1-tier header, signed numbers centered", async () => {
    const rows = parseCsv("./fixtures/budget.csv");
    const model = buildTableModel(BUDGET_SPEC, rows);
    const layout = layoutTable(model, layoutOpts);
    const svg = renderTableSvg(model, layout, { document });

    expect(svg.tagName.toLowerCase()).toBe("svg");
    // Header <text> count equals the number of distinct header cells.
    const headerTexts = svg.querySelectorAll("g.tbl-table-header text");
    expect(headerTexts.length).toBe(headerCellCount(model));
    // Numeric body cells are centered.
    const cellTexts = svg.querySelectorAll("g.tbl-table-cell text");
    expect(cellTexts.length).toBeGreaterThan(0);
    cellTexts.forEach((t) => expect(t.getAttribute("text-anchor")).toBe("middle"));
    // The group heading text appears (proposal level = group rows).
    const groupTexts = Array.from(svg.querySelectorAll("g.tbl-table-group text")).map((t) => t.textContent);
    expect(groupTexts).toContain("Lower rates");
    expect(groupTexts).toContain("Expand credit");

    await expect(svg.outerHTML).toMatchFileSnapshot("./fixtures/budget.golden.svg");
  });

  it("keyparams: 2-tier header, sublabels, per-group formats", async () => {
    const rows = parseCsv("./fixtures/keyparams.csv");
    const model = buildTableModel(KEYPARAMS_SPEC, rows);
    const layout = layoutTable(model, layoutOpts);
    const svg = renderTableSvg(model, layout, { document });

    const headerTexts = svg.querySelectorAll("g.tbl-table-header text");
    // Sublabels are rendered as extra <text> nodes below the leaf labels.
    const sublabelTexts = Array.from(svg.querySelectorAll("g.tbl-table-header text.tbl-table-sublabel"))
      .map((t) => t.textContent);
    expect(sublabelTexts).toEqual(expect.arrayContaining(["(S)", "(M)", "(R)"]));
    // Header cell <text> count = distinct header cells + the sublabel texts.
    expect(headerTexts.length).toBe(headerCellCount(model) + sublabelTexts.length);

    // Group headings present.
    const groupTexts = Array.from(svg.querySelectorAll("g.tbl-table-group text")).map((t) => t.textContent);
    expect(groupTexts).toContain("Tax rates");
    expect(groupTexts).toContain("Elasticities");

    await expect(svg.outerHTML).toMatchFileSnapshot("./fixtures/keyparams.golden.svg");
  });

  it("tariff: 3-tier header with a blank interior tier (rowspan)", async () => {
    const rows = parseCsv("./fixtures/tariff.csv");
    const model = buildTableModel(TARIFF_SPEC, rows);
    const layout = layoutTable(model, layoutOpts);
    const svg = renderTableSvg(model, layout, { document });

    const headerTexts = svg.querySelectorAll("g.tbl-table-header text");
    expect(headerTexts.length).toBe(headerCellCount(model));
    // The "CPI impact" leaf has a blank tier2: its leaf cell rowSpans up, so there is at least one
    // header cell whose rect is taller than any single tier (it sums ≥2 tier heights).
    const tierHeights = layout.tierY.map((y, i) =>
      i < layout.tierY.length - 1 ? layout.tierY[i + 1]! - y : layout.headerHeight - y,
    );
    const maxTier = Math.max(...tierHeights);
    const tallCells = Array.from(svg.querySelectorAll<SVGRectElement>("g.tbl-table-header rect.tbl-table-header-bg"))
      .filter((r) => Number(r.getAttribute("height")) > maxTier);
    expect(tallCells.length).toBeGreaterThan(0);

    // Numeric cells centered.
    svg.querySelectorAll("g.tbl-table-cell text").forEach((t) =>
      expect(t.getAttribute("text-anchor")).toBe("middle"),
    );

    await expect(svg.outerHTML).toMatchFileSnapshot("./fixtures/tariff.golden.svg");
  });

  it("renders the footnote list as <text> rows below the body", () => {
    const spec: TableSpec = {
      ...BUDGET_SPEC,
      footnote_column: "fn",
      footnotes: { a: "Provisional estimate." },
    };
    const rows = parseCsv("./fixtures/budget.csv");
    // Tag the first data row so a footnote marker is referenced (the list renders from
    // spec.footnotes regardless, but this mirrors real usage).
    if (rows[0]) rows[0].fn = "a";
    const model = buildTableModel(spec, rows);
    const layout = layoutTable(model, layoutOpts);
    const svg = renderTableSvg(model, layout, { document });

    const fnTexts = Array.from(svg.querySelectorAll("g.tbl-table-footnotes text")).map(
      (t) => t.textContent,
    );
    expect(fnTexts.length).toBe(1);
    expect(fnTexts[0]).toContain("Provisional estimate.");
    expect(fnTexts[0]).toContain("a");
    // Layout reserves height for the footnote block.
    expect(layout.footnotesHeight).toBeGreaterThan(0);
  });

  it("draws NO inter-tier rules by default; tier rules appear only with header_tier_rules", () => {
    const rows = parseCsv("./fixtures/tariff.csv");
    const model = buildTableModel(TARIFF_SPEC, rows);
    const layout = layoutTable(model, layoutOpts);

    // A horizontal line at an inter-tier boundary (the first tier's bottom, before the header bottom).
    const interTierY = layout.tierY[1]!;
    const hasLineAt = (svg: SVGSVGElement, y: number): boolean =>
      Array.from(svg.querySelectorAll("g.tbl-table-header line")).some(
        (l) =>
          Number(l.getAttribute("x1")) === 0 &&
          Number(l.getAttribute("y1")) === y &&
          Number(l.getAttribute("y2")) === y,
      );

    const off = renderTableSvg(model, layout, { document });
    expect(hasLineAt(off, interTierY)).toBe(false);

    const on = renderTableSvg(model, layout, { document, spec: { ...TARIFF_SPEC, header_tier_rules: true } });
    expect(hasLineAt(on, interTierY)).toBe(true);
  });

  it("header→body bottom rule spans the FULL width including the stub (bug #4)", () => {
    const rows = parseCsv("./fixtures/tariff.csv");
    const model = buildTableModel(TARIFF_SPEC, rows);
    const layout = layoutTable(model, layoutOpts);
    const svg = renderTableSvg(model, layout, { document });
    // The rule at y = headerHeight must run x=0 → totalWidth (across the stub corner).
    const bottom = Array.from(svg.querySelectorAll("g.tbl-table-header line")).find(
      (l) => Number(l.getAttribute("y1")) === layout.headerHeight,
    );
    expect(bottom).toBeTruthy();
    expect(Number(bottom!.getAttribute("x1"))).toBe(0);
    expect(Number(bottom!.getAttribute("x2"))).toBe(layout.totalWidth);
  });

  it("spanner_rules:false renders banners as plain text (no flanking lines)", () => {
    const rows = parseCsv("./fixtures/keyparams.csv");
    const model = buildTableModel(KEYPARAMS_SPEC, rows);
    const layout = layoutTable(model, layoutOpts);

    // The flanking lines use the lighter border tone (#E5E5E5); count them with/without rules.
    const flankCount = (svg: SVGSVGElement): number =>
      Array.from(svg.querySelectorAll("g.tbl-table-header line")).filter(
        (l) => l.getAttribute("stroke") === "#E5E5E5",
      ).length;

    const withRules = renderTableSvg(model, layout, { document });
    expect(flankCount(withRules)).toBeGreaterThan(0);

    const noRules = renderTableSvg(model, layout, { document, spec: { ...KEYPARAMS_SPEC, spanner_rules: false } });
    expect(flankCount(noRules)).toBe(0);
  });

  it("header_max_lines wraps a long leaf header into ≤ N tspans", () => {
    const spec: TableSpec = {
      title: "T",
      data: "d",
      value: "value",
      stub: [{ label: "row" }],
      header: ["metric"],
      column_labels: { m: "A very long header label that needs wrapping across lines" },
      column_width: { m: 60 },
      header_max_lines: 3,
      format: { default: { type: "number", decimals: 1 } },
    };
    const rows = [{ row: "r", metric: "m", value: "1.0" }] as unknown as TidyRow[];
    const model = buildTableModel(spec, rows);
    const layout = layoutTable(model, { width: 720, measureText: (s: string) => s.length * 7, columnWidth: { m: 60 }, headerMaxLines: 3 });
    const svg = renderTableSvg(model, layout, { document, spec });
    // The leaf header <text> should carry multiple <tspan> lines, ≤ 3.
    const leafText = Array.from(svg.querySelectorAll("g.tbl-table-header text")).find(
      (t) => t.querySelectorAll("tspan").length > 0,
    );
    expect(leafText).toBeTruthy();
    const tspans = leafText!.querySelectorAll("tspan");
    expect(tspans.length).toBeGreaterThan(1);
    expect(tspans.length).toBeLessThanOrEqual(3);
  });

  it("is deterministic: rendering twice is byte-identical", () => {
    const rows = parseCsv("./fixtures/budget.csv");
    const m = buildTableModel(BUDGET_SPEC, rows);
    const l = layoutTable(m, layoutOpts);
    const a = renderTableSvg(m, l, { document }).outerHTML;
    const b = renderTableSvg(m, l, { document }).outerHTML;
    expect(a).toBe(b);
  });
});

describe("renderTableSvg — whole-row emphasis (Task 3)", () => {
  const emphSpec: TableSpec = {
    title: "T", data: "d", value: "value",
    stub: [{ label: "row" }],
    header: ["metric"],
    format: { default: { type: "number", decimals: 1 } },
    emphasis_rows: ["Total"],
  };
  const emphRows = [
    { row: "A", metric: "M", value: "1.0" },
    { row: "Total", metric: "M", value: "2.0" },
  ] as unknown as TidyRow[];

  it("emphasized row's stub text gets weight 700 and an emph rect at the stub position", () => {
    const m = buildTableModel(emphSpec, emphRows);
    const l = layoutTable(m, layoutOpts);
    const svg = renderTableSvg(m, l, { document, spec: emphSpec });
    const rowGroups = svg.querySelectorAll("g.tbl-table-row");
    const totalRowG = rowGroups[1]!; // "A" then "Total", in body order
    const stubText = totalRowG.querySelector("text")!;
    expect(stubText.textContent).toBe("Total");
    expect(stubText.getAttribute("font-weight")).toBe("700");
    // An emph rect sits behind the stub: x=0, width = stubWidth.
    const emphRect = totalRowG.querySelector("rect.tbl-table-cell-emph");
    expect(emphRect).not.toBeNull();
    expect(Number(emphRect!.getAttribute("x"))).toBe(0);
    expect(Number(emphRect!.getAttribute("width"))).toBe(l.stubWidth);
  });

  it("non-emphasized row's stub stays weight 400 with no emph rect at the stub position", () => {
    const m = buildTableModel(emphSpec, emphRows);
    const l = layoutTable(m, layoutOpts);
    const svg = renderTableSvg(m, l, { document, spec: emphSpec });
    const rowGroups = svg.querySelectorAll("g.tbl-table-row");
    const aRowG = rowGroups[0]!;
    const stubText = aRowG.querySelector("text")!;
    expect(stubText.textContent).toBe("A");
    expect(stubText.getAttribute("font-weight")).toBe("400");
    expect(aRowG.querySelector("rect.tbl-table-cell-emph")).toBeNull();
  });

  it("emphasis_column-only (no emphasis_rows) leaves stubWeight at 400 (behavior change from the old some(c=>c.emphasis) heuristic)", () => {
    const colSpec: TableSpec = {
      title: "T", data: "d", value: "value",
      stub: [{ label: "row" }],
      header: ["metric"],
      format: { default: { type: "number", decimals: 1 } },
      emphasis_column: "flag",
    };
    const colRows = [
      { row: "A", metric: "M", value: "1.0", flag: "yes" },
    ] as unknown as TidyRow[];
    const m = buildTableModel(colSpec, colRows);
    const l = layoutTable(m, layoutOpts);
    const svg = renderTableSvg(m, l, { document, spec: colSpec });
    const rowG = svg.querySelector("g.tbl-table-row")!;
    const stubText = rowG.querySelector("text")!;
    expect(stubText.textContent).toBe("A");
    // The value cell IS emphasized (per-cell mechanism unaffected)...
    const emphRects = Array.from(rowG.querySelectorAll("rect.tbl-table-cell-emph"));
    expect(emphRects.length).toBe(1);
    // ...but the stub is not bolded and has no emph rect at x=0 (the stub's position).
    expect(stubText.getAttribute("font-weight")).toBe("400");
    expect(emphRects.some((r) => Number(r.getAttribute("x")) === 0)).toBe(false);
  });
});
