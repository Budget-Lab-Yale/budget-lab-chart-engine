// @vitest-environment jsdom
//
// Task 12: `projected_field` — dashed line / faded area for projected data runs. Exercises the
// full render path (renderChart → assemblePlot) so paint order, data-series tagging, and the
// area veil's paint-order-after-fill (but before annotations) are all proven end to end, not
// just at the mark-layer/splitter unit level (see test/projected-runs.test.ts for that).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderChart } from "../src/engine/index";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";
import { TBL } from "../src/engine/theme";

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

const LINE_PROJECTED_SPEC: ChartSpec = {
  chartType: "line",
  title: "Projected line",
  xAxisType: "numeric",
  series_order: ["A", "B"],
  columns: { x: "time", value: "value", series: "series" },
  projected_field: "projected",
  data: "line-projected.csv",
};

const AREA_PROJECTED_SPEC: ChartSpec = {
  chartType: "area",
  title: "Projected area",
  xAxisType: "numeric",
  series_order: ["X", "Y"],
  columns: { x: "time", value: "value", series: "series" },
  projected_field: "projected",
  data: "area-projected.csv",
};

describe("projected_field — line (dashed runs)", () => {
  const rows = parseCsv("./fixtures/line-projected.csv");

  it("splits into a projected-runs group (dashed) and an actual-runs group (solid), 4 paths each", () => {
    const { svg } = renderChart(LINE_PROJECTED_SPEC, rows, { width: 720, height: 400, document });
    const lineGroups = Array.from(svg.querySelectorAll('g[aria-label="line"]'));
    // No whole-series dashed override here, so exactly two groups: projected-runs, actual-runs.
    expect(lineGroups.length).toBe(2);
    const dashedGroup = lineGroups.find((g) => g.getAttribute("stroke-dasharray"));
    const solidGroup = lineGroups.find((g) => !g.getAttribute("stroke-dasharray"));
    expect(dashedGroup).toBeTruthy();
    expect(solidGroup).toBeTruthy();
    expect(dashedGroup!.getAttribute("stroke-dasharray")).toBe(TBL.dashArray);
    // 2 series x 2 disjoint projected runs each = 4 paths in the projected group; likewise 4
    // actual-run paths (2 series x 2 actual runs each: [1,2] and [5..8]).
    expect(dashedGroup!.querySelectorAll("path").length).toBe(4);
    expect(solidGroup!.querySelectorAll("path").length).toBe(4);
  });

  it("tags each path data-series in paint order: projected-runs (A,A,B,B) then actual-runs (A,A,B,B)", () => {
    const { svg } = renderChart(LINE_PROJECTED_SPEC, rows, { width: 720, height: 400, document });
    const paths = Array.from(svg.querySelectorAll('g[aria-label="line"] path'));
    expect(paths.map((p) => p.getAttribute("data-series"))).toEqual([
      "A", "A", "B", "B", // projected-runs group (painted first)
      "A", "A", "B", "B", // actual-runs group
    ]);
  });

  it("exactly one legend entry per series (projected styling adds no rows)", () => {
    const { legendItems } = renderChart(LINE_PROJECTED_SPEC, rows, { width: 720, height: 400, document });
    expect(legendItems?.map((l) => l.series)).toEqual(["A", "B"]);
    expect(legendItems?.length).toBe(2);
  });

  it("a whole-series dashed override wins outright: that series is not split by projected_field", () => {
    const spec: ChartSpec = { ...LINE_PROJECTED_SPEC, series_styles: { A: { dashed: true } } };
    const { svg } = renderChart(spec, rows, { width: 720, height: 400, document });
    const lineGroups = Array.from(svg.querySelectorAll('g[aria-label="line"]'));
    // Three groups now: whole-series-dashed (A, 1 path), projected-runs (B only, 2 paths),
    // actual-runs (B only, 2 paths).
    expect(lineGroups.length).toBe(3);
    const paths = Array.from(svg.querySelectorAll('g[aria-label="line"] path'));
    expect(paths.map((p) => p.getAttribute("data-series"))).toEqual(["A", "B", "B", "B", "B"]);
  });

  it("a null gap in an UNFLAGGED series still tags every path correctly (no phantom-path shift)", () => {
    // Series A has a null gap at x=2 and ZERO projected rows; B has one projected row at x=2.
    // The null row's isolated run renders NO <path> (all its points are defined:false), so the
    // splitter must not emit it — otherwise every subsequent data-series tag shifts by one and
    // B's actual paths get tagged "A" (the original bug this test pins).
    const gapRows: TidyRow[] = [
      { time: "1", series: "A", value: "10", projected: "0" },
      { time: "2", series: "A", value: "", projected: "0" }, // null gap, unflagged
      { time: "3", series: "A", value: "12", projected: "0" },
      { time: "1", series: "B", value: "5", projected: "0" },
      { time: "2", series: "B", value: "6", projected: "1" },
      { time: "3", series: "B", value: "7", projected: "0" },
    ] as TidyRow[];
    const spec: ChartSpec = {
      chartType: "line",
      title: "t",
      xAxisType: "numeric",
      projected_field: "projected",
      data: "x",
    };
    const { svg } = renderChart(spec, gapRows, { width: 400, height: 300, document });
    const paths = Array.from(svg.querySelectorAll('g[aria-label="line"] path'));
    // Accepted DOM shape (pinned deliberately): an unflagged series with a null gap renders as
    // MULTIPLE single-run <path>s (one per _seg), not the pre-projected_field single path with
    // gap subpaths — visually identical, and legend hover-dim / fat hit-paths key on
    // data-series, so the multi-path shape behaves identically for interaction. Paths:
    // B-projected (x1..x3 dashed, 1) + A actual runs (2; the null-only run renders nothing and
    // is dropped) + B actual runs (2, single boundary points at x=1 and x=3).
    expect(paths.length).toBe(5);
    expect(paths.map((p) => p.getAttribute("data-series"))).toEqual(["B", "A", "A", "B", "B"]);
    // Geometry cross-check: B's x=1 point (value 5) starts the projected path; any other path
    // sharing that exact start coordinate must also be tagged B (the bug tagged it "A").
    const dOf = (p: Element) => p.getAttribute("d") ?? "";
    const bStart = /^M([\d.]+,[\d.]+)/.exec(dOf(paths[0]!))![1];
    for (const p of paths.slice(1)) {
      if (dOf(p).startsWith(`M${bStart}`)) {
        expect(p.getAttribute("data-series")).toBe("B");
      }
    }
  });

  it("crosshair/tooltip data (dataInScope) is unaffected — same row count with or without the field", () => {
    const withField = renderChart(LINE_PROJECTED_SPEC, rows, { width: 720, height: 400, document });
    const withoutField = renderChart(
      { ...LINE_PROJECTED_SPEC, projected_field: undefined },
      rows,
      { width: 720, height: 400, document },
    );
    expect(withField.dataInScope.length).toBe(rows.length);
    expect(withField.dataInScope.length).toBe(withoutField.dataInScope.length);
  });

  it("is deterministic and matches the golden", async () => {
    const a = renderChart(LINE_PROJECTED_SPEC, rows, { width: 720, height: 400, document }).svg.outerHTML;
    const b = renderChart(LINE_PROJECTED_SPEC, rows, { width: 720, height: 400, document }).svg.outerHTML;
    expect(a).toBe(b);
    await expect(a).toMatchFileSnapshot("./fixtures/line-projected.golden.svg");
  });
});

