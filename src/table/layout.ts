// Pure table geometry. Given a `TableModel` and a `measureText` callback, compute the pixel
// layout (column widths, stub width, header/body rects) so the HTML and SVG renderers can share
// an identical layout. No Date/random — fully deterministic for a given model + measureText.
import type { TableModel, HeaderCell, BodyRow, RowGroup } from "./model";
import { TBL } from "../engine/theme";

export interface LayoutOptions {
  width: number;
  measureText: (s: string, fontPx: number, weight: number) => number;
}
export interface CellRect { x: number; y: number; w: number; h: number; }
export interface TableLayout {
  totalWidth: number; totalHeight: number;
  stubWidth: number; colX: number[]; colW: number[];        // per leaf
  headerHeight: number; rowHeight: number;
  footnotesHeight: number;          // reserved height for the footnote list below the body (0 if none)
  header: Array<{ cell: HeaderCell; rect: CellRect; tier: number }[]>;
  rows: Array<{ row: BodyRow; rect: CellRect; cellRects: CellRect[] } | { group: RowGroup; rect: CellRect }>;
}

// ---- Local geometry constants (kept small + explicit; type sizes pulled from TBL where sensible). ----
const headerFontPx = TBL.size.legend;       // 12 — header label type size
const bodyFontPx = TBL.size.legend;         // 12 — body cell type size
const headerWeight = 700;
const bodyWeight = 400;
const padX = 16;            // total horizontal padding per cell (left + right)
const tierHeight = 24;      // one header tier's row height
const sublabelLine = 14;    // extra height on the bottom tier when any leaf has a sublabel
const rowHeight = 22;       // one body row's height
// Per-level indentation of stub labels. Exported so the HTML and SVG renderers indent identically.
export const INDENT_STEP = 14;
// Footnote list (below the body): a top gap plus one line per footnote. Exported so the SVG
// renderer places each footnote text row at the same baseline the layout reserved.
export const FOOTNOTE_TOP_GAP = 8;
export const FOOTNOTE_LINE_HEIGHT = 16;

export function layoutTable(model: TableModel, opts: LayoutOptions): TableLayout {
  const { measureText } = opts;
  const leaves = model.leaves;

  // Body rows only (group entries don't have per-leaf cells).
  const bodyRows = model.body
    .filter((b): b is { kind: "row"; row: BodyRow } => b.kind === "row")
    .map((b) => b.row);

  // ---- Per-leaf natural width = max(label, sublabel, every body cell text) + padding. ----
  const colW = leaves.map((leaf, i) => {
    let natural = measureText(leaf.label, headerFontPx, headerWeight);
    if (leaf.sublabel != null) {
      natural = Math.max(natural, measureText(leaf.sublabel, headerFontPx, bodyWeight));
    }
    for (const row of bodyRows) {
      const cell = row.cells[i];
      if (cell) natural = Math.max(natural, measureText(cell.text, bodyFontPx, bodyWeight));
    }
    return natural + padX;
  });

  // ---- Stub width = max(group labels, row labels + indent) + padding. ----
  let stubNatural = measureText(model.stubHeader, headerFontPx, headerWeight);
  for (const b of model.body) {
    if (b.kind === "group") {
      stubNatural = Math.max(
        stubNatural,
        measureText(b.group.label, bodyFontPx, headerWeight) + b.group.level * INDENT_STEP,
      );
    } else {
      stubNatural = Math.max(
        stubNatural,
        measureText(b.row.label, bodyFontPx, bodyWeight) + b.row.level * INDENT_STEP,
      );
    }
  }
  const stubWidth = stubNatural + padX;

  // ---- Column x offsets, starting after the stub column. ----
  const colX: number[] = [];
  let x = stubWidth;
  for (const w of colW) { colX.push(x); x += w; }

  const totalWidth = stubWidth + colW.reduce((a, b) => a + b, 0);

  // ---- Header height: tiers × tierHeight, plus a sublabel line if any leaf has a sublabel. ----
  const tiers = model.headerRows.length;
  const hasSublabel = leaves.some((l) => l.sublabel != null);
  const headerHeight = tiers * tierHeight + (hasSublabel ? sublabelLine : 0);

  // ---- Header cell rects. Walk each tier left→right, accumulating colSpans to map each
  // HeaderCell to the leaf-index range it spans. A cell with `leafKey` set is anchored at that
  // exact leaf index (so blank-tier rowSpans land on the right column). ----
  const header: TableLayout["header"] = model.headerRows.map((tierCells, tier) => {
    let leafIdx = 0;
    return tierCells.map((cell) => {
      // Anchor leafKey-bearing cells to their leaf; otherwise consume from the running cursor.
      let start = leafIdx;
      if (cell.leafKey != null) {
        const found = leaves.findIndex((l) => l.key === cell.leafKey);
        if (found >= 0) start = found;
      }
      const span = cell.colSpan;
      const end = start + span - 1; // inclusive last leaf index
      const xStart = colX[start] ?? stubWidth;
      let w = 0;
      for (let i = start; i <= end && i < colW.length; i++) w += colW[i]!;
      const rect: CellRect = {
        x: xStart,
        y: tier * tierHeight,
        w,
        h: cell.rowSpan * tierHeight,
      };
      leafIdx = end + 1;
      return { cell, rect, tier };
    });
  });

  // ---- Body rows: group entries get a full-width band; data rows get a stub rect + cellRects. ----
  let y = headerHeight;
  const rows: TableLayout["rows"] = model.body.map((entry) => {
    if (entry.kind === "group") {
      const rect: CellRect = { x: 0, y, w: totalWidth, h: rowHeight };
      y += rowHeight;
      return { group: entry.group, rect };
    }
    const rowRect: CellRect = { x: 0, y, w: stubWidth, h: rowHeight };
    const cellRects: CellRect[] = leaves.map((_, i) => ({
      x: colX[i]!,
      y,
      w: colW[i]!,
      h: rowHeight,
    }));
    y += rowHeight;
    return { row: entry.row, rect: rowRect, cellRects };
  });

  // Footnote list height: a top gap plus one line per footnote (0 if there are none).
  const footnotesHeight =
    model.footnotes.length > 0
      ? FOOTNOTE_TOP_GAP + model.footnotes.length * FOOTNOTE_LINE_HEIGHT
      : 0;

  const totalHeight = headerHeight + model.body.length * rowHeight + footnotesHeight;

  return {
    totalWidth, totalHeight,
    stubWidth, colX, colW,
    headerHeight, rowHeight,
    footnotesHeight,
    header, rows,
  };
}
