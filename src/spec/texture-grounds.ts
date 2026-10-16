// Which authored colours a `series_patterns` texture is laid over, read from the spec AND the data.
//
// A texture's ground is the colour its mark is PAINTED (engine/hatch.ts), after fill precedence:
// `category_colors`, highlight dimming, the title-selector accent and `bar_color` each override the
// series colour on some chart types, and the waterfall paints its steps from `waterfall.colors`
// instead. Which of them reaches a mark depends on the data too: one series in a pane, a category
// that is drawn, a step that falls rather than rises. A colour the engine cannot read renders fine
// wherever no texture is laid over it, so it is rejected only where one is, and only when it is the
// colour actually painted there. Every branch below mirrors a mark builder, named at the branch;
// change them together. This is the only ground check: validateSpec, which has no data, cannot know
// the precedence.
import type { ChartSpec } from "./types";
import type { TidyRow } from "../data/index";
import type { ResolvedColumns } from "./columns";
import { SINGLE_SERIES_KEY } from "./columns";
import { ownValue } from "./own-key";
import { figurePaneValues } from "./panes";
import { facetsDrawAsGroups } from "./facet-groups";
import { hatchGroundError } from "./color-ref";

interface Ground {
  where: string;
  series: string;
  value: unknown;
}

/** Every colour the title-selector accent can take (spec/title.ts `resolveActiveOptionColor`): the
 *  first selector, in key order, whose active option resolves a colour supplies it, an option's
 *  colour being its own `color`, else its `series_colors` entry by label or id. Once a selector
 *  colours every one of its options, no later selector is ever reached, so collection stops there. */
function accentGrounds(spec: ChartSpec): Array<{ where: string; value: string }> {
  const out: Array<{ where: string; value: string }> = [];
  for (const [key, selector] of Object.entries(spec.title_selectors ?? {})) {
    let everyOptionColoured = (selector.options ?? []).length > 0;
    (selector.options ?? []).forEach((o, i) => {
      const name = o.label ?? o.id;
      const color = o.color ?? ownValue(spec.series_colors, name);
      if (!color) {
        everyOptionColoured = false;
        return;
      }
      const where = o.color != null ? `title_selectors.${key}.options[${i}].color` : `series_colors[${JSON.stringify(name)}]`;
      out.push({ where, value: color });
    });
    if (everyOptionColoured) break;
  }
  return out;
}

/** The rows each drawn pane holds: one pane for a single chart, one per rendered facet value for
 *  small multiples. A horizontal chart's facets draw as sections of one chart (spec/facet-groups.ts),
 *  and `section_order` — or `pane_order`, standing in for it there — drops the sections it omits. */
function paneRows(spec: ChartSpec, rows: TidyRow[], cols: ResolvedColumns): TidyRow[][] {
  const facet = cols.facet;
  const groups = facetsDrawAsGroups(spec);
  const sectionField = groups ? facet : cols.section;
  const sectionOrder = groups ? spec.small_multiples?.pane_order : spec.section_order;
  const drawn = sectionField && sectionOrder?.length
    ? rows.filter((r) => sectionOrder.includes((r[sectionField] as string) ?? ""))
    : rows;
  if (!spec.small_multiples || !facet || groups) return [drawn];
  return figurePaneValues(spec, drawn, facet).map((v) => drawn.filter((r) => r[facet] === v));
}

const seriesOf = (r: TidyRow, cols: ResolvedColumns): string =>
  cols.series ? ((r[cols.series] as string) ?? "") : SINGLE_SERIES_KEY;

/** A pane's series, as the engine scopes them (engine/pane.ts `scopeToSeries`). */
function paneSeries(spec: ChartSpec, rows: TidyRow[], cols: ResolvedColumns): string[] {
  const present = [...new Set(rows.map((r) => seriesOf(r, cols)))];
  return spec.series_order?.length ? spec.series_order.filter((s) => present.includes(s)) : present;
}

type Paint = { where: string; value: unknown };

/** An override field's paint, or what replaces it when it is the literal `"none"`. The hatch is
 *  grounded on the fill `paintedFill` (engine/painted-fill.ts) reads, and that walk skips `none` (the
 *  only value it skips), so assemble-plot falls back to the series colour map: the accent on a pane
 *  with one series, else the series colour. A `none` override is therefore not a ground; `colorMap`
 *  is. Only the override fields get this: the accent and the series colour ARE the map, so a `none`
 *  there is what the fallback finds, and resolveHatch throws on it. */
const overriding = (paint: Paint, colorMap: Paint[]): Paint[] => (paint.value === "none" ? colorMap : [paint]);

/** Waterfall (marks/waterfall.ts `fillFor`): every non-skip step is painted its category's colour,
 *  else the total colour, else the increase or decrease colour by the sign of its delta. All of it
 *  under the one series a waterfall tags its bars with. */
