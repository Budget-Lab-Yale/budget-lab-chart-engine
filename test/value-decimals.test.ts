// One decimal-count implementation (src/engine/value-decimals.ts) replaced three copies of the same
// idiom: stacked.ts makeValueFormatter, scales.ts waterfallValueDecimals and scales.ts
// makeTickFormatter. This test keeps the three ORIGINALS frozen verbatim, as the record of what
// shipped through 1.18.0, and requires each call site that now delegates to the shared module to give
// the same result over the same inputs, with one named exception (phase 5: A9 and the tick formatter
// below 1e-6). The originals counted each value's String() form, so float noise counted as precision
// (String(1.1 + 2.2) is "3.3000000000000003", 16 digits, capped to 2 on the value-label paths) and an
// exponent form counted the mantissa's digits ("1e-7" gave 0, so every such tick printed "0"). The
// shared count now rounds to 12 significant digits of the set's largest magnitude before counting.
// The inputs whose count that changes are listed in FIXED below, each with its new count; every
// other input must still match the originals exactly.
import { describe, expect, it } from "vitest";
import { fractionDigitsNeeded, valueLabelDecimals, VALUE_LABEL_DECIMALS_CAP } from "../src/engine/value-decimals";
import { makeTickFormatter, waterfallValueDecimals, computeWaterfallSteps, computeYAxis } from "../src/engine/scales";
import { makeValueFormatter } from "../src/engine/marks/stacked";
import { applyValueAffixes } from "../src/engine/util";
import type { PreparedRow } from "../src/engine/marks/index";
import type { ValueAffixes } from "../src/spec/types";

// ---- The three originals, frozen verbatim (b2525d3) ----

function origStackedFormatter(
  values: number[],
  affixes: ValueAffixes,
  keepMinus: boolean,
  decimals?: number,
): (d: number) => string {
  const maxFrac =
    decimals != null
      ? decimals
      : Math.min(
          2,
          values.reduce((max, v) => {
            if (!Number.isFinite(v)) return max;
            const s = String(v);
            const i = s.indexOf(".");
            return Math.max(max, i < 0 ? 0 : s.length - i - 1);
          }, 0),
        );
  return (d: number) => {
    if (!Number.isFinite(d)) return "";
    return applyValueAffixes((keepMinus ? d : Math.abs(d)).toFixed(maxFrac), affixes);
  };
}

function origWaterfallValueDecimals(data: PreparedRow[], explicit?: number): number {
  if (explicit != null) return explicit;
  const vals: number[] = [];
  for (const s of computeWaterfallSteps(data)) {
    if (s.kind === "skip") continue;
    vals.push(s.delta, s.level);
  }
  return Math.min(
    2,
    vals.reduce((max, v) => {
      if (!Number.isFinite(v)) return max;
      const str = String(v);
      const i = str.indexOf(".");
      return Math.max(max, i < 0 ? 0 : str.length - i - 1);
    }, 0),
  );
}

function origTickFormatter(
  ticks: number[],
  affixes: ValueAffixes = { prefix: "", suffix: "" },
): (d: number) => string {
  const maxFrac = ticks.reduce((max, t) => {
    if (!Number.isFinite(t)) return max;
    const s = String(t);
    const i = s.indexOf(".");
    return Math.max(max, i < 0 ? 0 : s.length - i - 1);
  }, 0);
  return (d: number) => {
    if (!Number.isFinite(d)) return "";
    return applyValueAffixes(d.toFixed(maxFrac), affixes);
  };
}

// ---- Shared inputs ----

