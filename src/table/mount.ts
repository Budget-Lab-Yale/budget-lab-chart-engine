// Live mount layer for table figures. Mirrors mountChart's card scaffold (header, scroll
// wrapper, source line, Data download) but uses the pure table pipeline instead of the chart
// rendering engine. Interactivity (sort, hover, sticky) is wired in Task 11.
import type { TableSpec } from "../spec/table-types.js";
import type { TidyRow } from "../data/index.js";
import type { TableModel } from "./model.js";
import { buildTableModel } from "./model.js";
import { layoutTable } from "./layout.js";
import { renderTableHtml } from "./render-html.js";
import { buildFigureHeader } from "../engine/render-live.js";
import { renderSourceLine } from "../engine/source-line.js";
import { rowsToCsvBrowser } from "../data/csv-browser.js";
import { exportTablePng } from "../embed/export-table-png.js";
import { makeMeasureText } from "./measure.js";

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

  // ---- Image (PNG) button ----
  const imgBtn = doc.createElement("button");
  imgBtn.type = "button";
  imgBtn.className = "figure-download-btn";
  imgBtn.setAttribute("aria-label", "Download image (PNG)");
  imgBtn.innerHTML = `${DOWNLOAD_ICON}<span>Image</span>`;
  const imgLabel = imgBtn.querySelector("span") as HTMLSpanElement;
  imgBtn.addEventListener("click", () => {
    const original = imgLabel.textContent ?? "Image";
    imgBtn.disabled = true;
    void exportTablePng(spec, rows, { filename: `${base}.png` })
      .then(() => {
        imgBtn.disabled = false;
      })
      .catch((err) => {
        console.error("Image download failed:", err);
        imgLabel.textContent = "Failed";
        setTimeout(() => { imgLabel.textContent = original; imgBtn.disabled = false; }, 2000);
      });
  });
  downloads.appendChild(imgBtn);

  return downloads;
}

/**
 * Wire live interactivity onto a freshly rendered table: sortable columns (within row groups),
 * column hover, and sticky classes. Called once per render — the ResizeObserver re-render in
 * mountTable replaces the table DOM, so this re-runs against the new elements each time. All
 * state is per-call and tied to the live elements, so no listeners leak across re-renders.
 */
