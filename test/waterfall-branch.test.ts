// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { computeWaterfallSteps } from "../src/engine/scales";
import { buildWaterfallMarks } from "../src/engine/marks/waterfall";
import { validateChart } from "../src/spec/validate";
import type { PreparedRow, MarkContext } from "../src/engine/marks/index";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";
import { renderChart } from "../src/engine/index";
import { mountHover, hoverFirstMark, coordShown, coordTexts, BAR_MARK } from "./helpers/hover-harness";

const row = (cat: string, y: number, kind = ""): PreparedRow =>
  ({ series: "", time: cat, _xc: cat, _y: y, ...(kind ? { _kind: kind } : {}) }) as PreparedRow;

describe("waterfall branch kind", () => {
  it("draws a bar without advancing the running total", () => {
    const s = computeWaterfallSteps([row("a", 10), row("b", 5, "branch"), row("c", 3)]);
    expect(s[1]).toMatchObject({ kind: "branch", before: 10, level: 15, base: 10, top: 15 });
    expect(s[2]).toMatchObject({ before: 10, level: 13 }); // NOT 15
  });

  it("an empty kind is a delta, and a blank total after a branch draws the running total (10, not the branch level 15)", () => {
    const s = computeWaterfallSteps([row("a", 10, ""), row("b", 5, "branch"), { ...row("c", 0, "total"), _y: null } as PreparedRow]);
    expect(s[0]).toMatchObject({ kind: "delta", level: 10 });
    expect(s[2]).toMatchObject({ kind: "total", base: 0, top: 10 });
  });

  it("is accepted by the validator; unknown kinds still are not", () => {
    const spec = { chartType: "waterfall", xAxisType: "categorical", title: "t",
      columns: { x: "c", value: "v", kind: "k" }, data: "d.csv" };
    const ok = validateChart(spec, [{ c: "a", v: "1", k: "" }, { c: "b", v: "2", k: "branch" }] as never);
    expect(ok.valid).toBe(true);
    const bad = validateChart(spec, [{ c: "a", v: "1", k: "bogus" }] as never);
    expect(bad.valid).toBe(false);
    expect(bad.errors.join(" ")).toMatch(/branch/);
  });

  it("marks: the connector leaving a branch sits at the running total, and a hollow box spans 0 to its level", () => {
    const spec = { chartType: "waterfall", xAxisType: "categorical", title: "t",
      columns: { x: "c", value: "v", kind: "k" } } as unknown as ChartSpec;
    const ctx = { xField: "_xc", colors: new Map() } as unknown as MarkContext;
    const layers = buildWaterfallMarks([row("a", 10), row("b", 5, "branch"), row("c", 3)], spec, ctx);
    const marks = layers.overlay as Array<{ data?: Array<Record<string, unknown>> }>;
    const conn = marks.find((m) => m.data?.some((d) => "x1" in d))!.data!;
    expect(conn.find((d) => d.x1 === "a")).toMatchObject({ x2: "b", y: 10 });
    expect(conn.find((d) => d.x1 === "b")).toMatchObject({ x2: "c", y: 10 }); // leaves b at 10, not 15
    const hollow = marks.find((m) => m.data?.some((d) => "_top" in d && !("_base" in d)))!.data!;
    expect(hollow).toEqual([{ _xc: "b", _top: 15 }]);
  });

  it("marks: a waterfall with no branch step draws no hollow box", () => {
    const spec = { chartType: "waterfall", xAxisType: "categorical", title: "t",
      columns: { x: "c", value: "v" } } as unknown as ChartSpec;
    const ctx = { xField: "_xc", colors: new Map() } as unknown as MarkContext;
    const layers = buildWaterfallMarks([row("a", 10), row("c", 3)], spec, ctx);
    const marks = layers.overlay as Array<{ data?: Array<Record<string, unknown>> }>;
    expect(marks.some((m) => m.data?.some((d) => "_top" in d && !("_base" in d)))).toBe(false);
  });
});

