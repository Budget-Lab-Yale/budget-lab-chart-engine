// Mechanical gates for two hard invariants (AGENTS.md) that were enforced only by prose and review:
//
//   1. No `eval` / `new Function` in shipped code. Published pages run under a strict CSP.
//   2. Module graph: `src/spec/*` must not import `src/engine/*`, and `src/engine/overlays.ts` must
//      not import `annotation-legend.ts`.
//
// Both scans read the TypeScript AST, so comments that name `eval` (src/spec/expr.ts explains why
// it is not used) do not trip them. `src/engine/vendor/` is excluded: d3's minified DSV code holds
// a textual `new Function` the engine never reaches (see AGENTS.md).
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { buildStandaloneHtml } from "../src/embed/bundle-standalone";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const VENDOR = join(SRC, "engine", "vendor");

function* sourceFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (p !== VENDOR) yield* sourceFiles(p);
    } else if (/\.(ts|js|mjs)$/.test(e.name) && !e.name.endsWith(".d.ts")) {
      yield p;
    }
  }
}

const rel = (p: string) => relative(ROOT, p).split(sep).join("/");

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
}

const GLOBALS = new Set(["globalThis", "window", "self", "global"]);

/** `(eval)`, `(0, eval)`, `eval as any` all call the same global. */
function unwrap(e: ts.Expression): ts.Expression {
  for (;;) {
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
    else if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.CommaToken) e = e.right;
    else return e;
  }
}

/** `eval(...)`, `Function(...)`, `new Function(...)`, also reached through a global object
 *  (`globalThis.eval`, `window["Function"]`). A method merely named `eval` on another object is not
 *  dynamic code and is not flagged. */
function dynamicCodeSites(sf: ts.SourceFile): string[] {
  const hits: string[] = [];
  const onGlobal = (e: ts.Expression) => {
    const r = unwrap(e);
    return ts.isIdentifier(r) && GLOBALS.has(r.text);
  };
  const calleeName = (callee: ts.Expression): string | undefined => {
    const e = unwrap(callee);
    if (ts.isIdentifier(e)) return e.text;
    if (ts.isPropertyAccessExpression(e) && onGlobal(e.expression)) return e.name.text;
    if (ts.isElementAccessExpression(e) && onGlobal(e.expression) &&
        ts.isStringLiteralLike(e.argumentExpression)) return e.argumentExpression.text;
    return undefined;
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const name = calleeName(node.expression);
      if (name === "eval" || name === "Function") {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        hits.push(`${name} at line ${line + 1}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/** Every module specifier a file imports or re-exports, static or dynamic, resolved to an absolute path. */
function importTargets(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const add = (spec: string) => {
    if (spec.startsWith(".")) out.push(resolve(dirname(sf.fileName), spec));
  };
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
               node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      add(node.arguments[0].text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) &&
               ts.isStringLiteral(node.argument.literal)) {
      add(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const within = (target: string, dir: string) => target === dir || target.startsWith(dir + sep);
const stripExt = (p: string) => p.replace(/\.(ts|js|mjs)$/, "");

describe("hard invariants — mechanical scans of src/", () => {
  const files = [...sourceFiles(SRC)];

  it("finds the source tree", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("no eval / Function / new Function outside src/engine/vendor", () => {
    const found = files.flatMap((f) => dynamicCodeSites(parse(f)).map((h) => `${rel(f)}: ${h}`));
    expect(found).toEqual([]);
  });

  it("src/spec/* imports nothing from src/engine/*", () => {
    const engine = join(SRC, "engine");
    const found = files
      .filter((f) => within(f, join(SRC, "spec")))
      .flatMap((f) => importTargets(parse(f)).filter((t) => within(t, engine)).map((t) => `${rel(f)} -> ${rel(t)}`));
    expect(found).toEqual([]);
  });

  it("src/engine/overlays.ts does not import annotation-legend.ts", () => {
    const legend = join(SRC, "engine", "annotation-legend");
    const targets = importTargets(parse(join(SRC, "engine", "overlays.ts"))).map(stripExt);
    expect(targets).not.toContain(legend);
  });

  // Published pages also run code that lives in source as a string: the bootstrap that
  // buildStandaloneHtml writes into an inline <script>. Shared-asset mode links the runtime bundle
  // (whose vendored d3 holds the inert `new Function`) instead of inlining it, so every inline
  // script left on the page is engine-authored.
  it("the inline scripts of a standalone page contain no dynamic code", () => {
    const scripts = (["mountChart", "mountTable"] as const).flatMap((mountFn) => {
      const html = buildStandaloneHtml({
        spec: { chartType: "line", title: "t" },
        rows: [],
        css: "",
        assets: { base: "../../embed/v1", version: "0.0.0" },
        eyebrow: "Figure 1",
        mountFn,
      });
      return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "");
    });
    expect(scripts.length).toBe(2);
    const found = scripts.flatMap((s, i) =>
      dynamicCodeSites(ts.createSourceFile(`inline-${i}.js`, s, ts.ScriptTarget.Latest, true)),
    );
    expect(found).toEqual([]);
  });
});

// The scans must fail on the thing they guard, or a green run proves nothing.
describe("hard invariants — the scans catch violations", () => {
  const fake = (name: string, text: string) =>
    ts.createSourceFile(join(SRC, name), text, ts.ScriptTarget.Latest, true);

  it("flags each dynamic-code form and ignores comments and strings", () => {
    const sf = fake(
      "spec/x.ts",
      [
        "// eval(1) in a comment",
        'const s = "new Function()";',
        "eval('1');",
        "globalThis.eval('1');",
        "new Function('return 1');",
        "Function('return 1')();",
        "(0, eval)('1');",
        "(eval)('1');",
        "window['Function']('return 1');",
        "new (Function)('return 1');",
        "const safe = { eval: (x: number) => x };",
        "safe.eval(1);",
      ].join("\n"),
    );
    expect(dynamicCodeSites(sf)).toEqual([
      "eval at line 3",
      "eval at line 4",
      "Function at line 5",
      "Function at line 6",
      "eval at line 7",
      "eval at line 8",
      "Function at line 9",
      "Function at line 10",
    ]);
  });

  it("resolves static, re-export, dynamic and type imports", () => {
    const sf = fake(
      "spec/x.ts",
      [
        'import { a } from "../engine/a";',
        'export { b } from "../engine/b";',
        'const c = await import("../engine/c");',
        "const c2 = await import(`../engine/c2`);",
        'type D = import("../engine/d").D;',
        'import { e } from "./e";',
        'import { f } from "vitest";',
      ].join("\n"),
    );
    const engine = join(SRC, "engine");
    expect(importTargets(sf).filter((t) => within(t, engine)).map(rel)).toEqual([
      "src/engine/a",
      "src/engine/b",
      "src/engine/c",
      "src/engine/c2",
      "src/engine/d",
    ]);
  });
});
