// chartType: treemap — rows to drawable data, the squarified layout (treemap-layout), colour and label
// fitting (treemap-labels), drawn as hand-built SVG: one tile per drawn row. Groups are named by the
// engine's standard legend (legendItems, placed and highlighted by render-live, drawn by the PNG
// export); an unlabelled tile is named by its aria-label and the hover card. The live mount and the
// PNG export both call renderTreemap at their width; nothing here is live-only. All text is SVG
// <text> (HTML inside an SVG does not rasterise).
//
// Imports buildColorMap back from ../index, which imports renderTreemap from here: the same safe
// ES-module cycle as marks/timeline.ts (both references resolve at call time).
import { TBL } from "../theme";
import { tokens } from "../../theme/tokens";
import { buildColorMap } from "../index";
import { ownValue } from "../../spec/own-key";
import type { LegendItem, RenderOptions, RenderResult } from "../index";
import { legendInRightColumn, LEGEND_COLUMN_WIDTH, LEGEND_GAP } from "../legend-layout";
import { INNER_W } from "../../embed/figure-chrome";
import type { ChartSpec } from "../../spec/types";
import type { TidyRow } from "../../data/index";
import {
  resolveTreemapConfig, treemapData, treemapDataWarnings, formatTreemapShare, formatTreemapValue,
  type TreemapDatum,
} from "../../spec/treemap";
import { layoutTreemap, treemapAreaHeight, TM_GEOM, TM_RETILINGS, TM_SQUARIFY, type TreemapTiling } from "../treemap-layout";
import {
  tileFill, contrastText, fitTileLabel, fitTileLabels, treemapLabelSize, TM_LABEL_SIZES, TM_LINE_HEIGHT as LINE_HEIGHT,
  type TileLabel,
} from "../treemap-labels";

const SVG_NS = "http://www.w3.org/2000/svg";
export const TREEMAP_CLASS = "tbl-treemap";

/** Baseline below a line box's centre that centres Figtree's cap height (0.7 em) in the box. */
const CAP_CENTRE = 0.35;

/** Per-tile hover payload, in DOM order of `rect.tbl-treemap-tile`. */
export interface TreemapTileInfo {
  name: string;
  group: string | null;
  groupLabel: string | null;
  value: number;
  share: number;
  row: TidyRow;
  fill: string;
}

interface BuiltTile {
  datum: TreemapDatum;
  x0: number; y0: number; x1: number; y1: number;
  groupLabel: string | null;
  share: number;
  fill: string;
  label: TileLabel;
}
interface Built {
  width: number;
  areaH: number;
  tiles: BuiltTile[];
  groupNames: string[];
  colors: Map<string, string>;
  /** One legend row per group, in groupNames order (empty for flat data). */
  keyRows: LegendItem[];
}

const r2 = (v: number): number => Math.round(v * 100) / 100;

/** One way to draw a chart: the tiling of the whole frame (flat data's tiles, or grouped data's
 *  group blocks) and the one label size. */
export interface TreemapCandidate { tiling: TreemapTiling; size: number }
/** A candidate and how many tiles it labels. */
export type ScoredCandidate = TreemapCandidate & { labelled: number };

/** Grouped data keeps squarified group blocks on a chart at least this wide. */
const GROUP_ARRANGE_BELOW = 600;

/** A non-squarify candidate must label at least this many more tiles than the best squarify variant
 *  at its size to be drawn (Ruling 45: squarify unless much better). */
const NON_SQUARIFY_MARGIN = 2;
const isSquarify = (t: TreemapTiling): boolean => (TM_SQUARIFY as readonly string[]).includes(t);

/** The candidates in their fixed order: every tiling — the squarify variants (TM_SQUARIFY) first,
 *  then TM_RETILINGS — at the base size (treemapLabelSize), then, on a chart narrower than
 *  TM_LABEL_SIZES.smallBelow, every tiling again at TM_LABEL_SIZES.small. With groups the tiling
 *  arranges the group blocks, and only below GROUP_ARRANGE_BELOW (d3's default squarify alone above
 *  it); each block's tiles stay squarified (and rescued where that saves its largest label,
 *  layoutTreemap). */
function candidates(width: number, grouped: boolean): TreemapCandidate[] {
  const tilings: TreemapTiling[] = grouped && width >= GROUP_ARRANGE_BELOW ? ["squarify"] : [...TM_SQUARIFY, ...TM_RETILINGS];
  const sizes = [treemapLabelSize(width), ...(width < TM_LABEL_SIZES.smallBelow ? [TM_LABEL_SIZES.small] : [])];
  return sizes.flatMap((size) => tilings.map((tiling) => ({ tiling, size })));
}

