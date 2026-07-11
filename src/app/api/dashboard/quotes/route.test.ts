import { describe, it, expect, vi, beforeEach } from "vitest";
import type { QuoteListRow } from "@/domains/pricing/quoteReviewTypes.ts";

vi.mock("@/lib/auth/requireMerchant.ts", () => ({
  requireMerchant: vi.fn(),
}));

vi.mock("@/domains/pricing/quoteReviewService.ts", () => ({
  listQuotes: vi.fn(),
}));

import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { listQuotes } from "@/domains/pricing/quoteReviewService.ts";
import { GET } from "./route.ts";

const mockRequireMerchant = vi.mocked(requireMerchant);
const mockListQuotes = vi.mocked(listQuotes);

const MERCHANT_ID = "99999999-9999-9999-9999-999999999999";

const ROW: QuoteListRow = {
  id: "66666666-6666-6666-6666-666666666666",
  quote_code: "I-2607-001",
  final_amount: 8000,
  status: "awaiting_review",
  is_conservative: false,
  created_at: "2026-07-11T02:00:00.000Z",
  category: "illustration",
  contact_email: "client@example.com",
};

function getRequest(query = ""): Request {
  return new Request(`http://localhost/api/dashboard/quotes${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/dashboard/quotes", () => {
  it("未登入 → 401", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 401 });

    const res = await GET(getRequest());

    expect(res.status).toBe(401);
    expect(mockListQuotes).not.toHaveBeenCalled();
  });

  it("已登入無 merchant → 403", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 403 });

    const res = await GET(getRequest());

    expect(res.status).toBe(403);
    expect(mockListQuotes).not.toHaveBeenCalled();
  });

  it("status 非法值 → 400", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });

    const res = await GET(getRequest("?status=pending"));

    expect(res.status).toBe(400);
    expect(mockListQuotes).not.toHaveBeenCalled();
  });

  it("無 status → 回全部（status 傳 undefined）", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockListQuotes.mockResolvedValue([ROW]);

    const res = await GET(getRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.items).toEqual([ROW]);
    expect(mockListQuotes).toHaveBeenCalledWith(MERCHANT_ID, undefined);
  });

  it("帶合法 status → 過濾條件傳遞至 service", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockListQuotes.mockResolvedValue([]);

    const res = await GET(getRequest("?status=awaiting_review"));

    expect(res.status).toBe(200);
    expect(mockListQuotes).toHaveBeenCalledWith(MERCHANT_ID, "awaiting_review");
  });

  it("service 拋錯 → 500", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockListQuotes.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(getRequest());

    expect(res.status).toBe(500);
  });
});
