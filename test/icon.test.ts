// @vitest-environment jsdom
//
// The single source of truth for legend, tooltip and export icons.
//
// Before this module there were six renderers and eleven different icon boxes: a tooltip's plain
// square was 11px next to a hatched one at 14px, a legend's line swatch was 18x3 while its chip was
// 14x14, and the export invented its own metrics again. Every renderer knew about a different subset
// of the shapes, so each new channel had to be threaded into all six by hand — and was not.
//
// Two properties make the inconsistency structurally impossible rather than merely tested:
//
//   1. ONE BOX. Every shape occupies ICON_BOX square. The ink inside varies; the box never does.
//      A banded chip is the single documented exception, because N colours need N bands.
//   2. ONE GEOMETRY. `iconShapes` returns the primitives; both emitters render that list and nothing
//      else. They cannot disagree, because there is only one description to disagree about.
import { describe, it, expect } from "vitest";
import {
  ICON_BOX,
  symbolArea,
  iconShapes,
  iconSvgMarkup,
  iconSvgGroup,
  iconSvgElement,
  iconFromLegendItem,
  iconWidth,
  type IconSpec,
} from "../src/engine/icon";
import { swatchWidthFor, MARK_POINT_R, MARK_LINE_POINT_R } from "../src/engine/theme";
import { resolveHatch, HATCH_GLYPH_BOX } from "../src/engine/hatch";
import { tokens } from "../src/theme/tokens";

const COLOR = "#0072B2";

/** One of each shape, for the properties that must hold across all of them. */
const EVERY_SHAPE: Array<{ name: string; icon: IconSpec }> = [
  { name: "solid line", icon: { shape: "line", color: COLOR } },
  { name: "dashed line", icon: { shape: "line", color: COLOR, dashed: true } },
  { name: "square", icon: { shape: "rect", color: COLOR } },
  { name: "rounded chip", icon: { shape: "rect", color: COLOR, rounded: true } },
  { name: "outlined chip", icon: { shape: "rect", color: "#F6F7F9", outlined: true } },
  { name: "textured square", icon: { shape: "rect", color: "#58A3E7", hatch: resolveHatch("/", "#58A3E7") } },
  { name: "dot", icon: { shape: "dot", color: COLOR } },
  { name: "hollow dot", icon: { shape: "dot", color: COLOR, marker: "hollow" as const } },
  { name: "hollow SYMBOL (what a dumbbell actually emits)", icon: { shape: "symbol", color: COLOR, symbol: "circle", marker: "hollow" as const } },
  { name: "symbol", icon: { shape: "symbol", color: COLOR, symbol: "triangle" } },
  { name: "line + symbol", icon: { shape: "line", color: COLOR, symbol: "square" } },
];

describe("one box for every shape", () => {
  it("is square", () => {
    expect(ICON_BOX).toBe(14);
  });

  it("keeps every shape's ink inside the box", () => {
    for (const { name, icon } of EVERY_SHAPE) {
      for (const s of iconShapes(icon)) {
        const bounds =
          s.kind === "circle"
            ? [s.cx - s.r, s.cy - s.r, s.cx + s.r, s.cy + s.r]
            : s.kind === "rect"
              ? [s.x, s.y, s.x + s.width, s.y + s.height]
              : s.kind === "line"
                ? [Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.max(s.x1, s.x2), Math.max(s.y1, s.y2)]
                : null; // a path's extent is its own business; it is centred by construction
        if (!bounds) continue;
        const [x0, y0, x1, y1] = bounds as [number, number, number, number];
        expect(x0, `${name}: ink starts left of the box`).toBeGreaterThanOrEqual(0);
        expect(y0, `${name}: ink starts above the box`).toBeGreaterThanOrEqual(0);
        expect(x1, `${name}: ink runs past the box`).toBeLessThanOrEqual(ICON_BOX);
        expect(y1, `${name}: ink runs below the box`).toBeLessThanOrEqual(ICON_BOX);
      }
    }
  });

  it("centres every shape on the box's middle", () => {
    // A column of keys must not appear to wobble as the shape changes.
    for (const { name, icon } of EVERY_SHAPE) {
      const shapes = iconShapes(icon);
      const covers = shapes.some((s) => {
        const c = ICON_BOX / 2;
        if (s.kind === "circle") return Math.hypot(s.cx - c, s.cy - c) <= s.r;
        if (s.kind === "rect") return s.x <= c && s.x + s.width >= c && s.y <= c && s.y + s.height >= c;
        if (s.kind === "line") return Math.abs((s.y1 + s.y2) / 2 - c) < 0.001 || Math.abs((s.x1 + s.x2) / 2 - c) < 0.001;
        return true; // paths carry their own translate to the centre
      });
      expect(covers, `${name}: nothing covers the centre of the box`).toBe(true);
    }
  });

  it("widens ONLY for a banded chip, and by the palette's own rule", () => {
    // swatchWidthFor is the existing rule (min 14, 3px per band, max 30) and annotation legends
    // already assert its values — a second rule here would make two right answers.
    const tints = ["#a1", "#b2", "#c3", "#d4", "#e5", "#f6", "#a7"];
    const banded: IconSpec = { shape: "rect", colors: tints };
    const bands = iconShapes(banded).filter((s) => s.kind === "rect");
    expect(bands).toHaveLength(tints.length);
    expect(iconWidth(banded)).toBe(swatchWidthFor(tints.length));
    expect(iconWidth(banded)).toBeGreaterThan(ICON_BOX);
    // Three tints still fit the box, so the box holds wherever it can.
    expect(iconWidth({ shape: "rect", colors: ["#a", "#b", "#c"] })).toBe(ICON_BOX);
  });
});

