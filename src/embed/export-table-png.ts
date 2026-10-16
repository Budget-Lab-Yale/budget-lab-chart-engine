// Self-contained PNG export for table figures (option B: redraw the table as SVG and reuse the
// chart rasterizer). Composes the same title/subtitle/logo/source/notes chrome as the chart
// export (via figure-chrome), then places the pure table-body SVG (renderTableSvg) below it,
// sizing the frame to fit chrome + table. Multi-pane specs stack one sub-table per pane.

import type { TableSpec } from "../spec/table-types.js";
import type { TidyRow } from "../data/index.js";
import type { TableModel } from "../table/model.js";
import { buildTableModel, applyCollapse } from "../table/model.js";
import { layoutTable, layoutOptionsFromSpec, footnoteListLines, FOOTNOTE_MARKER_SIZE, FOOTNOTE_LIST_WEIGHT } from "../table/layout.js";
import type { TableLayout } from "../table/layout.js";
import { renderTableSvg, renderFootnoteLinesSvg } from "../table/render-svg.js";
import { makeMeasureText } from "../table/measure.js";
import { layoutPanes } from "../table/panes.js";
import { noteBreakLines, richWidth } from "../table/richtext.js";
import {
  W,
  MARGIN,
  HEADING,
  W_BOLD,
  createExportRoot,
  composeTopChrome,
  bottomChromeHeight,
  composeBottomChrome,
  textEl,
} from "./figure-chrome.js";
import { rasterize, triggerDownload } from "./export-png.js";

// Gap (px) between the bottom of the top chrome and the top of the table body.
const BODY_TOP_GAP = 14;

// Minimum export frame width: enough for the title column beside the right-flush logo so neither
// is cramped on a narrow table. Tables wider than this drive the frame width directly.
const MIN_TABLE_FRAME = 560;
// A table narrower than this is stretched to it, as the live table (width:100%) fills its card.
const MIN_TABLE_CONTENT = MIN_TABLE_FRAME - MARGIN * 2;

// Pane subheading geometry (multi-pane).
const PANE_TITLE_SIZE = 14;
const PANE_TITLE_RISE = 16; // baseline drop from the cursor to the subheading
const PANE_TITLE_GAP = 8; // gap from the subheading down to its table
const PANE_GAP = 22; // gap between one pane's table and the next pane's subheading

const SVG_NS = "http://www.w3.org/2000/svg";

// Figure-level footnote list geometry.
const FN_TOP_GAP = 10;
const FN_LINE = 16;
const FN_FONT = 11;

/** The table note's hard-break segments for the chrome, when it has any (`\\` in `notes`). */
function noteOpt(note: string): { noteLines?: string[] } {
  const noteLines = noteBreakLines(note);
  return noteLines ? { noteLines } : {};
}

/** Slug a title for a default download filename. */
function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Options threading live view state into the export build. */
export interface TableExportOptions {
  /** Collapsed group keys (groupKeyToken values) from the live table; the export drops the
   *  collapsed groups' descendant rows (their headers remain, drawn with a collapsed caret).
   *  OMIT (undefined) to fall back to the spec's own collapsible default states; an explicit
   *  array — including [] (fully expanded) — wins verbatim. */
  collapsed?: string[];
}

/** Keys of every group whose spec-resolved default state is collapsed — the same resolution the
 *  mount seeding uses (collapsed-list > expanded-list > default). Empty for non-collapsible
 *  specs (every group.collapsed defaults false), so applying it is a no-op there. */
function defaultCollapsedKeys(model: TableModel): Set<string> {
  const keys = new Set<string>();
  for (const b of model.body) {
    if (b.kind === "group" && b.group.collapsed) keys.add(b.group.key);
  }
  return keys;
}

/**
 * Build a self-contained export SVG for a table: chrome (title/subtitle/logo/source/notes) plus
 * the table body redrawn as SVG. The frame width is the max of the standard content frame and
 * the natural table width; a narrower table is stretched to the frame's content width. The height
 * fits chrome + table + bottom chrome.
 */
