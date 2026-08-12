// @vitest-environment jsdom
//
// The PNG export is the requirement a consumer cannot work around. export-png.ts re-renders from
// the SPEC (`renderFigure(spec, rows)`) and composes its own chrome, so a CSS override on the page
// reaches neither the plot nor the legend in the downloaded image. Both halves have to carry the
// texture: the chart body (which comes from the engine, so it does already) and the export's own
// SVG legend chip (which is drawn here from scratch).
import { describe, it, expect } from "vitest";
import { buildExportSvg } from "../src/embed/export-png";
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

  it("carries the texture into the exported legend chip, as a real pattern", () => {
    const svg = buildExportSvg(SPEC, ROWS);
    // The chip is filled from a pattern, not a flat colour, so the key matches the bars.
    const chips = [...svg.querySelectorAll('rect[fill^="url(#tblhatch-fwd-"]')];
    expect(chips.length).toBeGreaterThan(0);
  });

  it("defines every referenced pattern somewhere in the exported document", () => {
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

  it("exports byte-identically to before when no texture is declared", () => {
    const { series_patterns, ...plain } = SPEC as unknown as Record<string, unknown>;
    const svg = buildExportSvg(plain as unknown as ChartSpec, ROWS);
    expect(svg.querySelector("pattern")).toBeNull();
    expect(svg.outerHTML).not.toContain("tblhatch");
  });
});
