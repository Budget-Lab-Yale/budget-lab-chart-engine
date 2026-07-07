// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { mountTable } from "../../../src/table/mount";
import { buildTableModel } from "../../../src/table/model";
import { layoutTable } from "../../../src/table/layout";
import { renderTableHtml } from "../../../src/table/render-html";
import type { TableSpec } from "../../../src/spec/table-types";
import type { TidyRow } from "../../../src/data/index";

function measureText(s: string, _fontPx: number, _weight: number) { return s.length * 7; }

// Two flat (level-0) groups, two rows each.
const SPEC: TableSpec = {
  title: "Collapsible", data: "inline",
  stub: ["country", { label: "scenario" }],
  header: ["metric"],
  value: "value",
  collapsible: { default: "expanded" },
};
const ROWS: TidyRow[] = [
  { country: "China", scenario: "base", metric: "rate", value: "10" },
  { country: "China", scenario: "reform", metric: "rate", value: "8" },
  { country: "Canada", scenario: "base", metric: "rate", value: "6" },
  { country: "Canada", scenario: "reform", metric: "rate", value: "5" },
];

// Nested: region > country > row, so collapsing a region must hide its child country header too.
const NESTED_SPEC: TableSpec = {
  title: "Nested", data: "inline",
  stub: ["region", "country", { label: "row" }],
  header: ["metric"],
  value: "value",
  collapsible: {},
};
const NESTED_ROWS: TidyRow[] = [
  { region: "Americas", country: "US", row: "r1", metric: "m", value: "1" },
  { region: "Americas", country: "CA", row: "r2", metric: "m", value: "2" },
  { region: "Asia", country: "JP", row: "r3", metric: "m", value: "3" },
];

function groupTr(table: HTMLTableElement, label: string): HTMLTableRowElement {
  return Array.from(table.querySelectorAll("tr.tbl-table-group")).find((tr) => {
    // Collapsible markup wraps the label in .tbl-table-group-label; plain markup puts it in the <th>.
    const labelEl = tr.querySelector(".tbl-table-group-label") ?? tr.querySelector("th");
    return labelEl?.textContent?.trim() === label;
  }) as HTMLTableRowElement;
}

describe("collapsible groups — markup (render-html)", () => {
  it("renders a toggle button + caret + aria-expanded when spec.collapsible is set", () => {
    const model = buildTableModel(SPEC, ROWS);
    const layout = layoutTable(model, { width: 600, measureText });
    const table = renderTableHtml(model, layout, document, SPEC);
    const btn = table.querySelector("tr.tbl-table-group button.tbl-table-group-toggle") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute("type")).toBe("button");
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(btn.querySelector(".tbl-table-caret")).not.toBeNull();
    expect(btn.querySelector(".tbl-table-caret")?.getAttribute("aria-hidden")).toBe("true");
    expect(btn.querySelector(".tbl-table-group-label")?.textContent).toBe("China");
  });

  it("group <tr> carries data-group-key and data-group-parents; data rows carry data-group-parents", () => {
    const model = buildTableModel(SPEC, ROWS);
    const layout = layoutTable(model, { width: 600, measureText });
    const table = renderTableHtml(model, layout, document, SPEC);
    const gtr = groupTr(table, "China");
    expect(gtr.getAttribute("data-group-key")).toBe("China");
    expect(gtr.getAttribute("data-group-parents")).toBe("");
    const dataRow = table.querySelector('tbody tr[data-row="base"]')!;
    expect(dataRow.getAttribute("data-group-parents")).toBe("China");
  });

  it("non-collapsible spec renders NO toggle buttons (plain group labels)", () => {
    const plainSpec: TableSpec = { ...SPEC, collapsible: undefined };
    const model = buildTableModel(plainSpec, ROWS);
    const layout = layoutTable(model, { width: 600, measureText });
    const table = renderTableHtml(model, layout, document, plainSpec);
    expect(table.querySelector("button.tbl-table-group-toggle")).toBeNull();
    // Group label text is still present, just not wrapped in a button.
    const gtr = groupTr(table, "China");
    expect(gtr.textContent).toContain("China");
    // data-group-key/parents are still present regardless (cheap, always emitted).
    expect(gtr.getAttribute("data-group-key")).toBe("China");
  });
});

