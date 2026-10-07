// The horizontal category band shared by the one-bar-per-row builders: bar.ts (single-series and
// grouped) and stacked.ts. `columns.section` groups the rows into sections; every section after the
// first is preceded by SECTION_SPACER_SLOTS empty band slots that hold its bold header, and the first
// section's header sits in the top margin. Sectioned charts put the band on `fy` row facets (a mark
// with fy-bound header marks but a plain `y` band makes Plot facet the whole plot from the headers
// alone — the fig09/fig10 phantom-facet defect), so both builders compose the band here and cannot
// drift apart.
import { ownValue } from "../../spec/own-key";
import type { ChartSpec } from "../../spec/types";
import {
  tblFacetGroupYAxis,
  tblSectionTopHeader,
  sectionSpacerSlot,
  SECTION_SPACER_SLOTS,
  SECTION_HEADER_GAP,
  isSectionSpacer,
  horizontalValueAxisMargins,
} from "../axes";
import type { MarkLayers, PreparedRow } from "./index";

// Outer padding fraction for the horizontal category band, with `align: 0` so the (small) outer
// pad goes to the BOTTOM only — the first bar then sits flush at marginTop (no empty band above it).
export const HBAND_PADDING_OUTER = 0.02;

type Header = { category: string; label: string };

export interface CategoryBand {
  /** Whether `columns.section` applies: horizontal, and some row carries a section. */
  sectioned: boolean;
  /** The categories in data-encounter order. */
  categories: string[];
  /** The band domain: the categories, section-grouped with spacer slots when sectioned. */
  bandDomain: string[];
  /** The categories in drawn order (bandDomain without the spacers). With fy faceting Plot emits
   *  marks facet by facet in this order, so DOM-order tagging must follow it, not encounter order. */
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
      for (let i = 0; i < SECTION_SPACER_SLOTS; i++) domain.push(sectionSpacerSlot(s, i));
      sectionHeaders.push({ category: catsInSection[0] as string, label: labelOf(s) });
    }
    for (const cat of catsInSection) domain.push(cat);
  }
  return {
    sectioned,
    categories,
    bandDomain: domain,
    drawnOrder: domain.filter((c) => !isSectionSpacer(c)),
    sectionHeaders,
    topSectionHeader,
  };
}

/** The first section header is faceted on its first category (facet top = first bar, align:0) and
 *  lifted so its baseline lands the same ~15px above the bar as the spacer-based headers: the
 *  top-anchored baseline sits ~one font-size below the facet top, and the bottom-anchored spacers
 *  sit ~5px higher. */
export const topHeaderLift = (catFont: number): number => SECTION_HEADER_GAP + catFont + 5;

/** The fy layer pieces for a category band on `fy` row facets: the band scale, the left-gutter
 *  category labels + section headers, and the margins. For an unsectioned band the header marks
 *  contribute nothing. */
export function fyCategoryBandLayer(
  band: CategoryBand,
  opts: { gutter: number; catFont: number; hideLabels: boolean; xAxisTicks: ChartSpec["x_axis_ticks"] },
): Pick<MarkLayers, "fyScaleOpts" | "xAxisMarks" | "marginLeft" | "marginTop" | "marginBottom"> {
  const { gutter, catFont, hideLabels } = opts;
  const lift = topHeaderLift(catFont);
  return {
    // Declaration order; never auto-sort (Style-Guide §9). No axis: labelled by the marks below.
    fyScaleOpts: { domain: band.bandDomain, paddingInner: 0.2, paddingOuter: HBAND_PADDING_OUTER, align: 0, axis: null },
    xAxisMarks: hideLabels
      ? []
      : [
          ...tblFacetGroupYAxis(band.categories, gutter, catFont),
          ...band.sectionHeaders.flatMap((h) => tblSectionTopHeader(h, gutter, lift, catFont)),
          ...(band.topSectionHeader ? tblSectionTopHeader(band.topSectionHeader, gutter, lift, catFont) : []),
        ],
    marginLeft: gutter,
    ...horizontalValueAxisMargins(opts.xAxisTicks, {
      sectioned: band.sectioned,
      ...(band.topSectionHeader ? { topHeaderLift: lift } : {}),
    }),
  };
}
