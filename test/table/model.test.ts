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

it("per-column signColor:false overrides global sign_color:true", () => {
  // Global sign_color is on, but column "B" opts out via format.columns.B.signColor=false.
  // Cells in column B must carry NO signClass; cells in column A still do.
  const spec: TableSpec = {
    title: "T", data: "d", value: "value",
    stub: [{ label: "row" }],
    header: ["metric"],
    sign_color: true,
    format: {
      default: { type: "number", decimals: 1 },
      columns: { B: { signColor: false } },
    },
  };
  const rows = [
    { row: "r1", metric: "A", value: "1.0" },
    { row: "r1", metric: "B", value: "-2.0" },
  ] as any;
  const m = buildTableModel(spec, rows);
  expect(m.leaves.map((l) => l.key)).toEqual(["A", "B"]);
  const r1 = m.body.find((b) => b.kind === "row") as any;
  // Column A (index 0): global default applies → signClass present.
  expect(r1.row.cells[0].signClass).toBe("pos");
  // Column B (index 1): per-column override wins → no signClass despite negative value.
  expect(r1.row.cells[1].signClass).toBeUndefined();
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
  // Byte-identity guard: globally-unique leaf values → key === lastValue (no suffix branch hit).
  expect(m.leaves.map((l) => l.lastValue)).toEqual(["Static", "Dynamic", "Other"]);
  m.leaves.forEach((l) => expect(l.key).toBe(l.lastValue));
});

describe("repeated last-tier header value under distinct banners (full-path leaf keying)", () => {
  const spec: TableSpec = {
    title: "T", data: "d", value: "value",
    stub: [{ label: "row" }],
    header: ["banner", "leaf"],
    format: { default: { type: "number", decimals: 1 } },
    header_labels: {
      Levels: "Levels",
      Change: "Change vs. default",
      presub: "Pre-substitution",
      postsub: "Post-substitution",
    },
  };
  const rows = [
    { row: "USA", banner: "Levels", leaf: "presub", value: "10" },
    { row: "USA", banner: "Levels", leaf: "postsub", value: "20" },
    { row: "USA", banner: "Change", leaf: "presub", value: "30" },
    { row: "USA", banner: "Change", leaf: "postsub", value: "40" },
  ] as any;

  it("keeps all 4 leaves distinct (no collision/drop) and suffixes the duplicate keys deterministically", () => {
    const m = buildTableModel(spec, rows);
    expect(m.leaves).toHaveLength(4);
    expect(m.leaves.map((l) => l.key)).toEqual(["presub", "postsub", "presub~1", "postsub~1"]);
    expect(m.leaves.map((l) => l.lastValue)).toEqual(["presub", "postsub", "presub", "postsub"]);
  });

  it("renders both banner texts in the top header row", () => {
    const m = buildTableModel(spec, rows);
    const bannerTexts = m.headerRows[0]!.map((c) => c.text);
    expect(bannerTexts).toEqual(["Levels", "Change vs. default"]);
  });

  it("applies header_labels keyed by the repeated value to BOTH leaves", () => {
    const m = buildTableModel(spec, rows);
    const leafTexts = m.headerRows[1]!.map((c) => c.text);
    expect(leafTexts).toEqual(["Pre-substitution", "Post-substitution", "Pre-substitution", "Post-substitution"]);
  });

  it("resolves correct cell values under each banner", () => {
    const m = buildTableModel(spec, rows);
    const row = m.body.find((b) => b.kind === "row") as any;
    expect(row.row.cells.map((c: any) => c.text)).toEqual(["10.0", "20.0", "30.0", "40.0"]);
  });

  it("column_order listing the repeated value orders both leaves (stable first-seen tie-break)", () => {
    const orderedSpec: TableSpec = { ...spec, column_order: ["postsub", "presub"] };
    const m = buildTableModel(orderedSpec, rows);
    expect(m.leaves.map((l) => l.key)).toEqual(["postsub", "postsub~1", "presub", "presub~1"]);
    expect(m.leaves.map((l) => l.lastValue)).toEqual(["postsub", "postsub", "presub", "presub"]);
  });
});

it("keeps non-numeric values as text cells (verbatim, no numeric formatting)", () => {
  const spec: TableSpec = {
    title: "T", data: "d", value: "value",
    stub: [{ label: "row" }],
    header: ["metric"],
    format: { default: { type: "number", decimals: 1 } },
  };
  const rows = [
    { row: "Rate", metric: "Details", value: "10% flat rate" },
    { row: "Count", metric: "Details", value: "42" },
    { row: "Blank", metric: "Details", value: "" },
  ] as any;
  const m = buildTableModel(spec, rows);
  const cells = m.body
    .filter((b) => b.kind === "row")
    .map((b) => (b as any).row.cells[0]);
  // Text value: kept verbatim, flagged isText, value null.
  expect(cells[0].isText).toBe(true);
  expect(cells[0].text).toBe("10% flat rate");
  expect(cells[0].value).toBeNull();
  // Numeric value: formatted, not text.
  expect(cells[1].isText).toBeUndefined();
  expect(cells[1].value).toBe(42);
  expect(cells[1].text).toBe("42.0");
  // Blank: stays a null numeric cell, not text.
  expect(cells[2].isText).toBeUndefined();
});

it("flags a pure-text column as isText (mixed/numeric columns are not)", () => {
  const spec: TableSpec = {
    title: "T", data: "d", value: "value",
    stub: [{ label: "row" }],
    header: ["metric"],
    format: { default: { type: "number", decimals: 0 } },
  };
  const pureText = [
    { row: "a", metric: "Details", value: "free text" },
    { row: "b", metric: "Details", value: "more text" },
  ] as any;
  expect(buildTableModel(spec, pureText).leaves[0]!.isText).toBe(true);

  const mixed = [
    { row: "a", metric: "Details", value: "free text" },
    { row: "b", metric: "Details", value: "42" },
  ] as any;
  expect(buildTableModel(spec, mixed).leaves[0]!.isText).toBeUndefined();
});

