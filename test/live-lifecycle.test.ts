// @vitest-environment jsdom
//
// T2.8 (review 2026-10-15, render-live.md and crosshair.md MINOR findings): the live mount's smaller
// lifecycle gaps.
//   1. Callbacks after teardown: a host that tears the mount down from inside one of its own
//      callbacks must hear nothing more from it.
//   2. A failed draw clears the chrome of the last good one, retries at the same width, and prints its
//      message as text.
//   3. A line chart with one x value draws its crosshair guide at a real coordinate, not NaN.
//   5. A card at width 0 (a hidden tab) is not redrawn until it has a width again; an area restack
//      redraws at the card's width, not its chart column's.
// Standalone (mountChart) and small-multiples (mountFigure) paths where both apply.
import { describe, it, expect, afterEach } from "vitest";
import { mountChart, type MountOptions } from "../src/engine/render-live";
import { mockRect1to1, hoverPlotAt, hoverFirstMark, cardShown, BAR_MARK, DOT_MARK } from "./helpers/hover-harness";
import type { BandHoverCtx } from "../src/engine/crosshair";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

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
const useFakeRO = (): void => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
};
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
const FACET_SPEC = {
  ...LINE_SPEC,
  columns: { x: "time", value: "value", series: "series", facet: "pane" },
  small_multiples: { mode: "shared" },
} as unknown as ChartSpec;
const makeRows = (): TidyRow[] =>
  ["2024-01-01", "2024-02-01", "2024-03-01"].flatMap((t, i) => [
    { time: t, series: "A", value: String(1 + i) },
    { time: t, series: "B", value: String(2 + i) },
    { time: t, series: "C", value: String(3 + i) },
  ]) as unknown as TidyRow[];
const makeFacetRows = (): TidyRow[] =>
  ["P1", "P2"].flatMap((pane) => makeRows().map((r) => ({ ...r, pane }))) as unknown as TidyRow[];
const dropSeries = (rows: TidyRow[], series: string): void => {
  for (let i = rows.length - 1; i >= 0; i--) if ((rows[i] as { series?: string }).series === series) rows.splice(i, 1);
};
const legendItem = (c: HTMLElement, s: string): HTMLElement | undefined =>
  [...c.querySelectorAll<HTMLElement>(".tbl-legend-item")].find((b) => b.getAttribute("data-series") === s);
const choose = (c: HTMLElement, id: string): void => {
  c.querySelector<HTMLButtonElement>("button.inline-select")!.click();
  c.querySelector<HTMLLIElement>(`li[data-id="${id}"]`)!.click();
};
const svgsOf = (c: HTMLElement): SVGSVGElement[] =>
  [...c.querySelectorAll<SVGSVGElement>(".figure-canvas svg, .figure-pane svg")];

const PATHS: Array<[string, ChartSpec, () => TidyRow[]]> = [
  ["standalone", LINE_SPEC, makeRows],
  ["2-pane figure", FACET_SPEC, makeFacetRows],
];

