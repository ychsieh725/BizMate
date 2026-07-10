import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetUser = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
  })),
}));

vi.mock("@/lib/env.ts", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
  },
}));

import { getUserAndResponse } from "./middlewareClient.ts";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getUserAndResponse", () => {
  it("回傳已登入使用者", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });

    const request = new NextRequest("http://localhost/dashboard");
    const { user } = await getUserAndResponse(request);

    expect(user).toEqual({ id: "u1" });
  });

  it("未登入時 user 為 null", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const request = new NextRequest("http://localhost/dashboard");
    const { user } = await getUserAndResponse(request);

    expect(user).toBeNull();
  });

  it("Supabase 呼叫失敗時 fail closed（視為未登入，不拋錯）", async () => {
    mockGetUser.mockRejectedValue(new Error("network error"));

    const request = new NextRequest("http://localhost/dashboard");
    const { user } = await getUserAndResponse(request);

    expect(user).toBeNull();
  });

  it("回傳 NextResponse 物件供 middleware 沿用", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const request = new NextRequest("http://localhost/dashboard");
    const { response } = await getUserAndResponse(request);

    expect(response).toBeDefined();
  });
});
