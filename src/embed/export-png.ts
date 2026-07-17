// Pure SVG composition + rasterization for PNG export
// Port of C:\dev\GitHub\budget-lab-interactives\tools\ai-labor-market-tracker\export-image.js

import type { ChartSpec } from "../spec/types.js";
import { resolveActiveOptionColor, resolveSelections, resolveTitleText } from "../spec/title.js";
import type { TidyRow } from "../data/index.js";
import { renderChart, renderFigure } from "../engine/index.js";
import type { FigureRenderResult } from "../engine/index.js";
import { sharedColumnWidths, horizontalBarChartHeight } from "../engine/figure.js";
import { resolveColor } from "../engine/palette.js";
import { symbolPathD } from "../engine/symbols.js";
import {
  SVG_NS,
  W,
  H,
  MARGIN,
  INNER_W,
  SCALE,
  W_BODY,
  W_SEMI,
  FONT,
  NAVY,
  MUTED,
  BODY,
  AXIS,
  HEADING,
  svgEl as svgElDoc,
  textEl as textElDoc,
  measureText,
  wrapText,
  drawLines as drawLinesDoc,
  createExportRoot,
  composeTopChrome,
  bottomChromeHeight,
  composeBottomChrome,
} from "./figure-chrome.js";

// ---------------------------------------------------------------------------
// Document-bound wrappers (this module always draws into the global `document`).
// ---------------------------------------------------------------------------

function svgEl(name: string, attrs: Record<string, string | number> = {}): SVGElement {
  return svgElDoc(document, name, attrs);
}

function textEl(
  x: number,
  y: number,
  str: string,
  opts: { size: number; weight?: number; fill?: string; anchor?: string },
): SVGElement {
  return textElDoc(document, x, y, str, opts);
}

function drawLines(
  root: SVGElement,
  lines: string[],
  x: number,
  firstBaseline: number,
  lineHeight: number,
  opt: { size: number; weight?: number; fill?: string; anchor?: string },
): number {
  return drawLinesDoc(document, root, lines, x, firstBaseline, lineHeight, opt);
}

// Small-multiples figure layout tokens.
const PANE_CHART_H = 240; // per-pane mini-chart height — matches the live PANE_HEIGHT so the
                          // exported panes keep the same (squarer) proportion as on screen.
// Dot-plot AND bar/stacked panes render taller (matches the live render-live TALL_PANE_TYPES).
const TALL_PANE_TYPES = new Set(["dotplot", "bar", "stacked"]);
const TALL_PANE_CHART_H = 320;
const PANE_TITLE_H = 18; // per-pane title band height
const COL_GAP = 20; // horizontal gap between per-pane grid cells
const ROW_GAP = 18; // vertical gap between per-pane grid rows

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

const SHAPE_LEGEND_COLOR = "#555B66";

function drawLegend(
  root: SVGElement,
  items: Array<{ label: string; color: string | undefined; dashed: boolean; markerSymbol?: string; markerShape?: string }>,
  firstBaseline: number,
  leadingTitle?: string,
): number {
  const legendFont = `${W_BODY} 13px ${FONT}`;
  const titleFont = `${W_SEMI} 12px ${FONT}`;
  const SW = 22;
  const GAP = 6;
  const ITEM_GAP = 18;
  const ROW_H = 20;
  let x = MARGIN;
  let y = firstBaseline;

  // Optional group heading (point charts, dual encoding): a short label before the items.
  if (leadingTitle) {
    root.appendChild(textEl(x, y, leadingTitle, { size: 12, weight: W_SEMI, fill: AXIS }));
    x += measureText(leadingTitle, titleFont) + ITEM_GAP;
  }

  for (const item of items) {
    const color = item.color ?? NAVY;
    const itemW = SW + GAP + measureText(item.label, legendFont);
    if (x > MARGIN && x + itemW > MARGIN + INNER_W) {
      x = MARGIN;
      y += ROW_H;
    }
    const cy = y - 4;
    if (item.markerShape === "point") {
      // Point chart: a filled colored marker (the symbol, default circle) with no line.
      root.appendChild(
        svgEl("path", {
          d: symbolPathD(item.markerSymbol ?? "circle", 100),
          transform: `translate(${x + SW / 2},${cy})`,
          fill: color,
          stroke: "#ffffff",
          "stroke-width": 1,
        }),
      );
    } else if (item.dashed) {
      root.appendChild(
        svgEl("line", {
          x1: x,
          y1: cy,
          x2: x + SW,
          y2: cy,
          stroke: color,
          "stroke-width": 2,
          "stroke-dasharray": "5 3",
        }),
      );
    } else if (item.markerSymbol) {
      // Line + the series' marker symbol (matches the chart markers, for accessibility).
      root.appendChild(
        svgEl("line", { x1: x, y1: cy, x2: x + SW, y2: cy, stroke: color, "stroke-width": 2 }),
      );
      root.appendChild(
        svgEl("path", {
          d: symbolPathD(item.markerSymbol, 34),
          transform: `translate(${x + SW / 2},${cy})`,
          fill: color,
          stroke: "#ffffff",
          "stroke-width": 0.75,
        }),
      );
    } else if (item.markerShape === "rect" || item.markerShape === "chip") {
      // Color chip — a filled rounded square (color key), matching the live legend.
      const chip = 13;
      root.appendChild(
        svgEl("rect", { x: x + (SW - chip) / 2, y: cy - chip / 2, width: chip, height: chip, rx: 4, fill: color }),
      );
    } else {
      root.appendChild(
        svgEl("rect", { x, y: cy - 2, width: SW, height: 4, fill: color }),
      );
    }
    root.appendChild(
      textEl(x + SW + GAP, y, item.label, {
        size: 13,
        weight: W_BODY,
        fill: BODY,
      }),
    );
    x += itemW + ITEM_GAP;
  }
  return y;
}

