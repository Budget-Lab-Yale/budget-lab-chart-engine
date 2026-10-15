#!/usr/bin/env node
// Runs every golden-bearing test file (any test/**/*.test.ts that calls toMatchFileSnapshot), so a
// new golden test joins automatically with no list to maintain.
//
//   npm run goldens          verify: snapshot writing is OFF (--update=none), so a missing or
//                            mismatching golden FAILS exactly as it does in CI.
//   npm run goldens:record   record: --update=new writes goldens that do not exist yet (existing
//                            ones are still compared, never overwritten). This is the one explicit
//                            path for adding a NEW golden. Re-recording an existing golden is
//                            forbidden by CLAUDE.md (Hard invariants), so "all" is never offered.
//
// Orphan guard: every *.golden.svg under test/ must be named (its file name, literally) in one of
// the discovered test files. A golden nothing compares against guards nothing, and a renamed case
// would otherwise leave its old file behind looking like coverage.
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { basename, join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function* walk(dir, suffix) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, suffix);
    else if (e.name.endsWith(suffix)) yield p;
  }
}

const rel = (f) => relative(root, f).split("\\").join("/");
const mode = process.argv[2] === "record" ? "new" : "none";
const sources = [...walk(join(root, "test"), ".test.ts")]
  .map((f) => ({ f, text: readFileSync(f, "utf8") }))
  .filter(({ text }) => text.includes("toMatchFileSnapshot"));
const files = sources.map(({ f }) => rel(f));

if (files.length === 0) {
  console.error("goldens: found no test files that use toMatchFileSnapshot");
  process.exit(1);
}

// The name must follow a path separator or a quote, so "bar.golden.svg" is not satisfied by a
// reference to "stacked-bar.golden.svg".
const named = (text, name) =>
  new RegExp(`[/\\\\"'\`]${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(text);
const orphans = [...walk(join(root, "test"), ".golden.svg")]
  .filter((g) => !sources.some(({ text }) => named(text, basename(g))))
  .map(rel);
if (orphans.length > 0) {
  console.error("goldens: these goldens are not named in any golden test file (orphans):");
  for (const o of orphans) console.error(`  ${o}`);
  process.exit(1);
}

// Node + vitest's own bin, no shell: arguments reach vitest verbatim, so a path with spaces is safe.
const require = createRequire(import.meta.url);
const vitestPkgPath = require.resolve("vitest/package.json");
const vitestBin = join(dirname(vitestPkgPath), JSON.parse(readFileSync(vitestPkgPath, "utf8")).bin.vitest);

const r = spawnSync(process.execPath, [vitestBin, "run", `--update=${mode}`, ...files], {
  cwd: root,
  stdio: "inherit",
});
if (r.error) console.error(`goldens: could not start vitest: ${r.error.message}`);
process.exit(r.status ?? 1);
