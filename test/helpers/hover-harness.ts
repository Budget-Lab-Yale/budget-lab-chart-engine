// Shared jsdom hover harness for the two DEFAULT-CONFIGURATION hover test files
// (hover-card-reach.test.ts, hover-claims-defaults.test.ts). Not a test file — `vitest.config.ts`
// only collects `test/**/*.test.ts`, so this is imported, never run on its own.
//
// Everything here is measurement plumbing, not policy: no helper sets a spec field, so a test
// cannot accidentally acquire a non-default dial from the harness. That matters because the class
// of defect these two files gate is "a claim verified by a test that quietly turned a default off".
import { mountChart } from "../../src/engine/render-live";
import { CROSSHAIR_HIT_SELECTOR } from "../../src/engine/crosshair";
import type { ChartSpec } from "../../src/spec/types";
import type { TidyRow } from "../../src/data/index";

/** jsdom has no layout: map the SVG's own rect 1:1 onto its viewBox so clientX/Y are user-space,
 *  and give every <text> and <circle> a rect derived from its own coords plus its ancestors'
 *  transforms. Both are load-bearing: `readCategoryCentersFromAxis` measures axis-label rects and
 *  `readCategoryCentersFromMarks` measures `[data-category]` marks, skipping any whose rect is
 *  0×0 — which is every SVG element in jsdom unless mocked, so a dot plot would otherwise report
 *  "no card" for a harness reason rather than a behavioural one. */
export function mockRect1to1(svg: SVGSVGElement): void {
  const vb = svg.viewBox.baseVal;
  Object.defineProperty(svg, "getBoundingClientRect", {
    value: () => ({ width: vb.width, height: vb.height, top: 0, left: 0, right: vb.width, bottom: vb.height, x: 0, y: 0 }),
    configurable: true,
  });
  const translate = (el: Element | null): [number, number] => {
    let x = 0, y = 0;
    let cur: Element | null = el;
    while (cur && cur !== svg) {
      const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)/.exec(cur.getAttribute("transform") ?? "");
      if (m) { x += +m[1]!; y += +m[2]!; }
      cur = cur.parentElement;
    }
    return [x, y];
  };
  const box = (el: Element, cx: number, cy: number, w: number, h: number): void => {
    Object.defineProperty(el, "getBoundingClientRect", {
      value: () => ({ left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2, width: w, height: h, x: cx - w / 2, y: cy - h / 2 }),
      configurable: true,
    });
  };
  for (const t of Array.from(svg.querySelectorAll<SVGTextElement>("text"))) {
    const [tx, ty] = translate(t.parentElement);
    const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)/.exec(t.getAttribute("transform") ?? "");
    const ox = m ? +m[1]! : +(t.getAttribute("x") ?? 0);
    const oy = m ? +m[2]! : +(t.getAttribute("y") ?? 0);
    box(t, tx + ox, ty + oy, Math.max(6, (t.textContent ?? "").length * 5), 10);
  }
  for (const c of Array.from(svg.querySelectorAll<SVGCircleElement>("circle"))) {
    const [tx, ty] = translate(c.parentElement);
    const r = Math.max(1, +(c.getAttribute("r") ?? 3));
    box(c, tx + +(c.getAttribute("cx") ?? 0), ty + +(c.getAttribute("cy") ?? 0), r * 2, r * 2);
  }
}

export type Mounted = { container: HTMLElement; svgs: SVGSVGElement[]; calls: () => number };

/** Mount `spec` exactly as given — the harness adds no spec field of its own — with a counting
 *  `hooks.tooltip`. `faceted` picks the pane selector only; the spec decides whether panes exist. */
export function mountHover(spec: ChartSpec, rows: TidyRow[], faceted = false): Mounted {
  let calls = 0;
  const container = document.createElement("div");
  document.body.appendChild(container);
  mountChart(container, {
    spec,
    rows,
    width: faceted ? 838 : 720,
    height: faceted ? 420 : 400,
    hooks: { tooltip: () => { calls++; return null; } },
  } as never);
  const svgs = Array.from(container.querySelectorAll<SVGSVGElement>(faceted ? ".figure-pane svg" : ".figure-canvas svg"));
  svgs.forEach(mockRect1to1);
  return { container, svgs, calls: () => calls };
}

/** Is a floating card actually SHOWN? A non-emitOnly attach creates the singleton up front, so
 *  presence alone is not enough — the shown state is opacity 1. */
export function cardShown(): boolean {
  const tip = document.body.querySelector<HTMLElement>(".tbl-tooltip");
  return !!tip && tip.style.opacity === "1";
}

/** The shown card's text, or "" when no card is shown. */
export function cardText(): string {
  return cardShown() ? document.body.querySelector<HTMLElement>(".tbl-tooltip")!.textContent ?? "" : "";
}

/** Did the pane RESPOND to the hover? Paired with every `cardShown() === false` assertion, so
 *  "no card" can never silently mean "the hover never resolved a category". The coordinated cursor
 *  group is the substitute the engine draws in place of the card. */
export function coordShown(svg: SVGSVGElement): boolean {
  return svg.querySelector("g.tbl-coord")?.getAttribute("opacity") === "1";
}

/** Every text node the coordinated cursor drew on this pane — the substitute's whole readout. */
export function coordTexts(svg: SVGSVGElement): string[] {
  return Array.from(svg.querySelectorAll("g.tbl-coord text")).map((t) => t.textContent ?? "");
}

/** Hover the horizontal centre of the first mark matching `markSel`, on whichever hit rect the
 *  chart attached. Falls back to the middle of the pane when there is no such mark. */
export function hoverFirstMark(svg: SVGSVGElement, markSel: string): void {
  const vb = svg.viewBox.baseVal;
  const mark = svg.querySelector<SVGGraphicsElement>(markSel);
  let cx = vb.width / 2;
  if (mark) {
    const x = mark.getAttribute("x");
    if (x != null) cx = parseFloat(x) + parseFloat(mark.getAttribute("width") ?? "0") / 2;
    else if (mark.getAttribute("cx") != null) cx = parseFloat(mark.getAttribute("cx")!);
  }
  svg.querySelector(CROSSHAIR_HIT_SELECTOR)!.dispatchEvent(
    new PointerEvent("pointermove", { clientX: cx, clientY: vb.height / 2, bubbles: true }),
  );
}

export const BAR_MARK = 'g[aria-label="bar"] rect';
export const HIST_MARK = 'g[aria-label="rect"] rect';
export const DOT_MARK = 'g[aria-label="dot"] circle';
/** A selector that matches nothing — hover the middle of the plot instead. */
export const PLOT_MIDDLE = "nothing-matches";
