import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/orchestrator/describeFlow.ts", () => ({ handleDescribe: vi.fn() }));

import { handleDescribe } from "@/orchestrator/describeFlow.ts";
import { POST } from "@/app/api/sessions/[id]/describe/route.ts";

const mockHandle = vi.mocked(handleDescribe);
const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_BODY = { raw_text: "幫我畫一個角色", contact_email: "c@example.com" };

function post(id: string, body: unknown, raw = false) {
  return POST(
    new Request(`http://localhost/api/sessions/${id}/describe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/sessions/{id}/describe — 驗證", () => {
  it("非法 UUID → 400，不進編排", async () => {
    const res = await post("bad-id", VALID_BODY);
    expect(res.status).toBe(400);
    expect(mockHandle).not.toHaveBeenCalled();
  });

  it("非 JSON → 400", async () => {
    const res = await post(VALID_UUID, "不是JSON{{", true);
    expect(res.status).toBe(400);
  });

  it("缺 raw_text → 400", async () => {
    const res = await post(VALID_UUID, { contact_email: "c@example.com" });
    expect(res.status).toBe(400);
  });

  it("email 格式錯 → 400", async () => {
    const res = await post(VALID_UUID, { raw_text: "x", contact_email: "not-email" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/sessions/{id}/describe — 編排結果對映", () => {
  it("not_found → 404", async () => {
    mockHandle.mockResolvedValue({ ok: false, error: "not_found" });
    const res = await post(VALID_UUID, VALID_BODY);
    expect(res.status).toBe(404);
  });

  it("conflict → 409", async () => {
    mockHandle.mockResolvedValue({ ok: false, error: "conflict", currentStatus: "awaiting_freelancer" });
    const res = await post(VALID_UUID, VALID_BODY);
    expect(res.status).toBe(409);
  });

  it("齊全 → 200 + quote_code + out_of_scope（snake_case）", async () => {
    mockHandle.mockResolvedValue({
      ok: true,
      outcome: { status: "awaiting_freelancer", quoteCode: "I-2607001", outOfScope: false },
    });
    const res = await post(VALID_UUID, VALID_BODY);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data).toEqual({
      status: "awaiting_freelancer",
      quote_code: "I-2607001",
      out_of_scope: false,
    });
  });

  it("缺欄位 → 200 + missing_fields", async () => {
    mockHandle.mockResolvedValue({
      ok: true,
      outcome: { status: "awaiting_clarification", missingFields: ["deadline_days"] },
    });
    const res = await post(VALID_UUID, VALID_BODY);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data).toEqual({
      status: "awaiting_clarification",
      missing_fields: ["deadline_days"],
    });
  });

  it("編排拋錯 → 500 + 友善訊息", async () => {
    mockHandle.mockRejectedValue(new Error("gemini timeout"));
    const res = await post(VALID_UUID, VALID_BODY);
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.error).not.toContain("gemini timeout");
  });
});
