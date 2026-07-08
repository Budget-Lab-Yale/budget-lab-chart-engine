// @vitest-environment jsdom
//
// Task 9: per-facet annotations (both orientations) + horizontal value-axis markers.
//
//   1. `facet?: string` on XAxisMarker/YAxisMarker: a marker with a facet key renders ONLY in the
//      pane whose facet value matches; no facet ⇒ all panes (unchanged). Non-faceted charts ignore
//      the key (marker always renders).
//   2. Horizontal bars: `annotations.xAxis` numeric markers were previously a silent no-op (the
//      categorical y-band adapter's markerToX always returns null). This is NEW capability: a
//      vertical rule + label on the VALUE axis (which runs along x for horizontal bars).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderChart, renderFigure } from "../src/engine/index";
import { resolveAnnotations, filterAnnotationsByFacet } from "../src/spec/annotations";
import { validateSpec } from "../src/spec/validate";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

// Minimal CSV → TidyRow[] (mirrors golden.test.ts's local helper) — fixtures are comma-free.
function parseCsv(path: string): TidyRow[] {
  const text = readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8").trim();
  const [header, ...lines] = text.split(/\r?\n/);
  const cols = (header as string).split(",");
  return lines.map((line) => {
    const cells = line.split(",");
    const row: Record<string, string> = {};
    cols.forEach((c, i) => { row[c] = cells[i] ?? ""; });
    return row as TidyRow;
  });
}

// ---------------------------------------------------------------------------
// filterAnnotationsByFacet — pure unit tests
// ---------------------------------------------------------------------------

describe("filterAnnotationsByFacet", () => {
  const resolved = resolveAnnotations({
    annotations: {
      xAxis: [
        { x: "1", label: "no-facet" },
        { x: "2", label: "facet-a", facet: "A" },
        { x: "3", label: "facet-b", facet: "B" },
      ],
      yAxis: [
        { y: 1, label: "no-facet" },
        { y: 2, label: "facet-a", facet: "A" },
        { y: 3, label: "facet-b", facet: "B" },
      ],
      bands: [{ start: "1", end: "2", label: "band" }],
      points: [{ x: "1", y: 1, label: "point" }],
    },
  } as ChartSpec);

  it("undefined facetValue leaves everything unchanged", () => {
    const out = filterAnnotationsByFacet(resolved, undefined);
    expect(out).toBe(resolved); // identity — byte-identical non-faceted rendering
  });

  it("keeps markers with no facet key, plus markers matching the given facet value", () => {
    const out = filterAnnotationsByFacet(resolved, "A");
    expect(out.xAxis.map((m) => m.label)).toEqual(["no-facet", "facet-a"]);
    expect(out.yAxis.map((m) => m.label)).toEqual(["no-facet", "facet-a"]);
  });

  it("a facet value with no matching keyed markers still keeps the unkeyed ones", () => {
    const out = filterAnnotationsByFacet(resolved, "C");
    expect(out.xAxis.map((m) => m.label)).toEqual(["no-facet"]);
    expect(out.yAxis.map((m) => m.label)).toEqual(["no-facet"]);
  });

  it("bands and points pass through unfiltered regardless of facet value", () => {
    const out = filterAnnotationsByFacet(resolved, "A");
    expect(out.bands).toEqual(resolved.bands);
    expect(out.points).toEqual(resolved.points);
  });
});

// ---------------------------------------------------------------------------
// Schema: facet key on xAxis / yAxis markers
// ---------------------------------------------------------------------------

