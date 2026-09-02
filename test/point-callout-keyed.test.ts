// @vitest-environment jsdom
//
// `annotations.points[].point`: key a callout to ONE observation by its `columns.point_label` cell
// instead of copying that row's x/y into the spec. Validation demands exactly one matching row —
// the motivating chart had two rows sharing an exact x AND series ("2025b" / "2025b*"), which the
// `(x, series)` snap would have silently resolved to the first of.
import { describe, it, expect } from "vitest";
import { validateSpec, validateChartData } from "../src/spec/validate";
import { renderChart, renderFigure } from "../src/engine/index";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const rowsOf = (o: Record<string, string>[]): TidyRow[] => o as unknown as TidyRow[];

const BASE = {
  title: "T",
  chartType: "scatter",
  xAxisType: "numeric",
  data: "d.csv",
  columns: { x: "x", value: "y", series: "g", point_label: "period" },
} as unknown as ChartSpec;

const ROWS = rowsOf([
  { x: "2.59", y: "-0.12", g: "Recent", period: "2025a" },
  { x: "2.32", y: "-1.50", g: "Recent", period: "2025b" },
  { x: "2.32", y: "-0.40", g: "Recent", period: "2025b*" },
  { x: "1.10", y: "0.80", g: "Earlier", period: "2019" },
]);

const withPoints = (points: unknown[], extra: Record<string, unknown> = {}): ChartSpec =>
  ({ ...BASE, ...extra, annotations: { points } }) as unknown as ChartSpec;

/** The `<text>` carrying `label`, plus the (px, py) Plot translated it to. */
function labelAt(svg: SVGSVGElement, label: string): { el: SVGTextElement; x: number; y: number } | null {
  const el = Array.from(svg.querySelectorAll("text")).find((t) => t.textContent === label);
  if (!el) return null;
  const m = /translate\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(el.getAttribute("transform") ?? "");
  return { el, x: Number(m?.[1]), y: Number(m?.[2]) };
}

/** Every rendered dot, in row order (a shape channel makes them <path>, otherwise <circle>). */
function dots(svg: SVGSVGElement): Array<{ x: number; y: number }> {
  return Array.from(svg.querySelectorAll('g[aria-label="dot"] circle')).map((c) => ({
    x: Number(c.getAttribute("cx")),
    y: Number(c.getAttribute("cy")),
  }));
}

// ---------------------------------------------------------------------------
// validateSpec — spec-only checks
// ---------------------------------------------------------------------------

