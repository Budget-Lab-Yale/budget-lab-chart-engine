import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:5200";
const SHOT = process.argv[2];
mkdirSync(SHOT, { recursive: true });
const url = (d) => `${BASE}/chart/${d}/chart.yaml`;
const results = [];
const pass = (n, c, d = "") => results.push({ n, ok: !!c, d });

const browser = await chromium.launch();
const page = await (await browser.newContext({ deviceScaleFactor: 2 })).newPage();

async function load(route, w = 1100, h = 780) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(url(route), { waitUntil: "networkidle" });
  await page.waitForSelector('g[aria-label="rect"] rect', { state: "attached", timeout: 15000 });
  await page.waitForTimeout(500);
}

// #1 TRANSPARENCY: single-series now translucent
await load("01-auto-single");
let ops = await page.$$eval('g[aria-label="rect"] rect', (rs) => Array.from(new Set(rs.map((r) => Number(r.getAttribute("fill-opacity") ?? "1")))));
pass("#1 single-series bars are translucent (fill-opacity < 1)", ops.length && ops.every((o) => o < 1), `ops=${ops}`);
let hasStroke = await page.$$eval('g[aria-label="rect"] rect', (rs) => rs.some((r) => { const s = r.getAttribute("stroke"); return s && s !== "none"; }));
pass("#1 single-series bars have a stroke (crisp edges)", hasStroke);
await page.screenshot({ path: `${SHOT}/v2-01-transparency.png`, fullPage: true });

// #3 NO DOUBLED AXIS LABELS on temporal (06, 07): no two <text> with same content at ~same x/y
async function dupLabels(route) {
  await load(route);
  return page.evaluate(() => {
    const texts = Array.from(document.querySelectorAll("svg text")).map((t) => ({
      s: (t.textContent || "").trim(),
      x: t.getBoundingClientRect().x, y: t.getBoundingClientRect().y,
    })).filter((t) => t.s);
    let dups = 0;
    for (let i = 0; i < texts.length; i++)
      for (let j = i + 1; j < texts.length; j++)
        if (texts[i].s === texts[j].s && Math.abs(texts[i].x - texts[j].x) < 4 && Math.abs(texts[i].y - texts[j].y) < 6) dups++;
    return dups;
  });
}
for (const r of ["06-temporal-month", "07-temporal-quarter"]) {
  const d = await dupLabels(r);
  pass(`#3 ${r}: no overlapping duplicate axis labels`, d === 0, `dupPairs=${d}`);
  await page.screenshot({ path: `${SHOT}/v2-${r}.png`, fullPage: true });
}

// #2 HOVER works: move over the plot, a tooltip with a bin range appears
async function hoverCheck(route) {
  await load(route);
  const hit = await page.$(".tbl-hist-hover-hit");
  if (!hit) return { wired: false };
  const box = await hit.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6);
  await page.waitForTimeout(250);
  const tip = await page.evaluate(() => {
    const t = document.querySelector(".tbl-tooltip");
    if (!t) return null;
    const vis = getComputedStyle(t).opacity !== "0" && t.offsetParent !== null;
    return { text: (t.textContent || "").trim(), vis };
  });
  const hlW = await page.evaluate(() => { const h = document.querySelector(".tbl-hist-hover-hl"); return h ? Number(h.getAttribute("width")) : 0; });
  return { wired: true, tip, hlW };
}
{
  const h = await hoverCheck("01-auto-single");
  pass("#2 hover: hit layer wired (single)", h.wired);
  pass("#2 hover: tooltip appears with a bin range [x0,x1)", h.tip?.vis && /\[.*,.*\)/.test(h.tip.text), JSON.stringify(h.tip));
  pass("#2 hover: bin highlight rect shown", h.hlW > 0, `hlW=${h.hlW}`);
  await page.screenshot({ path: `${SHOT}/v2-hover-single.png`, fullPage: true });
}
{
  const h = await hoverCheck("04-overlap-density");
  pass("#2 hover: multi-series tooltip lists series", h.tip?.vis && /A|B|C/.test(h.tip.text), JSON.stringify(h.tip));
  await page.screenshot({ path: `${SHOT}/v2-hover-multi.png`, fullPage: true });
}
{
  const h = await hoverCheck("06-temporal-month");
  pass("#2 hover: temporal tooltip shows a date range (4-digit year, no epoch ms)", h.tip?.vis && /\d{4}/.test(h.tip.text) && !/\d{10,}/.test(h.tip.text), JSON.stringify(h.tip));
}

// #4 FACETED + OVERLAPPING (13): multiple panes, each 2 series groups, translucent
await load("13-faceted-overlap");
const fo = await page.evaluate(() => {
  const panes = Array.from(document.querySelectorAll(".figure-pane, .figure-canvas svg"));
  // count rect groups per pane
  const groupsPerPane = panes.map((p) => p.querySelectorAll('g[aria-label="rect"]').length);
  const rects = Array.from(document.querySelectorAll('g[aria-label="rect"] rect'));
  const ops = Array.from(new Set(rects.map((r) => Number(r.getAttribute("fill-opacity") ?? "1"))));
  const fills = Array.from(new Set(rects.map((r) => r.getAttribute("fill"))));
  return { paneCount: panes.length, groupsPerPane, ops, fillCount: fills.length };
});
pass("#4 faceted+overlap: multiple panes", fo.paneCount >= 3, `panes=${fo.paneCount}`);
pass("#4 faceted+overlap: each pane has 2 series groups", fo.groupsPerPane.filter((g) => g === 2).length >= 3, `groupsPerPane=${fo.groupsPerPane}`);
pass("#4 faceted+overlap: translucent", fo.ops.every((o) => o < 1), `ops=${fo.ops}`);
pass("#4 faceted+overlap: 2 pinned colors across panes", fo.fillCount === 2, `fills=${fo.fillCount}`);
await page.screenshot({ path: `${SHOT}/v2-13-faceted-overlap.png`, fullPage: true });

await browser.close();
let allOk = true;
for (const r of results) { if (!r.ok) allOk = false; console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.n}${r.d ? "  [" + r.d + "]" : ""}`); }
console.log(`\n${allOk ? "ALL PASS" : "SOME FAILED"} (${results.filter((r) => r.ok).length}/${results.length})`);
process.exit(allOk ? 0 : 1);
