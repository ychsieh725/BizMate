import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/supabase/database.types.ts";

vi.mock("@/domains/pricing/repositories/rateCardRepository.ts", () => ({
  rateCardRepository: { findBase: vi.fn(), findModifiers: vi.fn() },
}));

import { rateCardRepository } from "@/domains/pricing/repositories/rateCardRepository.ts";
import {
  computeBasePricing,
  normalizeLicenseScope,
} from "@/domains/pricing/basePricing.ts";

const mockFindBase = vi.mocked(rateCardRepository.findBase);
const mockFindModifiers = vi.mocked(rateCardRepository.findModifiers);

function baseRow(overrides: Partial<Tables<"rate_card_base">> = {}): Tables<"rate_card_base"> {
  return {
    id: "base-1",
    category: "illustration",
    subtype: "角色設計",
    unit: "每角色",
    base_price: 6000,
    includes: null,
    ...overrides,
  };
}

function modRow(overrides: Partial<Tables<"rate_card_modifiers">>): Tables<"rate_card_modifiers"> {
  return {
    id: "mod-1",
    category: null,
    modifier_name: "商業使用加成",
    trigger_condition: "授權範圍=商業使用",
    range_min: 0.3,
    range_max: 0.3,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindModifiers.mockResolvedValue([]);
});

describe("normalizeLicenseScope", () => {
  it.each([
    ["商業使用", "商業使用"],
    ["商用", "商業使用"],
    ["要獨家買斷", "獨家買斷"],
    ["個人使用", "個人使用"],
    ["不知道", null],
    [null, null],
  ])("%s → %s", (input, expected) => {
    expect(normalizeLicenseScope(input)).toBe(expected);
  });
});

describe("computeBasePricing — 基礎費", () => {
  it("base_price × 數量，帶 ruleId 可回溯", async () => {
    mockFindBase.mockResolvedValue(baseRow({ id: "base-42", base_price: 4000 }));

    const result = await computeBasePricing("illustration", {
      subtype: { value: "單張插畫" },
      quantity: { value: "3" },
    });

    expect(result.outOfScope).toBe(false);
    expect(result.lineItems[0]).toMatchObject({
      amount: 12000,
      ruleId: "base-42",
      modifierId: null,
    });
    expect(result.total).toBe(12000);
  });

  it("數量缺漏或非正整數 → 視為 1", async () => {
    mockFindBase.mockResolvedValue(baseRow({ base_price: 5000 }));

    const result = await computeBasePricing("illustration", {
      subtype: { value: "單張插畫" },
    });

    expect(result.lineItems[0].amount).toBe(5000);
  });

  it("web_design 用 page_count 當數量", async () => {
    mockFindBase.mockResolvedValue(
      baseRow({ category: "web_design", subtype: "多頁式網站", base_price: 8000 }),
    );

    const result = await computeBasePricing("web_design", {
      subtype: { value: "多頁式網站" },
      page_count: { value: "5" },
    });

    expect(result.lineItems[0].amount).toBe(40000);
  });
});

describe("computeBasePricing — out_of_scope", () => {
  it("查無 subtype → outOfScope，不虛構金額", async () => {
    mockFindBase.mockResolvedValue(null);

    const result = await computeBasePricing("illustration", {
      subtype: { value: "不存在的類型" },
    });

    expect(result).toEqual({ lineItems: [], total: 0, outOfScope: true });
  });

  it("subtype 缺漏 → 不查表、outOfScope", async () => {
    const result = await computeBasePricing("illustration", {});
    expect(result.outOfScope).toBe(true);
    expect(mockFindBase).not.toHaveBeenCalled();
  });

  it("base_price 為 null → outOfScope", async () => {
    mockFindBase.mockResolvedValue(baseRow({ base_price: null }));
    const result = await computeBasePricing("illustration", {
      subtype: { value: "角色設計" },
    });
    expect(result.outOfScope).toBe(true);
  });
});

describe("computeBasePricing — 固定倍率 modifiers", () => {
  it("觸發的固定 modifier（商業使用 +30%）加成", async () => {
    mockFindBase.mockResolvedValue(baseRow({ base_price: 6000 }));
    mockFindModifiers.mockResolvedValue([
      modRow({ id: "m-commercial", range_min: 0.3, range_max: 0.3 }),
    ]);

    const result = await computeBasePricing("illustration", {
      subtype: { value: "角色設計" },
      license_scope: { value: "商用" },
    });

    expect(result.lineItems).toHaveLength(2);
    expect(result.lineItems[1]).toMatchObject({
      amount: 1800,
      modifierId: "m-commercial",
      ruleId: null,
    });
    expect(result.total).toBe(7800);
  });

  it("未觸發的 modifier（個人使用）不加成", async () => {
    mockFindBase.mockResolvedValue(baseRow({ base_price: 6000 }));
    mockFindModifiers.mockResolvedValue([modRow({ range_min: 0.3, range_max: 0.3 })]);

    const result = await computeBasePricing("illustration", {
      subtype: { value: "角色設計" },
      license_scope: { value: "個人使用" },
    });

    expect(result.lineItems).toHaveLength(1);
    expect(result.total).toBe(6000);
  });

  it("固定倍率但觸發條件非「授權範圍=」→ 保守跳過（留 4.3）", async () => {
    mockFindBase.mockResolvedValue(baseRow({ base_price: 6000 }));
    mockFindModifiers.mockResolvedValue([
      modRow({
        id: "m-print",
        modifier_name: "印刷檔輸出",
        trigger_condition: "需CMYK/出血/向量印刷檔",
        range_min: 0.2,
        range_max: 0.2,
      }),
    ]);

    const result = await computeBasePricing("graphic_design", {
      subtype: { value: "LOGO設計" },
      license_scope: { value: "商用" },
    });

    expect(result.lineItems).toHaveLength(1); // 只有基礎費，印刷 modifier 無法 deterministic 判斷
  });

  it("range_min/max 為 null 的 modifier → 跳過", async () => {
    mockFindBase.mockResolvedValue(baseRow({ base_price: 6000 }));
    mockFindModifiers.mockResolvedValue([
      modRow({ range_min: null, range_max: null }),
    ]);

    const result = await computeBasePricing("illustration", {
      subtype: { value: "角色設計" },
      license_scope: { value: "商用" },
    });

    expect(result.lineItems).toHaveLength(1);
  });

  it("區間 modifier（min≠max，如急件）跳過，留給 4.3", async () => {
    mockFindBase.mockResolvedValue(baseRow({ base_price: 6000 }));
    mockFindModifiers.mockResolvedValue([
      modRow({
        id: "m-urgent",
        modifier_name: "急件加成",
        trigger_condition: "交期<=急件門檻(3天)",
        range_min: 0.2,
        range_max: 0.5,
      }),
    ]);

    const result = await computeBasePricing("illustration", {
      subtype: { value: "角色設計" },
      license_scope: { value: "商用" },
    });

    expect(result.lineItems).toHaveLength(1); // 只有基礎費
  });
});
