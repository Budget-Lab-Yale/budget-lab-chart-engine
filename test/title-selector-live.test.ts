// @vitest-environment jsdom
//
// Live-DOM wiring for the inline title selector: buildFigureHeader renders an engine-owned
// <select> per {token} in the title (see src/spec/title.ts for the pure parse/resolve helpers).
// Covers: initial render, onSelect + the bubbling tbl-title-select CustomEvent, persistence
// across the engine's own resize re-render, and byte-identical output for specs with no
// title_selectors.
import { describe, it, expect, afterEach, vi } from "vitest";
import { mountChart } from "../src/engine/render-live";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const ROWS: TidyRow[] = [
  { time: "2024-01-01", series: "A", value: "1.0" },
  { time: "2024-02-01", series: "A", value: "2.0" },
];

const SPEC_WITH_SELECTOR: ChartSpec = {
  chartType: "line",
  title: "Long-Run Change in Real GDP by {dimension}",
  xAxisType: "temporal",
  data: "inline",
  title_selectors: {
    dimension: {
      options: [
        { id: "sector", label: "Sector" },
        { id: "country", label: "Country" },
      ],
      default: "sector",
    },
  },
};

const SPEC_NO_SELECTOR: ChartSpec = {
  chartType: "line",
  title: "Plain Title",
  xAxisType: "temporal",
  data: "inline",
};

/** Minimal ResizeObserver stub — jsdom has none. Captures the callback so a test can invoke it
 *  directly to simulate the engine's own resize re-render (mountChart's `ro.observe(card)`). */
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

/** The title as a reader sees it: text nodes verbatim; a <select> contributes its ACTIVE
 *  option's label (h3.textContent would concatenate every option's text instead). */
function visibleTitle(h3: HTMLElement): string {
  return Array.from(h3.childNodes)
    .map((n) => {
      if (n instanceof HTMLSelectElement) return n.selectedOptions[0]?.textContent ?? "";
      return n.textContent ?? "";
    })
    .join("");
}

describe("inline title selector — live DOM", () => {
  afterEach(() => {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    FakeResizeObserver.instances = [];
  });

  it("renders the select inline in the <h3> with the right options and the default active", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: SPEC_WITH_SELECTOR, rows: ROWS });
    const h3 = container.querySelector("h3.figure-title") as HTMLElement;
    expect(h3).not.toBeNull();
    const select = h3.querySelector("select.figure-title-select") as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(Array.from(select.options).map((o) => [o.value, o.textContent])).toEqual([
      ["sector", "Sector"],
      ["country", "Country"],
    ]);
    expect(select.value).toBe("sector");
    // Surrounding literal text is preserved; the select shows the active label.
    expect(visibleTitle(h3)).toBe("Long-Run Change in Real GDP by Sector");
  });

  it("has an aria-label naming the selector key", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: SPEC_WITH_SELECTOR, rows: ROWS });
    const select = container.querySelector("select.figure-title-select") as HTMLSelectElement;
    expect(select.getAttribute("aria-label")).toMatch(/dimension/i);
  });

  it("MountOptions.selections sets the initial active value (host re-mount state restore)", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: SPEC_WITH_SELECTOR, rows: ROWS, selections: { dimension: "country" } });
    const select = container.querySelector("select.figure-title-select") as HTMLSelectElement;
    expect(select.value).toBe("country");
    expect(visibleTitle(container.querySelector("h3") as HTMLElement)).toBe(
      "Long-Run Change in Real GDP by Country",
    );
  });

  it("changing the select fires onSelect with {id, value} and dispatches a bubbling tbl-title-select CustomEvent", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const onSelect = vi.fn();
    mountChart(container, { spec: SPEC_WITH_SELECTOR, rows: ROWS, onSelect });

    const busEvents: CustomEvent[] = [];
    document.body.addEventListener("tbl-title-select", (e) => busEvents.push(e as CustomEvent));

    const select = container.querySelector("select.figure-title-select") as HTMLSelectElement;
    select.value = "country";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onSelect).toHaveBeenCalledWith({ id: "dimension", value: "country" });
    expect(busEvents).toHaveLength(1);
    expect(busEvents[0]!.detail).toEqual({ id: "dimension", value: "country" });
    expect(busEvents[0]!.bubbles).toBe(true);

    container.remove();
  });

  it("selection survives the engine's own resize re-render", async () => {
    // jsdom has no ResizeObserver — install the stub before mounting.
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
    const container = document.createElement("div");
    mountChart(container, { spec: SPEC_WITH_SELECTOR, rows: ROWS });

    const select = container.querySelector("select.figure-title-select") as HTMLSelectElement;
    select.value = "country";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(select.value).toBe("country");

    // Simulate a resize: invoke the captured ResizeObserver callback. mountChart's RO handler
    // only SCHEDULES draw() via requestAnimationFrame, so await rAF ticks before asserting —
    // otherwise the redraw never runs and the assertions pass vacuously. (Scope the chart-svg
    // selector to .figure-canvas — a bare "svg" would match the header's logo SVG instead.)
    const svgBefore = container.querySelector(".figure-canvas svg");
    expect(svgBefore).not.toBeNull();
    expect(FakeResizeObserver.instances.length).toBeGreaterThan(0);
    for (const inst of FakeResizeObserver.instances) inst.cb([], inst as unknown as ResizeObserver);
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));

    // The redraw genuinely executed: draw() rebuilt the chart SVG (card.clientWidth is 0 in
    // jsdom, so the render width changed 720 → the 390 floor and replaceChildren swapped it)...
    expect(container.querySelector(".figure-canvas svg")).not.toBe(svgBefore);

    // ...but the header was NOT rebuilt (buildFigureHeader runs once per mount): same <select>
    // element, still holding the changed value.
    const selectAfter = container.querySelector("select.figure-title-select") as HTMLSelectElement;
    expect(selectAfter).not.toBeNull();
    expect(selectAfter).toBe(select);
    expect(selectAfter.value).toBe("country");
  });

  it("a spec without title_selectors renders a plain textContent <h3> — no wrapper spans, byte-identical to before this feature", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: SPEC_NO_SELECTOR, rows: ROWS });
    const h3 = container.querySelector("h3.figure-title") as HTMLElement;
    expect(h3.innerHTML).toBe("Plain Title");
    expect(h3.querySelector("select")).toBeNull();
  });

  it("an unmatched {token} with no matching selector key stays literal text", () => {
    const spec: ChartSpec = { ...SPEC_NO_SELECTOR, title: "GDP by {region}" };
    const container = document.createElement("div");
    mountChart(container, { spec, rows: ROWS });
    expect(container.querySelector("h3")?.textContent).toBe("GDP by {region}");
    expect(container.querySelector("select")).toBeNull();
  });
});
