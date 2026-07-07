import { describe, it, expect } from "vitest";
import { validateTableSpec, validateTableData } from "../../src/spec/table-validate";
import type { TableSpec } from "../../src/spec/table-types";

const ok: TableSpec = { title: "T", data: "d.csv", stub: ["g", { label: "lab" }], header: ["per"], value: "val" };

describe("validateTableSpec", () => {
  it("accepts a minimal valid spec", () => { expect(validateTableSpec(ok).valid).toBe(true); });
  it("rejects unknown property", () => {
    const r = validateTableSpec({ ...ok, bogus: 1 });
    expect(r.valid).toBe(false); expect(r.errors.join()).toMatch(/bogus/);
  });
  it("requires stub/header/value", () => { expect(validateTableSpec({ title: "T", data: "d" }).valid).toBe(false); });

  it("accepts group_order as a flat string[] (first tier) or string[][] (per level)", () => {
    expect(validateTableSpec({ ...ok, group_order: ["A", "B"] }).valid).toBe(true);
    expect(validateTableSpec({ ...ok, group_order: [["A"], ["B", "C"]] }).valid).toBe(true);
  });
  it("rejects group_order with a non-string/non-array-of-strings shape", () => {
    expect(validateTableSpec({ ...ok, group_order: [1, 2] }).valid).toBe(false);
    expect(validateTableSpec({ ...ok, group_order: "nope" }).valid).toBe(false);
  });

  it("accepts collapsible with default/expanded/collapsed", () => {
    const r = validateTableSpec({
      ...ok,
      collapsible: { default: "collapsed", expanded: ["China", "Total"], collapsed: ["Mexico"] },
    });
    expect(r.valid).toBe(true);
  });

  it("accepts collapsible with no subkeys at all", () => {
    expect(validateTableSpec({ ...ok, collapsible: {} }).valid).toBe(true);
  });

  it("rejects a bad collapsible.default enum value", () => {
    const r = validateTableSpec({ ...ok, collapsible: { default: "closed" } });
    expect(r.valid).toBe(false);
  });

  it("rejects an unknown collapsible subkey", () => {
    const r = validateTableSpec({ ...ok, collapsible: { defualt: "collapsed" } } as any);
    expect(r.valid).toBe(false);
  });
});

describe("validateTableData", () => {
  const rows = [
    { g: "A", lab: "r1", per: "2026", val: "1" },
    { g: "A", lab: "r1", per: "2027", val: "2" },
  ] as any;
  it("passes when role columns exist", () => { expect(validateTableData(ok, rows).valid).toBe(true); });
  it("fails on missing role column", () => {
    const r = validateTableData(ok, [{ g: "A", per: "2026", val: "1" }] as any);
    expect(r.valid).toBe(false); expect(r.errors.join()).toMatch(/lab/);
  });
  it("fails on duplicate cell", () => {
    const dup = [...rows, { g: "A", lab: "r1", per: "2026", val: "9" }] as any;
    const r = validateTableData(ok, dup);
    expect(r.valid).toBe(false); expect(r.errors.join()).toMatch(/duplicate/i);
  });

  it("fails when the pane column is missing", () => {
    const r = validateTableData({ ...ok, pane: "section" }, rows);
    expect(r.valid).toBe(false); expect(r.errors.join()).toMatch(/section/);
  });

  it("allows the same stub+header coordinate across different panes", () => {
    const paned = [
      { section: "A", g: "G", lab: "r1", per: "2026", val: "1" },
      { section: "B", g: "G", lab: "r1", per: "2026", val: "2" }, // same coord, different pane → OK
    ] as any;
    const r = validateTableData({ ...ok, pane: "section" }, paned);
    expect(r.valid).toBe(true);
  });

  it("still catches a duplicate within one pane", () => {
    const paned = [
      { section: "A", g: "G", lab: "r1", per: "2026", val: "1" },
      { section: "A", g: "G", lab: "r1", per: "2026", val: "9" }, // dup within pane A
    ] as any;
    const r = validateTableData({ ...ok, pane: "section" }, paned);
    expect(r.valid).toBe(false); expect(r.errors.join()).toMatch(/duplicate/i);
  });
});
