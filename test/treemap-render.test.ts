// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderChart } from "../src/engine/index";
import { mountChart } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import { TREEMAP_CLASS, treemapHeight, treemapWarnings } from "../src/engine/marks/treemap";
import { treemapAreaHeight, TM_GEOM } from "../src/engine/treemap-layout";
import { contrastText, fitTileLabel, stripFill, TM_KEY_PREFIX } from "../src/engine/treemap-labels";
import { tokens } from "../src/theme/tokens";
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
const WHITE = tokens.structural.background;
const NAVY = tokens.structural.text_heading;
const FLAT_SPEC = {
  chartType: "treemap", title: "Share of total annual expenditures, 2024", xAxisType: "categorical", data: "d.csv",
  columns: { x: "category", value: "amount" }, value_format: { prefix: "$" },
} as ChartSpec;
const GROUPED_SPEC = {
  ...FLAT_SPEC, title: "Federal outlays", columns: { x: "category", value: "amount", series: "group" },
  series_order: ["Mandatory", "Discretionary", "Net interest", "Other spending"],
} as ChartSpec;
const rowsOf = (pairs: Array<[string, number]>): TidyRow[] => pairs.map(([category, amount]) => ({ category, amount: String(amount) }) as TidyRow);
const q = <E extends Element = Element>(root: ParentNode, sel: string): E[] => [...root.querySelectorAll<E>(sel)];
const num = (e: Element, a: string): number => Number(e.getAttribute(a));
const tiles = (svg: SVGSVGElement) => q<SVGGElement>(svg, "g[role=img]");
const tileOf = (svg: SVGSVGElement, name: string): SVGGElement =>
  tiles(svg).find((g) => (g.getAttribute("aria-label") ?? "").split(", ")[0]!.split(" · ").pop() === name)!;
const keyText = (svg: SVGSVGElement): string[] => q(svg, "text.tbl-treemap-key").map((t) => t.textContent ?? "");
/** The key's entries, assuming no entry was broken across lines (true at these widths). */
const keyEntriesOf = (svg: SVGSVGElement): string[] => {
  const lines = keyText(svg);
  if (!lines.length) return [];
  return lines.join(" · ").slice(TM_KEY_PREFIX.length).trim().split(" · ");
};
const render = (spec: ChartSpec, rows: TidyRow[], width = 920, extra = {}) => renderChart(spec, rows, { width, ...extra });

