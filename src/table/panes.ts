// Split tidy rows into stacked table panes by a pane column. A single-table spec (no `pane`) yields
// one untitled pane holding all rows, so callers can treat both cases uniformly.
import type { TableSpec } from "../spec/table-types";
import type { TidyRow } from "../data/index";
import type { TableModel } from "./model";
import type { TableLayout } from "./layout";
import { buildTableModel, applyCollapse } from "./model";
import { layoutTable, layoutOptionsFromSpec } from "./layout";

export interface Pane {
  /** The pane column value (empty string for a single-table spec). */
  value: string;
  /** Subheading to show above the pane (pane_titles override, else the value; "" when single). */
  title: string;
  /** The rows belonging to this pane. */
  rows: TidyRow[];
}

/**
 * Group rows into panes by `spec.pane`. Order follows `spec.pane_order` (which also filters to the
 * listed values) when given, otherwise first-appearance order in the data. Subheadings come from
 * `spec.pane_titles[value]`, falling back to the raw value.
 */
export function splitPanes(spec: TableSpec, rows: TidyRow[]): Pane[] {
  const paneCol = spec.pane;
  if (paneCol == null) return [{ value: "", title: "", rows }];

  const order: string[] = [];
  const groups = new Map<string, TidyRow[]>();
  for (const r of rows) {
    const v = String((r as Record<string, unknown>)[paneCol] ?? "");
    let bucket = groups.get(v);
    if (bucket == null) {
      bucket = [];
      groups.set(v, bucket);
      order.push(v);
    }
    bucket.push(r);
  }

  const values =
    spec.pane_order && spec.pane_order.length > 0
      ? spec.pane_order.filter((v) => groups.has(v))
      : order;

  return values.map((v) => ({
    value: v,
    title: spec.pane_titles?.[v] ?? v,
    rows: groups.get(v) ?? [],
  }));
}

/** Resolve the corner (stub header) label for a given pane: a string applies to all panes; a map
 *  is keyed by pane value. */
export function resolveStubHeader(spec: TableSpec, paneValue: string): string {
  const sh = spec.stub_header;
  if (sh == null) return "";
  return typeof sh === "string" ? sh : (sh[paneValue] ?? "");
}

export interface LaidPane { value: string; title: string; model: TableModel; layout: TableLayout; }

/**
 * Build + lay out every pane with a SHARED stub width (the widest pane's stub), so the first column
 * lines up across panes. When `fill` is set, also stretch each pane's data columns to a shared total
 * width so the right edges align too (for the PNG); the HTML instead fills the card and only needs
 * the shared stub. Pane corner labels (stub_header) are resolved per pane. Footnotes are stripped
 * from pane models when `fill` (the PNG lists them once at figure level). `collapsedKeys`
 * (PNG export of a collapsible table) filters each pane model through applyCollapse BEFORE
 * layout, so the laid-out geometry matches the visible (collapsed-aware) rows.
 */
export function layoutPanes(
  spec: TableSpec,
  rows: TidyRow[],
  measureText: (s: string, fontPx: number, weight: number) => number,
  fill: boolean,
  collapsedKeys?: Set<string>,
): LaidPane[] {
  const opts = layoutOptionsFromSpec(spec);
  const panes = splitPanes(spec, rows);

  // Pass 1: natural layouts to discover the shared stub width and (for fill) the shared total.
  const natural = panes.map((p) => {
    let model = buildTableModel(spec, p.rows);
    if (collapsedKeys) model = applyCollapse(model, collapsedKeys);
    model.stubHeader = resolveStubHeader(spec, p.value);
    return { p, model, layout: layoutTable(model, { width: 720, measureText, ...opts }) };
  });
  const sharedStub = Math.max(...natural.map((n) => n.layout.stubWidth));
  const sharedTotal = Math.max(...natural.map((n) => sharedStub + (n.layout.totalWidth - n.layout.stubWidth)));

  // Pass 2: re-lay each pane with the shared stub (and shared total when filling).
  return natural.map(({ p, model }) => {
    const m = fill ? { ...model, footnotes: [] } : model;
    const layout = layoutTable(m, {
      width: 720,
      measureText,
      ...opts,
      stubWidth: sharedStub,
      ...(fill ? { fillWidth: sharedTotal } : {}),
    });
    return { value: p.value, title: p.title, model: m, layout };
  });
}