describe("schema / validate — projected_field", () => {
  const rows = parseCsv("./fixtures/line-projected.csv");

  it("accepts projected_field and projected_style", async () => {
    const { validateSpec } = await import("../src/spec/validate");
    const r = validateSpec({ ...LINE_PROJECTED_SPEC, projected_style: { dashed: false, fillOpacity: 0.3 } });
    expect(r.valid).toBe(true);
  });

  it("rejects an unknown projected_style key", async () => {
    const { validateSpec } = await import("../src/spec/validate");
    const r = validateSpec({ ...LINE_PROJECTED_SPEC, projected_style: { bogus: true } });
    expect(r.valid).toBe(false);
  });

  it("rejects a fillOpacity outside 0..1", async () => {
    const { validateSpec } = await import("../src/spec/validate");
    const r = validateSpec({ ...LINE_PROJECTED_SPEC, projected_style: { fillOpacity: 1.5 } });
    expect(r.valid).toBe(false);
  });

  it("data validation errors when the projected_field column doesn't exist", async () => {
    const { validateChartData } = await import("../src/spec/validate");
    const spec: ChartSpec = { ...LINE_PROJECTED_SPEC, projected_field: "not_a_column" };
    const r = validateChartData(spec, rows);
    expect(r.valid).toBe(false);
    expect(r.errors.join("\n")).toMatch(/columns\.projected_field is "not_a_column".*no such column/);
  });
});

