// @vitest-environment jsdom
//
// A REVERSED value axis: `yAxisPolicy: { min: 0, max: -3 }` puts -3 at the top, for indices where
// more-negative is worse (CFNAI, output gaps, deficit-as-negative). It resolves to a DESCENDING
// domain, which is what Plot wants — but it means `domain[0]` is the axis' NEAR edge (the bottom
// vertically, the left horizontally), not its numeric lower bound, so any code reading the pair as
// [lo, hi] silently inverts.
//
// The reported symptom was a `shading` threshold baseline clamping to the far edge instead of the
// threshold (also covered in shading-render.test.ts). These lock the general property: reversal
// works on every chart type, on whichever axis carries the value.
import { describe, it, expect } from "vitest";
import { renderChart, renderFigure, renderPane } from "../src/engine/index";
import { domainBounds, isReversedDomain, resolveHardDomain } from "../src/engine/scales";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";
import { TBL_VALUE_LABEL } from "../src/engine/theme";

const BASE = {
  chartType: "line",
  title: "t",
  xAxisType: "numeric",
  columns: { x: "time", value: "value", series: "series" },
} as unknown as ChartSpec;

function rows(pairs: Array<[number, number]>, series = "A"): TidyRow[] {
  return pairs.map(([t, v]) => ({ time: String(t), value: String(v), series })) as unknown as TidyRow[];
}

const OPTS = { width: 720, height: 400, document };
/** Straddles zero and fits inside both domains below, so nothing here needs clipping. */
const STRADDLING = rows([[2020, -0.2], [2021, -1.5], [2022, 0.5]]);

const UP = { min: -3, max: 1 };
const DOWN = { min: 1, max: -3 };

const render = (policy: Record<string, number>, data = STRADDLING) =>
  renderChart({ ...BASE, yAxisPolicy: policy } as unknown as ChartSpec, data, OPTS);

describe("domainBounds", () => {
  it("returns an ascending domain unchanged", () => {
    expect(domainBounds([-3, 1])).toEqual([-3, 1]);
  });

  it("sorts a descending domain", () => {
    expect(domainBounds([1, -3])).toEqual([-3, 1]);
  });

  it("passes a degenerate domain through", () => {
    expect(domainBounds([2, 2])).toEqual([2, 2]);
  });
});

describe("isReversedDomain", () => {
  it("is true only for a descending domain", () => {
    expect(isReversedDomain([1, -3])).toBe(true);
    expect(isReversedDomain([-3, 1])).toBe(false);
    expect(isReversedDomain([2, 2])).toBe(false);
  });
});

describe("resolveHardDomain", () => {
  const auto = { min: -2, max: 8 };

  it("returns null when neither bound is pinned and there is no auto extent", () => {
    expect(resolveHardDomain({})).toBeNull();
  });

  it("passes an ascending pinned pair through", () => {
    expect(resolveHardDomain({ min: 0, max: 10, auto })).toEqual([0, 10]);
  });

  it("keeps a reversed pinned pair reversed", () => {
    expect(resolveHardDomain({ min: 0, max: -4, auto })).toEqual([0, -4]);
  });

  it("fills an unpinned end from the auto extent", () => {
    expect(resolveHardDomain({ min: 0, auto })).toEqual([0, 8]);
    expect(resolveHardDomain({ max: 10, auto })).toEqual([-2, 10]);
  });

  // The asymmetry here is pre-existing behavior, preserved deliberately: a fold value beyond the
  // pinned CEILING widens it (so a reference marker above `max` stays visible), while a pinned
  // FLOOR is authoritative. Changing either would move every ascending chart that has one.
  it("lets a fold value widen a pinned ceiling but not a pinned floor", () => {
    expect(resolveHardDomain({ min: 0, max: 10, auto, fold: [14] })).toEqual([0, 14]);
    expect(resolveHardDomain({ min: 0, max: 10, auto, fold: [-9] })).toEqual([0, 10]);
  });

  // The defect this whole change exists to fix: `Math.max(policy.max, ...markerYs)` read -0.7 as
  // above -4 and collapsed the ceiling, which painted bars off the top of the canvas.
  it("never lets a fold value flip or collapse a reversed domain", () => {
    expect(resolveHardDomain({ min: 0, max: -4, auto, fold: [-0.7] })).toEqual([0, -4]);
    expect(resolveHardDomain({ min: 0, max: -4, auto, fold: [-9] })).toEqual([0, -4]);
  });

  it("widens a reversed domain's numeric ceiling, which is its `min`", () => {
    expect(resolveHardDomain({ min: 0, max: -4, auto, fold: [3] })).toEqual([3, -4]);
  });

  it("treats a single pinned bound as ascending — reversal needs both", () => {
    expect(resolveHardDomain({ min: 5, auto })).toEqual([5, 8]);
  });

  it("ignores non-finite fold values", () => {
    expect(resolveHardDomain({ min: 0, max: 10, auto, fold: [NaN, Infinity, 12] })).toEqual([0, 12]);
  });
});

