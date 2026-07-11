import { getSupabaseClient } from "@/lib/supabase/client.ts";
import { RepositoryError } from "@/lib/supabase/repository.ts";
import type { QuoteStatus, SessionStatus } from "@/shared/types/domain.types";

/**
 * 後台終審動作的 repository：封裝原子 RPC（migration 0005 + 0006）。
 *
 * 這裡刻意不繼承 BaseRepository —— 它提供的是單表 CRUD，而這些動作的重點
 * 正是「跨表原子寫入」，用不上也不該用單表 update。
 *
 * RPC 回傳 boolean：FALSE 代表 CAS 條件不成立（非該商家的報價、報價不在
 * 預期狀態、或併發下被搶先），呼叫端一律視為 conflict。
 */

/**
 * 推進報價狀態：原子同步 quotes.status 與 sessions.status，可選寫入 sent_at。
 * 供確認（5.7）與寄送（5.8）兩個轉移共用——兩者面對相同的雙表原子性問題，
 * RPC 本身不含任何業務知識（見 advance_quote_status 的 migration 註解）。
 */
export async function callAdvanceQuoteStatus(params: {
  quoteId: string;
  merchantId: string;
  fromStatus: SessionStatus;
  toStatus: SessionStatus;
  setSentAt: boolean;
}): Promise<boolean> {
  const { data, error } = await getSupabaseClient().rpc("advance_quote_status", {
    p_quote_id: params.quoteId,
    p_merchant_id: params.merchantId,
    p_from_status: params.fromStatus,
    p_to_status: params.toStatus,
    p_set_sent_at: params.setSentAt,
  });
  if (error) {
    throw new RepositoryError("quotes", "callAdvanceQuoteStatus", error.message);
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
