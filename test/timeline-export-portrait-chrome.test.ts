// @vitest-environment jsdom
//
// Round 3 final fix (Rulings 50, 51b): the portrait PNG frame's chrome measured with widths close to
// the real Figtree. jsdom has no canvas, so the export's measureText falls back to 8px a character —
// far narrower than 22px weight-800 Figtree (~11–13px a character), which is how a title running
// into the logo passed `timeline-export-portrait.test.ts`. This file gives the export a measuring
// canvas backed by the calibrated Figtree table instead (a separate file, because figure-chrome
// caches the first context it gets).
import { describe, it, expect, beforeAll } from "vitest";
import { buildExportSvg } from "../src/embed/export-png";
import { TIMELINE_CLASS } from "../src/engine/marks/timeline";
import { MARGIN, LOGO_W, LOGO_H } from "../src/embed/figure-chrome";
import { timelineTextWidth } from "../src/engine/timeline-text";
import type { ChartSpec } from "../src/spec/types";
import type { TidyRow } from "../src/data/index";

/** Width of `text` in `font` ("<weight> <size>px <family>"): the calibrated table at 500 or 700, and
 *  weight 800 as 700 plus 2% — Chromium draws "Implementation" at 800 22px 163px, "reconciliation"
 *  141px, "milestones" 111px, "Workforce" 109px; this gives 163.9, 141.2, 111.6, 110.8. */
function figtreeWidth(text: string, font: string): number {
  const m = /^(\d+) (\d+(?:\.\d+)?)px/.exec(font);
  if (!m) throw new Error(`unparsed font ${font}`);
  const weight = Number(m[1]);
  const size = Number(m[2]);
  return timelineTextWidth(text, size, weight >= 700 ? 700 : 500) * (weight >= 800 ? 1.02 : 1);
}

beforeAll(() => {
  const ctx = { font: "", measureText(t: string) { return { width: figtreeWidth(t, this.font) }; } };
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as HTMLCanvasElement["getContext"];
});

const num = (el: Element, a: string): number => Number(el.getAttribute(a));
const chartOf = (svg: SVGSVGElement) => svg.querySelector(`svg.${TIMELINE_CLASS}`) as SVGSVGElement;
const chromeTexts = (svg: SVGSVGElement) => [...svg.querySelectorAll("text")].filter((t) => !t.closest(`svg.${TIMELINE_CLASS}`) && !t.closest("g"));
const TITLE_FONT = "800 22px Figtree";

/** Lines wrapped at their spaces to `innerW`: each one whose words fit stays inside it, and is
 *  filled to it (the next line's first word would not have fitted). A one-word line wider than
 *  `innerW` is the documented exception. */
function expectWrappedTo(lines: string[], font: string, innerW: number): void {
  lines.forEach((text, i) => {
    if (!text.includes(" ") && figtreeWidth(text, font) > innerW) return;
    expect(figtreeWidth(text, font), text).toBeLessThanOrEqual(innerW);
    const next = lines[i + 1];
    if (next) expect(figtreeWidth(`${text} ${next.split(" ")[0]}`, font), text).toBeGreaterThan(innerW);
  });
}

const BASE = {
  chartType: "timeline", xAxisType: "temporal", data: "d.csv", orientation: "vertical",
  subtitle: "Signing, rules, fixes and effective dates", source: "The Budget Lab analysis",
} as const;
// The final review's repro: short labels hug a two-lane timeline down to the 360px frame.
const LANES = { ...BASE, timeline: { lanes: true }, columns: { x: "date", label: "title", series: "category" } } as const;
const SHORT_LANES = [
  { date: "2025", title: "Signed", category: "alpha" }, { date: "2026", title: "Rules", category: "beta" },
  { date: "2027", title: "Fix", category: "alpha" }, { date: "2028", title: "Effective", category: "beta" },
] as TidyRow[];
const POINTS = [
  { date: "2026", title: "Policy begins" }, { date: "2050", title: "First cohort born under the fully phased-in new policy" },
  { date: "2075", title: "Annual projection ends" }, { date: "2100", title: "That cohort turns 65" },
] as TidyRow[];

