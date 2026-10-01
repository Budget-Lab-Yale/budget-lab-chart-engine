// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { mountChart } from "../src/engine/render-live";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const SPEC = {
  chartType: "line", title: "T", xAxisType: "temporal", data: "d.csv", legendPosition: "right",
  columns: { x: "date", value: "value", series: "s" },
} as ChartSpec;
const ROWS = ["2020-01-01", "2021-01-01", "2022-01-01"].flatMap((date, i) =>
  ["Alpha", "Beta"].map((s, j) => ({ date, s, value: String(i + j) })),
) as unknown as TidyRow[];

/** Minimal ResizeObserver stub — jsdom has none. Same pattern as test/timeline-live.test.ts. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
    FakeResizeObserver.instances.push(this);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
async function resizeTo(host: HTMLElement, width: number): Promise<void> {
  const card = host.querySelector<HTMLElement>(".figure-card")!;
  Object.defineProperty(card, "clientWidth", { value: width, configurable: true });
  for (const inst of FakeResizeObserver.instances) inst.cb([], inst as unknown as ResizeObserver);
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));
}

afterEach(() => {
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  FakeResizeObserver.instances = [];
  document.body.replaceChildren();
});

// Wide -> narrow -> wide used to leave the right-legend wrapper in place on the narrow draw (both
// legends shown, the chart squeezed beside a stale column) and then throw NotFoundError on the wide
// one, whose rebuild assumed the canvas was still a direct child of the card. Only timelines tore
// the column down; every chart type now does.
const STACKED_DEFAULT_RIGHT = {
  chartType: "stacked", title: "T", xAxisType: "categorical", data: "d.csv",
  columns: { x: "g", value: "v", series: "s" },
} as unknown as ChartSpec;
const STACKED_ROWS = ["A", "B"].flatMap((g) =>
  Array.from({ length: 5 }, (_, i) => ({ g, s: `s${i}`, v: String(i + 1) })),
) as unknown as TidyRow[];

const cases: Array<[string, ChartSpec, TidyRow[], number]> = [
  ["line, explicit legendPosition: right", SPEC, ROWS, 2],
  ["stacked with five series (right by default)", STACKED_DEFAULT_RIGHT, STACKED_ROWS, 5],
];

describe("right legend across a resize below the right-column minimum and back", () => {
  for (const [name, spec, rows, n] of cases) {
    it(name, async () => {
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
      const errors: unknown[] = [];
      const onError = (e: ErrorEvent) => { errors.push(e.error ?? e.message); e.preventDefault(); };
      window.addEventListener("error", onError);
      try {
        const host = document.createElement("div");
        document.body.append(host);
        mountChart(host, { spec, rows, width: 900 });
        const card = host.querySelector(".figure-card")!;
        const rightItems = () => host.querySelectorAll(".figure-legend-slot--right .tbl-legend-item[data-series]");
        const topItems = () => host.querySelectorAll(".figure-legend-slot .tbl-legend-item[data-series]");
        const wrappers = () => host.querySelectorAll(".figure-body--legend-right");
        const scroll = () => host.querySelector(".figure-canvas-scroll")!;
        expect(wrappers()).toHaveLength(1);
        expect(rightItems()).toHaveLength(n);

        await resizeTo(host, 500);
        expect(errors).toEqual([]);
        expect(wrappers()).toHaveLength(0);
        expect(scroll().parentElement).toBe(card);
        expect(topItems()).toHaveLength(n);
        expect(rightItems()).toHaveLength(0);

        await resizeTo(host, 900);
        expect(errors).toEqual([]);
        expect(wrappers()).toHaveLength(1);
        expect(scroll().parentElement).toBe(wrappers()[0]);
        expect(rightItems()).toHaveLength(n);
        expect(topItems()).toHaveLength(0);
      } finally {
        window.removeEventListener("error", onError);
      }
    });
  }
});
