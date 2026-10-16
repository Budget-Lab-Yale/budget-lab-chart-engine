// @vitest-environment jsdom
// Table sort: row identity (B3), sort surviving the card ResizeObserver re-render (B4), and the
// sortable-header a11y shape (aria-sort on a th that keeps its columnheader role).
import { describe, it, expect, afterEach } from "vitest";
import { mountTable } from "../../../src/table/mount";
import type { TableSpec } from "../../../src/spec/table-types";
import type { TidyRow } from "../../../src/data/index";

// Codex repro: the leaf labels A and B repeat across groups, and each group's values order the
// rows differently (G1: A<B, G2: B<A).
const SPEC: TableSpec = {
  title: "Repeated labels",
  data: "inline",
  stub: [{ label: "group" }, { label: "item" }],
  header: ["metric"],
  value: "v",
  sort: true,
  format: { default: { type: "number", decimals: 0 } },
};
const ROWS: TidyRow[] = [
  { group: "G1", item: "A", metric: "Value", v: "1" },
  { group: "G1", item: "B", metric: "Value", v: "2" },
  { group: "G2", item: "A", metric: "Value", v: "20" },
  { group: "G2", item: "B", metric: "Value", v: "10" },
];

/** tbody as "g:<label>" for group rows and "<label>=<value cell text>" for data rows. */
function sequence(table: HTMLTableElement): string[] {
  return Array.from(table.querySelector("tbody")!.children).map((tr) => {
    if (tr.classList.contains("tbl-table-group")) {
      const label = tr.querySelector(".tbl-table-group-label") ?? tr.querySelector("th");
      return `g:${label?.textContent?.trim()}`;
    }
    return `${tr.getAttribute("data-row")}=${tr.querySelector("td")?.textContent?.trim()}`;
  });
}

function leafHeader(table: HTMLTableElement): HTMLTableCellElement {
  const lastTier = Array.from(table.querySelectorAll("thead tr")).at(-1)!;
  return Array.from(lastTier.querySelectorAll("th")).find(
    (th) => !th.classList.contains("tbl-table-stub-header"),
  ) as HTMLTableCellElement;
}

function groupToggle(table: HTMLTableElement, label: string): HTMLButtonElement {
  const tr = Array.from(table.querySelectorAll("tr.tbl-table-group")).find(
    (g) => g.querySelector(".tbl-table-group-label")?.textContent?.trim() === label,
  )!;
  return tr.querySelector("button.tbl-table-group-toggle") as HTMLButtonElement;
}

// ---- Harness for the card ResizeObserver and the canvas measurer (both absent in jsdom). ----
let roCallbacks: Array<() => void> = [];
let measureScale = 7;
const realGetContext = HTMLCanvasElement.prototype.getContext;

/** Install a fake ResizeObserver (callbacks captured) and a canvas measurer whose glyph width is
 *  `measureScale`, so a test can make a re-render produce a different layout (a real rebuild). */
function installHarness(): void {
  roCallbacks = [];
  measureScale = 7;
  (globalThis as any).ResizeObserver = class {
    constructor(cb: () => void) { roCallbacks.push(cb); }
    observe(): void {}
    disconnect(): void {}
  };
  (HTMLCanvasElement.prototype as any).getContext = function () {
    return { font: "", measureText: (s: string) => ({ width: s.length * measureScale }) };
  };
}

/** Fire the CARD observer (mountTable's first ResizeObserver) with a measurable card width. */
function fireCardResize(container: HTMLElement): void {
  const card = container.querySelector(".figure-card") as HTMLElement;
  Object.defineProperty(card, "clientWidth", { value: 500, configurable: true });
  roCallbacks[0]!();
}

afterEach(() => {
  delete (globalThis as any).ResizeObserver;
  HTMLCanvasElement.prototype.getContext = realGetContext;
});

