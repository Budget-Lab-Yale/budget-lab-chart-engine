// @vitest-environment jsdom
//
// Composition test: group_order x emphasis_rows x collapsible on ONE table spec with
// interleaved source rows (scenario-major, not pre-grouped) — groups ordered per group_order,
// the emphasized row styled including its stub, collapse defaults applied, and export honoring
// live collapse state. Lifted from the branch-review scratch draft at
// .superpowers/compose-table.test.ts (deleted once folded in here) and adapted to this suite's
// conventions (relative import depth, no local vitest config).
import { describe, it, expect } from "vitest";
import { buildTableModel, applyCollapse } from "../../src/table/model";
import { layoutTable } from "../../src/table/layout";
import { renderTableSvg } from "../../src/table/render-svg";
import { mountTable } from "../../src/table/mount";
import { buildTableExportSvg } from "../../src/embed/export-table-png";
import type { TableSpec } from "../../src/spec/table-types";
import type { TidyRow } from "../../src/data/index";

function measureText(s: string, _f: number, _w: number) {
  return s.length * 7;
}

// One spec using all three features. Source rows are deliberately INTERLEAVED
// (scenario-major) so order-independent grouping is exercised, first-seen group
// order is Americas-first, and group_order flips it to Asia-first.
const SPEC: TableSpec = {
  title: "Compose",
  data: "inline",
  stub: ["group", { label: "item" }],
  header: ["metric"],
  value: "value",
  group_order: ["Asia", "Americas"],
  emphasis_rows: ["Total"],
  collapsible: { collapsed: ["Americas"] },
};
const ROWS: TidyRow[] = [
  { group: "Americas", item: "US", metric: "rate", value: "1" },
  { group: "Asia", item: "China", metric: "rate", value: "2" },
  { group: "Americas", item: "Total", metric: "rate", value: "3" },
  { group: "Asia", item: "Japan", metric: "rate", value: "4" },
  { group: "Asia", item: "Total", metric: "rate", value: "6" },
  { group: "Americas", item: "CA", metric: "rate", value: "5" },
];

function bodyKinds(m: ReturnType<typeof buildTableModel>) {
  return m.body.map((b) => (b.kind === "group" ? `G:${b.group.label}` : `R:${b.row.label}`));
}

describe("table composition — group_order x collapsible defaults x emphasis_rows", () => {
  it("group_order reorders groups; collapsed default still matches the moved group by value", () => {
    const m = buildTableModel(SPEC, ROWS);
    expect(bodyKinds(m)).toEqual([
      "G:Asia", "R:China", "R:Japan", "R:Total",
      "G:Americas", "R:US", "R:Total", "R:CA",
    ]);
    const groups = m.body.filter((b) => b.kind === "group").map((b: any) => b.group);
    expect(groups.map((g: any) => [g.label, g.collapsed])).toEqual([
      ["Asia", false],
      ["Americas", true], // collapsed-list match survives the reorder
    ]);
    // Keys are path tokens independent of order.
    expect(groups.map((g: any) => g.key)).toEqual(["Asia", "Americas"]);
  });

  it("emphasis_rows matches by row content (raw label), not index, under reordering", () => {
    const m = buildTableModel(SPEC, ROWS);
    const rows = m.body.filter((b) => b.kind === "row").map((b: any) => b.row);
    for (const r of rows) {
      const expected = r.label === "Total";
      expect(!!r.emphasis, `row ${r.groupKeys[0]}/${r.label}`).toBe(expected);
      expect(!!r.cells[0]?.emphasis, `cell ${r.groupKeys[0]}/${r.label}`).toBe(expected);
    }
  });

  it("applyCollapse(defaults) drops only the collapsed group's rows, keeps order + emphasis", () => {
    const m = buildTableModel(SPEC, ROWS);
    const collapsed = new Set(
      m.body.filter((b) => b.kind === "group" && (b as any).group.collapsed).map((b: any) => b.group.key),
    );
    const c = applyCollapse(m, collapsed);
    expect(bodyKinds(c)).toEqual([
      "G:Asia", "R:China", "R:Japan", "R:Total",
      "G:Americas", // header stays, subtree gone
    ]);
    const asiaTotal: any = c.body.find((b) => b.kind === "row" && (b as any).row.label === "Total");
    expect(asiaTotal.row.emphasis).toBe(true);
    expect(asiaTotal.row.groupKeys).toEqual(["Asia"]);
  });
});

