import Ajv from "ajv";
import { TABLE_SPEC_SCHEMA } from "./table-schema.js";
import type { TableSpec } from "./table-types.js";
import type { TidyRow } from "../data/index.js";
import { validateRichText } from "../table/richtext.js";

const ajv = new Ajv({ allErrors: true });
const structural = ajv.compile(TABLE_SPEC_SCHEMA);

const labelOf = (e: string | { label: string }) => (typeof e === "string" ? e : e.label);

// Shared message for unsupported inline-math commands (the same wording for spec fields + data).
function richError(where: string, bad: string[]): string {
  return `${where}: unsupported math command(s) ${bad.map((c) => "\\" + c).join(", ")} — tables support `
    + `sub/superscripts (_{}, ^{}), Greek (\\sigma, \\theta), and inline italics (\\textit{}), `
    + `but not \\frac, \\sqrt, or other stacked/2-D constructs`;
}

/** Collect every author-supplied string in the spec that is rendered as table text. */
function richStrings(spec: TableSpec): Array<{ where: string; value: string }> {
  const out: Array<{ where: string; value: string }> = [];
  const add = (where: string, v: unknown) => { if (typeof v === "string") out.push({ where, value: v }); };
  add("title", spec.title);
  add("subtitle", spec.subtitle);
  add("source", spec.source);
  if (Array.isArray(spec.notes)) spec.notes.forEach((n, i) => add(`notes[${i}]`, n));
  else add("notes", spec.notes);
  if (typeof spec.stub_header === "string") add("stub_header", spec.stub_header);
  else if (spec.stub_header) for (const [k, v] of Object.entries(spec.stub_header)) add(`stub_header.${k}`, v);
  for (const e of spec.stub ?? []) if (typeof e !== "string") add("stub.label", e.label);
  for (const rec of ["column_labels", "row_labels", "group_labels", "header_labels", "sublabels", "group_notes", "pane_titles"] as const) {
    const m = spec[rec];
    if (m) for (const [k, v] of Object.entries(m)) add(`${rec}.${k}`, v);
  }
  return out;
}

export function validateTableSpec(spec: unknown) {
  const ok = structural(spec);
  if (!ok) {
    return { valid: false, errors: (structural.errors ?? []).map((e) =>
      `${e.instancePath || "(root)"}: ${e.keyword === "additionalProperties"
        ? `unknown property "${(e.params as any).additionalProperty}"` : e.message}`) };
  }
  // Inline-math markup check on the supported linear subset (rejects \frac, \sqrt, etc.).
  const errors: string[] = [];
  for (const { where, value } of richStrings(spec as TableSpec)) {
    const bad = validateRichText(value);
    if (bad.length) errors.push(richError(where, bad));
  }
  return { valid: errors.length === 0, errors };
}

export function validateTableData(spec: TableSpec, rows: TidyRow[]) {
  const errors: string[] = [];
  if (!rows.length) return { valid: false, errors: ["data has no rows"] };
  const cols = new Set(Object.keys(rows[0] as object));
  const roles = [...spec.stub.map(labelOf), ...spec.header, spec.value];
  if (spec.pane != null) roles.push(spec.pane);
  for (const c of roles) if (!cols.has(c)) errors.push(`config/data mismatch: column "${c}" not found`);
  if (errors.length) return { valid: false, errors };
  const stubCols = spec.stub.map(labelOf);
  const SEP = "\x1F";
  // Duplicate-cell check is scoped per pane: the same stub+header coordinate may legitimately
  // recur across panes (each pane is a separate sub-table).
  const seenByPane = new Map<string, Set<string>>();
  for (const r of rows) {
    const paneKey = spec.pane != null ? String((r as any)[spec.pane]) : "";
    let seen = seenByPane.get(paneKey);
    if (seen == null) { seen = new Set<string>(); seenByPane.set(paneKey, seen); }
    const key = [...stubCols, ...spec.header].map((c) => String((r as any)[c])).join(SEP);
    if (seen.has(key)) { errors.push(`duplicate cell for ${key.replace(/\x1F/g, " / ")}`); }
    seen.add(key);
  }
  // Inline-math check on the CSV-derived text that becomes labels and text cells (row/group
  // labels come from the stub columns, column banners from the header columns). Deduped by value.
  const textRoles = [...stubCols, ...spec.header, spec.value];
  const richSeen = new Set<string>();
  for (const r of rows) {
    for (const c of textRoles) {
      const v = (r as any)[c];
      if (typeof v !== "string" || richSeen.has(v)) continue;
      const bad = validateRichText(v);
      if (bad.length) { errors.push(richError(`data "${v}"`, bad)); richSeen.add(v); }
    }
  }
  return { valid: errors.length === 0, errors };
}
