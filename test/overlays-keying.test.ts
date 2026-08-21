// @vitest-environment jsdom
//
// How an overlay is identified to the reader: an in-frame label at the line, or a legend row. Never
// both — `legend: true` MOVES the label, the convention annotations.yAxis follows — and never
// NEITHER, which is what would happen if the label were stripped on a chart whose legend is off.
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import { buildExportSvg } from "../src/embed/export-png";
import { OVERLAY_LABEL_CLASS, OVERLAY_LINE_CLASS, OVERLAY_BAND_CLASS } from "../src/engine/marks/overlay";
import { annotationKey } from "../src/engine/annotation-legend";
import { renderLegend } from "../src/engine/legend";
import { ICON_GROUP_CLASS } from "../src/engine/icon";
import { TBL } from "../src/engine/theme";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const BASE = {
  chartType: "scatter",
  title: "t",
  xAxisType: "numeric",
  data: "data.csv",
  columns: { x: "time", value: "value", series: "series" },
} as unknown as ChartSpec;

const ROWS: TidyRow[] = [
  { time: "1", value: "1", series: "A" },
  { time: "2", value: "3", series: "A" },
  { time: "3", value: "2", series: "A" },
] as unknown as TidyRow[];

const OPTS = { width: 720, height: 400, document };

const labelTexts = (svg: SVGSVGElement) =>
  Array.from(svg.querySelectorAll(`g.${OVERLAY_LABEL_CLASS} text`)).map((t) => t.textContent);

function spec(overlays: unknown[], patch: Record<string, unknown> = {}): ChartSpec {
  return { ...BASE, ...patch, overlays } as ChartSpec;
}

describe("overlays — in-frame label", () => {
  it("draws no label when none is given", () => {
    expect(labelTexts(renderChart(spec([{ method: "lm" }]), ROWS, OPTS).svg)).toEqual([]);
  });

  it("draws the label at the line", () => {
    expect(labelTexts(renderChart(spec([{ method: "lm", label: "Linear fit" }]), ROWS, OPTS).svg)).toEqual([
      "Linear fit",
    ]);
  });

  it("colours the label to match its line", () => {
    const { svg } = renderChart(spec([{ slope: 1, intercept: 0, label: "45 degrees" }]), ROWS, OPTS);
    // Plot hoists a CONSTANT fill onto the wrapping <g aria-label="text">, not each <text> — the
    // same behavior band-crosshair.test.ts and shading-render.test.ts already assert against for
    // other Plot-generated marks, so the fill is read off the group, not the leaf.
    expect(svg.querySelector(`g.${OVERLAY_LABEL_CLASS}`)!.getAttribute("fill")).toBe(
      TBL.color.annotationDim,
    );
  });

  it("is NOT clipped — a half-cut label reads worse than one past the axis", () => {
    const { svg } = renderChart(spec([{ method: "lm", label: "Linear fit" }]), ROWS, OPTS);
    const g = svg.querySelector(`g.${OVERLAY_LABEL_CLASS}`)!;
    expect(g.getAttribute("clip-path")).toBeNull();
  });

  it("reaches the export path", () => {
    expect(labelTexts(buildExportSvg(spec([{ method: "lm", label: "Linear fit" }]), ROWS))).toEqual([
      "Linear fit",
    ]);
  });
});

describe("overlays — legend row", () => {
  it("emits a line-swatch row and draws nothing in-frame", () => {
    const s = spec([{ fun: "2*x", label: "Fitted line (prelim slope)", legend: true }]);
    const { svg, legendItems } = renderChart(s, ROWS, OPTS);
    expect(labelTexts(svg)).toEqual([]);
    const row = (legendItems ?? []).find((i) => i.label === "Fitted line (prelim slope)");
    expect(row).toBeTruthy();
    expect(row!.markerShape).toBe("line");
    expect(row!.annotation).toBe(true);
  });

  it("keys a dashed overlay with a dashed swatch and a solid one with a solid swatch", () => {
    const dashed = renderChart(spec([{ fun: "x", label: "Asserted", legend: true }]), ROWS, OPTS);
    const solid = renderChart(spec([{ method: "lm", label: "Fitted", legend: true }]), ROWS, OPTS);
    expect((dashed.legendItems ?? []).find((i) => i.label === "Asserted")!.dashed).toBe(true);
    expect((solid.legendItems ?? []).find((i) => i.label === "Fitted")!.dashed).toBe(false);
  });

  it("gives a per-series fit ONE neutral row for the concept, not one per series", () => {
    const two = [
      ...ROWS,
      { time: "1", value: "10", series: "B" },
      { time: "2", value: "12", series: "B" },
    ] as unknown as TidyRow[];
    const { legendItems } = renderChart(
      spec([{ method: "lm", label: "Linear fit", legend: true }]),
      two,
      OPTS,
    );
    const rows = (legendItems ?? []).filter((i) => i.label === "Linear fit");
    expect(rows.length).toBe(1);
    expect(rows[0]!.color).toBe(TBL.color.annotationDim);
  });

  it("reaches the export path's composed legend", () => {
    const svg = buildExportSvg(spec([{ fun: "x", label: "Asserted", legend: true }]), ROWS);
    const texts = Array.from(svg.querySelectorAll("text")).map((t) => t.textContent ?? "");
    expect(texts).toContain("Asserted");
  });
});

