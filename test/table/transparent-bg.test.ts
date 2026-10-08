// Tables render on a transparent background, like charts (src/embed/styles.ts `body`), so an
// embedded table takes the host page's colour. Deliberate tints (emphasis, hover) keep theirs.
// The pinned first column (sticky.firstColumn) stays opaque wherever scrolled cells can pass
// behind it — i.e. whenever the table overflows its scroll box — and is transparent when the
// table fits. Asserted on computed style AND on pixels in a real Chromium page whose background
// is a non-white host colour, so a rule that resolves but does not paint still fails.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import { PNG } from "pngjs";
import { BUNDLE_PATH } from "../setup/global-build";
import { CHART_CSS } from "../../src/embed/styles";
import type { TableSpec } from "../../src/spec/table-types";
import type { TidyRow } from "../../src/data/index";

const HAS_BROWSER = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

// Real Chromium launch: raised per-file, as in test/tooltip-divider-visibility.test.ts.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const HOST_BG = "#f4efe6";
const HOST_RGB = [0xf4, 0xef, 0xe6] as const;
const TRANSPARENT = "rgba(0, 0, 0, 0)";
const WHITE = "rgb(255, 255, 255)"; // --tbl-bg
const SUBTLE = "rgb(246, 247, 249)"; // --tbl-bg-subtle

const ROWS: TidyRow[] = [];
const COLS = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"];
for (const g of ["G1", "G2"]) {
  for (const r of ["A", "B"]) {
    for (const c of COLS) ROWS.push({ grp: g, row: r, col: c, value: "88888" } as TidyRow);
  }
}

const BASE: TableSpec = {
  title: "Background",
  data: "inline",
  stub: ["grp", "row"],
  header: ["col"],
  value: "value",
  format: { default: { type: "number", decimals: 0 } },
  emphasis_rows: ["B"],
};
// A short stub label in a wide fixed stub column leaves the pinned cell's right half empty, so
// anything painted there while scrolled can only be a scrolled cell showing through.
const STICKY: TableSpec = { ...BASE, sticky: { firstColumn: true }, stub_width: 160 };
const STICKY_WIDE: TableSpec = { ...STICKY, column_width: 120 }; // 160 + 8 x 120 > 700: overflows

let browser: Browser;
beforeAll(async () => {
  if (HAS_BROWSER) browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

async function mount(spec: TableSpec, width = 700): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: width + 40, height: 600 } });
  const liveJs = readFileSync(BUNDLE_PATH, "utf8");
  await page.setContent(
    `<!doctype html><html><head><style>${CHART_CSS}</style></head>` +
      `<body style="margin:0;padding:20px;background:${HOST_BG}">` +
      `<div id="t" style="width:${width}px"></div>` +
      `<script>${liveJs}</script></body></html>`,
    { waitUntil: "load" },
  );
  await page.evaluate(
    ({ spec, rows, width }) => {
      const w = window as unknown as {
        BudgetLabChart: { mountTable: (el: Element, opts: unknown) => void };
      };
      w.BudgetLabChart.mountTable(document.getElementById("t")!, { spec, rows, width });
    },
    { spec, rows: ROWS, width },
  );
  // Let the ResizeObserver's first (attached) draw run.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page;
}

const bg = (page: Page, selector: string): Promise<string[]> =>
  page.$$eval(selector, (els) => els.map((el) => getComputedStyle(el).backgroundColor));

