// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { mountTable } from "../../../src/table/mount";
import type { TableSpec } from "../../../src/spec/table-types";
import type { TidyRow } from "../../../src/data/index";

// Two groups (North, South) with two rows each. A global sort by the "pop" column would
// interleave the groups (e.g. South's 10 < North's 20 < North's 40 < South's 50), so the
// test can prove rows never cross group boundaries.
const SPEC: TableSpec = {
  title: "Regions",
  data: "inline",
  stub: [{ label: "region" }, { label: "city" }],
  header: ["metric"],
  value: "value",
  sort: true,
  format: { default: { type: "number", decimals: 0 } },
};

const ROWS: TidyRow[] = [
  { region: "North", city: "Alpha", metric: "pop", value: "40" },
  { region: "North", city: "Beta", metric: "pop", value: "20" },
  { region: "South", city: "Gamma", metric: "pop", value: "50" },
  { region: "South", city: "Delta", metric: "pop", value: "10" },
];

/** Return the tbody children as a tagged sequence: "g:<label>" for group rows, the row label otherwise. */
function sequence(table: HTMLTableElement): string[] {
  const tbody = table.querySelector("tbody")!;
  return Array.from(tbody.children).map((tr) => {
    if (tr.classList.contains("tbl-table-group")) return `g:${tr.querySelector("th")?.textContent?.trim()}`;
    return tr.getAttribute("data-row") ?? "";
  });
}

function leafHeader(table: HTMLTableElement): HTMLTableCellElement {
  // Leaf header cells are the last header tier's data <th> (not the stub corner).
  const lastTier = Array.from(table.querySelectorAll("thead tr")).at(-1)!;
  const ths = Array.from(lastTier.querySelectorAll("th")).filter(
    (th) => !th.classList.contains("tbl-table-stub-header"),
  );
  return ths[0] as HTMLTableCellElement;
}

describe("table interactivity — sort", () => {
  it("cycles a column asc → desc → none within group boundaries", () => {
    const container = document.createElement("div");
    mountTable(container, { spec: SPEC, rows: ROWS });
    const table = container.querySelector("table.tbl-table") as HTMLTableElement;

    const original = sequence(table);
    expect(original).toEqual(["g:North", "Alpha", "Beta", "g:South", "Gamma", "Delta"]);

    const th = leafHeader(table);

    // First click: ascending within each group.
    th.click();
    expect(sequence(table)).toEqual(["g:North", "Beta", "Alpha", "g:South", "Delta", "Gamma"]);

    // Second click: descending within each group.
    th.click();
    expect(sequence(table)).toEqual(["g:North", "Alpha", "Beta", "g:South", "Gamma", "Delta"]);

    // Third click: back to original order.
    th.click();
    expect(sequence(table)).toEqual(original);
  });

  it("never moves rows across group boundaries (no global interleave)", () => {
    const container = document.createElement("div");
    mountTable(container, { spec: SPEC, rows: ROWS });
    const table = container.querySelector("table.tbl-table") as HTMLTableElement;
    const th = leafHeader(table);
    th.click(); // ascending

    const seq = sequence(table);
    const northIdx = seq.indexOf("g:North");
    const southIdx = seq.indexOf("g:South");
    // All North cities are between the two group headers; South cities come after South header.
    expect(seq.slice(northIdx + 1, southIdx)).toEqual(["Beta", "Alpha"]);
    expect(seq.slice(southIdx + 1)).toEqual(["Delta", "Gamma"]);
  });

  it("reflects sort state on the header via aria-sort", () => {
    const container = document.createElement("div");
    mountTable(container, { spec: SPEC, rows: ROWS });
    const table = container.querySelector("table.tbl-table") as HTMLTableElement;
    const th = leafHeader(table);

    expect(th.getAttribute("aria-sort")).toBeNull();
    th.click();
    expect(th.getAttribute("aria-sort")).toBe("ascending");
    th.click();
    expect(th.getAttribute("aria-sort")).toBe("descending");
    th.click();
    expect(th.getAttribute("aria-sort")).toBeNull();
  });

  it("does not make headers sortable when spec.sort is falsy", () => {
    const container = document.createElement("div");
    mountTable(container, { spec: { ...SPEC, sort: false }, rows: ROWS });
    const table = container.querySelector("table.tbl-table") as HTMLTableElement;
    const before = sequence(table);
    leafHeader(table).click();
    expect(sequence(table)).toEqual(before);
  });
});

describe("table interactivity — column hover", () => {
  it("toggles is-col-hover on all cells with the hovered column's data-col", () => {
    const container = document.createElement("div");
    mountTable(container, { spec: SPEC, rows: ROWS });
    const table = container.querySelector("table.tbl-table") as HTMLTableElement;

    const cells = Array.from(table.querySelectorAll('td[data-col="pop"]')) as HTMLTableCellElement[];
    expect(cells.length).toBe(4);

    const target = cells[0]!;
    target.dispatchEvent(new Event("pointerover", { bubbles: true }));
    for (const c of cells) expect(c.classList.contains("is-col-hover")).toBe(true);

    target.dispatchEvent(new Event("pointerout", { bubbles: true }));
    for (const c of cells) expect(c.classList.contains("is-col-hover")).toBe(false);
  });
});

describe("table interactivity — sticky", () => {
  it("adds tbl-table--sticky-first when spec.sticky.firstColumn", () => {
    const container = document.createElement("div");
    mountTable(container, { spec: { ...SPEC, sticky: { firstColumn: true } }, rows: ROWS });
    const table = container.querySelector("table.tbl-table") as HTMLTableElement;
    expect(table.classList.contains("tbl-table--sticky-first")).toBe(true);
  });

  it("does not add tbl-table--sticky-first by default", () => {
    const container = document.createElement("div");
    mountTable(container, { spec: SPEC, rows: ROWS });
    const table = container.querySelector("table.tbl-table") as HTMLTableElement;
    expect(table.classList.contains("tbl-table--sticky-first")).toBe(false);
  });

  // Real horizontal/vertical scroll clipping can't be exercised under jsdom (no layout), so
  // assert the structural hooks the sticky z-index ladder targets are present.
  it("exposes the structural hooks for the sticky column clip (corner + stub cells)", () => {
    const container = document.createElement("div");
    mountTable(container, { spec: { ...SPEC, sticky: { firstColumn: true } }, rows: ROWS });
    const table = container.querySelector("table.tbl-table") as HTMLTableElement;
    // Header corner cell the z-4 rule targets.
    expect(table.querySelector("thead th.tbl-table-stub-header")).not.toBeNull();
    // Body stub cells the z-3 rule targets.
    expect(table.querySelector("tbody th.tbl-table-stub")).not.toBeNull();
    // Sticky header thead cells (z-2) and group titles exist.
    expect(table.querySelector("thead th")).not.toBeNull();
    expect(table.querySelector("tbody tr.tbl-table-group th")).not.toBeNull();
  });

  it("sets --tbl-thead-h on the table for sticky group-title offset", () => {
    const container = document.createElement("div");
    mountTable(container, { spec: SPEC, rows: ROWS });
    const table = container.querySelector("table.tbl-table") as HTMLTableElement;
    // jsdom has no layout, so the measured height is 0px — but the property must be set.
    expect(table.style.getPropertyValue("--tbl-thead-h")).toBe("0px");
  });
});
