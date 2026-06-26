// Pure table geometry. Given a `TableModel` and a `measureText` callback, compute the pixel
// layout (column widths, stub width, header/body rects) so the HTML and SVG renderers can share
// an identical layout. No Date/random — fully deterministic for a given model + measureText.
//
// All text wrapping (leaf-header lines, group notes) is resolved HERE using the caller's
// measureText, and the resulting line arrays are stored on the layout — so the SVG renderer draws
// exactly the lines this module measured, and the two cannot disagree on line counts (which would
// otherwise mismatch the reserved height and overlap neighboring rows).
import type { TableModel, HeaderCell, BodyRow, RowGroup } from "./model";
import { TBL } from "../engine/theme";

export interface LayoutOptions {
  width: number;
  measureText: (s: string, fontPx: number, weight: number) => number;
  /** Fixed px width for the stub column (overrides the computed width). */
  stubWidth?: number;
  /** When true, size the stub to the longest label (no wrapping). */
  stubNowrap?: boolean;
  /** Fixed px width for data columns: a single number (all leaves) or per-leaf-key map. */
  columnWidth?: number | Record<string, number>;
  /** Wrap bottom-tier (leaf) header labels to at most N lines. */
  headerMaxLines?: number;
}
export interface CellRect { x: number; y: number; w: number; h: number; }
export interface HeaderEntry { cell: HeaderCell; rect: CellRect; tier: number; lines?: string[]; }
export type RowEntry =
  | { row: BodyRow; rect: CellRect; cellRects: CellRect[] }
  | { group: RowGroup; rect: CellRect; noteLines: string[]; topGap: number; isFirst: boolean };
export interface TableLayout {
  totalWidth: number; totalHeight: number;
  stubWidth: number; colX: number[]; colW: number[];        // per leaf
  headerHeight: number; rowHeight: number;
  tierY: number[];                  // y offset of each header tier (length = tier count)
  footnotesHeight: number;          // reserved height for the footnote list below the body (0 if none)
  header: HeaderEntry[][];
  rows: RowEntry[];
}

// ---- Local geometry constants (kept small + explicit; type sizes pulled from TBL where sensible). ----
// Type sizes mirror the live HTML (styles.ts): header 12px, body 13px.
const headerFontPx = TBL.size.legend;       // 12 — header label type size
const bodyFontPx = 13;                       // 13 — body cell type size (matches HTML td/th)
const noteFontPx = TBL.size.annotation;      // 11 — group-note / sublabel type size
const headerWeight = 700;
const bodyWeight = 400;
const padX = 16;            // total horizontal padding per cell (left + right)
const tierHeight = 26;      // one banner tier's row height (HTML header ≈ 12px + 6+6 padding)
const sublabelLine = 14;    // extra height on the bottom tier when any leaf has a sublabel
// Flanking-rule gap on a banner cell (one side). Mirrors the SVG renderer's PAD_X inset (8px),
// so the banner-width fit reserves room for the rule gaps on both sides of the centered text.
const spannerGap = 8;
// Per-line height for wrapped leaf-header labels (header_max_lines). Lines beyond the first
// add this much to the bottom tier.
const headerLineHeight = 15;
const rowHeight = 26;       // one body row's height (HTML td ≈ 13px + 5+5 padding + border)
// Row-group breathing room (HTML: border-top + padding-top 14px above a heading, 4px for the
// first group; an italic note sits below the label).
const groupTopGap = 14;
const groupFirstTopGap = 4;
const groupLabelLine = 18;
const groupNoteLineHeight = 15;
const groupNoteGap = 1;
const groupBottomPad = 4;
// Per-level indentation of stub labels. Exported so the HTML and SVG renderers indent identically.
export const INDENT_STEP = 14;
// Footnote list (below the body): a top gap plus one line per footnote. Exported so the SVG
// renderer places each footnote text row at the same baseline the layout reserved.
export const FOOTNOTE_TOP_GAP = 8;
export const FOOTNOTE_LINE_HEIGHT = 16;
// Shared with render-svg so drawn text aligns with the heights reserved here.
export const HEADER_LINE_HEIGHT = headerLineHeight;
export const SUBLABEL_LINE = sublabelLine;
export const GROUP_LABEL_LINE = groupLabelLine;
export const GROUP_NOTE_GAP = groupNoteGap;
export const GROUP_NOTE_LINE_HEIGHT = groupNoteLineHeight;
// Horizontal inset used for wrapping group notes to the table width (mirrors render-svg PAD_X*2).
const NOTE_WRAP_PAD = 16;
const NOTE_WRAP_MAX_LINES = 4;

