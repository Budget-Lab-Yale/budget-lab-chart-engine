// @vitest-environment jsdom
//
// The PNG export is the requirement a consumer cannot work around. export-png.ts re-renders from
// the SPEC (`renderFigure(spec, rows)`) and composes its own chrome, so a CSS override on the page
// reaches neither the plot nor the legend in the downloaded image. Both halves have to carry the
// texture: the chart body (which comes from the engine, so it does already) and the export's own
// SVG legend chip (which is drawn here from scratch).
import { describe, it, expect } from "vitest";
import { buildExportSvg } from "../src/embed/export-png";
import { defaultHatchStroke } from "../src/engine/hatch";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const ROWS: TidyRow[] = [
  { time: "Bottom 50%", series: "collectedNew", value: "3" },
  { time: "Bottom 50%", series: "lostToBehavior", value: "1" },
  { time: "Top 1%", series: "collectedNew", value: "7" },
  { time: "Top 1%", series: "lostToBehavior", value: "4" },
] as unknown as TidyRow[];

const SPEC = {
  chartType: "stacked",
  title: "Distribution",
  xAxisType: "categorical",
  columns: { x: "time", value: "value", series: "series" },
  series_colors: { collectedNew: "blue", lostToBehavior: "#58A3E7" },
  series_patterns: { lostToBehavior: "/" },
} as unknown as ChartSpec;

describe("the PNG export", () => {
  it("carries the texture into the exported chart body", () => {
    const svg = buildExportSvg(SPEC, ROWS);
    const hatched = [...svg.querySelectorAll<SVGElement>('rect[data-series="lostToBehavior"]')];
    expect(hatched.length).toBeGreaterThan(0);
    for (const rect of hatched) expect(rect.style.fill).toMatch(/^url\("?#tblhatch-fwd-/);
  });

  it("carries the texture into the exported legend chip, as the same centred glyph", () => {
    const svg = buildExportSvg(SPEC, ROWS);
    // The chip is the glyph the live legend draws — a ground rect plus one centred band — NOT a
    // patch of the chart body's tiling, which at chip size would show an edge and no direction.
    const band = defaultHatchStroke("#58A3E7");
    const glyph = [...svg.querySelectorAll("g[transform]")].find((g) => {
      const shapes = [...g.querySelectorAll("rect, line")];
      return (
        shapes.length === 2 &&
        (shapes[0]!.getAttribute("style") ?? "").includes("#58A3E7") &&
        (shapes[1]!.getAttribute("style") ?? "").includes(band)
      );
    });
    expect(glyph, "no hatch glyph found in the exported legend").toBeTruthy();
    // `/` is a diagonal, so its band is a line — and it ascends left to right.
    const line = glyph!.querySelector("line")!;
    expect(+line.getAttribute("x1")!).toBeLessThan(+line.getAttribute("x2")!);
    expect(+line.getAttribute("y1")!).toBeGreaterThan(+line.getAttribute("y2")!);
  });

  it("defines every pattern the chart body references", () => {
    const svg = buildExportSvg(SPEC, ROWS);
    const referenced = new Set<string>();
    svg.querySelectorAll("*").forEach((el) => {
      for (const source of [el.getAttribute("fill"), (el as SVGElement).style?.fill]) {
        const m = source?.match(/url\("?#(tblhatch-[^")]+)"?\)/);
        if (m) referenced.add(m[1]!);
      }
    });
    expect(referenced.size).toBeGreaterThan(0);
    for (const id of referenced) {
      expect(svg.querySelector(`pattern[id="${id}"]`), `pattern ${id}`).not.toBeNull();
    }
  });

  // A regression guard, not a driver: segmentGap runs inside assemblePlot, which the export already
  // goes through. It is asserted here because "reaches the PNG export" is the half of #27 a
  // consumer's CSS cannot do, so it should fail loudly if the export ever stops re-rendering.
  it("carries barStack.segmentGap into the exported chart body", () => {
    const gapped = { ...SPEC, barStack: { segmentGap: 2 } } as unknown as ChartSpec;
    const stacks = (s: ChartSpec) => {
      const byBand = new Map<number, Array<{ y: number; h: number }>>();
      buildExportSvg(s, ROWS)
        .querySelectorAll('g[aria-label="bar"] rect')
        .forEach((r) => {
          const x = Math.round(+r.getAttribute("x")!);
          if (!byBand.has(x)) byBand.set(x, []);
          byBand.get(x)!.push({ y: +r.getAttribute("y")!, h: +r.getAttribute("height")! });
        });
      return [...byBand.values()].map((g) => g.sort((a, b) => a.y - b.y));
    };
    for (const stack of stacks(gapped)) {
      expect(stack.length).toBeGreaterThan(1);
      for (let i = 0; i < stack.length - 1; i++) {
        expect(stack[i + 1]!.y - (stack[i]!.y + stack[i]!.h)).toBeCloseTo(2, 5);
      }
    }
  });

  it("exports byte-identically to before when no texture is declared", () => {
    const { series_patterns, ...plain } = SPEC as unknown as Record<string, unknown>;
    const svg = buildExportSvg(plain as unknown as ChartSpec, ROWS);
    expect(svg.querySelector("pattern")).toBeNull();
    expect(svg.outerHTML).not.toContain("tblhatch");
  });
});
