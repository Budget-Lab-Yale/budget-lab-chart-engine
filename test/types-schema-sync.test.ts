// The TypeScript contract (src/spec/types.ts ChartSpec, src/spec/table-types.ts TableSpec) and the
// runtime JSON schemas (src/spec/schema.ts, src/spec/table-schema.ts) describe the same shape and
// were held in lockstep by hand. This walks both and compares, per field path
// (test/helpers/schema-paths.ts grammar: `.name`, `[]`, `.*`):
//   - the set of field paths,
//   - whether each is required (an optional `?` property vs the schema's `required`),
//   - the literal members at each path, string, number and boolean alike (a TS literal union vs the
//     schema's `enum`/`const`). A TS `boolean` is the union `true | false` and is not a literal set.
// Any other kind of type the walk cannot compare (a template literal, `bigint`) throws.
// Types are read through the TypeScript compiler API, not by parsing text, so aliases (`ColorRef`,
// `ValueFormat`), unions and `Record<string, T>` resolve as the compiler sees them.
import { describe, it, expect, beforeAll } from "vitest";
import ts from "typescript";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHART_SPEC_SCHEMA } from "../src/spec/schema";
import { TABLE_SPEC_SCHEMA } from "../src/spec/table-schema";
import { walkSchema, literalKey, type SchemaWalk } from "./helpers/schema-paths";

const SPEC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "spec");
const TYPES = join(SPEC_DIR, "types.ts");
const TABLE_TYPES = join(SPEC_DIR, "table-types.ts");

let program: ts.Program;
beforeAll(() => {
  program = ts.createProgram([TYPES, TABLE_TYPES], {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  });
});

function walkType(file: string, typeName: string): SchemaWalk {
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(file);
  if (!sf) throw new Error(`no source file ${file}`);
  const mod = checker.getSymbolAtLocation(sf);
  const sym = mod && checker.getExportsOfModule(mod).find((s) => s.name === typeName);
  if (!sym) throw new Error(`${typeName} is not exported from ${file}`);

  const fields: SchemaWalk["fields"] = new Map();
  const enums: SchemaWalk["enums"] = new Map();
  const visit = (t: ts.Type, path: string, depth: number): void => {
    if (depth > 12) throw new Error(`type recursion at ${path}`);
    const addEnum = (v: unknown): void => {
      if (!enums.has(path)) enums.set(path, new Set());
      enums.get(path)!.add(literalKey(v));
    };
    if (t.isUnion()) {
      const bools = t.types.filter((m) => m.flags & ts.TypeFlags.BooleanLiteral).map((m) => checker.typeToString(m));
      const isBoolean = bools.includes("true") && bools.includes("false");
      for (const m of t.types) if (!(isBoolean && m.flags & ts.TypeFlags.BooleanLiteral)) visit(m, path, depth);
      return;
    }
    if (t.isStringLiteral() || t.isNumberLiteral()) return addEnum(t.value);
    if (t.flags & ts.TypeFlags.BooleanLiteral) return addEnum(checker.typeToString(t) === "true");
    if (t.flags & (ts.TypeFlags.TemplateLiteral | ts.TypeFlags.StringMapping | ts.TypeFlags.BigIntLike | ts.TypeFlags.EnumLike)) {
      throw new Error(`${path}: type ${checker.typeToString(t)} is not compared by this gate`);
    }
    if (!(t.flags & ts.TypeFlags.Object)) return;
    if (checker.isArrayType(t) || checker.isTupleType(t)) {
      for (const el of checker.getTypeArguments(t as ts.TypeReference)) visit(el, `${path}[]`, depth + 1);
      return;
    }
    const index = checker.getIndexTypeOfType(t, ts.IndexKind.String);
    if (index) visit(index, `${path}.*`, depth + 1);
    for (const prop of checker.getPropertiesOfType(t)) {
      const p = path ? `${path}.${prop.name}` : prop.name;
      if (!fields.has(p)) fields.set(p, { path: p, required: new Set() });
      fields.get(p)!.required.add((prop.flags & ts.SymbolFlags.Optional) === 0);
      visit(checker.getNonNullableType(checker.getTypeOfSymbol(prop)), p, depth + 1);
    }
  };
  visit(checker.getDeclaredTypeOfSymbol(sym), "", 0);
  return { fields, enums };
}

/** Every disagreement between the two walks, one line each; empty when in sync. */
function diff(types: SchemaWalk, schema: SchemaWalk): string[] {
  const out: string[] = [];
  const flags = (s: Set<boolean>): string => [...s].map((b) => (b ? "required" : "optional")).sort().join("|");
  for (const p of types.fields.keys()) if (!schema.fields.has(p)) out.push(`${p}: in the type, not the schema`);
  for (const p of schema.fields.keys()) if (!types.fields.has(p)) out.push(`${p}: in the schema, not the type`);
  for (const [p, f] of types.fields) {
    const s = schema.fields.get(p);
    if (s && flags(f.required) !== flags(s.required)) {
      out.push(`${p}: ${flags(f.required)} in the type, ${flags(s.required)} in the schema`);
    }
  }
  for (const p of new Set([...types.enums.keys(), ...schema.enums.keys()])) {
    const a = [...(types.enums.get(p) ?? [])].sort();
    const b = [...(schema.enums.get(p) ?? [])].sort();
    if (a.join("\0") !== b.join("\0")) out.push(`${p}: enum [${a.join(", ")}] in the type, [${b.join(", ")}] in the schema`);
  }
  return out;
}

describe("spec types and JSON schemas agree", () => {
  it("ChartSpec (types.ts) and CHART_SPEC_SCHEMA (schema.ts)", () => {
    const types = walkType(TYPES, "ChartSpec");
    const schema = walkSchema(CHART_SPEC_SCHEMA);
    expect(diff(types, schema)).toEqual([]);
    // The walk reaches the leaves, so an empty diff is not an empty comparison.
    expect(schema.fields.size).toBeGreaterThan(300);
    expect(types.enums.get("chartType")?.has(literalKey("treemap"))).toBe(true);
    expect(types.fields.get("annotations.points[].label")?.required).toEqual(new Set([true]));
  });

  it("TableSpec (table-types.ts) and TABLE_SPEC_SCHEMA (table-schema.ts)", () => {
    const types = walkType(TABLE_TYPES, "TableSpec");
    const schema = walkSchema(TABLE_SPEC_SCHEMA);
    expect(diff(types, schema)).toEqual([]);
    expect(schema.fields.size).toBeGreaterThan(70);
    expect(types.enums.get("format.columns.*.type")?.has(literalKey("currency"))).toBe(true);
  });
});
