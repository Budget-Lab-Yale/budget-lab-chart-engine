// Legend and series-key row construction (LegendItem / ShapeLegendItem), shared by renderChart
// (index.ts) and renderFigure (figure.ts). Below index.ts in the module graph, so figure.ts imports
// it directly rather than back through the entry point.
import type { ChartSpec } from "../spec/types";
import { ownValue } from "../spec/own-key";
import type { MarkLayers } from "./marks/index";
import { markerSymbolForSeries } from "./theme";
import { buildAnnotationLegendItems } from "./annotation-legend";
import { type SeriesHatch } from "./hatch";

export interface LegendItem {
  series: string;
  label: string;
  color: string | undefined;
  dashed: boolean;
  /** Swatch style: "line"/"rect"/"dot" for line/bar/stacked; "point" for scatter/dotplot — a
   *  filled colored marker (the `markerSymbol`, default circle); "chip" — a filled rounded-square
   *  color key (point charts' color-only legend, where a point shape would be ambiguous). */
  markerShape: "line" | "rect" | "dot" | "point" | "chip";
  /** Line charts with point markers, or point charts with redundant color+shape encoding: the
   *  d3 symbol name for this series (shown on the swatch so series can be told apart by shape,
   *  not just color). */
  markerSymbol?: string;
  /** Dumbbell "hollow" marker: render the point swatch as a ring (`fill="none"` — a genuine hole,
   *  so the swatch takes the card or the tooltip's blur as its ground — with a series-color stroke)
   *  instead of a solid dot, matching the chart's hollow dots. See `engine/marker-ink.ts`. */
  hollow?: boolean;
  /** A `rect` swatch showing MORE THAN ONE tint, drawn as equal vertical bands in this order.
   *  Set when one keyed concept covers several differently-colored fills — `shading` with no
   *  `series` gives every series its own region in its own color, so a single-color chip would key
   *  the gold and purple fills with the blue one. Absent ⇒ the single `color`. */
  colors?: string[];
  /** Draw a hairline around a `rect` swatch. Set on annotation-derived fill rows, whose tint can be
   *  near-white (an `annotations.bands` fill is 10 % opaque) and would otherwise read as a gap.
   *  Off for series swatches, so bar/stacked legends stay byte-identical. */
  outlined?: boolean;
  /** True for synthetic rows (e.g. Total) that are not interactive series. */
  nonInteractive?: boolean;
  /** True for a row that keys an ANNOTATION (a band, a `shading` fill, a reference line, a rug
   *  track) rather than a series. Interactive, but in its own selection dimension: `series` holds
   *  the annotation key and the chart elements it names carry it as `data-annotation`. Separate
   *  from the series dimension because an element can only carry one `data-series` — a keyed
   *  `shading` fill needs to dim with its line AND light up with its annotation row. */
  annotation?: boolean;
  /** True for appended pseudo-series rows (e.g. the diverging Total) that are interactive
   *  but should sort AFTER the real series in the right-legend column. */
  isExtra?: boolean;
  /** `series_patterns` texture for this series, resolved against the colour actually painted.
   *  Present only for a textured series on a filled chart type — the swatch renders it as CSS
   *  gradients, and the PNG export re-emits it as a real `<pattern>`. Absent ⇒ flat fill,
   *  byte-identical to before the field existed. */
  hatch?: SeriesHatch;
}

/** One row of the SHAPE legend (point charts, dual color/shape encoding): a neutral-colored
 *  marker symbol identifying a shape-channel value. Non-interactive in v1 (the shape legend
 *  does not drive hover-dim / pin). */
export interface ShapeLegendItem {
  /** The raw shape-value key. */
  shape: string;
  label: string;
  /** d3 symbol name (assigned by shape index, matching the chart's symbol scale). */
  markerSymbol: string;
}