// ---------------------------------------------------------------------------
// buildExportSvg
// ---------------------------------------------------------------------------

/**
 * Build a self-contained export SVG for the given chart spec and data rows.
 * Pure — no canvas, no async, no external resources. Fixed 1000×750 (4:3) frame, matching
 * the AILMT export. The chart fills the height left after the title/subtitle/legend chrome.
 * NOTE: the eyebrow is intentionally NOT drawn in the export (matches AILMT — the figure
 * number belongs to the publication context, not the standalone image).
 *
 * `selections` (active title-selector option ids, from the live mount) resolves any `{token}`
 * in the title to the ACTIVE option's label; omitted, tokens resolve with the spec defaults.
 * Either way the exported title is plain text — a raw braced token never prints.
 */
export function buildExportSvg(
  spec: ChartSpec,
  rows: TidyRow[],
  opts: { selections?: Record<string, string> } = {},
): SVGSVGElement {
  const isFigure = spec.small_multiples != null;
  const isSingleHorizontalBar =
    !isFigure && (spec.chartType === "bar" || spec.chartType === "stacked") && spec.orientation === "horizontal";

  // Pre-render to read legend items + axis title (rendered for real again below at the
  // computed height). For a figure the legend + x-axis title come from renderFigure (the
  // figure-level legend), not from a single chart.
  const meta = isFigure
    ? renderFigure(spec, rows, { width: INNER_W })
    : renderChart(spec, rows, { width: INNER_W });
  const legendItems = meta.legendItems ?? [];
  const shapeLegendItems = meta.shapeLegendItems ?? [];
  const hasShapeLegend = shapeLegendItems.length > 0;
  const colorLegendTitle = meta.colorLegendTitle ?? "";
  const shapeLegendTitle = meta.shapeLegendTitle ?? "";
  const xAxisTitle = meta.xAxisTitle ?? "";
  const yAxisTitle = spec.y_axis_title ?? "";

  // Title-selector tokens → the active (or default) option labels, as plain SVG text.
  const title = spec.title ? resolveTitleText(spec, opts.selections) : "";
  const subtitle = spec.subtitle ?? "";
  const note = spec.note ?? "";
  const source = spec.source ?? "";

  // Color accent feed (AILMT parity): resolve the same accent color the live single-chart mount
  // would show for these `selections`, so a downloaded PNG matches what the user sees on screen.
  // `renderFigure` (small multiples) also receives it, so a faceted chart's per-pane bars adopt the
  // active option's accent in the export just as they do live (see mountFigure in render-live.ts).
  const effectiveSelections = opts.selections ?? resolveSelections(spec);
  const rawAccent = spec.title_selectors
    ? resolveActiveOptionColor(spec.title_selectors, effectiveSelections, spec.series_colors)
    : undefined;
  const accentColor = rawAccent ? resolveColor(rawAccent) : undefined;

  const { root, bgRect } = createExportRoot(document, W, H);

  // --- top chrome: title (+ logo), subtitle ---
  let cursor = composeTopChrome(document, root, { title, subtitle, width: W });

  // --- legend(s) + y-axis title (chart-specific chrome) ---
  if (legendItems.length) {
    cursor = drawLegend(root, legendItems, cursor + 26, hasShapeLegend ? colorLegendTitle : undefined);
  }
  // Point charts with dual encoding: a second, neutral-gray SHAPE legend below the color legend.
  if (hasShapeLegend) {
    const shapeRows = shapeLegendItems.map((s) => ({
      label: s.label,
      color: SHAPE_LEGEND_COLOR,
      dashed: false,
      markerShape: "point",
      markerSymbol: s.markerSymbol,
    }));
    cursor = drawLegend(root, shapeRows, cursor + (legendItems.length ? 20 : 26), shapeLegendTitle || undefined);
  }
  // Y-axis title: a left-aligned caption just above the plot (coexists with the units subtitle).
  if (yAxisTitle) {
    cursor = drawLines(root, wrapText(yAxisTitle, `${W_SEMI} 12px ${FONT}`, INNER_W), MARGIN, cursor + 18, 16, {
      size: 12,
      weight: W_SEMI,
      fill: AXIS,
    });
  }
  const chartTop = cursor + 14;

  // Reserve the bottom-chrome height so the chart fills the rest (total == H).
  let bottomH = bottomChromeHeight({ note, source, width: W });
  if (xAxisTitle) bottomH += 14;

  // Chart region. `contentHeight` is the height occupied by the chart/figure body below
  // `chartTop`; for the single chart it fills the fixed frame, for a figure it can extend it.
  let contentHeight: number;
  if (!isFigure) {
    // Single chart: horizontal bar/stacked charts size from the shared intrinsic-height helper
    // (growing the export frame with row count); everything else fills the fixed 750 frame.
    contentHeight = isSingleHorizontalBar
      ? horizontalBarChartHeight(spec, rows)
      : Math.max(160, H - chartTop - bottomH);
    const { svg: chartSvg } = renderChart(spec, rows, {
      width: INNER_W,
      height: contentHeight,
      ...(accentColor ? { accentColor } : {}),
    });
    chartSvg.setAttribute("x", String(MARGIN));
    chartSvg.setAttribute("y", String(chartTop));
    chartSvg.setAttribute("width", String(INNER_W));
    chartSvg.setAttribute("height", String(contentHeight));
    root.appendChild(chartSvg);
  } else {
    // BOTH modes are per-pane compositions: lay the N mini-SVGs into a (cols × rows) grid,
    // each with a pane-title text above it. (Shared mode forces one y-domain across panes and
    // hides the y-tick labels on non-leftmost columns inside renderFigure; the export layout is
    // otherwise identical.) Render the panes at the exact cell width so they fill their column.
    const figMeta = meta as FigureRenderResult;
    const cols = figMeta.columns;
    const gridRows = figMeta.rows;
    const paneChartH = TALL_PANE_TYPES.has(spec.chartType) ? TALL_PANE_CHART_H : PANE_CHART_H;
    // Horizontal bar figures grow with their row count — let renderFigure compute the pane height
    // (pass undefined) and read it back from the rendered SVG for the layout math below.
    const isHorizontalBarFig = spec.chartType === "bar" && spec.orientation === "horizontal";
    const isShared = (spec.small_multiples?.mode ?? "shared") === "shared";
    // SHARED mode: unequal column widths (labeled col 0 wider, label-less cols narrower) sharing
    // one inner data width — same helper as the live grid, so the export matches the live look.
    // PER-PANE mode: equal columns, EXCEPT horizontal bars — their category gutter is asymmetric
    // (pane 0 wide, others narrow), so renderFigure sizes unequal outer widths and needs the
    // TOTAL row width (gridWidth), exactly like shared mode; the cell layout then consumes the
    // returned columnWidths.
    const shared = isShared ? sharedColumnWidths(INNER_W, cols, COL_GAP) : null;
    const equalPaneW = Math.floor((INNER_W - COL_GAP * (cols - 1)) / cols);
    const useGridW = isShared || isHorizontalBarFig;
    const fig = useGridW
      ? renderFigure(spec, rows, { gridWidth: INNER_W, gridGap: COL_GAP, height: isHorizontalBarFig ? undefined : paneChartH, columns: cols, ...(accentColor ? { accentColor } : {}) })
      : renderFigure(spec, rows, { width: equalPaneW, height: isHorizontalBarFig ? undefined : paneChartH, columns: cols, ...(accentColor ? { accentColor } : {}) });
    // Cell width per column: shared keeps its precomputed helper widths (byte-identical to
    // before); per-pane horizontal consumes the figure's columnWidths; else equal columns.
    const figColWidths = !isShared && isHorizontalBarFig ? fig.columnWidths : undefined;
    const colWidth = (col: number): number =>
      shared?.colWidths[col] ?? figColWidths?.[col] ?? equalPaneW;
    // Cumulative left x per column (panes tile the row exactly, leaving COL_GAP between them).
    const colX: number[] = [];
    let acc = MARGIN;
    for (let c = 0; c < cols; c++) {
      colX.push(acc);
      acc += colWidth(c) + COL_GAP;
    }
    // Effective pane height: the renderFigure-computed height for horizontal bars (read from the
    // rendered SVG), else the fixed pane height.
    const effPaneH =
      isHorizontalBarFig && fig.panes[0]?.svg
        ? Number((fig.panes[0].svg as SVGSVGElement).getAttribute("height")) || paneChartH
        : paneChartH;
    const gridTop = chartTop;
    fig.panes.forEach((pane, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = colX[col]!;
      const w = colWidth(col);
      const y = gridTop + row * (PANE_TITLE_H + effPaneH + ROW_GAP);
      // Horizontal bars: align the pane title with the DATA area (offset by the pane's left gutter)
      // rather than over the category labels.
      const titleDx = isHorizontalBarFig
        ? Number((pane.svg as SVGSVGElement | undefined)?.dataset.marginLeft) || 0
        : 0;
      root.appendChild(
        textEl(x + titleDx, y + 12, pane.title, { size: 11, weight: W_SEMI, fill: HEADING }),
      );
      if (pane.svg) {
        const ps = pane.svg;
        ps.setAttribute("x", String(x));
        ps.setAttribute("y", String(y + PANE_TITLE_H));
        ps.setAttribute("width", String(w));
        ps.setAttribute("height", String(effPaneH));
        root.appendChild(ps);
      }
    });
    contentHeight =
      gridRows * (PANE_TITLE_H + effPaneH) + (gridRows - 1) * ROW_GAP;
  }

  // Figures size to their CONTENT height (chrome + the pane grid), so a short figure (e.g. a
  // single row of panes) doesn't leave a big band of whitespace below. The single chart keeps the
  // fixed 4:3 frame.
  const H_eff = isFigure || isSingleHorizontalBar ? Math.round(chartTop + contentHeight + bottomH) : H;
  if (H_eff !== H) {
    root.setAttribute("height", String(H_eff));
    bgRect.setAttribute("height", String(H_eff));
  }

  // --- bottom chrome: x-axis title (chart-specific), note, source ---
  let by = chartTop + contentHeight;
  if (xAxisTitle) {
    by += 14;
    root.appendChild(textEl(W / 2, by, xAxisTitle, { size: 12, weight: W_SEMI, fill: AXIS, anchor: "middle" }));
  }
  composeBottomChrome(document, root, by, { note, source, width: W });

  return root;
}

