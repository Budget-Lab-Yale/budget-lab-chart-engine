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
import { renderChart } from "../src/engine/index";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

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

describe("golden SVG — bars", () => {
  it("renders a single-series bar chart (brand.blue, value labels)", async () => {
    const rows = parseCsv("./fixtures/bar-single.csv");
    const { svg } = renderChart(BAR_SINGLE_SPEC, rows, { width: 720, height: 400, document });
    // 4 bars rendered.
    expect(svg.querySelectorAll('g[aria-label="bar"] rect').length).toBe(4);
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
    // ...but the value-label text mark is omitted entirely. The only remaining
    // aria-label="text" groups are the chrome labels (y-tick labels + band x-axis labels);
    // a value-label group would be a third. Assert no <text> renders any bar's value (1.5).
    const texts = Array.from(svg.querySelectorAll('g[aria-label="text"] text')).map(
      (t) => t.textContent ?? "",
    );
    expect(texts.some((t) => t === "1.5")).toBe(false);
    await expect(svg.outerHTML).toMatchFileSnapshot("./fixtures/bar-thin.golden.svg");
  });

  it("renders the horizontal single-series variant", async () => {
    const rows = parseCsv("./fixtures/bar-horizontal.csv");
    const { svg } = renderChart(BAR_HORIZONTAL_SPEC, rows, { width: 720, height: 400, document });
    expect(svg.querySelectorAll('g[aria-label="bar"] rect').length).toBe(4);
    await expect(svg.outerHTML).toMatchFileSnapshot("./fixtures/bar-horizontal.golden.svg");
  });
});
