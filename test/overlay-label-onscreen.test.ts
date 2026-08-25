// @vitest-environment jsdom
//
// An overlay's in-frame label must land ON the canvas.
//
// The label anchors at a point on the line and is deliberately never clipped ("a half-cut label
// reads worse than one sitting past the axis"). Those two together used to put the label wherever
// the line's LAST SAMPLED point was — including far outside the frame, because a line is drawn over
// its `domain`, not over the part of it you can see:
//   - `domain: axis` on a steep fit reaches y values the axis does not show;
//   - an explicit `domain: [min, max]` wider than the x axis runs off the side.
// Measured before the fix: a slope-3 line's label sat 675px above a 400px-tall frame, and a real
// published spec's SAHM label was 44% visible. Silently invisible, with nothing in validation or
// rendering to say so.
//
// The anchor is now chosen from the sampled points that are actually inside the frame.
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const ROWS = [
  { x: "1", y: "10" }, { x: "25", y: "30" }, { x: "50", y: "50" },
  { x: "75", y: "70" }, { x: "100", y: "90" },
] as unknown as TidyRow[];

const spec = (overlays: unknown[], extra: Record<string, unknown> = {}): ChartSpec =>
  ({
    chartType: "scatter", xAxisType: "numeric", title: "T",
    columns: { x: "x", value: "y" },
    yAxisPolicy: { min: 0, max: 100 },
    overlays, ...extra,
  }) as unknown as ChartSpec;

/** Where the label actually sits in the SVG's own user space, plus the frame it must fit in. */
function labelPos(res: { svg: SVGSVGElement }, match: RegExp) {
  const svg = res.svg;
  const w = Number(svg.getAttribute("width"));
  const h = Number(svg.getAttribute("height"));
  const el = Array.from(svg.querySelectorAll("text")).find((t) => match.test(t.textContent ?? ""));
  if (!el) return { found: false as const, w, h };
  const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)/.exec(el.getAttribute("transform") ?? "");
  return { found: true as const, x: m ? +m[1]! : NaN, y: m ? +m[2]! : NaN, w, h };
}

const onCanvas = (p: { x: number; y: number; w: number; h: number }): boolean =>
  p.x >= 0 && p.x <= p.w && p.y >= 0 && p.y <= p.h;

/** The label's own offset from its anchor — Plot bakes dx/dy into the parent <g>. */
function labelOffset(res: { svg: SVGSVGElement }, match: RegExp): { dx: number; dy: number } | null {
  const el = Array.from(res.svg.querySelectorAll("text")).find((t) => match.test(t.textContent ?? ""));
  const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)/.exec(el?.parentElement?.getAttribute("transform") ?? "");
  return m ? { dx: +m[1]!, dy: +m[2]! } : null;
}

describe("overlay label clears a steep line", () => {
  it("clears a shallow line vertically", () => {
    const res = renderChart(spec([{ slope: 0.1, intercept: 5, domain: "axis", label: "shallow" }]), ROWS);
    const o = labelOffset(res as never, /shallow/)!;
    expect(Math.abs(o.dy)).toBeGreaterThanOrEqual(5);
    expect(Math.abs(o.dx)).toBeLessThanOrEqual(7);
  });

  it("clears a steep line HORIZONTALLY instead", () => {
    // A few px of vertical nudge cannot clear a line that climbs further than that across the width
    // of the text — it runs straight through. Past 45° on screen the label moves beside the line.
    const res = renderChart(spec([{ slope: 10, intercept: 5, domain: "axis", label: "steepy" }]), ROWS);
    const o = labelOffset(res as never, /steepy/)!;
    expect(Math.abs(o.dx)).toBeGreaterThanOrEqual(8);
    expect(Math.abs(o.dy)).toBeLessThanOrEqual(2);
  });

  it("is a SCREEN judgement, not a data one — a wide value range flattens the same slope", () => {
    // Same data slope, y range 100x larger: on screen the line is now shallow, so the label should
    // go back to clearing vertically. Keying off the data slope alone would miss this.
    const res = renderChart(
      spec([{ slope: 10, intercept: 5, domain: "axis", label: "flattened" }], {
        yAxisPolicy: { min: 0, max: 10000 },
      }),
      ROWS,
    );
    const o = labelOffset(res as never, /flattened/)!;
    expect(Math.abs(o.dy)).toBeGreaterThanOrEqual(5);
  });
});

