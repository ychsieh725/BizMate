import { quoteReviewRepository } from "./repositories/quoteReviewRepository.ts";
import type { QuoteDetail, QuoteListRow } from "./quoteReviewTypes.ts";
import type { QuoteStatus } from "@/shared/types/domain.types";

/**
 * 後台報價審核的唯讀 service（5.6）。
 *
 * 安全不變式（本模組存在的主要理由）：
 * price_line_items / extracted_fields / clarification_turns / raw_inputs
 * 四張子表只有 session_id、沒有 merchant_id，而 repository 走 service_role
 * 繞過 RLS。因此「以 quote.merchant_id 驗證歸屬」必須在任何子表查詢之前完成，
 * 且子表只接受由該 quote 帶出的 session_id——絕不接受外部傳入的 session_id。
 */

/** 該商家的報價列表（status 選填過濾）。 */
export async function listQuotes(
  merchantId: string,
  status?: QuoteStatus,
): Promise<QuoteListRow[]> {
  const quotes = await quoteReviewRepository.findByMerchant(merchantId, status);
  if (quotes.length === 0) {
    return [];
  }

  const sessions = await quoteReviewRepository.findSessionsByIds(
    quotes.map((quote) => quote.session_id),
  );
  const sessionById = new Map(
    sessions.map((session) => [session.id, session] as const),
  );

  return quotes.map((quote) => {
    const session = sessionById.get(quote.session_id);
    return {
      id: quote.id,
      quote_code: quote.quote_code,
      final_amount: quote.final_amount,
      status: quote.status,
      is_conservative: quote.is_conservative,
      created_at: quote.created_at,
      category: session?.category ?? null,
      contact_email: session?.contact_email ?? null,
    };
  });
}

/**
 * 單張報價的完整脈絡。查無或不屬於該商家一律回 null——
 * 呼叫端轉 404（不回 403，不洩漏「資源存在但非本人所有」）。
 */
export async function getQuoteDetail(
  quoteId: string,
  merchantId: string,
): Promise<QuoteDetail | null> {
  const quote = await quoteReviewRepository.findById(quoteId);
  if (quote === null || quote.merchant_id !== merchantId) {
    return null;
  }

  // ── 歸屬檢查已通過，此後才准使用 quote.session_id 查子表 ──
  const sessionId = quote.session_id;
  const [session, lineItems, extractedFields, clarifications, rawInputs] =
    await Promise.all([
      quoteReviewRepository.findSessionById(sessionId),
      quoteReviewRepository.findLineItems(sessionId),
      quoteReviewRepository.findExtractedFields(sessionId),
      quoteReviewRepository.findClarifications(sessionId),
      quoteReviewRepository.findRawInputs(sessionId),
    ]);

  if (session === null) {
    return null;
  }

  return { quote, session, lineItems, extractedFields, clarifications, rawInputs };
}
