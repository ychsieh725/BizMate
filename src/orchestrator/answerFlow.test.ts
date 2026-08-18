import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/supabase/database.types.ts";
import type { CaseCategory, SessionStatus } from "@/shared/types/domain.types";

vi.mock("@/domains/intake/repositories/sessionsRepository.ts", () => ({
  sessionsRepository: { findById: vi.fn(), update: vi.fn() },
}));
vi.mock("@/domains/intake/repositories/rawInputsRepository.ts", () => ({
  rawInputsRepository: { findLatestBySession: vi.fn() },
}));
vi.mock("@/domains/intake/repositories/extractedFieldsRepository.ts", () => ({
  extractedFieldsRepository: { upsertMany: vi.fn() },
}));
vi.mock("@/domains/intake/repositories/clarificationTurnsRepository.ts", () => ({
  clarificationTurnsRepository: {
    findUnanswered: vi.fn(),
    update: vi.fn(),
    findAnsweredOrdered: vi.fn(),
  },
}));
vi.mock("@/domains/intake/parserAgent.ts", () => ({ parseIntake: vi.fn() }));
vi.mock("@/domains/pricing/repositories/rateCardRepository.ts", () => ({
  rateCardRepository: { findActiveServices: vi.fn() },
}));
vi.mock("@/orchestrator/resolveAfterParse.ts", () => ({ resolveAfterParse: vi.fn() }));

import { sessionsRepository } from "@/domains/intake/repositories/sessionsRepository.ts";
import { rawInputsRepository } from "@/domains/intake/repositories/rawInputsRepository.ts";
import { clarificationTurnsRepository } from "@/domains/intake/repositories/clarificationTurnsRepository.ts";
import { parseIntake } from "@/domains/intake/parserAgent.ts";
import { rateCardRepository } from "@/domains/pricing/repositories/rateCardRepository.ts";
import { resolveAfterParse } from "@/orchestrator/resolveAfterParse.ts";
import { handleAnswer } from "@/orchestrator/answerFlow.ts";

const mockFindById = vi.mocked(sessionsRepository.findById);
const mockRawLatest = vi.mocked(rawInputsRepository.findLatestBySession);
const mockFindUnanswered = vi.mocked(clarificationTurnsRepository.findUnanswered);
const mockTurnUpdate = vi.mocked(clarificationTurnsRepository.update);
const mockFindAnswered = vi.mocked(clarificationTurnsRepository.findAnsweredOrdered);
const mockParse = vi.mocked(parseIntake);
const mockResolve = vi.mocked(resolveAfterParse);

function fakeSession(status: SessionStatus, category: CaseCategory = "illustration"): Tables<"sessions"> {
  return {
    id: "s1",
    merchant_id: "99999999-9999-9999-9999-999999999999",
    category,
    contact_email: "c@example.com",
    status,
    current_step: 1,
    created_at: "2026-07-05T00:00:00Z",
    updated_at: "2026-07-05T00:00:00Z",
  };
}

function turn(
  overrides: Partial<Tables<"clarification_turns">>,
): Tables<"clarification_turns"> {
  return {
    id: "turn-x",
    session_id: "s1",
    round: 1,
    question: "問句",
    answer: null,
    triggered_field: "license_scope",
    created_at: "2026-07-05T00:00:00Z",
    ...overrides,
  };
}

// 本輪一次回答兩個欄位（批次）
const CALL = {
  sessionId: "s1",
  answers: [
    { field: "license_scope", answer: "商業使用" },
    { field: "deadline_days", answer: "兩週內" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sessionsRepository.update).mockResolvedValue(fakeSession("parsing"));
  vi.mocked(rateCardRepository.findActiveServices).mockResolvedValue([
    { subtype: "角色設計", unit: "每角色" },
    { subtype: "單張插畫", unit: "每張" },
  ]);
  mockTurnUpdate.mockResolvedValue({} as never);
  mockParse.mockResolvedValue({
    fields: { license_scope: { value: "商業使用", confidence: 0.9, source_span: "商業" } },
    missingRequiredFields: [],
  });
  mockResolve.mockResolvedValue({ status: "awaiting_review", quoteCode: "I-2607005", conservative: false });
});

