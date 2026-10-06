#!/usr/bin/env node
/**
 * gen-script-metrics.mjs — measure Cyrillic and Greek letters in the system fonts that draw them
 * when Figtree cannot, and write src/engine/script-metrics.ts: for each letter, at the two weights
 * a timeline draws (500, 700), the WIDEST advance any of the given faces has for it. timelineTextWidth
 * (src/engine/timeline-text.ts) sums that table for those letters, so no letter measures short of
 * any measured font, whichever one a reader's browser falls back to.
 *
 * Usage, one argument per font file, `Family:weight=path` (weight a number, or "min max" for a
 * variable font):
 *   node scripts/gen-script-metrics.mjs "Arial:400=C:/Windows/Fonts/arial.ttf" \
 *     "Arial:700=C:/Windows/Fonts/arialbd.ttf" "Noto Sans:100 900=fonts/NotoSans[wdth,wght].ttf" ...
 * The set used for the committed table is listed in its header. Each face is loaded into headless
 * Chromium as a FontFace and every letter it maps (read from its cmap) is measured with canvas
 * measureText at 1000px, so the table is in thousandths of an em; at each weight a family is
 * measured with the face CSS font matching picks for it (500 takes a 400 face where there is no
 * 500). Run by hand (needs playwright's Chromium); it is not part of the build or the tests.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const OUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src/engine/script-metrics.ts");
const WEIGHTS = [500, 700];
/** Greek and Coptic, Cyrillic, Cyrillic Supplement, Cyrillic Extended-C, Greek Extended, Cyrillic
 *  Extended-B. (Cyrillic Extended-A, U+2DE0–2DFF, is all combining marks, which the table leaves out.) */
const BLOCKS = [[0x0370, 0x03ff], [0x0400, 0x052f], [0x1c80, 0x1c8f], [0x1f00, 0x1fff], [0xa640, 0xa69f]];

/** The code points a TrueType/OpenType font maps (cmap format 4 or 12, Unicode subtables). */
function cmapCodePoints(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const numTables = dv.getUint16(4);
  let cmap = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + 16 * i;
    if (String.fromCharCode(...buf.subarray(rec, rec + 4)) === "cmap") cmap = dv.getUint32(rec + 8);
  }
  if (cmap < 0) throw new Error("no cmap table");
  const out = new Set();
  const n = dv.getUint16(cmap + 2);
  for (let i = 0; i < n; i++) {
    const platform = dv.getUint16(cmap + 4 + 8 * i);
    const encoding = dv.getUint16(cmap + 6 + 8 * i);
    if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue;
    const st = cmap + dv.getUint32(cmap + 8 + 8 * i);
    const format = dv.getUint16(st);
    if (format === 4) {
      const segX2 = dv.getUint16(st + 6);
      const ends = st + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const offsets = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = dv.getUint16(ends + 2 * s);
        const start = dv.getUint16(starts + 2 * s);
        const delta = dv.getUint16(deltas + 2 * s);
        const ro = dv.getUint16(offsets + 2 * s);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          const glyph = ro === 0 ? (c + delta) & 0xffff : dv.getUint16(offsets + 2 * s + ro + 2 * (c - start));
          if (glyph !== 0) out.add(c);
        }
      }
    } else if (format === 12) {
      const groups = dv.getUint32(st + 12);
      for (let g = 0; g < groups; g++) {
        const start = dv.getUint32(st + 16 + 12 * g);
        const end = dv.getUint32(st + 20 + 12 * g);
        for (let c = start; c <= end; c++) out.add(c);
      }
    }
  }
  return out;
}

/** The face CSS font matching picks from `faces` (one family) for `weight`. */
function matchFace(faces, weight) {
  const exact = faces.find((f) => f.lo <= weight && weight <= f.hi);
  if (exact) return exact;
  const below = faces.filter((f) => f.hi < weight).sort((a, b) => b.hi - a.hi);
  const above = faces.filter((f) => f.lo > weight).sort((a, b) => a.lo - b.lo);
  // CSS Fonts 4 §5.2: a desired weight of 400-500 looks up to 500, then down, then up; above 500, up then down.
  return weight <= 500 ? (below[0] ?? above[0]) : (above[0] ?? below[0]);
}

