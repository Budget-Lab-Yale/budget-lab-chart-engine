# Tables — design

Status: draft for review · Date: 2026-06-25 · Engine: budget-lab-chart-engine

## 1. Goal

Add a **table** figure type to the engine, parallel to charts: an author writes a
`table.yaml` + long/tidy `data.csv`, and the engine produces an interactive HTML table
(live embed) and a self-contained PNG export, styled to the Budget Lab theme. Tables are a
first-class figure in `budget-lab-charts` articles, alongside charts.

Reference tables (structure only — visual style is a fresh TBL design, not a copy):
- **Budget score** (most common): row groups, 10 year columns + 3 decade-aggregate columns,
  flat one-tier header, right-aligned 1-dp numbers.
- **T1 key parameters**: a 2-tier header (one banner over `Slow/Moderate/Rapid`, each with a
  `(S)/(M)/(R)` sub-label), row groups with italic notes, per-row-group number formats.
- **Tariff summary**: a 3-tier header with banners spanning different column sets and a tier
  that some leaves skip (rowspan), footnote markers, horizontal overflow.

## 2. Scope (v1)

In: multi-tier data-driven headers (arbitrary depth, colspan + rowspan); row groups +
indented sub-rows; per-column / per-group / per-row / per-cell number formatting; title /
units subtitle / source / multi-line notes; footnotes; per-row & per-cell emphasis; sign
coloring; interactivity (sortable columns, row hover, column hover, sticky header + sticky
first column, responsive horizontal scroll); HTML embed + self-contained PNG export.

Out (v1): pulling header *labels* from anything but the data + spec polish; pivoting wide
data; cell spark-marks/mini-charts; CSV-driven conditional formatting rules; merged *body*
cells (only headers span).

## 3. Data model — long / tidy

The CSV is tidy: **one row per rendered cell**. Three roles, declared in the spec:

- **`stub`** — an ordered list of CSV columns that identify a *row* and its nesting. The last
  entry is the row label; earlier entries are nested group headings (outer → inner). This is
  how row groups and indented sub-rows are expressed.
- **`header`** — an ordered list of CSV columns that identify a *column* and its nesting. The
  last entry is the leaf column; earlier entries are nested header banners (outer → inner).
  This is the column-axis mirror of `stub`.
- **`value`** — the CSV column holding the cell number.

The engine pivots: a cell sits at (stub-path × header-path). The header lattice is derived
from the data:
- **colspan** — a banner value shared by adjacent leaves spans them.
- **rowspan** — a *blank* intermediate header tier lets its leaf span up to fill the empty
  tier (e.g. a column with a top banner but no middle banner).

Symmetry: rows nest via `stub`, columns nest via `header`; both come from the data, so adding
a column or a grouping level is a data edit, not a spec rewrite.

**Per-cell metadata** rides as optional companion columns (one row per cell makes this
natural): e.g. `emphasis` (bold/strong), `footnote` (marker key), `sign` override. The spec
names which columns carry which role.

### Example — budget score
`stub: [proposal, label: method]`, `header: [period]`, `value: value`
```csv
proposal,method,period,value
Biden 2025 Budget Proposal,Old Method,2026,0.1
Biden 2025 Budget Proposal,Old Method,26-35,10.7
Biden 2025 Budget Proposal,New Method,2026,0.3
Wyden et al Proposal,Old Method,2026,3.0
```

### Example — T1 (two-tier header, per-group formats)
`stub: [group, label: parameter]`, `header: [scenario_group, scenario]`, `value: value`
```csv
group,parameter,scenario_group,scenario,value
AI-adoption inputs,Annual GDP growth under AI,AI Adoption Scenarios via Karger et al. (2026),Slow,0.020
AI-adoption inputs,Annual GDP growth under AI,AI Adoption Scenarios via Karger et al. (2026),Moderate,0.026
Derived cumulative growth,GDP,AI Adoption Scenarios via Karger et al. (2026),Slow,0.0059
Labor-income inequality parameter,Compressive,AI Adoption Scenarios via Karger et al. (2026),Slow,0.994
```

### Example — tariff summary (three-tier header, blank tier → rowspan)
`stub: [label: row]`, `header: [tier1, tier2, metric]`, `value: value`
```csv
row,tier1,tier2,metric,value
All 2025 Tariffs to Date,Conventional Score,2026-35,$billions,2933
All 2025 Tariffs to Date,Conventional Score,In Equilibrium,% Change in PCE Price Level,0.0204
All 2025 Tariffs to Date,Add'l Dynamic Effects,,Change in 2025 Q4-Q4 Real GDP Growth,-0.80
```

