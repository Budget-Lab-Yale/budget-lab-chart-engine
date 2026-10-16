// Table footnote markers, live and in the PNG, measured in one real Chromium page with Figtree
// loaded: the footnote list's marker and a body cell's marker.
//
// Live, the list draws `<sup>marker</sup> text` (fillFootnoteListHtml); that <sup> takes the UA style
// (font-size: smaller, vertical-align: super) under the list's 11 px type. A cell draws
// `value<sup>marker</sup>`, styled by `.tbl-table sup` (0.7em, vertical-align: super) under 13 px.
// The PNG must draw each marker at the same size, raised by the same amount, against the same text,
// in both PNG layouts and with math in the text. The PNG is read from the export SVG laid out inline,
// which is the layout Chromium rasterises (`baseline-shift` included).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Browser, Page } from "playwright";
import { EXPORT_BUNDLE_PATH } from "../setup/global-build";
import { CHART_CSS } from "../../src/embed/styles";
import { FIGTREE_FONT_FACE } from "../../src/embed/assets";
import type { TableSpec } from "../../src/spec/table-types";
import type { TidyRow } from "../../src/data/index";
import { HAS_BROWSER, launchBrowser, closeBrowser, CLOSE_HOOK_TIMEOUT_MS } from "../helpers/browser";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const MATH = "Elasticity \\(\\sigma_{ai}\\) held fixed.";
const base: TableSpec = {
  title: "Footnotes", data: "inline", stub: [{ label: "row" }], header: ["per"], value: "value",
  format: { default: { decimals: 1 } },
};
const rows = (panes: string[] = [""]): TidyRow[] =>
  panes.flatMap((section) => ["Alpha", "Beta"].flatMap((row, i) => ["2026", "2027"].map((per, j) => ({
    row, per, section, value: String(1 + i + j),
  })))) as unknown as TidyRow[];

let browser: Browser;
beforeAll(async () => {
  if (HAS_BROWSER) browser = await launchBrowser();
}, 60_000);
afterAll(() => closeBrowser(browser), CLOSE_HOOK_TIMEOUT_MS);

/** A marker's font size, how far its baseline sits above its text's, its advance width, and the
 *  gap between it and the text beside it. */
type Geometry = { size: number; rise: number; advance: number; gap: number };

/** A page with the live table mounted and the export SVG laid out inline below it. */
async function open(spec: TableSpec, rs: TidyRow[]): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 760, height: 900 } });
  await page.setContent(
    `<!doctype html><html><head><style>${FIGTREE_FONT_FACE}\n${CHART_CSS}</style></head>` +
      `<body style="margin:0;padding:20px"><div id="t" style="width:700px"></div>` +
      `<script>${readFileSync(EXPORT_BUNDLE_PATH, "utf8")}</script></body></html>`,
    { waitUntil: "load" },
  );
  await page.evaluate(async ({ spec, rows }) => {
    await document.fonts.load("500 11px Figtree");
    const w = window as unknown as { BudgetLabExport: {
      mountTable: (el: Element, opts: unknown) => void;
      buildTableExportSvg: (spec: unknown, rows: unknown) => SVGSVGElement;
    } };
    w.BudgetLabExport.mountTable(document.getElementById("t")!, { spec, rows, width: 700 });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    document.body.appendChild(w.BudgetLabExport.buildTableExportSvg(spec, rows));
    await document.fonts.ready;
  }, { spec, rows: rs });
  return page;
}

/** The first footnote's marker in the live list and in the PNG list (the marker leads the line). */
async function listMarker(spec: TableSpec, rs: TidyRow[]): Promise<{ live: Geometry; png: Geometry }> {
  const page = await open(spec, rs);
  try {
    return await page.evaluate(() => {
      // Live: zero-size inline blocks sit on the baseline of whatever contains them.
      const sup = document.querySelector(".tbl-table-footnotes > div > sup") as HTMLElement;
      const probe = () => Object.assign(document.createElement("span"), { style: "display:inline-block;width:0;height:0" });
      const inSup = sup.appendChild(probe());
      const after = sup.parentElement!.insertBefore(probe(), sup.nextSibling);
      const supBox = sup.getBoundingClientRect();
      const live = {
        size: parseFloat(getComputedStyle(sup).fontSize),
        rise: after.getBoundingClientRect().bottom - inSup.getBoundingClientRect().bottom,
        advance: supBox.width,
        gap: after.getBoundingClientRect().left - supBox.right,
      };
      const text = document.querySelector("svg g.tbl-table-footnotes > text, svg g.tbl-figure-footnotes > text") as SVGTextContentElement;
      const m0 = text.getStartPositionOfChar(0);
      const m1 = text.getEndPositionOfChar(0);
      const t0 = text.getStartPositionOfChar(1); // the space before the text
      // The node drawing the first character: a marker <tspan>, or the <text>'s own text node.
      const first = text.firstChild!;
      const holder = first.nodeType === Node.TEXT_NODE ? text : (first as Element);
      const png = { size: parseFloat(getComputedStyle(holder).fontSize), rise: t0.y - m0.y, advance: m1.x - m0.x, gap: t0.x - m1.x };
      return { live, png };
    });
  } finally {
    await page.close();
  }
}

