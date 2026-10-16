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
import { rowsToCsv } from "./csv-browser.js";
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
 *  - a leading byte-order mark (dropped)
 *  - leading/trailing whitespace in header names
 *  - empty cells  → ""
 *  - entirely blank rows → skipped
 *
 * Throws `CSV line N: …` where a lenient read would drop or shift data without a word: a quoted
 * field with no closing quote (the rest of the file became one cell), text after a closing quote
 * (`"x"y,1` shifted every later column), two header columns with one non-blank name (the later one
 * won), and a non-empty cell past the header's last column (dropped).
 */
export function parseCsv(text: string): TidyRow[] {
  // Normalise CRLF and bare CR to LF. A byte-order mark is dropped first: left in, it is the first
  // header's first character, and a quoted first header kept its quotes ("time" as `"time"`).
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const fail = (line: number, msg: string): never => {
    throw new Error(`CSV line ${line}: ${msg}`);
  };
  // The 1-based line each row starts on (a quoted field can span lines), for the errors below.
  let line = 1;
  const rowLines: number[] = [1];

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
      line++;
      rowLines.push(line);
      continue;
    }

    if (ch === '"') {
      // Quoted field
      const opened = line;
      let closed = false;
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
            closed = true;
            break;
          }
        } else {
          if (c === "\n") line++;
          field += c;
          i++;
        }
      }
      if (!closed) fail(opened, "a quoted field has no closing quote");
      // After a quoted field comes a comma, the end of the row or the end of the file.
      if (i < len && src[i] !== "," && src[i] !== "\n") {
        fail(line, `text after the closing quote of "${field}": put the whole cell inside the quotes`);
      }
      tokens.push(field);
      // Skip the comma.
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
  const named = new Set<string>();
  for (const h of headers) {
    // Blank names repeat legitimately: the stray empty columns a spreadsheet exports (`time,value,,,`).
    if (h === "") continue;
    if (named.has(h)) fail(1, `two header columns are named "${h}"`);
    named.add(h);
  }

  const result: TidyRow[] = [];

  for (let r = 1; r < rawRows.length; r++) {
    const cells = rawRows[r];
    if (cells === undefined) continue;
    // Skip entirely blank rows (blank line or a row with only empty fields).
    if (cells.length === 0 || (cells.length === 1 && cells[0] === "")) continue;
    if (cells.slice(headers.length).some((c) => c !== "")) {
      fail(rowLines[r]!, `${cells.length} cells, but the header names ${headers.length} columns`);
    }

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
// rowsToCsv — implemented in csv-browser.ts (no Node imports, so the browser bundle can use it)
// ---------------------------------------------------------------------------

export { rowsToCsv };

// ---------------------------------------------------------------------------
// loadData
// ---------------------------------------------------------------------------

/** Throw a pointed error on a non-2xx remote response, so an HTTP error page is never
 * silently parsed as data (and never frozen as a "snapshot"). */
function assertOk(resp: { ok: boolean; status: number; statusText: string }, url: string): void {
  if (!resp.ok) {
    throw new Error(`loadData: HTTP ${resp.status} ${resp.statusText} fetching ${url}`);
  }
}

/** parseCsv, with a parse error naming the file or URL it read. */
function parseCsvFrom(text: string, from: string): TidyRow[] {
  try {
    return parseCsv(text);
  } catch (err) {
    throw new Error(`loadData: ${from}: ${(err as Error).message}`);
  }
}

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
    return parseCsvFrom(text, filePath);
  }

  // Remote source (url)
  if (resolved.format === "csv") {
    const resp = await fetchFn(resolved.url);
    assertOk(resp, resolved.url);
    const text = await resp.text();
    return parseCsvFrom(text, resolved.url);
  }

  // format === "json"
  const resp = await fetchFn(resolved.url);
  assertOk(resp, resolved.url);
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
