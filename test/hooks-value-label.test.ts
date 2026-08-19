// @vitest-environment jsdom
//
// The parity guarantee: a static hook's output must appear in the PNG export identically, because
// the export RE-RENDERS from the spec rather than serialising the DOM (#30). `valueLabel` is
// consumed by BOTH mark builders that draw a static in-mark value label — stacked (segment labels
// + the cumulative net callout) and waterfall (running-total labels) — so both are exercised here.
//
// Value labels are OFF by default (`spec.valueLabels.show === true` is required); every spec below
// sets it, or these assertions would be vacuous.
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import { buildExportSvg } from "../src/embed/export-png";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";
import type { RenderHooks } from "../src/spec/hooks";

const OPTS = { width: 720, height: 400, document };

const texts = (svg: SVGSVGElement) =>
  Array.from(svg.querySelectorAll("text")).map((t) => t.textContent ?? "");

const prefixed = (svg: SVGSVGElement) => texts(svg).filter((t) => t.startsWith("H:"));

describe("hooks.valueLabel — stacked (segment labels + net callout)", () => {
  const ROWS: TidyRow[] = [
    { cat: "A", series: "x", value: "3" },
    { cat: "A", series: "y", value: "2" },
    { cat: "B", series: "x", value: "6" },
    { cat: "B", series: "y", value: "1" },
  ] as unknown as TidyRow[];

  const SPEC = {
    chartType: "stacked",
    title: "t",
    xAxisType: "categorical",
    data: "data.csv",
    columns: { x: "cat", value: "value", series: "series" },
    valueLabels: { show: true },
  } as unknown as ChartSpec;

  // 4 segment labels ("3","2","6","1") + 2 net callouts ("5","7" — no negatives, so netMode
  // resolves to "text"): 6 static value-label texts total, every one of which must be hooked.
  const hooks: RenderHooks = { valueLabel: (ctx) => `H:${ctx.rendered}` };

  it("replaces every in-bar segment label AND the net callout on the live render", () => {
    const { svg } = renderChart(SPEC, ROWS, { ...OPTS, hooks });
    const hooked = prefixed(svg);
    expect(hooked.sort()).toEqual(["H:1", "H:2", "H:3", "H:5", "H:6", "H:7"].sort());
  });

  it("leaves every value label alone when the hook returns null", () => {
    const { svg } = renderChart(SPEC, ROWS, { ...OPTS, hooks: { valueLabel: () => null } });
    expect(prefixed(svg)).toEqual([]);
    const all = texts(svg);
    for (const v of ["1", "2", "3", "5", "6", "7"]) expect(all).toContain(v);
  });

  it("appears IDENTICALLY in the export — the whole point", () => {
    const live = prefixed(renderChart(SPEC, ROWS, { ...OPTS, hooks }).svg).sort();
    const exported = prefixed(buildExportSvg(SPEC, ROWS, { hooks })).sort();
    expect(exported).toEqual(live);
    expect(exported.length).toBe(6);
  });

  it("renders byte-identically with no hooks at all", () => {
    const a = renderChart(SPEC, ROWS, OPTS).svg.outerHTML;
    const b = renderChart(SPEC, ROWS, { ...OPTS, hooks: {} }).svg.outerHTML;
    expect(b).toBe(a);
  });
});

describe("hooks.valueLabel — waterfall (running-total labels)", () => {
  const ROWS: TidyRow[] = [
    { cat: "Start", value: "100", kind: "total" },
    { cat: "Up", value: "40", kind: "delta" },
    { cat: "Down", value: "-10", kind: "delta" },
  ] as unknown as TidyRow[];

  const SPEC = {
    chartType: "waterfall",
    title: "t",
    xAxisType: "categorical",
    data: "data.csv",
    columns: { x: "cat", value: "value", kind: "kind" },
    valueLabels: { show: true },
  } as unknown as ChartSpec;

  // Running levels: Start=100, Up=140, Down=130 — 3 static running-total labels.
  const hooks: RenderHooks = { valueLabel: (ctx) => `H:${ctx.rendered}` };

  it("replaces every running-total label on the live render", () => {
    const { svg } = renderChart(SPEC, ROWS, { ...OPTS, hooks });
    expect(prefixed(svg).sort()).toEqual(["H:100", "H:130", "H:140"].sort());
  });

  it("leaves the running-total labels alone when the hook returns null", () => {
    const { svg } = renderChart(SPEC, ROWS, { ...OPTS, hooks: { valueLabel: () => null } });
    expect(prefixed(svg)).toEqual([]);
    const all = texts(svg);
    for (const v of ["100", "140", "130"]) expect(all).toContain(v);
  });

  it("appears IDENTICALLY in the export — the whole point", () => {
    const live = prefixed(renderChart(SPEC, ROWS, { ...OPTS, hooks }).svg).sort();
    const exported = prefixed(buildExportSvg(SPEC, ROWS, { hooks })).sort();
    expect(exported).toEqual(live);
    expect(exported.length).toBe(3);
  });

  it("renders byte-identically with no hooks at all", () => {
    const a = renderChart(SPEC, ROWS, OPTS).svg.outerHTML;
    const b = renderChart(SPEC, ROWS, { ...OPTS, hooks: {} }).svg.outerHTML;
    expect(b).toBe(a);
  });
});
