// @vitest-environment jsdom
//
// `src/engine/hover-classes.ts` lists the class of every transparent hover overlay, and render-live,
// the embed stylesheet and the hit-path ordering all read that list. A class the list lacks leaves
// one chart type out of all of them (the categorical-line overlay was missing from two such lists).
// This holds the list and the attach functions to each other, both ways: every overlay an attach
// function draws carries a listed class, and every listed class is drawn by some attach function.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CROSSHAIR_HIT_CLASSES } from "../src/engine/hover-classes";
import {
  attachCrosshair,
  attachBandCrosshair,
  attachHistogramHover,
  attachCategoricalLineCrosshair,
} from "../src/engine/crosshair";

const NS = "http://www.w3.org/2000/svg";

function freshSvg(): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg") as SVGSVGElement;
  svg.setAttribute("viewBox", "0 0 400 300");
  document.body.appendChild(svg);
  return svg;
}

/** The overlay an attach drew: the transparent rect it listens on (pointer-events "all"). */
function overlayClasses(svg: SVGSVGElement): string[][] {
  return Array.from(svg.querySelectorAll<SVGRectElement>("rect"))
    .filter((r) => r.getAttribute("fill") === "transparent" && r.style.pointerEvents === "all")
    .map((r) => Array.from(r.classList));
}

/** Every pointer-tracking attach function, each with the least input that makes it attach. */
const ATTACHES: Array<[string, (svg: SVGSVGElement) => void]> = [
  ["attachCrosshair", (svg) => attachCrosshair(svg, { rows: [{ time: 1, value: 2, series: "a" }], xParse: Number })],
  ["attachBandCrosshair", (svg) => attachBandCrosshair(svg, { rows: [{ _xc: "A", series: "a", _y: 1 }] })],
  ["attachHistogramHover", (svg) => attachHistogramHover(svg, { rows: [{ _x0: 0, _x1: 1, _y: 1, series: "a" }] })],
  ["attachCategoricalLineCrosshair", (svg) => attachCategoricalLineCrosshair(svg, { rows: [{ _xc: "A", series: "a", _y: 1 }] })],
];

describe("hover-classes.ts matches the overlays the attach functions draw", () => {
  const drawn = new Map<string, string[]>();
  for (const [name, attach] of ATTACHES) {
    it(`${name} draws exactly one overlay, and its class is listed`, () => {
      const svg = freshSvg();
      attach(svg);
      const overlays = overlayClasses(svg);
      expect(overlays).toHaveLength(1);
      expect(overlays[0]).toHaveLength(1);
      const cls = overlays[0]![0]!;
      expect(CROSSHAIR_HIT_CLASSES as readonly string[]).toContain(cls);
      drawn.set(name, overlays[0]!);
    });
  }

  it("every listed class is drawn by some attach function, each by a different one", () => {
    const classes = [...drawn.values()].map((c) => c[0]);
    expect(classes).toHaveLength(ATTACHES.length);
    expect(new Set(classes).size).toBe(classes.length);
    expect([...classes].sort()).toEqual([...CROSSHAIR_HIT_CLASSES].sort());
  });

  // The runtime check above only sees the attach functions this file calls. A NEW attach function
  // with its own overlay class would be missed, so also read the source: every `*-hit` class the
  // crosshair modules give a hit rect (`appendHitRect`, or a hand-built `classList.add`) is listed.
  it("every `-hit` class added in the crosshair sources is listed", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "engine");
    const files = [join(dir, "crosshair.ts"), ...readdirSync(join(dir, "crosshair")).map((f) => join(dir, "crosshair", f))];
    const added = new Set<string>();
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/(?:classList\.add\(|appendHitRect\(svgEl, )"([\w-]+-hit)"/g)) added.add(m[1]!);
    }
    expect(added.size).toBeGreaterThan(0);
    expect([...added].sort()).toEqual([...CROSSHAIR_HIT_CLASSES].sort());
  });
});
