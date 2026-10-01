// @vitest-environment jsdom
// Treemap live mount (spec §6): sizing at the card width with a 280px floor, re-flow on resize
// through the ordinary draw() path, no legend or y-axis overlay, and the per-tile hover card.
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mountChart, computeChartHeight } from "../src/engine/render-live";
import { treemapHeight } from "../src/engine/marks/treemap";
import { treemapAreaHeight } from "../src/engine/treemap-layout";
import { tokens } from "../src/theme/tokens";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

function parseCsv(path: string): TidyRow[] {
  const text = readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8").trim();
  const [header, ...lines] = text.split(/\r?\n/);
  const cols = (header as string).split(",");
  return lines.map((line) => {
    const cells = line.split(",");
    const row: Record<string, string> = {};
    cols.forEach((c, i) => { row[c] = cells[i] ?? ""; });
    return row as TidyRow;
  });
}
const BLS = parseCsv("./fixtures/treemap-bls.csv");
const FLAT_SPEC = {
  chartType: "treemap", title: "Share of total annual expenditures, 2024", xAxisType: "categorical", data: "d.csv",
  columns: { x: "category", value: "amount" }, value_format: { prefix: "$" },
} as ChartSpec;

// Grouped, with markup in a group label, a tile name and a text cell (escaping), a numeric cell with
// its own format, a numeric cell falling back to value_format, and blank cells (row omitted).
const HOVER_SPEC = {
  chartType: "treemap", title: "Outlays", xAxisType: "categorical", data: "d.csv",
  columns: { x: "category", value: "amount", series: "group" },
  series_labels: { Mandatory: "Mandatory & <co>" },
  value_format: { prefix: "$" }, tooltip_decimals: 1,
  treemap: {
    share_decimals: 2,
    tooltip: [
      { column: "change", label: "Change", format: { decimals: 1, suffix: " pp" } },
      { column: "note" },
      { column: "count", label: "Count" },
    ],
  },
} as ChartSpec;
const HOVER_ROWS = [
  { group: "Mandatory", category: "Social <Security>", amount: "1461", change: "1.26", note: "Includes <OASI> & DI", count: "1234" },
  { group: "Mandatory", category: "Medicare", amount: "874", change: "-1.04", note: "", count: "5000" },
  { group: "Discretionary", category: "Defense", amount: "850", change: "", note: "Base budget", count: "" },
  { group: "Discretionary", category: "Education", amount: "300", change: "2", note: "", count: "" },
] as unknown as TidyRow[];

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

function mountAt(width: number, spec: ChartSpec = FLAT_SPEC, rows: TidyRow[] = BLS): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  mountChart(host, { spec, rows, width });
  return host;
}
const svgOf = (host: HTMLElement) => host.querySelector("svg.tbl-treemap") as SVGSVGElement;
const num = (e: Element, a: string): number => Number(e.getAttribute(a));
const tileRects = (svg: SVGSVGElement) => [...svg.querySelectorAll<SVGRectElement>("rect.tbl-treemap-tile")];
const tileGroups = (svg: SVGSVGElement) => tileRects(svg).map((r) => r.parentElement as unknown as SVGGElement);
const tileNamed = (svg: SVGSVGElement, name: string): SVGRectElement =>
  tileRects(svg).find((r) => (r.parentElement!.getAttribute("aria-label") ?? "").split(", ")[0]!.split(" · ").pop() === name)!;
const geometry = (svg: SVGSVGElement): string =>
  tileRects(svg).map((r) => ["x", "y", "width", "height"].map((a) => r.getAttribute(a)).join(",")).join(" ");
const keyText = (svg: SVGSVGElement): string[] => [...svg.querySelectorAll("text.tbl-treemap-key")].map((t) => t.textContent ?? "");
const tip = (): HTMLElement | null => document.body.querySelector<HTMLElement>(".tbl-tooltip");
const cardShown = (): boolean => tip()?.style.opacity === "1";
const enter = (el: Element): void => {
  el.dispatchEvent(new PointerEvent("pointerenter", { clientX: 10, clientY: 10 }));
};
const leave = (el: Element): void => {
  el.dispatchEvent(new PointerEvent("pointerleave", { clientX: 10, clientY: 10 }));
};
/** Card rows as "Label: value" (the label span carries its own colon; the gap is a nbsp). */
const cardRows = (): string[] =>
  [...tip()!.querySelectorAll(".tbl-tooltip-row")].map((r) =>
    `${r.querySelector(".tbl-tooltip-label")!.textContent} ${r.querySelector(".tbl-tooltip-value")!.textContent}`);

