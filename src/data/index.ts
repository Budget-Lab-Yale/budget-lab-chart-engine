// Data layer entry point. `loadData(source)` → tidy long rows (local CSV + remote
// URL/JSON, remote→frozen) lands here in engine step 5.

/** One row of long-format data: a map of column name → cell value. The engine maps specific
 *  columns onto its roles (x / value / series / facet) via the spec's `columns` block; no
 *  particular column names are required. */
export interface TidyRow {
  [column: string]: string;
}

export { parseCsv, rowsToCsv, loadData, freezeRemote } from "./load.js";