describe("treemap render", () => {
  it("draws one tile per non-zero row, in a tbl-treemap svg", () => {
    const rows = [...BLS, { category: "Nothing", amount: "0" } as TidyRow];
    const { svg } = render(FLAT_SPEC, rows);
    expect(svg.getAttribute("class")).toBe(TREEMAP_CLASS);
    expect(svg.getAttribute("aria-label")).toBe(FLAT_SPEC.title);
    expect(q(svg, "rect.tbl-treemap-tile")).toHaveLength(BLS.length);
    expect(tiles(svg)).toHaveLength(BLS.length);
  });

  it.each([375, 720, 920])("keeps every tile and strip inside the treemap area at %ipx", (w) => {
    for (const [spec, rows] of [[FLAT_SPEC, BLS], [GROUPED_SPEC, GROUPED]] as const) {
      const { svg } = render(spec, rows, w);
      const areaH = treemapAreaHeight(w);
      for (const r of q(svg, "rect.tbl-treemap-tile, rect.tbl-treemap-strip")) {
        for (const a of ["x", "y", "width", "height"]) expect(Number.isFinite(num(r, a))).toBe(true);
        expect(num(r, "x")).toBeGreaterThanOrEqual(0);
        expect(num(r, "y")).toBeGreaterThanOrEqual(0);
        expect(num(r, "x") + num(r, "width")).toBeLessThanOrEqual(w + 0.01);
        expect(num(r, "y") + num(r, "height")).toBeLessThanOrEqual(areaH + 0.01);
      }
    }
  });

  it("labels each tile for assistive technology with both numbers (flat)", () => {
    const { svg } = render({ ...FLAT_SPEC, treemap: { label_value: "none" } } as ChartSpec, BLS);
    expect(tileOf(svg, "Housing").getAttribute("aria-label")).toBe("Housing, 33.4% of total, $28,452");
    expect(tileOf(svg, "Education").getAttribute("aria-label")).toBe("Education, 2.0% of total, $1,700");
    expect(tileOf(svg, "Housing").hasAttribute("data-series")).toBe(false);
  });

  it("labels each tile with its group's display label (grouped)", () => {
    const spec = { ...GROUPED_SPEC, series_labels: { Mandatory: "Mandatory spending" } } as ChartSpec;
    const { svg } = render(spec, GROUPED);
    expect(tileOf(svg, "Medicare").getAttribute("aria-label")).toBe("Mandatory spending · Medicare, 13.4% of total, $874");
    expect(tileOf(svg, "Defense").getAttribute("aria-label")).toBe("Discretionary · Defense, 13.0% of total, $850");
    expect(tileOf(svg, "Medicare").getAttribute("data-series")).toBe("Mandatory");
  });

  it("puts white text on a dark tile and navy on a light one, per contrastText", () => {
    const { svg } = render(FLAT_SPEC, BLS);
    const fills = new Set<string>();
    for (const g of tiles(svg)) {
      const text = g.querySelector("text");
      if (!text) continue;
      const rectFill = g.querySelector("rect")!.getAttribute("fill")!;
      expect(text.getAttribute("fill")).toBe(contrastText(rectFill));
      fills.add(text.getAttribute("fill")!);
    }
    expect(fills).toEqual(new Set([WHITE, NAVY]));
    expect(tileOf(svg, "Housing").querySelector("text")!.getAttribute("fill")).toBe(WHITE);
    expect(tileOf(svg, "Housing").querySelector("rect")!.getAttribute("fill")).toBe(tokens.scales.blue["700"]);
  });

  it("shows the share by default, the formatted value with label_value: value, the name alone with none", () => {
    const label = (spec: ChartSpec) => tileOf(render(spec, BLS).svg, "Housing").querySelector("text")!;
    expect([...label(FLAT_SPEC).children].map((s) => s.textContent)).toEqual(["Housing", "33.4%"]);
    const value = label({ ...FLAT_SPEC, treemap: { label_value: "value" } } as ChartSpec);
    expect([...value.children].map((s) => s.textContent)).toEqual(["Housing", "$28,452"]);
    const none = render({ ...FLAT_SPEC, treemap: { label_value: "none" } } as ChartSpec, BLS).svg;
    expect(tileOf(none, "Housing").querySelector("text")!.textContent).toBe("Housing");
    for (const t of q(none, "text.tbl-treemap-label")) expect(t.textContent).not.toMatch(/%|\$/);
  });

  it("draws every label exactly as fitTileLabel fitted it, top-left in its tile's inner box", () => {
    let inline = 0;
    for (const w of [375, 560, 720, 920]) {
      for (const [spec, rows] of [[FLAT_SPEC, BLS], [GROUPED_SPEC, GROUPED]] as const) {
        const { svg } = render(spec, rows, w);
        for (const g of tiles(svg)) {
          const rect = g.querySelector("rect")!;
          const [x, y, rw, rh] = ["x", "y", "width", "height"].map((a) => num(rect, a)) as [number, number, number, number];
          const name = g.getAttribute("aria-label")!.split(", ")[0]!.split(" · ").pop()!;
          const share = g.getAttribute("aria-label")!.split(", ")[1]!.replace(" of total", "");
          const fit = fitTileLabel(name, share, rw, rh);
          const text = g.querySelector("text");
          if (fit.mode === "none") {
            expect(text).toBeNull();
            continue;
          }
          const spans = [...text!.children];
          // Left-aligned at the inner box's left edge; each line's box stacks down from its top edge,
          // the baseline centring the cap height in the line box.
          expect(text!.getAttribute("text-anchor")).toBe("start");
          const left = x + TM_GEOM.pad;
          let top = y + TM_GEOM.pad;
          const baseline = (size: number): number => top + (size * 1.2) / 2 + 0.35 * size;
          if (fit.mode === "stacked") {
            expect(spans.map((s) => s.textContent)).toEqual([...fit.nameLines, fit.number]);
            spans.forEach((s, i) => {
              const isNumber = i === spans.length - 1;
              const size = isNumber ? fit.numberSize : fit.size;
              expect(num(s, "font-weight")).toBe(isNumber ? 500 : 700);
              expect(num(s, "font-size")).toBe(size);
              expect(num(s, "x")).toBeCloseTo(left, 1);
              expect(num(s, "y")).toBeCloseTo(baseline(size), 1);
              top += size * 1.2;
            });
          } else {
            inline++;
            expect(spans.map((s) => s.textContent)).toEqual([fit.name, ` ${fit.number}`]);
            expect(spans.map((s) => num(s, "font-weight"))).toEqual([700, 500]);
            expect(num(text!, "font-size")).toBe(fit.size);
            expect(num(text!, "x")).toBeCloseTo(left, 1);
            expect(num(text!, "y")).toBeCloseTo(baseline(fit.size), 1);
            top += fit.size * 1.2;
          }
          // The block ends inside the inner box.
          expect(top).toBeLessThanOrEqual(y + rh - TM_GEOM.pad + 0.01);
        }
      }
    }
    expect(inline).toBeGreaterThan(0);
  });

  it("lists exactly the unlabelled tiles in the key, in layout order", () => {
    for (const w of [375, 720]) {
      const { svg } = render(FLAT_SPEC, BLS, w);
      const want = tiles(svg)
        .filter((g) => {
          const rect = g.querySelector("rect")!;
          const [name, share] = g.getAttribute("aria-label")!.split(", ") as [string, string];
          return fitTileLabel(name, share.replace(" of total", ""), num(rect, "width"), num(rect, "height")).mode === "none";
        })
        .map((g) => g.getAttribute("aria-label")!.split(", ").slice(0, 2).join(" ").replace(" of total", ""));
      expect(want.length).toBeGreaterThan(0);
      expect(keyEntriesOf(svg)).toEqual(want);
      expect(q(svg, "text.tbl-treemap-label")).toHaveLength(BLS.length - want.length);
    }
  });

  it("draws the key prefix bold, the rest at 500, 12px muted, below the area", () => {
    const { svg } = render(FLAT_SPEC, BLS, 375);
    const lines = q(svg, "text.tbl-treemap-key");
    expect(lines.length).toBeGreaterThan(0);
    const first = [...lines[0]!.children];
    expect(first[0]!.textContent).toBe(TM_KEY_PREFIX);
    expect(num(first[0]!, "font-weight")).toBe(700);
    expect(num(first[1]!, "font-weight")).toBe(500);
    const areaH = treemapAreaHeight(375);
    lines.forEach((l, i) => {
      expect(num(l, "font-size")).toBe(12);
      expect(l.getAttribute("fill")).toBe(tokens.structural.text_muted);
      expect(num(l, "y")).toBeGreaterThan(areaH + 8 + 16 * i);
      expect(num(l, "y")).toBeLessThanOrEqual(areaH + 8 + 16 * (i + 1));
    });
  });

  it("has no key when every tile is labelled", () => {
    const { svg } = render(FLAT_SPEC, rowsOf([["Alpha", 5], ["Beta", 4], ["Gamma", 3]]), 920);
    expect(q(svg, "text.tbl-treemap-label")).toHaveLength(3);
    expect(q(svg, "text.tbl-treemap-key")).toHaveLength(0);
    expect(num(svg, "height")).toBe(treemapAreaHeight(920));
  });

  it("draws a header strip per group that fits, in the group's 700 tier with contrast text", () => {
    const { svg, colors } = render(GROUPED_SPEC, GROUPED);
    const strips = q(svg, "rect.tbl-treemap-strip");
    expect(strips.map((s) => s.getAttribute("data-series"))).toEqual(["Mandatory", "Discretionary", "Net interest"]);
    const labels = q(svg, "text.tbl-treemap-strip-label");
    strips.forEach((s, i) => {
      const fill = stripFill(colors.get(s.getAttribute("data-series")!)!);
      expect(s.getAttribute("fill")).toBe(fill);
      expect(num(s, "height")).toBe(TM_GEOM.stripH);
      expect(labels[i]!.getAttribute("fill")).toBe(contrastText(fill));
      expect(num(labels[i]!, "x")).toBe(num(s, "x") + TM_GEOM.stripPad);
    });
    expect(colors.get("Mandatory")).toBe(tokens.categorical[0]!.base);
    expect(strips[0]!.getAttribute("fill")).toBe(tokens.scales.blue["700"]);
    expect([...labels[0]!.children].map((s) => [s.textContent, num(s, "font-weight")])).toEqual([["Mandatory", 700], [" 58.9%", 500]]);
  });

  it("lists a strip-less group first in the key", () => {
    const { svg } = render(GROUPED_SPEC, GROUPED);
    const entries = keyEntriesOf(svg);
    expect(entries[0]).toBe("Other spending: 0.5%");
    expect(entries.slice(1).every((e) => /\(.+\) \d/.test(e))).toBe(true);
  });

  it("drops the strip of a block under two strips tall, even when its name fits", () => {
    const g = (rows: Array<[string, string, number]>) => rows.map(([group, category, amount]) => ({ group, category, amount: String(amount) }) as TidyRow);
    // At 280px wide the second group is a full-width band: 10% of 350px is 35px (< 44), 15% is 52.5px.
    const short = render(GROUPED_SPEC, g([["A", "a1", 50], ["A", "a2", 40], ["B", "b1", 10]]), 280).svg;
    expect(q(short, "rect.tbl-treemap-strip").map((s) => s.getAttribute("data-series"))).toEqual(["A"]);
    expect(keyEntriesOf(short)[0]).toBe("B: 10.0%");
    const tall = render(GROUPED_SPEC, g([["A", "a1", 45], ["A", "a2", 40], ["B", "b1", 15]]), 280).svg;
    expect(q(tall, "rect.tbl-treemap-strip").map((s) => s.getAttribute("data-series"))).toEqual(["A", "B"]);
  });

  it("shows 100.0% on a one-tile chart", () => {
    const { svg } = render(FLAT_SPEC, rowsOf([["Everything", 42]]));
    expect(q(svg, "rect.tbl-treemap-tile")).toHaveLength(1);
    expect(svg.querySelector("text.tbl-treemap-label")!.textContent).toBe("Everything100.0%");
  });

  it("keeps a sub-pixel tile's attributes finite and lists it in the key", () => {
    const { svg } = render(FLAT_SPEC, rowsOf([["Big", 1_000_000], ["Tiny", 1]]), 720);
    const tiny = tileOf(svg, "Tiny").querySelector("rect")!;
    for (const a of ["x", "y", "width", "height"]) expect(Number.isFinite(num(tiny, a))).toBe(true);
    expect(tileOf(svg, "Tiny").querySelector("text")).toBeNull();
    expect(keyEntriesOf(svg)).toEqual(["Tiny 0.0%"]);
  });

  it("draws no legend and returns per-tile hover info in DOM order", () => {
    const res = render(GROUPED_SPEC, GROUPED);
    expect(res.legendItems).toBeNull();
    const rects = q(res.svg, "rect.tbl-treemap-tile");
    expect(res.treemapTiles).toHaveLength(rects.length);
    res.treemapTiles!.forEach((t, i) => {
      expect(t.fill).toBe(rects[i]!.getAttribute("fill"));
      expect(rects[i]!.parentElement!.getAttribute("aria-label")).toContain(`${t.name}, `);
    });
    const medicare = res.treemapTiles!.find((t) => t.name === "Medicare")!;
    expect(medicare).toMatchObject({ group: "Mandatory", groupLabel: "Mandatory", value: 874 });
    expect(medicare.share).toBeCloseTo(874 / 6531, 12);
    expect(medicare.row).toBe(GROUPED[1]);
    const flat = render(FLAT_SPEC, BLS).treemapTiles!;
    expect(flat[0]).toMatchObject({ name: "Housing", group: null, groupLabel: null, value: 28452 });
  });

  it("calls hooks.afterRender once with the svg and the phase", () => {
    const afterRender = vi.fn();
    const { svg } = render(FLAT_SPEC, BLS, 920, { hooks: { afterRender }, phase: "export" });
    expect(afterRender).toHaveBeenCalledTimes(1);
    expect(afterRender).toHaveBeenCalledWith(svg, { phase: "export" });
  });

  it.each([375, 720, 920])("treemapHeight equals the svg height at %ipx", (w) => {
    for (const [spec, rows] of [[FLAT_SPEC, BLS], [GROUPED_SPEC, GROUPED]] as const) {
      const { svg } = render(spec, rows, w);
      expect(treemapHeight(spec, rows, w)).toBe(num(svg, "height"));
    }
  });
});