describe("order-independent grouping + group_order (Task 2)", () => {
  it("groups rows by stub path regardless of input order (scenario-major CSV)", () => {
    const spec: TableSpec = {
      title: "T", data: "d", value: "value",
      stub: ["country", { label: "scenario" }],
      header: ["metric"],
    };
    // Scenario-major input: base for both countries, then reform for both countries.
    const rows = [
      { country: "China", scenario: "base", metric: "m", value: "1" },
      { country: "Canada", scenario: "base", metric: "m", value: "2" },
      { country: "China", scenario: "reform", metric: "m", value: "3" },
      { country: "Canada", scenario: "reform", metric: "m", value: "4" },
    ] as any;
    const m = buildTableModel(spec, rows);
    expect(m.body.map((b) => b.kind)).toEqual(["group", "row", "row", "group", "row", "row"]);
    expect(m.body.filter((b) => b.kind === "group").map((b: any) => b.group.label)).toEqual(["China", "Canada"]);
    expect(m.body.filter((b) => b.kind === "row").map((b: any) => b.row.label)).toEqual([
      "base", "reform", "base", "reform",
    ]);
  });

  it("group_order reorders the first group tier; unlisted groups follow first-seen", () => {
    const spec: TableSpec = {
      title: "T", data: "d", value: "value",
      stub: ["country", { label: "scenario" }],
      header: ["metric"],
      group_order: ["Total", "China", "Canada"],
    };
    const rows = [
      { country: "China", scenario: "base", metric: "m", value: "1" },
      { country: "Canada", scenario: "base", metric: "m", value: "2" },
      { country: "Mexico", scenario: "base", metric: "m", value: "3" }, // unlisted
      { country: "Total", scenario: "base", metric: "m", value: "4" },
    ] as any;
    const m = buildTableModel(spec, rows);
    expect(m.body.filter((b) => b.kind === "group").map((b: any) => b.group.label)).toEqual([
      "Total", "China", "Canada", "Mexico",
    ]);
  });

  it("group_order as string[][] orders each group level independently", () => {
    const spec: TableSpec = {
      title: "T", data: "d", value: "value",
      stub: ["region", "country", { label: "scenario" }],
      header: ["metric"],
      group_order: [["Americas", "Asia"], ["Canada", "Mexico", "China"]],
    };
    const rows = [
      { region: "Asia", country: "China", scenario: "base", metric: "m", value: "1" },
      { region: "Americas", country: "Mexico", scenario: "base", metric: "m", value: "2" },
      { region: "Americas", country: "Canada", scenario: "base", metric: "m", value: "3" },
    ] as any;
    const m = buildTableModel(spec, rows);
    expect(m.body.filter((b) => b.kind === "group").map((b: any) => [b.group.level, b.group.label])).toEqual([
      [0, "Americas"], [1, "Canada"], [1, "Mexico"], [0, "Asia"], [1, "China"],
    ]);
  });

  it("row_order orders leaves within each group only (a shared leaf value doesn't hoist across groups)", () => {
    const spec: TableSpec = {
      title: "T", data: "d", value: "value",
      stub: ["country", { label: "scenario" }],
      header: ["metric"],
      row_order: ["reform", "base"],
    };
    const rows = [
      { country: "China", scenario: "base", metric: "m", value: "1" },
      { country: "China", scenario: "reform", metric: "m", value: "2" },
      { country: "Canada", scenario: "base", metric: "m", value: "3" },
      { country: "Canada", scenario: "reform", metric: "m", value: "4" },
    ] as any;
    const m = buildTableModel(spec, rows);
    expect(m.body.filter((b) => b.kind === "group").map((b: any) => b.group.label)).toEqual(["China", "Canada"]);
    expect(m.body.filter((b) => b.kind === "row").map((b: any) => b.row.label)).toEqual([
      "reform", "base", "reform", "base",
    ]);
  });

  it("absent group_order + already-contiguous grouped data produces unchanged body order (byte-identity guard)", () => {
    const spec: TableSpec = { ...tariff, stub: ["grp", { label: "row" }], header: ["per"] };
    const rows = [
      { grp: "G1", row: "r1", per: "2026", value: "1.2" },
      { grp: "G1", row: "r2", per: "2026", value: "3.4" },
      { grp: "G2", row: "r3", per: "2026", value: "5.6" },
    ] as any;
    const m = buildTableModel(spec, rows);
    expect(m.body.map((b) => b.kind)).toEqual(["group", "row", "row", "group", "row"]);
    expect(m.body.filter((b) => b.kind === "row").map((b: any) => b.row.label)).toEqual(["r1", "r2", "r3"]);
  });

  it("flat stub (no groups) with no row_order stays in first-seen order (sort is skipped)", () => {
    const spec: TableSpec = {
      title: "T", data: "d", value: "value",
      stub: [{ label: "row" }],
      header: ["metric"],
    };
    const rows = [
      { row: "b", metric: "m", value: "1" },
      { row: "a", metric: "m", value: "2" },
    ] as any;
    const m = buildTableModel(spec, rows);
    expect(m.body.map((b: any) => b.row.label)).toEqual(["b", "a"]);
  });
});

it("sets the stub corner from stub_header (string form)", () => {
  const spec: TableSpec = {
    title: "T", data: "d", value: "value", stub_header: "Parameter",
    stub: [{ label: "row" }], header: ["metric"],
  };
  const m = buildTableModel(spec, [{ row: "a", metric: "M", value: "1" }] as any);
  expect(m.stubHeader).toBe("Parameter");
});
