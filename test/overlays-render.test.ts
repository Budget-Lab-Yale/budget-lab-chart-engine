// @vitest-environment jsdom
//
// End-to-end wiring for `overlays`. The geometry is unit-tested in test/overlays-resolve.test.ts;
// this file locks which marks are emitted, that they reach the EXPORT path, that they clip, and that
// a chart without overlays emits nothing.
import { describe, it, expect } from "vitest";
import { renderChart, renderPane, renderFigure } from "../src/engine/index";
import { buildExportSvg } from "../src/embed/export-png";
import { OVERLAY_LINE_CLASS, OVERLAY_BAND_CLASS } from "../src/engine/marks/overlay";
import { validateSpec, validateChartData } from "../src/spec/validate";
import { TBL } from "../src/engine/theme";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const BASE = {
  chartType: "scatter",
  title: "t",
  xAxisType: "numeric",
  data: "data.csv",
  columns: { x: "time", value: "value", series: "series" },
} as unknown as ChartSpec;

const ROWS: TidyRow[] = [
  { time: "1", value: "1", series: "A", yhat: "1.2" },
  { time: "2", value: "3", series: "A", yhat: "2.2" },
  { time: "3", value: "2", series: "A", yhat: "3.2" },
  { time: "4", value: "5", series: "A", yhat: "4.2" },
] as unknown as TidyRow[];

const OPTS = { width: 720, height: 400, document };

const lines = (svg: SVGSVGElement) =>
  Array.from(svg.querySelectorAll<SVGPathElement>(`g.${OVERLAY_LINE_CLASS} path`));

// Presentation attributes (stroke, stroke-dasharray) land on the overlay's <g> wrapper, not each
// <path> — Plot hoists constant mark styling there, and SVG presentation attributes inherit down
// to children, so the DOM (and the PNG export, which rasterises the same DOM) render correctly
// without copying anything onto the <path>. Read the group for style; read `lines` (above) to
// confirm a path actually exists underneath it, so relaxing the element can't pass on an empty group.
const groups = (svg: SVGSVGElement) =>
  Array.from(svg.querySelectorAll<SVGGElement>(`g.${OVERLAY_LINE_CLASS}`));

function spec(overlays: unknown[], patch: Record<string, unknown> = {}): ChartSpec {
  return { ...BASE, ...patch, overlays } as ChartSpec;
}

describe("overlays — mark emission", () => {
  it("emits nothing when `overlays` is absent", () => {
    expect(lines(renderChart(BASE, ROWS, OPTS).svg).length).toBe(0);
  });

  it("emits one path for a single fit", () => {
    expect(lines(renderChart(spec([{ method: "lm" }]), ROWS, OPTS).svg).length).toBe(1);
  });

  it("emits one path per overlay, in list order", () => {
    const { svg } = renderChart(
      spec([{ method: "lm" }, { slope: 1, intercept: 0 }, { fun: "2*x" }]),
      ROWS,
      OPTS,
    );
    expect(lines(svg).length).toBe(3);
  });

  it("emits one path per series for a per-series fit", () => {
    const two = [
      ...ROWS,
      { time: "1", value: "10", series: "B" },
      { time: "2", value: "12", series: "B" },
    ] as unknown as TidyRow[];
    expect(lines(renderChart(spec([{ method: "lm" }]), two, OPTS).svg).length).toBe(2);
  });

  it("draws a `column` overlay from the named data column", () => {
    expect(lines(renderChart(spec([{ column: "yhat" }]), ROWS, OPTS).svg).length).toBe(1);
  });
});

describe("overlays — stroke presentation", () => {
  it("draws a fit solid", () => {
    const svg = renderChart(spec([{ method: "lm" }]), ROWS, OPTS).svg;
    expect(lines(svg).length).toBeGreaterThan(0);
    const g = groups(svg)[0]!;
    expect(g.getAttribute("stroke-dasharray")).toBeNull();
  });

  it("draws an abline dashed in the dim annotation neutral", () => {
    const svg = renderChart(spec([{ slope: 1, intercept: 0 }]), ROWS, OPTS).svg;
    expect(lines(svg).length).toBeGreaterThan(0);
    const g = groups(svg)[0]!;
    expect(g.getAttribute("stroke-dasharray")).toBeTruthy();
    expect(g.getAttribute("stroke")).toBe(TBL.color.annotationDim);
  });

  it("honours an explicit colour and style", () => {
    const svg = renderChart(
      spec([{ method: "lm", color: "#00ff00", style: "dashed" }]),
      ROWS,
      OPTS,
    ).svg;
    expect(lines(svg).length).toBeGreaterThan(0);
    const g = groups(svg)[0]!;
    expect(g.getAttribute("stroke")).toBe("#00ff00");
    expect(g.getAttribute("stroke-dasharray")).toBeTruthy();
  });
});

