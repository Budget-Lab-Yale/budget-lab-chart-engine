// @vitest-environment jsdom
// Wrapped table text breaks only between words, and the wrap points are the ones the export draws:
//  - a column whose cells soft-wrap is never narrower than its widest unbreakable word, so neither
//    the browser (overflow-wrap: break-word) nor the export has to split or overflow a word;
//  - a marker glyph stays attached: a leading triangle (▲ ▼ …) to the word after it, a lone
//    trailing °, † or ‡ to the word before it;
//  - wrapping inside inline math (e.g. a \textit{…} run with spaces) keeps each line's styling
//    instead of leaking delimiter fragments like `}\)` into the export.
import { describe, it, expect } from "vitest";
import { buildTableModel } from "../../src/table/model";
import { layoutTable } from "../../src/table/layout";
import { renderTableSvg } from "../../src/table/render-svg";
import { parseRich, richToPlain } from "../../src/table/richtext";
import type { TableSpec } from "../../src/spec/table-types";
import type { TidyRow } from "../../src/data/index";

const measureText = (s: string) => (s ?? "").length * 7;
const NB = " ";
const SPEC: TableSpec = { title: "T", data: "d", value: "value", stub: [{ label: "row" }], header: ["col"] };
const rowsOf = (cells: Array<[string, string, string]>) =>
  cells.map(([row, col, value]) => ({ row, col, value })) as unknown as TidyRow[];

function lay(cells: Array<[string, string, string]>, opts: Record<string, unknown>) {
  const model = buildTableModel(SPEC, rowsOf(cells));
  const layout = layoutTable(model, { width: 800, measureText, ...opts });
  return { model, layout };
}
const linesOf = (layout: ReturnType<typeof layoutTable>, row: string, i: number): string[] => {
  const e = layout.rows.find((r) => "row" in r && r.row.label === row) as any;
  return e.cellLines?.[i] ?? [e.row.cells[i].text];
};

describe("column floor at the widest word", () => {
  it("a capped column_wrap column grows to fit its widest word", () => {
    const { layout } = lay([["r", "c", "Underreporting rises"]], { columnWidth: 40, columnWrap: true });
    expect(layout.colW[0]).toBe(measureText("Underreporting") + 16);
  });

  it("a capped text column (no column_wrap) grows the same way", () => {
    const { layout } = lay([["r", "c", "Underreporting rises"]], { columnWidth: 40 });
    expect(layout.colW[0]).toBe(measureText("Underreporting") + 16);
  });

  it("a cap wider than every word is honoured exactly", () => {
    const { layout } = lay([["r", "c", "short words only here"]], { columnWidth: 60, columnWrap: true });
    expect(layout.colW[0]).toBe(60);
  });

  it("measures the word at the weight it renders live (500 body, 800 emphasis)", () => {
    const weighted = (s: string, _px: number, weight: number) => (s ?? "").length * (weight >= 800 ? 9 : weight >= 500 ? 8 : 7);
    const model = buildTableModel({ ...SPEC, emphasis_rows: ["e"] }, rowsOf([["r", "c", "Accumulated"], ["e", "c", "Underreporting"]]));
    const layout = layoutTable(model, { width: 800, measureText: weighted, columnWidth: 40 });
    expect(layout.colW[0]).toBe("Underreporting".length * 9 + 16); // emphasized: 800
    const model2 = buildTableModel(SPEC, rowsOf([["r", "c", "Underreporting"]]));
    expect(layoutTable(model2, { width: 800, measureText: weighted, columnWidth: 40 }).colW[0]).toBe("Underreporting".length * 8 + 16); // body: 500
  });

  it("a non-wrapping numeric column keeps its cap", () => {
    const { layout } = lay([["r", "c", "123456789"]], { columnWidth: 30 });
    expect(layout.colW[0]).toBe(30);
  });
});

describe("marker glyphs stay attached", () => {
  it("a leading triangle is joined to the next word with a no-break space", () => {
    const { model } = lay([["r", "c", "▲ Income shifts; ▼ wealth falls"]], {});
    const row = model.body.find((b) => b.kind === "row") as any;
    expect(row.row.cells[0].text).toBe(`▲${NB}Income shifts; ▼${NB}wealth falls`);
  });

  it("a lone trailing °, † or ‡ is joined to the word before it", () => {
    const { model } = lay([["r", "c", "shrink estates °; deductible †"]], {});
    const row = model.body.find((b) => b.kind === "row") as any;
    expect(row.row.cells[0].text).toBe(`shrink estates${NB}°; deductible${NB}†`);
  });

  it("glues a trailing marker that ends an italic math run", () => {
    const src = String.raw`\(\textit{shrink estates °}\)`;
    const { model } = lay([["r", "c", src]], {});
    const row = model.body.find((b) => b.kind === "row") as any;
    expect(row.row.cells[0].text).toBe(src.replace(" °", NB + "°"));
  });

  it("numeric cells and text without markers are untouched", () => {
    const { model } = lay([["r", "c", "plain text here"], ["s", "c", "° alone"]], {});
    const cells = model.body.filter((b) => b.kind === "row").map((b: any) => b.row.cells[0].text);
    expect(cells).toEqual(["plain text here", "° alone"]);
  });

  it("the layout never strands a triangle on its own line", () => {
    const { layout } = lay([["r", "c", "▼ Compensation converts into deferred equity"]], { columnWidth: 60, columnWrap: true });
    const lines = linesOf(layout, "r", 0);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toBe(`▼${NB}Compensation`);
    // The glued pair is the widest unit, so the column floors at it.
    expect(layout.colW[0]).toBe(measureText(`▼${NB}Compensation`) + 16);
  });
});