afterEach(() => {
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  FakeResizeObserver.instances = [];
  document.body.replaceChildren();
});

describe("treemap live mount: sizing", () => {
  it("pre-draw height estimate is the treemap's own height at 720, not the fixed 400", () => {
    expect(computeChartHeight(FLAT_SPEC, BLS)).toBe(treemapHeight(FLAT_SPEC, BLS, 720));
  });

  it("renders at the card width with the treemap's height (area + key)", () => {
    const svg = svgOf(mountAt(900));
    expect(num(svg, "width")).toBe(900);
    expect(num(svg, "height")).toBe(treemapHeight(FLAT_SPEC, BLS, 900));
    // The area is width / 2 at this width (aspect 2.0, under the 460 cap); the tiles fill it.
    const bottom = Math.max(...tileRects(svg).map((r) => num(r, "y") + num(r, "height")));
    expect(bottom).toBeCloseTo(treemapAreaHeight(900), 1);
    expect(treemapAreaHeight(900)).toBe(450);
  });

  it("floors the live width at 280px: a 200px card renders a 280px chart", () => {
    const svg = svgOf(mountAt(200));
    expect(num(svg, "width")).toBe(280);
    expect(num(svg, "height")).toBe(treemapHeight(FLAT_SPEC, BLS, 280));
  });

  it("draws no legend and no sticky y-axis overlay", () => {
    const host = mountAt(900, HOVER_SPEC, HOVER_ROWS);
    expect(host.querySelector(".figure-legend-slot")!.childElementCount).toBe(0);
    expect(host.querySelector(".figure-legend-slot--right")).toBeNull();
    expect(host.querySelector(".tbl-legend")).toBeNull();
    expect(host.querySelector(".figure-y-axis-overlay")).toBeNull();
  });

  it("re-flows on resize (900 → 340 → 900) and the round trip reproduces the first draw byte-for-byte", async () => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
    const host = mountAt(900);
    const first = svgOf(host).outerHTML;
    const firstGeom = geometry(svgOf(host));
    expect(keyText(svgOf(host))).toEqual([]);

    await resizeTo(host, 340);
    const narrow = svgOf(host);
    expect(num(narrow, "width")).toBe(340);
    expect(num(narrow, "height")).toBe(treemapHeight(FLAT_SPEC, BLS, 340));
    // Portrait-ish: the area is taller than it is wide at 340.
    const bottom = Math.max(...tileRects(narrow).map((r) => num(r, "y") + num(r, "height")));
    expect(bottom).toBeGreaterThan(340);
    expect(geometry(narrow)).not.toBe(firstGeom);
    // Label fitting re-runs too: tiles too small at 340 move into the key.
    expect(keyText(narrow).join(" ")).toContain("Cash contributions");

    await resizeTo(host, 900);
    expect(svgOf(host).outerHTML).toBe(first);
  });

  it("the round trip still reproduces the first draw after a hover on the first draw", async () => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
    const host = mountAt(900, HOVER_SPEC, HOVER_ROWS);
    const first = svgOf(host).outerHTML;
    const r = tileRects(svgOf(host))[0]!.parentElement!;
    enter(r);
    leave(r);
    await resizeTo(host, 340);
    await resizeTo(host, 900);
    expect(svgOf(host).outerHTML).toBe(first);
  });
});

