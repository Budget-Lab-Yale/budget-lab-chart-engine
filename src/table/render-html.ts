// Render a TableModel + TableLayout as a semantic HTML <table> element.
// The document argument lets callers pass any DOM (browser or jsdom) without importing globals.
import type { TableModel, BodyRow, RowGroup } from "./model";
import type { TableLayout } from "./layout";
import { INDENT_STEP } from "./layout";

// Base left padding on stub cells, matching the CSS `.tbl-table tbody th` padding and the SVG
// renderer's PAD_X — so the corner, group headers, and row labels share one left edge.
const STUB_BASE_PAD = 8;
import type { TableSpec } from "../spec/table-types";

/**
 * Build a semantic HTML <table> from a TableModel + TableLayout.
 * - <colgroup> sets per-column widths from layout (table-layout:fixed).
 * - <thead> emits one <tr> per header tier; stub corner spans all tiers.
 * - <tbody> emits group rows (.tbl-table-group) and data rows in model order.
 * - Data row labels use <th scope="row">; numeric cells use <td class="is-num" data-col=key>.
 * - Rows carry data-row; group rows carry data-level.
 * - Sublabels render as <span class="tbl-table-sublabel"> inside the leaf header cell.
 */
export function renderTableHtml(
  model: TableModel,
  layout: TableLayout,
  doc: Document,
  spec?: TableSpec,
  opts?: { flexDataCols?: boolean },
): HTMLTableElement {
  const { leaves, headerRows, body } = model;
  const { stubWidth, colW } = layout;
  const headerMaxLines = spec?.header_max_lines;
  const stubNowrap = spec?.stub_nowrap === true;
  // Stub wraps only when explicitly opted in (and not also forced nowrap); otherwise it stays on
  // one line and is clipped to the column when capped narrower than the label.
  const stubWrap = spec?.stub_wrap === true && !stubNowrap;
  // Flexible data columns: pin only the stub, let data columns absorb the card width. Used for
  // stub_wrap and for multi-pane (so all panes share the pinned stub and align).
  const flexData = stubWrap || opts?.flexDataCols === true;

  const table = doc.createElement("table");
  table.className = "tbl-table";
  table.style.tableLayout = "fixed";
  // By default the table fills the card (CSS width:100%): under table-layout:fixed the column px
  // act as ratios, so a table narrower than the card stretches to fill it (the normal look). For
  // stub_wrap that stretching would re-widen the stub and defeat the wrap, so there we pin the stub
  // column to its exact width and leave the data columns flexible — the stub stays narrow (labels
  // wrap) while the data columns absorb any extra width and the table still fills the card.

  // ---- <colgroup> ----
  const colgroup = doc.createElement("colgroup");

  // Stub column — always pinned to its computed width.
  const stubCol = doc.createElement("col");
  stubCol.style.width = `${stubWidth}px`;
  colgroup.appendChild(stubCol);

  // One <col> per leaf. With stub_wrap the data columns are left flexible (no width) so the freed
  // space flows to them rather than re-widening the pinned stub.
  leaves.forEach((_, i) => {
    const col = doc.createElement("col");
    if (!flexData) col.style.width = `${colW[i]}px`;
    colgroup.appendChild(col);
  });
  table.appendChild(colgroup);

  // ---- <thead> ----
  const thead = doc.createElement("thead");
  const tierCount = headerRows.length;
  const totalCols = 1 + leaves.length; // stub + leaves

  headerRows.forEach((tierCells, tierIdx) => {
    const tr = doc.createElement("tr");

    // First tier: emit stub corner cell spanning all tiers
    if (tierIdx === 0) {
      const cornerTh = doc.createElement("th");
      cornerTh.rowSpan = tierCount;
      cornerTh.className = "tbl-table-stub-header";
      cornerTh.textContent = model.stubHeader;
      tr.appendChild(cornerTh);
    }

    // Emit each header cell
    tierCells.forEach((hCell) => {
      const th = doc.createElement("th");
      th.scope = "col";
      th.colSpan = hCell.colSpan;
      th.rowSpan = hCell.rowSpan;
      // A leaf header over a text column left-aligns to match its (left-aligned) cells.
      const leafForCell = hCell.leafKey != null ? leaves.find((l) => l.key === hCell.leafKey) : undefined;
      if (leafForCell?.isText) th.classList.add("is-text");

      // Banner cells (spanning >1 column) get flanking rules. The flex layout that draws the
      // rules MUST live on an inner wrapper, not the <th> itself — `display:flex` on a table
      // cell drops its `table-cell` box and breaks colspan/column alignment.
      // When spanner_rules === false, render banners as plain centered text (no is-spanner hook).
      // Leaf-header line clamp: cap the label to N lines. Like the spanner flex, the
      // -webkit-box/-line-clamp MUST live on an inner wrapper, not the <th> — applying it to the
      // table cell drops its `table-cell` box and breaks column alignment.
      const spannerRules = spec?.spanner_rules !== false;
      const clamp = headerMaxLines != null && hCell.leafKey != null;
      if (hCell.colSpan > 1 && spannerRules) {
        th.classList.add("is-spanner");
        const inner = doc.createElement("span");
        inner.className = "tbl-table-spanner";
        inner.textContent = hCell.text;
        th.appendChild(inner);
      } else if (clamp) {
        const inner = doc.createElement("span");
        inner.className = "tbl-table-header-clamp";
        inner.style.setProperty("--tbl-header-lines", String(headerMaxLines));
        inner.textContent = hCell.text;
        th.appendChild(inner);
      } else {
        th.textContent = hCell.text;
      }

      // If this is a leaf-bottom cell (has leafKey) and the leaf has a sublabel, append it
      if (hCell.leafKey != null) {
        const leaf = leaves.find((l) => l.key === hCell.leafKey);
        if (leaf?.sublabel != null) {
          const span = doc.createElement("span");
          span.className = "tbl-table-sublabel";
          span.textContent = leaf.sublabel;
          th.appendChild(span);
        }
      }

      tr.appendChild(th);
    });

    thead.appendChild(tr);
  });
  table.appendChild(thead);

  // ---- <tbody> ----
  const tbody = doc.createElement("tbody");

  body.forEach((entry) => {
    if (entry.kind === "group") {
      const group: RowGroup = entry.group;
      const tr = doc.createElement("tr");
      tr.className = "tbl-table-group";
      tr.setAttribute("data-level", String(group.level));

      const th = doc.createElement("th");
      th.colSpan = totalCols;
      // Wrap the label (+ note) in a sticky-left inner block so the group title stays anchored at
      // the left edge during horizontal scroll (it labels the pinned rows) instead of scrolling
      // off and clipping under the sticky first column.
      const inner = doc.createElement("div");
      inner.className = "tbl-table-group-inner";
      if (stubNowrap) inner.classList.add("is-nowrap");
      inner.textContent = group.label;

      if (group.note != null) {
        const noteDiv = doc.createElement("div");
        noteDiv.className = "tbl-table-group-note";
        noteDiv.textContent = group.note;
        inner.appendChild(noteDiv);
      }

      th.appendChild(inner);
      tr.appendChild(th);
      tbody.appendChild(tr);
    } else {
      const row: BodyRow = entry.row;
      const tr = doc.createElement("tr");
      tr.setAttribute("data-row", row.label);

      // Stub label cell
      const stubTh = doc.createElement("th");
      stubTh.scope = "row";
      stubTh.className = "tbl-table-stub";
      stubTh.classList.add(stubWrap ? "is-wrap" : "is-nowrap");
      // Keep the cell's base 8px left padding (matches the corner + group headers) and ADD the
      // nesting indent on top — setting paddingLeft to just the indent would drop the base padding
      // for level-0 rows, leaving them flush at the cell edge while the corner sits at 8px.
      stubTh.style.paddingLeft = `${STUB_BASE_PAD + row.level * INDENT_STEP}px`;

      // Row label. When not wrapping, place it in an inner clip block so an over-long label is
      // clipped to the (capped) column — table cells themselves ignore overflow.
      if (stubWrap) {
        stubTh.textContent = row.label;
      } else {
        const clip = doc.createElement("span");
        clip.className = "tbl-table-stub-clip";
        clip.textContent = row.label;
        stubTh.appendChild(clip);
      }

      tr.appendChild(stubTh);

      // One <td> per leaf cell
      row.cells.forEach((cell, i) => {
        const td = doc.createElement("td");
        // Text cells are left-aligned and wrap (is-text); numeric cells are centered tabular (is-num).
        td.className = cell.isText ? "is-text" : "is-num";
        td.setAttribute("data-col", leaves[i]!.key);

        // Sign class
        if (cell.signClass != null) {
          td.classList.add(`is-${cell.signClass}`);
        }
        // Emphasis
        if (cell.emphasis) {
          td.classList.add("is-emphasis");
        }

        // Cell text, with footnote superscript if present
        td.textContent = cell.text;
        if (cell.footnote != null) {
          const sup = doc.createElement("sup");
          sup.textContent = cell.footnote;
          td.appendChild(sup);
        }

        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    }
  });
  table.appendChild(tbody);

  return table;
}