describe("one geometry, two emitters", () => {
  /** Geometry only — colours and radii included, hosting attributes excluded. */
  const geometryOf = (svg: Element) =>
    [...svg.querySelectorAll("rect, line, circle, path")].map((el) =>
      [
        el.tagName.toLowerCase(),
        ...["x", "y", "width", "height", "rx", "x1", "y1", "x2", "y2", "cx", "cy", "r", "d", "transform", "stroke-width", "stroke-dasharray", "style"].map(
          (a) => `${a}=${el.getAttribute(a) ?? ""}`,
        ),
      ].join("|"),
    );

  it("renders identically as markup and as DOM, for every shape", () => {
    for (const { name, icon } of EVERY_SHAPE) {
      const fromMarkup = new DOMParser().parseFromString(iconSvgMarkup(icon), "text/html").querySelector("svg")!;
      const fromDom = iconSvgGroup(document, icon)!;
      expect(geometryOf(fromMarkup), `${name}`).toEqual(geometryOf(fromDom));
    }
  });

  it("gives both emitters the same box, for every shape", () => {
    // Checked across ALL shapes, not just a line: the banded chip is the one that can break this and
    // it was the one shape the old assertion skipped — its viewBox stayed 14 while its bands ran to
    // 21, so preserveAspectRatio centred the view and cut the last band off.
    for (const { name, icon } of EVERY_SHAPE) {
      const w = iconWidth(icon);
      const svg = new DOMParser().parseFromString(iconSvgMarkup(icon), "text/html").querySelector("svg")!;
      expect(svg.getAttribute("viewBox"), name).toBe(`0 0 ${w} ${ICON_BOX}`);
      expect(svg.getAttribute("width"), name).toBe(String(w));
      expect(iconSvgElement(document, icon)!.getAttribute("viewBox"), name).toBe(`0 0 ${w} ${ICON_BOX}`);
    }
  });

  it("keeps the banded chip's last band inside its own view", () => {
    const tints = ["#a1", "#b2", "#c3", "#d4", "#e5", "#f6", "#a7"];
    const icon: IconSpec = { shape: "rect", colors: tints };
    const bands = iconShapes(icon).filter((s) => s.kind === "rect");
    const right = Math.max(...bands.map((s) => (s.kind === "rect" ? s.x + s.width : 0)));
    expect(right).toBeCloseTo(iconWidth(icon), 5);
  });
});