describe("treemap live mount: hover", () => {
  it("hover outlines the tile above its neighbours, dims the others, and shows the card", () => {
    const svg = svgOf(mountAt(900, HOVER_SPEC, HOVER_ROWS));
    const rect = tileNamed(svg, "Social <Security>");
    const g = rect.parentElement!;
    enter(g);

    // Outline: a separate element, drawn last, exactly over the hovered tile.
    const outline = svg.lastElementChild!;
    expect(outline.getAttribute("class")).toBe("tbl-treemap-hover-outline");
    expect(outline.getAttribute("stroke")).toBe(tokens.structural.text_heading);
    expect(outline.getAttribute("stroke-width")).toBe("2");
    expect(outline.getAttribute("fill")).toBe("none");
    for (const a of ["x", "y", "width", "height"]) expect(outline.getAttribute(a)).toBe(rect.getAttribute(a));
    // Dim: every other tile at 0.85, the hovered one untouched.
    for (const other of tileGroups(svg)) {
      expect(other.getAttribute("opacity")).toBe(other === (g as unknown as SVGGElement) ? null : "0.85");
    }

    expect(cardShown()).toBe(true);
    const head = tip()!.querySelector(".tbl-tooltip-head")!;
    expect(head.textContent).toBe("Mandatory & <co> · Social <Security>");
    expect(head.innerHTML).toBe("Mandatory &amp; &lt;co&gt; · Social &lt;Security&gt;");
    // Value at tooltip_decimals (1), Share at share_decimals (2: 1461 / 3485), then the configured
    // rows in order: own format, text verbatim (label defaults to the column), value_format fallback.
    expect(cardRows()).toEqual([
      "Value: $1,461.0",
      "Share: 41.92%",
      "Change: 1.3 pp",
      "note: Includes <OASI> & DI",
      "Count: $1,234",
    ]);
    expect(tip()!.innerHTML).toContain("Includes &lt;OASI&gt; &amp; DI");
    // Same row markup as the scatter card: label span, a non-breaking gap, value span.
    const row = tip()!.querySelector(".tbl-tooltip-row")!;
    const parts = [...row.firstElementChild!.childNodes].map((n) =>
      n.nodeType === 1 ? `${(n as Element).className}=${n.textContent}` : JSON.stringify(n.textContent));
    expect(parts).toEqual(["tbl-tooltip-label=Value:", JSON.stringify(" "), "tbl-tooltip-value=$1,461.0"]);
  });

  it("a blank cell omits that row for that tile", () => {
    const svg = svgOf(mountAt(900, HOVER_SPEC, HOVER_ROWS));
    enter(tileNamed(svg, "Defense").parentElement!);
    expect(tip()!.querySelector(".tbl-tooltip-head")!.textContent).toBe("Discretionary · Defense");
    expect(cardRows()).toEqual(["Value: $850.0", "Share: 24.39%", "note: Base budget"]);

    enter(tileNamed(svg, "Medicare").parentElement!);
    expect(cardRows()).toEqual(["Value: $874.0", "Share: 25.08%", "Change: -1.0 pp", "Count: $5,000"]);
  });

  it("value uses value_format.decimals when tooltip_decimals is unset; flat tiles have no group prefix", () => {
    const svg = svgOf(mountAt(900));
    enter(tileNamed(svg, "Housing").parentElement!);
    expect(tip()!.querySelector(".tbl-tooltip-head")!.textContent).toBe("Housing");
    expect(cardRows()[0]).toBe("Value: $28,452");
    expect(cardRows()[1]).toMatch(/^Share: \d+\.\d%$/);
  });

  it("pointerleave restores the static render and hides the card", () => {
    const svg = svgOf(mountAt(900, HOVER_SPEC, HOVER_ROWS));
    const before = svg.outerHTML;
    const g = tileNamed(svg, "Medicare").parentElement!;
    enter(g);
    expect(svg.outerHTML).not.toBe(before);
    leave(g);
    expect(svg.outerHTML).toBe(before);
    expect(cardShown()).toBe(false);
  });

  it("moving straight from one tile to another leaves one outline and re-dims", () => {
    const svg = svgOf(mountAt(900, HOVER_SPEC, HOVER_ROWS));
    const a = tileNamed(svg, "Medicare").parentElement!;
    const b = tileNamed(svg, "Defense").parentElement!;
    enter(a);
    enter(b);
    expect(svg.querySelectorAll(".tbl-treemap-hover-outline")).toHaveLength(1);
    expect(a.getAttribute("opacity")).toBe("0.85");
    expect(b.getAttribute("opacity")).toBeNull();
  });

  it("chrome.tooltip: false keeps the outline and dim but shows no card", () => {
    const spec = { ...HOVER_SPEC, chrome: { tooltip: false } } as ChartSpec;
    const svg = svgOf(mountAt(900, spec, HOVER_ROWS));
    const g = tileNamed(svg, "Medicare").parentElement!;
    enter(g);
    expect(svg.querySelectorAll(".tbl-treemap-hover-outline")).toHaveLength(1);
    expect(tileNamed(svg, "Defense").parentElement!.getAttribute("opacity")).toBe("0.85");
    expect(cardShown()).toBe(false);
    expect(tip()?.textContent ?? "").toBe("");
  });
});
