// @vitest-environment jsdom
//
// CONFIG-SPEC "Treemap options" claims that no other treemap test pins at the level the doc states
// them. CONFIG-SPEC.md is vendored verbatim by budget-lab-charts, so each sentence here is a promise
// to figure authors; every test below would fail if the behaviour it backs were removed.
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { validateSpec, validateChartData } from "../src/spec/validate";
import { layoutTreemap } from "../src/engine/treemap-layout";
import { renderChart, renderFigure } from "../src/engine/index";
import { mountChart } from "../src/engine/render-live";
import { tokens } from "../src/theme/tokens";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

beforeEach(() => {
  document.body.innerHTML = "";
});

const TM = {
  chartType: "treemap", title: "Outlays", xAxisType: "categorical", data: "d.csv",
  columns: { x: "category", value: "amount", series: "group" },
} as ChartSpec;
const FLAT = { ...TM, columns: { x: "category", value: "amount" } } as ChartSpec;
const rows = (r: Array<[string, string, number]>): TidyRow[] =>
  r.map(([group, category, amount]) => ({ group, category, amount: String(amount) }) as TidyRow);
const flatRows = (r: Array<[string, number]>): TidyRow[] =>
  r.map(([category, amount]) => ({ category, amount: String(amount) }) as TidyRow);
const q = <E extends Element = Element>(root: ParentNode, sel: string): E[] => [...root.querySelectorAll<E>(sel)];
const tileFill = (svg: SVGSVGElement, name: string): string =>
  q(svg, "g[role=img]").find((g) => (g.getAttribute("aria-label") ?? "").split(", ")[0]!.split(" · ").pop() === name)!
    .querySelector("rect")!.getAttribute("fill")!;
const tileFills = (svg: SVGSVGElement, group: string): string[] =>
  q(svg, "g[role=img]").filter((g) => g.getAttribute("data-series") === group).map((g) => g.querySelector("rect")!.getAttribute("fill")!);
const stripFillOf = (svg: SVGSVGElement, group: string): string | null =>
  q(svg, "rect.tbl-treemap-strip").find((s) => s.getAttribute("data-series") === group)?.getAttribute("fill") ?? null;

// Two large groups whose strips fit at 920, each with three tiles.
const TWO = rows([
  ["A", "a1", 300], ["A", "a2", 200], ["A", "a3", 100],
  ["B", "b1", 250], ["B", "b2", 150], ["B", "b3", 80],
]);

describe("series_order on a treemap: hue order and tie-break only", () => {
  it("does not filter: an unlisted group still draws", () => {
    const { svg } = renderChart({ ...TM, series_order: ["B"] } as ChartSpec, TWO, { width: 920 });
    expect(tileFills(svg, "A")).toHaveLength(3);
    expect(tileFills(svg, "B")).toHaveLength(3);
  });

  it("sets the hue order: listed groups take blue, amber, … in series_order order", () => {
    const def = renderChart(TM, TWO, { width: 920 }).svg;
    expect(stripFillOf(def, "A")).toBe(tokens.scales.blue["700"]);
    expect(stripFillOf(def, "B")).toBe(tokens.scales.amber["700"]);
    const swapped = renderChart({ ...TM, series_order: ["B", "A"] } as ChartSpec, TWO, { width: 920 }).svg;
    expect(stripFillOf(swapped, "B")).toBe(tokens.scales.blue["700"]);
    expect(stripFillOf(swapped, "A")).toBe(tokens.scales.amber["700"]);
  });

  it("does not set the layout order: the larger group is drawn first whatever series_order says", () => {
    const { svg } = renderChart({ ...TM, series_order: ["B", "A"] } as ChartSpec, TWO, { width: 920 });
    expect(q(svg, "rect.tbl-treemap-strip").map((s) => s.getAttribute("data-series"))).toEqual(["A", "B"]);
  });

  it("breaks a tie between equal group totals", () => {
    const tied = rows([["A", "a1", 300], ["A", "a2", 200], ["B", "b1", 300], ["B", "b2", 200]]);
    const first = (spec: ChartSpec) => q(renderChart(spec, tied, { width: 920 }).svg, "rect.tbl-treemap-strip")[0]!.getAttribute("data-series");
    expect(first(TM)).toBe("A");
    expect(first({ ...TM, series_order: ["B", "A"] } as ChartSpec)).toBe("B");
  });

  it("breaks a tie between decimal totals that float addition makes unequal (0.1 + 0.2 vs 0.3)", () => {
    const tied = rows([["A", "a1", 0.1], ["A", "a2", 0.2], ["B", "b1", 0.3]]);
    const first = (spec: ChartSpec) => q(renderChart(spec, tied, { width: 920 }).svg, "rect.tbl-treemap-strip")[0]!.getAttribute("data-series");
    expect(first(TM)).toBe("A");
    expect(first({ ...TM, series_order: ["B", "A"] } as ChartSpec)).toBe("B");
  });
});

