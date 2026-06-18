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
