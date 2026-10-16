// @vitest-environment jsdom
//
// Hover/selection options parity between the two live mount paths (T4.3; review 2026-10-15,
// crosshair.md debt step 5, render-live.md debt map #1). mountChart's draw() and wireFigureSvg used
// to build the attach options by hand, side by side, and drifted (click-to-pin, the scatter card,
// the categorical-line hit-paths). Both now build one plan per chart family through
// `buildHoverPlan` (src/engine/live/hover-options.ts).
//
// The matrix below is family × {standalone, uncoordinated pane, coordinated pane}. Each case builds
// all three plans from the SAME inputs and asserts the plans are identical except at the paths
// listed for it. Every listed path cites the numbered PANE DIFFERENCES in hover-options.ts; a
// difference that is not listed (an option one mount sets and the other forgot) fails here.
//
// Functions handed in (the onResolve / onHover sinks, the tooltip hook, the x parse/format) must be
// passed through as the SAME function on both mounts: `HANDED_IN` lists them and the diff requires
// `===`. Only the formatters each plan builds itself (fresh closures per call) are compared by their
// output over a fixed set of values.
//
// The second half checks that both mount paths really build their hover through this one builder:
// a plan matrix that nothing calls would pass on its own.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildHoverPlan,
  hoverFamily,
  type HoverFamily,
  type HoverInputs,
  type HoverMount,
  type HoverPlan,
} from "../src/engine/live/hover-options";
import { mountChart } from "../src/engine/render-live";
import type { PreparedRow } from "../src/engine/marks/index";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";
import type { NetMode } from "../src/spec/bar-stack";

vi.mock("../src/engine/live/hover-options", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/engine/live/hover-options")>();
  return { ...actual, buildHoverPlan: vi.fn(actual.buildHoverPlan) };
});

const spec = (s: Record<string, unknown>): ChartSpec => ({ title: "t", data: "inline", ...s }) as unknown as ChartSpec;

// ---- inputs --------------------------------------------------------------------------------

const SERIES = ["A", "B"];
const CATS = ["c1", "c2", "c3"];
const container = document.createElement("div");
const onResolve = (_key: unknown): void => {};
const onHover = (): void => {};
const tooltipXParse = (v: string): number => Date.parse(v);
const tooltipXFormat = (v: number): string => new Date(v).toISOString().slice(0, 7);
const tooltipHook = (): string | null => null;
const HANDED_IN = new Set<unknown>([onResolve, onHover, tooltipHook, tooltipXParse, tooltipXFormat]);

const catRows = (extra: (s: string, c: string, k: number) => Partial<PreparedRow> = () => ({})): PreparedRow[] =>
  SERIES.flatMap((s, k) => CATS.map((c, i) => ({ series: s, time: c, _xc: c, _y: 2 + i + k * 3, ...extra(s, c, k) })));

const timeRows: PreparedRow[] = SERIES.flatMap((s, k) =>
  ["2020-01-01", "2020-02-01", "2020-03-01"].map((t, i) => ({ series: s, time: t, _y: 1.25 + i + k })),
);

const histRows: PreparedRow[] = SERIES.flatMap((s, k) =>
  [0, 5, 10].map((x0, i) => ({ series: s, time: String(x0), _x0: x0, _x1: x0 + 5, _y: i + k + 1 })),
);

const pointRows: PreparedRow[] = SERIES.flatMap((s, k) =>
  [1, 2, 3].map((x) => ({ series: s, time: String(x), _xn: x, _y: x * (2 + k), _shape: x === 1 ? "lo" : "hi" })),
);

function inputs(s: ChartSpec, dataInScope: PreparedRow[], extra: Partial<HoverInputs> = {}): HoverInputs {
  return {
    spec: s,
    dataInScope,
    colors: new Map([["A", "#111111"], ["B", "#222222"]]),
    seriesLabels: { A: "Alpha", B: "Beta" },
    seriesOrder: SERIES,
    valueAffixes: { prefix: "$", suffix: "" },
    icons: new Map(SERIES.map((series) => [series, { color: "#000000", shape: "rect" }] as never)),
    tooltipContainer: container,
    hooks: { tooltip: tooltipHook },
    tooltipXParse,
    tooltipXFormat,
    overlayTooltips: [],
    onHover,
    symbolSeries: SERIES,
    ...extra,
  };
}

// ---- structural diff -----------------------------------------------------------------------

const PROBES = [0, 2, -1.5, 0.004, 1234.5678, NaN];
const probe = (f: (v: number) => unknown): string =>
  JSON.stringify(PROBES.map((v) => { try { return String(f(v)); } catch { return "<throws>"; } }));

