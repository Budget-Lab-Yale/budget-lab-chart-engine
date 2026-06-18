// Bar chart mark builder. Produces single-series and grouped (multi-series) bars,
// vertical (default) or horizontal single-series, with in-bar value labels and optional
// highlight/dim. The generic chrome (gridlines, y-labels, zero baseline) is added by
// assemblePlot.
//
// Category-label homing (see task A6 sec A/B): single-series VERTICAL bars put categories
// on the `x` band scale, so the adapter's `tblBandXAxis(.., "x")` labels them and this
// builder leaves `xAxisMarks` undefined. Grouped bars use Plot's faceting idiom (`fx` =
// group, `x` = series within group), so categories live on `fx`; this builder supplies its
// own `xAxisMarks` (group labels on `fx`) which assemblePlot uses INSTEAD of the adapter's.
// Horizontal single-series puts categories on a band `y` (the value axis moves to `x`).
import { Plot } from "../vendor";
import { TBL } from "../theme";
import { tblBandXAxis, tblBandYAxis } from "../axes";
import type { ChartSpec } from "../../spec/types";
import type { MarkContext, MarkLayers, PreparedRow } from "./index";

// Px width below which value labels can't fit cleanly on a bar - drop them entirely
// (Style-Guide bar-grouped sec 6 suppression rule, slide half-scale 25px threshold).
const VALUE_LABEL_MIN_PX = 25;
// Below this, bars are so dense the chart is out of spec for grouped bars; warn (no throw).
const TOO_DENSE_PX = 10;

/** A pure value-label formatter (no toLocaleString/locale, so goldens stay byte-stable).
 *  Uses the minimum decimal precision needed across the rendered values, like
 *  makeTickFormatter. `signed` prepends an explicit + / U+2212 (matching Style-Guide). */
function makeValueFormatter(
  values: number[],
  units: string,
  signed: boolean,
): (d: number) => string {
  const maxFrac = values.reduce((max, v) => {
    if (!Number.isFinite(v)) return max;
    const s = String(v);
    const i = s.indexOf(".");
    return Math.max(max, i < 0 ? 0 : s.length - i - 1);
  }, 0);
  return (d: number) => {
    if (!Number.isFinite(d)) return "";
    const mag = Math.abs(d).toFixed(maxFrac);
    const body = units ? `${mag}${units}` : mag;
    if (!signed) return body;
    return d < 0 ? `−${body}` : `+${body}`;
  };
}

