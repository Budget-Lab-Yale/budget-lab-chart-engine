// @vitest-environment jsdom
//
// Table HTML <-> SVG parity. Each spec is rendered through the live path (`mountTable`, which builds
// `renderTableHtml` plus the card-level footnote list) and through the PNG export path
// (`buildTableExportSvg`, which draws `renderTableSvg` inside the export chrome). The two are then
// compared on what a reader sees:
//   1. body: each row's stub, group rows, and every cell's text, footnote marker and sign colour;
//   2. header cells: text, tier, and the leaf-column range each covers. HTML ranges come from the
//      rowspan/colspan grid; SVG ranges come from each header rect mapped back onto the layout's
//      column edges;
//   3. group labels, corner, banners and sublabels: the hard `\\` line structure, and in the SVG
//      that each drawn line's baseline lies inside its own band (row, header cell or header);
//   4. the footnote list.
//
// A case may list a known divergence in `fails` (check -> an `it.fails` title carrying the finding
// id), so the suite stays green until it is fixed. The eight finding-A10 divergences (2026-10-15 debt
// review) were fixed in phase 5 (T5.9) and are normal `it`s now; no case lists one.
//
// A leaf header the live table clamps (header_max_lines) keeps its whole label in the DOM but shows
// only N lines; the SVG draws only those, so the header check compares a clamped cell by prefix.
//
// Text measurement: getContext is stubbed to null so the live mount, the export and the layout
// recomputed here all use the same `s.length * fontPx * 0.6` fallback (src/table/measure.ts).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mountTable } from "../../src/table/mount";
import { buildTableExportSvg, tableExportLayout } from "../../src/embed/export-table-png";
import { buildTableModel } from "../../src/table/model";
import type { TableLayout } from "../../src/table/layout";
import { makeMeasureText } from "../../src/table/measure";
import { richWidth } from "../../src/table/richtext";
import { tokens } from "../../src/theme/tokens";
import type { TableSpec } from "../../src/spec/table-types";
import type { TidyRow } from "../../src/data/index";

const realGetContext = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
});

const rowsOf = (rs: Array<Record<string, string | number>>): TidyRow[] =>
  rs.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)]))) as unknown as TidyRow[];
const BS2 = "\\\\"; // the two-character `\\` hard-break token

const SIGN_POS = tokens.categorical[3]!.base;
const SIGN_NEG = tokens.categorical[4]!.base;
const PAD_X_TOTAL = 16; // layout.ts padX: horizontal padding per cell (left + right)

// ---- text extraction ---------------------------------------------------------------------------

/** Whitespace-collapse (incl. the no-break space glueMarkers inserts — both paths carry it). */
const norm = (s: string): string => s.replace(/\s+/g, " ").trim();
const words = (lines: string[]): string => norm(lines.join(" "));

/** Hard lines of an HTML subtree: text concatenated, a new line at each <br>. */
function htmlLines(root: Node, skip: (el: Element) => boolean = () => false): string[] {
  const lines = [""];
  const walk = (n: Node): void => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === 3) lines[lines.length - 1] += c.textContent ?? "";
      else if (c.nodeType === 1) {
        const el = c as Element;
        if (skip(el)) continue;
        if (el.localName === "br") lines.push("");
        else walk(el);
      }
    }
  };
  walk(root);
  return lines.map(norm);
}

interface SvgLine { text: string; y: number; fontSize: number }

/** Drawn lines of one or more SVG <text> elements, each with its baseline y. Handles the three
 *  shapes render-svg emits: plain text; `drawLines` (one <tspan dy> per line); and the rich emitter
 *  (absolute-y tspans, one baseline per `\\` line, scripts offset from it by less than half a line).
 *  A footnote superscript (<tspan class="tbl-table-fn-marker">) is returned as `marker`, not as text. */