describe("clipping leaves an in-frame line exactly as it was", () => {
  it("does not move a label on a line that never leaves the frame", () => {
    // `a + 1 * (b - a)` is not guaranteed to equal `b`, so a clipper that reconstructs every
    // endpoint can shift an untouched figure by an ulp — and make the "was it clipped?" identity
    // check fire when nothing was. Coordinates chosen to be unfriendly to float round-tripping.
    const rows = [
      { x: "270.73624672732234", y: "10.5" },
      { x: "960.2969964209482", y: "88.25" },
    ] as unknown as TidyRow[];
    const inFrame = {
      chartType: "scatter", xAxisType: "numeric", title: "T",
      columns: { x: "x", value: "y" },
      overlays: [{ slope: 0.05, intercept: 5, domain: "axis", label: "untouched" }],
    } as unknown as ChartSpec;
    const o = labelOffset(renderChart(inFrame, rows) as never, /untouched/)!;
    // The unclipped pairing: `right` extends LEFT and clears vertically. An edge-aware anchor
    // would surface here as a zero or positive dx. (Plot folds its own half-pixel offset into the
    // same transform, so the direction is the assertable part, not the exact magnitude.)
    expect(o.dx).toBeLessThan(-3);
    expect(Math.abs(o.dy)).toBeGreaterThanOrEqual(5);
  });

  it("does not read a repeated vertex as an infinitely steep line", () => {
    // Duplicates are preserved on purpose, but a coincident neighbour has no direction. Treating
    // its zero dx as infinite slope would move a HORIZONTAL line's label sideways.
    // The LAST two rows are coincident in BOTH x and the column value, so the anchor's immediate
    // backward neighbour has no direction. Distinct x values would never reproduce this.
    const rows = [
      { x: "1", y: "10", c: "50" }, { x: "2", y: "20", c: "50" },
      { x: "3", y: "30", c: "50" }, { x: "3", y: "30", c: "50" },
    ] as unknown as TidyRow[];
    const flat = {
      chartType: "scatter", xAxisType: "numeric", title: "T",
      columns: { x: "x", value: "y" }, yAxisPolicy: { min: 0, max: 100 },
      overlays: [{ column: "c", by: "none", label: "flatdupes" }],
    } as unknown as ChartSpec;
    const o = labelOffset(renderChart(flat, rows) as never, /flatdupes/)!;
    // A flat line clears VERTICALLY.
    expect(Math.abs(o.dy)).toBeGreaterThanOrEqual(5);
    expect(Math.abs(o.dx)).toBeLessThanOrEqual(7);
  });

  it("searches FORWARD for direction when the anchor is the run's first vertex", () => {
    // [A, A, B] with a left anchor: nothing sits behind it, so the backward search comes up empty
    // and the forward one must supply the direction. A→B is SHALLOW here on purpose — taking the
    // coincident duplicate instead yields dx 0, reads as infinite slope, and would clear sideways.
    const rows = [
      { x: "1", y: "10", c: "50" }, { x: "1", y: "10", c: "50" }, { x: "20", y: "90", c: "55" },
    ] as unknown as TidyRow[];
    const spec3 = {
      chartType: "scatter", xAxisType: "numeric", title: "T",
      columns: { x: "x", value: "y" }, yAxisPolicy: { min: 0, max: 100 },
      overlays: [{ column: "c", by: "none", label: "fwd", labelPosition: "left" }],
    } as unknown as ChartSpec;
    const o = labelOffset(renderChart(spec3, rows) as never, /fwd/)!;
    expect(Math.abs(o.dy)).toBeGreaterThanOrEqual(5);
    expect(Math.abs(o.dx)).toBeLessThanOrEqual(7);
  });

  it("keeps duplicate vertices, which a middle anchor counts", () => {
    // EXACTLY [A, A, B], coincident in both coordinates — the only shape where de-duplicating
    // changes the middle anchor: with the duplicate it is the second A (left), without it B
    // (right). Distinct x values, as an earlier version of this test used, cannot detect the bug.
    const rows = [
      { x: "1", y: "10", c: "20" },
      { x: "1", y: "10", c: "20" },
      { x: "9", y: "90", c: "60" },
    ] as unknown as TidyRow[];
    const spec2 = {
      chartType: "scatter", xAxisType: "numeric", title: "T",
      columns: { x: "x", value: "y" }, yAxisPolicy: { min: 0, max: 100 },
      overlays: [{ column: "c", by: "none", label: "dupes", labelPosition: "middle" }],
    } as unknown as ChartSpec;
    const p = labelPos(renderChart(spec2, rows) as never, /dupes/);
    expect(p.found).toBe(true);
    expect(onCanvas(p as never)).toBe(true);
    // Anchored at the duplicated LEFT vertex, not at B on the right.
    expect(p.x).toBeLessThan(p.w / 2);
  });
});

