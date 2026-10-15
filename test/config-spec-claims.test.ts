// @vitest-environment jsdom
//
// CONFIG-SPEC.md claims corrected in T2.10 (review 2026-10-15), one block per claim. CONFIG-SPEC is
// vendored verbatim by budget-lab-charts and gated in its CI, so each sentence it makes is a promise
// to figure authors and embedders. Every test here would fail if the sentence it backs were false;
// the section a test backs is named in its describe().
//
// These describe what the code does TODAY. Several (colours, throwing hooks, annotation-row dedupe,
// rug cover) document behaviour a later phase may tighten — when it does, this file and the doc
// move together.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The PNG download's own entry point, replaced so a test can see what a mount hands it. Everything
// else in the module (buildExportSvg) stays real.
vi.mock("../src/embed/export-png", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/embed/export-png")>();
  return { ...mod, exportChartPng: vi.fn(async () => {}) };
});

import { validateSpec, validateChart } from "../src/spec/validate";
import { validateTableSpec } from "../src/spec/table-validate";
import { renderChart } from "../src/engine/index";
import { mountChart } from "../src/engine/render-live";
import { mountTable } from "../src/table/mount";
import { buildExportSvg, exportChartPng } from "../src/embed/export-png";
import { parseRich } from "../src/table/richtext";
import { resolveRugTracks } from "../src/spec/rug";
import { RUG_CLASS } from "../src/engine/rug";
import { CAT_LABEL_CLASS } from "../src/engine/axes";
import { SHADE_CLASS } from "../src/engine/marks/line";
import { resolveColor } from "../src/engine/palette";
import { TBL_COLORS } from "../src/spec/color-ref";
import { TBL } from "../src/engine/theme";
import { d3 } from "../src/engine/vendor";
import { mockRect1to1, hoverFirstMark, cardShown, cardHtml, BAR_MARK } from "./helpers/hover-harness";
import { CROSSHAIR_HIT_SELECTOR } from "../src/engine/crosshair";
import { buildTableExportSvg } from "../src/embed/export-table-png";
import type { ChartSpec } from "../src/spec/types";
import type { TableSpec } from "../src/spec/table-types";
import type { TidyRow } from "../src/data/index";
import type { RenderHooks } from "../src/spec/hooks";

const rows = (r: Array<Record<string, string>>): TidyRow[] => r as unknown as TidyRow[];
const spec = (s: Record<string, unknown>): ChartSpec => s as unknown as ChartSpec;

