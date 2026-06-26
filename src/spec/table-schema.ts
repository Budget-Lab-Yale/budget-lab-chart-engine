// ajv JSON Schema for a single TableSpec. Kept strict — `additionalProperties: false` at
// every level so a typo is caught loudly instead of silently ignored.
//
// This must stay in lockstep with spec/table-types.ts (the TS contract). Both describe
// the same shape; the type is for authoring, the schema for runtime validation.

const FORMAT_RULE = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: { type: "string", enum: ["number", "percent", "currency"] },
    decimals: { type: "number" },
    thousands: { type: "boolean" },
    signColor: { type: "boolean" },
    prefix: { type: "string" },
    suffix: { type: "string" },
  },
} as const;

const STUB_ITEM = {
  anyOf: [
    { type: "string" },
    {
      type: "object",
      additionalProperties: false,
      required: ["label"],
      properties: { label: { type: "string" } },
    },
  ],
} as const;

export const TABLE_SPEC_SCHEMA = {
  $id: "https://budget-lab-yale.github.io/schemas/table-spec.json",
  type: "object",
  additionalProperties: false,
  required: ["title", "data", "stub", "header", "value"],
  properties: {
    title: { type: "string", minLength: 1 },
    subtitle: { type: "string" },
    data: { type: "string", minLength: 1 },
    stub: { type: "array", items: STUB_ITEM },
    header: { type: "array", items: { type: "string" } },
    value: { type: "string" },
    row_order: { type: "array", items: { type: "string" } },
    column_order: { type: "array", items: { type: "string" } },
    column_labels: { type: "object", additionalProperties: { type: "string" } },
    sublabels: { type: "object", additionalProperties: { type: "string" } },
    header_labels: { type: "object", additionalProperties: { type: "string" } },
    format: {
      type: "object",
      additionalProperties: false,
      properties: {
        default: FORMAT_RULE,
        columns: { type: "object", additionalProperties: FORMAT_RULE },
        groups: { type: "object", additionalProperties: FORMAT_RULE },
        rows: { type: "object", additionalProperties: FORMAT_RULE },
      },
    },
    group_notes: { type: "object", additionalProperties: { type: "string" } },
    emphasis_rows: { type: "array", items: { type: "string" } },
    emphasis_column: { type: "string" },
    footnotes: { type: "object", additionalProperties: { type: "string" } },
    footnote_column: { type: "string" },
    sign_color: { type: "boolean" },
    sort: { type: "boolean" },
    sticky: {
      type: "object",
      additionalProperties: false,
      properties: {
        header: { type: "boolean" },
        firstColumn: { type: "boolean" },
      },
    },
    header_tier_rules: { type: "boolean" },
    spanner_rules: { type: "boolean" },
    stub_width: { type: "number" },
    stub_nowrap: { type: "boolean" },
    column_width: {
      anyOf: [
        { type: "number" },
        { type: "object", additionalProperties: { type: "number" } },
      ],
    },
    header_max_lines: { type: "number" },
    source: { type: "string" },
    notes: {
      anyOf: [
        { type: "string" },
        { type: "array", items: { type: "string" } },
      ],
    },
  },
} as const;
