// CONFIG-SPEC `stub_width` / `column_width`: the px widths hold when the table is at least as wide
// as its space, and a narrower table is stretched to fill it; the widest-word and banner floors hold
// on a single table and not on a live multi-pane one. Measured on the live table in real Chromium
// (table-layout:fixed, width:100% only resolve in a layout engine). The PNG side of the same
// sentences is test/table/export-fill-width.test.ts.
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

/** One rendered table: its width, each data row's cell widths and height, and each banner cell's
 *  width beside the width of its label text. */
interface Probed {
  width: number;
  rows: Array<{ widths: number[]; height: number }>;
  banners: Array<{ width: number; label: number }>;
}

/** Mount `spec` in a CARD-wide container in Chromium and measure every table it draws. */
async function liveTables(spec: TableSpec, rows: TidyRow[]): Promise<Probed[]> {
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
      tables.map((t) => ({
        width: t.getBoundingClientRect().width,
        rows: Array.from(t.querySelectorAll("tbody tr[data-row]")).map((tr) => ({
          widths: Array.from(tr.children).map((c) => c.getBoundingClientRect().width),
          height: tr.getBoundingClientRect().height,
        })),
        banners: Array.from(t.querySelectorAll("thead th.is-spanner > .tbl-table-spanner")).map((span) => {
          const range = document.createRange();
          range.selectNodeContents(span);
          return { width: span.parentElement!.getBoundingClientRect().width, label: range.getBoundingClientRect().width };
        }),
      })));
  } finally {
    await page.close();
  }
}

/** Rendered widths of the first data row of each pane: [stub, ...data cells]. */
async function liveWidths(spec: TableSpec, rows: TidyRow[]): Promise<number[][]> {
  return (await liveTables(spec, rows)).map((t) => t.rows[0]!.widths);
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

  // CONFIG-SPEC `column_width`: the widest-word floor holds on a single table and not on a live
  // multi-pane one, whose equal shares ignore it. The single table is the control: same spec, no pane.
  it("a wrapping word wider than its column: a single table widens the column, a multi-pane one breaks the word", async () => {
    const WORD = "W".repeat(120);
    const spec: TableSpec = { ...BASE, column_width: 40, column_wrap: true };
    const withWord = (rows: TidyRow[]) => rows.map((r) => (r.row === "A" && r.col === "c1" ? { ...r, value: WORD } : r));

    // The single table's column is raised from 40 to about the word's width (~1500 px). Its row
    // height is not asserted: this page has no Figtree, and the canvas measure falls back to a
    // different face than the CSS stack, so the raised width can miss the drawn word by a few px.
    const [single] = await liveTables(spec, withWord(rowsFor(["c1", "c2"])));
    const sa = single!.rows[0]!;
    expect(sa.widths[1]!).toBeGreaterThan(1000);

    const panes = await liveTables({ ...spec, pane: "pane" }, withWord(rowsFor(["c1", "c2"], ["P", "Q"])));
    expect(panes).toHaveLength(2);
    for (const p of panes) {
      const [a, b] = p.rows;
      expect(p.width).toBeCloseTo(CARD, 0); // nothing widened past the card
      expect(a!.widths[1]!).toBeCloseTo(a!.widths[2]!, 0); // equal shares, the word's column included
      expect(a!.widths[1]!).toBeLessThan(sa.widths[1]! / 3); // far narrower than the word needs...
      expect(a!.height).toBeGreaterThan(2 * b!.height); // ...so the word breaks across lines
    }
  });

  // CONFIG-SPEC `column_width`: a banner wider than its columns widens them on a single table, and
  // does not on a live multi-pane one.
  it("a banner wider than its columns: a single table widens them, a multi-pane one does not", async () => {
    const LABEL = "A banner label wider than its pair";
    const rows = (panes: string[]): TidyRow[] => panes.flatMap((pane) => ["A", "B"].flatMap((row) =>
      EIGHT.map((col, i) => ({ pane, row, grp: `${LABEL} ${Math.floor(i / 2) + 1}`, col, value: "1" }) as TidyRow)));
    const spec: TableSpec = { ...BASE, header: ["grp", "col"], column_width: 40 };

    const [single] = await liveTables(spec, rows([""]));
    expect(single!.banners).toHaveLength(4);
    for (const b of single!.banners) expect(b.width).toBeGreaterThan(b.label);

    const panes = await liveTables({ ...spec, pane: "pane" }, rows(["P", "Q"]));
    expect(panes).toHaveLength(2);
    for (const p of panes) {
      expect(p.width).toBeCloseTo(CARD, 0);
      expect(p.banners).toHaveLength(4);
      for (const b of p.banners) expect(b.width).toBeLessThan(b.label);
    }
  });
});
