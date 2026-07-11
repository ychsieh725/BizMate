import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/supabase/database.types.ts";

vi.mock("./repositories/quoteReviewRepository.ts", () => ({
  quoteReviewRepository: {
    findById: vi.fn(),
    findSessionById: vi.fn(),
  },
}));

vi.mock("./repositories/quoteActionsRepository.ts", () => ({
  callConfirmQuote: vi.fn(),
  callAdjustQuoteAmount: vi.fn(),
}));

import { quoteReviewRepository } from "./repositories/quoteReviewRepository.ts";
import {
  callConfirmQuote,
  callAdjustQuoteAmount,
} from "./repositories/quoteActionsRepository.ts";
import { adjustQuoteAmount, confirmQuote } from "./quoteActionsService.ts";

const repo = vi.mocked(quoteReviewRepository);
const mockConfirm = vi.mocked(callConfirmQuote);
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
    mockAdjust.mockResolvedValue(false);

    const result = await adjustQuoteAmount({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_A,
      finalAmount: 9000,
    });

    expect(result).toEqual({ ok: false, reason: "conflict" });
  });

  it("成功 → 回傳更新後的報價，RPC 參數正確", async () => {
    const updated = { ...QUOTE_A, final_amount: 9000 };
    repo.findById
      .mockResolvedValueOnce(QUOTE_A)
      .mockResolvedValueOnce(updated);
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
    expect(mockConfirm).not.toHaveBeenCalled();
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
    expect(mockConfirm).not.toHaveBeenCalled();
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
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("RPC 回 false（併發下被搶先）→ conflict", async () => {
    repo.findById.mockResolvedValue(QUOTE_A);
    repo.findSessionById.mockResolvedValue(SESSION_A);
    mockConfirm.mockResolvedValue(false);

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
    mockConfirm.mockResolvedValue(true);

    const result = await confirmQuote({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_A,
    });

    expect(result).toEqual({ ok: true, quote: confirmed });
    expect(mockConfirm).toHaveBeenCalledWith({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_A,
      fromStatus: "awaiting_review",
      toStatus: "confirmed",
    });
  });
});
