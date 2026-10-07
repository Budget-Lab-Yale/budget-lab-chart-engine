// @vitest-environment jsdom
//
// F5 / Ruling 51: text the calibrated Figtree table does not cover (Cyrillic, Greek, other scripts,
// emoji clusters) stays inside its column as Chromium actually draws it. The layout places every
// line by timelineTextWidth, so a jsdom assertion on the layout's own boxes would only check the
// estimate against itself; this renders the timeline and treemap SVGs in headless Chromium with the
// embedded Figtree and reads each line's real width and box. Whichever system font draws the
// scripts on the machine running it (Segoe UI on Windows; Liberation, DejaVu, FreeFont or Unifont
// in the CI Playwright image), no line may draw wider than its estimate, nor past its column.
//
// Latin lines (every character in the Figtree table) are held to the table, as Chromium positions
// glyphs on the machine running it, which each page probes first (`positioning`): Chromium on
// Windows places glyphs at sub-pixel advances, so a line draws within EPS of the table's sum; Linux
// Chromium at device scale 1, the CI image, rounds each glyph's advance to a whole pixel, so a line
// draws to the sum of those rounded advances (`wholePixelWidth`), up to half a pixel per glyph wider
// than the table's ("2022" in 13px bold: 32px against 31.005). Script lines keep the strict bound on
// both. The probe also proves the embedded Figtree is the face drawing Latin text: a fallback face
// matches neither the table's advances nor their rounding, and fails the suite loudly.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { existsSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import { renderChart } from "../src/engine/index";
import { FIGTREE_FONT_FACE } from "../src/embed/assets";
import { TM_GEOM } from "../src/engine/treemap-layout";
import { timelineTextWidth } from "../src/engine/timeline-text";
import { FIGTREE_ADVANCE, FIGTREE_CHARS } from "../src/engine/timeline-metrics";
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
 *  for it; `estWhole` the width it draws at whole-pixel positioning (wholePixelWidth), for a line of
 *  table characters only; `col` the column it was laid out in (a timeline label's box: the union of
 *  its lines' estimated extents; a treemap tile's padded box), when it has one. */
interface Drawn { text: string; est: number; estWhole: number | null; drawn: number; x0: number; x1: number; col: [number, number] | null }

/** How the page's Chromium positions glyphs (see the header). */
type Positioning = "sub-pixel" | "whole-pixel";

/** Figtree's table advance of `ch`, in px, or undefined for a character outside the table. */
const figtreeAdvance = (ch: string, size: number, weight: 500 | 700): number | undefined => {
  const i = [...FIGTREE_CHARS].indexOf(ch);
  return i < 0 ? undefined : (FIGTREE_ADVANCE[weight][i]! * size) / 1000;
};

/** A line of table characters as Chromium draws it with whole-pixel glyph positioning: each
 *  advance rounded to the nearest pixel. The table holds whole thousandths of an em (±0.007px at
 *  14px), so an advance within that of a half-pixel tie is taken as rounding up. Null if any
 *  character is outside the table: script and emoji lines keep the strict bound. */
function wholePixelWidth(text: string, size: number, weight: 500 | 700): number | null {
  let w = 0;
  for (const ch of text) {
    const a = figtreeAdvance(ch, size, weight);
    if (a === undefined) return null;
    w += Math.round(a + 0.01);
  }
  return w;
}

/** The single glyphs each page draws first: every character of PROBE_CHARS at the sizes and weights
 *  the timeline and treemap draw, kept where the table's advance is at least 0.1px from a whole and
 *  from a half pixel, so sub-pixel and whole-pixel positioning predict different widths. One glyph
 *  at a time, so kerning never enters. */
const PROBE_CHARS = "abegmnorsw0234689%";
const PROBES = [12, 13, 14].flatMap((size) => ([500, 700] as const).flatMap((weight) =>
  [...PROBE_CHARS].map((ch) => ({ ch, size, weight, est: figtreeAdvance(ch, size, weight)! })),
)).filter(({ est }) => {
  const f = est - Math.floor(est);
  return f >= 0.1 && f <= 0.9 && Math.abs(f - 0.5) >= 0.1;
});

/** The page's glyph positioning, read from PROBES as drawn; fails loudly unless the embedded Figtree
 *  loaded and is the face drawing them. `faces` counts the loaded Figtree faces document.fonts.load
 *  returned for 500 and for 700 (an unknown family resolves to none: document.fonts.check would
 *  report true then, so it proves nothing). A fallback face draws the probes neither at the table's
 *  advances (within 0.05px, the table's own precision against Chromium) nor at them rounded. */
