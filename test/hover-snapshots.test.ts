// @vitest-environment jsdom
//
// HOVER SNAPSHOTS: the live-hover output of every chart family, standalone and (where the family
// supports facets) as a 2-pane small-multiples figure, coordinated (the default) and with
// `small_multiples.coordinated_cursor: false`, recorded as files under test/fixtures/hover/.
//
// Why this file exists: goldens never mount, so nothing on the static/PNG path exercises
// crosshair.ts or render-live.ts's hover wiring. This is the characterisation net for splitting
// those two files: a pure move must leave every snapshot here byte-identical. It records what the
// code DOES today, defects included. Whether that is right is for the behavioural tests to say
// (hover-surface-matrix, hover-card-reach, hover-claims-defaults). A snapshot that moves means
// the hover output changed. Read the diff; do not re-record to make the suite pass.
//
// Each snapshot holds, after one pointer move at a fixed data point:
//   - the floating card's HTML (`.tbl-tooltip` innerHTML), or `(no card)` when it is not shown;
//   - per pane, every element the hover machinery adds to the SVG (hit rects, guides, band
//     highlights, the coordinated-cursor echo, highlight pills, the treemap outline), outermost
//     matches only, in document order;
//   - the last `onHover` payload, or `(no onHover call)`.
//
// The files are toMatchFileSnapshot goldens, so `npm run goldens` verifies them and only
// `npm run goldens:record` can add a new one (it never overwrites an existing one).
//
// The snapshots are pretty-printed (one element or text node per line) so a diff names the
// attribute that moved. The printer drops nothing: every attribute and every text node is kept,
// and text is JSON-quoted with non-ASCII escaped, so a whitespace or nbsp change still shows.
import { describe, it, expect, beforeEach } from "vitest";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mountHover, cardShown, hoverFirstMark,
  BAR_MARK, HIST_MARK, DOT_MARK, PLOT_MIDDLE,
} from "./helpers/hover-harness";
import type { BandHoverCtx } from "../src/engine/crosshair";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

