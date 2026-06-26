// Self-contained PNG export for table figures (option B: redraw the table as SVG and reuse the
// chart rasterizer). Composes the same title/subtitle/logo/source/notes chrome as the chart
// export (via figure-chrome), then places the pure table-body SVG (renderTableSvg) below it,
// sizing the frame to fit chrome + table.

import type { TableSpec } from "../spec/table-types.js";
import type { TidyRow } from "../data/index.js";
import { buildTableModel } from "../table/model.js";
import { layoutTable } from "../table/layout.js";
import { renderTableSvg } from "../table/render-svg.js";
import { makeMeasureText } from "../table/measure.js";
import {
  W,
  MARGIN,
  INNER_W,
  createExportRoot,
  composeTopChrome,
  bottomChromeHeight,
  composeBottomChrome,
} from "./figure-chrome.js";
import { rasterize, triggerDownload } from "./export-png.js";

// Gap (px) between the bottom of the top chrome and the top of the table body.
const BODY_TOP_GAP = 14;

/** Slug a title for a default download filename. */
function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Build a self-contained export SVG for a table: chrome (title/subtitle/logo/source/notes) plus
 * the table body redrawn as SVG. The frame width is the max of the standard content frame and
 * the natural table width; the height fits chrome + table + bottom chrome.
 */
export function buildTableExportSvg(spec: TableSpec, rows: TidyRow[]): SVGSVGElement {
  const title = spec.title ?? "";
  const subtitle = spec.subtitle ?? "";
  const source = spec.source ?? "";
  const note = Array.isArray(spec.notes) ? spec.notes.join("  ") : (spec.notes ?? "");

  // Build the model and lay it out at the standard inner content width. The table may be wider
  // (wide tables scroll on screen); the export frame grows to fit it.
  const measureText = makeMeasureText();
  const model = buildTableModel(spec, rows);
  const layout = layoutTable(model, { width: INNER_W, measureText });

  // Frame width: standard frame, widened if the table itself is wider than the inner content box.
  const width = Math.max(W, layout.totalWidth + MARGIN * 2);

  // Provisional root (height patched once known) — needed so chrome can be drawn and measured.
  const { root, bgRect } = createExportRoot(document, width, 1);

  // Top chrome → cursor at last drawn baseline; table starts a gap below it.
  const topCursor = composeTopChrome(document, root, { title, subtitle, width });
  const bodyTop = topCursor + BODY_TOP_GAP;

  // Table body SVG, positioned below the chrome and inset by the left margin.
  const bodySvg = renderTableSvg(model, layout, { document });
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
 * Export the table as a 2x-scale PNG download: build the export SVG, rasterize it on an offscreen
 * canvas, and trigger a browser download. Reuses the chart exporter's rasterize/triggerDownload.
 */
export async function exportTablePng(
  spec: TableSpec,
  rows: TidyRow[],
  opts: { filename?: string } = {},
): Promise<void> {
  const svgElement = buildTableExportSvg(spec, rows);
  const width = parseInt(svgElement.getAttribute("width") ?? String(W), 10);
  const height = parseInt(svgElement.getAttribute("height") ?? "0", 10);
  const blob = await rasterize(svgElement, width, height);
  const filename = opts.filename ?? `${slugify(spec.title) || "table"}.png`;
  triggerDownload(blob, filename);
}