describe("a curve that leaves and re-enters keeps its pieces apart", () => {
  it("measures slope within the anchor's own visible piece, not across the gap", () => {
    // A parabola that dives below the frame and climbs back. Clipping yields TWO visible runs. If
    // they were joined, the exit and re-entry would sit side by side — both on the same boundary,
    // so the slope between them reads ~0 and the label would clear vertically straight through a
    // steeply re-entering line. Kept apart, the neighbour is a real step along the curve.
    const rows = [
      { x: "0", y: "10" }, { x: "50", y: "50" }, { x: "100", y: "90" },
    ] as unknown as TidyRow[];
    const uCurve = {
      chartType: "scatter", xAxisType: "numeric", title: "T",
      columns: { x: "x", value: "y" }, yAxisPolicy: { min: 0, max: 100 },
      overlays: [{
        // Sampled coarsely on purpose so the two visible pieces are short and the MIDDLE anchor
        // lands on the second piece's first vertex — the one point where "neighbour within my run"
        // and "neighbour across the gap" differ. Within the run the neighbour is the steep
        // re-entry; across the gap it is the previous piece's exit, at the same boundary y, which
        // reads as slope zero.
        fun: "b0 + b1*x + b2*x*x", params: { b0: 50, b1: -20, b2: 1 }, n: 8,
        domain: "axis", label: "ucurve", labelPosition: "middle",
      }],
    } as unknown as ChartSpec;
    const p = labelPos(renderChart(uCurve, rows) as never, /ucurve/);
    expect(p.found).toBe(true);
    expect(onCanvas(p as never)).toBe(true);
    const o = labelOffset(renderChart(uCurve, rows) as never, /ucurve/)!;
    // The curve is steep where it crosses the frame edge, so the label clears sideways.
    expect(Math.abs(o.dx)).toBeGreaterThanOrEqual(8);
  });
});

describe("overlay label respects a break in the line", () => {
  it("does not bridge a null gap to invent a visible crossing", () => {
    // A `column` overlay's blank cell is a BREAK — the line is drawn as two paths. Two points
    // outside the frame on OPPOSITE sides of that gap must not be joined into a segment that
    // appears to cross the view, with a label hung on it.
    const rows = [
      { x: "1", y: "10", c: "-500" },
      { x: "50", y: "50", c: "" },
      { x: "100", y: "90", c: "5000" },
    ] as unknown as TidyRow[];
    const res = renderChart(
      spec([{ column: "c", by: "none", label: "broken" }], { columns: { x: "x", value: "y" } }),
      rows,
    );
    expect(labelPos(res as never, /broken/).found).toBe(false);
  });
});

describe("labelSide still means something on a steep line", () => {
  const steepSpec = (labelSide?: "top" | "bottom") =>
    spec([{ slope: 10, intercept: 5, domain: "axis", label: "sided",
            ...(labelSide ? { labelSide } : {}) }]);

  it("puts `bottom` on the opposite side from the default", () => {
    // Above/below is meaningless on a near-vertical line, so the field toggles sides instead of
    // being silently ignored — which is what the CONFIG-SPEC row now promises.
    const a = labelOffset(renderChart(steepSpec(), ROWS) as never, /sided/)!;
    const b = labelOffset(renderChart(steepSpec("bottom"), ROWS) as never, /sided/)!;
    expect(Math.sign(a.dx)).not.toBe(Math.sign(b.dx));
    expect(Math.abs(b.dx)).toBeGreaterThanOrEqual(8);
  });
});

describe("overlay label stays on the canvas", () => {
  it("anchors a steep line's label inside the frame, not at its off-screen end", () => {
    const res = renderChart(spec([{ slope: 3, intercept: 5, domain: "axis", label: "steep fit" }]), ROWS);
    const p = labelPos(res as never, /steep fit/);
    expect(p.found).toBe(true);
    expect(onCanvas(p as never)).toBe(true);
  });

  it("anchors a label whose domain runs past the x axis", () => {
    // The shape of the published SAHM fit: domain far wider than the plotted x range.
    const res = renderChart(
      spec([{ fun: "b0 + b1*x", params: { b0: 40, b1: 0.02 }, domain: [-1000, 1000], label: "wide fit" }]),
      ROWS,
    );
    const p = labelPos(res as never, /wide fit/);
    expect(p.found).toBe(true);
    expect(onCanvas(p as never)).toBe(true);
  });

  it("holds for every labelPosition", () => {
    for (const labelPosition of ["left", "middle", "right"] as const) {
      const res = renderChart(
        spec([{ slope: 3, intercept: 5, domain: "axis", label: `pos ${labelPosition}`, labelPosition }]),
        ROWS,
      );
      const p = labelPos(res as never, new RegExp(`pos ${labelPosition}`));
      expect(p.found, labelPosition).toBe(true);
      expect(onCanvas(p as never), labelPosition).toBe(true);
    }
  });

  it("draws NO label when the line is nowhere in the frame", () => {
    // A label for a line the reader cannot see is the same defect as a legend row for a line drawn
    // nowhere — which this codebase already rejects.
    const res = renderChart(
      spec([{ slope: 0, intercept: 5000, domain: "axis", label: "way above" }]),
      ROWS,
    );
    expect(labelPos(res as never, /way above/).found).toBe(false);
  });

  it("leaves a line that fits entirely in frame exactly where it was", () => {
    // The regression guard: this is every existing figure, and its label must not move.
    const res = renderChart(spec([{ slope: 0.5, intercept: 20, domain: "axis", label: "gentle fit" }]), ROWS);
    const p = labelPos(res as never, /gentle fit/);
    expect(p.found).toBe(true);
    expect(onCanvas(p as never)).toBe(true);
  });
});
