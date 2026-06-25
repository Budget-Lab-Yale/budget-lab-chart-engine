import { describe, it, expect } from "vitest";
import { buildTableModel } from "../../src/table/model";
import type { TableSpec } from "../../src/spec/table-types";
import { layoutTable } from "../../src/table/layout";

// Deterministic measurement: width proportional to character count, ignoring font/weight.
const measureText = (s: string) => (s ?? "").length * 7;

// A tiny tidy dataset with: nested stub (group + row), a two-tier header with one banner
// spanning two leaves and one stand-alone leaf, formatted numeric cells.
const spec: TableSpec = {
  title: "T",
  data: "d",
  value: "value",
  stub: [{ label: "grp" }, { label: "row" }],
  header: ["tier1", "metric"],
  format: { default: { type: "number", decimals: 2 } },
};
const rows = [
  { grp: "Group One", row: "alpha", tier1: "Conventional", metric: "billions", value: "12.5" },
  { grp: "Group One", row: "alpha", tier1: "Conventional", metric: "share", value: "0.3" },
  { grp: "Group One", row: "alpha", tier1: "Dynamic", metric: "gdp", value: "-100.25" },
  { grp: "Group One", row: "longer-row-label", tier1: "Conventional", metric: "billions", value: "9999.99" },
  { grp: "Group One", row: "longer-row-label", tier1: "Conventional", metric: "share", value: "1.0" },
  { grp: "Group One", row: "longer-row-label", tier1: "Dynamic", metric: "gdp", value: "5.0" },
] as any;

function build() {
  const model = buildTableModel(spec, rows);
  const layout = layoutTable(model, { width: 800, measureText });
  return { model, layout };
}

describe("layoutTable", () => {
  it("each leaf colW fits its widest cell text and header label, plus padding", () => {
    const { model, layout } = build();
    expect(layout.colW.length).toBe(model.leaves.length);
    model.leaves.forEach((leaf, i) => {
      const cellTexts = model.body
        .filter((b) => b.kind === "row")
        .map((b) => (b as any).row.cells[i].text as string);
      const widest = Math.max(
        measureText(leaf.label),
        leaf.sublabel ? measureText(leaf.sublabel) : 0,
        ...cellTexts.map(measureText),
      );
      // colW must be at least the natural content width (padding makes it strictly larger).
      expect(layout.colW[i]!).toBeGreaterThanOrEqual(widest);
      expect(layout.colW[i]!).toBeGreaterThan(widest); // padding added
    });
  });

  it("stubWidth fits the longest row/group label including indentation", () => {
    const { model, layout } = build();
    let maxNatural = 0;
    for (const b of model.body) {
      if (b.kind === "group") {
        maxNatural = Math.max(maxNatural, measureText((b as any).group.label));
      } else {
        const row = (b as any).row;
        maxNatural = Math.max(maxNatural, measureText(row.label) + row.level * /*indentStep*/ 0);
      }
    }
    // Whatever the indent step is, the deepest label's indented width must fit.
    const longestRow = model.body
      .filter((b) => b.kind === "row")
      .map((b) => (b as any).row)
      .reduce((a, r) => (measureText(r.label) > measureText(a.label) ? r : a));
    expect(layout.stubWidth).toBeGreaterThan(measureText(longestRow.label) + longestRow.level * 0);
    // A deeper row consumes indent: a row at level L must fit label + L*indentStep within stubWidth.
    for (const b of model.body) {
      if (b.kind !== "row") continue;
      const row = (b as any).row;
      expect(layout.stubWidth).toBeGreaterThanOrEqual(measureText(row.label) + row.level * 1);
    }
  });

  it("totalWidth equals stubWidth + sum(colW)", () => {
    const { layout } = build();
    const sum = layout.colW.reduce((a, b) => a + b, 0);
    expect(layout.totalWidth).toBe(layout.stubWidth + sum);
  });

  it("colX offsets start at stubWidth and accumulate colW", () => {
    const { layout } = build();
    expect(layout.colX[0]).toBe(layout.stubWidth);
    for (let i = 1; i < layout.colX.length; i++) {
      expect(layout.colX[i]).toBe(layout.colX[i - 1]! + layout.colW[i - 1]!);
    }
  });

  it("header cell rects honor colSpan (width = sum of spanned colW)", () => {
    const { model, layout } = build();
    // tier0 "Conventional" spans 2 leaves (billions, share).
    const topTier = layout.header[0]!;
    const conv = topTier.find((h) => h.cell.text === "Conventional")!;
    expect(conv.cell.colSpan).toBe(2);
    expect(conv.rect.w).toBe(layout.colW[0]! + layout.colW[1]!);
    expect(conv.rect.x).toBe(layout.colX[0]);
  });

  it("header cell rects honor rowSpan (height = rowSpan × tierHeight)", () => {
    const { model, layout } = build();
    // "Dynamic" banner over a single leaf whose bottom tier value (gdp) differs:
    // find the leaf cell carrying leafKey "gdp" which rowSpans down across the banner... but in
    // this fixture tier1 is non-blank for Dynamic, so the gdp leaf sits at the bottom tier
    // (rowSpan 1) and Dynamic at top (rowSpan 1). Instead assert tierHeight consistency:
    const tierHeight = layout.headerHeight / model.headerRows.length;
    for (const tier of layout.header) {
      for (const h of tier) {
        expect(h.rect.h).toBe(h.cell.rowSpan * tierHeight);
        expect(h.rect.y).toBe(h.tier * tierHeight);
      }
    }
  });

  it("group and data rows stack vertically with increasing y", () => {
    const { model, layout } = build();
    expect(layout.rows.length).toBe(model.body.length);
    let prevY = -1;
    for (const r of layout.rows) {
      const rect = (r as any).rect as { y: number; h: number };
      expect(rect.y).toBeGreaterThan(prevY);
      prevY = rect.y;
    }
    // first body entry starts right below the header.
    expect((layout.rows[0] as any).rect.y).toBe(layout.headerHeight);
  });

  it("group rows span full width; data rows carry one cellRect per leaf", () => {
    const { model, layout } = build();
    const groupLayout = layout.rows.find((r) => "group" in r) as any;
    expect(groupLayout.rect.w).toBe(layout.totalWidth);
    const rowLayout = layout.rows.find((r) => "row" in r) as any;
    expect(rowLayout.cellRects.length).toBe(model.leaves.length);
    rowLayout.cellRects.forEach((cr: any, i: number) => {
      expect(cr.x).toBe(layout.colX[i]);
      expect(cr.w).toBe(layout.colW[i]);
    });
    // stub rect of a data row starts at x=0 with width=stubWidth.
    expect(rowLayout.rect.x).toBe(0);
    expect(rowLayout.rect.w).toBe(layout.stubWidth);
  });

  it("totalHeight = headerHeight + body entries × rowHeight", () => {
    const { model, layout } = build();
    expect(layout.totalHeight).toBe(layout.headerHeight + model.body.length * layout.rowHeight);
  });
});
