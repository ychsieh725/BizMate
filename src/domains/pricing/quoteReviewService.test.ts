import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/supabase/database.types.ts";

vi.mock("./repositories/quoteReviewRepository.ts", () => ({
  quoteReviewRepository: {
    findByMerchant: vi.fn(),
    findSessionsByIds: vi.fn(),
    findById: vi.fn(),
    findSessionById: vi.fn(),
    findLineItems: vi.fn(),
    findExtractedFields: vi.fn(),
    findClarifications: vi.fn(),
    findRawInputs: vi.fn(),
  },
}));

import { quoteReviewRepository } from "./repositories/quoteReviewRepository.ts";
import { listQuotes, getQuoteDetail } from "./quoteReviewService.ts";

const repo = vi.mocked(quoteReviewRepository);

const MERCHANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const MERCHANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SESSION_ID = "55555555-5555-5555-5555-555555555555";
const QUOTE_ID = "66666666-6666-6666-6666-666666666666";

const QUOTE_A: Tables<"quotes"> = {
  id: QUOTE_ID,
  session_id: SESSION_ID,
  merchant_id: MERCHANT_A,
  quote_code: "I-2607-001",
  final_amount: 8000,
  status: "awaiting_review",
  pdf_url: null,
  created_at: "2026-07-11T02:00:00.000Z",
  sent_at: null,
  is_conservative: false,
};

const SESSION_A: Tables<"sessions"> = {
  id: SESSION_ID,
  merchant_id: MERCHANT_A,
  category: "illustration",
  contact_email: "client@example.com",
  status: "awaiting_review",
  current_step: 4,
  created_at: "2026-07-11T01:00:00.000Z",
  updated_at: "2026-07-11T02:00:00.000Z",
};

/** 四張子表：沒有 merchant_id，歸屬檢查失敗時一次都不該被呼叫。 */
const subTableQueries = [
  () => repo.findLineItems,
  () => repo.findExtractedFields,
  () => repo.findClarifications,
  () => repo.findRawInputs,
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listQuotes", () => {
  it("無報價 → 回空陣列，且不查 sessions", async () => {
    repo.findByMerchant.mockResolvedValue([]);

    const rows = await listQuotes(MERCHANT_A);

    expect(rows).toEqual([]);
    expect(repo.findSessionsByIds).not.toHaveBeenCalled();
  });

  it("以 session 補上 category / contact_email", async () => {
    repo.findByMerchant.mockResolvedValue([QUOTE_A]);
    repo.findSessionsByIds.mockResolvedValue([SESSION_A]);

    const rows = await listQuotes(MERCHANT_A);

    expect(rows).toEqual([
      {
        id: QUOTE_ID,
        quote_code: "I-2607-001",
        final_amount: 8000,
        status: "awaiting_review",
        is_conservative: false,
        created_at: "2026-07-11T02:00:00.000Z",
        category: "illustration",
        contact_email: "client@example.com",
      },
    ]);
  });

  it("status 過濾條件傳遞至 repository", async () => {
    repo.findByMerchant.mockResolvedValue([]);

    await listQuotes(MERCHANT_A, "sent");

    expect(repo.findByMerchant).toHaveBeenCalledWith(MERCHANT_A, "sent");
  });
});

describe("getQuoteDetail", () => {
  it("報價不存在 → null，且不碰任何子表", async () => {
    repo.findById.mockResolvedValue(null);

    const detail = await getQuoteDetail(QUOTE_ID, MERCHANT_A);

    expect(detail).toBeNull();
    for (const query of subTableQueries) {
      expect(query()).not.toHaveBeenCalled();
    }
  });

  it("跨租戶：B 商家取 A 的報價 → null，且四張子表一次都沒被查（安全不變式）", async () => {
    repo.findById.mockResolvedValue(QUOTE_A);

    const detail = await getQuoteDetail(QUOTE_ID, MERCHANT_B);

    expect(detail).toBeNull();
    expect(repo.findSessionById).not.toHaveBeenCalled();
    for (const query of subTableQueries) {
      expect(query()).not.toHaveBeenCalled();
    }
  });

  it("歸屬正確 → 聚合四張子表，且子表只以 quote.session_id 查詢", async () => {
    repo.findById.mockResolvedValue(QUOTE_A);
    repo.findSessionById.mockResolvedValue(SESSION_A);
    repo.findLineItems.mockResolvedValue([]);
    repo.findExtractedFields.mockResolvedValue([]);
    repo.findClarifications.mockResolvedValue([]);
    repo.findRawInputs.mockResolvedValue([]);

    const detail = await getQuoteDetail(QUOTE_ID, MERCHANT_A);

    expect(detail).toEqual({
      quote: QUOTE_A,
      session: SESSION_A,
      lineItems: [],
      extractedFields: [],
      clarifications: [],
      rawInputs: [],
    });
    for (const query of subTableQueries) {
      expect(query()).toHaveBeenCalledWith(SESSION_ID);
    }
  });

  it("session 屬於其他商家（quotes 的兩個 FK 錯配）→ null", async () => {
    repo.findById.mockResolvedValue(QUOTE_A);
    repo.findSessionById.mockResolvedValue({
      ...SESSION_A,
      merchant_id: MERCHANT_B,
    });
    repo.findLineItems.mockResolvedValue([]);
    repo.findExtractedFields.mockResolvedValue([]);
    repo.findClarifications.mockResolvedValue([]);
    repo.findRawInputs.mockResolvedValue([]);

    const detail = await getQuoteDetail(QUOTE_ID, MERCHANT_A);

    expect(detail).toBeNull();
  });

  it("session 遺失（資料不一致）→ null", async () => {
    repo.findById.mockResolvedValue(QUOTE_A);
    repo.findSessionById.mockResolvedValue(null);
    repo.findLineItems.mockResolvedValue([]);
    repo.findExtractedFields.mockResolvedValue([]);
    repo.findClarifications.mockResolvedValue([]);
    repo.findRawInputs.mockResolvedValue([]);

    const detail = await getQuoteDetail(QUOTE_ID, MERCHANT_A);

    expect(detail).toBeNull();
  });
});
