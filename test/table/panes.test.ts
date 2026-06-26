import { describe, it, expect } from "vitest";
import { splitPanes } from "../../src/table/panes";
import type { TableSpec } from "../../src/spec/table-types";

const base: TableSpec = {
  title: "T",
  data: "d",
  stub: [{ label: "row" }],
  header: ["metric"],
  value: "value",
};

const rows = [
  { section: "A", row: "r1", metric: "x", value: "1" },
  { section: "B", row: "r2", metric: "y", value: "2" },
  { section: "A", row: "r3", metric: "x", value: "3" },
  { section: "C", row: "r4", metric: "z", value: "4" },
] as any;

describe("splitPanes", () => {
  it("single-table spec (no pane) yields one untitled pane with all rows", () => {
    const panes = splitPanes(base, rows);
    expect(panes.length).toBe(1);
    expect(panes[0]!.value).toBe("");
    expect(panes[0]!.title).toBe("");
    expect(panes[0]!.rows.length).toBe(rows.length);
  });

  it("groups rows by the pane column in first-seen order", () => {
    const panes = splitPanes({ ...base, pane: "section" }, rows);
    expect(panes.map((p) => p.value)).toEqual(["A", "B", "C"]);
    expect(panes[0]!.rows.map((r: any) => r.row)).toEqual(["r1", "r3"]);
  });

  it("pane_order reorders and filters", () => {
    const panes = splitPanes({ ...base, pane: "section", pane_order: ["C", "A"] }, rows);
    expect(panes.map((p) => p.value)).toEqual(["C", "A"]); // B dropped
  });

  it("pane_titles overrides the subheading; falls back to the value", () => {
    const panes = splitPanes(
      { ...base, pane: "section", pane_titles: { A: "Group Alpha" } },
      rows,
    );
    expect(panes.find((p) => p.value === "A")!.title).toBe("Group Alpha");
    expect(panes.find((p) => p.value === "B")!.title).toBe("B");
  });
});
