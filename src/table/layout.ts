// Pure table geometry. Given a `TableModel` and a `measureText` callback, compute the pixel
// layout (column widths, stub width, header/body rects) so the HTML and SVG renderers can share
// an identical layout. No Date/random — fully deterministic for a given model + measureText.
//
// All text wrapping (leaf-header lines, group notes) is resolved HERE using the caller's
// measureText, and the resulting line arrays are stored on the layout — so the SVG renderer draws
// exactly the lines this module measured, and the two cannot disagree on line counts (which would
// otherwise mismatch the reserved height and overlap neighboring rows).
import type { TableModel, HeaderCell, BodyRow, RowGroup } from "./model";
import type { TableSpec, ColumnAlign } from "../spec/table-types";
import { ownValue } from "../spec/own-key";
import { TBL } from "../engine/theme";
import { richWidth, hasBreak, hasMath, splitBreaks, splitRichWords } from "./richtext";

export interface LayoutOptions {
  measureText: (s: string, fontPx: number, weight: number) => number;
  /** Fixed px width for the stub column (overrides the computed width). */
  stubWidth?: number;
  /** Fixed px width for data columns: a single number (all leaves) or per-leaf-key map. */
  columnWidth?: number | Record<string, number>;
  /** Allow body data cells to wrap within their column width: `true` (all leaves) or a per-leaf-key
   *  map. Pairs with columnWidth to cap the width; without a cap the column sizes to its natural
   *  (widest-segment) width and nothing wraps. */
  columnWrap?: boolean | Record<string, boolean>;
  /** Wrap bottom-tier (leaf) header labels to at most N lines. */
  headerMaxLines?: number;
  /** Minimum px width for the stub column (a floor; or the wrap target when stubWrap is set). */
  stubMinWidth?: number;
  /** Allow stub (row-label) cells to wrap, shrinking the column toward stubMinWidth. */
  stubWrap?: boolean;
  /** Stretch the table to this total width by scaling the data columns proportionally (the stub
   *  keeps its width). Aligns multi-pane sub-tables to a shared width, and fills a narrow table's
   *  PNG frame. Ignored when ≤ the natural width. */
  fillWidth?: number;
}
export interface CellRect { x: number; y: number; w: number; h: number; }
export interface HeaderEntry { cell: HeaderCell; rect: CellRect; tier: number; lines?: string[]; }
export type RowEntry =
  | { row: BodyRow; rect: CellRect; cellRects: CellRect[]; stubLines?: string[]; cellLines?: (string[] | undefined)[] }
  | {
      group: RowGroup; rect: CellRect; noteLines: string[]; topGap: number; isFirst: boolean;
      /** Lines of the group label when it has a `\\` break (absent for a one-line label). */
      labelLines?: number;
    };
