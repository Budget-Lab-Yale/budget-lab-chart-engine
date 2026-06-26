// Chart-relevant CSS ported from the AI Labor Market Tracker's styles.css.
// Includes only the rules required to render the MVP classes:
//   figure-card, figure-title, figure-subtitle, figure-canvas, figure-legend-slot,
//   figure-meta / figure-meta-text / figure-note / figure-source / figure-source-prefix,
//   tbl-legend / tbl-legend-item / tbl-legend-swatch (.is-dashed) / tbl-legend-reset /
//   tbl-legend-reset-icon / .is-pinned, tbl-dimmed,
//   tbl-tooltip / tbl-tooltip-head / tbl-tooltip-row / tbl-tooltip-swatch (.is-dashed) /
//   tbl-tooltip-label / tbl-tooltip-value.
// Base font/color variables and body defaults are included so the standalone HTML
// renders correctly without any external stylesheet.
// Intentionally omitted: scroll wrapper, y-axis overlay, downloads, selectors,
// tabs, sidebar, current-update cards, outer shell/header, responsive breakpoints.

import { TOKENS_CSS } from "../theme/tokens";

// Color custom properties (--tbl-navy, --tbl-text-*, etc.) come from TOKENS_CSS, generated
// verbatim from the Style-Guide palette so the HTML/CSS matches the SVG side exactly. Only
// the font stack + Figtree weight scale (not in colors.json) are defined here.
const RULES = `
/* =========================================================================
 * Typography â€” Figtree weight scale and font variables.
 * ========================================================================= */
:root {
  --tbl-font-sans: 'Figtree', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif;
  --tbl-font-sans-compact: 'Figtree', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif;

  /* Figtree weight scale */
  --tw-body:   500;
  --tw-medium: 600;
  --tw-semi:   700;
  --tw-bold:   800;
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: var(--tbl-font-sans);
  font-weight: var(--tw-body);
  color: var(--tbl-text-body);
  /* Transparent so the chart inherits the host page's background when embedded in an iframe
     (e.g. publications with non-white backgrounds). Standalone, the browser default (white)
     shows through, so the gallery view is visually unchanged. */
  background: transparent;
  line-height: 1.5;
}

/* =========================================================================
 * Figure card
 * ========================================================================= */
.figure-card {
  margin-bottom: 28px;
  /* Query container so narrow-width rules (e.g. stacking the download buttons) respond to
     the CHART CARD's own width, not the page viewport — correct for an embed of any size,
     unlike AILMT's viewport media query (which keyed on its full sidebar+main layout). */
  container-type: inline-size;
}
.figure-card:last-child { margin-bottom: 0; }

/* Eyebrow above the title (e.g. "Figure 1"). Ported from the tracker's figure-supertitle. */
.figure-supertitle {
  font: var(--tw-body) 11px/1.2 var(--tbl-font-sans);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--tbl-text-muted);
  margin: 0 0 8px;
}

.figure-title {
  margin: 0 0 4px;
  font-size: 18px;
  font-weight: var(--tw-bold);
  color: var(--tbl-navy);
  line-height: 1.25;
  letter-spacing: -0.005em;
}

.figure-subtitle {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: var(--tw-semi);
  color: var(--tbl-text-muted);
}

/* =========================================================================
 * Legend slot + canvas
 * ========================================================================= */
.figure-legend-slot { width: 100%; }

/* Right-legend layout: flex row containing the scroll wrapper (left) and the vertical
   legend column (right). The chart area gets a reduced width so the legend column has
   space — no layout feedback loop because the width computation is based on the OUTER
   card element, not this flex child. */
.figure-body--legend-right {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16px;
}
/* The canvas scroll wrapper stretches to fill the remaining flex space. */
.figure-body--legend-right .figure-canvas-scroll {
  flex: 1 1 0;
  min-width: 0;
}
/* Right legend column: fixed width matching LEGEND_COLUMN_WIDTH in render-live.ts (160px).
   Centered vertically on the chart area. ~22px row gaps per Style-Guide §8.2. */
.figure-legend-slot--right {
  flex: 0 0 160px;
  width: 160px;
  align-self: center;
}
/* Vertical legend: items stacked in a column with consistent row spacing. Items stretch
   to the column width and left-align their contents, so every swatch sits on a common
   left edge (Fix #D). */
.tbl-legend--vertical {
  flex-direction: column;
  align-items: stretch;
  gap: 0 0;
  row-gap: 4px;
  margin: 0;
  min-height: 0;
}
.tbl-legend--vertical .tbl-legend-item {
  justify-content: flex-start;
  text-align: left;
  width: 100%;
}
/* Reset button left-aligned at the bottom of the vertical legend (no trailing right
   margin pushing it off the common left edge). */
.tbl-legend--vertical .tbl-legend-reset {
  margin: 2px 0 0 0;
  align-self: flex-start;
}
/* The vertical (right) legend is vertically centered on the chart, so the reset button
   appearing/disappearing must NOT change the column height (that would re-center and shift
   every row). Reserve its slot always: keep it in flow but invisible until pinned (overrides
   the global display:none for the hidden state). */
.tbl-legend--vertical .tbl-legend-reset[hidden] {
  display: inline-flex;
  visibility: hidden;
}

/* Small-multiples PER-PANE grid: a responsive CSS grid of mini-chart cells. The live layer
   sets --figure-cols (reflowed by container width) and re-renders each pane's SVG at the
   matching pane width. Each cell stacks a pane title above its mini-SVG. */
.figure-grid {
  display: grid;
  grid-template-columns: repeat(var(--figure-cols, 2), minmax(0, 1fr));
  gap: 18px 16px;
  width: 100%;
}
.figure-pane {
  min-width: 0;
}
.figure-pane-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--tbl-text-heading);
  margin: 0 0 2px 0;
}
.figure-pane svg {
  display: block;
  max-width: 100%;
}

/* Scroll wrapper isolates horizontal overflow to the chart region, so the title/subtitle/
   source above and below keep wrapping to the card width. */
.figure-canvas-scroll {
  width: 100%;
  position: relative;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.figure-canvas {
  width: 100%;
  position: relative;
}
/* Native px: the SVG is re-rendered at the container width and keeps that exact width; below
   the min width it overflows into the scroll wrapper rather than being CSS-scaled down. */
.figure-canvas svg {
  display: block;
  max-width: none;
}

/* Sticky y-axis overlay — floating value labels pinned at the left during horizontal scroll
   (the controller translateX's it by scrollLeft). */
.figure-y-axis-overlay {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
  pointer-events: none;
}
.figure-y-axis-overlay span {
  position: absolute;
  left: 0;
  background: rgba(255, 255, 255, 0.8);
  padding: 1px 4px;
  border-radius: 6px;
  font: var(--tw-body) 10.5px/1 var(--tbl-font-sans);
  color: var(--tbl-text-axis);
  white-space: nowrap;
}

/* X-axis title — sticky + centered in the visible viewport regardless of horizontal scroll. */
/* X- and y-axis titles share one type treatment (12px semibold, axis color); they differ only
 * in placement — x centered below the plot, y left-aligned above it. The negative top margin on
 * the x-title absorbs the SVG's bottom whitespace below the tick labels so the title sits close
 * to them (not floating well below). */
.figure-x-axis-title {
  position: sticky;
  left: 0;
  margin: -3px 0 0;
  font: var(--tw-semi) 12px/1.3 var(--tbl-font-sans);
  color: var(--tbl-text-axis);
  text-align: center;
}
/* Scatter's numeric x-axis labels sit tighter to the frame than the temporal axis the default
   was tuned for, so give the x-axis title a little more breathing room. */
.chart-scatter .figure-x-axis-title {
  margin-top: 8px;
}
.figure-y-axis-title {
  margin: 0 0 4px;
  font: var(--tw-semi) 12px/1.3 var(--tbl-font-sans);
  color: var(--tbl-text-axis);
  text-align: left;
}

/* =========================================================================
 * Meta / source line
 * ========================================================================= */
.figure-meta {
  margin-top: 10px;
  font-size: 12px;
  color: var(--tbl-text-muted);
  line-height: 1.45;
  display: flex;
  align-items: flex-start;
  gap: 16px;
}
.figure-meta-text { flex: 1 1 auto; min-width: 0; }
.figure-meta .figure-note { margin: 0 0 4px; }
.figure-meta .figure-source { margin: 0; }
.figure-meta .figure-source-prefix { font-weight: var(--tw-semi); }

/* =========================================================================
 * Legend
 * ========================================================================= */
.tbl-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 4px;
  margin: 0 0 8px;
  padding: 0;
  /* Reserve the reset button's height (22px) so the row doesn't grow â€” and shove the
     chart down ~1px â€” when the reset toggles in on the first pin. */
  min-height: 22px;
}
.tbl-legend-item {
  appearance: none;
  background: transparent;
  border: none;
  padding: 4px 8px 3px 6px;
  margin: 0;
  font: var(--tw-body) 12px/1.2 var(--tbl-font-sans-compact, var(--tbl-font-sans));
  color: var(--tbl-text-body);
  display: inline-flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  border-radius: 4px;
  box-shadow: inset 0 -2px 0 transparent;
  transition: background 0.12s, color 0.12s, box-shadow 0.12s;
}
.tbl-legend-item:hover,
.tbl-legend-item:focus-visible {
  background: var(--tbl-bg-subtle);
  color: var(--tbl-text-heading);
  outline: none;
}
.tbl-legend-item.is-pinned {
  color: var(--tbl-text-heading);
  background: var(--tbl-bg-subtle);
  box-shadow: inset 0 -1px 0 var(--legend-color, var(--tbl-navy));
}
.tbl-legend-swatch {
  width: 18px;
  height: 3px;
  border-radius: 1px;
  display: inline-block;
  flex-shrink: 0;
}
.tbl-legend-swatch.is-dashed {
  background: linear-gradient(
    to right,
    var(--swatch-color, currentColor) 0 25%,
    transparent          25% 37.5%,
    var(--swatch-color, currentColor) 37.5% 62.5%,
    transparent          62.5% 75%,
    var(--swatch-color, currentColor) 75% 100%
  );
  border: 0;
  height: 2px;
}
.tbl-legend-swatch.is-rect {
  width: 14px;
  height: 12px;
  border-radius: 1px;
}
.tbl-legend-swatch.is-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  box-shadow: inset 0 0 0 1.5px #000;
}
/* Line + point-marker swatch: sized to the inline SVG (line with the series' symbol). */
.tbl-legend-swatch.is-symbol {
  width: 22px;
  height: 12px;
  border-radius: 0;
  background: none;
  display: inline-flex;
  align-items: center;
}
/* Point-chart swatch: a filled colored marker (the symbol) with no connecting line. */
.tbl-legend-swatch.is-point {
  width: 18px;
  height: 16px;
  border-radius: 0;
  background: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
/* Two-group (color + shape) point legend: groups STACK on separate lines (color row, then
   shape row), each group an inline cluster of swatches. */
.tbl-legend--grouped {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px 0;
}
.tbl-legend-group {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 4px;
}
.tbl-legend-group-title {
  font: var(--tw-semi, 600) 11px/1.2 var(--tbl-font-sans-compact, var(--tbl-font-sans));
  color: var(--tbl-text-muted, var(--tbl-text-axis));
  text-transform: none;
  margin-right: 2px;
  white-space: nowrap;
}
/* Shape-legend rows are non-interactive in v1: plain markers + labels, no hover affordance. */
.tbl-legend-item.is-static {
  cursor: default;
  padding: 4px 8px 3px 6px;
}
.tbl-legend-item.is-static:hover {
  background: transparent;
  color: var(--tbl-text-body);
}

/* =========================================================================
 * Legend reset button
 * ========================================================================= */
.tbl-legend-reset {
  appearance: none;
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid var(--tbl-border);
  background: var(--tbl-bg);
  color: var(--tbl-text-muted);
  margin: 0 6px 0 0;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
  font-family: 'Segoe UI Symbol', 'Apple Symbols', 'Noto Sans Symbols', system-ui, sans-serif;
  font-size: 16px;
  line-height: 1;
  text-align: center;
}
.tbl-legend-reset-icon {
  display: block;
  transform: translateY(-2px);
  line-height: 1;
}
.tbl-legend-reset[hidden] { display: none; }
.tbl-legend-reset:hover,
.tbl-legend-reset:focus-visible {
  background: var(--tbl-navy);
  color: #fff;
  border-color: var(--tbl-navy);
  outline: none;
}

/* =========================================================================
 * Hover-to-dim
 * ========================================================================= */
/* Applies to line <path data-series> AND bar/stacked <rect data-series>. Scoped to the chart
   regions — the single-chart canvas AND the per-pane small-multiples grid — so dimming works
   for figures too (the grid svgs live in .figure-grid, not .figure-canvas). */
.figure-canvas svg [data-series],
.figure-grid svg [data-series] {
  transition: opacity 120ms linear;
}
.figure-canvas svg .tbl-dimmed,
.figure-grid svg .tbl-dimmed {
  opacity: 0.15;
}
/* The diverging net-total LABEL is a wide text over the bar center; it is tagged with the
   Total key so it DIMS with the dot, but it must not steal clicks from the segments beneath
   it. Make it non-interactive so clicks fall through to the segment — only the small net
   DOT (tbl-net-marker) selects Total. */
.figure-canvas svg .tbl-net-label,
.figure-grid svg .tbl-net-label {
  pointer-events: none;
}

/* =========================================================================
 * Click-to-select cursor — only on interactive (has-legend) charts.
 * render-live adds .is-selectable to the card when it wires chart clicks to the
 * legend's pin toggle. The transparent crosshair hit-overlay sits ON TOP of the
 * marks, so its cursor wins where they overlap; give it the same pointer cursor so the
 * affordance is consistent across the whole plot when selection is on.
 * ========================================================================= */
.figure-card.is-selectable .figure-canvas svg [data-series],
.figure-card.is-selectable .figure-canvas svg .tbl-crosshair-hit,
.figure-card.is-selectable .figure-canvas svg .tbl-band-crosshair-hit,
.figure-card.is-selectable .figure-grid svg [data-series],
.figure-card.is-selectable .figure-grid svg .tbl-crosshair-hit,
.figure-card.is-selectable .figure-grid svg .tbl-band-crosshair-hit {
  cursor: pointer;
}

/* =========================================================================
 * Crosshair tooltip â€” frosted glass
 * ========================================================================= */
.tbl-tooltip {
  position: fixed;
  pointer-events: none;
  opacity: 0;
  background: rgba(255, 255, 255, 0.5);
  color: var(--tbl-text-heading, #1A1A2E);
  font: var(--tw-body) 12px/1.35 var(--tbl-font-sans);
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid rgba(200, 205, 215, 0.7);
  white-space: nowrap;
  z-index: 9999;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.10);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
          backdrop-filter: blur(20px) saturate(160%);
  transition: opacity 80ms linear;
  max-width: 320px;
}
.tbl-tooltip-head {
  margin-bottom: 4px;
  font-weight: var(--tw-bold);
}
.tbl-tooltip-label { font-weight: var(--tw-body); }
.tbl-tooltip-value { font-weight: var(--tw-bold); }
.tbl-tooltip-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}
.tbl-tooltip-row:last-child { margin-bottom: 0; }
.tbl-tooltip-swatch {
  display: inline-block;
  flex-shrink: 0;
  width: 18px;
  height: 3px;
  border-radius: 1px;
}
.tbl-tooltip-swatch.is-dashed {
  background: linear-gradient(
    to right,
    var(--swatch-color, currentColor) 0 25%,
    transparent          25% 37.5%,
    var(--swatch-color, currentColor) 37.5% 62.5%,
    transparent          62.5% 75%,
    var(--swatch-color, currentColor) 75% 100%
  );
  height: 2px;
}
/* Total row (diverging net dot): a CIRCLE swatch matching the net marker + legend "Total"
   entry — white fill, black inset stroke. Mirrors .tbl-legend-swatch.is-dot. */
.tbl-tooltip-swatch.is-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  box-shadow: inset 0 0 0 1.5px #000;
}
/* Bar tooltip swatch: a filled square matching the bar legend (vs the default thin line). */
.tbl-tooltip-swatch.is-square {
  width: 11px;
  height: 11px;
  border-radius: 1px;
}
/* Scatter tooltip header: the point's actual marker symbol (colored), inline before the text. */
.tbl-tooltip-swatch.is-symbol {
  width: 16px;
  height: 14px;
  background: none;
  border-radius: 0;
  vertical-align: middle;
  margin-right: 5px;
}

/* =========================================================================
 * Figure header — flex row with title-text left, logo right
 * ========================================================================= */
.figure-header {
  margin-bottom: 0;
}
/* Title row: the title fills the width and pushes the logo to the right; baseline alignment
   lets the logo sit on the title's first-line baseline. The eyebrow sits above this row and
   the subtitle below it (both full width). */
.figure-titlebar {
  position: relative;
}
.figure-titlebar .figure-title {
  /* Reserve space on the right for the absolutely-positioned logo (130px + ~16px gap) so
     the title text wraps before it. */
  padding-right: 146px;
}

/* =========================================================================
 * Logo
 * ========================================================================= */
.figure-logo {
  position: absolute;
  right: 0;
  /* Lift the logo so its wordmark baseline (~0.87 down the 4:1 box ≈ 28.3px at 130px wide)
     lands on the title's first-line baseline (~17px below the titlebar top for the 18px/1.25
     title): top = 17 − 28.3 ≈ −11.3px. Absolute + inside the relative titlebar, so it adds
     no row height (no eyebrow gap) and its bottom (≈21px) stays within the title's first line
     — nothing overflows downward, so no Firefox clip. */
  top: -11.3px;
  width: 130px;
}
.figure-logo svg {
  display: block;
  width: 100%;
  height: auto;
}

/* =========================================================================
 * Download buttons — ported from tracker styles.css
 * ========================================================================= */
.figure-downloads {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.figure-download-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font: var(--tw-medium) 12px/1 var(--tbl-font-sans);
  color: var(--tbl-text-muted);
  background: transparent;
  border: 1px solid var(--tbl-border);
  border-radius: 4px;
  padding: 4px 8px;
  cursor: pointer;
  white-space: nowrap;
}
.figure-download-btn:hover,
.figure-download-btn:focus-visible {
  border-color: var(--tbl-navy);
  color: #fff;
  background: var(--tbl-navy);
  outline: none;
}
.figure-download-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.figure-download-btn svg { display: block; flex-shrink: 0; }

/* =========================================================================
 * Responsive — stack the Data/Image buttons when the chart card itself is narrow.
 * Container query (keyed on the card width), so it's correct regardless of the embed's
 * page context. ~520px ≈ AILMT's chart-area width when it stacked (880px viewport − 280px
 * sidebar − gaps/padding).
 * ========================================================================= */
@container (max-width: 520px) {
  .figure-downloads { flex-direction: column; }
}

/* =========================================================================
 * Table — .tbl-table (figure type "table")
 * Uses --tbl-* tokens throughout; no hardcoded hex values.
 * ========================================================================= */

/* ---- Table element ---- */
.tbl-table {
  font-family: var(--tbl-font-sans);
  font-weight: var(--tw-body);
  font-size: 13px;
  color: var(--tbl-text-body);
  border-collapse: collapse;
  table-layout: fixed;
  width: 100%;
}

/* ---- Column sizing via colgroup/col ---- */
.tbl-table col { }

/* ---- Header ---- */
.tbl-table thead th {
  font-weight: var(--tw-bold);
  color: var(--tbl-text-heading);
  font-size: 12px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--tbl-axis-stroke);
  background: var(--tbl-bg);
  text-align: center;
  vertical-align: bottom;
  white-space: nowrap;
  /* Sticky header: thead stays pinned to the top of the scroll container. */
  position: sticky;
  top: 0;
  z-index: 2;
}

/* Banner tiers (non-leaf header rows): centered, no bottom border between tiers. */
.tbl-table thead tr:not(:last-child) th {
  vertical-align: middle;
  border-bottom: 1px solid var(--tbl-border);
}

/* Leaf headers (last header row): bottom-aligned, centered (inherits text-align:center). */
.tbl-table thead tr:last-child th {
  vertical-align: bottom;
}

/* Banner cells (colSpan > 1): centered label flanked by hairline rules extending to the cell's
   edges, showing the columns the banner governs. Leaf headers (colSpan 1) are unaffected. */
.tbl-table thead th.is-spanner { text-align: center; }
.tbl-table thead th.is-spanner > .tbl-table-spanner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.tbl-table thead th.is-spanner > .tbl-table-spanner::before,
.tbl-table thead th.is-spanner > .tbl-table-spanner::after {
  content: "";
  flex: 1 1 auto;
  border-top: 1px solid var(--tbl-border);
}

/* Stub cell in header (corner) — left-aligned. The corner <th> carries class
   tbl-table-stub-header in the rendered HTML. */
.tbl-table thead th.tbl-table-stub-header {
  text-align: left;
}

/* ---- Sub-label: displayed on its own line below the leaf header text ---- */
.tbl-table-sublabel {
  display: block;
  font-size: 10px;
  font-weight: var(--tw-body);
  color: var(--tbl-text-muted);
  margin-top: 2px;
  white-space: nowrap;
}

/* ---- Body ---- */
.tbl-table tbody td,
.tbl-table tbody th {
  padding: 5px 8px;
  border-bottom: 1px solid var(--tbl-gridline);
  font-size: 13px;
  background: var(--tbl-bg);
  /* Base of the sticky stacking ladder: scrolling body cells sit below the sticky thead (z 2)
     and the pinned first column (z 3) / header corner (z 4). */
  position: relative;
  z-index: 0;
}

/* Numeric cells: centered by default, tabular figures. */
td.is-num {
  text-align: center;
  font-variant-numeric: tabular-nums;
}

/* Stub (row label) cells: left-aligned. */
th.tbl-table-stub {
  text-align: left;
  font-weight: var(--tw-body);
  color: var(--tbl-text-body);
}

/* ---- Row groups ---- */
/* Group heading: bold, no fill. A single hairline rule ABOVE the heading separates groups;
   extra top padding gives breathing room (the rule + space does the grouping, not a fill band). */
tr.tbl-table-group th,
tr.tbl-table-group td {
  text-align: left;
  font-weight: var(--tw-bold);
  color: var(--tbl-text-heading);
  border-top: 1px solid var(--tbl-border);
  padding-top: 14px;
  padding-bottom: 3px;
}
/* The first group has no rows above it, so its top rule is redundant — drop it. */
.tbl-table tbody tr.tbl-table-group:first-child th,
.tbl-table tbody tr.tbl-table-group:first-child td {
  border-top: none;
  padding-top: 4px;
}
/* Sticky row-group titles: the group heading sticks just below the sticky column-header block
   as the page scrolls vertically. --tbl-thead-h is measured + set by mount.ts (0 fallback under
   jsdom, which has no layout). Opaque bg so body rows scroll under the stuck title. */
.tbl-table tbody tr.tbl-table-group th {
  position: sticky;
  top: var(--tbl-thead-h, 0px);
  z-index: 1;
  background: var(--tbl-bg);
}
/* Keep the group title anchored at the left during horizontal scroll (it labels the pinned
   rows), instead of scrolling off and clipping under the sticky first column. */
.tbl-table-group-inner {
  position: sticky;
  left: 0;
  display: inline-block;
}

/* Group note: italic, muted, smaller — sits directly under the heading, no rule, no fill. */
tr.tbl-table-group-note th,
tr.tbl-table-group-note td,
.tbl-table-group-note {
  text-align: left;
  font-style: italic;
  font-weight: var(--tw-body);
  font-size: 11px;
  color: var(--tbl-text-muted);
  padding-top: 0;
  padding-bottom: 6px;
}

/* ---- Emphasis ---- */
.is-emphasis {
  font-weight: var(--tw-bold);
  background: var(--tbl-bg-subtle) !important;
}

/* ---- Positive / negative coloring ---- */
/* Use categorical green (cat4) and red (cat5) tokens — muted base tones. */
td.is-pos {
  color: var(--tbl-cat4);  /* green */
}
td.is-neg {
  color: var(--tbl-cat5);  /* red */
}

/* ---- Row hover (CSS only — no JS needed) ---- */
.tbl-table tbody tr:hover td,
.tbl-table tbody tr:hover th {
  background: var(--tbl-bg-subtle);
}

/* ---- Column hover (JS toggles .is-col-hover on [data-col=k] cells) ---- */
/* Same subtle grey as the row hover so the crosshair reads gently, not as a bold blue band. */
.tbl-table .is-col-hover {
  background: var(--tbl-bg-subtle) !important;
}

/* ---- Sticky first column ---- */
/* Enabled when .tbl-table--sticky-first is present on the table element. A z-index ladder keeps
   the pinned stub column ABOVE the scrolling header + body so column headers are clipped by the
   pinned column at the same moment their data cells slide under it:
     body cells            z 0  (set above)
     sticky thead th (top) z 2
     sticky stub column    z 3  (body stub cells + leaf-tier stub <th>)
     header corner         z 4  (sticky top + left). */
.tbl-table--sticky-first td:first-child,
.tbl-table--sticky-first th.tbl-table-stub {
  position: sticky;
  left: 0;
  z-index: 3;
  /* Opaque background so scrolling cells pass behind the pinned column. */
  background: var(--tbl-bg);
}
/* The header corner is pinned at both top and left, and must sit above the scrolling thead so
   header cells disappear under it in lockstep with their data column. */
.tbl-table--sticky-first thead th.tbl-table-stub-header {
  position: sticky;
  left: 0;
  z-index: 4;
  background: var(--tbl-bg);
}

/* ---- Footnote superscript ---- */
.tbl-table sup {
  font-size: 0.7em;
  vertical-align: super;
  line-height: 0;
  color: var(--tbl-text-muted);
}
`;

/** Self-contained chart CSS: the Style-Guide color tokens (generated) followed by the
 * font scale + chart-chrome rules. */
export const CHART_CSS: string = `${TOKENS_CSS}\n${RULES}`;