// ---------------------------------------------------------------------------------------------
// 1. Callbacks after teardown
// ---------------------------------------------------------------------------------------------
describe("T2.8 item 1: a mount torn down from inside its own callback goes quiet", () => {
  for (const [path, spec, rowsFor] of PATHS) {
    it(`${path}: a teardown in onSelect gets no reselect redraw and no onRender`, () => {
      const host = document.createElement("div");
      document.body.append(host);
      const phases: string[] = [];
      let teardown = (): void => {};
      teardown = mountChart(host, {
        spec, rows: rowsFor(), width: 900,
        onSelect: () => teardown(),
        onRender: (c) => phases.push(c.phase),
      });
      const before = svgsOf(host);
      choose(host, "country");
      expect(phases).toEqual([]);
      expect(svgsOf(host)).toEqual(before);
    });

    it(`${path}: a teardown in onRender("reselect") stops the dropped-pin report that follows it`, () => {
      const host = document.createElement("div");
      document.body.append(host);
      const rows = rowsFor();
      const seen: string[][] = [];
      let teardown = (): void => {};
      teardown = mountChart(host, {
        spec, rows, width: 900,
        onSelect: () => dropSeries(rows, "A"),
        onLegendSelect: (c) => seen.push(c.active),
        onRender: (c) => { if (c.phase === "reselect") teardown(); },
      });
      legendItem(host, "A")!.click();
      legendItem(host, "B")!.click();
      const before = seen.length;
      choose(host, "country");
      expect(seen.slice(before), "a disposed mount reported a dropped pin").toEqual([]);
    });
  }

  for (const [path, spec, rowsFor] of [...PATHS, ["area", AREA_SPEC, makeRows] as const]) {
    it(`${path}: a legend click after teardown sends no onLegendSelect`, () => {
      const host = document.createElement("div");
      document.body.append(host);
      const seen: string[][] = [];
      const phases: string[] = [];
      const teardown = mountChart(host, {
        spec, rows: rowsFor(), width: 900,
        onLegendSelect: (c) => seen.push(c.active),
        onRender: (c) => phases.push(c.phase),
      });
      teardown();
      legendItem(host, "A")!.click();
      expect(seen).toEqual([]);
      expect(phases, "a disposed area chart restacked").toEqual([]);
    });
  }

  for (const [path, spec, rowsFor] of PATHS) {
    it(`${path}: a title-selector pick after teardown sends no onSelect, tbl-title-select or redraw`, () => {
      const host = document.createElement("div");
      document.body.append(host);
      const selects: unknown[] = [];
      const events: unknown[] = [];
      const phases: string[] = [];
      host.addEventListener("tbl-title-select", (e) => events.push((e as CustomEvent).detail));
      const teardown = mountChart(host, {
        spec, rows: rowsFor(), width: 900,
        onSelect: (s) => selects.push(s),
        onRender: (c) => phases.push(c.phase),
      });
      const svgs = svgsOf(host);
      teardown();
      choose(host, "country");
      expect(selects).toEqual([]);
      expect(events).toEqual([]);
      expect(phases).toEqual([]);
      expect(svgsOf(host)).toEqual(svgs);
    });
  }

  for (const [path, spec, rowsFor] of PATHS) {
    // A resize redraw, not a title-selector pick: the selector's popover takes focus itself.
    it(`${path}: a teardown in the dropped-pin onLegendSelect gets no focus hand-back`, async () => {
      useFakeRO();
      const host = document.createElement("div");
      document.body.append(host);
      const rows = rowsFor();
      let teardown = (): void => {};
      let armed = false;
      teardown = mountChart(host, {
        spec, rows, width: 900,
        onLegendSelect: () => { if (armed) { armed = false; teardown(); } },
      });
      legendItem(host, "A")!.click();
      legendItem(host, "C")!.click();
      legendItem(host, "C")!.focus();
      expect(document.activeElement, "precondition: focus on the legend").toBe(legendItem(host, "C"));
      dropSeries(rows, "A");
      armed = true;
      await resizeTo(host, 700);
      expect(armed, "precondition: the drop was reported").toBe(false);
      expect(legendItem(host, "C"), "precondition: the redraw rebuilt the legend").toBeDefined();
      expect(document.activeElement?.closest(".tbl-legend") ?? null, "focus was handed to a torn-down legend").toBeNull();
    });
  }

  it("2-pane figure: a teardown in the first pane's onRender stops the second pane's", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const phases: string[] = [];
    let teardown = (): void => {};
    teardown = mountChart(host, {
      spec: FACET_SPEC, rows: makeFacetRows(), width: 900,
      onRender: (c) => { phases.push(c.phase); if (c.phase === "reselect") teardown(); },
    });
    choose(host, "country");
    expect(phases).toEqual(["reselect"]);
  });

  // Carried from T2.2: the restack tail (morph + onLegendSelect) ran on a mount the consumer tore
  // down from the restack draw's onRender.
  it('area: a teardown in onRender("restack") stops the onLegendSelect and the morph after it', () => {
    const host = document.createElement("div");
    document.body.append(host);
    const seen: string[][] = [];
    let teardown = (): void => {};
    let rafCalls = 0;
    const realRaf = window.requestAnimationFrame;
    teardown = mountChart(host, {
      spec: AREA_SPEC, rows: makeRows(), width: 900,
      onLegendSelect: (c) => seen.push(c.active),
      onRender: (c) => { if (c.phase === "restack") teardown(); },
    });
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => { rafCalls++; return realRaf(cb); }) as typeof realRaf;
    try {
      legendItem(host, "C")!.click();
    } finally {
      window.requestAnimationFrame = realRaf;
    }
    expect(seen, "a disposed mount sent onLegendSelect").toEqual([]);
    expect(rafCalls, "a disposed mount started the restack morph").toBe(0);
  });
});

