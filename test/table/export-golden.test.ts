// @vitest-environment jsdom
//
// Table export goldens: pin today's table PNG-export SVG (`buildTableExportSvg`,
// src/embed/export-table-png.ts) byte for byte. The three body goldens in render-svg.test.ts cover
// `renderTableSvg` only, without a spec, so footnotes, the export chrome and collapse seeding are
// unguarded there. These goldens let a refactor of the table export path prove itself output-neutral.
//
// The four A10 cases were recorded pinning the finding A10 defects (2026-10-15 debt review) and
// re-recorded once, in phase 5 (T5.9), when those defects were fixed. All five were re-recorded again
// (U4, owner waiver 2026-10-16) when the export began stretching a table narrower than the frame to
// the frame's content width, as the live table fills its card; no published table is that narrow.
// table-footnotes was re-recorded a third time (U5, owner waiver 2026-10-16) when its footnote
// markers, in the cells and the list, were drawn at the live size and rise.
//
// Those five are narrow, so they take the export's stretched branch. table-wide is at least as wide
// as the frame's 480 px content width, the unstretched branch every published table takes (natural
// layout, frame max(560, width + 80)); it was recorded new, not re-recorded.
//
// Text measurement: the same fallback the existing table goldens get under jsdom, which has no
// canvas. `makeMeasureText` (src/table/measure.ts) returns `s.length * fontPx * 0.6`, and the chrome's
// `measureText` (src/embed/figure-chrome.ts) returns `text.length * 8`, when `getContext("2d")` is
// null. getContext is stubbed to return null here so the fallback holds even if a canvas package is
// ever installed.
//
// Serialisation: `serializeExportSvg` (test/helpers/export-golden.ts): XMLSerializer, as `rasterize()`
// uses, with each embedded `data:` payload (font, logo) replaced by its SHA-256 and length.
// Golden files: test/fixtures/export/table-*.golden.svg. Verify: `npm run goldens`. Record a NEW
// case only with `npm run goldens:record` (scripts/goldens.mjs); never re-record an existing one.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serializeExportSvg as ser } from "../helpers/export-golden";
import { buildTableExportSvg } from "../../src/embed/export-table-png";
import { buildTableModel } from "../../src/table/model";
import { layoutTable, layoutOptionsFromSpec } from "../../src/table/layout";
import { makeMeasureText } from "../../src/table/measure";
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