/** Greedy word-wrap into at most `maxLines` lines that each fit `maxWidth` px (via `measure`).
 * The final line absorbs any overflow rather than dropping words, so no text is lost. Returns a
 * single-element array when the text fits on one line. */
function wrapToLines(s: string, maxWidth: number, maxLines: number, measure: (s: string) => number): string[] {
  if (maxLines <= 1 || measure(s) <= maxWidth) return [s];
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (measure(next) <= maxWidth || cur === "") {
      cur = next;
    } else {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines - 1) break;
    }
  }
  const consumed = lines.join(" ").split(/\s+/).filter(Boolean).length;
  const rest = words.slice(consumed).join(" ");
  if (rest) lines.push(rest);
  return lines.length ? lines.slice(0, maxLines) : [s];
}

export function layoutTable(model: TableModel, opts: LayoutOptions): TableLayout {
  const { measureText } = opts;
  const leaves = model.leaves;
  const headerMaxLines = opts.headerMaxLines;
  const measureHeader = (s: string) => measureText(s, headerFontPx, headerWeight);
  const measureNote = (s: string) => measureText(s, noteFontPx, bodyWeight);

  // Body rows only (group entries don't have per-leaf cells).
  const bodyRows = model.body
    .filter((b): b is { kind: "row"; row: BodyRow } => b.kind === "row")
    .map((b) => b.row);

  // Resolve a per-leaf width override from opts.columnWidth (single number or per-key map).
  const colWidthOverride = (leafKey: string): number | undefined => {
    const cw = opts.columnWidth;
    if (cw == null) return undefined;
    if (typeof cw === "number") return cw;
    return cw[leafKey];
  };

  // ---- Per-leaf natural width = max(label, sublabel, every body cell text) + padding. ----
  // When header_max_lines is set, the leaf header label is allowed to WRAP, so it does NOT force
  // the column wide enough for the full label (only the sublabel + body cells do). A per-leaf
  // columnWidth override always wins.
  const colW = leaves.map((leaf, i) => {
    const override = colWidthOverride(leaf.key);
    if (override != null) return override;
    let natural = headerMaxLines != null ? 0 : measureHeader(leaf.label);
    if (leaf.sublabel != null) {
      natural = Math.max(natural, measureText(leaf.sublabel, headerFontPx, bodyWeight));
    }
    for (const row of bodyRows) {
      const cell = row.cells[i];
      if (cell) natural = Math.max(natural, measureText(cell.text, bodyFontPx, bodyWeight));
    }
    return natural + padX;
  });

  // ---- Banner fit: a banner (colSpan>1) whose text is wider than the columns it spans widens
  // them. Required width = text + padX + 2*spannerGap (room for the flanking rules). If that
  // exceeds the spanned leaves' total colW, distribute the deficit evenly across them. ----
  for (const tierCells of model.headerRows) {
    let cursor = 0;
    for (const cell of tierCells) {
      // Anchor leafKey-bearing cells; otherwise consume from the running cursor.
      let start = cursor;
      if (cell.leafKey != null) {
        const found = leaves.findIndex((l) => l.key === cell.leafKey);
        if (found >= 0) start = found;
      }
      const end = start + cell.colSpan - 1;
      if (cell.colSpan > 1) {
        const required = measureHeader(cell.text) + padX + 2 * spannerGap;
        let spanned = 0;
        for (let k = start; k <= end && k < colW.length; k++) spanned += colW[k]!;
        if (required > spanned) {
          const add = (required - spanned) / cell.colSpan;
          for (let k = start; k <= end && k < colW.length; k++) colW[k]! += add;
        }
      }
      cursor = end + 1;
    }
  }

  // ---- Stub width = max(group labels, row labels + indent) + padding. ----
  // With stub_nowrap the longest label must fit on one line — same natural-width computation,
  // but the renderers add `white-space:nowrap` so it isn't clipped.
  let stubNatural = measureHeader(model.stubHeader);
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
  const stubWidth = opts.stubWidth != null ? opts.stubWidth : stubNatural + padX;

  // ---- Column x offsets, starting after the stub column. ----
  const colX: number[] = [];
  let x = stubWidth;
  for (const w of colW) { colX.push(x); x += w; }

  const totalWidth = stubWidth + colW.reduce((a, b) => a + b, 0);

  // ---- Leaf-header wrapping (header_max_lines): resolve the actual lines per leaf now, using the
  // final column widths, so the renderer draws exactly these. ----
  const leafLines: (string[] | null)[] = leaves.map((leaf, i) => {
    if (headerMaxLines == null || headerMaxLines <= 1) return null;
    const avail = Math.max(1, colW[i]! - padX);
    const lines = wrapToLines(leaf.label, avail, headerMaxLines, measureHeader);
    return lines.length > 1 ? lines : null;
  });
  const maxLeafLines = leafLines.reduce((m, l) => Math.max(m, l ? l.length : 1), 1);

  // ---- Header tier heights. The bottom (leaf) tier is taller to hold any wrapped lines + the
  // sublabel line; banner tiers above stay one tier tall. Non-uniform tiers mean a leaf that
  // rowSpans up through a blank tier gets the sum of the tier heights it covers. ----
  const tiers = model.headerRows.length;
  const hasSublabel = leaves.some((l) => l.sublabel != null);
  const leafTierHeight =
    tierHeight + (maxLeafLines - 1) * headerLineHeight + (hasSublabel ? sublabelLine : 0);
  const tierH: number[] = Array.from({ length: tiers }, (_, t) =>
    t === tiers - 1 ? leafTierHeight : tierHeight,
  );
  const tierY: number[] = [];
  { let acc = 0; for (const h of tierH) { tierY.push(acc); acc += h; } }
  const headerHeight = tierH.reduce((a, b) => a + b, 0);

  // ---- Header cell rects. Walk each tier left→right, accumulating colSpans to map each
  // HeaderCell to the leaf-index range it spans. A cell with `leafKey` set is anchored at that
  // exact leaf index (so blank-tier rowSpans land on the right column). Height = the sum of the
  // tier heights the cell's rowSpan covers. ----
  const header: HeaderEntry[][] = model.headerRows.map((tierCells, tier) => {
    let leafIdx = 0;
    return tierCells.map((cell) => {
      let start = leafIdx;
      if (cell.leafKey != null) {
        const found = leaves.findIndex((l) => l.key === cell.leafKey);
        if (found >= 0) start = found;
      }
      const end = start + cell.colSpan - 1; // inclusive last leaf index
      const xStart = colX[start] ?? stubWidth;
      let w = 0;
      for (let i = start; i <= end && i < colW.length; i++) w += colW[i]!;
      let h = 0;
      for (let r = 0; r < cell.rowSpan && tier + r < tiers; r++) h += tierH[tier + r]!;
      const rect: CellRect = { x: xStart, y: tierY[tier]!, w, h };
      const lines = cell.leafKey != null ? leafLines[start] : null;
      leafIdx = end + 1;
      return lines ? { cell, rect, tier, lines } : { cell, rect, tier };
    });
  });

  // ---- Body rows: group entries get a full-width band (with breathing room + an optional wrapped
  // note); data rows get a stub rect + cellRects. Heights vary per entry. ----
  let y = headerHeight;
  let firstGroupSeen = false;
  const rows: RowEntry[] = model.body.map((entry) => {
    if (entry.kind === "group") {
      const isFirst = !firstGroupSeen;
      firstGroupSeen = true;
      const topGap = isFirst ? groupFirstTopGap : groupTopGap;
      const noteLines =
        entry.group.note != null
          ? wrapToLines(entry.group.note, totalWidth - NOTE_WRAP_PAD, NOTE_WRAP_MAX_LINES, measureNote)
          : [];
      const noteH = noteLines.length ? groupNoteGap + noteLines.length * groupNoteLineHeight : 0;
      const h = topGap + groupLabelLine + noteH + groupBottomPad;
      const rect: CellRect = { x: 0, y, w: totalWidth, h };
      y += h;
      return { group: entry.group, rect, noteLines, topGap, isFirst };
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

  const totalHeight = y + footnotesHeight;

  return {
    totalWidth, totalHeight,
    stubWidth, colX, colW,
    headerHeight, rowHeight,
    tierY,
    footnotesHeight,
    header, rows,
  };
}