## 4. `table.yaml` spec

```yaml
title: "…"                 # required
subtitle: "…"              # optional units line
data: data.csv             # required

stub: [groupCol, …, { label: labelCol }]   # required; last = row label
header: [tierCol, …, leafCol]              # required; last = leaf column
value: value                               # required

# Ordering (optional). Default = first-seen-in-CSV. Spec can pin or filter.
row_order: […]             # by row-label value, or per-level orders
column_order: […]          # by leaf value

# Header polish (optional), keyed by the data value it annotates:
column_labels: { "metricKey": "Display label" }   # override long leaf text
sublabels:     { "Slow": "(S)" }                  # second line in a leaf header cell
header_labels: { "tier1Key": "Display banner" }   # override banner text

# Formatting — resolution order: default → column → group → row → cell (most specific wins)
format:
  default: { type: number, decimals: 1 }
  columns: { "% of GDP": { type: percent, decimals: 1 } }
  groups:  { "Derived cumulative growth": { type: percent, decimals: 2 } }
  rows:    { "Compressive": { type: number, decimals: 3 } }
# format types: number | percent | currency, with {decimals, thousands, signColor, prefix, suffix}

# Row-group notes (italic line under a bold group heading), keyed by group value:
group_notes: { "Derived cumulative growth": "Cumulative over the 5-year horizon…" }

# Extras:
emphasis: { column: emphasis }     # CSV col carrying per-cell emphasis flags; or emphasis_rows: […]
footnotes:                         # marker → text; markers attach via inline [^a] in labels or a CSV col
  a: "…"
footnote_column: footnote          # optional CSV col carrying per-cell footnote keys
sign_color: false                  # global default; per-column format can override

# Interaction / layout:
sort: true                         # enable sortable columns (sorts within each row group)
sticky: { header: true, firstColumn: true }
source: "…"
notes: "…"                         # string or list → multi-line

# Header rules / banners:
header_tier_rules: false           # default false. Draw horizontal rules BETWEEN header tiers.
                                   #   The single header→body bottom rule always stays regardless.
spanner_rules: true                # default true. Flanking horizontal lines on multi-column
                                   #   banners. false → plain centered banner text (no rules).

# Column width + wrap controls (all optional; default = auto-sized from text):
stub_width: 220                    # fixed px width for the stub column (overrides computed width)
stub_nowrap: false                 # default false. true → stub labels/group titles never wrap;
                                   #   the stub is sized to the longest label so nothing is clipped.
column_width: 90                   # fixed px width for data columns. A single number applies to
                                   #   every leaf, or a per-leaf map: { "Slow": 70, "Rapid": 70 }.
header_max_lines: 2                # wrap bottom-tier (leaf) header labels to at most N lines
                                   #   (the leaf column is then NOT forced wide enough for the full
                                   #   label; header height grows to fit the wrapped lines).
```

Banner-width fit: a banner (colSpan>1) whose text is wider than the columns it spans widens
them — the deficit (text width + cell padding + flanking-rule gaps, minus the spanned columns'
total width) is distributed evenly across the spanned leaves, so the banner never overflows or
mis-centers. This is automatic and unconditional.

Number formatting reuses/extends the engine's existing formatter so rounding matches charts.

## 5. Architecture

Tables are a **separate spec + renderer** that reuses the engine's theme tokens, figure-card
chrome (title/subtitle/logo/source/notes), download-button UI, and PNG rasterizer. New modules:

```
src/spec/table-types.ts        TableSpec types
src/spec/table-schema.ts       ajv schema
src/spec/table-validate.ts     structural + data cross-checks (stub/header/value exist; no dup cells; etc.)
src/table/model.ts             pivot long rows → { headerLattice, rowTree, cells, formats }   (pure)
src/table/layout.ts            geometry: column widths (text-measure), row heights, header
                               tier rects w/ colspan+rowspan, group/indent offsets            (pure)
src/table/render-html.ts       model+layout → <table> DOM (semantic thead/tbody)
src/table/render-svg.ts        model+layout → SVG (for PNG export)
src/table/mount.ts             live: mount HTML card + wire sort/hover/sticky/scroll
src/embed/export-table-png.ts  render-svg → rasterize (reuse export-png rasterize())
```

