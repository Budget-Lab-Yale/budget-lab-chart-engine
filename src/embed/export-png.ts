// Pure SVG composition + rasterization for PNG export
// Port of C:\dev\GitHub\budget-lab-interactives\tools\ai-labor-market-tracker\export-image.js

import type { ChartSpec } from "../spec/types.js";
import type { TidyRow } from "../data/index.js";
import { renderChart, renderFigure } from "../engine/index.js";
import type { FigureRenderResult } from "../engine/index.js";
import { sharedColumnWidths } from "../engine/figure.js";
import { TBL } from "../engine/theme.js";
import { symbolPathD } from "../engine/symbols.js";
import { LOGO_DATA_URL, FIGTREE_FONT_FACE, LOGO_ASPECT } from "./assets.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

// Layout tokens — match the AI Labor Market Tracker export exactly: a fixed 1000×750
// content frame (→ 2000×1500 PNG at SCALE 2), so every export shares one 4:3 frame and
// the chart fills whatever height the chrome leaves.
const W = 1000;
const H = 750;
const MARGIN = 40; // outer padding (all sides)
const INNER_W = W - MARGIN * 2; // 920
const LOGO_W = 150;
const LOGO_H = LOGO_W / LOGO_ASPECT; // 37.5 (logo viewBox is 216×54 = 4:1)
const LOGO_BASELINE_FRAC = 0.87; // wordmark baseline within the logo box
const SCALE = 2;

// Small-multiples figure layout tokens.
const PANE_CHART_H = 240; // per-pane mini-chart height — matches the live PANE_HEIGHT so the
                          // exported panes keep the same (squarer) proportion as on screen.
const PANE_TITLE_H = 18; // per-pane title band height
const COL_GAP = 20; // horizontal gap between per-pane grid cells
const ROW_GAP = 18; // vertical gap between per-pane grid rows

// Typography weights (matching styles.ts Figtree weight scale)
const W_BODY = 500;
const W_SEMI = 700;
const W_BOLD = 800;

const FONT = TBL.font;
const NAVY = TBL.color.navy;
const MUTED = TBL.color.muted;
const BODY = TBL.color.text;
const AXIS = TBL.color.axis;
const HEADING = TBL.color.heading;

// ---------------------------------------------------------------------------
// SVG helpers
// ---------------------------------------------------------------------------

