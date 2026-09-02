// @vitest-environment jsdom
//
// Task 41 (#41): THE HOVER CARD WRAPS A LONG ROW LABEL RATHER THAN CLIPPING IT — and a value never
// ends up alone on a line, separated from the label it belongs to.
//
// `.tbl-tooltip` carried `white-space: nowrap` AND `max-width: 320px`. Those two contradict: the
// box stops at 320px and the un-wrappable line runs out through the border, so the row's VALUE —
// the one thing a reader hovers for — was painted outside the card and clipped. Measured on a
// scatter whose card rows fall back to the axis titles (`tooltip_x_label` absent, the #35 fallback),
// but it hit any card with a long series name, category name or overlay label.
//
// The fix is `white-space: normal` plus a NON-BREAKING space between every label span and its value
// span. Without the nbsp, wrapping trades clipping for a worse read: the label fills the line and
// the value drops onto one of its own, so "…(percentage points)" and "2.59" no longer look like one
// statement. There are seven separate emission sites in crosshair.ts (scatter x/y, series rows,
// two Total rows, the cumulative-area Total, overlay rows); `rowSeparators` below is applied to
// every card these tests can reach, so they cannot drift apart on it again.
//
// jsdom does not lay out, so the WRAPPING itself is not provable here — only the CSS declaration
// and the separator are. The wrap is evidenced by the Playwright screenshots named in the task
// report (`wrap-after-*.png`).
import { describe, it, expect, beforeEach } from "vitest";
import { mountChart } from "../src/engine/render-live";
import { mountHover, cardShown, hoverFirstMark, BAR_MARK, PLOT_MIDDLE } from "./helpers/hover-harness";
import { overlayTooltipRows } from "../src/engine/crosshair";
import { CHART_CSS } from "../src/embed/styles";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const rowsOf = (o: Record<string, string>[]): TidyRow[] => o as unknown as TidyRow[];

// The card is a DOCUMENT-level singleton, so a previous test's card would be read as this one's.
beforeEach(() => { document.body.innerHTML = ""; });

function mount(spec: ChartSpec, rows: TidyRow[]): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  mountChart(container, { spec, rows, width: 720, height: 400 } as never);
  return container;
}

const canvas = (c: HTMLElement) => c.querySelector<SVGSVGElement>(".figure-canvas svg")!;

/** The `.tbl-tooltip` rule's own declaration block, so a `white-space` belonging to some other
 *  selector cannot satisfy (or break) an assertion about THIS one. */
function tooltipRuleBlock(): string {
  const m = /\.tbl-tooltip\s*\{([^}]*)\}/.exec(CHART_CSS);
  expect(m, "no .tbl-tooltip rule in CHART_CSS — this measures nothing").not.toBeNull();
  return m![1]!;
}

/** For every card row carrying BOTH a label and a value, the text sitting BETWEEN them. The two
 *  spans are siblings inside one wrapper span whose only other content is that separator, so
 *  slicing the wrapper's text by the two children's lengths isolates it exactly. */
function rowSeparators(root: ParentNode = document.body): string[] {
  const tip = root.querySelector<HTMLElement>(".tbl-tooltip") ?? (root as HTMLElement);
  const out: string[] = [];
  for (const row of Array.from(tip.querySelectorAll(".tbl-tooltip-row"))) {
    const label = row.querySelector(".tbl-tooltip-label");
    const value = row.querySelector(".tbl-tooltip-value");
    if (!label || !value) continue;
    const whole = label.parentElement!.textContent ?? "";
    const lt = (label.textContent ?? "").length;
    const vt = (value.textContent ?? "").length;
    out.push(whole.slice(lt, whole.length - vt));
  }
  return out;
}

/** Written as the ESCAPE, never as the character: a literal nbsp in source is indistinguishable
 *  from a plain space on screen, so the next person to touch this file could not tell that an
 *  assertion had silently become the very thing it exists to reject. */
const NBSP = "\u00a0";

/** Every separator is the non-breaking space, and there is at least one to check. */
function expectNbspSeparators(seps: string[], what: string): void {
  expect(seps.length, `${what}: no label+value row found, so this measures nothing`).toBeGreaterThan(0);
  for (const s of seps) expect(s, `${what}: separator is ${JSON.stringify(s)}`).toBe(NBSP);
}

/** Long enough to overflow a 320px card at 12px — the defect's own condition. */
const LONG_X = "CBO's projected annual debt-to-GDP ratio change (percentage points)";
const LONG_Y = "Congress's deficit reduction (percent of GDP)";