// A callback and its bubbling event are one notification. A teardown from inside the callback
// must also stop the event: a host page listening on an ancestor would otherwise hear from a mount
// its own code had just torn down.
describe("T2.8 item 1: a teardown inside a callback stops that callback's bubbling event", () => {
  const STACK_SPEC = {
    chartType: "stacked", title: "Deficit by {dimension}", xAxisType: "categorical",
    series_order: ["Up", "Down"], data: "inline", title_selectors: SELECTOR,
  } as unknown as ChartSpec;
  const STACK_FACET = {
    ...STACK_SPEC,
    columns: { x: "time", value: "value", series: "series", facet: "pane" },
    small_multiples: { columns: 2, mode: "shared" },
  } as unknown as ChartSpec;
  const stackRows = (faceted: boolean): TidyRow[] =>
    (faceted ? ["P1", "P2"] : [undefined]).flatMap((pane) =>
      [["Up", "6", "5"], ["Down", "-4", "-2"]].flatMap(([s, a, b]) => [
        { ...(pane ? { pane } : {}), time: "A", series: s, value: a },
        { ...(pane ? { pane } : {}), time: "B", series: s, value: b },
      ]),
    ) as unknown as TidyRow[];

  /** Mount inside an ancestor that records every bubbling tbl-* event. */
  function mountIn(faceted: boolean, extra: Partial<MountOptions>, teardownFrom: (t: () => void) => Partial<MountOptions>) {
    const page = document.createElement("section");
    const host = document.createElement("div");
    page.append(host);
    document.body.append(page);
    const heard: Array<{ type: string; detail: unknown }> = [];
    for (const type of ["tbl-hover", "tbl-render", "tbl-legend-select", "tbl-title-select"]) {
      page.addEventListener(type, (e) => heard.push({ type, detail: (e as CustomEvent).detail }));
    }
    let teardown = (): void => {};
    teardown = mountChart(host, {
      spec: faceted ? STACK_FACET : STACK_SPEC, rows: stackRows(faceted), width: 900,
      ...extra, ...teardownFrom(() => teardown()),
    });
    return { host, heard, teardown: () => teardown() };
  }
  const flush = (): Promise<void> => new Promise((r) => queueMicrotask(r));

  for (const faceted of [false, true]) {
    const path = faceted ? "2-pane figure" : "standalone";

    it(`${path}: onRender("reselect") -> no tbl-render`, () => {
      const m = mountIn(faceted, {}, (td) => ({ onRender: (c) => { if (c.phase === "reselect") td(); } }));
      choose(m.host, "country");
      expect(m.heard.filter((h) => h.type === "tbl-render")).toEqual([]);
    });

    it(`${path}: onRender("mount") -> no tbl-render`, async () => {
      const m = mountIn(faceted, {}, (td) => ({ onRender: () => td() }));
      await flush();
      expect(m.heard.filter((h) => h.type === "tbl-render")).toEqual([]);
    });

    it(`${path}: onLegendSelect -> no tbl-legend-select`, () => {
      const m = mountIn(faceted, {}, (td) => ({ onLegendSelect: () => td() }));
      legendItem(m.host, "Up")!.click();
      expect(m.heard.filter((h) => h.type === "tbl-legend-select")).toEqual([]);
    });

    it(`${path}: onSelect -> no tbl-title-select`, () => {
      const m = mountIn(faceted, {}, (td) => ({ onSelect: () => td() }));
      choose(m.host, "country");
      expect(m.heard.filter((h) => h.type === "tbl-title-select")).toEqual([]);
    });

    it(`${path}: onHover(ctx) -> no tbl-hover for that ctx; the teardown's own null still bubbles`, () => {
      const hovers: Array<BandHoverCtx | null> = [];
      const m = mountIn(faceted, {}, (td) => ({
        onHover: (c) => { hovers.push(c); if (c) td(); },
      }));
      const svg = m.host.querySelector<SVGSVGElement>(faceted ? ".figure-pane svg" : ".figure-canvas svg")!;
      mockRect1to1(svg);
      hoverFirstMark(svg, BAR_MARK);
      expect(hovers[0], "precondition: the hover resolved").not.toBeNull();
      expect(hovers.slice(1), "the teardown's own null reached onHover").toEqual([null]);
      expect(m.heard.filter((h) => h.type === "tbl-hover").map((h) => h.detail)).toEqual([null]);
    });

    it(`${path}: a plain teardown under a hover sends onHover(null) and its tbl-hover null`, () => {
      const hovers: Array<BandHoverCtx | null> = [];
      const m = mountIn(faceted, { onHover: (c) => { hovers.push(c); } }, () => ({}));
      const svg = m.host.querySelector<SVGSVGElement>(faceted ? ".figure-pane svg" : ".figure-canvas svg")!;
      mockRect1to1(svg);
      hoverFirstMark(svg, BAR_MARK);
      const before = { cb: hovers.length, ev: m.heard.filter((h) => h.type === "tbl-hover").length };
      m.teardown();
      expect(hovers.slice(before.cb)).toEqual([null]);
      expect(m.heard.filter((h) => h.type === "tbl-hover").slice(before.ev).map((h) => h.detail)).toEqual([null]);
    });
  }

  // Re-entrant teardown: the teardown's own onHover(null) runs while the teardown is still in
  // progress, so anything it triggers must read the mount's disposal, not a later-set flag.
  for (const faceted of [false, true]) {
    const path = faceted ? "2-pane figure" : "standalone";
    it(`${path}: a title-selector pick from the teardown's own onHover(null) fires nothing`, () => {
      const selects: unknown[] = [];
      const renders: string[] = [];
      let host: HTMLElement | undefined;
      let tearing = false;
      const m = mountIn(faceted, {
        onSelect: (s) => selects.push(s),
        onRender: (c) => renders.push(c.phase),
        onHover: (c) => { if (c === null && tearing) choose(host!, "country"); },
      }, () => ({}));
      host = m.host;
      const svg = m.host.querySelector<SVGSVGElement>(faceted ? ".figure-pane svg" : ".figure-canvas svg")!;
      mockRect1to1(svg);
      hoverFirstMark(svg, BAR_MARK);
      tearing = true;
      m.teardown();
      expect(m.host.querySelector("li.is-active")?.getAttribute("data-id"), "precondition: the pick happened").toBe("country");
      expect(selects).toEqual([]);
      expect(m.heard.filter((h) => h.type === "tbl-title-select")).toEqual([]);
      expect(renders.filter((p) => p !== "mount")).toEqual([]);
    });

    it(`${path}: a legend click from the teardown's own onHover(null) fires nothing`, () => {
      const seen: string[][] = [];
      let host: HTMLElement | undefined;
      let tearing = false;
      const m = mountIn(faceted, {
        onLegendSelect: (c) => seen.push(c.active),
        onHover: (c) => { if (c === null && tearing) legendItem(host!, "Up")!.click(); },
      }, () => ({}));
      host = m.host;
      const svg = m.host.querySelector<SVGSVGElement>(faceted ? ".figure-pane svg" : ".figure-canvas svg")!;
      mockRect1to1(svg);
      hoverFirstMark(svg, BAR_MARK);
      tearing = true;
      m.teardown();
      expect(seen).toEqual([]);
      expect(m.heard.filter((h) => h.type === "tbl-legend-select")).toEqual([]);
    });
  }

  // runHoverDetaches runs the detaches one by one, so while the first pane's sends its null, the
  // other panes' hover is still wired. A hover there must not reach the host either.
  for (const faceted of [false, true]) {
    const path = faceted ? "2-pane figure: a hover on the other pane" : "standalone: a re-hover";
    it(`${path} from the teardown's own onHover(null) fires nothing`, () => {
      const hovers: Array<BandHoverCtx | null> = [];
      let svgs: SVGSVGElement[] = [];
      let tearing = false;
      const m = mountIn(faceted, {
        onHover: (c) => {
          hovers.push(c);
          if (c === null && tearing) { tearing = false; hoverFirstMark(svgs[svgs.length - 1]!, BAR_MARK); }
        },
      }, () => ({}));
      svgs = [...m.host.querySelectorAll<SVGSVGElement>(faceted ? ".figure-pane svg" : ".figure-canvas svg")];
      svgs.forEach(mockRect1to1);
      hoverFirstMark(svgs[0]!, BAR_MARK);
      const before = { cb: hovers.length, ev: m.heard.filter((h) => h.type === "tbl-hover").length };
      tearing = true;
      m.teardown();
      expect(hovers.slice(before.cb), "only the teardown's own null").toEqual([null]);
      expect(m.heard.filter((h) => h.type === "tbl-hover").slice(before.ev).map((h) => h.detail)).toEqual([null]);
    });
  }

  it("area: onRender(\"restack\") -> no tbl-render and no tbl-legend-select", () => {
    const page = document.createElement("section");
    const host = document.createElement("div");
    page.append(host);
    document.body.append(page);
    const heard: string[] = [];
    for (const type of ["tbl-render", "tbl-legend-select"]) page.addEventListener(type, () => heard.push(type));
    let teardown = (): void => {};
    teardown = mountChart(host, {
      spec: AREA_SPEC, rows: makeRows(), width: 900,
      onRender: (c) => { if (c.phase === "restack") teardown(); },
    });
    legendItem(host, "C")!.click();
    expect(heard).toEqual([]);
  });
});

