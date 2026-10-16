// Every field the chart and table JSON schemas accept is documented in CONFIG-SPEC.md, which calls
// itself "the authoritative list of fields the engine accepts". Before this gate the whole
// `waterfall` block, `valueLabels.signed`, `category_order` and table `collapsible.control` were
// accepted and undocumented.
//
// THE RULE. Schema paths (test/helpers/schema-paths.ts) are compared with `[]` and `.*` dropped:
// `title_selectors.*.options[].id` reads `title_selectors.options.id`. Chart paths are looked up in
// the `## chart.yaml` half of the doc, table paths in the `## table.yaml` half. Fenced code blocks
// (indented or not) are ignored.
// - A FIELD ROW is a body row of a table whose header's first cell is `field` or `form` (the Data
//   table). Each code span in its first cell NAMES a path: the text up to the first space or colon,
//   and a span starting with `.` continues the previous span's parent (`shading[].from` / `.to`).
// - A field row DECLARES keys, from its own cells only:
//   (a) keys of a `{...}` shape span (one holding `,` or `:`): each identifier followed by `?`,
//       `,`, `:`, `}`, `]` or `|`, and not a quoted string, a value after `:` or a `<placeholder>`.
//       So `{x, label?, value_format?}` declares x, label, value_format;
//   (b) the last segment of a span naming a path under the row's own path (`connector.color` in the
//       `connector` row declares `color`);
//   (c) every field of a TYPE TABLE (a table headed `<Type> field`) whose type name the row
//       mentions: `format.default`'s type cell reads `FormatRule`, so it declares the FormatRule
//       table's `type`, `decimals`, ...
// 1. A field is documented when a field row names it or a descendant (a container such as
//    `waterfall` is documented by its fields' rows). A top-level field must pass this way.
// 2. A nested field is also documented when its last segment is declared by a row that names its
//    nearest ancestor that any field row names exactly.
// SHARED FRAGMENTS. A schema fragment reused under another path is matched as the path it is
// documented at, and the test checks the two are the same schema object: the legacy axis-policy
// arrays (the doc also has to say they mean the same), and the `{decimals, prefix, suffix}` value
// format under each annotation and `gap_annotation.format`.
// LIMITS. Rule 2 compares the last segment only, so a key declared anywhere in the ancestor's row
// passes at any depth below it: `title_selectors`' `{options: [{id, label?, color?}], default?}`
// would also pass a misplaced `title_selectors.*.id`. A type-name mention anywhere in a row counts
// (`sign_color`'s `FormatRule.signColor` gives it the FormatRule keys). Prose outside the row is
// never read (no field row has a list block under it today), so a field the doc explains only in a
// paragraph below its table fails until a row declares it.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHART_SPEC_SCHEMA } from "../src/spec/schema";
import { TABLE_SPEC_SCHEMA } from "../src/spec/table-schema";
import { walkSchema } from "./helpers/schema-paths";

const DOC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "CONFIG-SPEC.md"), "utf8");

/** Fields deliberately absent from CONFIG-SPEC, each with its reason. Keep it empty if possible. */
const UNDOCUMENTED = new Map<string, string>();

/** [schema path of the reuse, schema path it is documented at]. Each pair is one schema object. */
const CHART_ALIASES: Array<[reuse: string, documented: string]> = [
  ["xAxisPolicy.markers", "annotations.xAxis"],
  ["xAxisPolicy.bands", "annotations.bands"],
  ["yAxisPolicy.markers", "annotations.yAxis"],
  ["annotations.xAxis[].value_format", "value_format"],
  ["annotations.yAxis[].value_format", "value_format"],
  ["annotations.points[].value_format", "value_format"],
  ["gap_annotation.format", "value_format"],
];

interface Row {
  named: string[]; // normalised paths the first cell names
  keys: Set<string>; // keys the row declares (rules a-c)
  text: string; // the row's raw cells, for type-name mentions
}

const norm = (p: string): string => p.replace(/\[\]/g, "").replace(/\.\*/g, "");
const parent = (p: string): string => (p.includes(".") ? p.slice(0, p.lastIndexOf(".")) : "");
const leaf = (p: string): string => p.slice(p.lastIndexOf(".") + 1);
const SPAN_RE = /`([^`]+)`/g;
const SHAPE_KEY_RE = /(?<![<\w.$])(?<!:\s*)([A-Za-z_]\w*)\??\s*(?=[,}:\]|\\])/g;
const FENCE_RE = /^\s*(```|~~~)/;

/** First token of a span as a path (`data: { file }` -> `data`). */
const spanPath = (span: string): string => span.trim().split(/[\s:]/)[0]!;