describe("series_colors on a treemap", () => {
  it("a hue name or one of its tiers picks that hue family: its tiers shade the tiles, 700 fills the strip", () => {
    const { svg } = renderChart({ ...TM, series_colors: { A: "violet-300", B: "green" } } as ChartSpec, TWO, { width: 920 });
    expect(stripFillOf(svg, "A")).toBe(tokens.scales.violet["700"]);
    expect(stripFillOf(svg, "B")).toBe(tokens.scales.green["700"]);
    const violet = Object.values(tokens.scales.violet) as string[];
    for (const f of tileFills(svg, "A")) expect(violet).toContain(f);
    expect(new Set(tileFills(svg, "A")).size).toBe(3);
  });

  it("a colour on no hue ramp fills the group's strip and every tile as written", () => {
    const { svg } = renderChart({ ...TM, series_colors: { A: "#5B4B8A" } } as ChartSpec, TWO, { width: 920 });
    expect(stripFillOf(svg, "A")).toBe("#5B4B8A");
    expect(tileFills(svg, "A")).toEqual(["#5B4B8A", "#5B4B8A", "#5B4B8A"]);
  });

  it("past seven groups without series_colors the hues repeat: an eighth group shades like the first", () => {
    const eight = rows(Array.from({ length: 8 }, (_, i): [string, string, number] => [`G${i}`, `t${i}`, 100 - i]));
    const { svg } = renderChart(TM, eight, { width: 920 });
    expect(tileFills(svg, "G7")).toEqual(tileFills(svg, "G0"));
    expect(stripFillOf(svg, "G7")).not.toBeNull();
    expect(stripFillOf(svg, "G7")).toBe(stripFillOf(svg, "G0"));
  });
});

describe("layout sort ties: equal to 12 significant digits", () => {
  const datum = (name: string, value: number, index: number) => ({ index, name, group: null, value, row: {} as TidyRow });
  const order = (a: number, b: number) =>
    layoutTreemap([datum("a", a, 0), datum("b", b, 1)], 920, 460, { groupOrder: [] }).tiles.map((t) => t.datum.name);
  it("tile values equal to 12 significant digits keep their CSV order; a difference in the 12th digit sorts", () => {
    expect(order(1, 1.0000000000001)).toEqual(["a", "b"]);
    expect(order(1, 1.00000000001)).toEqual(["b", "a"]);
  });
});

describe("series_labels on a treemap", () => {
  it("renames a group in its strip, the hover card and the screen-reader labels", () => {
    const spec = { ...TM, series_labels: { A: "Alpha group", B: "Beta group" } } as ChartSpec;
    const { svg } = renderChart(spec, TWO, { width: 920 });
    expect(q(svg, "text.tbl-treemap-strip-label").map((t) => t.firstElementChild!.textContent)).toEqual(["Alpha group", "Beta group"]);
    const aria = q(svg, "g[role=img]").map((g) => g.getAttribute("aria-label")!);
    expect(aria.filter((a) => a.startsWith("Beta group · b"))).toHaveLength(3);
    expect(aria.some((a) => /^[AB] · /.test(a))).toBe(false);
    const host = document.createElement("div");
    document.body.append(host);
    mountChart(host, { spec, rows: TWO, width: 920 });
    q(host, "svg.tbl-treemap g[role=img]")[0]!.dispatchEvent(new PointerEvent("pointerenter", { clientX: 10, clientY: 10 }));
    expect(document.querySelector(".tbl-tooltip .tbl-tooltip-head")!.textContent).toBe("Alpha group · a1");
  });
});

