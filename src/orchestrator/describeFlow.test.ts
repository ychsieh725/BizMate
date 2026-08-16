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
vi.mock("@/domains/pricing/repositories/rateCardRepository.ts", () => ({
  rateCardRepository: { findActiveSubtypes: vi.fn() },
}));
vi.mock("@/orchestrator/resolveAfterParse.ts", () => ({ resolveAfterParse: vi.fn() }));
vi.mock("@/orchestrator/agentFlow.ts", () => ({
  isAgentLoopEnabled: vi.fn(() => false),
  runAgentOrFallback: vi.fn(),
}));

import { sessionsRepository } from "@/domains/intake/repositories/sessionsRepository.ts";
import { rawInputsRepository } from "@/domains/intake/repositories/rawInputsRepository.ts";
import { extractedFieldsRepository } from "@/domains/intake/repositories/extractedFieldsRepository.ts";
import { parseIntake } from "@/domains/intake/parserAgent.ts";
import { rateCardRepository } from "@/domains/pricing/repositories/rateCardRepository.ts";
import { resolveAfterParse } from "@/orchestrator/resolveAfterParse.ts";
import { isAgentLoopEnabled, runAgentOrFallback } from "@/orchestrator/agentFlow.ts";
import { handleDescribe } from "@/orchestrator/describeFlow.ts";

const mockFindById = vi.mocked(sessionsRepository.findById);
const mockUpdate = vi.mocked(sessionsRepository.update);
const mockRawCreate = vi.mocked(rawInputsRepository.create);
const mockUpsert = vi.mocked(extractedFieldsRepository.upsertMany);
const mockParse = vi.mocked(parseIntake);
const mockResolve = vi.mocked(resolveAfterParse);

function fakeSession(
  status: SessionStatus,
  category: CaseCategory = "illustration",
): Tables<"sessions"> {
  return {
    id: "s1",
    merchant_id: "99999999-9999-9999-9999-999999999999",
    category,
    contact_email: null,
    status,
    current_step: 1,
    created_at: "2026-07-05T00:00:00Z",
    updated_at: "2026-07-05T00:00:00Z",
  };
}

const CALL = { sessionId: "s1", rawText: "幫我畫一個角色", contactEmail: "c@example.com" };

const mockFindSubtypes = vi.mocked(rateCardRepository.findActiveSubtypes);

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdate.mockResolvedValue(fakeSession("created"));
  mockRawCreate.mockResolvedValue({} as never);
  mockUpsert.mockResolvedValue(undefined);
  mockFindSubtypes.mockResolvedValue(["角色設計", "單張插畫"]);
  mockParse.mockResolvedValue({
    fields: { subtype: { value: "角色設計", confidence: 0.9, source_span: "角色" } },
    missingRequiredFields: [],
  });
  mockResolve.mockResolvedValue({
    status: "awaiting_review",
    quoteCode: "I-2607001",
    outOfScope: false,
    conservative: false,
  });
});

describe("handleDescribe — session 前置檢查", () => {
  it("session 不存在 → not_found，不解析", async () => {
    mockFindById.mockResolvedValue(null);
    const result = await handleDescribe(CALL);
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(mockParse).not.toHaveBeenCalled();
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("session 非 created（已描述過）→ conflict，不解析", async () => {
    mockFindById.mockResolvedValue(fakeSession("awaiting_review"));
    const result = await handleDescribe(CALL);
    expect(result).toMatchObject({
      ok: false,
      error: "conflict",
      currentStatus: "awaiting_review",
    });
    expect(mockParse).not.toHaveBeenCalled();
  });
});

describe("handleDescribe — 主流程", () => {
  beforeEach(() => {
    mockFindById.mockResolvedValue(fakeSession("created"));
  });

  it("寫 raw_input、轉 parsing、抽取、upsert，並委派 resolveAfterParse（completedRounds=0）", async () => {
    await handleDescribe(CALL);

    expect(mockRawCreate).toHaveBeenCalledWith({
      session_id: "s1",
      raw_text: "幫我畫一個角色",
    });
    expect(mockParse).toHaveBeenCalledOnce();
    expect(mockUpsert).toHaveBeenCalledOnce();
    expect(mockResolve).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "s1",
        category: "illustration",
        completedRounds: 0,
      }),
    );
  });

  it("回傳 resolveAfterParse 的 outcome", async () => {
    const result = await handleDescribe(CALL);
    expect(result).toEqual({
      ok: true,
      outcome: {
        status: "awaiting_review",
        quoteCode: "I-2607001",
        outOfScope: false,
        conservative: false,
      },
    });
  });
});

/**
 * Feature flag 閘門（A4）。
 *
 * flag 關閉時**必須**走與 agent 化之前完全相同的路徑——這是「開關可以隨時
 * 關掉」這個承諾的機械化驗收。若關閉狀態下仍有任何 agent 相關呼叫，
 * 那個承諾就是假的。
 */
describe("handleDescribe — agent feature flag", () => {
  const mockIsEnabled = vi.mocked(isAgentLoopEnabled);
  const mockRunAgent = vi.mocked(runAgentOrFallback);

  it("flag 關閉 → 走既有路徑，完全不碰 agent", async () => {
    mockIsEnabled.mockReturnValue(false);

    await handleDescribe(CALL);

    expect(mockRunAgent).not.toHaveBeenCalled();
    expect(mockParse).toHaveBeenCalledTimes(1);
    expect(mockResolve).toHaveBeenCalledTimes(1);
  });

  it("flag 開啟 → 走 agent，且不再呼叫既有的 parser", async () => {
    mockIsEnabled.mockReturnValue(true);
    mockRunAgent.mockResolvedValue({ status: "awaiting_review", quoteCode: "G-1" });

    await handleDescribe(CALL);

    expect(mockRunAgent).toHaveBeenCalledTimes(1);
    expect(mockParse).not.toHaveBeenCalled();
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("flag 開啟時仍先寫入 raw_input 與推進狀態", async () => {
    mockIsEnabled.mockReturnValue(true);
    mockRunAgent.mockResolvedValue({ status: "awaiting_review", quoteCode: "G-1" });

    await handleDescribe(CALL);

    expect(mockRawCreate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith("s1", {
      contact_email: "c@example.com",
      status: "parsing",
    });
  });

  it("flag 開啟 → 以 session 的租戶範圍呼叫 agent", async () => {
    mockIsEnabled.mockReturnValue(true);
    mockRunAgent.mockResolvedValue({ status: "awaiting_review", quoteCode: "G-1" });

    await handleDescribe(CALL);

    expect(mockRunAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "s1",
        category: "illustration",
        completedRounds: 0,
      }),
    );
  });

  it("flag 開啟 → 回傳 agent 的 outcome", async () => {
    mockIsEnabled.mockReturnValue(true);
    mockRunAgent.mockResolvedValue({
      status: "awaiting_clarification",
      questions: [{ question: "幾款？", targetField: "quantity" }],
    });

    const result = await handleDescribe(CALL);

    expect(result).toEqual({
      ok: true,
      outcome: {
        status: "awaiting_clarification",
        questions: [{ question: "幾款？", targetField: "quantity" }],
      },
    });
  });
});
