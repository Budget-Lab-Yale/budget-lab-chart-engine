/**
 * Tests for src/cli/serve.ts — findCharts, createRequestHandler.
 *
 * The request-handler tests inject a stub liveBundleJs and css so the suite
 * does not require a pre-built dist/embed/live.js.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as http from "node:http";
import { findSpecs, createRequestHandler } from "../src/cli/serve";

// ---------------------------------------------------------------------------
// Repo root — used to prove findCharts discovers chart.yaml files in the tree
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

// ---------------------------------------------------------------------------
// Stub injection
// ---------------------------------------------------------------------------

const STUB_BUNDLE = `var BudgetLabChart={mountChart:function(el,opts){el.innerHTML='<p>chart</p>';},mountTable:function(el,opts){el.innerHTML='<p>table</p>';}};`;
const STUB_CSS = "body{}";

/** Write a minimal valid table.yaml + data.csv into `dir` (mirrors test/table/cli.test.ts). */
function makeTableFixture(dir: string): void {
  writeFileSync(
    join(dir, "data.csv"),
    "row,metric,value\nGDP,2024,1.2\nGDP,2025,1.8\n",
    "utf8",
  );
  writeFileSync(
    join(dir, "table.yaml"),
    [
      "title: Test Table",
      "data: data.csv",
      "stub:",
      "  - label: row",
      "header:",
      "  - metric",
      "value: value",
    ].join("\n") + "\n",
    "utf8",
  );
}

// ---------------------------------------------------------------------------
// Temp directory helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = join(tmpdir(), `serve-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of tempDirs) {
    try {
      if (existsSync(d)) rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  tempDirs.length = 0;
});

// ---------------------------------------------------------------------------
// Helper: make an HTTP request to a handler without starting a real server
// ---------------------------------------------------------------------------

/**
 * Invoke the handler with a fake IncomingMessage and capture the response.
 * Returns { status, body }.
 */