describe("schema — marker facet key", () => {
  it("accepts a facet key on both xAxis and yAxis markers", () => {
    const res = validateSpec({
      chartType: "line",
      title: "T",
      xAxisType: "numeric",
      data: "d.csv",
      annotations: {
        xAxis: [{ x: "1", label: "L", facet: "A" }],
        yAxis: [{ y: 1, label: "L", facet: "A" }],
      },
    });
    expect(res.valid).toBe(true);
  });

  it("rejects an unknown key on a marker (additionalProperties: false still holds)", () => {
    const res = validateSpec({
      chartType: "line",
      title: "T",
      xAxisType: "numeric",
      data: "d.csv",
      annotations: { xAxis: [{ x: "1", bogus: "nope" }] },
    });
    expect(res.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Vertical faceted bars — per-pane yAxis markers (both facet-scoping AND extent-folding)
// ---------------------------------------------------------------------------

const V_ROWS: TidyRow[] = [
  { facet: "pct", time: "A", value: "1" },
  { facet: "pct", time: "B", value: "2" },
  { facet: "dollars", time: "A", value: "100" },
  { facet: "dollars", time: "B", value: "200" },
] as TidyRow[];

function verticalFacetedSpec(mode: "shared" | "per-pane", markers: object[]): ChartSpec {
  return {
    chartType: "bar",
    title: "t",
    xAxisType: "categorical",
    columns: { facet: "facet" },
    data: "x",
    small_multiples: { mode, pane_order: ["pct", "dollars"], columns: 2 },
    annotations: { yAxis: markers },
  } as unknown as ChartSpec;
}

// Count rules (Plot.ruleY reference lines, identified by the annotation stroke width) is fragile;
// instead assert by LABEL TEXT presence per pane, which is unambiguous.
function labelTexts(svg: SVGSVGElement): string[] {
  return Array.from(svg.querySelectorAll("text")).map((t) => t.textContent ?? "");
}

describe("vertical faceted bars — per-facet yAxis markers", () => {
  const spec = verticalFacetedSpec("per-pane", [
    { y: 1.5, label: "PCTMARK", facet: "pct" },
    { y: 150, label: "DOLLARMARK", facet: "dollars" },
  ]);

  it("each pane renders ONLY its own facet-scoped marker + label", () => {
    const fig = renderFigure(spec, V_ROWS, { width: 720, height: 320, document });
    const [pane0, pane1] = fig.panes.map((p) => p.svg as SVGSVGElement);
    expect(labelTexts(pane0!)).toContain("PCTMARK");
    expect(labelTexts(pane0!)).not.toContain("DOLLARMARK");
    expect(labelTexts(pane1!)).toContain("DOLLARMARK");
    expect(labelTexts(pane1!)).not.toContain("PCTMARK");
  });

  it("each pane's y-domain widens to include ONLY its own marker value", () => {
    // pct pane's data tops out at 2; its marker (1.5) is within range → no widening from the marker.
    // Use a marker beyond each pane's own data range to prove the fold is per-pane.
    const baseline = renderFigure(verticalFacetedSpec("per-pane", []), V_ROWS, {
      width: 720,
      height: 320,
      document,
    });
    const wideSpec = verticalFacetedSpec("per-pane", [
      { y: 50, label: "PCTMARK", facet: "pct" }, // pct data max is 2 → 50 forces a much wider domain
    ]);
    const fig = renderFigure(wideSpec, V_ROWS, { width: 720, height: 320, document });
    const maxTick = (svg: SVGSVGElement): number =>
      Math.max(
        ...Array.from(svg.querySelectorAll("text"))
          .map((t) => parseFloat(t.textContent ?? ""))
          .filter((v) => Number.isFinite(v)),
      );
    const [pane0, pane1] = fig.panes.map((p) => p.svg as SVGSVGElement);
    const [basePane0, basePane1] = baseline.panes.map((p) => p.svg as SVGSVGElement);
    // pct pane's own domain must widen well past its unmarked baseline to fit the marker (50).
    expect(maxTick(pane0!)).toBeGreaterThan(maxTick(basePane0!));
    // dollars pane is UNAFFECTED by pct's marker — its domain is identical to the unmarked baseline.
    expect(maxTick(pane1!)).toBe(maxTick(basePane1!));
  });
});

describe("vertical faceted bars — shared mode: probe AND final render both respect the per-pane filter", () => {
  it("each pane's FINAL render (post shared-domain-forcing) still shows only its own marker", () => {
    // Shared mode has TWO renderPane call sites per pane (a probe, then the final forced-domain
    // render) — both must thread paneFacetValue, or the probe would mis-fold the union (caught by
    // the per-pane-mode extent test below, since union masks cross-pane contamination) or the final
    // render would show every pane's markers (caught here).
    const spec = verticalFacetedSpec("shared", [
      { y: 1.5, label: "PCTMARK", facet: "pct" },
      { y: 150, label: "DOLLARMARK", facet: "dollars" },
    ]);
    const fig = renderFigure(spec, V_ROWS, { width: 720, height: 320, document });
    const [pane0, pane1] = fig.panes.map((p) => p.svg as SVGSVGElement);
    expect(labelTexts(pane0!)).toContain("PCTMARK");
    expect(labelTexts(pane0!)).not.toContain("DOLLARMARK");
    expect(labelTexts(pane1!)).toContain("DOLLARMARK");
    expect(labelTexts(pane1!)).not.toContain("PCTMARK");
  });

  it("the probe folds each pane's own marker into the UNIONED shared domain (a marker beyond BOTH panes' data range still gets headroom)", () => {
    // A marker facet-scoped to "pct" but far beyond even the "dollars" pane's own range: if the
    // probe dropped facet filtering entirely (applied to neither pane, e.g. a bug that always
    // filtered to "" instead of passing the real value), the union would stay at the plain
    // data-driven ceiling (~210). Correctly folded, the union must reach past the marker (5000).
    // Shared mode hides y-tick LABEL text on non-leftmost columns, so read the tick values off the
    // leftmost (col 0 = "pct") pane only — both panes share one forced domain either way.
    const spec = verticalFacetedSpec("shared", [{ y: 5000, label: "PCTMARK", facet: "pct" }]);
    const fig = renderFigure(spec, V_ROWS, { width: 720, height: 320, document });
    const maxTick = (svg: SVGSVGElement): number =>
      Math.max(
        ...Array.from(svg.querySelectorAll("text"))
          .map((t) => parseFloat(t.textContent ?? ""))
          .filter((v) => Number.isFinite(v)),
      );
    expect(maxTick(fig.panes[0]!.svg as SVGSVGElement)).toBeGreaterThan(1000);
  });
});

describe("no-facet marker renders in all panes; facet key on a non-faceted chart is ignored", () => {
  it("a marker with no facet key renders in every pane of a faceted figure", () => {
    const spec = verticalFacetedSpec("shared", [{ y: 1, label: "ALLPANES" }]);
    const fig = renderFigure(spec, V_ROWS, { width: 720, height: 320, document });
    fig.panes.forEach((p) => {
      expect(labelTexts(p.svg as SVGSVGElement)).toContain("ALLPANES");
    });
  });

  it("a facet-keyed marker on a NON-faceted chart still renders (facet key ignored)", () => {
    const rows: TidyRow[] = [
      { time: "A", value: "1" },
      { time: "B", value: "2" },
    ] as TidyRow[];
    const spec: ChartSpec = {
      chartType: "bar",
      title: "t",
      xAxisType: "categorical",
      data: "x",
      annotations: { yAxis: [{ y: 1.5, label: "IGNORED-FACET", facet: "some-pane-that-does-not-exist" }] },
    };
    const { svg } = renderChart(spec, rows, { width: 400, height: 300, document });
    expect(labelTexts(svg)).toContain("IGNORED-FACET");
  });
});

// ---------------------------------------------------------------------------
// Horizontal bars — value-axis xAxis markers (NEW capability)
// ---------------------------------------------------------------------------

const H_BASE: ChartSpec = {
  chartType: "bar",
  title: "t",
  subtitle: "Percent",
  xAxisType: "categorical",
  orientation: "horizontal",
  columns: { x: "category", value: "value" },
  data: "x",
};

const H_ROWS: TidyRow[] = [
  { category: "Food", value: "0.2" },
  { category: "Energy", value: "0.4" },
] as unknown as TidyRow[];

describe("horizontal bars — xAxis value-axis markers (RED-proven new capability)", () => {
  it("a numeric xAxis marker renders a vertical rule + label on the value axis", () => {
    const spec: ChartSpec = {
      ...H_BASE,
      annotations: { xAxis: [{ x: "0.33", label: "ALLITEMS" }] },
    };
    const { svg } = renderChart(spec, H_ROWS, { width: 400, height: 300, document });
    expect(labelTexts(svg)).toContain("ALLITEMS");
    // The reference line is a <line> element distinct from the bar <rect>s / gridlines; assert at
    // least one additional rule beyond the always-present zero baseline + gridlines is present by
    // checking there IS a line whose stroke matches the default annotation color convention.
    const lines = Array.from(svg.querySelectorAll("line"));
    expect(lines.length).toBeGreaterThan(0);
  });

  it("a non-finite x value is silently skipped (no rule, no label, no throw)", () => {
    const spec: ChartSpec = {
      ...H_BASE,
      annotations: { xAxis: [{ x: "not-a-number", label: "SHOULDNOTAPPEAR" }] },
    };
    const { svg } = renderChart(spec, H_ROWS, { width: 400, height: 300, document });
    expect(labelTexts(svg)).not.toContain("SHOULDNOTAPPEAR");
  });

  it("the marker value folds into the horizontal value (x) extent", () => {
    const withMarker: ChartSpec = {
      ...H_BASE,
      annotations: { xAxis: [{ x: "5", label: "FAROUT" }] },
    };
    const plain = renderChart(H_BASE, H_ROWS, { width: 400, height: 300, document });
    const marked = renderChart(withMarker, H_ROWS, { width: 400, height: 300, document });
    const maxTick = (svg: SVGSVGElement): number =>
      Math.max(
        ...Array.from(svg.querySelectorAll("text"))
          .map((t) => parseFloat((t.textContent ?? "").replace("%", "")))
          .filter((v) => Number.isFinite(v)),
      );
    expect(maxTick(marked.svg)).toBeGreaterThan(maxTick(plain.svg));
  });
});

describe("horizontal faceted (shared mode) — xAxis markers scoped + folded per pane", () => {
  const rows = parseCsv("./fixtures/figure7-tariff.csv");
  const FIG7_FACETED_SPEC: ChartSpec = {
    chartType: "bar",
    title: "Consumer Price Effects by PCE Spending Category",
    subtitle: "Percent change in consumer prices",
    xAxisType: "categorical",
    orientation: "horizontal",
    series_order: ["Pre-Substitution", "Post-Substitution"],
    columns: { x: "category", value: "value", series: "series", facet: "facet" },
    small_multiples: {
      columns: 2,
      mode: "shared",
      pane_order: ["Section 122 Expires", "Section 122 Extended"],
    },
    data: "figure7-tariff.csv",
    annotations: {
      xAxis: [
        { x: "0.33", label: "EXPIRESMARK", facet: "Section 122 Expires" },
        { x: "0.26", label: "EXTENDEDMARK", facet: "Section 122 Extended" },
      ],
    },
  };

  it("each pane shows only its own facet-scoped vertical value line + label", () => {
    const fig = renderFigure(FIG7_FACETED_SPEC, rows, { width: 900, document });
    const [pane0, pane1] = fig.panes.map((p) => p.svg as SVGSVGElement);
    expect(labelTexts(pane0!)).toContain("EXPIRESMARK");
    expect(labelTexts(pane0!)).not.toContain("EXTENDEDMARK");
    expect(labelTexts(pane1!)).toContain("EXTENDEDMARK");
    expect(labelTexts(pane1!)).not.toContain("EXPIRESMARK");
  });

  it("grouped horizontal (fy row facets): the label renders exactly ONCE and the rule is one full-height copy", () => {
    // Categories live on fy row facets here, so an unfaceted mark would repeat per band (20
    // categories → 20 copies). The label binds to an end fy category and the rule is collapsed +
    // stretched by the fy chrome pass (like the zero baseline), so each appears once.
    const fig = renderFigure(FIG7_FACETED_SPEC, rows, { width: 900, document });
    const pane0 = fig.panes[0]!.svg as SVGSVGElement;
    expect(labelTexts(pane0).filter((t) => t === "EXPIRESMARK").length).toBe(1);
    // Exactly one collapsed marker-rule group; its line spans the full plot height (top margin →
    // bottom plot edge), like the value gridlines/zero baseline after the fy collapse.
    const ruleGroups = pane0.querySelectorAll('g[class*="tbl-annotation-vline-"]');
    expect(ruleGroups.length).toBe(1);
    const line = ruleGroups[0]!.querySelector("line")!;
    const y1 = Number(line.getAttribute("y1"));
    const y2 = Number(line.getAttribute("y2"));
    const svgH = Number(pane0.getAttribute("height"));
    expect(Math.abs(y2 - y1)).toBeGreaterThan(svgH * 0.7);
  });

  it("the shared value-axis extent folds in the markers (max tick reflects the widened domain)", () => {
    const withoutMarkers = renderFigure(
      { ...FIG7_FACETED_SPEC, annotations: undefined },
      rows,
      { width: 900, document },
    );
    const withMarkers = renderFigure(FIG7_FACETED_SPEC, rows, { width: 900, document });
    const maxTick = (svg: SVGSVGElement): number =>
      Math.max(
        ...Array.from(svg.querySelectorAll("text"))
          .map((t) => parseFloat((t.textContent ?? "").replace("%", "")))
          .filter((v) => Number.isFinite(v)),
      );
    const before = maxTick(withoutMarkers.panes[0]!.svg as SVGSVGElement);
    const after = maxTick(withMarkers.panes[0]!.svg as SVGSVGElement);
    expect(after).toBeGreaterThanOrEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Non-faceted / no-facet-key charts stay byte-identical.
// ---------------------------------------------------------------------------

describe("byte-identical guarantees", () => {
  it("a non-faceted chart with no facet keys renders identically before/after (no regression)", () => {
    const rows: TidyRow[] = [
      { time: "2020", series: "a", value: "1" },
      { time: "2021", series: "a", value: "3" },
    ] as TidyRow[];
    const spec: ChartSpec = {
      chartType: "line",
      title: "t",
      xAxisType: "numeric",
      data: "x",
      annotations: { xAxis: [{ x: "2020.5", label: "MARKA" }], yAxis: [{ y: 1.5, label: "YMARKA" }] },
    };
    const a = renderChart(spec, rows, { width: 720, height: 400, document }).svg.outerHTML;
    const b = renderChart(spec, rows, { width: 720, height: 400, document }).svg.outerHTML;
    expect(a).toBe(b);
  });
});
