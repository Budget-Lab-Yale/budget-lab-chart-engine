// Self-contained PNG export for table figures (option B: redraw the table as SVG and reuse the
// chart rasterizer). Composes the same title/subtitle/logo/source/notes chrome as the chart
// export (via figure-chrome), then places the pure table-body SVG (renderTableSvg) below it,
// sizing the frame to fit chrome + table. Multi-pane specs stack one sub-table per pane.

import type { TableSpec } from "../spec/table-types.js";
import type { TidyRow } from "../data/index.js";
import { buildTableModel, applyCollapse } from "../table/model.js";
import { layoutTable, layoutOptionsFromSpec } from "../table/layout.js";
import { renderTableSvg } from "../table/render-svg.js";
import { makeMeasureText } from "../table/measure.js";
import { layoutPanes } from "../table/panes.js";
import {
  W,
  MARGIN,
  INNER_W,
  HEADING,
  MUTED,
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

// Pane subheading geometry (multi-pane).
const PANE_TITLE_SIZE = 14;
const PANE_TITLE_RISE = 16; // baseline drop from the cursor to the subheading
const PANE_TITLE_GAP = 8; // gap from the subheading down to its table
const PANE_GAP = 22; // gap between one pane's table and the next pane's subheading

// Figure-level footnote list geometry.
const FN_TOP_GAP = 10;
const FN_LINE = 16;
const FN_FONT = 11;

/** Slug a title for a default download filename. */
function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Options threading live view state into the export build. */
export interface TableExportOptions {
  /** Collapsed group keys (groupKeyToken values) from the live table; the export drops the
   *  collapsed groups' descendant rows (their headers remain, drawn with a collapsed caret). */
  collapsed?: string[];
}

/**
 * Build a self-contained export SVG for a table: chrome (title/subtitle/logo/source/notes) plus
 * the table body redrawn as SVG. The frame width is the max of the standard content frame and
 * the natural table width; the height fits chrome + table + bottom chrome.
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
  // (wide tables scroll on screen); the export frame grows to fit it. Collapsed groups (live view
  // state) are filtered out of the model BEFORE layout, so the exported frame shrinks to fit and
  // the drawn rows match what the user sees on screen.
  const measureText = makeMeasureText();
  let model = buildTableModel(spec, rows);
  if (exportOpts.collapsed && exportOpts.collapsed.length > 0) {
    model = applyCollapse(model, new Set(exportOpts.collapsed));
  }
  const layout = layoutTable(model, { width: INNER_W, measureText, ...layoutOptionsFromSpec(spec) });

  // Frame width: standard frame, widened if the table itself is wider than the inner content box.
  const width = Math.max(MIN_TABLE_FRAME, layout.totalWidth + MARGIN * 2);

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
  composeBottomChrome(document, root, by, { note, source, width });

  // Final frame height = body bottom + reserved bottom-chrome space.
  const height = Math.round(by + bottomChromeHeight({ note, source, width }));
  root.setAttribute("height", String(height));
  bgRect.setAttribute("height", String(height));

  return root;
}

/**
 * Multi-pane export: one sub-table per pane, stacked vertically, each under its subheading. All
 * panes are stretched to a shared width so their left/right edges align. Footnotes are collected
 * across panes and listed once at the figure level (above the source line).
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
  // view) are filtered out of each pane model before layout.
  const collapsedKeys =
    exportOpts.collapsed && exportOpts.collapsed.length > 0 ? new Set(exportOpts.collapsed) : undefined;
  const laid = layoutPanes(spec, rows, measureText, true, collapsedKeys);
  const sharedTableW = Math.max(...laid.map((l) => l.layout.totalWidth));

  // Figure-level footnotes (spec defines them once; the same set applies to every pane).
  const figFootnotes = spec.footnotes
    ? Object.entries(spec.footnotes).map(([marker, text]) => ({ marker, text }))
    : [];

  const width = Math.max(MIN_TABLE_FRAME, sharedTableW + MARGIN * 2);
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

  // Figure-level footnote list.
  if (figFootnotes.length) {
    cursor += FN_TOP_GAP;
    for (const fn of figFootnotes) {
      cursor += FN_LINE;
      root.appendChild(textEl(document, MARGIN, cursor, `${fn.marker} ${fn.text}`, { size: FN_FONT, fill: MUTED }));
    }
  }

  const by = cursor;
  composeBottomChrome(document, root, by, { note, source, width });
  const height = Math.round(by + bottomChromeHeight({ note, source, width }));
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
  const svgElement = buildTableExportSvg(spec, rows, { collapsed: opts.collapsed ?? [] });
  const width = parseInt(svgElement.getAttribute("width") ?? String(W), 10);
  const height = parseInt(svgElement.getAttribute("height") ?? "0", 10);
  const blob = await rasterize(svgElement, width, height);
  const filename = opts.filename ?? `${slugify(spec.title) || "table"}.png`;
  triggerDownload(blob, filename);
}
