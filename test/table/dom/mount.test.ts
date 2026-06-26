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

  it("renders the footnote list OUTSIDE the scroll wrapper, before the source line (bug #1)", () => {
    const fnSpec: TableSpec = {
      ...SPEC,
      footnote_column: "fn",
      footnotes: { a: "Provisional estimate." },
    };
    const fnRows: TidyRow[] = [
      { row: "Revenue", metric: "2024", value: "4500", fn: "a" },
      { row: "Outlays", metric: "2024", value: "6100", fn: "" },
    ];
    const container = document.createElement("div");
    mountTable(container, { spec: fnSpec, rows: fnRows });
    const block = container.querySelector(".tbl-table-footnotes")!;
    // Not a descendant of the horizontal-scroll wrapper (so it doesn't scroll sideways).
    expect(block.closest(".figure-canvas-scroll")).toBeNull();
    // Sits directly after the scroll wrapper, before the source/meta line.
    const card = container.querySelector(".figure-card")!;
    const kids = Array.from(card.children);
    const scrollIdx = kids.findIndex((k) => k.classList.contains("figure-canvas-scroll"));
    const fnIdx = kids.indexOf(block as Element);
    const metaIdx = kids.findIndex((k) => k.classList.contains("figure-meta"));
    expect(fnIdx).toBe(scrollIdx + 1);
    expect(metaIdx).toBeGreaterThan(fnIdx);
  });

  it("adds tbl-table--header-tier-rules only when spec.header_tier_rules is true (5a)", () => {
    const off = document.createElement("div");
    mountTable(off, { spec: SPEC, rows: ROWS });
    expect(
      (off.querySelector("table.tbl-table") as HTMLElement).classList.contains(
        "tbl-table--header-tier-rules",
      ),
    ).toBe(false);

    const on = document.createElement("div");
    mountTable(on, { spec: { ...SPEC, header_tier_rules: true }, rows: ROWS });
    expect(
      (on.querySelector("table.tbl-table") as HTMLElement).classList.contains(
        "tbl-table--header-tier-rules",
      ),
    ).toBe(true);
  });
});

describe("mountTable — multi-pane", () => {
  const PANE_SPEC: TableSpec = {
    title: "Two Panes",
    data: "inline",
    pane: "section",
    pane_titles: { dist: "Distribution" },
    stub: [{ label: "row" }],
    header: ["metric"],
    value: "value",
    source: "CBO",
    format: { default: { type: "number", decimals: 1 } },
  };
  const PANE_ROWS: TidyRow[] = [
    { section: "budget", row: "Lower rates", metric: "2026", value: "1.2" },
    { section: "budget", row: "Lower rates", metric: "2027", value: "1.4" },
    { section: "dist", row: "Lower rates", metric: "Bottom", value: "2.1" },
    { section: "dist", row: "Lower rates", metric: "Top", value: "9.0" },
  ];

  it("renders one .tbl-pane per pane, each with its own table", () => {
    const c = document.createElement("div");
    mountTable(c, { spec: PANE_SPEC, rows: PANE_ROWS });
    const panes = c.querySelectorAll(".tbl-pane");
    expect(panes.length).toBe(2);
    panes.forEach((p) => expect(p.querySelector("table.tbl-table")).not.toBeNull());
  });

  it("shows a subheading per pane (pane_titles override, else the value)", () => {
    const c = document.createElement("div");
    mountTable(c, { spec: PANE_SPEC, rows: PANE_ROWS });
    const titles = Array.from(c.querySelectorAll(".tbl-pane-title")).map((t) => t.textContent);
    expect(titles).toEqual(["budget", "Distribution"]);
  });

  it("gives panes independent column headers", () => {
    const c = document.createElement("div");
    mountTable(c, { spec: PANE_SPEC, rows: PANE_ROWS });
    const tables = c.querySelectorAll("table.tbl-table");
    const heads = Array.from(tables).map((t) =>
      Array.from(t.querySelectorAll("thead th")).map((th) => th.textContent).join("|"),
    );
    expect(heads[0]).toContain("2026");
    expect(heads[1]).toContain("Bottom");
    expect(heads[1]).not.toContain("2026");
  });

  it("renders a single shared source line for the whole figure", () => {
    const c = document.createElement("div");
    mountTable(c, { spec: PANE_SPEC, rows: PANE_ROWS });
    expect(c.querySelectorAll(".figure-source").length).toBe(1);
  });
});