function svgLines(texts: Element[]): { lines: SvgLine[]; marker?: string } {
  const out: SvgLine[] = [];
  let marker: string | undefined;
  for (const t of texts) {
    const baseY = Number(t.getAttribute("y"));
    const fs = Number(t.getAttribute("font-size"));
    const lineH = fs + 3; // richtext.ts renderRichSvgText lineHeight
    const local: SvgLine[] = [];
    const byIdx = new Map<number, SvgLine>();
    let cur: SvgLine | undefined;
    let curY = baseY;
    const open = (y: number): SvgLine => { const l = { text: "", y, fontSize: fs }; local.push(l); return l; };
    for (const n of Array.from(t.childNodes)) {
      if (n.nodeType === 3) { (cur ??= open(baseY)).text += n.textContent ?? ""; continue; }
      const el = n as Element;
      if (el.localName !== "tspan") continue;
      if (el.getAttribute("class") === "tbl-table-fn-marker") { marker = (marker ?? "") + (el.textContent ?? ""); continue; }
      if (el.hasAttribute("dy")) {
        curY += Number(el.getAttribute("dy"));
        cur = open(curY);
        cur.text += el.textContent ?? "";
        continue;
      }
      if (el.hasAttribute("y")) {
        const idx = Math.round((Number(el.getAttribute("y")) - baseY) / lineH);
        let ln = byIdx.get(idx);
        if (!ln) { ln = open(baseY + idx * lineH); byIdx.set(idx, ln); }
        ln.text += el.textContent ?? "";
        continue;
      }
      (cur ??= open(baseY)).text += el.textContent ?? "";
    }
    out.push(...local);
  }
  return { lines: out.map((l) => ({ ...l, text: norm(l.text) })), ...(marker != null ? { marker } : {}) };
}

const childTexts = (el: Element): Element[] => Array.from(el.children).filter((c) => c.localName === "text");
const allTexts = (el: Element): Element[] => Array.from(el.querySelectorAll("text"));

// ---- rendering both paths ----------------------------------------------------------------------

interface Rendered {
  table: HTMLTableElement;
  card: HTMLElement;
  body: Element; // the export's nested table-body <svg>
  layout: TableLayout;
}

function render(spec: TableSpec, rows: TidyRow[]): Rendered {
  const container = document.createElement("div");
  mountTable(container, { spec, rows });
  const card = container.querySelector(".figure-card") as HTMLElement;
  const table = container.querySelector("table.tbl-table") as HTMLTableElement;
  const root = buildTableExportSvg(spec, rows);
  const body = root.querySelector("g.tbl-table-header")!.parentNode as Element;
  // The layout the export drew from, recomputed by the export's own tableExportLayout (same model,
  // measurer and spec; none of these specs collapse a group), so a narrow table's stretch to the
  // frame is included. Used for column edges and band rects only; the width check below proves it
  // is the same layout.
  const layout = tableExportLayout(buildTableModel(spec, rows), spec, makeMeasureText());
  expect(Number(body.getAttribute("width"))).toBe(layout.totalWidth);
  expect(Number(body.getAttribute("height"))).toBe(layout.totalHeight);
  return { table, card, body, layout };
}

// ---- 1. body -----------------------------------------------------------------------------------

interface BodyRowDesc { kind: "group" | "row"; stub: string; cells: Array<{ desc: string; isText: boolean }> }

const cellDesc = (text: string, marker: string | undefined, sign: string | undefined): string =>
  `${text}${marker != null ? `^${marker}` : ""}${sign ? ` {${sign}}` : ""}`;

function htmlBody(r: Rendered): BodyRowDesc[] {
  return Array.from(r.table.querySelectorAll("tbody > tr")).map((tr) => {
    if (tr.classList.contains("tbl-table-group")) {
      const inner = tr.querySelector(".tbl-table-group-inner")!;
      return { kind: "group", stub: words(htmlLines(inner, (el) => el.classList.contains("tbl-table-group-note"))), cells: [] };
    }
    const stub = words(htmlLines(tr.querySelector("th.tbl-table-stub")!));
    const cells = Array.from(tr.querySelectorAll("td")).map((td) => {
      const fn = Array.from(td.children).find((c) => c.localName === "sup" && !c.classList.contains("tbl-math"));
      const text = words(htmlLines(td, (el) => el === fn));
      const sign = td.classList.contains("is-neg") ? "neg" : td.classList.contains("is-pos") ? "pos" : undefined;
      return { desc: cellDesc(text, fn?.textContent ?? undefined, sign), isText: td.classList.contains("is-text") };
    });
    return { kind: "row", stub, cells };
  });
}

function svgBody(r: Rendered): BodyRowDesc[] {
  const bodyG = r.body.querySelector("g.tbl-table-body")!;
  return Array.from(bodyG.children).map((g) => {
    if (g.classList.contains("tbl-table-group")) {
      // The label is the group's first <text>; any further texts are its note lines.
      return { kind: "group", stub: words(svgLines(childTexts(g).slice(0, 1)).lines.map((l) => l.text)), cells: [] };
    }
    const stub = words(svgLines(childTexts(g)).lines.map((l) => l.text));
    const cells = Array.from(g.querySelectorAll("g.tbl-table-cell")).map((cg) => {
      const texts = allTexts(cg);
      const { lines, marker } = svgLines(texts);
      const fill = texts[0]?.getAttribute("fill");
      const sign = fill === SIGN_NEG ? "neg" : fill === SIGN_POS ? "pos" : undefined;
      // render-svg draws text cells start-anchored at the cell's left inset (or per column_align);
      // the HTML marks them is-text. Text-ness is read from the HTML side when comparing.
      return { desc: cellDesc(words(lines.map((l) => l.text)), marker, sign), isText: false };
    });
    return { kind: "row", stub, cells };
  });
}

