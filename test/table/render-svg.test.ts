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
    // The "CPI impact" leaf has a blank tier2: its leaf cell rowSpans up, so there is exactly
    // one header cell whose rect is taller than a single tier (h > tierHeight).
    const tallCells = Array.from(svg.querySelectorAll<SVGRectElement>("g.tbl-table-header rect.tbl-table-header-bg"))
      .filter((r) => Number(r.getAttribute("height")) > 24);
    expect(tallCells.length).toBeGreaterThan(0);

    // Numeric cells centered.
    svg.querySelectorAll("g.tbl-table-cell text").forEach((t) =>
      expect(t.getAttribute("text-anchor")).toBe("middle"),
    );

    await expect(svg.outerHTML).toMatchFileSnapshot("./fixtures/tariff.golden.svg");
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
