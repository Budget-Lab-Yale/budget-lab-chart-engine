// @vitest-environment jsdom
//
// A grouped treemap names its groups with the engine's standard legend: renderTreemap returns the
// usual legendItems, render-live places them top or right and wires the data-series highlight, and
// the PNG export draws them through its ordinary legend paths. Flat data has no legend.
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderChart } from "../src/engine/index";
import { mountChart } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import { renderTreemap, treemapExportChartWidth, treemapWarnings, TREEMAP_CLASS } from "../src/engine/marks/treemap";
import { INNER_W, MARGIN } from "../src/embed/figure-chrome";
import { LEGEND_COLUMN_WIDTH, LEGEND_GAP } from "../src/engine/legend-layout";
import { tokens } from "../src/theme/tokens";
import { locateOnRamp } from "../src/engine/palette";
import { treemapShades } from "../src/engine/treemap-labels";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

function parseCsv(path: string): TidyRow[] {
  const text = readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8").trim();
  const [header, ...lines] = text.split(/\r?\n/);
  const cols = (header as string).split(",");
  return lines.map((line) => {
    const cells = line.split(",");
    const row: Record<string, string> = {};
    cols.forEach((c, i) => { row[c] = cells[i] ?? ""; });
    return row as TidyRow;
  });
}
const BLS = parseCsv("./fixtures/treemap-bls.csv");
const GROUPED = parseCsv("./fixtures/treemap-grouped.csv");
const FLAT_SPEC = {
  chartType: "treemap", title: "Spending", xAxisType: "categorical", data: "d.csv",
  columns: { x: "category", value: "amount" }, value_format: { prefix: "$" },
} as ChartSpec;
const SPEC = {
  ...FLAT_SPEC, title: "Federal outlays", columns: { x: "category", value: "amount", series: "group" },
  series_order: ["Mandatory", "Discretionary", "Net interest", "Other spending"],
} as ChartSpec;
const GROUPS = ["Mandatory", "Discretionary", "Net interest", "Other spending"];
const RIGHT_W = INNER_W - LEGEND_COLUMN_WIDTH - LEGEND_GAP;
const q = <E extends Element = Element>(root: ParentNode, sel: string): E[] => [...root.querySelectorAll<E>(sel)];

afterEach(() => {
  document.body.replaceChildren();
  delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
});