/** Body descriptors as flat strings. `which` selects the stub/group/numeric part or the text cells
 *  (classified by the HTML's is-text, applied to the same (row, column) on both sides). */
function bodyStrings(r: Rendered, which: "main" | "text"): { html: string[]; svg: string[] } {
  const h = htmlBody(r);
  const s = svgBody(r);
  const pick = (rows: BodyRowDesc[]): string[] =>
    rows.flatMap((row, ri) => {
      if (row.kind === "group") return which === "main" ? [`# ${row.stub}`] : [];
      const head = which === "main" ? [`r${ri} stub: ${row.stub}`] : [];
      return head.concat(row.cells.flatMap((c, ci) => {
        const isText = h[ri]?.cells[ci]?.isText === true;
        return (which === "text") === isText ? [`r${ri} c${ci}: ${c.desc}`] : [];
      }));
    });
  return { html: pick(h), svg: pick(s) };
}

// ---- 2. header ---------------------------------------------------------------------------------

interface HeaderDesc {
  tier: number; start: number; end: number; leaf: boolean;
  label: string[]; sublabel: string[];
  /** Live only: the label sits in a header_max_lines clamp. */
  clamped?: boolean;
  svg?: { rect: { x: number; y: number; w: number; h: number }; labelLines: SvgLine[]; sublabelLines: SvgLine[] };
}

function htmlHeader(r: Rendered): { cells: HeaderDesc[]; corner: string[] } {
  const trs = Array.from(r.table.querySelectorAll("thead > tr"));
  const tiers = trs.length;
  const occupied: boolean[][] = trs.map(() => []);
  const cells: HeaderDesc[] = [];
  let corner: string[] = [];
  trs.forEach((tr, t) => {
    let col = 0;
    for (const th of Array.from(tr.children) as HTMLTableCellElement[]) {
      while (occupied[t]![col]) col++;
      for (let dr = 0; dr < th.rowSpan; dr++) for (let dc = 0; dc < th.colSpan; dc++) occupied[t + dr]![col + dc] = true;
      if (th.classList.contains("tbl-table-stub-header")) {
        corner = htmlLines(th, (el) => el.localName === "button");
      } else {
        const sub = th.querySelector(".tbl-table-sublabel");
        cells.push({
          tier: t, start: col - 1, end: col - 1 + th.colSpan - 1,
          leaf: t + th.rowSpan === tiers && th.colSpan === 1,
          label: htmlLines(th, (el) => el === sub),
          sublabel: sub ? htmlLines(sub) : [],
          ...(th.querySelector(".tbl-table-header-clamp") ? { clamped: true } : {}),
        });
      }
      col += th.colSpan;
    }
  });
  return { cells, corner };
}

function svgHeader(r: Rendered): { cells: HeaderDesc[]; corner: SvgLine[] } {
  const { layout } = r;
  const headerG = r.body.querySelector("g.tbl-table-header")!;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
  const groups: Array<{ rect: Element; texts: Element[] }> = [];
  const cornerTexts: Element[] = [];
  for (const c of Array.from(headerG.children)) {
    if (c.localName === "rect" && c.classList.contains("tbl-table-header-bg")) groups.push({ rect: c, texts: [] });
    else if (c.localName === "text") {
      // The corner label is drawn at the stub's left inset; every header cell sits right of the stub.
      if (Number(c.getAttribute("x")) < layout.stubWidth) cornerTexts.push(c);
      else groups[groups.length - 1]!.texts.push(c);
    }
  }
  const cells = groups.map(({ rect, texts }) => {
    const x = Number(rect.getAttribute("x")), y = Number(rect.getAttribute("y"));
    const w = Number(rect.getAttribute("width")), h = Number(rect.getAttribute("height"));
    const start = layout.colX.findIndex((cx) => near(cx, x));
    const end = layout.colX.findIndex((cx, i) => near(cx + layout.colW[i]!, x + w));
    const tier = layout.tierY.findIndex((ty) => near(ty, y));
    const subTexts = texts.filter((t) => t.classList.contains("tbl-table-sublabel"));
    const labelLines = svgLines(texts.filter((t) => !subTexts.includes(t))).lines;
    const sublabelLines = svgLines(subTexts).lines;
    return {
      tier, start, end, leaf: near(y + h, layout.headerHeight) && start === end,
      label: labelLines.map((l) => l.text), sublabel: sublabelLines.map((l) => l.text),
      svg: { rect: { x, y, w, h }, labelLines, sublabelLines },
    };
  });
  return { cells, corner: svgLines(cornerTexts).lines };
}

