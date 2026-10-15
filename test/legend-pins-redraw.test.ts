// @vitest-environment jsdom
//
// B5: legend pins (click-to-isolate) survive the live mount's own redraws. Every draw() / drawGrid()
// rebuilds the legend from scratch, so before this fix a resize or a title-selector change silently
// unpinned everything and onLegendSelect was never told. The carried state is the whole pin set
// (series, annotation and shape pins); a pinned key the new render no longer has is dropped and the
// host is told once. Keyboard focus on a legend button also survives the rebuild an area-chart pin
// forces.
import { describe, it, expect, afterEach } from "vitest";
import { mountChart } from "../src/engine/render-live";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

/** Minimal ResizeObserver stub — jsdom has none. Same pattern as test/right-legend-resize.test.ts. */
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

const SELECTOR = {
  dimension: { options: [{ id: "sector", label: "Sector" }, { id: "country", label: "Country" }] },
};

const LINE_SPEC = {
  chartType: "line",
  title: "GDP by {dimension}",
  xAxisType: "temporal",
  series_order: ["A", "B", "C"],
  data: "inline",
  title_selectors: SELECTOR,
} as unknown as ChartSpec;

const AREA_SPEC = { ...LINE_SPEC, chartType: "area" } as unknown as ChartSpec;

const makeRows = (): TidyRow[] =>
  ["2024-01-01", "2024-02-01", "2024-03-01"].flatMap((t, i) => [
    { time: t, series: "A", value: String(1 + i) },
    { time: t, series: "B", value: String(2 + i) },
    { time: t, series: "C", value: String(3 + i) },
  ]) as unknown as TidyRow[];

/** Remove every row of `series` IN PLACE. A mount reads its `rows` array on every draw, so this is
 *  how a host's onSelect hands the reselect redraw data that no longer has a pinned series. */
const dropSeries = (rows: TidyRow[], series: string): void => {
  for (let i = rows.length - 1; i >= 0; i--) if ((rows[i] as { series?: string }).series === series) rows.splice(i, 1);
};

const legendItem = (c: HTMLElement, s: string): HTMLElement | undefined =>
  [...c.querySelectorAll<HTMLElement>(".tbl-legend-item")].find((b) => b.getAttribute("data-series") === s);
const resetBtn = (c: HTMLElement): HTMLButtonElement => c.querySelector<HTMLButtonElement>(".tbl-legend-reset")!;
/** Series whose marks are NOT dimmed, across every svg in the container. */
const brightSeries = (c: HTMLElement): string[] =>
  [...new Set(
    [...c.querySelectorAll("svg [data-series]")]
      .filter((el) => !el.classList.contains("tbl-dimmed"))
      .map((el) => el.getAttribute("data-series")!),
  )].sort();
const dimmedCount = (c: HTMLElement): number => c.querySelectorAll("svg .tbl-dimmed").length;
const choose = (c: HTMLElement, id: string): void => {
  c.querySelector<HTMLButtonElement>("button.inline-select")!.click();
  c.querySelector<HTMLLIElement>(`li[data-id="${id}"]`)!.click();
};
const bottomArea = (c: HTMLElement): string | null | undefined =>
  c.querySelector('g[aria-label="area"] path[data-series]')?.getAttribute("data-series");