describe("tile label sizes", () => {
  // Many tiles of very different sizes and name lengths, so the old per-tile ladder would have
  // drawn several sizes.
  const MANY = flatRows([
    ["Housing", 28452], ["Transportation", 13174], ["Food", 10990], ["Personal insurance and pensions", 9556],
    ["Healthcare", 6159], ["Entertainment", 3635], ["Cash contributions", 2531], ["Apparel and services", 2041],
    ["Education", 1656], ["Other", 1500], ["Personal care", 950], ["Reading", 117],
  ]);
  // The same tiles in three groups.
  const MANY_GROUPED = rows(MANY.map((r, i): [string, string, number] => [["Core", "Other", "Small"][Math.min(2, Math.floor(i / 4))]!, r.category as string, Number(r.amount)]));
  // Every drawn text span: an inline tile label and a strip label carry the size on the <text>, a
  // stacked tile label on each <tspan>.
  const drawn = (svg: SVGSVGElement, sel = "text"): Array<[string, string]> =>
    q(svg, `${sel} tspan`).map((s) => [(s.getAttribute("font-size") ?? s.parentElement!.getAttribute("font-size"))!, s.getAttribute("font-weight")!]);

  it("one size in a whole chart: 14px at 600px wide and over, 12px below; the name 700, its number 500 at that size", () => {
    for (const [w, size] of [[920, "14"], [600, "14"], [599, "12"], [375, "12"]] as const) {
      for (const [spec, data] of [[FLAT, MANY], [TM, MANY_GROUPED]] as const) {
        const { svg } = renderChart(spec, data, { width: w });
        const spans = drawn(svg);
        expect(drawn(svg, "text.tbl-treemap-label").length).toBeGreaterThan(4);
        expect(new Set(spans.map(([s]) => s))).toEqual(new Set([size]));
        expect(new Set(spans.map(([, wt]) => wt))).toEqual(new Set(["700", "500"]));
      }
    }
  });

  it("group strip text is the tile labels' size too: name 700, share 500", () => {
    for (const [w, size] of [[920, "14"], [375, "12"]] as const) {
      const strips = q(renderChart(TM, MANY_GROUPED, { width: w }).svg, "text.tbl-treemap-strip-label");
      expect(strips.length).toBeGreaterThan(0);
      for (const s of strips) {
        expect(s.getAttribute("font-size")).toBe(size);
        expect([...s.children].map((c) => c.getAttribute("font-weight"))).toEqual(s.children.length === 2 ? ["700", "500"] : ["700"]);
      }
    }
  });
});

