// chartType: treemap — rows to drawable data, the squarified layout (treemap-layout), colour and label
// fitting (treemap-labels), drawn as hand-built SVG: one tile per drawn row and a header strip per
// group whose strip fits. There is no key: an unlabelled tile is named by its aria-label and the hover
// card. The live mount and the PNG export both call renderTreemap at their width; nothing here is
// live-only. All text is SVG <text> (HTML inside an SVG does not rasterise).
//
// Imports buildColorMap back from ../index, which imports renderTreemap from here: the same safe
// ES-module cycle as marks/timeline.ts (both references resolve at call time).
import { TBL } from "../theme";
import { tokens } from "../../theme/tokens";
import { buildColorMap } from "../index";
import type { RenderOptions, RenderResult } from "../index";
import type { ChartSpec } from "../../spec/types";
import type { TidyRow } from "../../data/index";
import {
  resolveTreemapConfig, treemapData, treemapDataWarnings, formatTreemapShare, formatTreemapValue,
  type TreemapDatum,
} from "../../spec/treemap";
import { layoutTreemap, treemapAreaHeight, TM_GEOM, type GroupRect, type TreemapLayout } from "../treemap-layout";
import {
  tileFill, stripFill, contrastText, fitTileLabels, fitStripLabel, treemapLabelSize, treemapStripHeight,
  TM_LINE_HEIGHT as LINE_HEIGHT,
  type TileLabel, type StripLabel,
} from "../treemap-labels";

const SVG_NS = "http://www.w3.org/2000/svg";
export const TREEMAP_CLASS = "tbl-treemap";

/** The PNG export's chart width; the unlabelled-tiles warning is judged there. */
const EXPORT_WIDTH = 920;
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
interface BuiltStrip { group: GroupRect; fill: string; label: StripLabel }
interface Built {
  width: number;
  areaH: number;
  /** The chart's one text size (tile labels and strip text) and the strip height it implies. */
  size: number;
  stripH: number;
  layout: TreemapLayout;
  tiles: BuiltTile[];
  strips: BuiltStrip[];
  groupNames: string[];
  colors: Map<string, string>;
}

const r2 = (v: number): number => Math.round(v * 100) / 100;

/** The one place a spec + rows + width becomes geometry, colours and labels, so the render and the
 *  warnings can never disagree. */
function build(spec: ChartSpec, rows: TidyRow[], width: number): Built {
  const cfg = resolveTreemapConfig(spec);
  const data = treemapData(spec, rows);
  const grouped = data.some((d) => d.group !== null);
  // Own-property lookups only: a group named "constructor", "toString" or "__proto__" must not
  // find the inherited Object.prototype member (author maps are ordinary objects).
  const own = (m: Record<string, string> | undefined, g: string): string | undefined =>
    m && Object.hasOwn(m, g) ? m[g] : undefined;
  const labelOf = (g: string): string => own(spec.series_labels, g) ?? g;

  // Hue order: series_order's present groups first, then the rest by first appearance.
  const appearance: string[] = [];
  for (const d of data) if (d.group !== null && !appearance.includes(d.group)) appearance.push(d.group);
  const listed = (spec.series_order ?? []).filter((g) => appearance.includes(g));
  const groupNames = grouped ? [...listed, ...appearance.filter((g) => !listed.includes(g))] : [];
  // buildColorMap indexes its map directly, so hand it a prototype-free copy of the own entries.
  const colorCfg: Record<string, string> = Object.create(null);
  for (const g of groupNames) {
    const c = own(spec.series_colors, g);
    if (c !== undefined) colorCfg[g] = c;
  }
  const colors = buildColorMap(groupNames, spec.series_colors ? colorCfg : undefined);
  const flatHue = tokens.categorical[0]!.base;
  const hueOf = (g: string | null): string => (g === null ? flatHue : colors.get(g) ?? flatHue);

  const total = data.reduce((s, d) => s + d.value, 0);
  const shareText = (v: number): string => formatTreemapShare(total > 0 ? v / total : 0, cfg.shareDecimals);
  const valueText = (v: number): string => formatTreemapValue(v, spec.value_format);

  const areaH = treemapAreaHeight(width);
  // Strip text is the tile labels' size, and the strip's height follows it.
  const size = treemapLabelSize(width);
  const stripH = treemapStripHeight(size);
  // A group keeps its strip only if its block is at least two strips tall and the strip has text.
  const layout = layoutTreemap(data, width, areaH, {
    groupOrder: groupNames,
    stripH,
    stripFits: (g) =>
      g.y1 - g.y0 >= 2 * stripH &&
      fitStripLabel(labelOf(g.group), shareText(g.total), g.x1 - g.x0, size).mode !== "none",
  });

  const groupSize = new Map<string | null, number>();
  for (const t of layout.tiles) groupSize.set(t.datum.group, (groupSize.get(t.datum.group) ?? 0) + 1);
  const numberOf = (v: number): string | null =>
    cfg.labelValue === "share" ? shareText(v) : cfg.labelValue === "value" ? valueText(v) : null;
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
      fill: tileFill(hueOf(d.group), t.rank, groupSize.get(d.group) ?? 1, grouped, cfg.shading),
      label: labels[i]!,
    };
  });
  const strips: BuiltStrip[] = layout.groups.filter((g) => g.strip).map((g) => ({
    group: g, fill: stripFill(hueOf(g.group)),
    label: fitStripLabel(labelOf(g.group), shareText(g.total), g.x1 - g.x0, size),
  }));
  return { width, areaH, size, stripH, layout, tiles, strips, groupNames, colors };
}

