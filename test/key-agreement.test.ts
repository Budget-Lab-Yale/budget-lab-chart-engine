// @vitest-environment jsdom
//
// THE GATE. For every chart type: mount it, hover it, and assert the tooltip key is the same drawing
// as the legend key.
//
// Five escapes reached the user before this existed, and every one of them passed a unit test. The
// pattern was identical each time: the emitter was correct, and a call site threw its argument away.
// `attachBandCrosshair` and `attachHistogramHover` both DECLARED an `icons` option, were both PASSED
// one, and both dropped it on the floor — so a unit test on the builder proved nothing about what a
// reader saw. Only a mounted chart can catch that, so this drives the real path end to end.
//
// It asserts on the DRAWING, never on class names or markup, so it survives restyling and fails only
// when the surfaces genuinely diverge.
//
// AND it compares both keys against THE MARK ITSELF. Comparing the two keys to each other is not
// enough and I proved it: reintroducing a resolver bug (`point` dropping `hollow`) left both keys
// agreeing, because both read the same resolver — they agreed on the wrong thing and the gate passed.
// A key's job is to match the MARK, so the mark is the reference.
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import { renderLegend } from "../src/engine/legend";
import { resolveTooltipIcons, iconSvgMarkup, iconShapes, ICON_GROUP_CLASS, type IconSpec } from "../src/engine/icon";
import { buildExportSvg } from "../src/embed/export-png";
import { mountChart } from "../src/engine/render-live";
import { defaultHatchStroke } from "../src/engine/hatch";
import { FILLED_CHART_TYPES } from "../src/spec/filled-chart-types";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const OPTS = { width: 720, height: 400, document };

/** One spelling for "paints nothing here", so an unset fill and an explicit `none` compare equal. A
 *  hollow icon's centre IS `none` — the hole has to take the ground it sits on, since a key sits on a
 *  card, on a translucent tooltip and on an exported frame. */
const paint = (v: string | undefined) => (!v || v === "none" ? "" : v);

/** A shape's identity, ignoring where it sits: the primitive kinds and the colours they paint. */
const fingerprint = (icon: IconSpec) =>
  iconShapes(icon)
    .map((s) => `${s.kind}:${paint("fill" in s ? s.fill : "")}:${paint("stroke" in s ? s.stroke : "")}`)
    .join("|");

/** The same, read back out of rendered SVG — so it compares what was DRAWN, not what was intended. */
function drawnFingerprint(svg: Element): string {
  return [...svg.querySelectorAll("rect, line, circle, path")]
    .map((el) => {
      const style = el.getAttribute("style") ?? "";
      const fill = /fill:\s*([^;]+)/.exec(style)?.[1];
      const stroke = /stroke:\s*([^;]+)/.exec(style)?.[1];
      return `${el.tagName.toLowerCase()}:${paint(fill)}:${paint(stroke)}`;
    })
    .join("|");
}

const ROWS_CAT: TidyRow[] = [
  { time: "A", series: "one", value: "6" },
  { time: "A", series: "two", value: "4" },
  { time: "B", series: "one", value: "3" },
  { time: "B", series: "two", value: "7" },
] as unknown as TidyRow[];

const ROWS_NUM: TidyRow[] = [
  { time: "2020", series: "one", value: "6" },
  { time: "2021", series: "one", value: "4" },
  { time: "2020", series: "two", value: "3" },
  { time: "2021", series: "two", value: "7" },
] as unknown as TidyRow[];

const COLORS = { one: "blue", two: "amber-300" };

