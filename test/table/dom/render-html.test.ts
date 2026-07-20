// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildTableModel } from "../../../src/table/model";
import { layoutTable } from "../../../src/table/layout";
import { renderTableHtml } from "../../../src/table/render-html";
import type { TableSpec } from "../../../src/spec/table-types";

// ---- Inline tidy dataset with 3 header tiers so colspan + rowspan are exercised. ----
// tier1: "Conv" spans 2 leaves (26-35/$b and Eq/PCE); "Dyn" has blank tier2 → leaf GDP rowspans.
// stub: single "row" label column (no groups) for simplicity.
const spec: TableSpec = {
  title: "Test",
  data: "d",
  value: "value",
  stub: [{ label: "row" }],
  header: ["tier1", "tier2", "metric"],
  format: { default: { type: "number", decimals: 2 } },
  sublabels: { "$b": "billions" },
};

const rows = [
  { row: "All", tier1: "Conv", tier2: "26-35", metric: "$b",  value: "2933" },
  { row: "All", tier1: "Conv", tier2: "Eq",    metric: "PCE", value: "0.0204" },
  { row: "All", tier1: "Dyn",  tier2: "",      metric: "GDP", value: "-0.80" },
  { row: "LI",  tier1: "Conv", tier2: "26-35", metric: "$b",  value: "100" },
  { row: "LI",  tier1: "Conv", tier2: "Eq",    metric: "PCE", value: "0.0050" },
  { row: "LI",  tier1: "Dyn",  tier2: "",      metric: "GDP", value: "-0.20" },
] as unknown as import("../../../src/data/index").TidyRow[];

// 2-tier grouped dataset for testing group rows
const spec2: TableSpec = {
  title: "Test2",
  data: "d",
  value: "val",
  stub: ["grp", { label: "lab" }],
  header: ["per"],
  format: { default: { type: "number", decimals: 1 } },
};

const rows2 = [
  { grp: "G1", lab: "r1", per: "2026", val: "1.2" },
  { grp: "G1", lab: "r2", per: "2026", val: "3.4" },
  { grp: "G2", lab: "r3", per: "2026", val: "5.6" },
] as unknown as import("../../../src/data/index").TidyRow[];

function measureText(s: string, _fontPx: number, _weight: number) { return s.length * 7; }