describe("overlays — series tagging", () => {
  // Pins the combined-selector `data-series` tagging in marks/overlay.ts: a per-series fit's path
  // carries its own series (for legend pin/dim), and a series-less overlay sharing the same class
  // must not be mistaken for one of the real series.
  it("tags each per-series fit's path with its own series, and the series-less overlay with neither", () => {
    const two = [
      ...ROWS,
      { time: "1", value: "10", series: "B" },
      { time: "2", value: "12", series: "B" },
    ] as unknown as TidyRow[];
    const { svg } = renderChart(spec([{ method: "lm" }, { slope: 1, intercept: 0 }]), two, OPTS);
    const paths = lines(svg);
    expect(paths.length).toBe(3);

    const bySeries = new Map(paths.map((p) => [p.getAttribute("data-series"), p]));
    expect(bySeries.has("A")).toBe(true);
    expect(bySeries.has("B")).toBe(true);

    // Exactly one path (the abline) is left over, tagged with neither real series name.
    const untagged = paths.filter(
      (p) => p.getAttribute("data-series") !== "A" && p.getAttribute("data-series") !== "B",
    );
    expect(untagged.length).toBe(1);

    // Distinct series get distinct colours (read off the wrapper — see `groups` above).
    const colorOf = (p: SVGPathElement) => p.closest(`g.${OVERLAY_LINE_CLASS}`)!.getAttribute("stroke");
    expect(colorOf(bySeries.get("A")!)).not.toBe(colorOf(bySeries.get("B")!));
  });
});

describe("overlays — clipping", () => {
  it("clips an overlay that leaves the frame, even though the DATA fits inside it", () => {
    // `clipMarks` is computed from the data's drawn extent (index.ts) and knows nothing about
    // overlays, so a steep constructed line would otherwise paint over the axis labels and title.
    // Plot's `clip: true` wraps the mark in a <g clip-path=…>.
    const { svg } = renderChart(spec([{ fun: "1000*x", domain: [0, 10] }]), ROWS, OPTS);
    const g = svg.querySelector(`g.${OVERLAY_LINE_CLASS}`)!;
    const clipped =
      g.getAttribute("clip-path") != null || g.closest("g[clip-path]") != null;
    expect(clipped).toBe(true);
  });
});

describe("overlays — the value axis", () => {
  // Asserted on the resolved domain itself, via renderPane (exported at index.ts:300), whose
  // PaneResult.yDomain is "the y-domain this pane was rendered against". This is the subtlest decision
  // in the feature, so it is asserted directly rather than through a rendering of it.
  const yDomainOf = (s: ChartSpec, rows: TidyRow[]) => renderPane(s, rows, OPTS).yDomain;

  it("folds a `column` overlay into the y extent, so it cannot sit off-frame", () => {
    // A column is real per-row data, like confidence_bands' bounds. Push it far above the data and the
    // axis has to follow.
    const high: TidyRow[] = ROWS.map((r) => ({ ...r, yhat: "500" })) as TidyRow[];
    const [, hi] = yDomainOf(spec([{ column: "yhat" }]), high);
    expect(hi).toBeGreaterThanOrEqual(500);
  });

  it("leaves the y extent alone without a column overlay, for the same data", () => {
    const high: TidyRow[] = ROWS.map((r) => ({ ...r, yhat: "500" })) as TidyRow[];
    const [, hi] = yDomainOf(spec([{ method: "lm" }]), high);
    expect(hi).toBeLessThan(500);
  });

  it("does NOT fold a constructed line into the y extent", () => {
    // fun reaches y = 10000 at the right edge of its domain; the axis must not follow it.
    const [, hi] = yDomainOf(spec([{ fun: "1000*x", domain: [0, 10] }]), ROWS);
    expect(hi).toBeLessThan(1000);
  });

  it("does not fold a FIT that extrapolates far past the data", () => {
    // An explicit domain, not `axis`: on a numeric axis the resolved x domain IS the data extent
    // (x-adapter.ts sets `domain: [xMin, xMax]` from the data), so `domain: "axis"` keeps the fit
    // inside the data's own y range and would pass this even if fits DID fold in. The fitted slope
    // here is 1.1, so x = 1000 puts the line near y = 1100.
    const [, hi] = yDomainOf(spec([{ method: "lm", domain: [0, 1000] }]), ROWS);
    expect(hi).toBeLessThan(100);
  });
});

describe("overlays — the export path", () => {
  it("reaches the exported SVG, which rebuilds from the spec", () => {
    expect(lines(buildExportSvg(spec([{ method: "lm" }]), ROWS)).length).toBe(1);
  });

  it("reaches it for every kind", () => {
    const svg = buildExportSvg(
      spec([{ method: "lm" }, { fun: "2*x" }, { slope: 1, intercept: 0 }, { column: "yhat" }]),
      ROWS,
    );
    expect(lines(svg).length).toBe(4);
  });
});

