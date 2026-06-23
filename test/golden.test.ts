// @vitest-environment jsdom
//
// Golden-SVG parity + determinism gate. Each case renders a real tracker chart spec
// against committed fixture data and locks the resulting SVG to a baseline file. The
// baseline is the visual contract: any change to the engine that alters a known chart's
// output fails here until the baseline is deliberately regenerated (-u) and reviewed.
//
// This is the headless engine path (engine/index.ts → assemblePlot) running under jsdom,
// so it also proves the render is deterministic and DOM-document-injectable for SSR.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderChart, renderFigure, render, TOTAL_SERIES_KEY } from "../src/engine/index";
import type { FigureRenderResult } from "../src/engine/index";
import { buildStackedMarks } from "../src/engine/marks/stacked";
import type { PreparedRow, MarkLayers } from "../src/engine/marks/index";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";
import { assemblePlot } from "../src/engine/assemble-plot";
import { Plot, d3 } from "../src/engine/vendor";
import { TBL } from "../src/engine/theme";
import { paneTitleMark, temporalXTicks } from "../src/engine/axes";
import { makeXAdapter } from "../src/engine/x-adapter";
import { computeYAxis } from "../src/engine/scales";
import { makeTickFormatter } from "../src/engine/scales";
import { X_AXIS_LABEL_CLASS } from "../src/engine/facet-chrome";
import { parseDate } from "../src/engine/parse-time";

// Minimal CSV → TidyRow[]. The real data layer (engine step 5) handles quoting/remote
// sources; these fixtures are deliberately comma-free so a plain split suffices.
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

// Absolute x of an SVG element, accumulating every `transform="translate(x,y)"` up the
// ancestor chain to the root <svg>. jsdom has no layout engine, so we read the transforms
// Plot emits (per-element + per-group) directly. Used to assert label-vs-bar alignment.
function absX(el: Element | null): number {
  let x = 0;
  let n: Element | null = el;
  while (n && n.tagName.toLowerCase() !== "svg") {
    const tf = n.getAttribute("transform");
    if (tf) {
      const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(tf);
      if (m) x += Number(m[1]);
    }
    n = n.parentElement;
  }
  return x;
}

const GRADS_SPEC: ChartSpec = {
  chartType: "line",
  title:
    "Dissimilarity in the Occupational Mix Between Recent College Graduates (Ages 20-24) and Older College Graduates (Ages 25-34)",
  subtitle: "Dissimilarity index (percentage points)",
  source: "CPS, The Budget Lab analysis",
  note: "Dissimilarity index is calculated using a 3-month moving average of employment data",
  xAxisType: "temporal",
  data: "grads-recent.csv",
};

const AUGMENTED_SPEC: ChartSpec = {
  chartType: "line",
  title:
    "Proportion of Workers in Occupations Augmented by AI by Duration of Unemployment",
  subtitle: "Percent. Three-month moving average.",
  source: "CPS, Anthropic, The Budget Lab analysis",
  xAxisType: "temporal",
  series_order: ["<5 Weeks", "5-14 Weeks", "15-26 Weeks", "27+ Weeks"],
  data: "augmented-occ-observed.csv",
};

describe("golden SVG", () => {
  it("renders the single-series temporal grads chart 1:1", async () => {
    const rows = parseCsv("./fixtures/grads-recent.csv");
    const { svg, legendItems } = renderChart(GRADS_SPEC, rows, {
      width: 720,
      height: 400,
      document,
    });
    // Single unstyled series → no legend.
    expect(legendItems).toBeNull();
    expect(svg.tagName.toLowerCase()).toBe("svg");
    await expect(svg.outerHTML).toMatchFileSnapshot("./fixtures/grads-recent.golden.svg");
  });

  it("renders the 4-series temporal chart in series_order with a legend", async () => {
    const rows = parseCsv("./fixtures/augmented-occ-observed.csv");
    const { svg, legendItems, seriesOrder, colors } = renderChart(AUGMENTED_SPEC, rows, {
      width: 720,
      height: 400,
      document,
    });
    expect(seriesOrder).toEqual(["<5 Weeks", "5-14 Weeks", "15-26 Weeks", "27+ Weeks"]);
    expect(legendItems?.map((l) => l.series)).toEqual(seriesOrder);
    // First four palette base hues, assigned in series_order.
    expect(colors.get("<5 Weeks")).toBe("#0072B2");
    expect(colors.get("27+ Weeks")).toBe("#2A8B3A");
    await expect(svg.outerHTML).toMatchFileSnapshot(
      "./fixtures/augmented-occ-observed.golden.svg",
    );
  });

  it("is deterministic: rendering twice is byte-identical", () => {
    const rows = parseCsv("./fixtures/grads-recent.csv");
    const a = renderChart(GRADS_SPEC, rows, { width: 720, height: 400, document }).svg.outerHTML;
    const b = renderChart(GRADS_SPEC, rows, { width: 720, height: 400, document }).svg.outerHTML;
    expect(a).toBe(b);
  });
});

// --- Bar charts (task A6) ---