export interface TableLayout {
  totalWidth: number; totalHeight: number;
  stubWidth: number; colX: number[]; colW: number[];        // per leaf
  headerHeight: number; rowHeight: number;
  tierY: number[];                  // y offset of each header tier (length = tier count)
  footnotesHeight: number;          // reserved height for the footnote list below the body (0 if none)
  /** Lines in every sublabel block when some sublabel has a `\\` break (absent otherwise). */
  sublabelLines?: number;
  /** The footnote list as drawn, one entry per line (absent when there are no footnotes). */
  footnoteLines?: string[];
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
// The weights body cells render at LIVE (styles.ts --tw-body / --tw-bold on .is-emphasis), heavier
// than the 400 / 700 the export draws. Used only for the word floor, which must hold in both.
const liveBodyWeight = 500;
const liveEmphasisWeight = 800;
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
const groupNoteGap = 7;
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
export const STUB_LINE_HEIGHT = 16; // per-line height for a wrapped stub label
// Horizontal inset used for wrapping group notes to the table width (mirrors render-svg PAD_X*2).
const NOTE_WRAP_PAD = 16;
const NOTE_WRAP_MAX_LINES = 4;

/** Soft-wrap without a line cap (wrapSegment's cap makes its last line absorb the overflow). */
const UNLIMITED_LINES = 99;
const ELLIPSIS = "\u2026";

/** Lines a string draws on when only its hard breaks split it (1 when it has none). */
export function breakLineCount(s: string): number {
  return hasBreak(s) ? splitBreaks(s).length : 1;
}

/** Keep the first `maxLines` lines and end the last with an ellipsis that fits `maxWidth`, as the
 *  live -webkit-line-clamp does. The line is cut by characters; a line with math is cut by whole
 *  words, since a character cut could split a math delimiter. */
function clampWithEllipsis(lines: string[], maxLines: number, maxWidth: number, measure: (s: string) => number): string[] {
  const kept = lines.slice(0, maxLines);
  const fits = (s: string) => measure(s + ELLIPSIS) <= maxWidth;
  let cut = kept[maxLines - 1]!.trimEnd();
  if (!fits(cut)) {
    if (hasMath(cut)) {
      const words = splitRichWords(cut);
      while (words.length > 1 && !fits(words.join(" "))) words.pop();
      cut = words.join(" ");
    } else {
      const chars = Array.from(cut);
      while (chars.length > 1 && !fits(chars.join("").trimEnd())) chars.pop();
      cut = chars.join("").trimEnd();
    }
  }
  kept[maxLines - 1] = cut + ELLIPSIS;
  return kept;
}

/** The footnote list as drawn, one entry per line. Each footnote is `marker text`; a `\\` in it
 *  starts a new line, and with `wrap` a line also soft-wraps to `wrap.maxWidth`. A footnote with
 *  neither stays the single `marker text` line it always was. */
export function footnoteListLines(
  footnotes: Array<{ marker: string; text: string }>,
  wrap?: { maxWidth: number; measure: (s: string) => number },
): string[] {
  return footnotes.flatMap((fn) => {
    const s = `${fn.marker} ${fn.text}`;
    const lines = wrap ? wrapToLines(s, wrap.maxWidth, UNLIMITED_LINES, wrap.measure) : splitBreaks(s);
    return hasBreak(s) ? lines.map((l) => l.trim()) : lines;
  });
}

/** Split on hard breaks (`\\`) first — each segment is an independent line that soft-wraps within
 * itself — then greedily word-wrap each segment via `wrapSegment`. Hard breaks are always honored;
 * `maxLines` caps only the soft-wrapping WITHIN a segment. */
function wrapToLines(s: string, maxWidth: number, maxLines: number, measure: (s: string) => number): string[] {
  const segments = splitBreaks(s);
  if (segments.length === 1) return wrapSegment(s, maxWidth, maxLines, measure);
  return segments.flatMap((seg) => wrapSegment(seg, maxWidth, maxLines, measure));
}

/** Greedy word-wrap into at most `maxLines` lines that each fit `maxWidth` px (via `measure`).
 * The final line absorbs any overflow rather than dropping words, so no text is lost. Returns a
 * single-element array when the text fits on one line. */
function wrapSegment(s: string, maxWidth: number, maxLines: number, measure: (s: string) => number): string[] {
  if (maxLines <= 1 || measure(s) <= maxWidth) return [s];
  const words = splitRichWords(s);
  const lines: string[] = [];
  let cur = "";
  let consumed = 0; // words already pushed onto `lines`
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const next = cur ? `${cur} ${w}` : w;
    if (measure(next) <= maxWidth || cur === "") {
      cur = next;
    } else {
      lines.push(cur);
      consumed = i;
      cur = w;
      if (lines.length === maxLines - 1) break;
    }
  }
  const rest = words.slice(consumed).join(" ");
  if (rest) lines.push(rest);
  return lines.length ? lines.slice(0, maxLines) : [s];
}

/** Widest unbreakable word among the cells of leaf `i` that soft-wrap — the narrowest the column
 *  can be without a word being split (live, overflow-wrap: break-word) or overflowing (export). */
function widestWrappingWord(
  bodyRows: BodyRow[], i: number, wrapsAll: boolean, measure: (s: string, weight: number) => number,
): number {
  let widest = 0;
  for (const row of bodyRows) {
    const cell = row.cells[i];
    if (!cell || cell.text === "" || !(wrapsAll || cell.isText)) continue;
    // Measured at the heavier of the two renderings (live CSS vs the export's SVG), so the word fits both.
    const weight = cell.emphasis ? liveEmphasisWeight : liveBodyWeight;
    for (const seg of splitBreaks(cell.text)) {
      for (const w of splitRichWords(seg)) widest = Math.max(widest, measure(w, weight));
    }
  }
  return widest;
}

