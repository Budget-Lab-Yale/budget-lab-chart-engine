// @vitest-environment jsdom
// `\\` in a table's `notes` is a hard line break, live and in the PNG export. Chart notes share
// the renderers but do not opt in, so a chart note keeps `\\` literal.
import { describe, it, expect } from "vitest";
import { mountTable } from "../../src/table/mount";
import { buildTableExportSvg } from "../../src/embed/export-table-png";
import { renderSourceLine } from "../../src/engine/source-line";
import type { TableSpec } from "../../src/spec/table-types";
import type { TidyRow } from "../../src/data/index";

const BS2 = "\\\\"; // the two-character break token
const SPEC: TableSpec = {
  title: "T", data: "d", value: "value",
  stub: [{ label: "row" }], header: ["per"],
  notes: `The note proper. ${BS2} ▲ = the base grows.`,
  source: "The Budget Lab",
};
const ROWS = [{ row: "a", per: "2026", value: "1" }] as unknown as TidyRow[];

describe("table notes — hard line break", () => {
  it("live: splits the note at \\\\ with a <br>, dropping the token", () => {
    const c = document.createElement("div");
    mountTable(c, { spec: SPEC, rows: ROWS });
    const p = c.querySelector(".figure-note")!;
    expect(p.querySelectorAll("br")).toHaveLength(1);
    expect(p.textContent).not.toContain("\\");
    expect(p.textContent).toContain("The note proper.");
    expect(p.textContent).toContain("▲ = the base grows.");
  });

  it("live: links still work on either side of the break", () => {
    const c = document.createElement("div");
    mountTable(c, { spec: { ...SPEC, notes: `See [CBO](https://cbo.gov). ${BS2} [TBL](https://budgetlab.yale.edu)` }, rows: ROWS });
    const links = c.querySelectorAll(".figure-note a.figure-link");
    expect(links).toHaveLength(2);
  });

  it("live: a note without \\\\ renders exactly as before (no <br>)", () => {
    const c = document.createElement("div");
    mountTable(c, { spec: { ...SPEC, notes: "Plain note." }, rows: ROWS });
    const p = c.querySelector(".figure-note")!;
    expect(p.innerHTML).toBe("Plain note.");
  });

  it("export: the text after the break starts a new line and no backslash is drawn", () => {
    const svg = buildTableExportSvg(SPEC, ROWS);
    expect(svg.textContent).not.toContain("\\");
    const texts = Array.from(svg.querySelectorAll("text"));
    const first = texts.find((t) => t.textContent?.includes("The note proper."))!;
    const second = texts.find((t) => t.textContent?.includes("▲ = the base grows."))!;
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
    expect(Number(second.getAttribute("y"))).toBeGreaterThan(Number(first.getAttribute("y")));
  });

  it("export: the frame grows by the extra line", () => {
    const one = buildTableExportSvg({ ...SPEC, notes: "The note proper. ▲ = the base grows." }, ROWS);
    const two = buildTableExportSvg(SPEC, ROWS);
    expect(Number(two.getAttribute("height")) - Number(one.getAttribute("height"))).toBe(15);
  });
});

describe("chart notes do not opt in", () => {
  it("renderSourceLine without the table opt-in keeps \\\\ literal", () => {
    const c = document.createElement("div");
    renderSourceLine(c, { note: `a ${BS2} b` });
    expect(c.querySelector(".figure-note")!.textContent).toBe(`a ${BS2} b`);
  });
});

describe("table notes — documented edges", () => {
  it("a folded block scalar (>-) keeps the token as two backslashes", async () => {
    const { parse } = await import("yaml");
    const doc = parse(`notes: >-\n  First part. ${BS2} Second\n  part.\n`) as { notes: string };
    expect(doc.notes).toBe(`First part. ${BS2} Second part.`);
  });

  it("inline math is not rendered in notes (delimiters stay literal)", () => {
    const c = document.createElement("div");
    const math = String.raw`Rate \(\eta\) is fixed.`;
    mountTable(c, { spec: { ...SPEC, notes: math }, rows: ROWS });
    expect(c.querySelector(".figure-note")!.textContent).toBe(math);
  });
});