describe("treemap.shading", () => {
  it("none: every tile is its group's colour as resolved — a series_colors value as written, a tier included", () => {
    const { svg } = renderChart({ ...TM, series_colors: { A: "violet-300", B: "#5B4B8A" }, treemap: { shading: "none" } } as ChartSpec, TWO, { width: 920 });
    expect(tileFills(svg, "A")).toEqual(Array(3).fill(tokens.scales.violet["300"]));
    expect(tokens.scales.violet["300"]).not.toBe(tokens.categorical.find((c) => c.key === "violet")!.base);
    expect(tileFills(svg, "B")).toEqual(Array(3).fill("#5B4B8A"));
  });

  it("none: every tile is its group's base hue; flat data is blue", () => {
    const grouped = renderChart({ ...TM, treemap: { shading: "none" } } as ChartSpec, TWO, { width: 920 }).svg;
    expect(tileFills(grouped, "A")).toEqual(Array(3).fill(tokens.categorical[0]!.base));
    expect(tileFills(grouped, "B")).toEqual(Array(3).fill(tokens.categorical[1]!.base));
    const flat = renderChart({ ...FLAT, treemap: { shading: "none" } } as ChartSpec, flatRows([["x", 5], ["y", 3], ["z", 1]]), { width: 920 }).svg;
    for (const n of ["x", "y", "z"]) expect(tileFill(flat, n)).toBe(tokens.categorical[0]!.base);
  });

  it("size: the 50 tier is never used, even when series_colors names it; none: only when series_colors sets it", () => {
    const fifties = new Set(Object.values(tokens.scales).map((s) => (s as Record<string, string>)["50"]));
    const many = rows([
      ...Array.from({ length: 12 }, (_, i): [string, string, number] => ["A", `a${i}`, 100 - i]),
      ...Array.from({ length: 12 }, (_, i): [string, string, number] => ["B", `b${i}`, 90 - i]),
    ]);
    const flatMany = flatRows(Array.from({ length: 12 }, (_, i): [string, number] => [`t${i}`, 100 - i]));
    const allFills = (svg: SVGSVGElement): string[] =>
      [...q(svg, "rect.tbl-treemap-tile"), ...q(svg, "rect.tbl-treemap-strip")].map((r) => r.getAttribute("fill")!);
    // shading: size (default), grouped and flat, a 50-tier series_colors included: no fill is a 50 tier.
    for (const svg of [
      renderChart(TM, many, { width: 920 }).svg,
      renderChart({ ...TM, series_colors: { A: "blue-50", B: "amber-50" } } as ChartSpec, many, { width: 920 }).svg,
      renderChart(FLAT, flatMany, { width: 920 }).svg,
    ]) for (const f of allFills(svg)) expect(fifties.has(f)).toBe(false);
    // shading: none: the default hues are not 50 tiers, so without series_colors none appears ...
    const none = { ...TM, treemap: { shading: "none" } } as ChartSpec;
    for (const f of allFills(renderChart(none, many, { width: 920 }).svg)) expect(fifties.has(f)).toBe(false);
    // ... and a series_colors 50 tier fills its group's tiles as written (its strip stays 700).
    const svg = renderChart({ ...none, series_colors: { A: "blue-50" } } as ChartSpec, many, { width: 920 }).svg;
    expect(new Set(tileFills(svg, "A"))).toEqual(new Set([tokens.scales.blue["50"]]));
    expect(stripFillOf(svg, "A")).toBe(tokens.scales.blue["700"]);
  });

  it("none, no series_colors, past seven groups: the 8th-14th groups take the palette's lighter repeats, amber-50 and rose-50 among them", () => {
    const groups = (n: number): TidyRow[] => rows(Array.from({ length: n }, (_, i): [string, string, number] => [`G${i}`, `t${i}`, 100 - i]));
    const none = { ...TM, treemap: { shading: "none" } } as ChartSpec;
    const light = ["blue-200", "amber-50", "violet-200", "green-100", "red-200", "rose-50", "russet-300"]
      .map((ref) => { const [h, t] = ref.split("-"); return (tokens.scales as Record<string, Record<string, string>>)[h!]![t!]!; });
    // The first seven groups are their hue's base colour; the 8th onward the lighter repeat, cycling.
    const svg15 = renderChart(none, groups(15), { width: 920 }).svg;
    for (let i = 0; i < 7; i++) expect(tileFills(svg15, `G${i}`)).toEqual([tokens.categorical[i]!.base]);
    for (let i = 7; i < 15; i++) expect(tileFills(svg15, `G${i}`)).toEqual([light[(i - 7) % 7]]);
    // 9 groups: the 9th is amber-50; 13 groups: the 13th is rose-50 — 50 tiers with no series_colors.
    expect(tileFills(renderChart(none, groups(9), { width: 920 }).svg, "G8")).toEqual([tokens.scales.amber["50"]]);
    expect(tokens.scales.amber["50"]).toBe("#FFC63D");
    expect(tileFills(renderChart(none, groups(13), { width: 920 }).svg, "G12")).toEqual([tokens.scales.rose["50"]]);
    // A group with its own series_colors entry still counts toward the order.
    const own = renderChart({ ...none, series_colors: { G0: "green" } } as ChartSpec, groups(9), { width: 920 }).svg;
    expect(tileFills(own, "G8")).toEqual([tokens.scales.amber["50"]]);
    // shading: size never draws those 50 tiers: the repeat takes its hue family's tiers.
    const fifties = new Set(Object.values(tokens.scales).map((s) => (s as Record<string, string>)["50"]));
    const sized = renderChart(TM, groups(13), { width: 920 }).svg;
    for (const r of [...q(sized, "rect.tbl-treemap-tile"), ...q(sized, "rect.tbl-treemap-strip")]) expect(fifties.has(r.getAttribute("fill")!)).toBe(false);
  });

  it("size (default) with groups: tiles run 600 → 100 by rank, the 700 tier is the strip's", () => {
    const { svg } = renderChart(TM, TWO, { width: 920 });
    expect(tileFills(svg, "A")).toEqual([tokens.scales.blue["600"], tokens.scales.blue["300"], tokens.scales.blue["100"]]);
  });
});

