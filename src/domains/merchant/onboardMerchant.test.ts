import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/supabase/database.types.ts";

vi.mock("@/domains/merchant/repositories/merchantsRepository.ts", () => ({
  merchantsRepository: {
    findById: vi.fn(),
    findBySlug: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("@/domains/merchant/onboardingService.ts", () => ({
  copyTemplateRateCard: vi.fn(),
}));

import { merchantsRepository } from "@/domains/merchant/repositories/merchantsRepository.ts";
import { copyTemplateRateCard } from "@/domains/merchant/onboardingService.ts";
import { onboardMerchant } from "./onboardMerchant.ts";

const mockFindById = vi.mocked(merchantsRepository.findById);
const mockFindBySlug = vi.mocked(merchantsRepository.findBySlug);
const mockCreate = vi.mocked(merchantsRepository.create);
const mockCopyTemplateRateCard = vi.mocked(copyTemplateRateCard);

const MERCHANT: Tables<"merchants"> = {
  id: "u1",
  display_name: "測試商家",
  public_slug: "abc123",
  contact_email: "abc123@gmail.com",
  created_at: "2026-07-10T00:00:00Z",
  updated_at: "2026-07-10T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("onboardMerchant", () => {
  it("已有 merchant 時直接回傳，不建立、不複製範本（真冪等）", async () => {
    mockFindById.mockResolvedValue(MERCHANT);

    const result = await onboardMerchant("u1", "abc123@gmail.com", "新名稱");

    expect(result).toEqual({ merchant: MERCHANT, created: false });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCopyTemplateRateCard).not.toHaveBeenCalled();
  });

  it("無 merchant 且 slug 未碰撞：建立 merchant 並複製範本", async () => {
    mockFindById.mockResolvedValue(null);
    mockFindBySlug.mockResolvedValue(null);
    mockCreate.mockResolvedValue(MERCHANT);

    const result = await onboardMerchant("u1", "abc123@gmail.com", "測試商家");

    expect(mockCreate).toHaveBeenCalledWith({
      id: "u1",
      display_name: "測試商家",
      public_slug: "abc123",
      contact_email: "abc123@gmail.com",
    });
    expect(mockCopyTemplateRateCard).toHaveBeenCalledWith(MERCHANT.id);
    expect(result).toEqual({ merchant: MERCHANT, created: true });
  });

  it("slug 碰撞時仍能建立，且 create 收到帶後綴的 slug", async () => {
    mockFindById.mockResolvedValue(null);
    mockFindBySlug
      .mockResolvedValueOnce(MERCHANT) // 基底已被使用
      .mockResolvedValueOnce(null); // 後綴候選可用
    mockCreate.mockResolvedValue(MERCHANT);

    await onboardMerchant("u1", "abc123@gmail.com", "測試商家");

    expect(mockFindBySlug).toHaveBeenCalledTimes(2);
    const createArg = mockCreate.mock.calls[0][0];
    expect(createArg.public_slug).toMatch(/^abc123-\d{3}$/);
  });
});
