import { authOkFixture } from "@/lib/auth/requireMerchantFixtures.ts";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/supabase/database.types.ts";

vi.mock("@/lib/auth/requireMerchant.ts", () => ({
  requireMerchant: vi.fn(),
}));

vi.mock("@/domains/merchant/repositories/merchantsRepository.ts", () => ({
  merchantsRepository: {
    findById: vi.fn(),
    update: vi.fn(),
  },
}));

import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { merchantsRepository } from "@/domains/merchant/repositories/merchantsRepository.ts";
import { GET, PATCH } from "./route.ts";

const mockRequireMerchant = vi.mocked(requireMerchant);
const mockFindById = vi.mocked(merchantsRepository.findById);
const mockUpdate = vi.mocked(merchantsRepository.update);

const MERCHANT_ID = "99999999-9999-9999-9999-999999999999";

const MERCHANT: Tables<"merchants"> = {
  id: MERCHANT_ID,
  display_name: "王小明工作室",
  public_slug: "wang-studio",
  contact_email: "wang@example.com",
  created_at: "2026-07-05T00:00:00Z",
  updated_at: "2026-07-05T00:00:00Z",
};

function patchRequest(body: unknown, raw = false): Request {
  return new Request("http://localhost/api/dashboard/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/dashboard/settings", () => {
  it("未登入 → 401", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 401 });

    const res = await GET();

    expect(res.status).toBe(401);
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it("已登入無 merchant → 403", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 403 });

    const res = await GET();

    expect(res.status).toBe(403);
  });

  it("成功 → 回傳 display_name + public_slug", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));
    mockFindById.mockResolvedValue(MERCHANT);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual({
      display_name: "王小明工作室",
      public_slug: "wang-studio",
    });
  });

  it("merchant 查無（資料不一致）→ 500", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));
    mockFindById.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(500);
  });
});

describe("PATCH /api/dashboard/settings", () => {
  it("未登入 → 401", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 401 });

    const res = await PATCH(patchRequest({ display_name: "新名稱" }));

    expect(res.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("body 驗證失敗（空物件）→ 400", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));

    const res = await PATCH(patchRequest({}));

    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("public_slug 格式不合法 → 400", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));

    const res = await PATCH(patchRequest({ public_slug: "Bad Slug!" }));

    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("非 JSON 主體 → 400", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));

    const res = await PATCH(patchRequest("這不是 JSON{{", true));

    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("更新成功 → 200 + 更新後資料", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));
    const updated = { ...MERCHANT, display_name: "新名稱" };
    mockUpdate.mockResolvedValue(updated);

    const res = await PATCH(patchRequest({ display_name: "新名稱" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual({
      display_name: "新名稱",
      public_slug: "wang-studio",
    });
    expect(mockUpdate).toHaveBeenCalledWith(MERCHANT_ID, { display_name: "新名稱" });
  });

  it("slug 撞號（UNIQUE 違反）→ 409", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));
    mockUpdate.mockRejectedValue(
      new Error("duplicate key value violates unique constraint"),
    );

    const res = await PATCH(patchRequest({ public_slug: "taken-slug" }));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toContain("已被使用");
  });

  it("其他錯誤 → 500 且不洩漏內部細節", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));
    mockUpdate.mockRejectedValue(new Error("DB connection refused"));

    const res = await PATCH(patchRequest({ display_name: "新名稱" }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).not.toContain("DB connection refused");
  });
});