describe("mountChart — legend pins survive a redraw", () => {
  it("a width-driven resize keeps the pin (DOM state + dimming) and does not notify", async () => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
    const host = document.createElement("div");
    document.body.append(host);
    const seen: string[][] = [];
    mountChart(host, { spec: LINE_SPEC, rows: makeRows(), width: 900, onLegendSelect: (c) => seen.push(c.active) });
    legendItem(host, "A")!.click();
    const svgBefore = host.querySelector(".figure-canvas svg");
    const before = seen.length;

    await resizeTo(host, 700);
    expect(host.querySelector(".figure-canvas svg")).not.toBe(svgBefore); // a real redraw happened
    const a = legendItem(host, "A")!;
    expect(a.getAttribute("aria-pressed")).toBe("true");
    expect(a.classList.contains("is-pinned")).toBe(true);
    expect(legendItem(host, "B")!.getAttribute("aria-pressed")).toBe("false");
    expect(resetBtn(host).hidden).toBe(false);
    expect(dimmedCount(host)).toBeGreaterThan(0);
    expect(brightSeries(host)).toEqual(["A"]);
    // Nothing changed for the host, so nothing is reported.
    expect(seen.length).toBe(before);
  });

  it("a title-selector change keeps the pin when the series is still there", () => {
    const host = document.createElement("div");
    const seen: string[][] = [];
    mountChart(host, { spec: LINE_SPEC, rows: makeRows(), width: 900, onLegendSelect: (c) => seen.push(c.active) });
    legendItem(host, "A")!.click();
    const before = seen.length;
    choose(host, "country");
    expect(legendItem(host, "A")!.getAttribute("aria-pressed")).toBe("true");
    expect(brightSeries(host)).toEqual(["A"]);
    expect(seen.length).toBe(before);
  });

  it("a title-selector change to data lacking a pinned series drops that pin and notifies once", () => {
    const host = document.createElement("div");
    const rows = makeRows();
    const seen: string[][] = [];
    mountChart(host, {
      spec: LINE_SPEC,
      rows,
      width: 900,
      onSelect: () => dropSeries(rows, "A"),
      onLegendSelect: (c) => seen.push(c.active),
    });
    legendItem(host, "A")!.click();
    legendItem(host, "B")!.click();
    const before = seen.length;
    choose(host, "country");

    expect(legendItem(host, "A")).toBeUndefined();
    expect(legendItem(host, "B")!.getAttribute("aria-pressed")).toBe("true");
    expect(brightSeries(host)).toEqual(["B"]);
    expect(seen.slice(before)).toEqual([["B"]]);
  });

  it("dropping the only pin clears the dimming and the reset button, and reports an empty set", () => {
    const host = document.createElement("div");
    const rows = makeRows();
    const seen: string[][] = [];
    mountChart(host, {
      spec: LINE_SPEC,
      rows,
      width: 900,
      onSelect: () => dropSeries(rows, "A"),
      onLegendSelect: (c) => seen.push(c.active),
    });
    legendItem(host, "A")!.click();
    const before = seen.length;
    choose(host, "country");
    expect(dimmedCount(host)).toBe(0);
    expect(resetBtn(host).hidden).toBe(true);
    expect(seen.slice(before)).toEqual([[]]);
  });

  it("an annotation-row pin survives a resize", async () => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
    const host = document.createElement("div");
    document.body.append(host);
    const spec = {
      ...LINE_SPEC,
      annotations: { bands: [{ start: "2024-01-15", end: "2024-02-15", label: "Recession", legend: true }] },
    } as unknown as ChartSpec;
    mountChart(host, { spec, rows: makeRows(), width: 900 });
    const annRow = (): HTMLElement => host.querySelector<HTMLElement>(".tbl-legend-item[data-annotation]")!;
    annRow().click();
    expect(annRow().getAttribute("aria-pressed")).toBe("true");
    await resizeTo(host, 700);
    expect(annRow().getAttribute("aria-pressed")).toBe("true");
    expect(resetBtn(host).hidden).toBe(false);
    expect(brightSeries(host)).toEqual([]); // every series line is dimmed behind the pinned band
  });

  it("area: a pin survives a resize and keeps its series at the bottom of the stack", async () => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
    const host = document.createElement("div");
    document.body.append(host);
    mountChart(host, { spec: AREA_SPEC, rows: makeRows(), width: 900 });
    legendItem(host, "C")!.click();
    expect(bottomArea(host)).toBe("C");
    await resizeTo(host, 700);
    expect(legendItem(host, "C")!.getAttribute("aria-pressed")).toBe("true");
    expect(bottomArea(host)).toBe("C");
    // Still in step: unpinning restores the default order (it would re-pin if the legend had lost it).
    legendItem(host, "C")!.click();
    expect(legendItem(host, "C")!.getAttribute("aria-pressed")).toBe("false");
    expect(bottomArea(host)).toBe("A");
  });

  it("area: dropping the pinned series restores the default stack order and notifies once", () => {
    const host = document.createElement("div");
    const rows = makeRows();
    const seen: string[][] = [];
    const phases: string[] = [];
    mountChart(host, {
      spec: AREA_SPEC,
      rows,
      width: 900,
      onSelect: () => dropSeries(rows, "A"),
      onLegendSelect: (c) => seen.push(c.active),
      onRender: (c) => phases.push(c.phase),
    });
    legendItem(host, "B")!.click();
    legendItem(host, "A")!.click();
    expect(bottomArea(host)).toBe("B");
    const before = seen.length;
    const phasesBefore = phases.length;
    choose(host, "country");
    expect(legendItem(host, "B")!.getAttribute("aria-pressed")).toBe("true");
    expect(bottomArea(host)).toBe("B");
    expect(seen.slice(before)).toEqual([["B"]]);
    expect(phases.slice(phasesBefore)).toEqual(["reselect", "restack"]);

    const seen2 = seen.length;
    dropSeries(rows, "B");
    choose(host, "sector");
    expect(dimmedCount(host)).toBe(0);
    expect(bottomArea(host)).toBe("C"); // series_order's first remaining series, i.e. no restack
    expect(seen.slice(seen2)).toEqual([[]]);
  });

  it("area: each pin fires onLegendSelect once, with the full set (no partial sets from re-applying pins)", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const seen: string[][] = [];
    mountChart(host, { spec: AREA_SPEC, rows: makeRows(), width: 900, onLegendSelect: (c) => seen.push(c.active) });
    legendItem(host, "B")!.click();
    expect(seen).toEqual([["B"]]);
    const focused = legendItem(host, "C")!;
    focused.focus(); // a mouse click focuses the button first in real browsers
    const before = seen.length;
    focused.click();
    expect(seen.slice(before)).toEqual([["B", "C"]]);
  });

  it("area: keyboard focus stays on the legend button after a pin rebuilds the legend", () => {
    const host = document.createElement("div");
    document.body.append(host);
    mountChart(host, { spec: AREA_SPEC, rows: makeRows(), width: 900 });
    const old = legendItem(host, "C")!;
    old.focus();
    expect(document.activeElement).toBe(old);
    old.click(); // Enter/Space on a focused button dispatches this click
    const fresh = legendItem(host, "C")!;
    expect(fresh).not.toBe(old); // the restack really rebuilt the legend
    expect(document.activeElement).toBe(fresh);
    expect(fresh.getAttribute("aria-pressed")).toBe("true");
  });
});

