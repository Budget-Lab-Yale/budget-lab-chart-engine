// @vitest-environment jsdom
//
// B2 (review 2026-10-15): every hover attach returns a detach handle, and render-live calls it
// before each redraw and on teardown. The floating card lives outside the svg, so without this a
// redraw or unmount under a still pointer stranded it, and `onHover` never heard the null that its
// MountOptions doc promises on the end of a hover.
//
// The per-family teardown cells are in hover-snapshots.test.ts ("B2: …"). This file covers what
// those cannot: the card is SHARED per parent, so one chart's teardown must leave another chart's
// card alone; a resize redraw clears the card and reports the end of the hover exactly once; and
// the old hit area stops answering once it is detached. Standalone and small-multiples paths both.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mountHover, mockRect1to1, cardShown, cardText, hoverFirstMark,
  BAR_MARK, DOT_MARK, PLOT_MIDDLE,
} from "./helpers/hover-harness";
import { CROSSHAIR_HIT_SELECTOR } from "../src/engine/crosshair";
import type { BandHoverCtx } from "../src/engine/crosshair";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

beforeEach(() => {
  document.body.innerHTML = "";
});

const spec = (s: Record<string, unknown>): ChartSpec => ({ title: "t", data: "inline", ...s }) as unknown as ChartSpec;
const FACETED = {
  data: "d.csv",
  columns: { x: "time", value: "value", series: "series", facet: "pane" },
  small_multiples: { columns: 2, mode: "shared" },
};
const uncoordinated = { small_multiples: { columns: 2, mode: "shared", coordinated_cursor: false } };

const catRows = (series: Array<[string, number, number]>, pane?: string): TidyRow[] =>
  series.flatMap(([s, a, b]) => [
    { ...(pane ? { pane } : {}), time: "A", series: s, value: String(a) },
    { ...(pane ? { pane } : {}), time: "B", series: s, value: String(b) },
  ]) as unknown as TidyRow[];
const STACKED_CARD: Array<[string, number, number]> = [["Up", 6, 5], ["Down", -4, -2]];
const stackedRows = (faceted: boolean): TidyRow[] =>
  faceted ? [...catRows(STACKED_CARD, "P1"), ...catRows(STACKED_CARD, "P2")] : catRows(STACKED_CARD);
/** A stack with a negative segment hovers with the floating card AND reaches `onHover`. */
const stackedSpec = (faceted: boolean): ChartSpec =>
  spec({ chartType: "stacked", xAxisType: "categorical", series_order: ["Up", "Down"], ...(faceted ? FACETED : {}) });

const temporalRows = (faceted: boolean): TidyRow[] =>
  ["2020-01-01", "2020-02-01", "2020-03-01"].flatMap((t, i) =>
    ["A", "B"].flatMap((s) => [
      { ...(faceted ? { pane: "P1" } : {}), time: t, series: s, value: String(3 + i) },
      ...(faceted ? [{ pane: "P2", time: t, series: s, value: String(5 + i) }] : []),
    ]),
  ) as unknown as TidyRow[];
const lineSpec = (faceted: boolean): ChartSpec =>
  spec({
    chartType: "line", xAxisType: "temporal", series_order: ["A", "B"],
    ...(faceted ? { ...FACETED, ...uncoordinated } : {}),
  });

const SCATTER_ROWS: TidyRow[] = [1, 2, 3, 4].map((x) => ({ time: String(x), series: "A", value: String(x * 2) })) as unknown as TidyRow[];
const SCATTER_SPEC = spec({
  chartType: "scatter", xAxisType: "numeric", columns: { x: "time", value: "value", series: "series" },
});
/** Scatter hover listens on each marker (`attachPointHover`), not on a hit rect. */
function hoverPoint(svg: SVGSVGElement): void {
  svg.querySelector<SVGElement>(DOT_MARK)!.dispatchEvent(
    new PointerEvent("pointerenter", { clientX: 10, clientY: 10, bubbles: true }),
  );
}

