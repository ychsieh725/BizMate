import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/supabase/database.types.ts";

vi.mock("./repositories/quoteReviewRepository.ts", () => ({
  quoteReviewRepository: {
    findById: vi.fn(),
    findSessionById: vi.fn(),
  },
}));

vi.mock("./repositories/quoteActionsRepository.ts", () => ({
  callAdvanceQuoteStatus: vi.fn(),
  callAdjustQuoteAmount: vi.fn(),
}));

import { quoteReviewRepository } from "./repositories/quoteReviewRepository.ts";
import {
  callAdvanceQuoteStatus,
  callAdjustQuoteAmount,
} from "./repositories/quoteActionsRepository.ts";
import { adjustQuoteAmount, confirmQuote } from "./quoteActionsService.ts";

const repo = vi.mocked(quoteReviewRepository);
const mockAdvance = vi.mocked(callAdvanceQuoteStatus);
const mockAdjust = vi.mocked(callAdjustQuoteAmount);

const MERCHANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MERCHANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const QUOTE_ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const SESSION_ID = "a3bb189e-8bf9-4888-9912-ace4e6543002";

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("adjustQuoteAmount", () => {
  it("報價不存在 → not_found，且不呼叫 RPC", async () => {
    repo.findById.mockResolvedValue(null);

    const result = await adjustQuoteAmount({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_A,
      finalAmount: 9000,
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(mockAdjust).not.toHaveBeenCalled();
  });

  it("跨租戶：B 調 A 的報價 → not_found，且不呼叫 RPC", async () => {
    repo.findById.mockResolvedValue(QUOTE_A);

    const result = await adjustQuoteAmount({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_B,
      finalAmount: 9000,
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(mockAdjust).not.toHaveBeenCalled();
  });

  it("報價已確認（非 awaiting_review）→ conflict，且不呼叫 RPC", async () => {
    repo.findById.mockResolvedValue({ ...QUOTE_A, status: "confirmed" });

    const result = await adjustQuoteAmount({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_A,
      finalAmount: 9000,
    });

    expect(result).toEqual({ ok: false, reason: "conflict" });
    expect(mockAdjust).not.toHaveBeenCalled();
  });

  it("RPC 回 false（併發下被搶先）→ conflict", async () => {
    repo.findById.mockResolvedValue(QUOTE_A);
    repo.findSessionById.mockResolvedValue(SESSION_A);
    mockAdjust.mockResolvedValue(false);

    const result = await adjustQuoteAmount({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_A,
      finalAmount: 9000,
    });

    expect(result).toEqual({ ok: false, reason: "conflict" });
  });

  it("session 屬於其他商家 → not_found，且不呼叫 RPC", async () => {
    repo.findById.mockResolvedValue(QUOTE_A);
    repo.findSessionById.mockResolvedValue({
      ...SESSION_A,
      merchant_id: MERCHANT_B,
    });

    const result = await adjustQuoteAmount({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_A,
      finalAmount: 9000,
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(mockAdjust).not.toHaveBeenCalled();
  });

  // 計價 pipeline 的寫入順序是「建 quote(awaiting_review) → 寫明細 → 推進 session」
  // （resolveAfterParse.ts:126-146）。若只看 quote.status 就放行，PATCH 可能落在
  // 「quote 已待審、明細還沒進 DB」的窗口內：base_sum=0 → 插入等於全額的調整列 →
  // pipeline 隨後補上基礎明細 → sum(line_items) != final_amount，不變式破裂。
  // session 狀態是 pipeline 最後才推進的，拿它當閘門即可關掉這個窗口。
  it("session 尚未進入 awaiting_review（明細還沒落地）→ conflict，且不呼叫 RPC", async () => {
    repo.findById.mockResolvedValue(QUOTE_A);
    repo.findSessionById.mockResolvedValue({ ...SESSION_A, status: "pricing" });

    const result = await adjustQuoteAmount({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_A,
      finalAmount: 9000,
    });

    expect(result).toEqual({ ok: false, reason: "conflict" });
    expect(mockAdjust).not.toHaveBeenCalled();
  });

  it("成功 → 回傳更新後的報價，RPC 參數正確", async () => {
    const updated = { ...QUOTE_A, final_amount: 9000 };
    repo.findById
      .mockResolvedValueOnce(QUOTE_A)
      .mockResolvedValueOnce(updated);
    repo.findSessionById.mockResolvedValue(SESSION_A);
    mockAdjust.mockResolvedValue(true);

    const result = await adjustQuoteAmount({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_A,
      finalAmount: 9000,
    });

    expect(result).toEqual({ ok: true, quote: updated });
    expect(mockAdjust).toHaveBeenCalledWith({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_A,
      newAmount: 9000,
      fromStatus: "awaiting_review",
    });
  });
});

describe("confirmQuote", () => {
  it("跨租戶：B 確認 A 的報價 → not_found，且不呼叫 RPC", async () => {
    repo.findById.mockResolvedValue(QUOTE_A);

    const result = await confirmQuote({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_B,
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(repo.findSessionById).not.toHaveBeenCalled();
    expect(mockAdvance).not.toHaveBeenCalled();
  });

  it("session 屬於其他商家 → not_found", async () => {
    repo.findById.mockResolvedValue(QUOTE_A);
    repo.findSessionById.mockResolvedValue({
      ...SESSION_A,
      merchant_id: MERCHANT_B,
    });

    const result = await confirmQuote({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_A,
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(mockAdvance).not.toHaveBeenCalled();
  });

  it("session 已 confirmed（狀態機不接受 quote_confirmed）→ conflict", async () => {
    repo.findById.mockResolvedValue(QUOTE_A);
    repo.findSessionById.mockResolvedValue({
      ...SESSION_A,
      status: "confirmed",
    });

    const result = await confirmQuote({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_A,
    });

    expect(result).toEqual({ ok: false, reason: "conflict" });
    expect(mockAdvance).not.toHaveBeenCalled();
  });

  it("RPC 回 false（併發下被搶先）→ conflict", async () => {
    repo.findById.mockResolvedValue(QUOTE_A);
    repo.findSessionById.mockResolvedValue(SESSION_A);
    mockAdvance.mockResolvedValue(false);

    const result = await confirmQuote({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_A,
    });

    expect(result).toEqual({ ok: false, reason: "conflict" });
  });

  it("成功 → from/to status 來自狀態機（非硬編碼），回傳確認後的報價", async () => {
    const confirmed = { ...QUOTE_A, status: "confirmed" as const };
    repo.findById
      .mockResolvedValueOnce(QUOTE_A)
      .mockResolvedValueOnce(confirmed);
    repo.findSessionById.mockResolvedValue(SESSION_A);
    mockAdvance.mockResolvedValue(true);

    const result = await confirmQuote({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_A,
    });

    expect(result).toEqual({ ok: true, quote: confirmed });
    expect(mockAdvance).toHaveBeenCalledWith({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_A,
      fromStatus: "awaiting_review",
      toStatus: "confirmed",
      setSentAt: false,
    });
  });
});
