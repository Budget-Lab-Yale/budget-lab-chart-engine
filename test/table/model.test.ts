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
  expect(dynLeaf.rowSpan).toBeGreaterThan(1);
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
