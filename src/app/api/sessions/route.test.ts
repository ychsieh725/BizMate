import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/supabase/database.types.ts";

vi.mock("@/domains/intake/sessionService.ts", () => ({
  createSession: vi.fn(),
  getSessionStatus: vi.fn(),
}));

vi.mock("@/domains/merchant/repositories/merchantsRepository.ts", () => ({
  merchantsRepository: { findBySlug: vi.fn() },
}));

vi.mock("@/lib/rateLimit/rateLimit.ts", () => ({
  checkRateLimit: vi.fn(),
  getClientIp: () => "test-ip",
  SESSION_CREATE_RULE: { limit: 10, windowMs: 3_600_000 },
}));
import { SESSION_CREATE_RULE } from "@/lib/rateLimit/rateLimit.ts";

import { createSession } from "@/domains/intake/sessionService.ts";
import { merchantsRepository } from "@/domains/merchant/repositories/merchantsRepository.ts";
import { checkRateLimit } from "@/lib/rateLimit/rateLimit.ts";
import { POST } from "@/app/api/sessions/route.ts";

const mockCreateSession = vi.mocked(createSession);
const mockFindBySlug = vi.mocked(merchantsRepository.findBySlug);
const mockCheckRateLimit = vi.mocked(checkRateLimit);

const MERCHANT: Tables<"merchants"> = {
  id: "99999999-9999-9999-9999-999999999999",
  display_name: "Dev 商家",
  public_slug: "dev",
  contact_email: "dev@bizmate.local",
  created_at: "2026-07-05T00:00:00Z",
  updated_at: "2026-07-05T00:00:00Z",
};

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
  mockFindBySlug.mockResolvedValue(MERCHANT);
});

describe("POST /api/sessions", () => {
  it("合法 category + slug → 201 + 信封含 session_id 與 status", async () => {
    mockCreateSession.mockResolvedValue({ sessionId: "sid-1", status: "created" });

    const res = await POST(postRequest({ category: "illustration", slug: "dev" }));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json).toEqual({
      success: true,
      data: { session_id: "sid-1", status: "created" },
      error: null,
    });
    expect(mockFindBySlug).toHaveBeenCalledWith("dev");
    expect(mockCreateSession).toHaveBeenCalledWith("illustration", MERCHANT.id);
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      "sessions:ip:test-ip",
      SESSION_CREATE_RULE,
    );
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      "sessions:slug:dev",
      SESSION_CREATE_RULE,
    );
  });

  it("查無 slug 對應商家 → 404 且不建立 session", async () => {
    mockFindBySlug.mockResolvedValue(null);

    const res = await POST(postRequest({ category: "illustration", slug: "ghost" }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("缺 slug → 400", async () => {
    const res = await POST(postRequest({ category: "illustration" }));
    expect(res.status).toBe(400);
    expect(mockFindBySlug).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("slug 格式不合法 → 400", async () => {
    const res = await POST(postRequest({ category: "illustration", slug: "A B!" }));
    expect(res.status).toBe(400);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("非 JSON 主體 → 400", async () => {
    const res = await POST(postRequest("這不是 JSON{{", true));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("缺 category → 400", async () => {
    const res = await POST(postRequest({ slug: "dev" }));
    expect(res.status).toBe(400);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("category 非合法列舉 → 400", async () => {
    const res = await POST(postRequest({ category: "cooking", slug: "dev" }));
    expect(res.status).toBe(400);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("超過 rate limit → 429 且不建立 session", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false });

    const res = await POST(postRequest({ category: "illustration", slug: "dev" }));
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(mockFindBySlug).not.toHaveBeenCalled();
    expect(json.success).toBe(false);
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("同 slug 超過 rate limit（IP 桶允許但 slug 桶超限）→ 429", async () => {
    mockCheckRateLimit.mockImplementation(async (bucketKey: string) => ({
      allowed: !bucketKey.startsWith("sessions:slug:"),
    }));

    const res = await POST(postRequest({ category: "illustration", slug: "dev" }));
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(mockFindBySlug).not.toHaveBeenCalled();
    expect(json.success).toBe(false);
  });

  it("service 拋錯 → 500 + 友善訊息（不洩漏內部細節）", async () => {
    mockCreateSession.mockRejectedValue(new Error("DB connection refused"));

    const res = await POST(postRequest({ category: "web_design", slug: "dev" }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).not.toContain("DB connection refused");
  });
});
