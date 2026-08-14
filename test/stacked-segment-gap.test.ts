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
import { renderChart, renderPane } from "../src/engine/index";
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

  it("is byte-identical to today at gap 0 with value labels on, too", () => {
    const labels = { valueLabels: { show: true } };
    const plain = renderChart(spec(labels), ROWS, OPTS).svg.outerHTML;
    expect(renderChart(gapSpec(0, labels), ROWS, OPTS).svg.outerHTML).toBe(plain);
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

// --- In-segment value labels ---
//
// The labels are placed at the segment's DATA-space midpoint, at build time, and kept or dropped on
// the segment's pre-gap pixel extent. The midpoint does not know the rect is about to shrink, so
// with `valueLabels.show` and a gap both set, every segment but the last in pixel order carried its
// label gap/2 off the visible centre (6px at the schema max, on a 10px font). That correction is
// taken from the rect the gap pass just changed, so it cannot drift from the shrink that caused it.
// The KEEP/DROP decision is not corrected, and must not be: it is about the segment's share of the
// data, and re-running its 25px threshold on the narrowed rect deletes labels that plainly fit.

/** Absolute position of a Plot element: its own `translate(x,y)` plus every ancestor's. A text mark
 *  and a bar mark sit in different groups, each with its own translate, so raw coordinates are not
 *  comparable. (Same reading the engine does — jsdom has no layout, so there is no getCTM.) */
function abs(el: Element): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (let n: Element | null = el; n && n.tagName.toLowerCase() !== "svg"; n = n.parentElement) {
    const m = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(n.getAttribute("transform") ?? "");
    if (m) {
      x += Number(m[1]);
      y += Number(m[2]);
    }
  }
  return { x, y };
}

/** Every rendered label paired with the segment it sits in, as ABSOLUTE geometry: the label's
 *  position and the visible centre of the rect whose box contains it. */
function labelledSegments(s: ChartSpec): Array<{ text: string; at: number; centre: number }> {
  const svg = renderChart(s, ROWS, OPTS).svg;
  const rects = [...svg.querySelectorAll('g[aria-label="bar"] rect')].map((r) => {
    const o = abs(r);
    return {
      x: o.x + +r.getAttribute("x")!,
      y: o.y + +r.getAttribute("y")!,
      w: +r.getAttribute("width")!,
      h: +r.getAttribute("height")!,
    };
  });
  const horizontal = s.orientation === "horizontal";
  return [...svg.querySelectorAll("g.tbl-segment-label text")].map((t) => {
    const at = abs(t);
    const rect = rects.find(
      (r) => at.x >= r.x && at.x <= r.x + r.w && at.y >= r.y && at.y <= r.y + r.h,
    );
    expect(rect, `no segment contains the label "${t.textContent}"`).toBeDefined();
    return {
      text: t.textContent ?? "",
      at: horizontal ? at.x : at.y,
      centre: horizontal ? rect!.x + rect!.w / 2 : rect!.y + rect!.h / 2,
    };
  });
}

describe("segmentGap with in-segment value labels", () => {
  const LABELS = { valueLabels: { show: true } };

  it("centres each label on the segment as GAPPED, not as originally stacked", () => {
    const labels = labelledSegments(gapSpec(6, LABELS));
    expect(labels.length).toBeGreaterThan(1);
    // 1px of slack for the half-pixel offset Plot puts on a text mark's group; the pre-gap
    // placement this replaces was off by gap/2 = 3px.
    for (const l of labels) {
      expect(Math.abs(l.at - l.centre), `label "${l.text}"`).toBeLessThan(1);
    }
  });

  it("centres them on a horizontal stack too — the shift follows the stacking axis", () => {
    const labels = labelledSegments(
      spec({ ...LABELS, orientation: "horizontal", barStack: { segmentGap: 6 } }),
    );
    expect(labels.length).toBeGreaterThan(1);
    for (const l of labels) {
      expect(Math.abs(l.at - l.centre), `label "${l.text}"`).toBeLessThan(1);
    }
  });

  it("keeps exactly the labels the un-gapped chart drew — a gap is separation, not a fit test", () => {
    // The 25px threshold is a judgement about a segment's share of the data, made once in
    // buildSegmentLabels against the un-shrunk extent. Re-running it on the gapped rect turns it
    // into "drop the label if segment-minus-gap is under 25", which is a different and much harsher
    // rule; the worst case it has to survive is "Top 1%" series b, 1 unit ≈ 25.7px, which the gap
    // narrows to ≈13.7px while its 10px glyphs still sit centred inside the drawn rect.
    const texts = (gap: number) => labelledSegments(gapSpec(gap, LABELS)).map((l) => l.text);
    const plain = texts(0);
    expect(plain).toContain("1");
    for (const gap of [1, 6, 12]) expect(texts(gap), `gap ${gap}`).toEqual(plain);
  });

  it("keeps all 16 labels on 36px segments at the schema-max gap, not one per bar", () => {
    // The shape of the regression a post-shrink re-test caused: 2 categories × 8 equal series at
    // 720×400 gives 36px segments, which hold a 10px label with or without 12px off. Re-testing 25
    // against the shrunk 24px dropped 14 of 16 — and asymmetrically, because the shrink loop skips
    // each bar's LAST segment, so exactly one survivor per bar was left behind.
    const series = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"];
    const equalRows = ["Bottom 50%", "Top 1%"].flatMap((time) =>
      series.map((s) => ({ time, series: s, value: "1" })),
    ) as unknown as TidyRow[];
    const count = (gap: number) =>
      renderChart(
        { ...BASE, ...LABELS, barStack: { segmentGap: gap } } as unknown as ChartSpec,
        equalRows,
        OPTS,
      ).svg.querySelectorAll("g.tbl-segment-label text").length;
    const heights = [
      ...renderChart(
        { ...BASE, ...LABELS, barStack: { segmentGap: 12 } } as unknown as ChartSpec,
        equalRows,
        OPTS,
      ).svg.querySelectorAll('g[aria-label="bar"] rect'),
    ].map((r) => +r.getAttribute("height")!);
    // Pin the geometry the counts below depend on: 36px pre-gap, 24px after the schema max.
    expect(Math.min(...heights)).toBeGreaterThan(23);
    for (const gap of [0, 6, 12]) expect(count(gap), `gap ${gap}`).toBe(16);
  });
});

// --- Facets ---
//
// The pass groups segments by band position WITHIN their own facet group, because two panes share a
// band position and their segments must not be interleaved into one stack. Interleaved, the sort
// along the value axis would spare only one pane's bottom segment and shrink the other's — opening
// a gap below a baseline, which is precisely what this feature promises never to do. Plot's grid
// faceting is reached through renderPane's `facetInfo` (dormant for live figures, still the only
// path that produces per-facet groups — see FacetInfo in engine/index.ts).
describe("segmentGap under Plot's facet grid", () => {
  const FACET_ROWS = ROWS.map((r, i) => ({
    ...(r as unknown as Record<string, string>),
    facet: i < 3 ? "P" : "Q",
  })) as unknown as TidyRow[];

  const facetSpec = (gap: number) =>
    ({
      ...BASE,
      columns: { ...BASE.columns, facet: "facet" },
      ...(gap ? { barStack: { segmentGap: gap } } : {}),
    }) as unknown as ChartSpec;

  /** Rects grouped by facet `<g>`, then by band, ordered along the value axis. */
  const facetStacks = (gap: number): Box[][] => {
    const svg = renderPane(facetSpec(gap), FACET_ROWS, OPTS, "p0", {
      facetField: "facet",
      cellFor: new Map([
        ["P", { col: 0, row: 0, title: "P" }],
        ["Q", { col: 1, row: 0, title: "Q" }],
      ]),
      columns: 2,
      rows: 1,
    }).svg;
    const byFacet = new Map<Element, Box[]>();
    for (const r of svg.querySelectorAll('g[aria-label="bar"] rect')) {
      const facet = r.parentElement!;
      if (!byFacet.has(facet)) byFacet.set(facet, []);
      byFacet.get(facet)!.push({
        x: +r.getAttribute("x")!,
        y: +r.getAttribute("y")!,
        w: +r.getAttribute("width")!,
        h: +r.getAttribute("height")!,
      });
    }
    expect(byFacet.size).toBeGreaterThan(1);
    return [...byFacet.values()].flatMap((rects) => stacks(rects, "y"));
  };

  it("gaps each facet's stacks on their own, leaving every facet's baseline and total put", () => {
    const plain = facetStacks(0);
    const gapped = facetStacks(3);
    expect(gapped).toHaveLength(plain.length);
    plain.forEach((stack, s) => {
      const g = gapped[s]!;
      expect(g.length).toBe(stack.length);
      // Interleaving two facets' segments would spare only one facet's bottom rect and shrink the
      // other's, lifting that baseline off the axis.
      expect(g[0]!.y).toBeCloseTo(stack[0]!.y, 5);
      const lastPlain = stack[stack.length - 1]!;
      const lastGapped = g[g.length - 1]!;
      expect(lastGapped.y + lastGapped.h).toBeCloseTo(lastPlain.y + lastPlain.h, 5);
      for (let i = 0; i < g.length - 1; i++) {
        expect(g[i + 1]!.y - (g[i]!.y + g[i]!.h), `boundary ${i}`).toBeCloseTo(3, 5);
      }
    });
  });
});
