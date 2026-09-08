// @vitest-environment jsdom
//
// The full cross-product: every hatch character over every palette colour, end to end.
//
// The per-feature tests each hold one variable still — one character, one colour. The combinations
// are where a rule quietly fails on one cell: a hue whose derived band lands off-ramp, a character
// whose glyph loses its ground, a dark hue that should invert and doesn't. 6 x 7 is small enough to
// check exhaustively, so there is no reason to sample.
//
// A companion specimen sheet renders the same matrix to look at — see the pressure directory.
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import { renderLegend } from "../src/engine/legend";
import {
  HATCH_CHARS,
  HATCH_GLYPH_BOX,
  defaultHatchStroke,
  hatchGlyphShapes,
  hatchPatternId,
  resolveHatch,
  type HatchChar,
} from "../src/engine/hatch";
import { locateOnRamp, lightness } from "../src/engine/palette";
import { tokens } from "../src/theme/tokens";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const OPTS = { width: 720, height: 400, document };

/** Every colour an author can name that belongs to a hue family, plus the brand blues. */
const COLOURS: Array<{ name: string; hex: string }> = [
  ...tokens.categorical.flatMap((c) => [
    { name: c.key, hex: c.base },
    { name: `${c.key}-light`, hex: c.light },
  ]),
  { name: "navy", hex: tokens.brand.navy },
  { name: "sky", hex: tokens.brand.sky },
];

/** Each character over each colour: 16 colours x 6 characters. */
const MATRIX: Array<{ char: HatchChar; name: string; hex: string }> = HATCH_CHARS.flatMap((char) =>
  COLOURS.map(({ name, hex }) => ({ char, name, hex })),
);

const ROWS: TidyRow[] = [
  { time: "A", series: "flat", value: "6" },
  { time: "A", series: "textured", value: "4" },
  { time: "B", series: "flat", value: "3" },
  { time: "B", series: "textured", value: "7" },
] as unknown as TidyRow[];

const specFor = (char: HatchChar, hex: string) =>
  ({
    chartType: "stacked",
    title: "t",
    xAxisType: "categorical",
    columns: { x: "time", value: "value", series: "series" },
    series_order: ["flat", "textured"],
    series_colors: { flat: "grey", textured: hex },
    series_patterns: { textured: char },
    barStack: { netDisplay: "none" },
  }) as unknown as ChartSpec;

describe(`every character over every palette colour (${MATRIX.length} combinations)`, () => {
  it("derives a band that stays on the ground's own hue ramp", () => {
    for (const { char, name, hex } of MATRIX) {
      const band = defaultHatchStroke(hex);
      const groundRamp = locateOnRamp(hex);
      const bandRamp = locateOnRamp(band);
      expect(groundRamp, `${name} should be locatable`).not.toBeNull();
      expect(bandRamp, `${char} over ${name}: band ${band} is off-ramp`).not.toBeNull();
      expect(bandRamp!.family, `${char} over ${name}: band left the hue family`).toBe(
        groundRamp!.family,
      );
    }
  });

  it("separates ground from band by 20-33 L*, in every cell", () => {
    for (const { char, name, hex } of MATRIX) {
      const dL = Math.abs(lightness(hex)! - lightness(defaultHatchStroke(hex))!);
      expect(dL, `${char} over ${name}: ΔL*=${dL.toFixed(1)}`).toBeGreaterThan(20);
      expect(dL, `${char} over ${name}: ΔL*=${dL.toFixed(1)}`).toBeLessThan(33);
    }
  });

  it("paints the mark from a pattern grounded in the declared colour", () => {
    for (const { char, name, hex } of MATRIX) {
      const { svg } = renderChart(specFor(char, hex), ROWS, OPTS);
      const hatch = resolveHatch(char, hex);

      const pattern = svg.querySelector(`pattern[id="${hatchPatternId(char, hex, hatch.stroke)}"]`);
      expect(pattern, `${char} over ${name}: no pattern in <defs>`).not.toBeNull();
      const shapes = [...pattern!.querySelectorAll("rect")];
      expect(shapes[0]!.getAttribute("style"), `${char} over ${name} ground`).toContain(hex);
      expect(shapes[1]!.getAttribute("style"), `${char} over ${name} band`).toContain(hatch.stroke);

      for (const rect of svg.querySelectorAll<SVGElement>('rect[data-series="textured"]')) {
        expect(rect.style.fill, `${char} over ${name} mark fill`).toContain(hatch.id);
      }
    }
  });

  it("keys the mark with a centred glyph carrying the same two colours", () => {
    for (const { char, name, hex } of MATRIX) {
      const { legendItems } = renderChart(specFor(char, hex), ROWS, OPTS);
      const item = legendItems!.find((i) => i.series === "textured")!;
      expect(item.hatch, `${char} over ${name}: legend row carries no hatch`).toBeTruthy();

      const parent = document.createElement("div");
      renderLegend(parent, legendItems!);
      const glyph = parent.querySelector('[data-series="textured"] .tbl-legend-swatch svg')!;
      expect(glyph, `${char} over ${name}: no glyph in the key`).not.toBeNull();
      expect(glyph.getAttribute("viewBox")).toBe(`0 0 ${HATCH_GLYPH_BOX} ${HATCH_GLYPH_BOX}`);

      const [ground, ...bands] = [...glyph.querySelectorAll("rect, line, polygon")];
      expect(ground!.getAttribute("style"), `${char} over ${name} glyph ground`).toContain(hex);
      expect(bands).toHaveLength(hatchGlyphShapes(char).length);
      for (const b of bands) {
        expect(b.getAttribute("style"), `${char} over ${name} glyph band`).toContain(
          defaultHatchStroke(hex),
        );
      }
    }
  });

  it("gives every cell a distinct pattern id, and repeats none", () => {
    const ids = MATRIX.map(({ char, hex }) => resolveHatch(char, hex).id);
    // Distinct per (character, colour) — a collision would make one cell paint as another.
    expect(new Set(ids).size).toBe(MATRIX.length);
  });
});
