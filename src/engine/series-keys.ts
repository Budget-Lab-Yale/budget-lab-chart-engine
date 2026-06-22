// Shared pseudo-series identity keys. Kept in their own module (no engine deps) so both
// the engine entry (index.ts) and the mark builders (marks/stacked.ts) can import the same
// constant without a circular import.

/** The single, shared identity for the diverging-stack "Total" pseudo-series. Used as the
 *  Total legend row's `series`, the net dot/label `data-series`, and the dim-logic key, so
 *  the legend row and the chart net markers pin/hover/dim as one. */
export const TOTAL_SERIES_KEY = "__total__";