describe("portrait frame: the logo has its own row and the title wraps below it (Ruling 50)", () => {
  const cases: Array<[string, ChartSpec, TidyRow[]]> = [
    ["two short lanes at the 360px floor", { ...LANES, title: "Implementation milestones for the 2025 reconciliation law" } as ChartSpec, SHORT_LANES],
    ["a long title on a points timeline", { ...BASE, columns: { x: "date", label: "title" },
      title: "Key dates in the implementation of the 2025 reconciliation law and its successors" } as ChartSpec, POINTS],
    ["a title word wider than the frame", { ...LANES, title: `Workforce ${"Implementationreconciliation".repeat(2)} milestones` } as ChartSpec, SHORT_LANES],
  ];
  for (const [name, spec, rows] of cases) {
    it(name, () => {
      const svg = buildExportSvg(spec, rows);
      const frameW = num(svg, "width");
      const innerW = frameW - 2 * MARGIN;
      const logo = svg.querySelector("image")!;
      const [lx0, ly0] = [num(logo, "x"), num(logo, "y")];
      const [lx1, ly1] = [lx0 + LOGO_W, ly0 + LOGO_H];
      // Right-flush at the frame's right margin, as in landscape.
      expect(lx1).toBe(frameW - MARGIN);
      const lines = chromeTexts(svg).filter((t) => t.getAttribute("font-size") === "22");
      expect(lines.map((t) => t.textContent).join(" ")).toBe(spec.title);
      for (const t of lines) {
        const text = t.textContent ?? "";
        const x0 = num(t, "x");
        const x1 = x0 + figtreeWidth(text, TITLE_FONT);
        const base = num(t, "y");
        // The line's box (a full em above the baseline, the descent below) clears the logo's, and
        // sits below the logo's row.
        const overlaps = x0 < lx1 && x1 > lx0 && base - 22 < ly1 && base + 6 > ly0;
        expect(overlaps, `title line "${text}" overlaps the logo`).toBe(false);
        expect(base - 22).toBeGreaterThanOrEqual(ly1);
        expect(x0).toBe(MARGIN);
      }
      expectWrappedTo(lines.map((t) => t.textContent ?? ""), TITLE_FONT, innerW);
      // The chrome below the title starts below its last line, and the chart below that.
      const lastTitle = Math.max(...lines.map((t) => num(t, "y")));
      const sub = chromeTexts(svg).find((t) => t.getAttribute("font-size") === "14")!;
      expect(num(sub, "y")).toBeGreaterThan(lastTitle);
      expect(num(chartOf(svg), "y")).toBeGreaterThan(num(sub, "y"));
    });
  }

  it("wraps the subtitle, note and source at their spaces to the frame's inner width", () => {
    const long = "and the words of this sentence run on well past what any portrait frame can hold on one line";
    const spec = { ...LANES, title: "T", subtitle: `Subtitle ${long}`, note: `Note ${long}`, source: `Agency ${long}` } as ChartSpec;
    const svg = buildExportSvg(spec, SHORT_LANES);
    const innerW = num(svg, "width") - 2 * MARGIN;
    const texts = chromeTexts(svg);
    const block = (first: RegExp, size: string): string[] => {
      const all = texts.filter((t) => t.getAttribute("font-size") === size).map((t) => t.textContent ?? "");
      const start = all.findIndex((s) => first.test(s));
      expect(start).toBeGreaterThanOrEqual(0);
      const out: string[] = [];
      for (const s of all.slice(start)) {
        out.push(s);
        if (s.endsWith("one line")) break;
      }
      return out;
    };
    const sub = block(/^Subtitle/, "14");
    const note = block(/^Note/, "11");
    const source = block(/^Source: Agency/, "11");
    for (const lines of [sub, note, source]) expect(lines.length).toBeGreaterThan(1);
    expectWrappedTo(sub, "700 14px Figtree", innerW);
    expectWrappedTo(note, "500 11px Figtree", innerW);
    expectWrappedTo(source, "500 11px Figtree", innerW);
  });

  it("draws the final review's repro at the 360px floor with the title in three lines (six beside the logo)", () => {
    const svg = buildExportSvg({ ...LANES, title: "Implementation milestones for the 2025 reconciliation law" } as ChartSpec, SHORT_LANES);
    expect(num(svg, "width")).toBe(360);
    const lines = chromeTexts(svg).filter((t) => t.getAttribute("font-size") === "22").map((t) => t.textContent);
    // Beside the logo the column was 106px: six lines, and "Implementation" (163px) over the logo.
    expect(lines).toEqual(["Implementation", "milestones for the 2025", "reconciliation law"]);
  });
});

describe("portrait frame: the x-axis title wraps within the frame (Ruling 51b)", () => {
  const caption = "Year ".repeat(20).trim();
  const spec = { ...BASE, title: "T", note: "A note.", timeline: { axis: true }, x_axis_title: caption, columns: { x: "date", label: "title" } } as ChartSpec;
  const rows = [{ date: "2020", title: "A" }, { date: "2030", title: "B" }] as TidyRow[];

  it("centres every line inside the frame and reserves their height above the note", () => {
    const svg = buildExportSvg(spec, rows);
    const frameW = num(svg, "width");
    const font = "700 12px Figtree";
    const lines = chromeTexts(svg).filter((t) => t.getAttribute("font-size") === "12" && /^Year/.test(t.textContent ?? ""));
    expect(lines.map((t) => t.textContent).join(" ")).toBe(caption);
    expect(lines.length).toBeGreaterThan(1);
    for (const t of lines) {
      const w = figtreeWidth(t.textContent ?? "", font);
      expect(t.getAttribute("text-anchor")).toBe("middle");
      expect(num(t, "x")).toBe(frameW / 2);
      expect(num(t, "x") - w / 2).toBeGreaterThanOrEqual(MARGIN);
      expect(num(t, "x") + w / 2).toBeLessThanOrEqual(frameW - MARGIN);
    }
    const chart = chartOf(svg);
    const ys = lines.map((t) => num(t, "y"));
    expect(Math.min(...ys)).toBeGreaterThan(num(chart, "y") + num(chart, "height"));
    const note = chromeTexts(svg).find((t) => t.textContent === "A note.")!;
    expect(num(note, "y")).toBeGreaterThan(Math.max(...ys) + 12);
    expect(num(svg, "height")).toBeGreaterThan(Math.max(...chromeTexts(svg).map((t) => num(t, "y"))));
  });

  it("hard-breaks a caption token wider than the frame", () => {
    const token = "Y".repeat(80);
    const svg = buildExportSvg({ ...spec, x_axis_title: token } as ChartSpec, rows);
    const frameW = num(svg, "width");
    const lines = chromeTexts(svg).filter((t) => t.getAttribute("font-size") === "12" && /^Y+$/.test(t.textContent ?? ""));
    expect(lines.map((t) => t.textContent).join("")).toBe(token);
    expect(lines.length).toBeGreaterThan(1);
    for (const t of lines) expect(figtreeWidth(t.textContent ?? "", "700 12px Figtree")).toBeLessThanOrEqual(frameW - 2 * MARGIN);
    // Split at the frame's width, not shorter: each piece but the last would have taken one more letter.
    lines.slice(0, -1).forEach((t) => expect(figtreeWidth(`${t.textContent}Y`, "700 12px Figtree")).toBeGreaterThan(frameW - 2 * MARGIN));
  });
});