describe("renderTreemap legendItems", () => {
  it("one rect-swatch row per group, in series_order then appearance order, in the group's resolved colour", () => {
    const res = renderChart(SPEC, GROUPED, { width: 920 });
    expect(res.legendItems).toEqual(GROUPS.map((g, i) => ({
      series: g, label: g, color: tokens.categorical[i]!.base, dashed: false, markerShape: "rect",
    })));
    expect(res.seriesKeyRows).toEqual(res.legendItems);
    // The swatch is the colour the group's tiles are shaded from.
    for (const item of res.legendItems!) expect(item.color).toBe(res.colors.get(item.series));
    // Unlisted groups follow the listed ones in order of first appearance.
    const partial = renderChart({ ...SPEC, series_order: ["Net interest"] } as ChartSpec, GROUPED, { width: 920 });
    expect(partial.legendItems!.map((i) => i.series)).toEqual(["Net interest", "Mandatory", "Discretionary", "Other spending"]);
  });

  it("labels rows by series_labels and swatches them by series_colors as resolved", () => {
    const spec = {
      ...SPEC, series_labels: { Mandatory: "Mandatory spending" }, series_colors: { Discretionary: "violet-300", "Net interest": "#5B4B8A" },
    } as ChartSpec;
    const items = renderChart(spec, GROUPED, { width: 920 }).legendItems!;
    expect(items.map((i) => i.label)).toEqual(["Mandatory spending", "Discretionary", "Net interest", "Other spending"]);
    expect(items[1]!.color).toBe(tokens.scales.violet["300"]);
    expect(items[2]!.color).toBe("#5B4B8A");
  });

  it("is null for flat data, with legend: false, with series_legend: false, and for a single group", () => {
    expect(renderChart(FLAT_SPEC, BLS, { width: 920 }).legendItems).toBeNull();
    expect(renderChart({ ...SPEC, legend: false } as ChartSpec, GROUPED, { width: 920 }).legendItems).toBeNull();
    expect(renderChart({ ...SPEC, series_legend: false } as ChartSpec, GROUPED, { width: 920 }).legendItems).toBeNull();
    const one = GROUPED.filter((r) => r.group === "Mandatory");
    expect(renderChart(SPEC, one, { width: 920 }).legendItems).toBeNull();
  });

  it("property: every grouped tile under shading: size is one of its chip's 7 shades, within 2 tiers of the chip on the chip's ramp, 3 for a chip at a ramp end (200 charts)", () => {
    let s = 17;
    const rand = (): number => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    const refs = ["blue", "amber-50", "violet-300", "green-700", "red", "rose-600", "russet-100", "blue-200"];
    let maxGap = 0;
    let endGap = 0;
    for (let c = 0; c < 200; c++) {
      const groups = 2 + Math.floor(rand() * 14);
      const rows = Array.from({ length: groups + Math.floor(rand() * 20) }, (_, i) => ({
        group: `G${i < groups ? i : Math.floor(rand() * groups)}`, category: `t${i}`, amount: String(1 + Math.floor(rand() * 500)),
      })) as TidyRow[];
      const series_colors = c % 3 === 0 ? { G0: refs[c % refs.length]!, G1: refs[(c + 3) % refs.length]! } : undefined;
      const spec = { ...SPEC, series_order: [], ...(series_colors ? { series_colors } : {}) } as ChartSpec;
      const res = renderChart(spec, rows, { width: [375, 599, 920][c % 3]! });
      const chip = new Map(res.legendItems!.map((i) => [i.series, i.color!]));
      for (const g of q(res.svg, "g[data-series]")) {
        const color = chip.get(g.getAttribute("data-series")!)!;
        const fill = g.querySelector("rect")!.getAttribute("fill")!;
        // A one-tile group is drawn in the chip's own colour.
        if (q(res.svg, `g[data-series="${g.getAttribute("data-series")}"]`).length === 1) {
          expect(fill).toBe(color);
          continue;
        }
        const at = locateOnRamp(color)!;
        const shades = treemapShades(color)!;
        const i = shades.indexOf(fill);
        expect(i).toBeGreaterThanOrEqual(0);
        // Shade i (darkest first) sits i/2 tiers lighter than the band's darkest tier: half-steps between tiers.
        const darkest = locateOnRamp(shades[0]!)!;
        expect(darkest.family).toBe(at.family);
        const gap = Math.abs(darkest.index - i / 2 - at.index);
        // A band clamped at either end keeps its 4 tiers, so it reaches one tier further from a chip there.
        if (at.index === 0 || at.index === at.tiers.length - 1) endGap = Math.max(endGap, gap);
        else maxGap = Math.max(maxGap, gap);
      }
    }
    expect(maxGap).toBe(2);
    expect(endGap).toBe(3);
  });

  it("keeps the group order in a right-hand column (no reversal)", () => {
    expect(renderChart(SPEC, GROUPED, { width: 920 }).legendVisualOrder).toEqual(GROUPS);
  });
});