const BAR_SINGLE_SPEC: ChartSpec = {
  chartType: "bar",
  title: "Effect by region",
  subtitle: "Percentage points",
  xAxisType: "categorical",
  data: "bar-single.csv",
};

const BAR_MULTI_SPEC: ChartSpec = {
  chartType: "bar",
  title: "Effect by region over time",
  subtitle: "Percentage points",
  xAxisType: "categorical",
  series_order: ["2019", "2022", "2025"],
  data: "bar-multi.csv",
};

const BAR_NEGATIVE_SPEC: ChartSpec = {
  chartType: "bar",
  title: "Change by sector",
  subtitle: "Percentage points",
  xAxisType: "categorical",
  data: "bar-negative.csv",
};

const BAR_THIN_SPEC: ChartSpec = {
  chartType: "bar",
  title: "Many thin bars",
  subtitle: "Percentage points",
  xAxisType: "categorical",
  data: "bar-thin.csv",
};

const BAR_HORIZONTAL_SPEC: ChartSpec = {
  chartType: "bar",
  title: "Share by region",
  subtitle: "Percentage points",
  xAxisType: "categorical",
  orientation: "horizontal",
  data: "bar-horizontal.csv",
};

const BAR_GROUPED_HORIZONTAL_SPEC: ChartSpec = {
  chartType: "bar",
  title: "Effect by region over time",
  subtitle: "Percentage points",
  xAxisType: "categorical",
  orientation: "horizontal",
  series_order: ["2019", "2022", "2025"],
  data: "bar-multi.csv",
};

