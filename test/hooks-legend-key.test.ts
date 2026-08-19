// @vitest-environment jsdom
//
// The parity guarantee: a static hook's output must appear in the PNG export identically, because
// the export re-renders through the same builders with the same hooks object rather than
// serialising the live legend DOM. `legendKey` replaces one legend row's key markup; `rendered`
// carries the engine's own markup so a hook can wrap rather than reconstruct it (#30).
import { describe, it, expect, beforeEach } from "vitest";
import { mountChart } from "../src/engine/render-live";
import { buildExportSvg } from "../src/embed/export-png";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";
import type { RenderHooks } from "../src/spec/hooks";

const ROWS: TidyRow[] = [
  { time: "Q1", value: "10", series: "A" },
  { time: "Q1", value: "20", series: "B" },
  { time: "Q2", value: "30", series: "A" },
  { time: "Q2", value: "40", series: "B" },
] as unknown as TidyRow[];

// Two series, so the legend actually draws rows (a single-series chart may suppress it entirely).
const SPEC = {
  chartType: "line",
  title: "t",
  xAxisType: "categorical",
  data: "data.csv",
  columns: { x: "time", value: "value", series: "series" },
} as unknown as ChartSpec;

const REPLACEMENT = '<span class="mine">A!</span>';
const hooks: RenderHooks = {
  legendKey: (ctx) => (ctx.series === "A" ? REPLACEMENT : null),
};

function mount(h?: RenderHooks): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  mountChart(el, { spec: SPEC, rows: ROWS, width: 720, height: 400, ...(h ? { hooks: h } : {}) });
  return el;
}

const legendItem = (root: ParentNode, series: string): HTMLElement =>
  Array.from(root.querySelectorAll<HTMLElement>(".tbl-legend-item")).find(
    (b) => b.dataset.series === series,
  )!;

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("hooks.legendKey", () => {
  it("replaces the hooked series' key only", () => {
    const el = mount(hooks);
    expect(legendItem(el, "A").innerHTML).toContain(REPLACEMENT);
    // Series B is untouched: still carries the engine's own icon + label.
    const b = legendItem(el, "B");
    expect(b.querySelector("svg")).not.toBeNull();
    expect(b.textContent).toContain("B");
  });

  it("leaves the engine's key when the hook returns null", () => {
    const el = mount({ legendKey: () => null });
    for (const series of ["A", "B"]) {
      const item = legendItem(el, series);
      expect(item.querySelector("svg")).not.toBeNull();
      expect(item.innerHTML).not.toContain(REPLACEMENT);
    }
  });

  it("appears IDENTICALLY in the export — the whole point", () => {
    const svg = buildExportSvg(SPEC, ROWS, { hooks });
    expect(svg.outerHTML).toContain(REPLACEMENT);
  });

  it("renders byte-identically with no hooks at all", () => {
    const a = mount().innerHTML;
    const b = mount({}).innerHTML;
    expect(b).toBe(a);
  });
});
