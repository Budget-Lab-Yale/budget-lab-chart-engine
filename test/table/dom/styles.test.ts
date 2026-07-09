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

  it("contains position: sticky (first-column sticky)", () => {
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

  it("pins the group title at the left during horizontal scroll (sticky-first only)", () => {
    expect(CHART_CSS).toMatch(
      /\.tbl-table--sticky-first \.tbl-table-group-inner\s*\{[^}]*position:\s*sticky/,
    );
  });

  it("contains .tbl-table-footnotes (footnote list block)", () => {
    expect(CHART_CSS).toContain(".tbl-table-footnotes");
  });

  it("declares the sticky z-index ladder for the pinned first column", () => {
    // corner z 4, stub column z 3, body z 0.
    expect(CHART_CSS).toContain("z-index: 4");
    expect(CHART_CSS).toContain("z-index: 3");
  });

  it("bolds an emphasized stub cell (th.tbl-table-stub.is-emphasis beats the plain stub's font-weight)", () => {
    // th.tbl-table-stub (0,1,1) otherwise outranks .is-emphasis (0,1,0) on font-weight, so an
    // emphasized row's stub would stay at the plain weight despite the .is-emphasis class.
    expect(CHART_CSS).toMatch(/th\.tbl-table-stub\.is-emphasis\s*\{[^}]*font-weight:\s*var\(--tw-bold\)/);
  });

  it("puts the header→body bottom rule on the bottom-tier th AND the stub corner (bug #4)", () => {
    expect(CHART_CSS).toMatch(
      /thead tr:last-child th,\s*\.tbl-table thead th\.tbl-table-stub-header\s*\{[^}]*border-bottom/,
    );
  });

  it("gates inter-tier header rules behind .tbl-table--header-tier-rules (5a)", () => {
    expect(CHART_CSS).toContain(".tbl-table--header-tier-rules thead tr:not(:last-child) th");
  });

  it("contains the header_max_lines clamp hook (5c)", () => {
    expect(CHART_CSS).toContain("tbl-table-header-clamp");
    expect(CHART_CSS).toContain("-webkit-line-clamp");
  });

  it("contains the stub_nowrap hook (5c)", () => {
    expect(CHART_CSS).toMatch(/\.tbl-table-stub\.is-nowrap[\s\S]*white-space:\s*nowrap/);
  });

  it("contains the collapsible group-toggle button styling (Task 4)", () => {
    expect(CHART_CSS).toContain(".tbl-table-group-toggle");
    // No button chrome: inline-flex, inherited font, pointer cursor.
    expect(CHART_CSS).toMatch(/\.tbl-table-group-toggle\s*\{[^}]*display:\s*inline-flex/);
    expect(CHART_CSS).toMatch(/\.tbl-table-group-toggle\s*\{[^}]*font:\s*inherit/);
    expect(CHART_CSS).toMatch(/\.tbl-table-group-toggle\s*\{[^}]*cursor:\s*pointer/);
  });

  it("contains the caret with rotation keyed on aria-expanded (Task 4)", () => {
    expect(CHART_CSS).toContain(".tbl-table-caret");
    expect(CHART_CSS).toMatch(
      /\.tbl-table-group-toggle\[aria-expanded="true"\] \.tbl-table-caret\s*\{[^}]*rotate\(90deg\)/,
    );
  });

  it("hides collapsed rows via the hidden attribute (Task 4)", () => {
    expect(CHART_CSS).toMatch(/\.tbl-table tr\[hidden\]\s*\{\s*display:\s*none/);
  });
});
