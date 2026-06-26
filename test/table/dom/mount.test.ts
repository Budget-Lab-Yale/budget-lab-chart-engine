// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mountTable } from "../../../src/table/mount";
import type { TableSpec } from "../../../src/spec/table-types";
import type { TidyRow } from "../../../src/data/index";

const SPEC: TableSpec = {
  title: "Test Table",
  subtitle: "Billions of dollars",
  data: "inline",
  stub: [{ label: "row" }],
  header: ["metric"],
  value: "value",
  source: "CBO",
  notes: "Preliminary figures.",
  format: { default: { type: "number", decimals: 1 } },
};

const ROWS: TidyRow[] = [
  { row: "Revenue", metric: "2024", value: "4500" },
  { row: "Revenue", metric: "2025", value: "4700" },
  { row: "Outlays", metric: "2024", value: "6100" },
  { row: "Outlays", metric: "2025", value: "6400" },
];

describe("mountTable", () => {
  it("appends a .figure-card into the container", () => {
    const container = document.createElement("div");
    mountTable(container, { spec: SPEC, rows: ROWS });
    expect(container.querySelector(".figure-card")).not.toBeNull();
  });

  it("renders the title text", () => {
    const container = document.createElement("div");
    mountTable(container, { spec: SPEC, rows: ROWS });
    const title = container.querySelector(".figure-title");
    expect(title).not.toBeNull();
    expect(title?.textContent).toBe("Test Table");
  });

  it("renders the subtitle text", () => {
    const container = document.createElement("div");
    mountTable(container, { spec: SPEC, rows: ROWS });
    const sub = container.querySelector(".figure-subtitle");
    expect(sub).not.toBeNull();
    expect(sub?.textContent).toBe("Billions of dollars");
  });

  it("renders a <table class='tbl-table'> inside the scroll wrapper", () => {
    const container = document.createElement("div");
    mountTable(container, { spec: SPEC, rows: ROWS });
    const table = container.querySelector(".figure-canvas-scroll table.tbl-table");
    expect(table).not.toBeNull();
  });

  it("renders a source line with the spec's source", () => {
    const container = document.createElement("div");
    mountTable(container, { spec: SPEC, rows: ROWS });
    const source = container.querySelector(".figure-source");
    expect(source).not.toBeNull();
    expect(source?.textContent).toContain("CBO");
  });

  it("renders the eyebrow when provided", () => {
    const container = document.createElement("div");
    mountTable(container, { spec: SPEC, rows: ROWS, eyebrow: "Table 2" });
    const eyebrow = container.querySelector(".figure-supertitle");
    expect(eyebrow).not.toBeNull();
    expect(eyebrow?.textContent).toBe("Table 2");
  });

  it("omits the eyebrow when not provided", () => {
    const container = document.createElement("div");
    mountTable(container, { spec: SPEC, rows: ROWS });
    expect(container.querySelector(".figure-supertitle")).toBeNull();
  });

  it("returns a teardown function", () => {
    const container = document.createElement("div");
    const teardown = mountTable(container, { spec: SPEC, rows: ROWS });
    expect(typeof teardown).toBe("function");
  });

  it("teardown removes the figure-card from the container", () => {
    const container = document.createElement("div");
    const teardown = mountTable(container, { spec: SPEC, rows: ROWS });
    expect(container.querySelector(".figure-card")).not.toBeNull();
    teardown();
    expect(container.querySelector(".figure-card")).toBeNull();
  });

  it("includes a Data (CSV) download button", () => {
    const container = document.createElement("div");
    mountTable(container, { spec: SPEC, rows: ROWS });
    const buttons = container.querySelectorAll(".figure-download-btn");
    // At least one button labelled "Data"
    const labels = Array.from(buttons).map((b) => b.textContent?.trim());
    expect(labels.some((l) => l?.includes("Data"))).toBe(true);
  });

  it("renders the footnote definition list below the table", () => {
    const fnSpec: TableSpec = {
      ...SPEC,
      footnote_column: "fn",
      footnotes: { a: "Provisional estimate." },
    };
    const fnRows: TidyRow[] = [
      { row: "Revenue", metric: "2024", value: "4500", fn: "a" },
      { row: "Revenue", metric: "2025", value: "4700", fn: "" },
      { row: "Outlays", metric: "2024", value: "6100", fn: "" },
      { row: "Outlays", metric: "2025", value: "6400", fn: "" },
    ];
    const container = document.createElement("div");
    mountTable(container, { spec: fnSpec, rows: fnRows });
    const block = container.querySelector(".tbl-table-footnotes");
    expect(block).not.toBeNull();
    expect(block?.querySelector("sup")?.textContent).toBe("a");
    expect(block?.textContent).toContain("Provisional estimate.");
  });

  it("omits the footnote list when the spec has no footnotes", () => {
    const container = document.createElement("div");
    mountTable(container, { spec: SPEC, rows: ROWS });
    expect(container.querySelector(".tbl-table-footnotes")).toBeNull();
  });
});