/** Every chart type that draws a legend, with the channels that made a key diverge in the past. */
const CHARTS: Array<{ name: string; spec: Record<string, unknown>; rows: TidyRow[] }> = [
  {
    name: "line",
    spec: { chartType: "line", xAxisType: "numeric", series_colors: COLORS },
    rows: ROWS_NUM,
  },
  {
    name: "line with point markers",
    spec: { chartType: "line", xAxisType: "numeric", points: true, series_colors: COLORS },
    rows: ROWS_NUM,
  },
  {
    name: "line, one series dashed",
    spec: {
      chartType: "line",
      xAxisType: "numeric",
      series_colors: COLORS,
      series_styles: { two: { dashed: true } },
    },
    rows: ROWS_NUM,
  },
  {
    name: "categorical-x line with markers",
    spec: { chartType: "line", xAxisType: "categorical", points: true, series_colors: COLORS },
    rows: ROWS_CAT,
  },
  {
    name: "area",
    spec: { chartType: "area", xAxisType: "numeric", series_colors: COLORS },
    rows: ROWS_NUM,
  },
  {
    name: "area, one series textured",
    spec: {
      chartType: "area",
      xAxisType: "numeric",
      series_colors: COLORS,
      series_patterns: { two: "/" },
    },
    rows: ROWS_NUM,
  },
  {
    name: "grouped bar",
    spec: { chartType: "bar", xAxisType: "categorical", series_colors: COLORS },
    rows: ROWS_CAT,
  },
  {
    name: "stacked, textured + gapped",
    spec: {
      chartType: "stacked",
      xAxisType: "categorical",
      series_colors: COLORS,
      series_patterns: { two: "x" },
      barStack: { segmentGap: 1, netDisplay: "none" },
    },
    rows: ROWS_CAT,
  },
  {
    name: "diverging stacked (Total dot)",
    spec: {
      chartType: "stacked",
      xAxisType: "categorical",
      series_colors: COLORS,
      barStack: { netDisplay: "dot" },
    },
    rows: [
      { time: "A", series: "one", value: "6" },
      { time: "A", series: "two", value: "-4" },
      { time: "B", series: "one", value: "3" },
      { time: "B", series: "two", value: "-2" },
    ] as unknown as TidyRow[],
  },
  {
    name: "dumbbell with a hollow end",
    spec: {
      chartType: "dumbbell",
      xAxisType: "categorical",
      orientation: "horizontal",
      series_colors: COLORS,
      series_marker: { two: "hollow" },
    },
    rows: ROWS_CAT,
  },
  {
    name: "multi-series histogram, one textured",
    spec: {
      chartType: "histogram",
      xAxisType: "numeric",
      histogram: { bins: 5 },
      series_colors: COLORS,
      series_patterns: { two: "-" },
    },
    rows: Array.from({ length: 40 }, (_, i) => ({
      time: String(i),
      series: i % 2 ? "one" : "two",
      value: String((i * 7) % 13),
    })) as unknown as TidyRow[],
  },
  {
    // Redundant colour+shape: each series gets its own SYMBOL, which is the case where a key can name
    // a shape the chart does not draw. The ink tests below cannot see that — same colour, wrong shape.
    name: "scatter, shape redundant with series",
    spec: {
      chartType: "scatter",
      xAxisType: "numeric",
      series_colors: COLORS,
      columns: { x: "time", value: "value", series: "series", shape: "series" },
    },
    rows: ROWS_NUM,
  },
];

const specOf = (s: Record<string, unknown>) =>
  ({ title: "t", columns: { x: "time", value: "value", series: "series" }, ...s }) as unknown as ChartSpec;

describe("a tooltip key is the same drawing as its legend key", () => {
  for (const { name, spec, rows } of CHARTS) {
    it(name, () => {
      const r = renderChart(specOf(spec), rows, OPTS);
      expect(r.legendItems, `${name} produced no legend`).toBeTruthy();

      // The map the live layer hands every tooltip on this chart.
      const icons = resolveTooltipIcons({ legendItems: r.legendItems, keyRows: r.seriesKeyRows });

      const parent = document.createElement("div");
      renderLegend(parent, r.legendItems!);

      for (const item of r.legendItems!.filter((i) => !i.annotation)) {
        const icon = icons.get(item.series);
        expect(icon, `${name}: no icon resolved for "${item.series}"`).toBeTruthy();

        // 1. What the LEGEND drew, read back from the DOM.
        const sel = item.nonInteractive
          ? ".tbl-legend-item .tbl-legend-swatch svg"
          : `[data-series="${item.series}"] .tbl-legend-swatch svg`;
        const legendSvg = [...parent.querySelectorAll(sel)].pop();
        expect(legendSvg, `${name}: "${item.series}" has no legend drawing`).toBeTruthy();

        // 2. What a TOOLTIP would draw for the same series.
        const tipSvg = new DOMParser()
          .parseFromString(iconSvgMarkup(icon!), "text/html")
          .querySelector("svg")!;

        expect(drawnFingerprint(tipSvg), `${name}: "${item.series}" key differs`).toBe(
          drawnFingerprint(legendSvg!),
        );
        // And both match the resolved intent, so neither drifted together in the same wrong direction.
        expect(drawnFingerprint(tipSvg), `${name}: "${item.series}" drifted from its IconSpec`).toBe(
          fingerprint(icon!),
        );
      }
    });
  }

  it("resolves an icon for every series a tooltip can show, on every chart type", () => {
    // The failure mode this catches: a chart whose series never reach the resolver at all, so a
    // tooltip silently falls back to the legacy channels and can disagree again.
    for (const { name, spec, rows } of CHARTS) {
      const r = renderChart(specOf(spec), rows, OPTS);
      const icons = resolveTooltipIcons({ legendItems: r.legendItems, keyRows: r.seriesKeyRows });
      for (const s of r.seriesOrder) {
        expect(icons.has(s), `${name}: series "${s}" has no resolved icon`).toBe(true);
      }
    }
  });
});

