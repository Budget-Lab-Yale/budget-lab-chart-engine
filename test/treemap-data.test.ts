import { describe, it, expect } from "vitest";
import { validateChartData } from "../src/spec/validate";
import {
  treemapData, treemapDataErrors, treemapDataWarnings, formatTreemapValue, formatTreemapShare,
} from "../src/spec/treemap";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const spec = (extra: Partial<ChartSpec> = {}, columns: ChartSpec["columns"] = { x: "name", value: "amount" }): ChartSpec =>
  ({ chartType: "treemap", title: "T", xAxisType: "categorical", data: "d.csv", columns, ...extra }) as ChartSpec;
const grouped = (extra: Partial<ChartSpec> = {}) => spec(extra, { x: "name", value: "amount", series: "g" });
const row = (name: string, amount: string, g?: string): TidyRow => (g === undefined ? { name, amount } : { name, amount, g });

describe("treemapDataErrors", () => {
  it("passes valid flat and grouped data", () => {
    expect(treemapDataErrors(spec(), [row("A", "1"), row("B", "2")])).toEqual([]);
    expect(treemapDataErrors(grouped(), [row("A", "1", "X"), row("B", "2", "Y")])).toEqual([]);
  });

  it("rejects a negative value", () => {
    expect(treemapDataErrors(spec(), [row("A", "1"), row("B", "-2")])).toEqual([
      `row 2: columns.value ("amount") must be a number ≥ 0, got "-2"`,
    ]);
  });

  it.each(["abc", "", "  ", "Infinity", "NaN"])("rejects non-numeric value %j", (bad) => {
    expect(treemapDataErrors(spec(), [row("A", bad)])).toEqual([
      `row 1: columns.value ("amount") must be a number ≥ 0, got ${JSON.stringify(bad)}`,
    ]);
  });

  it("rejects a blank name", () => {
    expect(treemapDataErrors(spec(), [row("A", "1"), row("  ", "2")])).toEqual([`row 2: columns.x ("name") is blank`]);
  });

  it.each(["", "   "])("rejects a blank group cell %j on a grouped treemap, naming the row", (blank) => {
    expect(treemapDataErrors(grouped(), [row("A", "1", "X"), row("B", "2", blank)])).toEqual([
      `row 2: columns.series ("g") is blank`,
    ]);
  });

  it("rejects data with no drawable tile", () => {
    expect(treemapDataErrors(spec(), [row("A", "0"), row("B", "0")])).toEqual([
      "treemap has no tiles to draw: every value is zero",
    ]);
  });

  it("rejects values whose grand total overflows to Infinity", () => {
    expect(treemapDataErrors(spec(), [row("A", "1e308"), row("B", "1e308")])).toEqual([
      "treemap values are too large to total",
    ]);
  });

  it("accepts one huge value whose total is still finite", () => {
    expect(treemapDataErrors(spec(), [row("A", "1e308")])).toEqual([]);
  });

  it("does not add the no-tiles error when a row is already invalid", () => {
    expect(treemapDataErrors(spec(), [row("A", "0"), row("B", "x")])).toHaveLength(1);
  });

  it("rejects a duplicate name within a group, naming both rows", () => {
    expect(treemapDataErrors(grouped(), [row("A", "1", "X"), row("B", "1", "X"), row("A", "3", "X")])).toEqual([
      `row 3: duplicate tile "A" in group "X" (also row 1)`,
    ]);
  });

  it("rejects a duplicate name with no groups", () => {
    expect(treemapDataErrors(spec(), [row("A", "1"), row("A", "2")])).toEqual([`row 2: duplicate tile "A" (also row 1)`]);
  });

  it("allows the same name across groups", () => {
    expect(treemapDataErrors(grouped(), [row("A", "1", "X"), row("A", "2", "Y")])).toEqual([]);
  });

  it("rejects a tooltip column missing from the data", () => {
    const s = spec({ treemap: { tooltip: [{ column: "amount" }, { column: "nope" }] } });
    expect(treemapDataErrors(s, [row("A", "1")])).toEqual([`treemap.tooltip[1].column "nope" is not a column in the data`]);
  });

  it("rejects a tooltip_note column missing from the data, naming it", () => {
    expect(treemapDataErrors(spec({ treemap: { tooltip_note: "nope" } }), [row("A", "1")]))
      .toEqual([`treemap.tooltip_note "nope" is not a column in the data`]);
    expect(treemapDataErrors(spec({ treemap: { tooltip_note: "amount" } }), [row("A", "1")])).toEqual([]);
  });

  it("reports a missing name or value column", () => {
    const errs = treemapDataErrors(spec(), [{ other: "a" }]);
    expect(errs).toHaveLength(2);
    expect(errs[0]).toContain(`columns.x is "name" but no such column exists`);
    expect(errs[1]).toContain(`columns.value is "amount" but no such column exists`);
  });
});

