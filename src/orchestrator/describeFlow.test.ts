import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/supabase/database.types.ts";
import type { CaseCategory, SessionStatus } from "@/shared/types/domain.types";

vi.mock("@/domains/intake/repositories/sessionsRepository.ts", () => ({
  sessionsRepository: { findById: vi.fn(), update: vi.fn() },
}));
vi.mock("@/domains/intake/repositories/rawInputsRepository.ts", () => ({
  rawInputsRepository: { create: vi.fn() },
}));
vi.mock("@/domains/intake/repositories/extractedFieldsRepository.ts", () => ({
  extractedFieldsRepository: { upsertMany: vi.fn() },
}));
vi.mock("@/domains/intake/parserAgent.ts", () => ({ parseIntake: vi.fn() }));
vi.mock("@/domains/pricing/basePricing.ts", () => ({ computeBasePricing: vi.fn() }));
vi.mock("@/domains/pricing/quoteFormatter.ts", () => ({ generateQuoteCode: vi.fn() }));
vi.mock("@/domains/pricing/repositories/quotesRepository.ts", () => ({
  quotesRepository: { create: vi.fn() },
}));
vi.mock("@/domains/pricing/repositories/priceLineItemsRepository.ts", () => ({
  priceLineItemsRepository: { createMany: vi.fn() },
}));

import { sessionsRepository } from "@/domains/intake/repositories/sessionsRepository.ts";
import { rawInputsRepository } from "@/domains/intake/repositories/rawInputsRepository.ts";
import { extractedFieldsRepository } from "@/domains/intake/repositories/extractedFieldsRepository.ts";
import { parseIntake } from "@/domains/intake/parserAgent.ts";
import { computeBasePricing } from "@/domains/pricing/basePricing.ts";
import { generateQuoteCode } from "@/domains/pricing/quoteFormatter.ts";
import { quotesRepository } from "@/domains/pricing/repositories/quotesRepository.ts";
import { priceLineItemsRepository } from "@/domains/pricing/repositories/priceLineItemsRepository.ts";
import { handleDescribe } from "@/orchestrator/describeFlow.ts";

const mockFindById = vi.mocked(sessionsRepository.findById);
const mockUpdate = vi.mocked(sessionsRepository.update);
const mockRawCreate = vi.mocked(rawInputsRepository.create);
const mockUpsert = vi.mocked(extractedFieldsRepository.upsertMany);
const mockParse = vi.mocked(parseIntake);
const mockPricing = vi.mocked(computeBasePricing);
const mockQuoteCode = vi.mocked(generateQuoteCode);
const mockQuoteCreate = vi.mocked(quotesRepository.create);
const mockLineItems = vi.mocked(priceLineItemsRepository.createMany);

function fakeSession(
  status: SessionStatus,
  category: CaseCategory = "illustration",
): Tables<"sessions"> {
  return {
    id: "s1",
    category,
    contact_email: null,
    status,
    current_step: 1,
    created_at: "2026-07-05T00:00:00Z",
    updated_at: "2026-07-05T00:00:00Z",
  };
}

const CALL = { sessionId: "s1", rawText: "幫我畫一個角色", contactEmail: "c@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdate.mockResolvedValue(fakeSession("created"));
  mockRawCreate.mockResolvedValue({} as never);
  mockUpsert.mockResolvedValue(undefined);
  mockQuoteCreate.mockResolvedValue({} as never);
  mockLineItems.mockResolvedValue(undefined);
});

describe("handleDescribe — session 前置檢查", () => {
  it("session 不存在 → not_found", async () => {
    mockFindById.mockResolvedValue(null);
    const result = await handleDescribe(CALL);
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(mockParse).not.toHaveBeenCalled();
  });

  it("session 非 created（已描述過）→ conflict", async () => {
    mockFindById.mockResolvedValue(fakeSession("awaiting_freelancer"));
    const result = await handleDescribe(CALL);
    expect(result).toMatchObject({ ok: false, error: "conflict", currentStatus: "awaiting_freelancer" });
    expect(mockParse).not.toHaveBeenCalled();
  });
});

describe("handleDescribe — 缺欄位路徑", () => {
  it("有缺漏 → awaiting_clarification + missingFields，不計價", async () => {
    mockFindById.mockResolvedValue(fakeSession("created"));
    mockParse.mockResolvedValue({
      fields: { subtype: { value: "角色設計", confidence: 0.9, source_span: "角色" } },
      missingRequiredFields: ["revision_count", "deadline_days"],
    });

    const result = await handleDescribe(CALL);

    expect(result).toEqual({
      ok: true,
      outcome: { status: "awaiting_clarification", missingFields: ["revision_count", "deadline_days"] },
    });
    expect(mockPricing).not.toHaveBeenCalled();
    expect(mockQuoteCreate).not.toHaveBeenCalled();
    // 有寫 raw_input 與 extracted_fields
    expect(mockRawCreate).toHaveBeenCalledOnce();
    expect(mockUpsert).toHaveBeenCalledOnce();
  });
});

describe("handleDescribe — 齊全路徑", () => {
  beforeEach(() => {
    mockFindById.mockResolvedValue(fakeSession("created"));
    mockParse.mockResolvedValue({
      fields: { subtype: { value: "角色設計", confidence: 0.9, source_span: "角色" } },
      missingRequiredFields: [],
    });
    mockQuoteCode.mockResolvedValue("I-2607001");
  });

  it("齊全 → 計價、寫 quotes/line_items、awaiting_freelancer", async () => {
    mockPricing.mockResolvedValue({
      lineItems: [
        { itemName: "角色設計基本費", amount: 6000, ruleId: "r1", modifierId: null, agentReasoning: null },
      ],
      total: 6000,
      outOfScope: false,
    });

    const result = await handleDescribe(CALL);

    expect(result).toMatchObject({
      ok: true,
      outcome: { status: "awaiting_freelancer", quoteCode: "I-2607001", outOfScope: false },
    });
    expect(mockQuoteCreate).toHaveBeenCalledWith(
      expect.objectContaining({ quote_code: "I-2607001", final_amount: 6000, status: "awaiting_freelancer" }),
    );
    expect(mockLineItems).toHaveBeenCalledWith([
      expect.objectContaining({ item_name: "角色設計基本費", amount: 6000, rule_id: "r1" }),
    ]);
  });

  it("outOfScope → quote final_amount 為 null，仍進 awaiting_freelancer", async () => {
    mockPricing.mockResolvedValue({ lineItems: [], total: 0, outOfScope: true });

    const result = await handleDescribe(CALL);

    expect(result).toMatchObject({ ok: true, outcome: { status: "awaiting_freelancer", outOfScope: true } });
    expect(mockQuoteCreate).toHaveBeenCalledWith(
      expect.objectContaining({ final_amount: null, status: "awaiting_freelancer" }),
    );
  });

  it("最終 session 狀態被更新為 awaiting_freelancer", async () => {
    mockPricing.mockResolvedValue({ lineItems: [], total: 0, outOfScope: false });
    await handleDescribe(CALL);
    const lastUpdate = mockUpdate.mock.calls.at(-1);
    expect(lastUpdate?.[1]).toEqual({ status: "awaiting_freelancer" });
  });
});