function fakeRequest(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  url: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = {
      url,
      method: "GET",
      headers: {},
    } as unknown as http.IncomingMessage;

    let status = 200;
    let body = "";

    const res = {
      writeHead(code: number) {
        status = code;
      },
      end(chunk?: unknown) {
        if (typeof chunk === "string") body = chunk;
        resolve({ status, body });
      },
      headersSent: false,
    } as unknown as http.ServerResponse;

    try {
      handler(req, res);
    } catch (err) {
      reject(err);
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers: drive the index page's open-all script without a browser
// ---------------------------------------------------------------------------

/** Serve an index page for a gallery holding `count` chart specs. */
async function galleryFor(count: number): Promise<{ body: string }> {
  const dir = makeTempDir();
  for (let i = 0; i < count; i++) {
    const sub = join(dir, `spec-${i}`);
    mkdirSync(sub, { recursive: true });
    writeFileSync(
      join(sub, "chart.yaml"),
      `chartType: line\ntitle: Spec ${i}\nxAxisType: temporal\ndata: d.csv\n`,
    );
  }
  const handler = createRequestHandler({ rootDir: dir, liveBundleJs: STUB_BUNDLE, css: STUB_CSS });
  return { body: (await fakeRequest(handler, "/")).body };
}

/**
 * Run the index page's inline script against stub window/document objects and click the button.
 *
 * The behaviour under test is pop-up handling, which no assertion on the emitted source text can
 * reach: whether a returned window counts as blocked, and whether a large set is confirmed first,
 * are decisions the script makes at click time. Executing it with a stub `window.open` is the only
 * way to observe them, and is cheaper and less brittle than a real browser.
 */
function runOpenAll(
  body: string,
  stubs: { open?: (href: string) => unknown; confirm?: (msg: string) => boolean } = {},
): {
  opened: string[];
  confirmed: string[];
  note: { textContent: string; hidden: boolean };
  /** Click again, against the same note element — the only way to observe what one click leaves
   *  behind for the next. Stubs are consulted per call, so they can answer differently. */
  click: () => void;
} {
  const opened: string[] = [];
  const confirmed: string[] = [];
  const note = { textContent: "", hidden: true };
  let click: (() => void) | null = null;

  const win = {
    open(href: string) {
      opened.push(href);
      return stubs.open ? stubs.open(href) : {};
    },
    confirm(msg: string) {
      confirmed.push(msg);
      return stubs.confirm ? stubs.confirm(msg) : true;
    },
  };
  const doc = {
    getElementById(id: string) {
      if (id === "open-all") {
        return {
          addEventListener(_type: string, fn: () => void) {
            click = fn;
          },
        };
      }
      if (id === "open-all-note") return note;
      return null;
    },
  };

  const open = body.indexOf("<script>");
  const src = body.slice(open + "<script>".length, body.indexOf("</script>", open));
  new Function("window", "document", src)(win, doc);
  if (!click) throw new Error("open-all button never registered a click handler");
  (click as () => void)();
  return { opened, confirmed, note, click: click as () => void };
}

// ---------------------------------------------------------------------------
// findSpecs
// ---------------------------------------------------------------------------

describe("findSpecs", () => {
  it("discovers chart.yaml files under the repo root", () => {
    const found = findSpecs(REPO_ROOT);
    const normalized = found.map((p) => p.replace(/\\/g, "/"));
    expect(normalized.some((p) => p.endsWith("test/fixtures/sample-chart/chart.yaml"))).toBe(true);
  });

  it("skips node_modules, dist, and .git directories", () => {
    const found = findSpecs(REPO_ROOT);
    for (const p of found) {
      const normalized = p.replace(/\\/g, "/");
      expect(normalized).not.toContain("/node_modules/");
      expect(normalized).not.toContain("/dist/");
      expect(normalized).not.toContain("/.git/");
    }
  });

  it("returns an empty array for a dir with no chart.yaml or table.yaml files", () => {
    const dir = makeTempDir();
    expect(findSpecs(dir)).toHaveLength(0);
  });

  it("finds chart.yaml files in nested subdirectories", () => {
    const dir = makeTempDir();
    const sub = join(dir, "a", "b");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, "chart.yaml"), "chartType: line\ntitle: Nested\nxAxisType: temporal\ndata: d.csv\n");
    const found = findSpecs(dir);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(join("a", "b", "chart.yaml"));
  });

  it("finds table.yaml files alongside chart.yaml files", () => {
    const dir = makeTempDir();
    makeTableFixture(dir);
    const sub = join(dir, "chart-sub");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, "chart.yaml"), "chartType: line\ntitle: X\nxAxisType: temporal\ndata: d.csv\n");

    const found = findSpecs(dir).map((p) => p.replace(/\\/g, "/"));
    expect(found.some((p) => p.endsWith("table.yaml"))).toBe(true);
    expect(found.some((p) => p.endsWith("chart-sub/chart.yaml"))).toBe(true);
    expect(found).toHaveLength(2);
  });

  it("skips a dir named node_modules even when nested", () => {
    const dir = makeTempDir();
    const nm = join(dir, "node_modules", "some-pkg");
    mkdirSync(nm, { recursive: true });
    writeFileSync(join(nm, "chart.yaml"), "chartType: line\ntitle: X\nxAxisType: temporal\ndata: d.csv\n");
    expect(findSpecs(dir)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// GET / — index page
// ---------------------------------------------------------------------------

describe("GET / — index page", () => {
  it("returns 200 with HTML listing the example chart", async () => {
    const handler = createRequestHandler({
      rootDir: REPO_ROOT,
      liveBundleJs: STUB_BUNDLE,
      css: STUB_CSS,
    });

    const { status, body } = await fakeRequest(handler, "/");
    expect(status).toBe(200);
    expect(body).toContain("<!doctype html");
    // Fixture chart title (the gallery lists chart.yaml files found under the root)
    expect(body).toContain("Sample Chart");
  });

  it("shows 'No chart.yaml files found' when the dir is empty", async () => {
    const dir = makeTempDir();
    const handler = createRequestHandler({ rootDir: dir, liveBundleJs: STUB_BUNDLE, css: STUB_CSS });
    const { status, body } = await fakeRequest(handler, "/");
    expect(status).toBe(200);
    expect(body).toContain("No");
    expect(body).toContain("chart.yaml");
  });

  it("does not crash and returns valid HTML for an empty gallery dir", async () => {
    const dir = makeTempDir();
    const handler = createRequestHandler({ rootDir: dir, liveBundleJs: STUB_BUNDLE, css: STUB_CSS });
    const { status, body } = await fakeRequest(handler, "/");
    expect(status).toBe(200);
    expect(body).toContain("<!doctype html");
  });

  it("offers an open-all button carrying every spec's own URL", async () => {
    // Reviewing a suite means comparing figures side by side, so the gallery opens the whole set.
    const dir = makeTempDir();
    for (const name of ["alpha", "beta"]) {
      const sub = join(dir, name);
      mkdirSync(sub, { recursive: true });
      writeFileSync(join(sub, "chart.yaml"), `chartType: line\ntitle: ${name}\nxAxisType: temporal\ndata: d.csv\n`);
    }
    const handler = createRequestHandler({ rootDir: dir, liveBundleJs: STUB_BUNDLE, css: STUB_CSS });
    const { body } = await fakeRequest(handler, "/");
    expect(body).toContain("Open all 2 in tabs");
    // The button's list must be the SAME hrefs the links use, or it opens 404s.
    for (const name of ["alpha", "beta"]) {
      expect(body).toContain(`"/chart/${name}/chart.yaml"`);
    }
  });

  it("omits the open-all button when there is nothing to open", async () => {
    const dir = makeTempDir();
    const handler = createRequestHandler({ rootDir: dir, liveBundleJs: STUB_BUNDLE, css: STUB_CSS });
    const { body } = await fakeRequest(handler, "/");
    expect(body).not.toContain('id="open-all"');
  });

  // Windows forbids `<` and `>` in a filename, so the path this guards against cannot even be
  // created here — but CI runs on Linux, where it can.
  it.skipIf(process.platform === "win32")("cannot let a spec path close the open-all script early", async () => {
    // A spec path is not the author's to vet: an unescaped `</script>` in one would end the element
    // and spill the rest of the list into the page as markup.
    const dir = makeTempDir();
    const sub = join(dir, "a</script><b>b");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, "chart.yaml"), "chartType: line\ntitle: Odd\nxAxisType: temporal\ndata: d.csv\n");
    const handler = createRequestHandler({ rootDir: dir, liveBundleJs: STUB_BUNDLE, css: STUB_CSS });
    const { body } = await fakeRequest(handler, "/");
    const script = body.slice(body.indexOf('id="open-all"'));
    expect(script).not.toContain("</script><b>");
  });

  it("asks before opening a tab count large enough to be a misfire", async () => {
    // 13 specs is one past the threshold, so the click must be confirmed; declining opens nothing,
    // because the whole point of the guard is that there is no undo for 100 stray tabs.
    const { body } = await galleryFor(13);
    const declined = runOpenAll(body, { confirm: () => false });
    expect(declined.confirmed).toEqual(["Open 13 tabs, one per spec?"]);
    expect(declined.opened).toEqual([]);

    const accepted = runOpenAll(body, { confirm: () => true });
    expect(accepted.opened).toHaveLength(13);
  });

  it("does not ask at or below the threshold", async () => {
    const { body } = await galleryFor(12);
    const run = runOpenAll(body, {
      // A confirm at this size would be friction on the common case; if one is asked, fail loudly
      // rather than silently answering it.
      confirm: () => {
        throw new Error("should not confirm at 12 specs");
      },
    });
    expect(run.confirmed).toEqual([]);
    expect(run.opened).toHaveLength(12);
  });

  it("claims no blocked tabs when the browser handed back a window", async () => {
    // A window that opened fine may still report closed while it navigates, and some pop-up blockers
    // return a stub that never reports closed at all. Reading .closed therefore proves nothing, so a
    // non-null return must never be counted as blocked.
    const { body } = await galleryFor(2);
    const run = runOpenAll(body, { open: () => ({ closed: true }) });
    expect(run.opened).toHaveLength(2);
    expect(run.note.hidden).toBe(true);
    expect(run.note.textContent).toBe("");
  });

  it("reports a refused window as a floor, not an exact count", async () => {
    // null is the one unambiguous refusal, so the count is a lower bound and the wording must say so.
    const { body } = await galleryFor(2);
    const run = runOpenAll(body, { open: () => null });
    expect(run.note.hidden).toBe(false);
    expect(run.note.textContent).toContain("At least 2 of 2 tabs did not open");
    expect(run.note.textContent).toContain("allow pop-ups");
  });

  it("counts a window the browser handed back as undefined, not just null", async () => {
    // The spec says null, so this is theoretical — but it costs one character to cover, and the
    // failure it prevents is silent: a blocked suite that reports nothing at all.
    const { body } = await galleryFor(2);
    const run = runOpenAll(body, { open: () => undefined });
    expect(run.note.hidden).toBe(false);
    expect(run.note.textContent).toContain("At least 2 of 2 tabs did not open");
  });

  it("clears the blocked-tabs note when the next click is cancelled at the confirm", async () => {
    // Cancelling opens nothing, so an earlier click's note is left describing a click that did not
    // happen — it reads as "your tabs were blocked" when the answer was "you said no".
    const { body } = await galleryFor(13); // one past CONFIRM_ABOVE, so the click is confirmed
    let accept = true;
    const run = runOpenAll(body, { open: () => null, confirm: () => accept });
    expect(run.note.hidden).toBe(false);
    accept = false;
    run.click();
    expect(run.note.hidden).toBe(true);
    expect(run.opened).toHaveLength(13); // the cancelled click opened nothing more
  });

  it("lists a table.yaml spec by its title", async () => {
    const dir = makeTempDir();
    makeTableFixture(dir);
    const handler = createRequestHandler({ rootDir: dir, liveBundleJs: STUB_BUNDLE, css: STUB_CSS });
    const { status, body } = await fakeRequest(handler, "/");
    expect(status).toBe(200);
    expect(body).toContain("Test Table");
  });
});

// ---------------------------------------------------------------------------
// GET /chart/<relpath> — valid chart
// ---------------------------------------------------------------------------

describe("GET /chart/<relpath> — valid chart", () => {
  it("returns 200 with HTML containing the chart title", async () => {
    const handler = createRequestHandler({
      rootDir: REPO_ROOT,
      liveBundleJs: STUB_BUNDLE,
      css: STUB_CSS,
    });

    // Relative path from repo root to a chart (posix-style)
    const rel = "test/fixtures/sample-chart/chart.yaml";
    const { status, body } = await fakeRequest(handler, `/chart/${rel}`);
    expect(status).toBe(200);
    expect(body).toContain("<!doctype html");
    expect(body).toContain("Sample Chart");
  });

  it("includes the injected bundle JS in the response", async () => {
    const handler = createRequestHandler({
      rootDir: REPO_ROOT,
      liveBundleJs: STUB_BUNDLE,
      css: STUB_CSS,
    });

    const rel = "test/fixtures/sample-chart/chart.yaml";
    const { status, body } = await fakeRequest(handler, `/chart/${rel}`);
    expect(status).toBe(200);
    expect(body).toContain("BudgetLabChart");
  });
});

// ---------------------------------------------------------------------------
// GET /chart/<relpath> — valid table
// ---------------------------------------------------------------------------

describe("GET /chart/<relpath> — valid table", () => {
  it("routes table.yaml through the table validator/mount and returns 200", async () => {
    const dir = makeTempDir();
    makeTableFixture(dir);
    const handler = createRequestHandler({ rootDir: dir, liveBundleJs: STUB_BUNDLE, css: STUB_CSS });

    const { status, body } = await fakeRequest(handler, "/chart/table.yaml");
    expect(status).toBe(200);
    expect(body).toContain("<!doctype html");
    expect(body).toContain("BudgetLabChart.mountTable");
    expect(body).not.toContain("BudgetLabChart.mountChart");
    expect(body).toContain("Test Table");
  });

  it("returns 422 with table validator errors for an invalid table.yaml", async () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "data.csv"),
      "row,metric,value\nGDP,2024,1.2\n",
      "utf8",
    );
    writeFileSync(
      join(dir, "table.yaml"),
      [
        "title: Bad Table",
        "data: data.csv",
        "stub:",
        "  - label: row",
        "header:",
        "  - metric",
        // deliberately omitting 'value:' to trigger the table validator error
      ].join("\n") + "\n",
      "utf8",
    );

    const handler = createRequestHandler({ rootDir: dir, liveBundleJs: STUB_BUNDLE, css: STUB_CSS });
    const { status, body } = await fakeRequest(handler, "/chart/table.yaml");
    expect(status).toBe(422);
    expect(body).toContain("Validation error");
  });
});

