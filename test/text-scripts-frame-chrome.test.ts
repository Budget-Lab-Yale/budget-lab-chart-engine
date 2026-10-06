// @vitest-environment jsdom
//
// F5 / Ruling 51: text the calibrated Figtree table does not cover (Cyrillic, Greek, other scripts,
// emoji clusters) stays inside its column as Chromium actually draws it. The layout places every
// line by timelineTextWidth, so a jsdom assertion on the layout's own boxes would only check the
// estimate against itself; this renders the timeline and treemap SVGs in headless Chromium with the
// embedded Figtree and reads each line's real width and box. Whichever system font draws the
// scripts on the machine running it (Segoe UI on Windows; Liberation, DejaVu, FreeFont or Unifont
// in the CI Playwright image), no line may draw wider than its estimate, nor past its column.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { existsSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import { renderChart } from "../src/engine/index";
import { FIGTREE_FONT_FACE } from "../src/embed/assets";
import { TM_GEOM } from "../src/engine/treemap-layout";
import { timelineTextWidth } from "../src/engine/timeline-text";
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

/** One drawn line: a <text> without <tspan>s, or a <tspan>. `est` is timelineTextWidth's width
 *  for it; `col` the column it was laid out in (a timeline label's box: the union of its lines'
 *  estimated extents; a treemap tile's padded box), when it has one. */
interface Drawn { text: string; est: number; drawn: number; x0: number; x1: number; col: [number, number] | null }

/** The attribute `name` on `el` or its nearest ancestor that has it. */
const inherited = (el: Element, name: string): string | null => el.closest(`[${name}]`)?.getAttribute(name) ?? null;

/** Every line of `svg` as Chromium draws it. Estimates and columns are computed here, from the
 *  markup, and carried to the page as data attributes. */
async function drawnLines(svg: SVGSVGElement): Promise<Drawn[]> {
  const lines = [...svg.querySelectorAll("text")].flatMap((t) => (t.querySelector("tspan") ? [...t.querySelectorAll("tspan")] : [t]));
  const extent = (el: Element, est: number): [number, number] => {
    const x = Number(el.getAttribute("x"));
    const anchor = inherited(el, "text-anchor") ?? "start";
    return anchor === "middle" ? [x - est / 2, x + est / 2] : anchor === "end" ? [x - est, x] : [x, x + est];
  };
  for (const el of lines) {
    const size = Number(inherited(el, "font-size"));
    const weight = Number(inherited(el, "font-weight") ?? 500) >= 700 ? 700 : 500;
    el.setAttribute("data-est", String(timelineTextWidth(el.textContent ?? "", size, weight)));
  }
  for (const g of svg.querySelectorAll("g.tbl-timeline-label")) {
    const spans = [...g.querySelectorAll("text")].map((t) => extent(t, Number(t.getAttribute("data-est"))));
    const col = [Math.min(...spans.map((s) => s[0])), Math.max(...spans.map((s) => s[1]))];
    for (const t of g.querySelectorAll("text")) t.setAttribute("data-col", col.join(" "));
  }
  for (const rect of svg.querySelectorAll("rect.tbl-treemap-tile")) {
    const x = Number(rect.getAttribute("x"));
    const col = [x + TM_GEOM.pad, x + Number(rect.getAttribute("width")) - TM_GEOM.pad];
    for (const el of rect.parentElement!.querySelectorAll("text, tspan")) el.setAttribute("data-col", col.join(" "));
  }
  for (const [i, el] of lines.entries()) el.setAttribute("data-line", String(i));
  const page = await browser.newPage();
  try {
    await page.setContent(`<style>${FIGTREE_FONT_FACE}</style><body style="margin:0">${svg.outerHTML}</body>`);
    return await page.evaluate(async () => {
      await document.fonts.load("500 12px Figtree");
      await document.fonts.load("700 12px Figtree");
      await document.fonts.ready;
      return [...document.querySelectorAll<SVGTextContentElement>("[data-line]")].map((el) => {
        // The line's advance extent (what the layout reasons in), from its anchor and drawn length; a
        // tspan with no x of its own starts where the text before it ended.
        const drawn = el.getComputedTextLength();
        let x0 = el.getNumberOfChars() ? el.getStartPositionOfChar(0).x : 0;
        if (el.hasAttribute("x")) {
          const x = Number(el.getAttribute("x"));
          const anchor = el.closest("[text-anchor]")?.getAttribute("text-anchor") ?? "start";
          x0 = anchor === "middle" ? x - drawn / 2 : anchor === "end" ? x - drawn : x;
        }
        const col = el.getAttribute("data-col")?.split(" ").map(Number) as [number, number] | undefined;
        return { text: el.textContent ?? "", est: Number(el.getAttribute("data-est")), drawn, x0, x1: x0 + drawn, col: col ?? null };
      });
    });
  } finally {
    await page.close();
  }
}

