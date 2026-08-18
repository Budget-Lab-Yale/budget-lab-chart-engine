// The four decisions a stacked bar's `barStack` config drives — the net callout, the hover treatment,
// the tooltip's Total row, and whether net dots exist to pin a pill to — are independent (issue #29).
// This file is the resolution table. It is PURE: no DOM, no render path.
import { describe, it, expect } from "vitest";
import {
  resolveNetMode,
  resolveHoverMode,
  resolveTotalRow,
  hasNetDots,
} from "../src/spec/bar-stack";
import type { ChartSpec } from "../src/spec/types";
import { buildStackedMarks } from "../src/engine/marks/stacked";
import type { PreparedRow } from "../src/engine/marks/index";

function spec(barStack?: Record<string, unknown>): ChartSpec {
  return {
    chartType: "stacked",
    title: "t",
    xAxisType: "categorical",
    data: "data.csv",
    ...(barStack ? { barStack } : {}),
  } as unknown as ChartSpec;
}

/** All four decisions at once, for table-style assertions. */
function all(barStack: Record<string, unknown> | undefined, hasNegatives: boolean) {
  const s = spec(barStack);
  const netMode = resolveNetMode(s, hasNegatives);
  const hoverMode = resolveHoverMode(s, netMode);
  return {
    netMode,
    hoverMode,
    totalRow: resolveTotalRow(s, netMode, hoverMode),
    netDots: hasNetDots(netMode),
  };
}

describe("resolveNetMode — unchanged from today", () => {
  it('resolves auto to "dot" when some value is negative', () => {
    expect(resolveNetMode(spec(), true)).toBe("dot");
  });

  it('resolves auto to "text" when nothing is negative', () => {
    expect(resolveNetMode(spec(), false)).toBe("text");
  });

  it("honours an explicit netDisplay", () => {
    expect(resolveNetMode(spec({ netDisplay: "dot" }), false)).toBe("dot");
    expect(resolveNetMode(spec({ netDisplay: "text" }), true)).toBe("text");
    expect(resolveNetMode(spec({ netDisplay: "none" }), true)).toBe("none");
  });

  it('forces "none" on a normalized stack, whatever netDisplay says', () => {
    expect(resolveNetMode(spec({ normalize: true, netDisplay: "dot" }), true)).toBe("none");
  });
});

describe("the resolution table — today's behaviour, before barStack.hover exists", () => {
  it("a diverging stack: dot marker, tooltip, dot-swatch Total row, pillable dots", () => {
    expect(all(undefined, true)).toEqual({
      netMode: "dot",
      hoverMode: "tooltip",
      totalRow: "dot",
      netDots: true,
    });
  });

  it("an all-positive stack: text callout, value pills, text Total row, no dots", () => {
    expect(all(undefined, false)).toEqual({
      netMode: "text",
      hoverMode: "pills",
      totalRow: "text",
      netDots: false,
    });
  });

  it("netDisplay none: no callout, value pills, no Total row, no dots", () => {
    expect(all({ netDisplay: "none" }, false)).toEqual({
      netMode: "none",
      hoverMode: "pills",
      totalRow: "none",
      netDots: false,
    });
  });

  it("a normalized stack: nothing net at all", () => {
    expect(all({ normalize: true }, true)).toEqual({
      netMode: "none",
      hoverMode: "pills",
      totalRow: "none",
      netDots: false,
    });
  });
});

describe("hasNetDots — tracks the MARKER, not the Total row", () => {
  it("is true only for the dot callout", () => {
    expect(hasNetDots("dot")).toBe(true);
    expect(hasNetDots("text")).toBe(false);
    expect(hasNetDots("none")).toBe(false);
    expect(hasNetDots(undefined)).toBe(false);
  });
});

describe("an undefined netMode means NOT A STACKED CHART", () => {
  // The render-live read site serves bar AND stacked charts, and only marks/stacked.ts sets netMode.
  // Nothing validates `barStack` as stacked-only, so a bar spec carrying a stray hover field must not
  // start getting the floating tooltip — which today it never can.
  it("gives a plain bar chart pills, even with barStack.hover: tooltip set", () => {
    const s = spec({ hover: "tooltip" });
    expect(resolveHoverMode(s, undefined)).toBe("pills");
    expect(resolveTotalRow(s, undefined, resolveHoverMode(s, undefined))).toBe("none");
  });

  it("gives a plain bar chart pills with no barStack block at all", () => {
    expect(resolveHoverMode(spec(), undefined)).toBe("pills");
  });
});

/** `netMode` is a mark-layer field, so assert it through the builder rather than the render path —
 *  RenderResult flattens a copy, and buildStackedMarks is the source (test/golden.test.ts does the
 *  same for legendExtras, for the same reason). */
function layersFor(barStack: Record<string, unknown> | undefined, values: number[]) {
  const rows: PreparedRow[] = values.map((v, i) => ({
    series: i % 2 === 0 ? "A" : "B",
    time: i < 2 ? "Q1" : "Q2",
    _y: v,
    _xc: i < 2 ? "Q1" : "Q2",
  })) as PreparedRow[];
  return buildStackedMarks(rows, spec(barStack), {
    xField: "_xc",
    colors: new Map([["A", "#111111"], ["B", "#222222"]]),
    seriesNames: ["A", "B"],
  });
}

describe("buildStackedMarks — netMode reaches the mark layer", () => {
  it('is "dot" for a diverging stack', () => {
    expect(layersFor(undefined, [10, -20, 30, 40]).netMode).toBe("dot");
  });

  it('is "text" for an all-positive stack', () => {
    expect(layersFor(undefined, [10, 20, 30, 40]).netMode).toBe("text");
  });

  it('is "none" when netDisplay is none, and drops the Total legend row with it', () => {
    const l = layersFor({ netDisplay: "none" }, [10, 20, 30, 40]);
    expect(l.netMode).toBe("none");
    expect(l.legendExtras).toBeUndefined();
  });
});