describe("golden SVG — bars", () => {
  it("renders a single-series bar chart (brand.blue, value labels)", async () => {
    const rows = parseCsv("./fixtures/bar-single.csv");
    const { svg } = renderChart(BAR_SINGLE_SPEC, rows, { width: 720, height: 400, document });
    // 4 bars rendered.
    const rects = svg.querySelectorAll('g[aria-label="bar"] rect');
    expect(rects.length).toBe(4);
    // Category labels are CENTERED under each bar (tweak-r2): each label's resolved x equals
    // the corresponding bar's CENTER x (left + width/2), within tolerance.
    const labelG = Array.from(svg.querySelectorAll('g[aria-label="text"]')).find((g) =>
      Array.from(g.querySelectorAll("text")).some((t) => t.textContent === "Northeast"),
    );
    const labels = Array.from(labelG?.querySelectorAll("text") ?? []);
    expect(labels.map((t) => t.textContent)).toEqual(["Northeast", "Midwest", "South", "West"]);
    labels.forEach((label, i) => {
      const rect = rects[i] as Element;
      const barCenter =
        absX(rect.parentElement) + Number(rect.getAttribute("x")) + Number(rect.getAttribute("width")) / 2;
      expect(Math.abs(absX(label) - barCenter)).toBeLessThan(1);
    });
    await expect(svg.outerHTML).toMatchFileSnapshot("./fixtures/bar-single.golden.svg");
  });

  it("renders a 3-group x 3-series grouped bar chart via fx", async () => {
    const rows = parseCsv("./fixtures/bar-multi.csv");
    const { svg } = renderChart(BAR_MULTI_SPEC, rows, { width: 720, height: 400, document });
    const rects = svg.querySelectorAll('g[aria-label="bar"] rect');
    // 3 groups (declaration order: Northeast, Midwest, South) x 3 series. Midwest's 2022
    // value is missing in the fixture, but Plot 0.6.16 does NOT omit the rect - it renders
    // it at zero height - so the full 3x3 = 9 rects are emitted. The tagging order is the
    // facet-major cross-product (group order, then series in x order), so each group is
    // tagged 2019,2022,2025 regardless of the gap. The Midwest/2022 rect is the zero-height
    // one but is still correctly tagged "2022".
    expect(rects.length).toBe(9);
    expect(rects[0]?.getAttribute("data-series")).toBe("2019"); // Northeast 2019
    expect(rects[2]?.getAttribute("data-series")).toBe("2025"); // Northeast 2025
    expect(rects[3]?.getAttribute("data-series")).toBe("2019"); // Midwest 2019
    expect(rects[4]?.getAttribute("data-series")).toBe("2022"); // Midwest 2022 (zero-height)
    expect(rects[4]?.getAttribute("height")).toBe("0"); // the omitted value -> zero height
    expect(rects[5]?.getAttribute("data-series")).toBe("2025"); // Midwest 2025
    expect(rects[6]?.getAttribute("data-series")).toBe("2019"); // South 2019
    expect(rects[8]?.getAttribute("data-series")).toBe("2025"); // South 2025
    // Group (fx) labels are CENTERED under each cluster (tweak-r2). The group center is the
    // midpoint between the group's leftmost bar-left and rightmost bar-right; the label's
    // resolved x must match it.
    const groupCenters = [0, 3, 6].map((start) => {
      const groupRects = [start, start + 1, start + 2].map((i) => rects[i] as Element);
      const left = Math.min(
        ...groupRects.map((r) => absX(r.parentElement) + Number(r.getAttribute("x"))),
      );
      const right = Math.max(
        ...groupRects.map(
          (r) => absX(r.parentElement) + Number(r.getAttribute("x")) + Number(r.getAttribute("width")),
        ),
      );
      return (left + right) / 2;
    });
    const fxLabelG = Array.from(svg.querySelectorAll('g[aria-label="text"]')).find((g) =>
      Array.from(g.querySelectorAll("text")).some((t) => t.textContent === "Northeast"),
    );
    const fxLabels = Array.from(fxLabelG?.querySelectorAll("text") ?? []);
    expect(fxLabels.map((t) => t.textContent)).toEqual(["Northeast", "Midwest", "South"]);
    fxLabels.forEach((label, i) => {
      expect(Math.abs(absX(label) - (groupCenters[i] as number))).toBeLessThan(1);
    });
    await expect(svg.outerHTML).toMatchFileSnapshot("./fixtures/bar-multi.golden.svg");
  });

  it("grouped bar render is deterministic (byte-identical)", () => {
    const rows = parseCsv("./fixtures/bar-multi.csv");
    const a = renderChart(BAR_MULTI_SPEC, rows, { width: 720, height: 400, document }).svg.outerHTML;
    const b = renderChart(BAR_MULTI_SPEC, rows, { width: 720, height: 400, document }).svg.outerHTML;
    expect(a).toBe(b);
  });

  it("renders bars crossing zero (labels above/below)", async () => {
    const rows = parseCsv("./fixtures/bar-negative.csv");
    const { svg } = renderChart(BAR_NEGATIVE_SPEC, rows, { width: 720, height: 400, document });
    expect(svg.querySelectorAll('g[aria-label="bar"] rect').length).toBe(5);
    await expect(svg.outerHTML).toMatchFileSnapshot("./fixtures/bar-negative.golden.svg");
  });

  it("suppresses value labels when bars are too thin", async () => {
    const rows = parseCsv("./fixtures/bar-thin.csv");
    const { svg } = renderChart(BAR_THIN_SPEC, rows, { width: 720, height: 400, document });
    // Bars still render...
    expect(svg.querySelectorAll('g[aria-label="bar"] rect').length).toBe(24);
    // ...but the value-label text mark is omitted entirely. When suppressed, only the chrome
    // text groups are present: the y-tick-label group and the band x-axis group (2 total).
    // A value-label Plot.text call would add a third g[aria-label="text"]. This assertion is
    // robust to label content — it counts groups, not specific text strings.
    const textGroups = svg.querySelectorAll('g[aria-label="text"]');
    expect(textGroups.length).toBe(2);
    await expect(svg.outerHTML).toMatchFileSnapshot("./fixtures/bar-thin.golden.svg");
  });

  it("renders the horizontal single-series variant", async () => {
    const rows = parseCsv("./fixtures/bar-horizontal.csv");
    const { svg } = renderChart(BAR_HORIZONTAL_SPEC, rows, { width: 720, height: 400, document });
    const rects = svg.querySelectorAll('g[aria-label="bar"] rect');
    expect(rects.length).toBe(4);
    // The left gutter widens responsively to fit the longest category label ("Northeastern
    // region", ~19 chars) so it isn't clipped. Assert: (1) the gutter exceeds the default
    // 44px, and (2) the longest label's estimated width fits within it (the labels are
    // left-justified at svg x=0 and must end before the plot/bars begin at x=marginLeft).
    const marginLeft = Number(svg.dataset.marginLeft);
    expect(marginLeft).toBeGreaterThan(44);
    const longestLabel = rows.reduce((w, r) => Math.max(w, (r.time as string).length), 0);
    const estWidth = longestLabel * 10.5 * 0.55; // matches axes.estimateLabelWidth heuristic
    expect(estWidth).toBeLessThanOrEqual(marginLeft);
    // Bars begin at the gutter edge (value-axis origin = marginLeft), past the labels.
    rects.forEach((r) => expect(Number(r.getAttribute("x"))).toBeGreaterThanOrEqual(marginLeft - 1));
    await expect(svg.outerHTML).toMatchFileSnapshot("./fixtures/bar-horizontal.golden.svg");
  });

  it("renders a multi-series grouped HORIZONTAL bar chart via fy", async () => {
    const rows = parseCsv("./fixtures/bar-multi.csv");
    const { svg } = renderChart(BAR_GROUPED_HORIZONTAL_SPEC, rows, {
      width: 720,
      height: 400,
      document,
    });
    // 3 groups (Northeast, Midwest, South) x 3 series. Midwest/2022 is missing in the
    // fixture, but the engine keeps the null-value row in scope and Plot's fy+barX renders
    // it at zero WIDTH (it does NOT omit the rect — verified empirically, same as the
    // vertical fx+barY full cross-product). So the full 3x3 = 9 rects are emitted.
    const rects = svg.querySelectorAll('g[aria-label="bar"] rect');
    expect(rects.length).toBe(9);
    // Tagging order is facet-major: each group tagged 2019,2022,2025 regardless of the gap.
    expect(rects[0]?.getAttribute("data-series")).toBe("2019"); // Northeast 2019
    expect(rects[1]?.getAttribute("data-series")).toBe("2022"); // Northeast 2022
    expect(rects[2]?.getAttribute("data-series")).toBe("2025"); // Northeast 2025
    expect(rects[3]?.getAttribute("data-series")).toBe("2019"); // Midwest 2019
    expect(rects[4]?.getAttribute("data-series")).toBe("2022"); // Midwest 2022 (zero-width)
    expect(rects[4]?.getAttribute("width")).toBe("0"); // the omitted value -> zero width
    expect(rects[5]?.getAttribute("data-series")).toBe("2025"); // Midwest 2025
    expect(rects[6]?.getAttribute("data-series")).toBe("2019"); // South 2019
    expect(rects[8]?.getAttribute("data-series")).toBe("2025"); // South 2025
    // fy facet-chrome collapse: exactly ONE value-axis tick-label group and one gridline
    // group survive (the per-facet duplicates were dropped).
    expect(svg.querySelectorAll("g.tbl-x-tick-label").length).toBe(1);
    expect(svg.querySelectorAll("g.tbl-gridline").length).toBe(1);
    expect(svg.querySelectorAll("g.tbl-zero-baseline").length).toBe(1);
    // Surviving gridlines span the full plot height (continuous vertical rules): the kept
    // group's lines were stretched to top→bottom plot edges (marginTop..height-marginBottom).
    const mt = Number(svg.dataset.marginTop);
    const mb = Number(svg.dataset.marginBottom);
    const gridGroup = svg.querySelector("g.tbl-gridline");
    const gridTy = (() => {
      const m = /translate\(\s*-?[\d.]+\s*[ ,]\s*(-?[\d.]+)/.exec(gridGroup?.getAttribute("transform") ?? "");
      return m ? Number(m[1]) : 0;
    })();
    const firstLine = gridGroup?.querySelector("line");
    expect(Number(firstLine?.getAttribute("y1")) + gridTy).toBeCloseTo(mt, 0);
    expect(Number(firstLine?.getAttribute("y2")) + gridTy).toBeCloseTo(400 - mb, 0);
    await expect(svg.outerHTML).toMatchFileSnapshot("./fixtures/bar-grouped-horizontal.golden.svg");
  });

  it("grouped horizontal render is deterministic (byte-identical)", () => {
    const rows = parseCsv("./fixtures/bar-multi.csv");
    const a = renderChart(BAR_GROUPED_HORIZONTAL_SPEC, rows, { width: 720, height: 400, document }).svg.outerHTML;
    const b = renderChart(BAR_GROUPED_HORIZONTAL_SPEC, rows, { width: 720, height: 400, document }).svg.outerHTML;
    expect(a).toBe(b);
  });
});

// --- Stacked bars (task A7) ---

const STACKED_CUMULATIVE_SPEC: ChartSpec = {
  chartType: "stacked",
  title: "Compensation by component",
  subtitle: "Thousands of dollars",
  xAxisType: "categorical",
  series_order: ["Wages", "Benefits", "Taxes"],
  data: "stacked-cumulative.csv",
};

const STACKED_DIVERGING_SPEC: ChartSpec = {
  chartType: "stacked",
  title: "Contributions to the net effect",
  subtitle: "Percentage points",
  xAxisType: "categorical",
  series_order: ["Lower rates", "Wider brackets", "Limit deductions", "Repeal credit"],
  data: "stacked-diverging.csv",
};

const STACKED_MONO_SPEC: ChartSpec = {
  chartType: "stacked",
  title: "Tiered composition",
  subtitle: "Units",
  xAxisType: "categorical",
  series_order: ["Tier A", "Tier B", "Tier C", "Tier D"],
  barStack: { mono: { base: "blue" } },
  data: "stacked-mono.csv",
};

const STACKED_NONE_SPEC: ChartSpec = {
  chartType: "stacked",
  title: "Net markers suppressed",
  subtitle: "Units",
  xAxisType: "categorical",
  series_order: ["Positive A", "Positive B", "Negative A"],
  barStack: { netDisplay: "none" },
  data: "stacked-none.csv",
};

const STACKED_100_SPEC: ChartSpec = {
  chartType: "stacked",
  title: "Share of spending by level of government",
  subtitle: "Percent",
  xAxisType: "categorical",
  series_order: ["Federal", "State", "Local"],
  barStack: { normalize: true },
  data: "stacked-100.csv",
};

const STACKED_HORIZONTAL_SPEC: ChartSpec = {
  chartType: "stacked",
  title: "Compensation by component",
  subtitle: "Thousands of dollars",
  xAxisType: "categorical",
  orientation: "horizontal",
  series_order: ["Wages", "Benefits", "Taxes"],
  data: "stacked-cumulative.csv",
};

describe("golden SVG — stacked bars", () => {
  it("renders a cumulative HORIZONTAL stack (single y band, no fy faceting)", async () => {
    const rows = parseCsv("./fixtures/stacked-cumulative.csv");
    const { svg } = renderChart(STACKED_HORIZONTAL_SPEC, rows, { width: 720, height: 400, document });
    // 3 categories x 3 series = 9 rects (all present). Horizontal stacked uses a single
    // y band (no faceting), so there is exactly ONE value-axis tick-label / gridline set.
    const rects = svg.querySelectorAll('g[aria-label="bar"] rect');
    expect(rects.length).toBe(9);
    expect(rects[0]?.getAttribute("data-series")).toBe("Wages");
    expect(rects[1]?.getAttribute("data-series")).toBe("Benefits");
    expect(rects[2]?.getAttribute("data-series")).toBe("Taxes");
    // No fy collapse classes (single-band stacked is not faceted).
    expect(svg.querySelectorAll("g.tbl-x-tick-label").length).toBe(0);
    // Responsive left gutter for the category labels.
    expect(Number(svg.dataset.marginLeft)).toBeGreaterThan(0);
    await expect(svg.outerHTML).toMatchFileSnapshot("./fixtures/stacked-horizontal.golden.svg");
  });

  it("renders a cumulative (all-positive) stack with net text above", async () => {
    const rows = parseCsv("./fixtures/stacked-cumulative.csv");
    const { svg, legendItems } = renderChart(STACKED_CUMULATIVE_SPEC, rows, {
      width: 720,
      height: 400,
      document,
    });
    // 3 categories x 3 series = 9 rects (all present).
    const rects = svg.querySelectorAll('g[aria-label="bar"] rect');
    expect(rects.length).toBe(9);
    // Tagging order: category-major, declaration order within each category. The bottom of
    // the first category's stack (first rect) is the first-declared series "Wages".
    expect(rects[0]?.getAttribute("data-series")).toBe("Wages");
    expect(rects[1]?.getAttribute("data-series")).toBe("Benefits");
    expect(rects[2]?.getAttribute("data-series")).toBe("Taxes");
    // No diverging dot → no "Total" legend extra; per-series legend present (3 series).
    expect(legendItems?.length).toBe(3);
    // Net text above each stack: stack mark + one net-text mark = a g[aria-label="text"]
    // for the net beyond the chrome (y-tick + band-x = 2) → 3 text groups.
    expect(svg.querySelectorAll('g[aria-label="text"]').length).toBe(3);
    await expect(svg.outerHTML).toMatchFileSnapshot("./fixtures/stacked-cumulative.golden.svg");
  });

  it("renders a diverging stack with a net dot + signed label and Total legend extra", async () => {
    const rows = parseCsv("./fixtures/stacked-diverging.csv");
    const { svg } = renderChart(STACKED_DIVERGING_SPEC, rows, { width: 720, height: 400, document });
    // 3 categories x 4 series = 12 rects.
    expect(svg.querySelectorAll('g[aria-label="bar"] rect').length).toBe(12);
    // A net dot exists (Plot.dot → g[aria-label="dot"] with circles).
    const dots = svg.querySelectorAll('g[aria-label="dot"] circle');
    expect(dots.length).toBe(3); // one per category
    // Net dots + net labels carry the shared Total key as data-series (TT6 #2/#3).
    dots.forEach((d) => expect(d.getAttribute("data-series")).toBe(TOTAL_SERIES_KEY));
    const netLabels = svg.querySelectorAll("g.tbl-net-label text");
    expect(netLabels.length).toBe(3);
    netLabels.forEach((t) => expect(t.getAttribute("data-series")).toBe(TOTAL_SERIES_KEY));
    // Diverging stack-order pin: within category A, declaration order from 0 is
    // Lower rates (bottom positive), Wider brackets, then the negatives. The first rect
    // (visual bottom of the positive sub-stack) is the first-declared positive series.
    const rects = svg.querySelectorAll('g[aria-label="bar"] rect');
    expect(rects[0]?.getAttribute("data-series")).toBe("Lower rates");
    expect(rects[1]?.getAttribute("data-series")).toBe("Wider brackets");
    expect(rects[2]?.getAttribute("data-series")).toBe("Limit deductions");
    expect(rects[3]?.getAttribute("data-series")).toBe("Repeal credit");
    await expect(svg.outerHTML).toMatchFileSnapshot("./fixtures/stacked-diverging.golden.svg");
  });

  it("diverging stack exposes a Total legendExtras entry; cumulative does not", () => {
    // legendExtras is a mark-layer field (A7 produces it; A8 renders it), so assert it via
    // the builder directly rather than through the render path.
    const divData: PreparedRow[] = parseCsv("./fixtures/stacked-diverging.csv").map((r) => ({
      series: r.series as string,
      time: r.time as string,
      _y: r.value === "" ? null : +(r.value as string),
      _xc: r.time as string,
    }));
    const divLayers = buildStackedMarks(divData, STACKED_DIVERGING_SPEC, {
      xField: "_xc",
      colors: new Map(),
      seriesNames: STACKED_DIVERGING_SPEC.series_order,
    });
    expect(divLayers.legendExtras).toEqual([
      { series: TOTAL_SERIES_KEY, label: "Total", markerShape: "dot" },
    ]);

    const cumData: PreparedRow[] = parseCsv("./fixtures/stacked-cumulative.csv").map((r) => ({
      series: r.series as string,
      time: r.time as string,
      _y: r.value === "" ? null : +(r.value as string),
      _xc: r.time as string,
    }));
    const cumLayers = buildStackedMarks(cumData, STACKED_CUMULATIVE_SPEC, {
      xField: "_xc",
      colors: new Map(),
      seriesNames: STACKED_CUMULATIVE_SPEC.series_order,
    });
    expect(cumLayers.legendExtras).toBeUndefined();
  });

  it("renders monochromatic segments in darkest-bottom tier order", async () => {
    const rows = parseCsv("./fixtures/stacked-mono.csv");
    const { svg } = renderChart(STACKED_MONO_SPEC, rows, { width: 720, height: 400, document });
    const rects = svg.querySelectorAll('g[aria-label="bar"] rect');
    // 3 categories x 4 series = 12 rects. First category's 4 segments, bottom→top, carry
    // the 4 darkest blue tiers (700, 600, 500, 400) since all values are positive and the
    // declaration order maps directly to bottom→top.
    expect(rects.length).toBe(12);
    expect(rects[0]?.getAttribute("fill")).toBe("#002B61"); // 700, bottom
    expect(rects[1]?.getAttribute("fill")).toBe("#00407A"); // 600
    expect(rects[2]?.getAttribute("fill")).toBe("#005794"); // 500
    expect(rects[3]?.getAttribute("fill")).toBe("#0070AF"); // 400, top
    await expect(svg.outerHTML).toMatchFileSnapshot("./fixtures/stacked-mono.golden.svg");
  });

  it("renders a 100%-stacked chart with a 0–100 y-axis and no net callout", async () => {
    const rows = parseCsv("./fixtures/stacked-100.csv");
    const { svg } = renderChart(STACKED_100_SPEC, rows, { width: 720, height: 400, document });
    expect(svg.querySelectorAll('g[aria-label="bar"] rect').length).toBe(9);
    // No net text/dot for normalized (every bar tops at 100%). Only chrome text groups
    // (y-tick labels + band x-axis) → 2.
    expect(svg.querySelectorAll('g[aria-label="text"]').length).toBe(2);
    expect(svg.querySelectorAll('g[aria-label="dot"] circle').length).toBe(0);
    await expect(svg.outerHTML).toMatchFileSnapshot("./fixtures/stacked-100.golden.svg");
  });

  it("netDisplay:none suppresses all net markers and Total legend entry", async () => {
    const rows = parseCsv("./fixtures/stacked-none.csv");
    const { svg, legendItems } = renderChart(STACKED_NONE_SPEC, rows, {
      width: 720,
      height: 400,
      document,
    });
    // 3 categories x 3 series = 9 rects.
    expect(svg.querySelectorAll('g[aria-label="bar"] rect').length).toBe(9);
    // No net dot (diverging data would normally produce one).
    expect(svg.querySelectorAll('g[aria-label="dot"] circle').length).toBe(0);
    // No net text above (only chrome text groups: y-tick + band-x = 2).
    expect(svg.querySelectorAll('g[aria-label="text"]').length).toBe(2);
    // No "Total" legend extra — only the 3 series entries.
    expect(legendItems?.length).toBe(3);
    expect(legendItems?.every((l) => l.series !== TOTAL_SERIES_KEY)).toBe(true);
    await expect(svg.outerHTML).toMatchFileSnapshot("./fixtures/stacked-none.golden.svg");
  });

  it("netDisplay:none via buildStackedMarks emits no legendExtras", () => {
    const noneData: PreparedRow[] = parseCsv("./fixtures/stacked-none.csv").map((r) => ({
      series: r.series as string,
      time: r.time as string,
      _y: r.value === "" ? null : +(r.value as string),
      _xc: r.time as string,
    }));
    const noneLayers = buildStackedMarks(noneData, STACKED_NONE_SPEC, {
      xField: "_xc",
      colors: new Map(),
      seriesNames: STACKED_NONE_SPEC.series_order,
    });
    expect(noneLayers.legendExtras).toBeUndefined();
  });

  it("diverging stacked render is deterministic (byte-identical)", () => {
    const rows = parseCsv("./fixtures/stacked-diverging.csv");
    const a = renderChart(STACKED_DIVERGING_SPEC, rows, { width: 720, height: 400, document }).svg.outerHTML;
    const b = renderChart(STACKED_DIVERGING_SPEC, rows, { width: 720, height: 400, document }).svg.outerHTML;
    expect(a).toBe(b);
  });
});

// --- Shared-mode small multiples (task B3) ---
//
// Builds a 2x2 faceted line plot directly via assemblePlot (the figure orchestrator B4 will
// drive this the same way). Each region is one pane; the shared y-scale + fx/fy facet grid
// renders as ONE SVG. The chrome must collapse to: y-tick labels on the LEFT column only,
// x-axis labels on the BOTTOM row only, a pane title per cell, per-pane gridlines.

// 2x2 layout: Northeast (0,0), Midwest (1,0), South (0,1), West (1,1).
const FACET_LAYOUT: Record<string, { col: number; row: number }> = {
  Northeast: { col: 0, row: 0 },
  Midwest: { col: 1, row: 0 },
  South: { col: 0, row: 1 },
  West: { col: 1, row: 1 },
};

function buildFacetedPlot() {
  const rows = parseCsv("./fixtures/facet-regions.csv");
  // Parse into PreparedRows carrying the temporal x + the facet grid-index fields.
  const data: PreparedRow[] = rows.map((r) => {
    const facet = r.facet as string;
    const cell = FACET_LAYOUT[facet] as { col: number; row: number };
    return {
      series: r.series as string,
      time: r.time as string,
      _y: r.value === "" ? null : +(r.value as string),
      _xd: parseDate(r.time as string),
      _facet: facet,
      _fxCol: String(cell.col),
      _fyRow: String(cell.row),
    };
  });

  // Faceted line overlay: the line mark carries the fx/fy facet channels.
  const overlay = [
    Plot.line(data, {
      x: "_xd",
      y: "_y",
      z: "series",
      fx: "_fxCol",
      fy: "_fyRow",
      stroke: TBL.color.blue,
      strokeWidth: TBL.strokeWidth.solid,
      defined: (r: PreparedRow) => Number.isFinite(r._y),
    }),
  ];

  // Shared y-axis across all panes.
  const { domain: yDomain, ticks: yTicks } = computeYAxis(
    data.map((d) => d._y),
    { includeZero: true, tickCount: 5 },
  );

  // Shared temporal x-axis built through the REAL adapter with the faceted flag set, so the
  // adapter (not the test) is what tags the x-axis label marks with X_AXIS_LABEL_CLASS. This
  // exercises the production path end-to-end: buildXOpts(data, faceted=true) → tblTemporalXAxis
  // with the class → grid collapse keeps the bottom row.
  const xOpts = makeXAdapter("temporal").buildXOpts(data, true);

  const layers: MarkLayers = {
    underlay: [],
    overlay,
    tagging: [],
    dashedNames: new Set<string>(),
  };

  const cells = Object.entries(FACET_LAYOUT).map(([title, { col, row }]) => ({
    col,
    row,
    title,
  }));

  const spec: ChartSpec = {
    chartType: "line",
    title: "Trend by region",
    subtitle: "Index",
    xAxisType: "temporal",
    data: "facet-regions.csv",
    small_multiples: { facet_field: "facet", columns: 2, mode: "shared" },
  };

  return assemblePlot({
    layers,
    yDomain,
    yTicks,
    units: "",
    xOpts,
    seriesNames: ["Series"],
    colors: new Map([["Series", TBL.color.blue]]),
    spec,
    width: 720,
    height: 460,
    document,
    classNameSuffix: "facet",
    facet: { columns: 2, rows: 2, cells },
  });
}

describe("golden SVG — shared-mode small multiples", () => {
  it("renders a 2x2 faceted line grid with collapsed chrome", async () => {
    const svg = buildFacetedPlot();
    expect(svg.tagName.toLowerCase()).toBe("svg");

    // ONE left-column y-tick-label set: 2 rows x (originally 2 columns) collapse to 2 groups
    // (one per row, leftmost column only).
    const yLabelGroups = svg.querySelectorAll("g.tbl-y-tick-label");
    expect(yLabelGroups.length).toBe(2);

    // X-axis labels: bottom row only. The temporal axis emits 2 text marks (month + year),
    // each faceted into the grid; after collapse each keeps only its bottom-row copies =
    // 2 columns. So 2 marks x 2 bottom-row cells = 4 groups.
    const xLabelGroups = svg.querySelectorAll(`g.${X_AXIS_LABEL_CLASS}`);
    expect(xLabelGroups.length).toBe(4);

    // A pane title per cell (4 panes → 4 title groups, none collapsed).
    const titleTexts = Array.from(
      svg.querySelectorAll("g.tbl-pane-title text"),
    ).map((t) => t.textContent);
    expect(titleTexts.sort()).toEqual(["Midwest", "Northeast", "South", "West"]);

    await expect(svg.outerHTML).toMatchFileSnapshot("./fixtures/facet-regions.golden.svg");
  });

  it("faceted grid render is deterministic (byte-identical)", () => {
    const a = buildFacetedPlot().outerHTML;
    const b = buildFacetedPlot().outerHTML;
    expect(a).toBe(b);
  });
});

// --- Figure orchestrator: shared-mode small multiples (task B4) ---
//
// Drives the WHOLE figure path through `renderFigure`: the orchestrator partitions the
// facet-regions fixture by `facet`, lays out a 2x2 grid, computes ONE shared y-domain, and
// (via renderPane → assemblePlot's `facet` option) renders ONE faceted SVG. The line mark
// builder binds fx/fy from the MarkContext facet fields. Asserts grid + collapsed chrome +
// pane titles, then locks the combined SVG to a golden.

const FIGURE_SPEC: ChartSpec = {
  chartType: "line",
  title: "Trend by region",
  subtitle: "Index",
  xAxisType: "temporal",
  data: "facet-regions.csv",
  small_multiples: {
    facet_field: "facet",
    columns: 2,
    mode: "shared",
    pane_titles: { Northeast: "Northeast", Midwest: "Midwest", South: "South", West: "West" },
  },
};

describe("golden figure — shared-mode small multiples (renderFigure, task B4)", () => {
  it("renders a 2x2 faceted line figure as one combined SVG", async () => {
    const rows = parseCsv("./fixtures/facet-regions.csv");
    const fig = renderFigure(FIGURE_SPEC, rows, { width: 720, height: 460, document });

    // Pane count = facet count; grid columns/rows correct.
    expect(fig.mode).toBe("shared");
    expect(fig.panes.length).toBe(4);
    expect(fig.columns).toBe(2);
    expect(fig.rows).toBe(2);
    expect(fig.panes.map((p) => p.value)).toEqual(["Northeast", "Midwest", "South", "West"]);

    const svg = fig.combinedSvg as SVGSVGElement;
    expect(svg.tagName.toLowerCase()).toBe("svg");

    // One left-column y-tick-label set: 2 rows survive (leftmost column only).
    expect(svg.querySelectorAll("g.tbl-y-tick-label").length).toBe(2);
    // Bottom-row-only x labels: 2 temporal marks x 2 bottom-row columns = 4 groups.
    expect(svg.querySelectorAll(`g.${X_AXIS_LABEL_CLASS}`).length).toBe(4);
    // A pane title per cell.
    const titleTexts = Array.from(svg.querySelectorAll("g.tbl-pane-title text"))
      .map((t) => t.textContent)
      .sort();
    expect(titleTexts).toEqual(["Midwest", "Northeast", "South", "West"]);

    // Single, unstyled series → no figure legend (pane titles carry identity).
    expect(fig.legendItems).toBeNull();

    await expect(svg.outerHTML).toMatchFileSnapshot("./fixtures/figure-regions.golden.svg");
  });

  it("figure render is deterministic (byte-identical)", () => {
    const rows = parseCsv("./fixtures/facet-regions.csv");
    const a = renderFigure(FIGURE_SPEC, rows, { width: 720, height: 460, document })
      .combinedSvg!.outerHTML;
    const b = renderFigure(FIGURE_SPEC, rows, { width: 720, height: 460, document })
      .combinedSvg!.outerHTML;
    expect(a).toBe(b);
  });

  it("render() dispatches: small_multiples -> figure, else -> single chart", () => {
    const figRows = parseCsv("./fixtures/facet-regions.csv");
    const fig = render(FIGURE_SPEC, figRows, { width: 720, height: 460, document }) as FigureRenderResult;
    expect(fig.mode).toBe("shared");
    expect(fig.combinedSvg).toBeTruthy();

    // No small_multiples → renderChart's RenderResult (a single `svg`, no `combinedSvg`).
    const single = render(GRADS_SPEC, parseCsv("./fixtures/grads-recent.csv"), {
      width: 720,
      height: 400,
      document,
    });
    expect("combinedSvg" in single).toBe(false);
    expect((single as { svg: SVGSVGElement }).svg.tagName.toLowerCase()).toBe("svg");
  });
});

describe("axes primitives — pane titles + tick density (task B3)", () => {
  it("paneTitleMark returns one non-empty text mark per grid", () => {
    const marks = paneTitleMark([
      { col: 0, row: 0, title: "A" },
      { col: 1, row: 0, title: "B" },
    ]);
    expect(marks.length).toBe(1);
    expect(marks[0]).toBeTruthy();
  });

  it("a higher density multiplier yields fewer (or equal) x ticks", () => {
    const xDomain: [Date, Date] = [new Date(2010, 0, 1), new Date(2026, 0, 1)];
    const dense = temporalXTicks(xDomain, 1);
    const sparse = temporalXTicks(xDomain, 2);
    expect(sparse.length).toBeLessThan(dense.length);
    // Default (no multiplier) matches multiplier 1.
    expect(temporalXTicks(xDomain).length).toBe(dense.length);
    // Documented clamping: expects integers >= 1. Non-integers floor (1.9 -> 1, NOT 2), and
    // sub-1 / zero / negative inputs clamp to 1 (every tick), never collapsing the cadence.
    expect(temporalXTicks(xDomain, 1.9).length).toBe(dense.length); // floor(1.9)=1
    expect(temporalXTicks(xDomain, 0).length).toBe(dense.length); // max(1, 0)=1
    expect(temporalXTicks(xDomain, 0.5).length).toBe(dense.length); // floor->0, max->1
    expect(temporalXTicks(xDomain, -3).length).toBe(dense.length); // max(1, -3)=1
    // Sentinel against an unused import.
    expect(typeof makeTickFormatter([0, 1], "")).toBe("function");
    expect(typeof d3.timeFormat).toBe("function");
  });
});
