// Live mount layer for table figures. Mirrors mountChart's card scaffold (header, scroll
// wrapper, source line, Data download) but uses the pure table pipeline instead of the chart
// rendering engine. Interactivity (sort, hover, sticky) is wired in Task 11.
import type { TableSpec } from "../spec/table-types.js";
import type { TidyRow } from "../data/index.js";
import type { TableModel } from "./model.js";
import { buildTableModel } from "./model.js";
import { layoutTable, layoutOptionsFromSpec } from "./layout.js";
import { renderTableHtml } from "./render-html.js";
import { splitPanes, layoutPanes } from "./panes.js";
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

/** Data (CSV) + Image (PNG) download buttons for the table source line. `getCollapsed` (set for
 *  collapsible specs) reads the LIVE collapsed group keys at click time, so the exported PNG
 *  omits exactly the rows the user has collapsed on screen. */
function buildTableDownloadActions(
  doc: Document,
  spec: TableSpec,
  rows: TidyRow[],
  slugOverride?: string,
  getCollapsed?: () => string[],
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
    void exportTablePng(spec, rows, {
      filename: `${base}.png`,
      ...(getCollapsed ? { collapsed: getCollapsed() } : {}),
    })
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
function attachTableInteractivity(
  table: HTMLTableElement,
  model: TableModel,
  spec: TableSpec,
  onReorder?: () => void,
): void {
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
      // Collapsed rows are hidden via a DOM property on the row elements themselves, so it
      // travels with them through the reorder — this re-apply is a belt-and-suspenders sync
      // (e.g. re-stamping toggle aria-expanded) rather than a correctness requirement.
      onReorder?.();
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
    onReorder?.();
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
 * Wire collapsible row groups onto a freshly rendered table. Called each draw (like
 * attachTableInteractivity — the ResizeObserver re-render replaces the table DOM, so this
 * re-runs against the fresh elements). The `collapsed` set is OWNED BY THE CALLER's mount
 * closure and persists across re-renders; this function only reads/mutates its membership, so
 * collapse state survives the DOM replacement.
 *
 * Returns `applyVisibility` so the caller can re-run it after external DOM reorders (sort) or
 * bulk state changes (collapse-all).
 */
function attachCollapsible(
  table: HTMLTableElement,
  collapsed: Set<string>,
  onStateChange?: () => void,
): () => void {
  const groupTrs = Array.from(
    table.querySelectorAll("tbody tr.tbl-table-group[data-group-key]"),
  ) as HTMLTableRowElement[];
  const dataTrs = Array.from(
    table.querySelectorAll("tbody tr:not(.tbl-table-group)"),
  ) as HTMLTableRowElement[];

  const parentsOf = (tr: HTMLElement): string[] => {
    const raw = tr.getAttribute("data-group-parents") ?? "";
    return raw === "" ? [] : raw.split(" ");
  };

  /** Sync the DOM to the collapse set: hide any row (or nested subgroup header) with a collapsed
   *  ancestor via the `hidden` attribute (which also removes it from the a11y tree), and reflect
   *  each toggle's own state on aria-expanded + an is-collapsed class (the caret-rotation hook). */
  function applyVisibility(): void {
    for (const tr of dataTrs) {
      tr.hidden = parentsOf(tr).some((t) => collapsed.has(t));
    }
    for (const tr of groupTrs) {
      // A group header hides only when an ANCESTOR is collapsed; its own collapsed state keeps
      // the header visible (that is the affordance for expanding it again).
      tr.hidden = parentsOf(tr).some((t) => collapsed.has(t));
      const key = tr.getAttribute("data-group-key")!;
      const btn = tr.querySelector("button.tbl-table-group-toggle");
      if (btn) {
        const isCollapsed = collapsed.has(key);
        btn.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
        btn.classList.toggle("is-collapsed", isCollapsed);
      }
    }
    onStateChange?.();
  }

  for (const tr of groupTrs) {
    const key = tr.getAttribute("data-group-key")!;
    const btn = tr.querySelector("button.tbl-table-group-toggle");
    if (!btn) continue; // non-collapsible spec: plain label, nothing to wire
    btn.addEventListener("click", () => {
      if (collapsed.has(key)) collapsed.delete(key);
      else collapsed.add(key);
      applyVisibility();
    });
  }

  applyVisibility();
  return applyVisibility;
}

/**
 * The "Collapse all"/"Expand all" chrome control (single button, whole figure — all panes).
 * If ANY group is currently expanded it collapses all, else it expands all. `panes` pairs each
 * pane's live collapsed set with a getter for its current group keys (read from the live DOM so
 * a re-render is always reflected); `refresh` re-syncs every pane's row visibility.
 */
function buildCollapseAllButton(
  doc: Document,
  panes: Array<{ collapsed: Set<string>; keys: () => string[] }>,
  refresh: () => void,
): { el: HTMLButtonElement; sync: () => void } {
  const btn = doc.createElement("button");
  btn.type = "button";
  // Base marker class only; the caller adds the placement chrome ("figure-download-btn" in the
  // footer, "tbl-table-collapse-all-corner" in the stub-header corner).
  btn.className = "tbl-table-collapse-all";

  const anyExpanded = (): boolean =>
    panes.some((p) => p.keys().some((k) => !p.collapsed.has(k)));

  const sync = (): void => {
    const label = anyExpanded() ? "Collapse all" : "Expand all";
    btn.textContent = label;
    btn.setAttribute("aria-label", label);
  };

  btn.addEventListener("click", () => {
    if (anyExpanded()) {
      for (const p of panes) for (const k of p.keys()) p.collapsed.add(k);
    } else {
      for (const p of panes) p.collapsed.clear();
    }
    refresh();
    sync();
  });

  sync();
  return { el: btn, sync };
}

/** Current group keys in a rendered region (read live so a re-render is always reflected). */
function liveGroupKeys(region: HTMLElement): string[] {
  return Array.from(region.querySelectorAll("tr.tbl-table-group[data-group-key]")).map(
    (tr) => tr.getAttribute("data-group-key")!,
  );
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
  if (opts.spec.pane != null) return mountMultiPaneTable(container, opts);
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

  // ---- Collapsible state (persistent across re-renders) ----
  // The set lives in THIS closure — outside draw() — so the ResizeObserver re-render (which
  // replaces the table DOM and re-attaches everything) reads the same membership back and the
  // user's collapse state survives. Seeded ONCE from the model's resolved defaults on first draw.
  const collapsed = new Set<string>();
  let collapseSeeded = false;
  let applyVis: (() => void) | undefined; // re-applies visibility on the CURRENT table DOM
  let syncCollapseAll: (() => void) | undefined; // re-syncs the chrome button label

  /** Render (or re-render) the table at the given width, then re-wire interactivity. */
  function draw(width: number): void {
    const model = buildTableModel(spec, rows);
    const layout = layoutTable(model, { width, measureText, ...layoutOptionsFromSpec(spec) });
    const table = renderTableHtml(model, layout, doc, spec);
    canvasScroll.replaceChildren(table);
    if (spec.collapsible && !collapseSeeded) {
      collapseSeeded = true;
      for (const b of model.body) {
        if (b.kind === "group" && b.group.collapsed) collapsed.add(b.group.key);
      }
    }
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
    // The onReorder hook re-applies collapse visibility after the sort's DOM reorder.
    attachTableInteractivity(table, model, spec, () => applyVis?.());
    if (spec.collapsible) {
      applyVis = attachCollapsible(table, collapsed, () => syncCollapseAll?.());
      // Stub-header placement: the corner cell is rebuilt each draw, so re-parent the (stable)
      // control element into the fresh corner. Footer placement is handled once, below.
      if (collapsibleControl === "stub-header" && collapseAllEl) {
        table.querySelector("thead th.tbl-table-stub-header")?.appendChild(collapseAllEl);
      }
    }
  }

  // Collapse-all control: built once (the element is stable across re-renders); placement depends
  // on spec.collapsible.control (default "stub-header" = the top-left corner cell; "footer" = the
  // download action row). Declared before the initial draw so draw() can seat it in the corner.
  const collapsibleControl = spec.collapsible?.control ?? "stub-header";
  let collapseAllEl: HTMLElement | undefined;
  if (spec.collapsible) {
    const allBtn = buildCollapseAllButton(
      doc,
      [{ collapsed, keys: () => liveGroupKeys(canvasScroll) }],
      () => applyVis?.(),
    );
    syncCollapseAll = allBtn.sync;
    collapseAllEl = allBtn.el;
    allBtn.el.classList.add(
      collapsibleControl === "footer" ? "figure-download-btn" : "tbl-table-collapse-all-corner",
    );
  }

  // Initial render — use the provided width, the container's current width, or a default.
  const initialWidth = opts.width ?? (container.clientWidth || 720);
  draw(initialWidth);

  // Source/notes footer with Data download.
  const note = Array.isArray(spec.notes) ? spec.notes.join("\n") : spec.notes;
  const actions = buildTableDownloadActions(
    doc, spec, rows, opts.downloadName,
    spec.collapsible ? () => [...collapsed] : undefined,
  );
  if (collapseAllEl && collapsibleControl === "footer") {
    actions.insertBefore(collapseAllEl, actions.firstChild);
  }
  renderSourceLine(card, {
    note,
    source: spec.source,
    actions,
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

/**
 * Multi-pane variant: one sub-table per pane (split by spec.pane), stacked vertically under the
 * shared figure header, each with its own subheading and independent column headers / interactivity.
 * Footnotes are collected across panes and listed once below them; one source line + Data/Image
 * download serve the whole figure (the PNG export stacks the panes the same way).
 */
function mountMultiPaneTable(container: HTMLElement, opts: MountTableOptions): () => void {
  const { spec, rows } = opts;
  const doc = container.ownerDocument;
  const measureText = makeMeasureText();

  const card = doc.createElement("div");
  card.className = "figure-card";
  buildFigureHeader(card, doc, spec, opts.eyebrow);

  const panes = splitPanes(spec, rows);

  // Stable per-pane scroll wrappers; tables are (re)rendered into them on resize.
  const paneScrolls = panes.map((pane) => {
    const paneEl = doc.createElement("div");
    paneEl.className = "tbl-pane";
    if (pane.title) {
      const h = doc.createElement("div");
      h.className = "tbl-pane-title";
      h.textContent = pane.title;
      paneEl.appendChild(h);
    }
    const scroll = doc.createElement("div");
    scroll.className = "figure-canvas-scroll";
    paneEl.appendChild(scroll);
    card.appendChild(paneEl);
    return scroll;
  });

  // Figure-level footnote list (union across panes), placed after the panes, before the source line.
  const fnBlock = doc.createElement("div");
  fnBlock.className = "tbl-table-footnotes";

  // ---- Collapsible state, per pane (persistent across re-renders; see single-pane draw()) ----
  const paneCollapse = panes.map(() => ({
    collapsed: new Set<string>(),
    seeded: false,
    applyVis: undefined as (() => void) | undefined,
  }));
  let syncCollapseAll: (() => void) | undefined;

  function drawAll(_width: number): void {
    const fnMap = new Map<string, string>();
    // Panes share a stub width (planned across panes) so their first columns align; data columns
    // stay flexible to fill the card.
    const laid = layoutPanes(spec, rows, measureText, false);
    laid.forEach((lp, i) => {
      const table = renderTableHtml(lp.model, lp.layout, doc, spec, { flexDataCols: true });
      paneScrolls[i]!.replaceChildren(table);
      const pc = paneCollapse[i]!;
      attachTableInteractivity(table, lp.model, spec, () => pc.applyVis?.());
      if (spec.collapsible) {
        if (!pc.seeded) {
          pc.seeded = true;
          for (const b of lp.model.body) {
            if (b.kind === "group" && b.group.collapsed) pc.collapsed.add(b.group.key);
          }
        }
        pc.applyVis = attachCollapsible(table, pc.collapsed, () => syncCollapseAll?.());
      }
      for (const fn of lp.model.footnotes) if (!fnMap.has(fn.marker)) fnMap.set(fn.marker, fn.text);
    });
    // Stub-header placement: seat the (stable) whole-figure control in the FIRST pane's corner
    // cell, rebuilt each draw. Footer placement is handled once, below.
    if (spec.collapsible && collapsibleControl === "stub-header" && collapseAllEl) {
      paneScrolls[0]!.querySelector("thead th.tbl-table-stub-header")?.appendChild(collapseAllEl);
    }
    fnBlock.replaceChildren();
    if (fnMap.size > 0) {
      for (const [marker, text] of fnMap) {
        const line = doc.createElement("div");
        const sup = doc.createElement("sup");
        sup.textContent = marker;
        line.appendChild(sup);
        line.appendChild(doc.createTextNode(` ${text}`));
        fnBlock.appendChild(line);
      }
      if (fnBlock.parentNode == null) card.appendChild(fnBlock);
    } else if (fnBlock.parentNode != null) {
      fnBlock.remove();
    }
  }

  // Collapse-all control: built once, seated in the first pane's corner (default) or the footer
  // action row (control: "footer"); declared before the initial draw so drawAll() can seat it.
  const collapsibleControl = spec.collapsible?.control ?? "stub-header";
  let collapseAllEl: HTMLElement | undefined;
  if (spec.collapsible) {
    const allBtn = buildCollapseAllButton(
      doc,
      paneCollapse.map((pc, i) => ({ collapsed: pc.collapsed, keys: () => liveGroupKeys(paneScrolls[i]!) })),
      () => { for (const pc of paneCollapse) pc.applyVis?.(); },
    );
    syncCollapseAll = allBtn.sync;
    collapseAllEl = allBtn.el;
    allBtn.el.classList.add(
      collapsibleControl === "footer" ? "figure-download-btn" : "tbl-table-collapse-all-corner",
    );
  }

  const initialWidth = opts.width ?? (container.clientWidth || 720);
  drawAll(initialWidth);

  const note = Array.isArray(spec.notes) ? spec.notes.join("\n") : spec.notes;
  // PNG export threading: the union of every pane's collapsed keys. Keys are stub-path tokens, so
  // a group value shared across panes maps to the same key in each — the export applies the union
  // uniformly (a group collapsed in ANY pane exports collapsed in all panes that have it).
  const actions = buildTableDownloadActions(
    doc, spec, rows, opts.downloadName,
    spec.collapsible
      ? () => [...new Set(paneCollapse.flatMap((pc) => [...pc.collapsed]))]
      : undefined,
  );
  if (collapseAllEl && collapsibleControl === "footer") {
    actions.insertBefore(collapseAllEl, actions.firstChild);
  }
  renderSourceLine(card, {
    note,
    source: spec.source,
    actions,
  });

  container.appendChild(card);

  let ro: ResizeObserver | undefined;
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => {
      const w = card.clientWidth;
      if (w > 0) drawAll(w);
    });
    ro.observe(card);
  }

  return () => {
    ro?.disconnect();
    card.remove();
  };
}
