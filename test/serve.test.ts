/**
 * Tests for src/cli/serve.ts — findCharts, createRequestHandler.
 *
 * The request-handler tests inject a stub liveBundleJs and css so the suite
 * does not require a pre-built dist/embed/live.js.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as http from "node:http";
import { findCharts, createRequestHandler } from "../src/cli/serve";

// ---------------------------------------------------------------------------
// Repo root — used to locate the real example chart
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const EXAMPLE_CHART = join(REPO_ROOT, "examples", "augmented-occupations", "chart.yaml");

// ---------------------------------------------------------------------------
// Stub injection
// ---------------------------------------------------------------------------

const STUB_BUNDLE = `var BudgetLabChart={mountChart:function(el,opts){el.innerHTML='<p>chart</p>';}};`;
const STUB_CSS = "body{}";

// ---------------------------------------------------------------------------
// Temp directory helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = join(tmpdir(), `serve-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of tempDirs) {
    try {
      if (existsSync(d)) rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  tempDirs.length = 0;
});

// ---------------------------------------------------------------------------
// Helper: make an HTTP request to a handler without starting a real server
// ---------------------------------------------------------------------------

/**
 * Invoke the handler with a fake IncomingMessage and capture the response.
 * Returns { status, body }.
 */
function fakeRequest(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  url: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = {
      url,
      method: "GET",
      headers: {},
    } as unknown as http.IncomingMessage;

    let status = 200;
    let body = "";

    const res = {
      writeHead(code: number) {
        status = code;
      },
      end(chunk?: unknown) {
        if (typeof chunk === "string") body = chunk;
        resolve({ status, body });
      },
      headersSent: false,
    } as unknown as http.ServerResponse;

    try {
      handler(req, res);
    } catch (err) {
      reject(err);
    }
  });
}

// ---------------------------------------------------------------------------
// findCharts
// ---------------------------------------------------------------------------

describe("findCharts", () => {
  it("discovers the example chart.yaml under the repo root", () => {
    const found = findCharts(REPO_ROOT);
    const normalized = found.map((p) => p.replace(/\\/g, "/"));
    expect(normalized.some((p) => p.endsWith("examples/augmented-occupations/chart.yaml"))).toBe(
      true,
    );
  });

  it("skips node_modules, dist, and .git directories", () => {
    const found = findCharts(REPO_ROOT);
    for (const p of found) {
      const normalized = p.replace(/\\/g, "/");
      expect(normalized).not.toContain("/node_modules/");
      expect(normalized).not.toContain("/dist/");
      expect(normalized).not.toContain("/.git/");
    }
  });

  it("returns an empty array for a dir with no chart.yaml files", () => {
    const dir = makeTempDir();
    expect(findCharts(dir)).toHaveLength(0);
  });

  it("finds chart.yaml files in nested subdirectories", () => {
    const dir = makeTempDir();
    const sub = join(dir, "a", "b");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, "chart.yaml"), "chartType: line\ntitle: Nested\nxAxisType: temporal\ndata: d.csv\n");
    const found = findCharts(dir);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(join("a", "b", "chart.yaml"));
  });

  it("skips a dir named node_modules even when nested", () => {
    const dir = makeTempDir();
    const nm = join(dir, "node_modules", "some-pkg");
    mkdirSync(nm, { recursive: true });
    writeFileSync(join(nm, "chart.yaml"), "chartType: line\ntitle: X\nxAxisType: temporal\ndata: d.csv\n");
    expect(findCharts(dir)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// GET / — index page
// ---------------------------------------------------------------------------

describe("GET / — index page", () => {
  it("returns 200 with HTML listing the example chart", async () => {
    const handler = createRequestHandler({
      rootDir: REPO_ROOT,
      liveBundleJs: STUB_BUNDLE,
      css: STUB_CSS,
    });

    const { status, body } = await fakeRequest(handler, "/");
    expect(status).toBe(200);
    expect(body).toContain("<!doctype html");
    // Example chart title
    expect(body).toContain("Proportion of Workers");
  });

  it("shows 'No chart.yaml files found' when the dir is empty", async () => {
    const dir = makeTempDir();
    const handler = createRequestHandler({ rootDir: dir, liveBundleJs: STUB_BUNDLE, css: STUB_CSS });
    const { status, body } = await fakeRequest(handler, "/");
    expect(status).toBe(200);
    expect(body).toContain("No");
    expect(body).toContain("chart.yaml");
  });
});

// ---------------------------------------------------------------------------
// GET /chart/<relpath> — valid chart
// ---------------------------------------------------------------------------

describe("GET /chart/<relpath> — valid chart", () => {
  it("returns 200 with HTML containing the chart title", async () => {
    const handler = createRequestHandler({
      rootDir: REPO_ROOT,
      liveBundleJs: STUB_BUNDLE,
      css: STUB_CSS,
    });

    // Relative path from repo root to the example chart (posix-style)
    const rel = "examples/augmented-occupations/chart.yaml";
    const { status, body } = await fakeRequest(handler, `/chart/${rel}`);
    expect(status).toBe(200);
    expect(body).toContain("<!doctype html");
    expect(body).toContain("Proportion of Workers");
  });

  it("includes the injected bundle JS in the response", async () => {
    const handler = createRequestHandler({
      rootDir: REPO_ROOT,
      liveBundleJs: STUB_BUNDLE,
      css: STUB_CSS,
    });

    const rel = "examples/augmented-occupations/chart.yaml";
    const { status, body } = await fakeRequest(handler, `/chart/${rel}`);
    expect(status).toBe(200);
    expect(body).toContain("BudgetLabChart");
  });
});

// ---------------------------------------------------------------------------
// GET /chart/<relpath> — spec validation failure
// ---------------------------------------------------------------------------

describe("GET /chart/<relpath> — validation failure", () => {
  it("returns 422 with an error page listing validation errors", async () => {
    // Write a chart.yaml with an invalid xAxisType
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "chart.yaml"),
      "chartType: line\ntitle: Bad Chart\nxAxisType: weekly\ndata: data.csv\n",
    );
    // Also write a data.csv so loadData doesn't fail first
    writeFileSync(
      join(dir, "data.csv"),
      "time,series,value\n2024-01-01,A,1.0\n",
    );

    const handler = createRequestHandler({ rootDir: dir, liveBundleJs: STUB_BUNDLE, css: STUB_CSS });
    const { status, body } = await fakeRequest(handler, "/chart/chart.yaml");
    expect(status).toBe(422);
    expect(body).toContain("Validation error");
    expect(body).toContain("xAxisType");
  });
});

// ---------------------------------------------------------------------------
// Unknown route → 404
// ---------------------------------------------------------------------------

describe("Unknown route", () => {
  it("returns 404 for an unknown path", async () => {
    const handler = createRequestHandler({
      rootDir: REPO_ROOT,
      liveBundleJs: STUB_BUNDLE,
      css: STUB_CSS,
    });

    const { status } = await fakeRequest(handler, "/unknown/path/here");
    expect(status).toBe(404);
  });

  it("returns 404 when the chart file does not exist", async () => {
    const handler = createRequestHandler({
      rootDir: REPO_ROOT,
      liveBundleJs: STUB_BUNDLE,
      css: STUB_CSS,
    });

    const { status } = await fakeRequest(handler, "/chart/nonexistent/chart.yaml");
    expect(status).toBe(404);
  });
});
