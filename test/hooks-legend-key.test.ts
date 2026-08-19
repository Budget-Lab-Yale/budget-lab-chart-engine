// @vitest-environment jsdom
//
// The parity guarantee: a static hook's output must appear in the PNG export identically, because
// the export re-renders through the same builders with the same hooks object rather than
// serialising the live legend DOM. `legendKey` replaces one legend row's key markup; `rendered`
// carries the engine's own markup, in the caller's `medium`, so a hook can wrap rather than
// reconstruct it (#30).
//
// `medium` matters in a way a string-equality assertion cannot catch: the live legend is an HTML
// button (innerHTML parses HTML), but the export's row is an SVG <g> (export-png.ts's
// drawLegend) -- setting ITS innerHTML to an HTML string like '<span>' creates XHTML-namespaced
// nodes that the export's rasterizer (XMLSerializer -> Image -> canvas.drawImage, rasterize())
// never paints. A hook that switches on ctx.medium renders in both; one that ignores it renders
// on screen and silently vanishes from the download -- exactly the failure #30 exists to
// eliminate. The export assertions below check the actual node NAMESPACE, not merely that a
// string appears somewhere in the serialized markup.
import { describe, it, expect, beforeEach } from "vitest";
import { mountChart } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";
import type { RenderHooks } from "../src/spec/hooks";

const SVG_NS = "http://www.w3.org/2000/svg";

const ROWS: TidyRow[] = [
  { time: "Q1", value: "10", series: "A" },
  { time: "Q1", value: "20", series: "B" },
  { time: "Q2", value: "30", series: "A" },
  { time: "Q2", value: "40", series: "B" },
] as unknown as TidyRow[];

// Two series, so the legend actually draws rows (a single-series chart may suppress it entirely).
const SPEC = {
  chartType: "line",
  title: "t",
  xAxisType: "categorical",
  data: "data.csv",
  columns: { x: "time", value: "value", series: "series" },
} as unknown as ChartSpec;

const HTML_REPLACEMENT = '<span class="mine">A!</span>';
const SVG_REPLACEMENT = '<text class="mine" x="16" y="10">A!</text>';

// A well-behaved hook: switches on ctx.medium, as the docs (spec/hooks.ts) require.
const hooks: RenderHooks = {
  legendKey: (ctx) =>
    ctx.series !== "A" ? null : ctx.medium === "svg" ? SVG_REPLACEMENT : HTML_REPLACEMENT,
};

// A naive hook that ignores ctx.medium and always returns HTML -- the exact defect this suite
// guards against: correct on screen, invisible in the export.
const mediumBlindHooks: RenderHooks = {
  legendKey: (ctx) => (ctx.series === "A" ? HTML_REPLACEMENT : null),
};

function mount(h?: RenderHooks): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  mountChart(el, { spec: SPEC, rows: ROWS, width: 720, height: 400, ...(h ? { hooks: h } : {}) });
  return el;
}

const legendItem = (root: ParentNode, series: string): HTMLElement =>
  Array.from(root.querySelectorAll<HTMLElement>(".tbl-legend-item")).find(
    (b) => b.dataset.series === series,
  )!;

