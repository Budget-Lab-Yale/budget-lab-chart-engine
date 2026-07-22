// Dumbbell (connected dot plot) mark builder. Each category gets one dot per series joined by a
// connector "stem", so the GAP between series is the visual subject — for values that don't sum
// (e.g. current-law vs. static vs. collected effective rates), which a bar/stacked bar can't show.
//
// Structurally this is "point dots + one connector rule per category": it reuses the categorical
// band topology from bar.ts (orientation switch, horizontal left-gutter) and the dot rendering +
// per-series tagging idiom from point.ts. The generic chrome (value gridlines/axis, category
// labels for the vertical path) is added by assemblePlot; horizontal supplies its own y band +
// left-gutter category labels (signaled by yScaleOpts, exactly like horizontal bars).
import { Plot } from "../vendor";
import { TBL } from "../theme";
import { resolveColor } from "../palette";
import {
  tblBandYAxis,
  horizontalLeftGutter,
  FACETED_CAT_LABEL_PX,
  CAT_LABEL_CLASS,
  sectionSpacerSlot,
  SECTION_SPACER_SLOTS,
} from "../axes";
import { SHARED_LABELLESS_MARGIN_LEFT } from "../theme";
import { tokens } from "../../theme/tokens";
import type { ChartSpec, ValueFormat } from "../../spec/types";
import type { MarkContext, MarkLayers, PreparedRow } from "./index";

const PAGE_BG = tokens.structural.background; // hollow-dot center (stem shows through the ring)
const INK = tokens.structural.text_heading; // filled "ink"/neutral dot
const DEFAULT_CONNECTOR = TBL.color.annotationDim; // subtle stem behind the dots
const DEFAULT_DOT_R = 5;
const DOT_KEYLINE = "#ffffff"; // thin white keyline on filled/ink dots (matches point.ts)
// classNames so a post-render pass / test can find the connector and gap-label marks precisely
// (the connector is a rule like a gridline; the gap label is text like the axis ticks).
const CONNECTOR_CLASS = "tbl-dumbbell-connector";
const GAP_LABEL_CLASS = "tbl-dumbbell-gap";
const SECTION_HEADER_CLASS = "tbl-dumbbell-section";

type MarkerStyle = "filled" | "hollow" | "ink";

/** `{value}`-style number formatter for gap labels (pure — no locale, so goldens stay byte-stable). */
function fmtValue(v: number, f: ValueFormat | undefined): string {
  const decimals = f?.decimals ?? 1;
  return `${f?.prefix ?? ""}${v.toFixed(decimals)}${f?.suffix ?? ""}`;
}