/** A leaf the live table clamps (header_max_lines) shows its first N lines, the last ending in an
 *  ellipsis, while its DOM still holds the whole label. The SVG draws only what shows. For such a
 *  cell, check that the SVG text is the start of the live label and compare the rest as the label. */
function unclamp(svgCells: HeaderDesc[], htmlCells: HeaderDesc[]): HeaderDesc[] {
  return svgCells.map((c) => {
    const text = words(c.label);
    if (!c.leaf || !text.endsWith("…")) return c;
    const live = htmlCells.find((h) => h.leaf && h.start === c.start);
    expect(live?.clamped, `leaf ${c.start} ends in an ellipsis but the live cell is not clamped`).toBe(true);
    expect(words(live!.label).startsWith(text.slice(0, -1).trimEnd())).toBe(true);
    return { ...c, label: live!.label };
  });
}

const headerStrings = (cells: HeaderDesc[], corner: string[]): string[] =>
  [`corner: ${words(corner)}`].concat(cells.map((c) =>
    `T${c.tier} [${c.start}-${c.end}] ${words(c.label)}${c.sublabel.length ? ` | ${words(c.sublabel)}` : ""}`).sort());

// ---- 3. hard line breaks + bands ---------------------------------------------------------------

/** Exact hard-line structure of the slots render-svg draws without soft wrapping. */
function hardLines(r: Rendered): { html: string[]; svg: string[] } {
  const hh = htmlHeader(r), sh = svgHeader(r);
  const fmt = (slot: string, lines: string[]) => `${slot}: ${JSON.stringify(lines)}`;
  const html = [fmt("corner", hh.corner.filter(Boolean).length ? hh.corner : [])];
  const svg = [fmt("corner", sh.corner.map((l) => l.text))];
  for (const c of hh.cells) {
    if (!c.leaf) html.push(fmt(`banner T${c.tier}`, c.label));
    if (c.sublabel.length) html.push(fmt(`sublabel ${c.start}`, c.sublabel));
  }
  for (const c of sh.cells) {
    if (!c.leaf) svg.push(fmt(`banner T${c.tier}`, c.label));
    if (c.sublabel.length) svg.push(fmt(`sublabel ${c.start}`, c.sublabel));
  }
  for (const tr of Array.from(r.table.querySelectorAll("tbody > tr.tbl-table-group"))) {
    html.push(fmt("group", htmlLines(tr.querySelector(".tbl-table-group-inner")!, (el) => el.classList.contains("tbl-table-group-note"))));
  }
  for (const g of Array.from(r.body.querySelectorAll("g.tbl-table-body > g.tbl-table-group"))) {
    svg.push(fmt("group", svgLines(childTexts(g).slice(0, 1)).lines.map((l) => l.text)));
  }
  return { html: html.sort(), svg: svg.sort() };
}

type Slot = "group" | "corner" | "banner" | "sublabel" | "leaf" | "stub" | "cell";
const SLOTS: Slot[] = ["group", "corner", "banner", "sublabel", "leaf", "stub", "cell"];

/** SVG lines whose baseline falls outside their own band. A line is inside when its baseline is no
 *  lower than the band's bottom edge and at least ~0.7em below its top (room for the ascender). */
function bandViolations(r: Rendered, slot: Slot): { checked: number; violations: string[] } {
  const out: string[] = [];
  let checked = 0;
  const check = (what: string, lines: SvgLine[], top: number, bottom: number): void => {
    lines.forEach((l, i) => {
      checked++;
      if (l.y > bottom + 0.01 || l.y - 0.7 * l.fontSize < top - 0.01) {
        out.push(`${slot}${what ? ` ${what}` : ""} line ${i + 1} "${l.text}" baseline ${l.y} outside band [${top}, ${bottom}]`);
      }
    });
  };
  const { layout } = r;
  if (slot === "corner") check("", svgHeader(r).corner, 0, layout.headerHeight);
  if (slot === "banner" || slot === "leaf" || slot === "sublabel") {
    for (const c of svgHeader(r).cells) {
      const { rect, labelLines, sublabelLines } = c.svg!;
      if (slot === "banner" && !c.leaf) check(`"${words(c.label)}"`, labelLines, rect.y, rect.y + rect.h);
      if (slot === "leaf" && c.leaf) check(`"${words(c.label)}"`, labelLines, rect.y, rect.y + rect.h);
      if (slot === "sublabel") check(`of leaf ${c.start}`, sublabelLines, rect.y, rect.y + rect.h);
    }
  }
  if (slot === "group" || slot === "stub" || slot === "cell") {
    const gs = Array.from(r.body.querySelector("g.tbl-table-body")!.children);
    gs.forEach((g, i) => {
      const entry = layout.rows[i]!;
      const { y, h } = entry.rect;
      if (slot === "group" && "group" in entry) check(`"${entry.group.label}"`, svgLines(childTexts(g).slice(0, 1)).lines, y, y + h);
      if (slot === "stub" && "row" in entry) check(`"${entry.row.label}"`, svgLines(childTexts(g)).lines, y, y + h);
      if (slot === "cell" && "row" in entry) {
        Array.from(g.querySelectorAll("g.tbl-table-cell")).forEach((cg, ci) =>
          check(`r${i} c${ci}`, svgLines(allTexts(cg)).lines, y, y + h));
      }
    });
  }
  return { checked, violations: out };
}