describe("reversed value axis — line chart chrome", () => {
  it("puts the ticks in descending order, top to bottom", () => {
    const yTickTexts = (svg: SVGSVGElement) =>
      Array.from(svg.querySelectorAll("text"))
        .map((t) => t.textContent!)
        .filter((s) => /^-?[\d.]+$/.test(s) && Math.abs(Number(s)) <= 3);
    expect(yTickTexts(render(UP).svg)).toEqual(["-3", "-2", "-1", "0", "1"]);
    expect(yTickTexts(render(DOWN).svg)).toEqual(["1", "0", "-1", "-2", "-3"]);
  });

  it("draws the zero baseline, which is inside the domain either way", () => {
    // The zero rule is its own <g> alongside the gridline group; the count is what changes when
    // the `0 within domain` gate mis-reads a descending domain and drops it.
    const ruleGroups = (svg: SVGSVGElement) =>
      svg.querySelectorAll('g[aria-label="rule"]').length;
    expect(ruleGroups(render(UP).svg)).toBe(2);
    expect(ruleGroups(render(DOWN).svg)).toBe(2);
  });

  it("omits the zero baseline when zero is genuinely outside a reversed domain", () => {
    const { svg } = render({ min: -1, max: -3 }, rows([[2020, -1.5], [2021, -2.5]]));
    expect(svg.querySelectorAll('g[aria-label="rule"]').length).toBe(1);
  });

  it("does not clip when the data fits the reversed domain", () => {
    expect(render(UP).svg.querySelectorAll("clipPath").length).toBe(0);
    expect(render(DOWN).svg.querySelectorAll("clipPath").length).toBe(0);
  });

  it("still clips when the data overflows a reversed domain, in either direction", () => {
    // Below the numeric floor (paints past the frame BOTTOM on this axis) and above the ceiling
    // (past the frame TOP) — the gate has to fire for both.
    expect(render(DOWN, rows([[2020, -1], [2021, 4]])).svg.querySelectorAll("clipPath").length).toBe(1);
    expect(render(DOWN, rows([[2020, -1], [2021, -9]])).svg.querySelectorAll("clipPath").length).toBe(1);
  });

  it("mirrors the plotted geometry against the ascending render", () => {
    const linePath = (svg: SVGSVGElement) =>
      svg.querySelector('g[aria-label="line"] path')!.getAttribute("d")!;
    const ys = (svg: SVGSVGElement) =>
      Array.from(linePath(svg).matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)).map((m) => Number(m[2]));
    const svgUp = render(UP).svg;
    const top = Number(svgUp.getAttribute("data-margin-top"));
    const bottom = 400 - Number(svgUp.getAttribute("data-margin-bottom"));
    const upYs = ys(svgUp);
    const downYs = ys(render(DOWN).svg);
    expect(downYs.length).toBe(upYs.length);
    downYs.forEach((y, i) => expect(y).toBeCloseTo(top + bottom - upYs[i]!, 6));
  });

  it("places a yAxis reference line and its label at the mirrored position", () => {
    // -2 is deliberately OFF-CENTER in [-3, 1] — a mid-domain value sits at the same pixel in both
    // orientations and would pass even if the mapping were wrong.
    const markers = { markers: [{ y: -2, label: "threshold" }] };
    const ruleY = (svg: SVGSVGElement) =>
      Number(
        svg
          .querySelector('g[class^="tbl-annotation-line"] line')!
          .getAttribute("y1"),
      );
    const labelY = (svg: SVGSVGElement) =>
      Number(
        Array.from(svg.querySelectorAll("text"))
          .find((t) => t.textContent === "threshold")!
          .getAttribute("transform")!
          .match(/translate\([\d.-]+,([\d.-]+)\)/)![1],
      );
    const svgUp = render({ ...UP, ...markers } as never).svg;
    const svgDown = render({ ...DOWN, ...markers } as never).svg;
    const top = Number(svgUp.getAttribute("data-margin-top"));
    const bottom = 400 - Number(svgUp.getAttribute("data-margin-bottom"));
    expect(ruleY(svgDown)).toBeCloseTo(top + bottom - ruleY(svgUp), 6);
    // The label's own dy is a fixed pixel offset ABOVE its rule in both orientations, so it lands
    // that offset off a pure mirror rather than on it.
    expect(labelY(svgDown) - ruleY(svgDown)).toBeCloseTo(labelY(svgUp) - ruleY(svgUp), 6);
  });
});

