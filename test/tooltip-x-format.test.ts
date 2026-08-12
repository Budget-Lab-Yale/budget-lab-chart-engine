// @vitest-environment jsdom
//
// `tooltip_x_format` end-to-end: the spec key has to reach the formatter the crosshair actually
// calls. There are two `d3.timeFormat("%b %Y")` literals in crosshair.ts (:92, :487) that look
// like they'd also need patching, but they are auto-detect FALLBACKS — xAxisType is required
// (engine/index.ts throws without it), so the adapter always supplies a formatter and the
// fallbacks never fire on a declared temporal axis. These tests are what proves that: if the
// override didn't reach the tooltip, the last one here would report "Jul 2026".
import { describe, it, expect } from "vitest";
import { renderChart } from "../src/engine/index";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

const DAILY: TidyRow[] = [
  { time: "2026-07-21", series: "Overall", value: "9.1" },
  { time: "2026-07-22", series: "Overall", value: "9.3" },
  { time: "2026-07-23", series: "Overall", value: "4.2" },
  { time: "2026-07-24", series: "Overall", value: "4.2" },
] as unknown as TidyRow[];

const BASE = {
  chartType: "line",
  title: "Daily statutory rate",
  xAxisType: "temporal",
  columns: { x: "time", value: "value", series: "series" },
} as unknown as ChartSpec;

const OPTS = { width: 720, height: 400, document };

describe("tooltip_x_format reaches the rendered chart", () => {
  it("without the key, a daily series formats month-only (today's behavior)", () => {
    const r = renderChart(BASE, DAILY, OPTS);
    expect(r.tooltipXFormat!(r.tooltipXParse!("2026-07-23"))).toBe("Jul 2026");
  });

  it("with the key, the tooltip names the day the rate actually moved", () => {
    const spec = { ...BASE, tooltip_x_format: "%b %-d, %Y" } as unknown as ChartSpec;
    const r = renderChart(spec, DAILY, OPTS);
    expect(r.tooltipXFormat!(r.tooltipXParse!("2026-07-23"))).toBe("Jul 23, 2026");
  });
});
