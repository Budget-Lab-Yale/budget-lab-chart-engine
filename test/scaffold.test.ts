import { describe, it, expect } from "vitest";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

describe("scaffold", () => {
  it("ChartSpec contract accepts a minimal line spec", () => {
    const spec: ChartSpec = {
      chartType: "line",
      title: "Demo",
      xAxisType: "temporal",
      data: "data.csv",
    };
    expect(spec.chartType).toBe("line");
  });

  it("TidyRow has the required long-format columns", () => {
    const row: TidyRow = { time: "2026-01-01", series: "a", value: "1.0" };
    expect(row.series).toBe("a");
  });
});
