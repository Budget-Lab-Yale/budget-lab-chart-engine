// Shared SVG "chrome" for self-contained figure exports (charts and tables): the
// title (+ logo), subtitle, notes, and source line that frame a figure body. Extracted from
// export-png.ts so the chart and table PNG exporters draw identical chrome and cannot drift.
//
// Pure — no canvas, no async, no external resources. The body (chart or table) is positioned
// between the top chrome and the bottom chrome by the caller, using the offsets returned here.

import { TBL } from "../engine/theme.js";
import { LOGO_DATA_URL, FIGTREE_FONT_FACE, LOGO_ASPECT } from "./assets.js";

export const SVG_NS = "http://www.w3.org/2000/svg";
export const XLINK_NS = "http://www.w3.org/1999/xlink";

// Layout tokens — match the AI Labor Market Tracker export exactly.
export const W = 1000;
export const H = 750;
export const MARGIN = 40; // outer padding (all sides)
export const INNER_W = W - MARGIN * 2; // 920
export const LOGO_W = 150;
export const LOGO_H = LOGO_W / LOGO_ASPECT; // 37.5 (logo viewBox is 216×54 = 4:1)
export const LOGO_BASELINE_FRAC = 0.87; // wordmark baseline within the logo box
export const SCALE = 2;

// Typography weights (matching styles.ts Figtree weight scale).
export const W_BODY = 500;
export const W_SEMI = 700;
export const W_BOLD = 800;

export const FONT = TBL.font;
export const NAVY = TBL.color.navy;
export const MUTED = TBL.color.muted;
export const BODY = TBL.color.text;
export const AXIS = TBL.color.axis;
export const HEADING = TBL.color.heading;

// ---------------------------------------------------------------------------
// SVG helpers
// ---------------------------------------------------------------------------