describe("handleAnswer — 前置檢查", () => {
  it("session 不存在 → not_found", async () => {
    mockFindById.mockResolvedValue(null);
    expect(await handleAnswer(CALL)).toEqual({ ok: false, error: "not_found" });
    expect(mockParse).not.toHaveBeenCalled();
  });

  it("session 非 awaiting_clarification → conflict", async () => {
    mockFindById.mockResolvedValue(fakeSession("created"));
    expect(await handleAnswer(CALL)).toMatchObject({
      ok: false,
      error: "conflict",
      currentStatus: "created",
    });
    expect(mockParse).not.toHaveBeenCalled();
  });

  it("本輪無待回答的反問 → no_pending_question", async () => {
    mockFindById.mockResolvedValue(fakeSession("awaiting_clarification"));
    mockFindUnanswered.mockResolvedValue([]);
    expect(await handleAnswer(CALL)).toEqual({ ok: false, error: "no_pending_question" });
    expect(mockParse).not.toHaveBeenCalled();
  });
});

describe("handleAnswer — 主流程（批次）", () => {
  beforeEach(() => {
    mockFindById.mockResolvedValue(fakeSession("awaiting_clarification"));
    mockFindUnanswered.mockResolvedValue([
      turn({ id: "turn-1", round: 1, triggered_field: "license_scope", question: "用途？" }),
      turn({ id: "turn-2", round: 1, triggered_field: "deadline_days", question: "交期？" }),
    ]);
    mockRawLatest.mockResolvedValue({
      id: "raw-1",
      session_id: "s1",
      raw_text: "幫我畫一個角色",
      created_at: "2026-07-05T00:00:00Z",
    });
    mockFindAnswered.mockResolvedValue([
      turn({ id: "turn-1", round: 1, triggered_field: "license_scope", question: "用途？", answer: "商業使用" }),
      turn({ id: "turn-2", round: 1, triggered_field: "deadline_days", question: "交期？", answer: "兩週內" }),
    ]);
  });

  it("依 triggered_field 對應，填入本輪每一題的答案", async () => {
    await handleAnswer(CALL);
    expect(mockTurnUpdate).toHaveBeenCalledWith("turn-1", { answer: "商業使用" });
    expect(mockTurnUpdate).toHaveBeenCalledWith("turn-2", { answer: "兩週內" });
  });

  it("以「原始描述 + 累積問答」重新解析", async () => {
    await handleAnswer(CALL);
    const rawText = mockParse.mock.calls[0]![0].rawText;
    expect(rawText).toContain("幫我畫一個角色");
    expect(rawText).toContain("補充問答");
    expect(rawText).toContain("商業使用");
    expect(rawText).toContain("兩週內");
  });

  it("completedRounds = 已答 turn 的相異 round 數（同一輪多筆算一輪）", async () => {
    // 兩筆都是 round 1 → 相異輪數 = 1
    await handleAnswer(CALL);
    expect(mockResolve).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s1", completedRounds: 1 }),
    );
  });

  it("跨兩輪已答（round 1 + round 2）→ completedRounds = 2", async () => {
    mockFindAnswered.mockResolvedValue([
      turn({ id: "t1", round: 1, answer: "a" }),
      turn({ id: "t2", round: 1, answer: "b" }),
      turn({ id: "t3", round: 2, answer: "c" }),
    ]);
    await handleAnswer(CALL);
    expect(mockResolve).toHaveBeenCalledWith(
      expect.objectContaining({ completedRounds: 2 }),
    );
  });

  it("回傳 resolveAfterParse 的 outcome", async () => {
    const result = await handleAnswer(CALL);
    expect(result).toEqual({
      ok: true,
      outcome: { status: "awaiting_review", quoteCode: "I-2607005", conservative: false },
    });
  });
});
