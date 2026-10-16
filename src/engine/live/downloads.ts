// The Data (CSV) and Image (PNG) download buttons on a live card's source line. Moved verbatim
// from render-live.ts.
import type { ChartSpec } from "../../spec/types.js";
import type { RenderHooks } from "../../spec/hooks.js";
import { resolveTitleText } from "../../spec/title.js";
import type { TidyRow } from "../../data/index.js";
import { rowsToCsv } from "../../data/csv-browser.js";
import { exportChartPng } from "../../embed/export-png.js";

// Tray-with-down-arrow glyph — inlined so the bundle stays self-contained.
const DOWNLOAD_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">' +
  '<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" ' +
  'stroke-linejoin="round" d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13h10"/></svg>';

/** Convert a chart title to a kebab-case filename slug. */
function titleToSlug(title: string | undefined): string {
  if (!title) return "chart";
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** The chart's folder slug, taken from the page URL (charts are served at `…/<chart-folder>/`).
 *  Used for download filenames — far tidier than a slugified title. Falls back to the title slug
 *  when the last path segment looks like a file (e.g. a local `index.html` preview). */
function downloadSlug(spec: ChartSpec): string {
  try {
    const segs = location.pathname.split("/").filter(Boolean);
    const last = segs[segs.length - 1];
    // Served at a folder URL (…/F1_revenue_headline/) → that folder is the slug.
    if (last && !/\./.test(last)) return last;
    // Opened as a file (…/F1_revenue_headline/preview.html) → use the PARENT folder as the slug, so
    // downloads are still named by the chart folder rather than the title.
    const parent = segs[segs.length - 2];
    if (parent && !/\./.test(parent)) return parent;
  } catch {
    /* no location (SSR/jsdom) — fall through */
  }
  // Resolve any title-selector tokens (with the defaults) BEFORE slugifying, so the slug reads
  // "…-by-sector" rather than "…-by-dimension". (Braces themselves could never leak — the
  // slugifier strips all non-alphanumerics — but the resolved label is the better name.)
  return titleToSlug(resolveTitleText(spec));
}

/** Data (CSV) + Image (PNG) download buttons for the source line. Filenames use the chart's folder
 *  slug (from the URL) rather than the title, which makes for unwieldy filenames.
 *
 *  `selections` is the mount's LIVE title-selector selections object (mutated in place by the
 *  inline-select widget's change handler), so the PNG export always prints the currently-chosen
 *  option labels in its title — not the defaults captured at mount time. */
export function buildDownloadActions(
  doc: Document,
  spec: ChartSpec,
  rows: TidyRow[],
  slugOverride?: string,
  selections?: Record<string, string>,
  hooks?: RenderHooks,
): HTMLElement {
  const base = slugOverride || downloadSlug(spec);
  const downloads = doc.createElement("div");
  downloads.className = "figure-downloads";

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
      const csv = rowsToCsv(rows);
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

  const imgBtn = doc.createElement("button");
  imgBtn.type = "button";
  imgBtn.className = "figure-download-btn";
  imgBtn.setAttribute("aria-label", "Download image (PNG)");
  imgBtn.innerHTML = `${DOWNLOAD_ICON}<span>Image</span>`;
  const imgLabel = imgBtn.querySelector("span") as HTMLSpanElement;
  imgBtn.addEventListener("click", async () => {
    const original = imgLabel.textContent ?? "Image";
    imgBtn.disabled = true;
    imgLabel.textContent = "…";
    try {
      await exportChartPng(spec, rows, { filename: `${base}.png`, selections, hooks });
    } catch (err) {
      console.error("Image export failed:", err);
      imgLabel.textContent = "Failed";
      setTimeout(() => { imgLabel.textContent = original; imgBtn.disabled = false; }, 2000);
      return;
    }
    imgLabel.textContent = original;
    imgBtn.disabled = false;
  });
  downloads.appendChild(imgBtn);

  return downloads;
}