// The card is one module-level singleton reused while it stays attached to document.body, so
// clear the body between cases or one case's card leaks into the next.
beforeEach(() => {
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

/** Every class the hover machinery adds to a chart SVG (crosshair.ts, treemap-hover.ts). The hit
 *  rects are included: they carry the geometry the pointer is resolved against. */
const HOVER_CLASSES = [
  "tbl-crosshair", "tbl-crosshair-hit",
  "tbl-band-crosshair-hl", "tbl-band-crosshair-hit",
  "tbl-hist-hover-hl", "tbl-hist-hover-hit",
  "tbl-catline-hl", "tbl-catline-guide", "tbl-catline-hit",
  "tbl-coord", "tbl-hl-pills",
  "tbl-treemap-hover-outline",
];
const HOVER_SELECTOR = HOVER_CLASSES.map((c) => `.${c}`).join(", ");

const quote = (s: string): string =>
  JSON.stringify(s).replace(/[^\x20-\x7e]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);

const attrValue = (v: string): string =>
  v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/[^\x20-\x7e]/g,
    (ch) => `&#x${ch.charCodeAt(0).toString(16)};`);

/** One element or non-empty text node per line, indented by depth. */
function pretty(node: Node, depth = 0): string[] {
  const pad = "  ".repeat(depth);
  if (node.nodeType === 3) {
    const s = node.textContent ?? "";
    return s === "" ? [] : [pad + quote(s)];
  }
  if (node.nodeType !== 1) return [];
  const el = node as Element;
  const attrs = Array.from(el.attributes).map((a) => ` ${a.name}="${attrValue(a.value)}"`).join("");
  const kids = Array.from(el.childNodes).flatMap((c) => pretty(c, depth + 1));
  if (kids.length === 0) return [`${pad}<${el.localName}${attrs}/>`];
  return [`${pad}<${el.localName}${attrs}>`, ...kids, `${pad}</${el.localName}>`];
}

/** The hover elements of one pane: outermost matches only (a `g.tbl-coord` prints its children
 *  itself), in document order. */
function hoverMarkup(svg: SVGSVGElement): string[] {
  return Array.from(svg.querySelectorAll(HOVER_SELECTOR))
    .filter((el) => !el.parentElement?.closest(HOVER_SELECTOR))
    .flatMap((el) => pretty(el));
}

function cardMarkup(): string[] {
  if (!cardShown()) return ["(no card)"];
  const tip = document.body.querySelector<HTMLElement>(".tbl-tooltip")!;
  return Array.from(tip.childNodes).flatMap((c) => pretty(c));
}

function snapshotText(svgs: SVGSVGElement[], hovers: Array<BandHoverCtx | null>): string {
  const last = hovers.length ? hovers[hovers.length - 1] : undefined;
  return [
    "# card",
    ...cardMarkup(),
    ...svgs.flatMap((svg, i) => [`# pane ${i}${i === 0 ? " (hovered)" : ""}`, ...hoverMarkup(svg)]),
    "# onHover (last payload)",
    last === undefined ? "(no onHover call)" : JSON.stringify(last, null, 2),
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Fixtures: the shapes hover-surface-matrix.test.ts uses, at defaults (no hover dial is set).
// ---------------------------------------------------------------------------

const sm = { small_multiples: { columns: 2, mode: "shared" } };
const FACET_COLS = { columns: { x: "time", value: "value", series: "series", facet: "pane" } };
const spec = (s: Record<string, unknown>): ChartSpec => ({ title: "t", data: "inline", ...s }) as unknown as ChartSpec;
const paned = (f: boolean) => (f ? { data: "d.csv", ...FACET_COLS, ...sm } : {});

const catRows = (series: Array<[string, number, number]>, pane?: string): TidyRow[] =>
  series.flatMap(([s, a, b]) => [
    { ...(pane ? { pane } : {}), time: "A", series: s, value: String(a) },
    { ...(pane ? { pane } : {}), time: "B", series: s, value: String(b) },
  ]) as unknown as TidyRow[];
const cat = (f: boolean, series: Array<[string, number, number]>): TidyRow[] =>
  f
    ? [...catRows(series, "P1"), ...catRows(series.map(([s, a, b]) => [s, a / 2, b / 2] as [string, number, number]), "P2")]
    : catRows(series);

/** Month-spaced: a temporal pane spanning less than a month draws no ticks, and so no axis echo. */
const temporalRows = (f: boolean): TidyRow[] =>
  ["2020-01-01", "2020-02-01", "2020-03-01"].flatMap((t, i) =>
    ["A", "B"].flatMap((s) => [
      { ...(f ? { pane: "P1" } : {}), time: t, series: s, value: String(3 + i) },
      ...(f ? [{ pane: "P2", time: t, series: s, value: String(5 + i) }] : []),
    ]),
  ) as unknown as TidyRow[];

const histRows = (f: boolean): TidyRow[] =>
  (f ? ["P1", "P2"] : [undefined]).flatMap((pane) =>
    Array.from({ length: 16 }, (_, v) => ({ ...(pane ? { pane } : {}), amount: String(v) })),
  ) as unknown as TidyRow[];

const wfRows = (f: boolean): TidyRow[] =>
  (f ? ["P1", "P2"] : [""]).flatMap((p) =>
    [["Start", "10", "total"], ["Up", "5", "delta"], ["Down", "-3", "delta"]].map(([t, v, k]) => ({
      ...(p ? { pane: p } : {}), time: t, value: v, kind: k,
    })),
  ) as unknown as TidyRow[];

const TIMELINE_SPEC = spec({
  chartType: "timeline", xAxisType: "temporal", data: "d.csv",
  columns: { x: "date", label: "title", series: "kind" }, series_order: ["policy", "cohort"],
});
const TIMELINE_ROWS = [
  { date: "2026", title: "Policy begins", kind: "policy" }, { date: "2030", title: "First cohort born", kind: "policy" },
  { date: "2055", title: "Projection ends", kind: "cohort" }, { date: "2095", title: "Cohort turns 65", kind: "cohort" },
] as unknown as TidyRow[];

const TREEMAP_SPEC = spec({
  chartType: "treemap", xAxisType: "categorical", data: "d.csv",
  columns: { x: "category", value: "amount", series: "group" },
});
const TREEMAP_ROWS = [
  { group: "Mandatory", category: "Social Security", amount: "1461" },
  { group: "Mandatory", category: "Medicare", amount: "874" },
  { group: "Discretionary", category: "Defense", amount: "850" },
  { group: "Discretionary", category: "Education", amount: "300" },
] as unknown as TidyRow[];

// ---------------------------------------------------------------------------
// Hovering. A pointer move on the attached hit rect at a fixed mark (hover-harness's
// hoverFirstMark), except where the family has no hit rect.
// ---------------------------------------------------------------------------

/** The waterfall's second bar, a delta step: it draws a value pill where a total step does not. */
const WATERFALL_DELTA_MARK = `${BAR_MARK}:nth-of-type(2)`;

/** Treemap hover listens on each tile group (`pointerenter`), not a hit rect. */
function hoverTreemapTile(svg: SVGSVGElement): void {
  const tile = Array.from(svg.querySelectorAll<SVGRectElement>("rect.tbl-treemap-tile"))
    .find((r) => (r.parentElement!.getAttribute("aria-label") ?? "").startsWith("Mandatory · Medicare"))!;
  tile.parentElement!.dispatchEvent(new PointerEvent("pointerenter", { clientX: 10, clientY: 10, bubbles: true }));
}

/** A timeline attaches no hover machinery (static by design, render-live.ts). The move is sent to
 *  the SVG anyway, so the snapshot records that nothing responds. */
function hoverTimeline(svg: SVGSVGElement): void {
  const vb = svg.viewBox.baseVal;
  svg.dispatchEvent(new PointerEvent("pointermove", { clientX: vb.width / 2, clientY: vb.height / 2, bubbles: true }));
}

type Case = { spec: ChartSpec; rows: TidyRow[]; hover: (svg: SVGSVGElement) => void };
type Family = {
  name: string;
  slug: string;
  mount: (faceted: boolean) => Case;
  /** false: no 2-pane cell — the family rejects small_multiples (timeline, treemap) or draws
   *  facets as groups in one chart (a horizontal dumbbell). */
  panes?: false;
};

const FAMILIES: Family[] = [
  {
    name: "line (temporal)", slug: "line-temporal",
    mount: (f) => ({
      spec: spec({ chartType: "line", xAxisType: "temporal", series_order: ["A", "B"], ...paned(f) }),
      rows: temporalRows(f),
      hover: (svg) => hoverFirstMark(svg, PLOT_MIDDLE),
    }),
  },
  {
    name: "line (categorical x)", slug: "line-categorical",
    mount: (f) => ({
      spec: spec({ chartType: "line", xAxisType: "categorical", series_order: ["A", "B"], ...paned(f) }),
      rows: cat(f, [["A", 10, 20], ["B", 12, 22]]),
      hover: (svg) => hoverFirstMark(svg, PLOT_MIDDLE),
    }),
  },
  {
    name: "area (temporal)", slug: "area",
    mount: (f) => ({
      spec: spec({ chartType: "area", xAxisType: "temporal", series_order: ["A", "B"], ...paned(f) }),
      rows: temporalRows(f),
      hover: (svg) => hoverFirstMark(svg, PLOT_MIDDLE),
    }),
  },
  {
    name: "bar (plain)", slug: "bar",
    mount: (f) => ({
      spec: spec({ chartType: "bar", xAxisType: "categorical", ...paned(f) }),
      rows: cat(f, [["S", 6, 4]]),
      hover: (svg) => hoverFirstMark(svg, BAR_MARK),
    }),
  },
  {
    name: "bar (grouped)", slug: "bar-grouped",
    mount: (f) => ({
      spec: spec({ chartType: "bar", xAxisType: "categorical", series_order: ["Up", "Down"], ...paned(f) }),
      rows: cat(f, [["Up", 6, 5], ["Down", 4, 2]]),
      hover: (svg) => hoverFirstMark(svg, BAR_MARK),
    }),
  },
  {
    name: "stacked (all positive: pills)", slug: "stacked-pills",
    mount: (f) => ({
      spec: spec({ chartType: "stacked", xAxisType: "categorical", series_order: ["Up", "Down"], ...paned(f) }),
      rows: cat(f, [["Up", 6, 5], ["Down", 4, 2]]),
      hover: (svg) => hoverFirstMark(svg, BAR_MARK),
    }),
  },
  {
    name: "stacked (with a negative: card)", slug: "stacked-card",
    mount: (f) => ({
      spec: spec({ chartType: "stacked", xAxisType: "categorical", series_order: ["Up", "Down"], ...paned(f) }),
      rows: cat(f, [["Up", 6, 5], ["Down", -4, -2]]),
      hover: (svg) => hoverFirstMark(svg, BAR_MARK),
    }),
  },
  {
    name: "dumbbell (horizontal)", slug: "dumbbell",
    mount: (f) => ({
      spec: spec({ chartType: "dumbbell", xAxisType: "categorical", series_order: ["A", "B"], ...paned(f) }),
      rows: cat(f, [["A", 3, 4], ["B", 7, 9]]),
      hover: (svg) => hoverFirstMark(svg, DOT_MARK),
    }),
    panes: false,
  },
  {
    name: "dumbbell (vertical)", slug: "dumbbell-vertical",
    mount: (f) => ({
      spec: spec({ chartType: "dumbbell", orientation: "vertical", xAxisType: "categorical", series_order: ["A", "B"], ...paned(f) }),
      rows: cat(f, [["A", 3, 4], ["B", 7, 9]]),
      hover: (svg) => hoverFirstMark(svg, DOT_MARK),
    }),
  },
  {
    name: "waterfall", slug: "waterfall",
    mount: (f) => ({
      spec: spec({
        chartType: "waterfall", xAxisType: "categorical",
        columns: { x: "time", value: "value", kind: "kind", ...(f ? { facet: "pane" } : {}) },
        ...(f ? { data: "d.csv", ...sm } : {}),
      }),
      rows: wfRows(f),
      hover: (svg) => hoverFirstMark(svg, WATERFALL_DELTA_MARK),
    }),
  },
  {
    name: "histogram", slug: "histogram",
    mount: (f) => ({
      spec: spec({
        chartType: "histogram", xAxisType: "numeric", histogram: { bins: 4, domain: [0, 20] },
        columns: { x: "amount", ...(f ? { facet: "pane" } : {}) },
        ...(f ? { data: "d.csv", ...sm } : {}),
      }),
      rows: histRows(f),
      hover: (svg) => hoverFirstMark(svg, HIST_MARK),
    }),
  },
  {
    name: "timeline", slug: "timeline",
    mount: () => ({ spec: TIMELINE_SPEC, rows: TIMELINE_ROWS, hover: hoverTimeline }),
    panes: false,
  },
  {
    name: "treemap", slug: "treemap",
    mount: () => ({ spec: TREEMAP_SPEC, rows: TREEMAP_ROWS, hover: hoverTreemapTile }),
    panes: false,
  },
];

/** A 2-pane cell's figure with the cross-pane cursor off: each pane hovers on its own. */
const uncoordinated = (s: ChartSpec): ChartSpec => {
  const sm = (s as { small_multiples?: Record<string, unknown> }).small_multiples;
  return { ...s, small_multiples: { ...sm, coordinated_cursor: false } } as ChartSpec;
};

type Layout = "standalone" | "2-pane" | "2-pane-uncoordinated";
const LAYOUT_KEY: Record<Layout, string> = {
  "standalone": "standalone",
  "2-pane": "2-pane",
  "2-pane-uncoordinated": "2-pane, coordinated_cursor: false",
};

const cells = FAMILIES.flatMap((fam) =>
  (fam.panes === false ? ["standalone"] as const : ["standalone", "2-pane", "2-pane-uncoordinated"] as const)
    .map((layout: Layout) => ({
      fam,
      faceted: layout !== "standalone",
      layout,
      key: `${fam.name} · ${LAYOUT_KEY[layout]}`,
      file: `./fixtures/hover/${fam.slug}.${layout}.txt`,
    })),
);

/** Mount, hover pane 0 once, and collect every onHover call. */
type Cell = (typeof cells)[number];

function hoverCell({ fam, faceted, layout }: Cell) {
  const { spec: s0, rows, hover } = fam.mount(faceted);
  const s = layout === "2-pane-uncoordinated" ? uncoordinated(s0) : s0;
  const hovers: Array<BandHoverCtx | null> = [];
  const m = mountHover(s, rows, faceted, { onHover: (ctx) => { hovers.push(ctx); } });
  hover(m.svgs[0]!);
  return { m, hovers };
}

// `onHover` is wired through attachBandCrosshair only (MountOptions.onHover in render-live.ts:
// "Not yet wired for other chart types"). These are the families that reach it; on the others the
// snapshot records `(no onHover call)`, and the test below asserts that too, so a family gaining
// or losing the callback is a visible change rather than a silent snapshot edit.
const ON_HOVER_WIRED = new Set(["bar", "bar-grouped", "stacked-pills", "stacked-card", "waterfall"]);

describe("hover snapshots — every family, standalone and 2-pane, at one fixed hover", () => {
  for (const cell of cells) {
    const { fam, faceted, key, file } = cell;
    it(key, async () => {
      const { m, hovers } = hoverCell(cell);
      expect(m.svgs.length, `${key}: pane count`).toBe(faceted ? 2 : 1);
      if (ON_HOVER_WIRED.has(fam.slug)) {
        expect(hovers.length, `${key}: onHover was not called on the move`).toBeGreaterThan(0);
        expect(hovers[hovers.length - 1], `${key}: onHover payload`).not.toBeNull();
      } else {
        expect(hovers, `${key}: onHover is not wired for this family`).toEqual([]);
      }
      await expect(snapshotText(m.svgs, hovers)).toMatchFileSnapshot(file);
    });
  }

  it("every snapshot shows a hover response, except the timeline's (it has no hover)", () => {
    // Guards against a snapshot that records nothing because the pointer missed (a fixture
    // problem) rather than because the family draws nothing.
    for (const cell of cells) {
      const { fam, key } = cell;
      document.body.innerHTML = "";
      const { m, hovers } = hoverCell(cell);
      const responded =
        cardShown() ||
        hovers.some((h) => h !== null) ||
        m.svgs.some((svg) =>
          svg.querySelector('g.tbl-coord[opacity="1"], .tbl-hl-pills, .tbl-treemap-hover-outline') !== null ||
          Array.from(svg.querySelectorAll(".tbl-crosshair, .tbl-band-crosshair-hl, .tbl-hist-hover-hl, .tbl-catline-hl, .tbl-catline-guide"))
            .some((el) => el.getAttribute("opacity") !== "0"));
      expect(responded, key).toBe(fam.slug !== "timeline");
    }
  });

  it("every file in fixtures/hover/ belongs to a cell (no orphans left by a renamed case)", () => {
    // goldens.mjs's orphan guard covers *.golden.svg only, so these files need their own.
    const onDisk = readdirSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "hover")).sort();
    expect(onDisk).toEqual(cells.map((c) => c.file.replace("./fixtures/hover/", "")).sort());
  });
});

// ---------------------------------------------------------------------------
// B2 (review 2026-10-15): teardown leaves the hover card showing and never sends onHover(null).
// The condition each case asserts: after hover then teardown(), no card is shown, and if onHover
// received a payload, the last call is null. Today only the treemap honours the card half
// (Ruling 21); for the others these are `it.fails` until the lifecycle fix (plan T2.2) lands,
// when they flip to `it`.
// ---------------------------------------------------------------------------

function teardownLeavesNothing(cell: Cell): void {
  const { m, hovers } = hoverCell(cell);
  m.teardown();
  expect(cardShown(), "the hover card is still shown after teardown").toBe(false);
  if (hovers.some((h) => h !== null)) {
    expect(hovers[hovers.length - 1], "onHover's last call after teardown is not null").toBeNull();
  }
}

// Every cell where the hover shows a card or sends an onHover payload, so there is something for
// teardown to clear. Cells with neither (a coordinated pane of a family onHover does not reach)
// would pass vacuously and are left out. The last test below checks this list against the cells.
const B2_FAILS_TODAY = [
  "line (temporal) · standalone",
  "line (categorical x) · standalone",
  "area (temporal) · standalone",
  "bar (plain) · standalone",
  "bar (plain) · 2-pane",
  "bar (grouped) · standalone",
  "bar (grouped) · 2-pane",
  "stacked (all positive: pills) · standalone",
  "stacked (all positive: pills) · 2-pane",
  "stacked (with a negative: card) · standalone",
  "stacked (with a negative: card) · 2-pane",
  "dumbbell (horizontal) · standalone",
  "dumbbell (vertical) · standalone",
  "dumbbell (vertical) · 2-pane",
  "waterfall · standalone",
  "waterfall · 2-pane",
  "histogram · standalone",
  // Every pane under coordinated_cursor: false hovers with its own card.
  "line (temporal) · 2-pane, coordinated_cursor: false",
  "line (categorical x) · 2-pane, coordinated_cursor: false",
  "area (temporal) · 2-pane, coordinated_cursor: false",
  "bar (plain) · 2-pane, coordinated_cursor: false",
  "bar (grouped) · 2-pane, coordinated_cursor: false",
  "stacked (all positive: pills) · 2-pane, coordinated_cursor: false",
  "stacked (with a negative: card) · 2-pane, coordinated_cursor: false",
  "dumbbell (vertical) · 2-pane, coordinated_cursor: false",
  "waterfall · 2-pane, coordinated_cursor: false",
  "histogram · 2-pane, coordinated_cursor: false",
];

describe("B2: teardown() hides the hover card and sends onHover(null)", () => {
  for (const key of B2_FAILS_TODAY) {
    const cell = cells.find((c) => c.key === key)!;
    it.fails(`B2: ${key}`, () => teardownLeavesNothing(cell));
  }

  it("B2: treemap · standalone (already hides its card on teardown, Ruling 21)", () => {
    const cell = cells.find((c) => c.key === "treemap · standalone")!;
    const { m } = hoverCell(cell);
    expect(cardShown(), "precondition: the treemap hover shows a card").toBe(true);
    m.teardown();
    expect(cardShown()).toBe(false);
  });

  it("the B2 list is exactly the cells whose hover leaves something for teardown to clear", () => {
    // An `it.fails` also passes when the test throws for an unrelated reason (a missed hover, a
    // misspelt key). This pins the precondition: every listed cell shows a card or sends an
    // onHover payload, and no other non-treemap cell does.
    const live = cells
      .filter((cell) => {
        document.body.innerHTML = "";
        const { hovers } = hoverCell(cell);
        return cell.fam.slug !== "treemap" && (cardShown() || hovers.some((h) => h !== null));
      })
      .map((c) => c.key);
    expect(live.sort()).toEqual([...B2_FAILS_TODAY].sort());
  });
});
