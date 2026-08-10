/**
 * Tests for src/cli/index.ts — calls exported functions directly (no subprocess).
 *
 * render tests inject a stub liveBundleJs so the test suite does not need a
 * pre-built dist/embed/live.js.
 */

import { describe, it, expect, afterEach } from "vitest";
import { existsSync, unlinkSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";
import { runValidate, runRender, runAssets } from "../src/cli/index";

const EXAMPLE_SPEC = resolve(
  fileURLToPath(new URL("./fixtures/sample-chart/chart.yaml", import.meta.url)),
);

// Stub live bundle — just needs to be a non-empty JS string.
const STUB_BUNDLE = `var BudgetLabChart={mountChart:function(el,opts){el.innerHTML='<p>chart</p>';}};`;

// ---------------------------------------------------------------------------
// Cleanup
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

// ---------------------------------------------------------------------------
// validate: success
// ---------------------------------------------------------------------------

describe("runValidate — success", () => {
  it("returns exitCode 0 and an OK message for the example spec", async () => {
    const result = await runValidate(EXAMPLE_SPEC);
    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/^OK:/);
    expect(result.message).toContain(EXAMPLE_SPEC);
    // "(<N> rows, <M> series)"
    expect(result.message).toMatch(/\(\d+ rows, \d+ series\)/);
  });
});

// ---------------------------------------------------------------------------
// validate: errors
// ---------------------------------------------------------------------------

describe("runValidate — bad enum", () => {
  it("returns exitCode 1 when xAxisType is invalid", async () => {
    const specPath = join(tmpdir(), `cli-test-bad-enum-${Date.now()}.yaml`);
    tempFiles.push(specPath);
    writeFileSync(
      specPath,
      `chartType: line\ntitle: Test\nxAxisType: weekly\ndata: data.csv\n`,
      "utf8",
    );
    const result = await runValidate(specPath);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/xAxisType/);
    expect(result.message).toMatch(/numeric, temporal, quarterly/);
  });
});