describe("wrapping inside inline math", () => {
  const CELL = "▼ \\(\\textit{Underreporting rises; giving responds}\\)";

  it("every wrapped line re-parses to clean italic text (no delimiter fragments)", () => {
    const { layout } = lay([["r", "c", CELL]], { columnWidth: 100, columnWrap: true });
    const lines = linesOf(layout, "r", 0);
    expect(lines.length).toBeGreaterThan(1);
    const plain = lines.map((l) => richToPlain(l));
    expect(plain.join(" ")).toBe(`▼${NB}Underreporting rises; giving responds`);
    for (const p of plain) expect(p).not.toMatch(/[{}\\]/);
    // The words keep their italic styling on every line.
    for (const l of lines) {
      const italic = parseRich(l).filter((r) => r.kind === "text" && r.italic).map((r: any) => r.text).join("");
      expect(italic.length).toBeGreaterThan(0);
    }
  });

  it("the export draws no `}` or `\\)` for a wrapped math cell", () => {
    const model = buildTableModel(SPEC, rowsOf([["r", "c", CELL]]));
    const layout = layoutTable(model, { width: 800, measureText, columnWidth: 100, columnWrap: true });
    const svg = renderTableSvg(model, layout, { document, measure: measureText });
    const body = svg.querySelector("g.tbl-table-body")!.textContent!;
    expect(body).not.toMatch(/[{}\\]/);
    expect(body).toContain("Underreporting");
    expect(body).toContain("responds");
  });

  it("math without inner spaces wraps exactly as before (raw substrings kept)", () => {
    const label = "Long-run response (\\(\\eta\\)), the exponent on one minus";
    const { layout } = lay([["r", "c", label]], { columnWidth: 150, columnWrap: true });
    const lines = linesOf(layout, "r", 0);
    expect(lines.join(" ")).toBe(label);
  });
});

describe("live: word-floored tables re-measure once the webfont loads", () => {
  // The first draw runs before the font is ready, so its word widths come from the fallback font.
  async function tableReplaced(spec: TableSpec): Promise<boolean> {
    const { mountTable } = await import("../../src/table/mount");
    let resolve!: () => void;
    const ready = new Promise<void>((r) => { resolve = r; });
    Object.defineProperty(document, "fonts", { value: { status: "loading", ready }, configurable: true });
    try {
      const c = document.createElement("div");
      document.body.appendChild(c);
      mountTable(c, { spec, rows: rowsOf([["r", "c", "Underreporting rises"]]) });
      const before = c.querySelector("table");
      resolve();
      await ready;
      await Promise.resolve();
      const after = c.querySelector("table");
      c.remove();
      return before !== after;
    } finally {
      delete (document as any).fonts;
    }
  }

  it("redraws a table whose column_width cap can floor at a word", async () => {
    expect(await tableReplaced({ ...SPEC, column_width: 40, column_wrap: true })).toBe(true);
  });

  it("leaves every other table's single draw alone", async () => {
    expect(await tableReplaced({ ...SPEC })).toBe(false);
    expect(await tableReplaced({ ...SPEC, column_wrap: true })).toBe(false);
  });
});

describe("marker glyph range", () => {
  it("covers the outline and side-pointing triangles too (U+25B2 to U+25C5)", () => {
    const { model } = lay([["r", "c", "△ a ▽ b ▶ c ◀ d ▴ e ◅ f"]], {});
    const row = model.body.find((b) => b.kind === "row") as any;
    expect(row.row.cells[0].text).toBe(`△${NB}a ▽${NB}b ▶${NB}c ◀${NB}d ▴${NB}e ◅${NB}f`);
  });
});

describe("wrapped math keeps literal characters", () => {
  it("an escaped \\$\\$ is not turned into a $$ delimiter on a wrapped line", () => {
    const CELL2 = "\\(\\textit{alpha beta gamma}\\) costs \\$\\$ here";
    const { layout } = lay([["r", "c", CELL2]], { columnWidth: 60, columnWrap: true });
    const lines = linesOf(layout, "r", 0);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((l) => richToPlain(l)).join(" ")).toContain("costs $$ here");
  });
});

describe("live: the font redraw gate is evaluated per pane", () => {
  it("a text cell in one pane triggers it even where another pane has a number at the same spot", async () => {
    const { mountTable } = await import("../../src/table/mount");
    let resolve!: () => void;
    const ready = new Promise<void>((r) => { resolve = r; });
    Object.defineProperty(document, "fonts", { value: { status: "loading", ready }, configurable: true });
    try {
      const rows = [
        { p: "A", row: "r", col: "c", value: "Underreporting rises" },
        { p: "B", row: "r", col: "c", value: "5" },
      ] as unknown as TidyRow[];
      const c = document.createElement("div");
      document.body.appendChild(c);
      mountTable(c, { spec: { ...SPEC, pane: "p", column_width: 40 }, rows });
      const before = c.querySelector("table");
      resolve();
      await ready;
      await Promise.resolve();
      expect(c.querySelector("table")).not.toBe(before);
      c.remove();
    } finally {
      delete (document as any).fonts;
    }
  });
});