describe("annotations.points[].point — spec validation", () => {
  it("accepts a callout keyed by `point` with no x/y/series", () => {
    const r = validateSpec(withPoints([{ point: "2025b", label: "{point_label}" }]));
    expect(r.valid).toBe(true);
  });

  it("still accepts the legacy x + y shape", () => {
    expect(validateSpec(withPoints([{ x: "2.32", y: -1.5, label: "old" }])).valid).toBe(true);
  });

  it("rejects a callout with neither x nor point", () => {
    const r = validateSpec(withPoints([{ label: "nowhere" }]));
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/annotations\.points\[0\].*exactly one of.*x.*point/);
  });

  it("rejects a callout with both x and point, naming the index and both values", () => {
    const r = validateSpec(withPoints([{ x: "2.32", y: -1.5, label: "ok" }, { x: "2.32", point: "2025b", label: "both" }]));
    expect(r.valid).toBe(false);
    const msg = r.errors.join("\n");
    expect(msg).toMatch(/annotations\.points\[1\]/);
    expect(msg).toContain('"2.32"');
    expect(msg).toContain('"2025b"');
  });

  it("rejects point + y (the row supplies y)", () => {
    const r = validateSpec(withPoints([{ point: "2025b", y: -1.5, label: "l" }]));
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/annotations\.points\[0\].*point.*\by\b/);
  });

  it("rejects point + series (the row supplies series)", () => {
    const r = validateSpec(withPoints([{ point: "2025b", series: "Recent", label: "l" }]));
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/annotations\.points\[0\].*point.*series/);
  });

  it("rejects point on a non-scatter chart, naming scatter", () => {
    const spec = withPoints([{ point: "2025b", label: "l" }], {
      chartType: "line",
      xAxisType: "temporal",
      columns: { x: "x", value: "y" },
    });
    const r = validateSpec(spec);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/annotations\.points\[0\]\.point.*"scatter" only.*"line"/);
  });

  it("rejects point when columns.point_label is not set", () => {
    const spec = withPoints([{ point: "2025b", label: "l" }], { columns: { x: "x", value: "y", series: "g" } });
    const r = validateSpec(spec);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/annotations\.points\[0\]\.point needs columns\.point_label/);
  });

  it("rejects an empty point string (schema minLength)", () => {
    expect(validateSpec(withPoints([{ point: "", label: "l" }])).valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateChartData — exactly one matching row
// ---------------------------------------------------------------------------

describe("annotations.points[].point — data validation", () => {
  it("passes when exactly one row's point_label cell equals `point`", () => {
    const r = validateChartData(withPoints([{ point: "2025b", label: "l" }]), ROWS);
    expect(r.valid).toBe(true);
  });

  it("matches the raw cell exactly — a case/whitespace variant is zero matches", () => {
    const r = validateChartData(withPoints([{ point: "2025B", label: "l" }, { point: " 2025b", label: "l" }]), ROWS);
    expect(r.valid).toBe(false);
    expect(r.errors).toHaveLength(2);
  });

  it("zero matches: names the value and the point_label column", () => {
    const r = validateChartData(withPoints([{ point: "2031", label: "l" }]), ROWS);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/annotations\.points\[0\]\.point "2031".*no row.*"period"/);
  });

  it("several matches: names the count and the value and says to disambiguate", () => {
    const rows = rowsOf([...ROWS, { x: "0.5", y: "0.1", g: "Earlier", period: "2019" }, { x: "0.6", y: "0.2", g: "Earlier", period: "2019" }]);
    const r = validateChartData(withPoints([{ point: "2019", label: "l" }]), rows);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/annotations\.points\[0\]\.point "2019" matches 3 rows.*disambiguat/);
  });

  it("rejects a unique match whose value cell is empty — the callout would have no y and vanish", () => {
    const rows = rowsOf([...ROWS, { x: "0.5", y: "", g: "Earlier", period: "blank" }]);
    const r = validateChartData(withPoints([{ point: "blank", label: "l" }]), rows);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/annotations\.points\[0\]\.point "blank" matches a row whose "y" cell is ""/);
  });

  it("rejects a match whose series is filtered out by series_order — the callout would be drawn nowhere", () => {
    const r = validateChartData(withPoints([{ point: "2019", label: "l" }], { series_order: ["Recent"] }), ROWS);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/annotations\.points\[0\]\.point "2019".*"Earlier".*series_order excludes/);
    expect(validateChartData(withPoints([{ point: "2025a", label: "l" }], { series_order: ["Recent"] }), ROWS).valid).toBe(true);
  });

  it("rejects a match whose shape value shape_order excludes — its dot is never drawn", () => {
    const shaped = { columns: { x: "x", value: "y", series: "g", shape: "k", point_label: "period" }, shape_order: ["c"] };
    const rows = rowsOf([
      { x: "1", y: "1", g: "A", k: "c", period: "circle" },
      { x: "2", y: "2", g: "A", k: "s", period: "square" },
    ]);
    const r = validateChartData(withPoints([{ point: "square", label: "l" }], shaped), rows);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/annotations\.points\[0\]\.point "square".*"s".*shape_order excludes/);
    expect(validateChartData(withPoints([{ point: "circle", label: "l" }], shaped), rows).valid).toBe(true);
  });

  it("rejects a match whose shape cell is blank when a shape channel is active — the inferred domain omits it", () => {
    const shaped = { columns: { x: "x", value: "y", series: "g", shape: "k", point_label: "period" } };
    const rows = rowsOf([
      { x: "1", y: "1", g: "A", k: "c", period: "circle" },
      { x: "2", y: "2", g: "A", k: "", period: "blank" },
    ]);
    const r = validateChartData(withPoints([{ point: "blank", label: "l" }], shaped), rows);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/annotations\.points\[0\]\.point "blank".*"k" is "".*blank/);
    expect(validateChartData(withPoints([{ point: "circle", label: "l" }], shaped), rows).valid).toBe(true);
  });

  describe("faceted", () => {
    const FACETED = {
      columns: { x: "x", value: "y", series: "g", facet: "f", point_label: "period" },
      small_multiples: { columns: 2 },
    };
    const rows = rowsOf([
      { x: "2.59", y: "-0.12", g: "Recent", period: "2025a", f: "P" },
      { x: "1.10", y: "0.80", g: "Earlier", period: "2019", f: "Q" },
    ]);

    it("rejects a callout facet that disagrees with the matched row's pane", () => {
      const r = validateChartData(withPoints([{ point: "2019", label: "l", facet: "P" }], FACETED), rows);
      expect(r.valid).toBe(false);
      expect(r.errors.join("\n")).toMatch(/annotations\.points\[0\]\.facet "P" disagrees with the matched row's "f" "Q"/);
      expect(validateChartData(withPoints([{ point: "2019", label: "l", facet: "Q" }], FACETED), rows).valid).toBe(true);
    });

    it("rejects a match whose facet cell is blank — not a pane, never rendered", () => {
      const blank = rowsOf([...rows, { x: "0.5", y: "0.5", g: "Earlier", period: "nopane", f: "" }]);
      const r = validateChartData(withPoints([{ point: "nopane", label: "l" }], FACETED), blank);
      expect(r.valid).toBe(false);
      expect(r.errors.join("\n")).toMatch(/annotations\.points\[0\]\.point "nopane" matches a row whose "f" cell is blank/);
    });

    it("rejects a match whose pane small_multiples.pane_order excludes", () => {
      const spec = withPoints([{ point: "2019", label: "l" }], { ...FACETED, small_multiples: { columns: 2, pane_order: ["P"] } });
      const r = validateChartData(spec, rows);
      expect(r.valid).toBe(false);
      expect(r.errors.join("\n")).toMatch(/annotations\.points\[0\]\.point "2019" matches a row in pane "Q", which small_multiples\.pane_order excludes/);
    });
  });

  it("matches the RAW point_label column even when it duplicates the series column", () => {
    // resolveColumns nulls a point_label that names the series column (hover-header dedupe); the
    // callout key must not inherit that, or a valid `point:` would be reported as zero matches.
    const spec = withPoints([{ point: "Solo", label: "l" }], {
      columns: { x: "x", value: "y", series: "g", point_label: "g" },
    });
    const oneEach = rowsOf([
      { x: "1", y: "1", g: "Solo" },
      { x: "2", y: "2", g: "Duo" },
    ]);
    expect(validateChartData(spec, oneEach).valid).toBe(true);
  });

  it("does not double-report when the point_label column itself is missing", () => {
    const spec = withPoints([{ point: "2025b", label: "l" }], {
      columns: { x: "x", value: "y", series: "g", point_label: "nope" },
    });
    const r = validateChartData(spec, ROWS);
    expect(r.valid).toBe(false);
    expect(r.errors.filter((e) => /annotations\.points/.test(e))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Resolution — the callout lands on the matched row
// ---------------------------------------------------------------------------

describe("annotations.points[].point — resolution", () => {
  it("renders the label at the matched row's own drawn (x, y)", () => {
    const { svg } = renderChart(withPoints([{ point: "2025b*", label: "STAR" }]), ROWS, { width: 720, height: 400, document });
    const t = labelAt(svg as SVGSVGElement, "STAR");
    expect(t).not.toBeNull();
    const dot = dots(svg as SVGSVGElement)[2]!; // row index 2 = "2025b*"
    expect(t!.x).toBeCloseTo(dot.x, 6);
    expect(t!.y).toBeCloseTo(dot.y, 6);
  });

  it("distinguishes two rows that share x AND series (the 2025b / 2025b* trap)", () => {
    const { svg } = renderChart(
      withPoints([{ point: "2025b", label: "PLAIN" }, { point: "2025b*", label: "STAR" }]),
      ROWS,
      { width: 720, height: 400, document },
    );
    const plain = labelAt(svg as SVGSVGElement, "PLAIN")!;
    const star = labelAt(svg as SVGSVGElement, "STAR")!;
    const [, d1, d2] = dots(svg as SVGSVGElement);
    expect(plain.x).toBeCloseTo(star.x, 6);
    expect(plain.y).toBeCloseTo(d1!.y, 6);
    expect(star.y).toBeCloseTo(d2!.y, 6);
    expect(plain.y).not.toBeCloseTo(star.y, 6);
  });

  it("a connector follows the resolved point", () => {
    const { svg } = renderChart(withPoints([{ point: "2019", label: "C", connector: true }]), ROWS, { width: 720, height: 400, document });
    expect(svg.querySelector('g[aria-label="arrow"] path')).not.toBeNull();
    expect(labelAt(svg as SVGSVGElement, "C")).not.toBeNull();
  });

  it("on a faceted scatter, renders the callout only in the pane holding the row", () => {
    const spec = withPoints([{ point: "2019", label: "ONLY-Q" }], {
      columns: { x: "x", value: "y", series: "g", facet: "f", point_label: "period" },
      small_multiples: { columns: 2 },
    });
    const rows = rowsOf([
      { x: "2.59", y: "-0.12", g: "Recent", period: "2025a", f: "P" },
      { x: "2.32", y: "-1.50", g: "Recent", period: "2025b", f: "P" },
      { x: "1.10", y: "0.80", g: "Earlier", period: "2019", f: "Q" },
      { x: "1.20", y: "0.90", g: "Earlier", period: "2020", f: "Q" },
    ]);
    const fig = renderFigure(spec, rows, { width: 838, height: 420, document });
    const texts = fig.panes.map((p) => Array.from(p.svg!.querySelectorAll("text")).some((t) => t.textContent === "ONLY-Q"));
    expect(fig.panes.map((p) => p.value)).toEqual(["P", "Q"]);
    expect(texts).toEqual([false, true]);
  });
});
