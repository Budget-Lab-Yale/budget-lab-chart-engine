// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import { resolveTimelineOrientation, timelineWarnings, TIMELINE_CLASS } from "../src/engine/marks/timeline";
import { TL_GEOM } from "../src/engine/timeline-layout";
import { TBL } from "../src/engine/theme";
import { tokens } from "../src/theme/tokens";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const SPEC = {
  chartType: "timeline", title: "Policy and workforce timing", xAxisType: "temporal", data: "d.csv",
  columns: { x: "date", end: "end", label: "title", description: "detail", series: "kind" },
  series_order: ["policy", "cohort"], series_labels: { policy: "Policy", cohort: "Cohort milestone" },
  projected_field: "projected",
} as ChartSpec;
const ROWS: TidyRow[] = [
  { date: "2026", end: "", title: "Policy begins", detail: "", kind: "policy", projected: "" },
  { date: "2030", end: "", title: "First cohort born", detail: "Under fully phased-in policy", kind: "policy", projected: "" },
  { date: "2031", end: "2035", title: "Phase-in", detail: "", kind: "policy", projected: "1" },
  { date: "2040", end: "ongoing", title: "Credits", detail: "", kind: "policy", projected: "" },
  { date: "2057", end: "", title: "That cohort turns 27", detail: "", kind: "cohort", projected: "1" },
  { date: "2095", end: "", title: "That cohort turns 65", detail: "", kind: "cohort", projected: "" },
] as TidyRow[];
const r = (s: Partial<ChartSpec> = {}, width = 900, rows = ROWS) => renderChart({ ...SPEC, ...s } as ChartSpec, rows, { width });
const q = (svg: SVGSVGElement, sel: string) => [...svg.querySelectorAll(sel)];

