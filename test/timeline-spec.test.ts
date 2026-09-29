import { describe, it, expect } from "vitest";
import { validateSpec, TIMELINE_ALLOWED_FIELDS, TIMELINE_REJECTED_FIELDS } from "../src/spec/validate";
import { CHART_SPEC_SCHEMA } from "../src/spec/schema";
import type { ChartSpec } from "../src/spec/types";

const TL = { chartType: "timeline", title: "T", xAxisType: "temporal", data: "d.csv" } as ChartSpec;
const errs = (s: unknown): string => validateSpec(s).errors.join("\n");

describe("timeline — structural validation", () => {
  it("accepts a minimal timeline", () => {
    expect(validateSpec(TL)).toEqual({ valid: true, errors: [] });
  });

  it("accepts every timeline option and column role", () => {
    const r = validateSpec({
      ...TL,
      orientation: "horizontal",
      columns: { x: "date", end: "end", label: "t", description: "d", date_label: "dl", series: "kind" },
      series_order: ["a"], series_colors: { a: "navy" }, series_labels: { a: "A" },
      projected_field: "p", legend: true, series_legend: true, legendPosition: "top",
      color_legend_title: "Kind", x_axis_title: "Year", subtitle: "s", note: "n", source: "src", tags: ["x"],
      timeline: { spacing: "proportional", lanes: true, axis: true, date_format: "%Y", label_width: 150, max_rows: 2, auto_vertical: true },
    });
    expect(r).toEqual({ valid: true, errors: [] });
  });

  it("rejects a non-temporal x axis", () => {
    expect(errs({ ...TL, xAxisType: "numeric" })).toMatch(/chartType "timeline" requires xAxisType "temporal"/);
  });

  it("rejects an unknown timeline option (strict block)", () => {
    expect(validateSpec({ ...TL, timeline: { rows: 2 } }).valid).toBe(false);
  });

  it("rejects out-of-range label_width and max_rows", () => {
    expect(validateSpec({ ...TL, timeline: { label_width: 20 } }).valid).toBe(false);
    expect(validateSpec({ ...TL, timeline: { max_rows: 0 } }).valid).toBe(false);
  });

  it("accepts label_width 400 and max_rows 6, rejects 401 and 7", () => {
    expect(validateSpec({ ...TL, timeline: { label_width: 400, max_rows: 6 } })).toEqual({ valid: true, errors: [] });
    expect(validateSpec({ ...TL, timeline: { label_width: 401 } }).valid).toBe(false);
    expect(validateSpec({ ...TL, timeline: { max_rows: 7 } }).valid).toBe(false);
  });

  it("rejects axis with even spacing", () => {
    expect(errs({ ...TL, timeline: { axis: true, spacing: "even" } })).toMatch(/timeline\.axis cannot be used with timeline\.spacing "even"/);
  });

  it("rejects lanes on a vertical timeline", () => {
    expect(errs({ ...TL, orientation: "vertical", timeline: { lanes: true } })).toMatch(/timeline\.lanes is horizontal only/);
  });

  it("rejects x_axis_title without timeline.axis, accepts it with", () => {
    expect(errs({ ...TL, x_axis_title: "Year" })).toMatch(/x_axis_title on a timeline requires timeline\.axis: true/);
    expect(validateSpec({ ...TL, x_axis_title: "Year", timeline: { axis: true } }).valid).toBe(true);
  });

  it.each([
    ["annotations", { xAxis: [] }],
    ["overlays", []],
    ["small_multiples", {}],
    ["value_suffix", "%"],
    ["tooltip_decimals", 1],
    ["projected_style", { dashed: false }],
    ["chrome", { tooltip: false }],
    ["series_styles", {}],
    ["dot_radius", 5],
    ["yAxisPolicy", { min: 0 }],
  ])("rejects %s on a timeline", (field, value) => {
    expect(errs({ ...TL, [field]: value })).toContain(`${field} is not supported on chartType "timeline"`);
  });

  it.each(["value", "facet", "shape", "point_label", "section", "kind", "x0", "x1", "category"])(
    "rejects columns.%s on a timeline",
    (role) => {
      expect(errs({ ...TL, columns: { [role]: "c" } })).toContain(`columns.${role} is not supported on chartType "timeline"`);
    },
  );

  it("classifies every chart schema property exactly once", () => {
    const props = Object.keys((CHART_SPEC_SCHEMA as { properties: Record<string, unknown> }).properties);
    const allowed = new Set(TIMELINE_ALLOWED_FIELDS);
    const rejected = new Set(TIMELINE_REJECTED_FIELDS);
    expect(props.filter((p) => !allowed.has(p) && !rejected.has(p))).toEqual([]);
    expect([...allowed].filter((p) => rejected.has(p))).toEqual([]);
  });
});

describe("timeline-only fields on other chart types", () => {
  const LINE = { chartType: "line", title: "L", xAxisType: "temporal", data: "d.csv" };
  it.each(["end", "label", "description", "date_label"])("rejects columns.%s off a timeline", (role) => {
    expect(errs({ ...LINE, columns: { [role]: "c" } })).toContain(`columns.${role} is only valid on chartType "timeline"`);
  });
  it("rejects the timeline block off a timeline", () => {
    expect(errs({ ...LINE, timeline: {} })).toContain(`the timeline block is only valid on chartType "timeline"`);
  });
});
