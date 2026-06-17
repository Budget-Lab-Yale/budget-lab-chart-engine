// Vitest globalSetup: build the standalone browser IIFE bundle once, in real Node, before
// the test pool starts. esbuild's JS API throws inside vitest's module-runner realm
// (cross-realm Uint8Array invariant), so the standalone-bundle regression test can't build
// in-process — it reads the artifact this setup writes.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const BUNDLE_PATH = fileURLToPath(new URL("../.tmp/standalone-live.js", import.meta.url));

export default async function setup(): Promise<void> {
  const entry = fileURLToPath(new URL("../../src/embed/standalone-entry.ts", import.meta.url));
  mkdirSync(dirname(BUNDLE_PATH), { recursive: true });
  await build({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    platform: "browser",
    globalName: "BudgetLabChart",
    outfile: BUNDLE_PATH,
    logLevel: "silent",
  });
}
