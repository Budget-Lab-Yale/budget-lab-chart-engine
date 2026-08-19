// @vitest-environment jsdom
//
// `barStack.total.position` orders the tooltip's Total row; `.bold` and `.divider` style it.
// Default "last" position keeps today's markup byte-for-byte; "first" retires the consumer CSS
// reorder (issue #29). `bold` and `divider` default ON (opt-out with `false`) — every stacked
// chart with a Total row gets a bold, divided row on hover unless it says otherwise; this is a
// deliberate on-screen change to existing hover cards, not a regression (tooltips never appear in
// the PNG export or in any golden fixture). At the crosshair layer these stay three flat options
// (totalPosition, totalBold, totalDivider) on buildBandTooltipHtml's opts — the nesting is
// spec-authoring sugar only; see render-live.ts for where `barStack.total.*` gets flattened into
// these, UN-DEFAULTED (`spec.barStack?.total?.bold`, straight through as `undefined` when unset).
// The builder is the SINGLE source of the `?? true` default — defaulting it again at the
// render-live.ts call sites would be two sources for one rule. PURE — buildBandTooltipHtml does no
// DOM access (the jsdom environment here is only for the alignment test's child-count check).
import { describe, it, expect } from "vitest";
import { buildBandTooltipHtml } from "../src/engine/crosshair";

const ROWS = [
  { _xc: "Q1", series: "A", _y: 10 },
  { _xc: "Q1", series: "B", _y: 20 },
];

const OPTS = {
  isStacked: true,
  totalRow: "text" as const,
  seriesOrder: ["A", "B"],
  yFormat: (v: number) => String(v),
};

/** The tooltip's row labels, in DOM order. */
function labels(html: string): string[] {
  return Array.from(html.matchAll(/class="tbl-tooltip-label">([^<]*)</g)).map((m) =>
    (m[1] as string).replace(/:$/, ""),
  );
}

/** The class attribute of the Total row's own <div>, e.g. "tbl-tooltip-row tbl-tooltip-row--total". */
function totalRowClass(html: string): string {
  const m = html.match(/<div class="([^"]*tbl-tooltip-row--total[^"]*)"/);
  if (!m) throw new Error("no Total row found in: " + html);
  return m[1] as string;
}

/** Number of top-level child elements inside a `.tbl-tooltip-row` (or `--total`) div, via jsdom. */
function topLevelChildCount(html: string, selector: string): number {
  const div = document.createElement("div");
  div.innerHTML = html;
  const row = div.querySelector(selector);
  if (!row) throw new Error(`no match for ${selector} in: ${html}`);
  return row.children.length;
}

describe("band tooltip — Total row position", () => {
  it("appends the Total row last by default", () => {
    expect(labels(buildBandTooltipHtml("Q1", ROWS, OPTS))).toEqual(["A", "B", "Total"]);
  });

  it('leads with the Total row when totalPosition is "first"', () => {
    expect(labels(buildBandTooltipHtml("Q1", ROWS, { ...OPTS, totalPosition: "first" }))).toEqual([
      "Total",
      "A",
      "B",
    ]);
  });

  it("emits no Total row when totalRow is none, whatever the position", () => {
    expect(
      labels(buildBandTooltipHtml("Q1", ROWS, { ...OPTS, totalRow: "none", totalPosition: "first" })),
    ).toEqual(["A", "B"]);
  });

  it("keeps the dot swatch on a first-positioned dot row", () => {
    const html = buildBandTooltipHtml("Q1", ROWS, {
      ...OPTS,
      totalRow: "dot",
      totalPosition: "first",
    });
    expect(labels(html)).toEqual(["Total", "A", "B"]);
    // The dot row keys the net marker, so its swatch must survive the reorder.
    expect(html).toMatch(/tbl-tooltip-row--total/);
  });
});

