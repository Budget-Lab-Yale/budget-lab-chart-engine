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

// Library entry points consumed via package `exports`.
await build({
  ...common,
  entryPoints: ["src/engine/index.ts", "src/spec/index.ts", "src/data/index.ts"],
  outdir: "dist",
  outbase: "src",
});

console.log(`built ${pkg.name}@${version}`);
