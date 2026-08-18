import { quoteReviewRepository } from "./repositories/quoteReviewRepository.ts";
import type { QuoteDetail, QuoteListRow } from "./quoteReviewTypes.ts";
import type { QuoteStatus } from "@/shared/types/domain.types";
import { QUOTE_STATUS_LABELS } from "@/shared/constants/quoteStatus.ts";

/**
 * 後台報價審核的唯讀 service（5.6）。
 *
 * 安全不變式（本模組存在的主要理由）：
 * price_line_items / extracted_fields / clarification_turns / raw_inputs
 * 四張子表只有 session_id、沒有 merchant_id，而 repository 走 service_role
 * 繞過 RLS。因此「以 quote.merchant_id 驗證歸屬」必須在任何子表查詢之前完成，
 * 且子表只接受由該 quote 帶出的 session_id——絕不接受外部傳入的 session_id。
 */

/**
 * 該筆列表是否符合搜尋字串——比對報價編號、客戶 email、狀態中文標籤
 * （不分大小寫、子字串比對）。抽成純函式方便獨立測試。
 */
export function matchesQuoteSearch(item: QuoteListRow, query: string): boolean {
  const needle = query.toLowerCase();
  const haystack = [
    item.quote_code,
    item.contact_email ?? "",
    QUOTE_STATUS_LABELS[item.status],
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

/**
 * 該商家的報價列表（status 選填過濾，q 選填做全文搜尋）。
 *
 * q 的過濾在應用層做（先撈出 merchant+status 範圍內的全部列表，
 * 再用 matchesQuoteSearch 篩），不下推進 SQL——contact_email 在
 * sessions 表、quote_code/status 在 quotes 表，要在 DB 層對兩張表
 * 做跨表 OR 搜尋較複雜；MVP 規模下單一商家的報價筆數有限，
 * 應用層過濾足夠（同專案其他地方「量小先不分頁，量大再優化」的慣例，
 * 見 tests/e2e/support/testData.ts 的 findUserIdByEmail 註解）。
 */
export async function listQuotes(
  merchantId: string,
  status?: QuoteStatus,
  q?: string,
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

  const rows = quotes.map((quote) => {
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

  return q === undefined ? rows : rows.filter((row) => matchesQuoteSearch(row, q));
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
  const [session, lineItems, extractedFields, clarifications, rawInputs, agentSteps] =
    await Promise.all([
      quoteReviewRepository.findSessionById(sessionId),
      quoteReviewRepository.findLineItems(sessionId),
      quoteReviewRepository.findExtractedFields(sessionId),
      quoteReviewRepository.findClarifications(sessionId),
      quoteReviewRepository.findRawInputs(sessionId),
      quoteReviewRepository.findAgentSteps(sessionId),
    ]);

  // quotes.session_id 與 quotes.merchant_id 是兩個獨立 FK，DB 沒有 composite FK
  // 保證「該 session 屬於該 merchant」——維繫這個等式的是另一個模組的 insert
  // （resolveAfterParse）。在此複查，讓不變式由本模組自證，而非依賴跨模組約定。
  if (session === null || session.merchant_id !== merchantId) {
    return null;
  }

  return {
    quote,
    session,
    lineItems,
    extractedFields,
    clarifications,
    rawInputs,
    agentSteps,
  };
}