describe("band tooltip — Total row alignment (text branch)", () => {
  it("gives the text Total row an empty swatch spacer so its label indents like a series row", () => {
    const html = buildBandTooltipHtml("Q1", ROWS, OPTS);
    expect(html).toMatch(
      /<div class="[^"]*tbl-tooltip-row--total[^"]*"><span class="tbl-tooltip-swatch" aria-hidden="true">/,
    );
  });

  it("text Total row and a series row have the same number of top-level flex children", () => {
    const html = buildBandTooltipHtml("Q1", ROWS, OPTS);
    const seriesCount = topLevelChildCount(html, ".tbl-tooltip-row:not(.tbl-tooltip-row--total)");
    const totalCount = topLevelChildCount(html, ".tbl-tooltip-row--total");
    expect(totalCount).toBe(seriesCount);
    expect(totalCount).toBe(2); // swatch/spacer + label-and-value span
  });

  it("the dot Total row is untouched by the alignment fix (still a real swatch, unchanged shape)", () => {
    const html = buildBandTooltipHtml("Q1", ROWS, { ...OPTS, totalRow: "dot" as const });
    expect(topLevelChildCount(html, ".tbl-tooltip-row--total")).toBe(2);
    // The dot branch's swatch itself carries no aria-hidden — only the SVG glyph inside it does
    // (pre-existing); the empty-spacer pattern is unique to the text branch's alignment fix.
    expect(html).not.toMatch(/class="tbl-tooltip-swatch" aria-hidden="true"/);
  });

  it("with bold and divider explicitly off, the Total row class is exactly the pre-styling pair", () => {
    // The one true byte-identical-to-before-this-feature case now lives here, gated on the
    // explicit opt-out rather than on omitting the fields (which now means ON).
    const html = buildBandTooltipHtml("Q1", ROWS, { ...OPTS, totalBold: false, totalDivider: false });
    expect(totalRowClass(html)).toBe("tbl-tooltip-row tbl-tooltip-row--total");
  });
});

describe("band tooltip — Total row bold (default ON)", () => {
  it("adds tbl-tooltip-row--total-bold by DEFAULT, with no field set at all", () => {
    const html = buildBandTooltipHtml("Q1", ROWS, OPTS);
    expect(totalRowClass(html).split(" ")).toContain("tbl-tooltip-row--total-bold");
  });

  it("still adds it when totalBold is explicitly true", () => {
    const html = buildBandTooltipHtml("Q1", ROWS, { ...OPTS, totalBold: true });
    expect(totalRowClass(html).split(" ")).toContain("tbl-tooltip-row--total-bold");
  });

  it("an explicit false opts out", () => {
    const html = buildBandTooltipHtml("Q1", ROWS, { ...OPTS, totalBold: false });
    expect(totalRowClass(html)).not.toContain("total-bold");
  });

  it("applies to the dot branch too, default ON and opt-out still wins", () => {
    const dotDefault = buildBandTooltipHtml("Q1", ROWS, { ...OPTS, totalRow: "dot" as const });
    expect(totalRowClass(dotDefault).split(" ")).toContain("tbl-tooltip-row--total-bold");
    const dotOptOut = buildBandTooltipHtml("Q1", ROWS, { ...OPTS, totalRow: "dot" as const, totalBold: false });
    expect(totalRowClass(dotOptOut)).not.toContain("total-bold");
  });
});

describe("band tooltip — Total row divider (default ON, side flips with position)", () => {
  it('adds tbl-tooltip-row--total-rule-above by DEFAULT, with no field set at all (position "last")', () => {
    const html = buildBandTooltipHtml("Q1", ROWS, OPTS);
    const cls = totalRowClass(html).split(" ");
    expect(cls).toContain("tbl-tooltip-row--total-rule-above");
    expect(cls).not.toContain("tbl-tooltip-row--total-rule-below");
  });

  it('flips to tbl-tooltip-row--total-rule-below by DEFAULT when totalPosition is "first"', () => {
    const html = buildBandTooltipHtml("Q1", ROWS, { ...OPTS, totalPosition: "first" as const });
    const cls = totalRowClass(html).split(" ");
    expect(cls).toContain("tbl-tooltip-row--total-rule-below");
    expect(cls).not.toContain("tbl-tooltip-row--total-rule-above");
  });

  it("still adds the rule when totalDivider is explicitly true", () => {
    const html = buildBandTooltipHtml("Q1", ROWS, { ...OPTS, totalDivider: true });
    const cls = totalRowClass(html).split(" ");
    expect(cls).toContain("tbl-tooltip-row--total-rule-above");
    expect(cls).not.toContain("tbl-tooltip-row--total-rule-below");
  });

  it("an explicit false opts out, whatever the position", () => {
    const html = buildBandTooltipHtml("Q1", ROWS, {
      ...OPTS,
      totalDivider: false,
      totalPosition: "first" as const,
    });
    expect(totalRowClass(html)).not.toContain("total-rule");
  });

  it("applies to the dot branch too, default ON and opt-out still wins", () => {
    const dotDefault = buildBandTooltipHtml("Q1", ROWS, { ...OPTS, totalRow: "dot" as const });
    expect(totalRowClass(dotDefault).split(" ")).toContain("tbl-tooltip-row--total-rule-above");
    const dotOptOut = buildBandTooltipHtml("Q1", ROWS, { ...OPTS, totalRow: "dot" as const, totalDivider: false });
    expect(totalRowClass(dotOptOut)).not.toContain("total-rule");
  });
});