// ---------------------------------------------------------------------------
// rasterize + download
// ---------------------------------------------------------------------------

export async function rasterize(
  svgElement: SVGSVGElement,
  width: number,
  height: number,
): Promise<Blob> {
  const svgStr = new XMLSerializer().serializeToString(svgElement);
  const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("SVG image failed to load"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * SCALE);
    canvas.height = Math.round(height * SCALE);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get 2d context");
    ctx.scale(SCALE, SCALE);
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Export the chart as a 2x-scale PNG download.
 * Builds the publishable export SVG, rasterizes it on an offscreen canvas,
 * and triggers a browser download.
 */
export async function exportChartPng(
  spec: ChartSpec,
  rows: TidyRow[],
  opts: { filename?: string; selections?: Record<string, string> } = {},
): Promise<void> {
  const svgElement = buildExportSvg(spec, rows, { selections: opts.selections });
  const width = parseInt(svgElement.getAttribute("width") ?? String(W), 10);
  const height = parseInt(svgElement.getAttribute("height") ?? String(H), 10);
  const blob = await rasterize(svgElement, width, height);
  // Fallback filename slug: resolve title-selector tokens (defaults) before slugifying, so the
  // name reads "…-by-sector" rather than the token key. Braces themselves could never survive
  // the non-alphanumeric strip either way.
  const filename =
    opts.filename ??
    (spec.title
      ? resolveTitleText(spec)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") + ".png"
      : "chart.png");
  triggerDownload(blob, filename);
}