describe("renderTableHtml — 3-tier header", () => {
  const model = buildTableModel(spec, rows);
  const layout = layoutTable(model, { width: 800, measureText });
  let table: HTMLTableElement;

  it("returns an HTMLTableElement", () => {
    table = renderTableHtml(model, layout, document);
    expect(table.tagName).toBe("TABLE");
  });

  it("table has class tbl-table", () => {
    table = renderTableHtml(model, layout, document);
    expect(table.classList.contains("tbl-table")).toBe(true);
  });

  it("has a <colgroup> with per-column <col> elements (stub + leaves)", () => {
    table = renderTableHtml(model, layout, document);
    const colgroup = table.querySelector("colgroup");
    expect(colgroup).not.toBeNull();
    const cols = colgroup!.querySelectorAll("col");
    // stub col + one per leaf
    expect(cols.length).toBe(1 + model.leaves.length);
    // stub col width matches layout.stubWidth
    const stubCol = cols[0]!;
    expect(stubCol.style.width).toBe(`${layout.stubWidth}px`);
    // leaf col widths match layout.colW
    model.leaves.forEach((_, i) => {
      expect(cols[i + 1]!.style.width).toBe(`${layout.colW[i]}px`);
    });
  });

  it("<thead> has one <tr> per header tier", () => {
    table = renderTableHtml(model, layout, document);
    const thead = table.querySelector("thead");
    expect(thead).not.toBeNull();
    const trs = thead!.querySelectorAll("tr");
    expect(trs.length).toBe(model.headerRows.length);
  });

  it("header cells carry correct colSpan and rowSpan from the model", () => {
    table = renderTableHtml(model, layout, document);
    const thead = table.querySelector("thead")!;
    const trs = thead.querySelectorAll("tr");

    model.headerRows.forEach((tierCells, tierIdx) => {
      // Each tier maps to one <tr>; tier 0's first <th> is the stub corner (skip it)
      const allThs = Array.from(trs[tierIdx]!.querySelectorAll("th"));
      const dataThs = tierIdx === 0 ? allThs.slice(1) : allThs;

      tierCells.forEach((headerCell, ci) => {
        const th = dataThs[ci]!;
        expect(th.colSpan).toBe(headerCell.colSpan);
        expect(th.rowSpan).toBe(headerCell.rowSpan);
        expect(th.textContent?.trim().startsWith(headerCell.text)).toBe(true);
      });
    });
  });

  it("banner header cells (colSpan > 1) get the is-spanner class; leaf cells do not", () => {
    table = renderTableHtml(model, layout, document);
    const thead = table.querySelector("thead")!;
    const ths = Array.from(thead.querySelectorAll("th")) as HTMLTableCellElement[];
    // Every spanner <th> must have colSpan > 1; every colSpan>1 data <th> must be a spanner.
    ths.forEach((th) => {
      if (th.classList.contains("tbl-table-stub-header")) return; // corner uses rowSpan, not a banner
      if (th.colSpan > 1) expect(th.classList.contains("is-spanner")).toBe(true);
      else expect(th.classList.contains("is-spanner")).toBe(false);
    });
    // The "Conv" banner spans 2 leaves, so at least one spanner exists.
    expect(ths.some((th) => th.classList.contains("is-spanner"))).toBe(true);
  });

  it("stub corner <th> spans all header tiers (rowSpan = tier count)", () => {
    table = renderTableHtml(model, layout, document);
    const thead = table.querySelector("thead")!;
    const firstTr = thead.querySelectorAll("tr")[0]!;
    const firstTh = firstTr.querySelector("th")!;
    expect(firstTh.rowSpan).toBe(model.headerRows.length);
  });

  it("sublabel renders as <span class='tbl-table-sublabel'> inside the leaf header cell", () => {
    table = renderTableHtml(model, layout, document);
    const sublabelSpans = table.querySelectorAll("thead .tbl-table-sublabel");
    // spec has sublabels: { "$b": "billions" }
    expect(sublabelSpans.length).toBeGreaterThan(0);
    expect(sublabelSpans[0]!.textContent).toBe("billions");
  });

  it("<tbody> data rows have <th scope='row'> for stub label", () => {
    table = renderTableHtml(model, layout, document);
    const tbody = table.querySelector("tbody")!;
    const dataRows = tbody.querySelectorAll("tr:not(.tbl-table-group)");
    expect(dataRows.length).toBe(2); // "All" and "LI"
    dataRows.forEach((tr) => {
      const th = tr.querySelector("th[scope='row']");
      expect(th).not.toBeNull();
    });
  });

  it("numeric <td> carry data-col = leaf key and class is-num", () => {
    table = renderTableHtml(model, layout, document);
    const tbody = table.querySelector("tbody")!;
    const firstDataRow = tbody.querySelector("tr:not(.tbl-table-group)")!;
    const tds = firstDataRow.querySelectorAll("td");
    expect(tds.length).toBe(model.leaves.length);
    tds.forEach((td, i) => {
      expect(td.getAttribute("data-col")).toBe(model.leaves[i]!.key);
      expect(td.classList.contains("is-num")).toBe(true);
    });
  });

  it("rows carry data-row attribute with the row label", () => {
    table = renderTableHtml(model, layout, document);
    const tbody = table.querySelector("tbody")!;
    const dataRows = tbody.querySelectorAll("tr:not(.tbl-table-group)");
    expect(dataRows[0]!.getAttribute("data-row")).toBe("All");
    expect(dataRows[1]!.getAttribute("data-row")).toBe("LI");
  });
});

