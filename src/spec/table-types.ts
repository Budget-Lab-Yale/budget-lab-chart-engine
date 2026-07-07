/** Formatting rules for numeric cell values. Resolution precedence: default → column → group → row → cell. */
export interface FormatRule {
  /** "number" (default), "percent" (multiply by 100), or "currency". */
  type?: "number" | "percent" | "currency";
  /** Decimal places to display. */
  decimals?: number;
  /** Group thousands with ",". */
  thousands?: boolean;
  /** Apply color for negative (red) / positive (green) values. */
  signColor?: boolean;
  /** Prefix (e.g. "$" for currency). */
  prefix?: string;
  /** Suffix (e.g. "%" for percent; overridden by type="percent"). */
  suffix?: string;
}

/** A table spec: layout, data source, and formatting.
 *  Tidy/long data: one row per (stub-path × header-path × value) cell.
 *  Stub entries nest to form the row hierarchy (all but last → groups; last → row label).
 *  Header entries nest to form the column hierarchy (all but last → banners; last → leaf metric).
 *  Value column holds numeric or null. */
export interface TableSpec {
  /** Table title. */
  title: string;
  /** Subtitle (optional). */
  subtitle?: string;
  /** Path to tidy CSV data file. */
  data: string;
  /** Stub columns (row nesting): each entry is a column name or {label: "display name"}.
   *  The last entry holds the row label. */
  stub: Array<string | { label: string }>;
  /** Top-left corner label above the row labels. A string applies to all panes; a { paneValue:
   *  label } map sets it per pane (multi-pane). Omit for a blank corner. */
  stub_header?: string | Record<string, string>;
  /** Header columns (column nesting): each entry is a column name.
   *  The last entry holds the leaf metric key. */
  header: string[];
  /** Value column name (holds numbers or null). */
  value: string;
  /** Multi-pane: column whose values split the data into separate stacked sub-tables. Each pane is
   *  rendered from its own row subset, so panes can have different rows AND column headers. The
   *  other roles (stub/header/value) and all formatting apply to every pane. Omit for one table. */
  pane?: string;
  /** Pane render order + inclusion filter (values not listed are dropped). Default: first-seen. */
  pane_order?: string[];
  /** Pane value → subheading shown above that pane. Defaults to the pane value itself. */
  pane_titles?: Record<string, string>;
  /** Render order for rows (optional); omitted entries appear in first-seen order. Scoped WITHIN
   *  each row group — it orders leaves inside a group, not across groups. */
  row_order?: string[];
  /** Render order for row GROUPS (the non-last stub tiers), mirroring row_order/column_order.
   *  A flat string[] orders the FIRST group tier only; a string[][] orders each group level
   *  independently (index 0 = first tier, index 1 = second tier, ...). Unlisted group values at a
   *  level follow first-seen order. Omit for first-seen order at every level. Groups are always
   *  gathered by stub path regardless of input row order (each group's rows render contiguously
   *  under one header, wherever they appear in the source data). */
  group_order?: string[] | string[][];
  /** Render order for columns (optional); leaf keys not listed appear in first-seen order. */
  column_order?: string[];
  /** Leaf column key → display label (overrides the raw header value). */
  column_labels?: Record<string, string>;
  /** Row label (last stub value) → display label (overrides the raw CSV value). Lets math/markup
   *  live in the spec while the CSV keeps short plain keys. Keying (row_order, emphasis_rows,
   *  format.rows) still uses the raw CSV value. */
  row_labels?: Record<string, string>;
  /** Group value (any non-last stub value) → display label (overrides the raw CSV value). Keying
   *  (group_notes, format.groups) still uses the raw CSV value. */
  group_labels?: Record<string, string>;
  /** Leaf column key → secondary label (e.g. units). Rendered below the column label. */
  sublabels?: Record<string, string>;
  /** Header value → display label (applied to banner tiers above the leaves). */
  header_labels?: Record<string, string>;
  /** Formatting rules: default (applies to all), by column (leaf key), by group (group value), by row (row label). */
  format?: {
    default?: FormatRule;
    columns?: Record<string, FormatRule>;
    groups?: Record<string, FormatRule>;
    rows?: Record<string, FormatRule>;
  };
  /** Group label → explanatory note (displayed under the group heading). */
  group_notes?: Record<string, string>;
  /** Row labels to render bold/highlighted. */
  emphasis_rows?: string[];
  /** CSV column name holding per-cell emphasis flag (boolean-like: "yes"/"1"/"true"). */
  emphasis_column?: string;
  /** Footnote key → text (e.g. { "a": "revised", "b": "estimate" }). */
  footnotes?: Record<string, string>;
  /** CSV column name holding footnote keys per cell (comma-separated or space-separated). */
  footnote_column?: string;
  /** Apply color to negative (red) / positive (green) values (applies to all cells; overridable per FormatRule). */
  sign_color?: boolean;
  /** Allow interactive column sort (ascending/descending/none, per-group). */
  sort?: boolean;
  /** Sticky positioning: pin the first column (row labels) during horizontal scroll. */
  sticky?: { firstColumn?: boolean };
  /** Draw horizontal rules between header tiers. Default false (the single header→body rule always stays). */
  header_tier_rules?: boolean;
  /** Draw the flanking horizontal rules on multi-column banners. Default true; false → plain centered text. */
  spanner_rules?: boolean;
  /** Fixed px width for the stub column (overrides the computed width). */
  stub_width?: number;
  /** Minimum px width for the stub column. Without stub_wrap it is a floor on the auto-sized width;
   * with stub_wrap it is the width the stub shrinks toward (labels wrap to it) — i.e. the knob for
   * how aggressively labels wrap. */
  stub_min_width?: number;
  /** Allow row-label (stub) cells to wrap onto multiple lines so the stub column can be narrower
   * than the longest label (down toward stub_min_width). Default false — labels stay on one line
   * and the stub is sized to the longest label. */
  stub_wrap?: boolean;
  /** When true, stub labels do not wrap; the stub is sized to the longest label. Default false. */
  stub_nowrap?: boolean;
  /** Fixed px width for data columns: one number applies to all leaves, or a { leafKey: px } map. */
  column_width?: number | Record<string, number>;
  /** Wrap bottom-tier (leaf) header labels to at most N lines. */
  header_max_lines?: number;
  /** Data source line (e.g. "U.S. Bureau of Labor Statistics"). */
  source?: string;
  /** Explanatory notes. String or array of strings (each rendered as a paragraph). */
  notes?: string | string[];
}