describe("waterfall branch step: rendered and hovered", () => {
  const spec = { chartType: "waterfall", xAxisType: "categorical", title: "t",
    columns: { x: "time", value: "value", kind: "kind" } } as unknown as ChartSpec;
  const rows = [["Start", "10", "total"], ["Side", "5", "branch"], ["Next", "3", "delta"]]
    .map(([time, value, kind]) => ({ time, value, kind })) as unknown as TidyRow[];

  it("draws one unfilled box beside the three bars, outside the bar group", () => {
    const { svgs } = mountHover(spec, rows);
    const rects = Array.from(svgs[0]!.querySelectorAll(BAR_MARK));
    expect(rects).toHaveLength(3); // the box is not a "bar" to the hover cursor
    const boxes = Array.from(svgs[0]!.querySelectorAll('g[aria-label="branch box"] rect'));
    expect(boxes).toHaveLength(1);
    const hollow = boxes[0]!;
    expect(hollow.parentElement!.getAttribute("fill")).toBe("none");
    // 0 -> 15 is three times the height of the branch bar's own 10 -> 15 span, on the branch's slot.
    expect(parseFloat(hollow.getAttribute("height")!)).toBeCloseTo(3 * parseFloat(rects[1]!.getAttribute("height")!), 5);
    expect(hollow.getAttribute("x")).toBe(rects[1]!.getAttribute("x"));
    expect(hollow.hasAttribute("data-series")).toBe(false);
  });

  it("the export path draws the box too", () => {
    const { svg } = renderChart(spec, rows, { width: 720, height: 400, document });
    expect(svg.querySelectorAll('g[aria-label="branch box"] rect')).toHaveLength(1);
    expect(svg.querySelectorAll(BAR_MARK)).toHaveLength(3);
  });

  it("hovering a branch bar shows exactly one signed value pill, as a delta does", () => {
    const { svgs } = mountHover(spec, rows);
    const svg = svgs[0]!;
    hoverFirstMark(svg, `${BAR_MARK}:nth-of-type(2)`);
    expect(coordShown(svg)).toBe(true);
    expect(coordTexts(svg).filter((s) => s.includes("+5"))).toHaveLength(1);
    expect(svg.querySelectorAll("g.tbl-coord .tbl-coord-pill")).toHaveLength(1);
  });

  it("a negative branch in first position also gets one pill", () => {
    const neg = [["Side", "-5", "branch"], ["Next", "3", "delta"]]
      .map(([time, value, kind]) => ({ time, value, kind })) as unknown as TidyRow[];
    const { svgs } = mountHover(spec, neg);
    const svg = svgs[0]!;
    hoverFirstMark(svg, BAR_MARK);
    expect(coordShown(svg)).toBe(true);
    expect(svg.querySelectorAll("g.tbl-coord .tbl-coord-pill")).toHaveLength(1);
    expect(coordTexts(svg).filter((s) => /5/.test(s))).toHaveLength(1);
  });

  it("the value label on a branch is the top of its own bar, not the running total", () => {
    const labelled = { ...spec, valueLabels: { show: true } } as unknown as ChartSpec;
    const { svgs } = mountHover(labelled, rows);
    // Value labels carry their bar's colour as a `fill`; axis tick text does not.
    const texts = Array.from(svgs[0]!.querySelectorAll("text[fill]")).map((t) => t.textContent);
    expect(texts).toEqual(["10", "15", "13"]); // branch: 10 + 5; next builds from 10, not 15
  });

  it("a skip step draws no bar of its own height but keeps its category slot", () => {
    const skipRows = [["A", "10", ""], ["Gap", "", "skip"], ["B", "5", ""]]
      .map(([time, value, kind]) => ({ time, value, kind })) as unknown as TidyRow[];
    const { svgs } = mountHover(spec, skipRows);
    const rects = Array.from(svgs[0]!.querySelectorAll(BAR_MARK));
    expect(rects).toHaveLength(3); // one rect per slot, the skip's has no height
    expect(parseFloat(rects[1]!.getAttribute("height")!)).toBe(0);
    expect(svgs[0]!.textContent).toContain("Gap");
  });
});
