// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderChart } from "../src/engine/index";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

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
const BLS = parseCsv("./fixtures/treemap-bls.csv");
const GROUPED = parseCsv("./fixtures/treemap-grouped.csv");
const base = { chartType: "treemap", xAxisType: "categorical", data: "d.csv", value_format: { prefix: "$" } } as const;
const FLAT = { ...base, title: "Share of total annual expenditures, 2024", columns: { x: "category", value: "amount" } } as ChartSpec;
const GROUPED_SPEC = {
  ...base, title: "Federal outlays", columns: { x: "category", value: "amount", series: "group" },
  series_order: ["Mandatory", "Discretionary", "Net interest", "Other spending"],
} as ChartSpec;

describe("treemap goldens", () => {
  it("flat, the reference image's categories, at 920", async () => {
    await expect(renderChart(FLAT, BLS, { width: 920 }).svg.outerHTML).toMatchFileSnapshot("./fixtures/treemap-flat.golden.svg");
  });
  it("grouped at 920", async () => {
    await expect(renderChart(GROUPED_SPEC, GROUPED, { width: 920 }).svg.outerHTML).toMatchFileSnapshot("./fixtures/treemap-grouped.golden.svg");
  });
  it("flat at 375 (narrow)", async () => {
    await expect(renderChart(FLAT, BLS, { width: 375 }).svg.outerHTML).toMatchFileSnapshot("./fixtures/treemap-narrow.golden.svg");
  });
});