/** Every candidate with the tiles it labels, and the index of the one drawn (pickCandidate).
 *  Exported for tests. */
export function treemapChoice(spec: ChartSpec, rows: TidyRow[], width: number): { candidates: ScoredCandidate[]; chosen: number } {
  return choose(spec, rows, width).choice;
}

function choose(spec: ChartSpec, rows: TidyRow[], width: number):
  { built: Built; choice: { candidates: ScoredCandidate[]; chosen: number } } {
  const grouped = treemapData(spec, rows).some((d) => d.group !== null);
  const builds = candidates(width, grouped).map((cand) => ({ cand, b: buildAt(spec, rows, width, cand) }));
  const scored = builds.map(({ cand, b }): ScoredCandidate => ({ ...cand, labelled: b.tiles.filter((t) => t.label.mode !== "none").length }));
  const chosen = pickCandidate(scored);
  return { built: builds[chosen]!.b, choice: { candidates: scored, chosen } };
}

/** Ruling 45. Within each size step, the squarify variant that labels the most tiles (the earlier
 *  on a tie), unless the best of the other tilings labels at least NON_SQUARIFY_MARGIN more; then,
 *  across size steps in order, the first step winner that labels the most (so the 11px step is taken
 *  only when it labels more than the base size). Deterministic. Exported for tests.
 *  Precondition: every size step in `scored` holds at least one squarify variant, as candidates()
 *  always produces; a step without one throws (firstMax reduces an empty list). */
export function pickCandidate(scored: ScoredCandidate[]): number {
  const firstMax = (ii: number[]): number => ii.reduce((a, b) => (scored[b]!.labelled > scored[a]!.labelled ? b : a));
  let best = -1;
  for (const size of [...new Set(scored.map((c) => c.size))]) {
    const idx = scored.map((_, i) => i).filter((i) => scored[i]!.size === size);
    const sq = idx.filter((i) => isSquarify(scored[i]!.tiling));
    const other = idx.filter((i) => !isSquarify(scored[i]!.tiling));
    let winner = firstMax(sq);
    if (other.length > 0) {
      const o = firstMax(other);
      if (scored[o]!.labelled >= scored[winner]!.labelled + NON_SQUARIFY_MARGIN) winner = o;
    }
    if (best < 0 || scored[winner]!.labelled > scored[best]!.labelled) best = winner;
  }
  return best;
}

/** The one place a spec + rows + width becomes geometry, colours and labels, so the render and the
 *  warnings can never disagree: the chosen candidate's build. */
function build(spec: ChartSpec, rows: TidyRow[], width: number): Built {
  return choose(spec, rows, width).built;
}

/** The groups in hue order, their resolved colours and their legend rows — width-independent. */
function treemapGroups(spec: ChartSpec, data: TreemapDatum[]): {
  groupNames: string[]; colors: Map<string, string>; keyRows: LegendItem[]; labelOf: (g: string) => string;
} {
  const grouped = data.some((d) => d.group !== null);
  const labelOf = (g: string): string => ownValue(spec.series_labels, g) ?? g;

  // Hue order: series_order's present groups first, then the rest by first appearance.
  const appearance: string[] = [];
  for (const d of data) if (d.group !== null && !appearance.includes(d.group)) appearance.push(d.group);
  // Deduplicated, first occurrence winning (Ruling 43): a repeated entry would otherwise take a hue
  // and a legend row of its own.
  const listed = [...new Set(spec.series_order ?? [])].filter((g) => appearance.includes(g));
  const groupNames = grouped ? [...listed, ...appearance.filter((g) => !listed.includes(g))] : [];
  const colors = buildColorMap(groupNames, spec.series_colors);
  const keyRows: LegendItem[] = groupNames.map((g) => ({
    series: g, label: labelOf(g), color: colors.get(g), dashed: false, markerShape: "rect",
  }));
  return { groupNames, colors, keyRows, labelOf };
}

