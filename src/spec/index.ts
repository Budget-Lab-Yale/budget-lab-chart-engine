// Spec layer entry point: the ChartSpec contract, its ajv JSON schema, and validation.
export type * from "./types";
export { CHART_SPEC_SCHEMA } from "./schema";
export { validateSpec, validateChartData, validateChart } from "./validate";
export type { ValidationResult } from "./validate";
