// `barStack.totalPosition` orders the tooltip's Total row. Default "last" keeps today's markup
// byte-for-byte; "first" retires the consumer CSS reorder (issue #29). PURE — buildBandTooltipHtml
// does no DOM access.
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
