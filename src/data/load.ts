/**
 * Data loading layer: CSV parsing, serialisation, and source resolution.
 *
 * Exports:
 *   parseCsv        – text → TidyRow[]
 *   rowsToCsv       – TidyRow[] → text (round-trips through parseCsv)
 *   loadData        – DataSource → Promise<TidyRow[]>
 *   freezeRemote    – loadData + persist as frozen CSV
 */

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type { TidyRow } from "./index.js";
import type { DataSource } from "../spec/types.js";

// ---------------------------------------------------------------------------
// parseCsv
// ---------------------------------------------------------------------------

/**
 * Parse RFC-4180-ish CSV text into TidyRow[].
 *
 * Handles:
 *  - quoted fields containing commas or newlines
 *  - escaped double-quotes ("") inside quoted fields
 *  - CRLF or LF line endings
 *  - trailing newline
 *  - leading/trailing whitespace in header names
 *  - empty cells  → ""
 *  - entirely blank rows → skipped
 */
export function parseCsv(text: string): TidyRow[] {
  // Normalise CRLF and bare CR to LF.
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Tokenise into a flat list of cells plus row-break markers.
  // null = end-of-row sentinel.
  type Token = string | null;
  const tokens: Token[] = [];

  let i = 0;
  const len = src.length;

  while (i < len) {
    const ch = src[i];

    if (ch === "\n") {
      // End of row
      tokens.push(null);
      i++;
      continue;
    }

    if (ch === '"') {
      // Quoted field
      let field = "";
      i++; // skip opening quote
      while (i < len) {
        const c = src[i];
        if (c === '"') {
          if (i + 1 < len && src[i + 1] === '"') {
            // Escaped quote
            field += '"';
            i += 2;
          } else {
            // Closing quote
            i++;
            break;
          }
        } else {
          field += c;
          i++;
        }
      }
      tokens.push(field);
      // After a quoted field there should be a comma or EOL; skip the comma.
      if (i < len && src[i] === ",") i++;
    } else {
      // Unquoted field — read until comma or newline
      let field = "";
      while (i < len && src[i] !== "," && src[i] !== "\n") {
        field += src[i];
        i++;
      }
      tokens.push(field);
      if (i < len && src[i] === ",") i++;
    }
  }

  // Ensure the token stream ends with a row-break sentinel so the last row
  // is always flushed (handles both trailing-newline and no-trailing-newline).
  if (tokens.length === 0 || tokens[tokens.length - 1] !== null) {
    tokens.push(null);
  }

  // Split tokens back into rows.
  const rawRows: string[][] = [];
  let currentRow: string[] = [];
  for (const tok of tokens) {
    if (tok === null) {
      rawRows.push(currentRow);
      currentRow = [];
    } else {
      currentRow.push(tok);
    }
  }

  if (rawRows.length === 0) return [];

  // First row is the header.
  const headerRow = rawRows[0];
  if (headerRow === undefined) return [];
  const headers = headerRow.map((h) => h.trim());

  const result: TidyRow[] = [];

  for (let r = 1; r < rawRows.length; r++) {
    const cells = rawRows[r];
    if (cells === undefined) continue;
    // Skip entirely blank rows (blank line or a row with only empty fields).
    if (cells.length === 0 || (cells.length === 1 && cells[0] === "")) continue;

    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (key === undefined) continue;
      row[key] = cells[c] ?? "";
    }
    result.push(row as TidyRow);
  }

  return result;
}

// ---------------------------------------------------------------------------
// rowsToCsv
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// loadData
// ---------------------------------------------------------------------------

/** Coerce an unknown value to a non-null string. */
function coerceString(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

/**
 * Load tidy rows from a DataSource.
 *
 * @param source         – the DataSource to resolve
 * @param opts.baseDir   – base directory for local file sources (default: cwd)
 * @param opts.fetchImpl – injectable fetch; defaults to global fetch (Node 20+)
 */
export async function loadData(
  source: DataSource,
  opts?: { baseDir?: string; fetchImpl?: typeof fetch },
): Promise<TidyRow[]> {
  const fetchFn = opts?.fetchImpl ?? fetch;

  // Normalise string sugar to { file }.
  const resolved: Exclude<DataSource, string> =
    typeof source === "string" ? { file: source } : source;

  if ("file" in resolved) {
    const filePath = resolve(opts?.baseDir ?? ".", resolved.file);
    const text = await readFile(filePath, "utf8");
    return parseCsv(text);
  }

  // Remote source (url)
  if (resolved.format === "csv") {
    const resp = await fetchFn(resolved.url);
    const text = await resp.text();
    return parseCsv(text);
  }

  // format === "json"
  const resp = await fetchFn(resolved.url);
  const data = (await resp.json()) as unknown;

  if (!Array.isArray(data)) {
    throw new Error(`loadData: JSON response from ${resolved.url} is not an array`);
  }

  const map = resolved.map;
  return (data as unknown[]).map((record, idx) => {
    if (typeof record !== "object" || record === null) {
      throw new Error(`loadData: record[${idx}] is not an object`);
    }
    const rec = record as Record<string, unknown>;

    let time: string;
    let series: string;
    let value: string;

    if (map !== undefined) {
      time = coerceString(rec[map.timeField]);
      series = coerceString(rec[map.seriesField]);
      value = coerceString(rec[map.valueField]);
    } else {
      time = coerceString(rec["time"]);
      series = coerceString(rec["series"]);
      value = coerceString(rec["value"]);
    }

    const row: Record<string, string> = { time, series, value };

    // Preserve other primitive fields as string columns.
    const reservedKeys: Set<string> =
      map !== undefined
        ? new Set([map.timeField, map.seriesField, map.valueField])
        : new Set(["time", "series", "value"]);

    for (const [k, v] of Object.entries(rec)) {
      if (
        !reservedKeys.has(k) &&
        (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
      ) {
        row[k] = coerceString(v);
      }
    }

    return row as TidyRow;
  });
}

// ---------------------------------------------------------------------------
// freezeRemote
// ---------------------------------------------------------------------------

/**
 * Load a DataSource and write a frozen CSV snapshot to `destPath`.
 * Creates parent directories as needed. Returns the loaded rows.
 */
export async function freezeRemote(
  source: DataSource,
  destPath: string,
  opts?: { baseDir?: string; fetchImpl?: typeof fetch },
): Promise<TidyRow[]> {
  const rows = await loadData(source, opts);
  const csv = rowsToCsv(rows);
  await mkdir(dirname(resolve(destPath)), { recursive: true });
  await writeFile(resolve(destPath), csv, "utf8");
  return rows;
}
