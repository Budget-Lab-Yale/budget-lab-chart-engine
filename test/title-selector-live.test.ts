// @vitest-environment jsdom
//
// Live-DOM wiring for the inline title selector: buildFigureHeader renders an engine-owned
// button+popover widget per {token} in the title (ported from the AI Labor Market Tracker's
// inline title picker — see src/engine/render-live.ts buildInlineSelect). See src/spec/title.ts
// for the pure parse/resolve helpers.
// Covers: initial render, open/close (click + click-away + Escape), keyboard (Enter/Space,
// arrows with wraparound, type-ahead), onSelect + the bubbling tbl-title-select CustomEvent,
// persistence across the engine's own resize re-render, color matching (explicit option color,
// series_colors fallback, single-series accent adopted by the rendered line, multi-series label-
// only tint), and byte-identical output for specs with no title_selectors.
import { describe, it, expect, afterEach, vi } from "vitest";
import { mountChart } from "../src/engine/render-live";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const ROWS: TidyRow[] = [
  { time: "2024-01-01", series: "A", value: "1.0" },
  { time: "2024-02-01", series: "A", value: "2.0" },
];

const MULTI_SERIES_ROWS: TidyRow[] = [
  { time: "2024-01-01", series: "Sector", value: "1.0" },
  { time: "2024-02-01", series: "Sector", value: "2.0" },
  { time: "2024-01-01", series: "Country", value: "3.0" },
  { time: "2024-02-01", series: "Country", value: "4.0" },
];