describe("B2: one chart's teardown leaves another chart's card alone (cards are shared per parent)", () => {
  // Both mounts use the default tooltip parent, document.body, so they share ONE `.tbl-tooltip`.
  for (const faceted of [false, true]) {
    it(`A = ${faceted ? "a 2-pane line figure (coordinated_cursor: false)" : "a standalone line"}, B = a standalone stack`, () => {
      const a = mountHover(lineSpec(faceted), temporalRows(faceted), faceted);
      const b = mountHover(stackedSpec(false), stackedRows(false));
      hoverFirstMark(a.svgs[0]!, PLOT_MIDDLE);
      expect(cardShown(), "precondition: A's hover shows the card").toBe(true);
      const aText = cardText();
      // No pointerleave on A: the pointer "jumps", which is exactly when A still thinks it is hovering.
      hoverFirstMark(b.svgs[0]!, BAR_MARK);
      expect(cardShown(), "precondition: B's hover shows the card").toBe(true);
      const bText = cardText();
      expect(bText, "precondition: the card now holds B's content").not.toBe(aText);
      expect(document.querySelectorAll(".tbl-tooltip").length, "precondition: one shared card").toBe(1);

      a.teardown();
      expect(cardShown(), "A's teardown hid B's card").toBe(true);
      expect(cardText()).toBe(bText);

      b.teardown();
      expect(cardShown(), "B's own teardown left its card showing").toBe(false);
    });
  }

  it("A = a scatter (per-point hover), B = a standalone stack", () => {
    const a = mountHover(SCATTER_SPEC, SCATTER_ROWS);
    const b = mountHover(stackedSpec(false), stackedRows(false));
    hoverPoint(a.svgs[0]!);
    expect(cardShown(), "precondition: the scatter's hover shows the card").toBe(true);
    hoverFirstMark(b.svgs[0]!, BAR_MARK);
    const bText = cardText();
    a.teardown();
    expect(cardShown(), "the scatter's teardown hid B's card").toBe(true);
    expect(cardText()).toBe(bText);
  });

  it("a scatter's own teardown hides the card it is showing", () => {
    const a = mountHover(SCATTER_SPEC, SCATTER_ROWS);
    hoverPoint(a.svgs[0]!);
    expect(cardShown(), "precondition: the scatter's hover shows the card").toBe(true);
    a.teardown();
    expect(cardShown()).toBe(false);
  });
});

