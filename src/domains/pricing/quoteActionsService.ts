import { transition } from "@/orchestrator/stateMachine.ts";
import { quoteReviewRepository } from "./repositories/quoteReviewRepository.ts";
import {
  callConfirmQuote,
  callAdjustQuoteAmount,
} from "./repositories/quoteActionsRepository.ts";
import type { QuoteActionResult } from "./quoteActionsSchemas.ts";

/**
 * 後台終審的兩個寫入動作（5.7）。與唯讀的 quoteReviewService 分開——
 * 「看報價」與「改報價」是不同關注點。
 *
 * 共同流程：
 *   1. 歸屬檢查（重用 quoteReviewRepository.findById，同 5.6 的 404 慣例）
 *   2. 業務規則 / 狀態機驗證 → 不通過即 conflict
 *   3. 呼叫原子 RPC（migration 0005），RPC 以 CAS 擋下併發
 *
 * 狀態機（transitions.ts）是合法轉移的唯一事實來源；RPC 只收 from/to status
 * 當參數，不含業務知識。
 */

/** 可編輯的報價狀態——只有待審中的報價能改金額。 */
const EDITABLE_QUOTE_STATUS = "awaiting_review";

/** 調整最終金額。差額如何攤進明細由 RPC 負責，本層不算錢。 */
export async function adjustQuoteAmount(params: {
  quoteId: string;
  merchantId: string;
  finalAmount: number;
}): Promise<QuoteActionResult> {
  const { quoteId, merchantId, finalAmount } = params;

  const quote = await quoteReviewRepository.findById(quoteId);
  if (quote === null || quote.merchant_id !== merchantId) {
    return { ok: false, reason: "not_found" };
  }
  if (quote.status !== EDITABLE_QUOTE_STATUS) {
    return { ok: false, reason: "conflict" };
  }

  const applied = await callAdjustQuoteAmount({
    quoteId,
    merchantId,
    newAmount: finalAmount,
    fromStatus: EDITABLE_QUOTE_STATUS,
  });
  if (!applied) {
    return { ok: false, reason: "conflict" };
  }

  return reloadQuote(quoteId);
}

/** 確認報價：quote_confirmed 事件落地，原子推進 quote 與 session。 */
export async function confirmQuote(params: {
  quoteId: string;
  merchantId: string;
}): Promise<QuoteActionResult> {
  const { quoteId, merchantId } = params;

  const quote = await quoteReviewRepository.findById(quoteId);
  if (quote === null || quote.merchant_id !== merchantId) {
    return { ok: false, reason: "not_found" };
  }

  // session 是狀態機的載體；歸屬同樣要複查（quotes 的兩個 FK 各自獨立，
  // DB 沒有 composite FK 保證兩者一致——見 5.6 的同名修正）。
  const session = await quoteReviewRepository.findSessionById(quote.session_id);
  if (session === null || session.merchant_id !== merchantId) {
    return { ok: false, reason: "not_found" };
  }

  const next = transition(session.status, "quote_confirmed");
  if (!next.ok) {
    return { ok: false, reason: "conflict" };
  }

  const applied = await callConfirmQuote({
    quoteId,
    merchantId,
    fromStatus: session.status,
    toStatus: next.state,
  });
  if (!applied) {
    return { ok: false, reason: "conflict" };
  }

  return reloadQuote(quoteId);
}

/** RPC 只回 boolean，成功後重讀報價回傳給前端。 */
async function reloadQuote(quoteId: string): Promise<QuoteActionResult> {
  const updated = await quoteReviewRepository.findById(quoteId);
  if (updated === null) {
    return { ok: false, reason: "not_found" };
  }
  return { ok: true, quote: updated };
}
