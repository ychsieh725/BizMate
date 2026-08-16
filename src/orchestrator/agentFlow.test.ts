import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/agentService.ts", () => ({ callAgentService: vi.fn() }));
// 完全替換而非 importOriginal：真模組會拉進 clarificationAgent → Gemini client
// → env 驗證，讓單元測試需要一整組真實金鑰。nextState 是純轉移查表，
// 直接以真實的 transition 重建，行為與正式路徑一致。
vi.mock("@/orchestrator/resolveAfterParse.ts", async () => {
  const { transition } = await import("@/orchestrator/stateMachine.ts");
  return {
    resolveAfterParse: vi.fn(),
    nextState: (
      current: Parameters<typeof transition>[0],
      event: Parameters<typeof transition>[1],
    ) => {
      const result = transition(current, event);
      if (!result.ok) throw new Error(`非法轉移：${current} + ${event}`);
      return result.state;
    },
  };
});
vi.mock("@/domains/intake/repositories/extractedFieldsRepository.ts", () => ({
  extractedFieldsRepository: { findBySession: vi.fn() },
}));
vi.mock("@/domains/intake/repositories/sessionsRepository.ts", () => ({
  sessionsRepository: { update: vi.fn() },
}));

import { callAgentService } from "@/lib/agentService.ts";
import { resolveAfterParse } from "@/orchestrator/resolveAfterParse.ts";
import { extractedFieldsRepository } from "@/domains/intake/repositories/extractedFieldsRepository.ts";
import { sessionsRepository } from "@/domains/intake/repositories/sessionsRepository.ts";
import { isAgentLoopEnabled, runAgentOrFallback } from "@/orchestrator/agentFlow.ts";

/**
 * agent 與既有流程的接縫。
 *
 * 這裡守的是不變式 I-3：**agent 未能完成時，系統退回既有路徑，
 * 產出與 agent 化之前完全一致的結果。** 每一種失敗模式都要退得回去，
 * 否則 agent 就從加值層變成了單點故障。
 */

const mockCall = vi.mocked(callAgentService);
const mockResolve = vi.mocked(resolveAfterParse);
const mockFindFields = vi.mocked(extractedFieldsRepository.findBySession);
const mockUpdate = vi.mocked(sessionsRepository.update);

const SESSION_ID = "550e8400-e29b-41d4-a716-446655440000";
const MERCHANT_ID = "660e8400-e29b-41d4-a716-446655440001";

const PARAMS = {
  sessionId: SESSION_ID,
  merchantId: MERCHANT_ID,
  category: "graphic_design" as const,
  rawText: "我要做三款品牌識別設計",
  completedRounds: 0,
};

const STORED_ROWS = [
  {
    id: "1",
    session_id: SESSION_ID,
    field_name: "subtype",
    value: "品牌識別設計",
    confidence: 0.9,
    source_span: "LOGO",
    updated_at: "2026-08-16T00:00:00Z",
  },
];

function agentSuccess(data: Record<string, unknown>) {
  return { ok: true as const, data };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindFields.mockResolvedValue(STORED_ROWS as never);
  mockResolve.mockResolvedValue({ status: "awaiting_review", quoteCode: "Q-1" });
  mockUpdate.mockResolvedValue({} as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isAgentLoopEnabled — 預設關閉", () => {
  it("未設定 → 關閉", () => {
    vi.stubEnv("AGENT_LOOP_ENABLED", "");
    expect(isAgentLoopEnabled()).toBe(false);
  });

  it('明確設為 "true" → 啟用', () => {
    vi.stubEnv("AGENT_LOOP_ENABLED", "true");
    expect(isAgentLoopEnabled()).toBe(true);
  });

  it.each(["1", "yes", "TRUE", "on", "false"])(
    "模糊值 %s 一律視為關閉",
    (value) => {
      vi.stubEnv("AGENT_LOOP_ENABLED", value);
      expect(isAgentLoopEnabled()).toBe(false);
    },
  );
});

describe("runAgentOrFallback — 不變式 I-3", () => {
  it.each([
    "not_configured",
    "timeout",
    "unreachable",
    "unauthorized",
    "service_error",
    "invalid_response",
  ] as const)("agent-service %s → 退回既有流程", async (reason) => {
    mockCall.mockResolvedValue({ ok: false, reason, detail: "x" });

    await runAgentOrFallback(PARAMS);

    expect(mockResolve).toHaveBeenCalledTimes(1);
  });

  it("agent 自行交棒（預算耗盡）→ 退回既有流程", async () => {
    mockCall.mockResolvedValue(
      agentSuccess({
        outcome: "fallback",
        event: null,
        fallback_reason: "steps_exhausted",
        tool_result: null,
      }),
    );

    await runAgentOrFallback(PARAMS);

    expect(mockResolve).toHaveBeenCalledTimes(1);
  });

  it("fallback 時沿用 agent 已寫入的欄位，不從頭來過", async () => {
    mockCall.mockResolvedValue({
      ok: false,
      reason: "timeout",
      detail: "逾時",
    });

    await runAgentOrFallback(PARAMS);

    const [args] = mockResolve.mock.calls[0];
    expect(args.fields.subtype.value).toBe("品牌識別設計");
  });

  it("fallback 時重新判斷缺漏，不沿用 agent 的判斷", async () => {
    mockCall.mockResolvedValue({
      ok: false,
      reason: "timeout",
      detail: "逾時",
    });

    await runAgentOrFallback(PARAMS);

    const [args] = mockResolve.mock.calls[0];
    // 只存了 subtype，其餘必要欄位都應被判為缺漏
    expect(args.missingFields).toContain("quantity");
    expect(args.missingFields).not.toContain("subtype");
  });

  it("fallback 不拋例外", async () => {
    mockCall.mockResolvedValue({
      ok: false,
      reason: "unreachable",
      detail: "連不上",
    });

    await expect(runAgentOrFallback(PARAMS)).resolves.toBeDefined();
  });
});