// ---------------------------------------------------------------------------------------------
// Per-chart-type coverage. SPECS holds one minimal spec + data per chart type, with the value
// axis pinned by `policy(lo, hi)` so each case can be rendered ascending and reversed from the
// same source. `valueOnX` marks the types whose VALUE axis is horizontal — the mirror runs across
// x there, not y.
// ---------------------------------------------------------------------------------------------

interface TypeCase {
  name: string;
  spec: Record<string, unknown>;
  rows: TidyRow[];
  /** Value-axis bounds to pin, chosen to contain this case's data with room to spare. */
  bounds: [number, number];
  /** True when the value axis is x (horizontal orientation). */
  valueOnX?: boolean;
  /** A value inside `bounds` that a reference marker can sit at, for the folding tests. */
  markerAt?: number;
}

const cat = (pairs: Array<[string, number]>, extra: Record<string, string> = {}) =>
  pairs.map(([c, v]) => ({ cat: c, value: String(v), ...extra })) as unknown as TidyRow[];

const TYPE_CASES: TypeCase[] = [
  {
    name: "line",
    spec: { chartType: "line", title: "t", xAxisType: "numeric", columns: { x: "time", value: "value", series: "series" } },
    rows: rows([[2020, -0.2], [2021, -1.5], [2022, 0.5]]),
    bounds: [-3, 1],
    markerAt: -0.7,
  },
  {
    name: "bar",
    spec: { chartType: "bar", title: "t", xAxisType: "categorical", columns: { x: "cat", value: "value" } },
    rows: cat([["a", -1], ["b", -2.5], ["c", -0.5]]),
    bounds: [-4, 0],
    markerAt: -0.7,
  },
  {
    name: "bar horizontal",
    spec: { chartType: "bar", title: "t", xAxisType: "categorical", orientation: "horizontal", columns: { x: "cat", value: "value" } },
    rows: cat([["a", -1], ["b", -2.5], ["c", -0.5]]),
    bounds: [-4, 0],
    valueOnX: true,
  },
  {
    name: "stacked",
    spec: { chartType: "stacked", title: "t", xAxisType: "categorical", columns: { x: "cat", value: "value", series: "series" }, series_order: ["S1", "S2"] },
    rows: [...cat([["a", 1], ["b", 2]], { series: "S1" }), ...cat([["a", 2], ["b", 1]], { series: "S2" })],
    bounds: [0, 6],
    markerAt: 4,
  },
  {
    name: "area",
    spec: { chartType: "area", title: "t", xAxisType: "numeric", columns: { x: "time", value: "value", series: "series" }, series_order: ["S1", "S2"] },
    rows: [
      ...rows([[2020, 1], [2021, 2]], "S1"),
      ...rows([[2020, 2], [2021, 1]], "S2"),
    ],
    bounds: [0, 6],
    markerAt: 4,
  },
  {
    name: "scatter",
    spec: { chartType: "scatter", title: "t", xAxisType: "numeric", columns: { x: "time", value: "value", series: "series" } },
    rows: rows([[10, 5], [20, 9], [30, 2]]),
    bounds: [0, 12],
    markerAt: 6,
  },
  {
    name: "dotplot",
    spec: { chartType: "dotplot", title: "t", xAxisType: "categorical", columns: { x: "cat", value: "value", series: "series" } },
    rows: cat([["a", 3], ["b", 7], ["c", 5]], { series: "S1" }),
    bounds: [0, 10],
    markerAt: 6,
  },
  {
    name: "dumbbell",
    // Dumbbell defaults to HORIZONTAL (`spec.orientation !== "vertical"`), so the vertical case
    // has to say so explicitly — omitting it puts the value axis on x.
    spec: { chartType: "dumbbell", title: "t", xAxisType: "categorical", orientation: "vertical", columns: { category: "cat", series: "series", value: "value" }, series_order: ["Pre", "Post"] },
    rows: [...cat([["a", 3], ["b", 5]], { series: "Pre" }), ...cat([["a", 7], ["b", 9]], { series: "Post" })],
    bounds: [0, 12],
    markerAt: 6,
  },
  {
    name: "dumbbell horizontal",
    spec: { chartType: "dumbbell", title: "t", xAxisType: "categorical", orientation: "horizontal", columns: { category: "cat", series: "series", value: "value" }, series_order: ["Pre", "Post"] },
    rows: [...cat([["a", 3], ["b", 5]], { series: "Pre" }), ...cat([["a", 7], ["b", 9]], { series: "Post" })],
    bounds: [0, 12],
    valueOnX: true,
  },
  {
    name: "waterfall",
    spec: { chartType: "waterfall", title: "t", xAxisType: "categorical", columns: { x: "cat", value: "value", kind: "kind" }, valueLabels: { show: true } },
    rows: [
      { cat: "a", value: "-2", kind: "" },
      { cat: "b", value: "-1", kind: "" },
      { cat: "c", value: "", kind: "total" },
    ] as unknown as TidyRow[],
    bounds: [-6, 0],
    markerAt: -1,
  },
  {
    name: "histogram",
    spec: { chartType: "histogram", title: "t", xAxisType: "numeric", columns: { x: "amount" }, histogram: { bins: 4, domain: [0, 20] } },
    rows: [2, 3, 4, 7, 8, 12, 13, 14, 18].map((v) => ({ amount: String(v) })) as unknown as TidyRow[],
    bounds: [0, 6],
    markerAt: 3,
  },
];

