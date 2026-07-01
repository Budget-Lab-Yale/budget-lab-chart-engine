import { describe, it, expect } from "vitest";
import { sharedColumnWidths, perPaneColumnWidths } from "../src/engine/figure";
import { TBL_MARGIN_LEFT, TBL_MARGIN_RIGHT, SHARED_LABELLESS_MARGIN_LEFT } from "../src/engine/theme";

const R = TBL_MARGIN_RIGHT;
const LM = TBL_MARGIN_LEFT;
const lm = SHARED_LABELLESS_MARGIN_LEFT;

/** A column's inner data width from its outer width + left margin. */
const dataOf = (colW: number, marginLeft: number) => colW - marginLeft - R;

describe("sharedColumnWidths (weighted per-column distribution)", () => {
  it("weights undefined ⇒ equal data width per column (byte-identical to before)", () => {
    const { colWidths, marginLeft } = sharedColumnWidths(900, 3, 16);
    const dws = colWidths.map((w, c) => dataOf(w, marginLeft[c]!));
    expect(dws[0]).toBeCloseTo(dws[1]!, 6);
    expect(dws[1]).toBeCloseTo(dws[2]!, 6);
    // col 0 carries the y-label gutter, others the small margin.
    expect(marginLeft).toEqual([LM, lm, lm]);
  });

  it("[2,1] ⇒ column 0's data width is twice column 1's", () => {
    const { colWidths, marginLeft } = sharedColumnWidths(900, 2, 16, LM, [2, 1]);
    const d0 = dataOf(colWidths[0]!, marginLeft[0]!);
    const d1 = dataOf(colWidths[1]!, marginLeft[1]!);
    expect(d0).toBeCloseTo(2 * d1, 6);
  });

  it("columns tile the available width exactly (minus the inter-column gaps)", () => {
    const availW = 900;
    const gap = 16;
    for (const weights of [undefined, [2, 1], [3, 1, 2]] as (number[] | undefined)[]) {
      const cols = weights ? weights.length : 3;
      const { colWidths } = sharedColumnWidths(availW, cols, gap, LM, weights);
      const total = colWidths.reduce((a, b) => a + b, 0) + gap * (cols - 1);
      expect(total).toBeCloseTo(availW, 4);
    }
  });

  it("single column (C=1) ignores weights and spans the row", () => {
    const { colWidths } = sharedColumnWidths(600, 1, 16, LM, [5]);
    expect(colWidths[0]).toBeCloseTo(600, 4);
  });
});

describe("perPaneColumnWidths (per-pane mode — every column keeps its own y-axis gutter)", () => {
  it("weights undefined ⇒ equal data width, EVERY column reserves the full label gutter", () => {
    const { colWidths } = perPaneColumnWidths(900, 3, 16);
    const dws = colWidths.map((w) => w - LM - R);
    expect(dws[0]).toBeCloseTo(dws[1]!, 6);
    expect(dws[1]).toBeCloseTo(dws[2]!, 6);
    // Unlike shared mode, no column is narrower — all carry LM (independent axes).
    expect(colWidths[0]).toBeCloseTo(colWidths[1]!, 6);
  });

  it("[3,1] ⇒ column 0's data width is three times column 1's", () => {
    const { colWidths } = perPaneColumnWidths(900, 2, 16, [3, 1]);
    const d0 = colWidths[0]! - LM - R;
    const d1 = colWidths[1]! - LM - R;
    expect(d0).toBeCloseTo(3 * d1, 6);
  });

  it("columns tile the available width exactly (minus the inter-column gaps)", () => {
    const availW = 900;
    const gap = 16;
    for (const weights of [undefined, [2, 1], [3, 1, 2]] as (number[] | undefined)[]) {
      const cols = weights ? weights.length : 3;
      const { colWidths } = perPaneColumnWidths(availW, cols, gap, weights);
      const total = colWidths.reduce((a, b) => a + b, 0) + gap * (cols - 1);
      expect(total).toBeCloseTo(availW, 4);
    }
  });

  it("single column (C=1) spans the row", () => {
    const { colWidths } = perPaneColumnWidths(600, 1, 16, [5]);
    expect(colWidths[0]).toBeCloseTo(600, 4);
  });
});
