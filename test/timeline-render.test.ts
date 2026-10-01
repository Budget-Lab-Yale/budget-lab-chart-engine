// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import { resolveTimelineOrientation, timelineWarnings, TIMELINE_CLASS } from "../src/engine/marks/timeline";
import { TL_GEOM } from "../src/engine/timeline-layout";
import { timelineTextWidth } from "../src/engine/timeline-text";
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
const q = (root: ParentNode, sel: string) => [...root.querySelectorAll(sel)];

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
    expect(id).toMatch(/^tblfade-[A-Za-z0-9_]+-right/);
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
    expect(grad.getAttribute("id")).toMatch(/^tblfade-[A-Za-z0-9_]+-down/);
    expect(grad.getAttribute("x2")).toBe("0");
    expect(grad.getAttribute("y2")).toBe("1");
    expect(q(svg, "rect.tbl-timeline-span").some((s) => s.getAttribute("fill") === `url(#${grad.getAttribute("id")})`)).toBe(true);
  });

  it("gives distinct colours distinct fade gradients even when they share their alphanumerics", () => {
    // rgb(255, 0, 0) and rgb(25, 50, 0) both strip to "rgb25500": two equal ongoing spans then
    // shared one gradient and both drew in the second colour.
    const colors = { a: "rgb(255, 0, 0)", b: "rgb(25, 50, 0)" };
    const rows = [
      { date: "2026", end: "ongoing", title: "A", detail: "", kind: "a", projected: "" },
      { date: "2026", end: "ongoing", title: "B", detail: "", kind: "b", projected: "" },
      { date: "2030", end: "", title: "Point", detail: "", kind: "a", projected: "" },
    ] as TidyRow[];
    const spec = { series_order: ["a", "b"], series_labels: { a: "A", b: "B" }, series_colors: colors };
    for (const orientation of ["horizontal", "vertical"] as const) {
      const { svg } = renderChart({ ...SPEC, ...spec } as ChartSpec, rows, { width: 600, timelineOrientation: orientation });
      const spans = q(svg, "rect.tbl-timeline-span");
      expect(spans).toHaveLength(2);
      const stopColors = spans.map((s) => {
        const id = /^url\(#(.+)\)$/.exec(s.getAttribute("fill") ?? "")![1]!;
        return svg.querySelector(`linearGradient[id="${id}"] stop`)!.getAttribute("stop-color");
      });
      expect(new Set(stopColors), orientation).toEqual(new Set(Object.values(colors)));
    }
  });

  it("renders the derived year format and a span range", () => {
    const text = r().svg.textContent!;
    expect(text).toContain("2026");
    expect(text).toContain("2031 – 2035");
    expect(text).toContain("2040 –");
    expect(text).not.toContain("Jan");
  });

  it("formats dates with an authored timeline.date_format", () => {
    const text = r({ timeline: { date_format: "%Y.%m" } }).svg.textContent!;
    expect(text).toContain("2031.01 – 2035.01");
    expect(text).toContain("2040.01 –");
    expect(text).not.toContain("2031 – 2035");
  });

  it("wraps horizontal labels at an authored timeline.label_width", () => {
    const long = "A long event headline that wraps onto several lines at the default width";
    const rows = [{ ...ROWS[0], title: long }, ...ROWS.slice(1)] as TidyRow[];
    const linesOf = (s: Partial<ChartSpec>) =>
      r(s, 900, rows).svg.querySelectorAll('g[role="listitem"]')[0]!.querySelectorAll("text").length;
    expect(linesOf({ timeline: { label_width: 400 } })).toBeLessThan(linesOf({}));
    expect(linesOf({})).toBe(linesOf({ timeline: { label_width: 150 } }));
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

  it("reads an open-ended span's aria-label as '<date> onward', while the visible date keeps the dash", () => {
    const { svg } = r();
    const items = q(svg, 'g[role="listitem"]');
    const ongoing = items.find((g) => g.getAttribute("aria-label")!.startsWith("2040"))!;
    expect(ongoing.getAttribute("aria-label")).toBe("2040 onward: Credits.");
    const dateLine = q(ongoing, "text")[0]!;
    expect(dateLine.textContent).toBe("2040 –");
    // A closed span's aria-label is unaffected.
    const closed = items.find((g) => g.getAttribute("aria-label")!.startsWith("2031"))!;
    expect(closed.getAttribute("aria-label")).toBe("2031 – 2035: Phase-in.");
    // An override is used verbatim, even for an open-ended span.
    const rows = ROWS.map((x, i) => ({ ...x, dl: i === 3 ? "Since 2040 –" : "" })) as TidyRow[];
    const overridden = q(r({ columns: { ...SPEC.columns, date_label: "dl" } }, 900, rows).svg, 'g[role="listitem"]')
      .find((g) => g.getAttribute("aria-label")!.startsWith("Since"))!;
    expect(overridden.getAttribute("aria-label")).toBe("Since 2040 –: Credits.");
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

  it("legend: false suppresses legendItems entirely", () => {
    expect(r().legendItems).toHaveLength(2); // the default, for contrast
    expect(r({ legend: false }).legendItems).toBeNull();
  });

  it("series_legend: false drops the series rows with no lanes involved", () => {
    expect(r({ series_legend: false }).legendItems).toBeNull();
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

  it("draws ticks only with axis: true, at the axis type size and ink", () => {
    expect(q(r().svg, ".tbl-timeline-tick")).toHaveLength(0);
    const ticks = q(r({ timeline: { axis: true } }).svg, ".tbl-timeline-tick");
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    for (const t of ticks) {
      expect(t.getAttribute("font-size")).toBe(String(TBL.size.axis));
      expect(t.getAttribute("fill")).toBe(TBL.color.axis);
    }
  });

  it("renders the authored orientation unless told otherwise, and reports it", () => {
    expect(r().timelineOrientation).toBe("horizontal");
    expect(renderChart(SPEC, ROWS, { width: 900, timelineOrientation: "vertical" }).timelineOrientation).toBe("vertical");
    expect(r({ orientation: "vertical" }).timelineOrientation).toBe("vertical");
  });

  describe("vertical lanes (D3)", () => {
    const THREE = [...ROWS, { date: "2070", end: "", title: "A third category", detail: "", kind: "other", projected: "" }] as TidyRow[];
    const vert = (s: Partial<ChartSpec>, rows = ROWS, width = 375) =>
      renderChart({ ...SPEC, orientation: "vertical", ...s } as ChartSpec, rows, { width });
    const rules = (svg: SVGSVGElement) => q(svg, "line.tbl-timeline-rule");

    it("draws two lanes as two vertical tracks named by lane labels, with no legend series rows", () => {
      const res = vert({ timeline: { lanes: true } });
      expect(rules(res.svg)).toHaveLength(2);
      for (const l of rules(res.svg)) expect(l.getAttribute("x1")).toBe(l.getAttribute("x2"));
      const names = q(res.svg, ".tbl-timeline-lane-label");
      expect(names.map((t) => [t.textContent, t.getAttribute("text-anchor")])).toEqual([["Policy", "end"], ["Cohort milestone", "start"]]);
      expect(res.legendItems).toBeNull(); // Ruling 26: the lane names label the categories
      expect(vert({ timeline: { lanes: true }, series_legend: true }).legendItems).toHaveLength(2);
    });

    it("styles a vertical lane name exactly as a horizontal one", () => {
      const attrs = (t: Element) => ["class", "font-size", "font-weight", "fill"].map((a) => t.getAttribute(a));
      const h = q(r({ timeline: { lanes: true } }).svg, ".tbl-timeline-lane-label")[0]!;
      const v = q(vert({ timeline: { lanes: true } }).svg, ".tbl-timeline-lane-label")[0]!;
      expect(attrs(v)).toEqual(attrs(h));
    });

    it("draws three or more lanes as one track, the legend naming the categories", () => {
      for (const vl of [undefined, "columns"] as const) {
        const res = vert({ series_order: ["policy", "cohort", "other"], timeline: { lanes: true, ...(vl ? { vertical_lanes: vl } : {}) } }, THREE);
        expect(rules(res.svg)).toHaveLength(1);
        expect(q(res.svg, ".tbl-timeline-lane-label")).toHaveLength(0);
        expect(res.legendItems).toHaveLength(3);
        // On by default only: series_legend: false and legend: false still remove them.
        expect(vert({ series_order: ["policy", "cohort", "other"], series_legend: false, timeline: { lanes: true } }, THREE).legendItems).toBeNull();
        expect(vert({ series_order: ["policy", "cohort", "other"], legend: false, timeline: { lanes: true } }, THREE).legendItems).toBeNull();
      }
    });

    it("draws two lanes as one track with vertical_lanes: single, legend rows on", () => {
      const res = vert({ timeline: { lanes: true, vertical_lanes: "single" } });
      expect(rules(res.svg)).toHaveLength(1);
      expect(q(res.svg, ".tbl-timeline-lane-label")).toHaveLength(0);
      expect(res.legendItems).toHaveLength(2);
      // Exactly the single-track chart of the same spec without lanes.
      expect(res.svg.outerHTML).toBe(vert({}).svg.outerHTML);
      // On by default only: series_legend: false and legend: false still remove them.
      expect(vert({ series_legend: false, timeline: { lanes: true, vertical_lanes: "single" } }).legendItems).toBeNull();
      expect(vert({ legend: false, timeline: { lanes: true, vertical_lanes: "single" } }).legendItems).toBeNull();
    });

    it("renders a lanes spec switched to vertical as lane columns too", () => {
      const res = renderChart({ ...SPEC, timeline: { lanes: true } } as ChartSpec, ROWS, { width: 400, timelineOrientation: "vertical" });
      expect(rules(res.svg)).toHaveLength(2);
      expect(q(res.svg, ".tbl-timeline-lane-label")).toHaveLength(2);
      expect(res.legendItems).toBeNull();
    });
  });

  it("fires afterRender last with the SVG it returns", () => {
    let seen: SVGSVGElement | null = null;
    const res = renderChart(SPEC, ROWS, { width: 900, hooks: { afterRender: (svg) => { seen = svg; } } });
    expect(seen).toBe(res.svg);
  });

  it("rings every point marker in a background halo painted behind it", () => {
    const { svg } = r();
    const markers = q(svg, "circle.tbl-timeline-marker");
    const halos = q(svg, "circle.tbl-timeline-marker-halo");
    expect(halos).toHaveLength(markers.length);
    for (const m of markers) {
      const h = halos.find((x) => x.getAttribute("cx") === m.getAttribute("cx") && x.getAttribute("cy") === m.getAttribute("cy"))!;
      expect(h).toBeDefined();
      expect(h.getAttribute("fill")).toBe(tokens.structural.background);
      expect(h.getAttribute("data-series")).toBe(m.getAttribute("data-series"));
      // Behind the marker, and 1.5px beyond its stroked edge.
      expect(h.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const edge = TL_GEOM.dotR + Number(m.getAttribute("stroke-width")) / 2;
      expect(Number(h.getAttribute("r"))).toBeCloseTo(edge + 1.5, 6);
      // The marker itself is unchanged.
      expect(m.getAttribute("r")).toBe(String(TL_GEOM.dotR));
    }
  });

  it("keeps a point on a same-colour span visible: its halo paints over the bar", () => {
    const rows = [
      { date: "2017", end: "2025", title: "Long law", detail: "", kind: "policy", projected: "" },
      { date: "2021", end: "", title: "Point on it", detail: "", kind: "policy", projected: "" },
      { date: "2030", end: "", title: "z", detail: "", kind: "cohort", projected: "" },
    ] as TidyRow[];
    for (const orientation of ["horizontal", "vertical"] as const) {
      const { svg } = renderChart(SPEC, rows, { width: 700, timelineOrientation: orientation });
      const bar = q(svg, "rect.tbl-timeline-span")[0]!;
      const marker = q(svg, "circle.tbl-timeline-marker")[0]!;
      const halo = q(svg, "circle.tbl-timeline-marker-halo")[0]!;
      expect(marker.getAttribute("fill")).toBe(bar.getAttribute("fill")); // same colour: the case at issue
      expect(bar.compareDocumentPosition(halo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(halo.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("paints a projected point above a same-date span listed after it in the CSV", () => {
    const rows = [
      { date: "2026", end: "", title: "Projected point", detail: "", kind: "policy", projected: "1" },
      { date: "2026", end: "2030", title: "Same-date span", detail: "", kind: "policy", projected: "" },
      { date: "2040", end: "", title: "z", detail: "", kind: "cohort", projected: "" },
    ] as TidyRow[];
    for (const orientation of ["horizontal", "vertical"] as const) {
      const { svg } = renderChart(SPEC, rows, { width: 700, timelineOrientation: orientation });
      const bar = q(svg, "rect.tbl-timeline-span")[0]!;
      const after = (x: Element) => Boolean(bar.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING);
      expect(after(q(svg, "circle.tbl-timeline-marker-halo")[0]!)).toBe(true);
      expect(after(q(svg, "circle.tbl-timeline-marker")[0]!)).toBe(true);
    }
  });

  it("paints in layers: stems, spans, markers, then the labelled list", () => {
    const { svg } = r();
    const layer = (cls: string) => svg.querySelector(`g.${cls}`)!;
    const order = ["tbl-timeline-stems", "tbl-timeline-spans", "tbl-timeline-markers"].map(layer);
    const list = svg.querySelector('g[role="list"]')!;
    const seq = [...order, list];
    for (let i = 1; i < seq.length; i++) {
      expect(seq[i - 1]!.compareDocumentPosition(seq[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    for (const g of order) expect(g.getAttribute("aria-hidden")).toBe("true");
    expect(q(layer("tbl-timeline-stems"), ".tbl-timeline-stem")).toHaveLength(q(svg, ".tbl-timeline-stem").length);
    expect(q(layer("tbl-timeline-spans"), ".tbl-timeline-span")).toHaveLength(2);
    expect(q(layer("tbl-timeline-markers"), ".tbl-timeline-marker")).toHaveLength(4);
    // Every halo paints before every marker, so no halo can clip a neighbouring dot.
    const markersG = q(layer("tbl-timeline-markers"), "circle").map((c) => c.getAttribute("class"));
    expect(markersG).toEqual([...Array(4).fill("tbl-timeline-marker-halo"), ...Array(4).fill("tbl-timeline-marker")]);
    // One listitem per event, each holding exactly that event's label.
    const items = q(list, 'g[role="listitem"]');
    expect(items).toHaveLength(6);
    for (const it of items) {
      expect([...it.children].map((c) => c.getAttribute("class"))).toEqual(["tbl-timeline-label"]);
    }
  });

  it("paints vertical leaders above spans and markers, still below the labels; horizontal stems stay beneath", () => {
    // Vertical leaders run beside the track and never cross label text, so they paint over the bars:
    // beneath, a left-side leader leaving an inner sub-track's bar would hide under the outer bars it
    // crosses.
    const layerSeq = (svg: SVGSVGElement): string[] =>
      [...svg.children].map((c) => c.getAttribute("class") ?? c.getAttribute("role") ?? c.tagName).filter((n) => n !== "defs" && n !== "tbl-timeline-chrome");
    const vertical = renderChart(SPEC, ROWS, { width: 360, timelineOrientation: "vertical" }).svg;
    expect(layerSeq(vertical)).toEqual(["tbl-timeline-spans", "tbl-timeline-markers", "tbl-timeline-stems", "list"]);
    expect(q(vertical, "g.tbl-timeline-stems .tbl-timeline-stem").length).toBeGreaterThan(0);
    expect(layerSeq(r().svg)).toEqual(["tbl-timeline-stems", "tbl-timeline-spans", "tbl-timeline-markers", "list"]);
  });

  it("draws each vertical label beside its item: bold date first, outer-sub-track spans on the left", () => {
    // "Overlap" runs inside the 2031-2035 phase-in, so it takes sub-track 1, left of the rule. The
    // 2030 label collides with 2026's on the right; the left would first be clear only below
    // Overlap's label, which a swap may never move (Ruling 34), a bigger push, so it stays right with
    // a leader. The 2031 phase-in, pushed on the right below that, is pushed less on the left, just
    // below Overlap's label (Ruling 38; Overlap's bar has ended there), so it goes left with a leader.
    const rows = [...ROWS, { date: "2032", end: "2034", title: "Overlap", detail: "", kind: "cohort", projected: "" }] as TidyRow[];
    const { svg } = renderChart(SPEC, rows, { width: 375, timelineOrientation: "vertical" });
    const rule = svg.querySelector("line.tbl-timeline-rule")!;
    const ruleX = Number(rule.getAttribute("x1"));
    expect(rule.getAttribute("x2")).toBe(rule.getAttribute("x1"));
    const bars = q(svg, "rect.tbl-timeline-span").map((s) => Number(s.getAttribute("x")));
    const items = q(svg, 'g[role="listitem"]');
    expect(items).toHaveLength(7);
    for (const item of items) {
      const texts = q(item, "text");
      expect(texts[0]!.getAttribute("font-weight")).toBe("700"); // the date line leads the block
      expect(texts[0]!.textContent!.length).toBeGreaterThan(0);
      const label = item.getAttribute("aria-label")!;
      const onLeft = label.includes("Overlap") || label.includes("Phase-in");
      for (const t of texts) {
        const x = Number(t.getAttribute("x"));
        if (onLeft) {
          expect(t.getAttribute("text-anchor")).toBe("end");
          expect(x).toBeLessThan(Math.min(...bars));
        } else {
          expect(t.getAttribute("text-anchor")).toBe("start");
          expect(x).toBeGreaterThan(ruleX + TL_GEOM.dotR);
        }
      }
    }
    // With nothing on the left (no outer sub-track, no collision to swap), the block is centred: the
    // blank beside the markers (past a 4px edge pad) equals the blank beyond the widest label, rather
    // than all of it sitting left of the rule (Rulings 29, 43).
    const spread = ROWS.filter((row) => ["2026", "2040", "2057", "2095"].includes(row.date as string));
    const plain = renderChart(SPEC, spread, { width: 375, timelineOrientation: "vertical" }).svg;
    const px = Number(plain.querySelector("line.tbl-timeline-rule")!.getAttribute("x1"));
    const right = Math.max(...q(plain, ".tbl-timeline-label text").map((t) =>
      Number(t.getAttribute("x")) + timelineTextWidth(t.textContent ?? "", Number(t.getAttribute("font-size")), t.getAttribute("font-weight") === "700" ? 700 : 500)));
    expect(px - TL_GEOM.dotR - 4).toBeCloseTo(375 - right - 4, 1);
    expect(px - TL_GEOM.dotR - 4).toBeGreaterThan(20);
  });

  it("drops the x-axis title with the ticks: drawn only when a render draws ticks", () => {
    const axis = { timeline: { axis: true }, x_axis_title: "Year" } as Partial<ChartSpec>;
    const wide = r(axis);
    expect(q(wide.svg, ".tbl-timeline-tick").length).toBeGreaterThanOrEqual(2);
    // Drawn at the weight the layout measured them at, not whatever the page (or none) supplies.
    for (const t of q(wide.svg, ".tbl-timeline-tick")) expect(t.getAttribute("font-weight")).toBe("500");
    expect(wide.xAxisTitle).toBe("Year");
    // Six overlapping spans whose date word ("Mid-to-late-September") is too wide on both sides at 280 to
    // leave a tick column any room beside the floors (amendment A8, Ruling 28): no ticks, no title.
    const months = Array.from({ length: 6 }, (_, i) => ({
      date: `2026-0${i + 1}-01`, end: "2030", title: `Event ${i} title`, detail: "", kind: "policy", projected: "",
      dl: "Mid-to-late-September 30, 2026",
    })) as TidyRow[];
    const narrow = renderChart(
      { ...SPEC, ...axis, columns: { ...SPEC.columns, date_label: "dl" } } as ChartSpec, months,
      { width: 280, timelineOrientation: "vertical" },
    );
    expect(q(narrow.svg, ".tbl-timeline-tick")).toHaveLength(0);
    expect(narrow.xAxisTitle).toBeNull();
    // One distinct date: no scale, so no ticks and no title either.
    const one = r(axis, 900, [ROWS[0]!] as TidyRow[]);
    expect(q(one.svg, ".tbl-timeline-tick")).toHaveLength(0);
    expect(one.xAxisTitle).toBeNull();
  });

  it("uses series_order as an inclusion filter: an unlisted category is not drawn at all", () => {
    const res = r({ series_order: ["policy"], series_legend: true });
    const cohort = ROWS.filter((x) => x.kind === "cohort").map((x) => x.title as string);
    expect(q(res.svg, '[data-series="cohort"]')).toHaveLength(0);
    expect(q(res.svg, 'g[role="listitem"]')).toHaveLength(ROWS.length - cohort.length);
    expect(res.svg.querySelector('g[role="list"]')!.getAttribute("aria-label")).toBe(`Timeline, ${ROWS.length - cohort.length} events`);
    for (const title of cohort) expect(res.svg.textContent).not.toContain(title);
    expect(res.legendItems!.map((i) => i.series)).toEqual(["policy"]);
  });

  it("draws the description as visible text in the event's label, not only in its aria-label", () => {
    const item = q(r().svg, 'g[role="listitem"]').find((g) => g.getAttribute("aria-label")!.startsWith("2030:"))!;
    const muted = q(item, "g.tbl-timeline-label text").filter((t) => t.getAttribute("font-size") === "11");
    expect(muted.map((t) => t.textContent).join(" ")).toBe("Under fully phased-in policy");
    for (const t of muted) expect(t.getAttribute("fill")).toBe(TBL.color.muted);
  });

  it("keeps an all-emoji title inside a 280px horizontal frame at Chromium's 1.37em advance (Ruling 48)", () => {
    // 23 consecutive 😀 with no break opportunity: hardBreak splits the line at the frame, so each
    // piece must be measured at least as wide as Chromium draws it (1.37em) to stay inside.
    const emoji = "😀".repeat(23);
    const rows = [{ date: "2026", end: "", title: emoji, detail: "", kind: "policy", projected: "" }] as TidyRow[];
    const { svg } = r({ timeline: { auto_vertical: false } }, 280, rows);
    const W = Number(svg.getAttribute("width"));
    expect(W).toBe(280);
    const texts = q(svg, ".tbl-timeline-label text");
    expect(texts.map((t) => t.textContent).join("")).toContain(emoji);
    for (const t of texts) {
      const size = Number(t.getAttribute("font-size"));
      const weight = Number(t.getAttribute("font-weight")) as 500 | 700;
      const w = [...t.textContent!].reduce((s, ch) => s + (ch.codePointAt(0)! > 0xffff ? 1.37 * size : timelineTextWidth(ch, size, weight)), 0);
      const x = Number(t.getAttribute("x"));
      const anchor = t.getAttribute("text-anchor");
      const x0 = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
      expect(x0, t.textContent!).toBeGreaterThanOrEqual(0);
      expect(x0 + w, t.textContent!).toBeLessThanOrEqual(W);
    }
  });

  it("never splits an emoji's surrogate pair when a date word is broken to keep its dash", () => {
    // A 15-emoji date_label ending " –" is wider than the 280px frame, so hardBreakDate splits it
    // and moves the last character down with the dash: that must be the last code point, not half
    // of one.
    const dl = `${"😀".repeat(15)} –`;
    const rows = [{ date: "2026", end: "", title: "t", detail: "", kind: "policy", projected: "", dl }] as TidyRow[];
    const spec = { timeline: { auto_vertical: false }, columns: { ...SPEC.columns, date_label: "dl" } } as Partial<ChartSpec>;
    const { svg } = r(spec, 280, rows);
    const dates = q(svg, ".tbl-timeline-label text").filter((t) => t.getAttribute("font-weight") === "700").map((t) => t.textContent!);
    expect(dates.length).toBeGreaterThan(1); // the word really was broken
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    for (const d of dates) expect(lone.test(d), JSON.stringify(d)).toBe(false);
    expect(dates.join("").replace(/\s/g, "")).toBe(dl.replace(/\s/g, ""));
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
  it("switches on width alone at the 480px boundary", () => {
    expect(resolveTimelineOrientation(SPEC, ROWS, 479)).toBe("vertical");
    expect(resolveTimelineOrientation(SPEC, ROWS, 480)).toBe("horizontal");
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
  it("warns when an explicit vertical_lanes: columns meets three or more lanes (Ruling 25)", () => {
    const three = [...ROWS, { date: "2070", end: "", title: "Third", detail: "", kind: "other", projected: "" }] as TidyRow[];
    // Authored vertical, where the setting takes effect (and no horizontal overflow check runs).
    const lanes = (t: Record<string, unknown>) => ({ ...SPEC, orientation: "vertical", series_order: undefined, timeline: { lanes: true, ...t } }) as ChartSpec;
    const w = timelineWarnings(lanes({ vertical_lanes: "columns" }), three, 920);
    expect(w).toEqual([
      `timeline.vertical_lanes "columns" draws lane columns only for exactly two lanes; with 3 lanes a vertical render draws one track`,
    ]);
    // Not when the value is the default, or with two lanes, or without lanes.
    expect(timelineWarnings(lanes({}), three, 920)).toEqual([]);
    expect(timelineWarnings(lanes({ vertical_lanes: "columns" }), ROWS, 920)).toEqual([]);
    expect(timelineWarnings({ ...SPEC, orientation: "vertical", series_order: undefined, timeline: { vertical_lanes: "columns" } } as ChartSpec, three, 920)).toEqual([]);
  });
  it("does not warn about horizontal overflow for an authored vertical", () => {
    const w = timelineWarnings({ ...SPEC, orientation: "vertical" } as ChartSpec, many, 920);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/21 events/);
  });
});
