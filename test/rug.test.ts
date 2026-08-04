// @vitest-environment jsdom
//
// The x-axis rug: track resolution (pure), the margin/label geometry that opens room for the strip,
// and the injected block geometry. The michez-rule chart is the motivating case — a one-month
// false-positive run on a 26-year axis is a hairline as a fill, so it becomes a solid block here.
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import { RUG_CLASS } from "../src/engine/rug";
import { buildExportSvg } from "../src/embed/export-png";
import { resolveRugTracks, rugAllowance, RUG_GAP, RUG_PAD } from "../src/spec/rug";
import { validateSpec } from "../src/spec/validate";
import { TBL_COLORS } from "../src/engine/palette";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const BASE = {
  chartType: "line",
  title: "t",
  xAxisType: "numeric",
  columns: { x: "time", value: "value" },
} as unknown as ChartSpec;

const DATA: TidyRow[] = [
  { time: "2000", value: "1" },
  { time: "2010", value: "4" },
  { time: "2020", value: "2" },
] as unknown as TidyRow[];

const OPTS = { width: 720, height: 400, document };

const blocks = (svg: SVGSVGElement) =>
  Array.from(svg.querySelectorAll<SVGRectElement>(`g.${RUG_CLASS} rect`));
const num = (el: Element, attr: string): number => Number(el.getAttribute(attr));

const MICHEZ = {
  ...BASE,
  annotations: {
    bands: [
      { start: "2001", end: "2002", color: "grey", label: "US recessions", rug: true },
      { start: "2008", end: "2009", color: "grey", label: "US recessions", rug: true },
    ],
  },
  shading: [
    { from: "2001", to: "2002", label: "False negatives", color: "amber", rug: true },
    { from: "2015", to: "2016", label: "False positives", color: "red", rug: true },
    { from: "2018", to: "2019", label: "False positives", color: "red", rug: true },
  ],
  rug: {},
} as ChartSpec;

describe("resolveRugTracks", () => {
  it("groups flagged bands and shading by label, bands first", () => {
    expect(resolveRugTracks(MICHEZ).map((t) => [t.label, t.origin, t.intervals.length])).toEqual([
      ["US recessions", "bands", 2],
      ["False negatives", "shading", 1],
      ["False positives", "shading", 2],
    ]);
  });

  it("appends explicit tracks after the derived ones", () => {
    const spec = {
      ...MICHEZ,
      rug: { tracks: [{ label: "Policy", color: "blue", intervals: [{ from: "2004", to: "2006" }] }] },
    } as ChartSpec;
    expect(resolveRugTracks(spec).map((t) => t.label)).toEqual([
      "US recessions",
      "False negatives",
      "False positives",
      "Policy",
    ]);
  });

  it("skips flags that cannot yield a closed interval", () => {
    const spec = {
      ...BASE,
      annotations: { bands: [{ start: "2001", end: "2002", rug: true }] }, // no label
      shading: [{ label: "Open", rug: true, from: "2001" }], // no `to`
      rug: {},
    } as ChartSpec;
    expect(resolveRugTracks(spec)).toEqual([]);
  });

  it("resolves nothing for a chart with no rug flags", () => {
    expect(resolveRugTracks(BASE)).toEqual([]);
    expect(rugAllowance(BASE)).toBe(0);
  });
});