describe("the card's CSS wraps instead of clipping (#41)", () => {
  it(".tbl-tooltip sets white-space: normal", () => {
    expect(tooltipRuleBlock()).toMatch(/white-space:\s*normal/);
  });

  it(".tbl-tooltip no longer sets white-space: nowrap", () => {
    // The defect itself: nowrap plus a max-width means the text leaves the box rather than wrapping
    // inside it, and the row's value is the part that lands outside.
    expect(tooltipRuleBlock()).not.toMatch(/white-space:\s*nowrap/);
  });

  it(".tbl-tooltip keeps max-width: 320px — that is the width it wraps AT", () => {
    // Raising the cap was the rejected alternative (wrap-C in the decision renders): a wider card
    // covers more of the chart it is describing.
    expect(tooltipRuleBlock()).toMatch(/max-width:\s*320px/);
  });
});

describe("a value never wraps onto a line of its own (#41)", () => {
  it("a scatter's x and y rows, on the axis-title fallback, separate label from value with nbsp", () => {
    // The reported case: no tooltip_x_label/tooltip_y_label, so the rows carry the axis titles.
    const spec = {
      chartType: "scatter",
      title: "t",
      xAxisType: "numeric",
      x_axis_title: LONG_X,
      y_axis_title: LONG_Y,
      columns: { x: "x", value: "y" },
      data: "inline",
    } as unknown as ChartSpec;
    const svg = canvas(mount(spec, rowsOf([{ x: "1", y: "10" }])));
    svg.querySelector('g[aria-label="dot"] circle, g[aria-label="dot"] path')!
      .dispatchEvent(new PointerEvent("pointerenter", { clientX: 10, clientY: 10, bubbles: true }));
    const seps = rowSeparators();
    expect(seps.length, "a scatter card draws an x row and a y row").toBe(2);
    expectNbspSeparators(seps, "scatter x/y rows");
  });

  it("a stacked bar's series rows and its Total row separate label from value with nbsp", () => {
    // A negative stack resolves netDisplay to a dot, which is what gives this card its Total row.
    const spec = {
      chartType: "stacked",
      title: "t",
      xAxisType: "categorical",
      data: "inline",
      series_labels: { a: "Refundable credits paid out to filers with no income tax liability" },
    } as unknown as ChartSpec;
    const rows = rowsOf([
      { time: "A", series: "a", value: "-6" },
      { time: "A", series: "b", value: "2" },
      { time: "B", series: "a", value: "-4" },
      { time: "B", series: "b", value: "1" },
    ]);
    const m = mountHover(spec, rows);
    hoverFirstMark(m.svgs[0]!, BAR_MARK);
    expect(cardShown(), "no card shown, so this measures nothing").toBe(true);
    const tip = document.body.querySelector<HTMLElement>(".tbl-tooltip")!;
    // Positive control: without the Total row this would only be measuring the series rows.
    expect(tip.querySelector(".tbl-tooltip-row--total"), "no Total row on this card").not.toBeNull();
    expectNbspSeparators(rowSeparators(), "stacked series + Total rows");
  });

  it("an overlay row separates its label from its value with nbsp", () => {
    const html = overlayTooltipRows(
      [{
        label: "Fitted trend through the post-2004 observations",
        color: "#333",
        dashed: false,
        points: [{ x: 2019, y: 4 }, { x: 2021, y: 6 }],
      }],
      2020,
      (v: number) => v.toFixed(2),
    );
    const holder = document.createElement("div");
    holder.innerHTML = html;
    expectNbspSeparators(rowSeparators(holder), "overlay row");
  });

  it("a stacked area's cumulative Total row separates its label from its value with nbsp", () => {
    const spec = {
      chartType: "area",
      title: "t",
      xAxisType: "temporal",
      data: "inline",
    } as unknown as ChartSpec;
    const rows = rowsOf([
      { time: "2020-01-01", series: "Alpha", value: "1" },
      { time: "2020-02-01", series: "Alpha", value: "2" },
      { time: "2020-01-01", series: "Beta", value: "3" },
      { time: "2020-02-01", series: "Beta", value: "4" },
    ]);
    const m = mountHover(spec, rows);
    hoverFirstMark(m.svgs[0]!, PLOT_MIDDLE);
    expect(cardShown(), "no card shown, so this measures nothing").toBe(true);
    const tip = document.body.querySelector<HTMLElement>(".tbl-tooltip")!;
    // Positive control: the cumulative Total row is the site this case exists for.
    expect(tip.textContent, "no Total row on this area card").toContain("Total");
    expectNbspSeparators(rowSeparators(), "area series + Total rows");
  });
});