export function buildBarMarks(
  data: PreparedRow[],
  spec: ChartSpec,
  ctx: MarkContext,
): MarkLayers {
  const { xField, colors } = ctx;
  const seriesNames = ctx.seriesNames ?? [];
  const horizontal = spec.orientation === "horizontal";
  const isMulti = seriesNames.length > 1;

  // Category (group) domain in data-encounter order - declaration order is authoritative.
  const categories: string[] = [];
  {
    const seen = new Set<string>();
    for (const r of data) {
      const cat = r._xc;
      if (typeof cat === "string" && cat !== "" && !seen.has(cat)) {
        seen.add(cat);
        categories.push(cat);
      }
    }
  }

  // Units suffix for value labels (matches the y-tick units inference upstream).
  const units = inferUnits(spec.subtitle);
  const showValueLabels = spec.valueLabels?.show !== false;
  const signed = spec.valueLabels?.signed === true;

  // Highlight/dim: literal fill accessor (not the color scale) so non-highlighted series
  // collapse to annotationDim regardless of their palette slot. Used sparingly per spec.
  const highlightSet =
    spec.highlightSeries && spec.highlightSeries.length
      ? new Set(spec.highlightSeries)
      : null;
  const fillFor = (series: string): string => {
    if (highlightSet) {
      return highlightSet.has(series)
        ? colors.get(series) || TBL.color.blue
        : TBL.color.annotationDim;
    }
    return colors.get(series) || TBL.color.blue;
  };

  // --- Value-label suppression math (Style-Guide sec 6) ---
  // Estimate per-bar px width from the available band axis length and the bar count.
  // Vertical: bars live along plotWidth; horizontal: along plotHeight.
  const nGroups = Math.max(1, categories.length);
  const nSeries = Math.max(1, isMulti ? seriesNames.length : 1);
  const bandAxisPx = (horizontal ? ctx.plotHeight : ctx.plotWidth) ?? 0;
  // Crude: total band axis / total bar slots, times a 0.8 usable-fraction factor to
  // account for inter-/outer-group padding eating into the axis.
  const estBarPx = bandAxisPx > 0 ? (bandAxisPx / (nGroups * nSeries)) * 0.8 : Infinity;
  if (Number.isFinite(estBarPx) && estBarPx < TOO_DENSE_PX) {
    // headless-safe: warn, never throw.
    console.warn(
      `buildBarMarks: estimated bar width ~${estBarPx.toFixed(1)}px is below ${TOO_DENSE_PX}px; ` +
        `chart is too dense for grouped bars (consider a line chart or fewer series).`,
    );
  }
  const emitValueLabels = showValueLabels && estBarPx >= VALUE_LABEL_MIN_PX;

  const allValues = data
    .map((r) => r._y)
    .filter((v): v is number => Number.isFinite(v as number));
  const fmt = makeValueFormatter(allValues, units, signed);

  const overlay: unknown[] = [];

  if (!isMulti) {
    // --- Single-series: categories on a band scale, no faceting. ---
    const fill = highlightSet
      ? (d: PreparedRow) => fillFor(d.series)
      : seriesNames.length === 1
        ? fillFor(seriesNames[0] as string)
        : TBL.color.blue;

    overlay.push(
      horizontal
        ? Plot.barX(data, { y: xField, x: "_y", fill })
        : Plot.barY(data, { x: xField, y: "_y", fill }),
    );

    if (emitValueLabels) {
      overlay.push(...buildValueLabelMarks(data, { band: xField }, fmt, horizontal));
    }

    // Rect tagging: Plot emits one <rect> per category in band-domain order (it does not
    // omit rects for null values - it renders them at zero length), so the order is simply
    // the (single) series name repeated once per category.
    const onlySeries = (seriesNames[0] as string) ?? (data[0]?.series ?? "");
    const seriesOrder: string[] = categories.map(() => onlySeries);

    if (horizontal) {
      // Categories on the band `y`; value on `x` (assemblePlot moves the value domain to
      // `x` when yScaleOpts is present). Supply the y band + its left-edge labels.
      return {
        underlay: [],
        overlay,
        tagging: [{ selector: 'g[aria-label="bar"] rect', seriesOrder }],
        dashedNames: new Set<string>(),
        yScaleOpts: { type: "band", domain: categories, padding: 0.2, axis: null },
        xAxisMarks: tblBandYAxis(categories),
      };
    }

    return {
      underlay: [],
      overlay,
      tagging: [{ selector: 'g[aria-label="bar"] rect', seriesOrder }],
      dashedNames: new Set<string>(),
      // Refine the adapter's band x with a slightly larger outer pad so bars do not kiss
      // the frame. (Adapter set type:band/domain/axis already.)
      xScaleOpts: { paddingInner: 0.2, paddingOuter: 0.2 },
      // xAxisMarks/xScaleField left undefined -> adapter labels categories on `x`.
    };
  }

  // --- Multi-series grouped (vertical): fx = group (category), x = series within group. ---
  // Horizontal grouped (fy faceting + band y + group labels) is not wired through the
  // assemble chrome yet; vertical grouped is the supported multi-series path (A6 scope).
  if (horizontal) {
    throw new Error(
      "buildBarMarks: horizontal orientation is supported for single-series bars only; " +
        "grouped (multi-series) horizontal bars are not yet implemented.",
    );
  }

  // Highlight/dim overrides the fill channel with a literal accessor.
  const fillChannel = highlightSet ? (d: PreparedRow) => fillFor(d.series) : "series";

  overlay.push(Plot.barY(data, { fx: "_xc", x: "series", y: "_y", fill: fillChannel }));

  if (emitValueLabels) {
    overlay.push(
      ...buildValueLabelMarks(data, { band: "series", facet: "_xc" }, fmt, horizontal),
    );
  }

  // --- Rect tagging order ---
  // Empirically (Plot 0.6.16, barY faceted on fx with an explicit inner-series band
  // domain): Plot emits a <rect> for EVERY (group, series) pair of the fx-domain x x-domain
  // cross-product, in facet-major order (fx-domain order, then series in x-domain order
  // within each facet). A missing/null value does NOT omit the rect - Plot renders it at
  // zero height. (This is the OPPOSITE of the brief's hypothesis; see the report.) So the
  // tagging order is the full cross-product - we must NOT skip missing pairs, or every
  // index after the first gap would shift. The fx/x domains are pinned (declaration order /
  // seriesNames), so this order is deterministic and independent of the data rows.
  const rectSeriesOrder: string[] = [];
  for (let g = 0; g < categories.length; g++) {
    for (const s of seriesNames) rectSeriesOrder.push(s);
  }

  // Group band (fx): explicit domain in data-declaration order (Style-Guide sec 9: never
  // auto-sort groups; Plot would otherwise sort the fx domain alphabetically). Inter-group
  // padding, equalized outer pads, no axis (groups are labeled via xAxisMarks). Inner
  // series band: domain in series order, padding 0 so bars touch within the group.
  const groupBandOpts = { domain: categories, padding: 0.2, paddingOuter: 0.2, axis: null };
  const innerBandOpts = { domain: seriesNames, padding: 0, axis: null };

  return {
    underlay: [],
    overlay,
    tagging: [{ selector: 'g[aria-label="bar"] rect', seriesOrder: rectSeriesOrder }],
    dashedNames: new Set<string>(),
    fxScaleOpts: groupBandOpts,
    xScaleOpts: innerBandOpts,
    xScaleField: "fx",
    xAxisMarks: tblBandXAxis(categories, "fx"),
  };
}

