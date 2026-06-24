import { describe, it, expect } from "vitest";
import { CHART_CSS } from "../src/embed/styles";
import { buildStandaloneHtml } from "../src/embed/bundle-standalone";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

describe("CSS token fidelity (matches the Style-Guide, not approximations)", () => {
  it("carries the canonical Style-Guide color values", () => {
    expect(CHART_CSS).toMatch(/--tbl-navy:\s*#101F5B/); // brand navy (the title color)
    expect(CHART_CSS).toMatch(/--tbl-text-body:\s*#4A4A4A/);
    expect(CHART_CSS).toMatch(/--tbl-text-muted:\s*#6D6D6D/);
    expect(CHART_CSS).toMatch(/--tbl-text-axis:\s*#666666/);
    expect(CHART_CSS).toMatch(/--tbl-border:\s*#E5E5E5/);
    expect(CHART_CSS).toMatch(/--tbl-bg-subtle:\s*#F6F7F9/);
  });

  it("does not contain the old hand-invented fallback values", () => {
    for (const wrong of ["#2E3044", "#6B7280", "#F7F8FA", "#E2E5EB", "#1A1A2E;\n}"]) {
      expect(CHART_CSS).not.toContain(wrong);
    }
  });

  it("includes the eyebrow (figure-supertitle) rule", () => {
    expect(CHART_CSS).toContain(".figure-supertitle");
    expect(CHART_CSS).toMatch(/text-transform:\s*uppercase/);
  });

  it("reserves the legend reset button's height so pinning doesn't shift the chart", () => {
    // .tbl-legend must carry a min-height matching the reset button (22px), else the row
    // grows ~1px when the reset toggles in on the first pin.
    expect(CHART_CSS).toMatch(/\.tbl-legend\s*\{[^}]*min-height:\s*22px/);
  });
});

describe("standalone HTML font loading", () => {
  it("inlines a variable Figtree covering the full weight range the CSS uses (incl. 700/800)", () => {
    const spec: ChartSpec = { chartType: "line", title: "t", xAxisType: "temporal", data: "d.csv" };
    const rows: TidyRow[] = [{ time: "2021-01-01", series: "a", value: "1" }];
    const html = buildStandaloneHtml({ spec, rows, liveBundleJs: "", css: CHART_CSS });
    // The inlined @font-face is a variable font spanning 300–900, so every weight the CSS uses
    // (body 500 … bold 800) resolves from the one embedded file — no Google Fonts request.
    expect(html).toContain("@font-face");
    expect(html).toMatch(/font-weight:\s*300 900/);
    expect(html).not.toContain("fonts.googleapis.com");
  });
});
