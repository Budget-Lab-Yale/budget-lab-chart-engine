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
      // The marker, then the subscript.
      expect(Array.from(texts[0]!.querySelectorAll("tspan[font-size]")).map((s) => s.textContent)).toEqual(["a", "ai"]);
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

// The live list draws each footnote as `<sup>marker</sup> text`. The list sets no rule on that
// <sup>, so it takes Chromium's UA style under the list's 11 px type: `font-size: smaller` (11/1.2
// px) and `vertical-align: super`, which raises its baseline 11/3 + 1 px; the text follows at once.
// The PNG draws the marker the same way. test/table/footnote-marker-live.test.ts measures both in
// Chromium; these pin the drawn SVG.
describe("footnote list: the PNG draws the marker as a superscript, as the live <sup>", () => {
  const SIZE = 11 / 1.2;
  const RISE = 11 / 3 + 1;
  const tspans = (t: Element) => Array.from(t.children).filter((c) => c.localName === "tspan");

  for (const [name, pane, rs] of [
    ["single-pane", {}, rows()],
    ["multi-pane", { pane: "section" }, rows(["One", "Two"])],
  ] as Array<[string, Partial<TableSpec>, TidyRow[]]>) {
    it(`${name}: the marker is smaller and raised, and the text follows on the line's baseline`, () => {
      const [t] = exportTexts({ ...base, ...pane, footnotes: { a: "Phased in." } }, rs);
      const y = Number(t!.getAttribute("y"));
      const [marker, text] = tspans(t!);
      expect(marker!.textContent).toBe("a");
      expect(Number(marker!.getAttribute("font-size"))).toBeCloseTo(SIZE, 6);
      expect(Number(marker!.getAttribute("y"))).toBeCloseTo(y - RISE, 6);
      expect(text!.textContent).toBe(" Phased in.");
      expect(Number(text!.getAttribute("y"))).toBe(y);
      expect(text!.hasAttribute("font-size")).toBe(false); // the list's 11 px
      expect(t!.textContent).toBe("a Phased in.");
    });

    it(`${name}: every line is drawn at the live list's weight, 500`, () => {
      const texts = exportTexts({ ...base, ...pane, footnotes: { a: "Phased in.", b: `One ${BS2} two` } }, rs);
      expect(texts).toHaveLength(3);
      for (const t of texts) expect(t.getAttribute("font-weight")).toBe("500");
    });

    it(`${name}: a line after a \`\\\` carries no marker`, () => {
      const texts = exportTexts({ ...base, ...pane, footnotes: { a: `First line ${BS2} second line` } }, rs);
      expect(texts.map((t) => t.textContent)).toEqual(["a First line", "second line"]);
      expect(tspans(texts[0]!)[0]!.textContent).toBe("a");
      expect(texts[1]!.querySelector("tspan[font-size]")).toBeNull();
    });

    it(`${name}: with math, the marker leads and the text starts after its width at the marker's size`, () => {
      const [t] = exportTexts({ ...base, ...pane, footnotes: { a: MATH } }, rs);
      const x = Number(t!.getAttribute("x"));
      const [marker, first] = tspans(t!);
      expect(marker!.textContent).toBe("a");
      expect(Number(marker!.getAttribute("font-size"))).toBeCloseTo(SIZE, 6);
      expect(Number(marker!.getAttribute("y"))).toBeCloseTo(Number(t!.getAttribute("y")) - RISE, 6);
      // The fallback measurer: 0.6 em per character, at the marker's size.
      expect(Number(first!.getAttribute("x"))).toBeCloseTo(x + SIZE * 0.6, 6);
      expect(first!.textContent).toBe(" Elasticity ");
      expect(t!.textContent).toBe("a Elasticity σai held fixed.");
    });
  }

  it("multi-pane: the first line wraps with the marker at its drawn size, not the text's", () => {
    // Frame content width 480. Marker "abc" at 11 px plus a space and a 69-character word is 73
    // characters at 6.6 px = 481.8 px, which overflows; at the marker's drawn size it is
    // 3 x 5.5 + 70 x 6.6 = 478.5 px, which fits.
    const word = "x".repeat(69);
    const spec: TableSpec = { ...base, pane: "section", footnotes: { abc: `${word} tail` } };
    const texts = exportTexts(spec, rows(["One", "Two"]));
    expect(texts.map((t) => t.textContent)).toEqual([`abc ${word}`, "tail"]);
    expect(texts[1]!.querySelector("tspan")).toBeNull();
  });

  it("multi-pane: a first word that cannot fit beside the marker starts the next line; the marker stands alone", () => {
    // Marker "a" at 5.5 px plus a 6.6 px space leaves 467.9 px; a 72-character word is 475.2 px.
    // Live, the line breaks at the space after the <sup>, so the marker sits alone.
    const word = "x".repeat(72);
    const spec: TableSpec = { ...base, pane: "section", footnotes: { a: `${word} tail` } };
    const texts = exportTexts(spec, rows(["One", "Two"]));
    expect(texts.map((t) => t.textContent)).toEqual(["a", word, "tail"]);
    const markerOnly = texts[0]!;
    expect(tspans(markerOnly)).toHaveLength(1);
    expect(tspans(markerOnly)[0]!.textContent).toBe("a");
    expect(texts[1]!.querySelector("tspan")).toBeNull();
  });

  it("multi-pane: a first line never runs past the frame, marker included", () => {
    const root = buildTableExportSvg({ ...base, pane: "section", footnotes: { a: `${"x".repeat(72)} tail`, b: `${"y".repeat(70)} z` } }, rows(["One", "Two"]));
    const width = Number(root.getAttribute("width"));
    for (const t of Array.from(root.querySelectorAll("g.tbl-figure-footnotes > text"))) {
      const [first, ...rest] = Array.from(t.childNodes);
      const marker = first?.nodeType === 1 && (first as Element).hasAttribute("font-size") ? (first as Element) : null;
      const text = marker ? rest.map((n) => n.textContent).join("") : t.textContent ?? "";
      // The fallback measurer: 0.6 em per character, the marker at its drawn size.
      const drawn = (marker ? (marker.textContent ?? "").length * SIZE * 0.6 : 0) + text.length * 11 * 0.6;
      expect(drawn).toBeLessThanOrEqual(width - 2 * MARGIN);
    }
  });
});
