// @vitest-environment jsdom
//
// The conformance test for #30's own headline invariant: "whatever a hook changes appears
// identically in the PNG export." Tasks 2-6 built each static hook (tickLabel, valueLabel,
// legendKey, afterRender) and each already has its own export-parity test — this file does not
// repeat those. What it adds is the ONE thing none of them can prove alone: that all four still
// thread correctly at the SAME TIME, against the SAME spec, in a SINGLE render. #30 called the
// invariant "quietly false for three features so far" — every prior break was a hook (or a
// hook-shaped feature) that worked alone in a unit test and then lost its thread the moment
// another feature's wiring sat next to it. If this test ever fails, that is this exact defect
// recurring: fix the threading in render-live.ts / export-png.ts, not this test.
//
// The comparison basis is `renderChart` vs `buildExportSvg`, matching every other hook test in
// this repo — NOT `mountChart`, whose live DOM adds interactive hover chrome (a crosshair hit
// rect, coord-group elements) that a static export never has. Comparing a MOUNTED tree's mark
// count to the export's would fail for a reason that has nothing to do with hooks. `legendKey` is
// the one hook here that a bare `renderChart` never calls at all (the live legend is built by
// render-live.ts's mountChart, not by renderChart) — it gets its own mountChart-based check below,
// with its own small hooks object, so its `afterRender`/`tooltip` call counts don't leak into the
// main comparison's counters.
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import { mountChart } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";
import type { RenderHooks } from "../src/spec/hooks";

const SVG_NS = "http://www.w3.org/2000/svg";

// A stacked, 2-series, categorical chart with value labels on: one spec that simultaneously
// exercises a value-axis tick (tickLabel), an in-bar segment label + net callout (valueLabel), a
// multi-series legend (legendKey), and the assembled SVG itself (afterRender) — all four static
// hooks, in one render, as the brief requires ("all four together — the point is the guarantee as
// a whole, not each hook again").
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

const OPTS = { width: 720, height: 400, document };

// `svg.tblchart` (assemble-plot.ts's PLOT_CLASS) selects the plot itself.
const chartSvg = (root: ParentNode): SVGSVGElement => root.querySelector<SVGSVGElement>("svg.tblchart")!;

// Shape marks only (not text) — a hook rewrites TEXT content, never geometry, so this count must
// be identical on both paths regardless of which hooks are active. A mismatch means a mark layer
// silently failed to draw on one of the two paths, not a hook doing its job.
const MARK_SELECTOR = "rect, path, circle, line, polygon";
const markCount = (svg: SVGSVGElement) => svg.querySelectorAll(MARK_SELECTOR).length;
const textContents = (svg: SVGSVGElement) =>
  Array.from(svg.querySelectorAll("text")).map((t) => t.textContent ?? "").sort();

describe("hooks export parity — all four static hooks together (#30)", () => {
  const afterRenderPhases: string[] = [];
  let tooltipCalls = 0;

  const hooks: RenderHooks = {
    tickLabel: (v) => `T:${v}`,
    valueLabel: (ctx) => `V:${ctx.rendered}`,
    afterRender: (svg, ctx) => {
      afterRenderPhases.push(ctx.phase);
      svg.setAttribute("data-hooked", "1");
    },
    // SCREEN-ONLY, deliberately included alongside the static hooks (see spec/hooks.ts's module
    // note and CONFIG-SPEC.md's Customisation section): a static PNG has no hover state, so there
    // is nothing for `tooltip` to be identical to. Do NOT thread this into buildExportSvg to make
    // the assertion below pass differently — that would undo a deliberate design decision, not
    // fix a gap.
    tooltip: () => {
      tooltipCalls++;
      return '<div class="hooked-tooltip">should never appear in a static export</div>';
    },
  };

  const liveSvg = renderChart(SPEC, ROWS, { ...OPTS, hooks }).svg;
  const exportRoot = buildExportSvg(SPEC, ROWS, { hooks });
  const exportChartSvg = chartSvg(exportRoot);

  it("has sane preconditions (both svgs found, at least one mark each)", () => {
    expect(liveSvg).not.toBeUndefined();
    expect(exportChartSvg).not.toBeUndefined();
    expect(markCount(liveSvg)).toBeGreaterThan(0);
  });

  it("draws the same number of marks in the chart body, live and exported", () => {
    expect(markCount(exportChartSvg)).toBe(markCount(liveSvg));
  });

  it("renders the same tick-label and value-label text, live and exported", () => {
    expect(textContents(exportChartSvg)).toEqual(textContents(liveSvg));
    // Sanity: both hooks actually fired, or the equality above would be vacuously true.
    expect(textContents(liveSvg).some((t) => t.startsWith("T:"))).toBe(true);
    expect(textContents(liveSvg).some((t) => t.startsWith("V:"))).toBe(true);
  });

  it("fires afterRender exactly once per path, with the matching phase, mutating both svgs", () => {
    expect(afterRenderPhases).toEqual(["live", "export"]);
    expect(liveSvg.getAttribute("data-hooked")).toBe("1");
    expect(exportChartSvg.getAttribute("data-hooked")).toBe("1");
  });

  // The one deliberate exception to the guarantee this file otherwise proves. Not a gap — see the
  // module comment above and the `tooltip` hook's own comment.
  it("never calls the tooltip hook while building the export — screen-only, by design", () => {
    expect(tooltipCalls).toBe(0);
    expect(exportRoot.outerHTML).not.toContain("hooked-tooltip");
  });
});

// legendKey gets its own render pair (a mountChart live legend + a fresh buildExportSvg call),
// with its own hooks object, so it does not share `afterRenderPhases`/`tooltipCalls` with the
// suite above.
describe("hooks export parity — legendKey (own render, own hooks)", () => {
  const legendMediums: string[] = [];
  const legendHooks: RenderHooks = {
    legendKey: (ctx) => {
      legendMediums.push(ctx.medium);
      // Medium-aware, as CONFIG-SPEC.md / spec/hooks.ts require: an HTML fragment on the live
      // ("html") legend, an SVG fragment on the export ("svg") legend — a hook that returned HTML
      // unconditionally would look right on screen and silently vanish from the download.
      return ctx.medium === "svg"
        ? `<g class="hooked-legend-key">${ctx.rendered}</g>`
        : `<span class="hooked-legend-key">${ctx.rendered}</span>`;
    },
  };

  const container = document.createElement("div");
  document.body.appendChild(container);
  mountChart(container, { spec: SPEC, rows: ROWS, width: 720, height: 400, hooks: legendHooks });
  const exportRoot = buildExportSvg(SPEC, ROWS, { hooks: legendHooks });

  it("threads legendKey to the export in the SVG vocabulary, matching the live HTML-vocabulary call", () => {
    // Live: an HTML legend button consumes the hook's HTML fragment.
    expect(container.querySelector(".hooked-legend-key")).not.toBeNull();
    // Export: an SVG <g> consumes the hook's SVG fragment, properly namespaced — the failure mode
    // this guards against is a medium-blind hook whose HTML lands in the export as an
    // XHTML-namespaced node that a canvas rasterizer never paints (spec/hooks.ts, CONFIG-SPEC.md).
    const exportedKey = exportRoot.querySelector("g.hooked-legend-key");
    expect(exportedKey).not.toBeNull();
    expect(exportedKey!.namespaceURI).toBe(SVG_NS);
    expect(legendMediums).toContain("html");
    expect(legendMediums).toContain("svg");
  });
});