// Faceted path: drawGrid rebuilds the legend the same way, and dims across every pane's svg.
const FACET_SPEC = {
  chartType: "line",
  title: "GDP by {dimension}",
  xAxisType: "temporal",
  series_order: ["A", "B", "C"],
  data: "inline",
  columns: { x: "time", value: "value", series: "series", facet: "pane" },
  small_multiples: { mode: "shared" },
  title_selectors: SELECTOR,
} as unknown as ChartSpec;
const makeFacetRows = (): TidyRow[] =>
  ["P1", "P2"].flatMap((pane) => makeRows().map((r) => ({ ...r, pane }))) as unknown as TidyRow[];

describe("mountFigure — legend pins survive a redraw", () => {
  it("a width-driven resize keeps the pin across every pane and does not notify", async () => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
    const host = document.createElement("div");
    document.body.append(host);
    const seen: string[][] = [];
    mountChart(host, { spec: FACET_SPEC, rows: makeFacetRows(), width: 900, onLegendSelect: (c) => seen.push(c.active) });
    legendItem(host, "A")!.click();
    const svgBefore = host.querySelector(".figure-grid svg");
    const before = seen.length;

    await resizeTo(host, 600);
    expect(host.querySelector(".figure-grid svg")).not.toBe(svgBefore);
    expect(host.querySelectorAll(".figure-grid svg").length).toBe(2);
    expect(legendItem(host, "A")!.getAttribute("aria-pressed")).toBe("true");
    expect(resetBtn(host).hidden).toBe(false);
    expect(brightSeries(host)).toEqual(["A"]);
    for (const svg of host.querySelectorAll(".figure-grid svg")) {
      expect(svg.querySelectorAll(".tbl-dimmed").length).toBeGreaterThan(0);
    }
    expect(seen.length).toBe(before);
  });

  it("a title-selector change to data lacking a pinned series drops that pin and notifies once", () => {
    const host = document.createElement("div");
    const rows = makeFacetRows();
    const seen: string[][] = [];
    mountChart(host, {
      spec: FACET_SPEC,
      rows,
      width: 900,
      onSelect: () => dropSeries(rows, "A"),
      onLegendSelect: (c) => seen.push(c.active),
    });
    legendItem(host, "A")!.click();
    legendItem(host, "C")!.click();
    const before = seen.length;
    choose(host, "country");
    expect(legendItem(host, "A")).toBeUndefined();
    expect(legendItem(host, "C")!.getAttribute("aria-pressed")).toBe("true");
    expect(brightSeries(host)).toEqual(["C"]);
    expect(seen.slice(before)).toEqual([["C"]]);
  });
});

