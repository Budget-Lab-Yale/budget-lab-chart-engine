// ajv JSON Schema (Draft 2020-12) for a single ChartSpec. Ported and reduced from the
// tracker's build-manifest.py CHART_SCHEMA: one chart = one spec, so the figure / tracker
// / nav wrappers and the variant / selector / chartLetter UI machinery are dropped. What
// remains is the chart-block schema, kept strict — `additionalProperties: false` at every
// level so a typo like `xAxisTpye` or `serires_order` fails loudly instead of being
// silently ignored.
//
// This must stay in lockstep with spec/types.ts (the TS contract). Both describe the same
// shape; the type is for authoring, the schema for runtime validation.

const X_AXIS_POLICY = {
  type: "object",
  additionalProperties: false,
  properties: {
    anchorAtZero: { type: "boolean" },
    markers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["x"],
        properties: {
          x: { type: "string" },
          label: { type: "string" },
          style: { type: "string", enum: ["dashed", "solid"] },
          color: { type: "string" },
          strokeWidth: { type: "number" },
        },
      },
    },
  },
} as const;

const Y_AXIS_POLICY = {
  type: "object",
  additionalProperties: false,
  properties: {
    min: { type: "number" },
    max: { type: "number" },
    includeZero: { type: "boolean" },
    tickCount: { type: "integer", minimum: 1 },
    autoWiden: {
      type: "object",
      additionalProperties: false,
      required: ["step"],
      properties: { step: { type: "number" } },
    },
  },
} as const;

const CONFIDENCE_BAND = {
  type: "object",
  additionalProperties: false,
  required: ["series", "lower", "upper"],
  properties: {
    series: { type: "string" },
    lower: { type: "string" },
    upper: { type: "string" },
  },
} as const;

// data: a bare string (filename) is sugar for { file }; otherwise an object — either a
// local { file } or a remote { url, format, map? }.
const DATA_SOURCE = {
  anyOf: [
    { type: "string", minLength: 1 },
    {
      type: "object",
      additionalProperties: false,
      required: ["file"],
      properties: { file: { type: "string", minLength: 1 } },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["url", "format"],
      properties: {
        url: { type: "string", minLength: 1 },
        format: { type: "string", enum: ["csv", "json"] },
        map: {
          type: "object",
          additionalProperties: false,
          required: ["timeField", "seriesField", "valueField"],
          properties: {
            timeField: { type: "string" },
            seriesField: { type: "string" },
            valueField: { type: "string" },
          },
        },
      },
    },
  ],
} as const;

const SMALL_MULTIPLES = {
  type: "object",
  additionalProperties: false,
  required: ["facet_field"],
  properties: {
    facet_field: { type: "string", minLength: 1 },
    columns: { type: "integer", minimum: 1 },
    mode: { type: "string", enum: ["shared", "per-pane"] },
    pane_order: { type: "array", items: { type: "string" } },
    pane_titles: { type: "object", additionalProperties: { type: "string" } },
  },
} as const;

export const CHART_SPEC_SCHEMA = {
  $id: "https://budget-lab-yale.github.io/schemas/chart-spec.json",
  type: "object",
  additionalProperties: false,
  required: ["chartType", "title", "xAxisType", "data"],
  properties: {
    chartType: { type: "string", enum: ["line", "bar", "stacked"] },

    // Text
    eyebrow: { type: "string" },
    title: { type: "string", minLength: 1 },
    subtitle: { type: "string" },
    source: { type: "string" },
    note: { type: "string" },
    x_axis_title: { type: "string" },

    // Axes
    xAxisType: { type: "string", enum: ["numeric", "temporal", "quarterly", "categorical"] },
    xAxisPolicy: X_AXIS_POLICY,
    yAxisPolicy: Y_AXIS_POLICY,

    // Series
    series_field: { type: "string" },
    series_order: { type: "array", items: { type: "string" } },
    series_colors: { type: "object", additionalProperties: { type: "string" } },
    series_styles: {
      type: "object",
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        properties: { dashed: { type: "boolean" } },
      },
    },
    series_labels: { type: "object", additionalProperties: { type: "string" } },

    confidence_bands: { type: "array", items: CONFIDENCE_BAND },

    // Bar / stacked bar
    orientation: { type: "string", enum: ["vertical", "horizontal"] },
    valueLabels: {
      type: "object",
      additionalProperties: false,
      properties: {
        show: { type: "boolean" },
        signed: { type: "boolean" },
      },
    },
    barStack: {
      type: "object",
      additionalProperties: false,
      properties: {
        netDisplay: { type: "string", enum: ["auto", "text", "dot", "none"] },
        mono: {
          type: "object",
          additionalProperties: false,
          required: ["base"],
          properties: { base: { type: "string" } },
        },
        netLabelColor: { type: "string", enum: ["white", "black"] },
        normalize: { type: "boolean" },
      },
    },
    highlightSeries: { type: "array", items: { type: "string" } },
    legendPosition: { type: "string", enum: ["top", "right"] },

    // Small multiples (multi-panel)
    small_multiples: SMALL_MULTIPLES,

    // Data
    data: DATA_SOURCE,

    // Provenance / locking
    engineVersion: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
  },
} as const;