/** Every path at which `a` and `b` differ. A key one side has and the other lacks is a difference
 *  even when its value is undefined. */
function diffPaths(a: unknown, b: unknown, path = ""): string[] {
  if (a === b) return [];
  // A handed-in function that is not passed through as itself (wrapped, dropped, swapped) differs.
  if (HANDED_IN.has(a) || HANDED_IN.has(b)) return [path];
  if (typeof a === "function" && typeof b === "function") {
    return probe(a as (v: number) => unknown) === probe(b as (v: number) => unknown) ? [] : [path];
  }
  if (a == null || b == null || typeof a !== "object" || typeof b !== "object") return [path];
  if (a instanceof Node || b instanceof Node) return [path]; // identity only
  if (a instanceof Map && b instanceof Map) return diffPaths([...a], [...b], path).length ? [path] : [];
  if (a instanceof Set && b instanceof Set) return diffPaths([...a], [...b], path).length ? [path] : [];
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return [path];
    return a.some((x, k) => diffPaths(x, b[k], path).length) ? [path] : [];
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: string[] = [];
  for (const k of keys) {
    const p = path ? `${path}.${k}` : k;
    if (!(k in a) || !(k in b)) out.push(p);
    else out.push(...diffPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], p));
  }
  return out.sort();
}

// ---- the matrix ----------------------------------------------------------------------------

// The documented pane differences (src/engine/live/hover-options.ts, PANE DIFFERENCES), as the
// paths they move. Numbers match that list.
const COORD_EMIT_ONLY = ["primary.opts.emitOnly", "primary.opts.onResolve", "secondary"]; // 1
const COORD_WITH_CARD = ["primary.opts.onResolve", "secondary"]; // 1: dumbbell
const COORD_ECHO_WITH_CARD = ["pillsHearCursor", "primary.opts.onResolve", "secondary"]; // 1: tooltip-mode band
const HORIZONTAL_CARD = ["primary.opts.accentLabel", "primary.opts.orientation", "primary.opts.regionFromLeftEdge"]; // 2
const HORIZONTAL_CURSOR = ["pills.horizontal", "secondary.opts.accentLabel", "secondary.opts.horizontal", "secondary.opts.regionFromLeftEdge"]; // 2
const VALUE_PILL_DEFAULT = ["pills", "secondary.opts.showPills"]; // 3
const DOT_DODGE = ["pills.dodge"]; // 4
const WATERFALL_PRECISION = ["pills.yFormat", "primary.opts.yFormat"]; // 5
const HISTOGRAM_HIT_PATHS = ["clickToPin.lineHitPaths"]; // 6

interface Case {
  name: string;
  family: HoverFamily;
  inputs: HoverInputs;
  /** Standalone vs a pane on a figure with `coordinated_cursor: false` (no `onResolve`). */
  vsPane: string[];
  /** Standalone vs a pane on a coordinating figure. */
  vsCoordinatedPane: string[];
}