describe("treemapWarnings", () => {
  it("passes the data warnings through and is otherwise empty for a well-labelled chart", () => {
    expect(treemapWarnings(FLAT_SPEC, BLS)).toEqual([]);
    const rows = [...BLS, { category: "Nothing", amount: "0" } as TidyRow];
    expect(treemapWarnings(FLAT_SPEC, rows)).toEqual([`treemap: 1 zero-value row not drawn: row 11 ("Nothing")`]);
  });

  it("warns when more than half the tiles are unlabelled at the 920px export width", () => {
    const rows = rowsOf([["Big", 1_000_000], ...Array.from({ length: 6 }, (_, i): [string, number] => [`Tiny ${i}`, 1])]);
    expect(treemapWarnings(FLAT_SPEC, rows)).toEqual([
      `treemap: 6 of 7 tiles are too small to label at 920px wide and are listed in the key below the chart; consider grouping small categories into "Other"`,
    ]);
    // The message names the width it was measured at, not a fixed "export width".
    expect(treemapWarnings(FLAT_SPEC, rows, 640)[0]).toMatch(/too small to label at 640px wide/);
    // Exactly half unlabelled is not more than half.
    const half = rowsOf([["Big", 1_000_000], ["Big 2", 1_000_000], ["Tiny 0", 1], ["Tiny 1", 1]]);
    expect(treemapWarnings(FLAT_SPEC, half)).toEqual([]);
  });
});

