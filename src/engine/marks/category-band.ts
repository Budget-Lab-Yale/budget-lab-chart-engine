// The horizontal category band shared by the one-bar-per-row builders: bar.ts (single-series and
// grouped) and stacked.ts. `columns.section` groups the rows into sections; every section after the
// first is set off by a fixed section gap (axes.ts sectionGapPx) that holds its bold header, and the
// first section's header sits in the top margin. Sectioned charts put the band on `fy` row facets (a mark
// with fy-bound header marks but a plain `y` band makes Plot facet the whole plot from the headers
// alone — the fig09/fig10 phantom-facet defect), so both builders compose the band here and cannot
// drift apart.
import { ownValue } from "../../spec/own-key";
import type { ChartSpec } from "../../spec/types";
import {
  tblFacetGroupYAxis,
  tblSectionTopHeader,
  sectionGapPx,
  sectionHeaderLift,
  horizontalValueAxisMargins,
  horizontalLeftGutter,
  SECTION_LABEL_INDENT,
  FACETED_CAT_LABEL_PX,
} from "../axes";
import { TBL_MARGIN_TOP } from "../theme";
import type { MarkLayers, PreparedRow } from "./index";

// Outer padding fraction for the horizontal category band, with `align: 0` so the (small) outer
// pad goes to the BOTTOM only — the first bar then sits flush at marginTop (no empty band above it).
export const HBAND_PADDING_OUTER = 0.02;
/** Inner padding fraction between the rows of that band. */
export const HBAND_PADDING_INNER = 0.2;
/** Band padding (inner and outer) of an unsectioned horizontal stack's category band. */
export const HSTACK_BAND_PADDING = 0.2;
/** Band padding (inner and outer) of an unsectioned horizontal dumbbell's category band. */
export const HDUMBBELL_BAND_PADDING = 0.4;
/** Bottom margin of an unsectioned horizontal dumbbell: one value-tick row. */
export const HDUMBBELL_MARGIN_BOTTOM = 22;

/** The vertical geometry of a horizontal bar, stack or dumbbell's row band as its builder draws it
 *  (bar.ts, stacked.ts, dumbbell.ts, and fyCategoryBandLayer below), for the height model
 *  (figure.ts). `margins` is the top plus bottom margin; `inner` and `outer` the band's padding
 *  fractions. Over n rows drawn in rowsPx, Plot's band step is rowsPx / max(1, n − inner + 2·outer),
 *  rounded down to whole px when that wastes at most 30px in all (its autoScaleRound). */
export function rowBandGeometry(
  chartType: ChartSpec["chartType"],
  xAxisTicks: ChartSpec["x_axis_ticks"],
  sectioned: boolean,
): { margins: number; inner: number; outer: number } {
  const rows = { inner: HBAND_PADDING_INNER, outer: HBAND_PADDING_OUTER };
  if (sectioned) {
    // Every sectioned chart puts its rows on fy, with the first section's header in the top margin.
    const m = horizontalValueAxisMargins(chartType === "dumbbell" ? undefined : xAxisTicks, {
      sectioned: true,
      topHeaderLift: sectionHeaderLift(FACETED_CAT_LABEL_PX),
    });
    return { margins: m.marginTop + m.marginBottom, ...rows };
  }
  if (chartType === "dumbbell") {
    return { margins: TBL_MARGIN_TOP + HDUMBBELL_MARGIN_BOTTOM, inner: HDUMBBELL_BAND_PADDING, outer: HDUMBBELL_BAND_PADDING };
  }
  const m = horizontalValueAxisMargins(xAxisTicks);
  return {
    margins: m.marginTop + m.marginBottom,
    ...(chartType === "stacked" ? { inner: HSTACK_BAND_PADDING, outer: HSTACK_BAND_PADDING } : rows),
  };
}

type Header = { category: string; label: string };

export interface CategoryBand {
  /** Whether `columns.section` applies: horizontal, and some row carries a section. */
  sectioned: boolean;
  /** The categories in data-encounter order. */
  categories: string[];
  /** The band domain: the categories, section-grouped when sectioned. */
  bandDomain: string[];
  /** The categories in drawn order (== bandDomain). With fy faceting Plot emits marks facet by facet
   *  in this order, so DOM-order tagging must follow it, not encounter order. */
  drawnOrder: string[];
  sectionHeaders: Header[];
  topSectionHeader: Header | null;
}