// Faceted no-series bars across two panes (no `series` column).
const FACET_BAR_ROWS: TidyRow[] = [
  { facet: "P1", time: "A", value: "1" },
  { facet: "P1", time: "B", value: "2" },
  { facet: "P2", time: "A", value: "3" },
  { facet: "P2", time: "B", value: "4" },
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

/** The title as a reader sees it: text nodes verbatim; the inline-select widget contributes its
 *  ACTIVE option's label (h3.textContent would concatenate every popover option's text instead). */
function visibleTitle(h3: HTMLElement): string {
  return Array.from(h3.childNodes)
    .map((n) => {
      if (n instanceof HTMLElement && n.classList.contains("inline-select-wrap")) {
        return n.querySelector(".inline-select-label")?.textContent ?? "";
      }
      return n.textContent ?? "";
    })
    .join("");
}

describe("inline title selector — live DOM", () => {
  afterEach(() => {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    FakeResizeObserver.instances = [];
  });

  it("renders the button+popover widget inline in the <h3> with the right options and the default active", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: SPEC_WITH_SELECTOR, rows: ROWS });
    const h3 = container.querySelector("h3.figure-title") as HTMLElement;
    expect(h3).not.toBeNull();
    const btn = h3.querySelector("button.inline-select") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute("aria-haspopup")).toBe("listbox");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    const popover = h3.querySelector("ul.inline-select-popover") as HTMLUListElement;
    expect(popover.hidden).toBe(true);
    const lis = Array.from(popover.querySelectorAll("li"));
    expect(lis.map((li) => [li.dataset.id, li.textContent])).toEqual([
      ["sector", "Sector"],
      ["country", "Country"],
    ]);
    expect(lis[0]!.getAttribute("aria-selected")).toBe("true");
    expect(lis[0]!.classList.contains("is-active")).toBe(true);
    expect(lis[1]!.getAttribute("aria-selected")).toBe("false");
    // Surrounding literal text is preserved; the button label shows the active option.
    expect(visibleTitle(h3)).toBe("Long-Run Change in Real GDP by Sector");
  });

  it("MountOptions.selections sets the initial active value (host re-mount state restore)", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: SPEC_WITH_SELECTOR, rows: ROWS, selections: { dimension: "country" } });
    const h3 = container.querySelector("h3") as HTMLElement;
    expect(visibleTitle(h3)).toBe("Long-Run Change in Real GDP by Country");
    const active = h3.querySelector("li.is-active") as HTMLLIElement;
    expect(active.dataset.id).toBe("country");
  });

  it("click toggles the popover open and closed", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: SPEC_WITH_SELECTOR, rows: ROWS });
    const btn = container.querySelector("button.inline-select") as HTMLButtonElement;
    const popover = container.querySelector("ul.inline-select-popover") as HTMLUListElement;

    btn.click();
    expect(popover.hidden).toBe(false);
    expect(btn.getAttribute("aria-expanded")).toBe("true");

    btn.click();
    expect(popover.hidden).toBe(true);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("a click outside the widget closes the popover", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    mountChart(container, { spec: SPEC_WITH_SELECTOR, rows: ROWS });
    const btn = container.querySelector("button.inline-select") as HTMLButtonElement;
    const popover = container.querySelector("ul.inline-select-popover") as HTMLUListElement;

    btn.click();
    expect(popover.hidden).toBe(false);
    // The click-away listener attaches via a 0ms setTimeout (so the SAME click that opened the
    // popover doesn't immediately close it) — wait a tick before dispatching the outside click.
    await new Promise((r) => setTimeout(r, 0));

    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(popover.hidden).toBe(true);

    container.remove();
  });

  it("clicking an option selects it, updates the label, and closes the popover", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: SPEC_WITH_SELECTOR, rows: ROWS });
    const h3 = container.querySelector("h3") as HTMLElement;
    const btn = container.querySelector("button.inline-select") as HTMLButtonElement;
    const popover = container.querySelector("ul.inline-select-popover") as HTMLUListElement;

    btn.click();
    const countryLi = popover.querySelector('li[data-id="country"]') as HTMLLIElement;
    countryLi.click();

    expect(popover.hidden).toBe(true);
    expect(visibleTitle(h3)).toBe("Long-Run Change in Real GDP by Country");
    expect(countryLi.classList.contains("is-active")).toBe(true);
    expect(countryLi.getAttribute("aria-selected")).toBe("true");
    const sectorLi = popover.querySelector('li[data-id="sector"]') as HTMLLIElement;
    expect(sectorLi.classList.contains("is-active")).toBe(false);
  });

  it("Escape closes the popover and refocuses the button", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    mountChart(container, { spec: SPEC_WITH_SELECTOR, rows: ROWS });
    const btn = container.querySelector("button.inline-select") as HTMLButtonElement;
    const popover = container.querySelector("ul.inline-select-popover") as HTMLUListElement;
    const wrap = container.querySelector(".inline-select-wrap") as HTMLElement;

    btn.click();
    expect(popover.hidden).toBe(false);

    wrap.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(popover.hidden).toBe(true);
    expect(document.activeElement).toBe(btn);

    container.remove();
  });

  it("Enter on a focused option selects it", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: SPEC_WITH_SELECTOR, rows: ROWS });
    const btn = container.querySelector("button.inline-select") as HTMLButtonElement;
    const popover = container.querySelector("ul.inline-select-popover") as HTMLUListElement;
    const countryLi = popover.querySelector('li[data-id="country"]') as HTMLLIElement;

    countryLi.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(popover.hidden).toBe(true);
    expect(countryLi.classList.contains("is-active")).toBe(true);
    void btn;
  });

  it("ArrowDown/ArrowUp move focus between options with wraparound", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    mountChart(container, { spec: SPEC_WITH_SELECTOR, rows: ROWS });
    const popover = container.querySelector("ul.inline-select-popover") as HTMLUListElement;
    const wrap = container.querySelector(".inline-select-wrap") as HTMLElement;
    const sectorLi = popover.querySelector('li[data-id="sector"]') as HTMLLIElement;
    const countryLi = popover.querySelector('li[data-id="country"]') as HTMLLIElement;

    sectorLi.focus();
    expect(document.activeElement).toBe(sectorLi);

    wrap.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(countryLi);

    // Wraps back to the first option.
    wrap.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(sectorLi);

    // ArrowUp from the first option wraps to the last.
    wrap.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(countryLi);
  });

  it("type-ahead jumps focus to the option whose label starts with the typed letter", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    mountChart(container, { spec: SPEC_WITH_SELECTOR, rows: ROWS });
    const popover = container.querySelector("ul.inline-select-popover") as HTMLUListElement;
    const wrap = container.querySelector(".inline-select-wrap") as HTMLElement;
    const countryLi = popover.querySelector('li[data-id="country"]') as HTMLLIElement;

    wrap.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(countryLi);
  });

  it("changing the selection fires onSelect with {id, value} and dispatches a bubbling tbl-title-select CustomEvent", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const onSelect = vi.fn();
    mountChart(container, { spec: SPEC_WITH_SELECTOR, rows: ROWS, onSelect });

    const busEvents: CustomEvent[] = [];
    document.body.addEventListener("tbl-title-select", (e) => busEvents.push(e as CustomEvent));

    const btn = container.querySelector("button.inline-select") as HTMLButtonElement;
    btn.click();
    (container.querySelector('li[data-id="country"]') as HTMLLIElement).click();

    expect(onSelect).toHaveBeenCalledWith({ id: "dimension", value: "country" });
    expect(busEvents).toHaveLength(1);
    expect(busEvents[0]!.detail).toEqual({ id: "dimension", value: "country" });
    expect(busEvents[0]!.bubbles).toBe(true);

    container.remove();
  });

  it("selection survives the engine's own resize re-render — the widget is not rebuilt by draw()", async () => {
    // jsdom has no ResizeObserver — install the stub before mounting.
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
    const container = document.createElement("div");
    mountChart(container, { spec: SPEC_WITH_SELECTOR, rows: ROWS });

    const btn = container.querySelector("button.inline-select") as HTMLButtonElement;
    btn.click();
    (container.querySelector('li[data-id="country"]') as HTMLLIElement).click();
    expect(container.querySelector("li.is-active")?.getAttribute("data-id")).toBe("country");

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

    // ...but the header was NOT rebuilt (buildFigureHeader runs once per mount): same button
    // element, still holding the changed selection.
    const btnAfter = container.querySelector("button.inline-select") as HTMLButtonElement;
    expect(btnAfter).not.toBeNull();
    expect(btnAfter).toBe(btn);
    expect(container.querySelector("li.is-active")?.getAttribute("data-id")).toBe("country");
  });

  it("a spec without title_selectors renders a plain textContent <h3> — no wrapper spans, byte-identical to before this feature", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: SPEC_NO_SELECTOR, rows: ROWS });
    const h3 = container.querySelector("h3.figure-title") as HTMLElement;
    expect(h3.innerHTML).toBe("Plain Title");
    expect(h3.querySelector(".inline-select-wrap")).toBeNull();
  });

  it("an unmatched {token} with no matching selector key stays literal text", () => {
    const spec: ChartSpec = { ...SPEC_NO_SELECTOR, title: "GDP by {region}" };
    const container = document.createElement("div");
    mountChart(container, { spec, rows: ROWS });
    expect(container.querySelector("h3")?.textContent).toBe("GDP by {region}");
    expect(container.querySelector(".inline-select-wrap")).toBeNull();
  });

  it("open then close in the SAME synchronous tick (click, then Escape, no await) does not leak the deferred click-away listener", async () => {
    // openPopover schedules `document.addEventListener("click", clickAway)` via setTimeout(...,0).
    // If closePopover (via Escape here) runs before that timer fires, removeEventListener no-ops
    // and — without the fix — the deferred addEventListener still attaches a tick later, wiring a
    // permanent document click listener that never gets cleaned up. Spy on addEventListener to
    // prove clickAway never actually gets attached once the timer is allowed to run.
    const container = document.createElement("div");
    document.body.appendChild(container);
    mountChart(container, { spec: SPEC_WITH_SELECTOR, rows: ROWS });
    const btn = container.querySelector("button.inline-select") as HTMLButtonElement;
    const popover = container.querySelector("ul.inline-select-popover") as HTMLUListElement;
    const wrap = container.querySelector(".inline-select-wrap") as HTMLElement;

    const addSpy = vi.spyOn(document, "addEventListener");

    // Open and close synchronously — no await between them, so the click-away setTimeout has not
    // yet fired.
    btn.click();
    expect(popover.hidden).toBe(false);
    wrap.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(popover.hidden).toBe(true);

    // Let the deferred setTimeout(...,0) callback(s) run.
    await new Promise((r) => setTimeout(r, 0));

    // The fix cancels the pending timer in closePopover, so clickAway is never registered —
    // without the fix, the deferred setTimeout still fires and calls addEventListener("click", ...).
    const clickCallsAfterClose = addSpy.mock.calls.filter(([type]) => type === "click").length;
    expect(clickCallsAfterClose).toBe(0);
    addSpy.mockRestore();

    // Behavioral confirmation: a document click does not reopen the popover or throw — if a
    // stray clickAway were attached, this would be a no-op too (popover already closed), so the
    // real proof is the listener count above; this just confirms no crash/reopen either.
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(popover.hidden).toBe(true);

    container.remove();
  });

  it("unmounting with the popover open removes the click-away listener (no leak past unmount)", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const unmount = mountChart(container, { spec: SPEC_WITH_SELECTOR, rows: ROWS });
    const btn = container.querySelector("button.inline-select") as HTMLButtonElement;
    const popover = container.querySelector("ul.inline-select-popover") as HTMLUListElement;

    btn.click();
    expect(popover.hidden).toBe(false);
    // Let the deferred click-away registration actually attach before unmounting, so this test
    // exercises the "listener is live, then torn down" path rather than the same-tick race above.
    await new Promise((r) => setTimeout(r, 0));

    const removeSpy = vi.spyOn(document, "removeEventListener");
    unmount();

    expect(popover.hidden).toBe(true);
    expect(removeSpy.mock.calls.some(([type]) => type === "click")).toBe(true);
    removeSpy.mockRestore();

    // A document click after unmount must not throw and must have no effect — if clickAway were
    // still attached, popover.hidden would already be true so this wouldn't distinguish the bug,
    // so the load-bearing assertion is the removeEventListener spy above; this just confirms no
    // crash from a dangling handler referencing a torn-down widget.
    expect(() => document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }))).not.toThrow();

    container.remove();
  });
});