/** Centered in-bar value labels. Split into a positive set and a negative set so each can
 *  use a CONSTANT dy/dx offset (above positive bars / below negative; outside the bar end
 *  for horizontal). A constant offset folds cleanly into Plot's group transform - a
 *  per-datum (function) offset leaves a NaN in the group transform and is fragile.
 *
 *  `channels.band` positions the label on the inner band axis (the category field for
 *  single-series, "series" for grouped); `channels.facet` (grouped only) places it in the
 *  right group via Plot's fx/fy faceting. */
function buildValueLabelMarks(
  data: PreparedRow[],
  channels: { band: string; facet?: string },
  fmt: (d: number) => string,
  horizontal: boolean,
): unknown[] {
  const text = (d: PreparedRow) => fmt(d._y as number);
  const common = {
    text,
    fill: TBL.color.heading,
    fontSize: TBL.size.axis,
    fontWeight: 600,
  };
  const pos = data.filter((d) => Number.isFinite(d._y as number) && (d._y as number) >= 0);
  const neg = data.filter((d) => Number.isFinite(d._y as number) && (d._y as number) < 0);
  const marks: unknown[] = [];

  if (horizontal) {
    const base = (rows: PreparedRow[], dx: number, anchor: "start" | "end") =>
      Plot.text(rows, {
        ...common,
        y: channels.band,
        ...(channels.facet ? { fy: channels.facet } : {}),
        x: "_y",
        textAnchor: anchor,
        dx,
      });
    if (pos.length) marks.push(base(pos, 4, "start"));
    if (neg.length) marks.push(base(neg, -4, "end"));
    return marks;
  }

  const base = (rows: PreparedRow[], dy: number) =>
    Plot.text(rows, {
      ...common,
      x: channels.band,
      ...(channels.facet ? { fx: channels.facet } : {}),
      y: "_y",
      dy,
    });
  if (pos.length) marks.push(base(pos, -4));
  if (neg.length) marks.push(base(neg, 12));
  return marks;
}

/** Mirror engine/index.ts inferUnitsFromSubtitle (not exported there). */
function inferUnits(subtitle?: string): string {
  if (!subtitle) return "";
  const lower = subtitle.toLowerCase();
  if (lower.includes("percent") || lower.includes("percentage point")) return "%";
  return "";
}
