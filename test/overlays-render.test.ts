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

  // A healthy column keeps EVERY vertex. Worth pinning because the failure it guards is invisible:
  // engine/index.ts reads the column with unary `+` and drops anything non-finite, so a dropped
  // middle value does not leave a gap — it reroutes the line straight from its neighbours, and the
  // result is a plausible-looking wrong line. Three rows ⇒ three points, not two.
  it("keeps a three-point column overlay's MIDDLE vertex", () => {
    const three: TidyRow[] = [
      { time: "1", value: "1", series: "A", yhat: "1" },
      { time: "2", value: "2", series: "A", yhat: "5" },
      { time: "3", value: "3", series: "A", yhat: "9" },
    ] as unknown as TidyRow[];
    const path = lines(renderChart(spec([{ column: "yhat" }]), three, OPTS).svg)[0];
    const d = path?.getAttribute("d") ?? "";
    expect((d.match(/[ML]/g) ?? []).length).toBe(3);
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

describe("overlays — a sparse `column` breaks its line", () => {
  // CONFIG-SPEC.md's `overlays[].column` row promises the break. Asserted on the PATH DATA, because
  // the failure mode is invisible in a count of overlay marks: one `Plot.line` mark is emitted either
  // way, and before the fix it rendered ONE 4-vertex polyline that joined x=2 straight to x=4 —
  // a plausible-looking wrong line. Two 2-vertex paths is the gap.
  /** Five in-scope rows; `blankAt` is the 0-based row whose `yhat` cell is empty. */
  const sparse = (blankAt: number): TidyRow[] =>
    [1, 2, 3, 4, 5].map((n, i) => ({
      time: String(n),
      value: String(n),
      series: "A",
      yhat: i === blankAt ? "" : String(n),
    })) as unknown as TidyRow[];

  /** Vertex count of a path's `d` — one M plus n-1 L commands. */
  const vertices = (d: string): number => (d.match(/[ML]/g) ?? []).length;
  const overlayDs = (rows: TidyRow[]): string[] =>
    lines(renderChart(spec([{ column: "yhat" }]), rows, OPTS).svg).map(
      (p) => p.getAttribute("d") ?? "",
    );

  it("draws two 2-vertex paths, not one joined 4-vertex path", () => {
    const ds = overlayDs(sparse(2));
    expect(ds.length).toBe(2);
    expect(ds.map(vertices)).toEqual([2, 2]);
  });

  it("leaves no stray path for a blank at the very start", () => {
    const ds = overlayDs(sparse(0));
    expect(ds.length).toBe(1);
    expect(vertices(ds[0]!)).toBe(4);
  });

  it("leaves no stray path for a blank at the very end", () => {
    const ds = overlayDs(sparse(4));
    expect(ds.length).toBe(1);
    expect(vertices(ds[0]!)).toBe(4);
  });

  it("the break reaches the PNG export path too, which rebuilds from the spec", () => {
    const ds = lines(buildExportSvg(spec([{ column: "yhat" }]), sparse(2))).map(
      (p) => p.getAttribute("d") ?? "",
    );
    expect(ds.map(vertices)).toEqual([2, 2]);
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

  // The pane_order-excluded case is a VALIDATION error (test/overlays-spec.test.ts) precisely
  // because nothing downstream can catch it: with `pane_order: ["A"]` and `facet: "B"` the figure
  // renders one pane, zero overlay paths anywhere, and still emits a legend row for the line.
  // This is the mirror case — the pane is included, so the line is really there and the row it
  // keys is real.
  it("draws the overlay in a pane pane_order INCLUDES", () => {
    const fig = renderFigure(
      { ...facetSpec, small_multiples: { columns: 2, pane_order: ["A"] } } as ChartSpec,
      facetRows,
      OPTS,
    );
    expect(fig.panes.map((p) => p.value)).toEqual(["A"]);
    expect(lines(fig.panes[0]!.svg as SVGSVGElement).length).toBeGreaterThan(0);
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

describe("overlays — facet scoping reaches the VALUE axis, not just the drawing", () => {
  // The pane that never DRAWS the overlay must not have its value axis widened by it either. The
  // fold (index.ts's yForAxis -> overlayColumnValues) runs long before the draw-time facet filter,
  // so scoping the drawing alone left every pane's axis stretched to the overlay's range — and in
  // `mode: "shared"` the UNIONED domain then flattened every pane, including the one that
  // legitimately draws the line. Asserted on the resolved domain (renderPane's yDomain), the same
  // way the value-axis block above is: a mark-count assertion cannot see an axis.
  const facetColumnSpec = (mode: "shared" | "per-pane"): ChartSpec =>
    ({
      chartType: "line",
      title: "faceted column overlay",
      xAxisType: "numeric",
      data: "data.csv",
      columns: { x: "time", value: "value", series: "series", facet: "facet" },
      small_multiples: { columns: 2, mode },
      overlays: [{ column: "yhat", facet: "A" }],
    }) as unknown as ChartSpec;

  // BOTH panes carry a `yhat` value of ~600 — the overlay is scoped to pane A, but pane B's own
  // rows have the column too, which is exactly how the unscoped fold reached pane B.
  const paneRows = (facet: string): TidyRow[] =>
    [1, 2, 3].map((n) => ({
      time: String(n),
      value: String(n),
      series: "S",
      facet,
      yhat: String(600 - n),
    })) as unknown as TidyRow[];

  const yDomainOfPane = (s: ChartSpec, facet: string) =>
    renderPane(s, paneRows(facet), { ...OPTS, pane: true, paneFacetValue: facet }).yDomain;

  it("does NOT widen the value axis of a pane the overlay is filtered out of", () => {
    const [, hi] = yDomainOfPane(facetColumnSpec("per-pane"), "B");
    expect(hi).toBeLessThan(100); // pane B's own data tops out at 3
  });

  it("DOES widen the value axis of the pane that actually draws it", () => {
    const [, hi] = yDomainOfPane(facetColumnSpec("per-pane"), "A");
    expect(hi).toBeGreaterThanOrEqual(599);
  });

  it("keeps the SHARED union wide enough for the pane that draws it", () => {
    // The other direction of the same fix: `shared` mode unions the per-pane probes, so an overlay
    // drawn in pane A must still reach the shared axis both panes are drawn against. Read the tick
    // values off the leftmost pane (shared mode hides the tick LABELS on non-leftmost columns).
    const fig = renderFigure(facetColumnSpec("shared"), [...paneRows("A"), ...paneRows("B")], OPTS);
    const maxTick = Math.max(
      ...Array.from((fig.panes[0]!.svg as SVGSVGElement).querySelectorAll("text"))
        .map((t) => parseFloat(t.textContent ?? ""))
        .filter((v) => Number.isFinite(v)),
    );
    expect(maxTick).toBeGreaterThanOrEqual(500);
  });
});

describe("overlays — `domain` crops the value-axis fold too", () => {
  /** x = 1..4; `yhat` is small at x = 1, 2 and enormous at x = 3, 4. */
  const ROWS_STEEP: TidyRow[] = [1, 2, 3, 4].map((n) => ({
    time: String(n),
    value: String(n),
    series: "A",
    yhat: n <= 2 ? String(n) : String(n * 1000),
  })) as unknown as TidyRow[];

  const hiOf = (s: ChartSpec, rows: TidyRow[] = ROWS_STEEP) => renderPane(s, rows, OPTS).yDomain[1];

  it("folds in only the part of the column the line is actually drawn over", () => {
    // `domain: [1, 2]` draws the line over x = 1..2 only, so the 3000/4000 cells at x = 3, 4 are
    // outside the drawn extent — clipped, exactly as the doc's "an overlay never widens the axis"
    // rule says of a constructed line beyond the frame.
    expect(hiOf(spec([{ column: "yhat", domain: [1, 2] }]))).toBeLessThan(100);
  });

  it("(companion) folds the whole column in with no `domain`, proving the crop, not a dropped fold", () => {
    expect(hiOf(spec([{ column: "yhat" }]))).toBeGreaterThanOrEqual(4000);
  });

  it("folds in nothing when the crop leaves too few points to draw a line", () => {
    // One in-domain row is not a line (resolveOverlays needs two REAL points), and a line that is
    // never drawn cannot justify axis headroom for its values.
    expect(hiOf(spec([{ column: "yhat", domain: [3.5, 4.5] }]))).toBeLessThan(100);
  });

  it("never lets a BLANK column cell fold in as a zero", () => {
    // Since the break fix, a blank cell resolves to `{y: null}` rather than being skipped. A null
    // read as a number would drag the floor to 0 and flatten a high-and-narrow series.
    const high: TidyRow[] = [1, 2, 3, 4].map((n, i) => ({
      time: String(n),
      value: String(500 + n),
      series: "A",
      yhat: i === 1 ? "" : String(500 + n),
    })) as unknown as TidyRow[];
    const [lo] = renderPane(spec([{ column: "yhat" }]), high, OPTS).yDomain;
    expect(lo).toBeGreaterThan(100);
  });
});