describe("inline title selector — color matching", () => {
  afterEach(() => {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    FakeResizeObserver.instances = [];
  });

  it("an option's explicit color tints the active label", () => {
    const spec: ChartSpec = {
      ...SPEC_WITH_SELECTOR,
      title_selectors: {
        dimension: {
          options: [
            { id: "sector", label: "Sector", color: "blue" },
            { id: "country", label: "Country", color: "amber" },
          ],
          default: "sector",
        },
      },
    };
    const container = document.createElement("div");
    mountChart(container, { spec, rows: ROWS });
    const label = container.querySelector(".inline-select-label") as HTMLElement;
    expect(label.style.color).not.toBe("");
    // "blue" resolves through engine/palette to the categorical blue hex.
    expect(label.style.color.toLowerCase()).toBe("rgb(0, 114, 178)"); // #0072B2
  });

  it("falls back to spec.series_colors[label] when the option has no explicit color", () => {
    const spec: ChartSpec = {
      ...SPEC_WITH_SELECTOR,
      series_colors: { Sector: "green", Country: "red" },
    };
    const container = document.createElement("div");
    mountChart(container, { spec, rows: ROWS });
    const label = container.querySelector(".inline-select-label") as HTMLElement;
    expect(label.style.color.toLowerCase()).toBe("rgb(42, 139, 58)"); // #2A8B3A (green)
  });

  it("no resolvable color leaves the label inheriting the surrounding title color", () => {
    const container = document.createElement("div");
    mountChart(container, { spec: SPEC_WITH_SELECTOR, rows: ROWS });
    const label = container.querySelector(".inline-select-label") as HTMLElement;
    expect(label.style.color).toBe("");
  });

  it("the popover carries no per-option tint — only the active row's navy/semibold class", () => {
    const spec: ChartSpec = {
      ...SPEC_WITH_SELECTOR,
      title_selectors: {
        dimension: {
          options: [
            { id: "sector", label: "Sector", color: "blue" },
            { id: "country", label: "Country", color: "amber" },
          ],
          default: "sector",
        },
      },
    };
    const container = document.createElement("div");
    mountChart(container, { spec, rows: ROWS });
    const lis = Array.from(container.querySelectorAll(".inline-select-popover li")) as HTMLElement[];
    for (const li of lis) expect(li.style.color).toBe("");
  });

  it("single-series chart: the rendered line adopts the active option's resolved color, and switching selection re-colors it", () => {
    const spec: ChartSpec = {
      chartType: "line",
      title: "GDP by {dimension}",
      xAxisType: "temporal",
      data: "inline",
      title_selectors: {
        dimension: {
          options: [
            { id: "sector", label: "Sector", color: "blue" },
            { id: "country", label: "Country", color: "amber" },
          ],
          default: "sector",
        },
      },
    };
    const container = document.createElement("div");
    mountChart(container, { spec, rows: ROWS });
    const pathBefore = container.querySelector(".figure-canvas svg path") as SVGPathElement;
    expect(pathBefore.getAttribute("stroke")?.toLowerCase()).toBe("#0072b2");

    const btn = container.querySelector("button.inline-select") as HTMLButtonElement;
    btn.click();
    (container.querySelector('li[data-id="country"]') as HTMLLIElement).click();

    const pathAfter = container.querySelector(".figure-canvas svg path") as SVGPathElement;
    expect(pathAfter.getAttribute("stroke")?.toLowerCase()).toBe("#e69f00");
  });

  it("multi-series chart: selection changes tint the label only — series colors are untouched", () => {
    const spec: ChartSpec = {
      chartType: "line",
      title: "GDP by {dimension}",
      xAxisType: "temporal",
      data: "inline",
      series_order: ["Sector", "Country"],
      title_selectors: {
        dimension: {
          options: [
            { id: "sector", label: "Sector", color: "blue" },
            { id: "country", label: "Country", color: "amber" },
          ],
          default: "sector",
        },
      },
    };
    const container = document.createElement("div");
    mountChart(container, { spec, rows: MULTI_SERIES_ROWS });
    const strokesBefore = Array.from(container.querySelectorAll(".figure-canvas svg path"))
      .map((p) => p.getAttribute("stroke")?.toLowerCase())
      .sort();

    const btn = container.querySelector("button.inline-select") as HTMLButtonElement;
    btn.click();
    (container.querySelector('li[data-id="country"]') as HTMLLIElement).click();

    const strokesAfter = Array.from(container.querySelectorAll(".figure-canvas svg path"))
      .map((p) => p.getAttribute("stroke")?.toLowerCase())
      .sort();
    expect(strokesAfter).toEqual(strokesBefore);

    // The label itself DID tint to the newly-active option's color.
    const label = container.querySelector(".inline-select-label") as HTMLElement;
    expect(label.style.color.toLowerCase()).toBe("rgb(230, 159, 0)"); // #E69F00 (amber)
  });

  it("faceted (small multiples) no-series bars: every pane adopts the accent, live on selection change", () => {
    const spec: ChartSpec = {
      chartType: "bar",
      title: "GDP by {dimension}",
      xAxisType: "categorical",
      data: "inline",
      columns: { x: "time", value: "value", facet: "facet" },
      small_multiples: { columns: 2 },
      title_selectors: {
        dimension: {
          options: [
            { id: "sector", label: "Sector", color: "blue" },
            { id: "country", label: "Country", color: "amber" },
          ],
          default: "sector",
        },
      },
    };
    const container = document.createElement("div");
    mountChart(container, { spec, rows: FACET_BAR_ROWS });
    // Effective bar fill per pane — hoisted constant on the group, else the first rect's fill.
    const paneFill = (g: Element): string | null => {
      const own = g.getAttribute("fill");
      if (own && own !== "none") return own.toLowerCase();
      return g.querySelector("rect")?.getAttribute("fill")?.toLowerCase() ?? null;
    };
    const groups = () => Array.from(container.querySelectorAll('.figure-pane svg g[aria-label="bar"]'));
    const before = groups();
    expect(before.length).toBe(2); // two panes
    before.forEach((g) => expect(paneFill(g)).toBe("#0072b2")); // blue accent at load

    const btn = container.querySelector("button.inline-select") as HTMLButtonElement;
    btn.click();
    (container.querySelector('li[data-id="country"]') as HTMLLIElement).click();

    groups().forEach((g) => expect(paneFill(g)).toBe("#e69f00")); // recolored to amber, live
  });
});