export function buildDumbbellMarks(
  data: PreparedRow[],
  spec: ChartSpec,
  ctx: MarkContext,
): MarkLayers {
  const { xField, colors, fxField, fyField } = ctx;
  const catField = xField; // "_xc" for the categorical axis
  const seriesNames = ctx.seriesNames ?? [];
  // Orientation defaults to horizontal (categories on screen-y) — long income-group labels read
  // best down the left gutter.
  const horizontal = spec.orientation !== "vertical";
  const catFont = horizontal ? FACETED_CAT_LABEL_PX : TBL.size.axis;
  const r = spec.dot_radius ?? DEFAULT_DOT_R;
  // Shared-mode small multiples: bind fx/fy so marks face into the grid (Plot allows a category
  // band AND a facet grid at once — the point.ts idiom, simpler than bar.ts's fy-category topology).
  const facetChannels = fxField && fyField ? { fx: fxField, fy: fyField } : {};

  // Category (band) domain in data-encounter order — declaration/`category_order` is authoritative
  // (the pane already sorted dataInScope by category order upstream).
  const categories: string[] = [];
  {
    const seen = new Set<string>();
    for (const row of data) {
      const c = (row as unknown as Record<string, unknown>)[catField] as string | undefined;
      if (typeof c === "string" && c !== "" && !seen.has(c)) {
        seen.add(c);
        categories.push(c);
      }
    }
  }

  // --- Sections (horizontal only): group categories into labeled blocks along the band, with a
  // block of empty spacer slots reserving header room before each non-first section (mirrors the
  // horizontal-bar section layout, but on a plain y band rather than fy facets). ---
  const sectioned = horizontal && data.some((r) => r._section != null);
  let bandDomain: string[] = categories;
  const sectionHeaders: { anchor: string; label: string; lift: boolean }[] = [];
  if (sectioned) {
    const sectionOf = new Map<string, string>();
    for (const row of data) {
      const cat = (row as unknown as Record<string, unknown>)[catField] as string | undefined;
      if (cat && row._section != null && !sectionOf.has(cat)) sectionOf.set(cat, row._section);
    }
    const seenSec = new Set<string>();
    const encountered: string[] = [];
    for (const cat of categories) {
      const s = sectionOf.get(cat) ?? "";
      if (!seenSec.has(s)) { seenSec.add(s); encountered.push(s); }
    }
    const order = spec.section_order?.length ? spec.section_order.filter((s) => seenSec.has(s)) : encountered;
    const labels = spec.section_labels ?? {};
    const domain: string[] = [];
    for (const s of order) {
      const cats = categories.filter((cat) => (sectionOf.get(cat) ?? "") === s);
      if (!cats.length) continue;
      const first = domain.length === 0;
      if (!first) {
        for (let i = 0; i < SECTION_SPACER_SLOTS; i++) domain.push(sectionSpacerSlot(s, i));
        // Non-first: header sits in the reserved spacer band (centered, no lift).
        sectionHeaders.push({ anchor: sectionSpacerSlot(s, 0), label: labels[s] ?? s, lift: false });
      } else {
        // First section: header lifts above the first row into the (reserved) top margin.
        sectionHeaders.push({ anchor: cats[0] as string, label: labels[s] ?? s, lift: true });
      }
      for (const cat of cats) domain.push(cat);
    }
    bandDomain = domain;
  }

  // --- Marker styling (filled / hollow / ink), per series ---
  const markerOf = (s: string): MarkerStyle => spec.series_marker?.[s] ?? "filled";
  const seriesColor = (s: string): string => colors.get(s) || TBL.color.blue;
  const fillFor = (s: string): string => {
    const m = markerOf(s);
    return m === "hollow" ? PAGE_BG : m === "ink" ? INK : seriesColor(s);
  };
  const strokeFor = (s: string): string =>
    markerOf(s) === "hollow" ? seriesColor(s) : DOT_KEYLINE;
  const strokeWidthFor = (s: string): number => (markerOf(s) === "hollow" ? 1.5 : 1);

  // --- Connector stems: per category, span min→max of that category's present dots ---
  // A single dot (or exactly-coincident dots) has no gap to span, so no stem is drawn there.
  const conn = categories
    .map((cat) => {
      const vals = data
        .filter(
          (d) =>
            (d as unknown as Record<string, unknown>)[catField] === cat &&
            Number.isFinite(d._y as number),
        )
        .map((d) => d._y as number);
      return { cat, lo: vals.length ? Math.min(...vals) : 0, hi: vals.length ? Math.max(...vals) : 0, n: vals.length };
    })
    .filter((c) => c.n >= 2 && c.lo !== c.hi);

  const connCfg = spec.connector ?? {};
  const connColor = connCfg.color ? resolveColor(connCfg.color) ?? DEFAULT_CONNECTOR : DEFAULT_CONNECTOR;
  const connWidth = connCfg.width ?? 1.5;
  const connDash =
    connCfg.style === "dashed" ? "5 3" : connCfg.style === "dotted" ? "1 3" : undefined;
  const connOpts = {
    stroke: connColor,
    strokeWidth: connWidth,
    className: CONNECTOR_CLASS,
    ...(connDash ? { strokeDasharray: connDash } : {}),
    ...facetChannels,
  };

  const underlay: unknown[] = [];
  if (conn.length) {
    underlay.push(
      horizontal
        ? Plot.ruleY(conn, { y: "cat", x1: "lo", x2: "hi", ...connOpts })
        : Plot.ruleX(conn, { x: "cat", y1: "lo", y2: "hi", ...connOpts }),
    );
  }

  // --- Dots: one mark, all series; per-datum fill/stroke keyed off each series' marker style. ---
  // Filter to finite values so Plot emits exactly one <circle> per rendered dot (keeps the tagging
  // DOM order aligned with `dotData`).
  const dotData = data.filter((d) => Number.isFinite(d._y as number));
  const dotOpts = {
    ...(horizontal ? { y: catField, x: "_y" } : { x: catField, y: "_y" }),
    fill: (d: PreparedRow) => fillFor(d.series),
    stroke: (d: PreparedRow) => strokeFor(d.series),
    strokeWidth: (d: PreparedRow) => strokeWidthFor(d.series),
    r,
    ...facetChannels,
  };
  const overlay: unknown[] = [Plot.dot(dotData, dotOpts)];

  // --- Optional gap annotation: label |value(a) − value(b)| on each stem. ---
  const gap = spec.gap_annotation;
  if (gap) {
    const seriesA = gap === true ? seriesNames[0] : gap.series_a;
    const seriesB = gap === true ? seriesNames[1] : gap.series_b;
    const gapFmt = (gap === true ? undefined : gap.format) ?? spec.value_format;
    if (seriesA && seriesB) {
      const valueAt = (cat: string, s: string): number | undefined => {
        const row = data.find(
          (d) => (d as unknown as Record<string, unknown>)[catField] === cat && d.series === s,
        );
        return Number.isFinite(row?._y as number) ? (row!._y as number) : undefined;
      };
      const gapRows = categories
        .map((cat) => {
          const a = valueAt(cat, seriesA);
          const b = valueAt(cat, seriesB);
          if (a == null || b == null) return null;
          return { cat, at: Math.max(a, b), text: fmtValue(Math.abs(a - b), gapFmt) };
        })
        .filter((g): g is { cat: string; at: number; text: string } => g != null);
      if (gapRows.length) {
        const common = {
          text: (d: { text: string }) => d.text,
          fill: TBL.color.muted,
          fontSize: TBL.size.annotation,
          fontWeight: 600,
          className: GAP_LABEL_CLASS,
          ...facetChannels,
        };
        overlay.push(
          horizontal
            ? Plot.text(gapRows, { ...common, y: "cat", x: "at", textAnchor: "start", dx: r + 6 })
            : Plot.text(gapRows, { ...common, x: "cat", y: "at", textAnchor: "middle", dy: -(r + 6) }),
        );
      }
    }
  }

  // Resolved series → legend swatch color (ink dots read as ink; hollow/filled read as the series
  // color — the hollow ring is rendered by the legend, task 5). Source of truth for the legend.
  const seriesColors = new Map<string, string>();
  for (const s of seriesNames) seriesColors.set(s, markerOf(s) === "ink" ? INK : seriesColor(s));

  // Tag each dot with BOTH its series (legend hover/pin) and its category (so the live hover /
  // coordinated cursor can resolve which category band the pointer is over, from the dots).
  const dotTagging = {
    selector: 'g[aria-label="dot"] circle',
    seriesOrder: dotData.map((d) => d.series),
    categoryOrder: dotData.map((d) => (d as unknown as Record<string, string>)[catField] ?? ""),
  };

  if (horizontal) {
    // Category band on `y`; value on `x` (assemblePlot moves the value domain to x when yScaleOpts
    // is present). Left gutter sized to the longest category label (shared/suppressed in faceted panes).
    const gutter = ctx.hideCategoryLabels
      ? SHARED_LABELLESS_MARGIN_LEFT
      : ctx.categoryGutter ?? horizontalLeftGutter(categories, { fontSize: catFont });
    // Bold section headers: anchored to their band slot (spacer for non-first sections; the first
    // section's header lifts above its first row into the reserved top margin).
    const headerLift = catFont + 8;
    const sectionMarks = sectioned && !ctx.hideCategoryLabels
      ? sectionHeaders.map((h) =>
          Plot.text([h], {
            y: () => h.anchor,
            text: () => h.label,
            frameAnchor: "left",
            dx: -gutter,
            dy: h.lift ? -headerLift : 0,
            textAnchor: "start",
            fill: TBL.color.heading,
            fontSize: catFont,
            fontWeight: 700,
            className: SECTION_HEADER_CLASS,
          }),
        )
      : [];
    return {
      underlay,
      overlay,
      tagging: [
        dotTagging,
        ...(ctx.hideCategoryLabels
          ? []
          : [{ selector: `g.${CAT_LABEL_CLASS} text`, seriesOrder: [] as string[], categoryOrder: categories }]),
      ],
      dashedNames: new Set<string>(),
      yScaleOpts: { type: "band", domain: bandDomain, padding: 0.4, axis: null },
      xAxisMarks: ctx.hideCategoryLabels ? [] : [...tblBandYAxis(categories, gutter, catFont), ...sectionMarks],
      marginLeft: gutter,
      ...(sectioned ? { marginTop: headerLift + 12 } : {}),
      seriesColors,
    };
  }

  return {
    underlay,
    overlay,
    tagging: [
      dotTagging,
      { selector: `g.${CAT_LABEL_CLASS} text`, seriesOrder: [], categoryOrder: categories },
    ],
    dashedNames: new Set<string>(),
    // Category band on `x`; adapter labels the categories (xAxisMarks left undefined). Slightly
    // larger outer pad so end dots don't kiss the frame.
    xScaleOpts: { paddingInner: 0.2, paddingOuter: 0.3 },
    seriesColors,
  };
}