const CASES: Case[] = [
  { name: "temporal line", family: "line", inputs: inputs(spec({ chartType: "line", xAxisType: "temporal", points: true }), timeRows),
    vsPane: [], vsCoordinatedPane: COORD_EMIT_ONLY },
  { name: "temporal area", family: "line", inputs: inputs(spec({ chartType: "area", xAxisType: "temporal" }), timeRows),
    vsPane: [], vsCoordinatedPane: COORD_EMIT_ONLY },
  { name: "categorical line", family: "catline", inputs: inputs(spec({ chartType: "line", xAxisType: "categorical", points: true }), catRows()),
    vsPane: [], vsCoordinatedPane: COORD_EMIT_ONLY },
  { name: "categorical area", family: "catline", inputs: inputs(spec({ chartType: "area", xAxisType: "categorical" }), catRows()),
    vsPane: [], vsCoordinatedPane: COORD_EMIT_ONLY },
  // A standalone band chart in pills mode drives its own coordinated cursor, so it matches the
  // COORDINATED pane and differs from the uncoordinated one.
  { name: "grouped bar", family: "band", inputs: inputs(spec({ chartType: "bar", xAxisType: "categorical" }), catRows()),
    vsPane: COORD_EMIT_ONLY, vsCoordinatedPane: [] },
  { name: "horizontal bar", family: "band",
    inputs: inputs(spec({ chartType: "bar", xAxisType: "categorical", orientation: "horizontal" }), catRows()),
    // The uncoordinated pane has no secondary, so only the pills' half of HORIZONTAL_CURSOR shows.
    vsPane: [...COORD_EMIT_ONLY, ...HORIZONTAL_CARD, "pills.horizontal"],
    vsCoordinatedPane: [...HORIZONTAL_CARD, ...HORIZONTAL_CURSOR] },
  { name: "stacked bar, pills mode", family: "band",
    inputs: inputs(spec({ chartType: "stacked", xAxisType: "categorical" }), catRows(), { netMode: "none" as NetMode }),
    vsPane: COORD_EMIT_ONLY, vsCoordinatedPane: [] },
  { name: "stacked bar with segment labels", family: "band",
    inputs: inputs(spec({ chartType: "stacked", xAxisType: "categorical", valueLabels: { show: true } }), catRows(), {
      netMode: "text" as NetMode, segmentLabelsDropped: false,
    }),
    vsPane: [...COORD_EMIT_ONLY, "pills"], vsCoordinatedPane: VALUE_PILL_DEFAULT },
  { name: "total-dot stack, tooltip mode", family: "band",
    inputs: inputs(spec({ chartType: "stacked", xAxisType: "categorical" }), catRows(), { netMode: "dot" as NetMode }),
    vsPane: [], vsCoordinatedPane: COORD_ECHO_WITH_CARD },
  { name: "waterfall", family: "band",
    inputs: inputs(spec({ chartType: "waterfall", xAxisType: "categorical" }), catRows((_s, c) => (c === "c3" ? { _kind: "total" } : {}))),
    vsPane: [...COORD_EMIT_ONLY, ...WATERFALL_PRECISION], vsCoordinatedPane: WATERFALL_PRECISION },
  { name: "histogram, shared mode", family: "histogram",
    inputs: inputs(spec({ chartType: "histogram", xAxisType: "numeric", small_multiples: { mode: "shared" } }), histRows),
    vsPane: HISTOGRAM_HIT_PATHS, vsCoordinatedPane: [...COORD_EMIT_ONLY, ...HISTOGRAM_HIT_PATHS] },
  { name: "histogram, per-pane mode", family: "histogram",
    inputs: inputs(spec({ chartType: "histogram", xAxisType: "numeric", small_multiples: { mode: "per-pane" } }), histRows),
    vsPane: HISTOGRAM_HIT_PATHS, vsCoordinatedPane: HISTOGRAM_HIT_PATHS },
  { name: "dot plot", family: "dotplot",
    inputs: inputs(spec({ chartType: "dotplot", xAxisType: "categorical", columns: { shape: "kind" } }), catRows(() => ({ _shape: "lo" })), {
      symbolScale: { domain: ["lo"], range: ["circle"] }, pointOrder: catRows(() => ({ _shape: "lo" })),
    }),
    vsPane: DOT_DODGE, vsCoordinatedPane: [...COORD_EMIT_ONLY, ...DOT_DODGE] },
  { name: "vertical dumbbell", family: "dumbbell",
    inputs: inputs(spec({ chartType: "dumbbell", xAxisType: "categorical", orientation: "vertical", tooltip_section: true }),
      catRows(() => ({ _section: "S1" }))),
    vsPane: [], vsCoordinatedPane: COORD_WITH_CARD },
  { name: "horizontal dumbbell", family: "dumbbell",
    inputs: inputs(spec({ chartType: "dumbbell", xAxisType: "categorical" }), catRows()),
    vsPane: HORIZONTAL_CARD, vsCoordinatedPane: [...COORD_WITH_CARD, ...HORIZONTAL_CARD] },
  { name: "scatter", family: "scatter",
    inputs: inputs(spec({ chartType: "scatter", xAxisType: "numeric", columns: { shape: "kind" } }), pointRows, {
      symbolScale: { domain: ["lo", "hi"], range: ["circle", "square"] }, pointOrder: pointRows,
    }),
    vsPane: [], vsCoordinatedPane: [] },
];

const plans = (c: Case): { standalone: HoverPlan; pane: HoverPlan; coordinatedPane: HoverPlan } => ({
  // The standalone caller always hands in its local driver; the builder decides whether to wire it.
  standalone: buildHoverPlan("standalone", { ...c.inputs, onResolve }),
  pane: buildHoverPlan("pane", c.inputs),
  coordinatedPane: buildHoverPlan("pane", { ...c.inputs, onResolve }),
});

