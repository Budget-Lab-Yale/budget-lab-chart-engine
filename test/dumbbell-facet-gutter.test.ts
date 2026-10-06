// @vitest-environment jsdom
//
// Panelled horizontal dot plots (horizontal dumbbells with small_multiples) share ONE category-label
// column. These panes always stack one per row, so every pane shows its own labels; the column is
// sized once from every pane's categories, the way the faceted horizontal-bar gutter is.
//
// Before: shared mode gave every pane the default TBL_MARGIN_LEFT while each pane pushed its labels
// left by its OWN gutter, so a pane with long labels started them left of x=0 (clipped: "op 1%");
// per-pane mode gave each pane its own gutter, so the plot areas and labels did not line up.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { renderFigure } from "../src/engine/index";
import { mountChart } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import { FACETED_CAT_LABEL_PX, horizontalLeftGutter } from "../src/engine/axes";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

// jsdom has no canvas: getContext logs "Not implemented" and returns null. Return the null quietly;
// the export's text measurement takes the same fallback either way.
const realGetContext = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
});
afterAll(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
});

const SPEC: ChartSpec = {
  chartType: "dumbbell",
  title: "t",
  xAxisType: "categorical",
  orientation: "horizontal",
  columns: { category: "group", series: "m", value: "v", facet: "pane" },
  series_order: ["a", "b"],
  small_multiples: { mode: "shared" },
  data: "d.csv",
};

const paneRows = (pane: string, groups: string[]) =>
  groups.flatMap((g, i) => [
    { pane, group: g, m: "a", v: String(10 + i) },
    { pane, group: g, m: "b", v: String(20 + i) },
  ]);
const SHORT = ["Q1", "Q5"];
const LONG = ["Top 1% by net worth", "Net worth of $1 billion or more"];
const ROWS = [...paneRows("Short", SHORT), ...paneRows("Long", LONG)] as unknown as TidyRow[];
const SHARED_GUTTER = horizontalLeftGutter([...SHORT, ...LONG], { fontSize: FACETED_CAT_LABEL_PX });

/** Absolute x of `el` inside its own <svg> (plus a local offset), accumulating ancestor translates. */
function absX(el: Element, local = 0): number {
  let x = local;
  let n: Element | null = el;
  while (n && n.tagName.toLowerCase() !== "svg") {
    const m = /translate\(\s*(-?[\d.]+)/.exec(n.getAttribute("transform") ?? "");
    if (m) x += Number(m[1]);
    n = n.parentElement;
  }
  return x;
}

/** Each category label's start x within its pane SVG, keyed by label text. */
function labelStarts(svg: SVGSVGElement): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of Array.from(svg.querySelectorAll("g.tbl-cat-label text"))) {
    out.set(t.textContent ?? "", absX(t, Number(t.getAttribute("x") ?? 0)));
  }
  return out;
}

function expectOneLabelColumn(panes: SVGSVGElement[]): void {
  expect(panes).toHaveLength(2);
  // Same left margin on every pane, wide enough for the longest label of ANY pane.
  const margins = panes.map((s) => Number(s.dataset.marginLeft));
  expect(margins[0]).toBe(margins[1]);
  expect(margins[0]).toBe(SHARED_GUTTER);
  // Every pane shows its OWN labels (none hidden), and every label starts at the same x, at the
  // pane's left edge (Plot's half-pixel offset aside) — never left of it.
  const [short, long] = panes.map(labelStarts);
  expect([...short!.keys()]).toEqual(SHORT);
  expect([...long!.keys()]).toEqual(LONG);
  for (const x of [...short!.values(), ...long!.values()]) {
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(1);
  }
}

