import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/domains/intake/sessionService.ts", () => ({
  createSession: vi.fn(),
  getSessionStatus: vi.fn(),
}));

vi.mock("@/lib/rateLimit/rateLimit.ts", () => ({
  checkRateLimit: vi.fn(),
  getClientIp: () => "test-ip",
  SESSION_CREATE_RULE: { limit: 10, windowMs: 3_600_000 },
}));

import { createSession } from "@/domains/intake/sessionService.ts";
import { checkRateLimit } from "@/lib/rateLimit/rateLimit.ts";
import { POST } from "@/app/api/sessions/route.ts";

const mockCreateSession = vi.mocked(createSession);
const mockCheckRateLimit = vi.mocked(checkRateLimit);

function postRequest(body: unknown, raw = false): Request {
  return new Request("http://localhost/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
});

describe("POST /api/sessions", () => {
  it("合法 category → 201 + 信封含 session_id 與 status", async () => {
    mockCreateSession.mockResolvedValue({ sessionId: "sid-1", status: "created" });

    const res = await POST(postRequest({ category: "illustration" }));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toEqual({
      success: true,
      data: { session_id: "sid-1", status: "created" },
      error: null,
    });
    expect(mockCreateSession).toHaveBeenCalledWith("illustration");
  });

  it("非 JSON 主體 → 400", async () => {
    const res = await POST(postRequest("這不是 JSON{{", true));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("缺 category → 400", async () => {
    const res = await POST(postRequest({}));
    expect(res.status).toBe(400);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("category 非合法列舉 → 400", async () => {
    const res = await POST(postRequest({ category: "cooking" }));
    expect(res.status).toBe(400);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("超過 rate limit → 429 且不建立 session", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false });

    const res = await POST(postRequest({ category: "illustration" }));
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.success).toBe(false);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("service 拋錯 → 500 + 友善訊息（不洩漏內部細節）", async () => {
    mockCreateSession.mockRejectedValue(new Error("DB connection refused"));

    const res = await POST(postRequest({ category: "web_design" }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).not.toContain("DB connection refused");
  });
});
