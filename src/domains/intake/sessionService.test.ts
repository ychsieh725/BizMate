import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/supabase/database.types.ts";

// mock repository 單例：service 測試不碰真實 Supabase，只驗證委派與轉換邏輯
vi.mock("@/domains/intake/repositories/sessionsRepository.ts", () => ({
  sessionsRepository: {
    create: vi.fn(),
    findById: vi.fn(),
  },
}));

import { sessionsRepository } from "@/domains/intake/repositories/sessionsRepository.ts";
import { createSession, getSessionStatus } from "@/domains/intake/sessionService.ts";

const mockCreate = vi.mocked(sessionsRepository.create);
const mockFindById = vi.mocked(sessionsRepository.findById);

const MERCHANT_ID = "99999999-9999-9999-9999-999999999999";

function fakeSession(overrides: Partial<Tables<"sessions">> = {}): Tables<"sessions"> {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    merchant_id: MERCHANT_ID,
    category: "illustration",
    contact_email: null,
    status: "created",
    current_step: 1,
    created_at: "2026-07-05T00:00:00Z",
    updated_at: "2026-07-05T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createSession", () => {
  it("以 category + merchantId 建立 session，回傳 sessionId 與 status", async () => {
    mockCreate.mockResolvedValue(fakeSession({ id: "abc", status: "created" }));

    const result = await createSession("illustration", MERCHANT_ID);

    expect(mockCreate).toHaveBeenCalledWith({
      category: "illustration",
      merchant_id: MERCHANT_ID,
    });
    expect(result).toEqual({ sessionId: "abc", status: "created" });
  });

  it("不硬編碼 status/current_step，讓 DB 填 default", async () => {
    mockCreate.mockResolvedValue(fakeSession());

    await createSession("web_design", MERCHANT_ID);

    expect(mockCreate).toHaveBeenCalledWith({
      category: "web_design",
      merchant_id: MERCHANT_ID,
    });
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("status");
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("current_step");
  });
});

describe("getSessionStatus", () => {
  it("session 存在時回傳其 status", async () => {
    mockFindById.mockResolvedValue(fakeSession({ status: "awaiting_review" }));

    const status = await getSessionStatus("abc");

    expect(mockFindById).toHaveBeenCalledWith("abc");
    expect(status).toBe("awaiting_review");
  });

  it("session 不存在時回傳 null", async () => {
    mockFindById.mockResolvedValue(null);

    const status = await getSessionStatus("missing");

    expect(status).toBeNull();
  });
});
