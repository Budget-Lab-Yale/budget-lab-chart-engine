/**
 * CSV serialisation with no Node.js dependencies — the single implementation of `rowsToCsv`.
 * data/load.ts re-exports it (and data/index.ts re-exports load.ts) for library consumers;
 * it lives here so browser bundles can import it without pulling in load.ts's
 * node:fs/promises and node:path imports.
 */
import type { TidyRow } from "./index.js";

/** Quote a single CSV field if it contains a comma, double-quote, or line break. A bare `\r` counts:
 *  unquoted, parseCsv reads it as a line ending and splits the row in two. */
function quoteCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/**
 * Serialise TidyRow[] back to CSV text.
 *
 * Column order: `time`, `series`, `value` first (if present), then any
 * remaining columns in first-seen order. Fields are quoted when they contain
 * a comma, a double-quote, or a line break. Output uses LF line endings and
 * ends with a trailing newline.
 */
export function rowsToCsv(rows: TidyRow[]): string {
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