describe("no key", () => {
  it("an unlabelled tile is described in full by its aria-label, both numbers whatever label_value says", () => {
    const R = flatRows([["Big", 1_000_000], ["Tiny one", 1], ["Tiny two", 1]]);
    for (const labelValue of ["share", "value", "none"] as const) {
      const spec = { ...FLAT, value_format: { prefix: "$" }, treemap: { label_value: labelValue } } as ChartSpec;
      const { svg } = renderChart(spec, R, { width: 375 });
      expect(q(svg, "text").map((t) => t.getAttribute("class"))).toEqual(["tbl-treemap-label"]);
      const tiny = q(svg, "g[role=img]").filter((g) => !g.querySelector("text")).map((g) => g.getAttribute("aria-label"));
      expect(tiny).toEqual(["Tiny one, 0.0% of total, $1", "Tiny two, 0.0% of total, $1"]);
    }
  });
});

describe("tile areas: proportional to value, less the gutters", () => {
  const area = (svg: SVGSVGElement, name: string): number => {
    const r = q(svg, "g[role=img]").find((g) => g.getAttribute("aria-label")!.split(", ")[0] === name)!.querySelector("rect")!;
    return Number(r.getAttribute("width")) * Number(r.getAttribute("height"));
  };
  it("the fixed gutters take relatively more from a smaller tile", () => {
    const vals: Array<[string, number]> = [["a", 600], ["b", 300], ["c", 60], ["d", 10]];
    const { svg } = renderChart(FLAT, flatRows(vals), { width: 920 });
    const perUnit = vals.map(([n, v]) => area(svg, n) / v);
    for (let i = 1; i < perUnit.length; i++) expect(perUnit[i]!).toBeLessThan(perUnit[i - 1]!);
    expect(perUnit[0]! / perUnit[3]!).toBeGreaterThan(1.02);
    expect(perUnit[0]! / perUnit[3]!).toBeLessThan(1.15);
  });
  it("a sliver can be left with no area at all", () => {
    const { svg } = renderChart(FLAT, flatRows([["Big", 1_000_000], ["Tiny", 1]]), { width: 920 });
    expect(area(svg, "Tiny")).toBe(0);
  });
  it("a header strip costs its group's tiles nothing: equal values draw equal tiles, strip or not, less the gutters", () => {
    const data = [["A", "a1"], ["A", "a2"], ["B", "b1"], ["B", "b2"]].map(([group, name], index) =>
      ({ index, name: name!, group: group!, value: 100, row: {} as TidyRow }));
    const at = (gutters?: { tile: number; group: number }) => {
      const l = layoutTreemap(data, 920, 460, { groupOrder: ["A", "B"], stripFits: (g) => g.group === "A", ...(gutters ? { gutters } : {}) });
      expect(l.groups.map((g) => [g.group, g.strip])).toEqual([["A", true], ["B", false]]);
      return (n: string) => { const t = l.tiles.find((x) => x.datum.name === n)!; return (t.x1 - t.x0) * (t.y1 - t.y0); };
    };
    const exact = at({ tile: 0, group: 0 });
    expect(Math.abs(exact("a1") - exact("b1")) / exact("b1")).toBeLessThan(1e-4);
    const drawn = at();
    expect(Math.abs(drawn("a1") - drawn("b1")) / drawn("b1")).toBeLessThan(0.02);
  });
});

describe("series_order: [] is no filter", () => {
  it("validates and draws every series on a bar chart", () => {
    const spec = { chartType: "bar", title: "b", xAxisType: "categorical", data: "d.csv", series_order: [] } as unknown as ChartSpec;
    const r = [{ time: "A", series: "S1", value: "3" }, { time: "A", series: "S2", value: "5" }] as unknown as TidyRow[];
    expect(validateSpec(spec)).toEqual({ valid: true, errors: [] });
    expect(validateChartData(spec, r)).toEqual({ valid: true, errors: [] });
    const { svg } = renderChart(spec, r, { width: 720, height: 400 });
    expect(q(svg, 'g[aria-label="bar"] rect')).toHaveLength(2);
    const listed = renderChart({ ...spec, series_order: ["S1"] } as ChartSpec, r, { width: 720, height: 400 }).svg;
    expect(q(listed, 'g[aria-label="bar"] rect')).toHaveLength(1);
  });

  it("draws every series in each small-multiples pane too", () => {
    const spec = {
      chartType: "bar", title: "b", xAxisType: "categorical", data: "d.csv", series_order: [],
      columns: { x: "time", value: "value", series: "series", facet: "pane" }, small_multiples: { columns: 2 },
    } as unknown as ChartSpec;
    const r = ["P1", "P2"].flatMap((pane) => [{ pane, time: "A", series: "S1", value: "3" }, { pane, time: "A", series: "S2", value: "5" }]) as unknown as TidyRow[];
    const bars = (s: ChartSpec) => renderFigure(s, r, { width: 838, height: 420, document }).panes.map((p) => q(p.svg!, 'g[aria-label="bar"] rect').length);
    expect(bars(spec)).toEqual([2, 2]);
    expect(bars({ ...spec, series_order: ["S2"] } as ChartSpec)).toEqual([1, 1]);
  });
});