/** The marker on the body cell whose text (marker included) is `cellText`, live and in the PNG
 *  (the marker ends the cell). */
async function cellMarker(spec: TableSpec, rs: TidyRow[], cellText: string): Promise<{ live: Geometry; png: Geometry }> {
  const page = await open(spec, rs);
  try {
    return await page.evaluate((cellText) => {
      const td = Array.from(document.querySelectorAll("table.tbl-table td")).find((c) => c.textContent === cellText)!;
      const sup = Array.from(td.querySelectorAll("sup")).find((s) => !s.classList.contains("tbl-math")) as HTMLElement;
      const probe = () => Object.assign(document.createElement("span"), { style: "display:inline-block;width:0;height:0" });
      const inSup = sup.appendChild(probe());
      const before = sup.parentElement!.insertBefore(probe(), sup);
      const supBox = sup.getBoundingClientRect();
      const live = {
        size: parseFloat(getComputedStyle(sup).fontSize),
        rise: before.getBoundingClientRect().bottom - inSup.getBoundingClientRect().bottom,
        advance: supBox.width,
        gap: supBox.left - before.getBoundingClientRect().left,
      };
      const text = Array.from(document.querySelectorAll("svg g.tbl-table-cell > text"))
        .find((t) => t.textContent === cellText) as SVGTextContentElement;
      const n = text.getNumberOfChars();
      const m0 = text.getStartPositionOfChar(n - 1);
      const m1 = text.getEndPositionOfChar(n - 1);
      const prevEnd = text.getEndPositionOfChar(n - 2);
      const png = {
        size: parseFloat(getComputedStyle(text.lastElementChild!).fontSize),
        rise: Number(text.getAttribute("y")) - m0.y,
        advance: m1.x - m0.x,
        gap: m0.x - prevEnd.x,
      };
      return { live, png };
    }, cellText);
  } finally {
    await page.close();
  }
}

function expectSame(live: Geometry, png: Geometry, gapTolerance = 0.1): void {
  expect(live.rise).toBeGreaterThan(3); // the live marker is raised: the probe works
  expect(png.size).toBeCloseTo(live.size, 2);
  expect(png.rise).toBeCloseTo(live.rise, 1);
  // Live box widths snap to 1/64 px layout units.
  expect(Math.abs(png.advance - live.advance)).toBeLessThan(0.05);
  expect(Math.abs(png.gap - live.gap)).toBeLessThan(gapTolerance);
}

describe.skipIf(!HAS_BROWSER)("footnote list marker: the PNG draws it as the live <sup>", () => {
  for (const [name, spec, rs] of [
    ["single-pane", { ...base, footnotes: { a: "Phased in over two years." } }, rows()],
    ["single-pane, math", { ...base, footnotes: { a: MATH } }, rows()],
    ["multi-pane", { ...base, pane: "section", footnotes: { a: "Phased in over two years." } }, rows(["One", "Two"])],
    ["multi-pane, math", { ...base, pane: "section", footnotes: { a: MATH } }, rows(["One", "Two"])],
  ] as Array<[string, TableSpec, TidyRow[]]>) {
    it(`${name}: same size, rise and weight, text directly after`, async () => {
      const { live, png } = await listMarker(spec, rs);
      expectSame(live, png);
    });
  }
});

describe.skipIf(!HAS_BROWSER)("body cell footnote marker: the PNG draws it as the live <sup>", () => {
  const spec: TableSpec = {
    title: "Provisions", data: "inline", stub: [{ label: "row" }], header: ["col"], value: "value",
    format: { default: { decimals: 1 } },
    footnote_column: "fn", footnotes: { a: "Phased in.", b: "Estimate." },
  };
  const rs = [
    { row: "Expands credit", col: "Enacted", value: "Yes", fn: "a" },
    { row: "Expands credit", col: "Cost", value: "3", fn: "b" },
    { row: "Raises rate", col: "Enacted", value: "Held \\(\\sigma_{ai}\\)", fn: "a" },
    { row: "Raises rate", col: "Cost", value: "-1.2", fn: "" },
  ] as unknown as TidyRow[];
  for (const [name, cellText] of [
    ["text cell", "Yesa"],
    ["numeric cell", "3.0b"],
    ["text cell with math", "Held σaia"],
  ] as Array<[string, string]>) {
    it(`${name}: same size and rise, directly after the value`, async () => {
      const { live, png } = await cellMarker(spec, rs, cellText);
      // After math the PNG places the marker at the measured width of the rich text.
      expectSame(live, png, name.includes("math") ? 0.5 : 0.1);
    });
  }
});
