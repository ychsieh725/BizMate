import { getSupabaseClient } from "@/lib/supabase/client.ts";
import { RepositoryError } from "@/lib/supabase/repository.ts";
import type { QuoteStatus, SessionStatus } from "@/shared/types/domain.types";

/**
 * 後台終審動作的 repository：封裝兩個原子 RPC（migration 0005）。
 *
 * 這裡刻意不繼承 BaseRepository —— 它提供的是單表 CRUD，而這兩個動作的重點
 * 正是「跨表原子寫入」，用不上也不該用單表 update。
 *
 * RPC 回傳 boolean：FALSE 代表 CAS 條件不成立（非該商家的報價、報價不在
 * 預期狀態、或併發下被搶先），呼叫端一律視為 conflict。
 */

/** 確認報價：原子推進 quotes.status 與 sessions.status。 */
export async function callConfirmQuote(params: {
  quoteId: string;
  merchantId: string;
  fromStatus: SessionStatus;
  toStatus: SessionStatus;
}): Promise<boolean> {
  const { data, error } = await getSupabaseClient().rpc("confirm_quote", {
    p_quote_id: params.quoteId,
    p_merchant_id: params.merchantId,
    p_from_status: params.fromStatus,
    p_to_status: params.toStatus,
  });
  if (error) {
    throw new RepositoryError("quotes", "callConfirmQuote", error.message);
  }
  return data === true;
}

/** 調整金額：更新 final_amount 並以手動調整明細列補差額。 */
export async function callAdjustQuoteAmount(params: {
  quoteId: string;
  merchantId: string;
  newAmount: number;
  fromStatus: QuoteStatus;
}): Promise<boolean> {
  const { data, error } = await getSupabaseClient().rpc("adjust_quote_amount", {
    p_quote_id: params.quoteId,
    p_merchant_id: params.merchantId,
    p_new_amount: params.newAmount,
    p_from_status: params.fromStatus,
  });
  if (error) {
    throw new RepositoryError("quotes", "callAdjustQuoteAmount", error.message);
  }
  return data === true;
}
