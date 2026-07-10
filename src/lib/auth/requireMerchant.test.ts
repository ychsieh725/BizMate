import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/supabase/database.types.ts";

const mockGetUser = vi.fn();

vi.mock("@/lib/supabase/serverClient.ts", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
  })),
}));

vi.mock("@/domains/merchant/repositories/merchantsRepository.ts", () => ({
  merchantsRepository: { findById: vi.fn() },
}));

import { merchantsRepository } from "@/domains/merchant/repositories/merchantsRepository.ts";
import { requireMerchant } from "./requireMerchant.ts";

const mockFindById = vi.mocked(merchantsRepository.findById);

const MERCHANT: Tables<"merchants"> = {
  id: "u1",
  display_name: "測試商家",
  public_slug: "test123",
  contact_email: "test@example.com",
  created_at: "2026-07-10T00:00:00Z",
  updated_at: "2026-07-10T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireMerchant", () => {
  it("未登入 → 401", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const result = await requireMerchant();

    expect(result).toEqual({ ok: false, status: 401 });
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it("已登入但無 merchant → 403", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockFindById.mockResolvedValue(null);

    const result = await requireMerchant();

    expect(result).toEqual({ ok: false, status: 403 });
  });

  it("已登入且有 merchant → 回傳 merchantId", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockFindById.mockResolvedValue(MERCHANT);

    const result = await requireMerchant();

    expect(result).toEqual({ ok: true, merchantId: "u1" });
  });

  it("Supabase 呼叫例外時 fail closed → 401", async () => {
    mockGetUser.mockRejectedValue(new Error("network error"));

    const result = await requireMerchant();

    expect(result).toEqual({ ok: false, status: 401 });
  });
});