describe("renderTableHtml — 2-tier grouped body", () => {
  const model = buildTableModel(spec2, rows2);
  const layout = layoutTable(model, { width: 600, measureText });

  it("<tbody> has group rows with class tbl-table-group", () => {
    const table = renderTableHtml(model, layout, document);
    const tbody = table.querySelector("tbody")!;
    const groupRows = tbody.querySelectorAll("tr.tbl-table-group");
    expect(groupRows.length).toBe(2); // G1 and G2
  });

  it("group row has <th> spanning all columns", () => {
    const table = renderTableHtml(model, layout, document);
    const tbody = table.querySelector("tbody")!;
    const groupRow = tbody.querySelector("tr.tbl-table-group")!;
    const th = groupRow.querySelector("th")!;
    // colSpan = 1 (stub) + leaves.length
    expect(th.colSpan).toBe(1 + model.leaves.length);
  });

  it("body order is: group, row, row, group, row", () => {
    const table = renderTableHtml(model, layout, document);
    const tbody = table.querySelector("tbody")!;
    const trs = tbody.querySelectorAll("tr");
    const kinds = Array.from(trs).map((tr) =>
      tr.classList.contains("tbl-table-group") ? "group" : "row"
    );
    expect(kinds).toEqual(["group", "row", "row", "group", "row"]);
  });

  it("data rows have data-row attribute", () => {
    const table = renderTableHtml(model, layout, document);
    const tbody = table.querySelector("tbody")!;
    const dataRows = tbody.querySelectorAll("tr:not(.tbl-table-group)");
    const labels = Array.from(dataRows).map((tr) => tr.getAttribute("data-row"));
    expect(labels).toEqual(["r1", "r2", "r3"]);
  });
});

describe("renderTableHtml — config hooks", () => {
  it("spanner_rules:false drops the is-spanner class (plain banner text)", () => {
    const m = buildTableModel(spec, rows);
    const l = layoutTable(m, { width: 800, measureText });
    const withRules = renderTableHtml(m, l, document, spec);
    expect(withRules.querySelector("thead th.is-spanner")).not.toBeNull();

    const noRules = renderTableHtml(m, l, document, { ...spec, spanner_rules: false });
    expect(noRules.querySelector("thead th.is-spanner")).toBeNull();
    // The banner text is still present (as a plain <th>).
    const banners = Array.from(noRules.querySelectorAll("thead th")).map((t) => t.textContent);
    expect(banners.some((t) => t?.includes("Conv"))).toBe(true);
  });

  it("header_max_lines adds the clamp class + --tbl-header-lines on leaf headers", () => {
    const m = buildTableModel(spec, rows);
    const l = layoutTable(m, { width: 800, measureText, headerMaxLines: 2 });
    const table = renderTableHtml(m, l, document, { ...spec, header_max_lines: 2 });
    // The clamp lives on an inner span (not the <th>) so it doesn't break the table-cell layout.
    const clamped = table.querySelector("thead th .tbl-table-header-clamp") as HTMLElement;
    expect(clamped).not.toBeNull();
    expect(clamped.style.getPropertyValue("--tbl-header-lines")).toBe("2");
  });

  it("stub_nowrap adds the is-nowrap class on stub cells and group inners", () => {
    const m = buildTableModel(spec2, rows2);
    const l = layoutTable(m, { width: 600, measureText, stubNowrap: true });
    const table = renderTableHtml(m, l, document, { ...spec2, stub_nowrap: true });
    expect(table.querySelector("tbody th.tbl-table-stub.is-nowrap")).not.toBeNull();
    expect(table.querySelector(".tbl-table-group-inner.is-nowrap")).not.toBeNull();
  });

  it("stub_wrap keeps explicit data-column widths on the <col>s (Change A)", () => {
    const m = buildTableModel(spec, rows);
    const l = layoutTable(m, { width: 380, measureText, stubWrap: true, stubMinWidth: 80 });
    const table = renderTableHtml(m, l, document, { ...spec, stub_wrap: true });
    const cols = table.querySelectorAll("colgroup col");
    // Every leaf <col> still carries its computed px width — stub_wrap no longer frees the data cols.
    m.leaves.forEach((_, i) => {
      expect((cols[i + 1] as HTMLElement).style.width).toBe(`${l.colW[i]}px`);
    });
  });

  it("only opts.flexDataCols (multi-pane) frees the data <col> widths", () => {
    const m = buildTableModel(spec, rows);
    const l = layoutTable(m, { width: 800, measureText });
    const table = renderTableHtml(m, l, document, spec, { flexDataCols: true });
    const cols = table.querySelectorAll("colgroup col");
    m.leaves.forEach((_, i) => {
      expect((cols[i + 1] as HTMLElement).style.width).toBe("");
    });
  });

  it("column_wrap adds the is-wrap class to the named column's body <td>s only", () => {
    const wrapSpec: TableSpec = {
      title: "T", data: "d", value: "value",
      stub: [{ label: "row" }],
      header: ["metric"],
      column_wrap: { notes: true },
    };
    const wrapRows = [
      { row: "r", metric: "notes", value: "some prose that could wrap" },
      { row: "r", metric: "num", value: "12.5" },
    ] as unknown as import("../../../src/data/index").TidyRow[];
    const m = buildTableModel(wrapSpec, wrapRows);
    const l = layoutTable(m, { width: 800, measureText, columnWrap: { notes: true } });
    const table = renderTableHtml(m, l, document, wrapSpec);
    const wrapped = table.querySelector('td[data-col="notes"]')!;
    const other = table.querySelector('td[data-col="num"]')!;
    expect(wrapped.classList.contains("is-wrap")).toBe(true);
    expect(other.classList.contains("is-wrap")).toBe(false);
  });

  it("column_wrap: true wraps every data column's body cells", () => {
    const m = buildTableModel(spec, rows);
    const l = layoutTable(m, { width: 800, measureText });
    const table = renderTableHtml(m, l, document, { ...spec, column_wrap: true });
    const tds = table.querySelectorAll("tbody td");
    expect(tds.length).toBeGreaterThan(0);
    tds.forEach((td) => expect(td.classList.contains("is-wrap")).toBe(true));
  });

  it("a \\\\ token in a stub label renders a <br>", () => {
    const brSpec: TableSpec = {
      title: "T", data: "d", value: "value",
      stub: [{ label: "row" }],
      header: ["metric"],
      format: { default: { type: "number", decimals: 0 } },
    };
    const brRows = [
      { row: "First\\\\second", metric: "x", value: "1" },
    ] as unknown as import("../../../src/data/index").TidyRow[];
    const m = buildTableModel(brSpec, brRows);
    const l = layoutTable(m, { width: 400, measureText });
    const table = renderTableHtml(m, l, document, brSpec);
    const stubTh = table.querySelector("tbody th.tbl-table-stub")!;
    expect(stubTh.querySelectorAll("br").length).toBe(1);
    expect(stubTh.textContent).toBe("Firstsecond"); // <br> carries no text
  });
});