describe("overlays — annotation key on the DOM path", () => {
  it("tags only the keyed overlay's path with data-annotation, and not its unkeyed neighbour", () => {
    // The neighbour is the point: annotationOrder is a hand-aligned parallel array to
    // combinedSeriesOrder (marks/overlay.ts), so an off-by-one there would tag the WRONG path — a
    // single-overlay test can't distinguish that from tagging none or tagging the right one by luck.
    const s = spec([
      { slope: 2, intercept: 0, label: "Unkeyed asserted" },
      { fun: "x", label: "Keyed asserted", legend: true },
    ]);
    const { svg } = renderChart(s, ROWS, OPTS);
    const tagged = Array.from(
      svg.querySelectorAll<SVGPathElement>(`g.${OVERLAY_LINE_CLASS} path[data-annotation]`),
    );
    expect(tagged.length).toBe(1);
    expect(tagged[0]!.getAttribute("data-annotation")).toBe(annotationKey("Keyed asserted"));
  });
});

describe("overlays — malformed entry", () => {
  it("gets no legend row when it declares two kinds at once (the resolver drops it)", () => {
    // overlayKind returns null for an entry declaring more than one kind — validate.ts would reject
    // this spec, but the legend builder must not re-derive its own looser "has a label" test and key
    // a row for a line the resolver never draws.
    const s = spec([{ method: "lm", fun: "x", label: "Two kinds", legend: true } as never]);
    const { legendItems } = renderChart(s, ROWS, OPTS);
    expect((legendItems ?? []).some((i) => i.label === "Two kinds")).toBe(false);
  });
});