const pinned = (c: TypeCase, reversed: boolean, extra: Record<string, unknown> = {}) => {
  const [lo, hi] = c.bounds;
  return {
    ...c.spec,
    yAxisPolicy: { ...(reversed ? { min: hi, max: lo } : { min: lo, max: hi }), ...extra },
  } as unknown as ChartSpec;
};

describe("reversed value axis — the pinned domain survives marker folding", () => {
  // `Math.max(policy.max, ...markerYs)` collapsed a reversed ceiling: {min: 0, max: -4} with a
  // marker at -0.7 resolved to [0, -0.7], which painted the first bar at y = -136 on a 400px canvas.
  for (const c of TYPE_CASES.filter((t) => t.markerAt != null)) {
    it(`${c.name}: a marker inside the domain does not move either bound`, () => {
      const [lo, hi] = c.bounds;
      const spec = pinned(c, true, { markers: [{ y: c.markerAt, label: "th" }] });
      expect(renderPane(spec, c.rows, OPTS).yDomain).toEqual([hi, lo]);
    });

    it(`${c.name}: ascending resolves to the same pair, mirrored`, () => {
      const [lo, hi] = c.bounds;
      const spec = pinned(c, false, { markers: [{ y: c.markerAt, label: "th" }] });
      expect(renderPane(spec, c.rows, OPTS).yDomain).toEqual([lo, hi]);
    });
  }
});

/** Plot's group labels for DATA marks. Deliberately excludes "rule" (gridlines, the zero baseline
 *  and annotation lines) and "text" (labels carry a fixed pixel dy that is not mirrored). */
const DATA_MARKS = ['g[aria-label="bar"]', 'g[aria-label="rect"]', 'g[aria-label="area"]',
  'g[aria-label="line"]', 'g[aria-label="dot"]', 'g[aria-label="link"]'].join(",");

/**
 * Value-axis coordinates of every data mark, grouped per SVG element in document order. Covers
 * each element shape Plot emits: rects by both edges, lines/links by both ends, circles by center,
 * paths by every vertex in their `d`.
 *
 * Grouping per element matters for the mirror comparison. A `<rect>`'s `y` is always its TOP edge,
 * so mirroring swaps which of its two coordinates is which — the element's coordinate SET mirrors
 * even though the attribute order does not. Element order across the two renders is stable (same
 * marks, same data), so pairing survives at the element level.
 *
 * Coordinates are made ABSOLUTE via `absPos`. A symbol marker is a `<path>` whose `d` is local
 * geometry around the origin plus a `translate()` to its data position, so reading `d` alone reports
 * a dot near y = 0 regardless of where it actually paints.
 */
function valueCoordGroups(svg: SVGSVGElement, onX: boolean): number[][] {
  const groups: number[][] = [];
  const num = (el: Element, attr: string) => Number(el.getAttribute(attr));
  for (const g of Array.from(svg.querySelectorAll(DATA_MARKS))) {
    for (const el of Array.from(g.querySelectorAll("rect,line,circle,path"))) {
      const out: number[] = [];
      switch (el.tagName) {
        case "rect": {
          const base = num(el, onX ? "x" : "y");
          out.push(base, base + num(el, onX ? "width" : "height"));
          break;
        }
        case "line":
          out.push(num(el, onX ? "x1" : "y1"), num(el, onX ? "x2" : "y2"));
          break;
        case "circle":
          out.push(num(el, onX ? "cx" : "cy"));
          break;
        case "path": {
          const d = el.getAttribute("d") ?? "";
          for (const m of d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)) out.push(Number(m[onX ? 1 : 2]));
          break;
        }
      }
      if (!out.length) continue;
      const off = absPos(el);
      const delta = onX ? off.x : off.y;
      groups.push(out.map((v) => v + delta));
    }
  }
  return groups;
}

const valueCoords = (svg: SVGSVGElement, onX: boolean): number[] =>
  valueCoordGroups(svg, onX).flat();