// ---------------------------------------------------------------------------
// GET /chart/<relpath> — spec validation failure
// ---------------------------------------------------------------------------

describe("GET /chart/<relpath> — validation failure", () => {
  it("returns 422 with an error page listing validation errors", async () => {
    // Write a chart.yaml with an invalid xAxisType
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "chart.yaml"),
      "chartType: line\ntitle: Bad Chart\nxAxisType: weekly\ndata: data.csv\n",
    );
    // Also write a data.csv so loadData doesn't fail first
    writeFileSync(
      join(dir, "data.csv"),
      "time,series,value\n2024-01-01,A,1.0\n",
    );

    const handler = createRequestHandler({ rootDir: dir, liveBundleJs: STUB_BUNDLE, css: STUB_CSS });
    const { status, body } = await fakeRequest(handler, "/chart/chart.yaml");
    expect(status).toBe(422);
    expect(body).toContain("Validation error");
    expect(body).toContain("xAxisType");
  });
});

// ---------------------------------------------------------------------------
// Unknown route → 404
// ---------------------------------------------------------------------------

describe("Unknown route", () => {
  it("returns 404 for an unknown path", async () => {
    const handler = createRequestHandler({
      rootDir: REPO_ROOT,
      liveBundleJs: STUB_BUNDLE,
      css: STUB_CSS,
    });

    const { status } = await fakeRequest(handler, "/unknown/path/here");
    expect(status).toBe(404);
  });

  it("returns 404 when the chart file does not exist", async () => {
    const handler = createRequestHandler({
      rootDir: REPO_ROOT,
      liveBundleJs: STUB_BUNDLE,
      css: STUB_CSS,
    });

    const { status } = await fakeRequest(handler, "/chart/nonexistent/chart.yaml");
    expect(status).toBe(404);
  });
});