/** Group `categories` (encounter order) into sections. Section order: `section_order` (filter +
 *  order), else encounter order; within a section, encounter order. A category belongs to the
 *  section of its first row. Unsectioned: the band is just `categories`. */
export function categoryBand(
  data: PreparedRow[],
  catField: string,
  categories: string[],
  spec: ChartSpec,
  horizontal: boolean,
): CategoryBand {
  const sectioned = horizontal && data.some((r) => r._section != null);
  if (!sectioned) {
    return { sectioned, categories, bandDomain: categories, drawnOrder: categories, sectionHeaders: [], topSectionHeader: null };
  }
  const sectionOf = new Map<string, string>();
  for (const r of data) {
    const cat = (r as unknown as Record<string, unknown>)[catField] as string | undefined;
    if (cat && r._section != null && !sectionOf.has(cat)) sectionOf.set(cat, r._section);
  }
  const encountered: string[] = [];
  const seenSec = new Set<string>();
  for (const cat of categories) {
    const s = sectionOf.get(cat) ?? "";
    if (!seenSec.has(s)) {
      seenSec.add(s);
      encountered.push(s);
    }
  }
  const order =
    spec.section_order && spec.section_order.length
      ? spec.section_order.filter((s) => seenSec.has(s))
      : encountered;
  const labelOf = (s: string): string => ownValue(spec.section_labels, s) ?? s;
  const domain: string[] = [];
  const sectionHeaders: Header[] = [];
  let topSectionHeader: Header | null = null;
  for (const s of order) {
    const catsInSection = categories.filter((cat) => (sectionOf.get(cat) ?? "") === s);
    if (!catsInSection.length) continue;
    if (!topSectionHeader) {
      topSectionHeader = { category: catsInSection[0] as string, label: labelOf(s) };
    } else {
      sectionHeaders.push({ category: catsInSection[0] as string, label: labelOf(s) });
    }
    for (const cat of catsInSection) domain.push(cat);
  }
  return {
    sectioned,
    categories,
    bandDomain: domain,
    drawnOrder: domain,
    sectionHeaders,
    topSectionHeader,
  };
}

/** The left gutter for a horizontal category band, unless the caller (a small-multiples figure)
 *  passes its shared one: wide enough for the longest label, plus the section indent when sectioned. */
export function bandGutter(categories: string[], catFont: number, sectioned: boolean, shared?: number): number {
  return shared ?? horizontalLeftGutter(categories, { fontSize: catFont, indent: sectioned ? SECTION_LABEL_INDENT : 0 });
}

/** The fy layer pieces for a category band on `fy` row facets: the band scale, the left-gutter
 *  category labels + section headers, the section gaps, and the margins. For an unsectioned band the
 *  header marks and gaps contribute nothing. */
export function fyCategoryBandLayer(
  band: CategoryBand,
  opts: { gutter: number; catFont: number; hideLabels: boolean; xAxisTicks: ChartSpec["x_axis_ticks"] },
): Pick<MarkLayers, "fyScaleOpts" | "xAxisMarks" | "marginLeft" | "marginTop" | "marginBottom" | "sectionGaps"> {
  const { gutter, catFont, hideLabels } = opts;
  const lift = sectionHeaderLift(catFont);
  return {
    // Declaration order; never auto-sort (Style-Guide §9). No axis: labelled by the marks below.
    fyScaleOpts: { domain: band.bandDomain, paddingInner: HBAND_PADDING_INNER, paddingOuter: HBAND_PADDING_OUTER, align: 0, axis: null },
    xAxisMarks: hideLabels
      ? []
      : [
          ...tblFacetGroupYAxis(band.categories, gutter, catFont, band.sectioned ? SECTION_LABEL_INDENT : 0),
          ...band.sectionHeaders.flatMap((h) => tblSectionTopHeader(h, gutter, lift, catFont)),
          ...(band.topSectionHeader ? tblSectionTopHeader(band.topSectionHeader, gutter, lift, catFont) : []),
        ],
    marginLeft: gutter,
    ...(band.sectionHeaders.length
      ? { sectionGaps: { before: band.sectionHeaders.map((h) => h.category), px: sectionGapPx(catFont) } }
      : {}),
    ...horizontalValueAxisMargins(opts.xAxisTicks, {
      sectioned: band.sectioned,
      ...(band.topSectionHeader ? { topHeaderLift: lift } : {}),
    }),
  };
}