describe("projected_field — area (fade veil)", () => {
  const rows = parseCsv("./fixtures/area-projected.csv");

  it("paints a white veil rect per projected x-range, after the fill, before annotations", () => {
    const spec: ChartSpec = {
      ...AREA_PROJECTED_SPEC,
      annotations: { yAxis: [{ y: 7, label: "TARGET" }] },
    };
    const { svg } = renderChart(spec, rows, { width: 720, height: 400, document });
    const all = Array.from(svg.querySelectorAll("*"));
    const idx = (el: Element) => all.indexOf(el);

    const areaPaths = Array.from(svg.querySelectorAll('g[aria-label="area"] path'));
    expect(areaPaths.length).toBe(2); // stacked X, Y

    // fill / fill-opacity are constant channels — Plot hoists them onto the wrapping <g>, not
    // onto each <rect> (verified empirically; matches how strokeDasharray hoists for lines).
    const veilGroup = svg.querySelector('g[aria-label="rect"]')!;
    expect(veilGroup.getAttribute("fill")).toBe("#FFFFFF");
    expect(veilGroup.getAttribute("fill-opacity")).toBe("0.8"); // 1 - 0.2 default
    const veilRects = Array.from(veilGroup.querySelectorAll("rect"));
    // Two disjoint all-series-projected x-ranges: [3,6] (interior, both-side-extended) and
    // [6,8] (trailing, left-extended only).
    expect(veilRects.length).toBe(2);

    // Paint order: veil rects paint AFTER the area fill (on top of it)...
    const lastAreaPath = Math.max(...areaPaths.map(idx));
    expect(Math.min(...veilRects.map(idx))).toBeGreaterThan(lastAreaPath);
    // ...but the annotation label paints after the veil (labels always paint last).
    const label = Array.from(svg.querySelectorAll("text")).find((t) => t.textContent === "TARGET")!;
    expect(idx(label)).toBeGreaterThan(Math.max(...veilRects.map(idx)));

    // x-extents: the two rects are contiguous (rect1 right edge == rect2 left edge), covering
    // x=3..8 of the x=1..8 domain (left edge > the domain-start pixel, right edge == domain end).
    const xs = veilRects
      .map((r) => ({ x: Number(r.getAttribute("x")), w: Number(r.getAttribute("width")) }))
      .sort((a, b) => a.x - b.x);
    expect(xs[0]!.x).toBeGreaterThan(0);
    expect(xs[0]!.x + xs[0]!.w).toBeCloseTo(xs[1]!.x, 0);
  });

  it("is deterministic and matches the golden", async () => {
    const a = renderChart(AREA_PROJECTED_SPEC, rows, { width: 720, height: 400, document }).svg.outerHTML;
    const b = renderChart(AREA_PROJECTED_SPEC, rows, { width: 720, height: 400, document }).svg.outerHTML;
    expect(a).toBe(b);
    await expect(a).toMatchFileSnapshot("./fixtures/area-projected.golden.svg");
  });
});