/** Half a pixel of rounding (r2 coordinates, sub-pixel glyph positioning). */
const EPS = 0.5;

/** Every line draws no wider than its estimate and inside its column and the chart. */
function expectContained(drawn: Drawn[], width: number): void {
  for (const d of drawn) {
    expect(d.drawn, `${d.text} drawn vs estimated`).toBeLessThanOrEqual(d.est + EPS);
    expect(d.x0, d.text).toBeGreaterThanOrEqual(-EPS);
    expect(d.x1, d.text).toBeLessThanOrEqual(width + EPS);
    if (d.col) {
      expect(d.x0, `${d.text} in its column`).toBeGreaterThanOrEqual(d.col[0] - EPS);
      expect(d.x1, `${d.text} in its column`).toBeLessThanOrEqual(d.col[1] + EPS);
    }
  }
}

const TIMELINE = {
  chartType: "timeline", title: "Хронология", xAxisType: "temporal", data: "d.csv",
  columns: { x: "date", label: "title", description: "detail" },
} as ChartSpec;
const TIMELINE_ROWS = [
  { date: "2017", title: "Закон о снижении налогов и создании рабочих мест", detail: "Федеральный бюджет" },
  { date: "2018", title: "ω".repeat(30), detail: "Щ".repeat(30) },
  { date: "2020", title: "ГОСУДАРСТВЕННЫЙБЮДЖЕТНАЛОГОВАЯРЕФОРМА", detail: "" },
  { date: "2022", title: "Κρατικός προϋπολογισμός ΦΟΡΟΛΟΓΙΚΗ ΜΕΤΑΡΡΥΘΜΙΣΗ", detail: "Υπουργείο Οικονομικών" },
  { date: "2024", title: "Рост ВВП в США 🇺🇸🇬🇧👍🏽👨‍👩‍👧", detail: "МВФ ЖКХ НДС" },
  { date: "2025", title: "சென்னை கோயம்புத்தூர் மதுரை திருச்சிராப்பள்ளி சேலம் திருநெல்வேலி", detail: "തിരുവനന്തപുരം".repeat(3) },
  { date: "2026", title: "Щедрыйвечерщедрыйвечерщедрыйвечер", detail: "කොළඹ ගාල්ල මහනුවර යාපනය ත්‍රිකුණාමලය" },
] as TidyRow[];

const TREEMAP = {
  chartType: "treemap", title: "Расходы", xAxisType: "categorical", data: "d.csv",
  columns: { x: "category", value: "amount" },
} as ChartSpec;
const TREEMAP_ROWS = ([
  ["Министерство обороны", 900], ["Здравоохранение", 640], ["Социальное обеспечение", 520],
  ["Образование", 380], ["Жилищное хозяйство", 300], ["Υπουργείο Οικονομικών", 260], ["ΦΟΡΟΛΟΓΙΑ", 200],
  ["Щедрый вечер", 170], ["ωωωωωωωω", 160], ["США 🇺🇸", 140], ["Москва", 120], ["சென்னை", 110], ["ЖКХ", 100], ["Αθήνα", 90], ["Київ", 70],
] as const).map(([category, amount]) => ({ category, amount: String(amount) }) as TidyRow);

describe.skipIf(!HAS_BROWSER)("scripts Figtree lacks stay in their column as Chromium draws them (F5, Ruling 51)", () => {
  it.each([
    ["vertical", 280], ["vertical", 375], ["horizontal", 600], ["horizontal", 900],
  ] as const)("timeline %s at %ipx: every line inside its column", async (orientation, width) => {
    const { svg } = renderChart(TIMELINE, TIMELINE_ROWS, { width, timelineOrientation: orientation });
    const drawn = await drawnLines(svg);
    expect(drawn.filter((d) => d.col).length).toBeGreaterThan(10);
    // The ω and Щ runs and the Malayalam word, hard-broken where the column is narrow: lines that
    // fill it.
    expect(drawn.filter((d) => /^[ωЩ]+$/.test(d.text)).length).toBeGreaterThanOrEqual(2);
    expectContained(drawn, Number(svg.getAttribute("width")));
  });

  it.each([375, 720, 920])("treemap at %ipx: every label inside its tile's padded box", async (width) => {
    const { svg } = renderChart(TREEMAP, TREEMAP_ROWS, { width });
    const drawn = await drawnLines(svg);
    expect(drawn.filter((d) => d.col).length).toBeGreaterThan(3);
    expectContained(drawn, Number(svg.getAttribute("width")));
  });
});
