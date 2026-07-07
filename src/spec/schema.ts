// ajv JSON Schema (Draft 2020-12) for a single ChartSpec. Ported and reduced from the
// tracker's build-manifest.py CHART_SCHEMA: one chart = one spec, so the figure / tracker
// / nav wrappers and the variant / selector / chartLetter UI machinery are dropped. What
// remains is the chart-block schema, kept strict — `additionalProperties: false` at every
// level so a typo like `xAxisTpye` or `serires_order` fails loudly instead of being
// silently ignored.
//
// This must stay in lockstep with spec/types.ts (the TS contract). Both describe the same
// shape; the type is for authoring, the schema for runtime validation.

// Shared annotation fragments — reused by the legacy axis policies AND the unified `annotations`
// block, so both accept the same shapes.
const X_MARKER_ARRAY = {
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
      labelSide: { type: "string", enum: ["left", "middle", "right"] },
      labelPosition: { type: "string", enum: ["top", "middle", "bottom"] },
      labelDx: { type: "number" },
      labelDy: { type: "number" },
    },
  },
} as const;

const X_BAND_ARRAY = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["start", "end"],
    properties: {
      start: { type: "string" },
      end: { type: "string" },
      label: { type: "string" },
      color: { type: "string" },
    },
  },
} as const;

const Y_MARKER_ARRAY = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["y"],
    properties: {
      y: { type: "number" },
      label: { type: "string" },
      style: { type: "string", enum: ["dashed", "solid"] },
      color: { type: "string" },
      strokeWidth: { type: "number" },
      labelSide: { type: "string", enum: ["top", "middle", "bottom"] },
      labelPosition: { type: "string", enum: ["left", "middle", "right"] },
      labelDx: { type: "number" },
      labelDy: { type: "number" },
    },
  },
} as const;

const POINT_CALLOUT_ARRAY = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["x", "label"],
    properties: {
      x: { type: "string" },
      y: { type: "number" },
      series: { type: "string" },
      label: { type: "string" },
      color: { type: "string" },
      dx: { type: "number" },
      dy: { type: "number" },
      connector: { type: "boolean" },
    },
  },
} as const;

const ANNOTATIONS = {
  type: "object",
  additionalProperties: false,
  properties: {
    xAxis: X_MARKER_ARRAY,
    yAxis: Y_MARKER_ARRAY,
    bands: X_BAND_ARRAY,
    points: POINT_CALLOUT_ARRAY,
  },
} as const;

const X_AXIS_POLICY = {
  type: "object",
  additionalProperties: false,
  properties: {
    anchorAtZero: { type: "boolean" },
    markers: X_MARKER_ARRAY,
    bands: X_BAND_ARRAY,
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
    markers: Y_MARKER_ARRAY,
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
  properties: {
    // Grid column COUNT (integer). The pane-splitting column is `columns.facet` (top level).
    columns: { type: "integer", minimum: 1 },
    mode: { type: "string", enum: ["shared", "per-pane"] },
    pane_order: { type: "array", items: { type: "string" } },
    pane_titles: { type: "object", additionalProperties: { type: "string" } },
    coordinated_cursor: { type: "boolean" },
    pane_widths: {
      anyOf: [
        { type: "string", enum: ["equal", "equal-bar"] },
        { type: "array", items: { type: "number", exclusiveMinimum: 0 }, minItems: 1 },
      ],
    },
  },
} as const;

export const CHART_SPEC_SCHEMA = {
  $id: "https://budget-lab-yale.github.io/schemas/chart-spec.json",
  type: "object",
  additionalProperties: false,
  required: ["chartType", "title", "xAxisType", "data"],
  properties: {
    chartType: { type: "string", enum: ["line", "area", "bar", "stacked", "scatter", "dotplot"] },

    // Data column → role mapping (any column names; absent ⇒ defaults x:"time"/value:"value"/series:"series").
    columns: {
      type: "object",
      additionalProperties: false,
      properties: {
        x: { type: "string" },
        value: { type: "string" },
        series: { type: "string" },
        facet: { type: "string" },
        shape: { type: "string" },
        section: { type: "string" },
      },
    },

    // Text
    // (No `eyebrow` — the figure number is an embed-time property of the article, not the spec.)
    title: { type: "string", minLength: 1 },
    subtitle: { type: "string" },
    source: { type: "string" },
    note: { type: "string" },
    x_axis_title: { type: "string" },
    x_axis_ticks: { type: "string", enum: ["bottom", "top", "both"] },
    y_axis_title: { type: "string" },
    tooltip_decimals: { type: "integer", minimum: 0, maximum: 10 },

    // Axes
    xAxisType: { type: "string", enum: ["numeric", "temporal", "quarterly", "categorical"] },
    xAxisPolicy: X_AXIS_POLICY,
    yAxisPolicy: Y_AXIS_POLICY,
    annotations: ANNOTATIONS,

    // Series (the series COLUMN is mapped via `columns.series`)
    series_order: { type: "array", items: { type: "string" } },
    series_colors: { type: "object", additionalProperties: { type: "string" } },
    bar_color: { type: "string" },
    category_colors: { type: "object", additionalProperties: { type: "string" } },
    series_styles: {
      type: "object",
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        properties: { dashed: { type: "boolean" } },
      },
    },
    series_labels: { type: "object", additionalProperties: { type: "string" } },

    // Section axis (horizontal bars; the section COLUMN is mapped via columns.section).
    section_order: { type: "array", items: { type: "string" } },
    section_labels: { type: "object", additionalProperties: { type: "string" } },
    x_order: { type: "array", items: { type: "string" } },
    x_labels: { type: "object", additionalProperties: { type: "string" } },

    // Shape channel (point charts). The shape COLUMN is mapped via columns.shape.
    shape_order: { type: "array", items: { type: "string" } },
    shape_labels: { type: "object", additionalProperties: { type: "string" } },
    color_legend_title: { type: "string" },
    shape_legend_title: { type: "string" },

    confidence_bands: { type: "array", items: CONFIDENCE_BAND },
    points: { type: "boolean" },

    // Bar / stacked bar
    orientation: { type: "string", enum: ["vertical", "horizontal"] },
    valueLabels: {
      type: "object",
      additionalProperties: false,
      properties: {
        show: { type: "boolean" },
        signed: { type: "boolean" },
        decimals: { type: "integer", minimum: 0, maximum: 10 },
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
        stackOrder: { type: "array", items: { type: "string" } },
      },
    },
    highlightSeries: { type: "array", items: { type: "string" } },
    legendPosition: { type: "string", enum: ["top", "right"] },

    // Small multiples (multi-panel)
    small_multiples: SMALL_MULTIPLES,

    // Data
    data: DATA_SOURCE,

    // Catalog facets
    tags: { type: "array", items: { type: "string" } },
  },
} as const;