/** The value axis' frame edges in pixels, read off the SVG's own margin attributes. */
function frame(svg: SVGSVGElement, onX: boolean): [number, number] {
  const a = (n: string) => Number(svg.getAttribute(n));
  return onX
    ? [a("data-margin-left"), 720 - a("data-margin-right")]
    : [a("data-margin-top"), 400 - a("data-margin-bottom")];
}

/** Plot offsets mark groups by half a pixel for crisp strokes, which lands in both renders and so
 *  shifts the mirror line by up to 1px off the frame's own mid-line. Every tolerance below is that
 *  offset, not slack — the defects being guarded against were off by 90 to 156 pixels. */
const CRISP = 1;

/**
 * Assert one render is the other reflected about the value axis' mid-line.
 *
 * Stated as symmetry rather than as absolute positions: for every mark coordinate, `ascending +
 * reversed` must be the SAME constant, and that constant must be the sum of the frame's two edges.
 * Requiring one shared constant is what makes this a mirror rather than merely "both inside the
 * frame", and deriving it from the data instead of hard-coding it keeps the half-pixel offset from
 * masquerading as an asymmetry.
 */
function expectMirrored(asc: SVGSVGElement, rev: SVGSVGElement, onX: boolean): void {
  const up = valueCoordGroups(asc, onX);
  const down = valueCoordGroups(rev, onX);
  expect(up.length).toBeGreaterThan(0);
  expect(down.length).toBe(up.length);

  const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
  const sums: number[] = [];
  up.forEach((coords, k) => {
    // Within one element the coordinate ORDER flips (a rect's `y` is always its top edge), so pair
    // the sorted lists head-to-tail.
    const a = sorted(coords);
    const b = sorted(down[k]!);
    expect(b.length).toBe(a.length);
    a.forEach((v, i) => sums.push(v + b[a.length - 1 - i]!));
  });

  // Plot applies its half-pixel offset per mark GROUP, so a chart mixing groups (waterfall's bars
  // and connectors, a line and its confidence band) mirrors about lines up to 1px apart. Requiring
  // the sums to agree with each other AND with the frame's mid-line to within that offset is the
  // tightest true statement; the defects this guards against were 90 to 156 pixels out.
  const [lo, hi] = frame(asc, onX);
  expect(Math.max(...sums) - Math.min(...sums)).toBeLessThanOrEqual(CRISP);
  for (const s of sums) {
    expect(s).toBeGreaterThanOrEqual(lo + hi - CRISP);
    expect(s).toBeLessThanOrEqual(lo + hi + CRISP);
  }
}

describe("reversed value axis — every chart type mirrors its ascending render", () => {
  for (const c of TYPE_CASES) {
    it(`${c.name}`, () => {
      const onX = c.valueOnX === true;
      expectMirrored(
        renderChart(pinned(c, false), c.rows, OPTS).svg,
        renderChart(pinned(c, true), c.rows, OPTS).svg,
        onX,
      );
    });
  }
});

describe("reversed value axis — no chart type paints outside the frame", () => {
  // The invariant the marker-fold defect broke: a collapsed reversed ceiling put the first bar at
  // y = -136 with height 514 on a 400px canvas, over the title and off the top of the SVG.
  for (const c of TYPE_CASES) {
    for (const reversed of [false, true]) {
      it(`${c.name}${reversed ? " reversed" : ""}${c.markerAt != null ? " + marker" : ""}`, () => {
        const onX = c.valueOnX === true;
        const spec = pinned(c, reversed, c.markerAt != null ? { markers: [{ y: c.markerAt, label: "th" }] } : {});
        const svg = renderChart(spec, c.rows, OPTS).svg;
        const [lo, hi] = frame(svg, onX);
        const coords = valueCoords(svg, onX);
        expect(coords.length).toBeGreaterThan(0);
        for (const v of coords) {
          expect(v).toBeGreaterThanOrEqual(lo - CRISP);
          expect(v).toBeLessThanOrEqual(hi + CRISP);
        }
      });
    }
  }
});

/**
 * Absolute painted position of an element, summing every `translate()` from it up to the <svg>.
 *
 * Plot splits a text mark's position across two levels: the element's own transform carries the
 * DATA position, while `dx`/`dy` land on the mark's wrapping <g>. Reading only the element would
 * miss the offset entirely — and the offset is the thing under test.
 */
function absPos(el: Element): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (let node: Element | null = el; node && node.tagName !== "svg"; node = node.parentElement) {
    const m = (node.getAttribute("transform") ?? "").match(/translate\((-?[\d.]+)(?:[ ,]+(-?[\d.]+))?\)/);
    if (m) {
      x += Number(m[1]);
      y += Number(m[2] ?? 0);
    }
  }
  return { x, y };
}