describe.skipIf(!HAS_BROWSER)("table background", () => {
  it("header and body cells are transparent; the host colour shows through", async () => {
    const page = await mount(BASE);
    try {
      for (const sel of [
        ".tbl-table thead th",
        ".tbl-table tbody tr:not(.tbl-table-group):not([data-row='B']) td",
        ".tbl-table tbody tr:not(.tbl-table-group):not([data-row='B']) th",
        ".tbl-table tbody tr.tbl-table-group th",
      ]) {
        const got = await bg(page, sel);
        expect(got.length, sel).toBeGreaterThan(0);
        expect(new Set(got), sel).toEqual(new Set([TRANSPARENT]));
      }
      // Pixels: the blank right-hand padding of a body cell is the host colour.
      await page.mouse.move(0, 0);
      const box = (await page.locator(".tbl-table tbody tr[data-row='A'] td").first().boundingBox())!;
      const png = PNG.sync.read(await page.screenshot({
        clip: { x: box.x + box.width - 4, y: box.y + 2, width: 2, height: 2 },
      }));
      expect([png.data[0], png.data[1], png.data[2]]).toEqual([...HOST_RGB]);
    } finally {
      await page.close();
    }
  });

  it("deliberate tints keep their fill: emphasis rows and row hover", async () => {
    const page = await mount(BASE);
    try {
      expect(new Set(await bg(page, ".tbl-table tbody tr[data-row='B'] td"))).toEqual(new Set([SUBTLE]));
      await page.locator(".tbl-table tbody tr[data-row='A'] td").first().hover();
      expect(new Set(await bg(page, ".tbl-table tbody tr[data-row='A']:hover td"))).toEqual(new Set([SUBTLE]));
    } finally {
      await page.close();
    }
  });

  it("sticky first column, table fits: the pinned column is transparent too", async () => {
    const page = await mount(STICKY);
    try {
      const fits = await page.$eval(".figure-canvas-scroll", (s) => s.scrollWidth <= s.clientWidth);
      expect(fits).toBe(true);
      expect(new Set(await bg(page, ".tbl-table tbody tr[data-row='A'] th.tbl-table-stub"))).toEqual(new Set([TRANSPARENT]));
      expect(await bg(page, ".tbl-table thead th.tbl-table-stub-header")).toEqual([TRANSPARENT]);
    } finally {
      await page.close();
    }
  });

  it("sticky first column, table overflows: pinned cells are opaque and nothing shows through when scrolled", async () => {
    const page = await mount(STICKY_WIDE);
    try {
      const overflow = await page.$eval(".figure-canvas-scroll", (s) => s.scrollWidth > s.clientWidth);
      expect(overflow).toBe(true);
      await page.$eval(".figure-canvas-scroll", (s) => { s.scrollLeft = 300; });
      await page.mouse.move(0, 0);
      expect(new Set(await bg(page, ".tbl-table tbody tr[data-row='A'] th.tbl-table-stub"))).toEqual(new Set([WHITE]));
      expect(await bg(page, ".tbl-table thead th.tbl-table-stub-header")).toEqual([WHITE]);
      // The pinned stub's empty right half, with numbers scrolled underneath it: all --tbl-bg.
      const box = (await page.locator(".tbl-table tbody tr[data-row='A'] th.tbl-table-stub").first().boundingBox())!;
      const png = PNG.sync.read(await page.screenshot({
        clip: { x: box.x + 60, y: box.y + 2, width: box.width - 64, height: box.height - 4 },
      }));
      let nonWhite = 0;
      for (let i = 0; i < png.data.length; i += 4) {
        if (png.data[i] !== 255 || png.data[i + 1] !== 255 || png.data[i + 2] !== 255) nonWhite++;
      }
      expect(nonWhite).toBe(0);
      // Hover still tints a pinned cell (the opaque fill must not outrank the hover rule).
      await page.locator(".tbl-table tbody tr[data-row='A'] th.tbl-table-stub").first().hover();
      expect(new Set(await bg(page, ".tbl-table tbody tr[data-row='A']:hover th.tbl-table-stub"))).toEqual(new Set([SUBTLE]));
    } finally {
      await page.close();
    }
  });

  it("a sticky table that starts fitting turns opaque once a resize makes it overflow", async () => {
    const page = await mount(STICKY_WIDE, 1400);
    try {
      expect(await page.$eval(".figure-canvas-scroll", (s) => s.scrollWidth <= s.clientWidth)).toBe(true);
      expect(await bg(page, ".tbl-table thead th.tbl-table-stub-header")).toEqual([TRANSPARENT]);
      await page.setViewportSize({ width: 740, height: 600 });
      await page.$eval("#t", (el) => { (el as HTMLElement).style.width = "700px"; });
      await expect.poll(() => bg(page, ".tbl-table thead th.tbl-table-stub-header")).toEqual([WHITE]);
    } finally {
      await page.close();
    }
  });

  it("re-measures when only the scroll box narrows (no card resize, no redraw)", async () => {
    const page = await mount(STICKY_WIDE, 1400);
    try {
      expect(await bg(page, ".tbl-table thead th.tbl-table-stub-header")).toEqual([TRANSPARENT]);
      await page.$eval(".figure-canvas-scroll", (el) => { (el as HTMLElement).style.width = "700px"; });
      await expect.poll(() => bg(page, ".tbl-table thead th.tbl-table-stub-header")).toEqual([WHITE]);
    } finally {
      await page.close();
    }
  });
});
