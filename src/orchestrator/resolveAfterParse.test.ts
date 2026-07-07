import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/domains/intake/clarificationAgent.ts", () => ({
  generateClarificationQuestion: vi.fn(),
}));
vi.mock("@/domains/intake/repositories/clarificationTurnsRepository.ts", () => ({
  clarificationTurnsRepository: { create: vi.fn() },
}));
vi.mock("@/domains/intake/repositories/sessionsRepository.ts", () => ({
  sessionsRepository: { update: vi.fn() },
}));
vi.mock("@/domains/pricing/basePricing.ts", () => ({
  computeBasePricing: vi.fn(),
}));
vi.mock("@/domains/pricing/quoteFormatter.ts", () => ({
  generateQuoteCode: vi.fn(),
}));
vi.mock("@/domains/pricing/repositories/quotesRepository.ts", () => ({
  quotesRepository: { create: vi.fn() },
}));
vi.mock("@/domains/pricing/repositories/priceLineItemsRepository.ts", () => ({
  priceLineItemsRepository: { createMany: vi.fn() },
}));

import { resolveAfterParse } from "./resolveAfterParse.ts";
import { generateClarificationQuestion } from "@/domains/intake/clarificationAgent.ts";
import { clarificationTurnsRepository } from "@/domains/intake/repositories/clarificationTurnsRepository.ts";
import { computeBasePricing } from "@/domains/pricing/basePricing.ts";
import { generateQuoteCode } from "@/domains/pricing/quoteFormatter.ts";
import { quotesRepository } from "@/domains/pricing/repositories/quotesRepository.ts";

const mockGenerateQuestion = vi.mocked(generateClarificationQuestion);
const mockTurnCreate = vi.mocked(clarificationTurnsRepository.create);
const mockPricing = vi.mocked(computeBasePricing);
const mockQuoteCode = vi.mocked(generateQuoteCode);
const mockQuoteCreate = vi.mocked(quotesRepository.create);

const MERCHANT_ID = "99999999-9999-9999-9999-999999999999";
const BASE = {
  sessionId: "sid-1",
  merchantId: MERCHANT_ID,
  category: "illustration" as const,
  fields: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPricing.mockResolvedValue({ lineItems: [], total: 5000, outOfScope: false });
  mockQuoteCode.mockResolvedValue("I-2607009");
  mockQuoteCreate.mockResolvedValue({ id: "q-1" } as never);
});

describe("resolveAfterParse", () => {
  it("齊全 → 正常計價，quote 標示 is_conservative=false", async () => {
    const outcome = await resolveAfterParse({
      ...BASE,
      missingFields: [],
      completedRounds: 0,
    });

    expect(mockGenerateQuestion).not.toHaveBeenCalled();
    expect(mockPricing).toHaveBeenCalledWith(MERCHANT_ID, "illustration", {});
    expect(mockQuoteCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        is_conservative: false,
        final_amount: 5000,
        merchant_id: MERCHANT_ID,
        status: "awaiting_review",
      }),
    );
    expect(outcome).toEqual({
      status: "awaiting_review",
      quoteCode: "I-2607009",
      outOfScope: false,
      conservative: false,
    });
  });

  it("有缺 & 未達上限 → 依優先序選下一題、寫 turn，不計價", async () => {
    mockGenerateQuestion.mockResolvedValue({
      question: "這張插畫會用在哪些地方呢？",
      targetField: "license_scope",
    });

    const outcome = await resolveAfterParse({
      ...BASE,
      missingFields: ["deadline_days", "license_scope"], // license 優先序高
      completedRounds: 0,
    });

    expect(mockGenerateQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ targetField: "license_scope" }),
    );
    expect(mockTurnCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        round: 1,
        triggered_field: "license_scope",
        question: "這張插畫會用在哪些地方呢？",
      }),
    );
    expect(mockPricing).not.toHaveBeenCalled();
    expect(outcome.status).toBe("awaiting_clarification");
    expect(outcome.question).toBe("這張插畫會用在哪些地方呢？");
    expect(outcome.targetField).toBe("license_scope");
  });

  it("有缺 & 已達輪數上限 → 保守估算，quote 標示 is_conservative=true", async () => {
    const outcome = await resolveAfterParse({
      ...BASE,
      missingFields: ["license_scope"],
      completedRounds: 3, // 達 MAX_CLARIFICATION_ROUNDS
    });

    expect(mockGenerateQuestion).not.toHaveBeenCalled();
    expect(mockPricing).toHaveBeenCalledOnce();
    expect(mockQuoteCreate).toHaveBeenCalledWith(
      expect.objectContaining({ is_conservative: true }),
    );
    expect(outcome.status).toBe("awaiting_review");
    expect(outcome.conservative).toBe(true);
    expect(outcome.quoteCode).toBe("I-2607009");
  });

  it("quote_code 撞唯一約束 → 重新取號重試一次", async () => {
    mockQuoteCode.mockResolvedValueOnce("I-2607009").mockResolvedValueOnce("I-2607010");
    mockQuoteCreate
      .mockRejectedValueOnce(
        new Error('duplicate key value violates unique constraint "quotes_merchant_id_quote_code_key"'),
      )
      .mockResolvedValueOnce({ id: "q-1" } as never);

    const outcome = await resolveAfterParse({
      ...BASE,
      missingFields: [],
      completedRounds: 0,
    });

    expect(mockQuoteCreate).toHaveBeenCalledTimes(2);
    expect(mockQuoteCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({ quote_code: "I-2607010" }),
    );
    expect(outcome.quoteCode).toBe("I-2607010");
  });

  it("quote 寫入失敗且非唯一約束 → 原樣拋出", async () => {
    mockQuoteCreate.mockRejectedValueOnce(new Error("connection refused"));

    await expect(
      resolveAfterParse({ ...BASE, missingFields: [], completedRounds: 0 }),
    ).rejects.toThrow("connection refused");
    expect(mockQuoteCreate).toHaveBeenCalledTimes(1);
  });

  it("保守估算時 out_of_scope（缺 subtype）→ final_amount 為 null", async () => {
    mockPricing.mockResolvedValue({ lineItems: [], total: 0, outOfScope: true });

    const outcome = await resolveAfterParse({
      ...BASE,
      missingFields: ["subtype"],
      completedRounds: 3,
    });

    expect(mockQuoteCreate).toHaveBeenCalledWith(
      expect.objectContaining({ is_conservative: true, final_amount: null }),
    );
    expect(outcome.outOfScope).toBe(true);
  });
});
