// Legend rows for things that are not series: shaded bands, reference lines, and `shading` fills.
//
// The engine's legend was series-only, so a chart whose subject is annotations (recession bands, a
// rule threshold, false-positive fills) had to name each of them INSIDE the plot frame — which on a
// busy chart reads as clutter — or mint dummy CSV series purely to get legend rows. Opting an entry
// in with `legend: true` moves its existing `label` out of the frame and into the legend instead.
//
// PURE — spec + resolved series colors in, LegendItem rows out. No DOM, no data: everything keyed
// here is declared in the spec, so renderChart and renderFigure both get the same rows.
import { TBL } from "./theme";
import { resolveColor, resolveColorOr } from "./palette";
import { resolveAnnotations, xMarkerLabel, yMarkerLabel } from "../spec/annotations";
import { resolveRugTracks } from "../spec/rug";
import type { LegendItem } from "./index";
import type { ChartSpec, ShadeRegion, XAxisBand, XAxisMarker, YAxisMarker } from "../spec/types";

/**
 * The selection key shared by a legend row and every chart element it names — the annotation
 * analogue of a series key. Keyed on the LABEL, not on the entry's index, precisely because one row
 * stands for many elements: the three recession bands, their three rug blocks, and a fill that
 * shares the label all resolve to this one key, so hovering the row lights up all of them at once.
 *
 * The `__annotation:` prefix keeps the namespace disjoint from series keys (a CSV series could
 * legitimately be called "US recessions") and carries it into the DOM as `data-annotation`.
 */
export function annotationKey(label: string): string {
  return `__annotation:${label}`;
}

/** Default fill opacity of an `annotations.bands` rect (assemble-plot.ts) — mirrored here so the
 *  swatch tint matches what the band actually paints. */
const BAND_FILL_OPACITY = 0.1;
/** Default `shading` fill opacity (marks/line.ts SHADE_FILL_OPACITY). */
const SHADE_FILL_OPACITY = 0.5;

/** Does this entry want a legend row? `rug: true` implies one (a solid block with no key is
 *  unreadable); `legend: false` always suppresses; a row needs something to say. */
function wantsRow(entry: { label?: string; legend?: boolean; rug?: boolean }): boolean {
  if (!entry.label) return false;
  if (entry.legend === false) return false;
  return entry.legend === true || entry.rug === true;
}

/** True when this band / marker's label has moved to the legend, so assemble-plot must NOT also
 *  draw it inside the frame (nor reserve an auto-stagger row for it). */
export function labelMovedToLegend(
  spec: ChartSpec,
  entry: { label?: string; legend?: boolean; rug?: boolean },
): boolean {
  return spec.legend !== false && wantsRow(entry);
}

/** Flatten `color` at `opacity` over white, so a swatch shows the tint the reader will actually
 *  see on the chart rather than the fill's full-strength hue. Non-hex colors pass through. */
export function flattenOverWhite(color: string, opacity: number): string {
  // A fully opaque fill IS its own color — return it untouched rather than a recomputed (and
  // case-normalized) rebuild of the same value, so a swatch and its mark compare equal as strings.
  if (opacity >= 1) return color;
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const hex = m[1] as string;
  const t = Math.max(opacity, 0);
  const channel = (i: number): number => {
    const v = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return Math.round(255 + (v - 255) * t);
  };
  const out = [0, 1, 2].map((i) => channel(i).toString(16).padStart(2, "0")).join("");
  return `#${out}`;
}

/**
 * The swatch tints for a `shading` region — one per fill it will actually paint, in series order.
 *
 * A region with an explicit `color` paints that one color. Otherwise it takes its SERIES' color, and
 * a region naming no series paints one fill per in-scope series, each in that series' color — so on
 * a three-series chart this returns three tints, and the row is keyed by all three rather than by
 * whichever happened to be first.
 *
 * `solid` (a rug-flagged region) keys by the block's full-strength hue; everything else keys by the
 * tint the fill paints — its hue composited over white at `fillOpacity`.
 */
function shadeSwatchColors(
  region: ShadeRegion,
  seriesNames: string[],
  colors: Map<string, string>,
): string[] {
  const explicit = resolveColor(region.color);
  // A rug-flagged region is keyed by its BLOCK, and the strip can only draw ONE color — so the chip
  // is a single solid swatch resolved exactly as `drawRug` resolves the block (spec/rug.ts
  // `rugTrackColor`). Without this the chip showed the series tints while the block drew the
  // neutral: a key pointing at a color that is nowhere on the strip.
  if (region.rug === true) {
    return [
      explicit ||
        (region.series != null ? colors.get(region.series) : undefined) ||
        TBL.color.annotationDim,
    ];
  }
  const opacity = region.fillOpacity ?? SHADE_FILL_OPACITY;
  const tint = (c: string): string => flattenOverWhite(c, opacity);
  if (explicit) return [tint(explicit)];
  const targets = region.series != null ? [region.series] : seriesNames;
  const out = targets
    .map((s) => colors.get(s))
    .filter((c): c is string => !!c)
    .map(tint);
  return out.length ? out : [tint(TBL.color.blue)];
}

