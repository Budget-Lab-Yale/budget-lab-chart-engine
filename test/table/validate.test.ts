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
});