/** Stub line count where the live stub cannot wrap (is-nowrap): the SVG must draw it on as many
 *  lines as it has hard breaks + 1, as the live cell does. */
function stubLineMismatches(r: Rendered): string[] {
  const out: string[] = [];
  const htmlRows = Array.from(r.table.querySelectorAll("tbody > tr:not(.tbl-table-group)"));
  const svgRows = Array.from(r.body.querySelectorAll("g.tbl-table-body > g.tbl-table-row"));
  expect(svgRows.length).toBe(htmlRows.length);
  htmlRows.forEach((tr, i) => {
    const th = tr.querySelector("th.tbl-table-stub")!;
    if (!th.classList.contains("is-nowrap")) return;
    const want = htmlLines(th).length;
    const got = svgLines(childTexts(svgRows[i]!)).lines;
    if (got.length !== want) {
      out.push(`row ${i} "${words(htmlLines(th))}": live is-nowrap on ${want} line(s), SVG draws ${got.length}: ${JSON.stringify(got.map((l) => l.text))}`);
    }
  });
  return out;
}

/** header_max_lines: the live leaf header is clamped to N lines inside its column; the SVG must
 *  draw at most N lines (`count`) each fitting the column (`fit`). */
function headerClampViolations(r: Rendered, spec: TableSpec, part: "count" | "fit"): string[] {
  const n = spec.header_max_lines!;
  const m = makeMeasureText();
  const out: string[] = [];
  // The live side really is clamped to N lines.
  const clamps = Array.from(r.table.querySelectorAll(".tbl-table-header-clamp")) as HTMLElement[];
  expect(clamps.length, "no clamped header on the live side").toBeGreaterThan(0);
  for (const el of clamps) {
    expect(el.style.getPropertyValue("--tbl-header-lines")).toBe(String(n));
  }
  for (const c of svgHeader(r).cells.filter((c) => c.leaf)) {
    const lines = c.svg!.labelLines;
    if (part === "count" && lines.length > n) out.push(`leaf ${c.start}: ${lines.length} lines > ${n}`);
    if (part === "fit") {
      const avail = c.svg!.rect.w - PAD_X_TOTAL;
      for (const l of lines) {
        const w = richWidth(l.text, 12, 700, m);
        if (w > avail + 0.01) out.push(`leaf ${c.start} line "${l.text}" is ${w.toFixed(1)}px wide in a ${avail.toFixed(1)}px column`);
      }
    }
  }
  return out;
}

/** Cell footnote markers drawn off their cell's last line. The marker must rise FOOTNOTE_RISE above
 *  that line's baseline (a marker that continues after a superscript inherits its raised baseline)
 *  and start right of every glyph run on the line (a stacked sub+super is as wide as its wider half).
 *  Run widths use the same `length * fontPx * 0.6` fallback the renderer measured with. */
