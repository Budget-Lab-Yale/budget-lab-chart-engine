// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { mountChart, computeChartHeight } from "../src/engine/render-live";
import { CROSSHAIR_HIT_SELECTOR } from "../src/engine/crosshair";
import { LEGEND_COLUMN_WIDTH, LEGEND_GAP } from "../src/engine/legend-layout";
import { timelineTextWidth } from "../src/engine/timeline-text";
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

  it("floors the live width at 280px: a narrower card renders a 280px chart", () => {
    const svg = svgOf(mountAt(250));
    expect(Number(svg.getAttribute("width"))).toBe(280);
    expect(orientationOf(svg)).toBe("vertical");
  });

  /** Horizontal extent of the drawn ink: label and tick text (by the layout's width estimate),
   *  markers and bars. */
  const inkOf = (svg: SVGSVGElement): [number, number] => {
    const num = (el: Element, a: string) => Number(el.getAttribute(a));
    const spans: Array<[number, number]> = [];
    for (const t of svg.querySelectorAll(".tbl-timeline-label text, .tbl-timeline-tick")) {
      const w = timelineTextWidth(t.textContent ?? "", num(t, "font-size"), t.getAttribute("font-weight") === "700" ? 700 : 500);
      const x = num(t, "x");
      spans.push(t.getAttribute("text-anchor") === "end" ? [x - w, x] : [x, x + w]);
    }
    for (const c of svg.querySelectorAll(".tbl-timeline-marker")) spans.push([num(c, "cx") - num(c, "r"), num(c, "cx") + num(c, "r")]);
    for (const r of svg.querySelectorAll(".tbl-timeline-span")) spans.push([num(r, "x"), num(r, "x") + num(r, "width")]);
    return [Math.min(...spans.map((s) => s[0])), Math.max(...spans.map((s) => s[1]))];
  };

  it("centres an authored-vertical timeline's ink on a wide card, its text column capped at 360px (E2, Ruling 39)", () => {
    const long = "A title long enough to need two lines in a readable column but one line across a wide card";
    const rows = [
      { date: "2026", title: "Policy begins" }, { date: "2050", title: long },
      { date: "2075", title: "Projection ends" }, { date: "2100", title: "Cohort turns 65" },
    ] as TidyRow[];
    const svg = svgOf(mountAt(1000, { ...SPEC, orientation: "vertical" } as ChartSpec, rows));
    expect(Number(svg.getAttribute("width"))).toBe(1000);
    expect(orientationOf(svg)).toBe("vertical");
    const [lo, hi] = inkOf(svg);
    expect(Math.abs((lo + hi) / 2 - 500)).toBeLessThanOrEqual(2);
    expect(hi - lo).toBeLessThanOrEqual(360 + 23);
    const titleLines = [...svg.querySelectorAll(".tbl-timeline-label")][1]!.querySelectorAll('text[font-size="12"]');
    expect(titleLines).toHaveLength(2);
  });

  it("centres the ink on wide cards whether or not a column reaches the cap: FIG7, lanes, a long left label (Ruling 43)", () => {
    const fig7 = [
      { date: "2026", title: "Policy begins" }, { date: "2030", title: "First cohort born under fully phased-in policy" },
      { date: "2055", title: "Annual projection ends" }, { date: "2057", title: "That cohort turns 27" }, { date: "2095", title: "That cohort turns 65" },
    ] as TidyRow[];
    const lanes = [
      { date: "2025", title: "Signed", kind: "a" }, { date: "2026", title: "Rules", kind: "b" },
      { date: "2027", title: "Fix", kind: "a" }, { date: "2028", title: "Effective", kind: "b" },
    ] as TidyRow[];
    const long = Array.from({ length: 30 }, () => "word").join(" ");
    const outer = [
      { date: "2020", end: "2030", title: "a" }, { date: "2025", end: "2035", title: `outer: ${long}` },
      { date: "2027", end: "", title: "pt" }, { date: "2040", end: "", title: "b" },
    ] as TidyRow[];
    const V = { ...SPEC, orientation: "vertical" } as ChartSpec;
    const cases: Array<[string, ChartSpec, TidyRow[]]> = [
      ["FIG7", V, fig7], ["FIG7 axis", { ...V, timeline: { axis: true } } as ChartSpec, fig7],
      ["lanes axis", { ...V, columns: { x: "date", label: "title", series: "kind" }, timeline: { lanes: true, axis: true } } as ChartSpec, lanes],
      ["outer axis", { ...V, columns: { x: "date", end: "end", label: "title" }, timeline: { axis: true } } as ChartSpec, outer],
    ];
    for (const [name, spec, rows] of cases) {
      for (const width of [728, 800, 900, 1100]) {
        document.body.replaceChildren();
        const svg = svgOf(mountAt(width, spec, rows));
        const [lo, hi] = inkOf(svg);
        expect(Math.abs((lo + hi) / 2 - Number(svg.getAttribute("width")) / 2), `${name} @${width}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it("centres the ink on a 728px card with a left column and a tick column (Ruling 39)", () => {
    const spec = { ...SPEC, orientation: "vertical", columns: { x: "date", end: "end", label: "title" }, timeline: { axis: true } } as ChartSpec;
    const rows = [
      { date: "2017-12-22", end: "2025-12-31", title: "TCJA individual provisions" },
      { date: "2021-03-11", end: "2021-12-31", title: "Expanded child tax credit" },
      { date: "2022-08-16", end: "ongoing", title: "IRA clean-energy credits" },
      { date: "2025-07-04", end: "", title: "OBBBA enacted" },
      { date: "2034-01-01", end: "", title: "Trust fund depletion" },
    ] as TidyRow[];
    const svg = svgOf(mountAt(728, spec, rows));
    expect(svg.querySelectorAll(".tbl-timeline-label text[text-anchor=\"end\"]").length).toBeGreaterThan(0);
    expect(svg.querySelectorAll(".tbl-timeline-tick").length).toBeGreaterThan(0);
    const [lo, hi] = inkOf(svg);
    expect(Math.abs((lo + hi) / 2 - Number(svg.getAttribute("width")) / 2)).toBeLessThanOrEqual(2);
  });

  it("stays horizontal with auto_vertical: false", () => {
    const svg = svgOf(mountAt(340, { ...SPEC, timeline: { auto_vertical: false } } as ChartSpec));
    expect(Number(svg.getAttribute("width"))).toBe(340);
    expect(Number(svg.getAttribute("height"))).toBeLessThan(400);
    expect(orientationOf(svg)).toBe("horizontal");
    // The 280px floor holds either way: narrower still, it stays horizontal at 280.
    document.body.replaceChildren();
    const floored = svgOf(mountAt(250, { ...SPEC, timeline: { auto_vertical: false } } as ChartSpec));
    expect(Number(floored.getAttribute("width"))).toBe(280);
    expect(orientationOf(floored)).toBe("horizontal");
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

  it("shows the x-axis title only while the ticks are drawn, across resizes", async () => {
    // Ticks fit at 900, but on a 280px vertical render six overlapping spans with a date word this
    // wide ("Mid-to-late-September") leave the tick column no room beside the floors (A8, Ruling 28).
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
    const spec = {
      ...SPEC, columns: { x: "date", end: "end", label: "title", date_label: "dl" }, timeline: { axis: true }, x_axis_title: "Month",
    } as ChartSpec;
    const rows = Array.from({ length: 6 }, (_, i) => ({ date: `2026-0${i + 1}-01`, end: "2030", title: `Event ${i} title`, dl: "Mid-to-late-September 30, 2026" })) as TidyRow[];
    const host = mountAt(900, spec, rows);
    const titles = () => [...host.querySelectorAll(".figure-x-axis-title")].map((t) => t.textContent);
    const ticks = () => svgOf(host).querySelectorAll(".tbl-timeline-tick").length;
    expect(ticks()).toBeGreaterThan(0);
    expect(titles()).toEqual(["Month"]);
    await resizeTo(host, 280);
    expect(orientationOf(svgOf(host))).toBe("vertical");
    expect(ticks()).toBe(0);
    expect(titles()).toEqual([]);
    await resizeTo(host, 900);
    expect(ticks()).toBeGreaterThan(0);
    expect(titles()).toEqual(["Month"]);
  });

  it("renders the lanes fixture horizontal at 900px", () => {
    // 2026 and 2030 each cover the other's stem in the policy lane; stem clearance is only a
    // preference, so this still fits and must not auto-switch to vertical.
    const host = mountAt(900, { ...CAT_SPEC, timeline: { lanes: true } } as ChartSpec, CAT_ROWS);
    expect(orientationOf(svgOf(host))).toBe("horizontal");
  });

  it("renders a two-lane chart switched to vertical as lane columns, the lane names replacing the legend", async () => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
    const host = mountAt(340, { ...CAT_SPEC, timeline: { lanes: true } } as ChartSpec, CAT_ROWS);
    const svg = svgOf(host);
    expect(orientationOf(svg)).toBe("vertical");
    expect(svg.querySelectorAll(".tbl-timeline-rule")).toHaveLength(2);
    expect([...svg.querySelectorAll(".tbl-timeline-lane-label")].map((t) => t.textContent)).toEqual(["policy", "cohort"]);
    expect(host.querySelectorAll(".tbl-legend-item")).toHaveLength(0);
    await resizeTo(host, 900);
    expect(orientationOf(svgOf(host))).toBe("horizontal");
    expect(svgOf(host).querySelectorAll(".tbl-timeline-lane-label")).toHaveLength(2);
  });

  // The legend tests below opt the two lanes into one vertical track (vertical_lanes: single), so
  // the switch to vertical really brings the legend's series rows in and out.
  it("clears the legend when a resize brings the lanes back", async () => {
    // Switched vertical onto one track, the legend names the colours; back at desktop width the
    // lane gutter names them and the legend's series rows must go, not linger from the last draw.
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
    const host = mountAt(340, { ...CAT_SPEC, timeline: { lanes: true, vertical_lanes: "single" } } as ChartSpec, CAT_ROWS);
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
      const spec = { ...CAT_SPEC, legendPosition: "right", timeline: { lanes: true, vertical_lanes: "single" } } as ChartSpec;
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
      const spec = { ...CAT_SPEC, legendPosition: "right", timeline: { lanes: true, vertical_lanes: "single" } } as ChartSpec;
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

  it("legend: false shows no legend items in a mounted card", () => {
    const shown = mountAt(900, CAT_SPEC, CAT_ROWS);
    expect(shown.querySelectorAll(".tbl-legend-item").length).toBeGreaterThan(0); // the default, for contrast
    document.body.replaceChildren();
    const host = mountAt(900, { ...CAT_SPEC, legend: false } as ChartSpec, CAT_ROWS);
    expect(host.querySelectorAll(".tbl-legend-item")).toHaveLength(0);
  });

  it("computeChartHeight returns the timeline's content height", () => {
    expect(computeChartHeight(SPEC, ROWS)).toBeLessThan(400);
    expect(computeChartHeight({ ...SPEC, orientation: "vertical" } as ChartSpec, ROWS)).toBeGreaterThanOrEqual(400);
  });
});
