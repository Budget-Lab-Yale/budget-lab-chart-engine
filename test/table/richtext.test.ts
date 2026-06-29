// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  parseRich,
  richWidth,
  richToPlain,
  hasMath,
  validateRichText,
  appendRichHtml,
  renderRichSvgText,
} from "../../src/table/richtext";

// Deterministic char-width measurer (mirrors the table tests' jsdom stub).
const measure = (s: string, fontPx: number, _weight?: number) => s.length * fontPx * 0.6;

describe("parseRich — passthrough", () => {
  it("returns a single verbatim text run when there is no math delimiter", () => {
    expect(parseRich("Change in Gini")).toEqual([{ kind: "text", text: "Change in Gini", italic: false }]);
  });
  it("leaves bare $ _ ^ * untouched outside math (no collision with currency)", () => {
    const s = "Cost is $2.50 per unit_x";
    expect(parseRich(s)).toEqual([{ kind: "text", text: s, italic: false }]);
    expect(hasMath(s)).toBe(false);
  });
  it("keeps literal parentheses like sublabels (S) plain — only \\( triggers math", () => {
    expect(hasMath("(S)")).toBe(false);
    expect(richToPlain("(S)")).toBe("(S)");
  });
});

describe("parseRich — math subset", () => {
  it("maps Greek macros to Unicode (lowercase italic, uppercase upright)", () => {
    expect(parseRich("\\(\\sigma\\)")).toEqual([{ kind: "text", text: "σ", italic: true }]);
    expect(parseRich("\\(\\theta\\)")).toEqual([{ kind: "text", text: "θ", italic: true }]);
    expect(parseRich("\\(\\Sigma\\)")).toEqual([{ kind: "text", text: "Σ", italic: false }]);
  });
  it("auto-italicizes single-letter math variables", () => {
    const runs = parseRich("\\(r\\)");
    expect(runs).toEqual([{ kind: "text", text: "r", italic: true }]);
  });
  it("parses a subscript (r_{ai})", () => {
    const runs = parseRich("\\(r_{ai}\\)");
    expect(runs[0]).toEqual({ kind: "text", text: "r", italic: true });
    expect(runs[1]).toEqual({ kind: "sub", text: "ai", italic: true });
  });
  it("parses a lone superscript", () => {
    const runs = parseRich("\\(x^2\\)");
    expect(runs[1]).toEqual({ kind: "super", text: "2", italic: false });
  });
  it("stacks sub+super on one base (\\theta_1^K → subsup)", () => {
    const runs = parseRich("\\(\\theta_1^K\\)");
    expect(runs[0]).toEqual({ kind: "text", text: "θ", italic: true });
    expect(runs[1]).toEqual({ kind: "subsup", sub: "1", sup: "K", subItalic: false, supItalic: true });
  });
  it("handles ^ before _ identically (order-independent stacking)", () => {
    const runs = parseRich("\\(\\theta^K_1\\)");
    expect(runs[1]).toEqual({ kind: "subsup", sub: "1", sup: "K", subItalic: false, supItalic: true });
  });
  it("renders mixed literal text around an inline math span", () => {
    const s = "2030 capital share (\\(\\theta_1^K\\))";
    const runs = parseRich(s);
    // Leading literal stays upright; the italic θ base, the stacked cluster, and the ")" follow.
    expect(runs[0]).toEqual({ kind: "text", text: "2030 capital share (", italic: false });
    expect(runs[1]).toEqual({ kind: "text", text: "θ", italic: true });
    expect(runs.some((r) => r.kind === "subsup")).toBe(true);
    expect(runs[runs.length - 1]).toEqual({ kind: "text", text: ")", italic: false });
    expect(richToPlain(s)).toBe("2030 capital share (θK1)");
  });
  it("supports \\textit{} inline italics", () => {
    expect(parseRich("\\(\\textit{abc}\\)")).toEqual([{ kind: "text", text: "abc", italic: true }]);
  });
  it("unescapes \\$ within a math-bearing string; leaves plain strings verbatim", () => {
    // Plain string (no delimiter) passes through untouched.
    expect(parseRich("price \\$5")).toEqual([{ kind: "text", text: "price \\$5", italic: false }]);
    // Alongside math, \$ becomes a literal $ in the surrounding text.
    expect(parseRich("\\$5 for \\(g_y\\)")[0]).toEqual({ kind: "text", text: "$5 for ", italic: false });
  });
  it("treats an unterminated delimiter as literal text (never throws)", () => {
    expect(() => parseRich("\\(\\sigma")).not.toThrow();
    expect(richToPlain("\\(\\sigma")).toContain("σ");
  });
});

