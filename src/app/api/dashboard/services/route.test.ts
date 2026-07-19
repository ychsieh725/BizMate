import { authOkFixture } from "@/lib/auth/requireMerchantFixtures.ts";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/supabase/database.types.ts";

vi.mock("@/lib/auth/requireMerchant.ts", () => ({
  requireMerchant: vi.fn(),
}));

vi.mock("@/domains/pricing/repositories/servicesRepository.ts", () => ({
  servicesRepository: {
    findAllByMerchant: vi.fn(),
    findModifiersByMerchant: vi.fn(),
    create: vi.fn(),
  },
}));

import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { servicesRepository } from "@/domains/pricing/repositories/servicesRepository.ts";
import { GET, POST } from "./route.ts";

const mockRequireMerchant = vi.mocked(requireMerchant);
const mockFindAllByMerchant = vi.mocked(servicesRepository.findAllByMerchant);
const mockFindModifiersByMerchant = vi.mocked(
  servicesRepository.findModifiersByMerchant,
);
const mockCreate = vi.mocked(servicesRepository.create);

const MERCHANT_ID = "99999999-9999-9999-9999-999999999999";

const ITEM: Tables<"rate_card_base"> = {
  id: "item-1",
  merchant_id: MERCHANT_ID,
  category: "illustration",
  subtype: "角色設計",
  unit: "每角色",
  base_price: 6000,
  includes: null,
  is_active: true,
};

function postRequest(body: unknown, raw = false): Request {
  return new Request("http://localhost/api/dashboard/services", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/dashboard/services", () => {
  it("未登入 → 401", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 401 });

    const res = await GET();

    expect(res.status).toBe(401);
    expect(mockFindAllByMerchant).not.toHaveBeenCalled();
  });

  it("已登入無 merchant → 403", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 403 });

    const res = await GET();

    expect(res.status).toBe(403);
  });

  it("成功 → 回傳 items + modifiers", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));
    mockFindAllByMerchant.mockResolvedValue([ITEM]);
    mockFindModifiersByMerchant.mockResolvedValue([]);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.items).toEqual([ITEM]);
    expect(json.data.modifiers).toEqual([]);
  });
});

describe("POST /api/dashboard/services", () => {
  it("未登入 → 401", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 401 });

    const res = await POST(postRequest({}));

    expect(res.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("body 驗證失敗 → 400", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));

    const res = await POST(postRequest({ category: "illustration" }));

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("新增成功 → 201", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));
    mockCreate.mockResolvedValue(ITEM);

    const res = await POST(
      postRequest({
        category: "illustration",
        subtype: "角色設計",
        unit: "每角色",
        base_price: 6000,
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.item).toEqual(ITEM);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "illustration",
        subtype: "角色設計",
        unit: "每角色",
        base_price: 6000,
        merchant_id: MERCHANT_ID,
      }),
    );
  });

  it("UNIQUE 撞號（category+subtype 重複）→ 409", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));
    mockCreate.mockRejectedValue(
      new Error("duplicate key value violates unique constraint"),
    );

    const res = await POST(
      postRequest({
        category: "illustration",
        subtype: "角色設計",
        unit: "每角色",
        base_price: 6000,
      }),
    );

    expect(res.status).toBe(409);
  });
});
