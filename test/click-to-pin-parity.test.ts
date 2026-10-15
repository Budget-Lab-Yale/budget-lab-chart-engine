// @vitest-environment jsdom
//
// Click-to-pin parity between standalone charts and figure panes (review 2026-10-15, render-live.md
// IMPORTANT #5, finding B10). The two mount paths wired the chart click independently and drifted:
//   - a standalone categorical LINE got no fat hit-paths (`addLineHitPaths`), so a click had to land
//     on the 2px stroke itself to pin the series, while the same chart as a figure pane got them;
//   - faceted HISTOGRAM and DUMBBELL panes had no click listener at all, while the standalone ones
//     pinned on click.
//
// jsdom has no layout, so `document.elementsFromPoint` (what the click handler hit-tests with) is
// stubbed to return the stack a real browser would: the transparent hover overlay on top, then
// whatever mark sits under the pointer, then the SVG. For the line case the stack holds only the
// fat hit-path, not the thin visible stroke: a click NEAR the line, which is what the hit-paths are
// for. Each test fails if its chart's click wiring is removed.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mountChart } from "../src/engine/render-live";
import { renderChart } from "../src/engine/index";
import { buildExportSvg } from "../src/embed/export-png";
import { CROSSHAIR_HIT_SELECTOR } from "../src/engine/hover-classes";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

type Doc = Document & { elementsFromPoint?: (x: number, y: number) => Element[] };
const doc = document as Doc;
const original = doc.elementsFromPoint;

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  doc.elementsFromPoint = original;
});

const spec = (s: Record<string, unknown>): ChartSpec => ({ title: "t", data: "inline", ...s }) as unknown as ChartSpec;

function mount(s: ChartSpec, rows: TidyRow[], faceted: boolean): { container: HTMLElement; svgs: SVGSVGElement[] } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  mountChart(container, { spec: s, rows, width: faceted ? 838 : 720, height: faceted ? 420 : 400 });
  const svgs = Array.from(container.querySelectorAll<SVGSVGElement>(faceted ? ".figure-pane svg" : ".figure-canvas svg"));
  expect(svgs.length).toBe(faceted ? 2 : 1);
  return { container, svgs };
}

/** Click `svg` with `elementsFromPoint` answering [overlay, ...under, svg]. */
function clickThrough(svg: SVGSVGElement, under: Element[]): void {
  const overlay = svg.querySelector(CROSSHAIR_HIT_SELECTOR);
  expect(overlay).not.toBeNull();
  doc.elementsFromPoint = () => [overlay!, ...under, svg];
  overlay!.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10 }));
}

const pinned = (container: HTMLElement, series: string): string | null =>
  container.querySelector(`.tbl-legend-item[data-series="${series}"]`)?.getAttribute("aria-pressed") ?? null;

const catRows = (panes: Array<string | undefined>): TidyRow[] =>
  panes.flatMap((pane, p) =>
    ["A", "B"].flatMap((s, k) =>
      ["c1", "c2", "c3"].map((c, i) => ({ ...(pane ? { pane } : {}), time: c, series: s, value: String(3 + i + k * 4 + p) })),
    ),
  ) as unknown as TidyRow[];