/** The author's column_align for a leaf (keyed by leaf VALUE, like column_width), or undefined for
 *  the type-driven default. Shared by the HTML and SVG renderers so both align identically. */
export function columnAlignOf(spec: TableSpec | undefined, leafValue: string): ColumnAlign | undefined {
  const ca = spec?.column_align;
  if (ca == null) return undefined;
  return typeof ca === "string" ? ca : ownValue(ca, leafValue);
}

/** header_max_lines as the layout and the live clamp use it: a whole number of lines, at least 1.
 *  The schema accepts any number; below 1 (or not finite) means no clamp, and a fraction is floored
 *  (the live -webkit-line-clamp takes an integer). */
export function normalizeMaxLines(n: number | undefined): number | undefined {
  return n != null && Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
}

/** Translate the per-table spec sizing fields into LayoutOptions (shared by the HTML and PNG
 * paths so they size columns identically). */
export function layoutOptionsFromSpec(spec: TableSpec): Partial<LayoutOptions> {
  return {
    ...(spec.stub_width != null ? { stubWidth: spec.stub_width } : {}),
    ...(spec.column_width != null ? { columnWidth: spec.column_width } : {}),
    ...(spec.column_wrap != null ? { columnWrap: spec.column_wrap } : {}),
    ...(normalizeMaxLines(spec.header_max_lines) != null ? { headerMaxLines: normalizeMaxLines(spec.header_max_lines)! } : {}),
    ...(spec.stub_min_width != null ? { stubMinWidth: spec.stub_min_width } : {}),
    // stub_nowrap wins over stub_wrap, as it does in the live table (render-html) and the SVG clip.
    ...(spec.stub_wrap != null ? { stubWrap: spec.stub_wrap && spec.stub_nowrap !== true } : {}),
  };
}

