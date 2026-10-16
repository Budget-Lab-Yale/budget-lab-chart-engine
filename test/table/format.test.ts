import { describe, it, expect } from "vitest";
import { resolveFormat, formatCell, formattedSign } from "../../src/table/format";
import type { TableSpec } from "../../src/spec/table-types";

const base = { title: "t", data: "d", stub: [{ label: "l" }], header: ["h"], value: "v" } as TableSpec;

describe("formatCell", () => {
  it("number with decimals", () => { expect(formatCell(1.234, { type: "number", decimals: 1 })).toBe("1.2"); });
  it("percent multiplies and appends %", () => { expect(formatCell(0.026, { type: "percent", decimals: 1 })).toBe("2.6%"); });
  it("currency prefix + thousands", () => { expect(formatCell(2933, { type: "currency", decimals: 0, thousands: true, prefix: "$" })).toBe("$2,933"); });
  it("null renders em dash", () => { expect(formatCell(null, { type: "number", decimals: 1 })).toBe("—"); });
  it("negative keeps minus", () => { expect(formatCell(-2713, { type: "number", decimals: 0, thousands: true })).toBe("-2,713"); });
  // A10: the sign is decided after rounding, so a value that rounds to zero prints no minus.
  it("a negative value that rounds to zero prints no minus", () => {
    expect(formatCell(-0.04, { type: "number", decimals: 1 })).toBe("0.0");
    expect(formatCell(-0.0004, { type: "percent", decimals: 1 })).toBe("0.0%");
    expect(formatCell(-0.4, { type: "number", decimals: 0, prefix: "$" })).toBe("$0");
    expect(formatCell(-0.004, { type: "number", decimals: 2, suffix: " pp" })).toBe("0.00 pp");
  });
  it("a negative value that rounds to a non-zero keeps its minus", () => {
    expect(formatCell(-0.05, { type: "number", decimals: 1 })).toBe("-0.1");
    expect(formatCell(-0.6, { type: "number", decimals: 0, prefix: "$" })).toBe("-$1");
  });
});

describe("formattedSign", () => {
  it("is the sign of the ROUNDED value", () => {
    expect(formattedSign(-0.04, { type: "number", decimals: 1 })).toBe(0);
    expect(formattedSign(0.04, { type: "number", decimals: 1 })).toBe(0);
    expect(formattedSign(-0.05, { type: "number", decimals: 1 })).toBe(-1);
    expect(formattedSign(0.05, { type: "number", decimals: 1 })).toBe(1);
    expect(formattedSign(0.004, { type: "percent", decimals: 1 })).toBe(1); // 0.4%
    expect(formattedSign(0.0004, { type: "percent", decimals: 1 })).toBe(0); // 0.0%
    expect(formattedSign(0, { type: "number", decimals: 1 })).toBe(0);
    expect(formattedSign(null, { type: "number", decimals: 1 })).toBe(0);
  });
});

describe("resolveFormat precedence", () => {
  const spec = { ...base, format: {
    default: { type: "number", decimals: 1 },
    columns: { "% of GDP": { type: "percent", decimals: 1 } },
    groups: { "Derived": { type: "percent", decimals: 2 } },
    rows: { "Compressive": { type: "number", decimals: 3 } },
  }} as TableSpec;
  it("row beats group beats column beats default", () => {
    expect(resolveFormat({ leafKey: "x", groupKeys: [], rowLabel: "Compressive", spec }).decimals).toBe(3);
    expect(resolveFormat({ leafKey: "x", groupKeys: ["Derived"], rowLabel: "y", spec }).decimals).toBe(2);
    expect(resolveFormat({ leafKey: "% of GDP", groupKeys: [], rowLabel: "y", spec }).type).toBe("percent");
    expect(resolveFormat({ leafKey: "x", groupKeys: [], rowLabel: "y", spec }).decimals).toBe(1);
  });
});
