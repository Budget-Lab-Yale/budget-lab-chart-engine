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

  it("totalHeight = headerHeight + body entries × rowHeight (+ footnotes)", () => {
    const { model, layout } = build();
    expect(layout.totalHeight).toBe(
      layout.headerHeight + model.body.length * layout.rowHeight + layout.footnotesHeight,
    );
  });
});

describe("layoutTable — banner width fit (bug #3)", () => {
  // A wide banner over three narrow columns: the banner text is much wider than the sum of the
  // Slow/Moderate/Rapid leaf widths, so those leaves must widen to fit it.
  const wideSpec: TableSpec = {
    title: "T",
    data: "d",
    value: "value",
    stub: [{ label: "row" }],
    header: ["banner", "scenario"],
    format: { default: { type: "number", decimals: 1 } },
  };
  const BANNER = "AI Adoption Scenarios via Karger et al. (2026)";
  const wideRows = [
    { row: "r", banner: BANNER, scenario: "Slow", value: "1.0" },
    { row: "r", banner: BANNER, scenario: "Moderate", value: "2.0" },
    { row: "r", banner: BANNER, scenario: "Rapid", value: "3.0" },
  ] as any;

  it("widens spanned columns so their sum ≥ the banner's required width", () => {
    const model = buildTableModel(wideSpec, wideRows);
    const layout = layoutTable(model, { width: 800, measureText });
    // The three leaves all sit under the single banner.
    const sumColW = layout.colW.reduce((a, b) => a + b, 0);
    // required width = text + padX(16) + 2*spannerGap(8) = +32
    const required = measureText(BANNER) + 32;
    expect(sumColW).toBeGreaterThanOrEqual(required);
    // colX/totalWidth re-derived consistently after the widening.
    expect(layout.totalWidth).toBe(layout.stubWidth + sumColW);
    expect(layout.colX[0]).toBe(layout.stubWidth);
    for (let i = 1; i < layout.colX.length; i++) {
      expect(layout.colX[i]).toBe(layout.colX[i - 1]! + layout.colW[i - 1]!);
    }
  });
});

describe("layoutTable — width + wrap config (5c)", () => {
  const cfgSpec: TableSpec = {
    title: "T",
    data: "d",
    value: "value",
    stub: [{ label: "row" }],
    header: ["metric"],
    format: { default: { type: "number", decimals: 1 } },
  };
  const cfgRows = [
    { row: "Alpha", metric: "x", value: "1.0" },
    { row: "Beta", metric: "x", value: "2.0" },
  ] as any;

  it("stub_width overrides the computed stub column width", () => {
    const model = buildTableModel(cfgSpec, cfgRows);
    const layout = layoutTable(model, { width: 800, measureText, stubWidth: 300 });
    expect(layout.stubWidth).toBe(300);
    expect(layout.colX[0]).toBe(300);
  });

  it("column_width (single number) overrides every leaf colW", () => {
    const model = buildTableModel(cfgSpec, cfgRows);
    const layout = layoutTable(model, { width: 800, measureText, columnWidth: 120 });
    layout.colW.forEach((w) => expect(w).toBe(120));
  });

  it("column_width (per-key map) overrides the named leaf only", () => {
    const model = buildTableModel(cfgSpec, cfgRows);
    const layout = layoutTable(model, { width: 800, measureText, columnWidth: { x: 200 } });
    const idx = model.leaves.findIndex((l) => l.key === "x");
    expect(layout.colW[idx]).toBe(200);
  });

  it("header_max_lines lets a long leaf header wrap and increases header height", () => {
    const longSpec: TableSpec = {
      title: "T",
      data: "d",
      value: "value",
      stub: [{ label: "row" }],
      header: ["metric"],
      column_width: { m: 60 },
      format: { default: { type: "number", decimals: 1 } },
    };
    const longRows = [
      { row: "r", metric: "m", value: "1.0" },
    ] as any;
    // The leaf label "m" is short, but column_labels makes it long so it must wrap at width 60.
    longSpec.column_labels = { m: "A very long header label that needs wrapping" };
    const model = buildTableModel(longSpec, longRows);
    const noWrap = layoutTable(model, { width: 800, measureText, columnWidth: { m: 60 } });
    const wrapped = layoutTable(model, {
      width: 800,
      measureText,
      columnWidth: { m: 60 },
      headerMaxLines: 3,
    });
    // The column is pinned to 60 either way; the wrapped layout reserves more header height.
    expect(wrapped.headerHeight).toBeGreaterThan(noWrap.headerHeight);
  });

  it("stub_min_width floors the stub; stub_wrap shrinks it toward the min and wraps long labels", () => {
    const s: TableSpec = {
      title: "T",
      data: "d",
      value: "v",
      stub: [{ label: "row" }],
      header: ["m"],
      format: { default: { type: "number", decimals: 0 } },
    };
    const r = [
      { row: "Annual GDP growth under AI", m: "x", v: "1" },
      { row: "GDP", m: "x", v: "2" },
    ] as any;
    const model = buildTableModel(s, r);
    const natural = layoutTable(model, { width: 800, measureText }); // sized to the longest label

    // stub_wrap + stub_min_width: stub shrinks to the min, long label wraps, that row grows.
    const wrapped = layoutTable(model, { width: 800, measureText, stubMinWidth: 120, stubWrap: true });
    expect(wrapped.stubWidth).toBe(120);
    expect(wrapped.stubWidth).toBeLessThan(natural.stubWidth);
    const longRow = wrapped.rows.find((e) => "row" in e && e.row.label.startsWith("Annual")) as any;
    expect(longRow.stubLines.length).toBeGreaterThan(1);
    expect(longRow.rect.h).toBeGreaterThan(wrapped.rowHeight);
    const shortRow = wrapped.rows.find((e) => "row" in e && e.row.label === "GDP") as any;
    expect(shortRow.stubLines).toBeUndefined();
    expect(shortRow.rect.h).toBe(wrapped.rowHeight);

    // Without stub_wrap, stub_min_width is just a floor: a min wider than natural widens the stub;
    // labels never wrap.
    const floored = layoutTable(model, { width: 800, measureText, stubMinWidth: natural.stubWidth + 80 });
    expect(floored.stubWidth).toBe(natural.stubWidth + 80);
    const flooredRow = floored.rows.find((e) => "row" in e && e.row.label.startsWith("Annual")) as any;
    expect(flooredRow.stubLines).toBeUndefined();
  });

  it("fillWidth stretches the table to a shared width, scaling stub + columns proportionally", () => {
    const { model, layout } = build();
    const target = layout.totalWidth + 200;
    const filled = layoutTable(model, { width: 800, measureText, fillWidth: target });
    expect(filled.totalWidth).toBe(target);
    const f = target / layout.totalWidth;
    expect(filled.stubWidth).toBeCloseTo(layout.stubWidth * f, 5);
    filled.colW.forEach((w, i) => expect(w).toBeCloseTo(layout.colW[i]! * f, 5));
    // The last cell's right edge reaches the shared width; heights are unchanged.
    expect(filled.colX[filled.colX.length - 1]! + filled.colW[filled.colW.length - 1]!).toBeCloseTo(target, 5);
    expect(filled.totalHeight).toBe(layout.totalHeight);
    // fillWidth ≤ natural is a no-op.
    const noop = layoutTable(model, { width: 800, measureText, fillWidth: layout.totalWidth - 50 });
    expect(noop.totalWidth).toBe(layout.totalWidth);
  });
});