export function buildTableExportSvg(
  spec: TableSpec,
  rows: TidyRow[],
  exportOpts: TableExportOptions = {},
): SVGSVGElement {
  if (spec.pane != null) return buildMultiPaneExportSvg(spec, rows, exportOpts);

  const title = spec.title ?? "";
  const subtitle = spec.subtitle ?? "";
  const source = spec.source ?? "";
  const note = Array.isArray(spec.notes) ? spec.notes.join("  ") : (spec.notes ?? "");

  // Build the model and lay it out at the standard inner content width. The table may be wider
  // (wide tables scroll on screen); the export frame grows to fit it. Collapsed groups are
  // filtered out of the model BEFORE layout, so the exported frame shrinks to fit and the drawn
  // rows match the visible view. An explicit collapsed list (the mount's live state, including
  // an explicit [] = fully expanded) wins verbatim; when OMITTED, the export honors the spec's
  // own collapsible defaults so a direct (CLI/batch) export shows the declared default view.
  const measureText = makeMeasureText();
  let model = buildTableModel(spec, rows);
  const collapsedKeys =
    exportOpts.collapsed != null ? new Set(exportOpts.collapsed) : defaultCollapsedKeys(model);
  if (collapsedKeys.size > 0) {
    model = applyCollapse(model, collapsedKeys);
  }
  const { layout, stretched } = exportLayout(model, spec, measureText);

  // Frame width: standard frame, widened if the table itself is wider than the inner content box.
  const width = frameWidth(layout.totalWidth, stretched);

  // Provisional root (height patched once known) — needed so chrome can be drawn and measured.
  const { root, bgRect } = createExportRoot(document, width, 1);

  // Top chrome → cursor at last drawn baseline; table starts a gap below it.
  const topCursor = composeTopChrome(document, root, { title, subtitle, width });
  const bodyTop = topCursor + BODY_TOP_GAP;

  // Table body SVG, positioned below the chrome and inset by the left margin.
  const bodySvg = renderTableSvg(model, layout, { document, spec, measure: measureText });
  bodySvg.setAttribute("x", String(MARGIN));
  bodySvg.setAttribute("y", String(bodyTop));
  bodySvg.setAttribute("width", String(layout.totalWidth));
  bodySvg.setAttribute("height", String(layout.totalHeight));
  root.appendChild(bodySvg);

  // Bottom chrome below the table.
  const by = bodyTop + layout.totalHeight;
  composeBottomChrome(document, root, by, { note, ...noteOpt(note), source, width });

  // Final frame height = body bottom + reserved bottom-chrome space.
  const height = Math.round(by + bottomChromeHeight({ note, ...noteOpt(note), source, width }));
  root.setAttribute("height", String(height));
  bgRect.setAttribute("height", String(height));

  return root;
}

/** Export frame width for a table body `tableW` wide. A stretched table totals the content width
 *  only up to float rounding, so it takes the standard frame exactly; any other table keeps the
 *  frame it always had. */
function frameWidth(tableW: number, stretched: boolean): number {
  return stretched ? MIN_TABLE_FRAME : Math.max(MIN_TABLE_FRAME, tableW + MARGIN * 2);
}

/**
 * The layout a single-pane table's PNG draws. A table narrower than the frame's content width is
 * re-laid at that width. Live, every <col> carries a px width under table-layout:fixed, so the
 * browser scales the stub and each column by one factor to fill the card (author-fixed stub_width /
 * column_width included). Here the stub is pinned at its scaled width and fillWidth scales the data
 * columns by the same factor. Wrapping (stub, text cells, header_max_lines, group notes) is then
 * resolved at the wider widths, as it is live. A wider table keeps its natural layout.
 */
export function tableExportLayout(
  model: TableModel,
  spec: TableSpec,
  measureText: (s: string, fontPx: number, weight: number) => number,
): TableLayout {
  return exportLayout(model, spec, measureText).layout;
}

function exportLayout(
  model: TableModel,
  spec: TableSpec,
  measureText: (s: string, fontPx: number, weight: number) => number,
): { layout: TableLayout; stretched: boolean } {
  const natural = layoutTable(model, { measureText, ...layoutOptionsFromSpec(spec) });
  if (natural.totalWidth >= MIN_TABLE_CONTENT) return { layout: natural, stretched: false };
  const f = MIN_TABLE_CONTENT / natural.totalWidth;
  const layout = layoutTable(model, {
    measureText,
    ...layoutOptionsFromSpec(spec),
    stubWidth: natural.stubWidth * f,
    fillWidth: MIN_TABLE_CONTENT,
  });
  return { layout, stretched: true };
}

/**
 * Multi-pane export: one sub-table per pane, stacked vertically, each under its subheading. All
 * panes are stretched to a shared width, at least the frame's content width, so their left/right
 * edges align. Footnotes are collected across panes and listed once at the figure level (above the
 * source line).
 */
