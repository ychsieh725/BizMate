import { authOkFixture } from "@/lib/auth/requireMerchantFixtures.ts";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/supabase/database.types.ts";

vi.mock("@/lib/auth/requireMerchant.ts", () => ({
  requireMerchant: vi.fn(),
}));

vi.mock("@/domains/pricing/quoteActionsService.ts", () => ({
  declineQuote: vi.fn(),
}));

import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { declineQuote } from "@/domains/pricing/quoteActionsService.ts";
import { POST } from "./route.ts";

const mockRequireMerchant = vi.mocked(requireMerchant);
const mockDeclineQuote = vi.mocked(declineQuote);

const MERCHANT_ID = "99999999-9999-4999-8999-999999999999";
const QUOTE_ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

const DECLINED_QUOTE: Tables<"quotes"> = {
  id: QUOTE_ID,
  session_id: "a3bb189e-8bf9-4888-9912-ace4e6543002",
  merchant_id: MERCHANT_ID,
  quote_code: "I-2607-001",
  final_amount: 9000,
  status: "abandoned",
  pdf_url: null,
  created_at: "2026-07-11T02:00:00.000Z",
  sent_at: null,
  is_conservative: false,
};

function postRequest(): Request {
  return new Request(
    `http://localhost/api/dashboard/quotes/${QUOTE_ID}/decline`,
    { method: "POST" },
  );
}

function routeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/dashboard/quotes/[id]/decline", () => {
  it("未登入 → 401", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 401 });

    const res = await POST(postRequest(), routeParams(QUOTE_ID));

    expect(res.status).toBe(401);
    expect(mockDeclineQuote).not.toHaveBeenCalled();
  });

  it("已登入無 merchant → 403", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 403 });

    const res = await POST(postRequest(), routeParams(QUOTE_ID));

    expect(res.status).toBe(403);
  });

  it("id 非 UUID → 400", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));

    const res = await POST(postRequest(), routeParams("bad-id"));

    expect(res.status).toBe(400);
    expect(mockDeclineQuote).not.toHaveBeenCalled();
  });

  it("跨租戶或不存在 → 404", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));
    mockDeclineQuote.mockResolvedValue({ ok: false, reason: "not_found" });

    const res = await POST(postRequest(), routeParams(QUOTE_ID));

    expect(res.status).toBe(404);
  });

  it("已確認或已寄出（狀態機不接受 quote_declined）→ 409", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));
    mockDeclineQuote.mockResolvedValue({ ok: false, reason: "conflict" });

    const res = await POST(postRequest(), routeParams(QUOTE_ID));

    expect(res.status).toBe(409);
  });

  it("成功 → 200，報價狀態為 abandoned", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));
    mockDeclineQuote.mockResolvedValue({ ok: true, quote: DECLINED_QUOTE });

    const res = await POST(postRequest(), routeParams(QUOTE_ID));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.quote.status).toBe("abandoned");
    expect(mockDeclineQuote).toHaveBeenCalledWith({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_ID,
    });
  });

  it("service 拋錯 → 500", async () => {
    mockRequireMerchant.mockResolvedValue(authOkFixture(MERCHANT_ID));
    mockDeclineQuote.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(postRequest(), routeParams(QUOTE_ID));

    expect(res.status).toBe(500);
  });
});