// A user hook that runs inside draw()/drawGrid() can tear the mount down mid-redraw. From that
// moment the redraw must stop: no onRender, no tbl-render, and not one more change to the card.
// A MutationObserver started inside the hook, right after the teardown, records anything after it.
describe("T2.8 item 1: a teardown from a user hook during a redraw stops the redraw", () => {
  type Armed = { on: boolean };
  function mountArmed(spec: ChartSpec, rows: TidyRow[], hook: "afterRender" | "legendKey" | "tickLabel") {
    const page = document.createElement("section");
    const host = document.createElement("div");
    page.append(host);
    document.body.append(page);
    const heard: string[] = [];
    page.addEventListener("tbl-render", (e) => heard.push((e as CustomEvent).detail.phase));
    const phases: string[] = [];
    const armed: Armed = { on: false };
    let teardown = (): void => {};
    let mo: MutationObserver | undefined;
    // Counted in the callback too: an async redraw (resize) lets the records be delivered before
    // the test reads them, and takeRecords() returns only the undelivered ones.
    let delivered = 0;
    const fire = (): void => {
      if (!armed.on) return;
      armed.on = false;
      teardown();
      mo = new MutationObserver((recs) => { delivered += chartRecords(recs); });
      mo.observe(host, { subtree: true, childList: true, attributes: true, characterData: true, attributeOldValue: true });
    };
    teardown = mountChart(host, {
      spec, rows, width: 900,
      onRender: (c) => phases.push(c.phase),
      hooks: hook === "afterRender" ? { afterRender: () => { fire(); } }
        : hook === "legendKey" ? { legendKey: () => { fire(); return null; } }
        : { tickLabel: () => { fire(); return null; } },
    } as MountOptions);
    return {
      host, armed,
      /** Non-mount onRender phases, tbl-render phases, and DOM changes after the teardown. */
      after: () => ({
        torn: mo !== undefined,
        onRender: phases.filter((p) => p !== "mount"),
        tblRender: heard.filter((p) => p !== "mount"),
        mutations: mo ? delivered + chartRecords(mo.takeRecords()) : -1,
      }),
    };
  }
  const QUIET = { torn: true, onRender: [], tblRender: [], mutations: 0 };
  /** Every record except a same-value write of `hidden` / `aria-expanded`. A title-selector pick
   *  finishes by closing its own popover after its callback returns; teardown has already closed
   *  it, so those two writes set the values they already hold. That is the user's click completing
   *  in the header widget, not the chart redrawing. Anything that CHANGES a value counts. */
  function chartRecords(recs: MutationRecord[]): number {
    return recs.filter((r) => {
      if (r.type !== "attributes" || (r.attributeName !== "hidden" && r.attributeName !== "aria-expanded")) return true;
      return (r.target as Element).getAttribute(r.attributeName) !== r.oldValue;
    }).length;
  }

  for (const [path, spec, rowsFor] of PATHS) {
    it(`${path}: afterRender tears down during a reselect`, () => {
      const m = mountArmed(spec, rowsFor(), "afterRender");
      const before = svgsOf(m.host);
      m.armed.on = true;
      choose(m.host, "country");
      expect(m.after()).toEqual(QUIET);
      expect(svgsOf(m.host), "the previous chart stays").toEqual(before);
    });

    it(`${path}: afterRender tears down during a resize redraw`, async () => {
      useFakeRO();
      const m = mountArmed(spec, rowsFor(), "afterRender");
      m.armed.on = true;
      await resizeTo(m.host, 700);
      expect(m.after()).toEqual(QUIET);
    });

    it(`${path}: tickLabel tears down during a reselect`, () => {
      const m = mountArmed(spec, rowsFor(), "tickLabel");
      const before = svgsOf(m.host);
      m.armed.on = true;
      choose(m.host, "country");
      expect(m.after()).toEqual(QUIET);
      expect(svgsOf(m.host), "the previous chart stays").toEqual(before);
    });

    it(`${path}: legendKey tears down during a resize redraw`, async () => {
      useFakeRO();
      const m = mountArmed(spec, rowsFor(), "legendKey");
      const before = svgsOf(m.host);
      m.armed.on = true;
      await resizeTo(m.host, 700);
      expect(m.after()).toEqual(QUIET);
      // The hook runs after the new chart is in place and the old legend is cleared.
      expect(svgsOf(m.host)[0], "the new chart is in place").not.toBe(before[0]);
      expect(m.host.querySelector(".tbl-legend"), "no legend").toBeNull();
    });
  }

  // Small multiples have no restack, so the area case is standalone only.
  it("standalone area: afterRender tears down during a restack", () => {
    const m = mountArmed(AREA_SPEC, makeRows(), "afterRender");
    const pinned = legendItem(m.host, "C")!;
    m.armed.on = true;
    pinned.click();
    expect(m.after()).toEqual(QUIET);
  });
});

