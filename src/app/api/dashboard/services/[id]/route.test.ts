import { authOkFixture } from "@/lib/auth/requireMerchantFixtures.ts";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/supabase/database.types.ts";

vi.mock("@/lib/auth/requireMerchant.ts", () => ({
  requireMerchant: vi.fn(),
}));

vi.mock("@/domains/pricing/repositories/servicesRepository.ts", () => ({
  servicesRepository: { findById: vi.fn(), update: vi.fn() },
}));

import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { servicesRepository } from "@/domains/pricing/repositories/servicesRepository.ts";
import { PATCH, DELETE } from "./route.ts";

const mockRequireMerchant = vi.mocked(requireMerchant);
const mockFindById = vi.mocked(servicesRepository.findById);
const mockUpdate = vi.mocked(servicesRepository.update);

const MERCHANT_ID = "99999999-9999-9999-9999-999999999999";
const OTHER_MERCHANT_ID = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const ITEM_ID = "550e8400-e29b-41d4-a716-446655440000";

const ITEM: Tables<"rate_card_base"> = {
  id: ITEM_ID,
  merchant_id: MERCHANT_ID,
  category: "illustration",
  subtype: "角色設計",
  unit: "每角色",
  base_price: 6000,
  includes: null,
  is_active: true,
};

function patchRequest(body: unknown): Request {
  return new Request(`http://localhost/api/dashboard/services/${ITEM_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteRequest(): Request {
  return new Request(`http://localhost/api/dashboard/services/${ITEM_ID}`, {
    method: "DELETE",
  });
}

function context(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/dashboard/services/[id]", () => {
  it("未登入 → 401", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 401 });

    const res = await PATCH(patchRequest({ base_price: 7000 }), context(ITEM_ID));

    expect(res.status).toBe(401);
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it("id 格式不正確 → 400", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));

    const res = await PATCH(patchRequest({ base_price: 7000 }), context("not-a-uuid"));

    expect(res.status).toBe(400);
  });

  it("body 驗證失敗（負數）→ 400", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));

    const res = await PATCH(patchRequest({ base_price: -100 }), context(ITEM_ID));

    expect(res.status).toBe(400);
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it("找不到資源 → 404", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));
    mockFindById.mockResolvedValue(null);

    const res = await PATCH(patchRequest({ base_price: 7000 }), context(ITEM_ID));

    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("跨租戶（非本人資源）→ 404", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));
    mockFindById.mockResolvedValue({ ...ITEM, merchant_id: OTHER_MERCHANT_ID });

    const res = await PATCH(patchRequest({ base_price: 7000 }), context(ITEM_ID));

    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("更新成功 → 200", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));
    mockFindById.mockResolvedValue(ITEM);
    mockUpdate.mockResolvedValue({ ...ITEM, base_price: 7000 });

    const res = await PATCH(patchRequest({ base_price: 7000 }), context(ITEM_ID));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.item.base_price).toBe(7000);
    expect(mockUpdate).toHaveBeenCalledWith(ITEM_ID, { base_price: 7000 });
  });
});

describe("DELETE /api/dashboard/services/[id]", () => {
  it("未登入 → 401", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 401 });

    const res = await DELETE(deleteRequest(), context(ITEM_ID));

    expect(res.status).toBe(401);
  });

  it("跨租戶（非本人資源）→ 404", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));
    mockFindById.mockResolvedValue({ ...ITEM, merchant_id: OTHER_MERCHANT_ID });

    const res = await DELETE(deleteRequest(), context(ITEM_ID));

    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("軟刪除成功 → 200，is_active=false", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));
    mockFindById.mockResolvedValue(ITEM);
    mockUpdate.mockResolvedValue({ ...ITEM, is_active: false });

    const res = await DELETE(deleteRequest(), context(ITEM_ID));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.item.is_active).toBe(false);
    expect(mockUpdate).toHaveBeenCalledWith(ITEM_ID, { is_active: false });
  });
});
