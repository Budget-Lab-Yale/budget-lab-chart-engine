// End-to-end regression guard for the standalone HTML path. The mountChart unit tests
// import from source, so they cannot catch a packaging bug where the IIFE's `globalName`
// wrapper fails to expose the global (the exact bug that shipped once). This builds the
// full standalone HTML (buildStandaloneHtml + the real IIFE bundle + CHART_CSS) and loads
// it in jsdom with `runScripts: "dangerously"` — executing the <script> tags exactly as a
// browser would — then asserts a chart actually mounted.
//
// The IIFE bundle is produced by the globalSetup (test/setup/global-build.ts); esbuild's
// API throws inside vitest's module-runner realm, so it can't be built in-test.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { BUNDLE_PATH } from "./setup/global-build";
import { buildStandaloneHtml } from "../src/embed/bundle-standalone";
import { CHART_CSS } from "../src/embed/styles";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const SPEC: ChartSpec = {
  chartType: "line",
  eyebrow: "Figure 1",
  title: "Bundle smoke",
  xAxisType: "temporal",
  series_order: ["a", "b"],
  data: "inline",
};
const ROWS: TidyRow[] = [
  { time: "2021-01-01", series: "a", value: "1" },
  { time: "2021-02-01", series: "a", value: "2" },
  { time: "2021-01-01", series: "b", value: "3" },
  { time: "2021-02-01", series: "b", value: "4" },
];

describe("standalone HTML", () => {
  it("mounts an interactive chart when its <script> tags execute (browser-equivalent)", () => {
    const liveBundleJs = readFileSync(BUNDLE_PATH, "utf8");
    const html = buildStandaloneHtml({ spec: SPEC, rows: ROWS, liveBundleJs, css: CHART_CSS });

    // runScripts:"dangerously" executes the inline <script> tags synchronously during parse,
    // as a browser would. External resources (the Google Fonts <link>) are not fetched.
    const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
    const doc = dom.window.document;

    const chart = doc.querySelector("#chart");
    expect(chart?.querySelector("svg")).toBeTruthy();
    expect(chart?.querySelectorAll(".tbl-legend .tbl-legend-item").length).toBe(2);
    expect(chart?.querySelectorAll("svg path[data-series]").length).toBe(2);
    expect(doc.querySelector(".figure-title")?.textContent).toBe("Bundle smoke");
    expect(chart?.querySelector(".figure-supertitle")?.textContent).toBe("Figure 1");
  });

  it("neutralizes a literal </script> inside the inlined bundle", () => {
    const html = buildStandaloneHtml({
      spec: SPEC,
      rows: ROWS,
      liveBundleJs: 'var x="</script><b>pwn</b>";',
      css: "",
    });
    // The bundle's `</script` is escaped to `<\/script` (harmless in a JS string literal),
    // so it cannot prematurely close the inline <script> tag.
    expect(html).toContain('var x="<\\/script>');
    expect(html).not.toContain('var x="</script>');
  });
});