const INPUTS: Array<{ name: string; values: number[] }> = [
  { name: "empty", values: [] },
  { name: "integers", values: [0, 4, 8, 12, 16] },
  { name: "halves", values: [0, 0.5, 1] },
  { name: "mixed precision", values: [-1.5, 2.125, 3] },
  { name: "float noise 1.1+2.2 (A9)", values: [1.1, 2.2, 1.1 + 2.2] },
  { name: "float noise 0.1+0.2 (A9)", values: [0.1 + 0.2] },
  { name: "many digits", values: [123.456789] },
  { name: "exponent form small", values: [1e-7, 0.25] },
  { name: "exponent form large", values: [1e21, 1.5] },
  { name: "denormal", values: [5e-324] },
  { name: "non-finite skipped", values: [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.25] },
  { name: "negative zero", values: [-0, -2.75] },
  { name: "1.005", values: [1.005, -0.333] },
];

const PROBES = [0, -0, 1, -1, 0.5, -2.75, 3.3000000000000003, 1e-7, 1234.5678, Number.NaN, Number.POSITIVE_INFINITY];
const AFFIXES: ValueAffixes[] = [
  { prefix: "", suffix: "" },
  { prefix: "$", suffix: " bn" },
  { prefix: "", suffix: "%" },
];
const EXPLICIT: Array<number | undefined> = [undefined, 0, 1, 3];

/** Delta rows for a waterfall whose deltas are `values` (non-finite deltas are drawn as 0). */
function waterfallRows(values: number[]): PreparedRow[] {
  return values.map((v, i) => ({ series: "s", _xc: `c${i}`, _y: v }) as unknown as PreparedRow);
}

/** Inputs whose count the A9 / tick fix changes, with the new uncapped count (ticks) and capped
 *  count (value labels, waterfall). Every other INPUTS entry is unchanged. The originals gave 16,
 *  17, 2 and 1 (capped: 2, 2, 2, 1). */
const FIXED: Record<string, { raw: number; label: number }> = {
  "float noise 1.1+2.2 (A9)": { raw: 1, label: 1 },
  "float noise 0.1+0.2 (A9)": { raw: 1, label: 1 },
  // 0.25 gave 2 and "1e-7" gave 0; 1e-7 needs 7. The label cap keeps the label count at 2.
  "exponent form small": { raw: 7, label: 2 },
  // 1.5 lies below the 12th significant digit of 1e21, so it is not counted.
  "exponent form large": { raw: 0, label: 0 },
};

/** The original tick formatter with a given count, so a FIXED input checks that ONLY the count moved. */
const tickWith =
  (n: number, affixes: ValueAffixes = { prefix: "", suffix: "" }) =>
  (d: number): string =>
    Number.isFinite(d) ? applyValueAffixes(d.toFixed(n), affixes) : "";

/** The count the original tick formatter used (it printed 0 with exactly that many decimals). */
const originalRaw = (values: number[]): number => origTickFormatter(values)(0).split(".")[1]?.length ?? 0;