function waterfallGrounds(spec: ChartSpec, rows: TidyRow[], cols: ResolvedColumns): Ground[] {
  if (ownValue(spec.series_patterns, SINGLE_SERIES_KEY) === undefined) return [];
  const colors = spec.waterfall?.colors;
  const colorMap: Paint[] = [
    ...accentGrounds(spec),
    { where: `series_colors[${JSON.stringify(SINGLE_SERIES_KEY)}]`, value: ownValue(spec.series_colors, SINGLE_SERIES_KEY) },
  ];
  const out: Ground[] = [];
  const push = (paint: Paint): void => {
    for (const g of overriding(paint, colorMap)) out.push({ ...g, series: SINGLE_SERIES_KEY });
  };
  for (const pane of paneRows(spec, rows, cols)) {
    for (const r of pane) {
      const kind = cols.kind ? ((r[cols.kind] as string) ?? "").trim() : "";
      if (kind === "skip") continue;
      const cat = (r[cols.x] as string) ?? "";
      const byCat = ownValue(spec.category_colors, cat);
      if (byCat !== undefined) {
        push({ where: `category_colors[${JSON.stringify(cat)}]`, value: byCat });
        continue;
      }
      if (kind === "total") {
        push({ where: "waterfall.colors.total", value: colors?.total });
        continue;
      }
      const raw = (r[cols.value] as string) ?? "";
      const delta = raw === "" ? 0 : Number(raw);
      const rises = !Number.isFinite(delta) || delta >= 0;
      push(
        rises
          ? { where: "waterfall.colors.increase", value: colors?.increase }
          : { where: "waterfall.colors.decrease", value: colors?.decrease },
      );
    }
  }
  return out;
}

/** What each textured series is painted with, pane by pane, after fill precedence. `seriesColor` is
 *  the series' own `series_colors` entry (absent means a palette colour, always readable). A pane
 *  holding ONE series lets the single-series overrides in; a pane with more paints each series its
 *  own colour. An override set to `"none"` falls back to the colour map (see `overriding`).
 *  - bar (marks/bar.ts): per category, `category_colors` first. Then highlight dimming (a token).
 *    Then, on one series, the accent, else `bar_color`, else the series colour. The PNG export
 *    paints a first pass before it resolves the accent (embed/export-png.ts, the legend metadata
 *    pass), so `bar_color` / the series colour is painted there even when every selector option
 *    has a colour: it stays a ground beside the accent.
 *  - histogram (marks/histogram.ts): highlight dimming; else, on one series, `bar_color` if set;
 *    else the accent (one series) and the series colour.
 *  - stacked: a `barStack.mono` stack paints tonal tiers, never an authored colour. Otherwise the
 *    accent (one series) and the series colour, through the colour map (engine/pane.ts).
 *  - area: the accent (one series) and the series colour. */
function seriesGrounds(spec: ChartSpec, rows: TidyRow[], cols: ResolvedColumns): Ground[] {
  const out: Ground[] = [];
  const accent = accentGrounds(spec);
  for (const pane of paneRows(spec, rows, cols)) {
    const names = paneSeries(spec, pane, cols);
    const single = names.length === 1;
    for (const series of names) {
      if (ownValue(spec.series_patterns, series) === undefined) continue;
      const dimmed = !!spec.highlightSeries?.length && !spec.highlightSeries.includes(series);
      const seriesColor: Paint = { where: `series_colors[${JSON.stringify(series)}]`, value: ownValue(spec.series_colors, series) };
      const colorMap: Paint[] = [...(single ? accent : []), seriesColor];
      const push = (...gs: Paint[]): void => {
        for (const g of gs) out.push({ ...g, series });
      };
      const pushOverride = (paint: Paint): void => push(...overriding(paint, colorMap));
      const barColor: Paint = { where: "bar_color", value: spec.bar_color };
      switch (spec.chartType) {
        case "bar": {
          if (!single) {
            if (!dimmed) push(seriesColor);
            break;
          }
          const cats = [...new Set(pane.filter((r) => seriesOf(r, cols) === series).map((r) => (r[cols.x] as string) ?? ""))];
          for (const cat of cats) {
            const byCat = ownValue(spec.category_colors, cat);
            if (byCat !== undefined) pushOverride({ where: `category_colors[${JSON.stringify(cat)}]`, value: byCat });
          }
          const uncovered = cats.some((cat) => ownValue(spec.category_colors, cat) === undefined);
          if (uncovered && !dimmed) {
            push(...accent);
            if (spec.bar_color) pushOverride(barColor);
            else push(seriesColor);
          }
          break;
        }
        case "histogram":
          if (dimmed) break;
          if (single && spec.bar_color) pushOverride(barColor);
          else push(...colorMap);
          break;
        case "stacked":
          if (!spec.barStack?.mono) push(...colorMap);
          break;
        case "area":
          push(...colorMap);
          break;
      }
    }
  }
  return out;
}

/** One error per field, for every authored colour a texture is laid over that the engine cannot
 *  read. Assumes the columns the spec names exist (the caller has checked). */
export function textureGroundErrors(spec: ChartSpec, rows: TidyRow[], cols: ResolvedColumns): string[] {
  if (!spec.series_patterns || !Object.keys(spec.series_patterns).length) return [];
  const grounds = spec.chartType === "waterfall"
    ? waterfallGrounds(spec, rows, cols)
    : seriesGrounds(spec, rows, cols);
  const errors = new Map<string, string>();
  for (const g of grounds) {
    if (errors.has(g.where)) continue;
    const err = hatchGroundError(g.where, g.series, g.value);
    if (err) errors.set(g.where, err);
  }
  return [...errors.values()];
}
