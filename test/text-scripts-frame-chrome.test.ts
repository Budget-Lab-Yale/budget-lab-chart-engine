// @vitest-environment jsdom
//
// F5: text the calibrated Figtree table does not cover (Cyrillic, Greek, other scripts, emoji
// clusters) stays inside its frame as Chromium actually draws it. The layout places every line by
// timelineTextWidth, so a jsdom assertion on the layout's own boxes would only check the estimate
// against itself; this renders the timeline and treemap SVGs in headless Chromium with the embedded
// Figtree and reads each <text>'s real box. Whichever system font draws the scripts on the machine
// running it (Segoe UI on Windows, the Playwright image's fonts in CI), the estimate is at most 2%
// short of the widest measured, so a line may run at most 2% of its width past its frame.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { existsSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import { renderChart } from "../src/engine/index";
import { FIGTREE_FONT_FACE } from "../src/embed/assets";
import { TM_GEOM } from "../src/engine/treemap-layout";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

// A real Chromium launch: the suite's jsdom-speed defaults are too tight under parallel load (see
// test/hatch-legend-legibility.test.ts).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const HAS_BROWSER = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

let browser: Browser;
beforeAll(async () => {
  if (HAS_BROWSER) browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

interface Drawn { text: string; x0: number; x1: number; y0: number; y1: number; tile: [number, number, number, number] | null }

/** Every <text> of `svg` as Chromium draws it (getBBox, in the SVG's own px), with the tile rect
 *  (x0, y0, x1, y1) of the treemap group it is in, if any. */
async function drawnTexts(svg: SVGSVGElement): Promise<Drawn[]> {
  const page = await browser.newPage();
  try {
    await page.setContent(`<style>${FIGTREE_FONT_FACE}</style><body style="margin:0">${svg.outerHTML}</body>`);
    return await page.evaluate(async () => {
      await document.fonts.load("500 12px Figtree");
      await document.fonts.load("700 12px Figtree");
      await document.fonts.ready;
      return [...document.querySelectorAll("text")].map((t) => {
        const b = (t as SVGTextElement).getBBox();
        const rect = t.closest("g")?.querySelector("rect.tbl-treemap-tile");
        const n = (a: string): number => Number(rect?.getAttribute(a));
        return {
          text: t.textContent ?? "", x0: b.x, x1: b.x + b.width, y0: b.y, y1: b.y + b.height,
          tile: rect ? [n("x"), n("y"), n("x") + n("width"), n("y") + n("height")] as [number, number, number, number] : null,
        };
      });
    });
  } finally {
    await page.close();
  }
}

/** The 2% the estimate may run short of the widest font, plus half a pixel of rounding. */
const slack = (d: Drawn): number => 0.02 * (d.x1 - d.x0) + 0.5;

const TIMELINE = {
  chartType: "timeline", title: "Хронология", xAxisType: "temporal", data: "d.csv",
  columns: { x: "date", label: "title", description: "detail" },
} as ChartSpec;
const TIMELINE_ROWS = [
  { date: "2017", title: "Закон о снижении налогов и создании рабочих мест", detail: "Федеральный бюджет" },
  { date: "2020", title: "ГОСУДАРСТВЕННЫЙБЮДЖЕТНАЛОГОВАЯРЕФОРМА", detail: "" },
  { date: "2022", title: "Κρατικός προϋπολογισμός ΦΟΡΟΛΟΓΙΚΗ ΜΕΤΑΡΡΥΘΜΙΣΗ", detail: "Υπουργείο Οικονομικών" },
  { date: "2024", title: "Рост ВВП в США 🇺🇸🇬🇧👍🏽👨‍👩‍👧", detail: "МВФ ЖКХ НДС" },
  { date: "2026", title: "Щедрыйвечерщедрыйвечерщедрыйвечер", detail: "சென்னை കോളം" },
] as TidyRow[];

const TREEMAP = {
  chartType: "treemap", title: "Расходы", xAxisType: "categorical", data: "d.csv",
  columns: { x: "category", value: "amount" },
} as ChartSpec;
const TREEMAP_ROWS = ([
  ["Министерство обороны", 900], ["Здравоохранение", 640], ["Социальное обеспечение", 520],
  ["Образование", 380], ["Жилищное хозяйство", 300], ["Υπουργείο Οικονομικών", 260], ["ΦΟΡΟΛΟΓΙΑ", 200],
  ["Щедрый вечер", 170], ["США 🇺🇸", 140], ["Москва", 120], ["ЖКХ", 100], ["Αθήνα", 90], ["Київ", 70],
] as const).map(([category, amount]) => ({ category, amount: String(amount) }) as TidyRow);

describe.skipIf(!HAS_BROWSER)("scripts Figtree lacks stay in their frame as Chromium draws them (F5)", () => {
  it.each([
    ["vertical", 280], ["vertical", 375], ["horizontal", 600], ["horizontal", 900],
  ] as const)("timeline %s at %ipx: every line inside the chart's width", async (orientation, width) => {
    const { svg } = renderChart(TIMELINE, TIMELINE_ROWS, { width, timelineOrientation: orientation });
    const w = Number(svg.getAttribute("width"));
    const drawn = await drawnTexts(svg);
    expect(drawn.some((d) => /[А-яΑ-ω]/.test(d.text))).toBe(true);
    for (const d of drawn) {
      expect(d.x0, d.text).toBeGreaterThanOrEqual(-slack(d));
      expect(d.x1, d.text).toBeLessThanOrEqual(w + slack(d));
    }
  });

  it.each([375, 720, 920])("treemap at %ipx: every label inside its tile's padded box", async (width) => {
    const { svg } = renderChart(TREEMAP, TREEMAP_ROWS, { width });
    const labels = (await drawnTexts(svg)).filter((d) => d.tile);
    expect(labels.length).toBeGreaterThan(3);
    for (const d of labels) {
      const [x0, , x1] = d.tile!;
      expect(d.x0, d.text).toBeGreaterThanOrEqual(x0 + TM_GEOM.pad - slack(d));
      expect(d.x1, d.text).toBeLessThanOrEqual(x1 - TM_GEOM.pad + slack(d));
    }
  });
});
