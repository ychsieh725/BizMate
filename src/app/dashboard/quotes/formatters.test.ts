import { describe, it, expect } from "vitest";
import { formatAmount, formatDateTime } from "./formatters.ts";

describe("formatAmount", () => {
  it("數字加上千分位與幣別前綴", () => {
    expect(formatAmount(8000)).toBe("NT$ 8,000");
  });

  it("null（尚未定價）→ 破折號，不顯示 NT$ 0 誤導", () => {
    expect(formatAmount(null)).toBe("—");
  });
});

describe("formatDateTime", () => {
  it("ISO 字串轉台北時區的年月日時分", () => {
    // 2026-07-11T02:00:00Z = 台北時間 10:00
    expect(formatDateTime("2026-07-11T02:00:00.000Z")).toBe("2026/07/11 10:00");
  });
});
