// No DOM needed — just asserts that key class/property strings appear in the CSS string.
import { describe, it, expect } from "vitest";
import { CHART_CSS } from "../../../src/embed/styles";

describe("CHART_CSS — table rules", () => {
  it("contains .tbl-table", () => {
    expect(CHART_CSS).toContain(".tbl-table");
  });

  it("contains .tbl-table-group", () => {
    expect(CHART_CSS).toContain(".tbl-table-group");
  });

  it("contains .tbl-table-stub", () => {
    expect(CHART_CSS).toContain(".tbl-table-stub");
  });

  it("contains .tbl-table-sublabel", () => {
    expect(CHART_CSS).toContain(".tbl-table-sublabel");
  });

  it("contains td.is-num", () => {
    expect(CHART_CSS).toContain("td.is-num");
  });

  it("contains position: sticky (header/first-col sticky)", () => {
    expect(CHART_CSS).toContain("position: sticky");
  });

  it("contains .is-col-hover (column hover hook)", () => {
    expect(CHART_CSS).toContain(".is-col-hover");
  });
});