describe("timeline render", () => {
  it("draws one marker per point event and one bar per span", () => {
    const { svg } = r();
    expect(svg.getAttribute("class")).toContain(TIMELINE_CLASS);
    expect(q(svg, "circle.tbl-timeline-marker")).toHaveLength(4);
    expect(q(svg, "rect.tbl-timeline-span")).toHaveLength(2);
  });

  it("draws a projected point hollow and a projected span dashed", () => {
    const { svg } = r();
    const hollow = q(svg, "circle.tbl-timeline-marker").filter((c) => c.getAttribute("fill") === tokens.structural.background);
    expect(hollow).toHaveLength(1);
    const dashed = q(svg, "rect.tbl-timeline-span").filter((s) => s.getAttribute("stroke-dasharray"));
    expect(dashed).toHaveLength(1);
  });

  it("defines the fade gradient and references it from the ongoing span", () => {
    const { svg } = r();
    const grad = svg.querySelector("linearGradient");
    expect(grad).not.toBeNull();
    const id = grad!.getAttribute("id")!;
    expect(id).toMatch(/^tblfade-[A-Za-z0-9]+-right/);
    expect(grad!.getAttribute("x2")).toBe("1");
    expect(grad!.getAttribute("y2")).toBe("0");
    expect(q(svg, "rect.tbl-timeline-span").some((s) => s.getAttribute("fill") === `url(#${id})`)).toBe(true);
  });

  it("fades the ongoing span over its last 24px, not a share of its length", () => {
    const { svg } = r();
    const span = q(svg, "rect.tbl-timeline-span").find((s) => (s.getAttribute("fill") ?? "").startsWith("url("))!;
    const w = Number(span.getAttribute("width"));
    const stops = [...svg.querySelector("linearGradient")!.querySelectorAll("stop")];
    const fadeStart = Number(stops[0]!.getAttribute("offset"));
    expect(w * (1 - fadeStart)).toBeCloseTo(TL_GEOM.fade, 0);
  });

  it("fades downward on a vertical render", () => {
    const { svg } = renderChart(SPEC, ROWS, { width: 400, timelineOrientation: "vertical" });
    const grad = svg.querySelector("linearGradient")!;
    expect(grad.getAttribute("id")).toMatch(/^tblfade-[A-Za-z0-9]+-down/);
    expect(grad.getAttribute("x2")).toBe("0");
    expect(grad.getAttribute("y2")).toBe("1");
    expect(q(svg, "rect.tbl-timeline-span").some((s) => s.getAttribute("fill") === `url(#${grad.getAttribute("id")})`)).toBe(true);
  });

  it("renders the derived year format and a span range", () => {
    const text = r().svg.textContent!;
    expect(text).toContain("2026");
    expect(text).toContain("2031–2035");
    expect(text).toContain("2040–");
    expect(text).not.toContain("Jan");
  });

  it("uses a date_label cell over the formatted date", () => {
    const rows = ROWS.map((x, i) => ({ ...x, dl: i === 0 ? "FY2026" : "" })) as TidyRow[];
    const text = r({ columns: { ...SPEC.columns, date_label: "dl" } }, 900, rows).svg.textContent!;
    expect(text).toContain("FY2026");
  });

  it("is a list of events in chronological DOM order", () => {
    const { svg } = r();
    const list = svg.querySelector('g[role="list"]')!;
    expect(list.getAttribute("aria-label")).toBe("Timeline, 6 events");
    const items = q(svg, 'g[role="listitem"]').map((g) => g.getAttribute("aria-label"));
    expect(items[0]).toBe("2026: Policy begins.");
    expect(items[1]).toBe("2030: First cohort born. Under fully phased-in policy");
    expect(items.at(-1)).toBe("2095: That cohort turns 65.");
  });

  it("orders listitems by date, not CSV order", () => {
    const shuffled = [ROWS[5], ROWS[0], ROWS[3], ROWS[1], ROWS[4], ROWS[2]] as TidyRow[];
    const items = q(r({}, 900, shuffled).svg, 'g[role="listitem"]').map((g) => g.getAttribute("aria-label")!.slice(0, 4));
    expect(items).toEqual(["2026", "2030", "2031", "2040", "2057", "2095"]);
  });

  it("tags every event element with data-series", () => {
    const { svg } = r();
    const els = q(svg, ".tbl-timeline-marker, .tbl-timeline-span, .tbl-timeline-stem, .tbl-timeline-label");
    expect(els.length).toBeGreaterThanOrEqual(6 * 3);
    for (const el of els) {
      expect(el.getAttribute("data-series")).toMatch(/^(policy|cohort)$/);
    }
  });

  it("keys the legend by category with point swatches", () => {
    const { legendItems } = r();
    expect(legendItems!.map((i) => [i.series, i.label, i.markerShape])).toEqual([
      ["policy", "Policy", "point"], ["cohort", "Cohort milestone", "point"],
    ]);
  });

  it("drops legend series rows with lanes, restores them with series_legend: true", () => {
    expect(r({ timeline: { lanes: true } }).legendItems).toBeNull();
    expect(r({ timeline: { lanes: true }, series_legend: true }).legendItems).toHaveLength(2);
  });

  it("draws one lane name per lane, in series_order", () => {
    const { svg } = r({ timeline: { lanes: true }, series_order: ["cohort", "policy"] });
    const names = q(svg, ".tbl-timeline-lane-label").map((t) => t.textContent);
    expect(names).toEqual(["Cohort milestone", "Policy"]);
    expect(q(svg, "line.tbl-timeline-rule")).toHaveLength(2);
  });

  it("draws a wrapped lane name as one element with a line per wrapped row", () => {
    const labels = { policy: "Federal and state policy changes", cohort: "Cohort milestone" };
    const { svg } = r({ timeline: { lanes: true }, series_labels: labels }, 500);
    const lanes = q(svg, ".tbl-timeline-lane-label");
    expect(lanes).toHaveLength(2);
    const lines = [...lanes[0]!.querySelectorAll("tspan")];
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((t) => t.textContent).join(" ")).toBe(labels.policy);
    const ys = lines.map((t) => Number(t.getAttribute("y")));
    expect(ys[1]! - ys[0]!).toBeCloseTo(15, 5);
    expect(lanes[0]!.getAttribute("text-anchor")).toBe("end");
  });

  it("has no legend row when the series column holds one value", () => {
    const rows = ROWS.map((x) => ({ ...x, kind: "policy" })) as TidyRow[];
    const res = r({ series_order: undefined, series_labels: undefined }, 900, rows);
    expect(res.legendItems).toBeNull();
    expect(q(res.svg, "circle.tbl-timeline-marker")[0]!.getAttribute("stroke")).toBeTruthy();
  });

  it("draws ticks only with axis: true, at the axis type size", () => {
    expect(q(r().svg, ".tbl-timeline-tick")).toHaveLength(0);
    const ticks = q(r({ timeline: { axis: true } }).svg, ".tbl-timeline-tick");
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    for (const t of ticks) expect(t.getAttribute("font-size")).toBe(String(TBL.size.axis));
  });

  it("renders the authored orientation unless told otherwise, and reports it", () => {
    expect(r().timelineOrientation).toBe("horizontal");
    expect(renderChart(SPEC, ROWS, { width: 900, timelineOrientation: "vertical" }).timelineOrientation).toBe("vertical");
    expect(r({ orientation: "vertical" }).timelineOrientation).toBe("vertical");
  });

  it("collapses lanes and shows legend rows when rendered vertical from a lanes spec", () => {
    const res = renderChart({ ...SPEC, timeline: { lanes: true } } as ChartSpec, ROWS, { width: 400, timelineOrientation: "vertical" });
    expect(q(res.svg, ".tbl-timeline-lane-label")).toHaveLength(0);
    expect(res.legendItems).toHaveLength(2);
  });

  it("fires afterRender last with the SVG it returns", () => {
    let seen: SVGSVGElement | null = null;
    const res = renderChart(SPEC, ROWS, { width: 900, hooks: { afterRender: (svg) => { seen = svg; } } });
    expect(seen).toBe(res.svg);
  });

  it("contains no NaN", () => {
    expect(/NaN/.test(r().svg.outerHTML)).toBe(false);
    expect(/NaN/.test(renderChart(SPEC, ROWS, { width: 320, timelineOrientation: "vertical" }).svg.outerHTML)).toBe(false);
  });
});