function buildMultiPaneExportSvg(
  spec: TableSpec,
  rows: TidyRow[],
  exportOpts: TableExportOptions = {},
): SVGSVGElement {
  const title = spec.title ?? "";
  const subtitle = spec.subtitle ?? "";
  const source = spec.source ?? "";
  const note = Array.isArray(spec.notes) ? spec.notes.join("  ") : (spec.notes ?? "");

  const measureText = makeMeasureText();
  // Panes laid out with a shared stub width and stretched to a shared total width so their left
  // edges, first columns, and right edges all align. Pane models have footnotes stripped (listed
  // once at the figure level below). Collapsed group keys (union across panes, from the live
  // view) are filtered out of each pane model before layout. When the caller passes NO collapsed
  // option, seed from the spec's collapsible defaults — resolved over a model of ALL rows, whose
  // groups superset each pane's (panes partition the rows), so every pane group gets its default.
  const explicit = exportOpts.collapsed != null ? new Set(exportOpts.collapsed) : undefined;
  const seeded = explicit ?? defaultCollapsedKeys(buildTableModel(spec, rows));
  const collapsedKeys = seeded.size > 0 ? seeded : undefined;
  // Laid out at the panes' own shared width first (as always); re-laid at the frame's content
  // width only when that is narrower.
  let laid = layoutPanes(spec, rows, measureText, true, collapsedKeys);
  const stretched = Math.max(...laid.map((l) => l.layout.totalWidth)) < MIN_TABLE_CONTENT;
  if (stretched) laid = layoutPanes(spec, rows, measureText, true, collapsedKeys, MIN_TABLE_CONTENT);
  const sharedTableW = Math.max(...laid.map((l) => l.layout.totalWidth));

  // Figure-level footnotes (spec defines them once; the same set applies to every pane).
  const figFootnotes = spec.footnotes
    ? Object.entries(spec.footnotes).map(([marker, text]) => ({ marker, text }))
    : [];

  const width = frameWidth(sharedTableW, stretched);
  const { root, bgRect } = createExportRoot(document, width, 1);

  const topCursor = composeTopChrome(document, root, { title, subtitle, width });
  let cursor = topCursor + BODY_TOP_GAP;

  laid.forEach(({ title, model, layout }, i) => {
    if (i > 0) cursor += PANE_GAP;
    if (title) {
      cursor += PANE_TITLE_RISE;
      root.appendChild(
        textEl(document, MARGIN, cursor, title, { size: PANE_TITLE_SIZE, weight: W_BOLD, fill: HEADING }),
      );
      cursor += PANE_TITLE_GAP;
    }
    const bodySvg = renderTableSvg(model, layout, { document, spec, measure: measureText });
    bodySvg.setAttribute("x", String(MARGIN));
    bodySvg.setAttribute("y", String(cursor));
    bodySvg.setAttribute("width", String(layout.totalWidth));
    bodySvg.setAttribute("height", String(layout.totalHeight));
    root.appendChild(bodySvg);
    cursor += layout.totalHeight;
  });

  // Figure-level footnote list, wrapped to the frame (live, the list wraps in the card) and drawn
  // by the same builder as the single-pane list, so math and breaks render as they do there.
  if (figFootnotes.length) {
    const lines = footnoteListLines(figFootnotes, {
      maxWidth: width - MARGIN * 2,
      measure: (s) => richWidth(s, FN_FONT, FOOTNOTE_LIST_WEIGHT, measureText),
      markerWidth: (m) => measureText(m, FOOTNOTE_MARKER_SIZE, FOOTNOTE_LIST_WEIGHT),
    });
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("class", "tbl-figure-footnotes");
    for (const t of renderFootnoteLinesSvg(document, lines, {
      x: MARGIN, firstBaselineY: cursor + FN_TOP_GAP + FN_LINE, lineHeight: FN_LINE, measure: measureText,
    })) g.appendChild(t);
    root.appendChild(g);
    cursor += FN_TOP_GAP + lines.length * FN_LINE;
  }

  const by = cursor;
  composeBottomChrome(document, root, by, { note, ...noteOpt(note), source, width });
  const height = Math.round(by + bottomChromeHeight({ note, ...noteOpt(note), source, width }));
  root.setAttribute("height", String(height));
  bgRect.setAttribute("height", String(height));

  return root;
}

/**
 * Export the table as a 2x-scale PNG download: build the export SVG, rasterize it on an offscreen
 * canvas, and trigger a browser download. Reuses the chart exporter's rasterize/triggerDownload.
 */
export async function exportTablePng(
  spec: TableSpec,
  rows: TidyRow[],
  opts: { filename?: string } & TableExportOptions = {},
): Promise<void> {
  // Preserve the undefined/[] distinction: undefined lets buildTableExportSvg seed from the
  // spec's collapsible defaults; an explicit array (the mount always passes one for collapsible
  // specs, possibly empty) is applied verbatim.
  const svgElement = buildTableExportSvg(
    spec, rows,
    opts.collapsed != null ? { collapsed: opts.collapsed } : {},
  );
  const width = parseInt(svgElement.getAttribute("width") ?? String(W), 10);
  const height = parseInt(svgElement.getAttribute("height") ?? "0", 10);
  const blob = await rasterize(svgElement, width, height);
  const filename = opts.filename ?? `${slugify(spec.title) || "table"}.png`;
  triggerDownload(blob, filename);
}
