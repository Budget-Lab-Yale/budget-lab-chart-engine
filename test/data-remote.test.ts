import { describe, it, expect } from "vitest";
import { loadData } from "../src/data/load";

// A minimal Response-like stub for the injected fetchImpl.
function fakeResponse(opts: {
  ok: boolean;
  status: number;
  statusText: string;
  text?: string;
  json?: unknown;
}): Response {
  return {
    ok: opts.ok,
    status: opts.status,
    statusText: opts.statusText,
    text: async () => opts.text ?? "",
    json: async () => opts.json,
  } as unknown as Response;
}

describe("loadData remote fetch", () => {
  it("rejects on a non-2xx response instead of parsing the error body", async () => {
    const fetchImpl = (async () =>
      fakeResponse({ ok: false, status: 404, statusText: "Not Found", text: "<!doctype html>" })) as typeof fetch;
    await expect(
      loadData({ url: "https://example.test/missing.csv", format: "csv" }, { fetchImpl }),
    ).rejects.toThrow(/HTTP 404 Not Found/);
  });

  it("rejects a non-2xx JSON response too", async () => {
    const fetchImpl = (async () =>
      fakeResponse({ ok: false, status: 500, statusText: "Server Error", json: { error: true } })) as typeof fetch;
    await expect(
      loadData({ url: "https://example.test/data.json", format: "json" }, { fetchImpl }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it("parses a 2xx CSV response", async () => {
    const fetchImpl = (async () =>
      fakeResponse({ ok: true, status: 200, statusText: "OK", text: "time,series,value\n2021-01-01,a,1\n" })) as typeof fetch;
    const rows = await loadData({ url: "https://example.test/ok.csv", format: "csv" }, { fetchImpl });
    expect(rows).toEqual([{ time: "2021-01-01", series: "a", value: "1" }]);
  });
});
