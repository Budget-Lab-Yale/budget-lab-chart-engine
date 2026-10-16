// @vitest-environment jsdom
//
// A wrapped categorical x-axis label is one `<text>` holding one `<tspan>` per line, and its
// `textContent` joins the lines with NO space. The hover readers used to compare labels to
// categories with all whitespace removed, so a wrapped "A B" (tspans "A", "B") read exactly like an
// unwrapped "AB": with both categories on the axis, the categorical-line hover keyed "A B"'s label
// as "AB" and lost "A B", and the echo cursor's category highlight found "A B"'s label for "AB".
// The readers now join the tspan lines with one space.
import { describe, it, expect } from "vitest";
import { readCategoryCentersFromAxis, findAxisLabelBox } from "../src/engine/crosshair/dom-geometry";

const NS = "http://www.w3.org/2000/svg";
const PLOT_BOTTOM = 250;

/** jsdom has no layout: give the svg a 1:1 rect over its viewBox and each label a box centred at
 *  (cx, 270), below the plot. */
function axis(labels: Array<{ lines: string[]; cx: number }>): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
  svg.setAttribute("viewBox", "0 0 400 300");
  Object.defineProperty(svg, "getBoundingClientRect", {
    value: () => ({ left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, x: 0, y: 0 }),
  });
  for (const { lines, cx } of labels) {
    const t = document.createElementNS(NS, "text") as SVGTextElement;
    if (lines.length === 1) t.textContent = lines[0]!;
    else {
      for (const line of lines) {
        const s = document.createElementNS(NS, "tspan");
        s.textContent = line;
        t.appendChild(s);
      }
    }
    Object.defineProperty(t, "getBoundingClientRect", {
      value: () => ({ left: cx - 10, right: cx + 10, top: 262, bottom: 278, width: 20, height: 16, x: cx - 10, y: 262 }),
    });
    svg.appendChild(t);
  }
  document.body.appendChild(svg);
  return svg;
}

describe("wrapped axis labels are read with their lines joined by a space", () => {
  for (const order of ["wrapped first", "unwrapped first"] as const) {
    const labels = order === "wrapped first"
      ? [{ lines: ["A", "B"], cx: 100 }, { lines: ["AB"], cx: 300 }]
      : [{ lines: ["AB"], cx: 100 }, { lines: ["A", "B"], cx: 300 }];
    const centreOf = (cat: string): number => labels.find((l) => l.lines.join(" ") === cat)!.cx;

    it(`readCategoryCentersFromAxis keeps "A B" and "AB" apart (${order})`, () => {
      const svg = axis(labels);
      const got = readCategoryCentersFromAxis(svg, PLOT_BOTTOM, ["A B", "AB"]);
      expect(got).toHaveLength(2);
      expect(got.find((c) => c.category === "A B")?.cx).toBe(centreOf("A B"));
      expect(got.find((c) => c.category === "AB")?.cx).toBe(centreOf("AB"));
    });

    it(`findAxisLabelBox finds each category's own label (${order})`, () => {
      const svg = axis(labels);
      expect(findAxisLabelBox(svg, PLOT_BOTTOM, "A B")?.cx).toBe(centreOf("A B"));
      expect(findAxisLabelBox(svg, PLOT_BOTTOM, "AB")?.cx).toBe(centreOf("AB"));
    });
  }

  // What the space-insensitive comparison was for still holds: a wrapped multi-word label maps
  // back to its category, and a category with a doubled space still finds its label.
  it("a wrapped multi-word label still resolves to its category", () => {
    const svg = axis([
      { lines: ["Lowest income", "households"], cx: 100 },
      { lines: ["Middle  income"], cx: 300 },
    ]);
    const cats = ["Lowest income households", "Middle  income"];
    expect(readCategoryCentersFromAxis(svg, PLOT_BOTTOM, cats)).toEqual([
      { category: "Lowest income households", cx: 100 },
      { category: "Middle  income", cx: 300 },
    ]);
    expect(findAxisLabelBox(svg, PLOT_BOTTOM, "Lowest income households")?.cx).toBe(100);
    expect(findAxisLabelBox(svg, PLOT_BOTTOM, "Middle income")?.cx).toBe(300);
  });
});
