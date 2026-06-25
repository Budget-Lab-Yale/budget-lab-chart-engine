import Ajv from "ajv";
import { TABLE_SPEC_SCHEMA } from "./table-schema.js";
import type { TableSpec } from "./table-types.js";
import type { TidyRow } from "../data/index.js";

const ajv = new Ajv({ allErrors: true });
const structural = ajv.compile(TABLE_SPEC_SCHEMA);

const labelOf = (e: string | { label: string }) => (typeof e === "string" ? e : e.label);

export function validateTableSpec(spec: unknown) {
  const ok = structural(spec);
  if (ok) return { valid: true, errors: [] as string[] };
  return { valid: false, errors: (structural.errors ?? []).map((e) =>
    `${e.instancePath || "(root)"}: ${e.keyword === "additionalProperties"
      ? `unknown property "${(e.params as any).additionalProperty}"` : e.message}`) };
}

export function validateTableData(spec: TableSpec, rows: TidyRow[]) {
  const errors: string[] = [];
  if (!rows.length) return { valid: false, errors: ["data has no rows"] };
  const cols = new Set(Object.keys(rows[0] as object));
  const roles = [...spec.stub.map(labelOf), ...spec.header, spec.value];
  for (const c of roles) if (!cols.has(c)) errors.push(`config/data mismatch: column "${c}" not found`);
  if (errors.length) return { valid: false, errors };
  const stubCols = spec.stub.map(labelOf);
  const seen = new Set<string>();
  const SEP = "\x1F";
  for (const r of rows) {
    const key = [...stubCols, ...spec.header].map((c) => String((r as any)[c])).join(SEP);
    if (seen.has(key)) { errors.push(`duplicate cell for ${key.replace(/\x1F/g, " / ")}`); }
    seen.add(key);
  }
  return { valid: errors.length === 0, errors };
}
