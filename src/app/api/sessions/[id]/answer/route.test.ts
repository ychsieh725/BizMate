import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/orchestrator/answerFlow.ts", () => ({ handleAnswer: vi.fn() }));

import { handleAnswer } from "@/orchestrator/answerFlow.ts";
import { POST } from "@/app/api/sessions/[id]/answer/route.ts";

const mockHandleAnswer = vi.mocked(handleAnswer);

const VALID_ID = "550e8400-e29b-41d4-a716-446655440000";

function postRequest(body: unknown, raw = false): Request {
  return new Request(`http://localhost/api/sessions/${VALID_ID}/answer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

function params(id = VALID_ID) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/sessions/[id]/answer", () => {
  it("id 非 UUID → 400，不進入編排", async () => {
    const res = await POST(postRequest({ answer: "商業使用" }), params("not-uuid"));
    expect(res.status).toBe(400);
    expect(mockHandleAnswer).not.toHaveBeenCalled();
  });

  it("非 JSON 主體 → 400", async () => {
    const res = await POST(postRequest("壞掉的{{", true), params());
    expect(res.status).toBe(400);
    expect(mockHandleAnswer).not.toHaveBeenCalled();
  });

  it("缺 answer → 400", async () => {
    const res = await POST(postRequest({}), params());
    expect(res.status).toBe(400);
    expect(mockHandleAnswer).not.toHaveBeenCalled();
  });

  it("session 不存在 → 404", async () => {
    mockHandleAnswer.mockResolvedValue({ ok: false, error: "not_found" });
    const res = await POST(postRequest({ answer: "商業使用" }), params());
    expect(res.status).toBe(404);
  });

  it("無待回答的反問 → 409", async () => {
    mockHandleAnswer.mockResolvedValue({ ok: false, error: "no_pending_question" });
    const res = await POST(postRequest({ answer: "商業使用" }), params());
    expect(res.status).toBe(409);
  });

  it("狀態不允許回答 → 409", async () => {
    mockHandleAnswer.mockResolvedValue({
      ok: false,
      error: "conflict",
      currentStatus: "awaiting_review",
    });
    const res = await POST(postRequest({ answer: "商業使用" }), params());
    expect(res.status).toBe(409);
  });

  it("續問 → 200 + question/target_field", async () => {
    mockHandleAnswer.mockResolvedValue({
      ok: true,
      outcome: {
        status: "awaiting_clarification",
        question: "交期希望幾天內完成呢？",
        targetField: "deadline_days",
        missingFields: ["deadline_days"],
      },
    });

    const res = await POST(postRequest({ answer: "商業使用" }), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({
      status: "awaiting_clarification",
      question: "交期希望幾天內完成呢？",
      target_field: "deadline_days",
    });
  });

  it("保守估算出報價 → 200 + conservative/quote_code", async () => {
    mockHandleAnswer.mockResolvedValue({
      ok: true,
      outcome: {
        status: "awaiting_review",
        quoteCode: "I-2607007",
        outOfScope: false,
        conservative: true,
      },
    });

    const res = await POST(postRequest({ answer: "不確定" }), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({
      status: "awaiting_review",
      quote_code: "I-2607007",
      conservative: true,
    });
  });
});
