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

  it("centers numeric body cells", () => {
    expect(CHART_CSS).toMatch(/td\.is-num\s*\{[^}]*text-align:\s*center/);
  });

  it("contains the banner spanner treatment (.is-spanner with inner-wrapper flanking rules)", () => {
    // The flanking-rule flex lives on an inner `.tbl-table-spanner` span, NOT the <th> itself
    // (display:flex on a table cell breaks colspan/column alignment).
    expect(CHART_CSS).toContain("th.is-spanner");
    expect(CHART_CSS).toContain(".tbl-table-spanner::before");
    expect(CHART_CSS).toContain(".tbl-table-spanner::after");
  });

  it("makes row-group titles sticky below the header block (--tbl-thead-h)", () => {
    expect(CHART_CSS).toContain("--tbl-thead-h");
    expect(CHART_CSS).toMatch(/tr\.tbl-table-group th\s*\{[^}]*position:\s*sticky/);
  });

  it("makes the header non-sticky under .tbl-table--no-sticky-header", () => {
    expect(CHART_CSS).toMatch(
      /\.tbl-table\.tbl-table--no-sticky-header thead th\s*\{[^}]*position:\s*static/,
    );
  });

  it("contains .tbl-table-footnotes (footnote list block)", () => {
    expect(CHART_CSS).toContain(".tbl-table-footnotes");
  });

  it("declares the sticky z-index ladder for the pinned first column", () => {
    // corner z 4, stub column z 3, thead z 2, body z 0.
    expect(CHART_CSS).toContain("z-index: 4");
    expect(CHART_CSS).toContain("z-index: 3");
  });
});