/** The field rows of one `## ...` half of the doc. */
function rowsOf(half: string): Row[] {
  const lines = DOC.split(/\r?\n/);
  const start = lines.findIndex((l) => l === `## \`${half}\``);
  expect(start, `CONFIG-SPEC has a "## \`${half}\`" heading`).toBeGreaterThanOrEqual(0);
  const rows: Row[] = [];
  const typeKeys = new Map<string, Set<string>>();
  let fenced = false;
  let table: { kind: "field" } | { kind: "type"; name: string } | null = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (FENCE_RE.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    if (/^## /.test(line)) break;
    if (!line.startsWith("|")) { table = null; continue; }
    const cells = line.split(/(?<!\\)\|/).slice(1, -1);
    const first = cells[0]?.trim() ?? "";
    if (/^:?-+:?$/.test(first)) continue; // the |---|---| separator
    if (/^\|\s*:?-+/.test(lines[i + 1] ?? "")) {
      // A header row (the next line is the separator).
      const type = /^(\w+) field$/.exec(first);
      table = first === "field" || first === "form" ? { kind: "field" } : type ? { kind: "type", name: type[1]! } : null;
      if (table?.kind === "type") typeKeys.set(table.name, new Set());
      continue;
    }
    if (!table) continue;
    const firstSpans = [...first.matchAll(SPAN_RE)].map((m) => spanPath(m[1]!));
    if (table.kind === "type") {
      for (const p of firstSpans) typeKeys.get(table.name)!.add(p);
      continue;
    }
    const named: string[] = [];
    let prev = "";
    for (let p of firstSpans) {
      if (p.startsWith(".")) p = parent(prev) + p;
      prev = p;
      named.push(norm(p));
    }
    const keys = new Set<string>();
    for (const m of line.matchAll(SPAN_RE)) {
      const span = m[1]!;
      if (span.includes("{") && /[,:]/.test(span)) {
        for (const k of span.replace(/"[^"]*"/g, '""').matchAll(SHAPE_KEY_RE)) keys.add(k[1]!);
      }
      const p = norm(spanPath(span));
      if (named.some((n) => p.startsWith(`${n}.`))) keys.add(leaf(p));
    }
    rows.push({ named, keys, text: cells.join("|") });
  }
  for (const row of rows) {
    for (const [name, fields] of typeKeys) {
      if (new RegExp(`\\b${name}\\b`).test(row.text)) for (const f of fields) row.keys.add(f);
    }
  }
  return rows;
}

function undocumented(schema: unknown, half: string, aliases: Array<[string, string]>): string[] {
  const rows = rowsOf(half);
  const exact = (p: string): Row[] => rows.filter((r) => r.named.includes(p));
  const normAliases = aliases.map(([a, b]) => [norm(a), norm(b)] as const);
  const missing: string[] = [];
  const fields = [...walkSchema(schema).fields.keys()];
  for (const raw of fields) {
    let p = norm(raw);
    for (let changed = true; changed;) {
      changed = false;
      for (const [reuse, documented] of normAliases) {
        if (p === reuse || p.startsWith(`${reuse}.`)) { p = documented + p.slice(reuse.length); changed = true; }
      }
    }
    if (rows.some((r) => r.named.some((n) => n === p || n.startsWith(`${p}.`)))) continue;
    let anc = parent(p);
    while (anc && exact(anc).length === 0) anc = parent(anc);
    if (anc !== "" && exact(anc).some((r) => r.keys.has(leaf(p)))) continue;
    missing.push(raw);
  }
  return missing.filter((p) => !UNDOCUMENTED.has(p));
}

/** Every schema fragment at a raw path (`[]` = items, `.*` = map values), across anyOf branches. */
function fragmentsAt(schema: unknown, path: string): unknown[] {
  let cur: unknown[] = [schema];
  for (const step of path.match(/[^.[\]]+|\[\]/g) ?? []) {
    const branches = (s: unknown): unknown[] => {
      const n = s as Record<string, unknown>;
      return [n, ...((n.anyOf ?? n.oneOf ?? []) as unknown[])];
    };
    cur = cur.flatMap(branches).flatMap((s) => {
      const n = s as Record<string, unknown>;
      if (step === "[]") return n.items ? [n.items] : [];
      if (step === "*") return n.additionalProperties && typeof n.additionalProperties === "object" ? [n.additionalProperties] : [];
      const props = n.properties as Record<string, unknown> | undefined;
      return props?.[step] ? [props[step]] : [];
    });
  }
  return cur;
}

describe("CONFIG-SPEC documents every schema field", () => {
  it("chart.yaml: every CHART_SPEC_SCHEMA field path", () => {
    expect(walkSchema(CHART_SPEC_SCHEMA).fields.size).toBeGreaterThan(300);
    expect(undocumented(CHART_SPEC_SCHEMA, "chart.yaml", CHART_ALIASES)).toEqual([]);
  });

  it("table.yaml: every TABLE_SPEC_SCHEMA field path", () => {
    expect(walkSchema(TABLE_SPEC_SCHEMA).fields.size).toBeGreaterThan(70);
    expect(undocumented(TABLE_SPEC_SCHEMA, "table.yaml", [])).toEqual([]);
  });

  it("each shared fragment is the very schema object it is matched as", () => {
    for (const [reuse, documented] of CHART_ALIASES) {
      const a = fragmentsAt(CHART_SPEC_SCHEMA, reuse);
      const b = fragmentsAt(CHART_SPEC_SCHEMA, documented);
      expect(a.length, reuse).toBeGreaterThan(0);
      expect(a.some((f) => b.includes(f)), `${reuse} is ${documented}`).toBe(true);
    }
  });

  it("the doc says the legacy axis-policy arrays mean the annotations ones", () => {
    const para = DOC.split(/\r?\n\r?\n/).find((p) => p.includes("still accepted and mean the same as"));
    expect(para).toBeDefined();
    const flat = para!.replace(/\s+/g, " ");
    expect(flat).toContain("`xAxisPolicy.markers`, `xAxisPolicy.bands`, and `yAxisPolicy.markers`");
    expect(flat).toContain("`annotations.xAxis`, `annotations.bands`, and `annotations.yAxis` respectively");
  });

  it("every allowlisted field still exists in a schema", () => {
    const all = new Set([...walkSchema(CHART_SPEC_SCHEMA).fields.keys(), ...walkSchema(TABLE_SPEC_SCHEMA).fields.keys()]);
    for (const p of UNDOCUMENTED.keys()) expect(all.has(p), p).toBe(true);
  });
});
