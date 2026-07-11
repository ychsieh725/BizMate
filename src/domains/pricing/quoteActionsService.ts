import { transition } from "@/orchestrator/stateMachine.ts";
import { quoteReviewRepository } from "./repositories/quoteReviewRepository.ts";
import {
  callAdvanceQuoteStatus,
  callAdjustQuoteAmount,
} from "./repositories/quoteActionsRepository.ts";
import type { QuoteActionResult } from "./quoteActionsSchemas.ts";
import { getQuoteDetail } from "./quoteReviewService.ts";
import { merchantsRepository } from "@/domains/merchant/repositories/merchantsRepository.ts";
import { renderQuoteEmail } from "@/lib/email/renderQuoteEmail.ts";
import { sendEmail } from "@/lib/email/resendClient.ts";

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

  // session 也要過閘門，理由有二：
  // (1) 歸屬複查——quotes 的 session_id 與 merchant_id 是兩個獨立 FK（見 5.6）。
  // (2) 關掉不變式的破口：計價 pipeline 先建 quote（已是 awaiting_review）、
  //     再寫明細、最後才推進 session（resolveAfterParse.ts:126-146）。只看
  //     quote.status 就放行的話，PATCH 可能落在「明細尚未落地」的窗口內，
  //     RPC 會以 base_sum=0 算差額並插入等於全額的調整列，等 pipeline 補上
  //     基礎明細後 sum(line_items) != final_amount。session 狀態是最後才推進的，
  //     拿它當閘門即可保證明細已完整落地。
  const session = await quoteReviewRepository.findSessionById(quote.session_id);
  if (session === null || session.merchant_id !== merchantId) {
    return { ok: false, reason: "not_found" };
  }
  if (session.status !== EDITABLE_QUOTE_STATUS) {
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

  const applied = await callAdvanceQuoteStatus({
    quoteId,
    merchantId,
    fromStatus: session.status,
    toStatus: next.state,
    setSentAt: false,
  });
  if (!applied) {
    return { ok: false, reason: "conflict" };
  }

  return reloadQuote(quoteId);
}

/**
 * 寄送最終報價單：email_sent 事件落地。
 * 順序刻意固定：先呼叫 Resend、成功了才推進狀態——若順序反過來，
 * 狀態已是 sent 但信根本沒寄出，商家會誤以為流程已完成。
 * 失敗（Resend 或 RPC）都不留半套狀態：Resend 失敗時 quote 留在 confirmed，
 * 本 API 天然冪等地允許重新呼叫（即重寄機制，不需獨立端點）。
 */
export async function sendQuoteEmail(params: {
  quoteId: string;
  merchantId: string;
}): Promise<QuoteActionResult> {
  const { quoteId, merchantId } = params;

  const detail = await getQuoteDetail(quoteId, merchantId);
  if (detail === null) {
    return { ok: false, reason: "not_found" };
  }

  const { quote, session, lineItems } = detail;

  const next = transition(session.status, "email_sent");
  if (!next.ok) {
    return { ok: false, reason: "conflict" };
  }

  const merchant = await merchantsRepository.findById(merchantId);
  if (merchant === null) {
    throw new Error(`sendQuoteEmail: merchant ${merchantId} 應存在但查無`);
  }
  if (session.contact_email === null) {
    throw new Error(
      `sendQuoteEmail: session ${session.id} 缺少 contact_email，資料不一致` +
        "（Step 2 的 describe API 已強制要求此欄位，不應發生）",
    );
  }

  const rendered = renderQuoteEmail({ merchant, quote, lineItems });
  const sent = await sendEmail({
    to: session.contact_email,
    replyTo: merchant.contact_email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
  if (!sent.ok) {
    return { ok: false, reason: "email_failed", message: sent.message };
  }

  const applied = await callAdvanceQuoteStatus({
    quoteId,
    merchantId,
    fromStatus: session.status,
    toStatus: next.state,
    setSentAt: true,
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
