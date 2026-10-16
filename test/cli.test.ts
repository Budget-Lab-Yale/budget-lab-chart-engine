/**
 * Tests for src/cli/index.ts — calls exported functions directly (no subprocess).
 *
 * render tests inject a stub liveBundleJs so the test suite does not need a
 * pre-built dist/embed/live.js.
 */

import { describe, it, expect, afterEach } from "vitest";
import { existsSync, unlinkSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import {
  runValidate,
  runRender,
  runAssets,
  runSnapshot,
  parseServeArgs,
  listenServe,
  serveUrl,
  snapshotDiffPath,
  startServe,
  type ServeArgs,
} from "../src/cli/index";
import * as http from "node:http";
import { PNG } from "pngjs";
import { BUNDLE_PATH } from "./setup/global-build";
import { CHART_CSS } from "../src/embed/styles";
import { HAS_BROWSER } from "./helpers/browser";
import { HORIZONTAL_FACET_ERROR } from "../src/spec/facet-groups";

const EXAMPLE_SPEC = resolve(
  fileURLToPath(new URL("./fixtures/sample-chart/chart.yaml", import.meta.url)),
);

const TIMELINE_DENSE_SPEC = resolve(
  fileURLToPath(new URL("./fixtures/timeline-dense/chart.yaml", import.meta.url)),
);

const TIMELINE_SMALL_SPEC = resolve(
  fileURLToPath(new URL("./fixtures/timeline-small/chart.yaml", import.meta.url)),
);

const TIMELINE_RIGHT_LEGEND_SPEC = resolve(
  fileURLToPath(new URL("./fixtures/timeline-right-legend/chart.yaml", import.meta.url)),
);

const TIMELINE_TOP_LEGEND_SPEC = resolve(
  fileURLToPath(new URL("./fixtures/timeline-top-legend/chart.yaml", import.meta.url)),
);

// Stub live bundle — just needs to be a non-empty JS string.
const STUB_BUNDLE = `var BudgetLabChart={mountChart:function(el,opts){el.innerHTML='<p>chart</p>';}};`;

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

const tempFiles: string[] = [];
afterEach(() => {
  for (const f of tempFiles) {
    try {
      if (existsSync(f)) unlinkSync(f);
    } catch {
      // ignore cleanup errors
    }
  }
  tempFiles.length = 0;
});

// ---------------------------------------------------------------------------
// validate: success
// ---------------------------------------------------------------------------

describe("runValidate — success", () => {
  it("returns exitCode 0 and an OK message for the example spec", async () => {
    const result = await runValidate(EXAMPLE_SPEC);
    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/^OK:/);
    expect(result.message).toContain(EXAMPLE_SPEC);
    // "(<N> rows, <M> series)"
    expect(result.message).toMatch(/\(\d+ rows, \d+ series\)/);
  });
});

// ---------------------------------------------------------------------------
// validate: errors
// ---------------------------------------------------------------------------

describe("runValidate — bad enum", () => {
  it("returns exitCode 1 when xAxisType is invalid", async () => {
    const specPath = join(tmpdir(), `cli-test-bad-enum-${Date.now()}.yaml`);
    tempFiles.push(specPath);
    writeFileSync(
      specPath,
      `chartType: line\ntitle: Test\nxAxisType: weekly\ndata: data.csv\n`,
      "utf8",
    );
    const result = await runValidate(specPath);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/xAxisType/);
    expect(result.message).toMatch(/numeric, temporal, quarterly/);
  });
});

