#!/usr/bin/env node
// Determinism self-check for the visual snapshot harness.
//
// Renders the example chart twice via headless Chromium and confirms the two
// PNG buffers are pixel-identical (diffPixels === 0).  No committed baseline
// is required — this only proves the render is stable on this machine.
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
// runSnapshot builds the HTML from spec+data internally, so we use it to get
// the HTML rather than duplicating all the spec/data/embed wiring here.
// But runSnapshot returns {exitCode, message}, not the HTML or PNG buffer.
// So we import the lower-level helpers via the CLI module's re-exported pieces.
// Actually the cleanest path: import runSnapshot with update:false using a
// temp baseline path, but we want the raw PNG buffers for comparison.
// Instead: build the HTML directly using the snapshot path modules.

// The spec/data/embed helpers were bundled into dist/cli/index.js as non-exports.
// We added dist/snapshot/*.js but the HTML-building functions are not in there.
// Use a small inline helper that mirrors what the CLI does, importing from the
// dist Node-library entries that ARE separate: dist/spec/index.js, dist/data/index.js.
// For buildStandaloneHtml + CHART_CSS, these were NOT emitted as separate files by
// the original build — they're inlined into dist/cli/index.js.
// Solution: add them as build entries (done in build.mjs above with the snapshot entries).
// Let's check if they exist; if not, guide the user.

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

// ── 4. Build chart HTML for the example spec ─────────────────────────────────

const exampleSpecPath = resolve(repoRoot, "examples", "augmented-occupations", "chart.yaml");
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

const result = comparePng(png1, png2);

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