describe("rug geometry", () => {
  it("grows marginBottom by the allowance and pushes the tick labels down with it", () => {
    const plain = renderChart(BASE, DATA, OPTS).svg;
    const rugged = renderChart(MICHEZ, DATA, OPTS).svg;
    const allowance = rugAllowance(MICHEZ);
    expect(allowance).toBe(RUG_GAP + 8 + RUG_PAD);
    expect(Number(rugged.dataset.marginBottom) - Number(plain.dataset.marginBottom)).toBe(allowance);

    // The tick labels keep their distance below the axis: the frame bottom rose by the allowance
    // and the labels moved down by it, so their absolute y is unchanged.
    const tickY = (svg: SVGSVGElement): number[] =>
      Array.from(svg.querySelectorAll("text"))
        .filter((t) => /^\d{4}$/.test(t.textContent ?? ""))
        .map((t) => Number(t.getAttribute("y")));
    expect(tickY(rugged)).toEqual(tickY(plain));
  });

  it("draws the strip below the frame, above the tick labels", () => {
    const { svg } = renderChart(MICHEZ, DATA, OPTS);
    const frameBottom = 400 - Number(svg.dataset.marginBottom);
    const rects = blocks(svg);
    expect(rects.length).toBe(5);
    for (const r of rects) {
      expect(num(r, "y")).toBe(frameBottom + RUG_GAP);
      expect(num(r, "height")).toBe(8);
    }
  });

  it("honors rug.height in both the strip and the allowance", () => {
    const spec = { ...MICHEZ, rug: { height: 14 } } as ChartSpec;
    const { svg } = renderChart(spec, DATA, OPTS);
    expect(rugAllowance(spec)).toBe(RUG_GAP + 14 + RUG_PAD);
    expect(num(blocks(svg)[0]!, "height")).toBe(14);
  });

  it("places blocks on the chart's own x scale", () => {
    const spec = {
      ...BASE,
      rug: { tracks: [{ label: "Half", color: "blue", intervals: [{ from: "2010", to: "2020" }] }] },
    } as ChartSpec;
    const { svg } = renderChart(spec, DATA, OPTS);
    const ml = Number(svg.dataset.marginLeft);
    const mr = Number(svg.dataset.marginRight);
    const rect = blocks(svg)[0]!;
    // 2010→2020 is the upper half of a 2000–2020 domain.
    expect(num(rect, "x")).toBeCloseTo(ml + (720 - ml - mr) / 2, 1);
    expect(num(rect, "width")).toBeCloseTo((720 - ml - mr) / 2, 1);
  });

  it("floors a sub-pixel interval at 2px so it stays visible", () => {
    const spec = {
      ...BASE,
      rug: { tracks: [{ label: "Blip", color: "red", intervals: [{ from: "2010", to: "2010" }] }] },
    } as ChartSpec;
    const { svg } = renderChart(spec, DATA, OPTS);
    expect(num(blocks(svg)[0]!, "width")).toBe(2);
  });

  it("clamps a block that overruns the domain and drops one wholly outside it", () => {
    const spec = {
      ...BASE,
      rug: {
        tracks: [
          { label: "Overrun", color: "red", intervals: [{ from: "1990", to: "2005" }] },
          { label: "Elsewhere", color: "blue", intervals: [{ from: "2050", to: "2060" }] },
        ],
      },
    } as ChartSpec;
    const { svg } = renderChart(spec, DATA, OPTS);
    const rects = blocks(svg);
    expect(rects.length).toBe(1);
    expect(num(rects[0]!, "x")).toBe(Number(svg.dataset.marginLeft));
  });

  it("paints tracks in resolution order, later over earlier", () => {
    const { svg } = renderChart(MICHEZ, DATA, OPTS);
    // grey (recessions) first, then amber, then the two reds.
    const fills = blocks(svg).map((r) => r.getAttribute("fill"));
    expect(new Set(fills.slice(0, 2)).size).toBe(1);
    expect(fills[3]).toBe(fills[4]);
  });

  it("emits no strip at all when the chart has no tracks", () => {
    expect(blocks(renderChart(BASE, DATA, OPTS).svg).length).toBe(0);
  });

  it("works on a temporal axis", () => {
    const spec = {
      ...BASE,
      xAxisType: "temporal",
      annotations: {
        bands: [{ start: "2001-04-01", end: "2001-12-01", label: "Recession", color: "grey", rug: true }],
      },
      rug: {},
    } as unknown as ChartSpec;
    const data = [
      { time: "2000-01-01", value: "1" },
      { time: "2010-01-01", value: "2" },
    ] as unknown as TidyRow[];
    const { svg, legendItems } = renderChart(spec, data, OPTS);
    expect(blocks(svg).length).toBe(1);
    expect(legendItems?.map((i) => i.label)).toEqual(["Recession"]);
  });
});