describe("table export goldens", () => {
  // A10: the text cell carries its footnote marker, as the numeric cell does
  it("footnotes on a text cell and a numeric cell", async () => {
    const spec: TableSpec = {
      title: "Provisions", source: "The Budget Lab", data: "d.csv",
      stub: [{ label: "row" }], header: ["col"], value: "value",
      format: { default: { decimals: 1 } },
      footnote_column: "fn", footnotes: { a: "Phased in over two years.", b: "Estimate." },
    };
    const rows = rowsOf([
      { row: "Expands credit", col: "Enacted", value: "Yes", fn: "a" },
      { row: "Expands credit", col: "Cost", value: 3, fn: "b" },
      { row: "Raises rate", col: "Enacted", value: "No", fn: "" },
      { row: "Raises rate", col: "Cost", value: -1.2, fn: "" },
    ]);
    const svg = buildTableExportSvg(spec, rows);
    expect(svg.textContent).toContain("Phased in over two years.");
    await expect(ser(svg)).toMatchFileSnapshot("../fixtures/export/table-footnotes.golden.svg");
  });

  // A10: the upper header "H" sits over c/d, its own columns
  it("multi-tier header with a blank top tier over a two-column group", async () => {
    const spec: TableSpec = {
      title: "Three-tier header", data: "d.csv",
      stub: [{ label: "row" }], header: ["t0", "t1", "leaf"], value: "value",
      format: { default: { decimals: 1 } },
    };
    const leaves = [["", "M", "a"], ["", "M", "b"], ["G", "H", "c"], ["G", "H", "d"]];
    const rows = rowsOf(["Revenue", "Outlays"].flatMap((row, r) =>
      leaves.map(([t0, t1, leaf], i) => ({ row, t0: t0!, t1: t1!, leaf: leaf!, value: 1 + r + i }))));
    const svg = buildTableExportSvg(spec, rows);
    expect(svg.textContent).toContain("H");
    await expect(ser(svg)).toMatchFileSnapshot("../fixtures/export/table-blank-top-tier.golden.svg");
  });

  // A10: the group row is a line taller, so the label's second line stays inside it
  it("line break in a group label", async () => {
    const spec: TableSpec = {
      title: "Grouped", data: "d.csv",
      stub: ["grp", { label: "row" }], header: ["per"], value: "value",
      group_labels: { One: `Group one ${BS2} second line` },
      format: { default: { decimals: 0 } },
    };
    const rows = rowsOf(["One", "Two"].flatMap((grp) => ["Alpha", "Beta"].flatMap((row, i) =>
      ["2026", "2027"].map((per, j) => ({ grp, row, per, value: 100 + i * 10 + j })))));
    const svg = buildTableExportSvg(spec, rows);
    expect(svg.textContent).toContain("second line");
    await expect(ser(svg)).toMatchFileSnapshot("../fixtures/export/table-group-label-break.golden.svg");
  });

  // pins: collapsible groups seeded from spec defaults ("Two" collapsed: header + caret kept, rows dropped)
  it("collapsible groups", async () => {
    const spec: TableSpec = {
      title: "Collapsible", data: "d.csv",
      stub: ["grp", { label: "row" }], header: ["per"], value: "value",
      collapsible: { default: "expanded", collapsed: ["Two"] },
      format: { default: { decimals: 0 } },
    };
    const rows = rowsOf(["One", "Two", "Three"].flatMap((grp) => ["Alpha", "Beta"].flatMap((row, i) =>
      ["2026", "2027"].map((per, j) => ({ grp, row, per, value: 10 + i + j })))));
    const svg = buildTableExportSvg(spec, rows);
    expect(svg.textContent).toContain("Three");
    await expect(ser(svg)).toMatchFileSnapshot("../fixtures/export/table-collapsible.golden.svg");
  });

  // A10: -0.04 and +0.04 at 1dp both print "0.0", uncoloured
  it("negative value that rounds to zero", async () => {
    const spec: TableSpec = {
      title: "Rounding", data: "d.csv",
      stub: [{ label: "row" }], header: ["per"], value: "value", sign_color: true,
      format: { default: { decimals: 1 } },
    };
    const rows = rowsOf([
      { row: "Small cut", per: "2026", value: -0.04 },
      { row: "Small cut", per: "2027", value: 0.04 },
      { row: "Large cut", per: "2026", value: -2.5 },
      { row: "Large cut", per: "2027", value: 1.5 },
    ]);
    const svg = buildTableExportSvg(spec, rows);
    expect(svg.textContent).not.toContain("-0.0");
    await expect(ser(svg)).toMatchFileSnapshot("../fixtures/export/table-negative-zero.golden.svg");
  });

  // pins: the unstretched branch. A table at least as wide as the 480 px content width is drawn at
  // its natural width in a max(560, width + 80) frame, with banners, groups, notes and source.
  it("a table at least as wide as the frame's content width", async () => {
    const spec: TableSpec = {
      title: "Ten-year revenue effects", subtitle: "Billions of dollars, by fiscal year",
      source: "The Budget Lab", notes: "Positive values are revenue increases.", data: "d.csv",
      stub: ["grp", { label: "row" }], header: ["window", "year"], value: "value",
      header_labels: { first: "First five years", second: "Second five years" },
      format: { default: { decimals: 1 } }, sign_color: true,
    };
    const years = Array.from({ length: 10 }, (_, i) => String(2026 + i));
    const rows = rowsOf(["Individual", "Corporate"].flatMap((grp, g) =>
      ["Rate changes", "Base broadeners"].flatMap((row, r) =>
        years.map((year, i) => ({
          grp, row, window: i < 5 ? "first" : "second", year, value: (g + 1) * (r ? -1 : 1) * (12.5 + i * 3.25),
        })))));
    const natural = layoutTable(buildTableModel(spec, rows), { measureText: makeMeasureText(), ...layoutOptionsFromSpec(spec) });
    expect(natural.totalWidth).toBeGreaterThanOrEqual(480); // precondition: the unstretched branch
    const svg = buildTableExportSvg(spec, rows);
    expect(Number(svg.getAttribute("width"))).toBe(Math.max(560, natural.totalWidth + 80));
    await expect(ser(svg)).toMatchFileSnapshot("../fixtures/export/table-wide.golden.svg");
  });
});
