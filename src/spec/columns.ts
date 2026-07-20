// Resolve the spec's `columns:` role map (x / value / series / facet) to concrete column names,
// applying the legacy defaults and the optional-series rule. This is the single source of truth
// for how input columns map onto what the engine consumes — used by the normalizer (renderPane),
// the live-layer helpers, the figure orchestrator, and data validation.
import type { ChartSpec } from "./types";

/** The implicit series key used when a chart has no series column (single-series chart). */
export const SINGLE_SERIES_KEY = "";

export interface ResolvedColumns {
  /** Column holding the x value. */
  x: string;
  /** Column holding the numeric value. */
  value: string;
  /** Column holding the series key, or null for a single implicit series. */
  series: string | null;
  /** Column splitting small-multiples panes, or null. */
  facet: string | null;
  /** Column driving marker shape (point charts), or null. */
  shape: string | null;
  /** Column grouping categories into sections (horizontal bars), or null. */
  section: string | null;
  /** Column flagging a waterfall step's kind (delta/total/skip), or null. */
  kind: string | null;
  /** Histogram pre-binned data: column holding each bin's lower edge, or null. */
  x0: string | null;
  /** Histogram pre-binned data: column holding each bin's upper edge, or null. */
  x1: string | null;
}

/**
 * Resolve `spec.columns` to concrete column names.
 *
 * Defaults (legacy contract, preserved when the block is absent): x="time", value="value".
 * Series: an explicit `columns.series` always wins; otherwise, if `rows` are provided, a "series"
 * column is used only when present (else `null` ⇒ single implicit series). With no `rows` context
 * the legacy "series" default is assumed.
 */
export function resolveColumns(
  spec: ChartSpec,
  rows?: ReadonlyArray<Record<string, unknown>>,
): ResolvedColumns {
  const c = spec.columns ?? {};
  const x = c.x ?? "time";
  const value = c.value ?? "value";
  const facet = c.facet ?? null;
  const shape = c.shape != null && c.shape !== "" ? c.shape : null;
  const section = c.section != null && c.section !== "" ? c.section : null;
  const kind = c.kind != null && c.kind !== "" ? c.kind : null;
  const x0 = c.x0 != null && c.x0 !== "" ? c.x0 : null;
  const x1 = c.x1 != null && c.x1 !== "" ? c.x1 : null;

  let series: string | null;
  if (c.series != null && c.series !== "") {
    series = c.series;
  } else if (rows && rows.length > 0) {
    series = "series" in rows[0]! ? "series" : null;
  } else {
    series = "series";
  }

  return { x, value, series, facet, shape, section, kind, x0, x1 };
}

/** True only when both bin-edge roles (`x0`/`x1`) are mapped — i.e. the data arrives pre-binned. */
export function isPreBinned(cols: ResolvedColumns): boolean {
  return cols.x0 != null && cols.x1 != null;
}