describe("the exported key is the same drawing as the on-screen key", () => {
  // The export drew its own legend, nine branches deep, and disagreed with the screen in seven ways
  // at once — a `rect` rounded like a chip, a `dot` with no branch at all (the stacked Total came out
  // a navy bar), a hollow dumbbell end exported filled, a dashed series with points exported without
  // its marker, every symbol at one area. A downloaded PNG is what leaves the building, so it is the
  // copy that most needs to agree; and nothing on the live path can catch this.
  for (const { name, spec, rows } of CHARTS) {
    it(name, () => {
      const resolved = specOf(spec);
      const r = renderChart(resolved, rows, OPTS);
      const parent = document.createElement("div");
      renderLegend(parent, r.legendItems!);
      const onScreen = [...parent.querySelectorAll(".tbl-legend-swatch svg")].map(drawnFingerprint);

      const exported = [...buildExportSvg(resolved, rows).querySelectorAll(`g.${ICON_GROUP_CLASS}`)]
        .map(drawnFingerprint);

      expect(exported.length, `${name}: exported ${exported.length} keys, screen drew ${onScreen.length}`)
        .toBe(onScreen.length);
      expect(exported).toEqual(onScreen);
    });
  }
});

describe("a key matches the mark it names", () => {
  /** The colours a mark is actually painted: its own, else inherited from an ancestor. */
  function markColours(svg: SVGSVGElement, series: string): { fill: string; stroke: string } | null {
    const el = svg.querySelector<SVGElement>(`[data-series="${series}"]`);
    if (!el) return null;
    const up = (attr: string) => {
      for (let n: Element | null = el; n && n !== svg.parentElement; n = n.parentElement) {
        const v =
          new RegExp(`(?:^|;)\s*${attr}:\s*([^;]+)`).exec(n.getAttribute("style") ?? "")?.[1] ??
          n.getAttribute(attr);
        if (v && v !== "none") return v.trim().toLowerCase();
      }
      return "";
    };
    // Plot may leave a stroke as `currentColor` and carry the hue in an ancestor's `color`.
    const deref = (v: string) => (v === "currentcolor" ? up("color") : v);
    return { fill: deref(up("fill")), stroke: deref(up("stroke")) };
  }

  /** The GROUND of a shape, never its meaning: white in the forms the engine spells it, and `none`.
   *
   *  `none` belongs here for the same reason white does, and this is a WIDENING of the vocabulary, not
   *  a loosening of the test: the ink role still has to match, and a hole is not ink. A MARK paints its
   *  hole white because it must occlude the stem or the bar behind it; a KEY leaves it empty because it
   *  has to take the card, the translucent tooltip or the exported frame it sits on. Both are ground,
   *  so both must resolve to the same role — otherwise this gate would report a ring as a filled dot. */
  const isGround = (c: string) =>
    c === "" || c === "none" || c === "#ffffff" || c === "#fff" || c === "white";

  /** Which ROLE carries a shape's meaning: `fill` for a filled mark, `stroke` for a ring or a line.
   *
   *  The role is the whole test. Comparing colour SETS is not enough and I proved it twice: the bug
   *  this catches swaps fill and stroke, so a ring painted white-on-colour and a disc painted
   *  colour-on-white contain the SAME two colours and a set cannot tell them apart. */
  const inkRole = (fill: string, stroke: string): { role: "fill" | "stroke"; color: string } | null => {
    if (!isGround(fill)) return { role: "fill", color: fill };
    if (!isGround(stroke)) return { role: "stroke", color: stroke };
    return null;
  };

  /** Every ink role a key paints. A key may carry more than one legitimately — a line chart with
   *  point markers keys a stroked line AND a filled marker — so the mark's role must be among them,
   *  not equal to a single chosen one. */
  function keyInks(icon: IconSpec): string[] {
    const out: string[] = [];
    for (const s of iconShapes(icon)) {
      const fill = "fill" in s ? s.fill.toLowerCase() : "";
      const stroke = "stroke" in s ? (s.stroke ?? "").toLowerCase() : "";
      const ink = inkRole(fill, stroke);
      if (ink) out.push(`${ink.role}:${ink.color}`);
    }
    return out;
  }

  for (const { name, spec, rows } of CHARTS) {
    it(name, () => {
      const r = renderChart(specOf(spec), rows, OPTS);
      const icons = resolveTooltipIcons({ legendItems: r.legendItems, keyRows: r.seriesKeyRows });

      // Legend rows, NOT seriesOrder: the stacked Total is a pseudo-series that exists only in the
      // legend, so iterating seriesOrder skipped the very row whose key had regressed.
      const keyed = (r.legendItems ?? []).filter((i) => !i.annotation).map((i) => i.series);
      for (const series of new Set([...r.seriesOrder, ...keyed])) {
        const mark = markColours(r.svg, series);
        if (!mark) continue; // some series draw no tagged element
        if (mark.fill.startsWith("url(")) continue; // textured: keyed by the glyph, checked above

        const markInk = inkRole(mark.fill, mark.stroke);
        if (!markInk) continue; // nothing coloured to compare
        const icon = icons.get(series);
        if (!icon) continue; // covered by the resolver-coverage test above
        const inks = keyInks(icon);
        expect(
          inks.includes(`${markInk.role}:${markInk.color}`),
          `${name}: "${series}" is painted ${markInk.color} as its ${markInk.role} on the chart, ` +
            `but its key paints ${inks.join(", ") || "nothing"}`,
        ).toBe(true);

        // AND, for an OUTLINED mark, what fills its middle.
        //
        // The role test above cannot see this and I proved it by shipping the bug: it counts white and
        // `none` as one thing ("ground"), so a mark painting an opaque white disc and a key leaving a
        // hole agree on the role and differ on the page. The stacked net marker is a white disc BY
        // DESIGN — it has to occlude the stack it sits on — while a dumbbell's hollow end is a hole
        // that shows the stem. Both are "a coloured ring around ground", and only the middle tells
        // them apart, so the middle is compared on its own.
        if (markInk.role !== "stroke") continue;
        const middles = iconShapes(icon)
          .filter((s) => ("stroke" in s ? paint(s.stroke) : "") === markInk.color)
          .map((s) => ("fill" in s ? paint(s.fill).toLowerCase() : ""));
        if (!middles.length) continue; // no outlined shape in the key; the role test covered it
        expect(
          middles,
          `${name}: "${series}" is outlined on the chart with ${paint(mark.fill) || "a HOLE"} in the ` +
            `middle, but its key has ${middles.map((m) => m || "a HOLE").join(", ")}`,
        ).toContain(paint(mark.fill).toLowerCase());
      }
    });
  }

  /** A path's command letters, which identify a SHAPE independently of the size it is drawn at: a
   *  circle carries arcs, a triangle three lines, a star ten. Numbers are stripped first so the
   *  exponent in `1e-7` cannot masquerade as a command. */
  const shapeSig = (d: string) =>
    d.replace(/[-+]?[\d.]+(?:e[-+]?\d+)?/gi, "").replace(/[\s,]/g, "");

  for (const { name, spec, rows } of CHARTS) {
    it(`${name} — the key draws the same SHAPE as the mark`, () => {
      // The ink tests above compare colour and role, so they pass a key that draws a square over a
      // triangle. On a point chart each series carries its own symbol, which makes that a real
      // possibility rather than a hypothetical, and the shape is the whole content of that channel.
      const r = renderChart(specOf(spec), rows, OPTS);
      const icons = resolveTooltipIcons({ legendItems: r.legendItems, keyRows: r.seriesKeyRows });
      let compared = 0;
      for (const series of r.seriesOrder) {
        // Only DOT marks: a line chart's `[data-series]` is the line itself, and comparing a rule to
        // a marker would be comparing two different things.
        const mark = r.svg.querySelector(`g[aria-label="dot"] [data-series="${series}"]`);
        if (!mark) continue;
        const icon = icons.get(series);
        const keyPath = icon && iconShapes(icon).find((s) => s.kind === "path");
        if (!keyPath || keyPath.kind !== "path") continue;
        compared++;
        if (mark.tagName.toLowerCase() === "circle") {
          // Plot draws a plain dot as <circle>; the key draws a circle as an arc path.
          expect(shapeSig(keyPath.d), `${name}: "${series}" is a round dot, key is not`).toContain("A");
          continue;
        }
        expect(
          shapeSig(keyPath.d),
          `${name}: "${series}" is drawn as one shape on the chart and another in its key`,
        ).toBe(shapeSig(mark.getAttribute("d") ?? ""));
      }
      if (name.startsWith("scatter") || name.startsWith("dumbbell") || name.includes("markers")) {
        expect(compared, `${name}: no dot marks were compared, so this proved nothing`).toBeGreaterThan(0);
      }
    });
  }
});

