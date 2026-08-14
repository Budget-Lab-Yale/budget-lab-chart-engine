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
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { BUNDLE_PATH } from "./setup/global-build";
import { buildStandaloneHtml } from "../src/embed/bundle-standalone";
import {
  buildSharedStylesheet,
  runtimeAssetName,
  stylesAssetName,
} from "../src/embed/shared-assets";
import { CHART_CSS } from "../src/embed/styles";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const SPEC: ChartSpec = {
  chartType: "line",
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
    const html = buildStandaloneHtml({ spec: SPEC, rows: ROWS, liveBundleJs, css: CHART_CSS, eyebrow: "Figure 1" });

    // runScripts:"dangerously" executes the inline <script> tags synchronously during parse,
    // as a browser would. External resources (the Google Fonts <link>) are not fetched.
    const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
    const doc = dom.window.document;

    const chart = doc.querySelector("#chart");
    expect(chart?.querySelector("svg")).toBeTruthy();
    expect(chart?.querySelectorAll(".tbl-legend .tbl-legend-item").length).toBe(2);
    // Visible line paths live inside g[aria-label="line"]; the transparent fat hit-paths
    // (.tbl-line-hitpath) are siblings appended to the svg, so scope the count to the
    // line group to exclude them.
    expect(chart?.querySelectorAll('svg g[aria-label="line"] path[data-series]').length).toBe(2);
    expect(doc.querySelector(".figure-title")?.textContent).toBe("Bundle smoke");
    // The eyebrow is supplied at embed time (baked into the bootstrap) and shown by default.
    expect(chart?.querySelector(".figure-supertitle")?.textContent).toBe("Figure 1");
  });

  it("hides the baked-in eyebrow when the page URL carries ?eyebrow=off", () => {
    const liveBundleJs = readFileSync(BUNDLE_PATH, "utf8");
    const html = buildStandaloneHtml({ spec: SPEC, rows: ROWS, liveBundleJs, css: CHART_CSS, eyebrow: "Figure 1" });

    const dom = new JSDOM(html, {
      url: "https://example.com/chart/?eyebrow=off",
      runScripts: "dangerously",
      pretendToBeVisual: true,
    });
    const doc = dom.window.document;
    expect(doc.querySelector("#chart svg")).toBeTruthy(); // chart still mounts
    expect(doc.querySelector(".figure-supertitle")).toBeNull();
  });

  it("renders no eyebrow (and emits no eyebrow bootstrap) when none is supplied", () => {
    const liveBundleJs = readFileSync(BUNDLE_PATH, "utf8");
    const html = buildStandaloneHtml({ spec: SPEC, rows: ROWS, liveBundleJs, css: CHART_CSS });
    expect(html).not.toContain("eyebrow:");

    const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
    expect(dom.window.document.querySelector(".figure-supertitle")).toBeNull();
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

// ---------------------------------------------------------------------------
// Shared-asset mode
// ---------------------------------------------------------------------------

// The regression this guards: a page that links its runtime instead of inlining it must still
// mount, and must resolve the link RELATIVE to its own location — that is what keeps output
// working from file:// and under a /pr-preview/pr-N/ prefix. So this writes a real asset dir and
// a page two levels below it, loads the page over file://, and lets jsdom fetch the script.
describe("shared-asset HTML", () => {
  const VERSION = "9.9.9-test";

  /** Lay out <root>/embed/v1/<assets> + <root>/col/chart/index.html, return the page path. */
  function layoutSite(): { root: string; pagePath: string } {
    const root = mkdtempSync(join(tmpdir(), "tbl-shared-"));
    const assetDir = join(root, "embed", "v1");
    mkdirSync(assetDir, { recursive: true });
    writeFileSync(join(assetDir, runtimeAssetName(VERSION)), readFileSync(BUNDLE_PATH, "utf8"));
    writeFileSync(join(assetDir, stylesAssetName(VERSION)), buildSharedStylesheet(CHART_CSS));

    const pageDir = join(root, "col", "chart");
    mkdirSync(pageDir, { recursive: true });
    const html = buildStandaloneHtml({
      spec: SPEC,
      rows: ROWS,
      css: CHART_CSS,
      assets: { base: "../../embed/v1", version: VERSION },
      eyebrow: "Figure 1",
    });
    const pagePath = join(pageDir, "index.html");
    writeFileSync(pagePath, html);
    return { root, pagePath };
  }

  it("links the versioned assets and inlines neither the runtime nor the font", () => {
    const html = buildStandaloneHtml({
      spec: SPEC,
      rows: ROWS,
      css: CHART_CSS,
      assets: { base: "../../embed/v1", version: VERSION },
    });
    expect(html).toContain(`<script src="../../embed/v1/engine-${VERSION}.js"></script>`);
    expect(html).toContain(`<link rel="stylesheet" href="../../embed/v1/chart-${VERSION}.css">`);
    // The payloads that made pages 1.65 MB each: the bundle and the base64 font.
    expect(html).not.toContain("base64");
    expect(html).not.toContain(".figure-card {");
    // No separate font request — the shared stylesheet carries it (CORS blocks font files
    // on file:// pages, which is how the thumbnail screenshotter loads them).
    expect(html).not.toContain("rel=\"preload\"");
    // Still carries the only per-page content: spec + data.
    expect(html).toContain('"chartType":"line"');
    expect(html.length).toBeLessThan(20_000);
  });

  it("mounts a chart when loaded over file:// with the runtime fetched relatively", async () => {
    const { pagePath } = layoutSite();
    const dom = await JSDOM.fromFile(pagePath, {
      runScripts: "dangerously",
      resources: "usable",
      pretendToBeVisual: true,
    });
    await new Promise<void>((res) => {
      if (dom.window.document.readyState === "complete") res();
      else dom.window.addEventListener("load", () => res());
    });

    const chart = dom.window.document.querySelector("#chart");
    expect(chart?.querySelector("svg")).toBeTruthy();
    expect(chart?.querySelectorAll('svg g[aria-label="line"] path[data-series]').length).toBe(2);
    expect(dom.window.document.querySelector(".figure-title")?.textContent).toBe("Bundle smoke");
    expect(chart?.querySelector(".figure-supertitle")?.textContent).toBe("Figure 1");
  }, 20_000);

  it("refuses to build without a runtime when assets are not linked", () => {
    expect(() => buildStandaloneHtml({ spec: SPEC, rows: ROWS, css: CHART_CSS })).toThrow(
      /liveBundleJs is required/,
    );
  });
});

// A shared runtime is a separate request, so it can fail where an inlined bundle could not. The
// page must then name the figure instead of leaving a blank rectangle mid-article — and must do so
// without the stylesheet, which is a separate request and may be equally absent.
describe("shared-asset fallback when the runtime does not arrive", () => {
  const VERSION = "9.9.9-test";

  function pageWithNoAssets(): string {
    const root = mkdtempSync(join(tmpdir(), "tbl-missing-"));
    const pageDir = join(root, "col", "chart");
    mkdirSync(pageDir, { recursive: true });
    const pagePath = join(pageDir, "index.html");
    writeFileSync(
      pagePath,
      buildStandaloneHtml({
        spec: SPEC,
        rows: ROWS,
        css: CHART_CSS,
        assets: { base: "../../embed/v1", version: VERSION },
        eyebrow: "Figure 1",
      }),
    );
    return pagePath;
  }

  it("names the figure, asks for a reload, and gives a contact address", async () => {
    const dom = await JSDOM.fromFile(pageWithNoAssets(), {
      runScripts: "dangerously",
      resources: "usable",
      pretendToBeVisual: true,
    });
    await new Promise<void>((res) => {
      if (dom.window.document.readyState === "complete") res();
      else dom.window.addEventListener("load", () => res());
    });

    const chart = dom.window.document.querySelector("#chart");
    expect(chart?.textContent).toContain("Bundle smoke");
    expect(chart?.textContent).toContain("Figure 1");
    expect(chart?.textContent).toContain("An error occurred, please try reloading this page.");

    // Reloading the HOST article is the useful action for an embedded figure, so the only link is
    // the contact address — an "open this figure alone" link makes no sense mid-article.
    const link = chart?.querySelector("a");
    expect(link?.getAttribute("href")).toBe("mailto:budgetlab@yale.edu");
    expect(chart?.querySelectorAll("a").length).toBe(1);

    // Styled inline, because the stylesheet may be missing too.
    expect(chart?.querySelector("[role=note]")?.getAttribute("style")).toContain("font:");
  }, 20_000);

  it("is emitted only in shared mode — an inlined page cannot lose its runtime", () => {
    const inline = buildStandaloneHtml({
      spec: SPEC,
      rows: ROWS,
      liveBundleJs: "var BudgetLabChart={mountChart:function(){}};",
      css: CHART_CSS,
    });
    expect(inline).not.toContain("An error occurred");
    expect(inline).not.toContain("renderUnavailable");

    const shared = buildStandaloneHtml({
      spec: SPEC,
      rows: ROWS,
      css: CHART_CSS,
      assets: { base: "../../embed/v1", version: VERSION },
    });
    expect(shared).toContain("renderUnavailable");
  });
});

// ---------------------------------------------------------------------------
// Bundle contents
// ---------------------------------------------------------------------------

// The validator is an AUTHORING/CLI concern — scripts/build.mjs says so outright at its spec/data
// entry, and builds those for Node with ajv external. Nothing enforced it on the browser side, and
// the leak is silent: `spec/validate.ts` instantiates Ajv at module scope, so ONE import of ANY
// name from it, anywhere in standalone-entry.ts's graph, drags the whole schema walker in. Nothing
// breaks when that happens — the bundle just grows, measured at +128 KB minified (+13%) on
// dist/embed/live.js when render-live.ts imported FILLED_CHART_TYPES from validate.ts (4744d05).
// A human reading a diff will not catch the next one, so this asserts it instead.
//
// BUNDLE_PATH is the SAME entry scripts/build.mjs ships as dist/embed/live.js, differing only in
// that the test build skips minification — which is why esbuild's per-module path comments are
// readable here. Both kinds of marker are checked anyway: the paths pin exactly which module pulled
// it in, and the ajv source strings would survive a minified build too.
describe("browser bundle contents", () => {
  const FORBIDDEN: Array<[string, string]> = [
    ["node_modules/ajv/", "ajv itself"],
    ["src/spec/validate.ts", "the validator, which instantiates Ajv at module scope"],
    ["src/spec/schema.ts", "the JSON schema, which only the validator reads"],
    ["strictTypes", "an ajv option name — present even if the path comments are stripped"],
    ["schema is invalid", "an ajv runtime message — likewise"],
  ];

  it("carries no ajv: the validator must not be reachable from the browser entry", () => {
    const js = readFileSync(BUNDLE_PATH, "utf8");
    // Guard the guard: a build that silently produced nothing would pass every assertion below.
    expect(js.length).toBeGreaterThan(500_000);
    for (const [needle, why] of FORBIDDEN) {
      expect(js.includes(needle), `bundle contains ${JSON.stringify(needle)} — ${why}`).toBe(false);
    }
  });
});