describe("resolveTimelineOrientation", () => {
  it("keeps horizontal when it fits, switches below 480px or when it does not fit", () => {
    expect(resolveTimelineOrientation(SPEC, ROWS, 1000)).toBe("horizontal");
    expect(resolveTimelineOrientation(SPEC, ROWS, 400)).toBe("vertical");
    const dense = Array.from({ length: 16 }, (_, i) => ({ date: `2026-${String((i % 12) + 1).padStart(2, "0")}-01`, end: "", title: `A reasonably long event title ${i}`, detail: "", kind: "policy", projected: "" })) as TidyRow[];
    expect(resolveTimelineOrientation(SPEC, dense, 700)).toBe("vertical");
  });
  it("never switches with auto_vertical: false, never leaves an authored vertical", () => {
    expect(resolveTimelineOrientation({ ...SPEC, timeline: { auto_vertical: false } } as ChartSpec, ROWS, 300)).toBe("horizontal");
    expect(resolveTimelineOrientation({ ...SPEC, orientation: "vertical" } as ChartSpec, ROWS, 1200)).toBe("vertical");
  });
});

describe("timelineWarnings", () => {
  // 21 events on 3 dates: seven labels share each date, more than the 4 rows (2 a side) can hold.
  const many = Array.from({ length: 21 }, (_, i) => ({ date: `2026-01-0${(i % 3) + 1}`, end: "", title: `Event ${i}`, detail: "", kind: "policy", projected: "" })) as TidyRow[];
  it("is empty for the fixture, warns past 20 events and on export overflow", () => {
    expect(timelineWarnings(SPEC, ROWS, 920)).toEqual([]);
    const w = timelineWarnings(SPEC, many, 920).join("\n");
    expect(w).toMatch(/21 events; more than 20 is hard to read/);
    expect(w).toMatch(/horizontal layout needs more than 2 label rows per side at the 920px export width/);
  });
  it("does not warn about horizontal overflow for an authored vertical", () => {
    const w = timelineWarnings({ ...SPEC, orientation: "vertical" } as ChartSpec, many, 920);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/21 events/);
  });
});
