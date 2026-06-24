# Changelog

All notable changes to the Budget Lab chart engine are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/); this project adheres to
[Semantic Versioning](https://semver.org/).

## [1.0.3] — 2026-06-24

### Changed
- Standalone chart page background is now transparent (was opaque white), so a chart embedded in
  an iframe inherits the host page's background — correct for publications with non-white pages.
  Standalone, the browser default (white) shows through, so the gallery view is unchanged.

## [1.0.2] — 2026-06-24

### Changed
- Data (CSV) and Image (PNG) download filenames now use the chart's folder slug (derived from the
  page URL, e.g. `childcare-by-activity.csv`) instead of a slugified title, which was unwieldy.
  Falls back to the title slug when the page isn't served from a chart-folder URL.

## [1.0.1] — 2026-06-24

### Fixed
- `tbl-chart` CLI was a silent no-op (exit 0, no output, no file written) when invoked through
  its `node_modules/.bin` symlink — i.e. under a normal install, including CI. The entry-point
  guard compared `import.meta.url` (the realpath) against `process.argv[1]` (the symlink path);
  these never matched, so `main()` never ran. The guard now resolves `process.argv[1]` through
  `realpathSync` before comparing.

## [1.0.0] — 2026-06-24

Initial public release — the launch baseline for the engine.

### Chart types
- **Line** charts (temporal, numeric, quarterly, and categorical x-axes), optional data-point markers.
- **Grouped bar** charts (vertical and horizontal), with value labels.
- **Stacked bar** charts: cumulative, diverging (net dot + signed labels), 100%/normalized, and
  monochromatic tonal modes.
- **Small multiples** (multi-panel figures) in shared-scale and per-pane modes, with a responsive
  reflowing grid.

### Data
- Configurable column mapping via a `columns:` block (`x` / `value` / `series` / `facet`) — input
  CSVs may use any column names; series is optional (single-series charts).
- Tidy long-format loading from local CSV or remote URL/JSON, normalized to one internal shape.

### Interactivity
- Hover crosshair / category tooltips, legend hover-to-highlight and click-to-pin, click-to-select.
- Coordinated cursor across small-multiples panes.
- Collision-aware value labels and adaptive x-axis labels (wrap → rotate).

### Styling & layout
- Style-Guide palette and typography tokens (generated from the canonical palette).
- Axis titles, value labels, confidence bands; responsive widths down to a mobile floor.

### Embedding & export
- Self-contained interactive HTML, PNG and SVG export.
- Figure-number eyebrow supplied at embed time (not in the spec); suppressible per-embed via
  `?eyebrow=off`.

### Tooling
- `tbl-chart` CLI: `validate`, `render`, `serve`, `snapshot`.
- ajv schema + data cross-reference validation.
- Distributed as a git-tag dependency; the `prepare` script builds `dist/` on install.
