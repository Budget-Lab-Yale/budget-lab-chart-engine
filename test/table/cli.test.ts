/**
 * Tests for table dispatch in src/cli/index.ts.
 *
 * A temp dir with a minimal table.yaml + data.csv is used to drive
 * runRender and runValidate without disk side-effects on the real examples.
 *
 * The live bundle is NOT required for these tests: like the chart CLI tests, we
 * inject a stub liveBundleJs. Detection is spec-content-based (stub/header/value
 * fields present), not filename-based.
 */

import { describe, it, expect, afterEach } from "vitest";
import { existsSync, unlinkSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { runValidate, runRender, runSnapshot } from "../../src/cli/index";
import { BUNDLE_PATH } from "../setup/global-build";
import { CHART_CSS } from "../../src/embed/styles";

// The PNG snapshot path renders through a real headless Chromium. Skip it where the browser binary
// isn't installed (e.g. CI running `npm ci` without `playwright install`); it runs locally. The
// table SVG/HTML output itself is covered by the jsdom golden + render tests, browser-free.
const HAS_BROWSER = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

// Stub bundle — just needs to expose BudgetLabChart.mountTable and mountChart stubs.
const STUB_BUNDLE = `var BudgetLabChart={mountChart:function(el,opts){el.innerHTML='<p>chart</p>';},mountTable:function(el,opts){el.innerHTML='<p>table</p>';}}`;

// ---------------------------------------------------------------------------
// Fixture factory
// ---------------------------------------------------------------------------

function makeTableFixture(
  dir: string,
  opts: { bad?: boolean } = {},
): { specPath: string; csvPath: string } {
  mkdirSync(dir, { recursive: true });
  const specPath = join(dir, "table.yaml");
  const csvPath = join(dir, "data.csv");

  writeFileSync(
    csvPath,
    // tidy/long: one row per (row × metric) cell
    "row,metric,value\nGDP,2024,1.2\nGDP,2025,1.8\nDeficit,2024,-0.5\nDeficit,2025,-0.3\n",
    "utf8",
  );

  if (opts.bad) {
    // Missing required "value" field → validateTableSpec should fail
    writeFileSync(
      specPath,
      [
        "title: Test Table",
        "data: data.csv",
        "stub:",
        "  - label: row",
        "header:",
        "  - metric",
        // deliberately omitting 'value:' to trigger the validator error
      ].join("\n") + "\n",
      "utf8",
    );
  } else {
    writeFileSync(
      specPath,
      [
        "title: Test Table",
        "data: data.csv",
        "stub:",
        "  - label: row",
        "header:",
        "  - metric",
        "value: value",
      ].join("\n") + "\n",
      "utf8",
    );
  }

  return { specPath, csvPath };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

const tempFiles: string[] = [];
afterEach(() => {
  for (const f of tempFiles) {
    try {
      if (existsSync(f)) unlinkSync(f);
    } catch {
      // ignore
    }
  }
  tempFiles.length = 0;
});

// ---------------------------------------------------------------------------
// runValidate — table dispatch
// ---------------------------------------------------------------------------

describe("runValidate — table spec (valid)", () => {
  it("returns exitCode 0 for a valid table.yaml", async () => {
    const dir = join(tmpdir(), `cli-table-validate-ok-${Date.now()}`);
    const { specPath, csvPath } = makeTableFixture(dir);
    tempFiles.push(specPath, csvPath);

    const result = await runValidate(specPath);
    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/OK:/i);
  });
});

describe("runValidate — table spec (bad: missing value field)", () => {
  it("returns exitCode 1 and reports the table validator error", async () => {
    const dir = join(tmpdir(), `cli-table-validate-bad-${Date.now()}`);
    const { specPath, csvPath } = makeTableFixture(dir, { bad: true });
    tempFiles.push(specPath, csvPath);

    const result = await runValidate(specPath);
    expect(result.exitCode).toBe(1);
    // The table schema requires "value"; the error should mention it.
    expect(result.message).toMatch(/value/i);
  });
});

// ---------------------------------------------------------------------------
// runRender — table dispatch
// ---------------------------------------------------------------------------

describe("runRender — table spec", () => {
  it("returns exitCode 0 and produces an HTML file", async () => {
    const dir = join(tmpdir(), `cli-table-render-${Date.now()}`);
    const { specPath, csvPath } = makeTableFixture(dir);
    const outPath = join(dir, "out.html");
    tempFiles.push(specPath, csvPath, outPath);

    const result = await runRender(specPath, {
      outPath,
      liveBundleJs: STUB_BUNDLE,
      css: "body{}",
    });

    expect(result.exitCode).toBe(0);
    expect(result.htmlPath).toBe(outPath);
    expect(existsSync(outPath)).toBe(true);
  });

  it("HTML output calls BudgetLabChart.mountTable, not mountChart", async () => {
    const dir = join(tmpdir(), `cli-table-render-content-${Date.now()}`);
    const { specPath, csvPath } = makeTableFixture(dir);
    const outPath = join(dir, "out.html");
    tempFiles.push(specPath, csvPath, outPath);

    await runRender(specPath, {
      outPath,
      liveBundleJs: STUB_BUNDLE,
      css: "body{}",
    });

    const html = readFileSync(outPath, "utf8");
    expect(html).toMatch(/<!doctype html/i);
    expect(html).toContain("BudgetLabChart.mountTable");
    expect(html).not.toContain("BudgetLabChart.mountChart");
    expect(html).toContain("Test Table");
  });
});

// ---------------------------------------------------------------------------
// runSnapshot — table dispatch (renders via real headless Chromium)
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_BROWSER)("runSnapshot — table spec", () => {
  // Renders through Playwright; allow generous time for browser launch.
  it("renders a table.yaml to a PNG baseline (--update)", async () => {
    const dir = join(tmpdir(), `cli-table-snapshot-${Date.now()}`);
    const { specPath, csvPath } = makeTableFixture(dir);
    const baselinePath = join(dir, "baseline.png");
    tempFiles.push(specPath, csvPath, baselinePath);

    // The snapshot path mounts the real bundle in a browser, so use the IIFE built by
    // globalSetup rather than the stub (which never produces a real DOM/PNG).
    const liveBundleJs = readFileSync(BUNDLE_PATH, "utf8");

    const result = await runSnapshot(specPath, {
      baselinePath,
      update: true,
      liveBundleJs,
      css: CHART_CSS,
    });

    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/Updated baseline/i);
    expect(existsSync(baselinePath)).toBe(true);
    // Verify it is a real PNG (magic bytes) and non-trivially sized.
    const png = readFileSync(baselinePath);
    expect(png.length).toBeGreaterThan(100);
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  }, 60_000);
});