function attachTableInteractivity(table: HTMLTableElement, model: TableModel, spec: TableSpec): void {
  // ---- Sticky classes ----
  // The first column (row labels) pins during horizontal scroll when opted in.
  if (spec.sticky?.firstColumn) {
    table.classList.add("tbl-table--sticky-first");
  }
  // Inter-tier header rules are off by default; opt in via spec.header_tier_rules.
  if (spec.header_tier_rules) {
    table.classList.add("tbl-table--header-tier-rules");
  }

  // ---- Tag leaf header cells with data-col ----
  // render-html doesn't carry a key on header cells, so walk the model's header lattice
  // alongside the DOM thead and stamp data-col onto the <th> that owns each leaf.
  const headerTrs = Array.from(table.querySelectorAll("thead tr"));
  const leafHeaderEls = new Map<string, HTMLTableCellElement>();
  model.headerRows.forEach((tierCells, tierIdx) => {
    const tr = headerTrs[tierIdx];
    if (!tr) return;
    // The DOM tier may begin with the stub corner cell (only on the first tier); the corner
    // carries class tbl-table-stub-header and is not part of model.headerRows.
    const cells = Array.from(tr.children).filter(
      (el) => !el.classList.contains("tbl-table-stub-header"),
    ) as HTMLTableCellElement[];
    tierCells.forEach((mCell, i) => {
      const el = cells[i];
      if (el && mCell.leafKey != null) {
        el.setAttribute("data-col", mCell.leafKey);
        leafHeaderEls.set(mCell.leafKey, el);
      }
    });
  });

  // ---- Column hover (event delegation; robust across re-renders) ----
  // Escape for use inside a double-quoted attribute selector (CSS.escape is absent in jsdom).
  // TODO: this minimal escaper only handles `"` and `\`; real browsers should prefer CSS.escape.
  const escAttr = (s: string): string => s.replace(/["\\]/g, "\\$&");
  const colCells = (key: string): HTMLElement[] =>
    Array.from(table.querySelectorAll(`[data-col="${escAttr(key)}"]`));
  const colKeyOf = (target: EventTarget | null): string | null => {
    const el = target instanceof Element ? target.closest("[data-col]") : null;
    return el ? el.getAttribute("data-col") : null;
  };
  table.addEventListener("pointerover", (ev) => {
    const key = colKeyOf(ev.target);
    if (key == null) return;
    for (const c of colCells(key)) c.classList.add("is-col-hover");
  });
  table.addEventListener("pointerout", (ev) => {
    const key = colKeyOf(ev.target);
    if (key == null) return;
    for (const c of colCells(key)) c.classList.remove("is-col-hover");
  });

  // ---- Sort ----
  if (!spec.sort) return;

  const tbodyEl = table.querySelector("tbody");
  if (!tbodyEl) return;
  const tbody: HTMLTableSectionElement = tbodyEl;

  // Capture the original tbody child order once so the "none" state can be restored exactly.
  const originalOrder = Array.from(tbody.children) as HTMLElement[];

  // Per-leaf numeric value lookup: rowLabel -> value, built from the model body. Sort reads
  // the model value (authoritative) rather than parsing rendered cell text.
  const leafIndex = new Map(model.leaves.map((l, i) => [l.key, i]));

  // sort state per column key: undefined = none, "asc", "desc".
  let activeKey: string | null = null;
  let activeDir: "asc" | "desc" | null = null;

  function valueFor(rowEl: HTMLElement, leafIdx: number): number | null {
    const label = rowEl.getAttribute("data-row");
    if (label == null) return null;
    // Find the model body row by label (data rows carry their label). Group rows have no data-row.
    for (const entry of model.body) {
      if (entry.kind === "row" && entry.row.label === label) {
        return entry.row.cells[leafIdx]?.value ?? null;
      }
    }
    return null;
  }

  function applySort(): void {
    if (activeKey == null || activeDir == null) {
      // Restore original order.
      tbody.replaceChildren(...originalOrder);
      return;
    }
    const leafIdx = leafIndex.get(activeKey);
    if (leafIdx == null) return;
    const dir = activeDir === "asc" ? 1 : -1;

    // Partition tbody children into runs of data rows separated by group rows (boundaries).
    // Sort each run stably in place, leaving group rows fixed.
    const children = Array.from(tbody.children) as HTMLElement[];
    const ordered: HTMLElement[] = [];
    let run: HTMLElement[] = [];
    const flush = (): void => {
      if (run.length === 0) return;
      // Stable sort: decorate with original index to break ties deterministically.
      const decorated = run.map((el, i) => ({ el, i, v: valueFor(el, leafIdx) }));
      decorated.sort((a, b) => {
        // Null values sort to the end regardless of direction.
        if (a.v == null && b.v == null) return a.i - b.i;
        if (a.v == null) return 1;
        if (b.v == null) return -1;
        if (a.v === b.v) return a.i - b.i;
        return (a.v - b.v) * dir;
      });
      for (const d of decorated) ordered.push(d.el);
      run = [];
    };
    for (const el of children) {
      if (el.classList.contains("tbl-table-group")) {
        flush();
        ordered.push(el); // group boundary stays in place
      } else {
        run.push(el);
      }
    }
    flush();
    tbody.replaceChildren(...ordered);
  }

  for (const [key, th] of leafHeaderEls) {
    th.classList.add("tbl-table-sortable");
    th.setAttribute("role", "button");
    th.tabIndex = 0;
    th.style.cursor = "pointer";
    const onActivate = (): void => {
      // Cycle this column: none -> asc -> desc -> none. Switching columns starts at asc.
      if (activeKey !== key) {
        activeKey = key;
        activeDir = "asc";
      } else if (activeDir === "asc") {
        activeDir = "desc";
      } else if (activeDir === "desc") {
        activeKey = null;
        activeDir = null;
      } else {
        activeDir = "asc";
      }
      // Reflect state on headers for CSS + a11y.
      for (const [k, el] of leafHeaderEls) {
        if (k === activeKey && activeDir != null) {
          el.setAttribute("aria-sort", activeDir === "asc" ? "ascending" : "descending");
          el.classList.add("is-sorted");
          el.classList.toggle("is-sorted-asc", activeDir === "asc");
          el.classList.toggle("is-sorted-desc", activeDir === "desc");
        } else {
          el.removeAttribute("aria-sort");
          el.classList.remove("is-sorted", "is-sorted-asc", "is-sorted-desc");
        }
      }
      applySort();
    };
    th.addEventListener("click", onActivate);
    th.addEventListener("keydown", (ev) => {
      const e = ev as KeyboardEvent;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onActivate();
      }
    });
  }
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

  // Footnote definition list lives OUTSIDE the horizontal-scroll wrapper (appended to the card
  // after it) so it stays put during horizontal scroll instead of sliding sideways with the data.
  // Created here for a stable position (after the scroll wrapper, before the source line) but only
  // attached to the card when the model actually has footnotes.
  const fnBlock = doc.createElement("div");
  fnBlock.className = "tbl-table-footnotes";

  const measureText = makeMeasureText();

  /** Render (or re-render) the table at the given width, then re-wire interactivity. */
  function draw(width: number): void {
    const model = buildTableModel(spec, rows);
    const layout = layoutTable(model, {
      width,
      measureText,
      ...(spec.stub_width != null ? { stubWidth: spec.stub_width } : {}),
      ...(spec.stub_nowrap != null ? { stubNowrap: spec.stub_nowrap } : {}),
      ...(spec.column_width != null ? { columnWidth: spec.column_width } : {}),
      ...(spec.header_max_lines != null ? { headerMaxLines: spec.header_max_lines } : {}),
    });
    const table = renderTableHtml(model, layout, doc, spec);
    canvasScroll.replaceChildren(table);
    // Footnote definition list (spec §8) — rebuilt each draw into the card-level block, which is
    // attached only when there are footnotes (so an empty block never appears in the DOM). It is
    // inserted right after the scroll wrapper so it sits above the source line.
    fnBlock.replaceChildren();
    if (model.footnotes.length > 0) {
      for (const fn of model.footnotes) {
        const line = doc.createElement("div");
        const sup = doc.createElement("sup");
        sup.textContent = fn.marker;
        line.appendChild(sup);
        line.appendChild(doc.createTextNode(` ${fn.text}`));
        fnBlock.appendChild(line);
      }
      if (fnBlock.parentNode == null) canvasScroll.insertAdjacentElement("afterend", fnBlock);
    } else if (fnBlock.parentNode != null) {
      fnBlock.remove();
    }
    // The ResizeObserver re-render replaces the table DOM, so interactivity (which holds
    // references to the live elements) must be re-attached against the fresh table each time.
    attachTableInteractivity(table, model, spec);
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