describe("runValidate — series_order names missing series", () => {
  it("returns exitCode 1 and names the missing series", async () => {
    // Write a temporary spec + CSV where series_order names a series not in data.
    const dir = join(tmpdir(), `cli-test-series-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const specPath = join(dir, "chart.yaml");
    const csvPath = join(dir, "data.csv");
    tempFiles.push(specPath, csvPath);

    writeFileSync(
      csvPath,
      "time,series,value\n2021-01-01,real-series,1.0\n",
      "utf8",
    );
    writeFileSync(
      specPath,
      [
        "chartType: line",
        "title: Test",
        "xAxisType: temporal",
        "data: data.csv",
        "series_order:",
        "  - real-series",
        "  - missing-series",
      ].join("\n") + "\n",
      "utf8",
    );

    const result = await runValidate(specPath);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/series_order/);
    expect(result.message).toMatch(/missing-series/);
  });
});

// ---------------------------------------------------------------------------
// render: success
// ---------------------------------------------------------------------------

describe("runRender — success", () => {
  it("writes an HTML file and returns exitCode 0", async () => {
    const outPath = join(tmpdir(), `cli-test-render-${Date.now()}.html`);
    tempFiles.push(outPath);

    const result = await runRender(EXAMPLE_SPEC, {
      outPath,
      liveBundleJs: STUB_BUNDLE,
      css: "body{}",
    });

    expect(result.exitCode).toBe(0);
    expect(result.htmlPath).toBe(outPath);
    expect(result.message).toContain(outPath);
    expect(existsSync(outPath)).toBe(true);
  });

  it("HTML output contains doctype, mountChart call, and the chart title", async () => {
    const outPath = join(tmpdir(), `cli-test-render-content-${Date.now()}.html`);
    tempFiles.push(outPath);

    await runRender(EXAMPLE_SPEC, {
      outPath,
      liveBundleJs: STUB_BUNDLE,
      css: "body{}",
    });

    const html = readFileSync(outPath, "utf8");
    expect(html).toMatch(/<!doctype html/i);
    expect(html).toContain("BudgetLabChart.mountChart");
    // The fixture spec title
    expect(html).toContain("Sample Chart");
  });

  it("defaults output path to <specBasename>.html in cwd when -o is omitted", async () => {
    // We need to know where it will land: resolve(process.cwd(), "chart.html")
    const expectedOut = resolve(process.cwd(), "chart.html");
    tempFiles.push(expectedOut);

    const result = await runRender(EXAMPLE_SPEC, {
      liveBundleJs: STUB_BUNDLE,
      css: "body{}",
    });

    expect(result.exitCode).toBe(0);
    expect(result.htmlPath).toBe(expectedOut);
    expect(existsSync(expectedOut)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// render: validation failure
// ---------------------------------------------------------------------------

describe("runRender — validation failure", () => {
  it("returns exitCode 1 and does NOT write a file when spec is invalid", async () => {
    const specPath = join(tmpdir(), `cli-test-render-invalid-${Date.now()}.yaml`);
    const outPath = join(tmpdir(), `cli-test-render-invalid-${Date.now()}.html`);
    tempFiles.push(specPath, outPath);

    writeFileSync(
      specPath,
      `chartType: line\ntitle: Test\nxAxisType: weekly\ndata: data.csv\n`,
      "utf8",
    );

    const result = await runRender(specPath, {
      outPath,
      liveBundleJs: STUB_BUNDLE,
      css: "body{}",
    });

    expect(result.exitCode).toBe(1);
    expect(existsSync(outPath)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assets + render --assets-base
// ---------------------------------------------------------------------------

describe("runAssets", () => {
  it("writes the three versioned files and reports them as a manifest", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "cli-assets-"));

    const result = await runAssets({
      outDir,
      version: "2.0.0",
      liveBundleJs: STUB_BUNDLE,
      css: ".figure-card{color:red}",
    });

    expect(result.exitCode).toBe(0);
    expect(result.manifest).toEqual({
      version: "2.0.0",
      runtime: "engine-2.0.0.js",
      styles: "chart-2.0.0.css",
    });
    expect(readFileSync(join(outDir, "engine-2.0.0.js"), "utf8")).toBe(STUB_BUNDLE);

    // The stylesheet carries the font, so a page needs one <link> and no font request.
    const css = readFileSync(join(outDir, "chart-2.0.0.css"), "utf8");
    expect(css).toContain("data:font/ttf;base64,");
    expect(css).toContain(".figure-card{color:red}");
  });

  it("fails cleanly when the output directory cannot be created", async () => {
    // Parent is a regular file, so mkdir -p cannot succeed (ENOTDIR on every platform).
    const blocker = join(mkdtempSync(join(tmpdir(), "cli-assets-bad-")), "not-a-dir");
    writeFileSync(blocker, "x");
    const result = await runAssets({
      outDir: join(blocker, "assets"),
      version: "2.0.0",
      liveBundleJs: STUB_BUNDLE,
      css: "body{}",
    });
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/cannot write assets/);
  });
});

describe("runRender with shared assets", () => {
  it("links the assets and needs no live bundle at all", async () => {
    const outPath = join(tmpdir(), `cli-test-render-shared-${Date.now()}.html`);
    tempFiles.push(outPath);

    const result = await runRender(EXAMPLE_SPEC, {
      outPath,
      css: "body{}",
      assets: { base: "../../embed/v1", version: "2.0.0" },
    });

    expect(result.exitCode).toBe(0);
    const html = readFileSync(outPath, "utf8");
    expect(html).toContain('<script src="../../embed/v1/engine-2.0.0.js"></script>');
    expect(html).toContain('<link rel="stylesheet" href="../../embed/v1/chart-2.0.0.css">');
    expect(html).not.toContain("body{}");
  });
});
