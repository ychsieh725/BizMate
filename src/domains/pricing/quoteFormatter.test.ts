import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/domains/pricing/repositories/quotesRepository.ts", () => ({
  quotesRepository: { countByCodePrefix: vi.fn() },
}));

import { quotesRepository } from "@/domains/pricing/repositories/quotesRepository.ts";
import {
  quoteCodePrefix,
  generateQuoteCode,
  formatQuotePreview,
} from "@/domains/pricing/quoteFormatter.ts";
import type { PricingResult } from "@/domains/pricing/pricingTypes.ts";

const mockCount = vi.mocked(quotesRepository.countByCodePrefix);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("quoteCodePrefix", () => {
  const july2026 = new Date(2026, 6, 5); // 月份 0-based：6 = 7 月

  it.each([
    ["graphic_design", "G-2607"],
    ["illustration", "I-2607"],
    ["web_design", "W-2607"],
  ] as const)("%s → %s", (category, expected) => {
    expect(quoteCodePrefix(category, july2026)).toBe(expected);
  });

  it("月份補零（1 月 → 01）", () => {
    expect(quoteCodePrefix("illustration", new Date(2026, 0, 1))).toBe("I-2601");
  });
});

describe("generateQuoteCode", () => {
  it("流水號 = 當月既有筆數 + 1，補到三位", async () => {
    mockCount.mockResolvedValue(0);
    expect(await generateQuoteCode("graphic_design", new Date(2026, 6, 5))).toBe("G-2607001");

    mockCount.mockResolvedValue(41);
    expect(await generateQuoteCode("graphic_design", new Date(2026, 6, 5))).toBe("G-2607042");
  });

  it("以正確前綴查詢流水號基數", async () => {
    mockCount.mockResolvedValue(0);
    await generateQuoteCode("web_design", new Date(2026, 6, 5));
    expect(mockCount).toHaveBeenCalledWith("W-2607");
  });
});

describe("formatQuotePreview", () => {
  const normalResult: PricingResult = {
    lineItems: [
      { itemName: "角色設計基本費", amount: 6000, ruleId: "b1", modifierId: null, agentReasoning: null },
      { itemName: "商業使用加成", amount: 1800, ruleId: null, modifierId: "m1", agentReasoning: null },
    ],
    total: 7800,
    outOfScope: false,
  };

  it("逐項 + 總計，含 quote_code 與類型", () => {
    const text = formatQuotePreview("illustration", normalResult, "I-2607001");
    expect(text).toContain("I-2607001");
    expect(text).toContain("插畫");
    expect(text).toContain("角色設計基本費");
    expect(text).toContain("NT$ 6,000");
    expect(text).toContain("商業使用加成");
    expect(text).toContain("總計");
    expect(text).toContain("NT$ 7,800");
  });

  it("outOfScope → 標示需人工評估，不含金額", () => {
    const text = formatQuotePreview(
      "illustration",
      { lineItems: [], total: 0, outOfScope: true },
      "I-2607002",
    );
    expect(text).toContain("人工評估");
    expect(text).not.toContain("總計");
  });
});