describe("value-decimals: the shared count matches all three originals, except the named A9 fix", () => {
  it("the three originals agree on the raw count; only the value-label sites cap it", () => {
    // The originals differ ONLY in the cap (stacked and waterfall cap at 2, ticks do not), so one
    // count with a capped entry point covers every site.
    for (const { name, values } of INPUTS) {
      const raw = fractionDigitsNeeded(values);
      expect(Math.min(2, raw), name).toBe(valueLabelDecimals(values));
      expect(VALUE_LABEL_DECIMALS_CAP).toBe(2);
      const fixed = FIXED[name];
      expect(raw, name).toBe(fixed ? fixed.raw : originalRaw(values));
      if (fixed) expect(raw, `${name} is in FIXED, so it differs from the original`).not.toBe(originalRaw(values));
    }
  });

  it("stacked value labels: makeValueFormatter matches the original but for the FIXED count", () => {
    for (const { name, values } of INPUTS)
      for (const affixes of AFFIXES)
        for (const keepMinus of [true, false])
          for (const decimals of EXPLICIT) {
            // An explicit `valueLabels.decimals` always wins, so it is unchanged for FIXED inputs too.
            const before = origStackedFormatter(values, affixes, keepMinus, decimals ?? FIXED[name]?.label);
            const after = makeValueFormatter(values, affixes, keepMinus, decimals);
            for (const d of [...PROBES, ...values]) {
              expect(after(d), `${name} ${JSON.stringify(affixes)} keepMinus=${keepMinus} decimals=${decimals} d=${d}`).toBe(
                before(d),
              );
            }
          }
  });

  it("waterfall: waterfallValueDecimals matches the original but for the FIXED count", () => {
    for (const { name, values } of INPUTS)
      for (const explicit of EXPLICIT) {
        const rows = waterfallRows(values);
        const want = explicit ?? FIXED[name]?.label ?? origWaterfallValueDecimals(rows, explicit);
        expect(waterfallValueDecimals(rows, explicit), `${name} explicit=${explicit}`).toBe(want);
      }
  });

  it("ticks: makeTickFormatter matches the original but for the FIXED count (uncapped)", () => {
    for (const { name, values } of INPUTS)
      for (const affixes of AFFIXES) {
        const fixed = FIXED[name];
        const before = fixed ? tickWith(fixed.raw, affixes) : origTickFormatter(values, affixes);
        const after = makeTickFormatter(values, affixes);
        for (const d of [...PROBES, ...values]) {
          expect(after(d), `${name} ${JSON.stringify(affixes)} d=${d}`).toBe(before(d));
        }
      }
    // Default affixes.
    expect(makeTickFormatter([0, 0.5, 1])(0.25)).toBe(origTickFormatter([0, 0.5, 1])(0.25));
  });
});

describe("A9: float noise is not precision", () => {
  it("the report's examples: a noisy sum counts the digits it was summed from", () => {
    // The originals read 16 and 17 digits, so every value label in the chart printed 2 decimals.
    expect(fractionDigitsNeeded([1.1 + 2.2])).toBe(1);
    expect(fractionDigitsNeeded([0.1 + 0.2])).toBe(1);
    // Stacked nets 1.1 + 2.2 and 1.5 + 2.5: "3.3", "4.0" (were "3.30", "4.00").
    expect(valueLabelDecimals([1.1 + 2.2, 1.5 + 2.5])).toBe(1);
    // Waterfall 1.1, 2.2, 0.5: running levels 1.1, 3.3000000000000003, 3.8000000000000003 (were "1.10").
    expect(waterfallValueDecimals(waterfallRows([1.1, 2.2, 0.5]))).toBe(1);
    expect(origWaterfallValueDecimals(waterfallRows([1.1, 2.2, 0.5]))).toBe(2);
    // Uncapped: a noisy tick no longer prints every digit (the original printed "1.0000000000000000").
    expect(makeTickFormatter([1.1 + 2.2])(1)).toBe("1.0");
  });

  it("cancellation: a net that sums to a small or zero value carries no noise digits", () => {
    // 5.3 + -5.2 is 0.09999999999999964; 0.1 + 0.2 - 0.3 is 5.551115123125783e-17, not 0.
    expect(fractionDigitsNeeded([5.3 + -5.2])).toBe(1);
    expect(valueLabelDecimals([0.1 + 0.2 - 0.3, 2])).toBe(0);
    expect(valueLabelDecimals([0.1 + 0.2 - 0.3, 2.5])).toBe(1);
  });

  it("genuine precision is kept, up to 12 significant digits of the largest value", () => {
    expect(fractionDigitsNeeded([123.456789])).toBe(6);
    expect(fractionDigitsNeeded([0, 0.125, 1])).toBe(3);
    expect(fractionDigitsNeeded([1234567.891])).toBe(3);
    expect(fractionDigitsNeeded([-1.5, 2.125, 3])).toBe(3);
    // 16 significant digits (a raw float): counted to the 12th.
    expect(fractionDigitsNeeded([2.593569308310415])).toBe(11);
    expect(valueLabelDecimals([2.593569308310415])).toBe(2);
    // CHANGELOG caveat: at 1e10 and up, decimals below the 12th digit are dropped.
    expect(makeValueFormatter([12345678901.25], { prefix: "", suffix: "" }, true)(12345678901.25)).toBe("12345678901.3");
    expect(fractionDigitsNeeded([])).toBe(0);
    expect(fractionDigitsNeeded([0, -0])).toBe(0);
    expect(fractionDigitsNeeded([Number.NaN, Number.POSITIVE_INFINITY])).toBe(0);
  });
});

