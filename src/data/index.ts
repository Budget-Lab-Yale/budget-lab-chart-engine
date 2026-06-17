// Data layer entry point. `loadData(source)` → tidy long rows (local CSV + remote
// URL/JSON, remote→frozen) lands here in engine step 5.

/** One row of tidy long-format data, as the engine consumes it. */
export interface TidyRow {
  time: string;
  series: string;
  value: string;
  [column: string]: string;
}

export { parseCsv, rowsToCsv, loadData, freezeRemote } from "./load.js";
