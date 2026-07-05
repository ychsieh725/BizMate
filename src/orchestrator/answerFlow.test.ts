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
    findUnansweredLatest: vi.fn(),
    update: vi.fn(),
    findAnsweredOrdered: vi.fn(),
    countAnswered: vi.fn(),
  },
}));
vi.mock("@/domains/intake/parserAgent.ts", () => ({ parseIntake: vi.fn() }));
vi.mock("@/orchestrator/resolveAfterParse.ts", () => ({ resolveAfterParse: vi.fn() }));

import { sessionsRepository } from "@/domains/intake/repositories/sessionsRepository.ts";
import { rawInputsRepository } from "@/domains/intake/repositories/rawInputsRepository.ts";
import { clarificationTurnsRepository } from "@/domains/intake/repositories/clarificationTurnsRepository.ts";
import { parseIntake } from "@/domains/intake/parserAgent.ts";
import { resolveAfterParse } from "@/orchestrator/resolveAfterParse.ts";
import { handleAnswer } from "@/orchestrator/answerFlow.ts";

const mockFindById = vi.mocked(sessionsRepository.findById);
const mockRawLatest = vi.mocked(rawInputsRepository.findLatestBySession);
const mockFindUnanswered = vi.mocked(clarificationTurnsRepository.findUnansweredLatest);
const mockTurnUpdate = vi.mocked(clarificationTurnsRepository.update);
const mockFindAnswered = vi.mocked(clarificationTurnsRepository.findAnsweredOrdered);
const mockCountAnswered = vi.mocked(clarificationTurnsRepository.countAnswered);
const mockParse = vi.mocked(parseIntake);
const mockResolve = vi.mocked(resolveAfterParse);

function fakeSession(status: SessionStatus, category: CaseCategory = "illustration"): Tables<"sessions"> {
  return {
    id: "s1",
    category,
    contact_email: "c@example.com",
    status,
    current_step: 1,
    created_at: "2026-07-05T00:00:00Z",
    updated_at: "2026-07-05T00:00:00Z",
  };
}

const CALL = { sessionId: "s1", answer: "商業使用" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sessionsRepository.update).mockResolvedValue(fakeSession("parsing"));
  mockTurnUpdate.mockResolvedValue({} as never);
  mockParse.mockResolvedValue({
    fields: { license_scope: { value: "商業使用", confidence: 0.9, source_span: "商業" } },
    missingRequiredFields: [],
  });
  mockCountAnswered.mockResolvedValue(1);
  mockResolve.mockResolvedValue({ status: "awaiting_freelancer", quoteCode: "I-2607005", conservative: false });
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

  it("無待回答的反問 → no_pending_question", async () => {
    mockFindById.mockResolvedValue(fakeSession("awaiting_clarification"));
    mockFindUnanswered.mockResolvedValue(null);
    expect(await handleAnswer(CALL)).toEqual({ ok: false, error: "no_pending_question" });
    expect(mockParse).not.toHaveBeenCalled();
  });
});

describe("handleAnswer — 主流程", () => {
  beforeEach(() => {
    mockFindById.mockResolvedValue(fakeSession("awaiting_clarification"));
    mockFindUnanswered.mockResolvedValue({
      id: "turn-1",
      session_id: "s1",
      round: 1,
      question: "這張插畫會用在哪些地方呢？",
      answer: null,
      triggered_field: "license_scope",
      created_at: "2026-07-05T00:00:00Z",
    });
    mockRawLatest.mockResolvedValue({
      id: "raw-1",
      session_id: "s1",
      raw_text: "幫我畫一個角色",
      created_at: "2026-07-05T00:00:00Z",
    });
    mockFindAnswered.mockResolvedValue([
      {
        id: "turn-1",
        session_id: "s1",
        round: 1,
        question: "這張插畫會用在哪些地方呢？",
        answer: "商業使用",
        triggered_field: "license_scope",
        created_at: "2026-07-05T00:00:00Z",
      },
    ]);
  });

  it("填入本輪答案", async () => {
    await handleAnswer(CALL);
    expect(mockTurnUpdate).toHaveBeenCalledWith("turn-1", { answer: "商業使用" });
  });

  it("以「原始描述 + 累積問答」重新解析", async () => {
    await handleAnswer(CALL);
    const rawText = mockParse.mock.calls[0]![0].rawText;
    expect(rawText).toContain("幫我畫一個角色");
    expect(rawText).toContain("補充問答");
    expect(rawText).toContain("商業使用");
  });

  it("以已答輪數委派 resolveAfterParse", async () => {
    mockCountAnswered.mockResolvedValue(2);
    await handleAnswer(CALL);
    expect(mockResolve).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s1", completedRounds: 2 }),
    );
  });

  it("回傳 resolveAfterParse 的 outcome", async () => {
    const result = await handleAnswer(CALL);
    expect(result).toEqual({
      ok: true,
      outcome: { status: "awaiting_freelancer", quoteCode: "I-2607005", conservative: false },
    });
  });
});