describe("treemap accessibility", () => {
  it("the root svg is a role=group labelled with the title; all drawn text is aria-hidden", () => {
    const { svg } = renderChart(TM, TWO, { width: 375 });
    expect(svg.getAttribute("role")).toBe("group");
    expect(svg.getAttribute("aria-label")).toBe("Outlays");
    const hidden = q(svg, "text.tbl-treemap-label, text.tbl-treemap-strip-label");
    expect(hidden.length).toBeGreaterThan(0);
    for (const t of hidden) expect(t.getAttribute("aria-hidden")).toBe("true");
    expect(q(svg, "text")).toHaveLength(hidden.length);
  });

  it("tiles are not keyboard-focusable: nothing in the mounted chart carries a tabindex", () => {
    const host = document.createElement("div");
    document.body.append(host);
    mountChart(host, { spec: TM, rows: TWO, width: 920 });
    const svg = host.querySelector("svg.tbl-treemap")!;
    expect(q(svg, "[tabindex]")).toHaveLength(0);
  });
});

describe("treemap hover: no onHover / tbl-hover", () => {
  it("hovering a tile shows the card but neither calls onHover nor dispatches tbl-hover", () => {
    const host = document.createElement("div");
    document.body.append(host);
    let calls = 0;
    let events = 0;
    host.addEventListener("tbl-hover", () => { events++; });
    mountChart(host, { spec: TM, rows: TWO, width: 920, onHover: () => { calls++; } });
    const g = host.querySelector("svg.tbl-treemap g[role=img]")!;
    g.dispatchEvent(new PointerEvent("pointerenter", { clientX: 10, clientY: 10 }));
    g.dispatchEvent(new PointerEvent("pointermove", { clientX: 12, clientY: 12, bubbles: true }));
    expect(document.querySelector<HTMLElement>(".tbl-tooltip")!.style.opacity).toBe("1");
    g.dispatchEvent(new PointerEvent("pointerleave", { clientX: 10, clientY: 10 }));
    expect(calls).toBe(0);
    expect(events).toBe(0);
  });
});

describe("hover card Value row decimals", () => {
  it("defaults to value_format.decimals when tooltip_decimals is unset", () => {
    const host = document.createElement("div");
    document.body.append(host);
    mountChart(host, { spec: { ...FLAT, value_format: { prefix: "$", decimals: 1 } } as ChartSpec, rows: flatRows([["Housing", 28452], ["Food", 10990]]), width: 920 });
    host.querySelector("svg.tbl-treemap g[role=img]")!.dispatchEvent(new PointerEvent("pointerenter", { clientX: 10, clientY: 10 }));
    expect(document.querySelector(".tbl-tooltip .tbl-tooltip-value")!.textContent).toBe("$28,452.0");
  });
});

describe("CONFIG-SPEC's treemap examples", () => {
  it("every yaml block with chartType: treemap validates", () => {
    const doc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "CONFIG-SPEC.md"), "utf8");
    const blocks = [...doc.matchAll(/```yaml\r?\n([\s\S]*?)```/g)].map((m) => m[1]!).filter((b) => /^chartType: treemap$/m.test(b));
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const b of blocks) expect(validateSpec(parseYaml(b))).toEqual({ valid: true, errors: [] });
  });
});

describe("value_format's thousands grouping is treemap-only", () => {
  it("a dumbbell's gap label prints the same format without separators", () => {
    const spec = {
      chartType: "dumbbell", title: "d", xAxisType: "categorical", data: "d.csv",
      columns: { category: "cat", series: "s", value: "v" }, gap_annotation: true, value_format: { prefix: "$" },
    } as unknown as ChartSpec;
    const r = [{ cat: "Q", s: "a", v: "1000" }, { cat: "Q", s: "b", v: "3234.5" }] as unknown as TidyRow[];
    const { svg } = renderChart(spec, r, { width: 720, height: 400 });
    expect(q(svg, "g.tbl-dumbbell-gap text").map((t) => t.textContent)).toEqual(["Δ$2234.5"]);
  });
});