describe("a chart with NO legend still keys its tooltip", () => {
  // The case the whole consolidation turns on. A lone series draws no legend on ANY chart type
  // (measured: line, area, bar, stacked, histogram, waterfall, dumbbell, dotplot and scatter all
  // return null legendItems at one series) — yet every one of them still shows tooltips. Those rows
  // used to key from a second mechanism: loose `swatchShape` / `hatches` / `swatchMarkers` /
  // `dashedSeries` channels synthesised inside the tooltip builder, reachable ONLY here, and a
  // partial copy of the legend's rules that drifted from them. `seriesKeyRows` closes it: the key is
  // the row the legend WOULD have drawn, so there is one mechanism and no second copy to drift.
  const HATCHED_HIST = {
    chartType: "histogram",
    title: "t",
    xAxisType: "numeric",
    histogram: { bins: 4, domain: [0, 20] },
    columns: { x: "amount", series: "group" },
    data: "inline",
    series_colors: { A: "#58A3E7" },
    series_patterns: { A: "/" },
  } as unknown as ChartSpec;
  const HIST_ROWS = Array.from({ length: 8 }, (_, i) => ({
    amount: String(i),
    group: "A",
  })) as unknown as TidyRow[];

  /** jsdom has no layout, so the crosshair's `getBoundingClientRect` guard would bail out before it
   *  ever builds a tooltip. Map client coords 1:1 onto the viewBox. */
  function mock1to1(svg: SVGSVGElement): void {
    const vb = svg.viewBox.baseVal;
    Object.defineProperty(svg, "getBoundingClientRect", {
      value: () => ({
        width: vb.width, height: vb.height, top: 0, left: 0,
        right: vb.width, bottom: vb.height, x: 0, y: 0,
      }),
      configurable: true,
    });
  }

  it("a legend-less textured histogram keys with a square and the mark's OWN texture", () => {
    expect(renderChart(HATCHED_HIST, HIST_ROWS, OPTS).legendItems).toBeNull();

    const container = document.createElement("div");
    mountChart(container, { spec: HATCHED_HIST, rows: HIST_ROWS, width: 640, height: 360 });
    document.body.appendChild(container);
    const svg = container.querySelector<SVGSVGElement>(".figure-canvas svg")!;
    mock1to1(svg);

    const bin = svg.querySelector<SVGRectElement>('g[aria-label="rect"] rect')!;
    const cx = parseFloat(bin.getAttribute("x")!) + parseFloat(bin.getAttribute("width")!) / 2;
    svg
      .querySelector(".tbl-hist-hover-hit")!
      .dispatchEvent(new PointerEvent("pointermove", { clientX: cx, clientY: 100, bubbles: true }));

    const key = document.querySelector(".tbl-tooltip .tbl-tooltip-swatch svg");
    // An EMPTY swatch span is what an unresolved series draws — the box is kept so the label does
    // not hang left, which makes the regression silent unless it is asserted here.
    expect(key, "the tooltip drew an empty key box: no icon resolved for this legend-less series")
      .not.toBeNull();
    // SHAPE: a histogram's marks are filled bins, so its key is a square ground — never the 18x3
    // line swatch the synthesised default fell back to.
    const ground = key!.querySelector("rect")!;
    expect(ground.getAttribute("style")).toContain("fill:#58A3E7");

    // TEXTURE: the glyph's bands, in the band colour derived from that ground.
    const bands = [...key!.querySelectorAll("rect, line, path")].slice(1);
    expect(bands.length).toBeGreaterThan(0);
    expect(bands.map((b) => b.getAttribute("style")).join(" ")).toContain(defaultHatchStroke("#58A3E7"));

    // AND it is the SAME texture the bin is painted with, not merely a texture — the key's resolved
    // hatch id is the id of the <pattern> filling the mark under the cursor.
    const icons = resolveTooltipIcons({ legendItems: null, keyRows: renderChart(HATCHED_HIST, HIST_ROWS, OPTS).seriesKeyRows });
    expect(bin.getAttribute("style")).toContain(icons.get("A")!.hatch!.id);

    document.body.removeChild(container);
  });

  /** Every chart type, rendered with ONE series so no legend is drawn. */
  const LONE: Array<{ name: string; spec: Record<string, unknown>; rows: TidyRow[] }> = [
    { name: "line", spec: { chartType: "line", xAxisType: "numeric" }, rows: ROWS_NUM },
    { name: "categorical line", spec: { chartType: "line", xAxisType: "categorical" }, rows: ROWS_CAT },
    { name: "area", spec: { chartType: "area", xAxisType: "numeric" }, rows: ROWS_NUM },
    { name: "bar", spec: { chartType: "bar", xAxisType: "categorical" }, rows: ROWS_CAT },
    { name: "stacked", spec: { chartType: "stacked", xAxisType: "categorical" }, rows: ROWS_CAT },
    { name: "waterfall", spec: { chartType: "waterfall", xAxisType: "categorical" }, rows: ROWS_CAT },
    { name: "dumbbell", spec: { chartType: "dumbbell", xAxisType: "categorical" }, rows: ROWS_CAT },
    { name: "dotplot", spec: { chartType: "dotplot", xAxisType: "categorical" }, rows: ROWS_CAT },
    { name: "scatter", spec: { chartType: "scatter", xAxisType: "numeric" }, rows: ROWS_NUM },
    {
      name: "histogram",
      spec: { chartType: "histogram", xAxisType: "numeric", histogram: { bins: 4 } },
      rows: Array.from({ length: 20 }, (_, i) => ({
        time: String(i), series: "one", value: String((i * 7) % 13),
      })) as unknown as TidyRow[],
    },
  ];

  for (const { name, spec, rows } of LONE) {
    it(`${name}: one series, no legend, still one resolved icon of the right shape`, () => {
      const lone = rows.filter((r) => (r as unknown as { series: string }).series === "one");
      const r = renderChart(specOf(spec), lone, OPTS);
      expect(r.legendItems, `${name}: expected no legend at one series`).toBeNull();

      const icons = resolveTooltipIcons({ legendItems: r.legendItems, keyRows: r.seriesKeyRows });
      const icon = icons.get("one");
      expect(icon, `${name}: a lone series resolved no icon, so its tooltip would key an empty box`)
        .toBeTruthy();

      // Pinned against the filled-type set rather than a literal list: a new filled chart type that
      // forgot to key with a chip would otherwise lose its square here and nowhere else.
      if (FILLED_CHART_TYPES.has(spec.chartType as string)) {
        expect(icon!.shape, `${name}: a filled mark must key with a square`).toBe("rect");
      } else {
        expect(icon!.shape, `${name}: a stroked/point mark must not key with a square`).not.toBe("rect");
      }
    });
  }
});
