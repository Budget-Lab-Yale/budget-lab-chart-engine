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
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith(".test.ts")) yield p;
  }
}

const mode = process.argv[2] === "record" ? "new" : "none";
const files = [...walk(join(root, "test"))]
  .filter((f) => readFileSync(f, "utf8").includes("toMatchFileSnapshot"))
  .map((f) => relative(root, f).split("\\").join("/"));

if (files.length === 0) {
  console.error("goldens: found no test files that use toMatchFileSnapshot");
  process.exit(1);
}

const r = spawnSync("npx", ["vitest", "run", `--update=${mode}`, ...files], {
  cwd: root,
  stdio: "inherit",
  shell: true,
});
process.exit(r.status ?? 1);