describe("tick formatter below 1e-6: ticks are not all printed as 0", () => {
  it("exponent-form ticks count their decimals", () => {
    // String(2e-7) is "2e-7": the original counted 0 decimals and printed every tick "0".
    const ticks = [0, 1e-7, 2e-7, 3e-7];
    expect(ticks.map(origTickFormatter(ticks))).toEqual(["0", "0", "0", "0"]);
    expect(ticks.map(makeTickFormatter(ticks))).toEqual(["0.0000000", "0.0000001", "0.0000002", "0.0000003"]);
    // "1.5e-7": the original counted the mantissa's 4 characters after "." and printed "0.0000".
    const half = [0, 5e-8, 1e-7, 1.5e-7];
    expect(half.map(origTickFormatter(half))).toEqual(["0.0000", "0.0000", "0.0000", "0.0000"]);
    expect(half.map(makeTickFormatter(half))).toEqual(["0.00000000", "0.00000005", "0.00000010", "0.00000015"]);
    expect(makeTickFormatter([0, 2e-12, 4e-12], { prefix: "", suffix: "%" })(2e-12)).toBe("0.000000000002%");
  });

  it("a step far below the largest tick's 12th digit: every tick prints its own value", () => {
    // The set-relative cut alone printed [1e12, 1e12 + 1]'s six ticks (step 0.2) as three
    // "1000000000000" and three "1000000000001"; ticks also count the decimals of their step.
    for (const [lo, hi, tickCount] of [
      [1e12, 1e12 + 1, 5],
      [-1e12 - 1, -1e12, 5],
      [1e8, 1e8 + 1e-4, 5],
      [1e9, 1e9 + 1e-5, 5],
      [0.1, 0.1 + 1e-12, 5],
      [1000000000000.1, 1000000000000.15, 1],
    ] as Array<[number, number, number]>) {
      const { ticks } = computeYAxis([lo, hi], { domain: [lo, hi], tickCount });
      const labels = ticks.map(makeTickFormatter(ticks));
      const step = Math.abs(ticks[1]! - ticks[0]!);
      expect(ticks.length, `[${lo}, ${hi}]`).toBeGreaterThan(1);
      expect(new Set(labels).size, `[${lo}, ${hi}]: ${labels.join(" ")}`).toBe(ticks.length);
      // Each label reads back as its own tick, well inside half a step (no rounding onto a neighbour
      // or past the domain).
      ticks.forEach((t, i) => expect(Math.abs(Number(labels[i]) - t), `[${lo}, ${hi}] ${labels[i]}`).toBeLessThan(step / 4));
    }
    // Codex's case: uniqueness alone stopped at 1 decimal and printed the upper tick as "…0.2".
    const codex = computeYAxis([0], { domain: [1000000000000.1, 1000000000000.15], tickCount: 1 }).ticks;
    expect(codex.map(makeTickFormatter(codex))).toEqual(["1000000000000.10", "1000000000000.15"]);
    const { ticks } = computeYAxis([1e12, 1e12 + 1], { domain: [1e12, 1e12 + 1] });
    expect(ticks.map(makeTickFormatter(ticks))).toEqual([
      "1000000000000.0", "1000000000000.2", "1000000000000.4", "1000000000000.6", "1000000000000.8", "1000000000001.0",
    ]);
  });

  it("the count stays within toFixed's limit of 100 digits", () => {
    expect(fractionDigitsNeeded([5e-324])).toBe(0);
    expect(() => makeTickFormatter([1e-150, 2e-150])(1e-150)).not.toThrow();
  });
});