describe("treemap legend, live", () => {
  const mount = (spec: ChartSpec, width: number, rows: TidyRow[] = GROUPED): HTMLElement => {
    const host = document.createElement("div");
    document.body.append(host);
    mountChart(host, { spec, rows, width });
    return host;
  };
  const svgOf = (host: HTMLElement) => host.querySelector<SVGSVGElement>(`svg.${TREEMAP_CLASS}`)!;
  const row = (host: HTMLElement, g: string) => host.querySelector<HTMLButtonElement>(`.tbl-legend-item[data-series="${g}"]`)!;
  const dimmed = (host: HTMLElement): string[] =>
    [...new Set(q(svgOf(host), "g.tbl-dimmed").map((g) => g.getAttribute("data-series")!))];
  const opacityAttrs = (host: HTMLElement): number => q(svgOf(host), "g[opacity]").length;

  it("draws a top legend by default, one row per group", () => {
    const host = mount(SPEC, 920);
    const rows = q(host, ".figure-legend-slot .tbl-legend-item");
    expect(rows.map((b) => b.getAttribute("data-series"))).toEqual(GROUPS);
    expect(rows.map((b) => b.textContent)).toEqual(GROUPS);
    expect(host.querySelector(".figure-legend-slot--right")).toBeNull();
    expect(Number(svgOf(host).getAttribute("width"))).toBe(920);
  });

  it("draws none for flat data, with legend: false, or with series_legend: false", () => {
    for (const host of [mount(FLAT_SPEC, 920, BLS), mount({ ...SPEC, legend: false } as ChartSpec, 920), mount({ ...SPEC, series_legend: false } as ChartSpec, 920)]) {
      expect(host.querySelector(".tbl-legend")).toBeNull();
    }
  });

  it("legendPosition: right puts the rows in a column beside a narrower treemap on a wide card, in group order", () => {
    const host = mount({ ...SPEC, legendPosition: "right" } as ChartSpec, 920);
    const col = host.querySelector(".figure-legend-slot--right .tbl-legend.tbl-legend--vertical")!;
    expect(q(col, ".tbl-legend-item").map((b) => b.getAttribute("data-series"))).toEqual(GROUPS);
    expect(host.querySelector(".figure-legend-slot")!.childElementCount).toBe(0);
    expect(Number(svgOf(host).getAttribute("width"))).toBe(RIGHT_W);
  });

  it("legendPosition: right with no legend rows (flat, one group, series_legend: false) draws at the full card width, as the PNG does", () => {
    const one = GROUPED.filter((r) => r.group === "Mandatory");
    const cases: Array<[ChartSpec, TidyRow[]]> = [
      [{ ...FLAT_SPEC, legendPosition: "right" } as ChartSpec, BLS],
      [{ ...SPEC, legendPosition: "right" } as ChartSpec, one],
      [{ ...SPEC, series_legend: false, legendPosition: "right" } as ChartSpec, GROUPED],
    ];
    for (const [spec, rows] of cases) {
      const host = mount(spec, INNER_W, rows);
      expect(host.querySelector(".tbl-legend")).toBeNull();
      expect(host.querySelector(".figure-body--legend-right")).toBeNull();
      const live = svgOf(host);
      const png = buildExportSvg(spec, rows).querySelector<SVGSVGElement>(`svg.${TREEMAP_CLASS}`)!;
      expect(Number(live.getAttribute("width"))).toBe(INNER_W);
      expect(Number(png.getAttribute("width"))).toBe(INNER_W);
      // The same layout on both paths: every tile at the same place and size.
      const boxes = (svg: SVGSVGElement) => q(svg, "rect.tbl-treemap-tile").map((r) => ["x", "y", "width", "height"].map((a) => r.getAttribute(a)).join(","));
      expect(boxes(live)).toEqual(boxes(png));
    }
  });

  it("the no-rows fallback is treemap-only: a non-treemap chart's right legend is unchanged", () => {
    // A two-series stacked chart keeps its right-hand column.
    const stacked = { chartType: "stacked", title: "S", xAxisType: "categorical", data: "inline", legendPosition: "right" } as ChartSpec;
    const sRows = [{ time: "X", series: "A", value: "3" }, { time: "X", series: "B", value: "2" }] as TidyRow[];
    const a = document.createElement("div");
    document.body.append(a);
    mountChart(a, { spec: stacked, rows: sRows, width: INNER_W });
    expect(a.querySelector(".figure-body--legend-right")).not.toBeNull();
    // A single-series line (no legend rows) with legendPosition: right still reserves the column's
    // width live, exactly as before this fix: pre-existing behaviour on non-treemap chart types,
    // pinned here so the treemap fallback provably does not reach them.
    const line = { chartType: "line", title: "L", xAxisType: "categorical", data: "inline", legendPosition: "right" } as ChartSpec;
    const lRows = [{ time: "X", series: "A", value: "3" }, { time: "Y", series: "A", value: "2" }] as TidyRow[];
    const b = document.createElement("div");
    document.body.append(b);
    mountChart(b, { spec: line, rows: lRows, width: INNER_W });
    expect(b.querySelector(".tbl-legend")).toBeNull();
    expect(Number(b.querySelector("svg.tblchart")!.getAttribute("width"))).toBe(RIGHT_W);
  });

  it("legendPosition: right falls back to the top on a card too narrow for the column", () => {
    const host = mount({ ...SPEC, legendPosition: "right" } as ChartSpec, 500);
    expect(host.querySelector(".figure-legend-slot--right")).toBeNull();
    expect(q(host, ".figure-legend-slot .tbl-legend-item")).toHaveLength(GROUPS.length);
    expect(Number(svgOf(host).getAttribute("width"))).toBe(500);
  });

  it("hovering a row dims every other group's tiles; leaving it restores them", () => {
    const host = mount(SPEC, 920);
    row(host, "Discretionary").dispatchEvent(new PointerEvent("pointerenter"));
    expect(dimmed(host).sort()).toEqual(["Mandatory", "Net interest", "Other spending"]);
    expect(q(svgOf(host), 'g[data-series="Discretionary"].tbl-dimmed')).toHaveLength(0);
    row(host, "Discretionary").dispatchEvent(new PointerEvent("pointerleave"));
    expect(dimmed(host)).toEqual([]);
  });

  it("composes with the tile hover: no dim state survives either gesture ending", () => {
    const host = mount(SPEC, 920);
    const tile = q(svgOf(host), 'g[data-series="Mandatory"]')[0]!;
    // Legend row hovered, then a tile hovered and left: the legend's dims stand, the tile's go.
    row(host, "Mandatory").dispatchEvent(new PointerEvent("pointerenter"));
    tile.dispatchEvent(new PointerEvent("pointerenter", { clientX: 10, clientY: 10 }));
    expect(opacityAttrs(host)).toBeGreaterThan(0);
    expect(svgOf(host).querySelector(".tbl-treemap-hover-outline")).not.toBeNull();
    expect(dimmed(host).sort()).toEqual(["Discretionary", "Net interest", "Other spending"]);
    tile.dispatchEvent(new PointerEvent("pointerleave", { clientX: 10, clientY: 10 }));
    expect(opacityAttrs(host)).toBe(0);
    expect(svgOf(host).querySelector(".tbl-treemap-hover-outline")).toBeNull();
    expect(dimmed(host).sort()).toEqual(["Discretionary", "Net interest", "Other spending"]);
    row(host, "Mandatory").dispatchEvent(new PointerEvent("pointerleave"));
    expect(dimmed(host)).toEqual([]);
    // The other order: a tile hovered, then a row hovered and left while the tile still is.
    tile.dispatchEvent(new PointerEvent("pointerenter", { clientX: 10, clientY: 10 }));
    row(host, "Net interest").dispatchEvent(new PointerEvent("pointerenter"));
    row(host, "Net interest").dispatchEvent(new PointerEvent("pointerleave"));
    expect(dimmed(host)).toEqual([]);
    tile.dispatchEvent(new PointerEvent("pointerleave", { clientX: 10, clientY: 10 }));
    expect(opacityAttrs(host)).toBe(0);
    expect(dimmed(host)).toEqual([]);
  });

  it("clicking a row pins the highlight through tile hovers; the reset button clears it", () => {
    const host = mount(SPEC, 920);
    row(host, "Net interest").click();
    row(host, "Net interest").dispatchEvent(new PointerEvent("pointerleave"));
    expect(dimmed(host).sort()).toEqual(["Discretionary", "Mandatory", "Other spending"]);
    const tile = q(svgOf(host), 'g[data-series="Mandatory"]')[0]!;
    tile.dispatchEvent(new PointerEvent("pointerenter", { clientX: 10, clientY: 10 }));
    tile.dispatchEvent(new PointerEvent("pointerleave", { clientX: 10, clientY: 10 }));
    expect(dimmed(host).sort()).toEqual(["Discretionary", "Mandatory", "Other spending"]);
    host.querySelector<HTMLButtonElement>(".tbl-legend-reset")!.click();
    expect(dimmed(host)).toEqual([]);
  });

  it("clicking a tile pins its group, as clicking a bar pins its series", () => {
    const host = mount(SPEC, 920);
    const svg = svgOf(host);
    const g = q(svg, 'g[data-series="Discretionary"]')[0]!;
    // jsdom has no layout: answer the hit test the click handler makes with the tile under the pointer.
    (document as { elementsFromPoint?: unknown }).elementsFromPoint = () => [g.querySelector("rect")!, g, svg];
    svg.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 50, clientY: 50 }));
    expect(row(host, "Discretionary").getAttribute("aria-pressed")).toBe("true");
    expect(dimmed(host).sort()).toEqual(["Mandatory", "Net interest", "Other spending"]);
  });
});

