import type { FormatRule, TableSpec } from "../spec/table-types";

export function resolveFormat(args: {
  leafKey: string; groupKeys: string[]; rowLabel: string; spec: TableSpec;
}): FormatRule {
  const f = args.spec.format ?? {};
  let rule: FormatRule = { type: "number", decimals: 1, ...(f.default ?? {}) };
  if (f.columns?.[args.leafKey]) rule = { ...rule, ...f.columns[args.leafKey] };
  for (const g of args.groupKeys) if (f.groups?.[g]) rule = { ...rule, ...f.groups[g] };
  if (f.rows?.[args.rowLabel]) rule = { ...rule, ...f.rows[args.rowLabel] };
  if (args.spec.sign_color) rule = { signColor: true, ...rule };
  return rule;
}

export function formatCell(value: number | null, rule: FormatRule): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const decimals = rule.decimals ?? 1;
  let v = value;
  let suffix = rule.suffix ?? "";
  if (rule.type === "percent") { v = v * 100; suffix = "%" + suffix; }
  const neg = v < 0;
  const abs = Math.abs(v).toFixed(decimals);
  const grouped = rule.thousands ? groupThousands(abs) : abs;
  const prefix = rule.prefix ?? "";
  return `${neg ? "-" : ""}${prefix}${grouped}${suffix}`;
}

function groupThousands(numStr: string): string {
  const [int, frac] = numStr.split(".");
  const g = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac != null ? `${g}.${frac}` : g;
}
