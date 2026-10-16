// One decimal-count implementation (src/engine/value-decimals.ts) replaced three copies of the same
// idiom: stacked.ts makeValueFormatter, scales.ts waterfallValueDecimals and scales.ts
// makeTickFormatter. This test freezes the three ORIGINALS verbatim and requires the shared module,
// and each call site that now delegates to it, to give the same result over the same inputs —
// including float noise (A9: String(1.1 + 2.2) is "3.3000000000000003", so the count reads 16 and the
// value-label paths cap it at 2). A9 is preserved here on purpose; phase 5 fixes it in the shared
// module, and this table is where that fix will show.
import { describe, expect, it } from "vitest";
import { fractionDigitsNeeded, valueLabelDecimals, VALUE_LABEL_DECIMALS_CAP } from "../src/engine/value-decimals";
import { makeTickFormatter, waterfallValueDecimals, computeWaterfallSteps } from "../src/engine/scales";
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

describe("value-decimals: the shared count matches all three originals", () => {
  it("the three originals agree on the raw count; only the value-label sites cap it", () => {
    // Recorded for the report: the originals differ ONLY in the cap (stacked and waterfall cap at
    // 2, ticks do not), so one count with a capped entry point covers every site.
    for (const { name, values } of INPUTS) {
      const raw = fractionDigitsNeeded(values);
      expect(Math.min(2, raw), name).toBe(valueLabelDecimals(values));
      expect(VALUE_LABEL_DECIMALS_CAP).toBe(2);
    }
    expect(fractionDigitsNeeded([1.1 + 2.2])).toBe(16);
    expect(valueLabelDecimals([1.1 + 2.2])).toBe(2);
    expect(fractionDigitsNeeded([1e-7])).toBe(0);
  });

  it("stacked value labels: makeValueFormatter output is unchanged", () => {
    for (const { name, values } of INPUTS)
      for (const affixes of AFFIXES)
        for (const keepMinus of [true, false])
          for (const decimals of EXPLICIT) {
            const before = origStackedFormatter(values, affixes, keepMinus, decimals);
            const after = makeValueFormatter(values, affixes, keepMinus, decimals);
            for (const d of [...PROBES, ...values]) {
              expect(after(d), `${name} ${JSON.stringify(affixes)} keepMinus=${keepMinus} decimals=${decimals} d=${d}`).toBe(
                before(d),
              );
            }
          }
  });

  it("waterfall: waterfallValueDecimals is unchanged (deltas and running levels)", () => {
    for (const { name, values } of INPUTS)
      for (const explicit of EXPLICIT) {
        const rows = waterfallRows(values);
        expect(waterfallValueDecimals(rows, explicit), `${name} explicit=${explicit}`).toBe(
          origWaterfallValueDecimals(rows, explicit),
        );
      }
    // Float noise reached only through the running level: 1.1 then 2.2 sums to 3.3000000000000003.
    expect(waterfallValueDecimals(waterfallRows([1.1, 2.2]))).toBe(2);
  });

  it("ticks: makeTickFormatter output is unchanged (uncapped)", () => {
    for (const { name, values } of INPUTS)
      for (const affixes of AFFIXES) {
        const before = origTickFormatter(values, affixes);
        const after = makeTickFormatter(values, affixes);
        for (const d of [...PROBES, ...values]) {
          expect(after(d), `${name} ${JSON.stringify(affixes)} d=${d}`).toBe(before(d));
        }
      }
    // Default affixes.
    expect(makeTickFormatter([0, 0.5, 1])(0.25)).toBe(origTickFormatter([0, 0.5, 1])(0.25));
    // Uncapped: float-noise ticks print every digit, unlike the value-label sites.
    expect(makeTickFormatter([1.1 + 2.2])(1)).toBe("1.0000000000000000");
  });
});