describe("table sort — row identity (B3)", () => {
  it("sorts each group on its own rows' values when leaf labels repeat across groups", () => {
    const container = document.createElement("div");
    mountTable(container, { spec: SPEC, rows: ROWS });
    const table = container.querySelector("table.tbl-table") as HTMLTableElement;
    expect(sequence(table)).toEqual(["g:G1", "A=1", "B=2", "g:G2", "A=20", "B=10"]);

    leafHeader(table).click(); // ascending
    expect(sequence(table)).toEqual(["g:G1", "A=1", "B=2", "g:G2", "B=10", "A=20"]);

    leafHeader(table).click(); // descending
    expect(sequence(table)).toEqual(["g:G1", "B=2", "A=1", "g:G2", "A=20", "B=10"]);
  });

  it("sorts each pane's groups on their own values in a multi-pane table", () => {
    const paneSpec: TableSpec = { ...SPEC, pane: "section" };
    const paneRows: TidyRow[] = [
      ...ROWS.map((r) => ({ ...r, section: "P1" })),
      ...ROWS.map((r) => ({ ...r, section: "P2", v: String(100 - Number(r.v)) })),
    ];
    const container = document.createElement("div");
    mountTable(container, { spec: paneSpec, rows: paneRows });
    const [t1, t2] = Array.from(container.querySelectorAll("table.tbl-table")) as HTMLTableElement[];

    leafHeader(t1!).click();
    expect(sequence(t1!)).toEqual(["g:G1", "A=1", "B=2", "g:G2", "B=10", "A=20"]);
    leafHeader(t2!).click();
    // P2 values: G1 A=99 B=98, G2 A=80 B=90.
    expect(sequence(t2!)).toEqual(["g:G1", "B=98", "A=99", "g:G2", "A=80", "B=90"]);
  });
});

describe("table sort — survives the card re-render (B4)", () => {
  const COLLAPSIBLE: TableSpec = { ...SPEC, collapsible: { default: "expanded" } };

  it("keeps the sort when a re-render rebuilds the table (layout changed)", () => {
    installHarness();
    const container = document.createElement("div");
    mountTable(container, { spec: COLLAPSIBLE, rows: ROWS });
    const before = container.querySelector("table.tbl-table") as HTMLTableElement;
    leafHeader(before).click(); // ascending

    measureScale = 9; // e.g. the webfont arrived: the next draw measures differently
    fireCardResize(container);

    const after = container.querySelector("table.tbl-table") as HTMLTableElement;
    expect(after).not.toBe(before); // a real rebuild happened
    expect(sequence(after)).toEqual(["g:G1", "A=1", "B=2", "g:G2", "B=10", "A=20"]);
    expect(leafHeader(after).getAttribute("aria-sort")).toBe("ascending");
    expect(leafHeader(after).classList.contains("is-sorted-asc")).toBe(true);

    // The carried state keeps cycling from where it was: asc -> desc.
    leafHeader(after).click();
    expect(sequence(after)).toEqual(["g:G1", "B=2", "A=1", "g:G2", "A=20", "B=10"]);
  });

  it("keeps the sort after collapsing and expanding a group", () => {
    installHarness();
    const container = document.createElement("div");
    mountTable(container, { spec: COLLAPSIBLE, rows: ROWS });
    let table = container.querySelector("table.tbl-table") as HTMLTableElement;
    leafHeader(table).click(); // ascending

    // Collapse G2: the card shrinks, so the observer fires. Measurement also shifts, forcing a
    // rebuild, so this exercises the carried state rather than the no-op skip.
    groupToggle(table, "G2").click();
    measureScale = 8;
    fireCardResize(container);
    table = container.querySelector("table.tbl-table") as HTMLTableElement;
    expect(sequence(table)).toEqual(["g:G1", "A=1", "B=2", "g:G2", "B=10", "A=20"]);

    // Expand it again: same.
    groupToggle(table, "G2").click();
    measureScale = 9;
    fireCardResize(container);
    table = container.querySelector("table.tbl-table") as HTMLTableElement;
    expect(sequence(table)).toEqual(["g:G1", "A=1", "B=2", "g:G2", "B=10", "A=20"]);
    expect(leafHeader(table).getAttribute("aria-sort")).toBe("ascending");
    const g2Rows = Array.from(table.querySelectorAll("tbody tr[data-row]")).slice(2) as HTMLTableRowElement[];
    expect(g2Rows.every((tr) => !tr.hidden)).toBe(true);
  });

  it("does not rebuild the table when a re-render would reproduce it (collapse changes height only)", () => {
    installHarness();
    const container = document.createElement("div");
    mountTable(container, { spec: COLLAPSIBLE, rows: ROWS });
    const before = container.querySelector("table.tbl-table") as HTMLTableElement;
    leafHeader(before).click();
    groupToggle(before, "G2").click();

    fireCardResize(container); // same measurement: identical layout

    // Same element: the toggle the user just pressed keeps focus, and no state is rebuilt.
    const after = container.querySelector("table.tbl-table") as HTMLTableElement;
    expect(after).toBe(before);
    expect(sequence(after)).toEqual(["g:G1", "A=1", "B=2", "g:G2", "B=10", "A=20"]);
  });

  it("keeps each pane's sort when a multi-pane table rebuilds", () => {
    installHarness();
    const paneSpec: TableSpec = { ...COLLAPSIBLE, pane: "section" };
    const paneRows: TidyRow[] = [
      ...ROWS.map((r) => ({ ...r, section: "P1" })),
      ...ROWS.map((r) => ({ ...r, section: "P2" })),
    ];
    const container = document.createElement("div");
    mountTable(container, { spec: paneSpec, rows: paneRows });
    const [t1] = Array.from(container.querySelectorAll("table.tbl-table")) as HTMLTableElement[];
    leafHeader(t1!).click(); // pane 1 ascending; pane 2 untouched

    measureScale = 9;
    fireCardResize(container);

    const [a1, a2] = Array.from(container.querySelectorAll("table.tbl-table")) as HTMLTableElement[];
    expect(a1).not.toBe(t1);
    expect(sequence(a1!)).toEqual(["g:G1", "A=1", "B=2", "g:G2", "B=10", "A=20"]);
    expect(leafHeader(a1!).getAttribute("aria-sort")).toBe("ascending");
    expect(sequence(a2!)).toEqual(["g:G1", "A=1", "B=2", "g:G2", "A=20", "B=10"]);
    expect(leafHeader(a2!).getAttribute("aria-sort")).toBeNull();
  });

  it("does not rebuild a multi-pane table when the layout is unchanged", () => {
    installHarness();
    const paneSpec: TableSpec = { ...COLLAPSIBLE, pane: "section" };
    const paneRows: TidyRow[] = [
      ...ROWS.map((r) => ({ ...r, section: "P1" })),
      ...ROWS.map((r) => ({ ...r, section: "P2" })),
    ];
    const container = document.createElement("div");
    mountTable(container, { spec: paneSpec, rows: paneRows });
    const before = Array.from(container.querySelectorAll("table.tbl-table"));
    fireCardResize(container);
    const after = Array.from(container.querySelectorAll("table.tbl-table"));
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
  });
});

