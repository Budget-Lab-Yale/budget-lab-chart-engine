// Pure SVG composition + rasterization for PNG export
// Port of C:\dev\GitHub\budget-lab-interactives\tools\ai-labor-market-tracker\export-image.js

import type { ChartSpec } from "../spec/types.js";
import type { RenderHooks } from "../spec/hooks.js";
import { resolveActiveOptionColor, resolveSelections, resolveTitleText } from "../spec/title.js";
import type { TidyRow } from "../data/index.js";
import { renderChart, renderFigure } from "../engine/index.js";
import type { FigureRenderResult, LegendItem } from "../engine/index.js";
import { sharedColumnWidths, horizontalBarChartHeight, figurePaneHeight } from "../engine/figure.js";
import { resolveColor } from "../engine/palette.js";
import { SHAPE_LEGEND_COLOR } from "../engine/theme.js";
import type { SeriesHatch } from "../engine/hatch.js";
import { ICON_BOX, iconFromLegendItem, legendRowMarkupSvg, iconSvgGroup, iconWidth } from "../engine/icon.js";
import {
  W,
  H,
  MARGIN,
  INNER_W,
  SCALE,
  W_BODY,
  W_SEMI,
  FONT,
  NAVY,
  BODY,
  AXIS,
  HEADING,
  SVG_NS,
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

// Small-multiples figure layout tokens. Per-pane chart height comes from figurePaneHeight
// (engine/figure.ts) — the single source of truth shared with the live figure mount.
const PANE_TITLE_H = 18; // per-pane title band height
const COL_GAP = 20; // horizontal gap between per-pane grid cells
const ROW_GAP = 18; // vertical gap between per-pane grid rows

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function drawLegend(
  root: SVGElement,
  items: Array<{
    label: string;
    color: string | undefined;
    dashed: boolean;
    markerSymbol?: string;
    markerShape?: LegendItem["markerShape"];
    /** `series_patterns` texture, resolved upstream by the engine's legend builder. */
    hatch?: SeriesHatch;
    outlined?: boolean;
    colors?: string[];
    /** A dumbbell's hollow end — a ring, not a disc. It was absent from this type entirely, so a
     *  hollow series exported filled. */
    hollow?: boolean;
    /** Present for a genuine series/color-legend row; absent for the neutral SHAPE-legend rows
     *  (which have no series key and never invoke `legendKey`). */
    series?: string;
  }>,
  firstBaseline: number,
  leadingTitle?: string,
  /** Only `legendKey` is consumed here, and only for rows carrying `series` — see above. */
  hooks?: RenderHooks,
): number {
  const legendFont = `${W_BODY} 13px ${FONT}`;
  const titleFont = `${W_SEMI} 12px ${FONT}`;
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
    // ONE drawing. This branched nine ways and got five of them wrong against the live legend — a
    // `rect` was rounded like a chip, a `dot` had no branch at all (the stacked Total exported as a
    // navy bar), `hollow` was missing from the type so a dumbbell ring exported filled, `dashed` was
    // tested before `markerSymbol` so a dashed series with points exported unmarked, and every
    // symbol was drawn at one area. None of that could be caught by reading the export alone, which
    // is why it is no longer written here: engine/icon.ts draws it, the same call the legend makes.
    const icon = iconFromLegendItem(item);
    const swatchW = iconWidth(icon);
    const itemW = swatchW + GAP + measureText(item.label, legendFont);
    if (x > MARGIN && x + itemW > MARGIN + INNER_W) {
      x = MARGIN;
      y += ROW_H;
    }
    const cy = y - 4;
    // `rendered` is SVG markup (legendRowMarkupSvg draws from the same iconShapes(icon) the
    // group below does) -- NOT legend.ts's HTML string. `g` below is SVG-namespaced; setting its
    // innerHTML to an HTML string like legend.ts's `<span>`s creates XHTML-namespaced nodes that
    // the canvas rasterizer below (rasterize()) never paints -- correct on screen, invisible in
    // the download. `medium: "svg"` tells the hook which vocabulary is safe to return here.
    // `null`/no hook falls through to the untouched default drawing.
    const custom = item.series != null && hooks?.legendKey
      ? hooks.legendKey({
          series: item.series,
          label: item.label,
          color: item.color,
          medium: "svg",
          rendered: legendRowMarkupSvg(icon, item.label),
        })
      : null;
    if (custom != null) {
      const g = document.createElementNS(SVG_NS, "g");
      g.setAttribute("transform", `translate(${x},${cy - ICON_BOX / 2})`);
      g.setAttribute("color", NAVY);
      g.innerHTML = custom;
      root.appendChild(g);
    } else {
      const drawing = iconSvgGroup(document, icon);
      if (drawing) {
        // The primitives are in a box at the origin, so the group is placed by its top-left corner.
        drawing.setAttribute("transform", `translate(${x},${cy - ICON_BOX / 2})`);
        // A row with no colour of its own draws in `currentColor`, which the page supplies live and
        // the export has to supply itself — this frame carries no inherited text colour.
        drawing.setAttribute("color", NAVY);
        root.appendChild(drawing);
      }
      root.appendChild(
        textEl(x + swatchW + GAP, y, item.label, {
          size: 13,
          weight: W_BODY,
          fill: BODY,
        }),
      );
    }
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
  opts: { selections?: Record<string, string>; hooks?: RenderHooks } = {},
): SVGSVGElement {
  const isFigure = spec.small_multiples != null;
  const isSingleHorizontalBar =
    !isFigure && (spec.chartType === "bar" || spec.chartType === "stacked") && spec.orientation === "horizontal";

  // Pre-render to read legend items + axis title (rendered for real again below at the
  // computed height). For a figure the legend + x-axis title come from renderFigure (the
  // figure-level legend), not from a single chart.
  //
  // `afterRender` is stripped from the hooks object for THIS call only: its SVG(s) are discarded
  // (only the legend/title metadata is read below), so calling a mutating, potentially side-
  // effecting hook against them would double-fire it per export — once here on throwaway output,
  // once more below on the SVG that's actually returned. Every other hook is a pure formatter
  // (idempotent), so passing them through unchanged here is harmless.
  const metaHooks = opts.hooks?.afterRender ? { ...opts.hooks, afterRender: undefined } : opts.hooks;
  const meta = isFigure
    ? renderFigure(spec, rows, { width: INNER_W, hooks: metaHooks })
    : renderChart(spec, rows, { width: INNER_W, hooks: metaHooks });
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
    cursor = drawLegend(root, legendItems, cursor + 26, hasShapeLegend ? colorLegendTitle : undefined, opts.hooks);
  }
  // Point charts with dual encoding: a second, neutral-gray SHAPE legend below the color legend.
  if (hasShapeLegend) {
    const shapeRows = shapeLegendItems.map((s) => ({
      label: s.label,
      color: SHAPE_LEGEND_COLOR,
      dashed: false,
      markerShape: "point" as const,
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
  // `chartTop`; a figure or a single horizontal bar/stacked chart can extend past the fixed
  // frame, everything else fills it.
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
      hooks: opts.hooks,
      phase: "export",
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
    // Horizontal bar/stacked figures grow with their row count — figurePaneHeight returns
    // undefined for them, so renderFigure computes the height and we read it back from the
    // rendered SVG for the layout math below.
    const paneChartH = figurePaneHeight(spec);
    const isHorizontalBarFig =
      (spec.chartType === "bar" || spec.chartType === "stacked") && spec.orientation === "horizontal";
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
      ? renderFigure(spec, rows, { gridWidth: INNER_W, gridGap: COL_GAP, height: paneChartH, columns: cols, hooks: opts.hooks, phase: "export", ...(accentColor ? { accentColor } : {}) })
      : renderFigure(spec, rows, { width: equalPaneW, height: paneChartH, columns: cols, hooks: opts.hooks, phase: "export", ...(accentColor ? { accentColor } : {}) });
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
    // Per-pane height: read each pane's own rendered height (ragged horizontal bar/stacked facets
    // are sized individually via fig.paneHeights — see figure.ts), else the fixed pane height from
    // figurePaneHeight. Reads the rendered SVG's height attribute directly (always set by
    // renderFigure), so the `?? 240` fallback is a type-level floor that never fires in practice.
    const paneH = (i: number): number =>
      Number((fig.panes[i]?.svg as SVGSVGElement | undefined)?.getAttribute("height")) || paneChartH || 240;
    // Each grid ROW's height = the tallest pane in that row (ragged facets keep their own height
    // within the row; a busier sibling in the same row only grows the shared row band, never
    // stretches a shorter pane's own SVG). Reduces to one uniform value when every paneH(i) is
    // equal (the common case, and every non-horizontal-bar figure), matching the pre-fix math.
    const rowHeights: number[] = [];
    for (let r = 0; r < gridRows; r++) {
      let h = 0;
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (i < fig.panes.length) h = Math.max(h, paneH(i));
      }
      rowHeights.push(h);
    }
    // Cumulative top y for each row (title band + row height + gap between rows).
    const rowY: number[] = [];
    {
      let acc = chartTop;
      for (let r = 0; r < gridRows; r++) {
        rowY.push(acc);
        acc += PANE_TITLE_H + rowHeights[r]! + ROW_GAP;
      }
    }
    fig.panes.forEach((pane, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = colX[col]!;
      const w = colWidth(col);
      const y = rowY[row]!;
      const h = paneH(i);
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
        ps.setAttribute("height", String(h));
        root.appendChild(ps);
      }
    });
    contentHeight = rowHeights.reduce((s, h) => s + PANE_TITLE_H + h, 0) + (gridRows - 1) * ROW_GAP;
  }

  // Figures size to their CONTENT height (chrome + the pane grid), so a short figure (e.g. a
  // single row of panes) doesn't leave a big band of whitespace below. Single horizontal bar/
  // stacked charts do the same (their row count can outgrow the 750 frame); every other single
  // chart keeps the fixed 4:3 frame.
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
  opts: { filename?: string; selections?: Record<string, string>; hooks?: RenderHooks } = {},
): Promise<void> {
  const svgElement = buildExportSvg(spec, rows, { selections: opts.selections, hooks: opts.hooks });
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