export function layoutTable(model: TableModel, opts: LayoutOptions): TableLayout {
  const { measureText } = opts;
  const leaves = model.leaves;
  const headerMaxLines = normalizeMaxLines(opts.headerMaxLines);
  // Rich-aware measurers: text without math delimiters measures exactly as before, so plain
  // tables size identically; math markup measures at its RENDERED width (not the raw source).
  const measureHeader = (s: string) => richWidth(s, headerFontPx, headerWeight, measureText);
  const measureNote = (s: string) => richWidth(s, noteFontPx, bodyWeight, measureText);

  // Body rows only (group entries don't have per-leaf cells).
  const bodyRows = model.body
    .filter((b): b is { kind: "row"; row: BodyRow } => b.kind === "row")
    .map((b) => b.row);

  // Resolve a per-leaf width override from opts.columnWidth (single number or per-key map).
  // The map is author-facing: authors write the raw leaf VALUE (leaf.lastValue), never a
  // collision-suffixed key like "presub~1" — a width keyed by a repeated leaf value applies to
  // every leaf sharing that value (same convention as header_labels / format.columns).
  const colWidthOverride = (leafValue: string): number | undefined => {
    const cw = opts.columnWidth;
    if (cw == null) return undefined;
    if (typeof cw === "number") return cw;
    return ownValue(cw, leafValue);
  };

  // Resolve whether a leaf's body cells wrap (opts.columnWrap: true for all, or a per-leaf-value
  // map). Keyed by leaf VALUE like columnWidth, so a repeated value wraps every column sharing it.
  const colWrapEnabled = (leafValue: string): boolean => {
    const cw = opts.columnWrap;
    if (cw == null) return false;
    if (typeof cw === "boolean") return cw;
    return ownValue(cw, leafValue) === true;
  };

  // ---- Per-leaf natural width = max(label, sublabel, every body cell text) + padding. ----
  // When header_max_lines is set, the leaf header label is allowed to WRAP, so it does NOT force
  // the column wide enough for the full label (only the sublabel + body cells do). A per-leaf
  // columnWidth override always wins.
  const measureBodyText = (s: string, weight: number) => richWidth(s, bodyFontPx, weight, measureText);
  const colW = leaves.map((leaf, i) => {
    const override = colWidthOverride(leaf.lastValue);
    if (override != null) {
      // A cap narrower than a wrapping cell's widest word would split that word mid-way on screen
      // and run it into the next column in the export, so the cap floors at that word.
      const word = widestWrappingWord(bodyRows, i, colWrapEnabled(leaf.lastValue), measureBodyText);
      // Rounded up: the browser compares the same width, and a sub-pixel shortfall would wrap it.
      return word > 0 ? Math.max(override, Math.ceil(word) + padX) : override;
    }
    let natural = headerMaxLines != null ? 0 : measureHeader(leaf.label);
    if (leaf.sublabel != null) {
      natural = Math.max(natural, richWidth(leaf.sublabel, headerFontPx, bodyWeight, measureText));
    }
    for (const row of bodyRows) {
      const cell = row.cells[i];
      if (cell) natural = Math.max(natural, richWidth(cell.text, bodyFontPx, bodyWeight, measureText));
    }
    return natural + padX;
  });

  // ---- Banner fit: a banner (colSpan>1) whose text is wider than the columns it spans widens
  // them. Required width = text + padX + 2*spannerGap (room for the flanking rules). If that
  // exceeds the spanned leaves' total colW, distribute the deficit evenly across them. ----
  for (const tierCells of model.headerRows) {
    for (const cell of tierCells) {
      const start = cell.start;
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
        richWidth(b.group.label, bodyFontPx, headerWeight, measureText) + b.group.level * INDENT_STEP,
      );
    } else {
      stubNatural = Math.max(
        stubNatural,
        richWidth(b.row.label, bodyFontPx, bodyWeight, measureText) + b.row.level * INDENT_STEP,
      );
    }
  }
  // Widest single (unbreakable) word among row labels — the narrowest the stub can wrap to without
  // a word overflowing its line. Only needed when wrapping.
  let widestWord = 0;
  if (opts.stubWrap) {
    for (const b of model.body) {
      if (b.kind !== "row") continue;
      // Measure words per hard-break segment so the `\\` token itself is never counted as a word.
      for (const seg of splitBreaks(b.row.label)) {
        for (const w of seg.split(/\s+/).filter(Boolean)) {
          widestWord = Math.max(widestWord, richWidth(w, bodyFontPx, bodyWeight, measureText) + b.row.level * INDENT_STEP);
        }
      }
    }
  }
  // Stub width:
  // - fixed stub_width wins outright;
  // - with stub_wrap, shrink toward stub_min_width so long labels wrap (never below the widest
  //   word, so no word overflows; a min ≥ the natural width simply means nothing wraps);
  // - otherwise size to the longest label, floored at stub_min_width.
  const naturalStubW = stubNatural + padX;
  const stubWidth =
    opts.stubWidth != null
      ? opts.stubWidth
      : opts.stubWrap
        ? Math.max(opts.stubMinWidth ?? 0, widestWord + padX)
        : Math.max(naturalStubW, opts.stubMinWidth ?? 0);

  // ---- fillWidth: stretch the table to a shared total by widening the DATA columns only (the stub
  // stays put). Used to align multi-pane sub-tables, which pin the stub to a shared width and then
  // fill — so both the stub column and the right edge line up across panes. ----
  const dataNatural = colW.reduce((a, b) => a + b, 0);
  if (opts.fillWidth != null && dataNatural > 0) {
    const targetData = opts.fillWidth - stubWidth;
    if (targetData > dataNatural) {
      const f = targetData / dataNatural;
      for (let i = 0; i < colW.length; i++) colW[i]! *= f;
    }
  }

  // ---- Column x offsets, starting after the stub column. ----
  const colX: number[] = [];
  let x = stubWidth;
  for (const w of colW) { colX.push(x); x += w; }

  const totalWidth = stubWidth + colW.reduce((a, b) => a + b, 0);

  // ---- Leaf-header wrapping: resolve the actual lines per leaf now, using the final column widths,
  // so the renderer draws exactly these. Soft-wrapping needs header_max_lines; a hard break (`\\`)
  // always splits, even without it (each segment stays on one line). ----
  // header_max_lines mirrors the live clamp (-webkit-line-clamp on .tbl-table-header-clamp): the
  // label wraps at the column width and only the first N lines show, the Nth ending in an ellipsis
  // when more text follows. A label that fits in N lines wraps exactly as it always has.
  const leafLines: (string[] | null)[] = leaves.map((leaf, i) => {
    if (headerMaxLines == null && !hasBreak(leaf.label)) return null;
    const avail = Math.max(1, colW[i]! - padX);
    let lines: string[];
    if (headerMaxLines != null) {
      const all = wrapToLines(leaf.label, avail, UNLIMITED_LINES, measureHeader);
      lines = all.length > headerMaxLines ? clampWithEllipsis(all, headerMaxLines, avail, measureHeader) : all;
    } else {
      lines = wrapToLines(leaf.label, avail, 1, measureHeader);
    }
    return lines.length > 1 || lines[0] !== leaf.label ? lines : null;
  });
  const maxLeafLines = leafLines.reduce((m, l) => Math.max(m, l ? l.length : 1), 1);

  // ---- Header tier heights. The bottom (leaf) tier is taller to hold any wrapped lines + the
  // sublabel line; banner tiers above stay one tier tall. Non-uniform tiers mean a leaf that
  // rowSpans up through a blank tier gets the sum of the tier heights it covers. ----
  const tiers = model.headerRows.length;
  const hasSublabel = leaves.some((l) => l.sublabel != null);
  // A `\\` in a sublabel stacks its lines under the leaf labels: every sublabel line gets a
  // sublabel line of height, and all leaves share the deepest block, as they share a label baseline.
  // Break-free sublabels keep the single line they always had.
  const maxSublabelLines = leaves.reduce((m, l) => Math.max(m, l.sublabel != null ? breakLineCount(l.sublabel) : 1), 1);
  const sublabelH = hasSublabel ? sublabelLine * maxSublabelLines : 0;
  const leafTierHeight = tierHeight + (maxLeafLines - 1) * headerLineHeight + sublabelH;
  const tierH: number[] = Array.from({ length: tiers }, (_, t) =>
    t === tiers - 1 ? leafTierHeight : tierHeight,
  );
  // A `\\` in a banner (any non-leaf header cell) needs one header line per extra line. A one-tier
  // cell grows its own tier; a cell spanning several tiers (a blank tier absorbed from below) takes
  // only what its tiers do not already give it, on its top tier. One-tier cells go first, so a
  // spanning cell sees their growth. Break-free banners never enter this loop.
  const brokenBanners = model.headerRows
    .flatMap((cells, tier) => cells.map((cell) => ({ cell, tier })))
    .filter(({ cell }) => cell.leafKey == null && hasBreak(cell.text))
    .sort((a, b) => a.cell.rowSpan - b.cell.rowSpan);
  for (const { cell, tier } of brokenBanners) {
    const need = tierHeight + (breakLineCount(cell.text) - 1) * headerLineHeight;
    let covered = 0;
    for (let r = 0; r < cell.rowSpan && tier + r < tiers; r++) covered += tierH[tier + r]!;
    if (need > covered) tierH[tier]! += need - covered;
  }
  // A `\\` in the corner (stub_header): the corner bottom-aligns with the leaf labels and spans
  // every tier, so it grows the leaf tier only by what the whole header cannot already hold. Its
  // first line then sits no higher than a one-tier leaf label's first line.
  const cornerLines = breakLineCount(model.stubHeader);
  if (cornerLines > 1) {
    const need = tierHeight + sublabelH + (cornerLines - 1) * headerLineHeight;
    const have = tierH.reduce((a, b) => a + b, 0);
    if (need > have) tierH[tiers - 1]! += need - have;
  }
  const tierY: number[] = [];
  { let acc = 0; for (const h of tierH) { tierY.push(acc); acc += h; } }
  const headerHeight = tierH.reduce((a, b) => a + b, 0);

  // ---- Header cell rects. Each HeaderCell spans leaves [start, start + colSpan - 1] (`start`
  // comes from the model, so cells after a skipped, absorbed leaf land on their own columns).
  // Height = the sum of the tier heights the cell's rowSpan covers. ----
  const header: HeaderEntry[][] = model.headerRows.map((tierCells, tier) => {
    return tierCells.map((cell) => {
      const start = cell.start;
      const end = start + cell.colSpan - 1; // inclusive last leaf index
      const xStart = colX[start] ?? stubWidth;
      let w = 0;
      for (let i = start; i <= end && i < colW.length; i++) w += colW[i]!;
      let h = 0;
      for (let r = 0; r < cell.rowSpan && tier + r < tiers; r++) h += tierH[tier + r]!;
      const rect: CellRect = { x: xStart, y: tierY[tier]!, w, h };
      const lines = cell.leafKey != null ? leafLines[start] : null;
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
      // A `\\` in the group label: each extra line adds a body line (the note moves down with it).
      const labelLines = breakLineCount(entry.group.label);
      const h = topGap + groupLabelLine + (labelLines - 1) * STUB_LINE_HEIGHT + noteH + groupBottomPad;
      const rect: CellRect = { x: 0, y, w: totalWidth, h };
      y += h;
      const groupEntry: Extract<RowEntry, { group: RowGroup }> = { group: entry.group, rect, noteLines, topGap, isFirst };
      if (labelLines > 1) groupEntry.labelLines = labelLines;
      return groupEntry;
    }
    // Row height grows to fit the tallest wrapped content: the row label (soft-wrapped when
    // stub_wrap is on, hard-broken on `\\` regardless) and any data cell that wraps — text columns
    // and column_wrap columns soft-wrap to their width; every cell hard-breaks on `\\`.
    const measureBody = (s: string) => richWidth(s, bodyFontPx, bodyWeight, measureText);
    let maxLines = 1;
    let stubLines: string[] | undefined;
    if (opts.stubWrap || hasBreak(entry.row.label)) {
      const avail = Math.max(1, stubWidth - padX - entry.row.level * INDENT_STEP);
      const lines = wrapToLines(entry.row.label, avail, opts.stubWrap ? 99 : 1, measureBody);
      if (lines.length > 1) { stubLines = lines; maxLines = Math.max(maxLines, lines.length); }
    }
    let cellLines: (string[] | undefined)[] | undefined;
    entry.row.cells.forEach((cell, i) => {
      if (cell.text === "") return;
      const softWrap = cell.isText || colWrapEnabled(leaves[i]!.lastValue);
      if (!softWrap && !hasBreak(cell.text)) return;
      const lines = wrapToLines(cell.text, Math.max(1, colW[i]! - padX), softWrap ? 99 : 1, measureBody);
      if (lines.length > 1) {
        if (!cellLines) cellLines = leaves.map(() => undefined);
        cellLines[i] = lines;
        maxLines = Math.max(maxLines, lines.length);
      }
    });
    const h = maxLines > 1 ? maxLines * STUB_LINE_HEIGHT + (rowHeight - STUB_LINE_HEIGHT) : rowHeight;
    const rowRect: CellRect = { x: 0, y, w: stubWidth, h };
    const cellRects: CellRect[] = leaves.map((_, i) => ({ x: colX[i]!, y, w: colW[i]!, h }));
    y += h;
    const rowEntry: Extract<RowEntry, { row: BodyRow }> = { row: entry.row, rect: rowRect, cellRects };
    if (stubLines) rowEntry.stubLines = stubLines;
    if (cellLines) rowEntry.cellLines = cellLines;
    return rowEntry;
  });

  // Footnote list height: a top gap plus one line per drawn footnote line (0 if there are none).
  const footnoteLines = model.footnotes.length > 0 ? footnoteListLines(model.footnotes) : undefined;
  const footnotesHeight = footnoteLines ? FOOTNOTE_TOP_GAP + footnoteLines.length * FOOTNOTE_LINE_HEIGHT : 0;

  const totalHeight = y + footnotesHeight;

  return {
    totalWidth, totalHeight,
    stubWidth, colX, colW,
    headerHeight, rowHeight,
    tierY,
    footnotesHeight,
    ...(maxSublabelLines > 1 ? { sublabelLines: maxSublabelLines } : {}),
    ...(footnoteLines ? { footnoteLines } : {}),
    header, rows,
  };
}