beforeEach(() => {
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------------------------
// Colors: the forms validation accepts today, and what each paints.
// ---------------------------------------------------------------------------------------------
describe("CONFIG-SPEC Colors: accepted forms", () => {
  const BAR = spec({ chartType: "bar", title: "t", xAxisType: "categorical", data: "d.csv" });
  const ROWS = rows([{ time: "A", value: "6" }, { time: "B", value: "3" }]);
  const ok = (c: string): boolean => validateSpec({ ...BAR, bar_color: c }).valid;
  const barFill = (c: string): string | null =>
    renderChart({ ...BAR, bar_color: c }, ROWS, { width: 600, height: 300, document })
      .svg.querySelector('g[aria-label="bar"]')!.getAttribute("fill");

  it("a non-palette value reaches the renderer unchanged", () => {
    expect(barFill("#1A1A2E")).toBe("#1A1A2E");
    expect(barFill("steelblue")).toBe("steelblue");
    expect(barFill("rgb(0,114,178)")).toBe("rgb(0,114,178)");
  });

  it("# plus 3 to 8 hex digits, in any case; a 5- or 7-digit value passes though it is not valid CSS", () => {
    for (const c of ["#abc", "#ABCD", "#1A1A2E", "#1a1a2e80", "#12345", "#1234567"]) expect(ok(c), c).toBe(true);
    for (const c of ["#ab", "#123456789", "#ggg"]) expect(ok(c), c).toBe(false);
    // jsdom's CSS parser, as a browser's: a 6-digit hex is a colour, a 5-digit one is dropped.
    const parsed = (c: string): string => {
      const el = document.createElement("div");
      el.style.color = c;
      return el.style.color;
    };
    expect(parsed("#123456")).not.toBe("");
    expect(parsed("#12345")).toBe("");
    expect(parsed("#1234567")).toBe("");
  });

  it("a 5- or 7-digit hex under a texture passes validation and fails at render", () => {
    for (const c of ["#12345", "#1234567"]) {
      const textured = spec({ ...BAR, bar_color: c, series_patterns: { "": "/" } });
      expect(validateSpec(textured).valid, c).toBe(true);
      expect(() => renderChart(textured, ROWS, { width: 600, height: 300, document }), c).toThrow(/cannot derive a hatch band/);
    }
  });

  it("the named CSS functions, whatever their parentheses hold", () => {
    for (const fn of ["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color", "color-mix", "var", "url"]) {
      expect(ok(`${fn}(0 1 2)`), fn).toBe(true);
    }
    expect(ok("rgb(foo)")).toBe(true);
    expect(ok("calc(1)")).toBe(false);
  });

  it("CSS keywords from Plot's list, in any case, including transparent, none and currentColor — but not yellowgreen", () => {
    for (const c of ["steelblue", "SteelBlue", "transparent", "none", "currentColor"]) expect(ok(c), c).toBe(true);
    expect(ok("yellowgreen")).toBe(false);
    // yellowgreen IS a CSS colour; Plot's list is what omits it.
    expect(d3.color("yellowgreen")).not.toBeNull();
  });

  it("palette names match exactly: \"Blue\" is the CSS keyword, painted CSS blue, not the palette's blue", () => {
    expect(ok("Blue")).toBe(true);
    expect(barFill("Blue")).toBe("Blue");
    expect(d3.color("Blue")!.formatHex()).toBe("#0000ff");
    expect(resolveColor("blue")!.toLowerCase()).not.toBe("#0000ff");
    expect(TBL_COLORS.Blue).toBeUndefined();
  });

  it("barStack.mono.base is the exception: a categorical hue (or alias) only", () => {
    const STACK = spec({ chartType: "stacked", title: "t", xAxisType: "categorical", data: "d.csv" });
    for (const c of ["blue", "purple"]) expect(validateSpec({ ...STACK, barStack: { mono: { base: c } } }).valid, c).toBe(true);
    for (const c of ["#123456", "steelblue", "rgb(0,114,178)", "navy", "blue-500"]) {
      expect(validateSpec({ ...STACK, barStack: { mono: { base: c } } }).valid, c).toBe(false);
    }
  });

  it("anything else is rejected at load", () => {
    for (const c of ["blu", "blue-450", "BLUE-200", "not a colour"]) expect(ok(c), c).toBe(false);
  });

  it("a 5-digit hex on a line is written as given, and nothing above it supplies a stroke, so the line is not drawn", () => {
    const LINE = spec({ chartType: "line", title: "t", xAxisType: "numeric", data: "d", series_colors: { "": "#12345" } });
    expect(validateSpec(LINE).valid).toBe(true);
    const svg = renderChart(LINE, rows([{ time: "0", value: "1" }, { time: "10", value: "4" }]), { width: 600, height: 300, document }).svg;
    const path = svg.querySelector('g[aria-label="line"] path')!;
    let el: Element | null = path;
    while (el && !el.hasAttribute("stroke")) el = el.parentElement;
    expect(el?.getAttribute("stroke")).toBe("#12345");
    let up: Element | null = el!.parentElement;
    while (up && !up.hasAttribute("stroke")) up = up.parentElement;
    expect(up, "an ancestor supplies a stroke to fall back to").toBeNull();
  });

  it("a 5- or 7-digit hex is written as given; a browser drops it and the mark inherits the chart's currentColor", () => {
    const svg = renderChart({ ...BAR, bar_color: "#12345" }, ROWS, { width: 600, height: 300, document }).svg;
    const g = svg.querySelector('g[aria-label="bar"]')!;
    expect(g.getAttribute("fill")).toBe("#12345");
    let up: Element | null = g.parentElement;
    while (up && !up.hasAttribute("fill")) up = up.parentElement;
    expect(up).toBe(svg);
    expect(svg.getAttribute("fill")).toBe("currentColor");
    expect(svg.style.color).not.toBe("");
  });

  it("every color field takes the CSS forms too", () => {
    const LINE = spec({ chartType: "line", title: "t", xAxisType: "numeric", data: "d" });
    const fields: Array<(c: string) => Record<string, unknown>> = [
      (c) => ({ ...BAR, series_colors: { "": c } }),
      (c) => ({ ...LINE, annotations: { xAxis: [{ x: "1", color: c }] } }),
      (c) => ({ ...LINE, rug: { tracks: [{ label: "R", color: c, intervals: [{ from: "1", to: "2" }] }] } }),
      (c) => ({ ...LINE, shading: [{ color: c }] }),
      (c) => ({ ...LINE, overlays: [{ slope: 1, intercept: 0, color: c }] }),
      (c) => ({ ...BAR, chartType: "dumbbell", connector: { color: c } }),
    ];
    for (const f of fields) {
      for (const c of ["rgb(0,114,178)", "#1A1A2E", "steelblue"]) expect(validateSpec(f(c)).valid, JSON.stringify(f(c))).toBe(true);
      expect(validateSpec(f("blu")).valid).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Series textures: which grounds a texture can sit on, and which bad ones validation misses.
// ---------------------------------------------------------------------------------------------
describe("CONFIG-SPEC Series textures: the color under a texture", () => {
  const BAR = spec({ chartType: "bar", title: "t", xAxisType: "categorical", data: "d.csv", series_patterns: { "": "/" } });
  const ROWS = rows([{ time: "A", value: "6" }, { time: "B", value: "3" }]);
  const draw = (s: ChartSpec): void => { renderChart(s, ROWS, { width: 600, height: 300, document }); };

  it("readable grounds, e.g. a palette name, a 3/4/6/8-digit hex, comma-form rgb(): validate and render", () => {
    for (const c of ["blue", "#abc", "#abcd", "#aabbcc", "#aabbcc80", "rgb(0,114,178)", "rgba(0,114,178,0.5)", "hsl(200,50%,40%)", "hsla(200,50%,40%,0.5)", "steelblue"]) {
      const s = spec({ ...BAR, bar_color: c });
      expect(validateSpec(s).valid, c).toBe(true);
      expect(() => draw(s), c).not.toThrow();
    }
  });

  const UNREADABLE = ["currentColor", "none", "var(--x)", "oklch(0.6 0.1 200)", "color-mix(in srgb, red, blue)", "rgb(0 114 178)"];

  it("an unreadable ground renders without a texture", () => {
    const plain = spec({ chartType: "bar", title: "t", xAxisType: "categorical", data: "d.csv" });
    for (const c of UNREADABLE) {
      expect(validateSpec(spec({ ...plain, bar_color: c })).valid, c).toBe(true);
      expect(() => draw(spec({ ...plain, bar_color: c })), c).not.toThrow();
    }
  });

  it("under a texture, validation catches some: currentColor or oklch() set through series_colors, naming the series", () => {
    const S = spec({ ...BAR, columns: { x: "time", value: "value", series: "s" }, series_patterns: { Up: "/" } });
    for (const c of ["currentColor", "oklch(0.6 0.1 200)"]) {
      const v = validateSpec(spec({ ...S, series_colors: { Up: c } }));
      expect(v.valid, c).toBe(false);
      expect(v.errors.join(" "), c).toMatch(/series "Up"/);
    }
    for (const c of UNREADABLE) expect(validateSpec(spec({ ...BAR, series_colors: { "": c } })).valid, c).toBe(false);
  });

  const GAPS: Array<[string, ChartSpec, () => void]> = [
    ["a 5-digit hex", spec({ ...BAR, bar_color: "#12345" }), () => draw(spec({ ...BAR, bar_color: "#12345" }))],
    ["a comma-form function holding no color", spec({ ...BAR, bar_color: "rgb(foo, bar)" }), () => draw(spec({ ...BAR, bar_color: "rgb(foo, bar)" }))],
    [
      "bar_color on a chart whose one series is named",
      spec({ ...BAR, columns: { x: "time", value: "value", series: "s" }, bar_color: "oklch(0.6 0.1 200)", series_patterns: { Up: "/" } }),
      () => renderChart(
        spec({ ...BAR, columns: { x: "time", value: "value", series: "s" }, bar_color: "oklch(0.6 0.1 200)", series_patterns: { Up: "/" } }),
        rows([{ time: "A", s: "Up", value: "6" }, { time: "B", s: "Up", value: "3" }]),
        { width: 600, height: 300, document },
      ),
    ],
    [
      "category_colors",
      spec({ ...BAR, category_colors: { A: "oklch(0.6 0.1 200)" } }),
      () => draw(spec({ ...BAR, category_colors: { A: "oklch(0.6 0.1 200)" } })),
    ],
    [
      "waterfall.colors",
      spec({ ...BAR, chartType: "waterfall", waterfall: { colors: { increase: "oklch(0.6 0.1 200)" } } }),
      () => draw(spec({ ...BAR, chartType: "waterfall", waterfall: { colors: { increase: "oklch(0.6 0.1 200)" } } })),
    ],
    [
      "a title-selector option's color",
      spec({ ...BAR, title: "t {k}", title_selectors: { k: { options: [{ id: "a", color: "oklch(0.6 0.1 200)" }] } } }),
      () => buildExportSvg(spec({ ...BAR, title: "t {k}", title_selectors: { k: { options: [{ id: "a", color: "oklch(0.6 0.1 200)" }] } } }), ROWS),
    ],
  ];
  for (const [name, s, render] of GAPS) {
    it(`${name} under a texture passes validation and fails at render`, () => {
      const named = (s.columns as { series?: string } | undefined)?.series === "s";
      const data = named ? rows([{ time: "A", s: "Up", value: "6" }, { time: "B", s: "Up", value: "3" }]) : ROWS;
      expect(validateChart(s, data).valid).toBe(true);
      expect(render).toThrow(/cannot derive a hatch band/);
    });
  }
});

// ---------------------------------------------------------------------------------------------
// Inline math & special characters: `\$`.
// ---------------------------------------------------------------------------------------------
describe("CONFIG-SPEC Inline math: \\$ is a literal dollar only beside math or a \\\\ break", () => {
  const text = (s: string): string =>
    parseRich(s).map((r) => (r.kind === "text" ? r.text : r.kind === "break" ? "|" : "")).join("");

  it("with math in the string, \\$ is a dollar sign", () => {
    expect(text("Cost \\$5 \\(x\\)")).toContain("Cost $5 ");
  });
  it("with a \\\\ break in the string, \\$ is a dollar sign", () => {
    expect(text("Cost \\$5 \\\\ more")).toBe("Cost $5 | more");
  });
  it("inside math, \\$ keeps its backslash", () => {
    expect(text("\\(\\text{Cost \\$5}\\)")).toContain("Cost \\$5");
  });
  it("with neither, the text is drawn as written, backslash included", () => {
    expect(text("Cost \\$5")).toBe("Cost \\$5");
  });
});

describe("CONFIG-SPEC Inline math: \\$ in a table, on screen and in the PNG export", () => {
  const MULTI = "Cost \\$5 \\\\ \\(x\\)"; // a \$, a \\ break, and math on the other line
  const T: TableSpec = { title: "t", data: "d", stub: ["grp", { label: "row" }], header: ["per"], value: "v" };
  const build = (r: Record<string, string>): { live: HTMLElement; png: SVGSVGElement } => {
    const live = document.createElement("div");
    document.body.append(live);
    const tr = rows([{ grp: "G", row: "r", per: "p", v: "text", ...r }]);
    mountTable(live, { spec: T, rows: tr });
    return { live, png: buildTableExportSvg(T, tr) };
  };
  const pngTexts = (svg: SVGSVGElement): string[] => [...svg.querySelectorAll("text")].map((t) => t.textContent ?? "");

  for (const [where, field, liveSel] of [
    ["a cell", "v", "td"],
    ["a row label", "row", "tbody th"],
    ["a leaf column header", "per", "thead th"],
  ] as const) {
    it(`${where} with math on another line: a dollar on screen, the backslash kept in the PNG`, () => {
      const { live, png } = build({ [field]: MULTI });
      const liveText = [...live.querySelectorAll(liveSel)].map((e) => e.textContent ?? "").join(" ");
      expect(liveText).toContain("Cost $5");
      expect(liveText).not.toContain("\\$");
      expect(pngTexts(png).some((t) => t.includes("Cost \\$5"))).toBe(true);
    });
  }

  it("a group note runs to more than one line the same way: a dollar on screen, the backslash kept in the PNG", () => {
    const spec2: TableSpec = { ...T, group_notes: { G: MULTI } };
    const tr = rows([{ grp: "G", row: "r", per: "p", v: "text" }]);
    const live = document.createElement("div");
    document.body.append(live);
    mountTable(live, { spec: spec2, rows: tr });
    expect(live.querySelector("tbody")!.textContent).toContain("Cost $5");
    expect(pngTexts(buildTableExportSvg(spec2, tr)).some((t) => t.includes("Cost \\$5"))).toBe(true);
  });

  it("the table's notes line is never parsed for math, even with a break", () => {
    const spec2: TableSpec = { ...T, notes: "Cost \\$5 \\\\ more" };
    const tr = rows([{ grp: "G", row: "r", per: "p", v: "text" }]);
    const live = document.createElement("div");
    document.body.append(live);
    mountTable(live, { spec: spec2, rows: tr });
    expect(live.querySelector(".figure-note")!.textContent).toContain("Cost \\$5");
    expect(pngTexts(buildTableExportSvg(spec2, tr)).some((t) => t.includes("Cost \\$5"))).toBe(true);
  });

  it("a math line in the export does unescape its own \\$", () => {
    const { png } = build({ v: "\\(x\\) costs \\$5" });
    expect(pngTexts(png).some((t) => t.includes("costs $5"))).toBe(true);
  });

  it("with neither math nor a break: drawn as written on screen and in the PNG", () => {
    const { live, png } = build({ v: "Cost \\$5" });
    expect(live.querySelector("td")!.textContent).toBe("Cost \\$5");
    expect(pngTexts(png)).toContain("Cost \\$5");
  });
});

// ---------------------------------------------------------------------------------------------
// Hooks: what a throwing hook does.
// ---------------------------------------------------------------------------------------------
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
    FakeResizeObserver.instances.push(this);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
async function resizeTo(host: HTMLElement, width: number): Promise<void> {
  const card = host.querySelector<HTMLElement>(".figure-card")!;
  Object.defineProperty(card, "clientWidth", { value: width, configurable: true });
  for (const inst of FakeResizeObserver.instances) inst.cb([], inst as unknown as ResizeObserver);
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));
}

describe("CONFIG-SPEC Hooks: a throwing hook", () => {
  const SELECTOR = { dimension: { options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] } };
  const LINE = spec({
    chartType: "line", title: "By {dimension}", xAxisType: "categorical", data: "d",
    title_selectors: SELECTOR,
  });
  const FIG = spec({
    ...LINE,
    columns: { x: "time", value: "value", series: "series", facet: "pane" },
    small_multiples: { mode: "shared" },
  });
  const lineRows = (): TidyRow[] =>
    rows(["A", "B"].flatMap((time) => [
      { time, series: "U", value: "6" },
      { time, series: "D", value: "4" },
    ]));
  const figRows = (): TidyRow[] =>
    rows(["P1", "P2"].flatMap((pane) => (lineRows() as unknown as Array<Record<string, string>>).map((r) => ({ ...r, pane }))));
  const PATHS: Array<[string, ChartSpec, () => TidyRow[]]> = [
    ["standalone", LINE, lineRows],
    ["2-pane figure", FIG, figRows],
  ];
  const svgsOf = (c: HTMLElement): SVGSVGElement[] =>
    [...c.querySelectorAll<SVGSVGElement>(".figure-canvas svg, .figure-pane svg")];
  const choose = (c: HTMLElement, id: string): void => {
    c.querySelector<HTMLButtonElement>("button.inline-select")!.click();
    c.querySelector<HTMLLIElement>(`li[data-id="${id}"]`)!.click();
  };

  // A throw out of an event listener or an animation-frame callback is reported on `window`
  // ("uncaught"), not to the code that dispatched it. Cancelled here so jsdom does not log it.
  let uncaught: string[] = [];
  const onError = (e: ErrorEvent): void => {
    uncaught.push((e.error as Error)?.message);
    e.preventDefault();
  };
  beforeEach(() => {
    uncaught = [];
    window.addEventListener("error", onError);
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
    FakeResizeObserver.instances = [];
  });
  afterEach(() => {
    window.removeEventListener("error", onError);
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  });

  for (const [path, s, rowsFor] of PATHS) {
    for (const hook of ["tickLabel", "afterRender"] as const) {
      it(`${path}: ${hook} is caught by the draw and shown as an in-card .figure-error`, () => {
        const host = document.createElement("div");
        document.body.append(host);
        const hooks: RenderHooks = { [hook]: () => { throw new Error("boom"); } };
        const teardown = mountChart(host, { spec: s, rows: rowsFor(), width: 900, hooks });
        expect(typeof teardown).toBe("function");
        expect(host.querySelector(".figure-error")?.textContent).toBe("boom");
      });
    }

    it(`${path}: legendKey at mount throws out of mountChart, leaving the card with its chart, no legend and no resize`, () => {
      const host = document.createElement("div");
      document.body.append(host);
      expect(() =>
        mountChart(host, { spec: s, rows: rowsFor(), width: 900, hooks: { legendKey: () => { throw new Error("LK"); } } }),
      ).toThrow("LK");
      expect(host.querySelectorAll(".figure-card").length).toBe(1);
      expect(svgsOf(host).length).toBeGreaterThan(0);
      expect(host.querySelector(".tbl-legend")).toBeNull();
      expect(host.querySelector(".figure-error")).toBeNull();
      // No ResizeObserver was attached, so nothing redraws the chart on a resize.
      expect(FakeResizeObserver.instances.length).toBe(0);
    });

    it(`${path}: legendKey on a resize leaves that redraw's chart without a legend, and the error escapes`, async () => {
      const host = document.createElement("div");
      document.body.append(host);
      const armed = { on: false };
      mountChart(host, {
        spec: s, rows: rowsFor(), width: 900,
        hooks: { legendKey: () => { if (armed.on) throw new Error("LK"); return null; } },
      });
      const before = svgsOf(host);
      expect(host.querySelector(".tbl-legend"), "precondition: a legend").not.toBeNull();
      armed.on = true;
      await resizeTo(host, 700);
      expect(svgsOf(host)[0]).not.toBe(before[0]);
      expect(host.querySelector(".tbl-legend")).toBeNull();
      expect(uncaught).toEqual(["LK"]);
    });

    it(`${path}: legendKey on a title-selector change does the same`, () => {
      const host = document.createElement("div");
      document.body.append(host);
      const armed = { on: false };
      mountChart(host, {
        spec: s, rows: rowsFor(), width: 900,
        hooks: { legendKey: () => { if (armed.on) throw new Error("LK"); return null; } },
      });
      const before = svgsOf(host);
      armed.on = true;
      choose(host, "b");
      expect(svgsOf(host)[0]).not.toBe(before[0]);
      expect(host.querySelector(".tbl-legend")).toBeNull();
      expect(uncaught).toEqual(["LK"]);
    });
  }

  it("standalone: valueLabel is caught by the draw and shown as an in-card .figure-error", () => {
    const host = document.createElement("div");
    document.body.append(host);
    let calls = 0;
    const teardown = mountChart(host, {
      spec: spec({ chartType: "stacked", title: "t", xAxisType: "categorical", data: "d", valueLabels: { show: true } }),
      rows: rows(["A", "B"].flatMap((time) => [{ time, series: "U", value: "60" }, { time, series: "D", value: "40" }])),
      width: 600,
      height: 360,
      hooks: { valueLabel: () => { calls++; throw new Error("VL"); } },
    });
    expect(typeof teardown).toBe("function");
    expect(calls).toBeGreaterThan(0);
    expect(host.querySelector(".figure-error")?.textContent).toBe("VL");
  });

  it("tooltip runs only on hover: mountChart returns, and a throwing move with no card showing shows none and reports the error uncaught", () => {
    const host = document.createElement("div");
    document.body.append(host);
    let calls = 0;
    const teardown = mountChart(host, {
      spec: spec({ chartType: "stacked", title: "t", xAxisType: "categorical", data: "d", barStack: { hover: "tooltip" } }),
      rows: lineRows(),
      width: 600,
      height: 360,
      hooks: { tooltip: () => { calls++; throw new Error("TT"); } },
    });
    expect(typeof teardown).toBe("function");
    expect(calls, "the hook does not run at mount").toBe(0);
    const svg = host.querySelector<SVGSVGElement>(".figure-canvas svg")!;
    mockRect1to1(svg);
    expect(() => hoverFirstMark(svg, BAR_MARK)).not.toThrow();
    expect(calls).toBe(1);
    expect(cardShown()).toBe(false);
    expect(uncaught).toEqual(["TT"]);
  });

  for (const [path, s, rowsFor, redraws] of [
    ["standalone", LINE, lineRows, false],
    ["2-pane figure", FIG, figRows, true],
  ] as const) {
    it(`${path}: after a legendKey throw at mount, a title-selector change ${redraws ? "still redraws" : "no longer redraws"}`, () => {
      const host = document.createElement("div");
      document.body.append(host);
      const armed = { on: true };
      expect(() =>
        mountChart(host, { spec: s, rows: rowsFor(), width: 900, hooks: { legendKey: () => { if (armed.on) throw new Error("LK"); return null; } } }),
      ).toThrow("LK");
      armed.on = false;
      const before = svgsOf(host);
      choose(host, "b");
      expect(svgsOf(host)[0] !== before[0]).toBe(redraws);
    });
  }

  it("tooltip: a card shown on an earlier move stays, with that move's content, when the hook throws", () => {
    const host = document.createElement("div");
    document.body.append(host);
    mountChart(host, {
      spec: spec({ chartType: "stacked", title: "t", xAxisType: "categorical", data: "d", barStack: { hover: "tooltip" } }),
      rows: rows([{ time: "A", series: "U", value: "6" }, { time: "B", series: "U", value: "3" }]),
      width: 600,
      height: 360,
      hooks: {
        tooltip: (ctx) => {
          if (ctx.category === "B") throw new Error("TT");
          return `<div class="mine">${ctx.category}</div>`;
        },
      },
    });
    const svg = host.querySelector<SVGSVGElement>(".figure-canvas svg")!;
    mockRect1to1(svg);
    const bars = [...svg.querySelectorAll<SVGRectElement>(BAR_MARK)];
    const hoverBar = (r: SVGRectElement): void => {
      const cx = Number(r.getAttribute("x")) + Number(r.getAttribute("width")) / 2;
      svg.querySelector(CROSSHAIR_HIT_SELECTOR)!.dispatchEvent(new PointerEvent("pointermove", { clientX: cx, clientY: 20, bubbles: true }));
    };
    hoverBar(bars[0]!);
    expect(cardShown()).toBe(true);
    expect(cardHtml()).toContain('<div class="mine">A</div>');
    hoverBar(bars[1]!);
    expect(uncaught).toEqual(["TT"]);
    expect(cardShown()).toBe(true);
    expect(cardHtml()).toContain('<div class="mine">A</div>');
  });

  it("precondition: the same hover with a non-throwing hook does show a card", () => {
    const host = document.createElement("div");
    document.body.append(host);
    mountChart(host, {
      spec: spec({ chartType: "stacked", title: "t", xAxisType: "categorical", data: "d", barStack: { hover: "tooltip" } }),
      rows: lineRows(),
      width: 600,
      height: 360,
      hooks: { tooltip: () => null },
    });
    const svg = host.querySelector<SVGSVGElement>(".figure-canvas svg")!;
    mockRect1to1(svg);
    hoverFirstMark(svg, BAR_MARK);
    expect(cardShown()).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Hooks: legendKey's ctx.series on annotation rows, and how a changed row is drawn in the export.
// ---------------------------------------------------------------------------------------------
describe("CONFIG-SPEC Hooks: legendKey", () => {
  const ANNOTATED = spec({
    chartType: "line", title: "t", xAxisType: "numeric", data: "d",
    annotations: { bands: [{ start: "1", end: "2", label: "US recessions", legend: true }] },
  });
  const ANN_ROWS = rows([{ time: "0", value: "1" }, { time: "3", value: "2" }]);

  const KINDS: Array<[string, Record<string, unknown>]> = [
    ["band", { annotations: { bands: [{ start: "1", end: "2", label: "K", legend: true }] } }],
    ["shading region", { shading: [{ side: "positive", label: "K", legend: true }] }],
    ["reference line", { annotations: { xAxis: [{ x: "1", label: "K", legend: true }] } }],
    ["overlay", { overlays: [{ slope: 1, intercept: 0, label: "K", legend: true }] }],
    ["rug track", { rug: { tracks: [{ label: "K", intervals: [{ from: "1", to: "2" }] }] } }],
  ];
  for (const [kind, extra] of KINDS) {
    it(`a ${kind} row passes __annotation:<label> as ctx.series, live and in the export`, () => {
      const s = spec({ ...ANNOTATED, annotations: undefined, ...extra });
      const seen: Array<[string, string]> = [];
      const hooks: RenderHooks = { legendKey: (ctx) => { seen.push([ctx.medium, ctx.series]); return null; } };
      const host = document.createElement("div");
      document.body.append(host);
      mountChart(host, { spec: s, rows: ANN_ROWS, width: 720, height: 400, hooks });
      buildExportSvg(s, ANN_ROWS, { hooks });
      expect(seen).toContainEqual(["html", "__annotation:K"]);
      expect(seen).toContainEqual(["svg", "__annotation:K"]);
    });
  }

  // A hook that CHANGES the markup is drawn as returned: no wrapping, one line. Where the default
  // row's long label wraps (a right-hand column; a framed export), the hooked row's does not.
  const LONG = "A very long series label that cannot possibly fit in a 160px legend column";
  const changed: RenderHooks = {
    legendKey: (ctx) => (ctx.label.startsWith(LONG) && ctx.medium === "svg" ? `<g class="mine">${ctx.rendered}</g>` : null),
  };
  const textsWith = (root: Element, s: string): Element[] =>
    [...root.querySelectorAll("text")].filter((t) => (t.textContent ?? "").includes(s));

  const cases: Array<[string, ChartSpec, TidyRow[], Parameters<typeof buildExportSvg>[2]]> = [
    [
      "stacked, right-hand legend column",
      spec({ chartType: "stacked", title: "t", xAxisType: "categorical", data: "d" }),
      rows(["Q1", "Q2"].flatMap((time) =>
        Array.from({ length: 5 }, (_, i) => ({ time, series: i === 4 ? LONG : `s${i}`, value: String(i + 1) })))),
      {},
    ],
    [
      "line, framed export with a top legend",
      spec({ chartType: "line", title: "t", xAxisType: "categorical", data: "d" }),
      rows(["Q1", "Q2"].flatMap((time) => [
        { time, series: "A", value: "1" },
        { time, series: LONG + " and then some more words to pass a whole row", value: "2" },
      ])),
      { frame: { width: 480, height: 400 } },
    ],
  ];
  for (const [name, s, r, opts] of cases) {
    it(`${name}: the default row wraps its label; a changed row is drawn as returned, on one line`, () => {
      const label = (r as unknown as Array<{ series: string }>).find((x) => x.series.startsWith(LONG))!.series;
      const plain = buildExportSvg(s, r, { ...opts });
      expect(textsWith(plain, "A very long").length, "precondition: the default row is drawn").toBe(1);
      expect(textsWith(plain, label).length, "precondition: the default row wraps its label").toBe(0);
      const hooked = buildExportSvg(s, r, { ...opts, hooks: changed });
      const mine = hooked.querySelector("g.mine");
      expect(mine).not.toBeNull();
      const labels = [...mine!.querySelectorAll("text")];
      expect(labels.length).toBe(1);
      expect(labels[0]!.textContent).toBe(label);
    });
  }
});

// ---------------------------------------------------------------------------------------------
// Bar / stacked-bar options: netLabelColor and valueLabels.signed are accepted and do nothing.
// ---------------------------------------------------------------------------------------------
describe("CONFIG-SPEC Bar / stacked-bar options: no-op fields", () => {
  const STACK = spec({
    chartType: "stacked", title: "t", xAxisType: "categorical", data: "d",
    valueLabels: { show: true }, barStack: { netDisplay: "text" },
  });
  const STACK_ROWS = rows(["A", "B"].flatMap((time) => [
    { time, series: "U", value: "60" },
    { time, series: "D", value: "40" },
  ]));
  const DOT = spec({ ...STACK, valueLabels: undefined, barStack: { netDisplay: "dot" } });
  const DIVERGING = rows(["A", "B"].flatMap((time) => [
    { time, series: "U", value: "60" },
    { time, series: "D", value: "-40" },
  ]));
  const WF = spec({ chartType: "waterfall", title: "t", xAxisType: "categorical", data: "d", valueLabels: { show: true } });
  const WF_ROWS = rows([{ time: "a", value: "10" }, { time: "b", value: "-4" }]);

  const cases: Array<[string, ChartSpec, TidyRow[]]> = [
    ["stacked with net text and segment labels", STACK, STACK_ROWS],
    ["diverging stacked with a net dot", DOT, DIVERGING],
    ["waterfall with running-total labels", WF, WF_ROWS],
  ];
  for (const [name, base, r] of cases) {
    for (const [field, extra] of [
      ["barStack.netLabelColor", { barStack: { ...(base.barStack ?? {}), netLabelColor: "white" } }],
      ["barStack.netLabelColor", { barStack: { ...(base.barStack ?? {}), netLabelColor: "black" } }],
      ["valueLabels.signed", { valueLabels: { ...(base.valueLabels ?? {}), signed: true } }],
    ] as const) {
      it(`${name}: ${field} ${JSON.stringify(extra)} validates and changes nothing, live or exported`, () => {
        const withField = spec({ ...base, ...extra });
        expect(validateSpec(withField).valid).toBe(true);
        const o = { width: 600, height: 360, document };
        expect(renderChart(withField, r, o).svg.outerHTML).toBe(renderChart(base, r, o).svg.outerHTML);
        expect(buildExportSvg(withField, r).outerHTML).toBe(buildExportSvg(base, r).outerHTML);
      });
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Shading: `side` measures against `baseline` as written.
// ---------------------------------------------------------------------------------------------
describe("CONFIG-SPEC Shading: side is measured against baseline, not zero and not the clamped edge", () => {
  const LINE = spec({ chartType: "line", title: "t", xAxisType: "numeric", data: "d" });
  const LINE_ROWS = rows([0.2, 0.8, 0.9, 0.3, 0.05].map((v, i) => ({ time: String(i), value: String(v) })));
  const xs = (d: string): number[] =>
    [...d.matchAll(/[ML]\s*([-\d.]+)[ ,]/g)].map((m) => Number(m[1]));
  const extentOf = (svg: SVGSVGElement, sel: string): [number, number] => {
    const all = [...svg.querySelectorAll(sel)].flatMap((p) => xs(p.getAttribute("d") ?? ""));
    return [Math.min(...all), Math.max(...all)];
  };
  const render = (s: ChartSpec): SVGSVGElement =>
    renderChart(s, LINE_ROWS, { width: 720, height: 400, document }).svg;

  it("a positive-side fill over baseline 0.5 covers only the part of the line above 0.5", () => {
    const svg = render(spec({ ...LINE, shading: [{ side: "positive", baseline: 0.5 }] }));
    const [lineLo, lineHi] = extentOf(svg, 'g[aria-label="line"] path');
    const [shadeLo, shadeHi] = extentOf(svg, `g.${SHADE_CLASS} path`);
    // Every point is above zero, so a fill keyed off zero would span the whole line.
    expect(shadeLo).toBeGreaterThan(lineLo + 10);
    expect(shadeHi).toBeLessThan(lineHi - 10);
  });

  it("a baseline below the axis is drawn at the axis edge but still measured as written", () => {
    // Axis pinned to [0.4, 1]: baseline 0.1 is drawn at the 0.4 edge. Against 0.1, the first four
    // points are on the positive side; against the 0.4 edge, only the middle two would be.
    const svg = render(spec({
      ...LINE, yAxisPolicy: { min: 0.4, max: 1 }, shading: [{ side: "positive", baseline: 0.1 }],
    }));
    const [lineLo] = extentOf(svg, 'g[aria-label="line"] path');
    const [shadeLo] = extentOf(svg, `g.${SHADE_CLASS} path`);
    expect(Math.abs(shadeLo - lineLo)).toBeLessThan(0.5);
  });
});

// ---------------------------------------------------------------------------------------------
// X-axis rug: tracks group by label within each source; the cover check.
// ---------------------------------------------------------------------------------------------
describe("CONFIG-SPEC X-axis rug: tracks and cover", () => {
  const BASE = spec({ chartType: "line", title: "t", xAxisType: "numeric", data: "d", rug: {} });
  const DATA = rows([{ time: "0", value: "1" }, { time: "10", value: "4" }]);

  const legendRow = (s: ChartSpec, label: string) =>
    (renderChart(s, DATA, { width: 720, height: 400, document }).legendItems ?? []).filter((i) => i.label === label);
  const blockFills = (s: ChartSpec): string[] =>
    [...renderChart(s, DATA, { width: 720, height: 400, document }).svg.querySelectorAll(`g.${RUG_CLASS} rect`)]
      .map((r) => r.getAttribute("fill") ?? "");

  it("bands sharing a label paint one track in the first entry's color, but key with every entry's color", () => {
    const s = spec({
      ...BASE,
      annotations: {
        bands: [
          { start: "1", end: "2", label: "R", color: "grey", rug: true },
          { start: "5", end: "6", label: "R", color: "red", rug: true },
        ],
      },
    });
    expect(validateSpec(s).valid).toBe(true);
    const tracks = resolveRugTracks(s);
    expect(tracks.length).toBe(1);
    expect(tracks[0]!.intervals.length).toBe(2);
    const fills = blockFills(s);
    expect(fills.length).toBe(2);
    expect(new Set(fills)).toEqual(new Set([resolveColor("grey")]));
    const row = legendRow(s, "R");
    expect(row.length).toBe(1);
    expect(row[0]!.colors).toEqual([resolveColor("grey"), resolveColor("red")]);
  });

  it("legend: false on one entry leaves the row to the others", () => {
    const s = spec({
      ...BASE,
      annotations: {
        bands: [
          { start: "1", end: "2", label: "R", color: "grey", rug: true, legend: false },
          { start: "5", end: "6", label: "R", color: "red", rug: true },
        ],
      },
    });
    const row = legendRow(s, "R");
    expect(row.length).toBe(1);
    expect(row[0]!.color).toBe(resolveColor("red"));
    expect(row[0]!.colors).toBeUndefined();
    // The strip still takes the first entry's color.
    expect(new Set(blockFills(s))).toEqual(new Set([resolveColor("grey")]));
  });

  it("a first entry with no color: a band track is the neutral, even when a later entry has one", () => {
    const s = spec({
      ...BASE,
      annotations: {
        bands: [
          { start: "1", end: "2", label: "R", rug: true },
          { start: "5", end: "6", label: "R", color: "red", rug: true },
        ],
      },
    });
    expect(new Set(blockFills(s))).toEqual(new Set([TBL.color.annotationDim]));
  });

  it("a shading track with no color takes its regions' series color, or the neutral when they name different series", () => {
    const two = rows([
      { time: "0", series: "Up", value: "1" }, { time: "10", series: "Up", value: "2" },
      { time: "0", series: "Down", value: "-1" }, { time: "10", series: "Down", value: "-2" },
    ]);
    const fillsFor = (shading: unknown[]): Set<string> => {
      const built = renderChart(spec({ ...BASE, shading }), two, { width: 720, height: 400, document });
      const colors = new Map((built.legendItems ?? []).map((i) => [i.series, i.color]));
      const fills = new Set([...built.svg.querySelectorAll(`g.${RUG_CLASS} rect`)].map((r) => r.getAttribute("fill") ?? ""));
      return new Set([...fills].map((f) => (f === colors.get("Up") ? "Up" : f === colors.get("Down") ? "Down" : f)));
    };
    expect(fillsFor([
      { series: "Up", from: "1", to: "2", label: "S", rug: true },
      { series: "Up", from: "5", to: "6", label: "S", rug: true },
    ])).toEqual(new Set(["Up"]));
    expect(fillsFor([
      { series: "Up", from: "1", to: "2", label: "S", rug: true },
      { series: "Down", from: "5", to: "6", label: "S", rug: true },
    ])).toEqual(new Set([TBL.color.annotationDim]));
  });

  it("a rug-flagged entry is keyed by its solid color, not its fill's tint", () => {
    const s = spec({ ...BASE, shading: [{ from: "1", to: "2", label: "S", color: "amber", rug: true }] });
    expect(legendRow(s, "S")[0]!.color).toBe(resolveColor("amber"));
  });

  it("the strip's colors can differ from the chip's: same-label regions over different series key both tints over a neutral strip", () => {
    const two = rows([
      { time: "0", series: "Up", value: "1" }, { time: "10", series: "Up", value: "2" },
      { time: "0", series: "Down", value: "-1" }, { time: "10", series: "Down", value: "-2" },
    ]);
    const s = spec({
      ...BASE,
      shading: [
        { series: "Up", from: "1", to: "2", label: "S", rug: true },
        { series: "Down", from: "5", to: "6", label: "S", rug: true },
      ],
    });
    const built = renderChart(s, two, { width: 720, height: 400, document });
    const items = built.legendItems ?? [];
    const colorOf = (k: string) => items.find((i) => i.series === k)!.color;
    expect(items.find((i) => i.label === "S")!.colors).toEqual([colorOf("Up"), colorOf("Down")]);
    const fills = new Set([...built.svg.querySelectorAll(`g.${RUG_CLASS} rect`)].map((r) => r.getAttribute("fill")));
    expect(fills).toEqual(new Set([TBL.color.annotationDim]));
  });

  it("a band and a shading region sharing a label: one legend row, two tracks in their own colors", () => {
    const s = spec({
      ...BASE,
      annotations: { bands: [{ start: "1", end: "2", label: "R", color: "grey", rug: true }] },
      shading: [{ from: "5", to: "6", label: "R", color: "red", rug: true }],
    });
    expect(legendRow(s, "R").length).toBe(1);
    expect(resolveRugTracks(s).length).toBe(2);
    expect(new Set(blockFills(s))).toEqual(new Set([resolveColor("grey"), resolveColor("red")]));
  });

  it("explicit rug.tracks entries are never grouped, even under one label", () => {
    const s = spec({
      ...BASE,
      rug: {
        tracks: [
          { label: "T", color: "grey", intervals: [{ from: "1", to: "2" }] },
          { label: "T", color: "red", intervals: [{ from: "5", to: "6" }] },
        ],
      },
    });
    expect(resolveRugTracks(s).length).toBe(2);
    expect(new Set(blockFills(s))).toEqual(new Set([resolveColor("grey"), resolveColor("red")]));
  });

  it("shading regions sharing a label are one track; a band and a region never share one", () => {
    const s = spec({
      ...BASE,
      annotations: { bands: [{ start: "1", end: "2", label: "R", rug: true }] },
      shading: [
        { from: "3", to: "4", label: "R", rug: true },
        { from: "6", to: "7", label: "R", rug: true },
      ],
    });
    const tracks = resolveRugTracks(s);
    expect(tracks.map((t) => [t.origin, t.label, t.intervals.length])).toEqual([
      ["bands", "R", 1],
      ["shading", "R", 2],
    ]);
  });

  const tracks = (a: Array<[string, string]>, b: Array<[string, string]>) =>
    spec({
      ...BASE,
      rug: {
        tracks: [
          { label: "A", intervals: a.map(([from, to]) => ({ from, to })) },
          { label: "B", intervals: b.map(([from, to]) => ({ from, to })) },
        ],
      },
    });

  it("a track whose every interval lies inside one later interval is a validation error naming rug.rows", () => {
    const v = validateSpec(tracks([["2", "4"]], [["1", "5"]]));
    expect(v.valid).toBe(false);
    expect(v.errors.join(" ")).toMatch(/"A".*rug\.rows/);
  });

  it("cover pieced together from several later intervals is not detected", () => {
    const s = tracks([["2", "4"]], [["1", "3"], ["3", "5"]]);
    expect(validateSpec(s).valid).toBe(true);
    // And it really is covered: B's two blocks, painted after A's, span all of A's.
    const svg = renderChart(s, DATA, { width: 720, height: 400, document }).svg;
    const blocks = [...svg.querySelectorAll<SVGRectElement>(`g.${RUG_CLASS} rect`)].map((r) => {
      const x = Number(r.getAttribute("x"));
      return [x, x + Number(r.getAttribute("width"))] as const;
    });
    expect(blocks.length).toBe(3);
    const [a, b1, b2] = blocks as [readonly [number, number], readonly [number, number], readonly [number, number]];
    expect(b1[0]).toBeLessThanOrEqual(a[0]);
    expect(b2[1]).toBeGreaterThanOrEqual(a[1]);
    expect(b1[1]).toBeGreaterThanOrEqual(b2[0]);
  });
});

// ---------------------------------------------------------------------------------------------
// Keying annotations in the legend: which rows merge, and what a multi-series shading chip shows.
// ---------------------------------------------------------------------------------------------
describe("CONFIG-SPEC Keying annotations: row merging", () => {
  const LINE = spec({ chartType: "line", title: "t", xAxisType: "numeric", data: "d" });
  const DATA = rows([{ time: "0", value: "1" }, { time: "10", value: "4" }]);
  const annRows = (s: ChartSpec) =>
    (renderChart(s, DATA, { width: 720, height: 400, document }).legendItems ?? []).filter((i) =>
      i.series.startsWith("__annotation:"));

  it("fills sharing a label merge into one row whose chip shows each tint", () => {
    const s = spec({
      ...LINE,
      annotations: {
        bands: [
          { start: "1", end: "2", label: "R", color: "grey", legend: true },
          { start: "5", end: "6", label: "R", color: "red", legend: true },
        ],
      },
    });
    expect(validateSpec(s).valid).toBe(true);
    const r = annRows(s);
    expect(r.length).toBe(1);
    expect(r[0]!.colors?.length).toBe(2);
  });

  it("a band, a shading region and a rug track sharing a label merge into one row", () => {
    const s = spec({
      ...LINE,
      annotations: { bands: [{ start: "1", end: "2", label: "R", color: "grey", legend: true }] },
      shading: [{ side: "positive", label: "R", color: "amber", legend: true }],
      rug: { tracks: [{ label: "R", color: "red", intervals: [{ from: "5", to: "6" }] }] },
    });
    expect(validateSpec(s).valid).toBe(true);
    const r = annRows(s);
    expect(r.length).toBe(1);
    expect(r[0]!.colors?.length).toBe(3);
  });

  it("an overlay and a reference line sharing a label, both dashed, merge into one row", () => {
    const s = spec({
      ...LINE,
      annotations: { xAxis: [{ x: "2", label: "Trend", color: "red", legend: true }] },
      overlays: [{ slope: 0.1, intercept: 1, label: "Trend", color: "blue", legend: true }],
    });
    expect(validateSpec(s).valid).toBe(true);
    const r = annRows(s);
    expect(r.length).toBe(1);
    expect(r[0]!.dashed).toBe(true);
    // Overlays come before reference lines in row order, so the row takes the overlay's color.
    expect(r[0]!.color).toBe(resolveColor("blue"));
  });

  it("row order: bands, shading, overlays, xAxis, yAxis, explicit rug.tracks — whatever order the spec lists them", () => {
    const s = spec({
      ...LINE,
      rug: { tracks: [{ label: "6 track", intervals: [{ from: "8", to: "9" }] }] },
      annotations: {
        yAxis: [{ y: 2, label: "5 y", legend: true }],
        xAxis: [{ x: "2", label: "4 x", legend: true }],
        bands: [{ start: "1", end: "2", label: "1 band", legend: true }],
      },
      overlays: [{ slope: 0.1, intercept: 1, label: "3 overlay", legend: true }],
      shading: [{ side: "positive", label: "2 shade", legend: true }],
    });
    expect(annRows(s).map((i) => i.label)).toEqual(["1 band", "2 shade", "3 overlay", "4 x", "5 y", "6 track"]);
  });

  it("reference lines sharing a label and dash merge into one row in the first line's colour", () => {
    const s = spec({
      ...LINE,
      annotations: {
        xAxis: [
          { x: "2", label: "Policy", color: "red", legend: true },
          { x: "6", label: "Policy", color: "blue", legend: true },
        ],
      },
    });
    expect(validateSpec(s).valid).toBe(true);
    const r = annRows(s);
    expect(r.length).toBe(1);
    expect(r[0]!.color).toBe(resolveColor("red"));
  });

  it("a dashed and a solid line under one label stay two rows, as do a fill and a line", () => {
    const s = spec({
      ...LINE,
      annotations: {
        xAxis: [{ x: "2", label: "Shock", style: "solid", legend: true }],
        yAxis: [{ y: 2, label: "Shock", legend: true }],
        bands: [{ start: "1", end: "2", label: "Window", legend: true }],
      },
      overlays: [{ slope: 0.1, intercept: 1, label: "Window", legend: true }],
    });
    expect(validateSpec(s).valid).toBe(true);
    const r = annRows(s);
    expect(r.filter((i) => i.label === "Shock").map((i) => i.dashed).sort()).toEqual([false, true]);
    expect(r.filter((i) => i.label === "Window").map((i) => i.markerShape).sort()).toEqual(["line", "rect"]);
  });

  it("a shading chip with no series shows every series' tint, including one the region paints no fill for", () => {
    const s = spec({ ...LINE, shading: [{ side: "positive", label: "Above zero", legend: true }] });
    const twoSeries = rows([
      { time: "0", series: "Up", value: "1" }, { time: "10", series: "Up", value: "2" },
      { time: "0", series: "Down", value: "-1" }, { time: "10", series: "Down", value: "-2" },
    ]);
    const built = renderChart(s, twoSeries, { width: 720, height: 400, document });
    const row = (built.legendItems ?? []).find((i) => i.label === "Above zero")!;
    expect(row.colors?.length).toBe(2);
    // Only "Up" ever reaches the positive side, so only one fill is painted.
    expect(built.svg.querySelectorAll(`g.${SHADE_CLASS} path`).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// MountOptions.height: where it is honoured.
// ---------------------------------------------------------------------------------------------
describe("CONFIG-SPEC Customisation: MountOptions.height", () => {
  const svgHeight = (host: HTMLElement, sel: string): string | null =>
    host.querySelector(sel)!.getAttribute("height");
  const mount = (s: ChartSpec, r: TidyRow[], height?: number): HTMLElement => {
    const host = document.createElement("div");
    document.body.append(host);
    mountChart(host, { spec: s, rows: r, width: 720, ...(height != null ? { height } : {}) });
    return host;
  };
  const LINE = spec({ chartType: "line", title: "t", xAxisType: "numeric", data: "d" });
  const LINE_ROWS = rows([{ time: "0", value: "1" }, { time: "10", value: "4" }]);

  it("sets a standalone chart's height", () => {
    expect(svgHeight(mount(LINE, LINE_ROWS, 250), ".figure-canvas svg")).toBe("250");
    expect(svgHeight(mount(LINE, LINE_ROWS), ".figure-canvas svg")).not.toBe("250");
  });

  it("a timeline and a treemap ignore it", () => {
    const tl = spec({ chartType: "timeline", title: "t", xAxisType: "temporal", data: "d" });
    const tlRows = rows([{ time: "2020", label: "One" }, { time: "2024", label: "Two" }]);
    const tm = spec({ chartType: "treemap", title: "t", xAxisType: "categorical", data: "d" });
    const tmRows = rows([{ time: "A", value: "3" }, { time: "B", value: "1" }]);
    for (const [s, r] of [[tl, tlRows], [tm, tmRows]] as const) {
      const without = svgHeight(mount(s, r), ".figure-canvas svg");
      expect(svgHeight(mount(s, r, 900), ".figure-canvas svg"), s.chartType).toBe(without);
      expect(without).not.toBe("900");
    }
  });

  it("a small-multiples figure ignores it", () => {
    const fig = spec({ ...LINE, columns: { x: "time", value: "value", facet: "pane" }, small_multiples: { mode: "shared" } });
    const figRows = rows(["P1", "P2"].flatMap((pane) => [{ time: "0", value: "1", pane }, { time: "10", value: "4", pane }]));
    const without = svgHeight(mount(fig, figRows), ".figure-pane svg");
    expect(svgHeight(mount(fig, figRows, 900), ".figure-pane svg")).toBe(without);
    expect(without).not.toBe("900");
  });

  it("the PNG download is not handed it", async () => {
    const spy = vi.mocked(exportChartPng);
    spy.mockClear();
    const host = mount(LINE, LINE_ROWS, 250);
    host.querySelector<HTMLButtonElement>('button[aria-label="Download image (PNG)"]')!.click();
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![2]).not.toHaveProperty("height");
  });
});

// ---------------------------------------------------------------------------------------------
// Waterfall options.
// ---------------------------------------------------------------------------------------------
describe("CONFIG-SPEC Waterfall options", () => {
  const WF = spec({ chartType: "waterfall", title: "t", xAxisType: "categorical", data: "d", columns: { x: "c", value: "v", kind: "k" } });
  const WF_ROWS = rows([
    { c: "a", v: "10", k: "" },
    { c: "b", v: "-4", k: "" },
    { c: "c", v: "0", k: "" },
    { c: "d", v: "2", k: "branch" },
    { c: "e", v: "-1", k: "branch" },
    { c: "f", v: "", k: "total" },
  ]);
  const render = (s: ChartSpec) => renderChart(s, WF_ROWS, { width: 720, height: 400, document }).svg;
  const fills = (svg: SVGSVGElement): string[] =>
    [...svg.querySelectorAll('g[aria-label="bar"] rect')].map((r) => r.getAttribute("fill") ?? "");
  const links = (svg: SVGSVGElement) => [...svg.querySelectorAll('g[aria-label="link"] path')];

  it("defaults: increase blue, decrease red, total navy; a zero delta counts as an increase", () => {
    expect(validateSpec(WF).valid).toBe(true);
    expect(fills(render(WF))).toEqual(
      ["blue", "red", "blue", "blue", "red", "navy"].map((c) => resolveColor(c)),
    );
  });

  it("waterfall.colors overrides each, and category_colors wins per category on increase, decrease and total steps", () => {
    const s = spec({ ...WF, waterfall: { colors: { increase: "green", decrease: "amber", total: "black" } }, category_colors: { a: "violet", b: "rose", f: "sky" } });
    expect(validateChart(s, WF_ROWS).valid).toBe(true);
    expect(fills(render(s))).toEqual(
      ["violet", "rose", "green", "green", "amber", "sky"].map((c) => resolveColor(c)),
    );
  });

  it("connectors: one dotted line between each bar and the next, in the dim neutral by default", () => {
    const svg = render(WF);
    expect(links(svg).length).toBe(5);
    const g = svg.querySelector('g[aria-label="link"]')!;
    expect(g.getAttribute("stroke")).toBe(TBL.color.annotationDim);
    expect(g.getAttribute("stroke-dasharray")).toBe("1 3");
  });

  it("connectors: false draws none; connectorColor sets their colour", () => {
    expect(links(render(spec({ ...WF, waterfall: { connectors: false } }))).length).toBe(0);
    const s = spec({ ...WF, waterfall: { connectorColor: "red" } });
    expect(validateSpec(s).valid).toBe(true);
    expect(render(s).querySelector('g[aria-label="link"]')!.getAttribute("stroke")).toBe(resolveColor("red"));
  });
});

// ---------------------------------------------------------------------------------------------
// Axes / Column mapping: category_order and columns.category.
// ---------------------------------------------------------------------------------------------
describe("CONFIG-SPEC category_order and columns.category", () => {
  const BAR = spec({ chartType: "bar", title: "t", xAxisType: "categorical", data: "d" });
  const BAR_ROWS = rows([{ time: "A", value: "1" }, { time: "B", value: "2" }, { time: "C", value: "3" }]);
  const order = (s: ChartSpec, r: TidyRow[] = BAR_ROWS): string[] =>
    [...renderChart(s, r, { width: 720, height: 400, document }).svg.querySelectorAll(`.${CAT_LABEL_CLASS} text`)]
      .map((t) => t.textContent ?? "");

  it("category_order orders a bar chart's categories, as x_order does", () => {
    expect(order(spec({ ...BAR, category_order: ["C", "A", "B"] }))).toEqual(["C", "A", "B"]);
    expect(order(spec({ ...BAR, x_order: ["C", "A", "B"] }))).toEqual(["C", "A", "B"]);
  });

  it("with both set, category_order wins", () => {
    expect(order(spec({ ...BAR, category_order: ["B", "C", "A"], x_order: ["C", "A", "B"] }))).toEqual(["B", "C", "A"]);
  });

  it("a category it names that the data lacks is a validation error naming category_order", () => {
    const v = validateChart(spec({ ...BAR, category_order: ["A", "Z"] }), BAR_ROWS);
    expect(v.valid).toBe(false);
    expect(v.errors.join(" ")).toMatch(/category_order.*"Z"/);
  });

  it("columns.category is the x column on a bar chart, and overrides columns.x", () => {
    const r = rows([{ cat: "P", other: "Q", value: "1" }, { cat: "R", other: "S", value: "2" }]);
    const s = spec({ ...BAR, columns: { category: "cat", x: "other", value: "value" } });
    expect(validateChart(s, r).valid).toBe(true);
    expect(order(s, r)).toEqual(["P", "R"]);
  });

  it("a timeline and a treemap reject columns.category", () => {
    for (const s of [
      { chartType: "timeline", title: "t", xAxisType: "temporal", data: "d", columns: { category: "c" } },
      { chartType: "treemap", title: "t", xAxisType: "categorical", data: "d", columns: { category: "c" } },
    ]) {
      const v = validateSpec(s);
      expect(v.valid, s.chartType).toBe(false);
      expect(v.errors.join(" "), s.chartType).toMatch(/columns\.category/);
    }
  });
});

describe("CONFIG-SPEC Dumbbell options: gap_annotation decimals", () => {
  const DB = spec({
    chartType: "dumbbell", title: "t", xAxisType: "categorical", data: "d",
    columns: { category: "c", series: "s", value: "v" }, gap_annotation: true,
  });
  const DB_ROWS = rows([
    { c: "Q1", s: "a", v: "10" }, { c: "Q1", s: "b", v: "12" },
    { c: "Q2", s: "a", v: "5" }, { c: "Q2", s: "b", v: "7.25" },
  ]);
  const gaps = (s: ChartSpec): string[] =>
    [...renderChart(s, DB_ROWS, { width: 720, height: 400, document }).svg.querySelectorAll("g.tbl-dumbbell-gap text")]
      .map((t) => t.textContent ?? "");

  it("1 decimal place by default", () => {
    expect(gaps(DB)).toEqual(["Δ2.0", "Δ2.3"]);
  });
  it("gap_annotation.format, else value_format, sets the decimals", () => {
    expect(gaps(spec({ ...DB, value_format: { decimals: 2 } }))).toEqual(["Δ2.00", "Δ2.25"]);
    expect(gaps(spec({ ...DB, value_format: { decimals: 2 }, gap_annotation: { series_a: "a", series_b: "b", format: { decimals: 0 } } }))).toEqual(["Δ2", "Δ2"]);
  });
  it("a format without decimals keeps 1", () => {
    expect(gaps(spec({ ...DB, gap_annotation: { series_a: "a", series_b: "b", format: { suffix: " pp" } } }))).toEqual(["Δ2.0 pp", "Δ2.3 pp"]);
  });
});

// ---------------------------------------------------------------------------------------------
// table.yaml: collapsible.control.
// ---------------------------------------------------------------------------------------------
describe("CONFIG-SPEC table collapsible.control", () => {
  const T: TableSpec = {
    title: "t", data: "inline", stub: ["g", { label: "r" }], header: ["m"], value: "v",
    collapsible: { default: "expanded" },
  };
  const R = rows([
    { g: "G1", r: "a", m: "x", v: "1" },
    { g: "G2", r: "b", m: "x", v: "2" },
  ]);
  const control = (host: HTMLElement): HTMLElement => {
    const all = host.querySelectorAll<HTMLElement>(".tbl-table-collapse-all");
    expect(all.length).toBe(1);
    return all[0]!;
  };
  const mount = (spec: TableSpec, r: TidyRow[]): HTMLElement => {
    const host = document.createElement("div");
    document.body.append(host);
    mountTable(host, { spec, rows: r });
    return host;
  };

  it("accepts stub-header and footer only", () => {
    expect(validateTableSpec({ ...T, collapsible: { control: "stub-header" } }).valid).toBe(true);
    expect(validateTableSpec({ ...T, collapsible: { control: "footer" } }).valid).toBe(true);
    expect(validateTableSpec({ ...T, collapsible: { control: "header" } }).valid).toBe(false);
  });

  it("stub-header (default): the control sits in the top-left corner cell", () => {
    expect(control(mount(T, R)).closest("th.tbl-table-stub-header")).not.toBeNull();
  });

  it("stub-header on a multi-pane table: the first pane's corner cell", () => {
    const host = mount({ ...T, pane: "p" }, rows([
      { p: "P1", g: "G1", r: "a", m: "x", v: "1" },
      { p: "P2", g: "G2", r: "b", m: "x", v: "2" },
    ]));
    const corners = [...host.querySelectorAll("th.tbl-table-stub-header")];
    expect(corners.length).toBe(2);
    expect(corners[0]!.contains(control(host))).toBe(true);
  });

  it("footer: the control sits with the download buttons", () => {
    const host = mount({ ...T, collapsible: { default: "expanded", control: "footer" } }, R);
    const btn = control(host);
    expect(btn.closest("th")).toBeNull();
    expect(btn.parentElement!.querySelector('button[aria-label="Download image (PNG)"]')).not.toBeNull();
  });
});
