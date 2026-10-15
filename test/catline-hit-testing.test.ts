// @vitest-environment jsdom
//
// Hover hit-testing on categorical-x LINE/AREA charts (review 2026-10-15, crosshair.md bugs 1-2).
//
// B1. The fat line hit-paths (render-live `addLineHitPaths`, 14px `pointer-events: stroke`) must sit
//     BELOW every hover overlay. A categorical-line pane's overlay is `.tbl-catline-hit`; when the
//     insertion point was looked up with a list that omitted it, the hit-paths were appended ABOVE the
//     overlay, so near any line the hit-path took the pointer, the overlay got `pointerleave`, and the
//     coordinated cursor cleared on every pane. jsdom does no hit-testing, so the test asserts the
//     cause directly: document order, which decides SVG paint and hit-test order.
//
// B6. A multi-word category whose axis label wraps renders as two `<tspan>`s, and `textContent`
//     joins them with no space ("Lowest incomehouseholds"). The axis reader used that string as the
//     hover key, which matches no `_xc`: the card showed a run-together header and no value rows, and
//     a coordinated pane drew nothing.
import { describe, it, expect, beforeEach } from "vitest";
import {
  mountHover, cardShown, cardHtml, coordShown, hoverFirstMark, PLOT_MIDDLE,
} from "./helpers/hover-harness";
import { CROSSHAIR_HIT_SELECTOR } from "../src/engine/crosshair";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

beforeEach(() => {
  document.body.innerHTML = "";
});

const spec = (s: Record<string, unknown>): ChartSpec => ({ title: "t", data: "inline", ...s }) as unknown as ChartSpec;
const paned = { data: "d.csv", columns: { x: "time", value: "value", series: "series", facet: "pane" }, small_multiples: { columns: 2 } };

const rowsFor = (cats: string[], panes: Array<string | undefined>): TidyRow[] =>
  panes.flatMap((pane, p) =>
    cats.flatMap((c, i) =>
      ["A", "B"].map((s, k) => ({
        ...(pane ? { pane } : {}), time: c, series: s, value: String(10 + i * 2 + k * 3 + p),
      })),
    ),
  ) as unknown as TidyRow[];

const SHORT = ["18-21", "22-25", "26-30", "31-40"];
/** Six multi-word categories at the default standalone width: too long for one line, short
 *  enough to wrap. */
const WRAPPING = [
  "Lowest income households", "Second income quintile", "Middle income quintile",
  "Fourth income quintile", "Highest income households", "Top one percent",
];
/** The same for a half-width pane: fewer categories, so each still wraps rather than rotates. */
const WRAPPING_PANE = ["Lowest income households", "Middle income quintile", "Highest income households"];

/** Is `a` before `b` in document order? */
const precedes = (a: Element, b: Element): boolean =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe("B1: fat line hit-paths sit below every hover overlay", () => {
  // The atus-childcare shape: categorical x, series, facet, legend. (A categorical AREA pane takes
  // the same branch but draws no `g[aria-label="line"]` paths, so it gets no hit-paths to order.)
  it("two-pane categorical line with a legend: every .tbl-line-hitpath precedes .tbl-catline-hit", () => {
    const { svgs } = mountHover(
      spec({ chartType: "line", xAxisType: "categorical", series_order: ["A", "B"], ...paned }),
      rowsFor(SHORT, ["P1", "P2"]),
      true,
    );
    expect(svgs.length).toBe(2);
    for (const svg of svgs) {
      const overlay = svg.querySelector(".tbl-catline-hit");
      expect(overlay).not.toBeNull();
      const hitPaths = Array.from(svg.querySelectorAll(".tbl-line-hitpath"));
      expect(hitPaths.length).toBeGreaterThan(0); // not vacuous: the legend makes them
      for (const hp of hitPaths) expect(precedes(hp, overlay!)).toBe(true);
    }
  });

  // The same ordering on the families that were already right, so the shared selector cannot
  // regress them.
  it("two-pane temporal line: every .tbl-line-hitpath precedes every hover overlay", () => {
    const rows = ["2020-01-01", "2020-02-01", "2020-03-01"].flatMap((t, i) =>
      ["A", "B"].flatMap((s) => ["P1", "P2"].map((pane) => ({ pane, time: t, series: s, value: String(3 + i) }))),
    ) as unknown as TidyRow[];
    const { svgs } = mountHover(spec({ chartType: "line", xAxisType: "temporal", series_order: ["A", "B"], ...paned }), rows, true);
    for (const svg of svgs) {
      const overlays = Array.from(svg.querySelectorAll(CROSSHAIR_HIT_SELECTOR));
      const hitPaths = Array.from(svg.querySelectorAll(".tbl-line-hitpath"));
      expect(overlays.length).toBeGreaterThan(0);
      expect(hitPaths.length).toBeGreaterThan(0);
      for (const hp of hitPaths) for (const o of overlays) expect(precedes(hp, o)).toBe(true);
    }
  });
});

describe("B6: categorical-line hover survives wrapped x-axis labels", () => {
  /** Precondition: the axis really wrapped (some label carries two tspans). */
  const assertWrapped = (svg: SVGSVGElement): void => {
    const wrapped = Array.from(svg.querySelectorAll("text")).filter((t) => t.querySelectorAll("tspan").length > 1);
    expect(wrapped.length).toBeGreaterThan(0);
  };

  // Area cards add a Total row.
  for (const [chartType, rowCount] of [["line", 2], ["area", 3]] as const) {
    it(`standalone ${chartType}: the card names a real category and lists every series' value`, () => {
      const { svgs } = mountHover(
        spec({ chartType, xAxisType: "categorical", series_order: ["A", "B"], columns: { x: "time", value: "value", series: "series" } }),
        rowsFor(WRAPPING, [undefined]),
      );
      const svg = svgs[0]!;
      assertWrapped(svg);
      hoverFirstMark(svg, PLOT_MIDDLE);
      expect(cardShown()).toBe(true);
      const tip = document.body.querySelector<HTMLElement>(".tbl-tooltip")!;
      const head = tip.querySelector(".tbl-tooltip-head")!.textContent;
      expect(WRAPPING).toContain(head);
      expect(tip.querySelectorAll(".tbl-tooltip-row").length).toBe(rowCount);
      expect(cardHtml()).toContain("tbl-tooltip-value");
    });
  }

  it("coordinated two-pane: the hover draws the echo (dots + pills) on BOTH panes", () => {
    const { svgs } = mountHover(
      spec({ chartType: "line", xAxisType: "categorical", series_order: ["A", "B"], ...paned }),
      rowsFor(WRAPPING_PANE, ["P1", "P2"]),
      true,
    );
    expect(svgs.length).toBe(2);
    svgs.forEach(assertWrapped);
    hoverFirstMark(svgs[0]!, PLOT_MIDDLE);
    for (const svg of svgs) {
      expect(coordShown(svg)).toBe(true);
      expect(svg.querySelectorAll("g.tbl-coord .tbl-coord-dot").length).toBe(2);
      expect(svg.querySelectorAll("g.tbl-coord .tbl-coord-pill").length).toBe(2);
    }
  });
});