/** Every text element keyed by content + painted position, so two renders can be diffed. */
function textAt(svg: SVGSVGElement): Map<string, { x: number; y: number; text: string }> {
  const out = new Map<string, { x: number; y: number; text: string }>();
  for (const t of Array.from(svg.querySelectorAll("text"))) {
    const { x, y } = absPos(t);
    const text = t.textContent ?? "";
    out.set(`${text}@${x},${y}`, { x, y, text });
  }
  return out;
}

/**
 * The value labels a spec draws, identified by rendering it twice — `valueLabels.show` on and off —
 * and keeping the texts only the ON render has. Independent of any class or DOM position, so it
 * cannot silently start matching axis ticks or category labels.
 */
function valueLabels(spec: ChartSpec, data: TidyRow[]): Array<{ x: number; y: number; text: string }> {
  const on = textAt(renderChart({ ...spec, valueLabels: { show: true } } as ChartSpec, data, OPTS).svg);
  const off = textAt(renderChart({ ...spec, valueLabels: { show: false } } as ChartSpec, data, OPTS).svg);
  return [...on].filter(([k]) => !off.has(k)).map(([, v]) => v);
}

interface Bar {
  /** Band center, which is where a value label for this bar is anchored. */
  cx: number;
  top: number;
  bottom: number;
}

const bars = (svg: SVGSVGElement): Bar[] =>
  Array.from(svg.querySelectorAll('g[aria-label="bar"] rect')).map((r) => {
    const n = (a: string) => Number(r.getAttribute(a));
    return { cx: n("x") + n("width") / 2, top: n("y"), bottom: n("y") + n("height") };
  });

/** The bar a label belongs to: same band center, and tall enough to have an interior. A waterfall
 *  `total` bar spans back to zero and so overlaps other steps' label rows — pairing by x is what
 *  keeps this about the label's OWN bar. */
const ownBar = (label: { x: number }, all: Bar[]): Bar | undefined =>
  all.find((b) => Math.abs(b.cx - label.x) < 1 && b.bottom - b.top >= 1);

describe("reversed value axis — value labels stay clear of their bar", () => {
  // `dy: rising ? -gap : gapBelow` mixes a DATA-space test (`rising` is value >= 0) with a PIXEL
  // offset. On a reversed axis a rising bar grows downward in pixels, so the label lands inside the
  // bar. Asserting "no value label is painted within a bar's span" states the requirement without
  // hard-coding which side is correct for which case.
  const WF = TYPE_CASES.find((t) => t.name === "waterfall")!;

  for (const reversed of [false, true]) {
    it(`waterfall${reversed ? " reversed" : ""}: no running-total label lands inside its own bar`, () => {
      const spec = pinned(WF, reversed);
      const svg = renderChart({ ...spec, valueLabels: { show: true } } as ChartSpec, WF.rows, OPTS).svg;
      const labels = valueLabels(spec, WF.rows);
      const all = bars(svg);
      expect(labels.length).toBeGreaterThan(0);
      let checked = 0;
      for (const l of labels) {
        const b = ownBar(l, all);
        if (!b) continue;
        checked++;
        expect(l.y > b.top && l.y < b.bottom).toBe(false);
      }
      expect(checked).toBeGreaterThan(0);
    });
  }

  // The two gaps are NOT interchangeable and the flip must pick by pixel side, not by data sign:
  // text grows downward from its baseline, so a label placed BELOW a bar end needs more clearance
  // (gapBelow) than one placed above it (gap). Plot renders a mark's dx/dy as a group translate with
  // a half-pixel crispness offset, hence the ±0.5.
  for (const reversed of [false, true]) {
    it(`waterfall${reversed ? " reversed" : ""}: each label clears its bar end by the gap for the side it lands on`, () => {
      const spec = pinned(WF, reversed);
      const svg = renderChart({ ...spec, valueLabels: { show: true } } as ChartSpec, WF.rows, OPTS).svg;
      const all = bars(svg);
      let checked = 0;
      for (const l of valueLabels(spec, WF.rows)) {
        const b = ownBar(l, all);
        if (!b) continue;
        checked++;
        const above = l.y < b.top;
        const dist = above ? b.top - l.y : l.y - b.bottom;
        expect(dist).toBeCloseTo(
          above ? TBL_VALUE_LABEL.gap - 0.5 : TBL_VALUE_LABEL.gapBelow + 0.5,
          6,
        );
      }
      expect(checked).toBeGreaterThan(0);
    });
  }

  // The net total on a cumulative stack is drawn regardless of valueLabels.show, so the diff-based
  // valueLabels() cannot see it — find it by content instead (every category here totals 3, while
  // the segments are 1 and 2).
  for (const reversed of [false, true]) {
    it(`stacked${reversed ? " reversed" : ""}: the net-total label sits outside its stack`, () => {
      const ST = TYPE_CASES.find((t) => t.name === "stacked")!;
      const spec = pinned(ST, reversed);
      const svg = renderChart({ ...spec, valueLabels: { show: true } } as ChartSpec, ST.rows, OPTS).svg;
      const all = bars(svg);
      const nets = [...textAt(svg).values()].filter((t) => t.text.replace(/[^\d.-]/g, "") === "3");
      expect(nets.length).toBeGreaterThan(0);
      let checked = 0;
      for (const l of nets) {
        // A stack's segments share the band, so "its stack" is the union of the bars at this x.
        const stack = all.filter((b) => Math.abs(b.cx - l.x) < 1 && b.bottom - b.top >= 1);
        if (!stack.length) continue;
        checked++;
        const top = Math.min(...stack.map((b) => b.top));
        const bottom = Math.max(...stack.map((b) => b.bottom));
        expect(l.y > top && l.y < bottom).toBe(false);
      }
      expect(checked).toBeGreaterThan(0);
    });
  }
});

