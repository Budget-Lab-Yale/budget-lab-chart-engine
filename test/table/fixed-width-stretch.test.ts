// CONFIG-SPEC `stub_width` / `column_width`: the px widths hold when the table is at least as wide
// as its space, and a narrower table is stretched to fill it. Measured on the live table in real
// Chromium (table-layout:fixed, width:100% only resolve in a layout engine). The PNG side of the
// same sentences is test/table/export-fill-width.test.ts.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Browser } from "playwright";
import { BUNDLE_PATH } from "../setup/global-build";
import { CHART_CSS } from "../../src/embed/styles";
import type { TableSpec } from "../../src/spec/table-types";
import type { TidyRow } from "../../src/data/index";
import { HAS_BROWSER, launchBrowser, closeBrowser, CLOSE_HOOK_TIMEOUT_MS } from "../helpers/browser";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const CARD = 700;
const rowsFor = (cols: string[], panes: string[] = [""]): TidyRow[] =>
  panes.flatMap((pane) => ["A", "B"].flatMap((row) => cols.map((col) => ({ pane, row, col, value: "1" }) as TidyRow)));
const BASE: TableSpec = {
  title: "Widths", data: "inline", stub: [{ label: "row" }], header: ["col"], value: "value",
  format: { default: { type: "number", decimals: 0 } }, stub_width: 100,
};
const EIGHT = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"];

let browser: Browser;
beforeAll(async () => {
  if (HAS_BROWSER) browser = await launchBrowser();
}, 60_000);
afterAll(() => closeBrowser(browser), CLOSE_HOOK_TIMEOUT_MS);

/** Rendered widths of the first data row of each pane: [stub, ...data cells]. */
async function liveWidths(spec: TableSpec, rows: TidyRow[]): Promise<number[][]> {
  const page = await browser.newPage({ viewport: { width: CARD + 40, height: 800 } });
  try {
    const liveJs = readFileSync(BUNDLE_PATH, "utf8");
    await page.setContent(
      `<!doctype html><html><head><style>${CHART_CSS}</style></head>` +
        `<body style="margin:0;padding:20px"><div id="t" style="width:${CARD}px"></div>` +
        `<script>${liveJs}</script></body></html>`,
      { waitUntil: "load" },
    );
    await page.evaluate(({ spec, rows, width }) => {
      const w = window as unknown as { BudgetLabChart: { mountTable: (el: Element, opts: unknown) => void } };
      w.BudgetLabChart.mountTable(document.getElementById("t")!, { spec, rows, width });
    }, { spec, rows, width: CARD });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    return await page.$$eval("table.tbl-table", (tables) =>
      tables.map((t) => {
        const tr = t.querySelector("tbody tr[data-row]")!;
        return Array.from(tr.children).map((c) => c.getBoundingClientRect().width);
      }));
  } finally {
    await page.close();
  }
}

describe.skipIf(!HAS_BROWSER)("live table: stub_width / column_width against the card width", () => {
  it("a narrower single table stretches; stub and columns widen in proportion", async () => {
    const [w] = await liveWidths({ ...BASE, column_width: 80 }, rowsFor(["c1", "c2"]));
    const [stub, a, b] = w!;
    expect(stub!).toBeGreaterThan(100 * 1.5);
    expect(a!).toBeGreaterThan(80 * 1.5);
    expect(stub! / a!).toBeCloseTo(100 / 80, 1);
    expect(b!).toBeCloseTo(a!, 0);
  });

  it("a single table at least as wide as the card keeps the set widths", async () => {
    const [w] = await liveWidths({ ...BASE, column_width: 120 }, rowsFor(EIGHT)); // 100 + 8 x 120 > 700
    expect(w![0]!).toBeCloseTo(100, 0);
    for (const c of w!.slice(1)) expect(c).toBeCloseTo(120, 0);
  });

  it("multi-pane: the stub keeps its width and the data columns split the rest equally", async () => {
    const spec: TableSpec = { ...BASE, pane: "pane", column_width: { c1: 60, c2: 120 } };
    const panes = await liveWidths(spec, rowsFor(["c1", "c2"], ["P", "Q"]));
    expect(panes).toHaveLength(2);
    for (const [stub, a, b] of panes) {
      expect(stub!).toBeCloseTo(100, 0);
      expect(a!).toBeGreaterThan(120);
      expect(b!).toBeCloseTo(a!, 0);
    }
  });

  it("multi-pane: the equal split holds even when the set widths would not fit", async () => {
    const spec: TableSpec = { ...BASE, pane: "pane", column_width: 120 };
    const panes = await liveWidths(spec, rowsFor(EIGHT, ["P", "Q"]));
    for (const [stub, ...cells] of panes) {
      expect(stub!).toBeCloseTo(100, 0);
      for (const c of cells) expect(c).toBeCloseTo(cells[0]!, 0);
      expect(cells[0]!).toBeLessThan(120);
    }
  });
});