**The layout module is the keystone.** Because PNG export redraws as SVG (option B), HTML and
SVG must not drift — so a single pure `layout.ts` computes the grid geometry once (column
widths from canvas text-measurement, header lattice spans, row/indent positions) and **both**
renderers consume it. The HTML renderer applies the computed column widths explicitly (fixed
`table-layout`) so the browser matches the SVG.

Data flow: `loadData` (existing) → `model.ts` (pivot, resolve formats, build lattice/tree) →
`layout.ts` (geometry) → `render-html` (live) or `render-svg` (export).

## 6. Live interactivity (`mount.ts`)

- **Sort** — click a leaf header to sort rows by that column (asc/desc/none cycle). Sorts
  *within* each lowest-level row group (group order preserved); disabled per-column via spec.
- **Row / column hover** — CSS-driven highlight (`:hover` row; column via JS toggling a class
  on the column's cells, since CSS has no column hover).
- **Sticky** — `position: sticky` on `thead` (header) and the stub column (first column);
  both on for wide tables.
- **Responsive** — wrap the table in the existing horizontal-scroll container; the sticky
  first column keeps row labels visible while the data columns scroll (mirrors the chart
  engine's scroll + sticky-axis pattern).

## 7. PNG export (option B — SVG redraw)

`render-svg.ts` draws the table from the same model+layout as `<text>`, `<rect>` (rules,
group separators, emphasis fills), and `<line>` (borders), then `export-table-png.ts` feeds it
to the existing `rasterize()` (Image → canvas → PNG) with the inlined Figtree font. Fully
self-contained (works in any embed, no server, no `foreignObject`). The figure chrome
(title/subtitle/logo/source/notes) is composed exactly as `export-png.ts` does for charts;
that composition is factored into a shared helper so both reuse it.

## 8. Formatting & extras

- **Format resolution**: default → per-column → per-row-group → per-row → per-cell.
- **Sign coloring**: numeric cells colored by sign when enabled (theme-driven, accessible).
- **Footnotes**: `footnotes` map + markers attached either inline (`[^a]` in a label/banner)
  or via a per-cell `footnote_column`; rendered as superscripts, listed below the table.
- **Emphasis**: per-row (`emphasis_rows`) or per-cell (a CSV flag column) → bold / subtle fill.
- **Indented sub-rows**: extra `stub` levels → indentation; deepest level is the row label.

## 9. CLI + budget-lab-charts integration

- Engine CLI gains table awareness: `tbl-chart render`/`validate`/`snapshot` detect a
  `table.yaml` folder and dispatch to the table path (or a `tbl-table` subcommand — TBD with
  the CLI's current dispatch).
- `budget-lab-charts`: a figure folder may contain `table.yaml` instead of `chart.yaml`; the
  repo's validator + site build dispatch on which file is present. `article.yaml` figure maps
  are file-agnostic (folder name keyed) and need no change. (Cross-repo follow-on, after the
  engine ships.)

## 10. Testing

- **Pure units** (jsdom-free): `model.ts` (pivot correctness, dup-cell error, lattice
  colspan/rowspan incl. blank-tier rowspan, format resolution order) and `layout.ts` (column
  widths, span rects, indent offsets).
- **Golden SVG**: `render-svg` snapshots for the three reference tables (byte-stable, like the
  chart goldens).
- **HTML/jsdom**: `mount.ts` structure (thead tiers, tbody groups, sticky classes) + sort and
  hover behaviors.
- **Validation**: schema + cross-checks (missing roles, duplicate cells, unknown format keys).

## 11. Phasing (for the implementation plan)

1. Spec + schema + validation + `model.ts` (pivot + lattice + formats) — pure core.
2. `layout.ts` + `render-svg.ts` + golden tests — static visual core.
3. `render-html.ts` + `mount.ts` chrome (no interactivity yet) — live embed.
4. Interactivity: sort, hover, sticky, responsive scroll.
5. Extras: emphasis, sign color, footnotes, indentation.
6. PNG export (`export-table-png.ts`) + shared chrome helper.
7. CLI dispatch (+ budget-lab-charts integration as a separate cross-repo task).

## 12. Open questions

- CLI surface: extend the existing `tbl-chart` commands to detect `table.yaml`, or add a
  parallel `tbl-table` command? (Lean: detect + dispatch, one CLI.)
- Footnote marker source: **v1 ships the per-cell `footnote_column` only** (markers as `<sup>`
  on cells + a definition list below the table). Inline `[^a]` markers in labels/banners were
  descoped to a later iteration.