/** A spec + rows + width drawn as one candidate. */
function buildAt(spec: ChartSpec, rows: TidyRow[], width: number, cand: TreemapCandidate): Built {
  const cfg = resolveTreemapConfig(spec);
  const data = treemapData(spec, rows);
  const { groupNames, colors, keyRows, labelOf } = treemapGroups(spec, data);
  const flatHue = tokens.categorical[0]!.base;
  const hueOf = (g: string | null): string => (g === null ? flatHue : colors.get(g) ?? flatHue);

  const total = data.reduce((s, d) => s + d.value, 0);
  const shareText = (v: number): string => formatTreemapShare(total > 0 ? v / total : 0, cfg.shareDecimals);
  const valueText = (v: number): string => formatTreemapValue(v, spec.value_format);

  const areaH = treemapAreaHeight(width);
  const size = cand.size;
  const numberOf = (v: number): string | null =>
    cfg.labelValue === "share" ? shareText(v) : cfg.labelValue === "value" ? valueText(v) : null;
  // A group whose largest tile cannot hold its label is re-tiled inside its block where that helps.
  const layout = layoutTreemap(data, width, areaH, {
    groupOrder: groupNames,
    tiling: cand.tiling,
    labelFits: (t) => fitTileLabel(t.datum.name, numberOf(t.datum.value), t.x1 - t.x0, t.y1 - t.y0, size).mode !== "none",
  });

  const groupSize = new Map<string | null, number>();
  for (const t of layout.tiles) groupSize.set(t.datum.group, (groupSize.get(t.datum.group) ?? 0) + 1);
  // One label size for the whole chart, labelled top-down by value within each group.
  const labels = fitTileLabels(layout.tiles.map((t) => ({
    name: t.datum.name, number: numberOf(t.datum.value), group: t.datum.group, value: t.datum.value,
    w: t.x1 - t.x0, h: t.y1 - t.y0,
  })), size);
  const tiles: BuiltTile[] = layout.tiles.map((t, i) => {
    const d = t.datum;
    return {
      datum: d, x0: t.x0, y0: t.y0, x1: t.x1, y1: t.y1,
      groupLabel: d.group !== null ? labelOf(d.group) : null,
      share: total > 0 ? d.value / total : 0,
      fill: tileFill(hueOf(d.group), t.rank, groupSize.get(d.group) ?? 1, cfg.shading),
      label: labels[i]!,
    };
  });
  return { width, areaH, tiles, groupNames, colors, keyRows };
}

/** Total SVG height at `width`, as renderTreemap draws it: the treemap area alone, which depends on
 *  the width only. */
export function treemapHeight(width: number): number {
  return treemapAreaHeight(width);
}

/** Whether the legend draws its group rows: grouped data with more than one group, unless `legend:
 *  false` or `series_legend: false` (the engine's rule for a lone series, buildLegendItems). */
function legendShown(spec: ChartSpec, groupCount: number): boolean {
  return spec.legend !== false && spec.series_legend !== false && groupCount > 1;
}

/** The legend rows renderTreemap returns as `legendItems` (none when the legend is not drawn). */
function treemapLegendRows(spec: ChartSpec, keyRows: LegendItem[]): LegendItem[] | null {
  return legendShown(spec, keyRows.length) ? keyRows : null;
}

/** The chart width the PNG export draws a treemap at: the full inner width, less the right-hand
 *  legend column when the export puts the legend there — the export's own rule
 *  (legendInRightColumn) on the legend rows the export will see. A treemap has no shape legend. */
export function treemapExportChartWidth(spec: ChartSpec, rows: TidyRow[]): number {
  const items = treemapLegendRows(spec, treemapGroups(spec, treemapData(spec, rows)).keyRows) ?? [];
  return legendInRightColumn(spec, items, 0, rows) ? INNER_W - LEGEND_COLUMN_WIDTH - LEGEND_GAP : INNER_W;
}

/** Non-fatal warnings at `width` (by default the export's chart width): the data warnings, plus more
 *  than half the tiles unlabelled (the hover card and each tile's aria-label still name them). */
export function treemapWarnings(spec: ChartSpec, rows: TidyRow[], width: number = treemapExportChartWidth(spec, rows)): string[] {
  const out = treemapDataWarnings(spec, rows);
  const { tiles } = build(spec, rows, width);
  const unlabelled = tiles.filter((t) => t.label.mode === "none").length;
  if (unlabelled * 2 > tiles.length) {
    out.push(
      `treemap: ${unlabelled} of ${tiles.length} tiles are unlabelled at ${width}px wide (hover still names them); consider grouping small categories into "Other"`,
    );
  }
  return out;
}

