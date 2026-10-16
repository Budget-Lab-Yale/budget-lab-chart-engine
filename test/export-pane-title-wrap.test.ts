// @vitest-environment jsdom
//
// Small-multiples pane titles in the PNG export wrap to their pane's column, as the live grid's
// `.figure-pane-title` block does. The export drew each title as one <text> in a fixed 18px band, so a
// title wider than its column ran into the next pane's title. Widths come from the committed Figtree
// advance table (700 at 11px), not canvas measureText: jsdom has no canvas, and there measureText
// guesses 8px a character, which wrapped titles the browser fits on one line.
import { describe, it, expect } from "vitest";
import { buildExportSvg } from "../src/embed/export-png";
import { timelineTextWidth } from "../src/engine/timeline-text";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const titleW = (s: string): number => timelineTextWidth(s, 11, 700);
const LONG = "Share of homeowners with gains above the exclusion threshold"; // 60 chars, 480px

const spec = (titles: Record<string, string>, extra: Record<string, unknown> = {}): ChartSpec =>
  ({
    chartType: "line",
    title: "T",
    xAxisType: "numeric",
    columns: { x: "x", value: "y", series: "s", facet: "f" },
    small_multiples: { mode: "shared", columns: 3, pane_titles: titles },
    data: "d.csv",
    ...extra,
  }) as unknown as ChartSpec;

const PANES = ["a", "b", "c", "d"]; // 3 columns: two rows, the second holding one pane
const rows = PANES.flatMap((f) =>
  [1, 2, 3].map((x) => ({ f, x: String(x), s: "A", y: String(x * 2) })),
) as unknown as TidyRow[];

/** The pane svgs, in pane order. */
const panesOf = (root: SVGSVGElement): SVGSVGElement[] => Array.from(root.querySelectorAll("svg"));
/** The title <text> lines drawn on the root (not inside a pane). */
const rootTexts = (root: SVGSVGElement): SVGTextElement[] =>
  Array.from(root.querySelectorAll("text")).filter((t) => t.closest("svg") === root) as SVGTextElement[];
const num = (el: Element, a: string): number => Number(el.getAttribute(a));

describe("PNG export: pane titles wrap like the live grid", () => {
  const SHORT = { a: "Alpha", b: "Beta", c: "Gamma", d: "Delta" };

  it("a title wider than its column is drawn on several lines, each inside the column", () => {
    const root = buildExportSvg(spec({ ...SHORT, b: LONG }), rows);
    const panes = panesOf(root);
    const colW = num(panes[1]!, "width");
    expect(titleW(LONG)).toBeGreaterThan(colW); // precondition: it does not fit
    const words = new Set(LONG.split(" "));
    const lines = rootTexts(root).filter((t) => (t.textContent ?? "").split(" ").every((w) => words.has(w)) && num(t, "x") === num(panes[1]!, "x"));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.map((t) => t.textContent).join(" ")).toBe(LONG);
    for (const t of lines) expect(titleW(t.textContent ?? "")).toBeLessThanOrEqual(colW);
    // One line under the other, 16px apart, the first where a one-line title sits.
    const ys = lines.map((t) => num(t, "y"));
    for (let k = 1; k < ys.length; k++) expect(ys[k]! - ys[k - 1]!).toBe(16);
    const alpha = rootTexts(root).find((t) => t.textContent === "Alpha")!;
    expect(ys[0]).toBe(num(alpha, "y"));
  });

  it("every pane of that row starts below the wrapped title; the next row keeps a one-line band", () => {
    const short = buildExportSvg(spec(SHORT), rows);
    const wrapped = buildExportSvg(spec({ ...SHORT, b: LONG }), rows);
    const [s, w] = [panesOf(short), panesOf(wrapped)];
    const extra = num(w[0]!, "y") - num(s[0]!, "y");
    const lines = rootTexts(wrapped).filter((t) => LONG.includes(t.textContent ?? "\u0000") && (t.textContent ?? "").length > 0).length;
    expect(extra).toBe(16 * (lines - 1));
    expect(extra).toBeGreaterThan(0);
    // The row stays level: all three panes of row 0 share one y.
    expect(new Set(w.slice(0, 3).map((p) => num(p, "y"))).size).toBe(1);
    // Row 1 moves down by the same amount, and its band is the one-line 18px.
    expect(num(w[3]!, "y") - num(s[3]!, "y")).toBe(extra);
    const delta = rootTexts(wrapped).find((t) => t.textContent === "Delta")!;
    expect(num(w[3]!, "y") - (num(delta, "y") - 12)).toBe(18);
    // And the frame grows to hold it.
    expect(num(wrapped, "height") - num(short, "height")).toBe(extra);
  });

  it("per-pane mode wraps to its own (equal) columns the same way", () => {
    const perPane = (titles: Record<string, string>) =>
      spec(titles, { small_multiples: { mode: "per-pane", columns: 3, pane_titles: titles } });
    const short = panesOf(buildExportSvg(perPane(SHORT), rows));
    const wrapped = panesOf(buildExportSvg(perPane({ ...SHORT, c: LONG }), rows));
    expect(num(wrapped[0]!, "y") - num(short[0]!, "y")).toBeGreaterThanOrEqual(16);
    expect(new Set(wrapped.slice(0, 3).map((p) => num(p, "y"))).size).toBe(1);
  });

  it("a title that fits is drawn exactly as written, on one line", () => {
    const root = buildExportSvg(spec({ ...SHORT, a: "Two  spaces" }), rows);
    expect(rootTexts(root).some((t) => t.textContent === "Two  spaces")).toBe(true);
  });

  it("fillPanes: the panes shrink so the figure still fills the frame", () => {
    const frame = { width: 1000, height: 750, fillPanes: true };
    const short = buildExportSvg(spec(SHORT), rows, { frame });
    const wrapped = buildExportSvg(spec({ ...SHORT, b: LONG }), rows, { frame });
    expect(num(wrapped, "height")).toBe(num(short, "height"));
    const [s, w] = [panesOf(short), panesOf(wrapped)];
    // Two rows share the one extra line: each pane is 8px shorter.
    expect(num(s[0]!, "height") - num(w[0]!, "height")).toBe(8);
  });

  it("fillPanes with a wrapped title runs every hook as often as without one (the layout probe runs none)", () => {
    const counts = (titles: Record<string, string>) => {
      const c = { afterRender: 0, tickLabel: 0 };
      buildExportSvg(spec(titles), rows, {
        frame: { width: 1000, height: 750, fillPanes: true },
        hooks: {
          afterRender: () => void c.afterRender++,
          tickLabel: () => (c.tickLabel++, null),
        } as never,
      });
      return c;
    };
    const short = counts(SHORT);
    expect(short.tickLabel).toBeGreaterThan(0);
    expect(counts({ ...SHORT, b: LONG })).toEqual(short);
    // And as often as an export without a frame, which renders once.
    const c = { tickLabel: 0 };
    buildExportSvg(spec(SHORT), rows, { hooks: { tickLabel: () => (c.tickLabel++, null) } as never });
    expect(short.tickLabel).toBe(c.tickLabel);
  });

  it("fillPanes with a wrapped title still fires afterRender once per pane", () => {
    const calls: unknown[] = [];
    buildExportSvg(spec({ ...SHORT, b: LONG }), rows, {
      frame: { width: 1000, height: 750, fillPanes: true },
      hooks: { afterRender: (svg: SVGSVGElement) => calls.push(svg) } as never,
    });
    expect(calls).toHaveLength(PANES.length);
  });
});