describe("runValidate — series_order names missing series", () => {
  it("returns exitCode 1 and names the missing series", async () => {
    // Write a temporary spec + CSV where series_order names a series not in data.
    const dir = join(tmpdir(), `cli-test-series-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const specPath = join(dir, "chart.yaml");
    const csvPath = join(dir, "data.csv");
    tempFiles.push(specPath, csvPath);

    writeFileSync(
      csvPath,
      "time,series,value\n2021-01-01,real-series,1.0\n",
      "utf8",
    );
    writeFileSync(
      specPath,
      [
        "chartType: line",
        "title: Test",
        "xAxisType: temporal",
        "data: data.csv",
        "series_order:",
        "  - real-series",
        "  - missing-series",
      ].join("\n") + "\n",
      "utf8",
    );

    const result = await runValidate(specPath);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/series_order/);
    expect(result.message).toMatch(/missing-series/);
  });
});

describe("runValidate — series_order lists a series twice", () => {
  it("returns exitCode 1 and names the field and the repeated series", async () => {
    const dir = join(tmpdir(), `cli-test-series-dup-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const specPath = join(dir, "chart.yaml");
    const csvPath = join(dir, "data.csv");
    tempFiles.push(specPath, csvPath);
    writeFileSync(csvPath, "time,series,value\n2021-01-01,a,1.0\n2021-01-01,b,2.0\n", "utf8");
    writeFileSync(
      specPath,
      ["chartType: line", "title: Test", "xAxisType: temporal", "data: data.csv", "series_order: [a, b, a]"].join("\n") + "\n",
      "utf8",
    );
    const result = await runValidate(specPath);
    expect(result.exitCode).toBe(1);
    expect(result.message).toBe(`${specPath}: /series_order: "a" appears more than once`);
  });
});

describe("runValidate / runRender — columns.facet on a horizontal chart", () => {
  // Rejected (spec/facet-groups.ts); snapshot and serve load through the same loadSpecAndRows.
  it("fails validation with the one message and writes no HTML", async () => {
    const dir = join(tmpdir(), `cli-test-hfacet-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const specPath = join(dir, "chart.yaml");
    const csvPath = join(dir, "data.csv");
    const outPath = join(dir, "out.html");
    tempFiles.push(specPath, csvPath, outPath);
    writeFileSync(csvPath, "cat,pane,value\na,P,1\nb,Q,2\n", "utf8");
    writeFileSync(
      specPath,
      [
        "chartType: bar", "orientation: horizontal", "title: Test", "xAxisType: categorical", "data: data.csv",
        "columns: { x: cat, value: value, facet: pane }",
      ].join("\n") + "\n",
      "utf8",
    );
    const validated = await runValidate(specPath);
    expect(validated.exitCode).toBe(1);
    expect(validated.message).toBe(`${specPath}: ${HORIZONTAL_FACET_ERROR}`);
    const rendered = await runRender(specPath, { outPath, liveBundleJs: STUB_BUNDLE, css: "body{}" });
    expect(rendered.exitCode).toBe(1);
    expect(rendered.message).toContain(HORIZONTAL_FACET_ERROR);
    expect(existsSync(outPath)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validate: timeline warnings
// ---------------------------------------------------------------------------

describe("runValidate — timeline warnings", () => {
  it("passes with warnings appended (exit 0)", async () => {
    const result = await runValidate(TIMELINE_DENSE_SPEC);
    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/^OK: /);
    expect(result.message).toMatch(/warning: timeline has 21 events/);
    expect(result.message).toMatch(/warning: horizontal layout needs more than 2 label rows per side at the 920px export width/);
  });

  it("passes with no warnings for a small timeline (exit 0, no warning lines)", async () => {
    const result = await runValidate(TIMELINE_SMALL_SPEC);
    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/^OK: /);
    expect(result.message).not.toMatch(/warning:/);
  });

  // Codex scenario: a right-hand legend narrows the export's chart width from INNER_W (920) to
  // 744 (INNER_W - LEGEND_COLUMN_WIDTH - LEGEND_GAP), so a layout that fits at 920 can overflow
  // max_rows at the width the PNG actually draws. validate must check the SAME width (Ruling 17).
  it("warns of overflow at the narrower right-legend export width (744px), naming that width", async () => {
    const result = await runValidate(TIMELINE_RIGHT_LEGEND_SPEC);
    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/^OK: /);
    expect(result.message).toMatch(/warning: horizontal layout needs more than 1 label rows per side at the 744px export width/);
  });

  it("warns (exit 0) when an explicit vertical_lanes: columns meets three lanes (Ruling 25)", async () => {
    const dir = join(tmpdir(), `cli-test-vertical-lanes-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const specPath = join(dir, "chart.yaml");
    const csvPath = join(dir, "data.csv");
    tempFiles.push(specPath, csvPath);
    writeFileSync(csvPath, "date,label,kind\n2020,A,a\n2025,B,b\n2030,C,c\n", "utf8");
    const spec = (vl: string) => [
      "chartType: timeline", "title: T", "xAxisType: temporal", "orientation: vertical", "data: data.csv",
      "columns: { x: date, label: label, series: kind }", `timeline: { lanes: true${vl} }`,
    ].join("\n") + "\n";
    writeFileSync(specPath, spec(", vertical_lanes: columns"), "utf8");
    const result = await runValidate(specPath);
    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/^OK: /);
    expect(result.message).toMatch(/warning: timeline\.vertical_lanes "columns" draws lane columns only for exactly two lanes; with 3 lanes a vertical render draws one track/);
    writeFileSync(specPath, spec(""), "utf8");
    expect((await runValidate(specPath)).message).not.toMatch(/warning:/);
  });

  it("does not warn for the same data with a top legend (fits at the full 920px width)", async () => {
    const result = await runValidate(TIMELINE_TOP_LEGEND_SPEC);
    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/^OK: /);
    expect(result.message).not.toMatch(/warning:/);
  });
});

