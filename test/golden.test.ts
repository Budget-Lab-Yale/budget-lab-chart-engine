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