export function svgEl(
  doc: Document,
  name: string,
  attrs: Record<string, string | number> = {},
): SVGElement {
  const el = doc.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

export function textEl(
  doc: Document,
  x: number,
  y: number,
  str: string,
  opts: { size: number; weight?: number; fill?: string; anchor?: string },
): SVGElement {
  const { size, weight = 400, fill = HEADING, anchor = "start" } = opts;
  const t = svgEl(doc, "text", {
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

export function measureText(text: string, font: string): number {
  if (!_measureCtx) {
    const canvas = document.createElement("canvas");
    _measureCtx = canvas.getContext("2d");
  }
  if (!_measureCtx) return text.length * 8; // fallback
  _measureCtx.font = font;
  return _measureCtx.measureText(text).width;
}

export function wrapText(text: string, font: string, maxWidth: number): string[] {
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

export function drawLines(
  doc: Document,
  root: SVGElement,
  lines: string[],
  x: number,
  firstBaseline: number,
  lineHeight: number,
  opt: { size: number; weight?: number; fill?: string; anchor?: string },
): number {
  let by = firstBaseline;
  for (const line of lines) {
    root.appendChild(textEl(doc, x, by, line, opt));
    by += lineHeight;
  }
  return lines.length ? by - lineHeight : firstBaseline;
}

// ---------------------------------------------------------------------------
// Root + defs (background + font-face) — shared scaffold for an export SVG.
// ---------------------------------------------------------------------------

/**
 * Create the export root <svg> with the @font-face <style> in <defs> and a white background
 * rect (returned so the caller can patch its height if the frame extends). The body is drawn
 * between top and bottom chrome by the caller.
 */
export function createExportRoot(
  doc: Document,
  width: number,
  height: number,
): { root: SVGSVGElement; bgRect: SVGElement } {
  const root = svgEl(doc, "svg", {
    xmlns: SVG_NS,
    "xmlns:xlink": XLINK_NS,
    width,
    height,
  }) as SVGSVGElement;

  const defs = svgEl(doc, "defs");
  const style = svgEl(doc, "style");
  style.textContent = FIGTREE_FONT_FACE;
  defs.appendChild(style);
  root.appendChild(defs);

  const bgRect = svgEl(doc, "rect", { x: 0, y: 0, width, height, fill: "#FFFFFF" });
  root.appendChild(bgRect);

  return { root, bgRect };
}

// ---------------------------------------------------------------------------
// Top chrome: title (+ logo) and subtitle.
// ---------------------------------------------------------------------------

/**
 * Draw the title (wrapped, navy, bold), the right-flush logo, and the optional subtitle into
 * `root`. Returns the y cursor at the last drawn baseline (the caller adds its own gap before
 * the body / legend). `width` is the full frame width (logo is flush to its right margin).
 */
export function composeTopChrome(
  doc: Document,
  root: SVGElement,
  opts: { title: string; subtitle?: string; width?: number },
): number {
  const width = opts.width ?? W;
  const innerW = width - MARGIN * 2;
  const title = opts.title ?? "";
  const subtitle = opts.subtitle ?? "";

  // Title (+ logo): title first line baseline at MARGIN + 22.
  const titleFirstBaseline = MARGIN + 22;
  const titleLines = wrapText(title, `${W_BOLD} 22px ${FONT}`, innerW - LOGO_W - 24);
  let cursor = drawLines(doc, root, titleLines, MARGIN, titleFirstBaseline, 28, {
    size: 22,
    weight: W_BOLD,
    fill: NAVY,
  });

  // Logo: right edge flush with the content-right bound; baseline shared with the title's first
  // line. Set both href and xlink:href so it rasterizes across browsers.
  const logoY = titleFirstBaseline - LOGO_H * LOGO_BASELINE_FRAC;
  const logoEl = svgEl(doc, "image", {
    x: width - MARGIN - LOGO_W,
    y: logoY,
    width: LOGO_W,
    height: LOGO_H,
    href: LOGO_DATA_URL,
  });
  logoEl.setAttributeNS(XLINK_NS, "href", LOGO_DATA_URL);
  root.appendChild(logoEl);

  if (subtitle) {
    cursor = drawLines(doc, root, wrapText(subtitle, `${W_SEMI} 14px ${FONT}`, innerW), MARGIN, cursor + 24, 19, {
      size: 14,
      weight: W_SEMI,
      fill: MUTED,
    });
  }
  return cursor;
}

// ---------------------------------------------------------------------------
// Bottom chrome: note + source.
// ---------------------------------------------------------------------------

/**
 * The vertical space the bottom chrome (note + source) will occupy below the body, so the
 * caller can reserve it. Mirrors the drawing logic in `composeBottomChrome`. Does NOT include
 * the x-axis title (chart-specific) — that is reserved by the chart exporter separately.
 */
export function bottomChromeHeight(opts: { note?: string; source?: string; width?: number }): number {
  const width = opts.width ?? W;
  const innerW = width - MARGIN * 2;
  const note = opts.note ?? "";
  const source = opts.source ?? "";
  const noteLines = note ? wrapText(note, `${W_BODY} 11px ${FONT}`, innerW) : [];
  const sourceLines = source ? wrapText(`Source: ${source}`, `${W_BODY} 11px ${FONT}`, innerW) : [];
  let bottomH = 0;
  if (noteLines.length) bottomH += 18 + (noteLines.length - 1) * 15;
  if (sourceLines.length) bottomH += (note ? 15 : 18) + (sourceLines.length - 1) * 15;
  bottomH += MARGIN - 15; // bottom padding
  return bottomH;
}

/**
 * Draw the note (wrapped) and the "Source: …" line starting at baseline cursor `by` (the bottom
 * of the body). Returns the final baseline used.
 */
export function composeBottomChrome(
  doc: Document,
  root: SVGElement,
  by: number,
  opts: { note?: string; source?: string; width?: number },
): number {
  const width = opts.width ?? W;
  const innerW = width - MARGIN * 2;
  const note = opts.note ?? "";
  const source = opts.source ?? "";
  const noteLines = note ? wrapText(note, `${W_BODY} 11px ${FONT}`, innerW) : [];

  if (noteLines.length) {
    by = drawLines(doc, root, noteLines, MARGIN, by + 18, 15, { size: 11, weight: W_BODY, fill: MUTED });
  }
  if (source) {
    by += note ? 15 : 18;
    // Wrap the whole "Source: …" string to the content width; the "Source: " prefix stays bold on
    // the first line (the rest of that line, and any continuation lines, are regular weight).
    const PREFIX = "Source: ";
    const sourceLines = wrapText(`${PREFIX}${source}`, `${W_BODY} 11px ${FONT}`, innerW);
    sourceLines.forEach((ln, i) => {
      const g = svgEl(doc, "text", {
        x: MARGIN,
        y: by + i * 15,
        fill: MUTED,
        "font-family": FONT,
        "font-size": 11,
        "font-weight": W_BODY,
        "text-anchor": "start",
      });
      if (i === 0 && ln.startsWith(PREFIX)) {
        const pfx = svgEl(doc, "tspan", { "font-weight": W_SEMI });
        pfx.textContent = PREFIX;
        g.appendChild(pfx);
        g.appendChild(doc.createTextNode(ln.slice(PREFIX.length)));
      } else {
        g.textContent = ln;
      }
      root.appendChild(g);
    });
    by += (sourceLines.length - 1) * 15;
  }
  return by;
}
