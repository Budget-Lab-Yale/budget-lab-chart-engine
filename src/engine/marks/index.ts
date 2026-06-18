// Mark-builder registry, keyed on chartType. v1 has `line` only; adding bar/stacked/
// small-multiples later means writing a builder and registering it here — the rest of
// the engine (data prep, axes, assemble, render) is chart-type agnostic.
import type { ChartSpec, ChartType } from "../../spec/types";
import { buildLineMarks } from "./line";

/** A data row after parsing: canonical series/time plus the engine's derived fields. */
export interface PreparedRow {
  series: string;
  time: string;
  _y: number | null;
  /** Parsed numeric x (numeric axis). */
  _xn?: number;
  /** Parsed date x (temporal/quarterly axis). */
  _xd?: Date | null;
  /** Confidence-band bounds, when the row's series has a band. */
  _lo?: number;
  _hi?: number;
}

export interface MarkContext {
  /** In-memory field holding the parsed x value (`_xn` or `_xd`). */
  xField: string;
  /** series key → resolved color. */
  colors: Map<string, string>;
}

export interface MarkLayers {
  /** Marks painted behind the gridlines (e.g. confidence bands). */
  underlay: unknown[];
  /** Marks painted on top of the chrome (the lines). */
  overlay: unknown[];
  /** Series encounter order per line group, for post-render path tagging. */
  groupOrders: string[][];
  /** Series rendered dashed (drives legend swatches + tooltip styling). */
  dashedNames: Set<string>;
}

export type MarkBuilder = (data: PreparedRow[], spec: ChartSpec, ctx: MarkContext) => MarkLayers;

// bar / stacked builders are registered here once implemented (later tasks).
const _notImplemented =
  (type: ChartType): MarkBuilder =>
  () => {
    throw new Error(`Mark builder for chartType "${type}" is not yet implemented`);
  };

const REGISTRY: Record<ChartType, MarkBuilder> = {
  line: buildLineMarks,
  bar: _notImplemented("bar"),
  stacked: _notImplemented("stacked"),
};

export function markBuilderFor(chartType: ChartType): MarkBuilder {
  const builder = REGISTRY[chartType];
  if (!builder) throw new Error(`No mark builder registered for chartType: ${chartType}`);
  return builder;
}
