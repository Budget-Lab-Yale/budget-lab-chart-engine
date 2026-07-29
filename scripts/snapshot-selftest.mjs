#!/usr/bin/env node
// Determinism self-check for the visual snapshot harness.
//
// Renders a fixture chart twice via headless Chromium and confirms the two
// PNG buffers are pixel-identical (diffPixels === 0).  No committed baseline
// is required — this only proves the render is stable on this machine.
//
// It is also the only check that exercises the BUILT dist/ end to end: the vitest
// suite imports from src/, so it would pass even if the build emitted a broken
// bundle — and dist/ is what consumers get, since they install by git tag and
// rebuild via `prepare`. CI runs browser-free, so this stays a local gate.
//
// Run AFTER `npm run build`:
//   npm run build && npm run snapshot:selftest

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

// ── 1. Verify build artefacts are present ────────────────────────────────────

const liveBundlePath = resolve(repoRoot, "dist", "embed", "live.js");
const renderPngPath = resolve(repoRoot, "dist", "snapshot", "render-png.js");
const comparePath = resolve(repoRoot, "dist", "snapshot", "compare.js");
const cliIndexPath = resolve(repoRoot, "dist", "cli", "index.js");

for (const p of [liveBundlePath, renderPngPath, comparePath, cliIndexPath]) {
  if (!existsSync(p)) {
    console.error(`FAIL: ${p} not found.\nRun \`npm run build\` before running the snapshot selftest.`);
    process.exit(1);
  }
}

// ── 2. Import built utilities ─────────────────────────────────────────────────

const { renderChartPng } = await import(pathToFileURL(renderPngPath).href);
const { comparePng } = await import(pathToFileURL(comparePath).href);

// The HTML is assembled here rather than via the CLI's `runSnapshot`, which returns
// {exitCode, message} — this check needs the raw PNG buffers to compare.

const bundleStandalonePath = resolve(repoRoot, "dist", "embed", "bundle-standalone.js");
const stylesPath = resolve(repoRoot, "dist", "embed", "styles.js");

for (const p of [bundleStandalonePath, stylesPath]) {
  if (!existsSync(p)) {
    console.error(`FAIL: ${p} not found.\nRun \`npm run build\` first.`);
    process.exit(1);
  }
}

const { buildStandaloneHtml } = await import(pathToFileURL(bundleStandalonePath).href);
const { CHART_CSS } = await import(pathToFileURL(stylesPath).href);

// ── 3. Import spec/data helpers ───────────────────────────────────────────────

const { parse: parseYaml } = await import("yaml");
const specIndexPath = resolve(repoRoot, "dist", "spec", "index.js");
const dataIndexPath = resolve(repoRoot, "dist", "data", "index.js");

const { validateSpec, validateChart } = await import(pathToFileURL(specIndexPath).href);
const { loadData } = await import(pathToFileURL(dataIndexPath).href);

// ── 4. Build chart HTML for the fixture spec ──────────────────────────────────

// The engine ships no bundled example data (examples/ was removed in a32714a), so this renders the
// same in-repo fixture the CLI and serve tests were repointed onto by that commit.
const exampleSpecPath = resolve(repoRoot, "test", "fixtures", "sample-chart", "chart.yaml");
if (!existsSync(exampleSpecPath)) {
  console.error(`FAIL: ${exampleSpecPath} not found.\nThe selftest needs an in-repo spec to render.`);
  process.exit(1);
}
const specDir = dirname(exampleSpecPath);

const specText = await readFile(exampleSpecPath, "utf8");
const spec = parseYaml(specText);

const structural = validateSpec(spec);
if (!structural.valid) {
  console.error("FAIL: spec validation failed:", structural.errors.join(", "));
  process.exit(1);
}

const rows = await loadData(spec.data, { baseDir: specDir });
const validation = validateChart(spec, rows);
if (!validation.valid) {
  console.error("FAIL: chart validation failed:", validation.errors.join(", "));
  process.exit(1);
}

const liveBundleJs = await readFile(liveBundlePath, "utf8");
const html = buildStandaloneHtml({ spec, rows, liveBundleJs, css: CHART_CSS });

// ── 5. Render twice and compare ───────────────────────────────────────────────

console.log("Rendering chart (pass 1)...");
const png1 = await renderChartPng(html);

console.log("Rendering chart (pass 2)...");
const png2 = await renderChartPng(html);

const result = await comparePng(png1, png2);

if (result.diffPixels === 0) {
  console.log(`PASS: render is deterministic (diffPixels=0, totalPixels=${result.totalPixels})`);
  process.exit(0);
} else {
  console.error(
    `FAIL: renders differ by ${result.diffPixels} of ${result.totalPixels} pixels.\n` +
      "This may indicate a font-loading race or animation in the chart.",
  );
  process.exit(1);
}
