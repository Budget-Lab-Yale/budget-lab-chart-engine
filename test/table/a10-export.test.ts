// @vitest-environment jsdom
//
// Finding A10 (2026-10-15 debt review): table PNG-export geometry. Each block here pins one fix with
// a check that fails on the pre-fix code. The live/PNG comparison itself is test/table/parity.test.ts;
// these are the unit-level facts behind it (layout heights, clamp lines, header columns).
import { describe, it, expect } from "vitest";
import { buildTableModel } from "../../src/table/model";
import { layoutTable, layoutOptionsFromSpec } from "../../src/table/layout";
import { mountTable } from "../../src/table/mount";
import { buildTableExportSvg } from "../../src/embed/export-table-png";
import type { TableSpec } from "../../src/spec/table-types";
import type { TidyRow } from "../../src/data/index";

const BS2 = "\\\\"; // the two-character `\\` hard-break token
const rowsOf = (rs: Array<Record<string, string | number>>): TidyRow[] =>
  rs.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)]))) as unknown as TidyRow[];

/** A two-tier table: one banner `banner` over leaves 2026/2027, one stub column. */
function bannerTable(banner: string, extra: Partial<TableSpec> = {}) {
  const spec: TableSpec = {
    title: "T", data: "d.csv", stub: [{ label: "row" }], header: ["opt", "per"], value: "value",
    format: { default: { decimals: 0 } }, ...extra,
  };
  const rows = rowsOf(["Alpha", "Beta"].flatMap((row, i) =>
    ["2026", "2027"].map((per, j) => ({ row, opt: "Option", per, value: 10 + i + j }))));
  return { spec: { ...spec, header_labels: { Option: banner, ...(extra.header_labels ?? {}) } }, rows };
}

describe("A10 `\\\\` heights", () => {
  it("a broken banner grows its tier by one header line per extra line (income-above-top-thresholds: ~15 px)", () => {
    const plain = bannerTable("Income above threshold");
    const broken = bannerTable(`Income above ${BS2} threshold`);
    const lay = (x: { spec: TableSpec; rows: TidyRow[] }) =>
      layoutTable(buildTableModel(x.spec, x.rows), { measureText: (s) => s.length * 7 });
    const a = lay(plain), b = lay(broken);
    expect(b.tierY[1]! - a.tierY[1]!).toBe(15);
    expect(b.headerHeight - a.headerHeight).toBe(15);
  });

  it("a banner spanning two tiers (blank tier absorbed) takes only the height its tiers lack", () => {
    // Leaves a/b: tier0 blank, so "M" spans tiers 0-1. A 3-line "M" needs 26 + 2*15 = 56 > 52.
    const spec: TableSpec = {
      title: "T", data: "d.csv", stub: [{ label: "row" }], header: ["t0", "t1", "leaf"], value: "value",
      header_labels: { M: `One ${BS2} two ${BS2} three` },
    };
    const rows = rowsOf([["", "M", "a"], ["", "M", "b"], ["G", "H", "c"]].map(([t0, t1, leaf]) =>
      ({ row: "r", t0: t0!, t1: t1!, leaf: leaf!, value: 1 })));
    const layout = layoutTable(buildTableModel(spec, rows), { measureText: (s) => s.length * 7 });
    const m = layout.header.flat().find((e) => e.cell.text.startsWith("One"))!;
    expect(m.rect.h).toBe(56);
    expect(layout.tierY).toEqual([0, 30, 56]);
  });

  it("a corner `\\\\` only grows the header by what its tiers cannot already hold", () => {
    const one = (stub_header: string, header: string[]) => {
      const spec: TableSpec = { title: "T", data: "d.csv", stub: [{ label: "row" }], header, value: "value", stub_header };
      const rows = rowsOf([{ row: "r", opt: "O", per: "2026", value: 1 }, { row: "r", opt: "O", per: "2027", value: 1 }]);
      return layoutTable(buildTableModel(spec, rows), { measureText: (s) => s.length * 7 }).headerHeight;
    };
    expect(one(`A ${BS2} B`, ["per"]) - one("A B", ["per"])).toBe(15); // one tier: grows
    expect(one(`A ${BS2} B`, ["opt", "per"]) - one("A B", ["opt", "per"])).toBe(0); // two tiers: room
  });

  it("break-free headers, corners, group labels and sublabels lay out exactly as before", () => {
    const t = bannerTable("Option", { stub_header: "Row", sublabels: { "2026": "(a)" } });
    const layout = layoutTable(buildTableModel(t.spec, t.rows), { measureText: (s) => s.length * 7 });
    expect(layout.tierY).toEqual([0, 26]);
    expect(layout.headerHeight).toBe(26 + 26 + 14);
    expect("sublabelLines" in layout).toBe(false);
  });
});