describe("B2: a resize redraw under a still pointer hides the card and sends onHover(null) once", () => {
  /** jsdom has no ResizeObserver; this one captures the callback so the test can fire it. */
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
  beforeEach(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
  });
  afterEach(() => {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    FakeResizeObserver.instances = [];
  });
  /** Fire the engine's own resize redraw at a width different from the mount's. */
  async function resize(container: HTMLElement): Promise<void> {
    const card = container.querySelector<HTMLElement>(".figure-card")!;
    Object.defineProperty(card, "clientWidth", { value: 480, configurable: true });
    expect(FakeResizeObserver.instances.length).toBeGreaterThan(0);
    for (const inst of FakeResizeObserver.instances) inst.cb([], inst as unknown as ResizeObserver);
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
  }

  for (const faceted of [false, true]) {
    it(faceted ? "2-pane stack (card with cross-pane echo)" : "standalone stack", async () => {
      const hovers: Array<BandHoverCtx | null> = [];
      const m = mountHover(stackedSpec(faceted), stackedRows(faceted), faceted, { onHover: (c) => { hovers.push(c); } });
      hoverFirstMark(m.svgs[0]!, BAR_MARK);
      expect(cardShown(), "precondition: the hover shows the card").toBe(true);
      expect(hovers[hovers.length - 1], "precondition: onHover reported the hovered category").not.toBeNull();
      const before = hovers.length;

      // A different width, so draw() / drawGrid() does not take its same-width early return.
      const card = m.container.querySelector<HTMLElement>(".figure-card")!;
      Object.defineProperty(card, "clientWidth", { value: 480, configurable: true });
      expect(FakeResizeObserver.instances.length).toBeGreaterThan(0);
      for (const inst of FakeResizeObserver.instances) inst.cb([], inst as unknown as ResizeObserver);
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));

      const fresh = m.container.querySelector(faceted ? ".figure-pane svg" : ".figure-canvas svg");
      expect(fresh, "precondition: the resize replaced the svg").not.toBe(m.svgs[0]);
      expect(cardShown(), "the card survived the redraw").toBe(false);
      expect(hovers.slice(before), "onHover after the redraw").toEqual([null]);
      m.teardown();
      expect(hovers.slice(before), "teardown re-sent onHover(null) for a hover already ended").toEqual([null]);
    });
  }

  // The detach now reaches the consumer's onHover from inside draw(). A consumer that throws there
  // must not cost the chart its redraw; the error still surfaces, on its own microtask (the same
  // treatment as a throwing "mount" onRender, events.test.ts).
  it("an onHover that throws on null neither blocks the redraw nor is swallowed", async () => {
    let caught: unknown;
    const onUncaught = (err: unknown): void => { caught = err; };
    process.once("uncaughtException", onUncaught);
    try {
      const m = mountHover(stackedSpec(false), stackedRows(false), false, {
        onHover: (c) => { if (c === null) throw new Error("consumer boom"); },
      });
      hoverFirstMark(m.svgs[0]!, BAR_MARK);
      const card = m.container.querySelector<HTMLElement>(".figure-card")!;
      Object.defineProperty(card, "clientWidth", { value: 480, configurable: true });
      for (const inst of FakeResizeObserver.instances) inst.cb([], inst as unknown as ResizeObserver);
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      expect(m.container.querySelector(".figure-canvas svg"), "the redraw did not happen").not.toBe(m.svgs[0]);
      expect(cardShown()).toBe(false);
      await new Promise((r) => setTimeout(r, 0));
      expect((caught as Error | undefined)?.message).toBe("consumer boom");
    } finally {
      process.removeListener("uncaughtException", onUncaught);
    }
  });

  // The null a redraw now sends reaches the consumer synchronously, from inside draw(). A consumer
  // that unmounts in response (the callback, or a `tbl-hover` listener) must not get a chart back:
  // draw() carrying on would render a fresh svg and wire fresh hover onto a disposed mount.
  for (const faceted of [false, true]) {
    for (const via of ["onHover", "tbl-hover"] as const) {
      it(`${faceted ? "2-pane" : "standalone"} stack: a teardown from ${via}(null) during the redraw stops it`, async () => {
        let teardown: (() => void) | undefined;
        let tornDown = 0;
        const end = (c: BandHoverCtx | null): void => {
          if (c === null && teardown) { tornDown++; teardown(); }
        };
        const m = mountHover(stackedSpec(faceted), stackedRows(faceted), faceted,
          via === "onHover" ? { onHover: end } : {});
        if (via === "tbl-hover") {
          m.container.addEventListener("tbl-hover", (e) => end((e as CustomEvent<BandHoverCtx | null>).detail));
        }
        teardown = m.teardown;
        hoverFirstMark(m.svgs[0]!, BAR_MARK);
        expect(cardShown(), "precondition: the hover shows the card").toBe(true);

        await resize(m.container);
        expect(tornDown, "precondition: the redraw sent null and the consumer tore down").toBe(1);
        const sel = faceted ? ".figure-pane svg" : ".figure-canvas svg";
        const svg = m.container.querySelector<SVGSVGElement>(sel)!;
        expect(svg, "a disposed mount drew a new svg").toBe(m.svgs[0]);
        // Hover whatever svg is on the page: a disposed mount must not answer.
        mockRect1to1(svg);
        hoverFirstMark(svg, BAR_MARK);
        expect(cardShown(), "a disposed mount re-showed its card").toBe(false);
      });
    }
  }
});