/** The key row EVERY series gets, whether or not a legend is drawn.
 *
 *  Split out of `buildLegendItems` because a tooltip needs a key for a series the legend suppressed.
 *  A single, unstyled series draws no legend on any chart type — see `legendShowsSeriesRows`, which
 *  is the exact rule; a lone DASHED line still gets rows, and `legend: false` suppresses them at any
 *  series count — yet every one of those charts still shows tooltips. Those tooltips used to
 *  re-derive a key from loose channels — `swatchShape`, `hatches`, `swatchMarkers`, `dashedSeries` —
 *  a second, partial copy of the table below that drifted from it: a lone dot plot keyed a LINE, and
 *  a lone dumbbell keyed a plain DOT rather than the sized, box-centred symbol its legend row draws.
 *  Deriving both from this one function is what makes the drift impossible: the suppressed row and
 *  the tooltip key are built by the same code from the same inputs. Under `renderChart` they are the
 *  SAME OBJECTS — it builds them once and hands them to `buildLegendItems` — so nothing may mutate a
 *  returned row. `renderFigure` still builds twice, because a pane's rows and the FIGURE legend's are
 *  resolved from different series and colour maps; those two are deep-equal only when they agree.
 *
 *  A row's TEXTURE is not derived here at all: `paintedHatches` is what the marks were painted, and
 *  a row takes that object unchanged. The alternative — resolving the hatch from the colour map, as
 *  this did — agreed with the marks only by coincidence, since `bar_color`/`category_colors`/the
 *  selector accent override a mark's fill without reaching that map and merely happen to be
 *  single-series (so no legend series rows) today.
 *
 *  So this applies NO presence rule — `buildLegendItems` owns "is a legend worth drawing", this owns
 *  "what would this series' key look like". */
