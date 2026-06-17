/**
 * Tests for src/data/load.ts: parseCsv, rowsToCsv, loadData, freezeRemote.
 */

import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCsv, rowsToCsv, loadData, freezeRemote } from "../src/data/load.js";
import type { TidyRow } from "../src/data/index.js";

// ---------------------------------------------------------------------------
// parseCsv
// ---------------------------------------------------------------------------

describe("parseCsv", () => {
  it("parses simple rows", () => {
    const csv = "time,series,value\n2021-01,a,1.0\n2021-02,b,2.0\n";
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ time: "2021-01", series: "a", value: "1.0" });
    expect(rows[1]).toEqual({ time: "2021-02", series: "b", value: "2.0" });
  });

  it("handles a quoted field containing a comma", () => {
    const csv = 'time,series,value\n2021-01,"Trade, Transportation, and Utilities",3.5\n';
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.series).toBe("Trade, Transportation, and Utilities");
  });

  it("handles escaped quotes inside a quoted field", () => {
    const csv = 'time,series,value\n2021-01,"He said ""hello""",4.0\n';
    const rows = parseCsv(csv);
    expect(rows[0]?.series).toBe('He said "hello"');
  });

  it("handles CRLF line endings", () => {
    const csv = "time,series,value\r\n2021-01,a,1.0\r\n2021-02,b,2.0\r\n";
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.time).toBe("2021-01");
    expect(rows[1]?.value).toBe("2.0");
  });

  it("handles a trailing newline", () => {
    const csv = "time,series,value\n2021-01,a,1.0\n";
    expect(parseCsv(csv)).toHaveLength(1);
  });

  it("handles no trailing newline", () => {
    const csv = "time,series,value\n2021-01,a,1.0";
    expect(parseCsv(csv)).toHaveLength(1);
  });

  it("skips blank lines", () => {
    const csv = "time,series,value\n2021-01,a,1.0\n\n2021-02,b,2.0\n";
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
  });

  it("handles empty cells", () => {
    const csv = "time,series,value\n2021-01,,\n";
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual({ time: "2021-01", series: "", value: "" });
  });

  it("trims leading/trailing whitespace in header names", () => {
    const csv = " time , series , value \n2021-01,a,1.0\n";
    const rows = parseCsv(csv);
    expect(Object.keys(rows[0] ?? {})).toContain("time");
    expect(Object.keys(rows[0] ?? {})).toContain("series");
    expect(Object.keys(rows[0] ?? {})).toContain("value");
  });

  it("parses the fixture file correctly", () => {
    const fixturePath = fileURLToPath(
      new URL("./fixtures/augmented-occ-observed.csv", import.meta.url),
    );
    const text = readFileSync(fixturePath, "utf8");
    const rows = parseCsv(text);
    expect(rows.length).toBeGreaterThan(0);
    // Every row must have time, series, value
    for (const row of rows) {
      expect(typeof row.time).toBe("string");
      expect(typeof row.series).toBe("string");
      expect(typeof row.value).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// rowsToCsv
// ---------------------------------------------------------------------------

describe("rowsToCsv", () => {
  it("produces correct header and data lines", () => {
    const rows: TidyRow[] = [
      { time: "2021-01", series: "a", value: "1.0" },
      { time: "2021-02", series: "b", value: "2.0" },
    ];
    const csv = rowsToCsv(rows);
    const lines = csv.split("\n").filter(Boolean);
    expect(lines[0]).toBe("time,series,value");
    expect(lines[1]).toBe("2021-01,a,1.0");
    expect(lines[2]).toBe("2021-02,b,2.0");
  });

  it("puts time/series/value first then other columns in first-seen order", () => {
    const rows: TidyRow[] = [
      { time: "2021-01", series: "a", value: "1.0", lower: "0.8", upper: "1.2" },
    ];
    const csv = rowsToCsv(rows);
    const header = csv.split("\n")[0];
    expect(header).toBe("time,series,value,lower,upper");
  });

  it("quotes fields containing a comma", () => {
    const rows: TidyRow[] = [
      { time: "2021-01", series: "Trade, Transportation, and Utilities", value: "3.5" },
    ];
    const csv = rowsToCsv(rows);
    expect(csv).toContain('"Trade, Transportation, and Utilities"');
  });

  it("quotes fields containing a double-quote", () => {
    const rows: TidyRow[] = [
      { time: "2021-01", series: 'He said "hello"', value: "4.0" },
    ];
    const csv = rowsToCsv(rows);
    expect(csv).toContain('"He said ""hello"""');
  });

  it("round-trips through parseCsv for simple data", () => {
    const rows: TidyRow[] = [
      { time: "2021-01", series: "a", value: "1.0" },
      { time: "2021-02", series: "b", value: "2.0" },
    ];
    expect(parseCsv(rowsToCsv(rows))).toEqual(rows);
  });

  it("round-trips through parseCsv for comma-bearing series names", () => {
    const rows: TidyRow[] = [
      { time: "2021-01", series: "Trade, Transportation, and Utilities", value: "3.5" },
      { time: "2021-02", series: "Finance, Insurance", value: "2.1" },
    ];
    expect(parseCsv(rowsToCsv(rows))).toEqual(rows);
  });

  it("round-trips with extra columns", () => {
    const rows: TidyRow[] = [
      { time: "2021-01", series: "a", value: "1.0", lower: "0.8", upper: "1.2" },
      { time: "2021-02", series: "b", value: "2.0", lower: "1.7", upper: "2.3" },
    ];
    expect(parseCsv(rowsToCsv(rows))).toEqual(rows);
  });

  it("returns empty string for empty rows array", () => {
    expect(rowsToCsv([])).toBe("");
  });
});

// ---------------------------------------------------------------------------
// loadData — local file
// ---------------------------------------------------------------------------

describe("loadData – local file", () => {
  it("loads and parses the fixture CSV by bare string", async () => {
    const fixturePath = fileURLToPath(
      new URL("./fixtures/augmented-occ-observed.csv", import.meta.url),
    );
    const rows = await loadData(fixturePath);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ time: expect.any(String), series: expect.any(String), value: expect.any(String) });
  });

  it("loads the fixture CSV via { file } form with baseDir", async () => {
    const baseDir = fileURLToPath(new URL("./fixtures", import.meta.url));
    const rows = await loadData({ file: "augmented-occ-observed.csv" }, { baseDir });
    expect(rows.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// loadData — remote CSV
// ---------------------------------------------------------------------------

describe("loadData – remote CSV via fetchImpl", () => {
  it("fetches, parses, and returns rows", async () => {
    const fakeCsv = "time,series,value\n2021-01,a,1.0\n2021-02,b,2.0\n";
    const fetchImpl = async (_url: Parameters<typeof fetch>[0]): Promise<Response> =>
      ({ text: async () => fakeCsv, json: async () => [], ok: true, status: 200, statusText: "OK" } as unknown as Response);

    const rows = await loadData(
      { url: "https://example.com/data.csv", format: "csv" },
      { fetchImpl },
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ time: "2021-01", series: "a", value: "1.0" });
  });
});

// ---------------------------------------------------------------------------
// loadData — remote JSON (with and without map)
// ---------------------------------------------------------------------------

describe("loadData – remote JSON via fetchImpl", () => {
  it("maps records using the map option", async () => {
    const data = [
      { date: "2021-01", category: "a", amount: 1.0, extra: "x" },
      { date: "2021-02", category: "b", amount: 2.0, extra: "y" },
    ];
    const fetchImpl = async (_url: Parameters<typeof fetch>[0]): Promise<Response> =>
      ({ text: async () => "", json: async () => data, ok: true, status: 200, statusText: "OK" } as unknown as Response);

    const rows = await loadData(
      {
        url: "https://example.com/data.json",
        format: "json",
        map: { timeField: "date", seriesField: "category", valueField: "amount" },
      },
      { fetchImpl },
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ time: "2021-01", series: "a", value: "1", extra: "x" });
    expect(rows[1]).toEqual({ time: "2021-02", series: "b", value: "2", extra: "y" });
  });

  it("uses time/series/value directly when no map is given", async () => {
    const data = [
      { time: "2021-01", series: "a", value: "1.0", note: "ok" },
    ];
    const fetchImpl = async (_url: Parameters<typeof fetch>[0]): Promise<Response> =>
      ({ text: async () => "", json: async () => data, ok: true, status: 200, statusText: "OK" } as unknown as Response);

    const rows = await loadData(
      { url: "https://example.com/data.json", format: "json" },
      { fetchImpl },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ time: "2021-01", series: "a", value: "1.0", note: "ok" });
  });

  it("throws when the JSON response is not an array", async () => {
    const fetchImpl = async (_url: Parameters<typeof fetch>[0]): Promise<Response> =>
      ({ text: async () => "", json: async () => ({ not: "array" }), ok: true, status: 200, statusText: "OK" } as unknown as Response);

    await expect(
      loadData({ url: "https://example.com/data.json", format: "json" }, { fetchImpl }),
    ).rejects.toThrow("not an array");
  });
});

// ---------------------------------------------------------------------------
// freezeRemote
// ---------------------------------------------------------------------------

const tempFiles: string[] = [];
afterEach(() => {
  for (const f of tempFiles) {
    try {
      if (existsSync(f)) unlinkSync(f);
    } catch {
      // ignore cleanup errors
    }
  }
  tempFiles.length = 0;
});

describe("freezeRemote", () => {
  it("writes a CSV file and returns rows whose re-parsed contents match", async () => {
    const sourceRows: TidyRow[] = [
      { time: "2021-01", series: "a", value: "1.0" },
      { time: "2021-02", series: "Trade, Transportation, and Utilities", value: "2.5" },
    ];
    const fakeCsv = rowsToCsv(sourceRows);
    const fetchImpl = async (_url: Parameters<typeof fetch>[0]): Promise<Response> =>
      ({ text: async () => fakeCsv, json: async () => [], ok: true, status: 200, statusText: "OK" } as unknown as Response);

    const destPath = join(tmpdir(), `freeze-test-${Date.now()}.csv`);
    tempFiles.push(destPath);

    const rows = await freezeRemote(
      { url: "https://example.com/data.csv", format: "csv" },
      destPath,
      { fetchImpl },
    );

    // Returned rows match source
    expect(rows).toEqual(sourceRows);

    // Written file re-parses to the same rows
    const written = readFileSync(destPath, "utf8");
    expect(parseCsv(written)).toEqual(sourceRows);
  });

  it("creates parent directories when they do not exist", async () => {
    const fakeCsv = "time,series,value\n2021-01,a,1.0\n";
    const fetchImpl = async (_url: Parameters<typeof fetch>[0]): Promise<Response> =>
      ({ text: async () => fakeCsv, json: async () => [], ok: true, status: 200, statusText: "OK" } as unknown as Response);

    const destPath = join(tmpdir(), `freeze-subdir-${Date.now()}`, "nested", "out.csv");
    tempFiles.push(destPath);

    await freezeRemote(
      { url: "https://example.com/data.csv", format: "csv" },
      destPath,
      { fetchImpl },
    );

    expect(existsSync(destPath)).toBe(true);
  });

  it("works for a local file source (loads and writes a frozen copy)", async () => {
    const baseDir = fileURLToPath(new URL("./fixtures", import.meta.url));
    const destPath = join(tmpdir(), `freeze-local-${Date.now()}.csv`);
    tempFiles.push(destPath);

    const rows = await freezeRemote(
      { file: "augmented-occ-observed.csv" },
      destPath,
      { baseDir },
    );

    expect(rows.length).toBeGreaterThan(0);
    const written = readFileSync(destPath, "utf8");
    expect(parseCsv(written)).toEqual(rows);
  });
});