describe("A10 header_max_lines clamp", () => {
  const spec = (label: string, n: number): TableSpec => ({
    title: "T", data: "d.csv", stub: [{ label: "row" }], header: ["col"], value: "value",
    header_max_lines: n, column_width: 100, column_labels: { c: label },
  });
  const rows = rowsOf([{ row: "r", col: "c", value: 1 }]);
  const leafLines = (label: string, n: number) => {
    const s = spec(label, n);
    const layout = layoutTable(buildTableModel(s, rows), { measureText: (x) => x.length * 7, ...layoutOptionsFromSpec(s) });
    return layout.header[0]![0]!.lines;
  };

  it("more lines than N: the first N show, the Nth ending in an ellipsis that fits the column", () => {
    const lines = leafLines("Share of total federal tax change by income group", 2)!;
    expect(lines).toHaveLength(2);
    expect(lines[1]!.endsWith("…")).toBe(true);
    for (const l of lines) expect(l.length * 7).toBeLessThanOrEqual(100 - 16);
  });

  it("N = 1 clamps too (the live clamp wraps, then shows one line)", () => {
    const lines = leafLines("Share of total federal tax change", 1)!;
    expect(lines).toHaveLength(1);
    expect(lines[0]!.endsWith("…")).toBe(true);
    expect(lines[0]!.length * 7).toBeLessThanOrEqual(84);
  });

  it("a label that fits in N lines wraps as it always did", () => {
    expect(leafLines("Average tax change", 2)).toEqual(["Average tax", "change"]);
    expect(leafLines("Short", 2)).toBeUndefined();
  });

  // The schema accepts any number. Below 1 means no clamp; a fraction is floored. Live and export
  // must agree (and neither may throw).
  const LONG = "Share of total federal tax change by income group";
  for (const [n, live, lines] of [[0, null, 1], [0.5, null, 1], [1.5, "1", 1], [2, "2", 2], [2.9, "2", 2]] as const) {
    it(`header_max_lines ${n}: live clamp ${live ?? "none"}, export ${lines} line(s)`, () => {
      const s = spec(LONG, n);
      const container = document.createElement("div");
      mountTable(container, { spec: s, rows });
      const clampEl = container.querySelector(".tbl-table-header-clamp") as HTMLElement | null;
      expect(clampEl?.style.getPropertyValue("--tbl-header-lines") ?? null).toBe(live);
      const root = buildTableExportSvg(s, rows);
      const leaf = Array.from(root.querySelectorAll("g.tbl-table-header > text")).find((t) => (t.textContent ?? "").startsWith("Share"))!;
      const drawn = leaf.querySelectorAll("tspan").length || 1;
      expect(drawn).toBe(lines);
      if (live == null) expect(leaf.textContent).toBe(LONG); // unclamped: the whole label, on one line
      else expect((leaf.textContent ?? "").endsWith("…")).toBe(true);
    });
  }
});

describe("A10 header cells carry their leaf column", () => {
  it("cells after a skipped (absorbed) leaf start at their own column", () => {
    const spec: TableSpec = { title: "T", data: "d.csv", stub: [{ label: "row" }], header: ["t0", "t1", "leaf"], value: "value" };
    const rows = rowsOf([["", "M", "a"], ["", "M", "b"], ["G", "H", "c"], ["G", "H", "d"]].map(([t0, t1, leaf]) =>
      ({ row: "r", t0: t0!, t1: t1!, leaf: leaf!, value: 1 })));
    const m = buildTableModel(spec, rows);
    expect(m.headerRows.map((tier) => tier.map((c) => [c.text, c.start, c.colSpan]))).toEqual([
      [["M", 0, 2], ["G", 2, 2]],
      [["H", 2, 2]],
      [["a", 0, 1], ["b", 1, 1], ["c", 2, 1], ["d", 3, 1]],
    ]);
    const layout = layoutTable(m, { measureText: (s) => s.length * 7 });
    const h = layout.header[1]![0]!;
    expect(h.rect.x).toBe(layout.colX[2]);
  });
});
