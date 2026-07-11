import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/supabase/database.types.ts";

vi.mock("@/lib/auth/requireMerchant.ts", () => ({
  requireMerchant: vi.fn(),
}));

vi.mock("@/domains/pricing/quoteActionsService.ts", () => ({
  sendQuoteEmail: vi.fn(),
}));

import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { sendQuoteEmail } from "@/domains/pricing/quoteActionsService.ts";
import { POST } from "./route.ts";

const mockRequireMerchant = vi.mocked(requireMerchant);
const mockSendQuoteEmail = vi.mocked(sendQuoteEmail);

const MERCHANT_ID = "99999999-9999-4999-8999-999999999999";
const QUOTE_ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

const SENT_QUOTE: Tables<"quotes"> = {
  id: QUOTE_ID,
  session_id: "a3bb189e-8bf9-4888-9912-ace4e6543002",
  merchant_id: MERCHANT_ID,
  quote_code: "I-2607-001",
  final_amount: 9000,
  status: "sent",
  pdf_url: null,
  created_at: "2026-07-11T02:00:00.000Z",
  sent_at: "2026-07-11T03:00:00.000Z",
  is_conservative: false,
};

function postRequest(): Request {
  return new Request(`http://localhost/api/dashboard/quotes/${QUOTE_ID}/send`, {
    method: "POST",
  });
}

function routeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/dashboard/quotes/[id]/send", () => {
  it("未登入 → 401", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 401 });

    const res = await POST(postRequest(), routeParams(QUOTE_ID));

    expect(res.status).toBe(401);
    expect(mockSendQuoteEmail).not.toHaveBeenCalled();
  });

  it("已登入無 merchant → 403", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 403 });

    const res = await POST(postRequest(), routeParams(QUOTE_ID));

    expect(res.status).toBe(403);
  });

  it("id 非 UUID → 400", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });

    const res = await POST(postRequest(), routeParams("bad-id"));

    expect(res.status).toBe(400);
    expect(mockSendQuoteEmail).not.toHaveBeenCalled();
  });

  it("跨租戶或不存在 → 404", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockSendQuoteEmail.mockResolvedValue({ ok: false, reason: "not_found" });

    const res = await POST(postRequest(), routeParams(QUOTE_ID));

    expect(res.status).toBe(404);
  });

  it("報價不在 confirmed → 409", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockSendQuoteEmail.mockResolvedValue({ ok: false, reason: "conflict" });

    const res = await POST(postRequest(), routeParams(QUOTE_ID));

    expect(res.status).toBe(409);
  });

  it("Resend 寄送失敗 → 502", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockSendQuoteEmail.mockResolvedValue({
      ok: false,
      reason: "email_failed",
      message: "domain not verified",
    });

    const res = await POST(postRequest(), routeParams(QUOTE_ID));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.error).toContain("domain not verified");
  });

  it("成功 → 200，報價狀態為 sent", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockSendQuoteEmail.mockResolvedValue({ ok: true, quote: SENT_QUOTE });

    const res = await POST(postRequest(), routeParams(QUOTE_ID));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.quote.status).toBe("sent");
    expect(mockSendQuoteEmail).toHaveBeenCalledWith({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_ID,
    });
  });

  it("service 拋錯（例如資料不一致的 throw）→ 500", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockSendQuoteEmail.mockRejectedValue(new Error("data inconsistent"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(postRequest(), routeParams(QUOTE_ID));

    expect(res.status).toBe(500);
  });
});