// Fix round 1: the focus hand-back must be silent, and the old legend's HOVER state is carried
// explicitly rather than re-derived from focus. In real browsers a mouse click leaves the button
// focused, so "click to pin, click to unpin, move away, resize" used to end with the series
// re-highlighted and a spurious onLegendSelect.
describe("legend rebuild — focus hand-back is silent; hover is carried as it was", () => {
  const cases: Array<[string, ChartSpec, () => TidyRow[]]> = [
    ["mountChart", LINE_SPEC, makeRows],
    ["mountFigure", FACET_SPEC, makeFacetRows],
  ];
  for (const [path, spec, rowsFor] of cases) {
    it(`${path}: focus, pin, unpin, pointer leaves, resize -> nothing dimmed, no notify, focus kept`, async () => {
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
      const host = document.createElement("div");
      document.body.append(host);
      const seen: string[][] = [];
      mountChart(host, { spec, rows: rowsFor(), width: 900, onLegendSelect: (c) => seen.push(c.active) });
      const c = legendItem(host, "C")!;
      c.focus(); // what a mouse click does to a button in Chrome, Edge and Firefox
      c.click();
      c.click();
      c.dispatchEvent(new Event("pointerleave"));
      expect(dimmedCount(host)).toBe(0);
      const before = seen.length;

      await resizeTo(host, 600);
      expect(dimmedCount(host)).toBe(0);
      expect(seen.length).toBe(before);
      const fresh = legendItem(host, "C")!;
      expect(fresh).not.toBe(c);
      expect(document.activeElement).toBe(fresh);
    });

    it(`${path}: a pointer hover in progress is carried through a resize without a notify`, async () => {
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
      const host = document.createElement("div");
      document.body.append(host);
      const seen: string[][] = [];
      mountChart(host, { spec, rows: rowsFor(), width: 900, onLegendSelect: (c) => seen.push(c.active) });
      legendItem(host, "B")!.dispatchEvent(new Event("pointerenter"));
      expect(brightSeries(host)).toEqual(["B"]);
      const before = seen.length;
      await resizeTo(host, 600);
      expect(brightSeries(host)).toEqual(["B"]);
      expect(seen.length).toBe(before);
      // The carried hover ends the normal way.
      legendItem(host, "B")!.dispatchEvent(new Event("pointerleave"));
      expect(dimmedCount(host)).toBe(0);
    });

    it(`${path}: a dropped pin is reported once, with the remaining pins plus a carried hover`, () => {
      const host = document.createElement("div");
      const rows = rowsFor();
      const seen: string[][] = [];
      mountChart(host, {
        spec,
        rows,
        width: 900,
        onSelect: () => dropSeries(rows, "A"),
        onLegendSelect: (c) => seen.push(c.active),
      });
      legendItem(host, "A")!.click();
      legendItem(host, "C")!.click();
      legendItem(host, "B")!.dispatchEvent(new Event("pointerenter"));
      const before = seen.length;
      choose(host, "country");
      expect(seen.slice(before)).toEqual([["C", "B"]]);
      expect(brightSeries(host)).toEqual(["B", "C"]);
    });

    it(`${path}: a dropped pin is reported once even when onRender throws on that redraw`, () => {
      const host = document.createElement("div");
      document.body.append(host);
      const rows = rowsFor();
      const seen: string[][] = [];
      mountChart(host, {
        spec,
        rows,
        width: 900,
        onSelect: () => dropSeries(rows, "A"),
        onLegendSelect: (c) => seen.push(c.active),
        onRender: (c) => { if (c.phase === "reselect") throw new Error("consumer bug in onRender"); },
      });
      legendItem(host, "A")!.click();
      legendItem(host, "B")!.click();
      const before = seen.length;
      const caught: unknown[] = [];
      const onUncaught = (err: unknown): void => { caught.push(err); };
      process.on("uncaughtException", onUncaught);
      try {
        choose(host, "country");
      } finally {
        process.removeListener("uncaughtException", onUncaught);
      }
      expect(caught.map((e) => (e as Error).message)).toEqual(["consumer bug in onRender"]);
      expect(seen.slice(before)).toEqual([["B"]]);
    });
  }
});
