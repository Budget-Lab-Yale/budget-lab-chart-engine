/**
 * Pure CSV serialization/parsing utilities — no Node.js dependencies.
 * These are re-exported from data/index.ts for library consumers;
 * this file exists so browser bundles can import rowsToCsv without pulling
 * in the node:fs/promises imports from data/load.ts.
 */
import type { TidyRow } from "./index.js";

/** Quote a single CSV field if it contains a comma, double-quote, or newline. */
function quoteCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/**
 * Serialise TidyRow[] back to CSV text.
 *
 * Column order: `time`, `series`, `value` first (if present), then any
 * remaining columns in first-seen order. Fields are quoted when they contain
 * a comma, a double-quote, or a newline. Output uses LF line endings and
 * ends with a trailing newline.
 */
export function rowsToCsvBrowser(rows: TidyRow[]): string {
  if (rows.length === 0) return "";

  // Build stable column order.
  const PRIORITY = ["time", "series", "value"] as const;
  const seenExtra = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!(PRIORITY as readonly string[]).includes(key)) {
        seenExtra.add(key);
      }
    }
  }

  // Which of the priority columns actually appear in any row?
  const allKeys = new Set(rows.flatMap((r) => Object.keys(r)));
  const headers: string[] = [
    ...PRIORITY.filter((k) => allKeys.has(k)),
    ...seenExtra,
  ];

  const lines: string[] = [headers.map(quoteCsvField).join(",")];

  for (const row of rows) {
    lines.push(headers.map((h) => quoteCsvField(row[h] ?? "")).join(","));
  }

  return lines.join("\n") + "\n";
}