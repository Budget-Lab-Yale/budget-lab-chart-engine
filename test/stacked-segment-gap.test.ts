// @vitest-environment jsdom
//
// `barStack.segmentGap` — whitespace BETWEEN stacked segments, so two slices from the same hue
// family don't read as one block.
//
// Implemented as geometry, not paint, and specifically as a post-render pass rather than a Plot
// option: the vendored Plot 0.6.16 coerces `insetTop=+T`, i.e. insets are scalars, not channels, so
// one inset cannot both separate the interior boundaries AND leave the bar's two outer ends alone.
// A background-coloured stroke (what a consumer can do in CSS today) fails differently — it paints
// OVER the segment, so a slice thinner than the stroke is swallowed whole, and it never reaches the
// PNG export.
//
// The pass is shrink-only and never moves a rect, which is what guarantees the invariants below:
// the first segment still starts at the baseline and the last still ends at the total.
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const ROWS: TidyRow[] = [
  { time: "Bottom 50%", series: "a", value: "3" },
  { time: "Bottom 50%", series: "b", value: "2" },
  { time: "Bottom 50%", series: "c", value: "4" },
  { time: "Top 1%", series: "a", value: "6" },
  { time: "Top 1%", series: "b", value: "1" },
  { time: "Top 1%", series: "c", value: "5" },
] as unknown as TidyRow[];

const BASE = {
  chartType: "stacked",
  title: "t",
  xAxisType: "categorical",
  columns: { x: "time", value: "value", series: "series" },
} as unknown as ChartSpec;

const OPTS = { width: 720, height: 400, document };

const spec = (extra: Record<string, unknown> = {}) =>
  ({ ...BASE, ...extra }) as unknown as ChartSpec;
/** `extra` is spread FIRST so its own `barStack` cannot clobber the segmentGap we are testing. */
const gapSpec = (gap: number, extra: Record<string, unknown> = {}) =>
  spec({ ...extra, barStack: { ...((extra.barStack as object) ?? {}), segmentGap: gap } });

interface Box { x: number; y: number; w: number; h: number }

const boxes = (s: ChartSpec): Box[] =>
  [...renderChart(s, ROWS, OPTS).svg.querySelectorAll('g[aria-label="bar"] rect')].map((r) => ({
    x: +r.getAttribute("x")!,
    y: +r.getAttribute("y")!,
    w: +r.getAttribute("width")!,
    h: +r.getAttribute("height")!,
  }));

/** Group by band position, then order along the value axis in pixels. */
function stacks(list: Box[], axis: "y" | "x"): Box[][] {
  const key = axis === "y" ? "x" : "y";
  const byBand = new Map<number, Box[]>();
  for (const b of list) {
    const k = Math.round(b[key as "x" | "y"]);
    if (!byBand.has(k)) byBand.set(k, []);
    byBand.get(k)!.push(b);
  }
  return [...byBand.values()].map((g) => g.slice().sort((p, q) => p[axis] - q[axis]));
}

describe("barStack.segmentGap, vertical", () => {
  it("opens a gap of exactly N px between adjacent segments", () => {
    for (const gap of [1, 3]) {
      for (const stack of stacks(boxes(gapSpec(gap)), "y")) {
        expect(stack.length).toBeGreaterThan(1);
        for (let i = 0; i < stack.length - 1; i++) {
          const bottomOfUpper = stack[i]!.y + stack[i]!.h;
          expect(stack[i + 1]!.y - bottomOfUpper, `gap ${gap}, boundary ${i}`).toBeCloseTo(gap, 5);
        }
      }
    }
  });

  it("leaves the bar's outer ends untouched — the baseline and the total do not move", () => {
    const plain = stacks(boxes(spec()), "y");
    const gapped = stacks(boxes(gapSpec(2)), "y");
    expect(gapped).toHaveLength(plain.length);
    plain.forEach((stack, s) => {
      const g = gapped[s]!;
      // Top of the topmost segment = the stack's total; bottom of the bottommost = the baseline.
      expect(g[0]!.y).toBeCloseTo(stack[0]!.y, 5);
      const lastPlain = stack[stack.length - 1]!;
      const lastGapped = g[g.length - 1]!;
      expect(lastGapped.y + lastGapped.h).toBeCloseTo(lastPlain.y + lastPlain.h, 5);
    });
  });

  it("never moves a segment's leading edge, only pulls its trailing edge in", () => {
    const plain = boxes(spec());
    const gapped = boxes(gapSpec(2));
    gapped.forEach((g, i) => {
      expect(g.y).toBeCloseTo(plain[i]!.y, 5);
      expect(g.h).toBeLessThanOrEqual(plain[i]!.h + 1e-9);
    });
  });

  it("is byte-identical to today at gap 0, and when the key is absent", () => {
    const plain = renderChart(spec(), ROWS, OPTS).svg.outerHTML;
    expect(renderChart(gapSpec(0), ROWS, OPTS).svg.outerHTML).toBe(plain);
  });
});

