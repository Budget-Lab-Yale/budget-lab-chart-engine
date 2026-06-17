// esbuild build: compiles the TS sources to ESM under dist/.
// - CLI is bundled to a single Node-targeted file (dist/cli/index.js).
// - The engine is bundled for the browser as a shared, versioned bundle later;
//   for now we emit per-entry ESM so the package `exports` resolve.
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
const version = pkg.version;

const common = {
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  sourcemap: true,
  logLevel: "info",
  define: { __ENGINE_VERSION__: JSON.stringify(version) },
};

// CLI: bundle for Node, keep dependencies external (resolved from node_modules).
await build({
  ...common,
  platform: "node",
  packages: "external",
  entryPoints: ["src/cli/index.ts"],
  outfile: "dist/cli/index.js",
  banner: { js: "#!/usr/bin/env node" },
});

// Engine entry: the browser artifact. Self-contained (vendors Plot/D3, zero npm/node deps)
// and platform-neutral so it runs anywhere.
await build({
  ...common,
  entryPoints: ["src/engine/index.ts"],
  outdir: "dist",
  outbase: "src",
});

// Spec + data entries: Node library entries. The validator depends on ajv and the data
// loader on node built-ins (fs/path) — both are authoring/CLI concerns, not part of the
// browser engine bundle. Built for Node with deps + builtins external (resolved at runtime).
await build({
  ...common,
  platform: "node",
  packages: "external",
  entryPoints: ["src/spec/index.ts", "src/data/index.ts"],
  outdir: "dist",
  outbase: "src",
});

// Live embed bundle: self-contained browser IIFE. Bundles the engine + all vendored
// Plot/D3 so the standalone HTML needs no network request for JS. The entry sets
// globalThis.BudgetLabChart = { mountChart }.
await build({
  ...common,
  format: "iife",
  platform: "browser",
  bundle: true,
  globalName: "BudgetLabChart",
  entryPoints: ["src/embed/standalone-entry.ts"],
  outfile: "dist/embed/live.js",
});

// Embed helpers as separate Node entries: used by the snapshot selftest script
// to build standalone HTML without duplicating the full CLI bundle import path.
await build({
  ...common,
  platform: "node",
  packages: "external",
  entryPoints: [
    "src/embed/bundle-standalone.ts",
    "src/embed/styles.ts",
  ],
  outdir: "dist",
  outbase: "src",
});

// Snapshot utilities: Node library entries used by the selftest script and
// potentially by other tooling. Built for Node with deps external (playwright,
// pngjs, pixelmatch resolved from node_modules at runtime).
await build({
  ...common,
  platform: "node",
  packages: "external",
  entryPoints: [
    "src/snapshot/render-png.ts",
    "src/snapshot/compare.ts",
  ],
  outdir: "dist",
  outbase: "src",
});

console.log(`built ${pkg.name}@${version}`);