describe("validateChartData wiring", () => {
  it("runs the treemap data errors", () => {
    expect(validateChartData(spec(), [row("A", "-1")]).errors).toEqual([
      `row 1: columns.value ("amount") must be a number ≥ 0, got "-1"`,
    ]);
  });

  it("names series_order / series_colors / series_labels keys absent from the groups", () => {
    const rows = [row("A", "1", "X"), row("B", "2", "Y")];
    const r = validateChartData(grouped({ series_order: ["X", "Z"], series_colors: { Q: "blue" }, series_labels: { R: "r" } }), rows);
    expect(r.valid).toBe(false);
    expect(r.errors).toHaveLength(3);
    expect(r.errors[0]).toContain(`series_order names series ["Z"] not found in the data`);
    expect(r.errors[1]).toContain(`series_colors names series ["Q"]`);
    expect(r.errors[2]).toContain(`series_labels names series ["R"]`);
  });

  it("rejects every series_order / series_colors / series_labels key on a flat treemap, the \"\" key included", () => {
    const rows = [row("A", "1"), row("B", "2")];
    const r = validateChartData(spec({ series_order: [""], series_colors: { "": "red" }, series_labels: { "": "Everything", X: "x" } }), rows);
    expect(r.valid).toBe(false);
    expect(r.errors).toEqual([
      `series_order key "" is not allowed: this treemap has no groups (columns.series)`,
      `series_colors key "" is not allowed: this treemap has no groups (columns.series)`,
      `series_labels key "" is not allowed: this treemap has no groups (columns.series)`,
      `series_labels key "X" is not allowed: this treemap has no groups (columns.series)`,
    ]);
    expect(validateChartData(spec({ series_order: [] }), rows)).toEqual({ valid: true, errors: [] });
  });

  it("accepts valid group keys", () => {
    const rows = [row("A", "1", "X"), row("B", "2", "Y")];
    expect(validateChartData(grouped({ series_order: ["Y", "X"], series_colors: { X: "blue" } }), rows)).toEqual({ valid: true, errors: [] });
  });
});

describe("treemapData", () => {
  it("drops zeros and keeps CSV order and index", () => {
    const rows = [row("A", "5", "X"), row("B", "0", "X"), row("C", "2.5", "Y")];
    const d = treemapData(grouped(), rows);
    expect(d.map((x) => [x.index, x.name, x.group, x.value])).toEqual([[0, "A", "X", 5], [2, "C", "Y", 2.5]]);
    expect(d[0]!.row).toBe(rows[0]);
  });

  it("has a null group when flat", () => {
    expect(treemapData(spec(), [row("A", "1")])[0]!.group).toBeNull();
  });
});

describe("treemapDataWarnings", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => row(`T${i}`, "1"));

  it("warns on zero rows, naming them", () => {
    const w = treemapDataWarnings(spec(), [row("A", "1"), row("B", "0"), row("C", "0")]);
    expect(w).toEqual([`treemap: 2 zero-value rows not drawn: row 2 ("B"), row 3 ("C")`]);
  });

  it("warns above 30 tiles but not at 30", () => {
    expect(treemapDataWarnings(spec(), many(30))).toEqual([]);
    expect(treemapDataWarnings(spec(), many(31))).toEqual([`treemap: 31 tiles; consider grouping small categories into "Other"`]);
  });

  it("does not count dropped zero rows as tiles", () => {
    expect(treemapDataWarnings(spec(), [...many(30), row("Z", "0")])).toHaveLength(1);
  });

  it("warns on more than 7 groups without series_colors, not with", () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(`T${i}`, "1", `G${i}`));
    expect(treemapDataWarnings(grouped(), rows)).toHaveLength(1);
    expect(treemapDataWarnings(grouped(), rows)[0]).toContain("8 groups and no series_colors");
    expect(treemapDataWarnings(grouped({ series_colors: { G0: "blue" } }), rows)).toEqual([]);
    expect(treemapDataWarnings(grouped(), rows.slice(0, 7))).toEqual([]);
  });
});

describe("formatters", () => {
  it("groups thousands and applies affixes", () => {
    expect(formatTreemapValue(28452, { prefix: "$" })).toBe("$28,452");
    expect(formatTreemapValue(1234.567, { decimals: 1, suffix: " bn" })).toBe("1,234.6 bn");
    expect(formatTreemapValue(1234567, undefined)).toBe("1,234,567");
    expect(formatTreemapValue(999, undefined)).toBe("999");
    expect(formatTreemapValue(1000, { decimals: 2 })).toBe("1,000.00");
  });

  it("never prints an exponent, at any finite magnitude", () => {
    expect(formatTreemapValue(1e21, { prefix: "$", decimals: 2 })).toBe("$1,000,000,000,000,000,000,000.00");
    expect(formatTreemapValue(-1e21, { prefix: "$" })).toBe("-$1,000,000,000,000,000,000,000");
    expect(formatTreemapValue(1e-7, { decimals: 2 })).toBe("0.00");
    for (const v of [1e21, 1.5e30, 9.99e300, Number.MAX_VALUE]) expect(formatTreemapValue(v, { decimals: 1 })).not.toMatch(/e/i);
  });

  it("puts the minus before the prefix and never prints a negative zero", () => {
    expect(formatTreemapValue(-5, { prefix: "$" })).toBe("-$5");
    expect(formatTreemapValue(-1234.56, { decimals: 1, suffix: " bn" })).toBe("-1,234.6 bn");
    expect(formatTreemapValue(-0.04, { decimals: 1 })).toBe("0.0");
    expect(formatTreemapValue(-0, undefined)).toBe("0");
  });

  it("formats shares", () => {
    expect(formatTreemapShare(0.334, 1)).toBe("33.4%");
    expect(formatTreemapShare(1, 1)).toBe("100.0%");
    expect(formatTreemapShare(0.02, 0)).toBe("2%");
  });
});
