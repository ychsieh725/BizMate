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

function fakeSession(overrides: Partial<Tables<"sessions">> = {}): Tables<"sessions"> {
  return {
    id: "11111111-1111-1111-1111-111111111111",
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
  it("以 category 建立 session，回傳 sessionId 與 status", async () => {
    mockCreate.mockResolvedValue(fakeSession({ id: "abc", status: "created" }));

    const result = await createSession("illustration");

    expect(mockCreate).toHaveBeenCalledWith({ category: "illustration" });
    expect(result).toEqual({ sessionId: "abc", status: "created" });
  });

  it("不硬編碼 status/current_step，只傳 category 讓 DB 填 default", async () => {
    mockCreate.mockResolvedValue(fakeSession());

    await createSession("web_design");

    expect(mockCreate).toHaveBeenCalledWith({ category: "web_design" });
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("status");
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("current_step");
  });
});

describe("getSessionStatus", () => {
  it("session 存在時回傳其 status", async () => {
    mockFindById.mockResolvedValue(fakeSession({ status: "awaiting_freelancer" }));

    const status = await getSessionStatus("abc");

    expect(mockFindById).toHaveBeenCalledWith("abc");
    expect(status).toBe("awaiting_freelancer");
  });

  it("session 不存在時回傳 null", async () => {
    mockFindById.mockResolvedValue(null);

    const status = await getSessionStatus("missing");

    expect(status).toBeNull();
  });
});