describe("treemap legend, PNG export", () => {
  /** Texts drawn straight onto the export root (the legend), not inside the treemap svg. */
  const rootTexts = (root: SVGSVGElement) => q(root, "text").filter((t) => t.closest("svg") === root);
  const inner = (root: SVGSVGElement) => root.querySelector<SVGSVGElement>(`svg.${TREEMAP_CLASS}`)!;

  it("draws the top legend above a full-width treemap", () => {
    const root = buildExportSvg(SPEC, GROUPED);
    const t = inner(root);
    expect(Number(t.getAttribute("width"))).toBe(INNER_W);
    const legend = rootTexts(root).filter((x) => GROUPS.includes(x.textContent!.trim()));
    expect(legend.map((x) => x.textContent!.trim())).toEqual(GROUPS);
    for (const x of legend) expect(Number(x.getAttribute("y"))).toBeLessThan(Number(t.getAttribute("y")));
  });

  it("legendPosition: right draws the column beside a treemap rendered at the reduced width", () => {
    const spec = { ...SPEC, legendPosition: "right" } as ChartSpec;
    const root = buildExportSvg(spec, GROUPED);
    const t = inner(root);
    expect(Number(t.getAttribute("width"))).toBe(RIGHT_W);
    // Laid out at that width, not squeezed: the same tiles a direct render at RIGHT_W draws.
    expect(t.innerHTML).toBe(renderTreemap(spec, GROUPED, { width: RIGHT_W }).svg.innerHTML);
    expect(t.getAttribute("viewBox")).toBe(`0 0 ${RIGHT_W} ${RIGHT_W / 2}`);
    const legend = rootTexts(root).filter((x) => GROUPS.includes(x.textContent!.trim()));
    expect(legend.map((x) => x.textContent!.trim())).toEqual(GROUPS);
    for (const x of legend) {
      expect(Number(x.getAttribute("x"))).toBeGreaterThanOrEqual(MARGIN + RIGHT_W + LEGEND_GAP);
      expect(Number(x.getAttribute("y"))).toBeGreaterThanOrEqual(Number(t.getAttribute("y")));
    }
  });

  it("grows the frame to a right-hand column taller than the treemap, which keeps its own height", () => {
    const many = Array.from({ length: 24 }, (_, i) => ({ group: `Group ${i}`, category: `c${i}`, amount: String(100 - i) })) as TidyRow[];
    const spec = { ...SPEC, series_order: [], legendPosition: "right" } as ChartSpec;
    const root = buildExportSvg(spec, many);
    const t = inner(root);
    expect(Number(t.getAttribute("height"))).toBe(RIGHT_W / 2);
    const legend = rootTexts(root).filter((x) => /^Group \d+$/.test(x.textContent!.trim()));
    expect(legend).toHaveLength(24);
    const lowest = Math.max(...legend.map((x) => Number(x.getAttribute("y"))));
    // The column runs past the treemap's bottom, and the frame still holds it.
    expect(lowest).toBeGreaterThan(Number(t.getAttribute("y")) + RIGHT_W / 2);
    expect(Number(root.getAttribute("height"))).toBeGreaterThan(lowest);
  });

  it("draws no legend for flat data, legend: false or series_legend: false", () => {
    for (const [spec, rows] of [[FLAT_SPEC, BLS], [{ ...SPEC, legend: false }, GROUPED], [{ ...SPEC, series_legend: false, legendPosition: "right" }, GROUPED]] as const) {
      const root = buildExportSvg(spec as ChartSpec, rows);
      expect(Number(inner(root).getAttribute("width"))).toBe(INNER_W);
      expect(rootTexts(root).filter((x) => GROUPS.includes(x.textContent!.trim()))).toEqual([]);
    }
  });

  it("treemapExportChartWidth is the width the export draws at, and the warnings are judged there", () => {
    const cases: Array<[ChartSpec, TidyRow[]]> = [
      [SPEC, GROUPED], [{ ...SPEC, legendPosition: "right" } as ChartSpec, GROUPED], [FLAT_SPEC, BLS],
      [{ ...FLAT_SPEC, legendPosition: "right" } as ChartSpec, BLS], [{ ...SPEC, legend: false, legendPosition: "right" } as ChartSpec, GROUPED],
      [{ ...SPEC, series_legend: false, legendPosition: "right" } as ChartSpec, GROUPED],
    ];
    const widths = cases.map(([spec, rows]) => {
      const w = treemapExportChartWidth(spec, rows);
      expect(Number(inner(buildExportSvg(spec, rows)).getAttribute("width"))).toBe(w);
      return w;
    });
    expect(widths).toEqual([INNER_W, RIGHT_W, INNER_W, INNER_W, INNER_W, INNER_W]);
    // The unlabelled-tiles warning defaults to that width.
    const tiny = [{ group: "A", category: "Big", amount: "1000000" }, { group: "B", category: "Big two", amount: "1000000" },
      ...Array.from({ length: 6 }, (_, i) => ({ group: "B", category: `Tiny ${i}`, amount: "1" }))] as TidyRow[];
    expect(treemapWarnings({ ...SPEC, legendPosition: "right" } as ChartSpec, tiny)).toEqual([
      `treemap: 6 of 8 tiles are unlabelled at ${RIGHT_W}px wide (hover still names them); consider grouping small categories into "Other"`,
    ]);
  });
});
