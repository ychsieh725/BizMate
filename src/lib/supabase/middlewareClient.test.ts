import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetClaims = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getClaims: mockGetClaims },
  })),
}));

vi.mock("@/lib/env.ts", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
  },
}));

import { getUserIdAndResponse } from "./middlewareClient.ts";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getUserIdAndResponse", () => {
  it("JWT 驗證通過 → 回傳 claims.sub 作為 userId", async () => {
    mockGetClaims.mockResolvedValue({
      data: { claims: { sub: "u1" } },
      error: null,
    });

    const request = new NextRequest("http://localhost/dashboard");
    const { userId } = await getUserIdAndResponse(request);

    expect(userId).toBe("u1");
  });

  it("無 session（data 為 null）→ userId 為 null", async () => {
    mockGetClaims.mockResolvedValue({ data: null, error: null });

    const request = new NextRequest("http://localhost/dashboard");
    const { userId } = await getUserIdAndResponse(request);

    expect(userId).toBeNull();
  });

  it("Supabase 呼叫失敗時 fail closed（視為未登入，不拋錯）", async () => {
    mockGetClaims.mockRejectedValue(new Error("network error"));

    const request = new NextRequest("http://localhost/dashboard");
    const { userId } = await getUserIdAndResponse(request);

    expect(userId).toBeNull();
  });

  it("回傳 NextResponse 物件供 middleware 沿用", async () => {
    mockGetClaims.mockResolvedValue({ data: null, error: null });

    const request = new NextRequest("http://localhost/dashboard");
    const { response } = await getUserIdAndResponse(request);

    expect(response).toBeDefined();
  });
});