describe("B10: click-to-pin parity", () => {
  // Control: the harness pins through a path that was already wired, so a RED below is the wiring.
  it("control: standalone dumbbell, a click on a dot pins its series", () => {
    const { container, svgs } = mount(
      spec({ chartType: "dumbbell", orientation: "vertical", xAxisType: "categorical", series_order: ["A", "B"] }),
      catRows([undefined]),
      false,
    );
    const dot = svgs[0]!.querySelector('g[aria-label="dot"] circle[data-series="A"]');
    expect(dot).not.toBeNull();
    clickThrough(svgs[0]!, [dot!]);
    expect(pinned(container, "A")).toBe("true");
  });

  it("standalone categorical line: a click near line A (its fat hit-path, not the stroke) pins A", () => {
    const { container, svgs } = mount(
      spec({ chartType: "line", xAxisType: "categorical", series_order: ["A", "B"] }),
      catRows([undefined]),
      false,
    );
    const svg = svgs[0]!;
    const hits = Array.from(svg.querySelectorAll('.tbl-line-hitpath[data-series="A"]'));
    expect(pinned(container, "A")).toBe("false");
    clickThrough(svg, hits);
    expect(pinned(container, "A")).toBe("true");
    // The overlay advertises the click, as the pane path does.
    expect(svg.querySelector<SVGElement>(".tbl-catline-hit")!.style.cursor).toBe("pointer");
  });

  it("the hit-paths are live-only: renderChart and the PNG export draw none", () => {
    const s = spec({ chartType: "line", xAxisType: "categorical", series_order: ["A", "B"] });
    const rows = catRows([undefined]);
    const { svg } = renderChart(s, rows, { width: 720, height: 400 });
    expect(svg.querySelectorAll('g[aria-label="line"] path[data-series]').length).toBeGreaterThan(0);
    expect(svg.querySelectorAll(".tbl-line-hitpath").length).toBe(0);
    expect(buildExportSvg(s, rows).querySelectorAll(".tbl-line-hitpath").length).toBe(0);
  });

  it("faceted histogram pane: a click on a bin pins its series", () => {
    const rows = ["P1", "P2"].flatMap((pane) =>
      ["A", "B"].flatMap((grp, k) =>
        Array.from({ length: 12 }, (_, v) => ({ pane, grp, amount: String(v + k * 4) })),
      ),
    ) as unknown as TidyRow[];
    const { container, svgs } = mount(
      spec({
        chartType: "histogram", xAxisType: "numeric", histogram: { bins: 4, domain: [0, 20] },
        columns: { x: "amount", series: "grp", facet: "pane" }, series_order: ["A", "B"],
        data: "d.csv", small_multiples: { columns: 2, mode: "shared" },
      }),
      rows,
      true,
    );
    const svg = svgs[0]!;
    const bin = svg.querySelector('g[aria-label="rect"] rect[data-series="B"]');
    expect(bin).not.toBeNull();
    expect(pinned(container, "B")).toBe("false");
    clickThrough(svg, [bin!]);
    expect(pinned(container, "B")).toBe("true");
  });

  it("faceted dumbbell pane: a click on a dot pins its series", () => {
    const { container, svgs } = mount(
      spec({
        chartType: "dumbbell", orientation: "vertical", xAxisType: "categorical", series_order: ["A", "B"],
        data: "d.csv", columns: { x: "time", value: "value", series: "series", facet: "pane" },
        small_multiples: { columns: 2, mode: "shared" },
      }),
      catRows(["P1", "P2"]),
      true,
    );
    const svg = svgs[1]!;
    const dot = svg.querySelector('g[aria-label="dot"] circle[data-series="A"]');
    expect(dot).not.toBeNull();
    expect(pinned(container, "A")).toBe("false");
    clickThrough(svg, [dot!]);
    expect(pinned(container, "A")).toBe("true");
  });
});

// A figure card is marked `.is-selectable` (the click-to-select affordance) only when its panes
// actually pin on click. Dot-plot and scatter panes have no click wiring, as their standalone charts
// do not, so a legend alone must not set it.
describe("B10: figure .is-selectable follows the pane click wiring", () => {
  const paneCols = { columns: { x: "time", value: "value", series: "series", facet: "pane" } };
  const figure = (s: Record<string, unknown>) =>
    spec({ series_order: ["A", "B"], data: "d.csv", ...paneCols, small_multiples: { columns: 2 }, ...s });
  const scatterRows = [1, 2, 3, 4].flatMap((x) =>
    ["P1", "P2"].flatMap((pane) => ["A", "B"].map((series, k) => ({ pane, time: String(x), series, value: String(x * (2 + k)) }))),
  ) as unknown as TidyRow[];
  const selectable = (c: HTMLElement): boolean => c.querySelector(".figure-card")!.classList.contains("is-selectable");

  for (const [name, s, rows] of [
    ["dot plot", figure({ chartType: "dotplot", xAxisType: "categorical" }), catRows(["P1", "P2"])],
    ["scatter", figure({ chartType: "scatter", xAxisType: "numeric" }), scatterRows],
  ] as const) {
    it(`${name} figure with a legend: not selectable`, () => {
      const { container } = mount(s, rows, true);
      expect(container.querySelectorAll(".tbl-legend-item").length).toBe(2); // the legend exists
      expect(selectable(container)).toBe(false);
    });
  }

  for (const [name, s] of [
    ["categorical line", figure({ chartType: "line", xAxisType: "categorical" })],
    ["dumbbell", figure({ chartType: "dumbbell", orientation: "vertical", xAxisType: "categorical" })],
  ] as const) {
    it(`${name} figure with a legend: selectable`, () => {
      const { container } = mount(s, catRows(["P1", "P2"]), true);
      expect(selectable(container)).toBe(true);
    });
  }
});
