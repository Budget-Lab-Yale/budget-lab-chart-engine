// @vitest-environment jsdom
//
// Where `[text](url)` links actually land: the live DOM (charts AND tables, one renderer) and the
// PNG export's SVG chrome (charts AND tables, one composer).
//
// The export deliberately draws a link as underlined TEXT, not an <a>. HTML injected into an SVG
// lands in the XHTML namespace and does not rasterise, and a raster PNG cannot carry a link target
// anyway — an <a> there would promise something the download cannot deliver.
import { describe, it, expect } from "vitest";
import { mountChart } from "../src/engine/render-live";
import { mountTable } from "../src/table/mount";
import { buildExportSvg } from "../src/embed/export-png";
import { validateTableSpec } from "../src/spec/table-validate";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const ROWS = [
  { time: "2020", value: "1", series: "A" },
  { time: "2021", value: "2", series: "A" },
] as unknown as TidyRow[];

const specWith = (extra: Record<string, unknown>): ChartSpec =>
  ({ chartType: "line", xAxisType: "temporal", title: "T", ...extra }) as unknown as ChartSpec;

const LINKED = "BLS, [CES](https://www.bls.gov/ces/).";
const PLAIN = "BLS, CES.";

function live(spec: ChartSpec): HTMLElement {
  const c = document.createElement("div");
  document.body.appendChild(c);
  mountChart(c, { spec, rows: ROWS, width: 720, height: 400 } as never);
  return c;
}

describe("live DOM", () => {
  it("renders a source link as a real anchor, safely attributed", () => {
    const a = live(specWith({ source: LINKED })).querySelector<HTMLAnchorElement>(".figure-source a");
    expect(a).not.toBeNull();
    expect(a!.getAttribute("href")).toBe("https://www.bls.gov/ces/");
    expect(a!.textContent).toBe("CES");
    expect(a!.rel).toBe("noopener noreferrer");
    expect(a!.className).toBe("figure-link");
    expect(a!.parentElement!.textContent).toBe("Source: BLS, CES.");
  });

  it("renders a note link too", () => {
    expect(live(specWith({ note: LINKED })).querySelector(".figure-note a")).not.toBeNull();
  });

  it("leaves a link-free source as plain text with no anchor", () => {
    const p = live(specWith({ source: PLAIN })).querySelector(".figure-source")!;
    expect(p.querySelector("a")).toBeNull();
    expect(p.textContent).toBe("Source: BLS, CES.");
  });

  it("forms no anchor for a scheme outside the allowlist", () => {
    const p = live(specWith({ source: "x [a](javascript:alert(1)) y" })).querySelector(".figure-source")!;
    expect(p.querySelector("a")).toBeNull();
    expect(p.textContent).toContain("[a](javascript:alert(1))");
  });

  it("covers table source and notes through the same renderer", () => {
    const c = document.createElement("div");
    document.body.appendChild(c);
    mountTable(c, {
      spec: {
        title: "T", stub: ["r"], header: ["h"],
        source: LINKED, notes: [LINKED],
      },
      rows: [{ stub: "r", header: "h", value: "1" }],
    } as never);
    expect(c.querySelector(".figure-source a")).not.toBeNull();
    expect(c.querySelector(".figure-note a")).not.toBeNull();
  });
});

/** Every <text> the bottom chrome drew, as {content, tspans, underlined}. */
function sourceTexts(svg: SVGSVGElement) {
  return Array.from(svg.querySelectorAll("text"))
    .filter((t) => (t.textContent ?? "").startsWith("Source:"))
    .map((t) => ({
      content: t.textContent ?? "",
      tspans: t.querySelectorAll("tspan").length,
      underlined: t.querySelectorAll('tspan[text-decoration="underline"]').length,
    }));
}

describe("PNG export chrome", () => {
  it("draws a link-free source through the ORIGINAL branch — one bold prefix tspan, nothing else", () => {
    const [line] = sourceTexts(buildExportSvg(specWith({ source: PLAIN }), ROWS));
    expect(line!.content).toBe("Source: BLS, CES.");
    // The plain branch emits exactly the bold prefix as a tspan and the remainder as a text node.
    // One tspan per WORD would mean the run-aware path had taken over a spec that predates it.
    expect(line!.tspans).toBe(1);
    expect(line!.underlined).toBe(0);
  });

  it("underlines the link text and never emits an HTML anchor", () => {
    const svg = buildExportSvg(specWith({ source: LINKED }), ROWS);
    const [line] = sourceTexts(svg);
    expect(line!.content).toBe("Source: BLS, CES.");
    expect(line!.underlined).toBe(1);
    expect(svg.querySelectorAll("a")).toHaveLength(0);
  });

  it("shows the same visible text, on the same number of lines, linked or not", () => {
    const linked = sourceTexts(buildExportSvg(specWith({ source: LINKED }), ROWS));
    const plain = sourceTexts(buildExportSvg(specWith({ source: PLAIN }), ROWS));
    expect(linked.map((l) => l.content)).toEqual(plain.map((l) => l.content));
  });

  it("omits the URL — a PNG reader cannot follow it, so it is not shown", () => {
    const svg = buildExportSvg(specWith({ source: LINKED }), ROWS);
    expect(svg.textContent).not.toContain("bls.gov");
  });
});

// Table source/notes are ALSO policed by the inline-math grammar in table/richtext.ts, where `\[`
// opens display math. Link syntax uses a bare `[`, so the two grammars do not overlap — but that is
// a claim about another module's parser, so it is asserted rather than assumed.
describe("table rich-text validation coexists with link syntax", () => {
  it("accepts a table whose source and notes carry links", () => {
    const res = validateTableSpec({
      title: "T", data: "d.csv", stub: ["r"], header: ["h"], value: "value",
      source: "BLS, [CES](https://www.bls.gov/ces/).",
      notes: ["See [the methodology](https://example.org/m)."],
    });
    expect(res.errors).toEqual([]);
    expect(res.valid).toBe(true);
  });

  it("still rejects unsupported math, so the link parser has not displaced that check", () => {
    const res = validateTableSpec({
      title: "T", data: "d.csv", stub: ["r"], header: ["h"], value: "value",
      source: String.raw`\[\frac{a}{b}\]`,
    });
    expect(res.valid).toBe(false);
  });
});