describe("overlays — a line chart with a stated rule", () => {
  it("draws a 45-degree line over a line chart", () => {
    const s = spec([{ slope: 1, intercept: 0 }], { chartType: "line" });
    expect(lines(renderChart(s, ROWS, OPTS).svg).length).toBe(1);
  });
});

describe("overlays — confidence ribbon", () => {
  const bands = (svg: SVGSVGElement) =>
    Array.from(svg.querySelectorAll(`g.${OVERLAY_BAND_CLASS} path`));

  it("draws no ribbon without `ci`", () => {
    expect(bands(renderChart(spec([{ method: "lm" }]), ROWS, OPTS).svg).length).toBe(0);
  });

  it("draws a ribbon with `ci`", () => {
    expect(bands(renderChart(spec([{ method: "lm", ci: 0.95 }]), ROWS, OPTS).svg).length).toBe(1);
  });

  it("draws the line but no ribbon when the fit has no residual df", () => {
    const two = [ROWS[0]!, ROWS[1]!] as TidyRow[];
    const { svg } = renderChart(spec([{ method: "lm", ci: 0.95 }]), two, OPTS);
    expect(lines(svg).length).toBe(1);
    expect(bands(svg).length).toBe(0);
  });

  it("reaches the export path", () => {
    expect(bands(buildExportSvg(spec([{ method: "lm", ci: 0.95 }]), ROWS)).length).toBe(1);
  });
});

describe("overlays — facet scoping (small multiples)", () => {
  const facetSpec: ChartSpec = {
    chartType: "line",
    title: "faceted overlay",
    xAxisType: "numeric",
    data: "data.csv",
    columns: { x: "time", value: "value", series: "series", facet: "facet" },
    small_multiples: { columns: 2, mode: "shared" },
    overlays: [{ method: "lm", facet: "A" }],
  } as unknown as ChartSpec;

  const facetRows: TidyRow[] = [
    { time: "1", value: "1", series: "S", facet: "A" },
    { time: "2", value: "3", series: "S", facet: "A" },
    { time: "3", value: "2", series: "S", facet: "A" },
    { time: "1", value: "5", series: "S", facet: "B" },
    { time: "2", value: "6", series: "S", facet: "B" },
    { time: "3", value: "4", series: "S", facet: "B" },
  ] as unknown as TidyRow[];

  it("draws the overlay ONLY in the pane its `facet` names, not the other pane", () => {
    const fig = renderFigure(facetSpec, facetRows, OPTS);
    const byValue = new Map(fig.panes.map((p) => [p.value, p.svg as SVGSVGElement]));
    // A single-pane assertion would still pass with the filter deleted (both panes would draw the
    // overlay) — asserting BOTH panes is what actually exercises `.filter((o) => o.facet == null ||
    // o.facet === opts.paneFacetValue)` (index.ts).
    expect(lines(byValue.get("A")!).length).toBeGreaterThan(0);
    expect(lines(byValue.get("B")!).length).toBe(0);
  });
});

describe("overlays — fun density curve over a histogram", () => {
  // CONFIG-SPEC.md's FIRST overlay example, and the only overlay kind histograms support (`method`/
  // `column` are rejected at validation — see test/overlays-spec.test.ts's "histograms take `fun`
  // only" — because binned rows carry no `_xn`/`_overlayCols` for them to read). Rendering coverage
  // was missing entirely; this proves the accepted case actually draws a line, not just validates.
  const histSpec: ChartSpec = {
    chartType: "histogram",
    title: "H",
    xAxisType: "numeric",
    columns: { x: "amount" },
    data: "d.csv",
    histogram: { bins: 5, domain: [-3, 3] },
    overlays: [{ fun: "dnorm(x, 0, 1)" }],
  } as unknown as ChartSpec;

  const histRows: TidyRow[] = Array.from({ length: 30 }, (_, i) => ({
    amount: String(-3 + (i / 29) * 6),
  })) as unknown as TidyRow[];

  it("draws the density curve as an overlay line over the bars", () => {
    const { svg } = renderChart(histSpec, histRows, OPTS);
    expect(svg.querySelectorAll('g[aria-label="rect"], rect').length).toBeGreaterThan(0); // bars exist
    expect(lines(svg).length).toBe(1);
  });

  it("reaches the export path", () => {
    expect(lines(buildExportSvg(histSpec, histRows)).length).toBe(1);
  });
});

describe("overlays — validation accepts the specs this file renders", () => {
  it("validates each spec used above", () => {
    for (const overlays of [
      [{ method: "lm" }],
      [{ column: "yhat" }],
      [{ slope: 1, intercept: 0 }],
      [{ fun: "2*x" }],
      [{ fun: "1000*x", domain: [0, 10] }],
    ]) {
      const s = spec(overlays);
      expect(validateSpec(s).valid, JSON.stringify(overlays)).toBe(true);
      expect(validateChartData(s as never, ROWS).valid, JSON.stringify(overlays)).toBe(true);
    }
  });
});