function draw(doc: Document, spec: ChartSpec, b: Built): SVGSVGElement {
  const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] => {
    const n = doc.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
  };
  const span = (text: string, attrs: Record<string, string | number>): SVGTSpanElement => {
    const s = el("tspan", attrs);
    s.textContent = text;
    return s;
  };
  const cfg = resolveTreemapConfig(spec);
  /** A tile's fitted label top-left in the tile whose top-left corner is (x0, y0): left-aligned at
   *  the left padding, lines stacked down from the top padding, each baseline centring the cap height
   *  in its line box. */
  const labelText = (lab: Exclude<TileLabel, { mode: "none" }>, x0: number, y0: number, fill: string): SVGTextElement => {
    const left = r2(x0 + TM_GEOM.pad);
    const top = y0 + TM_GEOM.pad;
    const baseline = (lineTop: number): number => r2(lineTop + (lab.size * LINE_HEIGHT) / 2 + CAP_CENTRE * lab.size);
    const text = el("text", { class: "tbl-treemap-label", "text-anchor": "start", fill, "aria-hidden": "true" });
    if (lab.mode === "stacked") {
      let lineTop = top;
      for (const line of lab.nameLines) {
        text.append(span(line, { x: left, y: baseline(lineTop), "font-size": lab.size, "font-weight": 700 }));
        lineTop += lab.size * LINE_HEIGHT;
      }
      if (lab.number !== null) {
        text.append(span(lab.number, { x: left, y: baseline(lineTop), "font-size": lab.size, "font-weight": 500 }));
      }
    } else {
      // Inline: drawn exactly as fitTileLabel measured it, the name at 700 then " number" at 500.
      text.setAttribute("x", String(left));
      text.setAttribute("y", String(baseline(top)));
      text.setAttribute("font-size", String(lab.size));
      text.append(span(lab.name, { "font-weight": 700 }));
      text.append(span(` ${lab.number}`, { "font-weight": 500 }));
    }
    return text;
  };

  // role="group", not "img": an img's children are presentational, which would hide every tile's
  // own label from assistive technology.
  const svg = el("svg", {
    class: TREEMAP_CLASS, width: b.width, height: b.areaH, viewBox: `0 0 ${b.width} ${b.areaH}`,
    "font-family": TBL.font, role: "group", "aria-label": spec.title,
  });
  // The area is white under the tiles (spec §3), so the gutters are white on any host page, live as
  // in the PNG.
  svg.append(el("rect", {
    class: "tbl-treemap-bg", x: 0, y: 0, width: b.width, height: r2(b.areaH), fill: tokens.structural.background,
    "aria-hidden": "true",
  }));

  for (const t of b.tiles) {
    const d = t.datum;
    const aria = `${t.groupLabel !== null ? `${t.groupLabel} · ` : ""}${d.name}, ${formatTreemapShare(t.share, cfg.shareDecimals)} of total, ${formatTreemapValue(d.value, spec.value_format)}`;
    const g = el("g", { role: "img", "aria-label": aria, ...(d.group !== null ? { "data-series": d.group } : {}) });
    g.append(el("rect", {
      class: "tbl-treemap-tile", x: t.x0, y: t.y0, width: r2(t.x1 - t.x0), height: r2(t.y1 - t.y0), fill: t.fill,
    }));
    if (t.label.mode !== "none") {
      g.append(labelText(t.label, t.x0, t.y0, contrastText(t.fill)));
    }
    svg.append(g);
  }

  return svg;
}

export function renderTreemap(spec: ChartSpec, rows: TidyRow[], opts: RenderOptions = {}): RenderResult {
  const b = build(spec, rows, opts.width ?? 720);
  const svg = draw(opts.document ?? document, spec, b);
  const treemapTiles: TreemapTileInfo[] = b.tiles.map((t) => ({
    name: t.datum.name, group: t.datum.group, groupLabel: t.groupLabel, value: t.datum.value, share: t.share,
    row: t.datum.row, fill: t.fill,
  }));

  // Last, as on every chart type: nothing below touches the SVG.
  if (opts.hooks?.afterRender) opts.hooks.afterRender(svg, { phase: opts.phase ?? "live" });
  return {
    svg, legendItems: treemapLegendRows(spec, b.keyRows), seriesKeyRows: b.keyRows,
    // A right-hand column lists the groups in the same order as a top legend (not reversed).
    legendVisualOrder: b.groupNames,
    seriesLabels: spec.series_labels ?? {}, seriesOrder: b.groupNames,
    dashedNames: new Set(), colors: b.colors, valueAffixes: { prefix: "", suffix: "" }, xAxisTitle: null,
    dataInScope: [], overlayTooltips: [], treemapTiles,
  };
}