describe("each shape draws what it says", () => {
  it("draws a line as a horizontal rule across the box", () => {
    const [line] = iconShapes({ shape: "line", color: COLOR }) as [Extract<ReturnType<typeof iconShapes>[number], { kind: "line" }>];
    expect(line.kind).toBe("line");
    expect(line.x1).toBe(0);
    expect(line.x2).toBe(ICON_BOX);
    expect(line.y1).toBe(line.y2);
    expect(line.dasharray).toBeUndefined();
  });

  it("dashes that same line rather than drawing a different thing", () => {
    const solid = iconShapes({ shape: "line", color: COLOR })[0]!;
    const dashed = iconShapes({ shape: "line", color: COLOR, dashed: true })[0]!;
    expect({ ...dashed, dasharray: undefined }).toEqual({ ...solid, dasharray: undefined });
    expect(dashed.kind === "line" && dashed.dasharray).toBeTruthy();
  });

  it("fills the box for a square and rounds it for a chip", () => {
    const [sq] = iconShapes({ shape: "rect", color: COLOR });
    expect(sq!.kind === "rect" && sq!.width).toBe(ICON_BOX);
    const [chip] = iconShapes({ shape: "rect", color: COLOR, rounded: true });
    expect(chip!.kind === "rect" && (chip!.rx ?? 0)).toBeGreaterThan(1);
  });

  it("draws a hollow dot as a ring, not a filled circle", () => {
    const [solid] = iconShapes({ shape: "dot", color: COLOR }) as [Extract<ReturnType<typeof iconShapes>[number], { kind: "circle" }>];
    const [ring] = iconShapes({ shape: "dot", color: COLOR, marker: "hollow" as const }) as [Extract<ReturnType<typeof iconShapes>[number], { kind: "circle" }>];
    expect(solid.fill).toBe(COLOR);
    expect(ring.stroke).toBe(COLOR);
    // Same OUTER diameter, not same radius: a stroke straddles its radius, so the ring's radius is
    // half a stroke smaller. Equal radii would make the ring visibly bigger AND clip it.
    expect(ring.r + (ring.strokeWidth ?? 0) / 2).toBe(solid.r);
  });

  it("leaves a hollow centre EMPTY, on every hollow shape", () => {
    // Not white. A key sits on three different grounds — a card, the tooltip's translucent blur, and
    // the export's own frame — and an opaque white centre is only right on the first: it read as a
    // white blob on the other two, which is what "the ring is filled with white" meant.
    for (const icon of [
      { shape: "dot", color: COLOR, marker: "hollow" as const },
      { shape: "symbol", color: COLOR, symbol: "circle", marker: "hollow" as const },
      { shape: "symbol", color: COLOR, symbol: "square", marker: "hollow" as const },
    ] as IconSpec[]) {
      const [s] = iconShapes(icon);
      expect("fill" in s! && s.fill, `${icon.shape}/${icon.symbol ?? ""}`).toBe("none");
      // And the emitted markup must really say so, since `fill` unset would paint BLACK.
      expect(iconSvgMarkup(icon)).toContain("fill:none");
    }
    // A filled marker paints its colour and carries no keyline to eat its size.
    const [filled] = iconShapes({ shape: "symbol", color: COLOR, symbol: "square" });
    expect("fill" in filled! && filled.fill).toBe(COLOR);
    expect("stroke" in filled! && filled.stroke).toBeFalsy();
  });

  it("sizes a marker key from the chart's marker, corrected for how compact the shape is", () => {
    // Anchored to the chart (Plot sizes a symbol by area = pi*r^2, so a radius converts straight into
    // a d3 `size`) so a key cannot read smaller than the dot beside it — it was 9% smaller. Then
    // corrected, because equal area makes compact shapes read small and equal span makes spread ones
    // read light; there is no published cross-shape table, so the correction is one hand-judged
    // exponent over the measured shape constants rather than seven hand-tuned numbers.
    const chart = Math.PI * MARK_POINT_R ** 2;
    // Every symbol gets AT LEAST the chart's own marker area, unless the box cuts it first.
    for (const sym of ["circle", "square", "cross", "wye"]) {
      expect(symbolArea(sym), sym).toBeGreaterThan(chart);
    }
    // Size ascends as the shape gets more compact: a square carries its ink in the smallest span, so
    // it needs the most of it. This ordering IS the correction — at correction 0 it would be flat.
    const bySpan = ["square", "circle", "cross", "wye"]; // measured k ascending
    for (let i = 1; i < bySpan.length; i++) {
      expect(symbolArea(bySpan[i - 1]!), `${bySpan[i - 1]} vs ${bySpan[i]}`).toBeGreaterThan(symbolArea(bySpan[i]!));
    }
    // The three most spread shapes are cut by the box before the correction reaches them, which is
    // what a bigger ICON_BOX would relieve.
    for (const sym of ["triangle", "diamond", "star"]) {
      expect(symbolArea(sym), sym).toBeLessThan(symbolArea("wye"));
    }
    // A hollow symbol still makes room for its ring.
    expect(symbolArea("star", false, true)).toBeLessThan(symbolArea("star"));
  });

  it("draws a textured square as its ground plus the hatch glyph's own bands", () => {
    const hatch = resolveHatch("x", "#58A3E7");
    const shapes = iconShapes({ shape: "rect", color: "#58A3E7", hatch });
    // ground + the two crossed bands the glyph is made of — the SAME shapes hatch.ts produces,
    // so a key can never lean differently from the mark.
    expect(shapes).toHaveLength(3);
    expect(shapes[0]!.kind === "rect" && shapes[0]!.fill).toBe("#58A3E7");
    for (const s of shapes.slice(1)) {
      expect(s.kind === "line" ? s.stroke : s.kind === "rect" ? s.fill : "").toBe(hatch.stroke);
    }
  });

  it("draws the glyph in the SAME box it lays the icon out in", () => {
    // iconShapes places the glyph's bands straight into the icon's box, so the two constants are one
    // measurement kept in two modules — hatch.ts cannot import ICON_BOX without a cycle. If they
    // drift the glyph is cut by its own chip, silently and only for textured series.
    expect(HATCH_GLYPH_BOX).toBe(ICON_BOX);
  });

  it("lets the texture settle the shape, because only a filled mark can carry one", () => {
    const hatch = resolveHatch("/", "#58A3E7");
    // An AREA series is keyed by a chip but describes itself as a line on the legacy tooltip path.
    // Drawing that request literally is escape #1: a glyph in the legend, a plain line in the tooltip.
    expect(iconShapes({ shape: "line", color: "#58A3E7", hatch })).toEqual(
      iconShapes({ shape: "rect", color: "#58A3E7", hatch }),
    );
    // `none` still means none — an explicit no-key is not a shape to be overridden.
    expect(iconShapes({ shape: "none", hatch })).toEqual([]);
  });

  it("centres every symbol on the box, whatever its shape", () => {
    for (const symbol of ["triangle", "star", "square"]) {
      const [path] = iconShapes({ shape: "symbol", color: COLOR, symbol });
      expect(path!.kind).toBe("path");
      expect(path!.kind === "path" && path!.transform).toBe(`translate(${ICON_BOX / 2},${ICON_BOX / 2})`);
    }
  });

  it("draws nothing at all for the no-icon case", () => {
    // A cumulative stack's Total row is text with no key; the legend never has such a row, so this
    // state exists only so the tooltip can ask for it explicitly instead of skipping the emitter.
    expect(iconShapes({ shape: "none" })).toEqual([]);
    expect(iconSvgMarkup({ shape: "none" })).toBe("");
  });
});