describe("renderTableHtml — whole-row emphasis (Task 3)", () => {
  const emphSpec: TableSpec = {
    title: "T", data: "d", value: "value",
    stub: [{ label: "row" }],
    header: ["metric"],
    format: { default: { type: "number", decimals: 1 } },
    emphasis_rows: ["Total"],
  };
  const emphRows = [
    { row: "A", metric: "M", value: "1.0" },
    { row: "Total", metric: "M", value: "2.0" },
  ] as unknown as import("../../../src/data/index").TidyRow[];

  it("emphasized row's stub <th> gets is-emphasis", () => {
    const m = buildTableModel(emphSpec, emphRows);
    const l = layoutTable(m, { width: 400, measureText });
    const table = renderTableHtml(m, l, document, emphSpec);
    const totalTr = table.querySelector('tbody tr[data-row="Total"]')!;
    const stubTh = totalTr.querySelector("th.tbl-table-stub")!;
    expect(stubTh.classList.contains("is-emphasis")).toBe(true);
  });

  it("non-emphasized row's stub <th> does not get is-emphasis", () => {
    const m = buildTableModel(emphSpec, emphRows);
    const l = layoutTable(m, { width: 400, measureText });
    const table = renderTableHtml(m, l, document, emphSpec);
    const aTr = table.querySelector('tbody tr[data-row="A"]')!;
    const stubTh = aTr.querySelector("th.tbl-table-stub")!;
    expect(stubTh.classList.contains("is-emphasis")).toBe(false);
  });

  it("emphasis_column-only table has no stub emphasis", () => {
    const colSpec: TableSpec = {
      title: "T", data: "d", value: "value",
      stub: [{ label: "row" }],
      header: ["metric"],
      format: { default: { type: "number", decimals: 1 } },
      emphasis_column: "flag",
    };
    const colRows = [
      { row: "A", metric: "M", value: "1.0", flag: "yes" },
    ] as unknown as import("../../../src/data/index").TidyRow[];
    const m = buildTableModel(colSpec, colRows);
    const l = layoutTable(m, { width: 400, measureText });
    const table = renderTableHtml(m, l, document, colSpec);
    // Sanity: the value cell IS emphasized (per-cell mechanism unaffected).
    const td = table.querySelector('tbody tr[data-row="A"] td')!;
    expect(td.classList.contains("is-emphasis")).toBe(true);
    // But the stub is not.
    const stubTh = table.querySelector('tbody tr[data-row="A"] th.tbl-table-stub')!;
    expect(stubTh.classList.contains("is-emphasis")).toBe(false);
  });
});

