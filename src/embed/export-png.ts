// Pure SVG composition + rasterization for PNG export
// Port of C:\dev\GitHub\budget-lab-interactives\tools\ai-labor-market-tracker\export-image.js

import type { ChartSpec } from "../spec/types.js";
import type { TidyRow } from "../data/index.js";
import { renderChart } from "../engine/index.js";
import { TBL } from "../engine/theme.js";
import { LOGO_DATA_URL, FIGTREE_FONT_FACE, LOGO_ASPECT } from "./assets.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// Layout constants — fixed 720-wide content area, matching the live render default.
const W = 720;
const MARGIN = 32;
const INNER_W = W - MARGIN * 2;
const LOGO_W = 130;
const LOGO_H = LOGO_W / LOGO_ASPECT;
const SCALE = 2;

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

function drawLegend(
  root: SVGElement,
  items: Array<{ label: string; color: string | undefined; dashed: boolean }>,
  firstBaseline: number,
): number {
  const legendFont = `${W_BODY} 13px ${FONT}`;
  const SW = 22;
  const GAP = 6;
  const ITEM_GAP = 18;
  const ROW_H = 20;
  let x = MARGIN;
  let y = firstBaseline;

  for (const item of items) {
    const color = item.color ?? NAVY;
    const itemW = SW + GAP + measureText(item.label, legendFont);
    if (x > MARGIN && x + itemW > MARGIN + INNER_W) {
      x = MARGIN;
      y += ROW_H;
    }
    const cy = y - 4;
    if (item.dashed) {
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
 * Pure — no canvas, no async, no external resources.
 * The returned SVGSVGElement can be serialized and rasterized.
 */
export function buildExportSvg(
  spec: ChartSpec,
  rows: TidyRow[],
  opts: { width?: number } = {},
): SVGSVGElement {
  const contentW = opts.width ?? W;
  const innerW = contentW - MARGIN * 2;

  // Pre-render at a dummy height to get legend items and axis title.
  const meta = renderChart(spec, rows, { width: innerW });
  const legendItems = meta.legendItems ?? [];
  const xAxisTitle = meta.xAxisTitle ?? "";

  const title = spec.title ?? "";
  const subtitle = spec.subtitle ?? "";
  const note = spec.note ?? "";
  const source = spec.source ?? "";

  // -- Measure top chrome to compute chart height --

  const titleFont = `${W_BOLD} 22px ${FONT}`;
  const titleLines = wrapText(title, titleFont, innerW - LOGO_W - 24);
  const titleFirstBaseline = MARGIN + 22;
  // Each title line uses lineHeight 28
  let cursor =
    titleFirstBaseline + Math.max(0, titleLines.length - 1) * 28;

  if (subtitle) {
    cursor += 24 + Math.max(0, wrapText(subtitle, `${W_SEMI} 14px ${FONT}`, innerW).length - 1) * 19;
  }
  if (legendItems.length) {
    cursor += 26; // legend offset
  }
  const chartTop = cursor + 14;

  // Bottom chrome
  const noteLines = note
    ? wrapText(note, `${W_BODY} 11px ${FONT}`, innerW)
    : [];
  let bottomH = 0;
  if (xAxisTitle) bottomH += 14;
  if (noteLines.length) bottomH += 18 + (noteLines.length - 1) * 15;
  if (source) bottomH += note ? 15 : 18;
  bottomH += MARGIN - 15;

  const TOTAL_H = 750;
  const chartHeight = Math.max(160, TOTAL_H - chartTop - bottomH);

  // --- Build the SVG DOM ---

  const root = svgEl("svg", {
    xmlns: SVG_NS,
    width: contentW,
    height: TOTAL_H,
  }) as SVGSVGElement;

  // Embedded font face
  const defs = svgEl("defs");
  const style = svgEl("style");
  style.textContent = FIGTREE_FONT_FACE;
  defs.appendChild(style);
  root.appendChild(defs);

  // White background
  root.appendChild(
    svgEl("rect", {
      x: 0,
      y: 0,
      width: contentW,
      height: TOTAL_H,
      fill: "#FFFFFF",
    }),
  );

  // Eyebrow
  if (spec.eyebrow) {
    root.appendChild(
      textEl(MARGIN, titleFirstBaseline - 30, spec.eyebrow.toUpperCase(), {
        size: 11,
        weight: W_BODY,
        fill: MUTED,
      }),
    );
  }

  // Title lines
  drawLines(root, titleLines, MARGIN, titleFirstBaseline, 28, {
    size: 22,
    weight: W_BOLD,
    fill: NAVY,
  });

  // Logo — top-right, baseline aligned with first title line
  const logoY = titleFirstBaseline - LOGO_H * 0.87;
  const logoEl = svgEl("image", {
    x: contentW - MARGIN - LOGO_W,
    y: logoY,
    width: LOGO_W,
    height: LOGO_H,
    href: LOGO_DATA_URL,
  });
  root.appendChild(logoEl);

  // Subtitle
  if (subtitle) {
    cursor = drawLines(
      root,
      wrapText(subtitle, `${W_SEMI} 14px ${FONT}`, innerW),
      MARGIN,
      titleFirstBaseline + titleLines.length * 28 - 28 + 24,
      19,
      { size: 14, weight: W_SEMI, fill: MUTED },
    );
  }

  // Legend
  if (legendItems.length) {
    drawLegend(root, legendItems, chartTop - 14 - 26 + 26);
  }

  // Chart SVG — rendered at the precise height left after chrome
  const { svg: chartSvg } = renderChart(spec, rows, {
    width: innerW,
    height: chartHeight,
  });
  chartSvg.setAttribute("x", String(MARGIN));
  chartSvg.setAttribute("y", String(chartTop));
  chartSvg.setAttribute("width", String(innerW));
  chartSvg.setAttribute("height", String(chartHeight));
  root.appendChild(chartSvg);

  // Bottom chrome
  let by = chartTop + chartHeight;
  if (xAxisTitle) {
    by += 14;
    root.appendChild(
      textEl(contentW / 2, by, xAxisTitle, {
        size: 12,
        weight: W_BODY,
        fill: AXIS,
        anchor: "middle",
      }),
    );
  }
  if (noteLines.length) {
    by = drawLines(root, noteLines, MARGIN, by + 18, 15, {
      size: 11,
      weight: W_BODY,
      fill: MUTED,
    });
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

  return root as SVGSVGElement;
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
  const width = parseInt(svgElement.getAttribute("width") ?? "720", 10);
  const height = parseInt(svgElement.getAttribute("height") ?? "750", 10);
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