describe("rug legend keying", () => {
  it("keys every derived track once, in strip order", () => {
    expect(renderChart(MICHEZ, DATA, OPTS).legendItems?.map((i) => i.label)).toEqual([
      "US recessions",
      "False negatives",
      "False positives",
    ]);
  });

  it("keys an explicit track too", () => {
    const spec = {
      ...BASE,
      rug: { tracks: [{ label: "Policy", color: "blue", intervals: [{ from: "2004", to: "2006" }] }] },
    } as ChartSpec;
    const rows = renderChart(spec, DATA, OPTS).legendItems ?? [];
    expect(rows.map((r) => [r.label, r.markerShape, r.color])).toEqual([
      ["Policy", "rect", TBL_COLORS.blue],
    ]);
  });

  it("`legend: false` on an explicit track draws the blocks unkeyed", () => {
    const spec = {
      ...BASE,
      rug: {
        tracks: [{ label: "Policy", color: "blue", legend: false, intervals: [{ from: "2004", to: "2006" }] }],
      },
    } as ChartSpec;
    const { svg, legendItems } = renderChart(spec, DATA, OPTS);
    expect(blocks(svg).length).toBe(1);
    expect(legendItems).toBeNull();
  });
});

describe("rug + annotation legend in the PNG export", () => {
  it("carries the strip and keys it in the exported legend", () => {
    const svg = buildExportSvg(MICHEZ, DATA);
    expect(svg.querySelectorAll(`g.${RUG_CLASS} rect`).length).toBe(5);
    const text = Array.from(svg.querySelectorAll("text")).map((t) => t.textContent);
    expect(text).toContain("US recessions");
    expect(text).toContain("False positives");
    // The keyed chips carry the hairline that keeps a pale tint legible.
    expect(svg.querySelector('rect[stroke="rgba(0,0,0,0.18)"]')).not.toBeNull();
  });
});

describe("rug validation", () => {
  const spec = (extra: Record<string, unknown>) => ({ ...BASE, data: "d.csv", ...extra });

  it("rejects a categorical x-axis", () => {
    const res = validateSpec(
      spec({
        xAxisType: "categorical",
        rug: { tracks: [{ label: "A", intervals: [{ from: "x", to: "y" }] }] },
      }),
    );
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/continuous x-axis/);
  });

  it("rejects small multiples", () => {
    const res = validateSpec(
      spec({
        small_multiples: { columns: 2 },
        columns: { x: "time", value: "value", facet: "f" },
        rug: { tracks: [{ label: "A", intervals: [{ from: "2001", to: "2002" }] }] },
      }),
    );
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/not supported with small_multiples/);
  });

  it("rejects `rug: true` on an open-ended shading region", () => {
    const res = validateSpec(spec({ shading: [{ label: "F", rug: true, from: "2001" }] }));
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/needs BOTH `from` and `to`/);
  });

  it("rejects an unparseable bound", () => {
    const res = validateSpec(
      spec({ rug: { tracks: [{ label: "A", intervals: [{ from: "nope", to: "2002" }] }] } }),
    );
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/expected a number/);
  });

  it("rejects a backwards interval", () => {
    const res = validateSpec(
      spec({ rug: { tracks: [{ label: "A", intervals: [{ from: "2009", to: "2001" }] }] } }),
    );
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/runs backwards/);
  });

  it("rejects an empty intervals list", () => {
    const res = validateSpec(spec({ rug: { tracks: [{ label: "A", intervals: [] }] } }));
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/must not be empty/);
  });

  it("rejects a rug block that resolves to no tracks", () => {
    const res = validateSpec(spec({ rug: { height: 10 } }));
    expect(res.valid).toBe(false);
    expect(res.errors.join(" ")).toMatch(/resolves to no tracks/);
  });

  it("accepts the michez-rule shape", () => {
    expect(validateSpec(spec(MICHEZ as unknown as Record<string, unknown>)).valid).toBe(true);
  });
});