describe("B2: a title-selector reselect redraw hides the card and sends onHover(null) once", () => {
  const selectorSpec = (faceted: boolean): ChartSpec => ({
    ...stackedSpec(faceted),
    title: "Deficit by {view}",
    title_selectors: { view: { options: [{ id: "a", label: "A" }, { id: "b", label: "B" }], default: "a" } },
  }) as ChartSpec;

  for (const faceted of [false, true]) {
    it(faceted ? "2-pane stack" : "standalone stack", () => {
      const hovers: Array<BandHoverCtx | null> = [];
      const m = mountHover(selectorSpec(faceted), stackedRows(faceted), faceted, { onHover: (c) => { hovers.push(c); } });
      hoverFirstMark(m.svgs[0]!, BAR_MARK);
      expect(cardShown(), "precondition: the hover shows the card").toBe(true);
      const before = hovers.length;

      m.container.querySelector<HTMLButtonElement>("button.inline-select")!.click();
      m.container.querySelector<HTMLLIElement>('ul.inline-select-popover li[data-id="b"]')!.click();

      const sel = faceted ? ".figure-pane svg" : ".figure-canvas svg";
      expect(m.container.querySelector(sel), "precondition: the reselect redrew").not.toBe(m.svgs[0]);
      expect(cardShown(), "the card survived the reselect").toBe(false);
      expect(hovers.slice(before), "onHover after the reselect").toEqual([null]);
    });
  }
});

describe("B2: a torn-down treemap stops answering", () => {
  const TREEMAP_SPEC = spec({
    chartType: "treemap", xAxisType: "categorical", data: "d.csv",
    columns: { x: "category", value: "amount", series: "group" },
  });
  const TREEMAP_ROWS = [
    { group: "Mandatory", category: "Social Security", amount: "1461" },
    { group: "Mandatory", category: "Medicare", amount: "874" },
    { group: "Discretionary", category: "Defense", amount: "850" },
  ] as unknown as TidyRow[];
  const enterTile = (svg: SVGSVGElement): void => {
    svg.querySelector("rect.tbl-treemap-tile")!.parentElement!
      .dispatchEvent(new PointerEvent("pointerenter", { clientX: 10, clientY: 10, bubbles: true }));
  };

  it("a pointerenter on a tile after teardown shows no card and no outline", () => {
    const m = mountHover(TREEMAP_SPEC, TREEMAP_ROWS);
    enterTile(m.svgs[0]!);
    expect(cardShown(), "precondition: the tile hover shows the card").toBe(true);
    m.teardown();
    expect(cardShown()).toBe(false);
    enterTile(m.svgs[0]!);
    expect(cardShown(), "a torn-down treemap re-showed its card").toBe(false);
    expect(m.svgs[0]!.querySelector(".tbl-treemap-hover-outline"), "a torn-down treemap drew an outline").toBeNull();
  });
});

describe("B2: a detached hit area stops answering", () => {
  // teardown() leaves the card in its container (render-live's `disposed` note), so the old svg
  // is still on the page; its listeners must be gone, or a later move re-shows a card nobody clears.
  for (const faceted of [false, true]) {
    it(faceted ? "2-pane stack" : "standalone stack", () => {
      const hovers: Array<BandHoverCtx | null> = [];
      const m = mountHover(stackedSpec(faceted), stackedRows(faceted), faceted, { onHover: (c) => { hovers.push(c); } });
      hoverFirstMark(m.svgs[0]!, BAR_MARK);
      expect(cardShown(), "precondition: the hover shows the card").toBe(true);
      m.teardown();
      const after = hovers.length;
      expect(m.svgs[0]!.querySelector(CROSSHAIR_HIT_SELECTOR), "precondition: the hit rect is still in the DOM").not.toBeNull();
      hoverFirstMark(m.svgs[0]!, BAR_MARK);
      expect(cardShown(), "a move on the torn-down chart showed the card").toBe(false);
      expect(hovers.length, "a move on the torn-down chart reached onHover").toBe(after);
    });
  }
});