describe("group names that are Object.prototype keys", () => {
  // series_labels / series_colors are plain objects: a lookup keyed by a group named "constructor"
  // must not find the inherited property. Each group is large enough for its strip at 920.
  const PROTO = ["constructor", "toString", "__proto__"];
  const protoRows = PROTO.flatMap((group, i) => [
    { group, category: `${group} one`, amount: String(300 - 10 * i) },
    { group, category: `${group} two`, amount: String(200 - 10 * i) },
  ]) as TidyRow[];
  const SPEC = { ...FLAT_SPEC, columns: { x: "category", value: "amount", series: "group" } } as ChartSpec;
  const stripNames = (svg: SVGSVGElement): string[] =>
    q(svg, "text.tbl-treemap-strip-label").map((t) => t.firstElementChild!.textContent ?? "");
  const variants: Array<[string, ChartSpec]> = [
    ["no series_labels or series_colors", SPEC],
    // Set, but keyed by one group only: the other two must fall through to their own name and hue.
    ["series_labels and series_colors set for one group", { ...SPEC, series_labels: { toString: "Renamed" }, series_colors: { constructor: "green" } } as ChartSpec],
  ];

  for (const [what, spec] of variants) {
    it(`render, mount, export and warnings all work with ${what}`, () => {
      const renamed = spec.series_labels ? { toString: "Renamed" } as Record<string, string> : {};
      const want = PROTO.map((g) => (Object.hasOwn(renamed, g) ? renamed[g]! : g));
      const { svg } = renderChart(spec, protoRows, { width: 920 });
      expect(new Set(stripNames(svg))).toEqual(new Set(want));
      expect(q(svg, "rect.tbl-treemap-strip").map((r) => r.getAttribute("fill"))).not.toContain(null);
      for (const f of q(svg, "rect.tbl-treemap-tile").map((r) => r.getAttribute("fill")!)) expect(f).toMatch(/^#[0-9A-F]{6}$/i);
      if (spec.series_colors) {
        expect(q(svg, "rect.tbl-treemap-strip").find((r) => r.getAttribute("data-series") === "constructor")!.getAttribute("fill"))
          .toBe(tokens.scales.green["700"]);
      }
      expect(tileOf(svg, "toString one").getAttribute("aria-label")).toMatch(new RegExp(`^${want[1]} · toString one, `));

      document.body.innerHTML = "";
      const host = document.createElement("div");
      document.body.append(host);
      mountChart(host, { spec, rows: protoRows, width: 920 });
      const live = host.querySelector<SVGSVGElement>("svg.tbl-treemap")!;
      expect(new Set(stripNames(live))).toEqual(new Set(want));
      tileOf(live, "__proto__ one").dispatchEvent(new PointerEvent("pointerenter", { clientX: 10, clientY: 10 }));
      expect(document.querySelector(".tbl-tooltip .tbl-tooltip-head")!.textContent).toBe("__proto__ · __proto__ one");

      const exported = buildExportSvg(spec, protoRows).querySelector<SVGSVGElement>(`svg.${TREEMAP_CLASS}`)!;
      expect(new Set(stripNames(exported))).toEqual(new Set(want));

      expect(treemapWarnings(spec, protoRows)).toEqual([]);
    });
  }

  it("an own __proto__ key in series_labels (as JSON or YAML parsing makes one) renames that group", () => {
    const spec = { ...SPEC, series_labels: JSON.parse('{"__proto__": "Proto group"}') } as ChartSpec;
    expect(Object.hasOwn(spec.series_labels!, "__proto__")).toBe(true);
    const { svg } = renderChart(spec, protoRows, { width: 920 });
    expect(new Set(stripNames(svg))).toEqual(new Set(["constructor", "toString", "Proto group"]));
  });
});

describe("treemap background", () => {
  it("paints the treemap area white under the tiles and strips, so gutters are white on any host", () => {
    const rows = rowsOf([["Big", 1_000_000], ...Array.from({ length: 4 }, (_, i): [string, number] => [`Tiny ${i}`, 1])]);
    for (const [spec, data, width] of [[FLAT_SPEC, rows, 375], [GROUPED_SPEC, GROUPED, 920]] as const) {
      const { svg } = render(spec, data, width);
      const bg = svg.firstElementChild!;
      expect(bg.tagName).toBe("rect");
      expect(bg.getAttribute("class")).toBe("tbl-treemap-bg");
      expect(bg.getAttribute("fill")).toBe(WHITE);
      expect([num(bg, "x"), num(bg, "y"), num(bg, "width"), num(bg, "height")])
        .toEqual([0, 0, width, Math.round(treemapAreaHeight(width) * 100) / 100]);
      expect(q(svg, "rect.tbl-treemap-bg")).toHaveLength(1);
    }
    // The key sits below the area, on the card: the background stops at the area.
    const keyed = render(FLAT_SPEC, rows, 375).svg;
    expect(q(keyed, "text.tbl-treemap-key").length).toBeGreaterThan(0);
    expect(num(keyed.firstElementChild!, "height")).toBeLessThan(num(keyed, "height"));
  });
});
