// Live mount layer for table figures. Mirrors mountChart's card scaffold (header, scroll
// wrapper, source line, Data download) but uses the pure table pipeline instead of the chart
// rendering engine. Interactivity (sort, hover, sticky) is wired in Task 11.
import type { TableSpec } from "../spec/table-types.js";
import type { TidyRow } from "../data/index.js";
import { buildTableModel } from "./model.js";
import { layoutTable } from "./layout.js";
import { renderTableHtml } from "./render-html.js";
import { buildFigureHeader } from "../engine/render-live.js";
import { renderSourceLine } from "../engine/source-line.js";
import { rowsToCsvBrowser } from "../data/csv-browser.js";

// Tray-with-down-arrow glyph — same as in render-live.ts, inlined to avoid a cross-module
// private-symbol dependency.
const DOWNLOAD_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">' +
  '<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" ' +
  'stroke-linejoin="round" d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13h10"/></svg>';

export interface MountTableOptions {
  spec: TableSpec;
  rows: TidyRow[];
  /** Initial render width (used before the container is measured). */
  width?: number;
  /** Eyebrow line above the title (e.g. "Table 1"). Supplied at mount time, not from the spec. */
  eyebrow?: string;
  /** Override the Data download filename slug. */
  downloadName?: string;
}

/**
 * Build a canvas `measureText` function that uses a cached 2D context when available
 * (real browsers) and falls back to a character-count estimate when canvas/context is
 * absent (jsdom, SSR). The fallback is `s.length * fontPx * 0.6`.
 */
function makeMeasureText(): (s: string, fontPx: number, weight: number) => number {
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    const canvas = document.createElement("canvas");
    ctx = canvas.getContext("2d");
  } catch {
    // Ignore — canvas unavailable (jsdom default config).
  }
  return (s: string, fontPx: number, weight: number): number => {
    if (ctx) {
      try {
        ctx.font = `${weight} ${fontPx}px Figtree, sans-serif`;
        return ctx.measureText(s).width;
      } catch {
        // Fall through to estimate if measureText somehow fails.
      }
    }
    return s.length * fontPx * 0.6;
  };
}

/** Data (CSV) download button for the table source line. */
function buildTableDownloadActions(
  doc: Document,
  spec: TableSpec,
  rows: TidyRow[],
  slugOverride?: string,
): HTMLElement {
  // Derive a filename slug from the spec title or the override.
  const base = slugOverride ?? spec.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const downloads = doc.createElement("div");
  downloads.className = "figure-downloads";

  // ---- Data (CSV) button ----
  const dataBtn = doc.createElement("button");
  dataBtn.type = "button";
  dataBtn.className = "figure-download-btn";
  dataBtn.setAttribute("aria-label", "Download data (CSV)");
  dataBtn.innerHTML = `${DOWNLOAD_ICON}<span>Data</span>`;
  const dataLabel = dataBtn.querySelector("span") as HTMLSpanElement;
  dataBtn.addEventListener("click", () => {
    const original = dataLabel.textContent ?? "Data";
    dataBtn.disabled = true;
    try {
      const csv = rowsToCsvBrowser(rows);
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = doc.createElement("a");
      a.href = url;
      a.download = `${base}.csv`;
      doc.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      console.error("Data download failed:", err);
      dataLabel.textContent = "Failed";
      setTimeout(() => { dataLabel.textContent = original; dataBtn.disabled = false; }, 2000);
      return;
    }
    dataBtn.disabled = false;
  });
  downloads.appendChild(dataBtn);

  // TODO (Task 12): Add Image (PNG) button here once exportTablePng is implemented.
  // const imgBtn = buildImageButton(doc, spec, rows, base);
  // downloads.appendChild(imgBtn);

  return downloads;
}

/**
 * Mount a live, interactive-ready table card into `container`. Returns a teardown function
 * that disconnects observers and removes the card.
 *
 * Card structure:
 *   div.figure-card
 *     div.figure-header            eyebrow + title/logo + subtitle
 *     div.figure-canvas-scroll     horizontal scroll wrapper (contains the <table>)
 *       table.tbl-table
 *     div.figure-meta              note + source + Data download button
 */
export function mountTable(container: HTMLElement, opts: MountTableOptions): () => void {
  const { spec, rows } = opts;
  const doc = container.ownerDocument;

  const card = doc.createElement("div");
  card.className = "figure-card";

  // Header: eyebrow, title+logo, subtitle (reused from render-live, now exported).
  buildFigureHeader(card, doc, spec, opts.eyebrow);

  // Scroll wrapper isolates horizontal overflow to the table region.
  const canvasScroll = doc.createElement("div");
  canvasScroll.className = "figure-canvas-scroll";
  card.appendChild(canvasScroll);

  const measureText = makeMeasureText();

  /** Render (or re-render) the table at the given width. */
  function draw(width: number): void {
    const model = buildTableModel(spec, rows);
    const layout = layoutTable(model, { width, measureText });
    const table = renderTableHtml(model, layout, doc);
    canvasScroll.replaceChildren(table);
  }

  // Initial render — use the provided width, the container's current width, or a default.
  const initialWidth = opts.width ?? (container.clientWidth || 720);
  draw(initialWidth);

  // Source/notes footer with Data download.
  const note = Array.isArray(spec.notes) ? spec.notes.join("\n") : spec.notes;
  renderSourceLine(card, {
    note,
    source: spec.source,
    actions: buildTableDownloadActions(doc, spec, rows, opts.downloadName),
  });

  container.appendChild(card);

  // Re-render on width change via ResizeObserver. Guard for environments without it (jsdom).
  let ro: ResizeObserver | undefined;
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => {
      const w = card.clientWidth;
      if (w > 0) draw(w);
    });
    ro.observe(card);
  }

  return () => {
    ro?.disconnect();
    card.remove();
  };
}