describe("renderTableHtml — header separator under blank-group column (Task 5)", () => {
  // 2-tier header: "Group One" spans two leaves (A, B); "solo" has a BLANK top tier, so it
  // rowspans the whole header as a single <th> in the FIRST header row; "Group Two" spans one leaf.
  const blankGroupSpec: TableSpec = {
    title: "T5", data: "d", value: "value",
    stub: [{ label: "row" }],
    header: ["group", "metric"],
    format: { default: { type: "number", decimals: 0 } },
  };
  const blankGroupRows = [
    { row: "X", group: "Group One", metric: "A",    value: "1" },
    { row: "X", group: "Group One", metric: "B",    value: "2" },
    { row: "X", group: "",          metric: "Solo", value: "3" },
    { row: "X", group: "Group Two", metric: "C",    value: "4" },
    { row: "Y", group: "Group One", metric: "A",    value: "5" },
    { row: "Y", group: "Group One", metric: "B",    value: "6" },
    { row: "Y", group: "",          metric: "Solo", value: "7" },
    { row: "Y", group: "Group Two", metric: "C",    value: "8" },
  ] as unknown as import("../../../src/data/index").TidyRow[];

  const m = buildTableModel(blankGroupSpec, blankGroupRows);
  const l = layoutTable(m, { width: 800, measureText });
  const table = renderTableHtml(m, l, document, blankGroupSpec);
  const thead = table.querySelector("thead")!;
  const trs = thead.querySelectorAll("tr");
  const tierCount = m.headerRows.length;

  it("every leaf <th> in the last header row has is-header-bottom", () => {
    const lastRowThs = Array.from(trs[trs.length - 1]!.querySelectorAll("th"));
    expect(lastRowThs.length).toBeGreaterThan(0);
    lastRowThs.forEach((th) => {
      expect(th.classList.contains("is-header-bottom")).toBe(true);
    });
  });

  it("the blank-group column's rowspanning <th> (in the first header row) has is-header-bottom", () => {
    const firstRowThs = Array.from(trs[0]!.querySelectorAll("th"));
    // The blank-group leaf ("Solo") rowspans the full tier count and sits in the first row,
    // alongside the stub corner (also rowSpan = tierCount) and any banner cells (rowSpan 1).
    const soloTh = firstRowThs.find(
      (th) => th.rowSpan === tierCount && !th.classList.contains("tbl-table-stub-header"),
    );
    expect(soloTh).toBeDefined();
    expect(soloTh!.textContent?.trim()).toBe("Solo");
    expect(soloTh!.classList.contains("is-header-bottom")).toBe(true);
  });

  it("the stub corner <th> has is-header-bottom", () => {
    const corner = thead.querySelector("th.tbl-table-stub-header")!;
    expect(corner.classList.contains("is-header-bottom")).toBe(true);
  });

  it("a banner/super-group <th> (colSpan > 1, rowSpan < tierCount) does NOT have is-header-bottom", () => {
    const firstRowThs = Array.from(trs[0]!.querySelectorAll("th"));
    const banner = firstRowThs.find((th) => th.textContent?.trim() === "Group One");
    expect(banner).toBeDefined();
    expect(banner!.colSpan).toBe(2);
    expect(banner!.rowSpan).toBe(1);
    expect(banner!.classList.contains("is-header-bottom")).toBe(false);
  });
});