const FOOTNOTE_RISE = 13 / 3 + 1; // the live `.tbl-table sup` rise under the 13 px body
function markerViolations(r: Rendered): { checked: number; violations: string[] } {
  const out: string[] = [];
  let checked = 0;
  for (const cg of Array.from(r.body.querySelectorAll("g.tbl-table-cell"))) {
    const texts = allTexts(cg);
    const marker = cg.querySelector("tspan.tbl-table-fn-marker");
    if (!marker) continue;
    checked++;
    const host = marker.parentElement!;
    // Effective baseline of the marker: the host's y, moved by every y / dy up to and including it.
    let y = Number(host.getAttribute("y"));
    for (const n of Array.from(host.children)) {
      if (n.hasAttribute("y")) y = Number(n.getAttribute("y"));
      if (n.hasAttribute("dy")) y += Number(n.getAttribute("dy"));
      if (n === marker) break;
    }
    const lines = svgLines(texts).lines;
    const last = Math.max(...lines.map((l) => l.y));
    if (Math.abs(y - (last - FOOTNOTE_RISE)) > 0.01) out.push(`marker "${marker.textContent}" baseline ${y}, line baseline ${last}`);
    if (marker.hasAttribute("x")) {
      const mx = Number(marker.getAttribute("x"));
      const fs = Number(host.getAttribute("font-size"));
      for (const s of Array.from(host.querySelectorAll("tspan[y]"))) {
        if (s === marker) continue;
        const sy = Number(s.getAttribute("y"));
        if (Math.abs(sy - last) > fs / 2) continue; // another line
        const right = Number(s.getAttribute("x")) + (s.textContent ?? "").length * Number(s.getAttribute("font-size") ?? fs) * 0.6;
        if (mx < right - 0.01) out.push(`marker "${marker.textContent}" at x ${mx} overlaps "${s.textContent}" ending at ${right}`);
      }
    }
  }
  return { checked, violations: out };
}

// ---- 4. footnote list --------------------------------------------------------------------------

function footnoteStrings(r: Rendered): { html: string[]; svg: string[] } {
  const html = Array.from(r.card.querySelectorAll(".tbl-table-footnotes > div")).map((d) => {
    const sup = d.querySelector("sup");
    return `${sup?.textContent ?? ""} ${words(htmlLines(d, (el) => el === sup))}`;
  });
  const svg = Array.from(r.body.querySelectorAll("g.tbl-table-footnotes > text")).map((t) => norm(t.textContent ?? ""));
  return { html, svg };
}

// ---- cases -------------------------------------------------------------------------------------

type Check = "body" | "textCells" | "header" | "hardLines" | "stubLines" | "headerCount" | "headerFit" | "footnotes" | `band:${Slot}`;

interface Case {
  name: string;
  spec: TableSpec;
  rows: TidyRow[];
  /** Checks known to diverge today: check -> the it.fails title (carries the finding id). */
  fails?: Partial<Record<Check, string>>;
}

const yearRows = (stubs: string[], years: string[], value: (i: number, j: number) => number, extra: Record<string, string> = {}) =>
  rowsOf(stubs.flatMap((row, i) => years.map((per, j) => ({ row, per, value: value(i, j), ...extra }))));