function ruleRow(m: XAxisMarker | YAxisMarker, label: string): LegendItem {
  return {
    series: annotationKey(label),
    label,
    color: resolveColorOr(m.color, TBL.color.annotationDim),
    dashed: (m.style || "dashed") === "dashed",
    markerShape: "line",
    annotation: true,
    isExtra: true,
  };
}

/** `swatchColors` are already resolved by the caller — one per fill this row names (see
 *  `shadeSwatchColors`). `color` stays the first, for consumers that draw a single chip. */
function fillRow(label: string, swatchColors: string[]): LegendItem {
  return {
    series: annotationKey(label),
    label,
    color: swatchColors[0],
    ...(swatchColors.length > 1 ? { colors: swatchColors } : {}),
    dashed: false,
    markerShape: "rect",
    outlined: true,
    annotation: true,
    isExtra: true,
  };
}

/**
 * The annotation-derived legend rows, in order: bands → shading → xAxis rules → yAxis rules →
 * explicit `rug.tracks`. Rows dedupe by (label, swatch shape, color, dashed) — first occurrence
 * wins — so the three recession bands of a michez-rule chart collapse to one "US recessions" row,
 * while two same-label entries drawn differently still get a row each.
 *
 * Rows are interactive in their OWN selection dimension (`annotation: true`, matched through
 * `data-annotation` rather than `data-series`): hovering or pinning one lights up every chart
 * element carrying its key — bands, fills, reference lines, rug blocks — and dims the rest. The
 * separate dimension is what lets a `shading` fill dim with its line AND light up with its
 * annotation row, since an element can only carry one `data-series`.
 */
export function buildAnnotationLegendItems(
  spec: ChartSpec,
  seriesNames: string[],
  colors: Map<string, string>,
  {
    formatValue,
  }: {
    /** How to render a `{value}` token in a keyed reference-line label when the marker declares no
     *  `value_format` — the chart's value-axis tick formatter, so the legend row reads exactly as
     *  the in-frame label would have. Omitted ⇒ a bare number. */
    formatValue?: (v: number) => string;
  } = {},
): LegendItem[] {
  if (spec.legend === false) return [];
  const ann = resolveAnnotations(spec);
  const rows: LegendItem[] = [];

  ann.bands.forEach((b: XAxisBand) => {
    if (!wantsRow(b)) return;
    const color = resolveColorOr(b.color, TBL.color.annotationDim);
    const solid = b.rug === true;
    rows.push(fillRow(b.label as string, [solid ? color : flattenOverWhite(color, BAND_FILL_OPACITY)]));
  });

  (spec.shading ?? []).forEach((s: ShadeRegion) => {
    if (!wantsRow(s)) return;
    rows.push(fillRow(s.label as string, shadeSwatchColors(s, seriesNames, colors)));
  });

  // A `{value}` token resolves through the SAME helpers assemble-plot uses for the in-frame text, so
  // moving a label to the legend can neither print the raw brace token nor format it differently.
  const fallbackFormat = formatValue ?? ((v: number) => String(v));
  ann.xAxis.forEach((m) => {
    if (wantsRow(m)) rows.push(ruleRow(m, xMarkerLabel(m)));
  });
  ann.yAxis.forEach((m) => {
    if (wantsRow(m)) rows.push(ruleRow(m, yMarkerLabel(m, fallbackFormat)));
  });

  // Explicit rug tracks have no band or fill of their own, so nothing above has keyed them.
  resolveRugTracks(spec).forEach((t) => {
    if (t.origin !== "tracks" || !t.legend) return;
    // An explicit track has no fill of its own — its block IS the thing, so it keys solid.
    rows.push(fillRow(t.label, [resolveColorOr(t.color, TBL.color.annotationDim)]));
  });

  // Merge by (label, swatch shape, dashed) — NOT by color, so several same-label entries with
  // different tints (one per series, the other way to write a per-series fill) collapse to ONE row
  // whose chip shows every tint, instead of three identically-worded rows or one that keys two of
  // the three fills wrongly. A rect and a rule sharing a label stay separate rows: one swatch
  // cannot be both.
  const byKey = new Map<string, LegendItem>();
  for (const r of rows) {
    const key = `${r.label} ${r.markerShape} ${r.dashed}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, r);
      continue;
    }
    if (r.markerShape !== "rect") continue; // a multi-tint RULE swatch has no meaning
    const merged = [...(existing.colors ?? [existing.color as string]), ...(r.colors ?? [r.color as string])];
    const distinct = merged.filter((c, i) => c != null && merged.indexOf(c) === i);
    if (distinct.length > 1) existing.colors = distinct;
  }
  return [...byKey.values()];
}