// ---------------------------------------------------------------------------
// render: success
// ---------------------------------------------------------------------------

describe("runRender — success", () => {
  it("writes an HTML file and returns exitCode 0", async () => {
    const outPath = join(tmpdir(), `cli-test-render-${Date.now()}.html`);
    tempFiles.push(outPath);

    const result = await runRender(EXAMPLE_SPEC, {
      outPath,
      liveBundleJs: STUB_BUNDLE,
      css: "body{}",
    });

    expect(result.exitCode).toBe(0);
    expect(result.htmlPath).toBe(outPath);
    expect(result.message).toContain(outPath);
    expect(existsSync(outPath)).toBe(true);
  });

  it("HTML output contains doctype, mountChart call, and the chart title", async () => {
    const outPath = join(tmpdir(), `cli-test-render-content-${Date.now()}.html`);
    tempFiles.push(outPath);

    await runRender(EXAMPLE_SPEC, {
      outPath,
      liveBundleJs: STUB_BUNDLE,
      css: "body{}",
    });

    const html = readFileSync(outPath, "utf8");
    expect(html).toMatch(/<!doctype html/i);
    expect(html).toContain("BudgetLabChart.mountChart");
    // The fixture spec title
    expect(html).toContain("Sample Chart");
  });

  it("defaults output path to <specBasename>.html in cwd when -o is omitted", async () => {
    // We need to know where it will land: resolve(process.cwd(), "chart.html")
    const expectedOut = resolve(process.cwd(), "chart.html");
    tempFiles.push(expectedOut);

    const result = await runRender(EXAMPLE_SPEC, {
      liveBundleJs: STUB_BUNDLE,
      css: "body{}",
    });

    expect(result.exitCode).toBe(0);
    expect(result.htmlPath).toBe(expectedOut);
    expect(existsSync(expectedOut)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// render: validation failure
// ---------------------------------------------------------------------------

describe("runRender — validation failure", () => {
  it("returns exitCode 1 and does NOT write a file when spec is invalid", async () => {
    const specPath = join(tmpdir(), `cli-test-render-invalid-${Date.now()}.yaml`);
    const outPath = join(tmpdir(), `cli-test-render-invalid-${Date.now()}.html`);
    tempFiles.push(specPath, outPath);

    writeFileSync(
      specPath,
      `chartType: line\ntitle: Test\nxAxisType: weekly\ndata: data.csv\n`,
      "utf8",
    );

    const result = await runRender(specPath, {
      outPath,
      liveBundleJs: STUB_BUNDLE,
      css: "body{}",
    });

    expect(result.exitCode).toBe(1);
    expect(existsSync(outPath)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assets + render --assets-base
// ---------------------------------------------------------------------------

describe("runAssets", () => {
  it("writes the three versioned files and reports them as a manifest", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "cli-assets-"));

    const result = await runAssets({
      outDir,
      version: "2.0.0",
      liveBundleJs: STUB_BUNDLE,
      css: ".figure-card{color:red}",
    });

    expect(result.exitCode).toBe(0);
    expect(result.manifest).toEqual({
      version: "2.0.0",
      runtime: "engine-2.0.0.js",
      styles: "chart-2.0.0.css",
    });
    expect(readFileSync(join(outDir, "engine-2.0.0.js"), "utf8")).toBe(STUB_BUNDLE);

    // The stylesheet carries the font, so a page needs one <link> and no font request.
    const css = readFileSync(join(outDir, "chart-2.0.0.css"), "utf8");
    expect(css).toContain("data:font/ttf;base64,");
    expect(css).toContain(".figure-card{color:red}");
  });

  it("fails cleanly when the output directory cannot be created", async () => {
    // Parent is a regular file, so mkdir -p cannot succeed (ENOTDIR on every platform).
    const blocker = join(mkdtempSync(join(tmpdir(), "cli-assets-bad-")), "not-a-dir");
    writeFileSync(blocker, "x");
    const result = await runAssets({
      outDir: join(blocker, "assets"),
      version: "2.0.0",
      liveBundleJs: STUB_BUNDLE,
      css: "body{}",
    });
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/cannot write assets/);
  });
});

describe("runRender with shared assets", () => {
  it("links the assets and needs no live bundle at all", async () => {
    const outPath = join(tmpdir(), `cli-test-render-shared-${Date.now()}.html`);
    tempFiles.push(outPath);

    const result = await runRender(EXAMPLE_SPEC, {
      outPath,
      css: "body{}",
      assets: { base: "../../embed/v1", version: "2.0.0" },
    });

    expect(result.exitCode).toBe(0);
    const html = readFileSync(outPath, "utf8");
    expect(html).toContain('<script src="../../embed/v1/engine-2.0.0.js"></script>');
    expect(html).toContain('<link rel="stylesheet" href="../../embed/v1/chart-2.0.0.css">');
    expect(html).not.toContain("body{}");
  });
});

// ---------------------------------------------------------------------------
// validate: treemap warnings
// ---------------------------------------------------------------------------

describe("runValidate — treemap warnings", () => {
  function treemapSpec(rowsCsv: string, extraYaml: string[] = []): string {
    const dir = mkdtempSync(join(tmpdir(), "cli-test-treemap-"));
    const specPath = join(dir, "chart.yaml");
    const csvPath = join(dir, "data.csv");
    tempFiles.push(specPath, csvPath);
    writeFileSync(csvPath, rowsCsv, "utf8");
    writeFileSync(
      specPath,
      ["chartType: treemap", "title: Test", "xAxisType: categorical", "data: data.csv", "columns:", "  x: category", "  value: amount", ...extraYaml].join("\n") + "\n",
      "utf8",
    );
    return specPath;
  }
  const csv = (rows: Array<[string, number]>) => "category,amount\n" + rows.map(([c, a]) => `${c},${a}`).join("\n") + "\n";
  const count = (s: string, needle: string) => s.split(needle).length - 1;

  it("warns once about more than 30 tiles and exits 0", async () => {
    const specPath = treemapSpec(csv(Array.from({ length: 40 }, (_, i): [string, number] => [`Cat ${i}`, 100 + i])));
    const result = await runValidate(specPath);
    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/^OK: /);
    expect(count(result.message, "40 tiles")).toBe(1);
    expect(result.message).toMatch(/warning: treemap: 40 tiles; consider grouping small categories into "Other"/);
  });

  it("prints each warning exactly once (no double emission of the data warnings)", async () => {
    const specPath = treemapSpec(csv([["Big", 100], ["Nothing", 0]]));
    const result = await runValidate(specPath);
    expect(result.exitCode).toBe(0);
    expect(count(result.message, "zero-value row not drawn")).toBe(1);
  });

  it("warns when most tiles are unlabelled at the 920px export width, naming that width", async () => {
    const specPath = treemapSpec(csv([["Big", 1_000_000], ...Array.from({ length: 6 }, (_, i): [string, number] => [`Tiny${i}`, 1])]));
    const result = await runValidate(specPath);
    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/warning: treemap: 6 of 7 tiles are unlabelled at 920px wide/);
  });

  it("judges a grouped treemap with a right-hand legend at the narrower width the export draws it at (744px)", async () => {
    const rows = [["A", "Big", 1_000_000], ["B", "Big two", 1_000_000], ...Array.from({ length: 6 }, (_, i) => ["B", `Tiny${i}`, 1])];
    const specPath = treemapSpec("group,category,amount\n" + rows.map((r) => r.join(",")).join("\n") + "\n", ["  series: group", "legendPosition: right"]);
    const result = await runValidate(specPath);
    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/warning: treemap: 6 of 8 tiles are unlabelled at 744px wide/);
  });

  it("prints no warnings for a well-labelled treemap", async () => {
    const specPath = treemapSpec(csv([["Alpha", 500], ["Beta", 300], ["Gamma", 200]]));
    const result = await runValidate(specPath);
    expect(result.exitCode).toBe(0);
    expect(result.message).not.toMatch(/warning:/);
  });
});

// ---------------------------------------------------------------------------
// validate: a lone yAxisPolicy bound past every value in the data (Ruling 74)
// ---------------------------------------------------------------------------

// The warning is a statement about the DATA, never about what the chart draws: the drawn axis also
// answers to nice rounding, label headroom, reference markers, autoWiden and (in shared small
// multiples) the other panes, so a claim about visibility was false in some case whatever it said.
describe("runValidate — a lone yAxisPolicy bound past every value in the data", () => {
  function chartSpec(chartType: string, rowsCsv: string, extraYaml: string[], xAxisType = "categorical"): string {
    const dir = mkdtempSync(join(tmpdir(), "cli-test-lone-bound-"));
    const specPath = join(dir, "chart.yaml");
    const csvPath = join(dir, "data.csv");
    tempFiles.push(specPath, csvPath);
    writeFileSync(csvPath, rowsCsv, "utf8");
    writeFileSync(
      specPath,
      [`chartType: ${chartType}`, "title: Test", `xAxisType: ${xAxisType}`, "data: data.csv", ...extraYaml].join("\n") + "\n",
      "utf8",
    );
    return specPath;
  }
  const flat = "c,v\na,8\nb,31\n";
  const faceted = "f,c,v\nA,a,8\nA,b,31\nB,a,60\nB,b,80\n";
  const bar = (policy: string[]) => chartSpec("bar", flat, ["columns:", "  x: c", "  value: v", "yAxisPolicy:", ...policy]);
  const warningsOf = (message: string) => message.split("\n").filter((l) => l.includes("warning:"));

  it("warns, naming the bound, when a lone min is above every value (exit 0)", async () => {
    const result = await runValidate(bar(["  min: 50"]));
    expect(result.exitCode).toBe(0);
    expect(warningsOf(result.message)).toEqual([
      expect.stringMatching(/: warning: yAxisPolicy\.min \(50\) is above every value in the data$/),
    ]);
  });

  it("warns when a lone max is below every value, whatever the bars draw from their 0 base", async () => {
    const neg = await runValidate(bar(["  max: -5"]));
    expect(warningsOf(neg.message)).toEqual([
      expect.stringMatching(/warning: yAxisPolicy\.max \(-5\) is below every value in the data$/),
    ]);
    // Each bar still draws its 0–5 stretch here; the warning says only what is true of the data.
    const partial = await runValidate(bar(["  max: 5"]));
    expect(warningsOf(partial.message)).toEqual([
      expect.stringMatching(/warning: yAxisPolicy\.max \(5\) is below every value in the data$/),
    ]);
  });

  it("makes no claim about what the chart shows", async () => {
    for (const policy of [["  min: 50"], ["  max: -5"]]) {
      const lines = warningsOf((await runValidate(bar(policy))).message);
      expect(lines).toHaveLength(1);
      expect(lines[0]!.split("warning:")[1]).not.toMatch(/show|draw|visible|hid/);
    }
  });

  it("names only the pane whose values all lie past the bound, in either mode", async () => {
    for (const mode of ["shared", "per-pane"]) {
      const result = await runValidate(
        chartSpec("bar", faceted, [
          "columns:", "  x: c", "  value: v", "  facet: f", "small_multiples:", "  columns: 2", `  mode: ${mode}`,
          "yAxisPolicy:", "  min: 50",
        ]),
      );
      expect(result.exitCode).toBe(0);
      expect(warningsOf(result.message), mode).toEqual([
        expect.stringMatching(/warning: yAxisPolicy\.min \(50\) is above every value in pane "A"$/),
      ]);
    }
  });

  it("does not warn when some value lies on the open side, or both bounds are pinned", async () => {
    for (const policy of [["  min: 20"], ["  max: 50"], ["  min: 50", "  max: 100"], ["  min: 100", "  max: 50"]]) {
      expect(warningsOf((await runValidate(bar(policy))).message), policy.join(" ")).toEqual([]);
    }
  });

  it("is strict: a value exactly on the bound is not past it", async () => {
    // A flat line at 7 under min: 7 is drawn along the frame's edge; 8–31 under min: 31 draws its 31.
    const line = (csv: string, policy: string) =>
      chartSpec("line", csv, ["columns:", "  x: t", "  value: v", "yAxisPolicy:", policy], "numeric");
    expect(warningsOf((await runValidate(line("t,v\n1,7\n2,7\n", "  min: 7"))).message)).toEqual([]);
    expect(warningsOf((await runValidate(line("t,v\n1,7\n2,7\n", "  max: 7"))).message)).toEqual([]);
    expect(warningsOf((await runValidate(line("t,v\n1,8\n2,31\n", "  min: 31"))).message)).toEqual([]);
    expect(warningsOf((await runValidate(bar(["  max: 8"]))).message)).toEqual([]);
  });

  it("reads each value cell, not a stack's totals: a min above both segments warns", async () => {
    const stacked = "c,s,v\na,A,8\na,B,15\n";
    const result = await runValidate(
      chartSpec("stacked", stacked, ["columns:", "  x: c", "  value: v", "  series: s", "yAxisPolicy:", "  min: 20"]),
    );
    expect(warningsOf(result.message)).toEqual([
      expect.stringMatching(/warning: yAxisPolicy\.min \(20\) is above every value in the data$/),
    ]);
  });

  it("counts only the series the chart keeps (series_order filters)", async () => {
    const csv = "t,s,v\n1,A,8\n2,A,31\n1,B,80\n";
    const spec = (order: string[]) =>
      chartSpec(
        "line",
        csv,
        ["columns:", "  x: t", "  value: v", "  series: s", `series_order: [${order.join(", ")}]`, "yAxisPolicy:", "  min: 50"],
        "numeric",
      );
    expect(warningsOf((await runValidate(spec(["A"]))).message)).toHaveLength(1);
    expect(warningsOf((await runValidate(spec(["A", "B"]))).message)).toEqual([]);
  });

  it("counts a shape_order-filtered point as data, so the statement stays true", async () => {
    // The 80 is not drawn (shape_order drops it), but it is a value in the data: 50 is not above it.
    const csv = "t,v,k\n1,8,keep\n2,80,drop\n";
    const result = await runValidate(
      chartSpec(
        "scatter",
        csv,
        ["columns:", "  x: t", "  value: v", "  shape: k", "shape_order: [keep]", "yAxisPolicy:", "  min: 50"],
        "numeric",
      ),
    );
    expect(result.exitCode).toBe(0);
    expect(warningsOf(result.message)).toEqual([]);
  });

  it("states the bound as written, whatever autoWiden then does to the axis", async () => {
    const result = await runValidate(
      chartSpec(
        "scatter",
        "t,v\n1,8\n2,31\n",
        ["columns:", "  x: t", "  value: v", "yAxisPolicy:", "  max: 2", "  autoWiden:", "    step: 25"],
        "numeric",
      ),
    );
    expect(warningsOf(result.message)).toEqual([
      expect.stringMatching(/warning: yAxisPolicy\.max \(2\) is below every value in the data$/),
    ]);
  });

  it("a histogram's values are its bin heights", async () => {
    const result = await runValidate(
      chartSpec(
        "histogram",
        "lo,hi,n\n0,5,8\n5,10,31\n",
        ["columns:", "  x0: lo", "  x1: hi", "  value: n", "yAxisPolicy:", "  min: 50"],
        "numeric",
      ),
    );
    expect(warningsOf(result.message)).toEqual([
      expect.stringMatching(/warning: yAxisPolicy\.min \(50\) is above every bin height in the data$/),
    ]);
  });
});

// ---------------------------------------------------------------------------
// serve: bind address (B8)
// ---------------------------------------------------------------------------

describe("serve — bind address", () => {
  it("binds 127.0.0.1 by default, not every interface", () => {
    const parsed = parseServeArgs(["some/dir"]);
    expect(parsed).toMatchObject({ host: "127.0.0.1", port: 5173, rootDir: resolve("some/dir") });
  });

  it("takes --host as an explicit opt-in", () => {
    expect(parseServeArgs(["--host", "0.0.0.0", "--port", "8080"])).toMatchObject({ host: "0.0.0.0", port: 8080 });
  });

  it("still rejects a bad port", () => {
    expect(parseServeArgs(["--port", "0"])).toEqual({ error: 'tbl-chart serve: invalid port "0"' });
  });

  it("listens on the host it is given and reports that host in the URL", async () => {
    const server = http.createServer((_req, res) => res.end("ok"));
    try {
      const { host } = parseServeArgs([]) as { host: string };
      const url = await listenServe(server, 0, host);
      const addr = server.address() as import("node:net").AddressInfo;
      expect(addr.address).toBe("127.0.0.1");
      expect(url).toBe(`http://127.0.0.1:${addr.port}`);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("rejects, rather than hanging, when the port is taken", async () => {
    const a = http.createServer();
    const b = http.createServer();
    try {
      await listenServe(a, 0, "127.0.0.1");
      const port = (a.address() as import("node:net").AddressInfo).port;
      await expect(listenServe(b, port, "127.0.0.1")).rejects.toMatchObject({ code: "EADDRINUSE" });
    } finally {
      await new Promise((r) => a.close(r));
    }
  });

  it("serve's start path, fed parsed default args, binds 127.0.0.1 and prints that URL", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-serve-"));
    // Port 0 (the OS picks a free one) only; everything else is what `serve <dir>` parses to.
    const args = { ...(parseServeArgs([dir]) as ServeArgs), port: 0 };
    const started = await startServe(args, STUB_BUNDLE);
    expect(started.exitCode).toBe(0);
    if (started.exitCode !== 0) return;
    try {
      const addr = started.server.address() as import("node:net").AddressInfo;
      expect(addr.address).toBe("127.0.0.1");
      expect(started.url).toBe(`http://127.0.0.1:${addr.port}`);
      expect(started.message).toBe(`Serving 0 specs from ${dir} at http://127.0.0.1:${addr.port}`);
    } finally {
      await new Promise((r) => started.server.close(r));
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("serve's start path reports a taken port instead of throwing", async () => {
    // An empty root: startServe walks rootDir for specs before it listens, and the OS temp dir
    // itself is far too large to walk inside a test timeout.
    const dir = mkdtempSync(join(tmpdir(), "cli-serve-port-"));
    const blocker = http.createServer();
    await listenServe(blocker, 0, "127.0.0.1");
    try {
      const port = (blocker.address() as import("node:net").AddressInfo).port;
      const started = await startServe({ rootDir: dir, port, host: "127.0.0.1" }, STUB_BUNDLE);
      expect(started).toEqual({ exitCode: 1, message: expect.stringContaining(`port ${port} is already in use`) });
    } finally {
      await new Promise((r) => blocker.close(r));
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("brackets an IPv6 address in the URL", () => {
    expect(serveUrl("::1", 5173)).toBe("http://[::1]:5173");
    expect(serveUrl("0.0.0.0", 80)).toBe("http://0.0.0.0:80");
  });
});

// ---------------------------------------------------------------------------
// snapshot: diff path and the dimension-mismatch message (B9)
// ---------------------------------------------------------------------------

describe("snapshotDiffPath", () => {
  it("replaces a .png suffix (any case)", () => {
    expect(snapshotDiffPath(join("a", "base.png"))).toBe(join("a", "base.diff.png"));
    expect(snapshotDiffPath(join("a", "base.PNG"))).toBe(join("a", "base.diff.png"));
  });

  it("appends .diff.png when there is no .png suffix, so it never names the baseline", () => {
    for (const p of [join("a", "base"), join("a", "base.bin"), join("a.png", "base")]) {
      expect(snapshotDiffPath(p)).toBe(`${p}.diff.png`);
      expect(snapshotDiffPath(p)).not.toBe(p);
    }
  });
});

describe.skipIf(!HAS_BROWSER)("runSnapshot — baseline safety", () => {
  it("never overwrites a baseline without a .png suffix, and only claims a diff it wrote", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cli-snapshot-"));
    const baselinePath = join(dir, "baseline");
    const diffPath = `${baselinePath}.diff.png`;
    tempFiles.push(baselinePath, diffPath);
    const opts = { baselinePath, liveBundleJs: readFileSync(BUNDLE_PATH, "utf8"), css: CHART_CSS };

    expect((await runSnapshot(EXAMPLE_SPEC, { ...opts, update: true })).exitCode).toBe(0);

    // Same size, a block of pixels changed: a real pixel diff.
    const png = PNG.sync.read(readFileSync(baselinePath));
    for (let i = 0; i < 400 * 4; i++) png.data[i] = 255 - (png.data[i] as number);
    const tampered = PNG.sync.write(png);
    writeFileSync(baselinePath, tampered);

    const differs = await runSnapshot(EXAMPLE_SPEC, opts);
    expect(differs.exitCode).toBe(1);
    expect(readFileSync(baselinePath).equals(tampered)).toBe(true);
    expect(existsSync(diffPath)).toBe(true);
    expect(differs.message).toContain(`wrote ${diffPath}`);

    // Different dimensions: comparePng writes nothing, so the message must not say it did.
    unlinkSync(diffPath);
    writeFileSync(baselinePath, PNG.sync.write(new PNG({ width: 4, height: 4 })));
    const resized = await runSnapshot(EXAMPLE_SPEC, opts);
    expect(resized.exitCode).toBe(1);
    expect(resized.message).not.toContain("wrote");
    expect(resized.message).toMatch(/size/i);
    expect(existsSync(diffPath)).toBe(false);
  }, 120_000);
});