/** Total SVG height at `width`, as renderTreemap draws it: the treemap area alone (there is no key),
 *  so it depends on the width only. Takes the spec and rows so callers need not know that. */
export function treemapHeight(_spec: ChartSpec, _rows: TidyRow[], width: number): number {
  return treemapAreaHeight(width);
}

/** Non-fatal warnings at `width` (the export width by default): the data warnings, plus more than half
 *  the tiles unlabelled (the hover card and each tile's aria-label still name them). */
export function treemapWarnings(spec: ChartSpec, rows: TidyRow[], width: number = EXPORT_WIDTH): string[] {
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

  // role="group", not "img": an img's children are presentational, which would hide every tile's
  // own label from assistive technology.
  const svg = el("svg", {
    class: TREEMAP_CLASS, width: b.width, height: b.areaH, viewBox: `0 0 ${b.width} ${b.areaH}`,
    "font-family": TBL.font, role: "group", "aria-label": spec.title,
  });
  // The area is white under the tiles and strips (spec §3), so the gutters are white on any host
  // page, live as in the PNG.
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
    const lab = t.label;
    if (lab.mode !== "none") {
      // Top-left in the tile's inner box: left-aligned at the left padding, lines stacked down from
      // the top padding, each baseline centring the cap height in its line box.
      const left = r2(t.x0 + TM_GEOM.pad);
      const top = t.y0 + TM_GEOM.pad;
      const baseline = (lineTop: number, size: number): number => r2(lineTop + (size * LINE_HEIGHT) / 2 + CAP_CENTRE * size);
      const text = el("text", {
        class: "tbl-treemap-label", "text-anchor": "start", fill: contrastText(t.fill), "aria-hidden": "true",
      });
      if (lab.mode === "stacked") {
        let lineTop = top;
        for (const line of lab.nameLines) {
          text.append(span(line, { x: left, y: baseline(lineTop, lab.size), "font-size": lab.size, "font-weight": 700 }));
          lineTop += lab.size * LINE_HEIGHT;
        }
        if (lab.number !== null) {
          text.append(span(lab.number, { x: left, y: baseline(lineTop, lab.size), "font-size": lab.size, "font-weight": 500 }));
        }
      } else {
        // Inline: drawn exactly as fitTileLabel measured it, the name at 700 then " number" at 500.
        text.setAttribute("x", String(left));
        text.setAttribute("y", String(baseline(top, lab.size)));
        text.setAttribute("font-size", String(lab.size));
        text.append(span(lab.name, { "font-weight": 700 }));
        text.append(span(` ${lab.number}`, { "font-weight": 500 }));
      }
      g.append(text);
    }
    svg.append(g);
  }

  for (const s of b.strips) {
    const g = s.group;
    svg.append(el("rect", {
      class: "tbl-treemap-strip", x: g.x0, y: g.y0, width: r2(g.x1 - g.x0), height: b.stripH, fill: s.fill,
      "data-series": g.group,
    }));
    if (s.label.mode === "none") continue;
    const text = el("text", {
      class: "tbl-treemap-strip-label", x: r2(g.x0 + TM_GEOM.stripPad),
      y: r2(g.y0 + b.stripH / 2 + CAP_CENTRE * b.size), "font-size": b.size,
      fill: contrastText(s.fill), "aria-hidden": "true",
    });
    text.append(span(s.label.name, { "font-weight": 700 }));
    if (s.label.mode === "full") text.append(span(` ${s.label.share}`, { "font-weight": 500 }));
    svg.append(text);
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
    svg, legendItems: null, seriesKeyRows: [], seriesLabels: spec.series_labels ?? {}, seriesOrder: b.groupNames,
    dashedNames: new Set(), colors: b.colors, valueAffixes: { prefix: "", suffix: "" }, xAxisTitle: null,
    dataInScope: [], overlayTooltips: [], treemapTiles,
  };
}