describe("T4.3: hover options parity, family × standalone/pane", () => {
  for (const c of CASES) {
    describe(c.name, () => {
      it(`dispatches to ${c.family} on both mounts`, () => {
        const p = plans(c);
        expect([p.standalone.family, p.pane.family, p.coordinatedPane.family]).toEqual([c.family, c.family, c.family]);
      });
      it("standalone vs pane: identical apart from the listed differences", () => {
        const p = plans(c);
        expect(diffPaths(p.standalone, p.pane)).toEqual([...c.vsPane].sort());
      });
      it("standalone vs coordinated pane: identical apart from the listed differences", () => {
        const p = plans(c);
        expect(diffPaths(p.standalone, p.coordinatedPane)).toEqual([...c.vsCoordinatedPane].sort());
      });
    });
  }

  it("the matrix covers every family a pane can reach", () => {
    const paneFamilies: HoverFamily[] = ["scatter", "dotplot", "dumbbell", "catline", "band", "histogram", "line"];
    expect([...new Set(CASES.map((c) => c.family))].sort()).toEqual([...paneFamilies].sort());
  });

  // The diff must be able to see a difference, or every case above passes vacuously.
  it("control: the diff reports a formatter that differs and a key one side lacks", () => {
    expect(diffPaths({ yFormat: (v: number) => v.toFixed(2) }, { yFormat: (v: number) => v.toFixed(0) })).toEqual(["yFormat"]);
    expect(diffPaths({ a: 1, b: undefined }, { a: 1 })).toEqual(["b"]);
    expect(diffPaths({ m: new Map([["A", 1]]) }, { m: new Map([["A", 2]]) })).toEqual(["m"]);
    // A no-op in place of a handed-in sink probes identically (both return undefined); identity
    // still catches it.
    expect(diffPaths({ onResolve }, { onResolve: () => {} })).toEqual(["onResolve"]);
  });

  // A listed difference is checked for presence only: the coordinated pane's `onResolve` sits at a
  // path the standalone plan lacks, so the diff never compares its value. So every slot that carries
  // a handed-in function must carry THAT function, on every plan, whether or not the path is listed.
  it("every handed-in slot, on every plan, carries the function that was handed in", () => {
    const SLOTS: Record<string, unknown> = { onResolve, onHover, tooltipHook, xParse: tooltipXParse };
    const wrong: string[] = [];
    let slots = 0;
    const walk = (v: unknown, path: string): void => {
      if (v == null || typeof v !== "object" || v instanceof Node || v instanceof Map || v instanceof Set) return;
      for (const [k, x] of Object.entries(v)) {
        const at = `${path}.${k}`;
        if (k in SLOTS && x !== undefined) {
          slots++;
          if (x !== SLOTS[k]) wrong.push(at);
        }
        walk(x, at);
      }
    };
    for (const c of CASES) {
      for (const [mount, plan] of Object.entries(plans(c))) walk(plan, `${c.name}/${mount}`);
    }
    expect(wrong).toEqual([]);
    expect(slots).toBeGreaterThan(0); // the walk found slots to check
  });

  it("the coordinated cursor emits to the sink it was handed, on both mounts", () => {
    const bar = CASES.find((c) => c.name === "grouped bar")!;
    const p = plans(bar);
    expect(p.standalone.primary?.opts).toHaveProperty("onResolve", onResolve);
    expect(p.coordinatedPane.primary?.opts).toHaveProperty("onResolve", onResolve);
  });

  it("facet: an input forwarded into every card that feeds TooltipHookCtx, and only there", () => {
    const withFacet: Record<string, boolean> = {};
    for (const c of CASES) {
      const plan = buildHoverPlan("pane", { ...c.inputs, facet: "P1" });
      withFacet[c.family] = (plan.primary?.opts as { facet?: string }).facet === "P1";
    }
    expect(withFacet).toEqual({
      line: false, catline: true, band: true, histogram: false, dotplot: true, dumbbell: true, scatter: false,
    });
  });
});

describe("T4.3: family dispatch", () => {
  const specs: Array<[Record<string, unknown>, HoverFamily]> = [
    [{ chartType: "line", xAxisType: "temporal" }, "line"],
    [{ chartType: "bar", xAxisType: "temporal" }, "line"],
    [{ chartType: "line", xAxisType: "categorical" }, "catline"],
    [{ chartType: "area", xAxisType: "categorical" }, "catline"],
    [{ chartType: "bar", xAxisType: "categorical" }, "band"],
    [{ chartType: "stacked", xAxisType: "categorical" }, "band"],
    [{ chartType: "waterfall", xAxisType: "categorical" }, "band"],
    [{ chartType: "histogram", xAxisType: "numeric" }, "histogram"],
    [{ chartType: "dotplot", xAxisType: "categorical" }, "dotplot"],
    [{ chartType: "dumbbell", xAxisType: "categorical" }, "dumbbell"],
    [{ chartType: "scatter", xAxisType: "numeric" }, "scatter"],
  ];
  for (const [s, family] of specs) {
    it(`${s.chartType} on a ${s.xAxisType} axis → ${family}, on both mounts`, () => {
      for (const mount of ["standalone", "pane"] as HoverMount[]) expect(hoverFamily(spec(s), mount)).toBe(family);
    });
  }
  it("treemap and timeline are standalone-only families", () => {
    expect(hoverFamily(spec({ chartType: "treemap" }), "standalone")).toBe("treemap");
    expect(hoverFamily(spec({ chartType: "timeline" }), "standalone")).toBe("timeline");
    expect(hoverFamily(spec({ chartType: "treemap" }), "pane")).not.toBe("treemap");
    expect(hoverFamily(spec({ chartType: "timeline" }), "pane")).not.toBe("timeline");
  });
});

