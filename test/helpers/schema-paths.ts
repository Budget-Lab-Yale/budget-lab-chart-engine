// Field paths of a JSON schema (src/spec/schema.ts, src/spec/table-schema.ts), shared by the two
// schema gates: test/schema-doc-coverage.test.ts and test/types-schema-sync.test.ts.
//
// Path grammar: a property is `.name` (no dot at the top level), an array's items `[]`, and a map's
// values (`additionalProperties: {schema}`) `.*`. Every `anyOf` / `oneOf` / `allOf` branch is walked
// under the same path, so `data.file` and `data.url` both come from the one `data` field.
//
// The walker knows a fixed set of keywords and throws on any other, so a construct it cannot see
// into (`if`/`then`, `patternProperties`, `$ref`, ...) fails both gates instead of hiding fields.

export interface SchemaField {
  /** e.g. `annotations.xAxis[].labelSide`, `series_styles.*.dashed`. */
  path: string;
  /** Required in each object branch that declares it (two branches may disagree). */
  required: Set<boolean>;
}

export interface SchemaWalk {
  fields: Map<string, SchemaField>;
  /** Literal members (`enum` / `const`) reached at each path, as `literalKey()` strings. Paths with
   *  none are absent. */
  enums: Map<string, Set<string>>;
}

/** One literal value as a comparable string that keeps its kind: `"lm"` and `2` stay distinct. */
export function literalKey(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v === null) return "null";
  throw new Error(`literal of unsupported kind: ${JSON.stringify(v)}`);
}

/** Keywords the walker understands. Constraint-only keywords hold no fields; the rest are walked. */
const CONSTRAINTS = new Set([
  "$id", "type", "required", "enum", "const", "minLength", "maxLength", "pattern", "minimum", "maximum",
  "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minItems", "maxItems", "uniqueItems",
  "minProperties", "maxProperties", "propertyNames", "description",
]);
const WALKED = new Set(["properties", "items", "additionalProperties", "anyOf", "oneOf", "allOf"]);

type Node = Record<string, unknown>;

export function walkSchema(schema: unknown): SchemaWalk {
  const fields = new Map<string, SchemaField>();
  const enums = new Map<string, Set<string>>();
  const addEnum = (path: string, v: unknown): void => {
    if (!enums.has(path)) enums.set(path, new Set());
    enums.get(path)!.add(literalKey(v));
  };
  const visit = (s: unknown, path: string): void => {
    if (typeof s === "boolean") return;
    if (!s || typeof s !== "object" || Array.isArray(s)) throw new Error(`${path || "(root)"}: not a schema`);
    const n = s as Node;
    for (const k of Object.keys(n)) {
      if (!CONSTRAINTS.has(k) && !WALKED.has(k)) {
        throw new Error(`${path || "(root)"}: schema keyword "${k}" is not understood by test/helpers/schema-paths.ts`);
      }
    }
    for (const kw of ["anyOf", "oneOf", "allOf"] as const) {
      if (n[kw] !== undefined) for (const b of n[kw] as unknown[]) visit(b, path);
    }
    if (Array.isArray(n.enum)) for (const v of n.enum) addEnum(path, v);
    if ("const" in n) addEnum(path, n.const);
    if (n.properties !== undefined) {
      const required = new Set(Array.isArray(n.required) ? (n.required as string[]) : []);
      for (const [k, v] of Object.entries(n.properties as Node)) {
        const p = path ? `${path}.${k}` : k;
        if (!fields.has(p)) fields.set(p, { path: p, required: new Set() });
        fields.get(p)!.required.add(required.has(k));
        visit(v, p);
      }
    }
    if (n.items !== undefined) visit(n.items, `${path}[]`);
    if (n.additionalProperties !== undefined && typeof n.additionalProperties === "object") {
      visit(n.additionalProperties, `${path}.*`);
    }
  };
  visit(schema, "");
  return { fields, enums };
}