function svgEl(
  name: string,
  attrs: Record<string, string | number> = {},
): SVGElement {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function textEl(
  x: number,
  y: number,
  str: string,
  opts: { size: number; weight?: number; fill?: string; anchor?: string },
): SVGElement {
  const { size, weight = 400, fill = HEADING, anchor = "start" } = opts;
  const t = svgEl("text", {
    x,
    y,
    fill,
    "font-family": FONT,
    "font-size": size,
    "font-weight": weight,
    "text-anchor": anchor,
  });
  t.textContent = str;
  return t;
}

// ---------------------------------------------------------------------------
// Text measurement — uses a canvas for accurate width
// ---------------------------------------------------------------------------

let _measureCtx: CanvasRenderingContext2D | null = null;

function measureText(text: string, font: string): number {
  if (!_measureCtx) {
    const canvas = document.createElement("canvas");
    _measureCtx = canvas.getContext("2d");
  }
  if (!_measureCtx) return text.length * 8; // fallback
  _measureCtx.font = font;
  return _measureCtx.measureText(text).width;
}

function wrapText(text: string, font: string, maxWidth: number): string[] {
  const words = String(text || "")
    .split(/\s+/)
    .filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const trial = line ? `${line} ${w}` : w;
    if (line && measureText(trial, font) > maxWidth) {
      lines.push(line);
      line = w;
    } else {
      line = trial;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

function drawLines(
  root: SVGElement,
  lines: string[],
  x: number,
  firstBaseline: number,
  lineHeight: number,
  opt: { size: number; weight?: number; fill?: string; anchor?: string },
): number {
  let by = firstBaseline;
  for (const line of lines) {
    root.appendChild(textEl(x, by, line, opt));
    by += lineHeight;
  }
  return lines.length ? by - lineHeight : firstBaseline;
}

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
    } else if (item.markerShape === "rect") {
      // Color chip — a filled rounded square (color key), matching the live legend's is-rect.
      const chip = 13;
      root.appendChild(
        svgEl("rect", { x: x + (SW - chip) / 2, y: cy - chip / 2, width: chip, height: chip, rx: 2.5, fill: color }),
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
 */
export function buildExportSvg(spec: ChartSpec, rows: TidyRow[]): SVGSVGElement {
  const isFigure = spec.small_multiples != null;

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

  const title = spec.title ?? "";
  const subtitle = spec.subtitle ?? "";
  const note = spec.note ?? "";
  const source = spec.source ?? "";

  const root = svgEl("svg", {
    xmlns: SVG_NS,
    "xmlns:xlink": XLINK_NS,
    width: W,
    height: H,
  }) as SVGSVGElement;

  const defs = svgEl("defs");
  const style = svgEl("style");
  style.textContent = FIGTREE_FONT_FACE;
  defs.appendChild(style);
  root.appendChild(defs);
  // Background rect: painted first so it stays behind everything. Its height is patched to the
  // (possibly extended) figure height once known; the single-chart path keeps the fixed H.
  const bgRect = svgEl("rect", { x: 0, y: 0, width: W, height: H, fill: "#FFFFFF" });
  root.appendChild(bgRect);

  // --- top chrome: title (+ logo), subtitle, legend ---
  const titleFirstBaseline = MARGIN + 22;
  const titleLines = wrapText(title, `${W_BOLD} 22px ${FONT}`, INNER_W - LOGO_W - 24);
  let cursor = drawLines(root, titleLines, MARGIN, titleFirstBaseline, 28, {
    size: 22,
    weight: W_BOLD,
    fill: NAVY,
  });

  // Logo: right edge flush with the content-right bound; baseline shared with the title's
  // first line. Set both href and xlink:href so it rasterizes across browsers.
  const logoY = titleFirstBaseline - LOGO_H * LOGO_BASELINE_FRAC;
  const logoEl = svgEl("image", {
    x: W - MARGIN - LOGO_W,
    y: logoY,
    width: LOGO_W,
    height: LOGO_H,
    href: LOGO_DATA_URL,
  });
  logoEl.setAttributeNS(XLINK_NS, "href", LOGO_DATA_URL);
  root.appendChild(logoEl);

  if (subtitle) {
    cursor = drawLines(root, wrapText(subtitle, `${W_SEMI} 14px ${FONT}`, INNER_W), MARGIN, cursor + 24, 19, {
      size: 14,
      weight: W_SEMI,
      fill: MUTED,
    });
  }
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
  const noteLines = note ? wrapText(note, `${W_BODY} 11px ${FONT}`, INNER_W) : [];
  let bottomH = 0;
  if (xAxisTitle) bottomH += 14;
  if (noteLines.length) bottomH += 18 + (noteLines.length - 1) * 15;
  if (source) bottomH += note ? 15 : 18;
  bottomH += MARGIN - 15; // bottom padding

  // Chart region. `contentHeight` is the height occupied by the chart/figure body below
  // `chartTop`; for the single chart it fills the fixed frame, for a figure it can extend it.
  let contentHeight: number;
  if (!isFigure) {
    // Single chart — unchanged: fills the height left after the chrome inside the 750 frame.
    contentHeight = Math.max(160, H - chartTop - bottomH);
    const { svg: chartSvg } = renderChart(spec, rows, { width: INNER_W, height: contentHeight });
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
    const isShared = (spec.small_multiples?.mode ?? "shared") === "shared";
    // SHARED mode: unequal column widths (labeled col 0 wider, label-less cols narrower) sharing
    // one inner data width — same helper as the live grid, so the export matches the live look.
    // PER-PANE mode: equal columns (unchanged).
    const shared = isShared ? sharedColumnWidths(INNER_W, cols, COL_GAP) : null;
    const equalPaneW = Math.floor((INNER_W - COL_GAP * (cols - 1)) / cols);
    const colWidth = (col: number): number => shared?.colWidths[col] ?? equalPaneW;
    // Cumulative left x per column (panes tile the row exactly, leaving COL_GAP between them).
    const colX: number[] = [];
    let acc = MARGIN;
    for (let c = 0; c < cols; c++) {
      colX.push(acc);
      acc += colWidth(c) + COL_GAP;
    }
    const fig = isShared
      ? renderFigure(spec, rows, { gridWidth: INNER_W, gridGap: COL_GAP, height: PANE_CHART_H, columns: cols })
      : renderFigure(spec, rows, { width: equalPaneW, height: PANE_CHART_H, columns: cols });
    const gridTop = chartTop;
    fig.panes.forEach((pane, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = colX[col]!;
      const w = colWidth(col);
      const y = gridTop + row * (PANE_TITLE_H + PANE_CHART_H + ROW_GAP);
      root.appendChild(
        textEl(x, y + 12, pane.title, { size: 11, weight: W_SEMI, fill: HEADING }),
      );
      if (pane.svg) {
        const ps = pane.svg;
        ps.setAttribute("x", String(x));
        ps.setAttribute("y", String(y + PANE_TITLE_H));
        ps.setAttribute("width", String(w));
        ps.setAttribute("height", String(PANE_CHART_H));
        root.appendChild(ps);
      }
    });
    contentHeight =
      gridRows * (PANE_TITLE_H + PANE_CHART_H) + (gridRows - 1) * ROW_GAP;
  }

  // Figures size to their CONTENT height (chrome + the pane grid), so a short figure (e.g. a
  // single row of panes) doesn't leave a big band of whitespace below. The single chart keeps the
  // fixed 4:3 frame.
  const H_eff = isFigure ? Math.round(chartTop + contentHeight + bottomH) : H;
  if (H_eff !== H) {
    root.setAttribute("height", String(H_eff));
    bgRect.setAttribute("height", String(H_eff));
  }

  // --- bottom chrome: x-axis title, note, source ---
  let by = chartTop + contentHeight;
  if (xAxisTitle) {
    by += 14;
    root.appendChild(textEl(W / 2, by, xAxisTitle, { size: 12, weight: W_SEMI, fill: AXIS, anchor: "middle" }));
  }
  if (noteLines.length) {
    by = drawLines(root, noteLines, MARGIN, by + 18, 15, { size: 11, weight: W_BODY, fill: MUTED });
  }
  if (source) {
    by += note ? 15 : 18;
    const g = svgEl("text", {
      x: MARGIN,
      y: by,
      fill: MUTED,
      "font-family": FONT,
      "font-size": 11,
      "font-weight": W_BODY,
      "text-anchor": "start",
    });
    const pfx = svgEl("tspan", { "font-weight": W_SEMI });
    pfx.textContent = "Source: ";
    g.appendChild(pfx);
    g.appendChild(document.createTextNode(source));
    root.appendChild(g);
  }

  return root;
}

// ---------------------------------------------------------------------------
// rasterize + download
// ---------------------------------------------------------------------------

async function rasterize(
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

function triggerDownload(blob: Blob, filename: string): void {
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
  opts: { filename?: string } = {},
): Promise<void> {
  const svgElement = buildExportSvg(spec, rows);
  const width = parseInt(svgElement.getAttribute("width") ?? String(W), 10);
  const height = parseInt(svgElement.getAttribute("height") ?? String(H), 10);
  const blob = await rasterize(svgElement, width, height);
  const filename =
    opts.filename ??
    (spec.title
      ? spec.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") + ".png"
      : "chart.png");
  triggerDownload(blob, filename);
}