export function buildSeriesKeyRows(
  spec: ChartSpec,
  seriesNames: string[],
  colors: Map<string, string>,
  layers: MarkLayers,
  /** Series → the texture the MARKS were painted (`PaneResult.seriesHatches`). REQUIRED, and there
   *  is deliberately no colour-map fallback: a key's ground must be the ground its mark is drawn
   *  over, and the only thing that knows that is the render. See `AssembleResult.seriesHatches`. */
  paintedHatches: Map<string, SeriesHatch>,
  /** Series → the flat colour its FILLED marks were painted (`PaneResult.seriesPainted`). Preferred
   *  over any colour map for the same reason the hatch ground is: `highlightSeries` dims through a
   *  literal per-mark fill, so a dimmed series' chip read its palette colour beside grey bars. Absent
   *  for a series whose marks are not filled, where the colour map is correct.
   *
   *  REQUIRED, like `paintedHatches` and for the same reason: a default would let a new call site
   *  silently fall back to the colour map, which is the bug. */
  paintedColors: Map<string, string>,
  /** Small multiples: the FIGURE's series list, which numbers the per-series markers as the panes'
   *  marks and the figure legend do (theme.ts markerSymbolForSeries). A pane's key rows fill the
   *  hover card for a series the figure legend has no row for, so indexing the pane's own list there
   *  keyed a different marker from the one drawn. Absent (a single chart) → the row's own index. */
  symbolOrder?: readonly string[],
): LegendItem[] {
  const chartType = spec.chartType;
  const labelFor = (name: string): string => ownValue(spec.series_labels, name) ?? name;
  // When the mark layer is the source of truth for series colors (stacked: mono tiers or
  // categorical), use those for the legend swatches so the legend matches the bars.
  const legendColorFor = (name: string): string | undefined =>
    paintedColors.get(name) ?? layers.seriesColors?.get(name) ?? colors.get(name);


  let items: LegendItem[];
  if (chartType === "scatter" || chartType === "dotplot") {
    // Point charts (scatter / dotplot): the COLOR (series) legend. Swatch is a filled colored
    // marker — the per-series symbol when shape encodes the same field (redundant → combined
    // legend), otherwise a plain circle (shape is carried by the separate shape legend).
    //
    // A SEPARATE shape legend exists when shape is its own channel (distinct values, not the
    // series). In that case the color legend must NOT use a point shape (a circle/square here
    // would be ambiguous with the shape legend's symbols) — use a color chip (rounded square)
    // instead. Redundant encoding → the combined legend shows the actual colored marker shape;
    // no shape channel → the actual (circle) marker.
    const distinctShape = !!(layers.shapeNames && layers.shapeNames.length && !layers.shapeIsSeries);
    items = seriesNames.map((name, i) => {
      const base = {
        series: name,
        label: labelFor(name),
        color: legendColorFor(name),
        dashed: false,
      };
      if (layers.shapeIsSeries) {
        return { ...base, markerShape: "point" as const, markerSymbol: markerSymbolForSeries(name, i, symbolOrder) };
      }
      if (distinctShape) {
        return { ...base, markerShape: "chip" as const };
      }
      return { ...base, markerShape: "point" as const, markerSymbol: "circle" };
    });
  } else if (chartType === "dumbbell") {
    // Dumbbell: one dot per series, styled by its marker (filled/ink → solid colored dot; hollow →
    // ring). Colors come from layers.seriesColors (ink resolves to the ink token there).
    items = seriesNames.map((name) => ({
      series: name,
      label: labelFor(name),
      color: legendColorFor(name),
      dashed: false,
      markerShape: "point" as const,
      markerSymbol: "circle",
      ...((ownValue(spec.series_marker, name) ?? "filled") === "hollow" ? { hollow: true } : {}),
    }));
  } else {
    // Every chart type whose marks are FILLED keys with a chip; only stroked marks get a line
    // swatch. An area is a filled region, so a line swatch always misrepresented it — and a 3px line
    // cannot hold a texture, so a hatched area series had no way to show its glyph. Pinned against
    // spec/filled-chart-types.ts by test, since a new filled type that forgot this would lose
    // its texture in the key silently.
    const markerShape: "line" | "rect" =
      chartType === "bar" ||
      chartType === "stacked" ||
      chartType === "histogram" ||
      chartType === "area" ||
      chartType === "waterfall"
        ? "rect"
        : "line";
    // Line charts with point markers: each series carries its marker shape so the legend swatch
    // shows the same symbol as the chart (assigned by series index, matching the symbol scale).
    const withSymbols = markerShape === "line" && spec.points === true;
    items = seriesNames.map((name, i) => ({
      series: name,
      label: labelFor(name),
      color: legendColorFor(name),
      dashed: ownValue(spec.series_styles, name)?.dashed === true,
      markerShape,
      ...(withSymbols ? { markerSymbol: markerSymbolForSeries(name, i, symbolOrder) } : {}),
    }));
  }

  // Attach the PAINTED textures, on EVERY chart-type path so a new chart type cannot forget them.
  // The row carries the very object the mark was drawn from, so its ground cannot be a ground the
  // chart does not paint — and a textured series is keyed by a CHIP whatever its chart type (see
  // icon.ts: an area series' 18×3 line swatch is thinner than the glyph, so left as a line its
  // texture would never appear).
  if (!paintedHatches.size) return items;
  return items.map((item) => {
    const hatch = paintedHatches.get(item.series);
    return hatch ? { ...item, hatch } : item;
  });
}

/** Whether a legend DRAWS one row per series. A lone series has nothing to distinguish, so its row
 *  would be a restatement of the title — except when a dash override makes the style itself the
 *  thing being named. Point/dumbbell charts have no dash channel, so they key on count alone. */
function legendShowsSeriesRows(spec: ChartSpec, seriesNames: string[], layers: MarkLayers): boolean {
  // An explicit opt-out wins over every automatic rule: the author is saying the colour channel
  // does not need naming (the points are identified some other way). Only the SERIES rows go —
  // overlay and annotation rows are appended by the caller regardless, which is what distinguishes
  // this from the top-level `legend: false` that removes the whole box.
  if (spec.series_legend === false) return false;
  if (seriesNames.length > 1) return true;
  const chartType = spec.chartType;
  if (chartType === "scatter" || chartType === "dotplot" || chartType === "dumbbell") return false;
  return layers.dashedNames.size > 0;
}