describe("richWidth", () => {
  it("equals plain measureText for non-math strings", () => {
    expect(richWidth("hello", 13, 400, measure)).toBe(measure("hello", 13, 400));
  });
  it("scales script runs down and uses max width for a stacked cluster", () => {
    // θ (full) + max(1,K) at 0.72 scale.
    const w = richWidth("\\(\\theta_1^K\\)", 13, 400, measure);
    const expected = measure("θ", 13, 400) + Math.max(measure("1", 13 * 0.72, 400), measure("K", 13 * 0.72, 400));
    expect(w).toBeCloseTo(expected, 6);
  });
});

describe("validateRichText", () => {
  it("accepts the supported subset", () => {
    expect(validateRichText("\\(\\theta_1^K\\)")).toEqual([]);
    expect(validateRichText("\\(\\sigma \\leq 1\\)")).toEqual([]);
    expect(validateRichText("no math here")).toEqual([]);
  });
  it("flags unsupported 2-D commands", () => {
    expect(validateRichText("\\(\\frac{a}{b}\\)")).toContain("frac");
    expect(validateRichText("\\(\\sqrt{x}\\)")).toContain("sqrt");
  });
});

describe("appendRichHtml", () => {
  it("appends a plain text node for non-math (DOM identical to textContent)", () => {
    const td = document.createElement("td");
    appendRichHtml(td, "Labor (σ-free)", document);
    expect(td.childNodes.length).toBe(1);
    expect(td.textContent).toBe("Labor (σ-free)");
  });
  it("builds <sub>/<sup> with class tbl-math, not the muted footnote sup", () => {
    const td = document.createElement("td");
    appendRichHtml(td, "\\(r_{ai}\\)", document);
    const sub = td.querySelector("sub.tbl-math");
    expect(sub).not.toBeNull();
    expect(sub!.textContent).toBe("ai");
  });
  it("builds a stacked .tbl-msubsup with a sup half over a sub half", () => {
    const th = document.createElement("th");
    appendRichHtml(th, "\\(\\theta_1^K\\)", document);
    const stack = th.querySelector(".tbl-msubsup");
    expect(stack).not.toBeNull();
    expect(stack!.querySelector(".tbl-msup")!.textContent).toBe("K");
    expect(stack!.querySelector(".tbl-msub")!.textContent).toBe("1");
    // Base glyph present as text.
    expect(th.textContent).toContain("θ");
  });
});

describe("renderRichSvgText", () => {
  const base = {
    x: 100, baselineY: 20, fontFamily: "Figtree", fontSize: 13, weight: 400, fill: "#000", measure,
  } as const;

  it("lowers a subscript below the baseline via absolute y", () => {
    const t = renderRichSvgText(document, "\\(r_{ai}\\)", { ...base, anchor: "start" });
    const sub = Array.from(t.querySelectorAll("tspan")).find((ts) => ts.textContent === "ai");
    expect(sub).toBeTruthy();
    expect(Number(sub!.getAttribute("y"))).toBeGreaterThan(base.baselineY); // below baseline
  });

  it("stacks a subsup cluster: super above, sub below, both at the same x", () => {
    const t = renderRichSvgText(document, "\\(\\theta_1^K\\)", { ...base, anchor: "start" });
    const sup = Array.from(t.querySelectorAll("tspan")).find((ts) => ts.textContent === "K")!;
    const sub = Array.from(t.querySelectorAll("tspan")).find((ts) => ts.textContent === "1")!;
    expect(Number(sup.getAttribute("y"))).toBeLessThan(base.baselineY);    // super raised
    expect(Number(sub.getAttribute("y"))).toBeGreaterThan(base.baselineY); // sub lowered
    expect(sup.getAttribute("x")).toBe(sub.getAttribute("x"));             // same horizontal position
  });

  it("centers a middle-anchored rich string by measuring its total width", () => {
    const t = renderRichSvgText(document, "\\(\\sigma\\)", { ...base, anchor: "middle" });
    const w = richWidth("\\(\\sigma\\)", 13, 400, measure);
    expect(Number(t.getAttribute("x"))).toBeCloseTo(100 - w / 2, 6);
    expect(t.getAttribute("text-anchor")).toBe("start");
  });
});