describe("collapsible groups — mount interactivity", () => {
  it("clicking a group's toggle hides its descendant rows via the hidden attribute", () => {
    const container = document.createElement("div");
    mountTable(container, { spec: SPEC, rows: ROWS });
    const table = container.querySelector("table.tbl-table") as HTMLTableElement;
    const chinaBtn = groupTr(table, "China").querySelector("button.tbl-table-group-toggle") as HTMLButtonElement;
    const chinaRow = table.querySelector('tbody tr[data-row="base"]') as HTMLTableRowElement;

    expect(chinaRow.hidden).toBe(false);
    chinaBtn.click();
    expect(chinaRow.hidden).toBe(true);
    expect(chinaBtn.getAttribute("aria-expanded")).toBe("false");

    chinaBtn.click();
    expect(chinaRow.hidden).toBe(false);
    expect(chinaBtn.getAttribute("aria-expanded")).toBe("true");
  });

  it("does not hide rows belonging to a different group", () => {
    const container = document.createElement("div");
    mountTable(container, { spec: SPEC, rows: ROWS });
    const table = container.querySelector("table.tbl-table") as HTMLTableElement;
    const chinaBtn = groupTr(table, "China").querySelector("button.tbl-table-group-toggle") as HTMLButtonElement;
    chinaBtn.click();
    const canadaRows = table.querySelectorAll('tbody tr[data-group-parents="Canada"]');
    canadaRows.forEach((tr) => expect((tr as HTMLTableRowElement).hidden).toBe(false));
  });

  it("collapsing a nested parent group hides the whole subtree, including the child group header", () => {
    const container = document.createElement("div");
    mountTable(container, { spec: NESTED_SPEC, rows: NESTED_ROWS });
    const table = container.querySelector("table.tbl-table") as HTMLTableElement;
    const americasBtn = groupTr(table, "Americas").querySelector("button.tbl-table-group-toggle") as HTMLButtonElement;
    americasBtn.click();

    const usGroupTr = groupTr(table, "US");
    expect(usGroupTr.hidden).toBe(true);
    const r1 = table.querySelector('tbody tr[data-row="r1"]') as HTMLTableRowElement;
    expect(r1.hidden).toBe(true);

    // Asia's subtree is untouched.
    const asiaRow = table.querySelector('tbody tr[data-row="r3"]') as HTMLTableRowElement;
    expect(asiaRow.hidden).toBe(false);
  });

  it("expand/collapse-all toggles every group at once", () => {
    const container = document.createElement("div");
    mountTable(container, { spec: SPEC, rows: ROWS });
    const table = container.querySelector("table.tbl-table") as HTMLTableElement;
    const allBtn = container.querySelector(".tbl-table-collapse-all") as HTMLButtonElement;
    expect(allBtn).not.toBeNull();
    expect(allBtn.textContent).toBe("Collapse all");

    allBtn.click();
    const dataRows = Array.from(table.querySelectorAll("tbody tr:not(.tbl-table-group)")) as HTMLTableRowElement[];
    expect(dataRows.every((tr) => tr.hidden)).toBe(true);
    expect(allBtn.textContent).toBe("Expand all");

    allBtn.click();
    expect(dataRows.every((tr) => !tr.hidden)).toBe(true);
    expect(allBtn.textContent).toBe("Collapse all");
  });

  it("does not render the expand/collapse-all control when spec has no collapsible", () => {
    const container = document.createElement("div");
    mountTable(container, { spec: { ...SPEC, collapsible: undefined }, rows: ROWS });
    expect(container.querySelector(".tbl-table-collapse-all")).toBeNull();
  });
});

describe("collapsible groups — persists across the ResizeObserver re-render", () => {
  afterEach(() => { delete (globalThis as any).ResizeObserver; });

  it("keeps a collapsed group hidden after a simulated resize re-render", () => {
    let roCallback: (() => void) | undefined;
    class FakeResizeObserver {
      constructor(cb: () => void) { roCallback = cb; }
      observe(): void {}
      disconnect(): void {}
    }
    (globalThis as any).ResizeObserver = FakeResizeObserver;

    const container = document.createElement("div");
    mountTable(container, { spec: SPEC, rows: ROWS });
    const card = container.querySelector(".figure-card") as HTMLElement;
    Object.defineProperty(card, "clientWidth", { value: 500, configurable: true });

    let table = container.querySelector("table.tbl-table") as HTMLTableElement;
    const chinaBtn = groupTr(table, "China").querySelector("button.tbl-table-group-toggle") as HTMLButtonElement;
    chinaBtn.click();
    expect((table.querySelector('tbody tr[data-row="base"]') as HTMLTableRowElement).hidden).toBe(true);

    // Simulate the engine's own resize re-render, which replaces the table DOM.
    expect(roCallback).toBeDefined();
    roCallback!();

    // The table element was replaced; re-query it, then confirm collapse state survived.
    table = container.querySelector("table.tbl-table") as HTMLTableElement;
    const chinaRowAfter = table.querySelector('tbody tr[data-row="base"]') as HTMLTableRowElement;
    expect(chinaRowAfter.hidden).toBe(true);
    const chinaBtnAfter = groupTr(table, "China").querySelector("button.tbl-table-group-toggle") as HTMLButtonElement;
    expect(chinaBtnAfter.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("collapsible groups — sort re-apply", () => {
  it("keeps a collapsed group's rows hidden after a column sort reorders the tbody", () => {
    const sortSpec: TableSpec = { ...SPEC, sort: true };
    const container = document.createElement("div");
    mountTable(container, { spec: sortSpec, rows: ROWS });
    const table = container.querySelector("table.tbl-table") as HTMLTableElement;
    const chinaBtn = groupTr(table, "China").querySelector("button.tbl-table-group-toggle") as HTMLButtonElement;
    chinaBtn.click();

    const leafHeader = Array.from(table.querySelectorAll("thead tr:last-child th")).find(
      (th) => !th.classList.contains("tbl-table-stub-header"),
    ) as HTMLTableCellElement;
    leafHeader.click(); // trigger the sort's DOM reorder

    const chinaRow = table.querySelector('tbody tr[data-row="base"]') as HTMLTableRowElement;
    expect(chinaRow.hidden).toBe(true);
  });
});