const CASES: Case[] = [
  {
    name: "plain table",
    spec: {
      title: "Plain", data: "d.csv", stub: [{ label: "row" }], header: ["per"], value: "value",
      format: { default: { decimals: 1 } },
    },
    rows: yearRows(["Revenue", "Outlays", "Deficit"], ["2026", "2027", "2028"], (i, j) => 100 * (i + 1) + j * 3.25),
  },
  {
    name: "footnotes on a text cell and a numeric cell",
    spec: {
      title: "Provisions", data: "d.csv", stub: [{ label: "row" }], header: ["col"], value: "value",
      format: { default: { decimals: 1 } },
      footnote_column: "fn", footnotes: { a: "Phased in over two years.", b: "Estimate." },
    },
    rows: rowsOf([
      { row: "Expands credit", col: "Enacted", value: "Yes", fn: "a" },
      { row: "Expands credit", col: "Cost", value: 3, fn: "b" },
      { row: "Raises rate", col: "Enacted", value: "No", fn: "" },
      { row: "Raises rate", col: "Cost", value: -1.2, fn: "" },
    ]),
  },
  {
    name: "multi-tier header with a blank top tier over a two-column group",
    spec: {
      title: "Three-tier header", data: "d.csv", stub: [{ label: "row" }], header: ["t0", "t1", "leaf"], value: "value",
      format: { default: { decimals: 1 } },
    },
    rows: rowsOf(["Revenue", "Outlays"].flatMap((row, r) =>
      [["", "M", "a"], ["", "M", "b"], ["G", "H", "c"], ["G", "H", "d"]].map(([t0, t1, leaf], i) =>
        ({ row, t0: t0!, t1: t1!, leaf: leaf!, value: 1 + r + i })))),
  },
  {
    name: "`\\\\` in a group label",
    spec: {
      title: "Grouped", data: "d.csv", stub: ["grp", { label: "row" }], header: ["per"], value: "value",
      group_labels: { One: `Group one ${BS2} second line` },
      format: { default: { decimals: 0 } },
    },
    rows: rowsOf(["One", "Two"].flatMap((grp) => ["Alpha", "Beta"].flatMap((row, i) =>
      ["2026", "2027"].map((per, j) => ({ grp, row, per, value: 100 + i * 10 + j }))))),
  },
  {
    name: "`\\\\` in the corner (stub_header)",
    spec: {
      title: "Corner", data: "d.csv", stub: [{ label: "row" }], header: ["per"], value: "value",
      stub_header: `Line one ${BS2} Line two`,
      format: { default: { decimals: 0 } },
    },
    rows: yearRows(["Alpha", "Beta"], ["2026", "2027"], (i, j) => 10 + i + j),
  },
  {
    name: "`\\\\` in a banner",
    spec: {
      title: "Banner", data: "d.csv", stub: [{ label: "row" }], header: ["opt", "per"], value: "value",
      header_labels: { Option: `Policy option ${BS2} billions` },
      format: { default: { decimals: 0 } },
    },
    rows: rowsOf(["Alpha", "Beta"].flatMap((row, i) =>
      ["2026", "2027"].map((per, j) => ({ row, opt: "Option", per, value: 10 + i + j })))),
  },
  {
    name: "`\\\\` in a sublabel",
    spec: {
      title: "Sublabel", data: "d.csv", stub: [{ label: "row" }], header: ["per"], value: "value",
      sublabels: { "2026": `Fiscal year ${BS2} estimate` },
      format: { default: { decimals: 0 } },
    },
    rows: yearRows(["Alpha", "Beta"], ["2026", "2027"], (i, j) => 10 + i + j),
  },
  {
    name: "stub_wrap and stub_nowrap both set",
    spec: {
      title: "Stub", data: "d.csv", stub: [{ label: "row" }], header: ["per"], value: "value",
      stub_wrap: true, stub_nowrap: true, stub_min_width: 60,
      format: { default: { decimals: 1 } },
    },
    rows: yearRows(["Expanded child tax credit refundability", "Short"], ["2026", "2027"], (i, j) => 1.5 + i + j),
  },
  {
    name: "leaf header exceeding header_max_lines",
    spec: {
      title: "Clamp", data: "d.csv", stub: [{ label: "row" }], header: ["col"], value: "value",
      header_max_lines: 2, column_width: 100,
      format: { default: { decimals: 1 } },
    },
    // At the fallback 7.2 px/char a 100 px column has 84 px of text room: "Average tax change" wraps
    // to two fitting lines; "Share of total federal tax change" needs more than two.
    rows: rowsOf(["Bottom quintile", "Top quintile"].flatMap((row, i) =>
      ["Share of total federal tax change", "Average tax change"].map((col, j) => ({ row, col, value: 2.5 * (i + 1) + j })))),
  },
  {
    // Every slot at once: corner, banner over a blank-absorbed tier, leaf label, sublabel, group
    // label + note, stub, text cell (with a footnote), footnote with math; collapsible (expanded).
    name: "`\\\\` in every slot, with blanks at several header tiers",
    spec: {
      title: "Everything", data: "d.csv", stub: ["grp", { label: "row" }], header: ["t0", "t1", "leaf"], value: "value",
      stub_header: `Corner ${BS2} two`,
      header_labels: { M: `Middle ${BS2} banner`, G: `Top ${BS2} banner ${BS2} three`, c: `Leaf ${BS2} c` },
      sublabels: { d: `sub ${BS2} two` },
      group_labels: { One: `Group ${BS2} one` },
      group_notes: { One: "A note under a broken label." },
      collapsible: { default: "expanded" },
      footnote_column: "fn", footnotes: { a: "Math \\(x^2\\) here." },
      format: { default: { decimals: 1 } },
    },
    rows: rowsOf(["One", "Two"].flatMap((grp) => [`Row ${BS2} split`, "Plain"].flatMap((row, r) =>
      [["", "M", "a"], ["", "M", "b"], ["G", "H", "c"], ["G", "H", "d"], ["G", "", "e"], ["", "", "f"]].map(([t0, t1, leaf], i) =>
        ({ grp, row, t0: t0!, t1: t1!, leaf: leaf!, value: leaf === "e" ? (r ? "Text" : `Two ${BS2} lines`) : 1 + r + i, fn: leaf === "e" && r === 0 ? "a" : "" }))))),
  },
  {
    name: "footnote markers after trailing math, a stacked script and a broken line",
    spec: {
      title: "Markers", data: "d.csv", stub: [{ label: "row" }], header: ["col"], value: "value",
      format: { default: { decimals: 1 } },
      footnote_column: "fn", footnotes: { a: "Squared.", b: "Stacked.", c: "Broken.", d: "Numeric." },
    },
    rows: rowsOf([
      { row: "One", col: "Term", value: "Rate \\(x^2\\)", fn: "a" },
      { row: "One", col: "Cost", value: 3, fn: "d" },
      { row: "Two", col: "Term", value: "Share \\(\\theta_{1}^{KK}\\)", fn: "b" },
      { row: "Two", col: "Cost", value: 4, fn: "" },
      { row: "Three", col: "Term", value: `Line ${BS2} two \\(y_i\\)`, fn: "c" },
      { row: "Three", col: "Cost", value: 5, fn: "" },
    ]),
  },
  {
    name: "negative value rounding to zero",
    spec: {
      title: "Rounding", data: "d.csv", stub: [{ label: "row" }], header: ["per"], value: "value", sign_color: true,
      format: { default: { decimals: 1 } },
    },
    rows: rowsOf([
      { row: "Small cut", per: "2026", value: -0.04 },
      { row: "Small cut", per: "2027", value: 0.04 },
      { row: "Large cut", per: "2026", value: -2.5 },
      { row: "Large cut", per: "2027", value: 1.5 },
    ]),
  },
];