describe("table composition — SVG export path: collapsed + reordered + emphasized", () => {
  it("renderTableSvg after applyCollapse keeps emphasis rects, caret states, group order", () => {
    let m = buildTableModel(SPEC, ROWS);
    const collapsed = new Set(["Americas"]);
    m = applyCollapse(m, collapsed);
    const layout = layoutTable(m, { width: 600, measureText });
    const svg = renderTableSvg(m, layout, { document, spec: SPEC });

    // Emphasis: 1 visible emphasized row (Asia/Total) -> 1 stub rect + 1 cell rect.
    const emph = svg.querySelectorAll("rect.tbl-table-cell-emph");
    expect(emph.length).toBe(2);

    // Carets: one per group header; Americas (collapsed) uses the right-pointing path shape.
    const carets = Array.from(svg.querySelectorAll("path.tbl-table-caret"));
    expect(carets.length).toBe(2);
    const ds = carets.map((c) => c.getAttribute("d")!);
    expect(ds[0]).not.toBe(ds[1]); // expanded (Asia) vs collapsed (Americas) glyphs differ

    // Group order in draw order: Asia before Americas.
    const texts = Array.from(svg.querySelectorAll("text")).map((t) => t.textContent);
    expect(texts.indexOf("Asia")).toBeGreaterThan(-1);
    expect(texts.indexOf("Asia")).toBeLessThan(texts.indexOf("Americas"));
    // Collapsed subtree is really gone from the drawing.
    expect(texts).not.toContain("US");
    expect(texts).not.toContain("CA");
  });

  it("buildTableExportSvg with collapsed OMITTED seeds from spec defaults (Americas hidden)", () => {
    const svg = buildTableExportSvg(SPEC, ROWS, {});
    const texts = Array.from(svg.querySelectorAll("text")).map((t) => t.textContent);
    expect(texts).toContain("China");
    expect(texts).not.toContain("US");
    // Asia still before Americas in the export too.
    expect(texts.indexOf("Asia")).toBeLessThan(texts.indexOf("Americas"));
  });

  it("buildTableExportSvg with explicit live state (Asia collapsed, Americas expanded) wins", () => {
    const svg = buildTableExportSvg(SPEC, ROWS, { collapsed: ["Asia"] });
    const texts = Array.from(svg.querySelectorAll("text")).map((t) => t.textContent);
    expect(texts).not.toContain("China");
    expect(texts).toContain("US");
  });
});

describe("table composition — mount: interactive collapse x emphasis x group_order", () => {
  function groupTr(table: HTMLTableElement, label: string): HTMLTableRowElement {
    return Array.from(table.querySelectorAll("tr.tbl-table-group")).find((tr) => {
      const el = tr.querySelector(".tbl-table-group-label") ?? tr.querySelector("th");
      return el?.textContent?.trim() === label;
    }) as HTMLTableRowElement;
  }

  it("seeds Americas collapsed, renders groups in group_order, keeps emphasis classes through toggle", () => {
    const container = document.createElement("div");
    mountTable(container, { spec: SPEC, rows: ROWS });
    const table = container.querySelector("table.tbl-table") as HTMLTableElement;

    // Group order in the DOM.
    const groupLabels = Array.from(table.querySelectorAll("tr.tbl-table-group .tbl-table-group-label"))
      .map((el) => el.textContent);
    expect(groupLabels).toEqual(["Asia", "Americas"]);

    // Seeded default: Americas' rows hidden, Asia's visible.
    const trOf = (group: string, label: string) =>
      Array.from(table.querySelectorAll(`tbody tr[data-row="${label}"]`)).find(
        (tr) => tr.getAttribute("data-group-parents") === group,
      ) as HTMLTableRowElement;
    expect(trOf("Americas", "US").hidden).toBe(true);
    expect(trOf("Asia", "China").hidden).toBe(false);
    const americasBtn = groupTr(table, "Americas").querySelector("button.tbl-table-group-toggle") as HTMLButtonElement;
    expect(americasBtn.classList.contains("is-collapsed")).toBe(true);

    // Both Total rows carry whole-row emphasis on stub + cells.
    for (const g of ["Asia", "Americas"]) {
      const tot = trOf(g, "Total");
      expect(tot.querySelector("th.tbl-table-stub")!.classList.contains("is-emphasis")).toBe(true);
      expect(tot.querySelector("td")!.classList.contains("is-emphasis")).toBe(true);
    }

    // Expand Americas: its emphasized Total unhides with classes intact.
    americasBtn.click();
    const amTotal = trOf("Americas", "Total");
    expect(amTotal.hidden).toBe(false);
    expect(amTotal.querySelector("th.tbl-table-stub")!.classList.contains("is-emphasis")).toBe(true);
  });

  it("collapse-all / expand-all works with a spec-default mixed state", () => {
    const container = document.createElement("div");
    mountTable(container, { spec: SPEC, rows: ROWS });
    const table = container.querySelector("table.tbl-table") as HTMLTableElement;
    const allBtn = container.querySelector(".tbl-table-collapse-all") as HTMLButtonElement;
    // Asia expanded by default -> button offers Collapse all.
    expect(allBtn.textContent).toBe("Collapse all");
    allBtn.click();
    const dataRows = Array.from(table.querySelectorAll("tbody tr:not(.tbl-table-group)")) as HTMLTableRowElement[];
    expect(dataRows.every((tr) => tr.hidden)).toBe(true);
    expect(allBtn.textContent).toBe("Expand all");
    allBtn.click();
    expect(dataRows.every((tr) => !tr.hidden)).toBe(true);
  });
});