describe("table sort — header semantics", () => {
  it("keeps the th a columnheader carrying aria-sort, with activation on an inner button", () => {
    const container = document.createElement("div");
    mountTable(container, { spec: SPEC, rows: ROWS });
    const table = container.querySelector("table.tbl-table") as HTMLTableElement;
    const th = leafHeader(table);

    // role="button" on the th would replace the columnheader role and void aria-sort.
    expect(th.hasAttribute("role")).toBe(false);
    expect(th.hasAttribute("tabindex")).toBe(false);
    const btn = th.querySelector("button.tbl-table-sort-btn") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.type).toBe("button");
    expect(btn.textContent).toBe("Value");

    btn.click(); // keyboard Enter/Space on a native button dispatches this click
    expect(th.getAttribute("aria-sort")).toBe("ascending");
    expect(btn.hasAttribute("aria-sort")).toBe(false);
    expect(sequence(table)).toEqual(["g:G1", "A=1", "B=2", "g:G2", "B=10", "A=20"]);
  });

  it("wraps the sublabel in the button too, so the whole header label activates the sort", () => {
    const container = document.createElement("div");
    mountTable(container, { spec: { ...SPEC, sublabels: { Value: "dollars" } } as TableSpec, rows: ROWS });
    const th = leafHeader(container.querySelector("table.tbl-table") as HTMLTableElement);
    const btn = th.querySelector("button.tbl-table-sort-btn")!;
    expect(btn.querySelector(".tbl-table-sublabel")?.textContent).toBe("dollars");
    expect(th.children.length).toBe(1);
  });

  it("adds no button when spec.sort is falsy", () => {
    const container = document.createElement("div");
    mountTable(container, { spec: { ...SPEC, sort: false }, rows: ROWS });
    expect(container.querySelector("button.tbl-table-sort-btn")).toBeNull();
  });
});