function positioning(faces: number[], probes: number[]): Positioning {
  expect(faces, "the embedded Figtree must load (500 and 700) before any line is measured").toEqual([1, 1]);
  expect(PROBES.length).toBeGreaterThanOrEqual(30);
  const all = (ok: (drawn: number, est: number) => boolean) => PROBES.every((p, i) => ok(probes[i]!, p.est));
  if (all((drawn, est) => Math.abs(drawn - est) <= 0.05)) return "sub-pixel";
  if (all((drawn, est) => Math.abs(drawn - Math.round(est)) <= 0.01)) return "whole-pixel";
  const off = PROBES.map((p, i) => `${p.ch} ${p.size}px ${p.weight}: drawn ${probes[i]}, table ${p.est.toFixed(3)}`);
  throw new Error(
    "Figtree is not the face drawing Latin text in this page, or this Chromium positions glyphs neither " +
      "sub-pixel nor on whole pixels: single glyphs draw neither at the table's advances nor at them " +
      `rounded.\n${off.join("\n")}`,
  );
}

/** The attribute `name` on `el` or its nearest ancestor that has it. */
const inherited = (el: Element, name: string): string | null => el.closest(`[${name}]`)?.getAttribute(name) ?? null;

/** Every line of `svg` as Chromium draws it, and the page's glyph positioning. Estimates and
 *  columns are computed here, from the markup, and carried to the page as data attributes. */
async function drawnLines(svg: SVGSVGElement): Promise<{ drawn: Drawn[]; mode: Positioning }> {
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
    const whole = wholePixelWidth(el.textContent ?? "", size, weight);
    if (whole !== null) el.setAttribute("data-est-whole", String(whole));
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
    const { faces, probes, drawn } = await page.evaluate(async (probeSpecs) => {
      const isFigtree = (f: FontFace) => f.family.replace(/["']/g, "") === "Figtree" && f.status === "loaded";
      const faces = [
        (await document.fonts.load("500 12px Figtree")).filter(isFigtree).length,
        (await document.fonts.load("700 12px Figtree")).filter(isFigtree).length,
      ];
      await document.fonts.ready;
      // The probes in the chart's own font stack, in a second SVG after the chart's.
      const ns = "http://www.w3.org/2000/svg";
      const probeSvg = document.createElementNS(ns, "svg");
      probeSvg.setAttribute("font-family", document.querySelector("svg")!.getAttribute("font-family")!);
      document.body.append(probeSvg);
      const probes = probeSpecs.map(({ ch, size, weight }) => {
        const t = document.createElementNS(ns, "text");
        t.setAttribute("font-size", String(size));
        t.setAttribute("font-weight", String(weight));
        t.textContent = ch;
        probeSvg.append(t);
        return t.getComputedTextLength();
      });
      const drawn = [...document.querySelectorAll<SVGTextContentElement>("[data-line]")].map((el) => {
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
        const whole = el.getAttribute("data-est-whole");
        return {
          text: el.textContent ?? "", est: Number(el.getAttribute("data-est")), estWhole: whole === null ? null : Number(whole),
          drawn, x0, x1: x0 + drawn, col: col ?? null,
        };
      });
      return { faces, probes, drawn };
    }, PROBES);
    return { drawn, mode: positioning(faces, probes) };
  } finally {
    await page.close();
  }
}

/** Half a pixel of rounding (r2 coordinates, sub-pixel glyph positioning). */
const EPS = 0.5;

/** Every line draws no wider than its estimate and inside its column and the chart. A line of
 *  table characters, under whole-pixel positioning, may draw to its rounded width instead
 *  (wholePixelWidth), and past its column and the chart by that much more; nothing else is
 *  loosened. Soft assertions, so a failing run lists every line out of bounds, not the first. */
function expectContained({ drawn, mode }: { drawn: Drawn[]; mode: Positioning }, width: number): void {
  for (const d of drawn) {
    const bound = mode === "whole-pixel" && d.estWhole !== null ? Math.max(d.est, d.estWhole) : d.est;
    const slack = bound - d.est + EPS;
    expect.soft(d.drawn, `${d.text} drawn vs estimated (${mode})`).toBeLessThanOrEqual(bound + EPS);
    expect.soft(d.x0, d.text).toBeGreaterThanOrEqual(-slack);
    expect.soft(d.x1, d.text).toBeLessThanOrEqual(width + slack);
    if (d.col) {
      expect.soft(d.x0, `${d.text} in its column`).toBeGreaterThanOrEqual(d.col[0] - slack);
      expect.soft(d.x1, `${d.text} in its column`).toBeLessThanOrEqual(d.col[1] + slack);
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
    const lines = await drawnLines(svg);
    const { drawn } = lines;
    expect(drawn.filter((d) => d.col).length).toBeGreaterThan(10);
    // The ω and Щ runs and the Malayalam word, hard-broken where the column is narrow: lines that
    // fill it.
    expect(drawn.filter((d) => /^[ωЩ]+$/.test(d.text)).length).toBeGreaterThanOrEqual(2);
    expectContained(lines, Number(svg.getAttribute("width")));
  });

  it.each([375, 720, 920])("treemap at %ipx: every label inside its tile's padded box", async (width) => {
    const { svg } = renderChart(TREEMAP, TREEMAP_ROWS, { width });
    const lines = await drawnLines(svg);
    expect(lines.drawn.filter((d) => d.col).length).toBeGreaterThan(3);
    expectContained(lines, Number(svg.getAttribute("width")));
  });
});
