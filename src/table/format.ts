import type { FormatRule, TableSpec } from "../spec/table-types";
import { ownValue } from "../spec/own-key";

export function resolveFormat(args: {
  leafKey: string; groupKeys: string[]; rowLabel: string; spec: TableSpec;
}): FormatRule {
  const f = args.spec.format ?? {};
  let rule: FormatRule = { type: "number", decimals: 1, ...(f.default ?? {}) };
  const byColumn = ownValue(f.columns, args.leafKey);
  if (byColumn) rule = { ...rule, ...byColumn };
  for (const g of args.groupKeys) {
    const byGroup = ownValue(f.groups, g);
    if (byGroup) rule = { ...rule, ...byGroup };
  }
  const byRow = ownValue(f.rows, args.rowLabel);
  if (byRow) rule = { ...rule, ...byRow };
  if (args.spec.sign_color) rule = { signColor: true, ...rule };
  return rule;
}

/** The displayed magnitude (rounded to the rule's decimals, percent scaled) and the sign of the
 *  ROUNDED value: a value that rounds to zero has sign 0, so it prints neither a minus nor a sign
 *  colour ("-0.04" at one decimal is "0.0", not "-0.0"). */
function rounded(value: number, rule: FormatRule): { abs: string; sign: -1 | 0 | 1 } {
  const v = rule.type === "percent" ? value * 100 : value;
  const abs = Math.abs(v).toFixed(rule.decimals ?? 1);
  const sign = Number(abs) === 0 ? 0 : v < 0 ? -1 : 1;
  return { abs, sign };
}

/** Sign of a cell value as it is displayed (after rounding); 0 for null/non-finite. Drives the
 *  sign colour, so a cell that prints "0.0" is never coloured. */
export function formattedSign(value: number | null, rule: FormatRule): -1 | 0 | 1 {
  if (value == null || !Number.isFinite(value)) return 0;
  return rounded(value, rule).sign;
}

export function formatCell(value: number | null, rule: FormatRule): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const { abs, sign } = rounded(value, rule);
  const suffix = rule.type === "percent" ? "%" + (rule.suffix ?? "") : (rule.suffix ?? "");
  const grouped = rule.thousands ? groupThousands(abs) : abs;
  const prefix = rule.prefix ?? "";
  return `${sign < 0 ? "-" : ""}${prefix}${grouped}${suffix}`;
}

function groupThousands(numStr: string): string {
  const [int, frac] = numStr.split(".");
  const g = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac != null ? `${g}.${frac}` : g;
}