// The same at hover time: the band and categorical crosshairs call the host (onHover, hooks.tooltip)
// in the middle of a pointermove, and a teardown there must not be followed by the card showing.
describe("T2.8 item 1: a teardown from a hover-time callback leaves no card", () => {
  // A stack with a negative value hovers with the floating card (netDisplay dot → tooltip mode).
  const stack = (faceted: boolean): ChartSpec => ({
    chartType: "stacked", title: "t", xAxisType: "categorical", series_order: ["Up", "Down"], data: "inline",
    ...(faceted ? {
      columns: { x: "time", value: "value", series: "series", facet: "pane" },
      small_multiples: { columns: 2, mode: "shared", coordinated_cursor: false },
    } : {}),
  }) as unknown as ChartSpec;
  const rows = (faceted: boolean): TidyRow[] =>
    (faceted ? ["P1", "P2"] : [undefined]).flatMap((pane) =>
      [["Up", "6", "5"], ["Down", "-4", "-2"]].flatMap(([s, a, b]) => [
        { ...(pane ? { pane } : {}), time: "A", series: s, value: a },
        { ...(pane ? { pane } : {}), time: "B", series: s, value: b },
      ]),
    ) as unknown as TidyRow[];
  const dotplot = (faceted: boolean): ChartSpec => ({
    ...stack(faceted), chartType: "dotplot",
  }) as unknown as ChartSpec;

  function mountAndHover(spec: ChartSpec, r: TidyRow[], faceted: boolean, mark: string, via: "onHover" | "tooltip") {
    const host = document.createElement("div");
    document.body.append(host);
    let teardown = (): void => {};
    let armed = true;
    const fire = (): void => { if (armed) { armed = false; teardown(); } };
    teardown = mountChart(host, {
      spec, rows: r, width: faceted ? 838 : 720, height: faceted ? 420 : 400,
      ...(via === "onHover" ? { onHover: (c: BandHoverCtx | null) => { if (c) fire(); } } : {}),
      ...(via === "tooltip" ? { hooks: { tooltip: () => { fire(); return null; } } } : {}),
    } as MountOptions);
    const svg = host.querySelector<SVGSVGElement>(faceted ? ".figure-pane svg" : ".figure-canvas svg")!;
    mockRect1to1(svg);
    hoverFirstMark(svg, mark);
    return { armed: () => armed };
  }

  for (const faceted of [false, true]) {
    const path = faceted ? "2-pane figure (coordinated_cursor: false)" : "standalone";
    it(`${path} stack: a teardown in onHover leaves no card`, () => {
      const m = mountAndHover(stack(faceted), rows(faceted), faceted, BAR_MARK, "onHover");
      expect(m.armed(), "precondition: onHover fired").toBe(false);
      expect(cardShown()).toBe(false);
    });
    it(`${path} stack: a teardown in hooks.tooltip leaves no card`, () => {
      const m = mountAndHover(stack(faceted), rows(faceted), faceted, BAR_MARK, "tooltip");
      expect(m.armed(), "precondition: the tooltip hook fired").toBe(false);
      expect(cardShown()).toBe(false);
    });
    it(`${path} dot plot: a teardown in hooks.tooltip leaves no card`, () => {
      const m = mountAndHover(dotplot(faceted), rows(faceted), faceted, DOT_MARK, "tooltip");
      expect(m.armed(), "precondition: the tooltip hook fired").toBe(false);
      expect(cardShown()).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------------------------
// 2. Draw failure
// ---------------------------------------------------------------------------------------------
describe("T2.8 item 2: a failed draw", () => {
  const MSG = '<img src=x onerror="window.__xss=1"><b>boom</b>';
  const failing = (): { fail: { on: boolean }; hooks: MountOptions["hooks"] } => {
    const fail = { on: false };
    return { fail, hooks: { afterRender: () => { if (fail.on) throw new Error(MSG); } } };
  };

  for (const [path, spec, rowsFor] of PATHS) {
    it(`${path}: prints its message as text, and clears the legend and y-axis labels of the last good draw`, () => {
      const host = document.createElement("div");
      document.body.append(host);
      const { fail, hooks } = failing();
      mountChart(host, { spec, rows: rowsFor(), width: 900, hooks });
      expect(host.querySelector(".tbl-legend"), "precondition: a legend").not.toBeNull();
      if (path === "standalone") {
        expect(host.querySelector(".figure-y-axis-overlay"), "precondition: y-axis labels").not.toBeNull();
      }
      fail.on = true;
      choose(host, "country");
      const err = host.querySelector<HTMLElement>(".figure-error");
      expect(err).not.toBeNull();
      expect(err!.textContent).toBe(MSG);
      expect(err!.children.length, "the message was parsed as HTML").toBe(0);
      expect(host.querySelector(".tbl-legend"), "the old legend outlived the failed draw").toBeNull();
      expect(host.querySelector(".figure-y-axis-overlay"), "the old y-axis labels outlived the failed draw").toBeNull();
    });

    it(`${path}: a non-Error throw prints its value, not "undefined"`, () => {
      const host = document.createElement("div");
      document.body.append(host);
      let on = false;
      mountChart(host, {
        spec, rows: rowsFor(), width: 900,
        hooks: { afterRender: () => { if (on) throw "plain string"; } },
      });
      on = true;
      choose(host, "country");
      expect(host.querySelector(".figure-error")!.textContent).toBe("plain string");
    });

    it(`${path}: a resize back to the failed width retries`, async () => {
      useFakeRO();
      const host = document.createElement("div");
      document.body.append(host);
      const { fail, hooks } = failing();
      mountChart(host, { spec, rows: rowsFor(), width: 900, hooks });
      fail.on = true;
      await resizeTo(host, 700);
      expect(host.querySelector(".figure-error"), "precondition: the 700px draw failed").not.toBeNull();
      fail.on = false;
      await resizeTo(host, 700);
      expect(host.querySelector(".figure-error"), "the same-width retry was skipped").toBeNull();
      expect(svgsOf(host).length).toBeGreaterThan(0);
      expect(host.querySelector(".tbl-legend"), "the retry did not rebuild the legend").not.toBeNull();
      // The successful retry commits its width: the next same-width callback is a no-op.
      const svgs = svgsOf(host);
      await resizeTo(host, 700);
      expect(svgsOf(host)).toEqual(svgs);
    });
  }

  for (const [path, spec, rowsFor] of PATHS) {
    it(`${path}: a resize back to the last good width after a failure redraws`, async () => {
      useFakeRO();
      const host = document.createElement("div");
      document.body.append(host);
      const { fail, hooks } = failing();
      const phases: string[] = [];
      mountChart(host, { spec, rows: rowsFor(), width: 900, hooks, onRender: (c) => phases.push(c.phase) });
      await resizeTo(host, 900);
      expect(host.querySelector(".figure-error"), "precondition: 900 draws").toBeNull();
      fail.on = true;
      await resizeTo(host, 700);
      expect(host.querySelector(".figure-error"), "precondition: the 700px draw failed").not.toBeNull();
      fail.on = false;
      await resizeTo(host, 900);
      expect(host.querySelector(".figure-error"), "stuck on the error after resizing back").toBeNull();
      expect(svgsOf(host).length).toBeGreaterThan(0);
      expect(host.querySelector(".tbl-legend")).not.toBeNull();
      // No redraw loop: a further observer callback at the same width draws nothing.
      const before = phases.length;
      await resizeTo(host, 900);
      expect(phases.slice(before)).toEqual([]);
    });
  }

  it("standalone: the right-legend column is cleared too, and comes back on the retry", async () => {
    useFakeRO();
    const host = document.createElement("div");
    document.body.append(host);
    const { fail, hooks } = failing();
    mountChart(host, { spec: { ...LINE_SPEC, legendPosition: "right" } as ChartSpec, rows: makeRows(), width: 900, hooks });
    expect(host.querySelector(".figure-legend-slot--right .tbl-legend"), "precondition: a right legend").not.toBeNull();
    fail.on = true;
    await resizeTo(host, 800);
    expect(host.querySelector(".tbl-legend")).toBeNull();
    fail.on = false;
    await resizeTo(host, 800);
    expect(host.querySelector(".figure-legend-slot--right .tbl-legend")).not.toBeNull();
    expect(host.querySelectorAll(".tbl-legend").length).toBe(1);
  });

  it("standalone: a recovered draw keeps the pins of the draw before the failure", async () => {
    useFakeRO();
    const host = document.createElement("div");
    document.body.append(host);
    const { fail, hooks } = failing();
    mountChart(host, { spec: LINE_SPEC, rows: makeRows(), width: 900, hooks });
    legendItem(host, "A")!.click();
    fail.on = true;
    await resizeTo(host, 700);
    fail.on = false;
    await resizeTo(host, 700);
    expect(legendItem(host, "A")!.getAttribute("aria-pressed")).toBe("true");
  });
});

// ---------------------------------------------------------------------------------------------
// 3. Single-x line crosshair
// ---------------------------------------------------------------------------------------------
describe("T2.8 item 3: a line chart with one x value", () => {
  it("draws its crosshair guide at a number, on the drawn point", () => {
    const host = document.createElement("div");
    document.body.append(host);
    mountChart(host, {
      spec: { chartType: "line", title: "t", xAxisType: "temporal", series_order: ["A", "B"], data: "inline" } as unknown as ChartSpec,
      rows: [
        { time: "2024-01-01", series: "A", value: "1" },
        { time: "2024-01-01", series: "B", value: "2" },
      ] as unknown as TidyRow[],
      width: 720,
      height: 400,
    });
    const svg = host.querySelector<SVGSVGElement>(".figure-canvas svg")!;
    mockRect1to1(svg);
    hoverPlotAt(svg, 0.5);
    const guide = svg.querySelector(".tbl-crosshair")!;
    expect(guide.getAttribute("opacity"), "precondition: the hover resolved").toBe("1");
    const x1 = Number(guide.getAttribute("x1"));
    expect(Number.isFinite(x1), `guide x1 = ${guide.getAttribute("x1")}`).toBe(true);
    // On the point Plot drew: a degenerate domain maps to the middle of the range (d3's rule).
    const d = svg.querySelector('g[aria-label="line"] path')!.getAttribute("d")!;
    const drawnX = Number(/^M\s*([-\d.]+)/.exec(d)![1]);
    expect(x1).toBeCloseTo(drawnX, 0);
  });

  it("numeric x: draws its crosshair guide at a number, on the drawn point", () => {
    const host = document.createElement("div");
    document.body.append(host);
    mountChart(host, {
      spec: { chartType: "line", title: "t", xAxisType: "numeric", series_order: ["A", "B"], data: "inline" } as unknown as ChartSpec,
      rows: [
        { time: "5", series: "A", value: "1" },
        { time: "5", series: "B", value: "2" },
      ] as unknown as TidyRow[],
      width: 720,
      height: 400,
    });
    const svg = host.querySelector<SVGSVGElement>(".figure-canvas svg")!;
    mockRect1to1(svg);
    hoverPlotAt(svg, 0.5);
    const guide = svg.querySelector(".tbl-crosshair")!;
    expect(guide.getAttribute("opacity"), "precondition: the hover resolved").toBe("1");
    const x1 = Number(guide.getAttribute("x1"));
    expect(Number.isFinite(x1), `guide x1 = ${guide.getAttribute("x1")}`).toBe(true);
    const d = svg.querySelector('g[aria-label="line"] path')!.getAttribute("d")!;
    expect(x1).toBeCloseTo(Number(/^M\s*([-\d.]+)/.exec(d)![1]), 0);
  });

  it("2-pane figure: the coordinated cursor's guide sits on each pane's drawn point", () => {
    const host = document.createElement("div");
    document.body.append(host);
    mountChart(host, {
      spec: {
        chartType: "line", title: "t", xAxisType: "temporal", series_order: ["A", "B"], data: "inline",
        columns: { x: "time", value: "value", series: "series", facet: "pane" },
        small_multiples: { columns: 2, mode: "shared" },
      } as unknown as ChartSpec,
      rows: ["P1", "P2"].flatMap((pane) => [
        { pane, time: "2024-01-01", series: "A", value: "1" },
        { pane, time: "2024-01-01", series: "B", value: "2" },
      ]) as unknown as TidyRow[],
      width: 838,
      height: 420,
    });
    const svgs = [...host.querySelectorAll<SVGSVGElement>(".figure-pane svg")];
    expect(svgs.length).toBe(2);
    svgs.forEach(mockRect1to1);
    hoverPlotAt(svgs[0]!, 0.5);
    for (const svg of svgs) {
      const guide = svg.querySelector(".tbl-coord-guide");
      expect(guide, "precondition: the pane echoed the hover").not.toBeNull();
      const d = svg.querySelector('g[aria-label="line"] path')!.getAttribute("d")!;
      expect(Number(guide!.getAttribute("x1"))).toBeCloseTo(Number(/^M\s*([-\d.]+)/.exec(d)![1]), 0);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 5. Zero width
// ---------------------------------------------------------------------------------------------
describe("T2.8 item 5: a card at width 0 is not redrawn", () => {
  for (const [path, spec, rowsFor] of PATHS) {
    it(`${path}: a resize to 0 leaves the chart alone; the next real width draws`, async () => {
      useFakeRO();
      const host = document.createElement("div");
      document.body.append(host);
      const phases: string[] = [];
      mountChart(host, { spec, rows: rowsFor(), width: 900, onRender: (c) => phases.push(c.phase) });
      await resizeTo(host, 700);
      const svgs = svgsOf(host);
      const before = phases.length;
      await resizeTo(host, 0); // the tab is hidden
      expect(phases.slice(before), "a zero-width card was redrawn").toEqual([]);
      expect(svgsOf(host)).toEqual(svgs);
      await resizeTo(host, 650); // shown again, at a new width
      expect(phases.slice(before)).toEqual(["resize", ...(path === "standalone" ? [] : ["resize"])]);
    });
  }

  it("standalone: a right legend stays on the right while the card is hidden", async () => {
    useFakeRO();
    const host = document.createElement("div");
    document.body.append(host);
    mountChart(host, { spec: { ...LINE_SPEC, legendPosition: "right" } as ChartSpec, rows: makeRows(), width: 900 });
    await resizeTo(host, 0);
    expect(host.querySelector(".figure-legend-slot--right .tbl-legend")).not.toBeNull();
    expect(host.querySelector(".figure-legend-slot .tbl-legend:not(.tbl-legend--vertical)")).toBeNull();
  });

  // CHANGELOG "a hidden container (width 0, such as a collapsed tab)": a chart MOUNTED hidden, not only
  // one hidden after it renders. jsdom's clientWidth is 0, so the mount draws at its fallback width;
  // the observer's report of 0 must redraw nothing, and the first non-zero width must draw.
  for (const [path, spec, rowsFor] of PATHS) {
    it(`${path}: mounted at width 0, nothing redraws until the first non-zero width`, async () => {
      useFakeRO();
      const host = document.createElement("div");
      document.body.append(host);
      const phases: string[] = [];
      mountChart(host, { spec, rows: rowsFor(), onRender: (c) => phases.push(c.phase) });
      expect(host.querySelector<HTMLElement>(".figure-card")!.clientWidth, "precondition: hidden").toBe(0);
      await Promise.resolve(); // the deferred "mount" onRender
      const svgs = svgsOf(host);
      const widths = svgs.map((s) => s.getAttribute("width"));
      const before = phases.length;
      await resizeTo(host, 0); // the observer's first report, still hidden
      expect(phases.slice(before), "a zero-width card was redrawn").toEqual([]);
      expect(svgsOf(host)).toEqual(svgs);
      await resizeTo(host, 500); // shown
      expect(phases.slice(before)).toEqual(["resize", ...(path === "standalone" ? [] : ["resize"])]);
      expect(svgsOf(host).map((s) => s.getAttribute("width"))).not.toEqual(widths);
      for (const s of svgsOf(host)) expect(Number(s.getAttribute("width"))).toBeLessThanOrEqual(500);
    });
  }

  it("standalone: mounted hidden, a right legend stays on the right until shown", async () => {
    useFakeRO();
    const host = document.createElement("div");
    document.body.append(host);
    mountChart(host, { spec: { ...LINE_SPEC, legendPosition: "right" } as ChartSpec, rows: makeRows() });
    await resizeTo(host, 0);
    expect(host.querySelector(".figure-legend-slot--right .tbl-legend")).not.toBeNull();
    expect(host.querySelector(".figure-legend-slot .tbl-legend:not(.tbl-legend--vertical)")).toBeNull();
    await resizeTo(host, 900);
    expect(host.querySelector(".figure-legend-slot--right .tbl-legend")).not.toBeNull();
  });

  // Review probe P3: with no layout (clientWidth 0), the restack passed the CHART width where the
  // OUTER width belongs, and the legend column was subtracted twice.
  it("area with a right legend: a pin restacks at the same width", () => {
    const host = document.createElement("div");
    document.body.append(host);
    mountChart(host, { spec: { ...AREA_SPEC, legendPosition: "right" } as ChartSpec, rows: makeRows(), width: 900 });
    const w0 = host.querySelector(".figure-canvas svg")!.getAttribute("width");
    legendItem(host, "C")!.click();
    expect(host.querySelector(".figure-canvas svg")!.getAttribute("width")).toBe(w0);
  });
});

// ---------------------------------------------------------------------------------------------
// The deferred "mount" onRender reads `opts.onRender` when its microtask runs, not when it was
// scheduled: a host that swaps or clears the callback right after mountChart() returns is obeyed.
// (T4.2 fix round 1: the lifecycle controller had captured the callback at schedule time.)
// ---------------------------------------------------------------------------------------------
describe("the deferred mount onRender reads opts.onRender when it fires", () => {
  for (const [path, spec, rows] of PATHS) {
    it(`${path}: a callback replaced right after mount is the one called`, async () => {
      const host = document.createElement("div");
      document.body.append(host);
      const a: string[] = [];
      const b: string[] = [];
      const opts: MountOptions = { spec, rows: rows(), onRender: (ctx) => a.push(ctx.phase) };
      mountChart(host, opts);
      opts.onRender = (ctx) => b.push(ctx.phase);
      await Promise.resolve();
      await Promise.resolve();
      expect(a).toEqual([]);
      expect(b).toEqual(path === "standalone" ? ["mount"] : ["mount", "mount"]);
    });

    it(`${path}: a callback cleared right after mount is not called`, async () => {
      const host = document.createElement("div");
      document.body.append(host);
      const a: string[] = [];
      const opts: MountOptions = { spec, rows: rows(), onRender: (ctx) => a.push(ctx.phase) };
      mountChart(host, opts);
      delete opts.onRender;
      await Promise.resolve();
      await Promise.resolve();
      expect(a).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------------------------
// The restack error path reads `opts.onLegendSelect` when it notifies, not when the mount was
// built: a host that swaps or clears the callback after mountChart() returns is obeyed even when
// the restack draw's onRender throws. (T4.4 fix round 1: the restack controller had captured it.)
// ---------------------------------------------------------------------------------------------
describe("the restack error path reads opts.onLegendSelect when it fires", () => {
  const pinWithThrowingRestack = (opts: MountOptions, host: HTMLElement): unknown[] => {
    const caught: unknown[] = [];
    const onUncaught = (err: unknown): void => { caught.push(err); };
    process.once("uncaughtException", onUncaught);
    try {
      legendItem(host, "C")!.click();
    } finally {
      process.removeListener("uncaughtException", onUncaught);
    }
    return caught;
  };
  const throwOnRestack: MountOptions["onRender"] = (c) => {
    if (c.phase === "restack") throw new Error("consumer bug in onRender");
  };

  it("a callback replaced after mount is the one called", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const a: string[][] = [];
    const b: string[][] = [];
    const opts: MountOptions = {
      spec: AREA_SPEC, rows: makeRows(), width: 900,
      onLegendSelect: (c) => a.push(c.active),
      onRender: throwOnRestack,
    };
    mountChart(host, opts);
    opts.onLegendSelect = (c) => b.push(c.active);
    const caught = pinWithThrowingRestack(opts, host);
    expect(caught.map((e) => (e as Error).message)).toEqual(["consumer bug in onRender"]);
    expect(a, "the replaced callback was called").toEqual([]);
    expect(b).toContainEqual(["C"]);
  });

  it("a callback cleared after mount is not called", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const a: string[][] = [];
    const opts: MountOptions = {
      spec: AREA_SPEC, rows: makeRows(), width: 900,
      onLegendSelect: (c) => a.push(c.active),
      onRender: throwOnRestack,
    };
    mountChart(host, opts);
    delete opts.onLegendSelect;
    const caught = pinWithThrowingRestack(opts, host);
    expect(caught.map((e) => (e as Error).message)).toEqual(["consumer bug in onRender"]);
    expect(a, "the cleared callback was called").toEqual([]);
  });
});