describe("overlays — legend: false on the chart", () => {
  it("keeps the label IN-FRAME rather than deleting it", () => {
    // With no legend to move the label to, stripping it would remove it from the figure entirely.
    // annotation-legend.ts's labelMovedToLegend exists for exactly this; the resolver mirrors it.
    const s = spec([{ fun: "x", label: "Asserted", legend: true }], { legend: false });
    const { svg, legendItems } = renderChart(s, ROWS, OPTS);
    expect(labelTexts(svg)).toEqual(["Asserted"]);
    expect((legendItems ?? []).some((i) => i.label === "Asserted")).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// The swatch keys the LINE, not a convention.
//
// The row's colour and dash used to be derived here-and-there: `dashed` came from overlayDashed
// (right), but the colour was the annotation neutral for EVERY per-series entry — including one
// carrying an explicit `color`, whose lines are all that one colour, and one on a single-series
// chart, whose single line is that series' colour. So a green overlay keyed grey. The rule now is
// the same one CONFIG-SPEC states for a reference line: the swatch is the line's own colour,
// dashed when the line is. The neutral survives only where it is TRUE — a per-series entry that
// really does resolve to several colours, which no one line swatch can key.
//
// Every assertion below compares the swatch against the LINE's own resolved presentation, read off
// the DOM it actually paints, rather than against a hardcoded hex: a swatch that merely stopped
// being grey is not the fix.
const strokeOf = (el: Element): string =>
  (/stroke:\s*([^;]+)/.exec(el.getAttribute("style") ?? "")?.[1] ?? "").trim().toLowerCase();

/** The line's resolved presentation. Plot hoists constant styling onto the mark's `<g>` wrapper
 *  (see overlays-render.test.ts), so the group is where a line's colour and dash live. */
function drawnLines(svg: SVGSVGElement): Array<{ color: string; dashed: boolean }> {
  return Array.from(svg.querySelectorAll<SVGGElement>(`g.${OVERLAY_LINE_CLASS}`))
    .filter((g) => g.querySelector("path"))
    .map((g) => ({
      color: (g.getAttribute("stroke") ?? "").toLowerCase(),
      dashed: g.getAttribute("stroke-dasharray") != null,
    }));
}

/** The live legend's swatch for one annotation row, by label. */
function liveSwatch(s: ChartSpec, rows: TidyRow[], label: string) {
  const { svg, legendItems } = renderChart(s, rows, OPTS);
  const parent = document.createElement("div");
  renderLegend(parent, legendItems ?? [], { svg });
  const row = Array.from(
    parent.querySelectorAll<HTMLElement>(".tbl-legend-item[data-annotation]"),
  ).find((el) => el.textContent === label)!;
  const line = row.querySelector<SVGLineElement>(".tbl-legend-swatch svg line")!;
  return { color: strokeOf(line), dashed: line.getAttribute("stroke-dasharray") != null, line };
}

/** The PNG export's swatch for one row. The export RE-RENDERS from the spec (it does not serialise
 *  the live DOM), so a screen-only fix is a silent divergence in the download — and its icon must be
 *  SVG-namespaced, since XHTML nodes inside the exported `<g>` never rasterise. */
function exportSwatch(s: ChartSpec, rows: TidyRow[], label: string) {
  const svg = buildExportSvg(s, rows);
  const text = Array.from(svg.querySelectorAll("text")).find((t) => t.textContent === label)!;
  const group = text.previousElementSibling as SVGGElement;
  expect(group.getAttribute("class")).toBe(ICON_GROUP_CLASS);
  const line = group.querySelector("line")!;
  return { color: strokeOf(line), dashed: line.getAttribute("stroke-dasharray") != null, line };
}

const TWO_SERIES: TidyRow[] = [
  ...ROWS,
  { time: "1", value: "10", series: "B" },
  { time: "2", value: "12", series: "B" },
  { time: "3", value: "11", series: "B" },
] as unknown as TidyRow[];

describe("overlays — the legend swatch keys the line it names", () => {
  it("keys an explicit `color` with THAT colour, on a per-series fit", () => {
    // The reported defect: `color: green` reached the line and the swatch stayed grey.
    const s = spec([{ method: "lm", label: "Green fit", legend: true, color: "green" }]);
    const drawn = drawnLines(renderChart(s, ROWS, OPTS).svg);
    expect(drawn.length).toBe(1);
    const swatch = liveSwatch(s, ROWS, "Green fit");
    expect(swatch.color).toBe(drawn[0]!.color);
    expect(swatch.color).not.toBe(TBL.color.annotationDim.toLowerCase());
    expect(exportSwatch(s, ROWS, "Green fit").color).toBe(drawn[0]!.color);
  });

  it("keys a default-coloured single-series fit with the SERIES' colour", () => {
    // `by: "series"` (the default) over one series resolves to exactly one line, in that series'
    // colour. "One row cannot key N colours" does not apply when N is 1.
    const s = spec([{ method: "lm", label: "Fitted", legend: true }]);
    const drawn = drawnLines(renderChart(s, ROWS, OPTS).svg);
    expect(drawn.length).toBe(1);
    expect(drawn[0]!.color).not.toBe(TBL.color.annotationDim.toLowerCase());
    const swatch = liveSwatch(s, ROWS, "Fitted");
    expect(swatch.color).toBe(drawn[0]!.color);
    expect(swatch.dashed).toBe(drawn[0]!.dashed);
    expect(exportSwatch(s, ROWS, "Fitted").color).toBe(drawn[0]!.color);
  });

  it("keys the dash the KIND defaults to, in the line's own colour", () => {
    // `fun` is dashed by default (overlayDashed) and belongs to no series, so it keeps the neutral —
    // that neutral is the line's real colour here, not a stand-in for one.
    const s = spec([{ fun: "2*x", label: "Asserted", legend: true }]);
    const drawn = drawnLines(renderChart(s, ROWS, OPTS).svg);
    expect(drawn).toEqual([{ color: TBL.color.annotationDim.toLowerCase(), dashed: true }]);
    const swatch = liveSwatch(s, ROWS, "Asserted");
    expect(swatch.color).toBe(drawn[0]!.color);
    expect(swatch.dashed).toBe(true);
    expect(exportSwatch(s, ROWS, "Asserted").dashed).toBe(true);
  });

  it("keys an explicit `style: dashed` dashed, and a solid entry solid, each in its line's colour", () => {
    const dashedSpec = spec([
      { method: "lm", label: "Dashed fit", legend: true, style: "dashed", color: "purple" },
    ]);
    const solidSpec = spec([{ method: "lm", label: "Solid fit", legend: true, style: "solid" }]);
    const dashedLine = drawnLines(renderChart(dashedSpec, ROWS, OPTS).svg)[0]!;
    const solidLine = drawnLines(renderChart(solidSpec, ROWS, OPTS).svg)[0]!;
    expect(dashedLine.dashed).toBe(true);
    expect(solidLine.dashed).toBe(false);

    const dashedSwatch = liveSwatch(dashedSpec, ROWS, "Dashed fit");
    const solidSwatch = liveSwatch(solidSpec, ROWS, "Solid fit");
    expect(dashedSwatch).toMatchObject({ color: dashedLine.color, dashed: true });
    expect(solidSwatch).toMatchObject({ color: solidLine.color, dashed: false });
    expect(exportSwatch(dashedSpec, ROWS, "Dashed fit").dashed).toBe(true);
    expect(exportSwatch(solidSpec, ROWS, "Solid fit").dashed).toBe(false);
  });

  it("keys a MULTI-colour per-series fit with the neutral — no one line swatch can carry N colours", () => {
    // The ruling for the genuinely-many case: the lines' colours are already keyed by the series
    // legend (each path carries its own `data-series`), so this row keys the CONCEPT. Banding a line
    // swatch would also collide with the dash, which is the channel carrying "fitted vs asserted".
    const s = spec([{ method: "lm", label: "Linear fit", legend: true }]);
    const drawn = drawnLines(renderChart(s, TWO_SERIES, OPTS).svg);
    expect(new Set(drawn.map((d) => d.color)).size).toBe(2);
    const swatch = liveSwatch(s, TWO_SERIES, "Linear fit");
    expect(swatch.color).toBe(TBL.color.annotationDim.toLowerCase());
    expect(exportSwatch(s, TWO_SERIES, "Linear fit").color).toBe(
      TBL.color.annotationDim.toLowerCase(),
    );
  });

  it("keys a multi-series fit that carries an explicit `color` with THAT colour", () => {
    // An explicit `color` collapses the N lines to one colour, so the row has one to key.
    const s = spec([{ method: "lm", label: "One-colour fit", legend: true, color: "green" }]);
    const drawn = drawnLines(renderChart(s, TWO_SERIES, OPTS).svg);
    expect(drawn.length).toBe(2);
    expect(new Set(drawn.map((d) => d.color)).size).toBe(1);
    expect(liveSwatch(s, TWO_SERIES, "One-colour fit").color).toBe(drawn[0]!.color);
    expect(exportSwatch(s, TWO_SERIES, "One-colour fit").color).toBe(drawn[0]!.color);
  });

  it("keys a pooled (`by: none`) fit with its line's colour", () => {
    const s = spec([{ method: "lm", label: "Pooled fit", legend: true, by: "none", color: "red" }]);
    const drawn = drawnLines(renderChart(s, TWO_SERIES, OPTS).svg);
    expect(drawn.length).toBe(1);
    expect(liveSwatch(s, TWO_SERIES, "Pooled fit").color).toBe(drawn[0]!.color);
  });

  it("leaves an ANNOTATION row's swatch alone — the neutral is correct there", () => {
    // The fence for the shared code path (ruleRow): a keyed reference line with no colour of its own
    // keys the neutral, exactly as it does in already-published figures.
    const s = {
      ...BASE,
      annotations: { yAxis: [{ y: 2, label: "Threshold", legend: true }] },
    } as unknown as ChartSpec;
    const swatch = liveSwatch(s, ROWS, "Threshold");
    expect(swatch).toMatchObject({ color: TBL.color.annotationDim.toLowerCase(), dashed: true });
  });

  it("draws the exported swatch in the SVG namespace, so it rasterises", () => {
    const s = spec([{ method: "lm", label: "Fitted", legend: true, color: "green" }]);
    expect(exportSwatch(s, ROWS, "Fitted").line.namespaceURI).toBe("http://www.w3.org/2000/svg");
  });
});

// ---------------------------------------------------------------------------------------------
// A confidence ribbon dims WITH the line it belongs to.
//
// The ribbon is a separate Plot mark from the line (underlay vs overlay — see marks/overlay.ts), and
// it was emitted with neither `data-series` nor `data-annotation` while only the line paths entered
// the tagging arrays. Legend dimming walks `[data-series], [data-annotation]` (legend.ts), so a path
// carrying neither is never reached: selecting the overlay's own annotation row, or the series row it
// belongs to, dimmed the line and every other keyed mark and left the ribbon permanently bright.
//
// Both directions are asserted, because the ribbon needs BOTH keys for the same reason a keyed
// `shading` fill does: bright from its annotation row AND bright from its series' row.
describe("overlays — a confidence ribbon dims with its line", () => {
  // Per-series `lm` + `ci` on two series: two lines, two ribbons, and ONE neutral annotation row for
  // the concept. Legend universe = series A + series B + the "Fitted" row, so selecting any one of
  // the three is a strict subset and dimming fires.
  const CI_SPEC = spec([{ method: "lm", ci: 0.95, label: "Fitted", legend: true }]);
  const FITTED = annotationKey("Fitted");

  const mountCi = () => {
    const { svg, legendItems } = renderChart(CI_SPEC, TWO_SERIES, OPTS);
    const parent = document.createElement("div");
    const handle = renderLegend(parent, legendItems ?? [], { svg })!;
    return { svg, parent, handle };
  };
  const ribbons = (svg: SVGSVGElement): SVGPathElement[] =>
    Array.from(svg.querySelectorAll<SVGPathElement>(`g.${OVERLAY_BAND_CLASS} path`));
  const isDimmed = (el: Element): boolean => el.classList.contains("tbl-dimmed");

  it("tags each ribbon with its series AND its annotation key", () => {
    const bands = ribbons(mountCi().svg);
    expect(bands.length).toBe(2);
    expect(bands.map((b) => b.getAttribute("data-series"))).toEqual(["A", "B"]);
    expect(bands.map((b) => b.getAttribute("data-annotation"))).toEqual([FITTED, FITTED]);
  });

  it("keeps both ribbons bright when the overlay's own annotation row is selected", () => {
    const { svg, handle } = mountCi();
    handle.hoverAnnotation(FITTED);
    expect(ribbons(svg).map(isDimmed)).toEqual([false, false]);
    // The fence: dimming really is active — the scatter points dropped back.
    expect(Array.from(svg.querySelectorAll("[data-series]")).some(isDimmed)).toBe(true);
  });

  it("dims the ribbon of the series that is NOT selected", () => {
    const { svg, handle } = mountCi();
    handle.toggle("A");
    expect(ribbons(svg).map(isDimmed)).toEqual([false, true]);
  });

  it("carries the tags into the export SVG, which rebuilds from the spec", () => {
    const bands = ribbons(buildExportSvg(CI_SPEC, TWO_SERIES));
    expect(bands.map((b) => b.getAttribute("data-series"))).toEqual(["A", "B"]);
    expect(bands.map((b) => b.getAttribute("data-annotation"))).toEqual([FITTED, FITTED]);
  });

  it("leaves an identity-less ribbon untagged, exactly as it leaves its line untagged", () => {
    // `by: none` has no series identity and `legend` is omitted, so nothing moved to the legend:
    // there is no key of either kind for the legend to select on. The line paths are untagged in that
    // case (tagging the inert SINGLE_SERIES_KEY would dim them against every real series), and the
    // ribbon must match its line rather than acquire a key the line does not have.
    const { svg } = renderChart(spec([{ method: "lm", ci: 0.95, by: "none" }]), TWO_SERIES, OPTS);
    const bands = ribbons(svg);
    expect(bands.length).toBe(1);
    const line = svg.querySelector(`g.${OVERLAY_LINE_CLASS} path`)!;
    expect(line.getAttribute("data-series")).toBeNull();
    expect(bands[0]!.getAttribute("data-series")).toBeNull();
    expect(bands[0]!.getAttribute("data-annotation")).toBeNull();
  });
});
