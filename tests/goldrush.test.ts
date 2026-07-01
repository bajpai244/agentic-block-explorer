import { describe, expect, it } from "vitest";
import { formatTokenAmount } from "@/lib/goldrush";

describe("formatTokenAmount", () => {
  it("formats integer token balances with decimals", () => {
    expect(formatTokenAmount("123450000000000000000", 18)).toBe("123.45");
  });

  it("handles small balances", () => {
    expect(formatTokenAmount("1", 18)).toBe("0.000000");
  });

  it("handles zero and missing values", () => {
    expect(formatTokenAmount("0", 18)).toBe("0");
    expect(formatTokenAmount(undefined, 18)).toBe("0");
  });
});
