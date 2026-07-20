import { describe, it, expect } from "vitest";
import { resolveColumns, isPreBinned } from "../src/spec/columns";
import type { ChartSpec } from "../src/spec/types";

const spec = (columns: any) => ({ chartType: "histogram", title: "H", xAxisType: "numeric", data: "d", columns } as unknown as ChartSpec);

describe("histogram column resolution", () => {
  it("resolves x0/x1 roles", () => {
    const c = resolveColumns(spec({ x0: "lo", x1: "hi", value: "n" }));
    expect(c.x0).toBe("lo"); expect(c.x1).toBe("hi");
  });
  it("isPreBinned true only when both edges are present", () => {
    expect(isPreBinned(resolveColumns(spec({ x0: "lo", x1: "hi" })))).toBe(true);
    expect(isPreBinned(resolveColumns(spec({ x: "amount" })))).toBe(false);
  });
});
