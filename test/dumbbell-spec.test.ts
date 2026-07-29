import { describe, it, expect } from "vitest";
import { validateSpec } from "../src/spec/validate";
import { resolveColumns, categoryOrderFor } from "../src/spec/columns";
import type { ChartSpec } from "../src/spec/types";

// A minimal valid dumbbell spec. The categorical axis is declared via xAxisType (as bars do);
// `orientation` decides whether categories render on screen-y (horizontal) or screen-x (vertical).
const DUMBBELL: ChartSpec = {
  chartType: "dumbbell",
  title: "Effective rate by group",
  xAxisType: "categorical",
  orientation: "horizontal",
  columns: { category: "group", series: "measure", value: "rate" },
  data: "d.csv",
} as ChartSpec;

describe("dumbbell — structural validation", () => {
  it("accepts a horizontal dumbbell with categorical xAxisType", () => {
    expect(validateSpec(DUMBBELL).valid).toBe(true);
  });

  it("accepts a vertical dumbbell", () => {
    expect(validateSpec({ ...DUMBBELL, orientation: "vertical" }).valid).toBe(true);
  });

  it("rejects a dumbbell whose xAxisType is not categorical", () => {
    const r = validateSpec({ ...DUMBBELL, xAxisType: "numeric" });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/dumbbell.*requires xAxisType "categorical"/);
  });

  it("accepts the dumbbell-specific config fields", () => {
    const r = validateSpec({
      ...DUMBBELL,
      series_marker: { current_law: "ink", static: "hollow", collected: "filled" },
      connector: { color: "border", width: 1.5, style: "solid" },
      dot_radius: 5,
      gap_annotation: { series_a: "static", series_b: "collected" },
      value_axis_title: "Effective tax rate",
      value_format: { decimals: 1, suffix: "%" },
    });
    expect(r.valid).toBe(true);
  });

  it("accepts gap_annotation as a bare boolean", () => {
    expect(validateSpec({ ...DUMBBELL, gap_annotation: true }).valid).toBe(true);
  });

  it("rejects an unknown series_marker style", () => {
    const r = validateSpec({ ...DUMBBELL, series_marker: { static: "outline" } });
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/series_marker|filled|hollow|ink/);
  });

  it("rejects an unknown top-level property (strict schema)", () => {
    expect(validateSpec({ ...DUMBBELL, dumbell_typo: 1 }).valid).toBe(false);
  });
});

describe("dumbbell — column aliasing", () => {
  it("resolves columns.category onto the categorical x field", () => {
    const c = resolveColumns(DUMBBELL);
    expect(c.x).toBe("group");
    expect(c.value).toBe("rate");
    expect(c.series).toBe("measure");
  });

  it("columns.x still works and columns.category wins when both are set", () => {
    expect(resolveColumns({ ...DUMBBELL, columns: { x: "plain" } } as ChartSpec).x).toBe("plain");
    expect(
      resolveColumns({ ...DUMBBELL, columns: { category: "cat", x: "plain" } } as ChartSpec).x,
    ).toBe("cat");
  });

  it("categoryOrderFor aliases category_order to x_order", () => {
    expect(categoryOrderFor({ category_order: ["Q1", "Q2"] } as ChartSpec)).toEqual(["Q1", "Q2"]);
    expect(categoryOrderFor({ x_order: ["A", "B"] } as ChartSpec)).toEqual(["A", "B"]);
    // category_order wins when both are present.
    expect(
      categoryOrderFor({ category_order: ["c"], x_order: ["x"] } as ChartSpec),
    ).toEqual(["c"]);
    expect(categoryOrderFor({} as ChartSpec)).toBeUndefined();
  });
});
