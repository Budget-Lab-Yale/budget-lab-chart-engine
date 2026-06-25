import { describe, it, expect } from "vitest";
import { buildTableModel } from "../../src/table/model";
import type { TableSpec } from "../../src/spec/table-types";

const tariff: TableSpec = {
  title: "T", data: "d", value: "value",
  stub: [{ label: "row" }],
  header: ["tier1", "tier2", "metric"],
  format: { default: { type: "number", decimals: 2 } },
};
const tariffRows = [
  { row: "All", tier1: "Conv", tier2: "26-35", metric: "$b", value: "2933" },
  { row: "All", tier1: "Conv", tier2: "Eq", metric: "PCE", value: "0.0204" },
  { row: "All", tier1: "Dyn", tier2: "", metric: "GDP", value: "-0.80" },
] as any;

it("derives 3 header tiers with colspan + blank-tier rowspan", () => {
  const m = buildTableModel(tariff, tariffRows);
  expect(m.leaves.map((l) => l.key)).toEqual(["$b", "PCE", "GDP"]);
  // tier1: Conv spans 2 leaves, Dyn spans 1
  expect(m.headerRows[0]!.map((c) => [c.text, c.colSpan])).toEqual([["Conv", 2], ["Dyn", 1]]);
  // Dyn's leaf has a blank tier2 → that leaf header rowSpans down
  const dynLeaf = m.headerRows.flat().find((c) => c.leafKey === "GDP")!;
  expect(dynLeaf.rowSpan).toBe(2);
  // The bottom tier (headerRows[2]) should only contain the Conv leaves ($b, PCE),
  // not GDP (which was emitted at a higher tier with rowSpan 2).
  expect(m.headerRows[2]!.length).toBe(2);
});

it("groups body rows by stub and formats cells", () => {
  const spec: TableSpec = { ...tariff, stub: ["grp", { label: "row" }], header: ["per"] };
  const rows = [
    { grp: "G1", row: "r1", per: "2026", value: "1.2" },
    { grp: "G1", row: "r2", per: "2026", value: "3.4" },
    { grp: "G2", row: "r3", per: "2026", value: "5.6" },
  ] as any;
  const m = buildTableModel(spec, rows);
  expect(m.body.map((b) => b.kind)).toEqual(["group", "row", "row", "group", "row"]);
  const firstRow = m.body.find((b) => b.kind === "row") as any;
  expect(firstRow.row.cells[0].text).toBe("1.20");
});

it("missing cell yields null value and em-dash text", () => {
  // Row "r2" has no data for leaf "2026", only for leaf "2027".
  const spec: TableSpec = {
    title: "T", data: "d", value: "value",
    stub: [{ label: "row" }],
    header: ["per"],
    format: { default: { type: "number", decimals: 2 } },
  };
  const rows = [
    { row: "r1", per: "2026", value: "1.0" },
    { row: "r1", per: "2027", value: "2.0" },
    { row: "r2", per: "2027", value: "3.0" },
  ] as any;
  const m = buildTableModel(spec, rows);
  // Leaves should be [2026, 2027] in first-seen order.
  expect(m.leaves.map((l) => l.key)).toEqual(["2026", "2027"]);
  // r2's cell for "2026" has no source row → value null, text em-dash.
  const r2 = m.body.find((b) => b.kind === "row" && (b as any).row.label === "r2") as any;
  expect(r2.row.cells[0]).toEqual({ value: null, text: "—" });
});

it("column_order reorders leaves", () => {
  const spec: TableSpec = {
    title: "T", data: "d", value: "value",
    stub: [{ label: "row" }],
    header: ["per"],
    format: { default: { type: "number", decimals: 2 } },
    column_order: ["2027", "2026"],
  };
  const rows = [
    { row: "r1", per: "2026", value: "1.0" },
    { row: "r1", per: "2027", value: "2.0" },
  ] as any;
  const m = buildTableModel(spec, rows);
  expect(m.leaves.map((l) => l.key)).toEqual(["2027", "2026"]);
});

it("applies column_labels and header_labels overrides to HeaderCell.text", () => {
  // Two header tiers: banner (scenario_group) and leaf (scenario).
  // header_labels overrides a banner value; column_labels overrides a leaf value.
  const spec: TableSpec = {
    title: "T", data: "d", value: "value",
    stub: [{ label: "row" }],
    header: ["banner", "leaf"],
    format: { default: { type: "number", decimals: 1 } },
    header_labels: { "Baseline": "BL" },   // banner override
    column_labels: { "Static": "Stat" },   // leaf override
  };
  const rows = [
    { row: "r1", banner: "Baseline", leaf: "Static",  value: "1.0" },
    { row: "r1", banner: "Baseline", leaf: "Dynamic", value: "2.0" },
    { row: "r1", banner: "Reform",   leaf: "Other",   value: "3.0" },
  ] as any;

  const m = buildTableModel(spec, rows);

  // Banner tier (headerRows[0]): "Baseline" → "BL"; "Reform" stays "Reform" (no override).
  const bannerTexts = m.headerRows[0]!.map((c) => c.text);
  expect(bannerTexts).toContain("BL");
  expect(bannerTexts).toContain("Reform");
  expect(bannerTexts).not.toContain("Baseline");

  // Leaf tier (headerRows[1]): "Static" leaf → "Stat" via column_labels; "Dynamic" unchanged.
  const leafTexts = m.headerRows[1]!.map((c) => c.text);
  expect(leafTexts).toContain("Stat");
  expect(leafTexts).toContain("Dynamic");
  expect(leafTexts).not.toContain("Static");

  // Sanity: leaf keys are still the raw values.
  expect(m.leaves.map((l) => l.key)).toEqual(["Static", "Dynamic", "Other"]);
});
