import { authOkFixture } from "@/lib/auth/requireMerchantFixtures.ts";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { QuoteDetail } from "@/domains/pricing/quoteReviewTypes.ts";

vi.mock("@/lib/auth/requireMerchant.ts", () => ({
  requireMerchant: vi.fn(),
}));

vi.mock("@/domains/pricing/quoteReviewService.ts", () => ({
  getQuoteDetail: vi.fn(),
}));

vi.mock("@/domains/pricing/quoteActionsService.ts", () => ({
  adjustQuoteAmount: vi.fn(),
  confirmQuote: vi.fn(),
}));

import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { getQuoteDetail } from "@/domains/pricing/quoteReviewService.ts";
import { adjustQuoteAmount } from "@/domains/pricing/quoteActionsService.ts";
import { GET, PATCH } from "./route.ts";

const mockRequireMerchant = vi.mocked(requireMerchant);
const mockGetQuoteDetail = vi.mocked(getQuoteDetail);
const mockAdjustQuoteAmount = vi.mocked(adjustQuoteAmount);

const MERCHANT_ID = "99999999-9999-9999-9999-999999999999";
// zod 4 的 .uuid() 嚴格檢查 RFC 4122 variant/version bits——
// 「6666…」「5555…」這類重複數字不是合法 UUID，route 會回 400。
const QUOTE_ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const SESSION_ID = "a3bb189e-8bf9-4888-9912-ace4e6543002";

const DETAIL: QuoteDetail = {
  quote: {
    id: QUOTE_ID,
    session_id: SESSION_ID,
    merchant_id: MERCHANT_ID,
    quote_code: "I-2607-001",
    final_amount: 8000,
    status: "awaiting_review",
    pdf_url: null,
    created_at: "2026-07-11T02:00:00.000Z",
    sent_at: null,
    is_conservative: false,
  },
  session: {
    id: SESSION_ID,
    merchant_id: MERCHANT_ID,
    category: "illustration",
    contact_email: "client@example.com",
    status: "awaiting_review",
    current_step: 4,
    created_at: "2026-07-11T01:00:00.000Z",
    updated_at: "2026-07-11T02:00:00.000Z",
  },
  lineItems: [],
  extractedFields: [],
  clarifications: [],
  rawInputs: [],
  agentSteps: [],
};

function getRequest(): Request {
  return new Request(`http://localhost/api/dashboard/quotes/${QUOTE_ID}`);
}

function routeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

const UPDATED_QUOTE = { ...DETAIL.quote, final_amount: 9000 };

function patchRequest(body: unknown, raw = false): Request {
  return new Request(`http://localhost/api/dashboard/quotes/${QUOTE_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/dashboard/quotes/[id]", () => {
  it("未登入 → 401", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 401 });

    const res = await GET(getRequest(), routeParams(QUOTE_ID));

    expect(res.status).toBe(401);
    expect(mockGetQuoteDetail).not.toHaveBeenCalled();
  });

  it("已登入無 merchant → 403", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 403 });

    const res = await GET(getRequest(), routeParams(QUOTE_ID));

    expect(res.status).toBe(403);
  });

  it("id 非 UUID → 400", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));

    const res = await GET(getRequest(), routeParams("not-a-uuid"));

    expect(res.status).toBe(400);
    expect(mockGetQuoteDetail).not.toHaveBeenCalled();
  });

  it("查無報價（或跨租戶）→ 404", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));
    mockGetQuoteDetail.mockResolvedValue(null);

    const res = await GET(getRequest(), routeParams(QUOTE_ID));

    expect(res.status).toBe(404);
  });

  it("成功 → 200 帶完整 detail", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));
    mockGetQuoteDetail.mockResolvedValue(DETAIL);

    const res = await GET(getRequest(), routeParams(QUOTE_ID));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.detail).toEqual(DETAIL);
    expect(mockGetQuoteDetail).toHaveBeenCalledWith(QUOTE_ID, MERCHANT_ID);
  });

  it("service 拋錯 → 500", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));
    mockGetQuoteDetail.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(getRequest(), routeParams(QUOTE_ID));

    expect(res.status).toBe(500);
  });
});

describe("PATCH /api/dashboard/quotes/[id]", () => {
  it("未登入 → 401", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 401 });

    const res = await PATCH(patchRequest({ final_amount: 9000 }), routeParams(QUOTE_ID));

    expect(res.status).toBe(401);
    expect(mockAdjustQuoteAmount).not.toHaveBeenCalled();
  });

  it("已登入無 merchant → 403", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 403 });

    const res = await PATCH(patchRequest({ final_amount: 9000 }), routeParams(QUOTE_ID));

    expect(res.status).toBe(403);
  });

  it("id 非 UUID → 400", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));

    const res = await PATCH(patchRequest({ final_amount: 9000 }), routeParams("bad-id"));

    expect(res.status).toBe(400);
    expect(mockAdjustQuoteAmount).not.toHaveBeenCalled();
  });

  it("body 非合法 JSON → 400", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));

    const res = await PATCH(patchRequest("{not json", true), routeParams(QUOTE_ID));

    expect(res.status).toBe(400);
  });

  it("金額非正數 → 400", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));

    const res = await PATCH(patchRequest({ final_amount: -1 }), routeParams(QUOTE_ID));

    expect(res.status).toBe(400);
    expect(mockAdjustQuoteAmount).not.toHaveBeenCalled();
  });

  it("跨租戶或不存在 → 404", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));
    mockAdjustQuoteAmount.mockResolvedValue({ ok: false, reason: "not_found" });

    const res = await PATCH(patchRequest({ final_amount: 9000 }), routeParams(QUOTE_ID));

    expect(res.status).toBe(404);
  });

  it("報價已確認/已寄出 → 409", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));
    mockAdjustQuoteAmount.mockResolvedValue({ ok: false, reason: "conflict" });

    const res = await PATCH(patchRequest({ final_amount: 9000 }), routeParams(QUOTE_ID));

    expect(res.status).toBe(409);
  });

  it("成功 → 200，回傳更新後的報價", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));
    mockAdjustQuoteAmount.mockResolvedValue({ ok: true, quote: UPDATED_QUOTE });

    const res = await PATCH(patchRequest({ final_amount: 9000 }), routeParams(QUOTE_ID));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.quote).toEqual(UPDATED_QUOTE);
    expect(mockAdjustQuoteAmount).toHaveBeenCalledWith({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_ID,
      finalAmount: 9000,
    });
  });

  it("service 拋錯 → 500", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));
    mockAdjustQuoteAmount.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await PATCH(patchRequest({ final_amount: 9000 }), routeParams(QUOTE_ID));

    expect(res.status).toBe(500);
  });
});