describe("barStack.segmentGap, horizontal", () => {
  const horizontal = (extra: Record<string, unknown> = {}) =>
    ({ ...BASE, orientation: "horizontal", ...extra }) as unknown as ChartSpec;

  it("opens the gap along the stacking axis", () => {
    const gap = 2;
    const s = horizontal({ barStack: { segmentGap: gap } });
    for (const stack of stacks(boxes(s), "x")) {
      expect(stack.length).toBeGreaterThan(1);
      for (let i = 0; i < stack.length - 1; i++) {
        expect(stack[i + 1]!.x - (stack[i]!.x + stack[i]!.w)).toBeCloseTo(gap, 5);
      }
    }
  });

  it("leaves the outer ends untouched", () => {
    const plain = stacks(boxes(horizontal()), "x");
    const gapped = stacks(boxes(horizontal({ barStack: { segmentGap: 2 } })), "x");
    plain.forEach((stack, s) => {
      const g = gapped[s]!;
      expect(g[0]!.x).toBeCloseTo(stack[0]!.x, 5);
      const lastPlain = stack[stack.length - 1]!;
      const lastGapped = g[g.length - 1]!;
      expect(lastGapped.x + lastGapped.w).toBeCloseTo(lastPlain.x + lastPlain.w, 5);
    });
  });
});

describe("thin segments", () => {
  const THIN: TidyRow[] = [
    { time: "A", series: "big", value: "100" },
    { time: "A", series: "sliver", value: "0.05" },
    { time: "A", series: "rest", value: "40" },
  ] as unknown as TidyRow[];

  const thinBoxes = (gap: number) =>
    [
      ...renderChart(
        { ...BASE, barStack: { segmentGap: gap } } as unknown as ChartSpec,
        THIN,
        OPTS,
      ).svg.querySelectorAll('g[aria-label="bar"] rect'),
    ].map((r) => ({ h: +r.getAttribute("height")!, series: r.getAttribute("data-series") }));

  it("floors a segment thinner than the gap to a visible hairline rather than dropping it", () => {
    const sliver = thinBoxes(4).find((b) => b.series === "sliver")!;
    expect(sliver.h).toBeGreaterThan(0);
    expect(sliver.h).toBeCloseTo(0.5, 5);
  });

  it("leaves a genuinely zero-height segment at zero — a 0 value is not a hairline", () => {
    const zeroRows: TidyRow[] = [
      { time: "A", series: "big", value: "10" },
      { time: "A", series: "none", value: "0" },
    ] as unknown as TidyRow[];
    const heights = [
      ...renderChart(
        { ...BASE, barStack: { segmentGap: 3 } } as unknown as ChartSpec,
        zeroRows,
        OPTS,
      ).svg.querySelectorAll('g[aria-label="bar"] rect[data-series="none"]'),
    ].map((r) => +r.getAttribute("height")!);
    for (const h of heights) expect(h).toBe(0);
  });
});

describe("segmentGap with the rest of the stacked feature set", () => {
  it("honours the gap on a 100%-normalized stack", () => {
    const s = gapSpec(2, { barStack: { normalize: true } });
    for (const stack of stacks(boxes(s), "y")) {
      for (let i = 0; i < stack.length - 1; i++) {
        expect(stack[i + 1]!.y - (stack[i]!.y + stack[i]!.h)).toBeCloseTo(2, 5);
      }
    }
  });

  it("does not move the net dot, which marks the true total", () => {
    const divergingRows: TidyRow[] = [
      { time: "A", series: "up", value: "5" },
      { time: "A", series: "down", value: "-2" },
    ] as unknown as TidyRow[];
    const dotY = (gap: number) => {
      const s = { ...BASE, barStack: { segmentGap: gap, netDisplay: "dot" } } as unknown as ChartSpec;
      const dot = renderChart(s, divergingRows, OPTS).svg.querySelector("g.tbl-net-marker circle")!;
      return +dot.getAttribute("cy")!;
    };
    expect(dotY(3)).toBeCloseTo(dotY(0), 5);
  });

  it("puts a gap at the zero crossing of a diverging stack — that is a segment boundary too", () => {
    const divergingRows: TidyRow[] = [
      { time: "A", series: "up", value: "5" },
      { time: "A", series: "down", value: "-3" },
    ] as unknown as TidyRow[];
    const rects = [
      ...renderChart(
        { ...BASE, barStack: { segmentGap: 2 } } as unknown as ChartSpec,
        divergingRows,
        OPTS,
      ).svg.querySelectorAll('g[aria-label="bar"] rect'),
    ]
      .map((r) => ({ y: +r.getAttribute("y")!, h: +r.getAttribute("height")! }))
      .sort((a, b) => a.y - b.y);
    expect(rects).toHaveLength(2);
    expect(rects[1]!.y - (rects[0]!.y + rects[0]!.h)).toBeCloseTo(2, 5);
  });
});
