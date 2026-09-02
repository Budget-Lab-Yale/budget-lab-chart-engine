// @vitest-environment jsdom
//
// `annotations.points[].point`: key a callout to ONE observation by its `columns.point_label` cell
// instead of copying that row's x/y into the spec. Validation demands exactly one matching row —
// the motivating chart had two rows sharing an exact x AND series ("2025b" / "2025b*"), which the
// `(x, series)` snap would have silently resolved to the first of.
import { describe, it, expect } from "vitest";
import { validateSpec, validateChartData } from "../src/spec/validate";
import { substituteRowTokens } from "../src/spec/annotations";
import { renderChart, renderFigure } from "../src/engine/index";
import { mountChart } from "../src/engine/render-live";
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
    expect(r.errors.join("\n")).toMatch(/annotations\.points\[0\]\.point "blank" matches a row whose "y" cell is empty/);
  });

  it("accepts a whitespace-only value cell, which the engine draws at 0, and reports a non-numeric one once (per row, not per callout)", () => {
    const ws = rowsOf([...ROWS, { x: "0.5", y: " ", g: "Earlier", period: "ws" }]);
    expect(validateChartData(withPoints([{ point: "ws", label: "l" }]), ws).valid).toBe(true);
    const bad = rowsOf([...ROWS, { x: "0.5", y: "abc", g: "Earlier", period: "bad" }]);
    const r = validateChartData(withPoints([{ point: "bad", label: "l" }]), bad);
    expect(r.valid).toBe(false);
    expect(r.errors.filter((e) => /annotations\.points/.test(e))).toHaveLength(0);
    expect(r.errors.filter((e) => /is not numeric/.test(e))).toHaveLength(1);
  });

  it("a missing value column is reported once by the role check, not again per callout", () => {
    const spec = withPoints([{ point: "2025b", label: "l" }, { point: "2019", label: "l" }], {
      columns: { x: "x", value: "nope", series: "g", point_label: "period" },
    });
    const r = validateChartData(spec, ROWS);
    expect(r.valid).toBe(false);
    expect(r.errors.filter((e) => /columns\.value is "nope"/.test(e))).toHaveLength(1);
    expect(r.errors.filter((e) => /annotations\.points/.test(e))).toHaveLength(0);
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

// ---------------------------------------------------------------------------
// Row tokens — {point_label} {x} {series} read from the matched / snapped row
// ---------------------------------------------------------------------------

describe("substituteRowTokens (pure helper)", () => {
  it("returns the SAME string when the label carries no token", () => {
    const label = "Plain 2025b*";
    expect(substituteRowTokens(label, { point_label: "2025b*", x: "2.32", series: "Recent" })).toBe(label);
  });

  it("substitutes each token from the row", () => {
    expect(substituteRowTokens("{point_label} | {x} | {series}", { point_label: "2025b*", x: "2.32", series: "Recent" }))
      .toBe("2025b* | 2.32 | Recent");
  });

  it("replaces every occurrence of a repeated token", () => {
    expect(substituteRowTokens("{x}-{x}", { x: "1" })).toBe("1-1");
  });

  it("leaves an unresolvable token literal — never 'undefined'", () => {
    expect(substituteRowTokens("{point_label} at {x}", { x: "2.32" })).toBe("{point_label} at 2.32");
    expect(substituteRowTokens("{series}", {})).toBe("{series}");
  });

  it("never re-scans a substituted value, and treats `$` patterns in a cell literally", () => {
    expect(substituteRowTokens("{point_label}/{x}", { point_label: "Forecast {x}", x: "2025" })).toBe("Forecast {x}/2025");
    expect(substituteRowTokens("[{point_label}]", { point_label: "cost $& up $$1" })).toBe("[cost $& up $$1]");
  });

  it("leaves {value} literal when no value string is supplied, and fills it in the same pass when one is", () => {
    expect(substituteRowTokens("{point_label}: {value}", { point_label: "A" })).toBe("A: {value}");
    expect(substituteRowTokens("{point_label} = {value}", { point_label: "Fc {value}", value: "12" })).toBe("Fc {value} = 12");
  });
});

describe("annotations.points — row tokens in the rendered label", () => {
  const text = (svg: SVGSVGElement, re: RegExp): string | undefined =>
    Array.from(svg.querySelectorAll("text")).map((t) => t.textContent ?? "").find((t) => re.test(t));

  it("a point: callout fills {point_label}, {x} and {series} from its matched row", () => {
    const spec = withPoints([{ point: "2025b*", label: "{point_label} @ {x} ({series})" }], {
      series_labels: { Recent: "Recent era" },
    });
    const { svg } = renderChart(spec, ROWS, { width: 720, height: 400, document });
    // {series} is the display label when one exists; this x needs no rounding to print as "2.32".
    expect(text(svg as SVGSVGElement, /@/)).toBe("2025b* @ 2.32 (Recent era)");
  });

  it("{x} on a numeric axis is rounded and grouped the way the hover card formats x", () => {
    // The unrounded axis form put `2025a: -0.` and `2026a at x=2.285011857607663` on the frame in
    // the 1.14.0 visual review — a raw float is not a label. Both the card and the token now go
    // through `formatNumericX`, so a callout reads `2.59` / `2,000`. A test using a short x like
    // "2.32" cannot tell the two forms apart, hence the many-decimal and four-digit rows here.
    const rows = rowsOf([
      { x: "2.593569308310415", y: "-0.12", g: "Recent", period: "2025a" },
      { x: "2000", y: "0.80", g: "Earlier", period: "2019" },
    ]);
    const spec = withPoints([
      { point: "2025a", label: "a={x}" },
      { point: "2019", label: "b={x}" },
    ]);
    const { svg } = renderChart(spec, rows, { width: 720, height: 400, document });
    expect(text(svg as SVGSVGElement, /^a=/)).toBe("a=2.59");
    expect(text(svg as SVGSVGElement, /^b=/)).toBe("b=2,000");
  });

  it("{x} equals the scatter card's own x row for the same row (one formatter, two callers)", () => {
    // Parity against the card as MOUNTED, not against the shared helper — a second copy of the
    // toLocaleString call would pass a helper-vs-helper assertion and still be able to drift.
    document.body.innerHTML = "";
    const rows = rowsOf([{ x: "2.593569308310415", y: "-0.12", g: "Recent", period: "2025a" }]);
    const container = document.createElement("div");
    document.body.appendChild(container);
    mountChart(container, { spec: withPoints([{ point: "2025a", label: "a={x}" }]), rows, width: 720, height: 400 } as never);
    const svg = container.querySelector<SVGSVGElement>(".figure-canvas svg")!;
    svg.querySelector('g[aria-label="dot"] circle')!
      .dispatchEvent(new PointerEvent("pointerenter", { clientX: 10, clientY: 10, bubbles: true }));
    // The card's rows are x then y, so the first value cell is the formatted x.
    const cardX = document.body.querySelector(".tbl-tooltip .tbl-tooltip-row .tbl-tooltip-value")!.textContent;
    expect(cardX).toBe("2.59");
    expect(text(svg, /^a=/)).toBe(`a=${cardX}`);
  });

  it("{series} falls back to the raw key when no series_labels entry exists", () => {
    const { svg } = renderChart(withPoints([{ point: "2019", label: "S={series}" }]), ROWS, { width: 720, height: 400, document });
    expect(text(svg as SVGSVGElement, /^S=/)).toBe("S=Earlier");
  });

  it("{value} still works alongside the row tokens, with value_format", () => {
    const spec = withPoints([{ point: "2025b", label: "{point_label}: {value}", value_format: { decimals: 2 } }]);
    const { svg } = renderChart(spec, ROWS, { width: 720, height: 400, document });
    expect(text(svg as SVGSVGElement, /^2025b:/)).toBe("2025b: -1.50");
  });

  it("a label with no token renders the identical string", () => {
    const { svg } = renderChart(withPoints([{ point: "2019", label: "Plain {not_a_token}" }]), ROWS, { width: 720, height: 400, document });
    expect(text(svg as SVGSVGElement, /^Plain/)).toBe("Plain {not_a_token}");
  });

  it("a series-snap callout (line chart) fills {series} and {x} from the snapped row; {point_label} stays literal", () => {
    const spec = {
      title: "T", chartType: "line", xAxisType: "numeric", data: "d.csv",
      series_labels: { a: "Alpha" },
      annotations: { points: [{ x: "2021", series: "a", label: "{series}/{x}/{point_label}" }] },
    } as unknown as ChartSpec;
    const rows = rowsOf([
      { time: "2020", series: "a", value: "1" }, { time: "2021", series: "a", value: "2" },
      { time: "2020", series: "b", value: "4" }, { time: "2021", series: "b", value: "5" },
    ]);
    const { svg } = renderChart(spec, rows, { width: 720, height: 400, document });
    // A YEAR on a numeric axis is grouped, because `{x}` is the card's formatter and the card
    // groups: "2,021", not the axis tick's "2021". Pinned deliberately — this is the visible cost
    // of card parity, and `xAxisType: "temporal"` is the way to label a year axis with a date
    // format. Changing it means changing `formatNumericX`, which moves the card too.
    expect(text(svg as SVGSVGElement, /^Alpha/)).toBe("Alpha/2,021/{point_label}");
  });

  it("a stacked-area series callout (no single row) still fills {series} from p.series and {x} from p.x", () => {
    const spec = {
      title: "T", chartType: "area", xAxisType: "numeric", data: "d.csv",
      annotations: { points: [{ x: "2021", series: "b", label: "{series}@{x}" }] },
    } as unknown as ChartSpec;
    const rows = rowsOf([
      { time: "2020", series: "a", value: "1" }, { time: "2021", series: "a", value: "2" },
      { time: "2020", series: "b", value: "4" }, { time: "2021", series: "b", value: "5" },
    ]);
    const { svg } = renderChart(spec, rows, { width: 720, height: 400, document });
    expect(text(svg as SVGSVGElement, /@2,021$/)).toBe("b@2,021");
  });

  it("a plain x + y callout fills {x} (via the temporal tooltip format) and a given {series}; {point_label} stays literal", () => {
    const spec = {
      title: "T", chartType: "line", xAxisType: "temporal", data: "d.csv",
      annotations: { points: [{ x: "2021-06-15", y: 2, series: "a", label: "{x}|{series}|{point_label}" }] },
    } as unknown as ChartSpec;
    const rows = rowsOf([
      { time: "2021-01-01", series: "a", value: "1" }, { time: "2021-06-15", series: "a", value: "2" }, { time: "2021-12-01", series: "a", value: "3" },
    ]);
    const { svg } = renderChart(spec, rows, { width: 720, height: 400, document });
    // The temporal adapter's tooltip format is "%b %Y" by default.
    expect(text(svg as SVGSVGElement, /\|a\|/)).toBe("Jun 2021|a|{point_label}");
  });

  it("a point_label cell that itself contains {value} is shown verbatim — never expanded by the value pass", () => {
    const rows = rowsOf([...ROWS, { x: "0.7", y: "0.3", g: "Earlier", period: "Forecast {value}" }]);
    const { svg } = renderChart(withPoints([{ point: "Forecast {value}", label: "{point_label}" }]), rows, { width: 720, height: 400, document });
    expect(text(svg as SVGSVGElement, /^Forecast/)).toBe("Forecast {value}");
  });

  it("a blank point_label cell leaves {point_label} literal rather than erasing it", () => {
    const rows = rowsOf([...ROWS, { x: "0.7", y: "0.3", g: "Earlier", period: "" }]);
    const spec = withPoints([{ x: "0.7", series: "Earlier", label: "A: {point_label}" }]);
    const { svg } = renderChart(spec, rows, { width: 720, height: 400, document });
    expect(text(svg as SVGSVGElement, /^A:/)).toBe("A: {point_label}");
  });

  it("{series} on a single-series chart takes a series_labels name given for the implicit key", () => {
    const spec = withPoints([{ point: "2019", label: "[{series}]" }], {
      columns: { x: "x", value: "y", point_label: "period" },
      series_labels: { "": "Households" },
    });
    const { svg } = renderChart(spec, ROWS, { width: 720, height: 400, document });
    expect(text(svg as SVGSVGElement, /^\[/)).toBe("[Households]");
  });

  it("a series key that names an Object.prototype member falls through to the raw key, not the prototype", () => {
    const spec = withPoints([{ point: "p", label: "[{series}]" }], { series_labels: {} });
    const rows = rowsOf([{ x: "1", y: "1", g: "toString", period: "p" }, { x: "2", y: "2", g: "Other", period: "q" }]);
    const { svg } = renderChart(spec, rows, { width: 720, height: 400, document });
    expect(text(svg as SVGSVGElement, /^\[/)).toBe("[toString]");
  });

  it("{x} on a categorical axis shows the x_labels display name, as the hover card does", () => {
    const spec = {
      title: "T", chartType: "bar", xAxisType: "categorical", data: "d.csv",
      x_labels: { a: "Alpha" },
      annotations: { points: [{ x: "a", series: "s", label: "<{x}>" }] },
    } as unknown as ChartSpec;
    const rows = rowsOf([{ time: "a", series: "s", value: "1" }, { time: "b", series: "s", value: "2" }]);
    const { svg } = renderChart(spec, rows, { width: 720, height: 400, document });
    expect(text(svg as SVGSVGElement, /^</)).toBe("<Alpha>");
  });

  it("{series} on a single-series chart (nameless implicit series) stays literal rather than emitting an empty string", () => {
    const spec = withPoints([{ point: "2019", label: "[{series}]" }], { columns: { x: "x", value: "y", point_label: "period" } });
    const { svg } = renderChart(spec, ROWS, { width: 720, height: 400, document });
    expect(text(svg as SVGSVGElement, /^\[/)).toBe("[{series}]");
  });
});
