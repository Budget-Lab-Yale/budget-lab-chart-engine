// @vitest-environment jsdom
//
// The table footnote list (spec `footnotes`), live and in the PNG export, single- and multi-pane
// (finding A10 and the 2026-10-15 review's footnote-list drift). The same footnote must read the
// same in all four places: math rendered (not raw `\( \)` source), a `\\` starting a new line, and
// in the multi-pane PNG a long footnote wrapped to the frame instead of running off its edge.
//
// Text measurement: getContext is stubbed to null, so every measurer uses the
// `s.length * fontPx * 0.6` fallback (src/table/measure.ts).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mountTable } from "../../src/table/mount";
import { buildTableExportSvg } from "../../src/embed/export-table-png";
import { MARGIN } from "../../src/embed/figure-chrome";
import { CHART_CSS } from "../../src/embed/styles";
import type { TableSpec } from "../../src/spec/table-types";
import type { TidyRow } from "../../src/data/index";

const realGetContext = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
});

const BS2 = "\\\\"; // the two-character `\\` hard-break token
const MATH = "Elasticity \\(\\sigma_{ai}\\) held fixed.";

const base: TableSpec = {
  title: "Footnotes", data: "d.csv", stub: [{ label: "row" }], header: ["per"], value: "value",
  format: { default: { decimals: 1 } },
};
const rows = (pane?: string[]): TidyRow[] =>
  (pane ?? [""]).flatMap((p) => ["Alpha", "Beta"].flatMap((row, i) => ["2026", "2027"].map((per, j) => ({
    row, per, value: String(1 + i + j), ...(pane ? { section: p } : {}),
  })))) as unknown as TidyRow[];

function liveLines(spec: TableSpec, rs: TidyRow[]): HTMLElement[] {
  const container = document.createElement("div");
  mountTable(container, { spec, rows: rs });
  return Array.from(container.querySelectorAll(".tbl-table-footnotes > div")) as HTMLElement[];
}

/** Footnote <text> elements of the export, wherever the list is drawn. */
function exportTexts(spec: TableSpec, rs: TidyRow[]): Element[] {
  const root = buildTableExportSvg(spec, rs);
  const single = root.querySelector("g.tbl-table-footnotes");
  if (single) return Array.from(single.children).filter((c) => c.localName === "text");
  return Array.from(root.querySelectorAll("g.tbl-figure-footnotes > text"));
}

describe("footnote list: math", () => {
  for (const [name, spec, rs] of [
    ["single-pane", { ...base, footnotes: { a: MATH } }, rows()],
    ["multi-pane", { ...base, pane: "section", footnotes: { a: MATH } }, rows(["One", "Two"])],
  ] as Array<[string, TableSpec, TidyRow[]]>) {
    it(`${name}: live renders the math, not its source`, () => {
      const [line] = liveLines(spec, rs);
      expect(line!.textContent).not.toContain("\\(");
      expect(line!.querySelector("sub.tbl-math")?.textContent).toBe("ai");
      expect(line!.querySelector("sup")!.textContent).toBe("a"); // the marker still leads the line
    });
    it(`${name}: the PNG renders the math, not its source`, () => {
      const texts = exportTexts(spec, rs);
      expect(texts).toHaveLength(1);
      expect(texts[0]!.textContent).not.toContain("\\(");
      expect(texts[0]!.textContent).toContain("σai");
      expect(texts[0]!.querySelector("tspan[font-size]")?.textContent).toBe("ai"); // the subscript
    });
  }
});

describe("footnote list: the math styles reach the list (it sits outside the <table>)", () => {
  it("a stacked sub+super in a live footnote is laid out as a stack, as in a cell", () => {
    const style = document.createElement("style");
    style.textContent = CHART_CSS;
    document.head.appendChild(style);
    try {
      const spec: TableSpec = { ...base, footnotes: { a: "Share \\(\\theta_1^K\\) only." } };
      const container = document.createElement("div");
      document.body.appendChild(container);
      mountTable(container, { spec, rows: rows() });
      const stack = container.querySelector(".tbl-table-footnotes .tbl-msubsup") as HTMLElement;
      expect(getComputedStyle(stack).display).toBe("inline-flex");
      container.remove();
    } finally {
      style.remove();
    }
  });
});

describe("footnote list: `\\\\` breaks", () => {
  const text = `First line ${BS2} second line`;
  for (const [name, spec, rs] of [
    ["single-pane", { ...base, footnotes: { a: text, b: "After." } }, rows()],
    ["multi-pane", { ...base, pane: "section", footnotes: { a: text, b: "After." } }, rows(["One", "Two"])],
  ] as Array<[string, TableSpec, TidyRow[]]>) {
    it(`${name}: live breaks the line`, () => {
      const [line] = liveLines(spec, rs);
      expect(line!.querySelectorAll("br")).toHaveLength(1);
      expect(line!.textContent).not.toContain(BS2);
    });
    it(`${name}: the PNG draws each line on its own baseline, 16 px apart, and the next footnote below`, () => {
      const texts = exportTexts(spec, rs);
      expect(texts.map((t) => t.textContent)).toEqual(["a First line", "second line", "b After."]);
      const ys = texts.map((t) => Number(t.getAttribute("y")));
      expect(ys[1]! - ys[0]!).toBe(16);
      expect(ys[2]! - ys[1]!).toBe(16);
    });
  }

  it("single-pane: the table reserves a line of height per drawn line", () => {
    const one = buildTableExportSvg({ ...base, footnotes: { a: "First line" } }, rows());
    const two = buildTableExportSvg({ ...base, footnotes: { a: text } }, rows());
    const h = (root: SVGSVGElement) => Number(root.querySelector("g.tbl-table-header")!.parentElement!.getAttribute("height"));
    expect(h(two) - h(one)).toBe(16);
  });
});

describe("footnote list: multi-pane PNG wraps a long footnote to the frame", () => {
  const long = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
  const spec: TableSpec = { ...base, source: "The Budget Lab", pane: "section", footnotes: { a: long, b: "Short." } };

  it("every line fits inside the frame margins, the text is all there, and the source line sits below", () => {
    const root = buildTableExportSvg(spec, rows(["One", "Two"]));
    const width = Number(root.getAttribute("width"));
    const texts = Array.from(root.querySelectorAll("g.tbl-figure-footnotes > text"));
    expect(texts.length).toBeGreaterThan(2); // the long footnote wrapped
    for (const t of texts) {
      expect(Number(t.getAttribute("x"))).toBe(MARGIN);
      // The fallback measurer: 11 px * 0.6 per character.
      expect((t.textContent ?? "").length * 11 * 0.6).toBeLessThanOrEqual(width - 2 * MARGIN);
    }
    expect(texts.map((t) => t.textContent).join(" ")).toBe(`a ${long} b Short.`);
    const lastFootnoteY = Number(texts[texts.length - 1]!.getAttribute("y"));
    const source = Array.from(root.querySelectorAll("text")).find((t) => (t.textContent ?? "").includes("The Budget Lab"));
    expect(Number(source!.getAttribute("y"))).toBeGreaterThan(lastFootnoteY);
    expect(Number(root.getAttribute("height"))).toBeGreaterThan(lastFootnoteY);
  });

  it("a footnote that fits stays one line", () => {
    const root = buildTableExportSvg({ ...spec, footnotes: { b: "Short." } }, rows(["One", "Two"]));
    expect(Array.from(root.querySelectorAll("g.tbl-figure-footnotes > text")).map((t) => t.textContent)).toEqual(["b Short."]);
  });
});
