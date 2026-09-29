// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { mountChart, computeChartHeight } from "../src/engine/render-live";
import { CROSSHAIR_HIT_SELECTOR } from "../src/engine/crosshair";
import { LEGEND_COLUMN_WIDTH, LEGEND_GAP } from "../src/engine/legend-layout";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const SPEC = { chartType: "timeline", title: "T", xAxisType: "temporal", data: "d.csv", columns: { x: "date", label: "title" } } as ChartSpec;
const ROWS = [
  { date: "2026", title: "Policy begins" }, { date: "2030", title: "First cohort born" },
  { date: "2055", title: "Projection ends" }, { date: "2095", title: "Cohort turns 65" },
] as TidyRow[];

// Two categories, so the legend has series rows to pin.
const CAT_SPEC = { ...SPEC, columns: { x: "date", label: "title", series: "kind" }, series_order: ["policy", "cohort"] } as ChartSpec;
const CAT_ROWS = [
  { date: "2026", title: "Policy begins", kind: "policy" }, { date: "2030", title: "First cohort born", kind: "policy" },
  { date: "2055", title: "Projection ends", kind: "cohort" }, { date: "2095", title: "Cohort turns 65", kind: "cohort" },
] as TidyRow[];

function mountAt(width: number, spec: ChartSpec = SPEC, rows: TidyRow[] = ROWS): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  mountChart(host, { spec, rows, width });
  return host;
}
const svgOf = (host: HTMLElement) => host.querySelector("svg.tbl-timeline") as SVGSVGElement;
/** The orientation actually drawn: the timeline's rule runs along x (horizontal) or y (vertical). */
const orientationOf = (svg: SVGSVGElement): "horizontal" | "vertical" => {
  const rule = svg.querySelector(".tbl-timeline-rule")!;
  return rule.getAttribute("x1") === rule.getAttribute("x2") ? "vertical" : "horizontal";
};

/** Minimal ResizeObserver stub — jsdom has none. Same pattern as test/events.test.ts. */
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
/** Drive the mount's own width-driven redraw: set the card width, fire the observer, await its rAF. */
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