const args = process.argv.slice(2);
if (!args.length) throw new Error("usage: gen-script-metrics.mjs Family:weight=path ...");
const families = new Map();
for (const arg of args) {
  const m = /^([^:]+):([\d ]+)=(.+)$/.exec(arg);
  if (!m) throw new Error(`bad argument ${arg}`);
  const [lo, hi = lo] = m[2].trim().split(/\s+/).map(Number);
  const buf = await readFile(m[3]);
  const face = { family: m[1], lo, hi, weight: m[2].trim(), b64: buf.toString("base64"), cps: cmapCodePoints(buf) };
  families.set(m[1], [...(families.get(m[1]) ?? []), face]);
}

const letters = [];
for (const [a, b] of BLOCKS) {
  for (let cp = a; cp <= b; cp++) {
    const ch = String.fromCodePoint(cp);
    if (/\p{M}|\p{Cn}/u.test(ch)) continue; // combining marks and unassigned code points
    if ([...families.values()].some((faces) => faces.some((f) => f.cps.has(cp)))) letters.push(ch);
  }
}

// Per weight and letter, the faces that would draw it: each family's matched face, if it maps it.
const allFaces = [...families.values()].flat();
const jobs = WEIGHTS.flatMap((w) => [...families.values()].map((faces) => {
  const face = matchFace(faces, w);
  return { w, idx: allFaces.indexOf(face), chars: letters.filter((ch) => face.cps.has(ch.codePointAt(0))) };
}));

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const faces = allFaces.map(({ weight, b64 }) => ({ weight, b64 }));
  const widths = await page.evaluate(async ({ faces, jobs }) => {
    // Each face under its own family name, so a measurement can only come from that file (every
    // letter measured is one its cmap maps).
    for (const [i, f] of faces.entries()) {
      const face = new FontFace(`M${i}`, Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0)), { weight: f.weight });
      await face.load();
      document.fonts.add(face);
    }
    const ctx = document.createElement("canvas").getContext("2d");
    return jobs.map(({ w, idx, chars }) => {
      ctx.font = `${w} 1000px M${idx}`;
      return Object.fromEntries(chars.map((ch) => [ch, ctx.measureText(ch).width]));
    });
  }, { faces, jobs });

  const max = Object.fromEntries(WEIGHTS.map((w) => [w, new Map()]));
  jobs.forEach((job, j) => {
    for (const [ch, px] of Object.entries(widths[j])) max[job.w].set(ch, Math.max(max[job.w].get(ch) ?? 0, px));
  });
  // Rounded UP to 0.1, so the table is never narrower than a measured advance.
  const up = (x) => Math.ceil(x * 10 - 1e-9) / 10;
  const used = [...families.entries()].map(([fam, faces]) => `${fam} (${faces.map((f) => f.weight).join(", ")})`);
  const lines = [
    "// GENERATED by scripts/gen-script-metrics.mjs — do not edit by hand; see that script to regenerate.",
    "// Cyrillic and Greek letter advances, in thousandths of an em, at the weights a timeline draws: for",
    "// each letter the WIDEST advance among these faces (whichever maps it), measured in Chromium:",
    ...used.map((u) => `//   ${u}`),
    "",
    "/** The letters the table covers, in the order of each weight's advances. */",
    `export const SCRIPT_CHARS = ${JSON.stringify(letters.join(""))};`,
    "",
    "/** Widest measured advance per character of SCRIPT_CHARS, per 1000 em, by font weight. */",
    "export const SCRIPT_ADVANCE: Record<500 | 700, readonly number[]> = {",
    ...WEIGHTS.flatMap((w) => {
      const vals = letters.map((ch) => up(max[w].get(ch)));
      const rows = [];
      for (let i = 0; i < vals.length; i += 12) rows.push(`    ${vals.slice(i, i + 12).join(", ")},`);
      return [`  ${w}: [`, ...rows, "  ],"];
    }),
    "};",
    "",
  ];
  await writeFile(OUT_PATH, lines.join(String.fromCharCode(10)), "utf8");
  console.log(`wrote ${OUT_PATH}: ${letters.length} letters from ${families.size} families`);
} finally {
  await browser.close();
}