describe("runAgentOrFallback — agent 完成", () => {
  it("parse_complete → 走既有計價路徑（重用報價建立邏輯）", async () => {
    mockCall.mockResolvedValue(
      agentSuccess({
        outcome: "completed",
        event: "parse_complete",
        tool_result: { total: 48000 },
        fallback_reason: null,
      }),
    );

    await runAgentOrFallback(PARAMS);

    const [args] = mockResolve.mock.calls[0];
    // 空的 missingFields 讓 resolveAfterParse 進入計價分支
    expect(args.missingFields).toEqual([]);
  });

  it("parse_incomplete → 回傳 agent 擬定的問題", async () => {
    mockCall.mockResolvedValue(
      agentSuccess({
        outcome: "completed",
        event: "parse_incomplete",
        tool_result: {
          questions: [
            { target_field: "quantity", question: "想做幾款呢？" },
          ],
        },
        fallback_reason: null,
      }),
    );

    const outcome = await runAgentOrFallback(PARAMS);

    expect(outcome.questions).toEqual([
      { question: "想做幾款呢？", targetField: "quantity" },
    ]);
  });

  it("parse_incomplete 不再呼叫 resolveAfterParse（否則會寫入重複的反問）", async () => {
    mockCall.mockResolvedValue(
      agentSuccess({
        outcome: "completed",
        event: "parse_incomplete",
        tool_result: { questions: [] },
        fallback_reason: null,
      }),
    );

    await runAgentOrFallback(PARAMS);

    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("parse_incomplete 推進 session 狀態", async () => {
    mockCall.mockResolvedValue(
      agentSuccess({
        outcome: "completed",
        event: "parse_incomplete",
        tool_result: { questions: [] },
        fallback_reason: null,
      }),
    );

    const outcome = await runAgentOrFallback(PARAMS);

    expect(outcome.status).toBe("awaiting_clarification");
    expect(mockUpdate).toHaveBeenCalledWith(SESSION_ID, {
      status: "awaiting_clarification",
    });
  });
});

describe("runAgentOrFallback — 回應形狀的防禦", () => {
  it("parse_incomplete 但 tool_result 為 null → 不崩，回空問題清單", async () => {
    mockCall.mockResolvedValue(
      agentSuccess({
        outcome: "completed",
        event: "parse_incomplete",
        tool_result: null,
        fallback_reason: null,
      }),
    );

    const outcome = await runAgentOrFallback(PARAMS);

    expect(outcome.questions).toEqual([]);
    expect(outcome.status).toBe("awaiting_clarification");
  });

  it("欄位的 confidence 為 null → 視為 0（等同缺漏）", async () => {
    mockFindFields.mockResolvedValue([
      { ...STORED_ROWS[0], confidence: null },
    ] as never);
    mockCall.mockResolvedValue({
      ok: false,
      reason: "timeout",
      detail: "逾時",
    });

    await runAgentOrFallback(PARAMS);

    const [args] = mockResolve.mock.calls[0];
    expect(args.missingFields).toContain("subtype");
  });
});

describe("runAgentOrFallback — 請求內容", () => {
  it("以 session 的租戶範圍呼叫，不由 agent 指定", async () => {
    mockCall.mockResolvedValue(
      agentSuccess({
        outcome: "fallback",
        event: null,
        fallback_reason: "llm_error",
        tool_result: null,
      }),
    );

    await runAgentOrFallback(PARAMS);

    const [path, body] = mockCall.mock.calls[0];
    expect(path).toBe("/agent/resolve");
    expect(body).toMatchObject({
      session_id: SESSION_ID,
      merchant_id: MERCHANT_ID,
      category: "graphic_design",
    });
  });

  it("帶上先前輪次的問答脈絡", async () => {
    mockCall.mockResolvedValue(
      agentSuccess({
        outcome: "fallback",
        event: null,
        fallback_reason: "llm_error",
        tool_result: null,
      }),
    );

    await runAgentOrFallback({
      ...PARAMS,
      completedRounds: 1,
      priorAnswers: [{ question: "幾款？", answer: "三款" }],
    });

    const [, body] = mockCall.mock.calls[0];
    expect(body).toMatchObject({
      completed_rounds: 1,
      prior_answers: [{ question: "幾款？", answer: "三款" }],
    });
  });
});
