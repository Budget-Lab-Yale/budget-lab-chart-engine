// Render a TableModel + TableLayout as a semantic HTML <table> element.
// The document argument lets callers pass any DOM (browser or jsdom) without importing globals.
import type { TableModel, BodyRow, RowGroup } from "./model";
import type { TableLayout } from "./layout";
import { INDENT_STEP } from "./layout";

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
): HTMLTableElement {
  const { leaves, headerRows, body } = model;
  const { stubWidth, colW } = layout;

  const table = doc.createElement("table");
  table.className = "tbl-table";
  table.style.tableLayout = "fixed";

  // ---- <colgroup> ----
  const colgroup = doc.createElement("colgroup");

  // Stub column
  const stubCol = doc.createElement("col");
  stubCol.style.width = `${stubWidth}px`;
  colgroup.appendChild(stubCol);

  // One <col> per leaf
  leaves.forEach((_, i) => {
    const col = doc.createElement("col");
    col.style.width = `${colW[i]}px`;
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

      // Banner cells (spanning >1 column) get flanking rules. The flex layout that draws the
      // rules MUST live on an inner wrapper, not the <th> itself — `display:flex` on a table
      // cell drops its `table-cell` box and breaks colspan/column alignment.
      if (hCell.colSpan > 1) {
        th.classList.add("is-spanner");
        const inner = doc.createElement("span");
        inner.className = "tbl-table-spanner";
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
      stubTh.style.paddingLeft = `${row.level * INDENT_STEP}px`;

      // Label text (with footnote superscript if any row-level footnote key present)
      stubTh.textContent = row.label;

      tr.appendChild(stubTh);

      // One <td> per leaf cell
      row.cells.forEach((cell, i) => {
        const td = doc.createElement("td");
        td.className = "is-num";
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
