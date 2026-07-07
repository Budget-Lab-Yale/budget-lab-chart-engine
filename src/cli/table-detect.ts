// Shared table-vs-chart spec detection, used by src/cli/index.ts (validate/render/snapshot)
// and src/cli/serve.ts (gallery routing). Pulled out to a standalone module so both can import
// it without creating a circular dependency between the CLI entry point and the server.

import type { TableSpec } from "../spec/table-types";

/**
 * Returns true when the parsed YAML looks like a table spec.
 * Detection is content-based (not filename-based) and intentionally generous:
 * any spec that has a `stub` field is treated as a table — chart specs never use that key.
 * This means partially-invalid table specs (e.g. missing `value`) are still routed to the
 * table validator, which produces the correct error rather than falling through to the chart
 * validator and emitting confusing "chartType required" messages.
 */
export function isTableSpec(parsed: unknown): parsed is TableSpec {
  if (typeof parsed !== "object" || parsed === null) return false;
  const p = parsed as Record<string, unknown>;
  return p["stub"] !== undefined;
}