describe("reversed value axis — autoWiden extends the end the data overflows", () => {
  const wide = (policy: Record<string, unknown>, data: TidyRow[]) =>
    renderPane({ ...BASE, yAxisPolicy: policy } as unknown as ChartSpec, data, OPTS).yDomain;

  it("raises the ceiling on an ascending axis, as it always has", () => {
    expect(wide({ min: 0, max: 4, autoWiden: { step: 2 } }, rows([[2020, 1], [2021, 5]]))).toEqual([0, 6]);
  });

  it("lowers the floor on a reversed axis, where `max` IS the floor", () => {
    expect(wide({ min: 0, max: -4, autoWiden: { step: 2 } }, rows([[2020, -1], [2021, -5]]))).toEqual([0, -6]);
  });

  it("leaves a reversed axis alone when the data fits", () => {
    expect(wide({ min: 0, max: -4, autoWiden: { step: 2 } }, rows([[2020, -1], [2021, -3]]))).toEqual([0, -4]);
  });

  // Overflow past `min` is the numeric CEILING, which autoWiden has never handled in either
  // orientation — the clip gate is what keeps that data inside the frame.
  it("does not widen a reversed axis for data overflowing the other end", () => {
    expect(wide({ min: 0, max: -4, autoWiden: { step: 2 } }, rows([[2020, 3], [2021, -1]]))).toEqual([0, -4]);
  });
});

describe("reversed value axis — degenerate and boundary data", () => {
  it("holds the domain when every value sits exactly on a bound", () => {
    const svg = renderChart(
      { ...BASE, yAxisPolicy: { min: 0, max: -4 } } as unknown as ChartSpec,
      rows([[2020, 0], [2021, -4], [2022, 0]]),
      OPTS,
    ).svg;
    const [lo, hi] = frame(svg, false);
    // Flush against both edges is not overflow, so nothing clips.
    expect(svg.querySelectorAll("clipPath").length).toBe(0);
    const coords = valueCoords(svg, false);
    expect(Math.abs(Math.min(...coords) - lo)).toBeLessThanOrEqual(CRISP);
    expect(Math.abs(Math.max(...coords) - hi)).toBeLessThanOrEqual(CRISP);
  });

  it("handles a single data point", () => {
    const svg = renderChart(
      { ...BASE, yAxisPolicy: { min: 0, max: -4 }, points: true } as unknown as ChartSpec,
      rows([[2020, -1]]),
      OPTS,
    ).svg;
    const [lo, hi] = frame(svg, false);
    for (const v of valueCoords(svg, false)) {
      expect(v).toBeGreaterThanOrEqual(lo - 1e-6);
      expect(v).toBeLessThanOrEqual(hi + 1e-6);
    }
  });

  it("handles all-zero data on a reversed bar axis", () => {
    const spec = {
      chartType: "bar", title: "t", xAxisType: "categorical",
      columns: { x: "cat", value: "value" }, yAxisPolicy: { min: 4, max: -4 },
    } as unknown as ChartSpec;
    const data = [["a", 0], ["b", 0]].map(([c, v]) => ({ cat: c, value: String(v) })) as unknown as TidyRow[];
    expect(renderPane(spec, data, OPTS).yDomain).toEqual([4, -4]);
  });

  it("mirrors data lying entirely on one side of zero", () => {
    const oneSided = rows([[2020, -1], [2021, -3], [2022, -2]]);
    expectMirrored(
      renderChart({ ...BASE, yAxisPolicy: { min: -4, max: 0 } } as unknown as ChartSpec, oneSided, OPTS).svg,
      renderChart({ ...BASE, yAxisPolicy: { min: 0, max: -4 } } as unknown as ChartSpec, oneSided, OPTS).svg,
      false,
    );
  });
});