describe("timeline live mount", () => {
  it("renders horizontal at a desktop width", () => {
    const svg = svgOf(mountAt(900));
    expect(Number(svg.getAttribute("width"))).toBeGreaterThan(600);
    expect(Number(svg.getAttribute("height"))).toBeLessThan(400); // horizontal: rows, not the 400 floor
    expect(orientationOf(svg)).toBe("horizontal");
  });

  it("renders vertical at a phone width, at the real width (no 390 floor)", () => {
    const svg = svgOf(mountAt(340));
    expect(Number(svg.getAttribute("width"))).toBe(340);
    expect(Number(svg.getAttribute("height"))).toBeGreaterThanOrEqual(400);
    expect(orientationOf(svg)).toBe("vertical");
  });

  it("stays horizontal with auto_vertical: false", () => {
    const svg = svgOf(mountAt(340, { ...SPEC, timeline: { auto_vertical: false } } as ChartSpec));
    expect(Number(svg.getAttribute("width"))).toBe(340);
    expect(Number(svg.getAttribute("height"))).toBeLessThan(400);
    expect(orientationOf(svg)).toBe("horizontal");
  });

  it("re-resolves the orientation on every width-driven redraw", async () => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
    const host = mountAt(900);
    expect(orientationOf(svgOf(host))).toBe("horizontal");
    await resizeTo(host, 340);
    expect(orientationOf(svgOf(host))).toBe("vertical");
    expect(Number(svgOf(host).getAttribute("width"))).toBe(340);
    await resizeTo(host, 900);
    expect(orientationOf(svgOf(host))).toBe("horizontal");
  });

  it("renders the lanes fixture horizontal at 900px", () => {
    // 2026 and 2030 each cover the other's stem in the policy lane; stem clearance is only a
    // preference, so this still fits and must not auto-switch to vertical.
    const host = mountAt(900, { ...CAT_SPEC, timeline: { lanes: true } } as ChartSpec, CAT_ROWS);
    expect(orientationOf(svgOf(host))).toBe("horizontal");
  });

  it("clears the legend when a resize brings the lanes back", async () => {
    // Switched vertical: lanes collapse, so the legend names the colours; back at desktop width the
    // lane gutter names them and the legend's series rows must go, not linger from the last draw.
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
    const host = mountAt(340, { ...CAT_SPEC, timeline: { lanes: true } } as ChartSpec, CAT_ROWS);
    const slot = host.querySelector(".figure-legend-slot")!;
    expect(slot.querySelectorAll(".tbl-legend-item[data-series]")).toHaveLength(2);
    await resizeTo(host, 900);
    expect(svgOf(host).querySelectorAll(".tbl-timeline-lane-label")).toHaveLength(2);
    expect(slot.querySelectorAll(".tbl-legend-item")).toHaveLength(0);
    await resizeTo(host, 340);
    expect(slot.querySelectorAll(".tbl-legend-item[data-series]")).toHaveLength(2);
  });

  it("resolves the orientation on the chart width beside a right legend, not the card width", () => {
    const card = 620; // wide enough for the right column; the chart beside it is under 480
    const host = mountAt(card, { ...CAT_SPEC, legendPosition: "right" } as ChartSpec, CAT_ROWS);
    const svg = svgOf(host);
    expect(host.querySelector(".figure-legend-slot--right .tbl-legend-item[data-series]")).not.toBeNull();
    expect(Number(svg.getAttribute("width"))).toBe(card - LEGEND_COLUMN_WIDTH - LEGEND_GAP);
    expect(orientationOf(svg)).toBe("vertical");
  });

  it("builds the right-legend column when a resize first gives a lanes timeline a legend", async () => {
    // Horizontal with lanes at 900: no legend items, so no right column is built. At 600 the chart
    // column is under 480, the timeline goes vertical, and the legend must appear beside it.
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => { errors.push(e.error ?? e.message); e.preventDefault(); };
    window.addEventListener("error", onError);
    try {
      const spec = { ...CAT_SPEC, legendPosition: "right", timeline: { lanes: true } } as ChartSpec;
      const host = mountAt(900, spec, CAT_ROWS);
      expect(host.querySelectorAll(".tbl-legend-item")).toHaveLength(0);
      await resizeTo(host, 600);
      expect(errors).toEqual([]);
      expect(orientationOf(svgOf(host))).toBe("vertical");
      expect(host.querySelectorAll(".figure-legend-slot--right .tbl-legend-item[data-series]")).toHaveLength(2);
    } finally {
      window.removeEventListener("error", onError);
    }
  });

  it("dismantles the right-legend column when a resize moves the legend to the top or drops it", async () => {
    // 900 no legend -> 600 right column -> 340 top (card too narrow for the column) -> 600 right
    // again -> 900 no legend. Each move must leave exactly the layout it names, never a leftover.
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => { errors.push(e.error ?? e.message); e.preventDefault(); };
    window.addEventListener("error", onError);
    try {
      const spec = { ...CAT_SPEC, legendPosition: "right", timeline: { lanes: true } } as ChartSpec;
      const host = mountAt(900, spec, CAT_ROWS);
      const card = host.querySelector(".figure-card")!;
      const scroll = host.querySelector(".figure-canvas-scroll")!;
      const [prev, next] = [scroll.previousElementSibling, scroll.nextElementSibling];
      const rightItems = () => host.querySelectorAll(".figure-legend-slot--right .tbl-legend-item[data-series]");
      const topItems = () => host.querySelectorAll(".figure-legend-slot .tbl-legend-item[data-series]");
      const inPlace = () => {
        expect(scroll.parentElement).toBe(card);
        expect(scroll.previousElementSibling).toBe(prev);
        expect(scroll.nextElementSibling).toBe(next);
      };

      await resizeTo(host, 600);
      expect(rightItems()).toHaveLength(2);
      await resizeTo(host, 340);
      expect(errors).toEqual([]);
      expect(host.querySelectorAll(".figure-body--legend-right")).toHaveLength(0);
      expect(topItems()).toHaveLength(2);
      inPlace();
      await resizeTo(host, 600);
      expect(errors).toEqual([]);
      expect(host.querySelectorAll(".figure-body--legend-right")).toHaveLength(1);
      expect(rightItems()).toHaveLength(2);
      expect(topItems()).toHaveLength(0);
      await resizeTo(host, 900);
      expect(errors).toEqual([]);
      expect(orientationOf(svgOf(host))).toBe("horizontal");
      expect(host.querySelectorAll(".figure-body--legend-right")).toHaveLength(0);
      expect(host.querySelectorAll(".tbl-legend-item")).toHaveLength(0);
      inPlace();
    } finally {
      window.removeEventListener("error", onError);
    }
  });

  it("attaches no hover tooltip machinery", () => {
    const host = mountAt(900, CAT_SPEC, CAT_ROWS);
    // Every crosshair/band/histogram/categorical hit rect, the guide line, and the shared tooltip
    // (appended to the tooltip container — document.body by default — not to the card).
    expect(host.querySelector(`${CROSSHAIR_HIT_SELECTOR}, .tbl-crosshair, .tbl-facet-crosshair`)).toBeNull();
    expect(document.querySelector(".tbl-tooltip")).toBeNull();
  });

  it("dims the other category's events when a legend row is pinned", () => {
    const host = mountAt(900, CAT_SPEC, CAT_ROWS);
    const svg = svgOf(host);
    const events = (s: string) => [...svg.querySelectorAll(`[data-series="${s}"]`)];
    expect(events("cohort").length).toBeGreaterThan(0);
    host.querySelector<HTMLButtonElement>('.tbl-legend-item[data-series="policy"]')!.click();
    expect(events("policy").length).toBeGreaterThan(0);
    events("cohort").forEach((el) => expect(el.classList.contains("tbl-dimmed")).toBe(true));
    events("policy").forEach((el) => expect(el.classList.contains("tbl-dimmed")).toBe(false));
  });

  it("computeChartHeight returns the timeline's content height", () => {
    expect(computeChartHeight(SPEC, ROWS)).toBeLessThan(400);
    expect(computeChartHeight({ ...SPEC, orientation: "vertical" } as ChartSpec, ROWS)).toBeGreaterThanOrEqual(400);
  });
});