describe("iconFromLegendItem — one translation from the resolved row", () => {
  // The tooltip keys from the same rows the legend does, instead of re-deriving from raw colour
  // maps. That is the whole mechanism; without it the two can drift again.
  const cases: Array<[string, Parameters<typeof iconFromLegendItem>[0], IconSpec]> = [
    ["bar/stacked", { markerShape: "rect", color: "#0072B2" }, { shape: "rect", color: "#0072B2" }],
    ["dashed line", { markerShape: "line", color: "#0072B2", dashed: true }, { shape: "line", color: "#0072B2", dashed: true }],
    ["line + marker", { markerShape: "line", color: "#0072B2", markerSymbol: "square" }, { shape: "line", color: "#0072B2", symbol: "square" }],
    ["point chart", { markerShape: "point", color: "#0072B2", markerSymbol: "triangle" }, { shape: "symbol", color: "#0072B2", symbol: "triangle" }],
    ["colour chip", { markerShape: "chip", color: "#0072B2" }, { shape: "rect", rounded: true, color: "#0072B2" }],
    // A colourless dot is the stacked Total: white disc, black ring, like the chart net marker.
    ["total dot", { markerShape: "dot" }, { shape: "dot", color: tokens.structural.mark_black, marker: "net" as const }],
    // A dumbbell emits markerShape "point", NOT "dot" — this case used to say "dot" and so passed
    // while every hollow dumbbell key rendered solid.
    ["hollow dumbbell end", { markerShape: "point", color: "#0072B2", markerSymbol: "circle", hollow: true },
      { shape: "symbol", color: "#0072B2", symbol: "circle", marker: "hollow" as const }],
    ["filled dumbbell end", { markerShape: "point", color: "#0072B2", markerSymbol: "circle" },
      { shape: "symbol", color: "#0072B2", symbol: "circle" }],
    ["annotation tints", { markerShape: "rect", colors: ["#a", "#b"], outlined: true }, { shape: "rect", colors: ["#a", "#b"], outlined: true }],
  ];

  it("translates every legend vocabulary into a drawing", () => {
    for (const [name, item, expected] of cases) {
      expect(iconFromLegendItem(item), name).toEqual(expected);
    }
  });

  it("carries a texture through, so a key matches the mark it names", () => {
    const hatch = resolveHatch("/", "#58A3E7");
    const icon = iconFromLegendItem({ markerShape: "rect", color: "#58A3E7", hatch });
    expect(icon.hatch).toBe(hatch);
    expect(iconShapes(icon).length).toBeGreaterThan(1);
  });
});