describe("reversed value axis — interactions with other features", () => {
  it("keeps a 100%-normalized stack reversed, putting 100 at the bottom", () => {
    const spec = {
      chartType: "stacked", title: "t", xAxisType: "categorical",
      columns: { x: "cat", value: "value", series: "series" }, series_order: ["S1", "S2"],
      barStack: { normalize: true }, yAxisPolicy: { min: 100, max: 0 },
    } as unknown as ChartSpec;
    const data = [
      { cat: "a", value: "1", series: "S1" }, { cat: "a", value: "3", series: "S2" },
    ] as unknown as TidyRow[];
    const { svg, yDomain } = renderPane(spec, data, OPTS);
    expect(yDomain).toEqual([100, 0]);
    // A normalized stack fills the frame either way; reversal only decides which series is against
    // which edge, so the union of its segments must still span exactly frame top to frame bottom.
    const [top, bottom] = frame(svg, false);
    const spans = bars(svg);
    expect(Math.abs(Math.min(...spans.map((b) => b.top)) - top)).toBeLessThanOrEqual(CRISP);
    expect(Math.abs(Math.max(...spans.map((b) => b.bottom)) - bottom)).toBeLessThanOrEqual(CRISP);
  });

  it("shares ONE reversed domain across small-multiples panes", () => {
    const spec = {
      ...BASE,
      columns: { x: "time", value: "value", series: "series", facet: "facet" },
      small_multiples: { columns: 2, mode: "shared" },
      yAxisPolicy: { min: 0, max: -4 },
    } as unknown as ChartSpec;
    const data = [
      { time: "2020", value: "-1", series: "A", facet: "P" },
      { time: "2021", value: "-2", series: "A", facet: "P" },
      { time: "2020", value: "-3", series: "A", facet: "Q" },
      { time: "2021", value: "-1", series: "A", facet: "Q" },
    ] as unknown as TidyRow[];
    const fig = renderFigure(spec, data, OPTS);
    expect(fig.panes.length).toBe(2);
    // figure.ts unions the per-pane domains with min-of-firsts / max-of-seconds, which must not
    // silently sort a reversed pair back to ascending.
    let checked = 0;
    for (const p of fig.panes) {
      const ticks = Array.from(p.svg!.querySelectorAll("text"))
        .map((t) => t.textContent!)
        .filter((s) => /^-?[\d.]+$/.test(s) && Math.abs(Number(s)) <= 4);
      if (!ticks.length) continue;
      checked++;
      expect(Number(ticks[0])).toBeGreaterThan(Number(ticks[ticks.length - 1]));
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("mirrors a confidence band with its line", () => {
    const spec = {
      ...BASE, series_order: ["A"], confidence_bands: [{ series: "A", lower: "lo", upper: "hi" }],
    } as unknown as ChartSpec;
    const data = [
      { time: "2020", value: "-1", series: "A", lo: "-1.5", hi: "-0.5" },
      { time: "2021", value: "-2", series: "A", lo: "-2.5", hi: "-1.5" },
    ] as unknown as TidyRow[];
    expectMirrored(
      renderChart({ ...spec, yAxisPolicy: { min: -4, max: 0 } } as ChartSpec, data, OPTS).svg,
      renderChart({ ...spec, yAxisPolicy: { min: 0, max: -4 } } as ChartSpec, data, OPTS).svg,
      false,
    );
  });

  // The leader's data-space offset divides by the SIGNED domain span, so a positive `dy` (which the
  // spec defines as UP) has to stay visually up when the axis is reversed.
  it("points a callout connector the same way in both orientations", () => {
    const leader = (policy: Record<string, number>) => {
      const spec = {
        ...BASE, yAxisPolicy: policy,
        annotations: { points: [{ x: "2021", y: -2, label: "here", connector: true, dy: 20 }] },
      } as unknown as ChartSpec;
      const svg = renderChart(spec, rows([[2020, -1], [2021, -2], [2022, -3]]), OPTS).svg;
      const d = svg.querySelector('g[aria-label="arrow"] path')!.getAttribute("d")!;
      const ys = Array.from(d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)).map((m) => Number(m[2]));
      return { top: Math.min(...ys), bottom: Math.max(...ys) };
    };
    for (const policy of [{ min: -4, max: 0 }, { min: 0, max: -4 }]) {
      const l = leader(policy);
      expect(l.top).toBeLessThan(l.bottom);
    }
    // And the two renders mirror: the leader spans the same distance either way.
    const asc = leader({ min: -4, max: 0 });
    const rev = leader({ min: 0, max: -4 });
    expect(rev.bottom - rev.top).toBeCloseTo(asc.bottom - asc.top, 6);
  });
});
