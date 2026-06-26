// Split tidy rows into stacked table panes by a pane column. A single-table spec (no `pane`) yields
// one untitled pane holding all rows, so callers can treat both cases uniformly.
import type { TableSpec } from "../spec/table-types";
import type { TidyRow } from "../data/index";

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
