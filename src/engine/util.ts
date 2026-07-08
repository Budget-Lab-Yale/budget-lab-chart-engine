/** HTML-escape a value for safe interpolation into innerHTML (tooltip/legend). */
export function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/** Infer a units suffix from a chart subtitle (matches makeTickFormatter's inference). */
export function inferUnitsFromSubtitle(subtitle?: string): string {
  if (!subtitle) return "";
  const lower = subtitle.toLowerCase();
  if (lower.includes("percent") || lower.includes("percentage point")) return "%";
  return "";
}

/** Parses a `projected_field` (or similar boolean-flag CSV column) value: `1`/`true`/`yes`
 *  (case-insensitive, trimmed) is truthy; everything else (`0`, `false`, `no`, empty, missing)
 *  is falsy. */
export function isTruthyFlag(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}