// The archive figure the reviewer checked: budget-lab-charts
// articles/2026/10/scf-2025-tax-takeaways/home-sale-exclusion, a per-pane figure in two columns,
// exported in the slides' half frame (640 x 618, fillPanes). Its titles fit their 270px columns in
// Figtree, so neither may wrap, whatever the measuring backend (here jsdom, with no canvas).
describe("PNG export: archive pane titles that fit stay on one line", () => {
  const TITLES = ["Share of homeowners with gains above the exclusion", "Share of home gains above the exclusion"];
  const archive = (panes: string[]): [ChartSpec, TidyRow[]] => [
    {
      chartType: "line",
      title: "Home gains above the capital gains exclusion",
      xAxisType: "temporal",
      columns: { x: "year", value: "value", series: "series", facet: "panel" },
      small_multiples: { columns: 2, mode: "per-pane", pane_order: panes },
      yAxisPolicy: { min: 0 },
      data: "data.csv",
    } as unknown as ChartSpec,
    panes.flatMap((panel) =>
      ["1998", "2001", "2004", "2007"].map((year, i) => ({ year, panel, series: "Actual", value: String(1 + i) })),
    ) as unknown as TidyRow[],
  ];
  const HALF = { width: 640, height: 618, logoTop: 20, fillPanes: true, fitRows: true };

  it("home-sale-exclusion in the half frame: both titles on one line, panes where short titles put them", () => {
    const panes = panesOf(buildExportSvg(...archive(TITLES), { frame: HALF }));
    for (const title of TITLES) expect(titleW(title)).toBeLessThanOrEqual(num(panes[0]!, "width"));
    const root = buildExportSvg(...archive(TITLES), { frame: HALF });
    for (const title of TITLES) expect(rootTexts(root).some((t) => t.textContent === title)).toBe(true);
    const control = panesOf(buildExportSvg(...archive(["A", "B"]), { frame: HALF }));
    expect(panesOf(root).map((p) => num(p, "y"))).toEqual(control.map((p) => num(p, "y")));
    expect(panesOf(root).map((p) => num(p, "height"))).toEqual(control.map((p) => num(p, "height")));
  });
});