// ---- tests -------------------------------------------------------------------------------------

describe("table HTML <-> SVG export parity", () => {
  for (const c of CASES) {
    describe(c.name, () => {
      const test = (check: Check, title: string, fn: () => void): void => {
        const known = c.fails?.[check];
        if (known) it.fails(`${known} — ${title}`, fn);
        else it(title, fn);
      };
      const r = (): Rendered => render(c.spec, c.rows);

      test("body", "1. stubs, group rows and numeric cells (text, footnote marker, sign) match", () => {
        const { html, svg } = bodyStrings(r(), "main");
        expect(html.length).toBeGreaterThan(0);
        expect(svg).toEqual(html);
      });

      const hasTextCells = c.rows.some((row) => {
        const v = String(row[c.spec.value] ?? "").trim();
        return v !== "" && !Number.isFinite(Number(v));
      });
      if (hasTextCells) {
        test("textCells", "1. text cells (text, footnote marker) match", () => {
          const { html, svg } = bodyStrings(r(), "text");
          expect(html.length).toBeGreaterThan(0);
          expect(svg).toEqual(html);
        });
      }

      test("header", "2. header cells: text, tier and leaf-column range match", () => {
        const rr = r();
        const h = htmlHeader(rr), s = svgHeader(rr);
        expect(h.cells.length).toBeGreaterThan(0);
        expect(headerStrings(unclamp(s.cells, h.cells), s.corner.map((l) => l.text))).toEqual(headerStrings(h.cells, h.corner));
      });

      test("hardLines", "3. hard line breaks in group labels, corner, banners and sublabels match", () => {
        const { html, svg } = hardLines(r());
        expect(svg).toEqual(html);
      });

      // Slots with a known band divergence get their own it.fails below; the rest share one `it`.
      const failingSlots = SLOTS.filter((s) => c.fails?.[`band:${s}`]);
      const passingSlots = SLOTS.filter((s) => !failingSlots.includes(s));
      it(`3. every SVG text line stays inside its band (${passingSlots.join(", ")})`, () => {
        const rr = r();
        const results = passingSlots.map((s) => bandViolations(rr, s));
        expect(results.reduce((n, x) => n + x.checked, 0)).toBeGreaterThan(0);
        expect(results.flatMap((x) => x.violations)).toEqual([]);
      });
      for (const slot of failingSlots) {
        it.fails(`${c.fails![`band:${slot}`]} — 3. SVG ${slot} lines stay inside their band`, () => {
          const { checked, violations } = bandViolations(r(), slot);
          expect(checked).toBeGreaterThan(0);
          expect(violations).toEqual([]);
        });
      }

      test("stubLines", "3. a stub the live table keeps on one line is one line in the SVG", () => {
        expect(stubLineMismatches(r())).toEqual([]);
      });

      if (c.spec.header_max_lines != null) {
        test("headerCount", "3. leaf headers draw at most header_max_lines lines", () => {
          expect(headerClampViolations(r(), c.spec, "count")).toEqual([]);
        });
        test("headerFit", "3. every drawn leaf-header line fits its column, as the live clamp does", () => {
          expect(headerClampViolations(r(), c.spec, "fit")).toEqual([]);
        });
      }

      if (c.spec.footnote_column) {
        it("3. every cell footnote marker sits on its cell's last line, after its text", () => {
          const { checked, violations } = markerViolations(r());
          expect(checked).toBeGreaterThan(0);
          expect(violations).toEqual([]);
        });
      }

      test("footnotes", "4. footnote list matches", () => {
        const { html, svg } = footnoteStrings(r());
        expect(html.length).toBe(c.spec.footnotes ? Object.keys(c.spec.footnotes).length : 0);
        expect(svg).toEqual(html);
      });
    });
  }
});
