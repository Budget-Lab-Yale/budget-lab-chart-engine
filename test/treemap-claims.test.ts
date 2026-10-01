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
import { validateSpec } from "../src/spec/validate";
import { renderChart } from "../src/engine/index";
import { mountChart } from "../src/engine/render-live";
import { tokens } from "../src/theme/tokens";
import { TM_KEY_PREFIX, TM_NAME_SIZES } from "../src/engine/treemap-labels";
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
const keyLine = (svg: SVGSVGElement): string => q(svg, "text.tbl-treemap-key").map((t) => t.textContent).join(" · ");

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
  });
});

describe("series_labels on a treemap", () => {
  it("renames a group in its strip and in the key, for its strip-less entry and its tiles' entries", () => {
    const r = rows([["A", "a1", 300], ["A", "a2", 200], ["B", "b1", 1], ["C", "c1", 1_000_000], ["C", "c2", 1]]);
    const spec = { ...TM, series_labels: { A: "Alpha group", B: "Beta group", C: "Gamma group" } } as ChartSpec;
    const { svg } = renderChart(spec, r, { width: 375 });
    const strip = q(svg, "text.tbl-treemap-strip-label").map((t) => t.textContent);
    expect(strip.some((s) => s!.startsWith("Gamma group"))).toBe(true);
    const key = keyLine(svg);
    expect(key).toContain("Beta group: ");
    expect(key).toContain("c2 (Gamma group) ");
    expect(key).not.toMatch(/\b[ABC]:|\([ABC]\)/);
  });
});

describe("tile label sizes", () => {
  it("run from 20px down to 11px", () => {
    expect([...TM_NAME_SIZES]).toEqual([20, 17, 15, 13, 12, 11]);
  });
});

describe("treemap.shading", () => {
  it("none: every tile is its group's base hue; flat data is blue", () => {
    const grouped = renderChart({ ...TM, treemap: { shading: "none" } } as ChartSpec, TWO, { width: 920 }).svg;
    expect(tileFills(grouped, "A")).toEqual(Array(3).fill(tokens.categorical[0]!.base));
    expect(tileFills(grouped, "B")).toEqual(Array(3).fill(tokens.categorical[1]!.base));
    const flat = renderChart({ ...FLAT, treemap: { shading: "none" } } as ChartSpec, flatRows([["x", 5], ["y", 3], ["z", 1]]), { width: 920 }).svg;
    for (const n of ["x", "y", "z"]) expect(tileFill(flat, n)).toBe(tokens.categorical[0]!.base);
  });

  it("size (default) with groups: tiles run 600 → 100 by rank, the 700 tier is the strip's", () => {
    const { svg } = renderChart(TM, TWO, { width: 920 });
    expect(tileFills(svg, "A")).toEqual([tokens.scales.blue["600"], tokens.scales.blue["300"], tokens.scales.blue["100"]]);
  });
});

describe("the key's number follows label_value", () => {
  // One large tile and two too small to label at 375, so both land in the key.
  const R = flatRows([["Big", 1_000_000], ["Tiny one", 1], ["Tiny two", 1]]);
  const key = (labelValue?: "share" | "value" | "none") =>
    keyLine(renderChart({ ...FLAT, value_format: { prefix: "$" }, ...(labelValue ? { treemap: { label_value: labelValue } } : {}) } as ChartSpec, R, { width: 375 }).svg);

  it("share by default and with none; the formatted value with value", () => {
    expect(key()).toBe(`${TM_KEY_PREFIX} Tiny one 0.0% · Tiny two 0.0%`);
    expect(key("none")).toBe(`${TM_KEY_PREFIX} Tiny one 0.0% · Tiny two 0.0%`);
    expect(key("value")).toBe(`${TM_KEY_PREFIX} Tiny one $1 · Tiny two $1`);
  });
});

describe("treemap accessibility", () => {
  it("the root svg is a role=group labelled with the title; drawn label text is aria-hidden, the key is not", () => {
    const { svg } = renderChart(TM, TWO, { width: 375 });
    expect(svg.getAttribute("role")).toBe("group");
    expect(svg.getAttribute("aria-label")).toBe("Outlays");
    const hidden = q(svg, "text.tbl-treemap-label, text.tbl-treemap-strip-label");
    expect(hidden.length).toBeGreaterThan(0);
    for (const t of hidden) expect(t.getAttribute("aria-hidden")).toBe("true");
    for (const t of q(svg, "text.tbl-treemap-key")) expect(t.hasAttribute("aria-hidden")).toBe(false);
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