// ---- both mount paths build through the plan ------------------------------------------------

describe("T4.3: both mount paths build their hover through buildHoverPlan", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.mocked(buildHoverPlan).mockClear();
  });

  const catTidy = (panes: Array<string | undefined>): TidyRow[] =>
    panes.flatMap((pane, p) =>
      SERIES.flatMap((s, k) =>
        CATS.map((c, i) => ({ ...(pane ? { pane } : {}), time: c, series: s, value: String(3 + i + k * 4 + p) })),
      ),
    ) as unknown as TidyRow[];
  const timeTidy = (panes: Array<string | undefined>): TidyRow[] =>
    panes.flatMap((pane, p) =>
      SERIES.flatMap((s, k) =>
        ["2020-01-01", "2020-02-01", "2020-03-01"].map((t, i) => ({ ...(pane ? { pane } : {}), time: t, series: s, value: String(1 + i + k + p) })),
      ),
    ) as unknown as TidyRow[];
  const facet = { data: "d.csv", columns: { x: "time", value: "value", series: "series", facet: "pane" }, small_multiples: { columns: 2 } };

  // The mount-only inputs HoverInputs documents. Every other input key must be built by BOTH real
  // callers, or one mount's plan silently loses an option the matrix above assumes it gets.
  const STANDALONE_ONLY = ["segmentLabelsDropped", "treemapTiles"];
  const PANE_ONLY = ["facet", "symbolSeries"];
  const inputKeys = (k: number, drop: string[]): string[] =>
    Object.keys(vi.mocked(buildHoverPlan).mock.calls[k]![1]).filter((key) => !drop.includes(key)).sort();

  const families: Array<[string, Record<string, unknown>, (p: Array<string | undefined>) => TidyRow[], HoverFamily]> = [
    ["temporal line", { chartType: "line", xAxisType: "temporal" }, timeTidy, "line"],
    ["categorical line", { chartType: "line", xAxisType: "categorical" }, catTidy, "catline"],
    ["bar", { chartType: "bar", xAxisType: "categorical" }, catTidy, "band"],
    ["dot plot", { chartType: "dotplot", xAxisType: "categorical" }, catTidy, "dotplot"],
    ["dumbbell", { chartType: "dumbbell", orientation: "vertical", xAxisType: "categorical" }, catTidy, "dumbbell"],
  ];

  for (const [name, s, rows, family] of families) {
    it(`${name}: one standalone plan, one plan per pane, same family`, () => {
      const calls = (): Array<[HoverMount, HoverFamily]> =>
        vi.mocked(buildHoverPlan).mock.calls.map((call, k) => [
          call[0],
          (vi.mocked(buildHoverPlan).mock.results[k]!.value as HoverPlan).family,
        ]);
      const host = document.createElement("div");
      document.body.appendChild(host);
      mountChart(host, { spec: spec({ series_order: SERIES, ...s }), rows: rows([undefined]), width: 720, height: 400 });
      expect(calls()).toEqual([["standalone", family]]);
      const standaloneKeys = inputKeys(0, STANDALONE_ONLY);

      vi.mocked(buildHoverPlan).mockClear();
      const figHost = document.createElement("div");
      document.body.appendChild(figHost);
      mountChart(figHost, { spec: spec({ series_order: SERIES, ...s, ...facet }), rows: rows(["P1", "P2"]), width: 838, height: 420 });
      expect(figHost.querySelectorAll(".figure-pane svg").length).toBe(2);
      expect(calls()).toEqual([["pane", family], ["pane", family]]);
      // A coordinated figure (the default for two panes): the pane, like the standalone caller,
      // hands in `onResolve`.
      expect(inputKeys(0, PANE_ONLY)).toEqual(standaloneKeys);
      expect(inputKeys(1, PANE_ONLY)).toEqual(standaloneKeys);
    });
  }
});