describe("panelled horizontal dumbbell — one shared category-label column", () => {
  for (const mode of ["shared", "per-pane"] as const) {
    it(`${mode}: panes with different longest labels get the same left margin; labels start at x=0`, () => {
      const fig = renderFigure({ ...SPEC, small_multiples: { mode } }, ROWS, { gridWidth: 720, gridGap: 24, document });
      expectOneLabelColumn(fig.panes.map((p) => p.svg as SVGSVGElement));
    });
  }

  for (const mode of ["shared", "per-pane"] as const) {
    it(`${mode}, live mount: one label column, labels line up with the pane title`, () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const teardown = mountChart(container, { spec: { ...SPEC, small_multiples: { mode } }, rows: ROWS, width: 720 });
      try {
        const cells = Array.from(container.querySelectorAll(".figure-pane"));
        expect(cells).toHaveLength(2);
        const svgs = cells.map((c) => c.querySelector("svg") as SVGSVGElement);
        expectOneLabelColumn(svgs);
        // The title sits at the cell's left edge (no data-area offset, unlike horizontal bars), the
        // same x the labels start at.
        for (const c of cells) {
          const title = c.querySelector(".figure-pane-title") as HTMLElement;
          expect(title.style.paddingInlineStart).toBe("");
        }
      } finally {
        if (typeof teardown === "function") teardown();
        container.remove();
      }
    });
  }

  for (const mode of ["shared", "per-pane"] as const) {
    it(`${mode}, PNG export: one label column, labels line up with the pane title`, () => {
      const out = buildExportSvg({ ...SPEC, small_multiples: { mode } }, ROWS);
      const panes = Array.from(out.querySelectorAll("svg svg")).filter((s) =>
        s.querySelector("g.tbl-cat-label"),
      ) as SVGSVGElement[];
      expectOneLabelColumn(panes);
      for (const [i, title] of ["Short", "Long"].entries()) {
        const titleEl = Array.from(out.querySelectorAll("text")).find((t) => t.textContent === title)!;
        expect(titleEl).toBeTruthy();
        // Title x == pane x + label start (the labels start at the pane's x=0).
        const paneX = Number(panes[i]!.getAttribute("x"));
        const labelX = Math.min(...labelStarts(panes[i]!).values());
        expect(Math.abs(Number(titleEl.getAttribute("x")) - (paneX + labelX))).toBeLessThanOrEqual(1);
      }
    });
  }
});

describe("panelled horizontal dumbbell with sections — one label column, headers at the left edge", () => {
  // Ragged sections across panes: each pane's longest label and section headers differ.
  const SECTIONED: ChartSpec = { ...SPEC, columns: { ...SPEC.columns, section: "sec" } };
  const row = (pane: string, sec: string, group: string, i: number) => [
    { pane, sec, group, m: "a", v: String(10 + i) },
    { pane, sec, group, m: "b", v: String(20 + i) },
  ];
  const SEC_ROWS = [
    ...row("Short", "Income", "Q1", 0),
    ...row("Short", "Income", "Q5", 1),
    ...row("Short", "Wealth", "W1", 2),
    ...row("Long", "Income", "Top 1% by net worth", 0),
    ...row("Long", "Wealth", "Net worth of $1 billion or more", 1),
  ] as unknown as TidyRow[];
  const SEC_GUTTER = horizontalLeftGutter(["Q1", "Q5", "W1", ...LONG], { fontSize: FACETED_CAT_LABEL_PX });

  function expectAligned(panes: SVGSVGElement[]): void {
    expect(panes).toHaveLength(2);
    expect(panes.map((s) => Number(s.dataset.marginLeft))).toEqual([SEC_GUTTER, SEC_GUTTER]);
    for (const svg of panes) {
      const labels = [...labelStarts(svg).values()];
      const headers = Array.from(svg.querySelectorAll("text"))
        .filter((t) => !t.closest("g.tbl-cat-label") && /^(Income|Wealth)$/.test(t.textContent ?? ""))
        .map((t) => absX(t, Number(t.getAttribute("x") ?? 0)));
      expect(labels.length).toBeGreaterThan(0);
      expect(headers).toHaveLength(2);
      for (const x of [...labels, ...headers]) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
      }
    }
  }

  for (const mode of ["shared", "per-pane"] as const) {
    it(`${mode}, live mount`, () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const teardown = mountChart(container, { spec: { ...SECTIONED, small_multiples: { mode } }, rows: SEC_ROWS, width: 720 });
      try {
        expectAligned(Array.from(container.querySelectorAll(".figure-pane svg")) as SVGSVGElement[]);
      } finally {
        if (typeof teardown === "function") teardown();
        container.remove();
      }
    });

    it(`${mode}, PNG export`, () => {
      const out = buildExportSvg({ ...SECTIONED, small_multiples: { mode } }, SEC_ROWS);
      expectAligned(
        Array.from(out.querySelectorAll("svg svg")).filter((s) => s.querySelector("g.tbl-cat-label")) as SVGSVGElement[],
      );
    });
  }
});
