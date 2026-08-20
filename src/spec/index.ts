// Spec layer entry point: the ChartSpec contract, its ajv JSON schema, and validation.
export type * from "./types";
export { CHART_SPEC_SCHEMA } from "./schema";
export { validateSpec, validateChartData, validateChart } from "./validate";
export type { ValidationResult } from "./validate";
// Programmatic render hooks (see hooks.ts) — CONFIG-SPEC.md tells a consumer to "see
// src/spec/hooks.ts" for these types; without this re-export they were unreachable from either
// published subpath, so a consumer factoring a hook into a named variable or function parameter
// had nothing to type it with.
export type * from "./hooks";
export type { NetMode } from "./bar-stack";