/** Build the legend rows from a spec + a rendered pane's series order / colors / mark layers.
 *  Shared by renderChart (single frame) and renderFigure (figure-level legend), so both decide
 *  legend presence and ordering identically. Returns null for a single, unstyled series. */
export function buildLegendItems(
  spec: ChartSpec,
  seriesNames: string[],
  colors: Map<string, string>,
  layers: MarkLayers,
  /** The series key rows, already built by the caller (`buildSeriesKeyRows`). Passed rather than
   *  built here so the legend row and the tooltip key are ONE object, and so the only way to get a
   *  row is to have the painted hatches a row needs — there is no second construction site that
   *  could resolve a key's ground from anything but the render. */
  keyRows: LegendItem[],
  /** The pane's value-axis formatter (`PaneResult.formatValue`), used only for a `{value}` token in
   *  a keyed annotation label. Omitted → the token falls back to a bare number. */
  formatValue?: (v: number) => string,
): LegendItem[] | null {
  if (spec.legend === false) return null;
  const baseItems = legendShowsSeriesRows(spec, seriesNames, layers) ? keyRows : null;

  // Append legendExtras (e.g. diverging stacked Total row) after the series rows.
  let legendItems: LegendItem[] | null = baseItems;
  if (layers.legendExtras && layers.legendExtras.length > 0) {
    // The Total pseudo-series is INTERACTIVE: its `series` is the shared TOTAL_SERIES_KEY,
    // matching the net dot/label `data-series`, so the legend row and the chart markers
    // pin/hover/dim as one. `isExtra` keeps it sorted after the real series in the right
    // legend without making it non-interactive.
    const extras: LegendItem[] = layers.legendExtras.map((extra) => ({
      series: extra.series,
      label: extra.label,
      color: undefined,
      dashed: false,
      markerShape: extra.markerShape,
      isExtra: true,
    }));
    // Append the extras (e.g. the diverging "Total" dot row). If there were no series rows
    // (a single-series chart with no style override), the extras alone form the legend, so
    // the Total marker is never silently dropped.
    legendItems = legendItems ? [...legendItems, ...extras] : extras;
  }
  // Annotation-derived rows (bands / shading / reference lines opted in with `legend: true`) come
  // last, on EVERY chart-type path — a suppressed series list leaves `baseItems` null rather than
  // returning, because assemble-plot suppresses a keyed entry's in-frame label by asking the SPEC,
  // not the legend. An early return here would drop the row while the label stayed suppressed, and
  // the name would vanish from the chart entirely. Like the extras above these may be the ONLY
  // rows — a single-series chart whose subject is its annotations gets a legend built from them.
  const annotationRows = buildAnnotationLegendItems(spec, seriesNames, colors, {
    ...(formatValue ? { formatValue } : {}),
  });
  if (annotationRows.length) {
    legendItems = legendItems ? [...legendItems, ...annotationRows] : annotationRows;
  }
  return legendItems;
}

/** Build the SHAPE legend rows for a point chart with DUAL encoding (shape ≠ color). Returns
 *  null when there is no shape channel, or when shape encodes the same field as color (the
 *  redundant case — those symbols are folded into the combined color legend by buildLegendItems).
 *  Symbols are assigned by shape index, matching the chart's symbol scale. */
export function buildShapeLegendItems(
  spec: ChartSpec,
  layers: MarkLayers,
  /** Small multiples: the figure's shape list the panes' symbols index (RenderOptions.paletteShapes).
   *  Absent (a single chart) → the row's own index. */
  symbolOrder?: readonly string[],
): ShapeLegendItem[] | null {
  if (spec.legend === false) return null;
  if (!layers.shapeNames || layers.shapeNames.length === 0 || layers.shapeIsSeries) return null;
  return layers.shapeNames.map((shape, i) => ({
    shape,
    label: ownValue(spec.shape_labels, shape) ?? shape,
    markerSymbol: markerSymbolForSeries(shape, i, symbolOrder),
  }));
}