const foreignNodes = (root: ParentNode): Element[] =>
  Array.from(root.querySelectorAll("*")).filter((n) => n.namespaceURI !== SVG_NS);

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("hooks.legendKey", () => {
  it("replaces the hooked series' key only, on screen", () => {
    const el = mount(hooks);
    expect(legendItem(el, "A").innerHTML).toContain(HTML_REPLACEMENT);
    // Series B is untouched: still carries the engine's own icon + label.
    const b = legendItem(el, "B");
    expect(b.querySelector("svg")).not.toBeNull();
    expect(b.textContent).toContain("B");
  });

  it("leaves the engine's key when the hook returns null", () => {
    const el = mount({ legendKey: () => null });
    for (const series of ["A", "B"]) {
      const item = legendItem(el, series);
      expect(item.querySelector("svg")).not.toBeNull();
      expect(item.innerHTML).not.toContain(HTML_REPLACEMENT);
    }
  });

  it("tells the hook which medium it is building for", () => {
    const seen: string[] = [];
    mount({ legendKey: (ctx) => { seen.push(ctx.medium); return null; } });
    buildExportSvg(SPEC, ROWS, {
      hooks: { legendKey: (ctx) => { seen.push(ctx.medium); return null; } },
    });
    // Two series each: two "html" calls from the live mount, two "svg" calls from the export.
    expect(seen).toEqual(["html", "html", "svg", "svg"]);
  });

  it("a medium-appropriate hook's SVG markup lands in the SVG namespace in the export", () => {
    const svg = buildExportSvg(SPEC, ROWS, { hooks });
    const rowText = Array.from(svg.querySelectorAll("text.mine"));
    expect(rowText).toHaveLength(1);
    expect(rowText[0]!.namespaceURI).toBe(SVG_NS);
    // No XHTML-namespaced node reached the export at all -- a canvas rasterizer walking this SVG
    // paints everything present.
    expect(foreignNodes(svg)).toHaveLength(0);
  });

  // Neither test below reaches for a hardcoded literal: the hook's own body reads
  // `ctx.rendered`, so if the export site regressed to handing it legend.ts's HTML string
  // (instead of legendRowMarkupSvg's SVG string) while still labelling `medium: "svg"`, these
  // would fail on the namespace check even though every OTHER test in this file -- whose hooks
  // return hardcoded literals and never touch `ctx.rendered` -- would keep passing.
  it("a genuine pass-through hook (ctx => ctx.rendered) still renders as SVG in the export", () => {
    const passThrough: RenderHooks = {
      legendKey: (ctx) => (ctx.series === "A" ? ctx.rendered : null),
    };
    const svg = buildExportSvg(SPEC, ROWS, { hooks: passThrough });
    expect(foreignNodes(svg)).toHaveLength(0);
    // The key's own SVG-namespaced <text> (its label) is actually present, not merely absent-of-
    // foreign-nodes by virtue of an empty/failed row.
    const labelTexts = Array.from(svg.querySelectorAll("text")).filter(
      (t) => t.namespaceURI === SVG_NS && t.textContent === "A",
    );
    expect(labelTexts.length).toBeGreaterThan(0);
  });

  it("a wrap hook (`<g>${ctx.rendered}</g>`) also renders as SVG in the export", () => {
    const wrap: RenderHooks = {
      legendKey: (ctx) => (ctx.series === "A" ? `<g class="mine">${ctx.rendered}</g>` : null),
    };
    const svg = buildExportSvg(SPEC, ROWS, { hooks: wrap });
    expect(foreignNodes(svg)).toHaveLength(0);
    const wrapped = svg.querySelector("g.mine");
    expect(wrapped).not.toBeNull();
    expect(wrapped!.namespaceURI).toBe(SVG_NS);
    const labelTexts = Array.from(wrapped!.querySelectorAll("text")).filter(
      (t) => t.namespaceURI === SVG_NS && t.textContent === "A",
    );
    expect(labelTexts.length).toBeGreaterThan(0);
  });

  it("THE DEFECT this guards against: a hook that ignores ctx.medium renders on screen but not in the export", () => {
    const el = mount(mediumBlindHooks);
    expect(legendItem(el, "A").innerHTML).toContain(HTML_REPLACEMENT);

    const svg = buildExportSvg(SPEC, ROWS, { hooks: mediumBlindHooks });
    // The HTML string still lands as literal text in the serialized markup...
    expect(svg.outerHTML).toContain(HTML_REPLACEMENT);
    // ...but as an XHTML-namespaced node under an SVG root, which is exactly why nothing paints:
    // a canvas rasterizer walking this tree only draws SVG-namespaced elements. A string-equality
    // assertion (svg.outerHTML.toContain(...)) alone would pass here despite the visual bug --
    // that is why the other export tests above assert on `namespaceURI`, not on string content.
    expect(foreignNodes(svg).length).toBeGreaterThan(0);
  });

  it("renders byte-identically with no hooks at all", () => {
    const a = mount().innerHTML;
    const b = mount({}).innerHTML;
    expect(b).toBe(a);
  });

  it("export renders byte-identically with no hooks at all", () => {
    const a = buildExportSvg(SPEC, ROWS, {}).outerHTML;
    const b = buildExportSvg(SPEC, ROWS, { hooks: {} }).outerHTML;
    expect(b).toBe(a);
  });
});
