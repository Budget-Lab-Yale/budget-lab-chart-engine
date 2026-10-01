import { describe, it, expect } from "vitest";
import { validateSpec, TREEMAP_ALLOWED_FIELDS, TREEMAP_REJECTED_FIELDS } from "../src/spec/validate";
import { CHART_SPEC_SCHEMA } from "../src/spec/schema";
import { resolveTreemapConfig, treemapColumns } from "../src/spec/treemap";
import type { ChartSpec } from "../src/spec/types";

const TM = { chartType: "treemap", title: "T", xAxisType: "categorical", data: "d.csv" } as ChartSpec;
const errs = (s: unknown): string => validateSpec(s).errors.join("\n");

describe("treemap - structural validation", () => {
  it("accepts a minimal treemap", () => {
    expect(validateSpec(TM)).toEqual({ valid: true, errors: [] });
  });

  it("accepts every treemap option and allowed field", () => {
    const r = validateSpec({
      ...TM,
      subtitle: "s", note: "n", source: "src", tags: ["x"],
      columns: { x: "name", value: "amount", series: "group" },
      series_order: ["a"], series_colors: { a: "blue" }, series_labels: { a: "A" },
      value_format: { decimals: 0, prefix: "$" }, tooltip_decimals: 1,
      chrome: { tooltip: false },
      treemap: {
        label_value: "value", shading: "none", share_decimals: 3,
        tooltip: [{ column: "c", label: "C", format: { decimals: 1, suffix: " pp" } }, { column: "d" }],
      },
    });
    expect(r).toEqual({ valid: true, errors: [] });
  });

  it.each([
    ["legend", true], ["legendPosition", "top"], ["series_legend", true], ["value_prefix", "$"],
    ["value_suffix", "%"], ["annotations", { xAxis: [] }], ["overlays", []], ["x_axis_title", "Year"],
    ["yAxisPolicy", { min: 0 }], ["orientation", "horizontal"], ["small_multiples", {}],
    ["shading", []], ["projected_field", "p"], ["timeline", {}],
  ])("rejects %s on a treemap", (field, value) => {
    expect(errs({ ...TM, [field]: value })).toContain(`${field} is not supported on chartType "treemap"`);
  });

  it.each(["end", "category", "facet", "shape", "point_label", "section", "kind", "x0", "x1"])(
    "rejects columns.%s on a treemap",
    (role) => {
      expect(errs({ ...TM, columns: { [role]: "c" } })).toContain(`columns.${role} is not supported on chartType "treemap"`);
    },
  );

  it("rejects a non-categorical x axis", () => {
    expect(errs({ ...TM, xAxisType: "numeric" })).toContain(`chartType "treemap" requires xAxisType "categorical" (got "numeric")`);
  });

  it("rejects the treemap block on another chart type", () => {
    expect(errs({ chartType: "bar", title: "B", xAxisType: "categorical", data: "d.csv", treemap: {} })).toContain(
      `the treemap block is only valid on chartType "treemap"`,
    );
  });

  it("rejects an unknown label_value, shading, share_decimals out of range, and unknown keys", () => {
    expect(validateSpec({ ...TM, treemap: { label_value: "x" } }).valid).toBe(false);
    expect(validateSpec({ ...TM, treemap: { shading: "x" } }).valid).toBe(false);
    expect(validateSpec({ ...TM, treemap: { share_decimals: 4 } }).valid).toBe(false);
    expect(validateSpec({ ...TM, treemap: { share_decimals: -1 } }).valid).toBe(false);
    expect(validateSpec({ ...TM, treemap: { share_decimals: 1.5 } }).valid).toBe(false);
    expect(validateSpec({ ...TM, treemap: { rows: 2 } }).valid).toBe(false);
    expect(validateSpec({ ...TM, treemap: { tooltip: [{ label: "no column" }] } }).valid).toBe(false);
  });

  it("allows only chrome.tooltip inside chrome", () => {
    expect(errs({ ...TM, chrome: { valuePills: true } })).toContain(`chrome.valuePills is not supported on chartType "treemap"`);
    expect(validateSpec({ ...TM, chrome: { tooltip: false } })).toEqual({ valid: true, errors: [] });
  });

  it("classifies every chart schema property exactly once", () => {
    const props = Object.keys((CHART_SPEC_SCHEMA as { properties: Record<string, unknown> }).properties);
    const allowed = new Set(TREEMAP_ALLOWED_FIELDS);
    const rejected = new Set(TREEMAP_REJECTED_FIELDS);
    expect(props.filter((p) => !allowed.has(p) && !rejected.has(p))).toEqual([]);
    expect([...allowed].filter((p) => rejected.has(p))).toEqual([]);
    expect([...allowed, ...rejected].filter((p) => !props.includes(p))).toEqual([]);
  });
});

describe("treemap - config and columns", () => {
  it("applies defaults", () => {
    expect(resolveTreemapConfig(TM)).toEqual({ labelValue: "share", shading: "size", shareDecimals: 1, tooltip: [] });
  });

  it("honours authored options, including share_decimals 0", () => {
    const spec = { ...TM, treemap: { label_value: "none", shading: "none", share_decimals: 0, tooltip: [{ column: "c" }] } } as ChartSpec;
    expect(resolveTreemapConfig(spec)).toEqual({ labelValue: "none", shading: "none", shareDecimals: 0, tooltip: [{ column: "c" }] });
  });

  it("resolves name / value / group, group optional", () => {
    const flat = [{ time: "a", value: "1" }];
    expect(treemapColumns(TM, flat)).toEqual({ name: "time", value: "value", group: null });
    const spec = { ...TM, columns: { x: "n", value: "v", series: "g" } } as ChartSpec;
    expect(treemapColumns(spec, [{ n: "a", v: "1", g: "x" }])).toEqual({ name: "n", value: "v", group: "g" });
  });

  it("picks up a column named series when rows carry one, as other chart types do", () => {
    expect(treemapColumns(TM, [{ time: "a", value: "1", series: "g" }]).group).toBe("series");
    expect(treemapColumns(TM, [{ time: "a", value: "1" }]).group).toBeNull();
  });
});
